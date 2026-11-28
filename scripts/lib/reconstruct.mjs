/**
 * Turn an observed protocol log plus both teams into a replayable input log.
 *
 * A replay records *executions*, never decisions: no seed, no choices, and the
 * opponent's HP only as a Champions percentage. This rebuilds the missing input
 * log by replaying the battle forward one turn at a time and checking its own
 * work as it goes.
 *
 *   1. the simulator says what choice it wants and what is legal
 *      (`side.activeRequest`). We only answer "which of the
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
 * of every random event in it, so seed search is never used. Settling draws one
 * at a time costs their sum.
 * `>editbattle hp` stays rejected: it writes an HP no roll can produce, a log
 * inconsistent with its own seed.
 */

import os from 'os';
import { createRequire } from 'module';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { battleLines, firstDivergence, illusionStays, unmaskIllusion } from './protocol.mjs';
import { install, traceOn, markDraws, atLine } from './rng-control.mjs';
import { count, eventsNow } from './inference/census.mjs';

const require = createRequire(import.meta.url);
const { Battle, BattleStream, Dex, Teams, toID } = require('pokemon-showdown');
// Not re-exported by `sim/index.ts`. This is the sim's
// own resolver for the secret/public split, so no percentage arithmetic of ours
// exists anywhere in this project.
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');

/** Move targets the chooser must name explicitly (sim/battle-actions.ts:3). */
export const CHOOSABLE_TARGETS = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

/** Lines that start another action: a hit's own HP line always comes before them. */
export const ACTION_START = new Set(['move', 'cant', 'switch', 'drag', 'replace', 'upkeep', 'turn']);

/**
 * Pre-turn protocol lines allowed to differ without failing the reconstruction.
 *
 * A Bo3 replay says `|tier|... (Bo3)` and publishes `|showteam|` lines that a
 * plain single game never emits; a ladder game says `|rated|`, which decides
 * nothing in the battle. `|player|` repeats: a recording produced by
 * branching re-issues `>player` to update an avatar, and the server echoes one
 * more for every browser window that joins - neither is something the simulator
 * emits from a battle. Names, avatars and teams are checked directly instead.
 *
 * Everything substantive is still compared: `|poke|`, `|teamsize|`, `|start`,
 * the lead `|switch|` lines and `|turn|1`.
 */
export const SOFT_PRETURN = new Set(['tier', 'rated', 'rule', 'showteam', 'teampreview', 'player']);

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
    order: [],                      // start-of-turn slot actions in execution order
    reordered: [],                  // `${side}:${slot}` moved by Quash / After You
  };
  // Ally Switch moves two Pokemon between slots mid-turn, and the lines after
  // it name the new slots; a choice belongs to the slot its Pokemon chose from.
  const startOf = { p1: [0, 1, 2], p2: [0, 1, 2] };
  const left = { p1: new Set(), p2: new Set() };
  // A Pokemon Encored before it moves uses the Encored move, not the one it
  // chose, so its move line leaves its choice unseen - except a `[from]
  // lockedmove` release, which carries out a choice stored earlier, and a
  // charging move, whose target its release turn still names.
  const encored = new Set();
  // Revival Blessing asks its user's player which fainted Pokemon to bring
  // back, as a switch request for the user's slot; the heal line names the one
  // chosen. One revived into an empty active slot is switched in at once by
  // the simulator itself, before any next action or upkeep, so only that
  // immediate switch answers no request; one revived on the bench and sent in
  // later answers a request of its own.
  let reviver = null;
  let revived = null;

  for (const [i, line] of segment.entries()) {
    const parts = line.split('|');
    const kind = parts[1];

    if (kind === '-heal' && tagsOf(line).from === 'move: Revival Blessing' && reviver) {
      const side = identSide(parts[2]);
      plan.forced[side].push({ slot: reviver.slot, name: identName(parts[2]) });
      revived = identSlot(parts[2]) >= 0 ? { side, name: identName(parts[2]) } : null;
      reviver = null;
      continue;
    }
    if (kind === 'switch' && !tagsOf(line).from && revived && identSide(parts[2]) === revived.side && identName(parts[2]) === revived.name) {
      revived = null;
      continue;
    }
    if (ACTION_START.has(kind) || kind === 'faint') {
      reviver = null;
      revived = null;
    }

    if (kind === 'swap') {
      const side = identSide(parts[2]);
      const from = identSlot(parts[2]);
      const to = Number(parts[3]);
      if (startOf[side] && from >= 0 && to >= 0) [startOf[side][from], startOf[side][to]] = [startOf[side][to], startOf[side][from]];
      continue;
    }

    if (kind === '-mega' || kind === 'detailschange') {
      // `-mega` is the reliable marker; `detailschange` alone also covers forme
      // changes that are not a mega evolution at all.
      if (kind === '-mega') plan.megas.add(String(parts[2] || '').split(': ')[0]);
      continue;
    }

    if (kind === '-activate' && /^move: (Quash|After You)$/.test(parts[3] || '')) {
      const side = identSide(parts[2]);
      const orig = startOf[side]?.[identSlot(parts[2])] ?? -1;
      if (orig >= 0) plan.reordered.push(`${side}:${orig}`);
      continue;
    }

    if (kind === 'drag' || kind === 'faint') {
      const side = identSide(parts[2]);
      const orig = startOf[side]?.[identSlot(parts[2])] ?? identSlot(parts[2]);
      if (left[side] && orig >= 0 && !left[side].has(orig)) {
        if (!plan.actions[side][orig]) plan.order.push({ side, slot: orig, kind: 'faint' });
        left[side].add(orig);
      }
      continue;
    }

    if (kind === 'cant') {
      const side = identSide(parts[2]);
      const orig = startOf[side]?.[identSlot(parts[2])] ?? identSlot(parts[2]);
      if (left[side] && orig >= 0 && !left[side].has(orig)) plan.order.push({ side, slot: orig, kind: 'cant' });
      continue;
    }

    if (kind === 'switch') {
      const side = identSide(parts[2]);
      const slot = identSlot(parts[2]);
      const name = identName(parts[2]);
      const orig = startOf[side]?.[slot] ?? slot;
      if (i < cutoff && !tagsOf(line).from) plan.switches[side][slot] = name;
      else {
        if (left[side] && orig >= 0 && !left[side].has(orig) && !plan.actions[side][orig]) {
          plan.order.push({ side, slot: orig, kind: 'faint' });
        }
        plan.forced[side].push({ slot, name });
      }
      if (left[side] && orig >= 0) left[side].add(orig);
      continue;
    }

    if (kind === '-start' && /Encore$/.test(parts[3] || '')) {
      encored.add(parts[2]);
      continue;
    }

    if (kind === 'move') {
      if (toID(parts[3]) === 'revivalblessing') reviver = { slot: identSlot(parts[2]) };
      const from = tagsOf(line).from;
      // A `[from]` move was executed by something other than a fresh choice -
      // Copycat, Instruct, Dancer, Magic Bounce, Sleep Talk. `lockedmove` is the
      // exception: a locked Pokemon still gets a request offering exactly one
      // move (sim/pokemon.ts:1084), so it does need a choice line, even if
      // Encore landed on it earlier in the turn.
      if (from && from !== 'lockedmove') continue;
      const side = identSide(parts[2]);
      const slot = startOf[side]?.[identSlot(parts[2])] ?? identSlot(parts[2]);
      const moveid = toID(parts[3]);
      const target = parts[4] && parts[4].includes(': ') ? parts[4] : null;
      const isEncored = encored.has(parts[2]) && from !== 'lockedmove';
      if (left[side] && slot >= 0 && !left[side].has(slot)) {
        plan.order.push(isEncored ? { side, slot, kind: 'cant' } : { side, slot, kind: 'move', moveid });
      }
      plan.actions[side][slot] = {
        moveid,
        target,
        needsTarget: CHOOSABLE_TARGETS.has(dex.moves.get(moveid).target),
        encored: isEncored,
      };
    }

    if (kind === '-anim') {
      const side = identSide(parts[2]);
      const slot = startOf[side]?.[identSlot(parts[2])] ?? identSlot(parts[2]);
      const action = plan.actions[side]?.[slot];
      const target = parts[4] && parts[4].includes(': ') ? parts[4] : null;
      if (action && !action.target && action.needsTarget && action.moveid === toID(parts[3]) && target) {
        action.target = target;
        action.recovered = true;
      }
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
 * That is only where it landed: a redirection (Lightning Rod, Follow Me)
 * moves it, so the charge turn keeps its other targets as variants, and
 * `carriedInto` names the turn they show on.
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
            action.landsOn = plans.indexOf(later);
            break;
          }
        }
      }
    }
  }
}

/** The turns before `t` whose stored choices `t` carried out, latest first. */
function carriedInto(plans, t) {
  const out = [];
  for (let k = t - 1; k >= 0; k--) {
    if (Object.values(plans[k]?.actions || {}).some(acts => (acts || []).some(a => a?.landsOn === t))) out.push(k);
  }
  return out;
}

/**
 * Note in `out` each turn (`at.k`) on which a move or Illusion reads who stands
 * in the back of the party: Beat Up's allies, or `BeforeSwitchIn` choosing an
 * Illusion user's disguise from the last unfainted slot.
 */
function watchParty(battle, at, out, sideOut = null) {
  const note = (sideId = null) => {
    if (at.k > 0 && !out.includes(at.k)) out.push(at.k);
    if (at.k > 0 && sideId && sideOut) {
      const tag = `${at.k}:${sideId}`;
      if (!sideOut.includes(tag)) sideOut.push(tag);
    }
  };
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      let set = pokemon.set;
      Object.defineProperty(pokemon, 'set', {
        configurable: true,
        enumerable: true,
        get() {
          if (!this.isActive && battle.activeMove) note(side.id);
          return set;
        },
        set(value) { set = value; },
      });
    }
  }
  const origRunEvent = battle.runEvent;
  battle.runEvent = function (eventid, target, ...rest) {
    const res = origRunEvent.call(this, eventid, target, ...rest);
    if (eventid === 'BeforeSwitchIn' && (target?.ability === 'illusion' || target?.baseAbility === 'illusion')) note(target.side?.id);
    return res;
  };
  const origRandomSwitch = battle.getRandomSwitchable;
  if (typeof origRandomSwitch === 'function') {
    battle.getRandomSwitchable = function (side, ...rest) {
      note(side?.id);
      return origRandomSwitch.call(this, side, ...rest);
    };
  }
}

/** Every way to take `k` of `items` (as many as there are, if fewer), the first ones first. */
function combinations(items, k) {
  k = Math.min(k, items.length);
  if (k === 0) return [[]];
  const out = [];
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([items[i], ...rest]);
  }
  return out;
}

/** Every order of `items`, the given one first. */
function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([items[i], ...rest]);
  }
  return out;
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

/**
 * What the team sheets say about each side, for seeing an Illusion through:
 * each Pokemon's name, moves and max HP - read off a battle built from the
 * packed team, so the max HP is the simulator's - and whether the log shows
 * that side's HP exactly. A side with no team has no sheet.
 */
function sheetsOf(formatid, packedTeams, channel, guessed = null) {
  const out = {};
  for (const [s, packed] of packedTeams.entries()) {
    if (!packed) continue;
    const battle = new Battle({ formatid, p1: { name: 'p1', team: packed }, p2: { name: 'p2', team: packed } });
    const items = Object.values(battle.dex.data.Items);
    out[`p${s + 1}`] = {
      exact: channel === -1 || channel === s + 1,
      leads: battle.sides[0].active.length,
      members: battle.sides[0].pokemon.map(p => ({
        name: p.name,
        moves: new Set(p.set.moves.map(toID)),
        ability: toID(p.set.ability),
        megas: new Set([
          battle.actions.canMegaEvo(p),
          ...items.map(it => it?.megaStone?.[p.baseSpecies.name]).filter(Boolean),
        ].filter(Boolean)),
        maxhp: p.maxhp,
        // On a side whose spreads are guesses (`guessed`), every max HP its
        // Stat Points allow: one HP for each point, 0 to 32.
        ...(guessed?.includes(`p${s + 1}`) ? { hpSpan: [p.maxhp - (p.set.evs?.hp || 0), p.maxhp - (p.set.evs?.hp || 0) + 32] } : {}),
        illusion: toID(p.set.ability) === 'illusion',
      })),
    };
  }
  return out;
}

/**
 * Whether `orderNames` (a side's brought Pokemon in team-preview order) produces
 * every Illusion disguise shown in `rawLines` when replayed against `unmaskedLines`.
 */
function partyMatchesDisguises(orderNames, unmaskedLines, rawLines, sideId, sheet) {
  const users = (sheet?.members || []).filter(m => m.illusion);
  if (users.length !== 1) return true;
  if (new Set(sheet.members.map(m => m.name)).size !== sheet.members.length) return true;
  const zoroarkName = users[0].name;
  for (const l of unmaskedLines) {
    if (l.includes('Neutralizing Gas') || l.includes('Revival Blessing')) return true;
    if (l.startsWith('|-terastallize|') && l.includes(sideId) && l.includes(`: ${zoroarkName}`)) return true;
  }
  const slots = orderNames.slice();
  const leads = Math.min(sheet.leads || 2, slots.length);
  const fainted = new Set();
  let initialEntered = 0;
  for (let i = 0; i < unmaskedLines.length; i++) {
    const uParts = String(unmaskedLines[i]).split('|');
    const kind = uParts[1];
    const m = /^(p[1-4])([a-d]): (.+)$/.exec(uParts[2] || '');
    if (!m || m[1] !== sideId) continue;
    const pos = 'abcd'.indexOf(m[2]);
    const realName = m[3];
    if (kind === 'faint') {
      fainted.add(realName);
      continue;
    }
    if (kind === 'swap') {
      const newPos = Number(uParts[3]);
      if (pos >= 0 && newPos >= 0 && pos < leads && newPos < leads) {
        [slots[pos], slots[newPos]] = [slots[newPos], slots[pos]];
        continue;
      }
      return true;
    }
    if (kind !== 'switch' && kind !== 'drag') continue;
    if (initialEntered < leads) {
      initialEntered++;
      if (slots[pos] !== realName) return false;
    } else {
      const from = slots.indexOf(realName);
      if (from < leads || fainted.has(realName)) return false;
      [slots[pos], slots[from]] = [slots[from], slots[pos]];
    }
    if (realName === zoroarkName) {
      let disguisedAs = zoroarkName;
      for (let j = slots.length - 1; j > pos; j--) {
        if (!fainted.has(slots[j])) {
          disguisedAs = slots[j];
          break;
        }
      }
      const rParts = String(rawLines[i] || '').split('|');
      const rMatch = /^(p[1-4])[a-d]: (.+)$/.exec(rParts[2] || '');
      const shownName = rMatch ? rMatch[2] : realName;
      if (disguisedAs !== shownName) return false;
    }
  }
  return true;
}

/**
 * Whether the stay starting at `stayAt` did something the Illusion user's set
 * cannot: showed an exact max HP outside the Illusion user's range, Mega Evolved
 * into another species's Mega forme, triggered a non-Illusion ability before any
 * ability/forme change, used an unspoiled move only the shown Pokemon has,
 * overlapped with the Illusion user in another slot, or survived a move hit
 * without `|replace|` while Illusion was unsuppressed.
 */
function stayImpossibleForZoroark(rawLines, seenLines, stayAt, side, sheet) {
  const users = (sheet?.members || []).filter(m => m.illusion);
  if (users.length !== 1) return false;
  const zoroark = users[0];
  const rParts = String(rawLines[stayAt] || '').split('|');
  const m = /^((p[1-4])[a-d]): (.+)$/.exec(rParts[2] || '');
  if (!m || m[2] !== side) return false;
  const [, slot, , rawShownName] = m;
  const shown = sheet.members.find(x => x.name === rawShownName);
  const hp = /^\d+\/(\d+)/.exec(rParts[4] || '');
  const zoroarkCould = n => (zoroark.hpSpan ? n >= zoroark.hpSpan[0] && n <= zoroark.hpSpan[1] : n === zoroark.maxhp);
  const shownCould = n => !shown || (shown.hpSpan ? n >= shown.hpSpan[0] && n <= shown.hpSpan[1] : n === shown.maxhp);
  if (sheet.exact && hp && shownCould(Number(hp[1])) && !zoroarkCould(Number(hp[1]))) return true;

  let stayEnd = seenLines.length;
  let endedByReplace = false;
  for (let j = stayAt + 1; j < seenLines.length; j++) {
    const q = String(seenLines[j]).split('|');
    if (q[1] === 'swap' && String(q[2] || '').startsWith(side)) { stayEnd = j; break; }
    if (!String(q[2] || '').startsWith(`${slot}: `)) continue;
    if (['switch', 'drag', 'replace', 'faint'].includes(q[1])) {
      stayEnd = j;
      endedByReplace = q[1] === 'replace';
      break;
    }
  }
  if (endedByReplace) return false;

  const hasNeutralizingGas = seenLines.some(l => l.includes('Neutralizing Gas'));
  const zoroarkUnique = sheet.members.filter(x => x.name === zoroark.name).length === 1;
  let mover = null;
  let moveSpoiled = false;
  let abilitySpoiled = false;
  let illusionSuppressed = hasNeutralizingGas;
  for (let j = stayAt + 1; j < stayEnd; j++) {
    const line = String(seenLines[j]);
    const q = line.split('|');
    if (ACTION_START.has(q[1])) mover = q[1] === 'move' ? q[2] : null;
    const who = /^((p[1-4])[a-d]): (.+)$/.exec(q[2] || '');
    if (zoroarkUnique && who && who[2] === side && who[1] !== slot && who[3] === zoroark.name) return true;
    if (q[1] === '-activate' && line.includes(`${slot}: `)) {
      abilitySpoiled = true;
      if (/^move: (Mimic|Sketch)$/.test(q[3] || '')) moveSpoiled = true;
    }
    if (!abilitySpoiled && (q[1] === '-fieldstart' || q[1] === '-weather')) {
      const abMatch = /\[from\] ability: ([^|]+)/.exec(line);
      if (abMatch && line.includes(`[of] ${slot}: `)) {
        const ab = toID(abMatch[1]);
        if (ab && ab !== zoroark.ability) return true;
      }
    }
    if (!String(q[2] || '').startsWith(`${slot}: `)) continue;
    if (q[1] === 'detailschange') {
      const forme = String(q[3] || '').split(',')[0].trim();
      if (forme && (!shown || shown.megas.has(forme)) && !zoroark.megas.has(forme)) return true;
      abilitySpoiled = true;
    }
    if (q[1] === '-mega' && !zoroark.megas.size) return true;
    if (['-transform', '-formechange', '-terastallize', '-endability'].includes(q[1])) {
      abilitySpoiled = true;
      if (q[1] === '-transform') moveSpoiled = true;
      if (q[1] === '-endability') illusionSuppressed = true;
    }
    if (q[1] === '-ability') {
      if (line.includes('[from]')) abilitySpoiled = true;
      else if (!abilitySpoiled && toID(q[3]) && toID(q[3]) !== zoroark.ability) return true;
    }
    if (!illusionSuppressed && q[1] === '-damage' && !line.includes('[from]')
      && !/^0\b/.test(q[3] || '') && mover && mover !== q[2]) {
      return true;
    }
    if (!moveSpoiled && q[1] === 'move' && !line.includes('[from]')) {
      const move = toID(q[3]);
      if (move !== 'struggle' && shown?.moves.has(move) && !zoroark.moves.has(move)) return true;
    }
  }
  return false;
}

/**
 * Whether `seenLines` (with `forcedOnSide` unmasked on `side`) obeys Showdown's
 * team-size, active-slot uniqueness, fainted-switch, per-stay and party-slot
 * Illusion invariants on `side`.
 */
function sideConsistent(rawLines, seenLines, side, sheet, size, forcedOnSide) {
  if (!sheet) return true;
  for (const at of forcedOnSide) {
    if (stayImpossibleForZoroark(rawLines, seenLines, at, side, sheet)) return false;
  }
  const rev = revealOrder(seenLines)[side];
  if (rev.length > size) return false;
  const users = (sheet.members || []).filter(m => m.illusion);
  const zoroarkName = users.length === 1 ? users[0].name : null;
  const active = new Map();
  const dead = new Set();
  const entered = new Set();
  for (const line of seenLines) {
    if (line.includes('Revival Blessing')) dead.clear();
    const parts = String(line).split('|');
    const m = /^((p[1-4])[a-d]): (.+)$/.exec(parts[2] || '');
    if (!m || m[2] !== side) continue;
    const [, slot, , name] = m;
    const unique = sheet.members.filter(x => x.name === name).length === 1;
    if (parts[1] === 'faint') {
      active.delete(slot);
      if (unique) dead.add(name);
    } else if (parts[1] === 'swap') {
      const pos = Number(parts[3]);
      const other = pos >= 0 && pos < 4 ? `${side}${'abcd'[pos]}` : null;
      if (other) {
        const [va, vb] = [active.get(slot), active.get(other)];
        active.delete(slot); active.delete(other);
        if (vb !== undefined) active.set(slot, vb);
        if (va !== undefined) active.set(other, va);
      } else {
        active.clear();
      }
    } else if (parts[1] === 'replace') {
      if (unique && ((zoroarkName && name === zoroarkName && active.get(slot) !== zoroarkName)
        || [...active.entries()].some(([s, n]) => s !== slot && n === name) || dead.has(name))) return false;
      active.set(slot, name);
      entered.add(name);
    } else if (parts[1] === 'switch' || parts[1] === 'drag') {
      if (unique && ([...active.values()].includes(name) || dead.has(name))) return false;
      if (unique && !entered.has(name)) {
        const hp = /^(\d+)\/(\d+)/.exec(parts[4] || '');
        if (hp && Number(hp[1]) < Number(hp[2])) return false;
        if (/\b(psn|tox|brn|par|slp|frz)\b/.test(parts[4] || '')) return false;
      }
      active.set(slot, name);
      entered.add(name);
    }
  }
  if (users.length === 1 && new Set(sheet.members.map(m => m.name)).size === sheet.members.length) {
    const leads = Math.min(sheet.leads || 2, size);
    const front = rev.slice(0, leads);
    const known = rev.slice(leads);
    const pool = sheet.members.map(m => m.name).filter(n => !rev.includes(n));
    const need = Math.max(0, size - front.length - known.length);
    let anyOrder = false;
    outer: for (const chosen of combinations(pool, need)) {
      for (const back of permutations([...known, ...chosen])) {
        const order = [...front, ...back].slice(0, size);
        if (partyMatchesDisguises(order, seenLines, rawLines, side, sheet)) {
          anyOrder = true;
          break outer;
        }
      }
    }
    if (!anyOrder) return false;
  }
  return true;
}

/**
 * Structural Illusion analysis for one side: finds switch-ins that MUST be the
 * Illusion user across every consistent reading (`autoForced`), those that can
 * go either way (`open`), and tests complete or partial forced assignments.
 */
function analyseIllusionSide(lines, sheets, side) {
  const sheet = sheets?.[side];
  const users = (sheet?.members || []).filter(m => m.illusion);
  if (users.length !== 1) {
    return { autoForced: [], open: [], valid: () => true, canExtend: () => true };
  }
  const zoroark = users[0];
  const size = teamSizes(lines)[side];
  const base = unmaskIllusion(lines, { [side]: sheet });
  const rawStays = illusionStays(lines, { [side]: sheet });
  const candidates = rawStays.filter(({ at }) => {
    const m = /^(p[1-4])[a-d]: (.+)$/.exec(String(base.lines[at] || '').split('|')[2] || '');
    if (!m || m[2] === zoroark.name) return false;
    return !stayImpossibleForZoroark(lines, base.lines, at, side, sheet);
  });

  if (candidates.length <= 8) {
    const validMasks = [];
    for (let mask = 0; mask < (1 << candidates.length); mask++) {
      const trial = new Set(candidates.filter((_, k) => mask & (1 << k)).map(x => x.at));
      const unmasked = unmaskIllusion(lines, { [side]: sheet }, trial);
      if (sideConsistent(lines, unmasked.lines, side, sheet, size, trial)) validMasks.push(mask);
    }
    if (validMasks.length === 0) {
      return {
        autoForced: [],
        open: candidates.map(x => ({ ...x, side, name: identName(String(lines[x.at] || '').split('|')[2]) })),
        valid: () => true,
        canExtend: () => true,
      };
    }
    const autoForced = candidates
      .filter((_, k) => validMasks.every(m => m & (1 << k)))
      .map(x => x.at);
    const open = candidates.filter((_, k) =>
      validMasks.some(m => m & (1 << k)) && validMasks.some(m => !(m & (1 << k))))
      .map(x => ({ ...x, side, name: identName(String(lines[x.at] || '').split('|')[2]) }));
    const candIndex = new Map(candidates.map((c, k) => [c.at, k]));
    const checkForced = (forcedOnSide, partial) => {
      let reqBits = 0;
      for (const at of forcedOnSide) {
        const m = /^(p[1-4])[a-d]: (.+)$/.exec(String(base.lines[at] || '').split('|')[2] || '');
        if (m && m[2] === zoroark.name) continue;
        const idx = candIndex.get(at);
        if (idx === undefined) return false;
        reqBits |= 1 << idx;
      }
      if (partial) return validMasks.some(m => (m & reqBits) === reqBits);
      let fullMask = reqBits;
      for (const at of autoForced) fullMask |= 1 << candIndex.get(at);
      return validMasks.includes(fullMask);
    };
    return {
      autoForced,
      open,
      valid: set => checkForced(set, false),
      canExtend: set => checkForced(set, true),
    };
  }

  // Fallback for logs with >8 unsettled switches on one side.
  const autoSet = new Set();
  const hasSwap = lines.some(l => /^\|swap\|/.test(l) && l.includes(side));
  if (!hasSwap) {
    let moved = true;
    while (moved) {
      moved = false;
      const cur = unmaskIllusion(lines, { [side]: sheet }, autoSet).lines;
      const activeBySlot = new Map();
      const pairs = [];
      for (let i = 0; i < cur.length; i++) {
        const parts = String(cur[i]).split('|');
        const m = /^((p[1-4])[a-d]): (.+)$/.exec(parts[2] || '');
        if (!m || m[2] !== side) continue;
        const [, slot, , name] = m;
        if (parts[1] === 'faint') { activeBySlot.delete(slot); continue; }
        if (parts[1] !== 'switch' && parts[1] !== 'drag' && parts[1] !== 'replace') continue;
        const prevs = parts[1] === 'replace' ? [] : [...activeBySlot.values()];
        activeBySlot.delete(slot);
        if (parts[1] === 'replace') continue;
        const entry = { slot, name, at: i };
        for (const prev of prevs) pairs.push([prev, entry]);
        activeBySlot.set(slot, entry);
      }
      for (const [a, b] of pairs) {
        if (a.name !== b.name || a.name === zoroark.name) continue;
        if (sheet.members.filter(x => x.name === a.name).length !== 1) continue;
        const aImp = stayImpossibleForZoroark(lines, cur, a.at, side, sheet);
        const bImp = stayImpossibleForZoroark(lines, cur, b.at, side, sheet);
        if (aImp && !bImp && !autoSet.has(b.at)) { autoSet.add(b.at); moved = true; }
        else if (bImp && !aImp && !autoSet.has(a.at)) { autoSet.add(a.at); moved = true; }
      }
    }
  }
  const curLines = unmaskIllusion(lines, { [side]: sheet }, autoSet).lines;
  const open = candidates
    .filter(c => !autoSet.has(c.at) && !stayImpossibleForZoroark(lines, curLines, c.at, side, sheet))
    .map(x => ({ ...x, side, name: identName(String(lines[x.at] || '').split('|')[2]) }));
  const directValid = (forcedOnSide) => {
    const full = new Set([...autoSet, ...forcedOnSide]);
    const unmasked = unmaskIllusion(lines, { [side]: sheet }, full);
    return sideConsistent(lines, unmasked.lines, side, sheet, size, full);
  };
  return { autoForced: [...autoSet], open, valid: directValid, canExtend: directValid };
}

function analyseIllusion(lines, sheets) {
  const bySide = {
    p1: analyseIllusionSide(lines, sheets, 'p1'),
    p2: analyseIllusionSide(lines, sheets, 'p2'),
  };
  const sideMap = (ats) => {
    const out = { p1: new Set(), p2: new Set() };
    for (const at of ats || []) {
      const s = identSide(String(lines[at] || '').split('|')[2]);
      if (out[s]) out[s].add(at);
    }
    return out;
  };
  return {
    autoForced: [...bySide.p1.autoForced, ...bySide.p2.autoForced],
    open: [...bySide.p1.open, ...bySide.p2.open].sort((a, b) => a.at - b.at),
    valid(ats) {
      const m = sideMap(ats);
      return bySide.p1.valid(m.p1) && bySide.p2.valid(m.p2);
    },
    canExtend(ats) {
      const m = sideMap(ats);
      return bySide.p1.canExtend(m.p1) && bySide.p2.canExtend(m.p2);
    },
  };
}

function unmaskWithSheet(lines, sheets = null, forced = null) {
  if (!sheets) return unmaskIllusion(lines, null, forced);
  const analysis = analyseIllusion(lines, sheets);
  const fullForced = new Set([...(forced || []), ...analysis.autoForced]);
  return unmaskIllusion(lines, sheets, fullForced);
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
 * measured against the real input logs in `recordings/local/`:
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
  // A locked move is offered with NO target field at all (`sim/pokemon.ts:965`
  // returns just `{move, id}`), and naming a target for it is rejected outright:
  // the simulator reuses the target stored when the move was first chosen.
  if (!moveTarget || !CHOOSABLE_TARGETS.has(moveTarget)) return [''];

  // Naming no target is not an option in doubles: `sim/side.ts:663` rejects a
  // choosable-target move with no target outright. A recorded log CAN still
  // contain one - `getChoice()` omits a `targetLoc` of 0, which is what an
  // auto-chosen target leaves behind - and such a log is unreplayable through
  // no fault of ours. Detected and reported, not guessed.
  const doubles = side.active.length >= 2;
  // The user or its ally: Acupressure on a partner names the partner.
  if (moveTarget === 'adjacentAllyOrSelf') {
    const own = [` -${actorSlot + 1}`];
    const ally = doubles ? side.active[actorSlot === 0 ? 1 : 0] : null;
    if (ally && !ally.fainted) own.push(` -${actorSlot === 0 ? 2 : 1}`);
    return [...new Set([preferred, ...own].filter(o => o !== null && own.includes(o)))];
  }
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
 * The priority `battle` gives `pokemon` using `moveid` (`sim/battle.ts:2169`),
 * asked dry so no draw, item or log line moves.
 */
function movePriority(battle, pokemon, moveid) {
  const dex = battle.dex;
  let priority = dex.moves.get(moveid).priority;
  if (!pokemon) return priority;
  const st = battle.__rng;
  const prevDry = st?.dry;
  if (st) st.dry = prevDry || { roll: 0, draws: null };
  const savedLog = saveLog(battle);
  const savedItems = snapItems(battle.getAllActive());
  try {
    const move = dex.getActiveMove(moveid);
    priority = battle.singleEvent('ModifyPriority', move, null, pokemon, null, null, priority);
    priority = battle.runEvent('ModifyPriority', pokemon, null, move, priority);
    return priority;
  } finally {
    restoreItems(savedItems);
    savedLog();
    if (st) st.dry = prevDry;
  }
}

/** Conservative `[lo, hi, now]` priority interval for a move on `plan`'s turn. */
function priorityRange(battle, sideId, slotIndex, moveid, plan) {
  const sideObj = battle.sides[sideId === 'p1' ? 0 : 1];
  const pokemon = sideObj?.active[slotIndex] || null;
  const dex = battle.dex;
  const base = dex.moves.get(moveid).priority;
  const now = movePriority(battle, pokemon, moveid);
  const lo = Math.min(base, now);
  let hi = Math.max(base, now);
  const fieldMayShift = plan.megas.size > 0 || plan.switches.p1.some(Boolean) || plan.switches.p2.some(Boolean);
  if (fieldMayShift && dex.moves.get(moveid).onModifyPriority) hi = Math.max(hi, base + 1);
  if (pokemon && plan.megas.has(`${sideId}${'abc'[slotIndex]}`)) {
    const megaStone = dex.items.get(pokemon.item).megaStone;
    const megaSpecies = megaStone && Object.values(megaStone)[0];
    const megaAbility = megaSpecies ? dex.species.get(megaSpecies).abilities?.[0] : null;
    if (megaAbility && dex.abilities.get(megaAbility).onModifyPriority) hi = Math.max(hi, base + 3);
  }
  return [lo, hi, now];
}

/**
 * The choice string for one side's current request.
 *
 * Everything legal is read off the live request. Nothing is read off the set's
 * movelist: legality is dynamic, and a locked or disabled
 * move is offered or withheld by the simulator, not by us.
 */
function choiceFor(side, plan, state, notes) {
  const request = side.activeRequest;
  const sideId = side.id;

  if (request.teamPreview) {
    const bench = request.side.pokemon.map(p => identName(p.ident));
    // Illusion copies the last Pokemon brought that has not fainted, so one it
    // was shown as goes last - unless it led. Shown as two, the second stood
    // before the first, which had fainted - or a switch moved them: their order
    // is a hidden choice too, the one seen last first.
    const leads = side.active.length;
    const last = (state.disguises?.[sideId] || [])
      .filter(name => !state.reveal[sideId].slice(0, leads).includes(name))
      .map(name => bench.indexOf(name))
      .filter(at => at >= 0);
    const seen = [];
    for (const name of state.reveal[sideId]) {
      const at = bench.indexOf(name);
      if (at >= 0 && !seen.includes(at) && !last.includes(at)) seen.push(at);
    }
    // The leads are the first seen. Who else was brought, and in what order
    // they stand behind the leads, the replay never shows - a move that reads
    // the back of the party, Beat Up, shows only what it read - so it is a
    // hidden choice: those seen there, and the rest from the sheet, in every
    // order. The first is the order they were seen in, then the sheet's.
    const front = seen.slice(0, leads);
    const known = seen.slice(leads);
    const room = Math.max(0, state.sizes[sideId] - last.length - front.length);
    const pool = bench.map((_, i) => i).filter(i => !seen.includes(i) && !last.includes(i));
    const options = [];
    const seenOrders = new Set();
    const addOrder = (back, chosen, ends) => {
      const key = [...back, ...ends].join(',');
      if (seenOrders.has(key)) return;
      seenOrders.add(key);
      options.push({ back, chosen, ends });
    };
    const lastOrders = permutations(last.slice().reverse());
    for (const chosen of combinations(pool, Math.max(0, room - known.length))) {
      for (const back of permutations([...known, ...chosen])) {
        for (const ends of lastOrders) addOrder(back, chosen, ends);
      }
      if (last.length) {
        for (const full of permutations([...known, ...chosen, ...last])) addOrder(full, chosen, []);
      }
    }
    if (state.sheets?.[sideId] && state.unmaskedLines) {
      const fits = [];
      const rest = [];
      for (const opt of options) {
        const names = [...front, ...opt.back, ...opt.ends].slice(0, state.sizes[sideId]).map(at => bench[at]);
        if (partyMatchesDisguises(names, state.unmaskedLines, state.rawLines, sideId, state.sheets[sideId])) fits.push(opt);
        else rest.push(opt);
      }
      options.splice(0, options.length, ...fits, ...rest);
    }
    const { back, chosen, ends } = options.length > 1 ? options[state.nextVariantDigit(options.length, true)] : options[0];
    for (const i of chosen) notes.push(`${sideId} brought a Pokemon that never appeared - assumed ${bench[i]}`);
    const order = [...front, ...back, ...ends].map(at => at + 1);
    return `team ${order.slice(0, state.sizes[sideId]).join(', ')}`;
  }

  if (request.forceSwitch) {
    const pokemon = request.side.pokemon;
    const queue = state.forced[sideId];
    const used = new Set();
    let passesLeft = Math.max(0, request.forceSwitch.filter(Boolean).length - side.battle.canSwitch(side));
    return request.forceSwitch.map((needed, i) => {
      if (!needed) return 'pass';
      const reviving = !!side.slotConditions[i]?.revivalblessing;
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
        if (!reviving && passesLeft > 0) passesLeft--;
        return 'pass';
      }
      const entry = queue[at];
      const to = pokemon.findIndex((p, idx) => !used.has(idx) && identName(p.ident) === entry.name
        && (reviving ? p.condition.endsWith(' fnt') : !p.active && !p.condition.endsWith(' fnt')));
      if (to < 0) {
        // When both an unfainted pivot (Emergency Exit, Eject Pack) and a
        // fainted slot must switch at once with fewer bench Pokemon left than
        // switching slots, the simulator requires `pass` now and raises a
        // second forceSwitch once the pivot reaches the bench.
        const deferrable = !reviving && passesLeft > 0 && pokemon.some((p, idx) =>
          idx !== i && p.active && !p.condition.endsWith(' fnt') && request.forceSwitch[idx]
          && identName(p.ident) === entry.name
          && (idx < i ? used.size > 0 : queue.some((e, q) => q !== at && (e.slot === idx || e.slot === undefined))));
        if (deferrable) {
          passesLeft--;
          return 'pass';
        }
        queue.splice(at, 1);
        const deadBench = !reviving ? pokemon.findIndex((p, idx) => !used.has(idx) && !p.active && identName(p.ident) === entry.name) : -1;
        if (deadBench >= 0) {
          used.add(deadBench);
          return `switch ${deadBench + 1}`;
        }
        state.unsatisfied = `${sideId} switched in ${entry.name}, which is not on the bench`;
        return 'pass';
      }
      queue.splice(at, 1);
      used.add(to);
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

    if (!action || action.encored) {
      // Nothing executed for this slot - it fainted before acting, was flinched
      // or fully paralysed, or the battle ended before its action ran - or
      // Encore replaced what it chose before it moved. Which legal move and
      // target was chosen is a search variable; moves whose priority fits the
      // turn's action order and any recovered charging move come first.
      notes.push(`${sideId} slot ${i + 1} made an invisible choice - substituted a legal move`);
      state.invisible = true;
      const battle = side.battle;
      const order = plan.order || [];
      const reordered = new Set(plan.reordered || []);
      const ownKey = `${sideId}:${i}`;
      const at = order.findIndex(e => e.side === sideId && e.slot === i);
      const pos = at < 0 ? order.length : at;
      let minPrio = -Infinity;
      let maxPrio = Infinity;
      if (!reordered.has(ownKey)) {
        for (const e of order.slice(0, pos)) {
          if (e.kind !== 'move' || reordered.has(`${e.side}:${e.slot}`)) continue;
          maxPrio = Math.min(maxPrio, priorityRange(battle, e.side, e.slot, e.moveid, plan)[1]);
        }
        if (order[pos]?.kind === 'cant') {
          for (const e of order.slice(pos + 1)) {
            if (e.kind !== 'move' || reordered.has(`${e.side}:${e.slot}`)) continue;
            minPrio = Math.max(minPrio, priorityRange(battle, e.side, e.slot, e.moveid, plan)[0]);
          }
        }
        if (minPrio > maxPrio) { minPrio = -Infinity; maxPrio = Infinity; }
      }
      const loc = action?.recovered && action.target ? targetLoc(sideId, i, action.target) : null;
      const preferred = loc === null ? null : ` ${loc > 0 ? '+' : ''}${loc}`;
      const usable = slot.moves
        .map((m, j) => {
          const [lo, hi, prio] = priorityRange(battle, sideId, i, m.id, plan);
          const miss = hi < minPrio ? minPrio - hi : lo > maxPrio ? lo - maxPrio : 0;
          return { ...m, j, prio, miss };
        })
        .filter(m => !m.disabled)
        .sort((a, b) => a.miss - b.miss
          || (action?.recovered ? Number(b.id === action.moveid) - Number(a.id === action.moveid) : 0)
          || Math.abs(a.prio) - Math.abs(b.prio)
          || state.selfSwitchLast(a, b)
          || a.j - b.j);
      const options = [];
      for (const m of usable) {
        const pref = preferred && (!side.active[i] || battle.validTargetLoc(loc, side.active[i], m.target)) ? preferred : null;
        for (const suffix of targetOptions(side, i, m.target, pref)) {
          options.push({ str: `move ${m.j + 1}${suffix}${mega}`, prio: m.prio, miss: m.miss });
        }
      }
      if (!options.length) return 'pass';
      const picked = options[state.nextVariantDigit(options.length, true)];
      state.invisiblePrios.push({ key: ownKey, prio: picked.prio, miss: picked.miss });
      return picked.str;
    }

    const at = slot.moves.findIndex(m => m.id === action.moveid);
    // Imprison disables a foe's moves without telling its player: the request
    // still offers them, and choosing one makes the Pokemon Struggle.
    // The choice is read before it is turned into Struggle, so a move that
    // takes a target is written with one.
    if (at < 0 && action.moveid === 'struggle' && slot.moves.length) return `move 1${targetOptions(side, i, slot.moves[0].target)[0]}${mega}`;
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

/**
 * The input line that ends the battle the way the observed one ended, when no
 * Pokemon decided it: a forfeit or the timer leaves `|win|` (or `|tie`) as the
 * last line while the simulator is still waiting for choices. The room's own
 * announcement is filtered by `battleLines`; the recipe says `>forcelose`.
 * `|player|` is room noise wherever it appears - a Bo3 room re-issues it after
 * `|win|` while it waits for the next game - so it never ends a battle.
 */
function forcedEnding(segment, sides) {
  const lines = battleLines(segment).filter(l => !l.startsWith('|player|'));
  const last = lines[lines.length - 1] || '';
  if (last === '|tie') return '>forcetie';
  const won = /^\|win\|(.*)$/.exec(last);
  const loser = won && sides.find(s => s.name !== won[1]);
  return loser ? `>forcelose ${loser.id}` : null;
}

/**
 * The lines a raw log slice shows on one channel. A prefix slice cut inside an
 * unfinished `|split|p[1-4]` triplet drops the incomplete split so
 * `extractChannelMessages` never emits the raw `|split|` header or secret half.
 */
function onChannel(raw, channel) {
  let end = raw.length;
  if (end >= 1 && /^\|split\|p[1-4]$/.test(raw[end - 1])) end -= 1;
  else if (end >= 2 && /^\|split\|p[1-4]$/.test(raw[end - 2])) end -= 2;
  const slice = end === raw.length ? raw : raw.slice(0, end);
  return extractChannelMessages(slice.join('\n'), [channel])[channel];
}

// ------------------------------------------------- HP displays and dry runs

/** The failing turn's hidden choices a die that decides it later is judged under. */
const MAX_OUTCOMES = 4;
/** Backtracks to a die that brings a failing non-HP line closer, per rebuild. */
export const DIE_BACKTRACKS = 4;
/** Combinations of a turn's invisible choices walked, per turn. */
export const MAX_VARIANTS = 256;

/** A damage roll has sixteen faces; face 0 is full damage. */
export const ROLLS = 16;

/**
 * An HP display as a number that only ever grows with HP, so the values behind
 * one display form a single interval. Champions shades `20/100` and `50/100` by
 * which side of the fifth or the half they fall (`sim/pokemon.ts:2070`).
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

/**
 * A copy of an in-flight move that a dry run may change freely. Plain data on
 * it is copied; the simulator's own entries - abilities, items, conditions,
 * species, all frozen - and live objects such as a Pokemon are shared, because
 * handlers compare them by identity (`move.typeChangerBoosted === this.effect`).
 */
export function cloneMove(move) {
  const out = Object.create(Object.getPrototypeOf(move));
  for (const key of Object.keys(move)) out[key] = copyData(move[key]);
  return out;
}

function copyData(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return value.map(copyData);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = copyData(value[key]);
  return out;
}

/** Hand a move back the fields a `cloneMove` snapshot of it had. */
export function restoreMove(move, snap) {
  for (const key of Object.keys(move)) if (!(key in snap)) delete move[key];
  for (const key of Object.keys(snap)) move[key] = copyData(snap[key]);
}

/**
 * Run `fn` and hand back the dice it threw, as the RNG engine's trace rows. A
 * battle already tracing keeps every row where it was written.
 */
export function withDice(st, fn) {
  if (st.trace) {
    const start = st.trace.length;
    const value = fn();
    return { value, thrown: st.trace.slice(start) };
  }
  st.trace = [];
  try {
    const value = fn();
    return { value, thrown: st.trace };
  } finally {
    st.trace = null;
  }
}

/**
 * The battle log as a dry run found it. Lines are only ever appended, except
 * the last move line, which `attrLastMove` extends in place - Fickle Beam's
 * `[anim]` tag.
 */
export function saveLog(battle) {
  const length = battle.log.length;
  const at = battle.lastMoveLine;
  const line = battle.log[at];
  return () => {
    battle.log.length = length;
    battle.lastMoveLine = at;
    if (at >= 0 && at < length) battle.log[at] = line;
  };
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
  for (const { i, from, to, value, mark, at, chance } of trace || []) {
    if (mark !== seg || from < 0) continue;
    const lo = to < 0 ? 0 : from;
    const hi = (to < 0 ? from : to) - 1;
    if (hi <= lo) continue;
    rows.push({ i, lo, hi, value, at, chance: !!chance });
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
function candidates({ i, lo, hi, value, chance }, steer = null, wide = false) {
  const fits = steer?.get(i);
  if (fits) return fits.reps;
  const span = hi - lo + 1;
  // A wide die is tried at both ends, which settle a chance. Asked for `wide`,
  // one that is no chance is tried at eighths between them too: a die cut into
  // bands - Effect Spore's sleep, paralysis or poison out of a hundred - needs
  // a face inside each band.
  const all = span <= 16 ? Array.from({ length: span }, (_, k) => lo + k)
    : !wide || chance ? [lo, hi]
      : [...new Set([lo, hi, ...Array.from({ length: 7 }, (_, k) => lo + Math.round((span - 1) * (k + 1) / 8))])];
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
  let provedUpTo = 0;
  const known = exact?.get(k);
  if (known) {
    const proved = hard(known.lines);
    const gotExact = hard(onChannel(slice, -1));
    wantHard = known.partial ? [...proved, ...wantHard.slice(proved.length)] : proved;
    gotHard = known.partial ? [...gotExact.slice(0, proved.length), ...gotHard.slice(proved.length)] : gotExact;
    exactUpTo = known.partial ? proved.length : Infinity;
    provedUpTo = known.proved === undefined ? exactUpTo : hard(known.lines.slice(0, known.proved)).length;
  }
  return { wantHard, gotHard, exactUpTo, provedUpTo };
}

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
 * The crit die, each target's accuracy die and an unchosen move target's
 * `getRandomTarget` die are read the same way: the observed turn shows a
 * `|-crit|` or `|-miss|` for the target or it does not, and names the target
 * `|move|` wrote.
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
  let frame = null;
  const origRandomizer = battle.randomizer;
  battle.randomizer = function (base) {
    if (draws && !st.dry) draws.push(st.draws);
    return origRandomizer.call(this, base);
  };

  // Any die but the damage roll takes the face the real calculation's die of
  // the same range took (`thrown`).
  const dry = (fn, roll, thrown = null) => {
    const undo = override(battle, 'random', (m, n) => (m === 16 && n === undefined ? roll : (n === undefined ? 0 : m)));
    const prevDry = st.dry;
    st.dry = { roll, draws: thrown ? thrown.map(d => ({ ...d, used: false })) : null };
    const saved = {
      log: saveLog(battle), faints: battle.faintQueue.length, move: battle.activeMove,
      target: battle.activeTarget, user: battle.activePokemon, lastDamage: battle.lastDamage,
    };
    try {
      return fn();
    } finally {
      saved.log();
      battle.faintQueue.length = saved.faints;
      battle.activeMove = saved.move;
      battle.activeTarget = saved.target;
      battle.activePokemon = saved.user;
      battle.lastDamage = saved.lastDamage;
      st.dry = prevDry;
      undo();
    }
  };

  // A target that hit where the observed turn missed it, or a multi-hit loop
  // past the observed hit count, has not yet written the line that disagrees -
  // `spreadDamage` and `-hitcount` come after `getDamage` - so the log alone
  // still looks right while every draw after it is thrown for a hit that never
  // happened, at an ordinal the real turn gave to a later draw.
  let diverged = false;
  let counting = null;

  /**
   * The observed lines still to come in this action, or null if the rebuilt
   * turn already disagrees with the observed one.
   */
  function standing() {
    if (diverged || (counting?.want != null && battle.activeMove?.hit > counting.want)) {
      diverged = true;
      return null;
    }
    const { wantHard, gotHard, exactUpTo } = compare(at.k, battle.log.slice(at.logAt));
    // The move in flight has not had its `[spread]`, `[miss]` or `[still]`
    // appended yet (`attrLastMove`), so its line is only a prefix of the one
    // it will become. A spread move whose random display target has not been
    // flipped yet differs only in that slot while it is in flight.
    let moving = -1;
    for (let i = gotHard.length - 1; i >= 0 && moving < 0; i--) if (/^\|(move|-anim)\|/.test(gotHard[i])) moving = i;
    for (let i = 0; i < gotHard.length; i++) {
      if (gotHard[i] === wantHard[i]) continue;
      if (i === moving || (frame?.retarget && i === frame.retarget.at)) {
        let head = gotHard[i];
        if (frame?.retarget && i === frame.retarget.at) {
          const parts = head.split('|');
          if (parts[4] === frame.retarget.from) {
            parts[4] = frame.retarget.to;
            head = parts.join('|');
          }
        }
        if (head === wantHard[i] || (i === moving && String(wantHard[i]).startsWith(`${head}|`))) continue;
      }
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
      if (parts[2] !== ident) continue;
      if (parts[1] === '-crit') crit = true;
      if ((parts[1] === '-end' && parts[3] === 'Substitute')
        || (parts[1] === '-activate' && parts[3] === 'move: Substitute' && parts[4] === '[damage]')) break;
      if (parts[1] === '-damage' && parts.length === 4) line = i;
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

  function bracket(source, target, move, clone, items, seen, current, real, thrown) {
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
    // A hit through its target's Protect is quartered by the hit data the
    // hit step wrote before any damage; the dry copies keep that, and only that.
    const bypassProtect = move.moveHitData?.[target.getSlot()]?.bypassProtect;
    const through = bypassProtect ? { [target.getSlot()]: { crit: false, typeMod: 0, bypassProtect } } : undefined;
    const shown = new Map();
    const dealt = new Map();
    const printed = (r) => {
      if (shown.has(r)) return shown.get(r);
      let token = null;
      let left = null;
      const post = snapItems([source, target]);
      try {
        // A fresh copy each time, so no dry run sees another's changes.
        let x = dry(() => {
          restoreItems(items);
          const copy = cloneMove(clone);
          copy.moveHitData = through;
          return origGetDamage.call(actions, source, target, copy, true);
        }, r, thrown);
        dealt.set(r, x);
        if (typeof x === 'number') {
          if (x !== 0) x = Math.max(1, x);
          if (x >= h) {
            const raw = x;
            x = dry(() => { restoreItems(post); return battle.runEvent('Damage', target, source, move, x, true); }, r);
            if (typeof x === 'number' && x !== 0) x = Math.max(1, x);
            if (x !== raw) caught.add(r);
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
    // Rolls a Damage handler changed - a Focus Sash, a Sturdy, an Endure
    // holding the target at 1 HP - leave it where a roll that dealt exactly
    // that much leaves it too, but only they spend what held it.
    const caught = new Set();
    const after = r => `${hpAfter.get(r)}${caught.has(r) ? '!' : ''}`;
    const rankAt = (r) => {
      const token = printed(r);
      const rank = token === null ? undefined : hpRank(token.split(' ')[0], secret)?.rank;
      if (rank === undefined) throw new Error('unranked');
      return rank;
    };
    try {
      // The dry calculation stands in for the real one only if, on the roll the
      // real one took, it deals what the real one dealt.
      printed(current);
      if (dealt.get(current) !== real) return null;
      let lo = 0;
      let hi = ROLLS;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rankAt(mid) < wantRank) lo = mid + 1; else hi = mid; }
      if (lo === ROLLS || rankAt(lo) !== wantRank) return none(true);
      const first = lo;
      hi = ROLLS - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rankAt(mid) > wantRank) hi = mid - 1; else lo = mid; }
      const fits = [];
      for (let r = first; r <= lo; r++) if (printed(r) === want) fits.push(r);
      // Two rolls that leave the target on the same exact HP, the same way,
      // dealt the same damage, so everything after plays out the same: one of
      // them is probed for all, and none for the one the run already threw.
      printed(current);
      const groups = new Map();
      for (const r of fits) {
        if (after(r) === after(current)) continue;
        const rep = [...groups.keys()].find(k => after(k) === after(r));
        if (rep === undefined) groups.set(r, [r]); else groups.get(rep).push(r);
      }
      return { reps: [...groups.keys()], groups, wrong: !fits.includes(current) };
    } catch {
      return null;
    }
  }

  // The observed lines belonging to the hit that just dealt damage, stopping
  // before the next strike of a multi-hit move.
  const NEXT_HIT = new Set(['-anim', '-supereffective', '-resisted', '-crit', '-hitcount']);
  const hitSlice = (now) => {
    let end = now.from;
    while (end < now.end) {
      const parts = now.wantHard[end].split('|');
      if (NEXT_HIT.has(parts[1]) || (parts[1] === '-damage' && parts.length === 4)) break;
      end++;
    }
    return now.wantHard.slice(now.from, end);
  };

  // Whether `ident` flinched on its action later in this turn, or null when the
  // log never reached its flinch check or another hit landed before it flinched.
  function flinchOutcome(now, ident) {
    let hitAgain = false;
    let moving = null;
    for (let i = now.end; i < now.wantHard.length; i++) {
      const line = now.wantHard[i];
      const parts = line.split('|');
      const k = parts[1];
      if (k === 'upkeep' || k === 'turn') return null;
      if (k === 'move') moving = parts[2];
      else if (ACTION_START.has(k)) moving = null;
      if ((k === '-damage' && parts.length === 4 && parts[2] === ident && moving && moving !== ident)
        || (k === '-activate' && parts[2] === ident && parts[3] === 'move: Substitute' && parts[4] === '[damage]')
        || (k === '-end' && parts[2] === ident && parts[3] === 'Substitute')) {
        hitAgain = true;
      }
      if (parts[2] !== ident) continue;
      if (k === 'faint' || k === 'drag' || k === 'switch' || k === 'replace') return null;
      if (k === 'cant') {
        if (tagsOf(line).of) continue;
        if (parts[3] === 'flinch') return hitAgain ? null : true;
        if (parts[3] === 'slp' || parts[3] === 'frz' || (parts[3] || '').startsWith('ability:')) return null;
        return false;
      }
      if (k === 'move') {
        const from = tagsOf(line).from;
        if (!from || from === 'lockedmove') return false;
      }
      if (k === '-activate' && (parts[3] === 'confusion' || parts[3] === 'move: Attract')) return false;
    }
    return null;
  }

  // The crit is the one chance `getDamage` takes before it rolls damage; the
  // accuracy step takes one per target, with that target active; pre-action
  // priority, contact abilities and status checks before a move take their own.
  let chances = null;
  let aiming = null;
  let fracRolls = null;
  let hitRolls = null;
  const origChance = battle.randomChance;
  battle.randomChance = function (n, d) {
    if (!st.dry) {
      if (chances && !draws.length) chances.push({ i: st.draws, n, d });
      else if (aiming) aiming.push({ i: st.draws, n, d, target: battle.activeTarget });
      else if (at.k === turn && fracRolls && battle.event?.id === 'FractionalPriority') {
        fracRolls.push({ i: st.draws, n, d, eff: battle.effect, holder: battle.effectState?.target });
      } else if (at.k === turn && hitRolls && battle.event?.id === 'DamagingHit' && battle.effect?.effectType === 'Ability') {
        const holder = battle.effectState?.target;
        const victim = holder === battle.event.target ? battle.event.source : battle.event.target;
        hitRolls.push({ i: st.draws, n, d, eff: battle.effect, holder, victim });
      } else if (at.k === turn && battle.event?.id === 'BeforeMove') {
        const ord = st.draws;
        const now = standing();
        const holder = battle.effectState?.target;
        const eff = battle.effect;
        const res = origChance.call(this, n, d);
        if (now && holder && eff) {
          const ident = String(holder);
          const next = now.wantHard[now.from] || '';
          const slice = now.wantHard.slice(now.from, now.end);
          let want = null;
          if (eff.id === 'par' || eff.id === 'attract') {
            const cant = `|cant|${ident}|${eff.id === 'par' ? 'par' : eff.name}`;
            if (next === cant) want = true;
            else if (next.startsWith(`|move|${ident}|`) || next.startsWith(`|cant|${ident}|`) || next.startsWith(`|-activate|${ident}|`)) want = false;
          } else if (eff.id === 'frz') {
            if (next.startsWith(`|-curestatus|${ident}|frz`)) want = true;
            else if (next === `|cant|${ident}|frz`) want = false;
          } else if (eff.id === 'confusion') {
            want = slice.some(l => l.startsWith(`|-damage|${ident}|`) && tagsOf(l).from === 'confusion');
          }
          if (want !== null) {
            const entry = chanceEntry({ i: ord, n, d }, want);
            if (entry) out.set(ord, entry);
          }
        }
        return res;
      }
    }
    return origChance.call(this, n, d);
  };

  let secondaryScope = null;
  const origRunEvent = battle.runEvent;
  battle.runEvent = function (eventid, target, source, sourceEffect, relayVar, onEffect, fastExit) {
    if (at.k === turn && !st.dry) {
      if (eventid === 'ModifySecondaries' && secondaryScope && !secondaryScope.inHit) {
        const list = origRunEvent.call(this, eventid, target, source, sourceEffect, relayVar, onEffect, fastExit);
        if (Array.isArray(list)) {
          for (const sec of list) {
            const rec = { target, source, sec, self: false, roll: null, sample: null, emitted: [], hadFlinch: false, gotFlinch: false, willMove: false };
            secondaryScope.pending.push(rec);
            secondaryScope.records.push(rec);
          }
        }
        return list;
      }
      if (eventid === 'FractionalPriority' && !fracRolls) {
        const now = standing();
        const rolls = [];
        fracRolls = rolls;
        try {
          return origRunEvent.call(this, eventid, target, source, sourceEffect, relayVar, onEffect, fastExit);
        } finally {
          fracRolls = null;
          if (now) {
            const slice = now.wantHard.slice(now.from, now.end);
            for (const roll of rolls) {
              if (!roll.holder || (roll.eff?.effectType !== 'Ability' && roll.eff?.effectType !== 'Item')) continue;
              const prefix = roll.eff.effectType === 'Ability' ? 'ability' : 'item';
              const entry = chanceEntry(roll, slice.includes(`|-activate|${roll.holder}|${prefix}: ${roll.eff.name}`));
              if (entry) out.set(roll.i, entry);
            }
          }
        }
      }
      if (eventid === 'DamagingHit' && !hitRolls) {
        const now = standing();
        const slice = now ? hitSlice(now) : null;
        const logStart = battle.log.length;
        const rolls = [];
        hitRolls = rolls;
        try {
          return origRunEvent.call(this, eventid, target, source, sourceEffect, relayVar, onEffect, fastExit);
        } finally {
          hitRolls = null;
          if (now && slice && rolls.length) {
            const emitted = battleLines(onChannel(battle.log.slice(logStart), channel));
            for (const roll of rolls) {
              const face = faceOf(roll.i);
              if (face === undefined || !roll.holder || !roll.victim) continue;
              const hasProc = lines => lines.some(l =>
                l.split('|')[2] === String(roll.victim) && tagsOf(l).from === `ability: ${roll.eff.name}` && tagsOf(l).of === String(roll.holder));
              if (face < roll.n && !hasProc(emitted)) out.set(roll.i, none(false));
              else {
                const entry = chanceEntry(roll, hasProc(slice));
                if (entry) out.set(roll.i, entry);
              }
            }
          }
        }
      }
    }
    return origRunEvent.call(this, eventid, target, source, sourceEffect, relayVar, onEffect, fastExit);
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
        const missed = (target) => {
          const line = `|-miss|${pokemon}|${target}`;
          for (let i = now.from; i < now.end; i++) if (now.wantHard[i] === line) return true;
          return false;
        };
        for (const roll of rolls) {
          const want = !missed(roll.target);
          const entry = chanceEntry(roll, want);
          if (entry) out.set(roll.i, { ...entry, accuracy: true, shifts: entry.wrong });
          const face = faceOf(roll.i);
          if (face !== undefined && (face < roll.n) !== want) diverged = true;
        }
        for (const target of targets) {
          if (missed(target) && !rolls.some(r => r.target === target)) diverged = true;
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
    const clone = cloneMove(move);
    const items = snapItems([source, target]);
    const got = [];
    const rolled = [];
    draws = got;
    chances = rolled;
    let real;
    let thrown;
    try {
      ({ value: real, thrown } = withDice(st, () => origGetDamage.call(this, source, target, move, suppress)));
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
    const fits = bracket(source, target, move, clone, items, seen, current, real, thrown);
    if (fits) out.set(got[0], fits);
    return real;
  };

  function steerSecondary(cur, now, slice) {
    const face = cur.roll === null ? undefined : faceOf(cur.roll);
    if (face === undefined) return;
    const chance = cur.sec.chance;
    if (chance === undefined || chance >= 100) out.set(cur.roll, none(false));
    if (!now || !slice) return;
    const recipient = cur.self || cur.sec.self ? cur.source : cur.target;
    if (!recipient || !recipient.hp) {
      out.set(cur.roll, none(false));
      return;
    }
    const ident = String(recipient);
    const procced = chance === undefined || face < chance;
    const moveStatusOf = (lines) => {
      for (const l of lines) {
        const p = l.split('|');
        if (p[1] !== '-status' || p[2] !== ident) continue;
        const from = tagsOf(l).from || '';
        if (!from || from.startsWith('move:')) return p[3];
      }
      return null;
    };
    const boosts = cur.sec.boosts || cur.sec.self?.boosts;
    if (cur.sec.status && !boosts && !cur.sec.volatileStatus && !cur.sec.onHit) {
      if (chance !== undefined && chance < 100) {
        const want = moveStatusOf(slice) === cur.sec.status;
        if (procced && moveStatusOf(cur.emitted) !== cur.sec.status) out.set(cur.roll, none(false));
        else {
          const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, want);
          if (entry) out.set(cur.roll, entry);
        }
      }
    } else if (cur.sec.volatileStatus === 'flinch' && !cur.sec.status && !boosts && !cur.sec.onHit) {
      if (chance !== undefined && chance < 100) {
        if (!cur.willMove || cur.hadFlinch || (procced && !cur.gotFlinch)) out.set(cur.roll, none(false));
        else {
          const want = flinchOutcome(now, ident);
          if (want !== null) {
            const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, want);
            if (entry) out.set(cur.roll, entry);
          }
        }
      }
    } else if (cur.sec.volatileStatus === 'confusion' && !cur.sec.status && !boosts && !cur.sec.onHit) {
      if (chance !== undefined && chance < 100) {
        const hasConf = lines => lines.some((l) => {
          const p = l.split('|');
          const from = tagsOf(l).from || '';
          return p[1] === '-start' && p[2] === ident && p[3] === 'confusion' && !from.startsWith('ability:') && !l.includes('[fatigue]');
        });
        if (procced && !hasConf(cur.emitted)) out.set(cur.roll, none(false));
        else {
          const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, hasConf(slice));
          if (entry) out.set(cur.roll, entry);
        }
      }
    } else if (boosts && !cur.sec.status && !cur.sec.volatileStatus && !cur.sec.onHit) {
      if (chance !== undefined && chance < 100) {
        const stats = Object.keys(boosts);
        const hasBoost = (lines) => {
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const p = l.split('|');
            if (p[2] === ident && (p[1] === '-boost' || p[1] === '-unboost') && stats.includes(p[3]) && !tagsOf(l).from) {
              const prev = lines[i - 1]?.split('|');
              if (!(prev && prev[1] === '-ability')) return true;
            }
            if (p[1] === '-fail' && p[2] === ident && p[3] === 'unboost') return true;
            if (tagsOf(l).of === ident && (p[1] === '-boost' || p[1] === '-unboost' || p[1] === '-fail' || p[1] === '-block')) return true;
            if (p[1] === '-ability' && p[2] === ident && battle.dex.abilities.get(p[3]).onTryBoost) {
              const next = lines[i + 1]?.split('|');
              if (next && next[2] !== ident && (((next[1] === '-boost' || next[1] === '-unboost') && stats.includes(next[3]))
                || (next[1] === '-fail' && next[3] === 'unboost') || next[1] === '-block' || next[1] === '-ability')) return true;
            }
          }
          return false;
        };
        if (procced) {
          if (!cur.emitted.length) out.set(cur.roll, none(false));
          else if (!slice.includes(cur.emitted[0])) {
            const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, false);
            if (entry) out.set(cur.roll, entry);
          } else if (cur.emitted.every(l => slice.includes(l))) {
            out.set(cur.roll, none(false));
          }
        } else {
          const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, hasBoost(slice));
          if (entry) out.set(cur.roll, entry);
        }
      }
    } else if (cur.sec.onHit) {
      const wantStatus = moveStatusOf(slice);
      if (cur.sample) {
        const sFace = faceOf(cur.sample.i);
        if (sFace !== undefined && wantStatus && cur.sample.items.includes(wantStatus)) {
          const wantIdx = cur.sample.items.indexOf(wantStatus);
          out.set(cur.sample.i, { reps: sFace === wantIdx ? [] : [wantIdx], groups: new Map(), wrong: sFace !== wantIdx });
          if (chance !== undefined && chance < 100) out.set(cur.roll, none(false));
        } else if (chance !== undefined && chance < 100 && !wantStatus && cur.emitted.length) {
          const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, false);
          if (entry) out.set(cur.roll, entry);
        }
      } else if (chance !== undefined && chance < 100 && !procced && wantStatus) {
        const entry = chanceEntry({ i: cur.roll, n: chance, d: 100 }, true);
        if (entry) out.set(cur.roll, entry);
      }
    }
  }

  const origMoveHit = actions.moveHit;
  actions.moveHit = function (targets, pokemon, moveOrMoveName, moveData, isSecondary, isSelf) {
    if (secondaryScope && (isSecondary || isSelf) && moveData === secondaryScope.current?.sec && !secondaryScope.inHit) {
      const cur = secondaryScope.current;
      const logStart = battle.log.length;
      secondaryScope.inHit = true;
      try {
        return origMoveHit.call(this, targets, pokemon, moveOrMoveName, moveData, isSecondary, isSelf);
      } finally {
        secondaryScope.inHit = false;
        cur.gotFlinch = !!cur.target?.volatiles?.flinch;
        cur.emitted = battleLines(onChannel(battle.log.slice(logStart), channel));
      }
    }
    return origMoveHit.call(this, targets, pokemon, moveOrMoveName, moveData, isSecondary, isSelf);
  };

  const origSecondaries = actions.secondaries;
  actions.secondaries = function (targets, source, move, moveData, isSelf) {
    if (at.k !== turn || st.dry || secondaryScope || !moveData?.secondaries) {
      return origSecondaries.call(this, targets, source, move, moveData, isSelf);
    }
    const now = standing();
    const slice = now ? hitSlice(now) : null;
    const scope = { pending: [], records: [], current: null, inHit: false };
    secondaryScope = scope;
    try {
      return origSecondaries.call(this, targets, source, move, moveData, isSelf);
    } finally {
      secondaryScope = null;
      for (const cur of scope.records) steerSecondary(cur, now, slice);
    }
  };

  const origSelfDrops = actions.selfDrops;
  actions.selfDrops = function (targets, source, move, moveData, isSecondary) {
    if (at.k !== turn || st.dry || secondaryScope || isSecondary || !moveData?.self?.boosts || move.selfDropped) {
      return origSelfDrops.call(this, targets, source, move, moveData, isSecondary);
    }
    const now = standing();
    const slice = now ? hitSlice(now) : null;
    const pending = [];
    for (const target of targets) {
      if (target === false) continue;
      pending.push({ target: source, source, sec: moveData.self, self: true, roll: null, sample: null, emitted: [], hadFlinch: false, gotFlinch: false, willMove: false });
      if (!move.multihit) break;
    }
    const scope = { pending, records: pending.slice(), current: null, inHit: false };
    secondaryScope = scope;
    try {
      return origSelfDrops.call(this, targets, source, move, moveData, isSecondary);
    } finally {
      secondaryScope = null;
      for (const cur of scope.records) steerSecondary(cur, now, slice);
    }
  };

  // A move that hits a number of times drawn from a range throws that number
  // first, before its first hit; the observed turn's `|-hitcount|` for its
  // target says which faces of that die print it. Loaded Dice throws another
  // die after a low count, so its holder's count is searched in full.
  let samplingTarget = null;
  const origSample = battle.sample;
  battle.sample = function (items) {
    if (!st.dry) {
      if (counting && counting.i === null) Object.assign(counting, { i: st.draws, faces: items });
      else if (samplingTarget && samplingTarget.i === null && Array.isArray(items) && items.length > 1) {
        Object.assign(samplingTarget, { i: st.draws, items: items.slice() });
      } else if (secondaryScope?.inHit && secondaryScope.current && !secondaryScope.current.sample && Array.isArray(items) && items.every(x => typeof x === 'string')) {
        secondaryScope.current.sample = { i: st.draws, items: items.slice() };
      }
    }
    return origSample.call(this, items);
  };
  const origRandom = battle.random;
  battle.random = function (m, n) {
    if (!st.dry) {
      if (counting && counting.i === null && n !== undefined) {
        Object.assign(counting, { i: st.draws, faces: Array.from({ length: n - m }, (_, f) => m + f), off: m });
      } else if (secondaryScope && !secondaryScope.inHit && m === 100 && n === undefined && secondaryScope.pending.length) {
        const cur = secondaryScope.pending.shift();
        cur.roll = st.draws;
        cur.hadFlinch = !!cur.target?.volatiles?.flinch;
        cur.willMove = !!cur.target && !!battle.queue.willMove(cur.target);
        secondaryScope.current = cur;
      }
    }
    return origRandom.call(this, m, n);
  };
  const origHitLoop = actions.hitStepMoveHitLoop;
  actions.hitStepMoveHitLoop = function (targets, pokemon, move) {
    if (at.k !== turn || st.dry || !move.multihit || typeof move.smartTarget === 'boolean') {
      return origHitLoop.call(this, targets, pokemon, move);
    }
    const now = standing();
    const target0 = targets[0];
    const targetNames = new Set([String(target0), target0?.fullname, `${target0?.side?.id}: ${identName(String(target0))}`].filter(Boolean));
    let want = null;
    for (let i = now ? now.from : 0; now && i < now.end && want === null; i++) {
      const parts = now.wantHard[i].split('|');
      if (parts[1] === '-hitcount' && targetNames.has(parts[2])) want = Number(parts[3]);
    }
    const singleDie = Array.isArray(move.multihit) && !pokemon.hasItem('loadeddice');
    counting = { i: singleDie ? null : false, faces: null, off: 0, want };
    let count;
    try {
      return origHitLoop.call(this, targets, pokemon, move);
    } finally {
      count = counting;
      counting = null;
      const face = typeof count.i === 'number' ? faceOf(count.i) : undefined;
      if (want !== null && face !== undefined) {
        const reps = [];
        const groups = new Map();
        for (const [f, hits] of count.faces.entries()) {
          if (hits !== want) continue;
          const v = f + count.off;
          if (!reps.length) { reps.push(v); groups.set(v, []); }
          groups.get(reps[0]).push(v);
        }
        const wrongCount = count.faces[face - count.off] !== want;
        out.set(count.i, { reps, groups, wrong: wrongCount, shifts: wrongCount });
        if (wrongCount) diverged = true;
      }
    }
  };

  // A move with no chosen target - every spread move over foes, Outrage, a move
  // Encore or Sleep Talk chose - draws one in `getRandomTarget` before `addMove`
  // writes its `|move|` line. Each face of that `sample` is run dry through
  // `getMoveTargets`: where they all write a plain `|move|` line and only one
  // writes the target the observed line names, that face is the only one the
  // replay allows. Where both faces also hit the same targets in the same order
  // with the same move, the move in flight differs only in that display slot,
  // so its accuracy and damage dice are read on the same pass too.
  const sameList = (a, b) => a.length === b.length && a.every((x, idx) => x === b[idx]);
  const modifiedMove = (pokemon, item) => dry(() => {
    const snap = snapItems([pokemon, item]);
    try {
      const copy = cloneMove(frame.preMove);
      battle.singleEvent('ModifyType', copy, null, pokemon, item, copy, copy);
      battle.singleEvent('ModifyMove', copy, null, pokemon, item, copy, copy);
      return `${copy.type}|${copy.category}|${copy.accuracy}|${copy.target}`;
    } finally {
      restoreItems(snap);
    }
  }, 0);
  const sameModifiedMove = (pokemon, a, b) => !frame.preMove
    || (!frame.preMove.onModifyType && !frame.preMove.onModifyMove)
    || modifiedMove(pokemon, a) === modifiedMove(pokemon, b);

  const origRunMove = actions.runMove;
  actions.runMove = function (moveOrMoveName, pokemon, targetLoc, options) {
    if (at.k !== turn || st.dry) return origRunMove.call(this, moveOrMoveName, pokemon, targetLoc, options);
    const prev = frame;
    frame = { emitted: false, draw: null, preMove: null, retarget: null };
    try {
      return origRunMove.call(this, moveOrMoveName, pokemon, targetLoc, options);
    } finally {
      frame = prev;
    }
  };

  const origUseMoveInner = actions.useMoveInner;
  actions.useMoveInner = function (moveOrMoveName, pokemon, options) {
    if (at.k !== turn || st.dry) return origUseMoveInner.call(this, moveOrMoveName, pokemon, options);
    const nested = !frame || frame.emitted;
    const prev = frame;
    if (nested) frame = { emitted: false, draw: null, preMove: null, retarget: null };
    frame.preMove = cloneMove(this.dex.getActiveMove(moveOrMoveName));
    try {
      return origUseMoveInner.call(this, moveOrMoveName, pokemon, options);
    } finally {
      if (frame) frame.retarget = null;
      frame = prev;
    }
  };

  const origRandomTarget = battle.getRandomTarget;
  battle.getRandomTarget = function (pokemon, move) {
    if (at.k !== turn || st.dry || !frame || frame.emitted || samplingTarget) {
      return origRandomTarget.call(this, pokemon, move);
    }
    const picked = { i: null, items: null };
    samplingTarget = picked;
    try {
      const target = origRandomTarget.call(this, pokemon, move);
      frame.draw = picked.i !== null && target ? { i: picked.i, pokemon, items: picked.items, target } : null;
      return target;
    } finally {
      samplingTarget = null;
    }
  };

  const origAddMove = battle.addMove;
  battle.addMove = function (...args) {
    if (args[0] !== 'move' || at.k !== turn || st.dry || !frame || frame.emitted) {
      return origAddMove.apply(this, args);
    }
    frame.emitted = true;
    const [, pokemon, movename, rest = ''] = args;
    const drawn = frame.draw;
    const move = battle.activeMove;
    const gotTarget = String(rest).split('|')[0];
    if (drawn && move && drawn.pokemon === pokemon && gotTarget === String(drawn.target)
      && typeof move.smartTarget !== 'boolean' && !move.onModifyTarget) {
      const now = standing();
      const wantLine = now?.wantHard[now.from];
      const wantParts = wantLine ? wantLine.split('|') : null;
      const wantTarget = wantParts && wantParts[1] === 'move' && wantParts[2] === String(pokemon)
        && wantParts[3] === String(movename) ? (wantParts[4] || '') : '';
      const current = faceOf(drawn.i);
      if (wantTarget && current !== undefined) {
        try {
          const tail = String(rest).slice(gotTarget.length);
          const fits = [];
          const plans = [];
          let clean = true;
          for (const [f, item] of drawn.items.entries()) {
            if (!item || typeof item !== 'object') { clean = false; break; }
            const logLen = battle.log.length;
            const probed = dry(() => {
              const copy = cloneMove(move);
              origAddMove.call(battle, 'move', pokemon, movename, `${item}${tail}`);
              const plan = pokemon.getMoveTargets(copy, item);
              const added = battle.log.slice(logLen).filter(l => !l.startsWith('|debug|'));
              return added.length === 1 ? { target: added[0].split('|')[4], plan } : null;
            }, 0);
            if (!probed) { clean = false; break; }
            plans[f] = probed.plan;
            if (probed.target === wantTarget) fits.push(f);
          }
          if (clean && fits.length === 1) {
            const wantIdx = fits[0];
            const retargeted = current !== wantIdx && Boolean(plans[current]?.targets.length
              && sameList(plans[current].targets, plans[wantIdx].targets)
              && sameList(plans[current].pressureTargets, plans[wantIdx].pressureTargets)
              && sameModifiedMove(pokemon, drawn.items[current], drawn.items[wantIdx]));
            out.set(drawn.i, {
              reps: current === wantIdx ? [] : [wantIdx],
              groups: new Map(),
              wrong: current !== wantIdx,
              shifts: current !== wantIdx && !retargeted,
            });
            if (retargeted) {
              frame.retarget = { at: now.from, from: gotTarget, to: wantTarget };
            }
          }
        } catch { /* leave unsteered */ }
      }
    }
    return origAddMove.apply(this, args);
  };
}

// ------------------------------------------------------------- turn snapshots

/** The pins a snapshot's position depends on: every one addressed before it. */
const pinsBefore = (subs, draws) => Object.keys(subs || {})
  .map(Number)
  .filter(i => i < draws)
  .sort((a, b) => a - b)
  .map(i => `${i}=${subs[i]}`)
  .join(' ');

/**
 * The battle as it stood when turn `k` began, so a probe of that turn can start
 * there instead of at turn 0.
 *
 * `Battle.toJSON()` serializes the simulator's own state; the interceptor's is
 * taken beside it, because pins are addressed by ordinal and the ordinal of the
 * next draw has to survive the round trip. The interceptor itself is left out
 * of the battle's serialization - it holds the generator, which the serializer
 * refuses, and it is installed again on restore. A battle the serializer cannot
 * take gets no snapshot, and its probes replay from the start as before.
 */
function takeSnapshot(battle, { k, subs, variants, logAt, starts, widths, notes, hidden, party, partySides }) {
  const st = battle.__rng;
  let json;
  delete battle.__rng;
  try {
    json = JSON.stringify(battle.toJSON());
  } catch {
    return null;
  } finally {
    battle.__rng = st;
  }
  return {
    id: ++snapshotCount,
    turn: k,
    json,
    log: battle.log.slice(),
    draws: st.draws,
    reseeds: st.reseeds,
    sinceReseed: st.sinceReseed,
    pins: pinsBefore(subs, st.draws),
    variants: variants.slice(0, k).map(v => v || 0),
    logAt,
    starts: starts.slice(0, k),
    widths: widths.slice(0, k),
    notes: notes.slice(),
    hidden: hidden.slice(),
    party: party.slice(),
    partySides: partySides ? partySides.slice() : [],
  };
}

/**
 * The snapshot a run up to turn `t` can start from, or null. The position at
 * the start of a turn is fixed by the choices before it and by every pin
 * addressed before its first draw; pins for that turn and later ones only act
 * after it, the same whether the run starts at turn 0 or here.
 */
function snapshotFor(common, subs, t) {
  const snap = t >= 1 ? common.snaps?.get(t) : null;
  if (!snap) return null;
  for (let k = 0; k < t; k++) if ((common.variants[k] || 0) !== snap.variants[k]) return null;
  return pinsBefore(subs, snap.draws) === snap.pins ? snap : null;
}

/** A battle rebuilt from a snapshot, with the interceptor where it left off. */
function restoreSnapshot(snap, subs) {
  let battle;
  try {
    battle = Battle.fromJSON(snap.json);
  } catch {
    return null;
  }
  battle.restart(() => {});
  const st = install(battle);
  st.draws = snap.draws;
  st.reseeds = snap.reseeds;
  st.sinceReseed = snap.sinceReseed;
  const pairs = Object.entries(subs || {}).map(([i, v]) => [Number(i), Number(v)]);
  if (pairs.length) st.pins = new Map(pairs);
  return battle;
}

/**
 * Replay the whole battle under a given set of per-turn seeds.
 *
 * Stops at the first turn whose emitted lines disagree with the observed ones,
 * unless `tolerant` is set - which is how a best-effort log is produced after
 * the search gives up. With `steer`, that turn's damage, crit and accuracy dice
 * are read off the observed turn as they are thrown (`steerDice`).
 *
 * A run that stops at turn `t` takes a snapshot of the battle when turn `t`
 * begins, and a later run that stops there under the same earlier choices and
 * pins starts from it (`from`). Such a run replays one turn instead of all of
 * them. It carries the snapshot's recipe, not its own, so it has no input log:
 * only a run from turn 0 produces one.
 *
 * `tally.plays` counts the run, on the thread the search runs on.
 */
async function playThrough({ header, segments, plans, reseeds, variants, radices = null, maxVariants = Infinity, subs, channel, exact, state0, dex, cutEarly = false, stopAt, tolerant, steer = null, snaps = null, from = null, tally = null }) {
  if (tally) tally.plays++;
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
  const restored = from ? restoreSnapshot(from, subs) : null;
  if (restored) {
    stream.battle = restored;
  } else {
    from = null;
    await stream.write(header[0]);
    if (!stream.battle) throw new Error('no battle after >start - the header is malformed');
    install(stream.battle);
  }
  const battle = stream.battle;
  // A move a hidden disable turned into Struggle - Imprison's, in doubles - is
  // recorded as `move struggle`, which the request it answered never offered,
  // so that line would be refused on replay. The
  // choice that was written is recorded in its place.
  const written = {};
  const recordInput = battle.inputLog.push;
  battle.inputLog.push = function (line, ...rest) {
    const m = /^>(p[1-4]) (.*)$/.exec(String(line));
    const raw = m && written[m[1]];
    const fixed = raw && /\bmove struggle\b/.test(m[2]) && !/\bstruggle\b/.test(raw) ? `>${m[1]} ${raw}` : line;
    return recordInput.call(this, fixed, ...rest);
  };
  const trace = traceOn(battle);
  // Each draw also records how long the log was when it was thrown: a die
  // cannot change a line written before it.
  const push = trace.push;
  trace.push = row => push.call(trace, { ...row, at: battle.log.length });
  if (!from && subs && Object.keys(subs).length) await stream.write(atLine(subs));

  const compare = (k, slice) => compareTurn({ segments, exact, channel }, k, slice);
  const at = { k: 0, logAt: 0 };
  const steered = steer === null ? null : new Map();
  if (steered) steerDice(battle, { at, turn: steer, compare, channel, out: steered });
  if (!from) await stream.write(header.slice(1).join('\n'));

  const notes = from ? from.notes.slice() : [];
  // The turns where a choice the replay never showed was substituted.
  const hidden = from ? from.hidden.slice() : [];
  // The turns on which a move read a Pokemon in the back of the party: who
  // stands there, and where, is the team preview's hidden choice.
  const party = from ? from.party.slice() : [];
  const partySides = from?.partySides ? from.partySides.slice() : [];
  watchParty(battle, at, party, partySides);
  // Each choice written, with how long the log was when it was: like a die, a
  // choice cannot change a line written before it.
  const choices = [];
  const diffs = [];
  const widths = from ? from.widths.slice() : [];
  const starts = from ? from.starts.slice() : [];
  const invisiblePrios = from?.invisiblePrios ? from.invisiblePrios.slice() : [];
  let badTurn = null;
  let logAt = from ? from.logAt : 0;

  for (let k = from ? from.turn : 0; k < segments.length; k++) {
    if (snaps && !from && k === stopAt && k >= 1) {
      const snap = takeSnapshot(battle, { k, subs, variants, logAt, starts, widths, notes, hidden, party, partySides });
      if (snap) snaps.set(k, snap);
    }
    markDraws(battle, k);
    at.k = k;
    at.logAt = logAt;
    starts[k] = logAt;
    if (k >= 1 && reseeds[k]) await stream.write(`>reseed ${reseeds[k]}`);

    // `variant` is a mixed-radix counter over every undetermined target in the
    // turn: each unknown consumes one digit, so incrementing it walks the whole
    // space of substitutions without enumerating it. On a turn with more
    // variants than the search walks, the choices the replay never showed - a
    // fainted, flinched or fully paralysed Pokemon's move - take the low
    // digits, so they are walked first: a target the replay shows where a move
    // landed is a good guess, and an unseen move is none. Their radix is the
    // one the turn's first play found (`radices`), the same in every probe of
    // the rebuild.
    const variant = variants?.[k] || 0;
    const unseen = radices?.[k] || 0;
    let low = unseen ? variant % unseen : 0;
    let high = unseen ? Math.floor(variant / unseen) : variant;
    const state = {
      reveal: state0.reveal,
      sizes: state0.sizes,
      disguises: state0.disguises,
      sheets: state0.sheets,
      rawLines: state0.rawLines,
      unmaskedLines: state0.unmaskedLines,
      forced: { p1: [...plans[k].forced.p1], p2: [...plans[k].forced.p2] },
      unsatisfied: null,
      selfSwitchLast: selfSwitchLast(dex),
      invisiblePrios: [],
      variantWidth: 1,
      unseenWidth: 1,
      nextVariantDigit(radix, hidden = false) {
        if (radix <= 1) return 0;
        this.variantWidth *= radix;
        if (hidden) this.unseenWidth *= radix;
        if (hidden && unseen) {
          const digit = low % radix;
          low = Math.floor(low / radix);
          return digit;
        }
        const digit = high % radix;
        high = Math.floor(high / radix);
        return digit;
      },
    };

    // Drive this turn until the simulator moves past it. A battle that ended
    // without a Pokemon deciding it ends here once everything before its
    // `|win|` has been printed.
    const ending = !cutEarly && k === segments.length - 1 ? forcedEnding(segments[k], battle.sides) : null;
    let guard = 0;
    while (!battle.ended) {
      if (k >= 1 && battle.turn > k) break;
      if (k === 0 && battle.turn >= 1) break;
      const waiting = battle.sides.filter(s => s.requestState);
      if (!waiting.length) break;
      if (ending) {
        const { wantHard, gotHard } = compare(k, battle.log.slice(logAt));
        if (gotHard.length === wantHard.length - 1 && gotHard.every((line, i) => line === wantHard[i])) {
          await stream.write(ending);
          break;
        }
      }
      if (++guard > 24) {
        state.unsatisfied = `turn ${k} never resolved after ${guard} choice rounds`;
        state.cap = 'choiceRounds';
        break;
      }
      const before = `${battle.turn}:${battle.log.length}:${battle.sides.map(s => s.requestState).join('')}`;
      for (const side of waiting) {
        // A side whose choice an earlier round already made is left waiting
        // once the other side's choice resolves the turn: nothing to write.
        if (!side.requestState) continue;
        written[side.id] = choiceFor(side, plans[k], state, notes);
        choices.push({ turn: k, side: side.id, choice: written[side.id], at: battle.log.length });
        await stream.write(`>${side.id} ${written[side.id]}`);
      }
      const after = `${battle.turn}:${battle.log.length}:${battle.sides.map(s => s.requestState).join('')}`;
      if (before === after) {
        // A rejected choice is a silent no-op: the error goes to the side
        // channel, never to the battle log, and the turn simply does not
        // advance. Assert progress or it hangs unnoticed.
        state.unsatisfied = `turn ${k}: a choice was rejected - nothing advanced`;
        break;
      }
      if (state.unsatisfied) break;
    }

    widths[k] = state.variantWidth;
    invisiblePrios[k] = state.invisiblePrios;
    // Only a turn with more variants than the search walks needs the unseen
    // choices first; every variant of any other turn is walked anyway.
    if (radices && !radices[k] && state.unseenWidth > 1 && state.variantWidth > maxVariants) radices[k] = state.unseenWidth;
    if (state.invisible && !hidden.includes(k)) hidden.push(k);
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
    const finished = !found && !cutEarly && k === segments.length - 1;
    // `cap` marks a turn our own guard gave up on, which no refusal decided.
    const diff = state.unsatisfied && !finished
      ? (early || { index: -1, prefix: gotHard.length, expected: state.unsatisfied, actual: '', ...(state.cap ? { cap: state.cap } : {}) }) : found;

    if (diff) {
      diffs.push({ turn: k, ...diff });
      badTurn = k;
      if (!tolerant) break;
    }
    if (stopAt !== undefined && k >= stopAt) break;
  }

  const subHps = {};
  for (const side of battle.sides) {
    for (const p of side.pokemon) {
      if (p.volatiles?.substitute) subHps[`${side.id}:${p.name}`] = p.volatiles.substitute.hp;
    }
  }

  const result = {
    badTurn,
    diffs,
    widths,
    invisiblePrios,
    starts,
    notes,
    hidden,
    party,
    partySides,
    trace,
    choices,
    steer: steered,
    subHps,
    inputLog: from ? null : [...battle.inputLog],
    rawLog: [...battle.log],
    turn: battle.turn,
    ended: battle.ended,
    winner: battle.winner || null,
  };

  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return result;
}

/** A run up to turn `t`, from that turn's snapshot when one fits. */
const runTo = (common, subs, t, steer = null) =>
  playThrough({ ...common, subs, stopAt: t, steer, from: snapshotFor(common, subs, t) });

// ------------------------------------------------------------ parallel probes

/**
 * Worker threads that run probes ahead of the search.
 *
 * A probe is a pure function of the snapshot it starts from and the pins it is
 * given, so it can run anywhere. The search itself is unchanged: it still asks
 * for one probe at a time, in the same order, against the same budget, and a
 * worker only answers a question before it is asked. What a reconstruction finds
 * therefore never depends on how many threads found it - only how long it took.
 *
 * The pool is sized per machine: `os.availableParallelism()` less the thread the
 * search runs on, and no pool at all below two workers, where the messages would
 * cost more than they save. This file is the workers' entry too.
 */
const PROBE_ROLE = 'reconstruct-probe';

/**
 * Contexts and snapshots one worker holds. Both ends forget the same way - the
 * oldest that the message in hand does not use - so the main thread always
 * knows what a worker still has.
 */
const HELD = 16;
function hold(list, key, inUse) {
  list.push(key);
  const gone = [];
  while (list.length > HELD) {
    const at = list.findIndex(k => !inUse.includes(k));
    gone.push(...list.splice(at, 1));
  }
  return gone;
}

let contextCount = 0;
let snapshotCount = 0;
let workers = null;

/** What a worker needs to replay one reconstruction's turns. */
const contextPayload = ({ formatid, header, segments, plans, reseeds, channel, exact, state0, cutEarly }) =>
  ({ formatid, header, segments, plans, reseeds, channel, exact, state0, cutEarly });

function probePool(threads, formatid) {
  const size = Math.max(0, Math.floor(threads) - 1);
  if (size < 2 || !isMainThread) return null;
  if (workers?.size === size) return workers;
  workers?.close();
  workers = createPool(size, formatid);
  return workers;
}

function createPool(size, formatid) {
  const slots = [];
  const waiting = [];
  let jobs = 0;

  const pump = () => {
    for (const slot of slots) {
      if (!slot.ready || slot.busy || slot.dead || !waiting.length) continue;
      const job = waiting.shift();
      const msg = { job: ++jobs, ctx: { id: job.common.id }, snap: { id: job.snap.id }, subs: job.subs, variants: job.variants, radices: job.radices, t: job.t };
      const inUse = [`c${job.common.id}`, `s${job.snap.id}`];
      if (!slot.held.includes(inUse[0])) {
        msg.ctx.payload = contextPayload(job.common);
        hold(slot.held, inUse[0], inUse);
      }
      if (!slot.held.includes(inUse[1])) {
        msg.snap.payload = { ...job.snap, log: undefined };
        hold(slot.held, inUse[1], inUse);
      }
      job.state = 'sent';
      slot.busy = job;
      // Held only while it works: an idle pool never keeps the process alive.
      slot.worker.ref();
      slot.worker.postMessage(msg);
    }
  };

  for (let i = 0; i < size; i++) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { role: PROBE_ROLE, formatid } });
    const slot = { worker, ready: false, busy: null, dead: false, held: [] };
    worker.on('message', (msg) => {
      if (msg.ready) { slot.ready = true; pump(); return; }
      const job = slot.busy;
      slot.busy = null;
      worker.unref();
      if (job) {
        job.state = 'done';
        if (msg.error) job.reject(new Error(msg.error)); else job.resolve(msg.run);
      }
      pump();
    });
    worker.on('error', (err) => {
      slot.dead = true;
      worker.unref();
      if (slot.busy) { slot.busy.reject(err); slot.busy = null; }
    });
    // Listening refs the worker's port, so this comes after the listeners.
    worker.unref();
    slots.push(slot);
  }

  return {
    size,
    submit(common, snap, subs, t) {
      const job = { common, snap, subs, variants: common.variants.slice(), radices: { ...common.radices }, t, state: 'queued' };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      job.promise.catch(() => {});
      waiting.push(job);
      pump();
      return job;
    },
    withdraw(job) {
      const at = waiting.indexOf(job);
      if (at < 0) return false;
      waiting.splice(at, 1);
      return true;
    },
    close() {
      for (const slot of slots) slot.worker.terminate();
    },
  };
}

/**
 * The worker's side: hold what it is sent, answer one probe at a time. The
 * simulator loads its data on the first battle it builds, which costs far more
 * than a probe, so a worker builds one before it says it is ready - until then
 * the search runs its probes itself.
 */
function serveProbes() {
  const held = new Map();
  const order = [];
  const dexes = new Map();
  new Battle({ formatid: workerData.formatid });
  parentPort.on('message', async ({ job, ctx, snap, subs, variants, radices, t }) => {
    try {
      const inUse = [`c${ctx.id}`, `s${snap.id}`];
      for (const [key, payload] of [[inUse[0], ctx.payload], [inUse[1], snap.payload]]) {
        if (!payload) continue;
        held.set(key, payload);
        for (const gone of hold(order, key, inUse)) held.delete(gone);
      }
      const common = held.get(`c${ctx.id}`);
      const from = held.get(`s${snap.id}`);
      if (!dexes.has(common.formatid)) dexes.set(common.formatid, Dex.forFormat(common.formatid));
      const run = await playThrough({ ...common, dex: dexes.get(common.formatid), variants, radices, subs, stopAt: t, from });
      parentPort.postMessage({
        job,
        run: {
          badTurn: run.badTurn, diffs: run.diffs, starts: run.starts, widths: run.widths,
          trace: [...run.trace], tail: run.rawLog.slice(from.logAt), subHps: run.subHps,
        },
      });
    } catch (err) {
      parentPort.postMessage({ job, error: String(err?.stack || err) });
    }
  });
  parentPort.postMessage({ ready: true });
}

/**
 * The probes of one turn's search, answered by the pool when it got there first
 * and on this thread otherwise. `ahead` names the probes the search is about to
 * ask for, in the order it will ask; `get` is the asking. A probe still waiting
 * for a worker when it is asked for is taken back and run here, and anything a
 * worker could not answer is run here too, so the pool can only save time. A
 * probe a worker answered counts as a run the search played; one a worker ran
 * ahead that was never asked for does not, so the count is the same for any
 * number of threads.
 */
function prober(common, t) {
  const jobs = new Map();
  const keyOf = subs => Object.keys(subs).map(Number).sort((a, b) => a - b).map(i => `${i}=${subs[i]}`).join(' ');
  return {
    ahead(list) {
      if (!common.pool) return;
      for (const subs of list) {
        const key = keyOf(subs);
        if (jobs.has(key)) continue;
        const snap = snapshotFor(common, subs, t);
        if (snap) jobs.set(key, common.pool.submit(common, snap, subs, t));
      }
    },
    async get(subs) {
      const job = jobs.get(keyOf(subs));
      // The search itself only ever waits on promises, so a worker's messages
      // are read only when it yields: once, before a queued probe is taken back.
      if (job?.state === 'queued') await new Promise(resolve => setImmediate(resolve));
      if (job && !(job.state === 'queued' && common.pool.withdraw(job))) {
        try {
          const run = await job.promise;
          if (common.tally) common.tally.plays++;
          return { ...run, rawLog: job.snap.log.slice(0, job.snap.logAt).concat(run.tail), steer: null, inputLog: null, notes: [], hidden: [] };
        } catch { /* run it here */ }
      }
      return runTo(common, subs, t);
    },
    cancel() {
      for (const job of jobs.values()) if (job.state === 'queued') common.pool.withdraw(job);
      jobs.clear();
    },
  };
}

/**
 * How well a run agreed with turn `t`, as `[lines, fields, shared]`.
 *
 * `lines` is how far the turn got before disagreeing - `Infinity` for a turn
 * that matched outright. `fields` counts how much of the disagreeing line is
 * nevertheless right (`-1` for a choice the simulator refused after `lines`
 * agreed, which no die can repair), and it is what keeps the search off a
 * local minimum: one line can need two draws to change together, and a move
 * line that has found its target but not yet its damage is genuinely closer
 * than one that has neither. `shared` counts the fields right in place anywhere
 * in the line, which ranks lines whose kind is still wrong: a Pokemon the
 * replay shows flinching, sorted after a speed tie it lost, needs the tie and
 * the flinch together, and the run that has it moving where the replay has it
 * flinch has its name right.
 */
const OPENS_ACT = /^\|(move|cant)\||^\|-activate\|[^|]+\|confusion$|^\|-curestatus\|[^|]+\|(slp|frz)\|\[msg\]$/;

function opensMoveAct(text) {
  if (!OPENS_ACT.test(text)) return false;
  const kind = text.split('|')[1];
  if (kind === 'cant') return !tagsOf(text).of;
  if (kind === 'move') {
    const from = tagsOf(text).from;
    return !from || from === 'lockedmove';
  }
  return true;
}

function scoreOf(run, t) {
  if (run.badTurn === null || run.badTurn > t) return [Infinity, 0, 0];
  if (run.badTurn < t) return [-Infinity, 0, 0];
  const diff = run.diffs[0];
  if (!diff) return [-1, 0, 0];
  if (diff.index < 0) return [diff.prefix ?? 0, -1, 0];
  const wantText = String(diff.expected ?? '');
  const gotText = String(diff.actual ?? '');
  const want = wantText.split('|');
  const got = gotText.split('|');
  if (opensMoveAct(wantText) && opensMoveAct(gotText) && want[2] !== got[2]) {
    return [diff.index, 1, 1];
  }
  let fields = 0;
  while (fields < want.length && fields < got.length && want[fields] === got[fields]) fields++;
  const crossActorMove = want[1] === 'move' && got[1] === 'move' && want[2] !== got[2];
  let shared = 0;
  for (let i = 0; i < want.length && i < got.length; i++) {
    if (crossActorMove && i === 4) continue;
    if (want[i] === got[i]) shared++;
  }
  return [diff.index, fields, shared];
}

const sameMoveHead = (a, b) => {
  const pa = String(a || '').split('|');
  const pb = String(b || '').split('|');
  return pa[1] === 'move' && pb[1] === 'move' && pa[2] === pb[2] && pa[3] === pb[3];
};

/**
 * Which of turn `t`'s draws could change the line the turn disagrees on. A die
 * thrown after that line was written cannot - with one exception: a move line
 * is amended after the fact (`[miss]`, `[still]`, a retarget - `attrLastMove`,
 * `retargetLastMove`), so a move line stays open until the next action starts.
 */
function canReach(common, run, t, { strictMove = false } = {}) {
  const diff = run.diffs[0];
  if (!diff || diff.turn !== t || diff.index < 0 || run.starts?.[t] === undefined) return () => true;
  const { wantHard, gotHard } = compareTurn(common, t, run.rawLog.slice(run.starts[t]));
  let limit = diff.index;
  const line = gotHard[limit] || '';
  if (line.startsWith('|-anim|') || (line.startsWith('|move|') && (!strictMove || sameMoveHead(line, wantHard[limit])))) {
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

/**
 * Where a run fails inside a turn the evidence proved, under the dice and the
 * choices the proof was read under, as `{ turn, index, expected, actual }`;
 * otherwise null.
 *
 * Stat Point inference reads its proof off a rebuild and hands the next one
 * the turns it proved (`exact`) and the dice that rebuild them, and with them
 * every die that rebuild threw up to the turn it failed on, with the face the
 * proof read it under, and every choice it wrote (`pins.proof`). A run that
 * fails inside the proved part of a proved turn - on a refused choice too,
 * when nothing printed before it disagrees - while every die that could reach
 * the failing line (`canReach`) was thrown on the same turn, from the same
 * range and with the same face as in the proof, and every choice that could
 * reach it is the proof's, played the battle the proof was read off with
 * nothing changed but the Stat Points, to the ones the proof chose: the proof
 * does not fit its own guess. A run that threw a die another way, or wrote
 * another choice, played another battle - a spread that moves the dice, a
 * hidden choice the search had not settled - and is not one.
 */
function brokenProof(common, run, proof) {
  const t = run.badTurn;
  const diff = run.diffs[0];
  if (t === null || !diff || !proof || !common.exact?.has(t)) return null;
  // A rejected choice has index -1, not a position in the log. Its preceding
  // lines can already cover a partial proof, leaving the refusal outside it.
  if (diff.index < 0 && run.starts?.[t] === undefined) return null;
  const compared = compareTurn(common, t, diff.index < 0 ? run.rawLog.slice(run.starts[t]) : []);
  const index = diff.index < 0 ? compared.gotHard.length : diff.index;
  if (!(index < compared.exactUpTo) || !(index < compared.provedUpTo)) return null;
  if (proof.starts?.[t] === undefined || !proof.rawLog) return null;
  const diffs = [{ ...diff, index }];
  const reach = canReach(common, { ...run, diffs }, t);
  const proofReach = canReach(common, { ...proof, diffs }, t);
  // Compare both prefixes at their own log positions. A spread can remove a
  // speed-tie draw: checking only the new run would overlook the proof's extra
  // die, especially when it was the last draw before the disagreeing line.
  const draws = run.trace.filter(d => d.mark < t || (d.mark === t && reach(d)));
  const provedDraws = Object.values(proof.dice).filter(d => d.mark < t || (d.mark === t && proofReach(d)));
  if (draws.length !== provedDraws.length) return null;
  for (const [n, d] of draws.entries()) {
    const p = provedDraws[n];
    if (p.i !== d.i || p.mark !== d.mark || p.from !== d.from || p.to !== d.to || p.chance !== d.chance || p.value !== d.value) return null;
  }
  const choices = run.choices.filter(c => c.turn < t || (c.turn === t && reach(c)));
  const provedChoices = proof.choices.filter(c => c.turn < t || (c.turn === t && proofReach(c)));
  if (choices.length !== provedChoices.length) return null;
  for (const [n, c] of choices.entries()) {
    const p = provedChoices[n];
    if (p.turn !== c.turn || p.side !== c.side || p.choice !== c.choice) return null;
  }
  return { turn: t, index: diff.index, expected: diff.expected ?? null, actual: diff.actual ?? null };
}

const outranks = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);
const ties = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Raw log index on turn `t` at which hard line `idx` ends (extended across `|move|`/`|-anim|` when `extendMove` is set). */
function turnFailLogAt(common, t, start, lines, idx, extendMove = true, refused = false) {
  const end = start + lines.length;
  if (!Number.isFinite(idx) || idx < 0 || refused) return end;
  const count = p => compareTurn(common, t, lines.slice(0, p - start)).gotHard.length;
  const { wantHard, gotHard } = compareTurn(common, t, lines);
  const line = gotHard[idx] || '';
  if (extendMove && (line.startsWith('|-anim|') || (line.startsWith('|move|') && sameMoveHead(line, wantHard[idx])))) {
    let next = Infinity;
    for (let j = idx + 1; j < gotHard.length && next === Infinity; j++) {
      if (ACTION_START.has(gotHard[j].split('|')[1])) next = j;
    }
    idx = next;
  }
  if (idx >= gotHard.length) return end;
  let lo = start;
  let hi = end;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (count(mid) > idx) hi = mid; else lo = mid + 1; }
  return lo;
}

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
async function resolveTurn(t, common, subs, subTurn, sample, budget, { deferProbeLimit = false } = {}) {
  let run = await runTo(common, subs, t, t);
  let score = scoreOf(run, t);
  let forced = 0;
  let probes = 0;

  const found = new Map();
  const commits = [];
  const moved = [];
  const ownShape = new Map();
  let minCommitted = null;
  const shapeOf = d => (d ? `${d.lo}|${d.hi}|${d.chance}` : null);
  const ask = prober(common, t);
  const remember = (probe) => {
    const start = probe.starts?.[t] ?? 0;
    return {
      score: scoreOf(probe, t),
      diffs: probe.diffs,
      starts: probe.starts,
      rawLog: probe.rawLog,
      since: moved.length,
      start,
      lines: probe.rawLog.slice(start),
      trace: probe.trace.filter(row => row.mark === t),
    };
  };
  const failAt = (rec) => {
    if (rec.fail !== undefined) return rec.fail;
    return (rec.fail = turnFailLogAt(common, t, rec.start, rec.lines, rec.score[0], true, rec.score[1] === -1));
  };
  // Only the prefix of commits that strictly advanced `score[0]` before the
  // turn's stall line is carried into `rewalk`; speculative `fallback` commits
  // at a stall never mask another choice variant.
  let clean = { score, subs: { ...subs }, subTurn: { ...subTurn }, trace: drawsOf(run.trace, t) };
  const noteClean = () => {
    if (score[0] > clean.score[0]) {
      const stopLog = failAt(remember(run));
      const atMap = new Map(drawsOf(run.trace, t).map(d => [d.i, d.at]));
      const cSubs = {};
      const cSubTurn = {};
      for (const [k, v] of Object.entries(subs)) {
        if (subTurn[k] === t && (atMap.get(Number(k)) ?? 0) >= stopLog) continue;
        cSubs[k] = v;
        cSubTurn[k] = subTurn[k];
      }
      clean = { score, subs: cSubs, subTurn: cSubTurn, trace: drawsOf(run.trace, t) };
    }
  };
  const holds = (rec) => {
    if (!rec.at) rec.at = new Map(rec.trace.map(row => [row.i, row.at]));
    for (const c of moved.slice(rec.since)) {
      const thrown = rec.at.get(Number(c));
      if (thrown !== undefined && thrown < failAt(rec)) return false;
    }
    return true;
  };
  const commit = (i, value, shape = null) => {
    const prev = subs[i];
    const prevShape = ownShape.get(i);
    if (prev === undefined) forced++;
    subs[i] = value;
    subTurn[i] = t;
    commits.push({ i, prev, prevShape });
    moved.push(i);
    if (shape) ownShape.set(i, shape);
    minCommitted = minCommitted === null ? i : Math.min(minCommitted, i);
  };
  const dropShifted = async (prevLines) => {
    if (minCommitted === null || !(score[0] > prevLines)) { minCommitted = null; return; }
    const from = minCommitted;
    minCommitted = null;
    const now = new Map(drawsOf(run.trace, t).map(d => [d.i, shapeOf(d)]));
    const stale = [...ownShape].filter(([k, sh]) => k > from && now.get(k) !== sh).map(([k]) => k);
    if (!stale.length) return;
    const cleaned = { ...subs };
    for (const k of stale) delete cleaned[k];
    const check = await runTo(common, cleaned, t, t);
    if (scoreOf(check, t)[0] > prevLines) {
      for (const k of stale) {
        delete subs[k];
        delete subTurn[k];
        ownShape.delete(k);
        moved.push(k);
        forced--;
      }
      run = check;
      score = scoreOf(check, t);
    }
  };
  // A draw that only gets more of the line's fields or shared tokens right
  // without advancing past it is held on trial: it stays when a later draw
  // carries the turn further, and is taken back before two-die search when
  // none does. Field-improving trials are restored if nothing else advances;
  // in-place shared-only trials stay rolled back into `tried` for backtracking.
  let onTrial = null;
  let fieldTrial = null;
  let bestFieldStash = null;
  let tried = null;
  const deadTrials = new Set();
  const deadComboAt = new Set();
  const takeBack = () => {
    tried = { ...tried };
    for (const { i, prev, prevShape } of commits.splice(onTrial.at).reverse()) {
      if (subs[i] === undefined) continue;
      if (prev === undefined) {
        tried[i] = subs[i];
        delete subs[i];
        delete subTurn[i];
        ownShape.delete(i);
        moved.push(i);
        forced--;
      } else {
        subs[i] = prev;
        if (prevShape !== undefined) ownShape.set(i, prevShape);
        else ownShape.delete(i);
        moved.push(i);
      }
    }
    onTrial = null;
  };

  // Wide dice are tried between their ends only when nothing else moves the
  // turn, so a search that never needs it takes the path it always took.
  let wide = false;
  // The limit that left a candidate untried, if one did.
  let cut = null;
  while (score[0] !== Infinity && score[0] !== -1 && score[1] !== -1) {
    if (probes >= budget) { cut = 'probes'; break; }
    if (Date.now() >= common.deadline) { cut = 'deadline'; break; }
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
    let reach = canReach(common, run, t, { strictMove: true });
    let all = drawsOf(run.trace, t);
    const wrong = d => !!run.steer?.get(d.i)?.wrong;

    // Every such draw set right at once, first. A spread move that missed one
    // target and hit the other needs both accuracy dice moved, and neither
    // alone brings the line any closer. Flipping an accuracy or hit-count die
    // adds or drops the damage rolls after it, so those wait for the next pass.
    const rawFixes = all.filter(d => subs[d.i] === undefined && reach(d) && wrong(d) && run.steer.get(d.i).reps.length);
    const shiftFix = rawFixes.find(d => run.steer.get(d.i).shifts);
    const fixes = shiftFix
      ? rawFixes.filter(d => d.i <= shiftFix.i || (run.steer.get(shiftFix.i).accuracy && run.steer.get(d.i).accuracy))
      : rawFixes;
    let trial = null;
    if (fixes.length > 1 && probes < budget) {
      trial = { ...subs };
      for (const d of fixes) {
        const { reps, groups } = run.steer.get(d.i);
        const faces = reps.flatMap(v => groups.get(v) || [v]);
        trial[d.i] = faces[sample.pick(faces.length)];
      }
    }

    // The probes this scan will ask for, in order, are known before it asks:
    // the workers start on them now.
    let order = [...all.filter(wrong), ...all.filter(d => !wrong(d))];
    const planned = trial ? [trial] : [];
    for (const draw of order) {
      if (subs[draw.i] !== undefined || !reach(draw)) continue;
      for (const v of candidates(draw, run.steer, wide)) {
        const rec = found.get(`${draw.i}|${v}`);
        if (!rec || !holds(rec)) planned.push({ ...subs, [draw.i]: v });
      }
    }
    ask.ahead(planned.slice(0, budget - probes));

    if (trial) {
      const probe = await ask.get(trial);
      probes++;
      const after = drawsOf(probe.trace, t);
      let shiftAt = Infinity;
      for (let k = 0; k < Math.min(all.length, after.length); k++) {
        const x = all[k];
        const y = after[k];
        if (x.i !== y.i || x.lo !== y.lo || x.hi !== y.hi || x.chance !== y.chance || x.at !== y.at) {
          shiftAt = Math.min(x.i, y.i);
          break;
        }
      }
      if (shiftAt === Infinity && after.length < all.length) shiftAt = all[after.length].i;
      const kept = fixes.filter(d => d.i < shiftAt);
      if (kept.length === fixes.length && outranks(scoreOf(probe, t), score)) {
        ask.cancel();
        const prevLines = score[0];
        for (const d of fixes) commit(d.i, trial[d.i], shapeOf(d));
        run = await runTo(common, subs, t, t);
        score = scoreOf(run, t);
        await dropShifted(prevLines);
        noteClean();
        if (score[0] > prevLines) tried = null;
        if (onTrial && score[0] > onTrial.lines) onTrial = null;
        if (fieldTrial && score[0] > fieldTrial.lines) fieldTrial = null;
        if (bestFieldStash && score[0] > bestFieldStash.lines) bestFieldStash = null;
        continue;
      }
      if (kept.length > 0 && kept.length < fixes.length && probes < budget) {
        const subTrial = { ...subs };
        for (const d of kept) subTrial[d.i] = trial[d.i];
        const subProbe = await ask.get(subTrial);
        probes++;
        if (outranks(scoreOf(subProbe, t), score)) {
          ask.cancel();
          const prevLines = score[0];
          for (const d of kept) commit(d.i, subTrial[d.i], shapeOf(d));
          run = await runTo(common, subs, t, t);
          score = scoreOf(run, t);
          await dropShifted(prevLines);
          noteClean();
          if (score[0] > prevLines) tried = null;
          if (onTrial && score[0] > onTrial.lines) onTrial = null;
          if (fieldTrial && score[0] > fieldTrial.lines) fieldTrial = null;
          if (bestFieldStash && score[0] > bestFieldStash.lines) bestFieldStash = null;
          continue;
        }
      }
    }

    for (const draw of order) {
      if (subs[draw.i] !== undefined || !reach(draw)) continue;
      const same = v => run.steer?.get(draw.i)?.groups.get(v) || [v];

      let best = score;
      const winners = [];
      for (const v of candidates(draw, run.steer, wide)) {
        const key = `${draw.i}|${v}`;
        let rec = found.get(key);
        if (!rec || !holds(rec)) {
          if (probes >= budget) { cut = 'probes'; break; }
          const probe = await ask.get({ ...subs, [draw.i]: v });
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
      const pick = { i: draw.i, value: winners[sample.pick(winners.length)], best, shape: shapeOf(draw) };
      if (best[0] === score[0]) {
        if (!fallback || outranks(best, fallback.best)) fallback = pick;
        continue;
      }
      commit(pick.i, pick.value, pick.shape);
      committed = true;
      break;
    }

    // Before settling for a draw that only gets more of the line right, the
    // wide dice are tried between their ends.
    ask.cancel();
    if (!committed && !wide) {
      wide = true;
      continue;
    }
    const inPlace = fallback && fallback.best[1] === score[1];
    const fbKey = fallback && `${commits.length}|${score[0]}|${fallback.i}=${fallback.value}`;
    if (!committed && fallback && !deadTrials.has(fbKey) && !(inPlace && onTrial)) {
      if (inPlace) onTrial = { at: commits.length, lines: score[0], key: fbKey };
      else if (!fieldTrial) fieldTrial = { at: commits.length, lines: score[0], key: fbKey };
      commit(fallback.i, fallback.value, fallback.shape);
      committed = true;
    }
    if (!committed && (onTrial || fieldTrial)) {
      if (onTrial) {
        if (onTrial.key) deadTrials.add(onTrial.key);
        takeBack();
      }
      if (fieldTrial) {
        const stashed = [];
        for (const { i, prev, prevShape } of commits.splice(fieldTrial.at).reverse()) {
          if (subs[i] === undefined) continue;
          stashed.unshift({ i, value: subs[i], shape: ownShape.get(i) });
          if (prev === undefined) {
            delete subs[i];
            delete subTurn[i];
            ownShape.delete(i);
            moved.push(i);
            forced--;
          } else {
            subs[i] = prev;
            if (prevShape !== undefined) ownShape.set(i, prevShape);
            else ownShape.delete(i);
            moved.push(i);
          }
        }
        if (stashed.length && fieldTrial.key) deadTrials.add(fieldTrial.key);
        if (stashed.length && (!bestFieldStash || outranks(score, bestFieldStash.score))) {
          bestFieldStash = { lines: fieldTrial.lines, score, entries: stashed };
        }
        fieldTrial = null;
      }
      run = await runTo(common, subs, t, t);
      score = scoreOf(run, t);
      reach = canReach(common, run, t, { strictMove: true });
      all = drawsOf(run.trace, t);
      order = [...all.filter(wrong), ...all.filter(d => !wrong(d))];
    }

    // Two decision dice flipped together: a spread move's secondary that came
    // up on one target and not the other, a speed tie or random target paired
    // with a flinch, or a chance together with a die flipping it exposes or
    // shifts into place (Dire Claw's status pick, Poison Touch or Flame Body
    // behind it, Quick Claw behind Quick Draw, full paralysis behind a flinch).
    // Any non-damage-roll die is in scope: binary/small choices in full, wide
    // and chance dice at their ends.
    let comboFallback = null;
    if (!committed) {
      const isDecision = d => d.chance || d.hi - d.lo + 1 !== ROLLS;
      const endsOf = (d, steer = null) => {
        const fits = steer?.get(d.i);
        if (fits) return fits.reps;
        return d.chance || d.hi - d.lo + 1 > ROLLS
          ? [d.lo, d.hi].filter(v => v !== d.value)
          : candidates(d);
      };
      const sigOf = d => `${d.lo}-${d.hi}-${d.chance ? 1 : 0}`;
      const before = new Map(all.map(d => [d.i, sigOf(d)]));
      const beforeAt = new Map(all.map(d => [d.i, d.at]));
      const chances = all.filter(d => isDecision(d) && subs[d.i] === undefined);
      const comboSlot = `${commits.length}|${score[0]}`;
      const considerCombo = (entries, probeScore) => {
        if (probeScore[0] > score[0]) {
          for (const [i, v, sh] of entries) commit(i, v, sh);
          committed = true;
          return true;
        }
        if (outranks(probeScore, score) && !deadComboAt.has(comboSlot)) {
          const comboInPlace = probeScore[1] === score[1];
          const comboKey = `${comboSlot}|${entries.map(([i, v]) => `${i}=${v}`).join(',')}`;
          if (!deadTrials.has(comboKey) && !(comboInPlace && onTrial)
            && (!comboFallback || outranks(probeScore, comboFallback.best))) {
            comboFallback = { entries, best: probeScore, key: comboKey, slot: comboSlot };
          }
        }
        return false;
      };
      const splitAfter = (a, rec) => {
        const reachFlip = canReach(common, rec, t, { strictMove: true });
        const same = [];
        const brought = [];
        let shifted = false;
        let movedAt = false;
        for (const b of drawsOf(rec.trace, t)) {
          if (b.i <= a.i) continue;
          if (before.get(b.i) !== sigOf(b)) shifted = true;
          if (beforeAt.get(b.i) !== b.at) movedAt = true;
          if (subs[b.i] !== undefined || !isDecision(b) || !reachFlip(b)) continue;
          const vs = endsOf(b, shifted || movedAt ? null : run.steer);
          if (!vs.length) continue;
          (shifted ? brought : same).push({ b, vs });
        }
        return { reachFlip, same, brought };
      };

      const flips = [];
      for (const a of chances) {
        if (!reach(a)) continue;
        for (const va of endsOf(a, run.steer)) {
          const key = `${a.i}|${va}`;
          let rec = found.get(key);
          if (!rec || !holds(rec)) {
            if (probes >= budget) { cut = 'probes'; break; }
            const flipped = await ask.get({ ...subs, [a.i]: va });
            probes++;
            rec = remember(flipped);
            found.set(key, rec);
          }
          flips.push({ a, va, rec, ...splitAfter(a, rec) });
        }
        if (cut) break;
      }

      if (!cut) {
        const pairPlan = [];
        for (const { a, va, same } of flips) {
          for (const { b, vs } of same) {
            for (const vb of vs) pairPlan.push({ ...subs, [a.i]: va, [b.i]: vb });
          }
        }
        for (const { a, va, brought } of flips) {
          for (const { b, vs } of brought) {
            for (const vb of vs) pairPlan.push({ ...subs, [a.i]: va, [b.i]: vb });
          }
        }
        ask.ahead(pairPlan.slice(0, budget - probes));

        const uncovered = [];
        const collectUncovered = (a, va, rec, reachFlip, b, vb, probe) => {
          const recReachSigs = new Map(drawsOf(rec.trace, t).filter(d => d.i > b.i && reachFlip(d)).map(d => [d.i, sigOf(d)]));
          const probeReach = canReach(common, probe, t, { strictMove: true });
          for (const c of drawsOf(probe.trace, t)) {
            if (c.i <= b.i || subs[c.i] !== undefined || !isDecision(c) || !probeReach(c)) continue;
            if (recReachSigs.get(c.i) === sigOf(c)) continue;
            const vcs = endsOf(c);
            if (vcs.length) uncovered.push({ a, va, b, vb, c, vcs });
          }
        };

        pairs: for (const { a, va, rec, reachFlip, same } of flips) {
          for (const { b, vs } of same) {
            for (const vb of vs) {
              if (probes >= budget) { cut = 'probes'; break pairs; }
              const probe = await ask.get({ ...subs, [a.i]: va, [b.i]: vb });
              probes++;
              if (considerCombo([[a.i, va, shapeOf(a)], [b.i, vb, shapeOf(b)]], scoreOf(probe, t))) break pairs;
              collectUncovered(a, va, rec, reachFlip, b, vb, probe);
            }
          }
        }

        if (!committed && !cut) {
          brought: for (const { a, va, rec, reachFlip, brought } of flips) {
            for (const { b, vs } of brought) {
              for (const vb of vs) {
                if (probes >= budget) { cut = 'probes'; break brought; }
                const probe = await ask.get({ ...subs, [a.i]: va, [b.i]: vb });
                probes++;
                if (considerCombo([[a.i, va, shapeOf(a)], [b.i, vb, shapeOf(b)]], scoreOf(probe, t))) break brought;
                collectUncovered(a, va, rec, reachFlip, b, vb, probe);
              }
            }
          }
        }
        ask.cancel();

        // A pair that clears both a masking proc and a second blocker between
        // it and the real line (Dire Claw + Flame Body before Poison Touch, or
        // two flinches before full paralysis) only brings the third die into
        // reach once both earlier dice are flipped.
        if (!committed && !cut && !comboFallback && uncovered.length) {
          const triplePlan = [];
          for (const { a, va, b, vb, c, vcs } of uncovered) {
            for (const vc of vcs) triplePlan.push({ ...subs, [a.i]: va, [b.i]: vb, [c.i]: vc });
          }
          ask.ahead(triplePlan.slice(0, budget - probes));
          triples: for (const { a, va, b, vb, c, vcs } of uncovered) {
            for (const vc of vcs) {
              if (probes >= budget) { cut = 'probes'; break triples; }
              const probe = await ask.get({ ...subs, [a.i]: va, [b.i]: vb, [c.i]: vc });
              probes++;
              if (considerCombo([[a.i, va, shapeOf(a)], [b.i, vb, shapeOf(b)], [c.i, vc, shapeOf(c)]], scoreOf(probe, t))) break triples;
            }
          }
          ask.cancel();
        }
      }
    }

    // An earlier hit in this turn on a Pokemon shown as a percentage settled
    // one of the rolls that print that percentage before a later line in the
    // same turn read the exact HP or damage it left - Counter, Mirror Coat or
    // Metal Burst, a recoil or drain, or a second hit on it. Try its other
    // rolls that print the same line, uniformly first, then any shifted draw,
    // and last paired with a later settled draw.
    const settled = !committed && !cut ? new Set(commits.map(c => c.i).filter(i => subs[i] !== undefined)) : null;
    const sameFace = (steer, i, v) => steer?.get(i)?.groups.get(v) || [v];
    const revisable = settled ? all.filter(d => settled.has(d.i) && reach(d) && !wrong(d) && run.steer?.get(d.i)?.reps.length) : [];
    if (!committed && !cut && revisable.length) {
      for (const d of revisable.slice().reverse()) {
        let best = score;
        const winners = [];
        for (const v of run.steer.get(d.i).reps) {
          if (v === subs[d.i]) continue;
          if (probes >= budget) { cut = 'probes'; break; }
          const probe = await ask.get({ ...subs, [d.i]: v });
          probes++;
          const s = scoreOf(probe, t);
          if (s[0] > best[0] || (s[0] > score[0] && outranks(s, best))) {
            best = s;
            winners.length = 0;
            winners.push(...sameFace(run.steer, d.i, v));
          } else if (s[0] > score[0] && ties(s, best)) {
            winners.push(...sameFace(run.steer, d.i, v));
          }
        }
        if (winners.length) {
          commit(d.i, winners[sample.pick(winners.length)], shapeOf(d));
          committed = true;
          break;
        }
        if (cut) break;
      }
    }

    // A draw committed earlier in this turn's scan can shift onto a later roll
    // of the same shape once an earlier draw before it changes, or pick a face
    // within a percentage band that blocks a later line in the same turn.
    if (!committed && !cut && ownShape.size) {
      reprobe: for (const d of order) {
        if (!ownShape.has(d.i) || !reach(d)) continue;
        const next = { ...subs };
        delete next[d.i];
        const faces = [undefined, ...candidates(d, run.steer, true).filter(v => v !== subs[d.i])];
        for (const v of faces) {
          if (probes >= budget) { cut = 'probes'; break reprobe; }
          const probe = await ask.get(v === undefined ? next : { ...next, [d.i]: v });
          probes++;
          if (scoreOf(probe, t)[0] > score[0]) {
            if (v === undefined) {
              delete subs[d.i];
              delete subTurn[d.i];
              ownShape.delete(d.i);
              moved.push(d.i);
              forced--;
            } else {
              commit(d.i, v, shapeOf(d));
            }
            committed = true;
            break reprobe;
          }
        }
      }
      ask.cancel();
    }

    if (!committed && !cut && revisable.length) {
      paired: for (const a of revisable) {
        for (const va of run.steer.get(a.i).reps) {
          if (va === subs[a.i]) continue;
          if (probes >= budget) { cut = 'probes'; break paired; }
          const flipped = await runTo(common, { ...subs, [a.i]: va }, t, t);
          probes++;
          if (scoreOf(flipped, t)[0] > score[0]) {
            const faces = sameFace(run.steer, a.i, va);
            commit(a.i, faces[sample.pick(faces.length)], shapeOf(a));
            committed = true;
            break paired;
          }
          const later = drawsOf(flipped.trace, t).filter(b => b.i > a.i && settled.has(b.i) && flipped.steer?.get(b.i)?.reps.length);
          for (const b of later) {
            for (const vb of flipped.steer.get(b.i).reps) {
              if (vb === subs[b.i]) continue;
              if (probes >= budget) { cut = 'probes'; break paired; }
              const probe = await ask.get({ ...subs, [a.i]: va, [b.i]: vb });
              probes++;
              if (scoreOf(probe, t)[0] > score[0]) {
                const fa = sameFace(run.steer, a.i, va);
                const fb = sameFace(flipped.steer, b.i, vb);
                commit(a.i, fa[sample.pick(fa.length)], shapeOf(a));
                commit(b.i, fb[sample.pick(fb.length)], shapeOf(b));
                committed = true;
                break paired;
              }
            }
          }
        }
      }
      ask.cancel();
    }

    if (!committed && !cut && comboFallback) {
      deadComboAt.add(comboFallback.slot);
      if (comboFallback.best[1] === score[1]) onTrial = { at: commits.length, lines: score[0], key: comboFallback.key };
      else fieldTrial = { at: commits.length, lines: score[0], key: comboFallback.key };
      for (const [i, v, sh] of comboFallback.entries) commit(i, v, sh);
      committed = true;
    }

    ask.cancel();
    if (!committed) break;
    const prevLines = score[0];
    run = await runTo(common, subs, t, t);
    score = scoreOf(run, t);
    await dropShifted(prevLines);
    noteClean();
    if (score[0] > prevLines) tried = null;
    if (onTrial && score[0] > onTrial.lines) onTrial = null;
    if (fieldTrial && score[0] > fieldTrial.lines) fieldTrial = null;
    if (bestFieldStash && score[0] > bestFieldStash.lines) bestFieldStash = null;
  }
  // Why the search of this turn ended: the turn reproduces, the simulator
  // refused a choice, a limit left a candidate untried, or every candidate was
  // tried and no die and no pair of them carried the turn further. Only the
  // first two are answers; the rest prove nothing about the guess.
  const ended = score[0] === Infinity ? 'solved' : (score[0] === -1 || score[1] === -1) ? 'refused' : cut || 'stuck';
  if (ended === cut && !(deferProbeLimit && cut === 'probes')) common.limits.add(cut);
  if (onTrial) {
    takeBack();
    run = await runTo(common, subs, t, t);
    score = scoreOf(run, t);
  }
  if (!fieldTrial && bestFieldStash && bestFieldStash.lines === score[0]) {
    for (const { i, value, shape } of bestFieldStash.entries) commit(i, value, shape);
    run = await runTo(common, subs, t, t);
    score = scoreOf(run, t);
  }

  count('turns searched');
  count(score[0] === Infinity ? 'probes on turns the search solved' : 'probes on turns it left unsolved', probes);
  return {
    solved: score[0] === Infinity,
    rejected: score[0] === -1 || score[1] === -1,
    ended,
    forced,
    probes,
    score,
    tried,
    clean,
    diff: run.diffs[0] || null,
  };
}

/**
 * The turns that moved the HP of the Pokemon a failing line names, latest
 * first, or the turn before the failure when none did.
 *
 * A percentage that will not come out right is rarely the fault of the turn it
 * appears in: the HP behind it was decided the last time the Pokemon actually
 * took damage, which can be many turns earlier - a Pokemon can sit at `35/100`
 * through a Protect, a switch and two turns off the field. Redrawing the turn
 * just before the failure would leave that number exactly where it was. And
 * the HP that turn could leave depends on the HP the hit before it left: a
 * Kingambit on 19% can be on 40 or 41, and which of them a Flamethrower
 * reaches depends on which of 176 and 177 the Ice Punch before it left. So a
 * line that stays out of reach blames each of these turns in its turn.
 *
 * `switch` is deliberately not counted. It shows the HP again; it never sets it.
 */
function blameTurns(segments, t, line) {
  const who = identName(String(line || '').split('|')[2]);
  const out = [];
  if (who) {
    for (let k = t - 1; k >= 1; k--) {
      const moved = segments[k].some((observed) => {
        const parts = observed.split('|');
        return ['-damage', '-heal', '-sethp'].includes(parts[1]) && identName(parts[2]) === who;
      });
      if (moved) out.push(k);
    }
  }
  return out.length ? out : [t - 1];
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
  if (channel === -1 || !/^\|-(damage|heal)\|/.test(text)) return null;
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

/**
 * A Pokemon's exact HP at the end of a raw log, or null if it never appears.
 * A line split by side prints the exact HP first and the public one after
 * it: only the first is read, or a Pokemon shown as a percentage would read as
 * that percentage, the same whatever its HP.
 */
function exactHp(rawLog, who) {
  let hp = null;
  for (const [i, line] of rawLog.entries()) {
    if (i >= 2 && String(rawLog[i - 2]).startsWith('|split|')) continue;
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
async function redrawTurn(t, common, subs, subTurn, sample, budget, who, strict = false, failing = null, tried = null, alternatives = []) {
  const run = await runTo(common, subs, t, t);
  if (scoreOf(run, t)[0] !== Infinity) return false;
  const was = who ? exactHp(run.rawLog, who) : null;

  const options = [];
  const moving = [];
  let probes = 0;
  const draws = drawsOf(run.trace, t);
  const ask = prober(common, t);
  ask.ahead(draws.flatMap(draw => candidates(draw, run.steer).map(v => ({ ...subs, [draw.i]: v }))).slice(0, budget));
  for (const draw of draws) {
    for (const v of candidates(draw, run.steer)) {
      if (probes >= budget) { common.limits.add('redrawProbes'); break; }
      const probe = await ask.get({ ...subs, [draw.i]: v });
      probes++;
      if (scoreOf(probe, t)[0] !== Infinity) continue;
      const found = (run.steer?.get(draw.i)?.groups.get(v) || [v]).map(value => ({ i: draw.i, value, subHps: probe.subHps }));
      options.push(...found);
      // Most of a turn's dice have nothing to do with the Pokemon that is stuck.
      // Only the ones that actually move its HP are worth spending a backtrack
      // on; the rest would redraw the turn and change nothing that matters.
      if (who && exactHp(probe.rawLog, who) !== was) moving.push(...found);
    }
  }
  ask.cancel();
  // A die whose face shows nowhere in its own turn - how long Thrash locks its
  // user, how long a sleep or a Taunt lasts, or how much HP a Substitute kept -
  // decides a later one. When no die here moves the stuck Pokemon's HP, the
  // ones that bring the failing turn closer to the observation - or leave a
  // Substitute that fails on a later hit closer to holding or breaking there -
  // are the ones worth a backtrack.
  if (!moving.length && failing !== null && failing > t && options.length) {
    const beforeRun = await runTo(common, { ...subs, ...tried }, failing);
    const before = scoreOf(beforeRun, failing);
    const subLine = l => /^\|(-end|-activate)\|(p[1-4])[a-d]?: ([^|]+)\|(?:move: )?Substitute(\||$)/.exec(String(l || ''));
    const expSub = subLine(beforeRun.diffs[0]?.expected);
    const actSub = subLine(beforeRun.diffs[0]?.actual);
    const sameSub = expSub && actSub && expSub[2] === actSub[2] && expSub[3] === actSub[3]
      && !common.segments.slice(t + 1, failing).some(seg => seg.some((l) => {
        const m = /^\|-start\|(p[1-4])[a-d]?: ([^|]+)\|Substitute(\||$)/.exec(String(l || ''));
        return m && m[1] === expSub[2] && m[2] === expSub[3];
      }));
    const subKey = sameSub ? `${expSub[2]}:${expSub[3]}` : null;
    const wasSub = subKey ? run.subHps?.[subKey] : undefined;
    const subBetter = [];
    for (const option of options) {
      const afterRun = await runTo(common, { ...subs, ...tried, [option.i]: option.value }, failing);
      const after = scoreOf(afterRun, failing);
      if (after[0] > before[0] || (after[0] === before[0] && after[1] > before[1])) {
        moving.push(option);
      } else if (wasSub !== undefined && option.subHps?.[subKey] !== undefined && after[0] === before[0] && after[1] === before[1]) {
        const delta = expSub[1] === '-activate' ? option.subHps[subKey] - wasSub : wasSub - option.subHps[subKey];
        if (delta > 0) subBetter.push({ option, delta });
      }
    }
    if (!moving.length && subBetter.length) {
      const bestDelta = Math.max(...subBetter.map(x => x.delta));
      moving.push(...subBetter.filter(x => x.delta === bestDelta).map(x => x.option));
    }
    // Such a die can need another of the failing turn's unseen choices with it:
    // a sleep one turn longer only shows when the sleeper's own unseen move is
    // the Protect that puts it first. So under the failing turn's other hidden
    // choices, one of each outcome its search saw, the dice are judged again,
    // on the same budget as the candidates.
    const keep = common.variants[failing];
    for (const alt of alternatives) {
      if (moving.length || probes >= budget) break;
      if (alt === keep) continue;
      common.variants[failing] = alt;
      const was = scoreOf(await runTo(common, subs, failing), failing);
      for (const option of options) {
        if (probes >= budget) { common.limits.add('redrawProbes'); break; }
        probes++;
        const after = scoreOf(await runTo(common, { ...subs, [option.i]: option.value }, failing), failing);
        if (after[0] > was[0] || (after[0] === was[0] && after[1] > was[1])) moving.push(option);
      }
    }
    common.variants[failing] = keep;
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
 * @param formatid     e.g. `gen9championsvgc2026regmc`
 * @param packedTeams  both teams, packed, stat points included
 * @param playerNames  both names, as the observed `|player|` lines carry them
 * @param observed     the observed protocol lines
 * @param channel      -1 if the observation is omniscient, 1 or 2 if it is that player's
 *                     view, 0 if it is a spectator's
 * @param seed         the real seed when it is known; otherwise searched
 * @param sampleSeed   fixes the seed search, so a reconstruction is reproducible
 * @param exact        turn -> the same turn's lines with every HP exact, compared on
 *                     the omniscient channel instead. Stat Point inference supplies
 *                     it: where the evidence has proved which exact HP a percentage
 *                     hid, sampling it again can only pick wrong.
 * @param pins         `{ subs, turns, proof }`: draws already settled, by ordinal, and the turn
 *                     each belongs to. Stat Point inference supplies the dice that
 *                     rebuild its proved turns, so only the turn after them is
 *                     searched. A pin on a turn that fails is dropped and searched.
 *                     `proof`, the dice and choices the proof was read under, only
 *                     says whether the first run broke it (`brokenProof`).
 * @param threads      how many threads the dice search may use, this one included;
 *                     the machine's own count by default. The answer is the same
 *                     for any count.
 * @param deadline     a time from Date.now() past which no turn is searched further and
 *                     the furthest rebuild so far is the answer - for a page that
 *                     waits on it; none by default, so the answer never depends
 *                     on the machine's speed.
 * @returns the input log and the log it prints, the dice it pins, every die its
 *          last run threw as the RNG engine's trace rows (`dice`: `i`, `from`,
 *          `to`, `value`, `mark`, `chance`) and every choice it wrote
 *          (`choices`: `turn`, `side`, `choice`), where its first run broke the
 *          proof it was handed (`brokenProof`), and the `report`. A rebuild
 *          that fails also gives the hidden choices the search walked on the
 *          turn it failed on, the last time it searched it (`variantsTried`:
 *          `turn`, and per variant its index, the choices it wrote on the turn,
 *          `score`, the turn's `scoreOf` with its dice as drawn, by which the
 *          variants are ranked, and `searched`, the score once its dice were
 *          searched, or null) - with `dice`, what a harness that played the
 *          battle needs to hold the search against it, read off runs the
 *          search made anyway. What the search spent is in the report:
 *          `attempts`, every run of the battle the search played - from turn 0
 *          or from a snapshot, here or on a worker, the probes of a redrawn
 *          turn and its look-ahead to the failing one included, and none a
 *          worker ran ahead that was never asked for; `backtracks`, the
 *          earlier turns redrawn for a failing HP figure, and `dieBacktracks`,
 *          those redrawn for any other line - each counts the redraw one past
 *          its budget that ends the search, which is never played. Why it
 *          ended is `stop`: `complete`; `refused`, a choice the simulator
 *          would not take; `choiceRounds`, a turn still asking for choices
 *          after 24 rounds of them; `stuck`, no earlier turn had a die worth
 *          redrawing; `backtracks` or `dieBacktracks`, past their budget;
 *          `deadline`. `limits` names every limit that left a candidate
 *          untried in a search that then failed, even where the rebuild got
 *          past that turn later: `probes`, a turn's dice search; `redrawProbes`,
 *          a redraw's; `variants`, a turn with more combinations of invisible
 *          choices than `maxVariants`; `choiceRounds`; the two backtrack
 *          budgets; `deadline`. Only `complete` is an answer: a rebuild that
 *          stopped any other way proves nothing about the guess.
 */
async function reconstructOnce({
  formatid,
  packedTeams,
  // The sides whose spreads are guesses, whose max HP proves nothing alone.
  guessed = null,
  playerNames,
  observed,
  forced = null,
  throughTurn = null,
  channel = -1,
  seed = null,
  seedPlan = null,
  sampleSeed = 1,
  maxProbes = 4000,
  maxVariants = MAX_VARIANTS,
  maxBacktracks = 6,
  maxDieBacktracks = DIE_BACKTRACKS,
  exact = null,
  pins = null,
  threads = os.availableParallelism(),
  deadline = Infinity,
  onProgress = () => {},
}) {
  const dex = Dex.forFormat(formatid);
  const lines = observed.filter(l => typeof l === 'string');
  const fullSegments = splitTurns(lines);
  if (fullSegments.length < 2) throw new Error('observed log has no complete turn');

  // Who was really sent in, and who really acted, is planned from the log with
  // every Illusion seen through; the turns are still compared as shown.
  const sheets = sheetsOf(formatid, packedTeams, channel, guessed);
  const unmasked = unmaskWithSheet(lines, sheets, forced);
  const fullPlans = splitTurns(unmasked.lines).map(s => planSegment(s, dex));
  recoverChargeTargets(fullPlans);
  const segLimit = throughTurn === null ? fullSegments.length : Math.min(fullSegments.length, throughTurn + 1);
  const segments = fullSegments.slice(0, segLimit);
  const plans = fullPlans.slice(0, segLimit);
  const cutEarly = segLimit < fullSegments.length;

  const sample = sampler(sampleSeed);
  const avatar = avatars(lines);
  const startSeed = seed || sampler(sampleSeed ^ 0x5eed).seed();
  const header = [
    `>start ${JSON.stringify({ formatid, seed: startSeed })}`,
    `>player p1 ${JSON.stringify({ name: playerNames[0], avatar: avatar.p1, team: packedTeams[0] })}`,
    `>player p2 ${JSON.stringify({ name: playerNames[1], avatar: avatar.p2, team: packedTeams[1] })}`,
  ];

  const state0 = {
    reveal: revealOrder(unmasked.lines),
    sizes: teamSizes(lines),
    disguises: unmasked.disguises,
    sheets,
    rawLines: lines,
    unmaskedLines: unmasked.lines,
  };
  const reseeds = new Array(segments.length).fill(null);
  const variants = new Array(segments.length).fill(0);
  for (const [k, v] of Object.entries(pins?.variants || {})) {
    const idx = Number(k);
    if (idx >= 0 && idx < variants.length && v >= 0) variants[idx] = v;
  }
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
  const localExact = exact ? new Map(exact) : null;
  const common = {
    header, segments, plans, reseeds, variants, channel, exact: localExact, state0, dex, formatid, cutEarly, deadline,
    id: ++contextCount, snaps: new Map(), pool: probePool(threads, formatid), tally: { plays: 0 }, radices: {}, maxVariants,
    // Every limit that cut a search short somewhere in this rebuild, even one
    // that later got past the turn some other way (`report.limits`).
    limits: new Set(),
  };
  let backtracks = 0;
  // A backtrack to a die proved to bring the failing turn closer costs a few
  // probes, not a guess, so it has a budget of its own.
  let dieBacktracks = 0;
  let forcedDraws = 0;

  // Every variant walked on a turn: up to `maxVariants`, and when unseen
  // choices fill the low digits (`radices`), each visible target choice at
  // `low = 0` (`h * unseen`) too, so unseen moves never starve a target.
  const variantList = (all, unseen) => {
    const w = Math.min(all, maxVariants);
    const out = [...Array(w).keys()];
    if (unseen > 1) {
      for (let v = unseen; v < all && out.length < w + maxVariants; v += unseen) {
        if (v >= w) out.push(v);
      }
    }
    return out;
  };

  let run = await playThrough({ ...common, subs });
  // Before judging or dropping handed-in pins on a turn with unseen choices,
  // try its other variants: a choice the replay never showed - a fainted or
  // flinched Pokemon's move - can need another slot once a Speed moves, while
  // every die settled on and after that turn still stands.
  if (pins) {
    const recovered = new Set();
    while (run.badTurn !== null && !recovered.has(run.badTurn) && Date.now() < deadline) {
      const t = run.badTurn;
      recovered.add(t);
      const known = localExact?.get(t);
      if (known?.partial && run.diffs[0]?.index >= compareTurn(common, t, []).exactUpTo) break;
      const hasDownstreamPins = Object.keys(subs).some(i => subTurn[i] >= t) || variants.slice(t + 1).some(Boolean);
      if (!hasDownstreamPins && !pins.proof) break;
      const keep = variants[t] || 0;
      const tVariants = variantList(run.widths?.[t] || 1, common.radices[t] || 0);
      let advanced = false;
      for (const v of tVariants) {
        if (advanced || Date.now() >= deadline) break;
        if (v === keep) continue;
        variants[t] = v;
        const probe = await runTo(common, subs, t);
        advanced = probe.badTurn === null || probe.badTurn > t;
      }
      if (!advanced) {
        variants[t] = keep;
        break;
      }
      run = await playThrough({ ...common, subs });
    }
  }
  const broken = brokenProof(common, run, pins?.proof);
  // A handed-in pin is only as good as the turn it rebuilds: a spread that
  // throws a different sequence of dice there moves every ordinal after it. On
  // a turn proved only in part, the pins stand as long as that part holds.
  if (run.badTurn !== null && (Object.keys(subs).some(i => subTurn[i] >= run.badTurn) || variants.slice(run.badTurn).some(Boolean))) {
    const t = run.badTurn;
    const known = localExact?.get(t);
    const held = known?.partial && run.diffs[0]?.index >= compareTurn(common, t, []).exactUpTo;
    const clearFrom = held ? t + 1 : t;
    forget(clearFrom);
    for (let k = clearFrom; k < variants.length; k++) variants[k] = 0;
    run = await playThrough({ ...common, subs });
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

  // The hidden choices each turn's search walked, the last time it searched
  // that turn: per variant, the choices it wrote on the turn, the score the
  // turn got with its dice as drawn, by which the variants are ranked, and the
  // score once its dice were searched, if they were.
  const variantsAt = new Map();
  const choicesOn = (r, t) => (r.choices || []).filter(c => c.turn === t).map(({ side, choice }) => ({ side, choice }));

  // Why the search ended, when the rebuild did not reproduce the whole log.
  let stop = null;
  // Each earlier choice taken for a turn it carried into, taken once.
  const takenCarry = new Set();
  // How often each failing HP line has been backtracked from, to blame each
  // turn that moved its Pokemon's HP in its turn.
  const blamed = new Map();
  while (run.badTurn !== null) {
    if (Date.now() >= deadline) { stop = 'deadline'; common.limits.add('deadline'); break; }
    const t = run.badTurn;

    onProgress(`turn ${t}: settling draws - observed ${run.diffs[0]?.expected ?? '(nothing)'}`);

    let solved = false;
    // The hidden choices the turn came with: not always the first - a turn
    // searched again after a carried choice moved keeps the one it held.
    const entering = variants[t] || 0;
    const walked = [{ variant: entering, choices: choicesOn(run, t), score: scoreOf(run, t), searched: null }];
    variantsAt.set(t, walked);

    // A turn that cannot be finished is still worth what it got through, and
    // trying the next variant means clearing it. So the furthest attempt is held
    // aside and put back if nothing better turns up.
    let partial = null;
    const consider = (score, variant, tried, clean = null) => {
      const at = [t, ...score];
      if (!partial || ahead(at, partial.at)) {
        partial = {
          at,
          variant,
          subs: { ...subs },
          subTurn: { ...subTurn },
          tried,
          clean: clean || { score, subs: { ...subs }, subTurn: { ...subTurn }, trace: [] },
        };
      }
    };

    // Walk every unseen choice once under the turn's dice as drawn before
    // spending probes on one: a flinched or fainted Pokemon's real move that
    // sorts where the replay has it gets further right away. With more than one
    // distinct choice outcome, per-variant probe slices hold budget back so
    // `rewalk` and other priority brackets have probes left; if nothing beats
    // the furthest capped variant, it gets the rest.
    const enteringSubs = { ...subs };
    const enteringSubTurn = { ...subTurn };
    const restoreEntering = () => {
      for (const k of Object.keys(subs)) delete subs[k];
      for (const k of Object.keys(subTurn)) delete subTurn[k];
      Object.assign(subs, enteringSubs);
      Object.assign(subTurn, enteringSubTurn);
    };
    const allVariants = run.widths?.[t] || 1;
    const turnVariants = variantList(allVariants, common.radices[t] || 0);
    const hasHidden = (run.hidden || []).includes(t) && turnVariants.length > 1;
    const ranked = [{
      v: entering,
      score: walked[0].score,
      rejected: run.diffs[0]?.index === -1,
      actual: run.diffs[0]?.actual ?? '',
      prios: run.invisiblePrios?.[t] || [],
    }];
    for (const v of turnVariants) {
      if (solved) break;
      if (v === entering) continue;
      variants[t] = v;
      forget(t);
      const probe = await runTo(common, subs, t);
      const score = scoreOf(probe, t);
      walked.push({ variant: v, choices: choicesOn(probe, t), score, searched: null });
      if (probe.badTurn === null || probe.badTurn > t) { solved = true; break; }
      ranked.push({
        v,
        score,
        rejected: probe.diffs[0]?.index === -1,
        actual: probe.diffs[0]?.actual ?? '',
        prios: probe.invisiblePrios?.[t] || [],
      });
    }
    ranked.sort((a, b) => (outranks(b.score, a.score) ? 1 : outranks(a.score, b.score) ? -1
      : (a.v === entering ? -1 : b.v === entering ? 1 : a.v - b.v)));

    let hitProbes = false;
    const searchedVariants = new Set();
    const cappedVariants = new Set();
    const searchVariant = async (v, cap) => {
      const rem = maxProbes - spent[t];
      const slice = cap === undefined ? rem : Math.min(rem, cap);
      const got = await resolveTurn(t, common, subs, subTurn, sample, slice, { deferProbeLimit: slice < rem });
      spent[t] += got.probes;
      forcedDraws += got.forced;
      if (got.ended === 'probes') { hitProbes = true; cappedVariants.add(v); }
      else cappedVariants.delete(v);
      return got;
    };

    const nonRejectedCount = ranked.filter(r => !r.rejected).length;
    let firstStopDiff = run.diffs[0] || null;
    if (!solved && ranked.length) {
      const first = ranked[0];
      searchedVariants.add(first.v);
      variants[t] = first.v;
      if (first.v === entering) restoreEntering();
      else forget(t);
      // A rejected choice is a legality problem, not an RNG one - no die can
      // make the simulator accept a choice it refused.
      if (!first.rejected) {
        const rem = maxProbes - spent[t];
        const cap = nonRejectedCount > 1 ? Math.ceil(rem / 2) : rem;
        const got = await searchVariant(first.v, cap);
        firstStopDiff = got.diff;
        const w = walked.findLast(x => x.variant === first.v);
        if (w) w.searched = got.score;
        if (got.solved) solved = true;
        else consider(got.score, first.v, got.tried, got.clean);
      } else {
        consider(first.score, first.v, null);
      }
    }

    // The dice the search settled under one hidden choice can be the ones
    // another needs: the damage roll found under a substituted move is the roll
    // a Follow Me or Trick Room needs too, and under the dice as first drawn
    // every choice stopped at that roll alike. So the choices are walked again
    // under the furthest attempt's clean dice, and one that gets past the line
    // it stopped on is searched on with its share of what the turn's budget has left.
    let rewalkedFrom = null;
    const rewalkTried = new Set();
    const holdFrom = (srcSubs, srcSubTurn) => {
      for (const k of Object.keys(subs)) delete subs[k];
      for (const k of Object.keys(subTurn)) delete subTurn[k];
      Object.assign(subs, srcSubs);
      Object.assign(subTurn, srcSubTurn);
    };
    const rewalk = async (shareFn) => {
      if (solved || !partial || turnVariants.length <= 1 || partial === rewalkedFrom) return false;
      rewalkedFrom = partial;
      const base = partial.clean;
      const cleanDraws = new Map((base.trace || []).map(d => [d.i, d]));
      let better = null;
      for (const v of turnVariants) {
        if (solved) break;
        if (v === partial.variant) continue;
        variants[t] = v;
        holdFrom(base.subs, base.subTurn);
        let probe = await runTo(common, subs, t);
        if (probe.badTurn === null || probe.badTurn > t) { solved = true; break; }
        let score = scoreOf(probe, t);
        let heldSubs = base.subs;
        let heldSubTurn = base.subTurn;
        if (probe.badTurn === t && score[0] < base.score[0] && cleanDraws.size) {
          // A variant that changes an earlier action on turn `t` can shift the
          // ordinals after it or stop before them; drop turn-`t` pins from
          // there on so `partial`'s dice never mask `v`.
          const start = probe.starts?.[t] ?? 0;
          const stopLog = turnFailLogAt(common, t, start, probe.rawLog.slice(start), score[0], false, score[1] === -1);
          let cutOrd = Infinity;
          for (const d of drawsOf(probe.trace, t)) {
            const was = cleanDraws.get(d.i);
            if (was && (d.lo !== was.lo || d.hi !== was.hi || d.chance !== was.chance)) {
              cutOrd = Math.min(cutOrd, d.i);
              break;
            }
            if (base.subTurn[d.i] === t && (d.at ?? 0) >= stopLog) {
              cutOrd = Math.min(cutOrd, d.i);
            }
          }
          if (cutOrd < Infinity) {
            const prunedSubs = {};
            const prunedSubTurn = {};
            for (const [k, val] of Object.entries(base.subs)) {
              if (base.subTurn[k] === t && Number(k) >= cutOrd) continue;
              prunedSubs[k] = val;
              prunedSubTurn[k] = base.subTurn[k];
            }
            holdFrom(prunedSubs, prunedSubTurn);
            const retry = await runTo(common, subs, t);
            if (retry.badTurn === null || retry.badTurn > t) { solved = true; break; }
            const retryScore = scoreOf(retry, t);
            if (outranks(retryScore, score)) {
              probe = retry;
              score = retryScore;
              heldSubs = prunedSubs;
              heldSubTurn = prunedSubTurn;
            }
          }
        }
        if (score[1] === -1) continue;
        const rKey = `${v}|${JSON.stringify(heldSubs)}`;
        if (rewalkTried.has(rKey)) continue;
        const advances = score[0] > partial.at[1] || (!searchedVariants.has(v) && outranks(score, partial.at.slice(1)));
        if (advances && (!better || outranks(score, better.score))) {
          better = { v, score, subs: heldSubs, subTurn: heldSubTurn, rKey };
        }
      }
      if (!solved && better) {
        rewalkTried.add(better.rKey);
        const cap = shareFn();
        variants[t] = better.v;
        holdFrom(better.subs, better.subTurn);
        searchedVariants.add(better.v);
        const got = await searchVariant(better.v, cap);
        const w = walked.findLast(x => x.variant === better.v);
        if (w) w.searched = got.score;
        if (got.solved) solved = true;
        else consider(got.score, better.v, got.tried, got.clean);
        return true;
      }
      return false;
    };

    let orderedRanked = ranked;
    const repSet = new Set();
    if (hasHidden && ranked.length > 1) {
      const unseenRadix = common.radices[t] || 0;
      const highOf = v => (unseenRadix > 1 ? Math.floor(v / unseenRadix) : 0);
      const prioSig = list => (list || []).map(p => `${p.key}:${p.prio}`).join(',');
      const firstItem = ranked[0];
      const basePrio = new Map((firstItem.prios || []).map(p => [p.key, p.prio]));
      const prioDir = new Map();
      if (firstStopDiff) {
        const slotKeyOf = (line) => {
          const ident = String(line || '').split('|')[2] || '';
          const s = identSide(ident);
          const idx = identSlot(ident);
          return (s === 'p1' || s === 'p2') && idx >= 0 ? `${s}:${idx}` : null;
        };
        const expParts = String(firstStopDiff.expected || '').split('|');
        const actParts = String(firstStopDiff.actual || '').split('|');
        if (actParts[1] === 'move' && expParts[2] && actParts[2] !== expParts[2]) {
          const sk = slotKeyOf(firstStopDiff.actual);
          if (sk && basePrio.has(sk)) prioDir.set(sk, -1);
        } else if (expParts[1] === 'cant' && actParts[1] === 'move' && actParts[2] !== expParts[2]) {
          const sk = slotKeyOf(firstStopDiff.expected);
          if (sk && basePrio.has(sk)) prioDir.set(sk, 1);
        }
      }
      repSet.add(firstItem.v);
      const seenOutcomes = new Set([`${highOf(firstItem.v)}|${prioSig(firstItem.prios)}|${firstItem.score.join(',')}|${firstItem.actual}`]);
      const firstPass = [];
      const secondPass = [];
      for (const item of ranked.slice(1)) {
        const key = `${highOf(item.v)}|${prioSig(item.prios)}|${item.score.join(',')}|${item.actual}`;
        if (!seenOutcomes.has(key)) {
          seenOutcomes.add(key);
          repSet.add(item.v);
          firstPass.push(item);
        } else {
          secondPass.push(item);
        }
      }
      if (prioDir.size) {
        const dirRank = (item) => {
          for (const p of item.prios || []) {
            const dir = prioDir.get(p.key);
            const bp = basePrio.get(p.key);
            if (!dir || bp === undefined || p.miss > 0) continue;
            if ((dir > 0 && p.prio > bp) || (dir < 0 && p.prio < bp)) return 0;
          }
          return 1;
        };
        firstPass.sort((a, b) => dirRank(a) - dirRank(b) || (outranks(b.score, a.score) ? 1 : outranks(a.score, b.score) ? -1 : a.v - b.v));
      }
      orderedRanked = [firstItem, ...firstPass, ...secondPass];
    } else {
      for (const item of ranked) repSet.add(item.v);
    }

    const shareOf = (v = null) => {
      const rem = maxProbes - spent[t];
      const leftReps = orderedRanked.filter(r => !r.rejected && repSet.has(r.v) && !searchedVariants.has(r.v)).length;
      const leftAny = orderedRanked.filter(r => !r.rejected && !searchedVariants.has(r.v)).length;
      if (v !== null && !repSet.has(v)) {
        return cappedVariants.size || leftAny > 1 ? Math.min(rem, Math.max(16, Math.ceil(rem / Math.max(2, leftAny + 1)))) : rem;
      }
      if (leftReps > 1) return Math.min(rem, Math.max(16, Math.ceil(rem / 2)));
      if (leftAny > 1) return Math.min(rem, Math.max(24, Math.ceil((rem * 2) / 3)));
      return rem;
    };

    while (await rewalk(() => shareOf())) { /* keep advancing while rewalk finds a better variant */ }

    for (const { v, score, rejected } of orderedRanked) {
      if (solved) break;
      if (searchedVariants.has(v)) continue;
      if (rejected) {
        consider(score, v, null);
        continue;
      }
      const cap = shareOf(v);
      searchedVariants.add(v);
      variants[t] = v;
      if (v === entering) restoreEntering();
      else forget(t);
      const got = await searchVariant(v, cap);
      walked.findLast(w => w.variant === v).searched = got.score;
      if (got.solved) solved = true;
      else consider(got.score, v, got.tried, got.clean);
      if (repSet.has(v)) {
        while (await rewalk(() => shareOf())) { /* advance immediately when a bracket settles dice another needs */ }
      }
    }
    if (!solved && allVariants > maxVariants) common.limits.add('variants');

    while (await rewalk(() => shareOf())) { /* re-check if a later variant settled dice another needs */ }

    if (!solved && partial && cappedVariants.has(partial.variant) && spent[t] < maxProbes) {
      variants[t] = partial.variant;
      holdFrom(partial.subs, partial.subTurn);
      const got = await searchVariant(partial.variant, maxProbes - spent[t]);
      const w = walked.findLast(x => x.variant === partial.variant);
      if (w) w.searched = got.score;
      if (got.solved) solved = true;
      else consider(got.score, partial.variant, got.tried, got.clean);
      while (await rewalk(() => maxProbes - spent[t])) { /* re-check under the full search's dice */ }
    }
    if (!solved && hitProbes) common.limits.add('probes');

    if (!solved) {
      variants[t] = partial ? partial.variant : 0;
      forget(t);
      if (partial) {
        Object.assign(subs, partial.subs);
        Object.assign(subTurn, partial.subTurn);
      }
      run = await playThrough({ ...common, subs });
      remember();
    }

    // A choice an earlier turn made and this one carried out - a charging
    // move's target, chosen as it began and seen only where it landed, which a
    // redirection moves - was left at its first guess by that turn's search,
    // since nothing on that turn could tell. So each turn whose stored choice
    // lands here walks its hidden choices again, every die kept, and one that
    // gets this turn further is taken before any die is redrawn.
    if (!solved && run.diffs[0]?.index !== -1) {
      const from = scoreOf(run, t);
      let carried = false;
      let carryHitProbes = false;
      // The team preview chose who stands in the back of the party, and
      // where; a move that reads them there carries that choice out.
      const carriers = carriedInto(plans, t);
      if ((run.party || []).includes(t) && !carriers.includes(0)) carriers.push(0);
      const readSides = (() => {
        const sides = ['p1', 'p2'].filter(s => (run.partySides || []).some((tag) => {
          const [tk, ts] = String(tag).split(':');
          return ts === s && Number(tk) <= t;
        }));
        return sides.length ? sides : ['p1', 'p2'];
      })();
      const carrySigOf = (r, k, v) => (k === 0
        ? readSides.map(s => (r.choices || []).find(c => c.turn === 0 && c.side === s)?.choice || '').join('|')
        : String(v));
      const savedSnap = carriers.length ? common.snaps.get(t) : null;
      let carrySpent = 0;
      for (const k of carriers) {
        if (carried) break;
        const keep = variants[k] || 0;
        const keepSig = carrySigOf(run, k, keep);
        const kVariants = variantList(run.widths?.[k] || 1, common.radices[k] || 0);
        const rawProbed = [];
        for (const v of kVariants) {
          if (carried) break;
          if (v === keep || takenCarry.has(`${t}|${k}|${v}`)) continue;
          variants[k] = v;
          const probe = await runTo(common, subs, t);
          carried = probe.badTurn === null || probe.badTurn > t || (probe.badTurn === t && outranks(scoreOf(probe, t), from));
          if (!carried) rawProbed.push({ v, sig: carrySigOf(probe, k, v) });
        }
        if (carried) { takenCarry.add(`${t}|${k}|${variants[k]}`); spent[t] = 0; break; }
        // `from` was reached after `resolveTurn` settled turn `t`'s dice for
        // `keep`, leaving `subs` tailored to `keep` (Beat Up's per-slot base
        // powers, a crit on a later strike) while another carried choice needs
        // turn `t`'s dice settled for itself.
        const seenSigs = new Set([keepSig]);
        const cands = rawProbed.filter(({ sig }) => {
          if (!sig || seenSigs.has(sig) || takenCarry.has(`${t}|${k}|sig:${sig}`)) return false;
          seenSigs.add(sig);
          return true;
        });
        if (cands.length && carrySpent < maxProbes && Date.now() < deadline) {
          for (let idx = 0; idx < cands.length; idx++) {
            if (carried || carrySpent >= maxProbes || Date.now() >= deadline) break;
            const { v, sig } = cands[idx];
            variants[k] = v;
            variants[t] = partial ? partial.variant : entering;
            restoreEntering();
            let pre = await runTo(common, subs, t);
            // The choice can change the dice of the turns it was made on and
            // carried through, not only this one's: a target that left the
            // field before the move began is replaced by a draw
            // (`getRandomTarget`). Those turns' dice are settled again for it,
            // first failing turn first, and put back if it gets nowhere.
            const before = { subs: { ...subs }, subTurn: { ...subTurn } };
            while (pre.badTurn !== null && pre.badTurn >= k && pre.badTurn < t && pre.diffs[0]?.index !== -1 && carrySpent < maxProbes) {
              const bad = pre.badTurn;
              forget(bad);
              const settled = await resolveTurn(bad, common, subs, subTurn, sample, maxProbes - carrySpent);
              carrySpent += settled.probes;
              forcedDraws += settled.forced;
              if (!settled.solved) break;
              pre = await runTo(common, subs, t);
              if (pre.badTurn === bad) break;
            }
            if (pre.badTurn === null || pre.badTurn > t) {
              carried = true;
              takenCarry.add(`${t}|${k}|${v}`);
              takenCarry.add(`${t}|${k}|sig:${sig}`);
              break;
            }
            if (pre.badTurn < t || pre.diffs[0]?.index === -1) {
              for (const key of Object.keys(subs)) delete subs[key];
              for (const key of Object.keys(subTurn)) delete subTurn[key];
              Object.assign(subs, before.subs);
              Object.assign(subTurn, before.subTurn);
              continue;
            }
            const rem = maxProbes - carrySpent;
            const left = cands.length - idx;
            const slice = Math.min(rem, Math.max(16, Math.ceil(rem / left)));
            const got = await resolveTurn(t, common, subs, subTurn, sample, slice, { deferProbeLimit: slice < rem });
            carrySpent += got.probes;
            forcedDraws += got.forced;
            if (got.ended === 'probes') carryHitProbes = true;
            if (got.solved || outranks(got.score, from)) {
              carried = true;
              takenCarry.add(`${t}|${k}|${v}`);
              takenCarry.add(`${t}|${k}|sig:${sig}`);
              break;
            }
          }
          if (!carried) {
            variants[t] = partial ? partial.variant : 0;
            forget(t);
            if (partial) {
              Object.assign(subs, partial.subs);
              Object.assign(subTurn, partial.subTurn);
            }
          }
        }
        if (carried) { spent[t] = 0; break; }
        variants[k] = keep;
        if ((run.widths?.[k] || 1) > maxVariants) common.limits.add('variants');
      }
      if (!carried && carriers.length) {
        if (savedSnap) common.snaps.set(t, savedSnap);
        else common.snaps.delete(t);
        if (carryHitProbes) common.limits.add('probes');
      }
      if (carried) {
        onProgress(`turn ${t}: a choice made on an earlier turn and carried out here gets it further`);
        run = await playThrough({ ...common, subs });
        remember();
        continue;
      }
    }

    if (solved) {
      run = await playThrough({ ...common, subs });
      remember();
      continue;
    }

    // A partial exact prefix on this turn chose one HP among those its first
    // half allowed before its second half had been reached; when the second
    // half needs another, search the whole turn against what the replay shows.
    if (localExact?.get(t)?.partial && run.diffs[0]?.index !== -1) {
      localExact.delete(t);
      common.id = ++contextCount;
      common.snaps.clear();
      variants[t] = entering;
      spent[t] = 0;
      forget(t);
      run = await playThrough({ ...common, subs });
      remember();
      continue;
    }

    // A refused choice is not something an earlier turn can be blamed for, and
    // backtracking would only re-draw turns that were already right. Stop and
    // let the report name the turn.
    if (run.diffs[0]?.index === -1) {
      stop = run.diffs[0].cap || 'refused';
      if (run.diffs[0].cap) common.limits.add(run.diffs[0].cap);
      break;
    }

    // Exhausted. An HP sampled earlier can make this turn unreachable - the
    // Pokemon that had to faint here survives on the point that was given away -
    // so go back and draw an earlier turn's ambiguity again.
    // Every other backtrack blames the other Pokemon the line depends on, when
    // its HP is hidden and so could have been sampled differently.
    // A line that is no HP figure - a lock, a sleep or a confusion ending a
    // turn early or late - was decided by a die thrown when it began, which
    // showed nothing then. So every earlier turn is tried, latest first, for a
    // die that brings this turn closer, and only such a die is redrawn.
    const attacker = hiddenCulprit(segments[t], run.diffs[0]?.expected, channel);
    const onAttacker = attacker && backtracks % 2 === 1;
    const line = onAttacker ? `|-damage|${attacker}|` : run.diffs[0]?.expected;
    const stuck = identName(String(line || '').split('|')[2]);
    const hpFigure = /^\|-(damage|heal|sethp)\|/.test(String(line || ''));
    let back = t - 1;
    if (hpFigure) {
      const turns = blameTurns(segments, t, line);
      const key = `${t}|${line}`;
      const n = blamed.get(key) || 0;
      blamed.set(key, n + 1);
      back = turns[n % turns.length];
    }
    // The failing turn's hidden choices, one for each score its search saw.
    const outcomes = [...new Map((variantsAt.get(t) || []).map(w => [JSON.stringify(w.score), w.variant])).values()].slice(0, MAX_OUTCOMES);
    let moved = false;
    while (back >= 0 && !moved) {
      // The later turns keep the dice they settled while a die is judged, so
      // the failing turn gets as far as the line in question: an HP backtrack
      // settles them again afterwards, for the HP it moved, but judges a die
      // whose face shows only later - what a Substitute kept, which a recoil
      // off it reads - against them as they were.
      const later = Object.fromEntries(Object.entries(subs).filter(([key]) => subTurn[key] > back));
      if (hpFigure) forget(back + 1);
      moved = hpFigure
        ? await redrawTurn(back, common, subs, subTurn, sample, maxProbes, stuck, onAttacker, t, later)
        : await redrawTurn(back, common, subs, subTurn, sample, maxProbes, null, true, t, partial?.tried, outcomes);
      if (!moved) back--;
    }
    if (!moved) { stop = 'stuck'; break; }
    if (hpFigure ? ++backtracks > maxBacktracks : ++dieBacktracks > maxDieBacktracks) {
      stop = hpFigure ? 'backtracks' : 'dieBacktracks';
      common.limits.add(stop);
      break;
    }
    onProgress(`turn ${t}: unreachable, redrawing turn ${back}`);
    for (let i = back + 1; i < variants.length; i++) { variants[i] = 0; spent[i] = 0; }
    run = await playThrough({ ...common, subs });
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
  }

  const verifiedThroughTurn = complete ? segments.length - 1 : Math.max(0, (run.diffs[0]?.turn ?? 1) - 1);

  return {
    inputLog: run.inputLog,
    log: onChannel(run.rawLog, -1),
    rawLog: run.rawLog,
    starts: run.starts,
    seed: startSeed,
    pins: { subs: { ...subs }, turns: Object.fromEntries(run.trace.map(r => [r.i, r.mark])), variants: [...variants] },
    dice: run.trace.map(({ i, from, to, value, mark, chance, at }) => ({ i, from, to, value, mark, chance, at })),
    choices: run.choices.map(({ turn, side, choice, at }) => ({ turn, side, choice, at })),
    variantsTried: complete ? null : { turn: run.diffs[0]?.turn ?? null, variants: variantsAt.get(run.diffs[0]?.turn) || [] },
    brokenProof: broken,
    reseeds: reseeds.map((s, i) => (s ? { turn: i, seed: s } : null)).filter(Boolean),
    report: {
      complete,
      stop: complete ? 'complete' : stop,
      limits: [...common.limits].sort(),
      verifiedThroughTurn,
      turns: segments.length - 1,
      attempts: common.tally.plays,
      backtracks,
      dieBacktracks,
      forcedDraws,
      drawsSeen: run.trace.length,
      variantsUsed: variants.filter(Boolean).length,
      reseedCount: reseeds.filter(Boolean).length,
      diffs: run.diffs,
      widths: run.widths,
      notes: [...new Set(run.notes)],
      hidden: (run.hidden || []).filter(k => k <= (run.badTurn ?? Infinity)),
      ended: run.ended,
      winner: run.winner,
    },
  };
}

/**
 * Rebuild an input log from an observed protocol log (parameters as above).
 *
 * A side whose sheet has an Illusion user can send it in disguised as any
 * teammate, and a disguise no line gives away is read as the teammate. When
 * the rebuild then fails, each earlier switch-in of that side is tried as the
 * Illusion user, one more at a time, and the reading that reproduces the
 * furthest is kept. One that reproduces no further than the plain reading is
 * not taken: a disguise nothing tells apart stays the teammate. A trial runs
 * without the exact turns and dice it was handed, which were proved under the
 * other reading. The reading kept is handed back as `forced`, to start from
 * next time.
 *
 * `cost` is what every reading tried spent, the kept one's `report` only its
 * own: `trials`, the readings rebuilt, and the sums of their `attempts`,
 * `backtracks` and `dieBacktracks` as `probes`, `backtracks` and
 * `dieBacktracks`, and `limits`, every limit any of them hit. `brokenProof`
 * is the first reading's, the only one handed the proof.
 */
export async function reconstruct(options) {
  const from = eventsNow();
  try {
    count('rebuilds');
    return await reconstructAll(options);
  } finally {
    count('rebuilds events', eventsNow() - from);
  }
}

async function reconstructAll(options) {
  const forced = new Set(options.forced || []);
  const cost = { trials: 0, probes: 0, backtracks: 0, dieBacktracks: 0, limits: [] };
  const once = async (opts) => {
    const b = await reconstructOnce(opts);
    cost.trials++;
    cost.probes += b.report.attempts;
    cost.backtracks += b.report.backtracks;
    cost.dieBacktracks += b.report.dieBacktracks;
    cost.limits = [...new Set([...cost.limits, ...b.report.limits])].sort();
    return b;
  };
  let best = await once({ ...options, forced });
  const { brokenProof: broken } = best;
  if (best.report.complete || options.fixedReadings) return { ...best, forced: [...forced], cost };
  const lines = options.observed.filter(l => typeof l === 'string');
  const sheets = sheetsOf(options.formatid, options.packedTeams, options.channel ?? -1, options.guessed);
  const analysis = analyseIllusion(lines, sheets);
  const stays = analysis.open;
  const further = (a, b) => {
    const at = r => [r.report.diffs[0]?.turn ?? Infinity, r.report.diffs[0]?.index ?? Infinity];
    const [x, y] = [at(a), at(b)];
    return a.report.complete !== b.report.complete ? a.report.complete : x[0] !== y[0] ? x[0] > y[0] : x[1] > y[1];
  };
  let moved = true;
  while (moved && !best.report.complete) {
    moved = false;
    const baseValid = analysis.valid(forced);
    const failing = (best.report.diffs[0]?.turn ?? Infinity);
    let bestTrial = null;
    let bestAt = null;
    for (const { at, turn } of stays) {
      if (forced.has(at) || (options.throughTurn != null && turn > options.throughTurn) || (baseValid && turn > failing)) continue;
      const nextForced = new Set([...forced, at]);
      if (!analysis.canExtend(nextForced)) continue;
      const tried = await once({ ...options, exact: null, pins: null, forced: nextForced });
      if (further(tried, bestTrial || best)) {
        bestTrial = tried;
        bestAt = at;
        if (tried.report.complete) break;
      }
    }
    if (bestTrial) {
      best = bestTrial;
      forced.add(bestAt);
      moved = true;
    }
  }
  return { ...best, forced: [...forced], cost, brokenProof: broken };
}

/**
 * The unsettled switch-ins of a log that could be an Illusion user in disguise,
 * with `.valid(ats)` and `.canExtend(ats)` checking structural consistency.
 */
export function disguisableStays(formatid, packedTeams, channel, observed, guessed = null) {
  const lines = observed.filter(l => typeof l === 'string');
  const analysis = analyseIllusion(lines, sheetsOf(formatid, packedTeams, channel, guessed));
  const out = analysis.open.map(({ at, turn }) => ({ at, turn }));
  Object.defineProperties(out, {
    valid: { value: analysis.valid },
    canExtend: { value: analysis.canExtend },
  });
  return out;
}

/** Those switch-ins nothing settles, as `{ at, turn, side, name }`. */
export function unsettledDisguises(formatid, packedTeams, channel, observed, guessed = null) {
  const lines = observed.filter(l => typeof l === 'string');
  return analyseIllusion(lines, sheetsOf(formatid, packedTeams, channel, guessed)).open;
}

/** Both teams as set objects, the shape a `.log.json` carries them in. */
export function unpackTeams(packedTeams) {
  return packedTeams.map(t => Teams.unpack(t));
}

if (!isMainThread && workerData?.role === PROBE_ROLE) serveProbes();
