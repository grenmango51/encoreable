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
 * inference (`inference/`) decides which spreads survive, and asks the
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
export const SOFT_PRETURN = new Set(['tier', 'rule', 'showteam', 'teampreview', 'player']);

// --------------------------------------------------------------- log utilities

export const identName = ident => String(ident || '').split(': ').slice(1).join(': ');
export const identSide = ident => String(ident || '').slice(0, 2);
const identSlot = ident => 'abc'.indexOf(String(ident || '')[2]);

/** Tags on a protocol line, as `{ from: 'lockedmove', spread: 'p1a,p1b', ... }`. */
export function tagsOf(line) {
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
export function sampler(sampleSeed) {
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

// ------------------------------------------------- HP displays and dry runs

/** A damage roll has sixteen faces; face 0 is full damage. */
export const ROLLS = 16;

/**
 * An HP display as a number that only ever grows with HP, so the values behind
 * one display form a single interval. Champions shades `20/100` and `50/100` by
 * which side of the fifth or the half they fall (`sim/pokemon.ts:2075`).
 */
export function hpRank(token, exact) {
  if (token === '0') return { rank: 0, max: null };
  const m = /^(\d+)\/(\d+)([a-z]?)$/.exec(token);
  if (!m) return null;
  if (exact) return { rank: Number(m[1]), max: Number(m[2]) };
  const pct = Number(m[1]);
  const upper = (pct === 20 && m[3] === 'y') || (pct === 50 && m[3] === 'g');
  return { rank: 1 + 2 * pct + (upper ? 1 : 0), max: null };
}

/** Item and volatile state, captured so a dry run can hand it back untouched. */
export function snapItems(list) {
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

export function restoreItems(snap) {
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
export function override(obj, name, fn) {
  const had = Object.prototype.hasOwnProperty.call(obj, name);
  const prev = obj[name];
  obj[name] = fn;
  return () => { if (had) obj[name] = prev; else delete obj[name]; };
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
  for (const { i, from, to, value, mark, at } of trace || []) {
    if (mark !== seg || from < 0) continue;
    const lo = to < 0 ? 0 : from;
    const hi = (to < 0 ? from : to) - 1;
    if (hi <= lo) continue;
    rows.push({ i, lo, hi, value, at });
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
 *
 * A draw `steer` has already read off the observed turn is not enumerated: a
 * damage roll offers one roll per HP it could leave that prints the line its
 * hit is about to print, a crit only the face that makes it agree.
 */
function candidates({ i, lo, hi, value }, steer = null) {
  const fits = steer?.get(i);
  if (fits) return fits.reps;
  const span = hi - lo + 1;
  const all = span <= 16 ? Array.from({ length: span }, (_, k) => lo + k) : [lo, hi];
  return all.filter(v => v !== value);
}

/**
 * One rebuilt turn against the observed one, as the lines each side of the
 * comparison sees.
 *
 * `|player|` is room noise wherever it appears: a branch recording gets one more
 * every time a browser window takes a slot, mid-battle included. The rest of
 * the allowlist only makes sense before turn 1. A turn the evidence has proved
 * is compared exact, as far as it was proved: the omniscient view line for line
 * up to there, the observed one after.
 */
function compareTurn({ segments, exact, channel }, k, slice) {
  const soft = (line) => {
    const kind = String(line).split('|')[1];
    return kind === 'player' || (k === 0 && SOFT_PRETURN.has(kind));
  };
  const hard = lines => battleLines(lines).filter(l => !soft(l));
  let wantHard = hard(segments[k]);
  let gotHard = hard(onChannel(slice, channel));
  let exactUpTo = 0;
  const known = exact?.get(k);
  if (known) {
    const proved = hard(known.lines);
    const gotExact = hard(onChannel(slice, -1));
    wantHard = known.partial ? [...proved, ...wantHard.slice(proved.length)] : proved;
    gotHard = known.partial ? [...gotExact.slice(0, proved.length), ...gotHard.slice(proved.length)] : gotExact;
    exactUpTo = known.partial ? proved.length : Infinity;
  }
  return { wantHard, gotHard, exactUpTo };
}

/** Lines that start another action: a hit's own HP line always comes before them. */
export const ACTION_START = new Set(['move', 'cant', 'switch', 'drag', 'replace', 'upkeep', 'turn']);

/**
 * Read the dice of every real hit on turn `turn` off the observed turn, as they
 * are thrown.
 *
 * At the moment a hit is calculated the rebuilt turn has printed exactly what
 * the observed turn printed so far, so the observed turn says which HP line
 * this hit is about to print. The simulator's own `getDamage` is run again for
 * a roll, dry - a cloned move with the crit it really rolled, no dice consumed,
 * no messages, items and the log handed back - and the target's `getHealth`
 * says what that roll would print. HP after the hit only grows with the roll
 * (roll 0 is full damage), so the rolls that print the observed line are one
 * run of the sixteen, and a bisection finds its two ends.
 *
 * The crit die and each target's accuracy die are read the same way: the
 * observed turn shows a `|-crit|` or a `|-miss|` for the target or it does not.
 *
 * `out` maps a draw's ordinal to `{ reps, groups, wrong }`: the faces worth
 * probing, each standing for the faces that play out the same as it (`groups`),
 * and whether the face the run threw prints the wrong line. A hit whose line
 * cannot be placed - the turn already disagrees, a Substitute took it, a roll
 * the dry run cannot answer - gets no entry and is searched in full.
 */
function steerDice(battle, { at, turn, compare, channel, out }) {
  const st = battle.__rng;
  const actions = battle.actions;
  let draws = null;
  const origRandomizer = battle.randomizer;
  battle.randomizer = function (base) {
    if (draws && !st.dry) draws.push(st.draws);
    return origRandomizer.call(this, base);
  };

  const dry = (fn, roll) => {
    const undo = override(battle, 'random', (m, n) => (m === 16 && n === undefined ? roll : (n === undefined ? 0 : m)));
    const prevDry = st.dry;
    st.dry = { roll };
    const saved = {
      log: battle.log.length, faints: battle.faintQueue.length, move: battle.activeMove,
      target: battle.activeTarget, user: battle.activePokemon, lastDamage: battle.lastDamage,
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
      st.dry = prevDry;
      undo();
    }
  };

  /**
   * The observed lines still to come in this action, or null if the rebuilt
   * turn already disagrees with the observed one.
   */
  function standing() {
    const { wantHard, gotHard, exactUpTo } = compare(at.k, battle.log.slice(at.logAt));
    // The move in flight has not had its `[spread]`, `[miss]` or `[still]`
    // appended yet (`attrLastMove`), so its line is only a prefix of the one
    // it will become.
    let moving = -1;
    for (let i = gotHard.length - 1; i >= 0 && moving < 0; i--) if (gotHard[i].startsWith('|move|')) moving = i;
    for (let i = 0; i < gotHard.length; i++) {
      if (gotHard[i] === wantHard[i]) continue;
      if (i === moving && String(wantHard[i]).startsWith(`${gotHard[i]}|`)) continue;
      return null;
    }
    let end = gotHard.length;
    while (end < wantHard.length && !ACTION_START.has(wantHard[end].split('|')[1])) end++;
    return { wantHard, exactUpTo, from: gotHard.length, end };
  }

  /**
   * Where the observed turn stands when a hit starts: whether the hit's target
   * is shown a crit and which line is its HP line, before the next action.
   */
  function expect(target) {
    const now = standing();
    if (!now) return null;
    const ident = String(target);
    let crit = false;
    let line = -1;
    for (let i = now.from; i < now.end && line < 0; i++) {
      const parts = now.wantHard[i].split('|');
      if (parts[1] === '-crit' && parts[2] === ident) crit = true;
      if (parts[1] === '-damage' && parts[2] === ident && parts.length === 4) line = i;
    }
    return { ...now, crit, line };
  }

  const faceOf = i => st.trace?.findLast(row => row.i === i)?.value;

  /**
   * A chance die, `random(d) < n`, against the outcome the observed turn shows:
   * either end of the die decides it, and one that already agrees has nothing
   * to fix.
   */
  const chanceEntry = ({ i, n, d }, want) => {
    const face = faceOf(i);
    if (face === undefined || d <= 1) return null;
    if ((face < n) === want) return none(false);
    const fix = want ? 0 : d - 1;
    return (fix < n) === want ? { reps: [fix], groups: new Map(), wrong: true } : none(true);
  };

  const none = wrong => ({ reps: [], groups: new Map(), wrong });

  function bracket(source, target, move, clone, items, seen, current) {
    // No HP line for this target before the next action: the hit landed on
    // nothing the log shows, and its roll has nothing to fix - unless a
    // Substitute took it, whose breaking the roll does decide.
    if (seen.line < 0) return target.volatiles.substitute ? null : none(false);
    const { wantHard, exactUpTo, line } = seen;
    const want = wantHard[line].split('|')[3];
    const secret = channel === -1 || target.side.id === `p${channel}` || line < exactUpTo;
    const wantRank = hpRank(want.split(' ')[0], secret)?.rank;
    if (wantRank === undefined) return null;

    const h = target.hp;
    const shown = new Map();
    const printed = (r) => {
      if (shown.has(r)) return shown.get(r);
      let token = null;
      let left = null;
      const post = snapItems([source, target]);
      try {
        let x = dry(() => {
          restoreItems(items);
          clone.moveHitData = undefined;
          return origGetDamage.call(actions, source, target, clone, true);
        }, r);
        if (typeof x === 'number') {
          if (x !== 0) x = Math.max(1, x);
          if (x >= h) {
            x = dry(() => { restoreItems(post); return battle.runEvent('Damage', target, source, move, x, true); }, r);
            if (typeof x === 'number' && x !== 0) x = Math.max(1, x);
          }
          if (typeof x === 'number') {
            left = Math.max(0, h - Math.trunc(x));
            target.hp = left;
            const health = target.getHealth();
            token = String(secret ? health.secret : health.shared);
          }
        }
      } finally {
        target.hp = h;
        restoreItems(post);
      }
      shown.set(r, token);
      hpAfter.set(r, left);
      return token;
    };
    const hpAfter = new Map();
    const rankAt = (r) => {
      const token = printed(r);
      const rank = token === null ? undefined : hpRank(token.split(' ')[0], secret)?.rank;
      if (rank === undefined) throw new Error('unranked');
      return rank;
    };
    try {
      let lo = 0;
      let hi = ROLLS;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rankAt(mid) < wantRank) lo = mid + 1; else hi = mid; }
      if (lo === ROLLS || rankAt(lo) !== wantRank) return none(true);
      const first = lo;
      hi = ROLLS - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rankAt(mid) > wantRank) hi = mid - 1; else lo = mid; }
      const fits = [];
      for (let r = first; r <= lo; r++) if (printed(r) === want) fits.push(r);
      // Two rolls that leave the target on the same exact HP dealt the same
      // damage, so everything after plays out the same: one of them is probed
      // for all, and none for the one the run already threw.
      printed(current);
      const groups = new Map();
      for (const r of fits) {
        if (hpAfter.get(r) === hpAfter.get(current)) continue;
        const rep = [...groups.keys()].find(k => hpAfter.get(k) === hpAfter.get(r));
        if (rep === undefined) groups.set(r, [r]); else groups.get(rep).push(r);
      }
      return { reps: [...groups.keys()], groups, wrong: !fits.includes(current) };
    } catch {
      return null;
    }
  }

  // The crit is the one chance `getDamage` takes before it rolls damage; the
  // accuracy step takes one per target, with that target active.
  let chances = null;
  let aiming = null;
  const origChance = battle.randomChance;
  battle.randomChance = function (n, d) {
    if (!st.dry) {
      if (chances && !draws.length) chances.push({ i: st.draws, n, d });
      else if (aiming) aiming.push({ i: st.draws, n, d, target: battle.activeTarget });
    }
    return origChance.call(this, n, d);
  };

  // A target the observed turn shows `|-miss|` for was missed; every other
  // target that reached the accuracy step was hit.
  const origAccuracy = actions.hitStepAccuracy;
  actions.hitStepAccuracy = function (targets, pokemon, move) {
    if (at.k !== turn || st.dry || aiming || draws || move.smartTarget) return origAccuracy.call(this, targets, pokemon, move);
    const now = standing();
    const rolls = [];
    aiming = rolls;
    try {
      return origAccuracy.call(this, targets, pokemon, move);
    } finally {
      aiming = null;
      if (now) {
        for (const roll of rolls) {
          const missed = `|-miss|${pokemon}|${roll.target}`;
          let shown = false;
          for (let i = now.from; i < now.end && !shown; i++) shown = now.wantHard[i] === missed;
          const entry = chanceEntry(roll, !shown);
          if (entry) out.set(roll.i, entry);
        }
      }
    }
  };

  const origGetDamage = actions.getDamage;
  actions.getDamage = function (source, target, move, suppress) {
    if (at.k !== turn || st.dry || draws || typeof move !== 'object' || !move || move.category === 'Status') {
      return origGetDamage.call(this, source, target, move, suppress);
    }
    const seen = expect(target);
    const clone = Utils.deepClone(move);
    const items = snapItems([source, target]);
    const got = [];
    const rolled = [];
    draws = got;
    chances = rolled;
    let real;
    try {
      real = origGetDamage.call(this, source, target, move, suppress);
    } finally {
      draws = null;
      chances = null;
    }
    if (!seen || typeof real !== 'number') return real;
    const crit = !!target.getMoveHitData(move).crit;
    const chance = rolled.length === 1 && move.willCrit === undefined ? chanceEntry(rolled[0], seen.crit) : null;
    if (chance) out.set(rolled[0].i, chance);
    if (got.length !== 1 || crit !== seen.crit) return real;
    clone.willCrit = crit;
    const current = faceOf(got[0]);
    if (current === undefined) return real;
    const fits = bracket(source, target, move, clone, items, seen, current);
    if (fits) out.set(got[0], fits);
    return real;
  };
}

/**
 * Replay the whole battle under a given set of per-turn seeds.
 *
 * Stops at the first turn whose emitted lines disagree with the observed ones,
 * unless `tolerant` is set - which is how a best-effort log is produced after
 * the search gives up. With `steer`, that turn's damage, crit and accuracy dice
 * are read off the observed turn as they are thrown (`steerDice`).
 */
async function playThrough({ header, segments, plans, reseeds, variants, subs, channel, exact, state0, dex, stopAt, tolerant, steer = null }) {
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
  // Each draw also records how long the log was when it was thrown: a die
  // cannot change a line written before it.
  const push = trace.push;
  trace.push = row => push.call(trace, { ...row, at: battle.log.length });
  if (subs && Object.keys(subs).length) await stream.write(atLine(subs));

  const compare = (k, slice) => compareTurn({ segments, exact, channel }, k, slice);
  const at = { k: 0, logAt: 0 };
  const steered = steer === null ? null : new Map();
  if (steered) steerDice(battle, { at, turn: steer, compare, channel, out: steered });
  await stream.write(header.slice(1).join('\n'));

  const notes = [];
  const diffs = [];
  const widths = [];
  const starts = [];
  let badTurn = null;
  let logAt = 0;

  for (let k = 0; k < segments.length; k++) {
    markDraws(battle, k);
    at.k = k;
    at.logAt = logAt;
    starts[k] = logAt;
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

    const { wantHard, gotHard } = compare(k, slice);
    // A refused choice is often the echo of a line that already went wrong: a
    // Pokemon knocked out that the replay shows standing is then asked to be
    // replaced, and nothing was. That line is a die the search can move; only a
    // refusal behind lines that all agree is a matter of legality.
    // A replay can also stop on a turn whose replacements were never chosen - a
    // forfeit, the timer - and a last turn that printed everything it shows is
    // reproduced, whatever the simulator is still waiting for.
    const found = firstDivergence(wantHard, gotHard);
    const early = found && found.index < gotHard.length ? found : null;
    const finished = !found && k === segments.length - 1;
    const diff = state.unsatisfied && !finished ? (early || { index: -1, expected: state.unsatisfied, actual: '' }) : found;

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
    starts,
    notes,
    trace,
    steer: steered,
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

/**
 * Which of turn `t`'s draws could change the line the turn disagrees on. A die
 * thrown after that line was written cannot - with one exception: a move line
 * is amended after the fact (`[miss]`, `[still]`, a retarget - `attrLastMove`,
 * `retargetLastMove`), so a move line stays open until the next action starts.
 */
function canReach(common, run, t) {
  const diff = run.diffs[0];
  if (!diff || diff.turn !== t || diff.index < 0 || run.starts?.[t] === undefined) return () => true;
  const { gotHard } = compareTurn(common, t, run.rawLog.slice(run.starts[t]));
  let limit = diff.index;
  if (/^\|(move|-anim)\|/.test(gotHard[limit] || '')) {
    limit = Infinity;
    for (let j = diff.index + 1; j < gotHard.length; j++) {
      if (ACTION_START.has(gotHard[j].split('|')[1])) { limit = j; break; }
    }
  }
  if (limit === Infinity) return () => true;
  const reachOf = new Map();
  return (draw) => {
    if (draw.at === undefined) return true;
    let reach = reachOf.get(draw.at);
    if (reach === undefined) {
      reach = compareTurn(common, t, run.rawLog.slice(run.starts[t], draw.at)).gotHard.length;
      reachOf.set(draw.at, reach);
    }
    return reach <= limit;
  };
}

const outranks = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
const ties = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Settle one turn's random draws against the observed lines.
 *
 * Draws are taken in the order the simulator consumed them, because a die
 * cannot change a line that was written before it was thrown - so the earliest
 * disagreeing draw is always the one to fix, and fixing it can never undo
 * anything already agreed. The exception goes first: a draw `steerDice` read
 * off the observed turn and found printing the wrong line. Dice thrown after
 * the line the turn disagrees on are skipped (`canReach`). Each commit moves the
 * draws after it, so the trace is re-read from a fresh run rather than reused.
 *
 * A probe is not repeated when nothing it depended on moved. What changed since
 * it ran is the dice committed since, and a die thrown after the line the probe
 * failed on cannot reach that line: the run up to it is the same run, so it
 * fails there again.
 *
 * `subs` is mutated: it is the accumulated answer, keyed by the draw's position
 * in the battle, and it is what the emitted `>rng at` line carries.
 */
async function resolveTurn(t, common, subs, subTurn, sample, budget) {
  let run = await playThrough({ ...common, subs, stopAt: t, steer: t });
  let score = scoreOf(run, t);
  let forced = 0;
  let probes = 0;

  const found = new Map();
  const commits = [];
  const remember = (probe) => {
    const start = probe.starts?.[t] ?? 0;
    return {
      score: scoreOf(probe, t),
      since: commits.length,
      start,
      lines: probe.rawLog.slice(start),
      trace: probe.trace.filter(row => row.mark === t),
    };
  };
  const failAt = (rec) => {
    if (rec.fail !== undefined) return rec.fail;
    const { start, lines } = rec;
    const end = start + lines.length;
    let idx = rec.score[0];
    if (!Number.isFinite(idx) || idx < 0) return (rec.fail = end);
    const count = p => compareTurn(common, t, lines.slice(0, p - start)).gotHard.length;
    const { gotHard } = compareTurn(common, t, lines);
    if (/^\|(move|-anim)\|/.test(gotHard[idx] || '')) {
      let next = Infinity;
      for (let j = idx + 1; j < gotHard.length && next === Infinity; j++) {
        if (ACTION_START.has(gotHard[j].split('|')[1])) next = j;
      }
      idx = next;
    }
    if (idx >= gotHard.length) return (rec.fail = end);
    let lo = start;
    let hi = end;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (count(mid) > idx) hi = mid; else lo = mid + 1; }
    return (rec.fail = lo);
  };
  const holds = (rec) => {
    if (!rec.at) rec.at = new Map(rec.trace.map(row => [row.i, row.at]));
    for (const c of commits.slice(rec.since)) {
      const thrown = rec.at.get(Number(c));
      if (thrown !== undefined && thrown < failAt(rec)) return false;
    }
    return true;
  };
  const commit = (i, value) => {
    subs[i] = value;
    subTurn[i] = t;
    commits.push(i);
    forced++;
  };

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
    // A draw the steer has shown prints the wrong line is the likeliest fix,
    // so those go first; the rest keep the order they were thrown in.
    const reach = canReach(common, run, t);
    const all = drawsOf(run.trace, t);
    const wrong = d => !!run.steer?.get(d.i)?.wrong;

    // Every such draw set right at once, first. A spread move that missed one
    // target and hit the other needs both accuracy dice moved, and neither
    // alone brings the line any closer.
    const fixes = all.filter(d => subs[d.i] === undefined && reach(d) && wrong(d) && run.steer.get(d.i).reps.length);
    if (fixes.length > 1 && probes < budget) {
      const trial = { ...subs };
      for (const d of fixes) {
        const { reps, groups } = run.steer.get(d.i);
        const faces = reps.flatMap(v => groups.get(v) || [v]);
        trial[d.i] = faces[sample.pick(faces.length)];
      }
      const probe = await playThrough({ ...common, subs: trial, stopAt: t });
      probes++;
      if (outranks(scoreOf(probe, t), score)) {
        for (const d of fixes) commit(d.i, trial[d.i]);
        run = await playThrough({ ...common, subs, stopAt: t, steer: t });
        score = scoreOf(run, t);
        continue;
      }
    }

    for (const draw of [...all.filter(wrong), ...all.filter(d => !wrong(d))]) {
      if (subs[draw.i] !== undefined || !reach(draw)) continue;
      const same = v => run.steer?.get(draw.i)?.groups.get(v) || [v];

      let best = score;
      const winners = [];
      for (const v of candidates(draw, run.steer)) {
        const key = `${draw.i}|${v}`;
        let rec = found.get(key);
        if (!rec || !holds(rec)) {
          if (probes >= budget) break;
          const probe = await playThrough({ ...common, subs: { ...subs, [draw.i]: v }, stopAt: t });
          probes++;
          rec = remember(probe);
          found.set(key, rec);
        }
        const reach = rec.score;
        if (outranks(reach, best)) { best = reach; winners.length = 0; winners.push(...same(v)); }
        else if (ties(reach, best) && outranks(reach, score)) winners.push(...same(v));
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
      commit(pick.i, pick.value);
      committed = true;
      break;
    }

    if (!committed && fallback) {
      commit(fallback.i, fallback.value);
      committed = true;
    }

    if (!committed) break;
    run = await playThrough({ ...common, subs, stopAt: t, steer: t });
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
  const run = await playThrough({ ...common, subs, stopAt: t, steer: t });
  if (scoreOf(run, t)[0] !== Infinity) return false;
  const was = who ? exactHp(run.rawLog, who) : null;

  const options = [];
  const moving = [];
  let probes = 0;
  for (const draw of drawsOf(run.trace, t)) {
    for (const v of candidates(draw, run.steer)) {
      if (probes >= budget) break;
      const probe = await playThrough({ ...common, subs: { ...subs, [draw.i]: v }, stopAt: t });
      probes++;
      if (scoreOf(probe, t)[0] !== Infinity) continue;
      const found = (run.steer?.get(draw.i)?.groups.get(v) || [v]).map(value => ({ i: draw.i, value }));
      options.push(...found);
      // Most of a turn's dice have nothing to do with the Pokemon that is stuck.
      // Only the ones that actually move its HP are worth spending a backtrack
      // on; the rest would redraw the turn and change nothing that matters.
      if (who && exactHp(probe.rawLog, who) !== was) moving.push(...found);
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
 * @param pins         `{ subs, turns }`: draws already settled, by ordinal, and the turn
 *                     each belongs to. Stat Point inference supplies the dice that
 *                     rebuild its proved turns, so only the turn after them is
 *                     searched. A pin on a turn that fails is dropped and searched.
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
  pins = null,
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
  for (const [i, v] of Object.entries(pins?.subs || {})) {
    if (pins.turns?.[i] === undefined) continue;
    subs[i] = v;
    subTurn[i] = pins.turns[i];
  }

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
  // A handed-in pin is only as good as the turn it rebuilds: a spread that
  // throws a different sequence of dice there moves every ordinal after it. On
  // a turn proved only in part, the pins stand as long as that part holds.
  if (run.badTurn !== null && Object.keys(subs).some(i => subTurn[i] >= run.badTurn)) {
    const t = run.badTurn;
    const known = exact?.get(t);
    const held = known?.partial && run.diffs[0]?.index >= compareTurn(common, t, []).exactUpTo;
    forget(held ? t + 1 : t);
    run = await playThrough({ ...common, subs });
    attempts++;
  }

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
    pins: { subs: { ...subs }, turns: Object.fromEntries(run.trace.map(r => [r.i, r.mark])) },
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
