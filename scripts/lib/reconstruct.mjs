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
 *   3. on a mismatch the turn is replayed under a different `>reseed`, until its
 *      lines match. Uniform sampling over seeds is uniform sampling over the
 *      roll tuples consistent with the observation, so the search IS the
 *      sampler for the opponent's exact HP behind each percentage.
 *   4. on exhaustion, back up a turn and redraw: a sampled HP can make the next
 *      turn's observation unreachable.
 *
 * Nothing here computes damage, accuracy, turn order or HP. The only thing this
 * file decides is which choice to write and which seed to keep.
 *
 * `>reseed` is the only state-forcing mechanism used. `>editbattle hp` would
 * write an HP no roll can produce - a log inconsistent with its own seed
 * (ENGINEERING.md 4.3) - and `>eval` echoes its own code into the battle log.
 */

import { createRequire } from 'module';

import { battleLines, firstDivergence } from './protocol.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams, toID } = require('pokemon-showdown');
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

// ------------------------------------------------------------- seed generation

/** A deterministic stream of seeds, so a reconstruction is reproducible. */
function seedStream(sampleSeed) {
  let state = (sampleSeed >>> 0) || 1;
  const next32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
  return () => {
    let hex = '';
    for (let i = 0; i < 4; i++) hex += next32().toString(16).padStart(8, '0');
    return `sodium,${hex}`;
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

/**
 * Replay the whole battle under a given set of per-turn seeds.
 *
 * Stops at the first turn whose emitted lines disagree with the observed ones,
 * unless `tolerant` is set - which is how a best-effort log is produced after
 * the search gives up.
 */
async function playThrough({ header, segments, plans, reseeds, variants, channel, state0, dex, stopAt, tolerant }) {
  const stream = new BattleStream({ keepAlive: true });
  const sink = [];
  const drain = (async () => { for await (const chunk of stream) sink.push(chunk); })();

  await stream.write(header.join('\n'));
  const battle = stream.battle;
  if (!battle) throw new Error('no battle after >start - the header is malformed');

  const notes = [];
  const diffs = [];
  const widths = [];
  let badTurn = null;
  let logAt = 0;

  for (let k = 0; k < segments.length; k++) {
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
    const want = battleLines(segments[k]);
    const got = battleLines(onChannel(battle.log.slice(logAt), channel));
    logAt = battle.log.length;

    // `|player|` is room noise wherever it appears: a branch recording gets one
    // more every time a browser window takes a slot, mid-battle included. The
    // rest of the allowlist only makes sense before turn 1.
    const soft = (line) => {
      const kind = String(line).split('|')[1];
      return kind === 'player' || (k === 0 && SOFT_PRETURN.has(kind));
    };
    const wantHard = want.filter(l => !soft(l));
    const gotHard = got.filter(l => !soft(l));
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
  maxTries = 2000,
  maxVariants = 256,
  maxBacktracks = 6,
  onProgress = () => {},
}) {
  const dex = Dex.forFormat(formatid);
  const lines = observed.filter(l => typeof l === 'string');
  const segments = splitTurns(lines);
  if (segments.length < 2) throw new Error('observed log has no complete turn');

  const plans = segments.map(s => planSegment(s, dex));
  recoverChargeTargets(plans);

  const avatar = avatars(lines);
  const startSeed = seed || seedStream(sampleSeed ^ 0x5eed)();
  const header = [
    `>start ${JSON.stringify({ formatid, seed: startSeed })}`,
    `>player p1 ${JSON.stringify({ name: playerNames[0], avatar: avatar.p1, team: packedTeams[0] })}`,
    `>player p2 ${JSON.stringify({ name: playerNames[1], avatar: avatar.p2, team: packedTeams[1] })}`,
  ];

  const state0 = { reveal: revealOrder(lines), sizes: teamSizes(lines) };
  const reseeds = new Array(segments.length).fill(null);
  const variants = new Array(segments.length).fill(0);
  const tried = new Array(segments.length).fill(0);

  // A source produced by branching had its own RNG reset mid-battle. Where that
  // is known - the rung that supplies the real seed supplies these too - start
  // from it rather than making the search rediscover it.
  for (const { turn, seed: at } of seedPlan || []) {
    if (turn >= 1 && turn < reseeds.length) reseeds[turn] = at;
  }
  const nextSeed = seedStream(sampleSeed);

  const common = { header, segments, plans, channel, state0, dex };
  let attempts = 0;
  let backtracks = 0;

  let run = await playThrough({ ...common, reseeds, variants });
  attempts++;

  while (run.badTurn !== null) {
    const t = run.badTurn;
    if (t === 0) break; // the pre-turn segment is not something a seed can fix

    onProgress(`turn ${t}: searching - observed ${run.diffs[0]?.expected ?? '(nothing)'}`);

    let solved = false;

    // First walk the substitutions. A variant that reproduces the turn is
    // strictly better than a reseed: it leaves the seed alone, adds no
    // "RNG was reset" line, and may well be the choice that was really made.
    const width = Math.min(run.widths?.[t] || 1, maxVariants);
    for (let v = 1; v < width && !solved; v++) {
      variants[t] = v;
      const probe = await playThrough({ ...common, reseeds, variants, stopAt: t });
      attempts++;
      if (probe.badTurn === null) { solved = true; break; }
    }
    if (!solved) variants[t] = 0;

    // Then the seeds. Uniform over seeds is uniform over the roll tuples the
    // observation permits, which is what makes this the HP sampler.
    while (!solved && tried[t] < maxTries) {
      reseeds[t] = nextSeed();
      tried[t]++;
      const probe = await playThrough({ ...common, reseeds, variants, stopAt: t });
      attempts++;
      if (probe.badTurn === null) { solved = true; break; }
      if (tried[t] % 250 === 0) onProgress(`turn ${t}: ${tried[t]} seeds tried`);
    }

    if (solved) {
      run = await playThrough({ ...common, reseeds, variants });
      attempts++;
      continue;
    }

    // Exhausted. A sampled HP earlier in the game may have made this turn
    // unreachable, so back up and redraw.
    let back = t - 1;
    while (back >= 1 && tried[back] >= maxTries) back--;
    if (back < 1 || ++backtracks > maxBacktracks) break;
    onProgress(`turn ${t}: exhausted, backtracking to turn ${back}`);
    for (let i = back + 1; i < reseeds.length; i++) { reseeds[i] = null; variants[i] = 0; tried[i] = 0; }
    run = await playThrough({ ...common, reseeds, variants });
    attempts++;
  }

  const complete = run.badTurn === null;
  if (!complete) {
    // Best effort: drive every turn regardless, so the artifact exists and the
    // divergence is visible rather than the whole run being lost.
    run = await playThrough({ ...common, reseeds, variants, tolerant: true });
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
      seedsTried: tried.reduce((a, b) => a + b, 0),
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
