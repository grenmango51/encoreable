/**
 * Turn an observed protocol log plus both teams into a replayable input log.
 *
 * A replay records *executions*, never decisions: no seed, no choices, and the
 * opponent's HP only as a Champions percentage. This rebuilds the missing input
 * log by replaying the battle forward one turn at a time and checking its own
 * work as it goes.
 *
 *   1. the simulator says what choice it wants and what is legal
 *      (`side.activeRequest`, ENGINEERING.md 5.7). We only answer "which of the
 *      offered options did the player pick", and the observed log says.
 *   2. the turn is written, and the protocol lines it emitted are compared - in
 *      the same channel the observation came from - against the observed ones.
 *   3. on a mismatch the turn's random draws are settled one at a time, in the
 *      order the simulator consumed them, each against the observed lines. A
 *      draw is only ever moved to another value it could have produced anyway.
 *   4. on exhaustion, back up a turn and redraw: a sampled HP can make the next
 *      turn's observation unreachable.
 *
 * Nothing here computes damage, accuracy, turn order or HP. The reconstruction
 * decides which choice to write and which face of a die to keep; the Stat Point
 * inference at the end of the file decides which spreads survive, and asks the
 * simulator every question that takes.
 *
 * Searching for a seed that reproduces a whole turn at once costs the *product*
 * of every random event in it, which is why ENGINEERING.md 4 opens by saying
 * seed search was never required. Settling draws one at a time costs their sum.
 * `>editbattle hp` stays rejected: it writes an HP no roll can produce, a log
 * inconsistent with its own seed (ENGINEERING.md 4.3).
 */

import { createRequire } from 'module';

import { battleLines, firstDivergence } from './protocol.mjs';
import { install, traceOn, markDraws, atLine } from './rng-control.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams, toID, Utils } = require('pokemon-showdown');
// Not re-exported by `sim/index.ts`; see ENGINEERING.md 6.5. This is the sim's
// own resolver for the secret/public split, so no percentage arithmetic of ours
// exists anywhere in this project.
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');

/** Move targets the chooser must name explicitly (sim/battle-actions.ts:3). */
const CHOOSABLE_TARGETS = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

/**
 * Pre-turn protocol lines allowed to differ without failing the reconstruction.
 *
 * A Bo3 replay says `|tier|... (Bo3)` and publishes `|showteam|` lines that a
 * plain single game never emits. `|player|` repeats: a recording produced by
 * branching re-issues `>player` to update an avatar, and the server echoes one
 * more for every browser window that joins - neither is something the simulator
 * emits from a battle. Names, avatars and teams are checked directly instead.
 *
 * Everything substantive is still compared: `|poke|`, `|teamsize|`, `|start`,
 * the lead `|switch|` lines and `|turn|1`.
 */
const SOFT_PRETURN = new Set(['tier', 'rule', 'showteam', 'teampreview', 'player']);

// --------------------------------------------------------------- log utilities

const identName = ident => String(ident || '').split(': ').slice(1).join(': ');
const identSide = ident => String(ident || '').slice(0, 2);
const identSlot = ident => 'abc'.indexOf(String(ident || '')[2]);

/** Tags on a protocol line, as `{ from: 'lockedmove', spread: 'p1a,p1b', ... }`. */
function tagsOf(line) {
  const tags = {};
  for (const part of line.split('|').slice(1)) {
    const m = /^\[([a-z]+)\]\s*(.*)$/.exec(part.trim());
    if (m) tags[m[1]] = m[2];
  }
  return tags;
}

/**
 * Split an observed log into one segment per turn.
 *
 * Segment 0 is everything up to and including `|turn|1`; segment k is turn k's
 * lines up to and including `|turn|k+1`. A segment therefore ends with the line
 * that opens the next turn, which makes "did this turn end the way it really
 * did" a single string comparison.
 */
export function splitTurns(lines) {
  const segments = [[]];
  for (const line of lines) {
    segments[segments.length - 1].push(line);
    if (/^\|turn\|\d+/.test(line)) segments.push([]);
  }
  if (!segments[segments.length - 1].length) segments.pop();
  return segments;
}

/**
 * What the players did in one turn, as far as a replay can show it.
 *
 * `switches` are chosen switches - they appear before any action line and carry
 * no `[from]` tag, because a switch chosen at the start of a turn always
 * resolves before every move. Everything else that puts a Pokemon on the field
 * is a *consequence* (a faint replacement, a self-switch such as Parting Shot),
 * and is queued for whatever forced-switch request the simulator raises.
 */
function planSegment(segment, dex) {
  const firstAction = segment.findIndex(l => /^\|(move|cant)\|/.test(l));
  const cutoff = firstAction < 0 ? segment.length : firstAction;

  const plan = {
    switches: { p1: [], p2: [] },   // [slotIndex] -> species name
    actions: { p1: [], p2: [] },    // [slotIndex] -> { moveid, target, mega }
    forced: { p1: [], p2: [] },     // in log order
    megas: new Set(),
  };

  for (const [i, line] of segment.entries()) {
    const parts = line.split('|');
    const kind = parts[1];

    if (kind === '-mega' || kind === 'detailschange') {
      // `-mega` is the reliable marker; `detailschange` alone also covers forme
      // changes that are not a mega evolution at all.
      if (kind === '-mega') plan.megas.add(String(parts[2] || '').split(': ')[0]);
      continue;
    }

    if (kind === 'switch') {
      const side = identSide(parts[2]);
      const slot = identSlot(parts[2]);
      const name = identName(parts[2]);
      if (i < cutoff && !tagsOf(line).from) plan.switches[side][slot] = name;
      else plan.forced[side].push({ slot, name });
      continue;
    }

    if (kind === 'move') {
      const from = tagsOf(line).from;
      // A `[from]` move was executed by something other than a fresh choice -
      // Copycat, Instruct, Dancer, Magic Bounce, Sleep Talk. `lockedmove` is the
      // exception: a locked Pokemon still gets a request offering exactly one
      // move (sim/pokemon.ts:1090), so it does need a choice line.
      if (from && from !== 'lockedmove') continue;
      const side = identSide(parts[2]);
      const slot = identSlot(parts[2]);
      const moveid = toID(parts[3]);
      const target = parts[4] && parts[4].includes(': ') ? parts[4] : null;
      plan.actions[side][slot] = {
        moveid,
        target,
        needsTarget: CHOOSABLE_TARGETS.has(dex.moves.get(moveid).target),
      };
    }
  }
  return plan;
}

/**
 * Recover targets the log does not state.
 *
 * `|move|p1a: Charizard|Solar Beam||[still]` has an empty target field on the
 * charge turn, but a target was chosen. The execution turn names it:
 * `|move|p1a: Charizard|Solar Beam|p2b: Pelipper|[from] lockedmove`.
 */
function recoverChargeTargets(plans) {
  for (const [k, plan] of plans.entries()) {
    for (const side of ['p1', 'p2']) {
      for (const [slot, action] of plan.actions[side].entries()) {
        if (!action || action.target || !action.needsTarget) continue;
        for (const later of plans.slice(k + 1)) {
          const match = later.actions[side][slot];
          if (match?.moveid === action.moveid && match.target) {
            action.target = match.target;
            action.recovered = true;
            break;
          }
        }
      }
    }
  }
}

/** The order Pokemon were revealed, per side: leads first, then first sightings. */
function revealOrder(lines) {
  const order = { p1: [], p2: [] };
  for (const line of lines) {
    const parts = line.split('|');
    if (!['switch', 'drag', 'replace'].includes(parts[1])) continue;
    const side = identSide(parts[2]);
    const name = identName(parts[2]);
    if (order[side] && !order[side].includes(name)) order[side].push(name);
  }
  return order;
}

/** `|teamsize|pN|4` -> how many each side brought. */
function teamSizes(lines) {
  const sizes = { p1: 6, p2: 6 };
  for (const line of lines) {
    const parts = line.split('|');
    if (parts[1] === 'teamsize' && sizes[parts[2]] !== undefined) sizes[parts[2]] = Number(parts[3]);
  }
  return sizes;
}

/** `|player|p1|cundangcap|266|1780` -> the avatar the log will re-emit. */
function avatars(lines) {
  const found = { p1: '', p2: '' };
  for (const line of lines) {
    const parts = line.split('|');
    // first wins, to match the `>player` line that actually carried the team
    if (parts[1] === 'player' && found[parts[2]] === '') found[parts[2]] = parts[4] || '';
  }
  return found;
}

// ----------------------------------------------------------------- sampling

/** A deterministic stream of seeds and picks, so a reconstruction is reproducible. */
function sampler(sampleSeed) {
  let state = (sampleSeed >>> 0) || 1;
  const next32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
  return {
    seed() {
      let hex = '';
      for (let i = 0; i < 4; i++) hex += next32().toString(16).padStart(8, '0');
      return `sodium,${hex}`;
    },
    pick(n) {
      return n <= 1 ? 0 : next32() % n;
    },
  };
}

// ----------------------------------------------------------------- the driver

/** Relative target location: positive for a foe, negative for an ally. */
function targetLoc(actorSide, actorSlot, targetIdent) {
  const side = identSide(targetIdent);
  const slot = identSlot(targetIdent);
  if (slot < 0) return null;
  return side === actorSide ? -(slot + 1) : slot + 1;
}

/**
 * Every target a move choice could have carried, best guess first.
 *
 * A replay under-determines a move's target in three separate ways, all of them
 * measured against the real input logs in `recordings/`:
 *
 *   - the target may never have been named at all. `>p2 move memento` and
 *     `>p2 move memento +1` are not the same input: with no target the simulator
 *     resolves one itself through `getRandomTarget`, which *draws*. So an
 *     omitted target shifts every roll after it.
 *   - the target that executed may not be the target that was chosen. A choice
 *     of `+1` is redirected to `+2` when the first slot is gone (or by Rage
 *     Powder), and the log records only where the move landed.
 *   - a move that never executed - the Pokemon fainted first, or was flinched -
 *     leaves no line at all, yet its target still moved the RNG stream.
 *
 * None of the three is recoverable from a replay, so all of them are search
 * variables. `preferred` goes first because it is right most of the time.
 */
function targetOptions(side, actorSlot, moveTarget, preferred = null) {
  // A locked move is offered with NO target field at all (`sim/pokemon.ts:971`
  // returns just `{move, id}`), and naming a target for it is rejected outright:
  // the simulator reuses the target stored when the move was first chosen.
  if (!moveTarget || !CHOOSABLE_TARGETS.has(moveTarget)) return [''];

  // Naming no target is not an option in doubles: `sim/side.ts:663` rejects a
  // choosable-target move with no target outright. A recorded log CAN still
  // contain one - `getChoice()` omits a `targetLoc` of 0, which is what an
  // auto-chosen target leaves behind - and such a log is unreplayable through
  // no fault of ours (ENGINEERING.md 6.1). Detected and reported, not guessed.
  const doubles = side.active.length >= 2;
  if (moveTarget === 'adjacentAllyOrSelf') return [` -${actorSlot + 1}`];
  if (moveTarget === 'adjacentAlly') return [` -${actorSlot === 0 ? 2 : 1}`];

  const live = (side.foe?.active || []).map(p => !!p && !p.fainted);
  const options = [];
  for (let i = 0; i < Math.max(1, live.length); i++) {
    if (!live.length || live[i]) options.push(` +${i + 1}`);
  }
  if (!options.length) options.push(' +1');

  // `normal` and `any` reach an adjacent ALLY too - `>p2 move memento -2` is a
  // real recorded choice. Offering only foes makes a whole class of turn
  // impossible to reproduce.
  if (doubles && moveTarget !== 'adjacentFoe') {
    const ally = side.active[actorSlot === 0 ? 1 : 0];
    if (ally && !ally.fainted) options.push(` -${actorSlot === 0 ? 2 : 1}`);
  }

  return [...new Set([preferred, ...options, ...(doubles ? [] : [''])].filter(o => o !== null))];
}

/** Self-switching moves change the position, so they are the worst guess. */
function selfSwitchLast(dex) {
  return (a, b) => Number(!!dex.moves.get(a.id).selfSwitch) - Number(!!dex.moves.get(b.id).selfSwitch);
}

/**
 * The choice string for one side's current request.
 *
 * Everything legal is read off the live request. Nothing is read off the set's
 * movelist: legality is dynamic (ENGINEERING.md 5.6), and a locked or disabled
 * move is offered or withheld by the simulator, not by us.
 */
function choiceFor(side, plan, state, notes) {
  const request = side.activeRequest;
  const sideId = side.id;

  if (request.teamPreview) {
    const bench = request.side.pokemon.map(p => identName(p.ident));
    const order = [];
    for (const name of state.reveal[sideId]) {
      const at = bench.indexOf(name);
      if (at >= 0 && !order.includes(at + 1)) order.push(at + 1);
    }
    for (let i = 0; i < bench.length && order.length < state.sizes[sideId]; i++) {
      if (!order.includes(i + 1)) {
        order.push(i + 1);
        notes.push(`${sideId} brought a Pokemon that never appeared - assumed ${bench[i]}`);
      }
    }
    return `team ${order.slice(0, state.sizes[sideId]).join(', ')}`;
  }

  if (request.forceSwitch) {
    const bench = request.side.pokemon.map(p => identName(p.ident));
    const queue = state.forced[sideId];
    return request.forceSwitch.map((needed, i) => {
      if (!needed) return 'pass';
      // Match the slot the log names, not merely the order. When both actives
      // faint but only one Pokemon is left, the real choice is `pass, switch N`
      // - and which slot passes is a fact the observed switch records.
      let at = queue.findIndex(entry => entry.slot === i);
      if (at < 0) at = queue.findIndex(entry => entry.slot === undefined);
      if (at < 0) {
        // Nothing observed for this slot. Either the side had no Pokemon left
        // to send (a legal `pass`), or our rolls knocked out someone who
        // survived in reality - in which case the write is rejected and the
        // search hears about it.
        return 'pass';
      }
      const [entry] = queue.splice(at, 1);
      const to = bench.indexOf(entry.name);
      if (to < 0) {
        state.unsatisfied = `${sideId} switched in ${entry.name}, which is not on the bench`;
        return 'pass';
      }
      return `switch ${to + 1}`;
    }).join(', ');
  }

  return request.active.map((slot, i) => {
    const own = request.side.pokemon[i];
    if (!slot || !slot.moves || own?.condition?.endsWith(' fnt')) return 'pass';

    const wantedSwitch = plan.switches[sideId][i];
    if (wantedSwitch) {
      const at = request.side.pokemon.map(p => identName(p.ident)).indexOf(wantedSwitch);
      if (at >= 0) return `switch ${at + 1}`;
    }

    const action = plan.actions[sideId][i];
    const mega = plan.megas.has(`${sideId}${'abc'[i]}`) && slot.canMegaEvo ? ' mega' : '';

    if (!action) {
      // Nothing executed for this slot: it fainted before acting, was flinched
      // or fully paralysed, or the battle ended before its action ran. No PP
      // moved and no state changed - but the target still perturbs the RNG
      // stream, so which substitution we make is a search variable.
      notes.push(`${sideId} slot ${i + 1} made an invisible choice - substituted a legal move`);
      const usable = slot.moves
        .map((m, j) => ({ ...m, j }))
        .filter(m => !m.disabled)
        .sort(state.selfSwitchLast);
      const options = [];
      for (const m of usable) {
        for (const suffix of targetOptions(side, i, m.target)) {
          options.push(`move ${m.j + 1}${suffix}${mega}`);
        }
      }
      if (!options.length) return 'pass';
      return options[state.nextVariantDigit(options.length)];
    }

    const at = slot.moves.findIndex(m => m.id === action.moveid);
    if (at < 0) {
      // The simulator is not offering the move the log says was used. That is a
      // real divergence, not something to paper over.
      state.unsatisfied = `${sideId} slot ${i + 1} used ${action.moveid}, which the simulator did not offer`;
      return `move 1${targetOptions(side, i, slot.moves[0]?.target)[0]}${mega}`;
    }

    const moveTarget = slot.moves[at].target;
    let suffix = '';
    if (moveTarget && CHOOSABLE_TARGETS.has(moveTarget)) {
      // `|move|…|Shadow Ball|p2: Glalie|[notarget]` names a *side*, not a slot -
      // the chosen target had already left the field, so there is no slot to
      // read. Where the log does name a slot, that is only where the move
      // *landed*, which is the best guess and not a fact.
      const loc = action.target ? targetLoc(sideId, i, action.target) : null;
      const preferred = loc === null ? null : ` ${loc > 0 ? '+' : ''}${loc}`;
      const options = targetOptions(side, i, moveTarget, preferred);
      suffix = options[state.nextVariantDigit(options.length)];
    }
    return `move ${at + 1}${suffix}${mega}`;
  }).join(', ');
}

/** The lines a raw log slice shows on one channel. */
function onChannel(raw, channel) {
  return extractChannelMessages(raw.join('\n'), [channel])[channel];
}

// ------------------------------------------------------------ per-draw control

/**
 * The draws one segment consumed, as `{ i, lo, hi, value }`.
 *
 * `from`/`to` are the arguments the simulator handed `random()`: one of them is
 * a bare face count, both of them are a half-open range. Float draws and
 * one-faced ranges are dropped - there is nothing to choose.
 */
function drawsOf(trace, seg) {
  const rows = [];
  for (const { i, from, to, value, mark } of trace || []) {
    if (mark !== seg || from < 0) continue;
    const lo = to < 0 ? 0 : from;
    const hi = (to < 0 ? from : to) - 1;
    if (hi <= lo) continue;
    rows.push({ i, lo, hi, value });
  }
  return rows;
}

/**
 * The values worth trying for one draw.
 *
 * Both extremes settle every binary decision, because accuracy, crit and every
 * proc are `random(d) < n` (`sim/prng.ts:116`) - which side of the line the draw
 * falls on is the whole question. A small range is enumerated outright: that is
 * the damage roll's 16 bands, a multi-hit `sample`, a sleep duration, a speed
 * tie's shuffle.
 */
function candidates({ lo, hi, value }) {
  const span = hi - lo + 1;
  const all = span <= 16 ? Array.from({ length: span }, (_, k) => lo + k) : [lo, hi];
  return all.filter(v => v !== value);
}

/**
 * Replay the whole battle under a given set of per-turn seeds.
 *
 * Stops at the first turn whose emitted lines disagree with the observed ones,
 * unless `tolerant` is set - which is how a best-effort log is produced after
 * the search gives up.
 */
async function playThrough({ header, segments, plans, reseeds, variants, subs, channel, exact, state0, dex, stopAt, tolerant }) {
  const stream = new BattleStream({ keepAlive: true });
  const sink = [];
  const drain = (async () => { for await (const chunk of stream) sink.push(chunk); })();

  // The header is written in two halves. `>start` builds the battle and nothing
  // else; `>player` builds the teams, and a set that does not state a gender
  // rolls for one right there (`sim/pokemon.ts:340`). Installing between the two
  // is what puts that roll under control - and it is why nothing here has to pin
  // a gender by hand, which would remove a draw the real battle made and shift
  // every draw after it.
  //
  // Two installations, deliberately different. The trace is a direct call: the
  // search needs every draw, and none of that belongs in a recipe. The pins go
  // in as a `>rng at` line, because they are the answer and the emitted log has
  // to carry it - `applyLine` appends the line to `battle.inputLog`, so the
  // reconstruction re-simulates itself with no help from this file. Installing
  // the interceptor never perturbs the stream, so the empty case writes nothing
  // and the log of a battle that needed no forcing carries no `>rng` at all.
  await stream.write(header[0]);
  const battle = stream.battle;
  if (!battle) throw new Error('no battle after >start - the header is malformed');
  install(battle);
  const trace = traceOn(battle);
  if (subs && Object.keys(subs).length) await stream.write(atLine(subs));
  await stream.write(header.slice(1).join('\n'));

  const notes = [];
  const diffs = [];
  const widths = [];
  let badTurn = null;
  let logAt = 0;

  for (let k = 0; k < segments.length; k++) {
    markDraws(battle, k);
    if (k >= 1 && reseeds[k]) await stream.write(`>reseed ${reseeds[k]}`);

    // `variant` is a mixed-radix counter over every undetermined target in the
    // turn: each unknown consumes one digit, so incrementing it walks the whole
    // space of substitutions without enumerating it.
    let variant = variants?.[k] || 0;
    const state = {
      reveal: state0.reveal,
      sizes: state0.sizes,
      forced: { p1: [...plans[k].forced.p1], p2: [...plans[k].forced.p2] },
      unsatisfied: null,
      selfSwitchLast: selfSwitchLast(dex),
      variantWidth: 1,
      nextVariantDigit(radix) {
        if (radix <= 1) return 0;
        const digit = variant % radix;
        variant = Math.floor(variant / radix);
        this.variantWidth *= radix;
        return digit;
      },
    };

    // Drive this turn until the simulator moves past it.
    let guard = 0;
    while (!battle.ended) {
      if (k >= 1 && battle.turn > k) break;
      if (k === 0 && battle.turn >= 1) break;
      const waiting = battle.sides.filter(s => s.requestState);
      if (!waiting.length) break;
      if (++guard > 24) {
        state.unsatisfied = `turn ${k} never resolved after ${guard} choice rounds`;
        break;
      }
      const before = `${battle.turn}:${battle.log.length}:${battle.sides.map(s => s.requestState).join('')}`;
      for (const side of waiting) {
        await stream.write(`>${side.id} ${choiceFor(side, plans[k], state, notes)}`);
      }
      const after = `${battle.turn}:${battle.log.length}:${battle.sides.map(s => s.requestState).join('')}`;
      if (before === after) {
        // A rejected choice is a silent no-op: the error goes to the side
        // channel, never to the battle log, and the turn simply does not
        // advance (ENGINEERING.md 5.7). Assert progress or it hangs unnoticed.
        state.unsatisfied = `turn ${k}: a choice was rejected - nothing advanced`;
        break;
      }
      if (state.unsatisfied) break;
    }

    widths[k] = state.variantWidth;
    const slice = battle.log.slice(logAt);
    logAt = battle.log.length;

    // `|player|` is room noise wherever it appears: a branch recording gets one
    // more every time a browser window takes a slot, mid-battle included. The
    // rest of the allowlist only makes sense before turn 1.
    const soft = (line) => {
      const kind = String(line).split('|')[1];
      return kind === 'player' || (k === 0 && SOFT_PRETURN.has(kind));
    };
    const hard = lines => battleLines(lines).filter(l => !soft(l));
    let wantHard = hard(segments[k]);
    let gotHard = hard(onChannel(slice, channel));
    // A turn the evidence has proved is compared exact, as far as it was proved:
    // the omniscient view line for line up to there, the observed one after.
    const known = exact?.get(k);
    if (known) {
      const proved = hard(known.lines);
      const gotExact = hard(onChannel(slice, -1));
      wantHard = known.partial ? [...proved, ...wantHard.slice(proved.length)] : proved;
      gotHard = known.partial ? [...gotExact.slice(0, proved.length), ...gotHard.slice(proved.length)] : gotExact;
    }
    const diff = state.unsatisfied ? { index: -1, expected: state.unsatisfied, actual: '' }
      : firstDivergence(wantHard, gotHard);

    if (diff) {
      diffs.push({ turn: k, ...diff });
      badTurn = k;
      if (!tolerant) break;
    }
    if (stopAt !== undefined && k >= stopAt) break;
  }

  const result = {
    badTurn,
    diffs,
    widths,
    notes,
    trace,
    inputLog: [...battle.inputLog],
    rawLog: [...battle.log],
    turn: battle.turn,
    ended: battle.ended,
    winner: battle.winner || null,
  };

  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return result;
}

/**
 * How well a run agreed with turn `t`, as `[lines, fields]`.
 *
 * `lines` is how far the turn got before disagreeing - `Infinity` for a turn
 * that matched outright, `-1` for a choice the simulator refused, which no die
 * can repair. `fields` counts how much of the disagreeing line is nevertheless
 * right, and it is what keeps the search off a local minimum: one line can need
 * two draws to change together, and a move line that has found its target but
 * not yet its damage is genuinely closer than one that has neither.
 */
function scoreOf(run, t) {
  if (run.badTurn === null || run.badTurn > t) return [Infinity, 0];
  if (run.badTurn < t) return [-Infinity, 0];
  const diff = run.diffs[0];
  if (!diff || diff.index < 0) return [-1, 0];
  const want = String(diff.expected ?? '').split('|');
  const got = String(diff.actual ?? '').split('|');
  let fields = 0;
  while (fields < want.length && fields < got.length && want[fields] === got[fields]) fields++;
  return [diff.index, fields];
}

const outranks = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
const ties = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Settle one turn's random draws against the observed lines.
 *
 * Draws are taken in the order the simulator consumed them, because a die
 * cannot change a line that was written before it was thrown - so the earliest
 * disagreeing draw is always the one to fix, and fixing it can never undo
 * anything already agreed. Each commit moves the draws after it, so the trace is
 * re-read from a fresh run rather than reused.
 *
 * `subs` is mutated: it is the accumulated answer, keyed by the draw's position
 * in the battle, and it is what the emitted `>rng at` line carries.
 */
async function resolveTurn(t, common, subs, subTurn, sample, budget) {
  let run = await playThrough({ ...common, subs, stopAt: t });
  let score = scoreOf(run, t);
  let forced = 0;
  let probes = 0;

  while (score[0] !== Infinity && score[0] !== -1 && probes < budget) {
    let committed = false;
    // A draw that only improves the *fields* tie-break is a guess: it is the way
    // out of a line that needs two draws changed together, but it is never
    // preferred over a draw that carries the turn further outright. So it is
    // held back until the whole scan has failed to find a real advance.
    let fallback = null;

    // Every unsettled draw in the turn is in scope, not just those after the
    // last commit. A move with no named target picks one when the action is
    // queued, at the top of the turn, so the draw that decides it sits below
    // draws that were settled long before the line it spoils shows up.
    for (const draw of drawsOf(run.trace, t)) {
      if (subs[draw.i] !== undefined) continue;

      let best = score;
      const winners = [];
      for (const v of candidates(draw)) {
        if (probes >= budget) break;
        const probe = await playThrough({ ...common, subs: { ...subs, [draw.i]: v }, stopAt: t });
        probes++;
        const reach = scoreOf(probe, t);
        if (outranks(reach, best)) { best = reach; winners.length = 0; winners.push(v); }
        else if (ties(reach, best) && outranks(reach, score)) winners.push(v);
      }
      if (!winners.length) continue;

      // Several rolls can leave a Pokemon on the same displayed percentage. They
      // are equally consistent with what was observed, so the one kept is drawn
      // uniformly among them - this is where the opponent's exact HP is sampled.
      // A draw that matched on its own needs no such treatment: the generator
      // had already picked it uniformly, and it survived the comparison.
      const pick = { i: draw.i, value: winners[sample.pick(winners.length)], best };
      if (best[0] === score[0]) {
        if (!fallback || outranks(best, fallback.best)) fallback = pick;
        continue;
      }
      subs[pick.i] = pick.value;
      subTurn[pick.i] = t;
      forced++;
      committed = true;
      break;
    }

    if (!committed && fallback) {
      subs[fallback.i] = fallback.value;
      subTurn[fallback.i] = t;
      forced++;
      committed = true;
    }

    if (!committed) break;
    run = await playThrough({ ...common, subs, stopAt: t });
    score = scoreOf(run, t);
  }

  return { solved: score[0] === Infinity, rejected: score[0] === -1, forced, probes, score };
}

/**
 * The turn that last moved the HP of the Pokemon a failing line names.
 *
 * A percentage that will not come out right is rarely the fault of the turn it
 * appears in: the HP behind it was decided the last time the Pokemon actually
 * took damage, which can be many turns earlier - a Pokemon can sit at `35/100`
 * through a Protect, a switch and two turns off the field. Redrawing the turn
 * just before the failure would leave that number exactly where it was.
 *
 * `switch` is deliberately not counted. It shows the HP again; it never sets it.
 */
function blameTurn(segments, t, line) {
  const who = identName(String(line || '').split('|')[2]);
  if (!who) return t - 1;
  for (let k = t - 1; k >= 1; k--) {
    for (const observed of segments[k]) {
      const parts = observed.split('|');
      if (parts[1] !== '-damage' && parts[1] !== '-heal' && parts[1] !== '-sethp') continue;
      if (identName(parts[2]) === who) return k;
    }
  }
  return t - 1;
}

/**
 * The other Pokemon a failing line depends on, when its HP is hidden behind a
 * percentage - or null. A damage line depends on the attacker too: Water Spout,
 * Eruption and every pinch ability read the attacker's own HP. A recoil or
 * drain line depends on the victim: its amount is the damage dealt, which the
 * victim's HP decided. Either HP was sampled the last time *that* Pokemon was
 * hit, not the last time the line's own Pokemon was.
 */
function hiddenCulprit(segment, line, channel) {
  const text = String(line || '');
  if (channel === -1 || !/^|-(damage|heal)|/.test(text)) return null;
  const tags = tagsOf(text);
  const fromHit = /^(recoil|drain)$/i.test(tags.from || '');
  if (tags.from && !fromHit) return null;
  const at = segment.indexOf(line);
  for (let i = (at < 0 ? segment.length : at) - 1; i >= 0; i--) {
    const parts = String(segment[i]).split('|');
    if (parts[1] !== 'move') continue;
    const who = fromHit ? parts[4] : parts[2];
    return who && who.includes(': ') && identSide(who) !== `p${channel}` ? who : null;
  }
  return null;
}

/** A Pokemon's exact HP at the end of a raw log, or null if it never appears. */
function exactHp(rawLog, who) {
  let hp = null;
  for (const line of rawLog) {
    const parts = line.split('|');
    const shown = { '-damage': 3, '-heal': 3, '-sethp': 3, switch: 4, drag: 4, replace: 4, detailschange: 4 }[parts[1]];
    if (shown === undefined || identName(parts[2]) !== who) continue;
    const match = /^(\d+)\/(\d+)/.exec(String(parts[shown] || ''));
    if (match) hp = Number(match[1]);
  }
  return hp;
}

/**
 * Draw one of turn `t`'s dice again, without disturbing what it showed.
 *
 * A percentage hides a range of HP, so a turn that already agrees with the
 * observation usually agrees under several different rolls. Clearing that turn
 * and resolving it again finds nothing - the roll it kept was one the generator
 * offered on its own, so there is nothing to re-derive. Moving it deliberately
 * to another equally consistent value is the only thing that changes the HP a
 * later turn inherits, and it is the same uniform draw over the same consistent
 * set that the forward pass makes.
 */
async function redrawTurn(t, common, subs, subTurn, sample, budget, who, strict = false) {
  const run = await playThrough({ ...common, subs, stopAt: t });
  if (scoreOf(run, t)[0] !== Infinity) return false;
  const was = who ? exactHp(run.rawLog, who) : null;

  const options = [];
  const moving = [];
  let probes = 0;
  for (const draw of drawsOf(run.trace, t)) {
    for (const v of candidates(draw)) {
      if (probes >= budget) break;
      const probe = await playThrough({ ...common, subs: { ...subs, [draw.i]: v }, stopAt: t });
      probes++;
      if (scoreOf(probe, t)[0] !== Infinity) continue;
      const option = { i: draw.i, value: v };
      options.push(option);
      // Most of a turn's dice have nothing to do with the Pokemon that is stuck.
      // Only the ones that actually move its HP are worth spending a backtrack
      // on; the rest would redraw the turn and change nothing that matters.
      if (who && exactHp(probe.rawLog, who) !== was) moving.push(option);
    }
  }
  const pool = moving.length ? moving : strict ? [] : options;
  if (!pool.length) return false;

  const chosen = pool[sample.pick(pool.length)];
  subs[chosen.i] = chosen.value;
  subTurn[chosen.i] = t;
  return true;
}

// -------------------------------------------------------------------- the API

/**
 * Rebuild an input log from an observed protocol log.
 *
 * @param formatid     e.g. `gen9championsvgc2026regmb`
 * @param packedTeams  both teams, packed, stat points included
 * @param playerNames  both names, as the observed `|player|` lines carry them
 * @param observed     the observed protocol lines
 * @param channel      -1 if the observation is omniscient, 1 if it is p1's view
 * @param seed         the real seed when it is known; otherwise searched
 * @param sampleSeed   fixes the seed search, so a reconstruction is reproducible
 * @param exact        turn -> the same turn's lines with every HP exact, compared on
 *                     the omniscient channel instead. Stat Point inference supplies
 *                     it: where the evidence has proved which exact HP a percentage
 *                     hid, sampling it again can only pick wrong.
 */
export async function reconstruct({
  formatid,
  packedTeams,
  playerNames,
  observed,
  channel = -1,
  seed = null,
  seedPlan = null,
  sampleSeed = 1,
  maxProbes = 4000,
  maxVariants = 256,
  maxBacktracks = 6,
  exact = null,
  onProgress = () => {},
}) {
  const dex = Dex.forFormat(formatid);
  const lines = observed.filter(l => typeof l === 'string');
  const segments = splitTurns(lines);
  if (segments.length < 2) throw new Error('observed log has no complete turn');

  const plans = segments.map(s => planSegment(s, dex));
  recoverChargeTargets(plans);

  const sample = sampler(sampleSeed);
  const avatar = avatars(lines);
  const startSeed = seed || sampler(sampleSeed ^ 0x5eed).seed();
  const header = [
    `>start ${JSON.stringify({ formatid, seed: startSeed })}`,
    `>player p1 ${JSON.stringify({ name: playerNames[0], avatar: avatar.p1, team: packedTeams[0] })}`,
    `>player p2 ${JSON.stringify({ name: playerNames[1], avatar: avatar.p2, team: packedTeams[1] })}`,
  ];

  const state0 = { reveal: revealOrder(lines), sizes: teamSizes(lines) };
  const reseeds = new Array(segments.length).fill(null);
  const variants = new Array(segments.length).fill(0);
  const spent = new Array(segments.length).fill(0);
  const subs = {};
  const subTurn = {};

  /** Forget every draw settled from `turn` on, so they can be drawn again. */
  const forget = (turn) => {
    for (const key of Object.keys(subs)) {
      if (subTurn[key] >= turn) { delete subs[key]; delete subTurn[key]; }
    }
  };

  // A source produced by branching had its own RNG reset mid-battle. Where that
  // is known - the rung that supplies the real seed supplies these too - start
  // from it rather than making the search rediscover it.
  for (const { turn, seed: at } of seedPlan || []) {
    if (turn >= 1 && turn < reseeds.length) reseeds[turn] = at;
  }
  const common = { header, segments, plans, reseeds, variants, channel, exact, state0, dex };
  let attempts = 0;
  let backtracks = 0;
  let forcedDraws = 0;

  let run = await playThrough({ ...common, subs });
  attempts++;

  // Backtracking throws away turns that were already right, on the chance that a
  // different draw makes a later one reachable. That gamble does not always pay,
  // so the furthest the search ever got is kept and handed back if it never gets
  // that far again - otherwise a run that solved nine turns can report five.
  let best = null;
  const ahead = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const remember = () => {
    // Ranked by turn first, then by how far into that turn it got. Ranking on
    // the turn alone would call every attempt a draw - they all stop on the same
    // turn - and keep the first, which is the one that had done no work yet.
    const at = run.badTurn === null
      ? [Infinity, Infinity, 0]
      : [run.badTurn, ...scoreOf(run, run.badTurn)];
    if (!best || ahead(at, best.at)) best = { at, subs: { ...subs }, variants: [...variants] };
  };
  remember();

  while (run.badTurn !== null) {
    const t = run.badTurn;

    onProgress(`turn ${t}: settling draws - observed ${run.diffs[0]?.expected ?? '(nothing)'}`);

    let solved = false;

    // A turn that cannot be finished is still worth what it got through, and
    // trying the next variant means clearing it. So the furthest attempt is held
    // aside and put back if nothing better turns up.
    let partial = null;
    const consider = (score, variant) => {
      const at = [t, ...score];
      if (!partial || ahead(at, partial.at)) {
        partial = { at, variant, subs: { ...subs }, subTurn: { ...subTurn } };
      }
    };

    // A rejected choice is a legality problem, not an RNG one - no die can make
    // the simulator accept a choice it refused - so that case goes straight to
    // the substitutions.
    if (run.diffs[0]?.index !== -1) {
      const got = await resolveTurn(t, common, subs, subTurn, sample, maxProbes - spent[t]);
      attempts += got.probes;
      spent[t] += got.probes;
      forcedDraws += got.forced;
      solved = got.solved;
      if (!solved) consider(got.score, 0);
    }

    // Then the choices this turn left invisible. A mon that fainted before
    // acting emits no line either way, so its move is a free variable; walking
    // those is cheaper than anything and may well recover the real choice.
    const width = Math.min(run.widths?.[t] || 1, maxVariants);
    for (let v = 1; v < width && !solved; v++) {
      variants[t] = v;
      forget(t);
      const probe = await playThrough({ ...common, subs, stopAt: t });
      attempts++;
      if (probe.badTurn === null) { solved = true; break; }
      const got = await resolveTurn(t, common, subs, subTurn, sample, maxProbes - spent[t]);
      attempts += got.probes;
      spent[t] += got.probes;
      forcedDraws += got.forced;
      if (got.solved) solved = true;
      else consider(got.score, v);
    }

    if (!solved) {
      variants[t] = partial ? partial.variant : 0;
      forget(t);
      if (partial) {
        Object.assign(subs, partial.subs);
        Object.assign(subTurn, partial.subTurn);
      }
      run = await playThrough({ ...common, subs });
      attempts++;
      remember();
    }

    if (solved) {
      run = await playThrough({ ...common, subs });
      attempts++;
      remember();
      continue;
    }

    // A refused choice is not something an earlier turn can be blamed for, and
    // backtracking would only re-draw turns that were already right. Stop and
    // let the report name the turn.
    if (run.diffs[0]?.index === -1) break;

    // Exhausted. An HP sampled earlier can make this turn unreachable - the
    // Pokemon that had to faint here survives on the point that was given away -
    // so go back and draw an earlier turn's ambiguity again.
    // Every other backtrack blames the other Pokemon the line depends on, when
    // its HP is hidden and so could have been sampled differently.
    const attacker = hiddenCulprit(segments[t], run.diffs[0]?.expected, channel);
    const onAttacker = attacker && backtracks % 2 === 1;
    const line = onAttacker ? `|-damage|${attacker}|` : run.diffs[0]?.expected;
    const stuck = identName(String(line || '').split('|')[2]);
    let back = blameTurn(segments, t, line);
    let moved = false;
    while (back >= 0 && !moved) {
      forget(back + 1);
      moved = await redrawTurn(back, common, subs, subTurn, sample, maxProbes, stuck, onAttacker);
      if (!moved) back--;
    }
    if (!moved || ++backtracks > maxBacktracks) break;
    onProgress(`turn ${t}: unreachable, redrawing turn ${back}`);
    for (let i = back + 1; i < variants.length; i++) { variants[i] = 0; spent[i] = 0; }
    run = await playThrough({ ...common, subs });
    attempts++;
    remember();
  }

  const complete = run.badTurn === null;
  if (!complete) {
    // Best effort: drive every turn regardless, so the artifact exists and the
    // divergence is visible rather than the whole run being lost.
    Object.keys(subs).forEach(key => delete subs[key]);
    Object.assign(subs, best.subs);
    best.variants.forEach((v, i) => { variants[i] = v; });
    run = await playThrough({ ...common, subs, tolerant: true });
    attempts++;
  }

  const verifiedThroughTurn = complete ? segments.length - 1 : Math.max(0, (run.diffs[0]?.turn ?? 1) - 1);

  return {
    inputLog: run.inputLog,
    log: onChannel(run.rawLog, -1),
    rawLog: run.rawLog,
    seed: startSeed,
    reseeds: reseeds.map((s, i) => (s ? { turn: i, seed: s } : null)).filter(Boolean),
    report: {
      complete,
      verifiedThroughTurn,
      turns: segments.length - 1,
      attempts,
      backtracks,
      forcedDraws,
      drawsSeen: run.trace.length,
      variantsUsed: variants.filter(Boolean).length,
      reseedCount: reseeds.filter(Boolean).length,
      diffs: run.diffs,
      widths: run.widths,
      notes: [...new Set(run.notes)],
      ended: run.ended,
      winner: run.winner,
    },
  };
}

/** Both teams as set objects, the shape a `.log.json` carries them in. */
export function unpackTeams(packedTeams) {
  return packedTeams.map(t => Teams.unpack(t));
}

// ------------------------------------------------------- Stat Point inference

/*
 * Which Stat Point spreads could have produced this replay.
 *
 * Open Team Sheets publish everything but the spread, so a Pokemon's unknown is
 * six numbers, 0-32 each, at most 66 in total. Inference starts from every legal
 * spread and removes the ones the battle rules out. A spread is removed only when
 * the simulator itself says it could not have produced what the log shows - no
 * damage, speed or HP arithmetic of ours decides anything.
 *
 * The work happens in one replay of a reconstructed input log, with the
 * simulator hooked at the points where a spread matters:
 *
 *   - every damage calculation. At the moment the real hit is computed, the same
 *     `getDamage` is run again for every surviving attacking and defending stat,
 *     under the dry-run guards `damageLadder` established (ENGINEERING.md 4): a
 *     cloned move, no dice consumed, no messages, state restored. The in-flight
 *     move is cloned, so weather, Helping Hand, screens and boosts are exactly
 *     the real ones. `modifyDamage` is memoised on the value it receives, since
 *     everything after that point is the same whatever the stats were.
 *   - every HP change. Each candidate carries the set of exact HP values it
 *     could be sitting on, because the replay shows the opponent only as a
 *     percentage. A change maps each value through every damage roll, and the
 *     line the log printed next keeps only what the simulator's own `getHealth`
 *     would have printed.
 *   - every queue sort. A Pokemon that acted before another in the same
 *     priority bracket had at least its speed, and the simulator's
 *     `getActionSpeed` says what each spread's speed is at that moment.
 *
 * The replay needs a scaffold - some spread that reproduces the log, so that
 * every hit happens in the position it really happened in. The position does not
 * depend on which consistent spread built it, only the exact HP does, and that is
 * exactly what each candidate tracks for itself. So `inferSpreads` alternates:
 * reconstruct with a guess, collect the evidence up to where it diverged, move
 * the guess inside what survived, and go again until the whole log reproduces.
 *
 * Where the simulator cannot be asked - a hit that reads an unusual stat, an HP
 * change of unknown shape - the candidate may move anywhere the next printed
 * line allows. That loses precision and never eliminates a spread that fits.
 */

const SPAN = 33;
const BUDGET = 66;
const KEYS = SPAN * SPAN * SPAN;
const FLAT = ['atk', 'spa', 'spe'];
const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const ROLLS = 16;
const HP_BITS = 4096;

// HP, Defence and Special Defence travel together: they are what decides the HP
// a Pokemon is left on, so they are one joint key. Attack, Special Attack and
// Speed are independent flat domains.
const KEY_HP = new Uint8Array(KEYS);
const KEY_DEF = new Uint8Array(KEYS);
const KEY_SPD = new Uint8Array(KEYS);
const KEY_SUM = new Uint8Array(KEYS);
for (let k = 0; k < KEYS; k++) {
  KEY_HP[k] = Math.floor(k / (SPAN * SPAN));
  KEY_DEF[k] = Math.floor(k / SPAN) % SPAN;
  KEY_SPD[k] = k % SPAN;
  KEY_SUM[k] = KEY_HP[k] + KEY_DEF[k] + KEY_SPD[k];
}
const KEY_DIM = { def: KEY_DEF, spd: KEY_SPD };
const keyOf = (hp, def, spd) => (hp * SPAN + def) * SPAN + spd;

const fullEvs = evs => Object.fromEntries(STAT_IDS.map(s => [s, Number(evs?.[s]) || 0]));
const aliveOf = (mask) => {
  const out = [];
  for (let v = 0; v < mask.length; v++) if (mask[v]) out.push(v);
  return out;
};

/** Every fraction of max HP an effect is written as - `baseMaxhp / 16`, `* 3 / 4`. */
const FRACTIONS = (() => {
  const seen = new Set();
  const out = [];
  for (const d of [2, 3, 4, 6, 8, 10, 12, 16]) {
    for (let n = 1; n < d; n++) {
      const f = n / d;
      if (!seen.has(f)) { seen.add(f); out.push(f); }
    }
  }
  return out;
})();

// ------------------------------------------------------------ what is known

function freshKnowledge(set, known) {
  const keys = new Uint8Array(KEYS);
  const dom = { atk: new Uint8Array(SPAN), spa: new Uint8Array(SPAN), spe: new Uint8Array(SPAN) };
  if (known) {
    const e = fullEvs(set.evs);
    keys[keyOf(e.hp, e.def, e.spd)] = 1;
    for (const s of FLAT) dom[s][e[s]] = 1;
  } else {
    for (let k = 0; k < KEYS; k++) if (KEY_SUM[k] <= BUDGET) keys[k] = 1;
    for (const s of FLAT) dom[s].fill(1);
  }
  return { known, keys, dom };
}

function cloneKnowledge(map) {
  const out = new Map();
  for (const [id, kn] of map) {
    out.set(id, {
      known: kn.known,
      keys: kn.keys.slice(),
      dom: { atk: kn.dom.atk.slice(), spa: kn.dom.spa.slice(), spe: kn.dom.spe.slice() },
    });
  }
  return out;
}

function pinKnowledge(kn, evs) {
  const e = fullEvs(evs);
  kn.keys.fill(0);
  kn.keys[keyOf(e.hp, e.def, e.spd)] = 1;
  for (const s of FLAT) { kn.dom[s].fill(0); kn.dom[s][e[s]] = 1; }
}

/** Narrow `kn` to what a pass left alive. Returns whether anything moved. */
function intersectKnowledge(kn, keys, flat) {
  let moved = false;
  const keep = new Uint8Array(KEYS);
  for (const k of keys) keep[k] = 1;
  for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !keep[k]) { kn.keys[k] = 0; moved = true; }
  for (const s of FLAT) {
    for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !flat[s][v]) { kn.dom[s][v] = 0; moved = true; }
  }
  return moved;
}

/**
 * The 66-point budget, pushed through every stat: a value that cannot fit beside
 * the cheapest surviving choice for everything else is gone.
 */
function tighten(kn) {
  let moved = false;
  for (let round = 0; round < 4; round++) {
    let minKey = Infinity;
    for (let k = 0; k < KEYS; k++) if (kn.keys[k] && KEY_SUM[k] < minKey) minKey = KEY_SUM[k];
    const mins = {};
    for (const s of FLAT) mins[s] = kn.dom[s].indexOf(1);
    if (minKey === Infinity || FLAT.some(s => mins[s] < 0)) {
      const any = kn.keys.includes(1) || FLAT.some(s => kn.dom[s].includes(1));
      kn.keys.fill(0);
      for (const s of FLAT) kn.dom[s].fill(0);
      return moved || any;
    }
    const flatMin = mins.atk + mins.spa + mins.spe;
    let changed = false;
    for (let k = 0; k < KEYS; k++) {
      if (kn.keys[k] && KEY_SUM[k] + flatMin > BUDGET) { kn.keys[k] = 0; changed = true; }
    }
    for (const s of FLAT) {
      const rest = minKey + flatMin - mins[s];
      for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && v + rest > BUDGET) { kn.dom[s][v] = 0; changed = true; }
    }
    if (!changed) break;
    moved = true;
  }
  return moved;
}

/**
 * How many whole spreads survive: every alive (hp, def, spd) beside every alive
 * (atk, spa, spe) that fits the budget. `spent` counts the ones using all 66.
 */
function spreadCount(keys, dom) {
  const a = aliveOf(dom.atk);
  const s = aliveOf(dom.spa);
  const e = aliveOf(dom.spe);
  const pair = new Float64Array(2 * (SPAN - 1) + 1);
  for (const x of a) for (const y of s) pair[x + y]++;
  const flat = new Float64Array(3 * (SPAN - 1) + 1);
  for (let t = 0; t < pair.length; t++) if (pair[t]) for (const z of e) flat[t + z] += pair[t];
  const upTo = new Float64Array(flat.length);
  let run = 0;
  for (let t = 0; t < flat.length; t++) { run += flat[t]; upTo[t] = run; }
  let total = 0;
  let spent = 0;
  for (const k of keys) {
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    total += upTo[Math.min(room, flat.length - 1)];
    if (room < flat.length) spent += flat[room];
  }
  return { total, spent };
}

const maskKeys = (mask) => {
  const out = [];
  for (let k = 0; k < KEYS; k++) if (mask[k]) out.push(k);
  return out;
};

/** What survives for one Pokemon, as a range per stat plus the spread count. */
function summarise(kn) {
  const keys = maskKeys(kn.keys);
  const count = spreadCount(keys, kn.dom);
  const seen = { hp: new Uint8Array(SPAN), def: new Uint8Array(SPAN), spd: new Uint8Array(SPAN) };
  for (const k of keys) { seen.hp[KEY_HP[k]] = 1; seen.def[KEY_DEF[k]] = 1; seen.spd[KEY_SPD[k]] = 1; }
  const stats = {};
  for (const s of STAT_IDS) {
    const values = aliveOf(FLAT.includes(s) ? kn.dom[s] : seen[s]);
    stats[s] = values.length ? { min: values[0], max: values[values.length - 1], count: values.length } : null;
  }
  return { spreads: count.total, allSpent: count.spent, stats };
}

// ------------------------------------------------------- reading the replay

/** The lines one channel shows, each tagged with its index in the raw log. */
function channelView(raw, channel) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const split = /^\|split\|p([1-4])$/.exec(raw[i]);
    if (split) {
      const at = channel === -1 || Number(split[1]) === channel ? i + 1 : i + 2;
      if (raw[at]) out.push({ line: raw[at], at });
      i += 2;
      continue;
    }
    if (raw[i]) out.push({ line: raw[i], at: i });
  }
  return out;
}

/**
 * Where a rebuilt log stops agreeing with the observed one, as a raw-log index.
 * Compared exactly the way `playThrough` compares, so the verified prefix here
 * is the one the reconstruction report means.
 */
function verifiedPrefix(view, observed) {
  const want = splitTurns(observed.filter(l => typeof l === 'string'));
  const got = [[]];
  for (const entry of view) {
    got[got.length - 1].push(entry);
    if (/^\|turn\|\d+/.test(entry.line)) got.push([]);
  }
  for (let k = 0; k < want.length; k++) {
    const soft = (line) => {
      const kind = String(line).split('|')[1];
      return kind === 'player' || (k === 0 && SOFT_PRETURN.has(kind));
    };
    const a = battleLines(want[k]).filter(l => !soft(l));
    const b = (got[k] || [])
      .map(e => ({ at: e.at, line: battleLines([e.line])[0] }))
      .filter(e => e.line !== undefined && !soft(e.line));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]?.line) continue;
      const next = b[i]?.at ?? got[k + 1]?.[0]?.at ?? Infinity;
      return { cutoffAt: next, observedLine: a[i] ?? null, turn: k };
    }
  }
  return { cutoffAt: Infinity, observedLine: null, turn: null };
}

const HP_FIELD = { '-damage': 3, '-heal': 3, '-sethp': 3, switch: 4, drag: 4, replace: 4 };

function hpLine(line) {
  const parts = String(line || '').split('|');
  const at = HP_FIELD[parts[1]];
  if (at === undefined) return null;
  return {
    kind: parts[1],
    side: identSide(parts[2]),
    name: identName(parts[2]),
    token: String(parts[at] || '').split(' ')[0],
    changes: at === 3,
  };
}

/**
 * An HP display as a number that only ever grows with HP, so the values behind
 * one display form a single interval. Champions shades `20/100` and `50/100` by
 * which side of the fifth or the half they fall (`sim/pokemon.ts:2075`).
 */
function hpRank(token, exact) {
  if (token === '0') return { rank: 0, max: null };
  const m = /^(\d+)\/(\d+)([a-z]?)$/.exec(token);
  if (!m) return null;
  if (exact) return { rank: Number(m[1]), max: Number(m[2]) };
  const pct = Number(m[1]);
  const upper = (pct === 20 && m[3] === 'y') || (pct === 50 && m[3] === 'g');
  return { rank: 1 + 2 * pct + (upper ? 1 : 0), max: null };
}

// -------------------------------------------------------- one evidence pass

async function replayRaw(lines) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  for (const line of lines) await stream.write(line);
  const raw = [...stream.battle.log];
  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return raw;
}

/**
 * Replay one input log and remove every spread the verified part of it rules
 * out. `knowledge` is read, never written; the caller intersects the result.
 */
async function evidencePass({ inputLog, observed, channel, knowledge, cache, record, exact = false }) {
  const lines = (Array.isArray(inputLog) ? inputLog : String(inputLog).split('\n'))
    .map(l => String(l).trimEnd())
    .filter(l => l.startsWith('>'));
  let pre = cache.get('raw');
  if (!pre) { pre = await replayRaw(lines); cache.set('raw', pre); }
  const view = channelView(pre, channel);
  const prefix = verifiedPrefix(view, observed);

  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  let ctx = null;
  try {
    for (const line of lines) {
      if (!ctx && /^>p[1-4] /.test(line)) {
        ctx = attachInference(stream.battle, { view, prefix, channel, knowledge, cache, record });
      }
      await stream.write(line);
      if (ctx?.state.ended) break;
    }
    if (!ctx) throw new Error('the input log makes no choices, so there is nothing to infer from');
    ctx.finish();
    if (exact) {
      const tokens = ctx.paths(pre);
      ctx.exact = tokens && exactTurns(pre, tokens, prefix);
    }
    const clock = l => (String(l).startsWith('|t:|') ? '|t:|' : l);
    const drift = firstDivergence(stream.battle.log.map(clock), pre.slice(0, stream.battle.log.length).map(clock));
    if (drift) throw new Error(`inference perturbed the battle at raw line ${drift.index}: ${drift.actual} -> ${drift.expected}`);
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
  return { ...ctx.result(), exact: ctx.exact || null };
}

/**
 * The verified turns of a scaffold as the omniscient channel shows them, with
 * every hidden HP replaced by the exact value an evidence path chose.
 */
function exactTurns(raw, tokens, prefix) {
  const view = channelView(raw, -1);
  const turns = new Map();
  let k = 0;
  let lines = [];
  const withHp = (line, token) => {
    if (token === undefined || token === '0') return line;
    const parts = line.split('|');
    const at = HP_FIELD[parts[1]];
    const field = String(parts[at] || '');
    parts[at] = `${token}${field.includes(' ') ? field.slice(field.indexOf(' ')) : ''}`;
    return parts.join('|');
  };
  for (const entry of view) {
    if (prefix.turn !== null && k > prefix.turn) break;
    // The omniscient view shows a split line's secret half one index before
    // the half the observing channel shows.
    const split = /^\|split\|/.test(raw[entry.at - 1] || '');
    const cut = entry.at === prefix.cutoffAt || (split && entry.at === prefix.cutoffAt - 1);
    if (prefix.turn !== null && k === prefix.turn && (cut || entry.at > prefix.cutoffAt)) {
      // The failing line itself is proved only when it is a hidden HP the path
      // chose; anything else there is the scaffold's mistake, not the truth.
      if (cut && tokens.has(entry.at)) lines.push(withHp(entry.line, tokens.get(entry.at)));
      break;
    }
    lines.push(withHp(entry.line, tokens.get(entry.at)));
    if (/^\|turn\|\d+/.test(entry.line)) {
      turns.set(k, { lines, partial: false });
      k++;
      lines = [];
    }
  }
  if (prefix.turn !== null && lines.length) turns.set(prefix.turn, { lines, partial: true });
  return turns;
}

/** Item and volatile state, captured so a dry run can hand it back untouched. */
function snapItems(list) {
  return list.map(p => [p, {
    item: p.item,
    itemState: { ...p.itemState },
    lastItem: p.lastItem,
    usedItemThisTurn: p.usedItemThisTurn,
    ateBerry: p.ateBerry,
    volatiles: { ...p.volatiles },
    abilityState: { ...p.abilityState },
  }]);
}

function restoreInPlace(target, source) {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  Object.assign(target, source);
}

function restoreItems(snap) {
  for (const [p, s] of snap) {
    p.item = s.item;
    restoreInPlace(p.itemState, s.itemState);
    p.lastItem = s.lastItem;
    p.usedItemThisTurn = s.usedItemThisTurn;
    p.ateBerry = s.ateBerry;
    restoreInPlace(p.volatiles, s.volatiles);
    restoreInPlace(p.abilityState, s.abilityState);
  }
}

/** Swap an own method in, returning the undo. Mods install some methods per instance. */
function override(obj, name, fn) {
  const had = Object.prototype.hasOwnProperty.call(obj, name);
  const prev = obj[name];
  obj[name] = fn;
  return () => { if (had) obj[name] = prev; else delete obj[name]; };
}

function attachInference(battle, { view, prefix, channel, knowledge, cache, record }) {
  const st = install(battle);
  const actions = battle.actions;
  const state = { ended: false, dry: 0 };
  const events = [];
  const sorts = [];
  const executed = [];
  const tainted = new Set();
  const pendingHits = new Map();
  const damageContext = new Map();
  const healContext = new Map();
  let lastSort = null;
  let viewPos = 0;
  let hitOrdinal = 0;
  let changeOrdinal = 0;
  let sortOrdinal = 0;
  let seq = 0;

  const memo = (key, make) => {
    let value = cache.get(key);
    if (value === undefined) { value = make(); cache.set(key, value); }
    return value;
  };

  // ------------------------------------------------------------ who is who

  const recs = [];
  const byPokemon = new Map();
  const byIdent = new Map();
  for (const side of battle.sides) {
    for (const [index, pokemon] of side.pokemon.entries()) {
      const id = `${side.id}:${index}`;
      const kn = knowledge.get(id);
      if (!kn) continue;
      const byForme = new Map();
      const rec = {
        id,
        side: side.id,
        pokemon,
        name: pokemon.name,
        kn,
        knKeys: maskKeys(kn.keys),
        exact: channel === -1 || side.id === `p${channel}`,
        chain: null,
        flat: { atk: kn.dom.atk.slice(), spa: kn.dom.spa.slice(), spe: kn.dom.spe.slice() },
        pending: [],
        history: [],
        shown: [],
        // A stat as the simulator computes it for this Pokemon's current forme.
        stat(stat, sp) {
          let table = byForme.get(pokemon.species);
          if (!table) {
            table = {};
            for (const s of STAT_IDS) {
              table[s] = Int32Array.from({ length: SPAN }, (_, v) => battle.statModify(
                pokemon.species.baseStats, { ...pokemon.set, evs: { ...fullEvs(pokemon.set.evs), [s]: v } }, s));
            }
            byForme.set(pokemon.species, table);
          }
          return table[stat][sp];
        },
      };
      recs.push(rec);
      byPokemon.set(pokemon, rec);
      byIdent.set(`${side.id}:${pokemon.name}`, rec);
    }
  }
  const maxHp = (rec, hp) => rec.stat('hp', hp);
  const label = rec => rec.pokemon.species.name;
  const countOf = rec => spreadCount(rec.chain ? rec.chain.keys() : rec.knKeys, rec.flat).total;

  function initChain(rec) {
    rec.chain = new Map();
    for (const k of rec.knKeys) rec.chain.set(k, [maxHp(rec, KEY_HP[k])]);
  }

  /** The HP values behind one printed display, read off the simulator's `getHealth`. */
  function interval(rec, M, token) {
    return memo(`show|${rec.exact ? 'x' : 's'}|${M}|${token}`, () => {
      const want = hpRank(token, rec.exact);
      if (!want || (rec.exact && want.max !== null && want.max !== M)) return null;
      const p = rec.pokemon;
      const saved = [p.hp, p.maxhp];
      const rankAt = (h) => {
        p.hp = h;
        p.maxhp = M;
        const shown = p.getHealth();
        return hpRank(String(rec.exact ? shown.secret : shown.shared).split(' ')[0], rec.exact)?.rank ?? -1;
      };
      try {
        let lo = 0;
        let hi = M;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (rankAt(mid) < want.rank) lo = mid + 1; else hi = mid; }
        const first = lo;
        hi = M;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rankAt(mid) > want.rank) hi = mid - 1; else lo = mid; }
        return rankAt(first) === want.rank ? [first, lo] : null;
      } finally {
        [p.hp, p.maxhp] = saved;
      }
    });
  }

  // ------------------------------------------------------------ dry runs

  function withRoll(roll, fn) {
    const undo = override(battle, 'random', (m, n) => (m === 16 && n === undefined ? roll : (n === undefined ? 0 : m)));
    const prevDry = st.dry;
    st.dry = { roll };
    try { return fn(); } finally { st.dry = prevDry; undo(); }
  }

  function patchAll(patches) {
    const undo = [];
    for (const { pokemon, stats, hp, maxhp } of patches) {
      const saved = { stored: { ...pokemon.storedStats }, hp: pokemon.hp, maxhp: pokemon.maxhp, baseMaxhp: pokemon.baseMaxhp };
      for (const [s, v] of Object.entries(stats || {})) pokemon.storedStats[s] = v;
      if (maxhp !== undefined) { pokemon.maxhp = maxhp; pokemon.baseMaxhp = maxhp; }
      if (hp !== undefined) pokemon.hp = hp;
      undo.push(() => {
        Object.assign(pokemon.storedStats, saved.stored);
        pokemon.hp = saved.hp;
        pokemon.maxhp = saved.maxhp;
        pokemon.baseMaxhp = saved.baseMaxhp;
      });
    }
    return () => { for (const u of undo.reverse()) u(); };
  }

  /** Everything a dry run may disturb on the battle itself. */
  function guarded(fn) {
    state.dry++;
    const saved = {
      log: battle.log.length,
      faints: battle.faintQueue.length,
      move: battle.activeMove,
      target: battle.activeTarget,
      user: battle.activePokemon,
      lastDamage: battle.lastDamage,
    };
    try {
      return fn();
    } finally {
      battle.log.length = saved.log;
      battle.faintQueue.length = saved.faints;
      battle.activeMove = saved.move;
      battle.activeTarget = saved.target;
      battle.activePokemon = saved.user;
      battle.lastDamage = saved.lastDamage;
      state.dry--;
    }
  }

  /**
   * Sixteen damage values for one set of stats. `getDamage` runs once; every
   * roll re-runs only `modifyDamage`, memoised on the value it is handed.
   */
  function dryRow(hit, patches, post) {
    return guarded(() => {
      const undoPatch = patchAll(patches);
      let row = null;
      const origModify = actions.modifyDamage;
      const undoModify = override(actions, 'modifyDamage', function (base, pokemon, target, move, suppress) {
        let cached = post.get(base);
        if (!cached) {
          cached = [];
          for (let r = 0; r < ROLLS; r++) {
            restoreItems(hit.items);
            cached.push(withRoll(r, () => origModify.call(this, base, pokemon, target, move, suppress)));
          }
          post.set(base, cached);
        }
        row = cached;
        return cached[0];
      });
      try {
        restoreItems(hit.items);
        hit.clone.moveHitData = undefined;
        const out = withRoll(0, () => hit.getDamage.call(actions, hit.source, hit.target, hit.clone, true));
        return row || new Array(ROLLS).fill(typeof out === 'number' ? out : null);
      } finally {
        undoModify();
        undoPatch();
        restoreItems(hit.items);
      }
    });
  }

  const rowKey = (a, d, hp, h, si) => `${a}|${d}|${hp ?? '-'}|${h ?? '-'}|${si}`;
  const sameRow = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  /**
   * What one real damage calculation depends on, and its value for every
   * surviving stat. Computed before the real result lands, in the real position.
   */
  function analyseHit(source, target, clone, crit, real, items, getDamage) {
    const S = byPokemon.get(source);
    const T = byPokemon.get(target);
    const ord = hitOrdinal++;
    const hit = { S, T, source, target, clone, real, items, getDamage, ord, supported: false };
    clone.willCrit = crit;
    if (!T.chain) initChain(T);

    const shape = memo(`hit|${ord}`, () => {
      // Which stats the calculation reads, observed rather than assumed: Body
      // Press, Foul Play and Psyshock read something else, and Wonder Room swaps.
      const reads = [];
      const undo = [];
      for (const p of new Set([source, target])) {
        const calc = p.calculateStat;
        const get = p.getStat;
        undo.push(override(p, 'calculateStat', function (stat, ...rest) { reads.push([p, toID(stat)]); return calc.call(this, stat, ...rest); }));
        undo.push(override(p, 'getStat', function (stat, ...rest) { reads.push([p, toID(stat)]); return get.call(this, stat, ...rest); }));
      }
      let base;
      try { base = dryRow(hit, [], new Map()); } finally { for (const u of undo.reverse()) u(); }

      const unknownReads = reads.filter(([p]) => !byPokemon.get(p).kn.known);
      const off = unknownReads.find(([p, s]) => p === source && (s === 'atk' || s === 'spa'))?.[1] || null;
      const def = unknownReads.find(([p, s]) => p === target && (s === 'def' || s === 'spd'))?.[1]
        || reads.find(([p, s]) => p === target && (s === 'def' || s === 'spd'))?.[1] || null;
      const supported = source !== target && unknownReads.every(([p, s]) =>
        (p === source && s === off) || (p === target && s === def));

      // HP matters to Water Spout, Multiscale, Brine, pinch abilities. Ask
      // rather than list: the row either moves with HP or it does not.
      const probe = (p) => [...new Set([p.maxhp, p.maxhp - 1, Math.ceil(p.maxhp / 2),
        Math.floor(p.maxhp / 2), Math.floor(p.maxhp / 3), Math.floor(p.maxhp / 4), 1])].filter(h => h >= 1);
      const moves = p => probe(p).some(h => !sameRow(dryRow(hit, [{ pokemon: p, hp: h }], new Map()), base));
      return { off, def: def || 'def', supported, targetHp: moves(target), sourceHp: moves(source) };
    });
    Object.assign(hit, shape);
    if (!hit.supported) return hit;

    hit.aVals = hit.off && !S.kn.known ? aliveOf(S.flat[hit.off]) : [0];
    const dVals = new Set();
    const tStates = new Map();
    for (const [k, hs] of T.chain) {
      dVals.add(KEY_DIM[hit.def][k]);
      if (hit.targetHp) for (const h of hs) tStates.set(`${KEY_HP[k]}|${h}`, [KEY_HP[k], h]);
    }
    const sStates = [];
    if (hit.sourceHp) {
      if (!S.chain) initChain(S);
      const seen = new Set();
      for (const [k, hs] of S.chain) {
        for (const h of hs) {
          const M = maxHp(S, KEY_HP[k]);
          if (!seen.has(`${M}|${h}`)) { seen.add(`${M}|${h}`); sStates.push([M, h]); }
        }
      }
    }
    const targetStates = hit.targetHp ? [...tStates.values()] : [null];
    hit.sStates = hit.sourceHp ? sStates : [null];

    hit.rows = new Map();
    for (const t of targetStates) {
      for (const [si, s] of hit.sStates.entries()) {
        const hpKey = `${t ? t.join(':') : '-'}|${s ? s.join(':') : '-'}`;
        const post = new Map();
        for (const a of hit.aVals) {
          for (const d of dVals) {
            const row = memo(`row|${ord}|${a}|${d}|${hpKey}`, () => {
              const patches = [];
              if (hit.off && !S.kn.known) patches.push({ pokemon: source, stats: { [hit.off]: S.stat(hit.off, a) } });
              const tp = { pokemon: target, stats: T.kn.known ? {} : { [hit.def]: T.stat(hit.def, d) } };
              if (t) { tp.maxhp = maxHp(T, t[0]); tp.hp = t[1]; }
              patches.push(tp);
              if (s) patches.push({ pokemon: source, maxhp: s[0], hp: s[1] });
              return dryRow(hit, patches, post);
            });
            hit.rows.set(rowKey(a, d, t && t[0], t && t[1], si), row);
          }
        }
      }
    }
    return hit;
  }

  // ------------------------------------------------------ HP transitions

  /** Group a chain by what a transition depends on: HP stat, one defence, current HP. */
  function groupsOf(rec, dim) {
    const out = new Map();
    for (const [k, hs] of rec.chain) {
      const hp = KEY_HP[k];
      const d = dim ? KEY_DIM[dim][k] : 0;
      for (const h of hs) {
        const g = (hp * SPAN + d) * HP_BITS + h;
        if (!out.has(g)) out.set(g, [hp, d, h]);
      }
    }
    return out;
  }

  /** The simulator's own `Damage` event for one candidate: Focus Sash, Sturdy, Endure. */
  function damageEvent(hit, ctx, T, M, h, x) {
    return memo(`dmgev|${hit.ord}|${M}|${h}|${x}`, () => guarded(() => {
      const undo = patchAll([{ pokemon: T.pokemon, maxhp: M, hp: h }]);
      const after = snapItems([T.pokemon]);
      try {
        restoreItems(ctx.items);
        return battle.runEvent('Damage', T.pokemon, ctx.source, ctx.effect, x, true);
      } finally {
        restoreItems(after);
        undo();
      }
    }));
  }

  /**
   * A hit on `T`, as every (attacking stat, attacker HP state) it could have
   * come through. The two are packed into one `via`: `a + SPAN * state`.
   */
  function moveChange(T, hit, dealt, ctx) {
    const clamp = x => (typeof x === 'number' && x !== 0 ? Math.max(1, x) : x);
    const modified = clamp(hit.real) !== clamp(dealt);
    const table = new Map();
    for (const [g, [hp, d, h]] of groupsOf(T, hit.def)) {
      const M = maxHp(T, hp);
      const pairs = [];
      for (const a of hit.aVals) {
        for (let si = 0; si < hit.sStates.length; si++) {
          const row = hit.rows.get(rowKey(a, d, hit.targetHp ? hp : null, hit.targetHp ? h : null, si));
          if (!row) continue;
          const v = (a + SPAN * si) * HP_BITS;
          for (const value of row) {
            let x = clamp(value);
            if (typeof x !== 'number' || x <= 0) { pairs.push(v + h); continue; }
            if (modified || x >= h) x = clamp(damageEvent(hit, ctx, T, M, h, x));
            if (typeof x !== 'number' || x <= 0) { pairs.push(v + h); continue; }
            pairs.push(v + Math.max(0, h - Math.trunc(x)));
          }
        }
      }
      table.set(g, Int32Array.from(pairs));
    }
    const via = hit.off && !hit.S.kn.known ? { rec: hit.S, stat: hit.off } : null;
    const S = hit.S;
    S.hitsThisMove = S.hitMove === ctx.effect ? S.hitsThisMove + 1 : 1;
    S.hitMove = ctx.effect;
    return {
      dim: hit.def,
      table,
      via,
      dealtBy: S,
      sourceStates: hit.sourceHp ? hit.sStates : null,
      move: ctx.effect,
      off: hit.off,
      hits: S.hitsThisMove,
      what: `${label(hit.S)}'s ${hit.clone.name} hit ${label(T)}`,
    };
  }

  /** An HP change whose amount the simulator computed from one number we can scale. */
  /** The HP `run` leaves one candidate on, with the battle handed back untouched. */
  function dryHp(T, M, h, source, run) {
    return guarded(() => {
      const undo = patchAll([{ pokemon: T.pokemon, maxhp: M, hp: h }]);
      const saved = {
        faintQueued: T.pokemon.faintQueued,
        switchFlag: T.pokemon.switchFlag,
        hurtThisTurn: T.pokemon.hurtThisTurn,
        sourceLast: source?.lastDamage,
      };
      const items = snapItems([T.pokemon]);
      try {
        run();
        return T.pokemon.hp;
      } finally {
        T.pokemon.faintQueued = saved.faintQueued;
        T.pokemon.switchFlag = saved.switchFlag;
        T.pokemon.hurtThisTurn = saved.hurtThisTurn;
        if (source) source.lastDamage = saved.sourceLast;
        restoreItems(items);
        undo();
      }
    });
  }

  function amountChange(T, kind, amounts, ctx, what) {
    const ord = changeOrdinal;
    const table = new Map();
    for (const [g, [hp, , h]] of groupsOf(T, null)) {
      const M = maxHp(T, hp);
      const out = new Set();
      for (const amount of amounts(M)) {
        out.add(memo(`amt|${ord}|${M}|${h}|${amount}`, () => dryHp(T, M, h, ctx.source, () => {
          if (kind === 'heal') battle.heal(amount, T.pokemon, ctx.source, ctx.effect);
          else battle.spreadDamage([amount], [T.pokemon], ctx.source, ctx.effect);
        })));
      }
      table.set(g, Int32Array.from(out));
    }
    return { dim: null, table, via: null, what };
  }

  /**
   * Recoil or drain after a hit on a Pokemon shown only as a percentage. The
   * damage dealt is hidden, but every candidate attacking stat left a set of
   * amounts it could have dealt, and the simulator turns each into the HP the
   * attacker's own line has to show. `run(d)` is that simulator call.
   */
  function dealtChange(S, last, what, tag, run) {
    const ord = changeOrdinal;
    const known = S.kn.known || !last.off;
    const table = new Map();
    const dealtOf = new Map();
    for (const [g, [hp, , h]] of groupsOf(S, null)) {
      const M = maxHp(S, hp);
      const pairs = [];
      const amounts = [];
      for (const [a, dealt] of last.byA) {
        if (!known && !S.flat[last.off][a]) continue;
        for (const d of dealt) {
          const h2 = memo(`${tag}|${ord}|${M}|${h}|${d}`, () => dryHp(S, M, h, S.pokemon, () => run(d)));
          pairs.push(a * HP_BITS + h2);
          amounts.push(d);
        }
      }
      table.set(g, Int32Array.from(pairs));
      dealtOf.set(g, Int32Array.from(amounts));
    }
    return { dim: null, table, dealtOf, victim: last.change, via: known ? null : { rec: S, stat: last.off }, what };
  }

  /** Recoil: `applyRecoilDamage` computes and applies it in one call. */
  const recoilChange = (S, last, what) =>
    dealtChange(S, last, what, 'rcl', d => actions.applyRecoilDamage(d, last.move, S.pokemon));

  /**
   * Drain: the simulator heals the attacker inside `spreadDamage`, from the
   * damage the victim really took. So the victim is handed exactly `d` - HP one
   * above it, max HP above that so no Focus Sash can fire - and the attacker's
   * HP is read afterwards.
   */
  const drainChange = (S, last, what) => dealtChange(S, last, what, 'drn', (d) => {
    const V = last.victim.pokemon;
    const saved = {
      hp: V.hp, maxhp: V.maxhp, baseMaxhp: V.baseMaxhp,
      hurtThisTurn: V.hurtThisTurn, faintQueued: V.faintQueued, switchFlag: V.switchFlag,
    };
    const items = snapItems([V]);
    try {
      V.hp = d + 1;
      V.maxhp = Math.max(V.maxhp, d + 2);
      V.baseMaxhp = V.maxhp;
      battle.spreadDamage([d], [V], S.pokemon, last.move);
    } finally {
      Object.assign(V, saved);
      restoreItems(items);
    }
  });

  const band = (dir, what) => ({ band: dir, what });

  function effectChange(T, kind, raw, effect, other) {
    const e = typeof effect === 'string' ? battle.dex.conditions.getByID(effect) : effect;
    const id = e?.id || '';
    const ctx = { source: other || null, effect: e };
    const what = `${e?.name || id || kind} on ${label(T)}`;
    const dir = kind === 'heal' ? 'up' : 'down';
    if (typeof raw !== 'number' || !(raw > 0)) return band(dir, what);

    // Drain and recoil are a share of damage dealt. That share is exact when the
    // Pokemon that took the damage is one whose HP the log shows exactly;
    // otherwise it is one of the amounts the hit could have dealt, and the line
    // it prints says which. A recoil summed over several hits says nothing usable.
    if (id === 'drain' || id === 'recoil') {
      const hurt = id === 'drain' ? byPokemon.get(other) : null;
      const exactVictim = hurt ? hurt.exact : T.pokemon.side.foe.active.every(p => !p || byPokemon.get(p)?.exact);
      if (exactVictim) return amountChange(T, kind, () => [raw], ctx, what);
      const last = T.lastDealt;
      if (id === 'recoil' && last?.byA.size && last.move === battle.activeMove && last.hits === 1) return recoilChange(T, last, what);
      if (id === 'drain' && last?.byA.size && last.move === battle.activeMove && last.victim === hurt) return drainChange(T, last, what);
      return band(dir, what);
    }
    if (['leechseed', 'shellbell', 'strengthsap', 'painsplit', 'confusion'].includes(id)) return band(dir, what);

    // Everything else that scales is written as a fraction of max HP. A raw
    // amount that is not a whole number proves the fraction was passed unrounded;
    // a whole one could have been rounded either way, so both are kept.
    const M0 = T.pokemon.baseMaxhp;
    const k = FRACTIONS.find(f => Math.abs(raw - M0 * f) < 1e-9);
    if (k === undefined) return band(dir, what);
    const whole = Number.isInteger(raw);
    return amountChange(T, kind, M => (whole ? [...new Set([Math.floor(M * k), Math.ceil(M * k)])] : [M * k]), ctx, what);
  }

  function onChange(rec, kind, info) {
    sync();
    if (state.ended) return;
    if (!rec.chain) initChain(rec);
    for (const change of rec.pending.splice(0)) apply(rec, change, null);
    let change;
    if (kind === 'damage') {
      const ctx = damageContext.get(rec.pokemon) || { effect: info.effect, source: info.source, items: snapItems([rec.pokemon]) };
      damageContext.delete(rec.pokemon);
      const effect = typeof ctx.effect === 'string' ? battle.dex.conditions.getByID(ctx.effect) : ctx.effect;
      const hit = pendingHits.get(rec.pokemon);
      pendingHits.delete(rec.pokemon);
      if (effect?.effectType === 'Move') {
        change = hit?.supported ? moveChange(rec, hit, info.d, { ...ctx, effect })
          : band('down', `${effect.name} hit ${label(rec)}`);
      } else {
        change = effectChange(rec, 'damage', ctx.raw ?? info.d, effect, ctx.source);
      }
    } else if (kind === 'heal') {
      const ctx = healContext.get(rec.pokemon);
      healContext.delete(rec.pokemon);
      change = effectChange(rec, 'heal', ctx?.raw ?? info.d, ctx?.effect ?? info.effect, ctx?.source ?? info.source);
    } else {
      change = band('any', `HP set on ${label(rec)}`);
    }
    change.turn = battle.turn;
    changeOrdinal++;
    rec.pending.push(change);
  }

  /**
   * Move every candidate of `rec` through one change. With a printed display,
   * only the HP values it could print survive, and an attacking stat survives
   * only if some candidate reached the display through it.
   */
  function apply(rec, change, token) {
    const before = record && token !== null ? countOf(rec) : 0;
    const viaBefore = record && token !== null && change.via ? countOf(change.via.rec) : 0;
    const next = new Map();
    const supported = change.via ? new Uint8Array(SPAN) : null;
    const dealt = change.dealtBy && token !== null ? new Map() : null;
    const dealtOk = change.dealtOf && token !== null ? new Set() : null;
    const sourceOk = change.sourceStates && token !== null ? new Set() : null;
    const done = new Map();
    const allowAt = new Map();
    for (const [k, hs] of rec.chain) {
      const hp = KEY_HP[k];
      const M = maxHp(rec, hp);
      let allow = null;
      if (token !== null) {
        if (!allowAt.has(M)) allowAt.set(M, interval(rec, M, token));
        allow = allowAt.get(M);
        if (!allow) continue;
      }
      const d = change.dim ? KEY_DIM[change.dim][k] : 0;
      const out = new Set();
      for (const h of hs) {
        const g = (hp * SPAN + d) * HP_BITS + h;
        let res = done.get(g);
        if (!res) {
          res = { hs: [], via: [] };
          if (change.same) {
            const fits = !change.allowSet || change.allowSet.has(M * HP_BITS + h);
            if (fits && (!allow || (h >= allow[0] && h <= allow[1]))) res.hs.push(h);
          } else if (change.band) {
            let lo = change.band === 'up' ? h : 0;
            let hi = change.band === 'down' ? h : M;
            if (allow) { lo = Math.max(lo, allow[0]); hi = Math.min(hi, allow[1]); }
            for (let x = lo; x <= hi; x++) res.hs.push(x);
          } else {
            const pairs = change.table.get(g) || [];
            const amounts = dealtOk ? change.dealtOf.get(g) : null;
            const hsSeen = new Set();
            const viaSeen = new Set();
            for (let j = 0; j < pairs.length; j++) {
              const packed = pairs[j];
              const h2 = packed % HP_BITS;
              if (allow && (h2 < allow[0] || h2 > allow[1])) continue;
              const tag = Math.floor(packed / HP_BITS);
              const v = tag % SPAN;
              if (amounts) dealtOk.add(v * HP_BITS + amounts[j]);
              if (sourceOk) sourceOk.add(Math.floor(tag / SPAN));
              hsSeen.add(h2);
              viaSeen.add(v);
              if (dealt) {
                if (!dealt.has(v)) dealt.set(v, new Set());
                dealt.get(v).add(h - h2);
              }
            }
            res.hs = [...hsSeen];
            res.via = [...viaSeen];
          }
          done.set(g, res);
        }
        for (const h2 of res.hs) out.add(h2);
        if (supported) for (const v of res.via) supported[v] = 1;
      }
      if (out.size) next.set(k, [...out]);
    }
    if (dealtOk) change.victim.dealtOk = dealtOk;
    rec.history.push({ change, token, pre: rec.chain, seq: seq++ });
    rec.chain = next;
    if (dealt) change.dealtBy.lastDealt = { move: change.move, off: change.off, hits: change.hits, byA: dealt, change, victim: rec };
    if (supported && token !== null) {
      const dom = change.via.rec.flat[change.via.stat];
      for (let v = 0; v < SPAN; v++) if (dom[v] && !supported[v]) dom[v] = 0;
    }
    // The victim's display also says which HP the attacker could have been on,
    // when the hit depended on it.
    let attackerCut = null;
    if (sourceOk) {
      const S = change.dealtBy;
      const allowSet = new Set([...sourceOk].map(si => change.sourceStates[si][0] * HP_BITS + change.sourceStates[si][1]));
      for (const c of S.pending.splice(0)) apply(S, c, null);
      const sBefore = record ? countOf(S) : 0;
      apply(S, { same: true, allowSet, what: change.what, turn: change.turn }, null);
      if (record) attackerCut = { id: S.id, pokemon: label(S), before: sBefore, after: countOf(S) };
    }
    if (record && token !== null) {
      const cuts = [];
      const after = countOf(rec);
      if (after !== before) cuts.push({ id: rec.id, pokemon: label(rec), before, after });
      if (change.via && change.via.rec !== rec) {
        const viaAfter = countOf(change.via.rec);
        if (viaAfter !== viaBefore) cuts.push({ id: change.via.rec.id, pokemon: label(change.via.rec), before: viaBefore, after: viaAfter });
      }
      if (attackerCut && attackerCut.after !== attackerCut.before) {
        const same = cuts.find(c => c.id === attackerCut.id);
        if (same) same.after = attackerCut.after; else cuts.push(attackerCut);
      }
      if (cuts.length) events.push({ turn: change.turn ?? battle.turn, what: change.what, shown: token, cuts });
    }
  }

  /** A printed HP line: settle what is pending for that Pokemon against it. */
  function observe(line, token, at) {
    const rec = byIdent.get(`${line.side}:${line.name}`);
    if (!rec) return;
    const first = !rec.chain;
    if (first) initChain(rec);
    const due = rec.pending.splice(0);
    if (line.changes) {
      if (!due.length) due.push(band(line.kind === '-heal' ? 'up' : line.kind === '-damage' ? 'down' : 'any', `${line.kind} on ${label(rec)}`));
      for (const change of due.slice(0, -1)) apply(rec, change, null);
      apply(rec, due[due.length - 1], token);
    } else {
      for (const change of due) apply(rec, change, null);
      apply(rec, { same: true, what: first ? `${label(rec)} came in` : `${label(rec)} shown`, turn: battle.turn }, token);
    }
    rec.shown.push({ at, hist: rec.history.length - 1 });
  }

  function sync() {
    if (state.dry) return;
    while (!state.ended && viewPos < view.length && view[viewPos].at < battle.log.length) {
      const entry = view[viewPos++];
      if (entry.at > prefix.cutoffAt) { state.ended = true; break; }
      const atCut = entry.at === prefix.cutoffAt;
      const mine = hpLine(entry.line);
      const shown = atCut ? hpLine(prefix.observedLine) : mine;
      if (mine && shown && shown.side === mine.side && shown.name === mine.name && shown.kind === mine.kind) {
        observe(mine, shown.token, entry.at);
      }
      if (atCut) { state.ended = true; break; }
    }
  }

  // ------------------------------------------------------------ the hooks

  const origGetDamage = actions.getDamage;
  actions.getDamage = function (source, target, move, suppress) {
    if (state.dry || state.ended || typeof move !== 'object' || !move || move.category === 'Status'
      || !byPokemon.has(source) || !byPokemon.has(target)) {
      return origGetDamage.call(this, source, target, move, suppress);
    }
    sync();
    const clone = Utils.deepClone(move);
    const pre = snapItems([source, target]);
    const real = origGetDamage.call(this, source, target, move, suppress);
    if (typeof real !== 'number' || state.ended) return real;
    const crit = !!target.getMoveHitData(move).crit;
    const post = snapItems([source, target]);
    try {
      pendingHits.set(target, analyseHit(source, target, clone, crit, real, pre, origGetDamage));
    } finally {
      restoreItems(post);
    }
    return real;
  };

  const origSpread = battle.spreadDamage;
  battle.spreadDamage = function (damage, targetArray, source, effect, instafaint) {
    if (!state.dry && !state.ended && targetArray) {
      for (const [i, t] of targetArray.entries()) {
        if (t && byPokemon.has(t)) damageContext.set(t, { effect, source, raw: damage[i], items: snapItems([t]) });
      }
    }
    return origSpread.call(this, damage, targetArray, source, effect, instafaint);
  };

  const origHeal = battle.heal;
  battle.heal = function (damage, target, source, effect) {
    if (!state.dry && !state.ended) {
      let t = target;
      let s = source;
      let e = effect;
      if (this.event) { t ||= this.event.target; s ||= this.event.source; e ||= this.effect; }
      if (t && byPokemon.has(t)) healContext.set(t, { raw: damage, source: s, effect: e });
    }
    return origHeal.call(this, damage, target, source, effect);
  };

  for (const rec of recs) {
    const p = rec.pokemon;
    const damage = p.damage;
    const heal = p.heal;
    const sethp = p.sethp;
    override(p, 'damage', function (d, source, effect) {
      const out = damage.call(this, d, source, effect);
      if (!state.dry && !state.ended) onChange(rec, 'damage', { d, source, effect });
      return out;
    });
    override(p, 'heal', function (d, source, effect) {
      const before = this.hp;
      const out = heal.call(this, d, source, effect);
      if (!state.dry && !state.ended && this.hp !== before) onChange(rec, 'heal', { d, source, effect });
      return out;
    });
    override(p, 'sethp', function (d) {
      const before = this.hp;
      const out = sethp.call(this, d);
      if (!state.dry && !state.ended && this.hp !== before) onChange(rec, 'sethp', { d });
      return out;
    });
  }

  const speedTable = rec => memo(`spe|${sortOrdinal}|${rec.id}`, () => guarded(() => {
    const p = rec.pokemon;
    const saved = p.storedStats.spe;
    const out = new Float64Array(SPAN);
    try {
      for (let s = 0; s < SPAN; s++) { p.storedStats.spe = rec.stat('spe', s); out[s] = p.getActionSpeed(); }
    } finally {
      p.storedStats.spe = saved;
    }
    return out;
  }));

  const queue = battle.queue;
  const origSort = queue.sort;
  queue.sort = function () {
    const out = origSort.call(this);
    if (!state.dry && !state.ended) {
      sync();
      const entry = { turn: battle.turn, list: this.list.map(a => ({ action: a, order: a.order, priority: a.priority || 0, pokemon: a.pokemon || null })), speeds: new Map() };
      for (const item of entry.list) {
        const rec = item.pokemon && byPokemon.get(item.pokemon);
        if (rec && !entry.speeds.has(rec)) entry.speeds.set(rec, speedTable(rec));
      }
      sortOrdinal++;
      sorts.push(entry);
      lastSort = entry;
    }
    return out;
  };
  for (const name of ['prioritizeAction', 'changeAction']) {
    const orig = queue[name];
    queue[name] = function (...args) {
      tainted.add(battle.turn);
      return orig.apply(this, args);
    };
  }

  const origRun = battle.runAction;
  battle.runAction = function (action) {
    if (state.dry || state.ended) return origRun.call(this, action);
    sync();
    const start = battle.log.length;
    const sort = lastSort;
    try {
      return origRun.call(this, action);
    } finally {
      executed.push({ action, pokemon: action.pokemon || null, start, end: battle.log.length, sort });
    }
  };

  /**
   * An attacking stat survives a hit only if a candidate it moved there can
   * still reach every later display of that Pokemon. The forward pass checks
   * each display on its own; walking each HP history back from what survived
   * the last one keeps only whole paths - which is what makes two unknown
   * Pokemon hitting each other consistent across turns, not just within one.
   */
  function backward() {
    for (const rec of recs) {
      if (!rec.history.length) continue;
      let alive = new Map(rec.chain);
      rec.alive = [];
      for (let i = rec.history.length - 1; i >= 0; i--) {
        rec.alive[i] = alive;
        const { change, token, pre } = rec.history[i];
        const seen = change.via && token !== null ? new Uint8Array(SPAN) : null;
        const prev = new Map();
        const allowAt = new Map();
        for (const [k, hs] of pre) {
          const later = alive.get(k);
          if (!later) continue;
          const hp = KEY_HP[k];
          const M = maxHp(rec, hp);
          let allow = null;
          if (token !== null) {
            if (!allowAt.has(M)) allowAt.set(M, interval(rec, M, token));
            allow = allowAt.get(M);
            if (!allow) continue;
          }
          const d = change.dim ? KEY_DIM[change.dim][k] : 0;
          const keep = [];
          for (const h of hs) {
            let ok = false;
            if (change.same) {
              ok = later.includes(h) && (!change.allowSet || change.allowSet.has(M * HP_BITS + h));
            } else if (change.band) {
              let lo = change.band === 'up' ? h : 0;
              let hi = change.band === 'down' ? h : M;
              if (allow) { lo = Math.max(lo, allow[0]); hi = Math.min(hi, allow[1]); }
              ok = later.some(x => x >= lo && x <= hi);
            } else {
              for (const packed of change.table.get((hp * SPAN + d) * HP_BITS + h) || []) {
                const h2 = packed % HP_BITS;
                if (!later.includes(h2)) continue;
                const v = Math.floor(packed / HP_BITS) % SPAN;
                if (change.dealtOk && !change.dealtOk.has(v * HP_BITS + h - h2)) continue;
                ok = true;
                if (!seen) break;
                seen[v] = 1;
              }
            }
            if (ok) keep.push(h);
          }
          if (keep.length) prev.set(k, keep);
        }
        if (seen) {
          const dom = change.via.rec.flat[change.via.stat];
          for (let v = 0; v < SPAN; v++) if (dom[v] && !seen[v]) dom[v] = 0;
        }
        alive = prev;
      }
      rec.pathKeys = new Set(alive.keys());
    }
  }

  /** What the backward walk removed, as one event per Pokemon. */
  function wholePaths() {
    const before = record ? new Map(recs.map(rec => [rec, countOf(rec)])) : null;
    backward();
    for (const rec of recs) {
      if (rec.pathKeys && rec.chain) for (const k of [...rec.chain.keys()]) if (!rec.pathKeys.has(k)) rec.chain.delete(k);
    }
    if (!record) return;
    const cuts = [];
    for (const rec of recs) {
      const after = countOf(rec);
      if (after !== before.get(rec)) cuts.push({ id: rec.id, pokemon: label(rec), before: before.get(rec), after });
    }
    if (cuts.length) {
      events.push({ turn: battle.turn, what: 'every turn at once - recoil, attacker HP and later displays checked against earlier hits', cuts });
    }
  }

  /**
   * One exact HP path per Pokemon through everything the verified log showed,
   * when every spread is pinned. Chosen in the order the changes happened, so a
   * hit that depended on its attacker's HP takes the attacker's chosen HP, and a
   * hit whose recoil was printed deals an amount the recoil allows. Where more
   * than one value fits, the scaffold's own is kept.
   */
  function paths(raw) {
    const entries = [];
    for (const rec of recs) for (const [i, e] of rec.history.entries()) entries.push({ rec, i, e });
    entries.sort((x, y) => x.e.seq - y.e.seq);
    const cur = new Map();
    const chosen = new Map(recs.map(rec => [rec, []]));
    const secretAt = new Map();
    for (const rec of recs) {
      for (const { at, hist } of rec.shown) {
        const split = at >= 2 && /^\|split\|/.test(raw[at - 2] || '');
        const exactAt = split && raw[at] !== raw[at - 1] && !rec.exact ? at - 1 : at;
        secretAt.set(`${rec.id}|${hist}`, exactAt);
      }
    }
    const scaffoldHp = (rec, hist) => {
      const at = secretAt.get(`${rec.id}|${hist}`);
      const m = at === undefined ? null : /^(\d+)\//.exec(String(hpLine(raw[at])?.token || ''));
      return m ? Number(m[1]) : null;
    };
    for (const { rec, i, e } of entries) {
      const alive = rec.alive?.[i];
      if (!alive) return null;
      let state = cur.get(rec);
      if (!state) {
        const [k, hs] = [...e.pre.entries()][0] || [];
        if (k === undefined) return null;
        state = [k, hs[0]];
      }
      const [k, h] = state;
      const later = alive.get(k) || [];
      const M = maxHp(rec, KEY_HP[k]);
      const d = e.change.dim ? KEY_DIM[e.change.dim][k] : 0;
      const options = [];
      if (e.change.same) {
        if (later.includes(h) && (!e.change.allowSet || e.change.allowSet.has(M * HP_BITS + h))) options.push(h);
      } else if (e.change.band) {
        const lo = e.change.band === 'up' ? h : 0;
        const hi = e.change.band === 'down' ? h : M;
        for (const x of later) if (x >= lo && x <= hi) options.push(x);
      } else {
        const attacker = e.change.sourceStates ? cur.get(e.change.dealtBy) : null;
        for (const packed of e.change.table.get((KEY_HP[k] * SPAN + d) * HP_BITS + h) || []) {
          const h2 = packed % HP_BITS;
          if (!later.includes(h2)) continue;
          const tag = Math.floor(packed / HP_BITS);
          if (e.change.dealtOk && !e.change.dealtOk.has((tag % SPAN) * HP_BITS + h - h2)) continue;
          if (attacker) {
            const [sM, sH] = e.change.sourceStates[Math.floor(tag / SPAN)];
            if (sM !== maxHp(e.change.dealtBy, KEY_HP[attacker[0]]) || sH !== attacker[1]) continue;
          }
          options.push(h2);
        }
      }
      if (!options.length) return null;
      const own = e.token !== null ? scaffoldHp(rec, i) : null;
      const h2 = options.includes(own) ? own : options[0];
      chosen.get(rec)[i] = h2;
      cur.set(rec, [k, h2]);
    }

    const tokens = new Map();
    for (const rec of recs) {
      if (rec.exact) continue;
      const k = cur.get(rec)?.[0];
      if (k === undefined) continue;
      for (const { hist } of rec.shown) {
        const h = chosen.get(rec)[hist];
        if (h === undefined) return null;
        tokens.set(secretAt.get(`${rec.id}|${hist}`), h ? `${h}/${maxHp(rec, KEY_HP[k])}` : '0');
      }
    }
    return tokens;
  }

  // ------------------------------------------------------------ speed

  function speedRules() {
    const upTo = Math.min(prefix.cutoffAt, battle.log.length);
    const firstAt = (at) => {
      let lo = 0;
      let hi = view.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (view[mid].at < at) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const visible = (ex) => {
      const rec = ex.pokemon && byPokemon.get(ex.pokemon);
      if (!rec || ex.end > upTo) return false;
      const me = new RegExp(`(^|\\|| )${rec.side}[a-d]: ${rec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||$)`);
      for (let i = firstAt(ex.start); i < view.length && view[i].at < ex.end; i++) {
        if (me.test(view[i].line)) return true;
      }
      return false;
    };
    for (let i = firstAt(0); i < view.length && view[i].at < upTo; i++) {
      if (/\|(move: )?(After You|Quash|Instruct)(\||$)/.test(view[i].line)) {
        tainted.add(executed.find(ex => ex.start <= view[i].at && view[i].at < ex.end)?.sort?.turn);
      }
    }
    const shown = new Map(executed.map(ex => [ex.action, { ex, on: visible(ex) }]));
    const order = new Map(executed.map((ex, i) => [ex.action, i]));
    const rules = [];
    for (const [i, ex] of executed.entries()) {
      const S = ex.sort;
      if (!S || tainted.has(S.turn) || !shown.get(ex.action)?.on) continue;
      const at = S.list.findIndex(item => item.action === ex.action);
      if (at < 0) continue;
      const x = S.list[at];
      for (const y of S.list.slice(at + 1)) {
        if (!y.pokemon || y.pokemon === x.pokemon || y.order !== x.order || y.priority !== x.priority) continue;
        const later = order.get(y.action);
        if (later === undefined || later <= i || !shown.get(y.action)?.on) continue;
        const X = byPokemon.get(x.pokemon);
        const Y = byPokemon.get(y.pokemon);
        if (!X || !Y) continue;
        rules.push({ fast: X, slow: Y, tf: S.speeds.get(X), ts: S.speeds.get(Y), turn: S.turn });
      }
    }

    // The log diverged on who moved: the observed order is the true one.
    const cut = view.find(e => e.at === prefix.cutoffAt);
    const who = line => /^\|(move|cant)\|/.test(String(line || '')) ? String(line).split('|')[2] : null;
    const was = who(prefix.observedLine);
    const got = who(cut?.line);
    if (was && got && was !== got) {
      const ex = executed.find(e => e.start <= prefix.cutoffAt && prefix.cutoffAt < e.end);
      const P = byIdent.get(`${identSide(was)}:${identName(was)}`);
      const S = ex?.sort;
      const x = S?.list.find(item => item.action === ex.action);
      const y = S?.list.find(item => item.pokemon === P?.pokemon && item.order === x?.order && item.priority === x?.priority);
      const Q = x && byPokemon.get(x.pokemon);
      if (P && Q && y && !tainted.has(S.turn)) rules.push({ fast: P, slow: Q, tf: S.speeds.get(P), ts: S.speeds.get(Q), turn: S.turn });
    }
    return rules;
  }

  function applySpeed(rules) {
    let sweep = 0;
    let moved = true;
    while (moved && sweep++ < 16) {
      moved = false;
      for (const rule of rules) {
        const { fast, slow, tf, ts } = rule;
        const before = record && sweep === 1 ? [countOf(fast), countOf(slow)] : null;
        let maxFast = -Infinity;
        let minSlow = Infinity;
        for (let v = 0; v < SPAN; v++) {
          if (fast.flat.spe[v]) maxFast = Math.max(maxFast, tf[v]);
          if (slow.flat.spe[v]) minSlow = Math.min(minSlow, ts[v]);
        }
        for (let v = 0; v < SPAN; v++) {
          if (fast.flat.spe[v] && tf[v] < minSlow) { fast.flat.spe[v] = 0; moved = true; }
          if (slow.flat.spe[v] && ts[v] > maxFast) { slow.flat.spe[v] = 0; moved = true; }
        }
        if (before) {
          const cuts = [];
          const a = countOf(fast);
          const b = countOf(slow);
          if (a !== before[0]) cuts.push({ id: fast.id, pokemon: label(fast), before: before[0], after: a });
          if (b !== before[1]) cuts.push({ id: slow.id, pokemon: label(slow), before: before[1], after: b });
          if (cuts.length) events.push({ turn: rule.turn, what: `${label(fast)} acted before ${label(slow)}`, cuts });
        }
      }
    }
  }

  return {
    state,
    paths,
    finish() {
      sync();
      state.ended = true;
      wholePaths();
      applySpeed(speedRules());
    },
    result() {
      return {
        recs: recs.map(rec => ({
          id: rec.id,
          keys: rec.chain ? [...rec.chain.keys()] : rec.knKeys,
          flat: rec.flat,
          seen: !!rec.chain,
        })),
        // In the order they were applied: every HP event as the battle ran, then
        // the whole-path check, then speed order, which needs every turn's sort.
        events,
        cutoff: prefix.cutoffAt === Infinity ? null : { turn: prefix.turn, observed: prefix.observedLine },
      };
    },
  };
}

// ------------------------------------------------------------- the driver

/** A first guess: bulk and the stat the nature boosts, the way most sets are built. */
function defaultSpread(dex, set, hp) {
  const nature = dex.natures.get(set.nature || 'Serious');
  const base = dex.species.get(set.species || set.name).baseStats;
  const evs = { hp: Math.max(0, Math.min(32, hp ?? 32)), atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  let room = BUDGET - evs.hp;
  const put = (stat) => { const add = Math.max(0, Math.min(32 - evs[stat], room)); evs[stat] += add; room -= add; };
  put(nature.plus || (base.atk >= base.spa ? 'atk' : 'spa'));
  for (const stat of ['spe', 'def', 'spd', 'atk', 'spa']) if (stat !== nature.minus) put(stat);
  return evs;
}

/** The surviving spread nearest `prev`, counting Stat Points moved. */
function closestSpread(kn, prev) {
  const A = aliveOf(kn.dom.atk);
  const S = aliveOf(kn.dom.spa);
  const E = aliveOf(kn.dom.spe);
  if (!A.length || !S.length || !E.length) return null;
  const best = new Array(3 * (SPAN - 1) + 1).fill(null);
  for (const a of A) {
    for (const s of S) {
      for (const e of E) {
        const cost = Math.abs(a - prev.atk) + Math.abs(s - prev.spa) + Math.abs(e - prev.spe);
        const sum = a + s + e;
        if (!best[sum] || cost < best[sum].cost) best[sum] = { cost, a, s, e };
      }
    }
  }
  const upTo = [];
  let run = null;
  for (let r = 0; r < best.length; r++) {
    if (best[r] && (!run || best[r].cost < run.cost)) run = best[r];
    upTo[r] = run;
  }
  let win = null;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const f = upTo[Math.min(room, upTo.length - 1)];
    if (!f) continue;
    const cost = Math.abs(KEY_HP[k] - prev.hp) + Math.abs(KEY_DEF[k] - prev.def) + Math.abs(KEY_SPD[k] - prev.spd) + f.cost;
    if (!win || cost < win.cost) win = { cost, k, f };
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.f.a, def: KEY_DEF[win.k], spa: win.f.s, spd: KEY_SPD[win.k], spe: win.f.e };
}

const sameSpread = (a, b) => STAT_IDS.every(s => a[s] === b[s]);

/**
 * Where to aim the next guess. The nearest survivor to a guess the evidence
 * just removed sits on the edge of what survives, where the next observation
 * is most likely to cut again - so a stat the evidence has narrowed aims at the
 * middle of its range, and a stat nothing has touched keeps the old value.
 */
function aimFor(kn, prev, q = 0.5) {
  const seen = { hp: new Uint8Array(SPAN), def: new Uint8Array(SPAN), spd: new Uint8Array(SPAN) };
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    seen.hp[KEY_HP[k]] = 1;
    seen.def[KEY_DEF[k]] = 1;
    seen.spd[KEY_SPD[k]] = 1;
  }
  const aim = {};
  for (const s of STAT_IDS) {
    const values = aliveOf(FLAT.includes(s) ? kn.dom[s] : seen[s]);
    aim[s] = values.length && values.length < SPAN ? values[Math.floor((values.length - 1) * q + 0.5)] : prev[s];
  }
  return aim;
}

/**
 * Infer the Stat Points of every side marked unknown from a replay.
 *
 * @param sets     both teams as set objects - everything the sheets publish. A
 *                 known side's sets carry their real Stat Points.
 * @param known    `[p1Known, p2Known]`
 * @returns the surviving spreads per Pokemon, the events that removed the rest,
 *          and the reconstruction built from the spread it settled on.
 */
export async function inferSpreads({
  formatid,
  sets,
  known,
  playerNames,
  observed,
  channel = 1,
  sampleSeed = 1,
  maxProbes = 4000,
  maxRounds = 16,
  onProgress = () => {},
}) {
  const dex = Dex.forFormat(formatid);
  const lines = observed.filter(l => typeof l === 'string');

  // Where a side's HP is printed exactly, its max HP is printed too, and that
  // is the HP stat outright. Only the first guess uses it; the evidence pass
  // derives it again from the simulator.
  const exactHp = new Map();
  for (const line of lines) {
    const parts = line.split('|');
    if (!['switch', 'drag', 'replace'].includes(parts[1])) continue;
    const side = identSide(parts[2]);
    const m = /^(\d+)\/(\d+)$/.exec(String(parts[4] || '').split(' ')[0]);
    if (m && Number(m[2]) !== 100 && (channel === -1 || side === `p${channel}`)) {
      exactHp.set(`${side}:${identName(parts[2])}`, Number(m[2]));
    }
  }

  const blank = new Map();
  for (const [s, team] of sets.entries()) {
    for (const [i, set] of team.entries()) blank.set(`p${s + 1}:${i}`, freshKnowledge(set, known[s]));
  }
  let picks = sets.map((team, s) => team.map((set) => {
    if (known[s]) return fullEvs(set.evs);
    const max = exactHp.get(`p${s + 1}:${set.name || set.species}`);
    const base = dex.species.get(set.species || set.name).baseStats.hp;
    return defaultSpread(dex, set, max ? max - base - 75 : undefined);
  }));

  const settle = async (inputLog, knowledge, cache, record = false) => {
    const counts = () => new Map([...knowledge].map(([id, kn]) => [id, spreadCount(maskKeys(kn.keys), kn.dom).total]));
    const initial = record ? counts() : null;
    let first = null;
    let afterFirst = null;
    let passes = 0;
    while (passes < 8) {
      const pass = await evidencePass({ inputLog, observed: lines, channel, knowledge, cache, record: record && !first });
      passes++;
      let moved = false;
      for (const r of pass.recs) moved = intersectKnowledge(knowledge.get(r.id), r.keys, r.flat) || moved;
      for (const kn of knowledge.values()) moved = tighten(kn) || moved;
      if (!first) {
        first = pass;
        if (record) afterFirst = counts();
      }
      if (!moved) break;
    }
    return {
      events: first.events,
      cutoff: first.cutoff,
      seen: new Set(first.recs.filter(r => r.seen).map(r => r.id)),
      initial,
      afterFirst,
      passes,
    };
  };

  const knowledge = cloneKnowledge(blank);
  let built = null;
  let rounds = 0;
  let level = 0;
  let exact = null;
  const started = Date.now();

  // A wrong guess makes a turn that no die can repair, and a full search spends
  // its whole budget proving that. So a guess is first tried on a small budget,
  // and a bigger one is only spent on a guess the evidence has no quarrel with.
  // The last resort samples differently: the search's own uniform choices can
  // corner it where a different draw of them would not.
  const budgets = [
    { maxProbes: Math.min(maxProbes, 150), maxBacktracks: 0 },
    { maxProbes: Math.min(maxProbes, 600), maxBacktracks: 2 },
    { maxProbes, maxBacktracks: 6 },
    { maxProbes, maxBacktracks: 6, resample: 1 },
  ];

  while (rounds < maxRounds) {
    rounds++;
    const packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const searchStart = Date.now();
    built = await reconstruct({
      formatid, packedTeams, playerNames, observed, channel, exact,
      sampleSeed: sampleSeed + (budgets[level].resample || 0),
      maxProbes: budgets[level].maxProbes,
      maxBacktracks: budgets[level].maxBacktracks,
    });
    const diff = built.report.diffs[0];
    onProgress(`round ${rounds}${level ? ` (search ${level + 1})` : ''}, ${((Date.now() - searchStart) / 1000).toFixed(1)}s: ${built.report.complete ? 'the whole log reproduces'
      : `reproduces through turn ${built.report.verifiedThroughTurn} - wanted ${diff?.expected}, got ${diff?.actual}`}`);
    if (built.report.complete) break;

    const cache = new Map();
    const evidenceStart = Date.now();
    const { seen } = await settle(built.inputLog, knowledge, cache);

    // New guesses, chosen together. Each Pokemon is pinned before the next is
    // chosen, because two unknowns can each be possible alone and impossible
    // together; a pin that leaves a later Pokemon with nothing is taken back and
    // the next candidate tried. A full set is accepted only when, with all of it
    // pinned, the evidence can name one exact HP path through every verified
    // turn - and the next search is handed those turns exact, so it cannot
    // sample its way into a dead end there. A Pokemon the log never showed keeps
    // its guess: nothing about it can be wrong yet.
    const order = [];
    for (const [s, team] of sets.entries()) {
      if (known[s]) continue;
      for (const i of team.keys()) if (seen.has(`p${s + 1}:${i}`)) order.push([s, i]);
    }
    const next = picks.map(team => team.map(e => ({ ...e })));
    const emptied = kn => !kn.keys.includes(1) || FLAT.some(x => !kn.dom[x].includes(1));
    let tries = 32;
    const choose = async (n, cond) => {
      if (n === order.length) {
        tries--;
        const proof = await evidencePass({ inputLog: built.inputLog, observed: lines, channel, knowledge: cond, cache, exact: true });
        return proof.exact;
      }
      const [s, i] = order[n];
      const id = `p${s + 1}:${i}`;
      const kn = cond.get(id);
      const tried = [];
      for (const aim of [aimFor(kn, picks[s][i]), picks[s][i], aimFor(kn, picks[s][i], 0.25), aimFor(kn, picks[s][i], 0.75)]) {
        if (tries <= 0) return null;
        const pick = closestSpread(kn, aim);
        if (!pick || tried.some(t => sameSpread(t, pick))) continue;
        tried.push(pick);
        const narrowed = cloneKnowledge(cond);
        pinKnowledge(narrowed.get(id), pick);
        if (n < order.length - 1) {
          tries--;
          await settle(built.inputLog, narrowed, cache);
          if (order.slice(n + 1).some(([s2, i2]) => emptied(narrowed.get(`p${s2 + 1}:${i2}`)))) continue;
        }
        const found = await choose(n + 1, narrowed);
        if (found) { next[s][i] = pick; return found; }
      }
      return null;
    };
    exact = await choose(0, cloneKnowledge(knowledge));
    if (!exact) {
      for (const [s, i] of order) {
        const kn = knowledge.get(`p${s + 1}:${i}`);
        next[s][i] = closestSpread(kn, aimFor(kn, picks[s][i])) || next[s][i];
      }
    }
    onProgress(`  evidence and new guesses, ${((Date.now() - evidenceStart) / 1000).toFixed(1)}s${exact ? `, ${exact.size} turns exact` : ''}`);
    const unchanged = next.every((team, s) => team.every((e, i) => sameSpread(e, picks[s][i])));
    if (unchanged) {
      // The evidence accepts this guess, so what failed was the dice search.
      if (++level >= budgets.length) break;
    } else {
      level = 0;
    }
    picks = next;
  }

  const final = cloneKnowledge(blank);
  const result = await settle(built.inputLog, final, new Map(), true);
  for (const [id, kn] of final) {
    const had = knowledge.get(id);
    intersectKnowledge(kn, maskKeys(had.keys), had.dom);
    tighten(kn);
  }

  const pokemon = [];
  for (const [s, team] of sets.entries()) {
    for (const [i, set] of team.entries()) {
      const id = `p${s + 1}:${i}`;
      const kn = final.get(id);
      pokemon.push({
        id,
        side: `p${s + 1}`,
        species: set.species || set.name,
        known: known[s],
        seen: result.seen.has(id),
        from: result.initial.get(id),
        afterEvents: result.afterFirst.get(id),
        ...summarise(kn),
        used: picks[s][i],
        contains: (evs) => {
          const e = fullEvs(evs);
          return !!kn.keys[keyOf(e.hp, e.def, e.spd)] && FLAT.every(x => kn.dom[x][e[x]]);
        },
      });
    }
  }

  return {
    complete: built.report.complete,
    rounds,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    built,
    picks,
    pokemon,
    events: result.events,
    cutoff: result.cutoff,
    passes: result.passes,
  };
}
