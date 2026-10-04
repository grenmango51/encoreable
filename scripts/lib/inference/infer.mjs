/**
 * Which Stat Point spreads could have produced this replay.
 *
 * Open Team Sheets publish everything but the spread, so a Pokemon's unknown is
 * six numbers, 0-32 each, at most 66 in total. Inference starts from every legal
 * spread and removes the ones the battle rules out. A spread is removed only when
 * the simulator itself says it could not have produced what the log shows - no
 * damage, speed or HP arithmetic of ours decides anything.
 *
 *   knowledge.mjs  what is still possible per Pokemon, and how a guess is picked
 *   evidence.mjs   one replay of a scaffold, the simulator hooked at every hit,
 *                  HP change and held-item check
 *   speed.mjs      speed order from every sort the simulator makes by speed
 *   infer.mjs      the rounds
 *
 * The replay needs a scaffold - some spread that reproduces the log, so that
 * every hit happens in the position it really happened in. The position does not
 * depend on which consistent spread built it, only the exact HP does, and that is
 * exactly what each candidate tracks for itself. So `inferSpreads` alternates:
 * reconstruct with a guess, collect the evidence up to where it diverged, move
 * the guess inside what survived, and go again until the whole log reproduces.
 * Each round hands the next the exact HP it proved and the dice that rebuild it.
 */

import { createRequire } from 'module';

import { battleLines } from '../protocol.mjs';
import {
  ACTION_START, disguisableStays, identName, identSide, reconstruct, sampler, splitTurns, unsettledDisguises,
} from '../reconstruct.mjs';
import {
  BUDGET, FLAT, SPAN, STAT_IDS, aimFor, aliveOf, cloneKnowledge, closestSpread, containsSpread, defaultSpread, freshKnowledge, fullEvs,
  intersectKnowledge, keyOf, maskKeys, packKnowledge, pinKnowledge, restrictKnowledge, sameSpread, spreadAt, spreadsLeft, summarise,
  tighten, uniteKnowledge, valuesOf,
} from './knowledge.mjs';
import { evidencePass } from './evidence.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams, toID } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');

// What the fallback may spend: rebuilds of a failing turn, per line and per
// inference with the readings it runs again under, which bound it the same on
// every machine; and ceilings on one line's time and on the inference's that
// only a machine many times slower than usual meets.
const FALLBACK_REBUILDS = 8;
const FALLBACK_TOTAL = 32;
const FALLBACK_MS = 120000;
const FALLBACK_TOTAL_MS = 240000;

/**
 * The line a rebuild stopped on, in the replay's turn: the lines from the
 * action it belongs to through it, and as text - the line as the replay shows
 * it, with the move and how many times it hit or the part of the turn it came
 * in, and what the rebuild printed instead, and when that is the same kind of
 * line for another Pokemon, the order the replay has them in. A turn the
 * evidence proved is compared with its exact HP, so the line is found by kind
 * and Pokemon.
 */
function locate(segment, diff) {
  const hard = [];
  const raw = [];
  for (const [r, l] of segment.entries()) {
    const [kept] = battleLines([l]);
    if (kept === undefined || kept.split('|')[1] === 'player') continue;
    hard.push(kept);
    raw.push(r);
  }
  const head = l => String(l).split('|').slice(0, 3).join('|');
  let from = '';
  let line = diff.expected;
  let action = [diff.expected];
  if (hard[diff.index] !== undefined && head(hard[diff.index]) === head(diff.expected)) {
    line = hard[diff.index];
    // An action opens with its own line; the simulator prints an empty line
    // before the moves of a turn and before its end.
    let r = raw[diff.index];
    while (r > 0 && segment[r - 1] !== '|' && !ACTION_START.has(String(segment[r]).split('|')[1])) r--;
    const a = hard.findIndex((l, n) => raw[n] >= r);
    action = hard.slice(a, diff.index + 1);
    if (a < diff.index && hard[a].startsWith('|move|')) {
      let hits = 0;
      for (let b = a + 1; b < hard.length && !ACTION_START.has(hard[b].split('|')[1]); b++) {
        if (hard[b].startsWith('|-hitcount|')) hits = Number(hard[b].split('|')[3]) || hits;
      }
      from = `, from ${hard[a]}${hits > 1 ? ` (${hits} hits)` : ''}`;
    } else if (!ACTION_START.has(String(segment[r]).split('|')[1])) {
      from = segment.slice(0, r).some(l => /^\|(move|cant)\|/.test(l)) ? ', at the end of the turn' : ', at the start of the turn';
    }
  }
  const kind = l => String(l || '').split('|')[1];
  const who = l => /^p[1-4][a-d]?: (.+)$/.exec(String(l || '').split('|')[2] || '')?.[1];
  const cause = l => /\|\[from\] ([^|]+)/.exec(String(l || ''))?.[1] || '';
  let order = '';
  if (diff.actual && kind(diff.actual) === kind(diff.expected) && who(diff.expected) && who(diff.actual)
    && String(diff.actual).split('|')[2] !== String(diff.expected).split('|')[2] && cause(diff.actual) === cause(diff.expected)) {
    const by = cause(diff.expected).replace(/^(item|ability|move): /, '');
    order = ` - in the replay ${by ? `${by} reached ` : ''}${who(diff.expected)} before ${who(diff.actual)}`;
  }
  return { what: `${line}${from}; the rebuild printed ${diff.actual ?? 'nothing'}${order}`, action };
}

/**
 * An input log played again with other teams - the same choices and the same
 * dice - as `channel` sees it, through the line that opens the turn after
 * `turn`, or null where the simulator stops it.
 */
async function replayWith(inputLog, packedTeams, turn, channel) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  try {
    for (const raw of Array.isArray(inputLog) ? inputLog : String(inputLog).split('\n')) {
      let line = String(raw).trimEnd();
      if (!line.startsWith('>')) continue;
      const m = /^>player (p([1-4])) (.*)$/.exec(line);
      if (m && packedTeams[Number(m[2]) - 1]) line = `>player ${m[1]} ${JSON.stringify({ ...JSON.parse(m[3]), team: packedTeams[Number(m[2]) - 1] })}`;
      await stream.write(line);
      if (stream.battle?.turn > turn || stream.battle?.ended) break;
    }
    const log = extractChannelMessages(stream.battle.log.join('\n'), [channel])[channel].map(l => (l.startsWith('|t:|') ? '|t:|' : l));
    const end = log.indexOf(`|turn|${turn + 1}`);
    return end < 0 ? log : log.slice(0, end + 1);
  } catch {
    return null;
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
}

/**
 * The dice that rebuild a scaffold's verified turns under the next guess.
 *
 * Within those turns the same dice are thrown in the same order whatever the
 * spread - accuracy, crits and procs keep the faces the scaffold settled - and
 * only the damage rolls must change, to the ones the evidence path chose for the
 * new spreads. The path also runs into the failing turn as far as it was
 * proved, so its rolls there are handed on too; the scaffold's other dice on
 * that turn are not, since the search that failed there chose them. A spread
 * that throws a different sequence is caught by `reconstruct`, which drops the
 * pins from that turn on.
 */
function handOn(built, rolls) {
  const failed = built.report.diffs[0]?.turn ?? Infinity;
  const { subs, turns } = built.pins;
  const out = { subs: {}, turns: {} };
  const put = (i, v, upTo) => {
    if (!(turns[i] <= upTo)) return;
    out.subs[i] = v;
    out.turns[i] = turns[i];
  };
  for (const [i, v] of Object.entries(subs)) put(i, v, failed - 1);
  for (const [i, r] of rolls || []) put(i, r, failed);
  return out;
}

/**
 * Infer the Stat Points of every side marked unknown from a replay.
 *
 * @param sets     both teams as set objects - everything the sheets publish. A
 *                 known side's sets carry their real Stat Points.
 * @param known    `[p1Known, p2Known]`
 * @param allSpent assume every unknown set spends all 66 points, as real sets do.
 *                 An assumption, not evidence: off unless asked for.
 * @param spend    what the fallback has left - rebuilds and milliseconds - and
 *                 the lines it searched without getting past, shared with
 *                 the inferences this one runs again under another reading
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
  allSpent = false,
  threads,
  onProgress = () => {},
  forced = null,
  readings = true,
  spend = { rebuilds: FALLBACK_TOTAL, ms: FALLBACK_TOTAL_MS, fruitless: new Set() },
}) {
  const options = { ...arguments[0], spend };
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
    for (const [i, set] of team.entries()) blank.set(`p${s + 1}:${i}`, freshKnowledge(set, known[s], allSpent));
  }
  let picks = sets.map((team, s) => team.map((set) => {
    if (known[s]) return fullEvs(set.evs);
    const max = exactHp.get(`p${s + 1}:${set.name || set.species}`);
    const base = dex.species.get(set.species || set.name).baseStats.hp;
    return defaultSpread(dex, set, max ? max - base - 75 : undefined);
  }));

  const settle = async (inputLog, knowledge, cache, record = false) => {
    const counts = () => new Map([...knowledge].map(([id, kn]) => [id, spreadsLeft(kn)]));
    const initial = record ? counts() : null;
    let first = null;
    let afterFirst = null;
    let passes = 0;
    while (passes < 8) {
      const pass = await evidencePass({ inputLog, observed: lines, channel, knowledge, cache, record: record && !first });
      passes++;
      let moved = false;
      for (const r of pass.recs) moved = intersectKnowledge(knowledge.get(r.id), r.keys, r.flat, r.ties) || moved;
      for (const kn of knowledge.values()) moved = tighten(kn) || moved;
      if (!first) {
        first = pass;
        if (record) afterFirst = counts();
      }
      if (!moved) break;
    }
    return {
      events: first.events,
      checks: first.checks,
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
  let pins = null;
  const started = Date.now();
  // One seed for every round, so the dice a round hands on land on the same
  // generator: an ordinal nobody pinned draws the same value every time.
  const seed = sampler(sampleSeed ^ 0x5eed).seed();

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

  // What the fallback found: each line no evidence hook reads, and the spread
  // it gave each Pokemon whose guess it moved to reproduce one, which that
  // Pokemon's next guesses stay as near as what survives allows: the line
  // read the spread whole.
  const gaps = new Map();
  const gap = (mark, entry, found = false) => gaps.set(mark, { entry, at: mark.split('|').slice(0, 2).map(Number), found });
  const searched = new Map();
  const failed = new Set();
  const held = new Map();
  const aimed = (id, kn, prev) => held.get(id) || aimFor(kn, prev);
  let evidenceTurn = 0;
  const packOf = chosen => sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: chosen[s][i] }))));
  const signature = chosen => JSON.stringify(chosen.map(team => team.map(e => STAT_IDS.map(x => e[x]))));
  const markOf = d => (d ? `${d.turn}|${d.index}|${d.expected}` : null);

  /**
   * A guess for a line no evidence hook reads. A round that leaves every
   * guess where it was, on a rebuild that still stops, says the evidence has
   * nothing against the guess - and when the line it stops on is one no hook
   * reads, nothing ever will. A round whose evidence removed nothing, and a
   * line that stops a second rebuild after the guess moved, say the same: the
   * guess moved for no reason the line gave.
   *
   * A turn the guess itself reproduces - with the dice before it handed on,
   * or under a bigger search - is the dice's to settle: the guess stays, and
   * the next round searches the way the rebuild that reproduced the turn did.
   * So is a line the guess gets past once the dice before it are searched
   * again, which is asked of the guess before any spread found is taken.
   * Otherwise the failing turn is rebuilt on its own, through its last line,
   * with one stat of one inferred Pokemon the turn names moved at a time to
   * values its surviving spreads still allow: each stat's ends, Speed's first
   * when the line is an order, and halving between them where one end stops
   * the rebuild before the line and the other leaves it as it was; then every
   * stat's middle. When none gets past the line, the stats that change what
   * the turn prints are searched over every surviving value, and then in
   * pairs. The first spread that gets past the line is the next guess, and
   * the evidence reads on from there. Every spread is built inside what
   * survives, with the 66-point budget and the HP, Defence and Special Defence
   * keys that survive together, and nothing is removed from what survives:
   * this only picks a witness.
   *
   * When no surviving value gets past the line, the values just past each
   * moved or narrowed range are tried too. One that reproduces every turn the
   * evidence has read is a spread the evidence removed wrongly, and says so.
   * A line searched without getting past it is not searched again, nor under
   * another reading of the same replay; one it got past is searched once more,
   * should a later guess lose it.
   *
   * @param seen   the Pokemon the evidence has seen
   * @param start  the guess to move from: the one the scaffold was built with,
   *               each Pokemon's taken from `next` where it no longer survives
   * @returns `{ picks, pins, held, level }` - guesses that reproduce the
   *          failing line, the dice that rebuilt it, the spreads of the
   *          Pokemon whose guess it moved and the dice budget the rebuild
   *          needed - or null, when the turn is the dice search's or nothing
   *          gets past the line.
   */
  const fallback = async (seen, start) => {
    const diff = built.report.diffs[0];
    const t = diff?.turn;
    const mark = markOf(diff);
    if (!diff || !(t >= 1) || !(diff.index >= 0) || (searched.get(mark) || 0) >= 2 || spend.fruitless.has(mark)) return null;
    searched.set(mark, (searched.get(mark) || 0) + 1);
    const none = () => { searched.set(mark, 2); spend.fruitless.add(mark); return null; };
    if (spend.rebuilds <= 0 || spend.ms <= 0) return null;
    // The replay through the line that opens the turn after `turn`.
    const cutAt = (turn) => {
      const at = observed.findIndex(l => typeof l === 'string' && Number(/^\|turn\|(\d+)/.exec(l)?.[1]) === turn + 1);
      return at < 0 ? observed : observed.slice(0, at + 1);
    };
    const through = cutAt(t);
    const handed = handOn(built, null);
    const began = Date.now();
    let spent = 0;
    const rebuild = (chosen, budget, { upTo = through, given = handed } = {}) => {
      spent++;
      spend.rebuilds--;
      return reconstruct({
        formatid, packedTeams: packOf(chosen), playerNames, observed: upTo, channel, exact: null, forced: built.forced,
        seed, pins: given, sampleSeed, maxProbes: budget.maxProbes, maxBacktracks: budget.maxBacktracks, threads,
      });
    };
    const left = Math.min(FALLBACK_MS, spend.ms);
    const affordable = () => spent < FALLBACK_REBUILDS && spend.rebuilds > 0 && Date.now() - began < left;
    const reach = b => (b.report.complete ? [Infinity, Infinity] : [b.report.diffs[0]?.turn ?? -1, b.report.diffs[0]?.index ?? -1]);
    const further = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
    const outcome = b => JSON.stringify([...reach(b), b.report.diffs[0]?.actual ?? null]);
    const clock = () => `${((Date.now() - began) / 1000).toFixed(1)}s`;
    // A guess the next round keeps, with the dice and the budget of the
    // rebuild that reproduced the turn: the search is the same, so it reaches
    // the same dice - and the same choices a replay leaves invisible, which
    // no die records.
    const stays = (given, level) => ({ picks: start, pins: given, held: new Map(), level });

    // The inferred Pokemon the turn names: in the line itself, then in the
    // action the line belongs to, then anywhere in the turn.
    const unknown = [];
    for (const [s, team] of sets.entries()) {
      if (known[s]) continue;
      for (const [i, set] of team.entries()) unknown.push({ s, i, id: `p${s + 1}:${i}`, name: set.name || set.species });
    }
    const namedIn = (text) => {
      const out = new Set();
      for (const part of String(text || '').split('|')) {
        const m = /^(?:\[\w+\]\s*)?(p[1-4])[a-d]?: (.+)$/.exec(part.trim());
        if (!m) continue;
        for (const u of unknown) if (`p${u.s + 1}` === m[1] && u.name === m[2]) out.add(u.id);
      }
      return out;
    };
    const turns = splitTurns(lines);
    const segment = turns[t] || [];
    const place = locate(segment, diff);
    const names = list => new Set(list.flatMap(l => [...namedIn(l)]));
    // Who stood in each slot as the turn began: a switch is the action of the
    // Pokemon it takes out, and any of them can move an order.
    const stood = new Map();
    for (const l of turns.slice(0, t).flat()) {
      const [, kind, ident] = String(l).split('|');
      if (['switch', 'drag', 'replace'].includes(kind) && /^p[1-4][a-d]: /.test(ident || '')) stood.set(ident.slice(0, 3), `|switch|${ident}`);
    }
    const leaving = [diff.expected, diff.actual].filter(l => ['switch', 'drag'].includes(String(l || '').split('|')[1]))
      .map(l => stood.get(String(l).split('|')[2].slice(0, 3)));
    const tiers = [names([diff.expected, diff.actual, ...leaving]), names(place.action), names([...segment, ...stood.values()])];
    const rank = u => tiers.findIndex(tier => tier.has(u.id));
    const cast = unknown.filter(u => rank(u) >= 0 && (seen.has(u.id) || rank(u) === 0)).sort((a, b) => rank(a) - rank(b));

    const what = place.what;
    const named = list => [...new Set(list.map(d => d.name))].map(n => `${n}'s ${[...new Set(list.filter(d => d.name === n).map(d => d.stat))].join(' and ')}`).join(', ');
    const whoIn = (text, list) => [...new Map(list.map(d => [d.id, d])).values()]
      .map(d => ({ id: d.id, at: text.lastIndexOf(d.name) })).filter(w => w.at >= 0);
    if (!cast.length) {
      gap(mark, { turn: t, what, reason: 'no evidence hook reads this line, and no inferred Pokemon the turn names could move it' });
      onProgress(`  fallback on turn ${t}: ${diff.expected} - no inferred Pokemon the turn names`);
      return none();
    }
    // A battle the replay ends before anything happens in the turn ended
    // outside it - a forfeit, the timer - which no Stat Point decides.
    if (diff.index === 0 && ['win', 'tie'].includes(String(diff.expected).split('|')[1])) {
      gap(mark, { turn: t, what, reason: 'the replay ends the battle before anything happens in the turn, which no Stat Point decides' });
      onProgress(`  fallback on turn ${t}: ${diff.expected} - the battle ended outside the turn`);
      return none();
    }

    // Each rebuild gets the smallest budget that brings the guess itself to
    // the failing turn, without backtracking: the dice of the turns before are
    // handed on, and only the choices a replay leaves invisible are searched
    // there again.
    let budget = budgets[0];
    let base = await rebuild(start, budget);
    if (!base.report.complete && reach(base)[0] < t) {
      budget = { maxProbes: budgets[1].maxProbes, maxBacktracks: 0 };
      base = await rebuild(start, budget);
    }
    if (base.report.complete) return stays(handed, budget === budgets[0] ? 0 : 1);
    const dice = await rebuild(start, budgets[1]);
    onProgress(`  fallback on turn ${t}: ${diff.expected} - the guess alone ${dice.report.complete ? 'reproduces it under a bigger search' : 'does not'}, ${clock()}`);
    if (dice.report.complete) return stays(handed, 1);
    if (reach(base)[0] < t) return none();

    // A line the rebuild printed for another Pokemon, or another action in its
    // place, is an order, and an order is Speed's first.
    const kind = l => String(l || '').split('|')[1];
    const who = l => (/^p[1-4][a-d]?: /.test(String(l || '').split('|')[2] || '') ? String(l).split('|')[2] : null);
    const order = (who(diff.actual) && who(diff.expected) && who(diff.actual) !== who(diff.expected))
      || (kind(diff.actual) !== kind(diff.expected) && ACTION_START.has(kind(diff.actual)) && ACTION_START.has(kind(diff.expected)));
    const dims = [];
    for (const u of cast) {
      const kn = knowledge.get(u.id);
      const values = valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties).values;
      for (const stat of STAT_IDS) {
        dims.push({ ...u, stat, alive: aliveOf(values[stat]), now: start[u.s][u.i][stat], sides: new Map(), best: null, moved: false, passed: false });
      }
    }
    if (order) dims.sort((a, b) => (a.stat !== 'spe') - (b.stat !== 'spe'));
    const spots = (d) => {
      const n = d.alive.length;
      return n ? [...new Set([d.alive[0], d.alive[n - 1], d.alive[(n - 1) >> 1]])] : [];
    };

    // Each Pokemon's changes made inside what `from` leaves it, the rest of its
    // spread as near its guess as that allows.
    const build = (changes, from) => {
      const out = start.map(team => team.map(e => ({ ...e })));
      const by = new Map();
      for (const c of changes) by.set(c.id, [...(by.get(c.id) || []), c]);
      for (const [id, list] of by) {
        const { s, i } = list[0];
        let kn = from.get(id);
        const aim = { ...start[s][i] };
        for (const c of list) {
          kn = restrictKnowledge(kn, c.stat, c.value);
          aim[c.stat] = c.value;
        }
        const spread = closestSpread(kn, aim);
        if (!spread || list.some(c => spread[c.stat] !== c.value)) return null;
        out[s][i] = spread;
      }
      return out;
    };
    // A spread under which the scaffold's own choices and dice print what they
    // printed, as the replay shows it, through the failing turn, does not move
    // its line, and costs no rebuild.
    const plain = await replayWith(built.inputLog, packOf(start), t, channel);
    const done = new Set([signature(start)]);
    const probe = async (changes, from = knowledge) => {
      const chosen = build(changes, from);
      if (!chosen || done.has(signature(chosen))) return null;
      done.add(signature(chosen));
      const same = !!plain && JSON.stringify(await replayWith(built.inputLog, packOf(chosen), t, channel)) === JSON.stringify(plain);
      const b = same ? null : await rebuild(chosen, budget);
      const stop = b && b.report.diffs[0];
      onProgress(`  fallback on turn ${t}: ${changes.map(c => `${c.name} ${c.stat} ${c.value}`).join(', ')} - ${same ? 'plays out the same'
        : b.report.complete ? 'reproduces it' : `stops at ${reach(b).join('.')}: wanted ${stop?.expected}, got ${stop?.actual}`}, ${clock()}`);
      return { chosen, b, same };
    };

    const baseReach = reach(base);
    const baseOutcome = outcome(base);
    let found = null;
    let ahead = null;
    const judge = (changes, got, d = null) => {
      const r = reach(got.b);
      if (d) {
        const { value } = changes[0];
        if (r[0] >= t && outcome(got.b) !== baseOutcome) d.moved = true;
        if (further(r, baseReach)) d.passed = true;
        if (!d.best || further(r, reach(d.best.b))) d.best = { value, b: got.b };
      }
      if (got.b.report.complete) found = { got, by: changes };
      else if (further(r, baseReach) && (!ahead || further(r, reach(ahead.got.b)))) ahead = { got, by: changes };
    };
    // Where a value leaves the rebuild: stopping before the line, printing
    // what it printed, or something else.
    const sideOf = got => (got.same ? 'same' : further(baseReach, reach(got.b)) ? 'early' : outcome(got.b) === baseOutcome ? 'same' : 'other');
    const tryValue = async (d, value) => {
      if (value === d.now) return 'same';
      if (d.sides.has(value)) return d.sides.get(value);
      const changes = [{ ...d, value }];
      const got = await probe(changes);
      if (!got) return null;
      if (got.b) judge(changes, got, d);
      d.sides.set(value, sideOf(got));
      return d.sides.get(value);
    };
    // Which stats move the line: each stat at its ends. One whose ends stop
    // the rebuild before the line at one and leave it as it was at the other
    // has the line's values between them, as an order between two speeds
    // does, and is halved until a value gets past the line or the halves stop
    // telling the two apart. Then every stat at its middle.
    for (const d of dims) {
      const n = d.alive.length;
      if (!n || found || ahead || !affordable()) continue;
      let [i, j] = [0, n - 1];
      const ends = [await tryValue(d, d.alive[i]), found || ahead || !affordable() ? null : await tryValue(d, d.alive[j])];
      if (!ends.includes('early') || !ends.includes('same')) continue;
      while (j - i > 1 && !found && !ahead && affordable()) {
        const m = (i + j) >> 1;
        const side = await tryValue(d, d.alive[m]);
        if (side === ends[0]) i = m;
        else if (side === ends[1]) j = m;
        else break;
      }
    }
    for (const d of dims) {
      if (found || ahead || !affordable()) break;
      if (d.alive.length) await tryValue(d, d.alive[(d.alive.length - 1) >> 1]);
    }
    // When none gets past it, each stat that moved it over every surviving
    // value, nearest the value that got furthest first, and then two at a time.
    const furthest = (a, b) => (further(reach(b.best.b), reach(a.best.b)) ? 1 : further(reach(a.best.b), reach(b.best.b)) ? -1 : 0);
    const moved = dims.filter(d => d.moved).sort(furthest);
    for (const d of moved) {
      const rest = d.alive.filter(v => v !== d.now && !d.sides.has(v)).sort((x, y) => Math.abs(x - d.best.value) - Math.abs(y - d.best.value));
      for (const value of rest) {
        if (found || ahead || !affordable()) break;
        await tryValue(d, value);
      }
    }
    for (let x = 0; x < moved.length && !found && !ahead; x++) {
      for (let y = x + 1; y < moved.length && !found && !ahead; y++) {
        const [a, b] = [moved[x], moved[y]];
        for (const va of new Set([a.best.value, ...spots(a)])) {
          for (const vb of new Set([b.best.value, ...spots(b)])) {
            if (found || ahead || !affordable()) break;
            const changes = [{ ...a, value: va }, { ...b, value: vb }];
            const got = await probe(changes);
            if (got?.b) judge(changes, got);
          }
        }
      }
    }

    // A spread found under the dice of the turns before can owe the line to
    // dice that land differently under it; the guess itself, with those dice
    // searched again, says whether it does.
    if ((found || ahead) && Object.keys(handed.subs).length) {
      const fresh = await rebuild(start, budgets[1], { given: null });
      if (further(reach(fresh), baseReach)) {
        onProgress(`  fallback on turn ${t}: the guess alone gets past the line with the dice before it searched again, ${clock()}`);
        return stays(null, 1);
      }
    }
    const win = found || ahead;
    if (win) {
      const passed = dims.filter(d => d.passed);
      const by = passed.length ? passed : win.by;
      const text = `${what} (moved by ${named(by)})`;
      gap(mark, { turn: t, what: text, who: whoIn(text, by), reason: 'no evidence hook reads this line, and the fallback found a spread that reproduces it' }, true);
      onProgress(`  fallback on turn ${t}: ${found ? 'reproduced' : `past the line, stopping at ${reach(ahead.got.b).join('.')}`} in ${spent} rebuilds, ${clock()}`);
      const spreads = new Map(win.by.map(c => [c.id, win.got.chosen[c.s][c.i]]));
      return { picks: win.got.chosen, pins: handed, held: spreads, level: budget === budgets[0] ? 0 : 1 };
    }

    // No surviving value gets past it: the values just past each range that
    // moved it, or that the evidence narrowed, on a Pokemon the line or its
    // action names.
    const outside = dims.filter(d => d.moved || (rank(d) < 2 && d.alive.length && d.alive.length < SPAN));
    let wrong = null;
    for (const d of outside) {
      const lo = d.alive[0];
      const hi = d.alive[d.alive.length - 1];
      for (const value of [...new Set([lo - 1, hi + 1, 0, SPAN - 1])].filter(v => v >= 0 && v < SPAN && !d.alive.includes(v))) {
        if (wrong || !affordable()) break;
        const got = await probe([{ ...d, value }], blank);
        if (!got?.b?.report.complete) continue;
        // It reproduces this turn; the evidence that removed it may have read
        // further, and the spread has to reproduce that too.
        const full = evidenceTurn > t ? await rebuild(got.chosen, budget, { upTo: cutAt(evidenceTurn) }) : got.b;
        if (full.report.complete) wrong = { d, value };
      }
    }
    if (wrong) {
      const text = `${what} (${wrong.d.name}'s ${wrong.d.stat} at ${wrong.value})`;
      gap(mark, {
        turn: t, what: text, who: whoIn(text, [wrong.d]),
        reason: 'a spread the evidence removed reproduces every turn the evidence read, where no surviving one reproduces this line: a possible spread was removed',
      });
    } else {
      const text = moved.length ? `${what} (moved by ${named(moved)})` : what;
      gap(mark, {
        turn: t, what: text, who: whoIn(text, moved),
        reason: moved.length
          ? 'no evidence hook reads this line, and no surviving value of the stats that move it reproduces it in the fallback\'s search'
          : 'no evidence hook reads this line, and no value the fallback tried of a Stat Point of a Pokemon the turn names changes it',
      });
    }
    onProgress(`  fallback on turn ${t}: nothing gets past the line in ${spent} rebuilds, ${clock()}`);
    return none();
  };

  while (rounds < maxRounds) {
    rounds++;
    const packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const searchStart = Date.now();
    const resample = budgets[level].resample || 0;
    built = await reconstruct({
      formatid, packedTeams, playerNames, observed, channel, exact, forced: built?.forced ?? forced,
      seed: resample ? null : seed,
      pins: resample ? null : pins,
      sampleSeed: sampleSeed + resample,
      maxProbes: budgets[level].maxProbes,
      maxBacktracks: budgets[level].maxBacktracks,
      threads,
    });
    const diff = built.report.diffs[0];
    onProgress(`round ${rounds}${level ? ` (search ${level + 1})` : ''}, ${((Date.now() - searchStart) / 1000).toFixed(1)}s: ${built.report.complete ? 'the whole log reproduces'
      : `reproduces through turn ${built.report.verifiedThroughTurn} - wanted ${diff?.expected}, got ${diff?.actual}`}`);
    if (built.report.complete) break;

    const cache = new Map();
    const evidenceStart = Date.now();
    evidenceTurn = Math.max(evidenceTurn, diff?.turn ?? 0);
    const { seen, passes: read } = await settle(built.inputLog, knowledge, cache);

    // New guesses, chosen together. Each Pokemon is pinned before the next is
    // chosen, because two unknowns can each be possible alone and impossible
    // together; a pin that leaves a later Pokemon with nothing is taken back and
    // the next candidate tried. A full set is accepted only when, with all of it
    // pinned, the evidence can name one exact HP path through every verified
    // turn - and the next search is handed those turns exact, so it cannot
    // sample its way into a dead end there, along with the dice that rebuild
    // them, so it does not search them at all. A Pokemon the log never showed
    // keeps its guess: nothing about it can be wrong yet.
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
        return proof.exact ? proof : null;
      }
      const [s, i] = order[n];
      const id = `p${s + 1}:${i}`;
      const kn = cond.get(id);
      const tried = [];
      const fixed = held.has(id) ? [held.get(id)] : [];
      for (const aim of [...fixed, aimFor(kn, picks[s][i]), picks[s][i], aimFor(kn, picks[s][i], 0.25), aimFor(kn, picks[s][i], 0.75)]) {
        if (tries <= 0) return null;
        const first = closestSpread(kn, aim);
        if (!first) continue;
        // HP, Defence and Special Defence first, and the flat stats from what
        // survives beside them: one hit can tie the two together - Foul Play
        // reads the target's Attack against its own Defence.
        const keyed = cloneKnowledge(cond);
        const pinned = keyed.get(id);
        pinned.keys.fill(0);
        pinned.keys[keyOf(first.hp, first.def, first.spd)] = 1;
        tries--;
        await settle(built.inputLog, keyed, cache);
        const pick = closestSpread(pinned, aim);
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
    const proof = await choose(0, cloneKnowledge(knowledge));
    exact = proof?.exact || null;
    pins = proof ? handOn(built, proof.rolls) : null;
    if (!exact) {
      for (const [s, i] of order) {
        const id = `p${s + 1}:${i}`;
        const kn = knowledge.get(id);
        next[s][i] = closestSpread(kn, aimed(id, kn, picks[s][i])) || next[s][i];
      }
    }
    onProgress(`  evidence and new guesses, ${((Date.now() - evidenceStart) / 1000).toFixed(1)}s${exact ? `, ${exact.size} turns exact` : ''}${pins ? `, ${Object.keys(pins.subs).length} dice handed on` : ''}`);
    const unchanged = next.every((team, s) => team.every((e, i) => sameSpread(e, picks[s][i])));
    // The evidence accepts this guess, or it learned nothing from this
    // rebuild, or a line stops a rebuild again after the guess moved. Either
    // the line is one no hook reads, and the fallback finds a guess that
    // reproduces it, or what failed was the dice search.
    const again = failed.has(markOf(diff));
    failed.add(markOf(diff));
    if (unchanged || again || read < 2) {
      const start = picks.map((team, s) => team.map((e, i) => (containsSpread(knowledge.get(`p${s + 1}:${i}`), e) ? e : next[s][i])));
      const began = Date.now();
      const found = await fallback(seen, start);
      spend.ms -= Date.now() - began;
      if (found) {
        for (const [id, spread] of found.held) held.set(id, spread);
        picks = found.picks;
        exact = null;
        pins = found.pins;
        level = found.level;
        continue;
      }
    }
    if (unchanged) {
      if (++level >= budgets.length) break;
    } else {
      level = 0;
    }
    picks = next;
  }

  // A side with an Illusion user can have sent it in disguised as a teammate,
  // and the line that gives it away can be one only its own Stat Points
  // explain - a Speed no Stat Point of the teammate reaches. The rebuild alone
  // cannot prefer that reading before its Stat Points are narrowed under it,
  // so a battle that did not rebuild is inferred again under each reading of a
  // switch-in as the Illusion user, and the first that rebuilds is kept.
  if (!built.report.complete && readings) {
    const packed = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const failing = built.report.diffs[0]?.turn ?? Infinity;
    for (const { at, turn } of disguisableStays(formatid, packed, channel, observed)) {
      if (turn > failing || (built.forced || []).includes(at)) continue;
      onProgress(`reading the switch-in at line ${at} as the Illusion user`);
      const other = await inferSpreads({ ...options, forced: [at], readings: false });
      if (other.complete) return spareDisguises(other);
    }
  }

  const last = built.report.diffs[0];
  const rebuiltPast = at => built.report.complete || (last && (last.turn !== at[0] ? last.turn > at[0] : last.index > at[1]));

  const final = cloneKnowledge(blank);
  const result = await settle(built.inputLog, final, new Map(), true);
  for (const [id, kn] of final) {
    const had = knowledge.get(id);
    intersectKnowledge(kn, maskKeys(had.keys), had.dom, had.ties);
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
        contains: evs => containsSpread(kn, evs),
      });
    }
  }

  return spareDisguises({
    complete: built.report.complete,
    rounds,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    built,
    picks,
    pokemon,
    events: result.events,
    // Where a shortcut of the evidence pass disagreed with the simulator and
    // was not used: evidence given up, never a spread removed. Then each line
    // the fallback had to reproduce because no evidence hook reads it, and
    // each it could not that the battle still stops on or before.
    checks: [...result.checks, ...[...gaps.values()].filter(g => g.found || !rebuiltPast(g.at)).map(g => g.entry)],
    cutoff: result.cutoff,
    passes: result.passes,
    knowledge: final,
  });

  /**
   * A switch-in nothing settles could have been the Illusion user in disguise
   * (`unsettledStays`), and then what it showed belongs to neither for
   * certain. The reading `res` was built under gives it to the Pokemon shown,
   * and none of it to the Illusion user. So each Pokemon shown in one is
   * inferred again with all of its unsettled switch-ins read as the Illusion
   * user, which gives it none of them, and every Pokemon of that side but the
   * Illusion user keeps whatever either reading leaves it. A reading that does
   * not rebuild when `res` does proves one of those switch-ins was the
   * Pokemon shown: with only one, nothing is added; with more, each is read
   * alone instead.
   */
  async function spareDisguises(res) {
    if (!readings) return res;
    const packed = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const base = res.built.forced || [];
    const groups = new Map();
    for (const stay of unsettledDisguises(formatid, packed, channel, observed)) {
      if (base.includes(stay.at)) continue;
      const key = `${stay.side}|${stay.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(stay);
    }
    for (const [key, stays] of groups) {
      const [side, name] = key.split('|');
      const s = Number(side[1]) - 1;
      onProgress(`reading ${name}'s unsettled switch-ins as the Illusion user`);
      const read = ats => inferSpreads({ ...options, forced: [...base, ...ats], readings: false });
      const all = await read(stays.map(x => x.at));
      let taken = all.complete || !res.complete ? [all] : [];
      if (!taken.length && stays.length > 1) {
        for (const stay of stays) {
          const one = await read([stay.at]);
          if (one.complete) taken.push(one);
        }
      }
      if (!taken.length) continue;
      for (const [i, set] of sets[s].entries()) {
        const id = `${side}:${i}`;
        if (known[s] || toID(set.ability) === 'illusion') continue;
        for (const other of taken) uniteKnowledge(res.knowledge.get(id), other.knowledge.get(id));
        tighten(res.knowledge.get(id));
        Object.assign(res.pokemon.find(p => p.id === id), summarise(res.knowledge.get(id)));
      }
      const from = [...new Set(stays.map(x => (x.turn ? `turn ${x.turn}` : 'the start')))].join(', ');
      const shown = sets[s].findIndex(set => (set.name || set.species) === name);
      res.checks.push({
        turn: stays[0].turn,
        what: `${name}, shown from ${from}`,
        ...(shown >= 0 ? { who: [{ id: `${side}:${shown}`, at: 0 }] } : {}),
        reason: 'it could have been the Illusion user, so what it showed was not used on its side',
      });
    }
    return res;
  }
}

/**
 * The inference as a recording carries it: each inferred Pokemon's ranges and
 * what survives for it, every event that narrowed one and every check, so a
 * recording opened later shows what the replay showed.
 */
export function inferenceRecord(inf, inferred, certified = null) {
  return {
    inferred,
    complete: inf.complete,
    rounds: inf.rounds,
    pokemon: inf.pokemon.filter(p => !p.known)
      .map(({ contains, known, ...rest }) => ({ ...rest, knowledge: packKnowledge(inf.knowledge.get(rest.id)) })),
    events: inf.events,
    checks: inf.checks,
    ...(certified ? { certified } : {}),
  };
}

/**
 * Which ends of each inferred range a rebuild proves: a spread at that end,
 * every other Pokemon where the inference left it, that reproduces the whole
 * log line for line. That rebuild is a witness anyone can replay. The search
 * has a budget, so an end it does not prove is not shown impossible. The
 * spreads the inference settled on are a witness already when they rebuilt.
 *
 * With `outside`, each range is also tried one Stat Point beyond each end, a
 * value the inference removed: a rebuild that reproduces the log there is a
 * spread removed wrongly - a defect found without knowing the real spreads.
 *
 * @returns per Pokemon id, per stat, `{ min, max }` as true (proved) or false,
 *          and `outside`, the values beyond an end that rebuilt the log.
 */
export async function certifyRanges(inf, {
  formatid, sets, playerNames, observed, channel = 1, sampleSeed = 1, maxProbes = 600, threads, outside = false, onProgress = () => {},
}) {
  const seed = sampler(sampleSeed ^ 0x5eed).seed();
  const tried = new Map();
  const signature = picks => JSON.stringify(picks.map(team => team.map(e => STAT_IDS.map(s => e[s]))));
  if (inf.complete) tried.set(signature(inf.picks), true);
  const witness = async (picks) => {
    const sig = signature(picks);
    if (!tried.has(sig)) {
      const packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
      const built = await reconstruct({
        formatid, packedTeams, playerNames, observed, channel, forced: inf.built.forced, seed, sampleSeed, maxProbes, maxBacktracks: 2, threads,
      });
      tried.set(sig, built.report.complete);
    }
    return tried.get(sig);
  };
  const out = {};
  const certifiable = inf.pokemon.filter(p => !p.known && p.seen && p.spreads);
  const placeOf = p => [Number(p.side[1]) - 1, Number(p.id.split(':')[1])];
  // First every Pokemon at the same end of one stat at once: one rebuild that
  // reproduces the log proves all those ends.
  const joint = new Map();
  for (const stat of STAT_IDS) {
    for (const end of ['min', 'max']) {
      const picks = inf.picks.map(team => team.map(e => ({ ...e })));
      let all = true;
      for (const p of certifiable) {
        const [s, i] = placeOf(p);
        const pick = p.stats[stat] && spreadAt(inf.knowledge.get(p.id), stat, p.stats[stat][end], inf.picks[s][i]);
        if (!pick) { all = false; break; }
        picks[s][i] = pick;
      }
      if (!all || !certifiable.length) continue;
      onProgress(`certifying every ${stat} ${end} at once`);
      if (await witness(picks)) joint.set(`${stat}|${end}`, true);
    }
  }
  for (const p of certifiable) {
    const [s, i] = placeOf(p);
    const kn = inf.knowledge.get(p.id);
    out[p.id] = {};
    for (const stat of STAT_IDS) {
      const range = p.stats[stat];
      if (!range) continue;
      out[p.id][stat] = {};
      for (const [end, value] of [['min', range.min], ['max', range.max]]) {
        if (joint.get(`${stat}|${end}`)) { out[p.id][stat][end] = true; continue; }
        const pick = spreadAt(kn, stat, value, inf.picks[s][i]);
        if (!pick) { out[p.id][stat][end] = false; continue; }
        const picks = inf.picks.map(team => team.map(e => ({ ...e })));
        picks[s][i] = pick;
        onProgress(`certifying ${p.species}'s ${stat} ${end} (${value})`);
        out[p.id][stat][end] = await witness(picks);
      }
      if (!outside) continue;
      out[p.id][stat].outside = [];
      for (const value of [range.min - 1, range.max + 1]) {
        if (value < 0 || value >= SPAN) continue;
        // The inference's own spread with this stat moved out, the others
        // lowered, largest first, where that breaks the budget.
        const pick = { ...inf.picks[s][i], [stat]: value };
        let over = STAT_IDS.reduce((t, x) => t + pick[x], 0) - BUDGET;
        for (const x of [...STAT_IDS].filter(y => y !== stat).sort((a, b) => pick[b] - pick[a])) {
          if (over <= 0) break;
          const cut = Math.min(over, pick[x]);
          pick[x] -= cut;
          over -= cut;
        }
        const picks = inf.picks.map(team => team.map(e => ({ ...e })));
        picks[s][i] = pick;
        onProgress(`trying ${p.species}'s ${stat} at ${value}, outside its range`);
        if (await witness(picks)) out[p.id][stat].outside.push(value);
      }
    }
  }
  return out;
}
