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
  ACTION_START, CHOOSABLE_TARGETS, DIE_BACKTRACKS, MAX_VARIANTS, SOFT_PRETURN, disguisableStays, hpRank, identName,
  identSide, reconstruct, sampler, splitTurns, tagsOf, unsettledDisguises,
} from '../reconstruct.mjs';
import { sameSheet } from '../replay-source.mjs';
import {
  BUDGET, FLAT, SPAN, STAT_IDS, aimFor, aliveOf, cloneKnowledge, closestSpread, containsSpread, defaultSpread, freshKnowledge, fullEvs,
  intersectKnowledge, keyOf, maskKeys, packKnowledge, pinKnowledge, restrictKnowledge, sameSpread, spreadAt, spreadsLeft, summarise,
  orderSpeeds, tighten, uniteKnowledge, unpackKnowledge, valuesOf,
} from './knowledge.mjs';
import { usualSpreads } from './usage.mjs';
import { SURVIVAL, evidencePass } from './evidence.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams, toID } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');

// What the fallback may spend: rebuilds of a failing turn, per line and per
// inference with the readings it runs again under. Each rebuild has a probe
// budget of its own, so these bound the fallback the same on every machine -
// all but a few checks it always makes, which they do not count. Nothing here
// is measured in time: a limit in time makes the answer depend on the machine
// and its load.
const FALLBACK_REBUILDS = 8;
/** Switch-ins that could each be the Illusion user, up to which every reading of them is inferred. */
const MAX_READINGS = 3;
const FALLBACK_TOTAL = 32;
// The third start of a search that gave up from both: the fallback's rebuilds
// and the joint guess tries this many times wider (`wide`); and the last, of
// one that gave up from all three: the three again with every limit this many
// times wider (`widest`).
const WIDE = 4;

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
  let at = -1;
  if (hard[diff.index] !== undefined && head(hard[diff.index]) === head(diff.expected)) {
    line = hard[diff.index];
    // An action opens with its own line; the simulator prints an empty line
    // before the moves of a turn and before its end.
    let r = raw[diff.index];
    while (r > 0 && segment[r - 1] !== '|' && !ACTION_START.has(String(segment[r]).split('|')[1])) r--;
    const a = hard.findIndex((l, n) => raw[n] >= r);
    at = r;
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
  return { what: `${line}${from}; the rebuild printed ${diff.actual ?? 'nothing'}${order}`, action, at };
}

/** Every Pokemon some protocol lines name, as `p2: Gengar`, in the order they name them. */
const namedBy = lines => [...new Set(lines.flatMap(l => String(l || '').split('|')
  .map(part => /^(?:\[\w+\]\s*)?(p[1-4])[a-d]?: (.+)$/.exec(part.trim()))
  .filter(Boolean)
  .map(m => `${m[1]}: ${m[2]}`)))];

/**
 * An input log played again with other teams - the same choices and the same
 * dice - as `channel` sees it, through the line that opens the turn after
 * `turn`, or null where the simulator stops it.
 */
async function replayWith(inputLog, packedTeams, turn, channel, exactNames = null) {
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
    const channels = exactNames?.size && channel !== -1 ? [channel, -1] : [channel];
    const msgs = extractChannelMessages(stream.battle.log.join('\n'), channels);
    const cut = (list) => {
      const norm = list.map(l => (l.startsWith('|t:|') ? '|t:|' : l));
      const end = norm.indexOf(`|turn|${turn + 1}`);
      return end < 0 ? norm : norm.slice(0, end + 1);
    };
    const log = cut(msgs[channel]);
    if (channels.length > 1) {
      for (const l of cut(msgs[-1])) {
        const [, k, ident, hp] = l.split('|');
        if (!['-damage', '-heal', '-sethp'].includes(k)) continue;
        const m = /^(p[1-4])[a-d]?: (.+)$/.exec(ident || '');
        const f = /^(\d+)\/(\d+)/.exec(hp || '');
        if (m && f && f[1] !== f[2] && exactNames.has(`${m[1]}:${m[2]}`)) log.push(`${k}|${m[1]}:${m[2]}|${f[1]}/${f[2]}`);
      }
    }
    return log;
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
 *
 * `proof` is what the evidence read the turns under: every die the scaffold
 * threw through the failing turn, with the face it had there or the roll
 * handed in its place, and every choice it wrote. It moves nothing; a rebuild
 * only checks against it whether the proof breaks (`brokenProof`).
 */
function handOn(built, rolls, coupled = Infinity) {
  const failed = built.report.diffs[0]?.turn ?? Infinity;
  const { subs, turns, variants } = built.pins;
  const upToTurn = Math.min(failed, coupled) - 1;
  const out = {
    subs: {},
    turns: {},
    variants: Number.isFinite(upToTurn) ? (variants || []).slice(0, Math.max(0, upToTurn + 1)) : (variants || []).slice(),
    seed: built.seed,
  };
  const put = (i, v, upTo) => {
    if (!(turns[i] <= upTo)) return;
    out.subs[i] = v;
    out.turns[i] = turns[i];
  };
  for (const [i, v] of Object.entries(subs)) put(i, v, upToTurn);
  // A roll an evidence path chose past a joint Pain Split is no proof.
  for (const [i, r] of rolls || []) put(i, r, Math.min(failed, coupled - 1));
  const dice = {};
  for (const d of built.dice) if (d.mark <= failed) dice[d.i] = { ...d, value: d.i in out.subs ? out.subs[d.i] : d.value };
  out.proof = { dice, choices: built.choices, starts: built.starts, rawLog: built.rawLog };
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
 * @param usage    the spreads people run, by species and nature, as in
 *                 `usage-spreads.json`: a search that gives up starts again from
 *                 the one run most (`start: 'usage'`), and each Pokemon keeps what
 *                 both searches left. Only where a search starts, never evidence.
 * @param maxRounds the rounds that get no further than the furthest one yet;
 *                 a round that gets further costs none, up to four times as
 *                 many rounds in all - a long battle a line a round
 * @param deadline a time from Date.now() past which no round starts and no
 *                 turn is searched further, and the furthest rebuild so far
 *                 is the answer - for a page that waits on it; none by
 *                 default, so the answer never depends on the machine's speed
 * @param spend    what the fallback has left - rebuilds - and the lines it
 *                 searched without getting past, shared with the inferences
 *                 this one runs again under another reading
 * @returns the surviving spreads per Pokemon, the events that removed the rest,
 *          and the reconstruction built from the spread it settled on; and
 *          `work`, what it spent, with what every inference it ran again under
 *          another reading of an Illusion spent added in: `rounds`, the rounds
 *          of the loop; `rebuilds`, every `reconstruct` it called - a round's,
 *          the fallback's and the fallback's check of a line it got past;
 *          `probes`, the runs of the battle those rebuilds played, every
 *          reading of an Illusion they tried included (`cost.probes`);
 *          `fallback`, the rebuilds the fallback made, the check its budget
 *          does not count included; `backtracks` and `dieBacktracks`, every
 *          rebuild's, summed the same way. With no deadline, two runs give the
 *          same counts for any number of threads and on any machine. `stop`,
 *          why the rounds ended (`complete`, `searches`, `stalled`, `rounds`,
 *          `deadline`), and `limits`, every limit that cut a search short on
 *          the way - the rounds' own, the fallback's (`fallbackRebuilds`,
 *          `fallbackTotal`), `guessTries`, `evidencePasses`, and every one a
 *          rebuild names in its report. And `warnings`, each proof a rebuild was handed
 *          and broke - it failed inside a turn the evidence proved, on the
 *          proof's own dice and choices (`brokenProof` in `reconstruct.mjs`) -
 *          as `{ round, turn, expected, actual, pokemon }`: the round that
 *          rebuilt it, or whose fallback did, the line the replay shows and the
 *          one rebuilt, and every Pokemon either names; the inferences run
 *          again under another reading add theirs. The loop goes on as if it
 *          had not been counted. No recording carries either
 *          (`inferenceRecord`).
 * @param parallel threads to spare (`spareThreads` in `speculate.mjs`): the
 *                 starts a search that gives up runs next begin on them at
 *                 once, and are taken in order only if needed - the same
 *                 answer, work and limits as without, sooner
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
  deadline = Infinity,
  allSpent = false,
  threads,
  onProgress = () => {},
  forced = null,
  readings = true,
  // Read the switch-ins exactly as `forced` says, the rest as the Pokemon
  // shown: the rebuild tries none as the Illusion user on its own. Knowledge
  // carries from round to round, so a reading the rebuild took up halfway
  // would mix evidence read under two readings; the readings are inferred
  // each on its own instead (`spareDisguises`).
  fixedReadings = true,
  budgetScale = 1,
  usage = null,
  start = 'default',
  wide = false,
  widest = false,
  spend = { rebuilds: FALLBACK_TOTAL * budgetScale, fruitless: new Set() },
  parallel = null,
  // The spreads the battle was really played with, by Pokemon (`p2:0`), where
  // a grader knows them: nothing is decided by them. Each step that removes
  // one is reported (`lost`).
  truth = null,
}) {
  const options = { ...arguments[0], spend };
  // `budgetScale` multiplies every search limit at once - probes, backtracks,
  // rounds, the fallback's rebuilds, guess tries, evidence passes and the
  // invisible choices walked - to price what the limits cost
  // (`npm run score -- --budget <n>`). The nested inferences scale the same.
  const S = budgetScale;
  const W = wide ? WIDE : 1;
  maxProbes *= S;
  maxRounds *= S;
  // The sides inferred: their spreads in a rebuild are guesses.
  const guessed = [0, 1].filter(s => !known?.[s]).map(s => `p${s + 1}`);
  const searchLimits = { maxVariants: MAX_VARIANTS * S, maxDieBacktracks: DIE_BACKTRACKS * S, fixedReadings, guessed };
  const dex = Dex.forFormat(formatid);
  // `passes`: every evidence pass, the settles' and the guess picker's - the
  // work a round spends besides its rebuilds, counted as they are.
  const work = { rounds: 0, rebuilds: 0, probes: 0, fallback: 0, backtracks: 0, dieBacktracks: 0, passes: 0 };
  const warnings = [];
  // Each real spread a step removed (`truth`): the Pokemon, the round and the
  // start, the step - a pass's evidence, the speed orders, the budget - and
  // the events or orders that did it. One entry per Pokemon and inference.
  const lost = [];
  // Every limit that cut a search short, here or in a rebuild or an inference
  // this one ran: an answer reached past one is no proof that more would not
  // have found more.
  const limits = new Set();
  // A proof the fallback's check broke is handed to the next round as well,
  // and breaks there again: each is counted once.
  const broken = new Set();
  const counted = (b, byFallback = false, proved = null) => {
    work.rebuilds++;
    if (byFallback) work.fallback++;
    work.probes += b.cost.probes;
    work.backtracks += b.cost.backtracks;
    work.dieBacktracks += b.cost.dieBacktracks;
    for (const l of b.cost.limits) limits.add(l);
    const at = b.brokenProof;
    if (at && proved && !broken.has(proved)) {
      broken.add(proved);
      warnings.push({ round: rounds, turn: at.turn, expected: at.expected, actual: at.actual, pokemon: namedBy([at.expected, at.actual]) });
    }
    return b;
  };
  const absorb = (res) => {
    for (const k of Object.keys(work)) work[k] += res.work[k];
    warnings.push(...res.warnings);
    lost.push(...(res.lost || []));
    for (const l of res.limits) limits.add(l);
    return res;
  };
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
  // Each unknown set's first guess, from either start: bulk and the stat its
  // nature boosts, or (`start: 'usage'`) the spread people run most with its
  // species and nature. A guess is only where the search begins.
  const firstGuesses = from => sets.map((team, s) => team.map((set) => {
    if (known[s]) return fullEvs(set.evs);
    const max = exactHp.get(`p${s + 1}:${set.name || set.species}`);
    const base = dex.species.get(set.species || set.name).baseStats.hp;
    const hp = max ? max - base - 75 : undefined;
    const usual = from === 'usage' ? usualSpreads(usage, dex, set).find(u => hp === undefined || u.evs.hp === hp) : null;
    return usual ? { ...usual.evs } : defaultSpread(dex, set, hp);
  }));
  let picks = firstGuesses(start);
  const ahead = parallel && deadline === Infinity && start === 'default' && !wide ? parallel.ahead(restarts()) : null;

  // Every speed order a round's own evidence read, by its two Pokemon and
  // tables: applied in every settle after, the guess picker's too, so a pin
  // on one Speed moves the other.
  const orders = new Map();
  let watched = null;
  const settle = async (inputLog, knowledge, cache, record = false, learn = false, kept = [], beforeTurn = Infinity) => {
    const counts = () => new Map([...knowledge].map(([id, kn]) => [id, spreadsLeft(kn)]));
    const initial = record ? counts() : null;
    let first = null;
    let afterFirst = null;
    let passes = 0;
    const keptOrders = beforeTurn < Infinity ? kept.filter(o => !(o.turn >= beforeTurn)) : kept;
    // The real spreads still possible, watched in what the rounds keep and in
    // the final reading: a guess picker's knowledge is pinned to a guess.
    const watch = truth && (knowledge === watched || record);
    const gone = () => new Set([...knowledge].filter(([id, kn]) => truth[id] && !kn.known && !containsSpread(kn, truth[id])).map(([id]) => id));
    let was = watch ? gone() : null;
    const speedOf = (id, table, end) => (truth[id] ? table[fullEvs(truth[id]).spe] : end(...table.filter((_, v) => knowledge.get(id)?.dom.spe[v])));
    const report = async (step, before) => {
      const now = gone();
      for (const id of now) {
        if (was.has(id) || lost.some(l => l.id === id)) continue;
        let by = [];
        if (step === 'evidence') {
          // The pass again from what it started with, recording what each event removed.
          const again = await evidencePass({ inputLog, observed: lines, channel, knowledge: before, cache, record: true, truth: Object.fromEntries(Object.entries(truth).map(([k, v]) => [k, fullEvs(v)])), beforeTurn });
          const cuts = (again.events || []).flatMap(e => e.cuts.filter(c => c.id === id).map(c => ({ turn: e.turn, what: e.what, narrowed: c.narrowed, real: !!c.lostReal })));
          by = cuts.filter(c => c.real);
          if (!by.length) by = cuts;
          by = by.map(({ real, ...c }) => c);
        } else if (step === 'orders') {
          const named = [...orders.values()].filter(o => o.fast === id || o.slow === id);
          by = named.filter(o => (o.strict
            ? speedOf(o.fast, o.tf, Math.max) <= speedOf(o.slow, o.ts, Math.min)
            : speedOf(o.fast, o.tf, Math.max) < speedOf(o.slow, o.ts, Math.min)));
          if (!by.length) by = named;
          by = by.map(o => ({ turn: o.turn, what: o.what || `${o.fast} before ${o.slow}` }));
        }
        lost.push({ id, real: fullEvs(truth[id]), step, round: rounds, start: widest ? 'widest' : wide ? 'wide' : start, ...(forced?.length ? { reading: [...forced] } : {}), final: !!record, by: by.slice(0, 6) });
      }
      was = now;
    };
    if (!learn && !record) {
      const allOrders = [...orders.values(), ...keptOrders];
      for (let pre = true; pre;) {
        pre = false;
        for (const kn of knowledge.values()) if (!kn.known) pre = tighten(kn) || pre;
        pre = orderSpeeds(knowledge, allOrders) || pre;
      }
      if ([...knowledge.values()].some(kn => !kn.known && (!kn.keys.includes(1) || FLAT.some(x => !kn.dom[x].includes(1))))) {
        return {
          events: [], checks: [], cutoff: null, scaffoldOrders: [], cutoffSpeeds: [],
          seen: new Set(), lent: new Map(), initial: null, afterFirst: null, passes: 0,
        };
      }
    }
    while (passes < 8 * S) {
      const before = watch ? cloneKnowledge(knowledge) : null;
      const pass = await evidencePass({ inputLog, observed: lines, channel, knowledge, cache, record: record && !first, beforeTurn });
      passes++;
      work.passes++;
      let moved = false;
      for (const r of pass.recs) moved = intersectKnowledge(knowledge.get(r.id), r.keys, r.flat, r.ties) || moved;
      if (watch) await report('evidence', before);
      if (learn) for (const o of pass.orders || []) orders.set(`${o.fast}|${o.slow}|${o.strict ? '>' : '>='}|${o.tf}|${o.ts}`, o);
      moved = orderSpeeds(knowledge, [...orders.values(), ...keptOrders]) || moved;
      if (watch) await report('orders');
      for (const kn of knowledge.values()) moved = tighten(kn) || moved;
      if (watch) await report('budget');
      if (!first) {
        first = pass;
        if (record) afterFirst = counts();
      }
      if (!moved) break;
      if (passes === 8 * S) limits.add('evidencePasses');
    }
    return {
      events: first.events,
      checks: first.checks,
      cutoff: first.cutoff,
      scaffoldOrders: first.scaffoldOrders || [],
      cutoffSpeeds: first.cutoffSpeeds || [],
      seen: new Set(first.recs.filter(r => r.seen).map(r => r.id)),
      lent: new Map(first.recs.map(r => [r.id, r.lent || []])),
      initial,
      afterFirst,
      passes,
    };
  };

  const knowledge = cloneKnowledge(blank);
  watched = knowledge;
  let built = null;
  // Per Pokemon, the others whose Stat Points moved one of its stats, from the
  // last round's evidence.
  let lent = new Map();
  let rounds = 0;
  let level = 0;
  // The budget a turn has needed - a round that got further than the last on
  // a bigger one, or the fallback's word that the guess passes under it: a
  // new guess starts from it, since the dice a round hands on are addressed
  // by ordinal and do not survive a guess that draws a different number of
  // them before that turn.
  let floor = 0;
  let reached = null;
  let exact = null;
  let pins = null;
  const started = Date.now();
  // One seed for every round, so the dice a round hands on land on the same
  // generator: an ordinal nobody pinned draws the same value every time. When
  // a resampled search gets further than the one before it, its generator
  // becomes the rounds' seed so the dice it settled keep landing where they did.
  let activeSample = sampleSeed;
  let resamples = 0;
  let seed = sampler(activeSample ^ 0x5eed).seed();
  let roundSample = activeSample;
  let roundSeed = seed;

  // A wrong guess makes a turn that no die can repair, and a full search spends
  // its whole budget proving that. So a guess is first tried on a small budget,
  // and a bigger one is only spent on a guess the evidence has no quarrel with.
  // The last resort samples differently: the search's own uniform choices can
  // corner it where a different draw of them would not.
  const budgets = [
    { maxProbes: Math.min(maxProbes, 150 * S), maxBacktracks: 0 },
    { maxProbes: Math.min(maxProbes, 600 * S), maxBacktracks: 2 * S },
    { maxProbes, maxBacktracks: 6 * S },
    { maxProbes, maxBacktracks: 6 * S, resample: 1 },
  ];

  // What the fallback found: each line no evidence hook reads, and each stat
  // coordinate it moved to get past a failing line, kept on that Pokemon's next
  // guesses while the rest of its spread stays free to move and released once
  // later evidence overrides it or a downstream stall contradicts it.
  const gaps = new Map();
  const gap = (mark, entry, found = false) => gaps.set(mark, { entry, at: mark.split('|').slice(0, 2).map(Number), found });
  const searched = new Map();
  const failedAtKn = new Map();
  const abortedBefore = new Map();
  const failed = new Set();
  const releasedAt = new Set();
  const held = new Map();
  const emptied = kn => !kn.keys.includes(1) || FLAT.some(x => !kn.dom[x].includes(1));
  const holdsIn = (kn, coords) => {
    let at = kn;
    for (const [stat, { value }] of coords) at = restrictKnowledge(at, stat, value);
    return !emptied(at);
  };
  const heldSpread = (kn, id, base) => {
    const coords = held.get(id);
    if (!coords?.size) return null;
    let at = kn;
    const aim = { ...base };
    for (const [stat, { value }] of coords) {
      const next = restrictKnowledge(at, stat, value);
      if (!emptied(next)) {
        at = next;
        aim[stat] = value;
      }
    }
    return closestSpread(at, aim);
  };
  const hasHeldSpe = id => Boolean(held.get(id)?.has('spe'));
  let evidenceTurn = 0;
  const packOf = chosen => sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: chosen[s][i] }))));
  const signature = chosen => JSON.stringify(chosen.map(team => team.map(e => STAT_IDS.map(x => e[x]))));
  const sameTeam = (a, b) => a.every((team, s) => team.every((e, i) => sameSpread(e, b[s][i])));
  const evOf = (chosen, id) => {
    const [side, slot] = id.split(':');
    return chosen[Number(side.slice(1)) - 1]?.[Number(slot)];
  };
  const ordersAllow = (chosen, list = orders.values()) => {
    for (const { fast, slow, tf, ts, strict } of list) {
      const ef = evOf(chosen, fast);
      const ew = evOf(chosen, slow);
      if (ef && ew && (strict ? tf[ef.spe] <= ts[ew.spe] : tf[ef.spe] < ts[ew.spe])) return false;
    }
    return true;
  };
  const HP_AT = { '-damage': 3, '-heal': 3, '-sethp': 3, switch: 4, drag: 4, replace: 4, detailschange: 4 };
  const canonicalLine = (line) => {
    const parts = String(line ?? '').split('|');
    const at = HP_AT[parts[1]];
    if (at !== undefined && parts[at]) parts[at] = parts[at].replace(/^\d+\/\d+[a-z]?/, 'hp');
    return parts.join('|');
  };
  const markOf = d => (d ? `${d.turn}|${d.index}|${canonicalLine(d.expected)}` : null);
  // The replay through the line that opens the turn after `turn`.
  const cutAt = (turn) => {
    const at = observed.findIndex(l => typeof l === 'string' && Number(/^\|turn\|(\d+)/.exec(l)?.[1]) === turn + 1);
    return at < 0 ? observed : observed.slice(0, at + 1);
  };
  const hpTokenOf = (line, ch = channel) => {
    const parts = String(line || '').split('|');
    const at = { '-damage': 3, '-heal': 3, '-sethp': 3, switch: 4, drag: 4, replace: 4 }[parts[1]];
    if (at === undefined || !parts[at]) return null;
    const ident = parts[2] || '';
    const side = identSide(ident);
    if (!side) return null;
    const exactSide = ch === -1 || side === `p${ch}`;
    const r = hpRank(parts[at].split(' ')[0], exactSide);
    return r ? { who: `${side}:${identName(ident)}`, kind: parts[1], rank: r.rank } : null;
  };
  const scoreSimLines = (simLines, wantTurns, ch = channel) => {
    if (!simLines) return [-1, -1, 0, -1e9];
    const gotTurns = splitTurns(simLines);
    for (let k = 0; k < wantTurns.length; k++) {
      const soft = (line) => {
        const tag = String(line).split('|')[1];
        return tag === 'player' || (k === 0 && SOFT_PRETURN.has(tag));
      };
      const a = battleLines(wantTurns[k]).filter(l => !soft(l));
      const b = battleLines(gotTurns[k] || []).filter(l => !soft(l));
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        const w = hpTokenOf(a[i], ch);
        const g = hpTokenOf(b[i], ch);
        const sameHp = !!(w && g && w.who === g.who && w.kind === g.kind);
        return [k, i, sameHp ? 1 : 0, sameHp ? -Math.abs(g.rank - w.rank) : -1e6];
      }
    }
    return [Infinity, Infinity, 1, 0];
  };
  const betterSimScore = (x, y) => {
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] > y[k] ? -1 : 1;
    return 0;
  };
  const variantsUpTo = (v, maxTurn) => {
    const arr = [];
    if (!v || !(maxTurn >= 0)) return arr;
    for (const [k, val] of Object.entries(v)) {
      const idx = Number(k);
      if (idx >= 0 && idx <= maxTurn && val) arr[idx] = val;
    }
    return arr;
  };
  const prefixPins = (given, upTo, fallbackSeed = roundSeed) => {
    const out = { subs: {}, turns: {}, variants: variantsUpTo(given?.variants, upTo), seed: given?.seed || fallbackSeed };
    if (!given || !(upTo >= 0)) return out;
    for (const [i, v] of Object.entries(given.subs || {})) {
      if (given.turns?.[i] <= upTo) {
        out.subs[i] = v;
        out.turns[i] = given.turns[i];
      }
    }
    return out;
  };
  const scaffoldLimit = (chosen, list, maxTurn = Infinity) => {
    let limit = maxTurn;
    for (const o of list) {
      if (!(o.turn >= 0) || o.turn >= limit) continue;
      const vf = evOf(chosen, o.fast)?.spe ?? 0;
      const vs = evOf(chosen, o.slow)?.spe ?? 0;
      if (o.strict ? o.tf[vf] <= o.ts[vs] : o.tf[vf] < o.ts[vs]) limit = Math.min(limit, o.turn);
    }
    return limit;
  };
  const certifyAt = async (fromBuilt, chosen, beforeTurn, sharedCache, witness) => {
    if (!(beforeTurn >= 1)) return null;
    const pinned = cloneKnowledge(blank);
    for (const [s, team] of sets.entries()) {
      if (known[s]) continue;
      for (const i of team.keys()) pinKnowledge(pinned.get(`p${s + 1}:${i}`), chosen[s][i]);
    }
    work.passes++;
    const p = await evidencePass({
      inputLog: fromBuilt.inputLog, observed: lines, channel,
      knowledge: pinned, cache: sharedCache, exact: true, beforeTurn,
    });
    if (!p.exact?.size) return null;
    for (const r of p.recs) intersectKnowledge(pinned.get(r.id), r.keys, r.flat, r.ties);
    orderSpeeds(pinned, p.orders || []);
    for (const kn of pinned.values()) tighten(kn);
    if ([...pinned.values()].some(kn => !kn.known && emptied(kn))) return null;
    const firstUnproved = [...p.exact.entries()].find(([, v]) => v.partial || v.proved !== undefined)?.[0] ?? Infinity;
    const coupledAt = Math.min(beforeTurn, p.coupled ?? Infinity, firstUnproved);
    const ex = new Map([...p.exact].filter(([k]) => k < coupledAt));
    if (!ex.size) return null;
    const rolls = witness && sameTeam(chosen, witness) ? null : p.rolls;
    return { exact: ex, pins: handOn(fromBuilt, rolls, coupledAt) };
  };
  const certifyPrefix = async (fromBuilt, chosen, scaffoldList, maxBeforeTurn, sharedCache = new Map(), witness = null) => {
    const cap = scaffoldLimit(chosen, scaffoldList, maxBeforeTurn);
    if (!(cap >= 1)) return { exact: null, pins: null };
    const full = await certifyAt(fromBuilt, chosen, cap, sharedCache, witness);
    if (full) return full;
    let lo = 0;
    let hi = cap - 1;
    let best = null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const got = await certifyAt(fromBuilt, chosen, mid, sharedCache, witness);
      if (got) { best = got; lo = mid; }
      else hi = mid - 1;
    }
    return best || { exact: null, pins: null };
  };

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
   * A line the fallback got past is only one no hook reads when the guess it
   * moved from cannot get past it either under the full search, nor the guess
   * the evidence chose along the exact HP path it proved for it: where one
   * can, a hook read the line, and the fallback only found dice a smaller
   * search missed.
   *
   * @param seen   the Pokemon the evidence has seen
   * @param start  the guess to move from: the one the scaffold was built with,
   *               each Pokemon's taken from `next` where it no longer survives
   * @param proven the guesses the evidence chose, with the exact turns and the
   *               dice it proved for them, or null
   * @returns `{ picks, pins, held, level }` - guesses that reproduce the
   *          failing line, the dice that rebuilt it, the spreads of the
   *          Pokemon whose guess it moved and the dice budget the rebuild
   *          needed - or null, when the turn is the dice search's or nothing
   *          gets past the line.
   */
  const fallback = async (seen, start0, proven, cutoffSpeeds = []) => {
    const diff = built.report.diffs[0];
    const t = diff?.turn;
    const mark = markOf(diff);
    const sampleMark = `${roundSample}|${mark}`;
    let start = start0;
    if (!diff || !(t >= 0) || !(diff.index >= 0) || (searched.get(sampleMark) || 0) >= 2
      || spend.fruitless.has(mark) || spend.fruitless.has(sampleMark)) return null;
    if (abortedBefore.get(mark) === `${signature(start)}|${roundSample}|${Math.max(1, level)}`) return null;
    const budgetCut = (...runs) => runs.some(b => b && (b.report.hidden || []).includes(t)
      && b.report.limits.some(l => l === 'probes' || l === 'variants'));
    const permanentNone = () => { searched.set(sampleMark, 2); spend.fruitless.add(mark); return null; };
    const earlyAbort = () => { abortedBefore.set(mark, `${signature(start)}|${roundSample}|${Math.max(1, level)}`); return null; };
    if (spend.rebuilds <= 0) { limits.add('fallbackTotal'); return null; }
    // A line before the first turn - the order the leads' abilities came in -
    // is rebuilt through turn 1: a rebuild needs a whole turn.
    const through = cutAt(Math.max(t, 1));
    const exactBefore = (chosen) => {
      if (!proven?.exact || !sameTeam(chosen, proven.picks)) return null;
      const m = new Map([...proven.exact].filter(([k, v]) => k < t && !v.partial && v.proved === undefined));
      return m.size ? m : null;
    };
    let handed = prefixPins(proven && sameTeam(start, proven.picks) ? proven.pins : handOn(built, null), t - 1);
    const began = Date.now();
    let spent = 0;
    const rebuild = async (chosen, budget, { upTo = through, given = handed, exact: ex = null, resample: rs = 0 } = {}) => {
      spent++;
      spend.rebuilds--;
      return counted(await reconstruct({
        formatid, packedTeams: packOf(chosen), playerNames, observed: upTo, channel, exact: ex, forced: built.forced,
        seed: roundSeed, pins: given, sampleSeed: roundSample + rs, maxProbes: budget.maxProbes, maxBacktracks: budget.maxBacktracks, threads, deadline, ...searchLimits,
      }), true, ex);
    };
    const maxNonResample = budgets.findLastIndex(b => !b.resample);
    const levelOf = bgt => (bgt === budgets[0] ? 0 : bgt.maxBacktracks <= budgets[1].maxBacktracks ? 1 : maxNonResample);
    // Asked only where there is more to try, so a no names the limit that
    // stopped the search.
    const affordable = () => {
      const out = spent >= FALLBACK_REBUILDS * S * W ? 'fallbackRebuilds' : spend.rebuilds <= 0 ? 'fallbackTotal'
        : Date.now() >= deadline ? 'deadline' : null;
      if (out) limits.add(out);
      return !out;
    };
    const reach = b => (b.report.complete ? [Infinity, Infinity] : [b.report.diffs[0]?.turn ?? -1, b.report.diffs[0]?.index ?? -1]);
    const further = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
    const outcome = b => JSON.stringify([...reach(b), b.report.diffs[0]?.actual ?? null]);
    const clock = () => `${((Date.now() - began) / 1000).toFixed(1)}s`;
    // A guess the next round keeps, with the dice and the budget of the
    // rebuild that reproduced the turn: the search is the same, so it reaches
    // the same dice - and the same choices a replay leaves invisible, which
    // no die records.
    const stays = (given, lvl, b = null) => ({ picks: start, pins: given, held: new Map(), level: lvl, built: b });

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
    const cut = place.at >= 0 ? place.at : Math.max(0, segment.indexOf(place.action?.[0]));
    // A `|cant|` line (a flinch, a status) can owe both its condition and the
    // bracket its unseen move ran in to an earlier move of the turn, which the
    // line itself does not name: a Fake Out before `|cant|...|flinch`.
    const inflicted = [];
    const earlier = [];
    {
      const m = /^\|cant\|(p[1-4])[a-d]?: ([^|]+)\|/.exec(String(diff.expected || ''));
      if (m) {
        const [, vSide, vName] = m;
        const prior = segment.slice(0, cut);
        const hitsVictim = (line, skipActor) => String(line || '').split('|').slice(skipActor ? 3 : 2).some((part) => {
          const hit = /^(?:\[\w+\]\s*)?(p[1-4])[a-d]?: (.+)$/.exec(part.trim());
          return hit && hit[1] === vSide && hit[2] === vName;
        });
        for (let i = 0; i < prior.length; i++) {
          const parts = String(prior[i]).split('|');
          if (parts[1] !== 'move' || !/^p[1-4][a-d]?: /.test(parts[2] || '')) continue;
          let j = i + 1;
          while (j < prior.length && !ACTION_START.has(String(prior[j]).split('|')[1])) j++;
          const touched = hitsVictim(prior[i], true) || prior.slice(i + 1, j).some(l => hitsVictim(l, false));
          (touched ? inflicted : earlier).push(`|move|${parts[2]}`);
        }
      }
    }
    // A condition the action ends was started by someone the turn need not
    // name: the Substitute a Giga Drain breaks is a quarter of the HP of the
    // Orthworm whose Shed Tail made it a turn before. So the Pokemon named where
    // it started, and the one whose move started it, come next.
    const started = [];
    {
      const before = [...turns.slice(0, t).flat(), ...segment.slice(0, cut)];
      const effect = x => String(x || '').replace(/^move: /, '');
      const pair = { '-end': '-start', '-sideend': '-sidestart', '-fieldend': '-fieldstart' };
      for (const l of place.action || []) {
        const [, k, where, what] = String(l).split('|');
        if (!pair[k]) continue;
        const field = k === '-fieldend';
        for (let i = before.length - 1; i >= 0; i--) {
          const [, k2, where2, what2] = String(before[i]).split('|');
          if (k2 !== pair[k]) continue;
          if (field ? effect(where2) !== effect(where) : (String(where2).slice(0, 3) !== String(where).slice(0, 3) || effect(what2) !== effect(what))) continue;
          started.push(before[i]);
          for (let j = i - 1; j >= 0; j--) if (String(before[j]).startsWith('|move|')) { started.push(before[j]); break; }
          break;
        }
      }
    }
    // Then the Pokemon whose Stat Points moved a stat or HP of one of those -
    // a Guard Split's partner, the one a Transform copied, the target a recoil
    // or drain came off - which the turn need not name: it can have fainted.
    // And any earlier attacker whose damage set the HP a lethal recoil or pinch
    // threshold on the failing action reads.
    const near = [names([diff.expected, diff.actual, ...leaving]), names([...place.action, ...inflicted])];
    const lender = new Set([...near[0], ...near[1]].flatMap(id => lent.get(id) || []));
    const hurtTargets = new Set([...near[0], ...near[1]]);
    const priorAttackers = new Set();
    if (hurtTargets.size) {
      let mover = null;
      const actionEnd = place.action?.length ? Math.max(0, cut) + place.action.length : segment.length;
      for (const l of [...turns.slice(0, t).flat(), ...segment.slice(0, Math.max(0, actionEnd))]) {
        const tag = String(l).split('|')[1];
        if (tag === 'move') mover = namedIn(String(l).split('|').slice(0, 3).join('|'));
        else if (ACTION_START.has(tag)) mover = null;
        else if (tag === '-damage' && mover) {
          const hit = namedIn(String(l).split('|').slice(0, 3).join('|'));
          if ([...hit].some(id => hurtTargets.has(id))) for (const id of mover) priorAttackers.add(id);
        }
      }
    }
    const tiers = [...near, lender, names(earlier), names(started), priorAttackers, names([...segment, ...stood.values()])];
    const rank = u => tiers.findIndex(tier => tier.has(u.id));
    const cast = unknown.filter(u => rank(u) >= 0 && (seen.has(u.id) || rank(u) === 0)).sort((a, b) => rank(a) - rank(b));
    const castKnSig = cast.filter(u => rank(u) <= 5).map((u) => {
      const kn = knowledge.get(u.id);
      return `${u.id}:${maskKeys(kn.keys).length}.${FLAT.map(s => aliveOf(kn.dom[s]).length).join('.')}`;
    }).join(',');
    if (failedAtKn.get(sampleMark) === castKnSig) return null;

    const what = place.what;
    const named = list => [...new Set(list.map(d => d.name))].map(n => `${n}'s ${[...new Set(list.filter(d => d.name === n).map(d => d.stat))].join(' and ')}`).join(', ');
    const whoIn = (text, list) => [...new Map(list.map(d => [d.id, d])).values()]
      .map(d => ({ id: d.id, at: text.lastIndexOf(d.name) })).filter(w => w.at >= 0);
    if (!cast.length) {
      gap(mark, { turn: t, what, reason: 'no evidence hook reads this line, and no inferred Pokemon the turn names could move it' });
      onProgress(`  fallback on turn ${t}: ${diff.expected} - no inferred Pokemon the turn names`);
      return permanentNone();
    }
    // A battle the replay ends before anything happens in the turn ended
    // outside it - a forfeit, the timer - which no Stat Point decides.
    if (diff.index === 0 && ['win', 'tie'].includes(String(diff.expected).split('|')[1])) {
      gap(mark, { turn: t, what, reason: 'the replay ends the battle before anything happens in the turn, which no Stat Point decides' });
      onProgress(`  fallback on turn ${t}: ${diff.expected} - the battle ended outside the turn`);
      return permanentNone();
    }

    // Each rebuild gets the smallest budget that brings the guess itself to
    // the failing line, without backtracking unless nothing smaller reaches it:
    // the dice of the turns before are handed on, and only the choices a replay
    // leaves invisible are searched there again.
    const target = [t, diff.index];
    let budget = budgets[0];
    let base = await rebuild(start, budget);
    if (!base.report.complete && further(target, reach(base))) {
      budget = { maxProbes: budgets[1].maxProbes, maxBacktracks: 0 };
      const retried = await rebuild(start, budget, { exact: reach(base)[0] < t ? exactBefore(start) : null });
      if (retried.report.complete || further(reach(retried), reach(base))) {
        base = retried;
        if (reach(base)[0] >= t) handed = prefixPins(base.pins, t - 1);
      }
    }
    if (base.report.complete || further(reach(base), target)) {
      const upTo = base.report.complete ? Math.max(t, 1) : t - 1;
      return stays(prefixPins(base.pins, upTo), levelOf(budget), base);
    }
    let activeDiceBudget = reach(base)[0] < t ? budgets[Math.max(1, level)] : budgets[1];
    let dice = await rebuild(start, activeDiceBudget, { exact: reach(base)[0] < t ? exactBefore(start) : null });
    if (!dice.report.complete && reach(base)[0] < t && reach(dice)[0] < t && proven && !sameTeam(start, proven.picks) && affordable()) {
      start = proven.picks;
      handed = prefixPins(proven.pins, t - 1);
      budget = budgets[0];
      base = await rebuild(start, budget, { exact: exactBefore(start) });
      if (reach(base)[0] >= t) handed = prefixPins(base.pins, t - 1);
      if (base.report.complete || further(reach(base), target)) {
        const upTo = base.report.complete ? Math.max(t, 1) : t - 1;
        return stays(prefixPins(base.pins, upTo), 0, base);
      }
      activeDiceBudget = reach(base)[0] < t ? budgets[Math.max(1, level)] : budgets[1];
      dice = await rebuild(start, activeDiceBudget, { exact: reach(base)[0] < t ? exactBefore(start) : null });
    }
    const dicePast = dice.report.complete || (further(reach(dice), reach(base)) && further(reach(dice), target));
    const guessed = cast.map(u => `${u.name} ${STAT_IDS.map(x => start[u.s][u.i][x]).join('/')}`).join(', ');
    onProgress(`  fallback on turn ${t}: ${diff.expected} - the guess alone (${guessed}) ${dice.report.complete ? 'reproduces it under a bigger search'
      : dicePast ? `gets past the line, stopping at ${reach(dice).join('.')}, under a bigger search` : 'does not'}, ${clock()}`);
    if (dicePast) {
      const upTo = dice.report.complete ? Math.max(t, 1) : t - 1;
      return stays(prefixPins(dice.pins, upTo), levelOf(activeDiceBudget), dice);
    }
    if (further(target, reach(base)) && !further(target, reach(dice))) {
      base = dice;
      budget = dice.report.backtracks > budgets[1].maxBacktracks ? activeDiceBudget : budgets[1];
      handed = prefixPins(dice.pins, t - 1);
    }
    if (reach(base)[0] < t) {
      const bestPre = further(reach(dice), reach(base)) ? dice : base;
      const at = bestPre.report.diffs[0];
      onProgress(`  fallback on turn ${t}: the guess stops before the turn, at ${reach(bestPre).join('.')}: wanted ${at?.expected}, got ${at?.actual}, ${clock()}`);
      return earlyAbort();
    }

    // A choosable single-target move that already ran from the right Pokemon,
    // naming another active slot with no competing redirection to sort by
    // Speed, is a choice of target and not a Stat Point.
    {
      const exp = String(diff.expected || '').split('|');
      const act = String(diff.actual || '').split('|');
      const move = exp[1] === 'move' && act[1] === 'move' && exp[2] === act[2] && exp[3] && exp[3] === act[3]
        && /^p[1-4][a-d]: /.test(exp[2] || '') && /^p[1-4][a-d]: /.test(exp[4] || '') && /^p[1-4][a-d]: /.test(act[4] || '')
        && exp[4] !== act[4] && exp.slice(5).join('|') === act.slice(5).join('|') ? dex.moves.get(exp[3]) : null;
      const sameStop = b => reach(b)[0] === t && reach(b)[1] === diff.index && b.report.diffs[0]?.actual === diff.actual;
      const redirectAbility = ability => {
        const a = dex.abilities.get(ability);
        return !!(a.onAnyRedirectTarget || a.onFoeRedirectTarget || a.onRedirectTarget);
      };
      const redirectors = () => {
        let abilityCount = 0;
        for (const team of sets) {
          for (const set of team) {
            const mega = Object.values(dex.items.get(set.item).megaStone || {})[0];
            const has = redirectAbility(set.ability) || (mega && Object.values(dex.species.get(mega).abilities).some(redirectAbility));
            if (has) abilityCount++;
          }
        }
        const upto = place.at >= 0 ? place.at : (place.action?.[0] ? segment.indexOf(place.action[0]) : segment.length);
        const prior = [...turns.slice(0, t).flat(), ...segment.slice(0, Math.max(0, upto))];
        let count = abilityCount;
        if (abilityCount >= 1 && prior.some(l => /^\|-(transform|ability)\|/.test(String(l)))) count++;
        for (const l of segment.slice(0, Math.max(0, upto))) {
          const [, k, , eff] = String(l).split('|');
          if (k === '-singleturn' && /^move: /.test(eff || '')) {
            const c = dex.moves.get(eff.slice(6)).condition;
            if (c?.onFoeRedirectTarget || c?.onRedirectTarget || c?.onAnyRedirectTarget) count++;
          }
        }
        return count;
      };
      if (move && CHOOSABLE_TARGETS.has(move.target) && !move.smartTarget
        && sameStop(base) && sameStop(dice) && redirectors() < 2) {
        gap(mark, { turn: t, what, reason: 'a single-target move aimed at another slot, which no Stat Point decides' });
        onProgress(`  fallback on turn ${t}: ${diff.expected} - a single-target move aimed at another slot, ${clock()}`);
        return permanentNone();
      }
    }
    const prevSearches = searched.get(sampleMark) || 0;
    searched.set(sampleMark, prevSearches + 1);

    // A line the rebuild printed for another Pokemon at the same step - another
    // action at an action start, or another Pokemon's simultaneous effect
    // between them - is an order, and an order is Speed's first, unless an
    // unseen choice put two moves of different priority brackets against each
    // other. A secondary or sub-event on a target before the next action, or a
    // flinch or paralysis on the same Pokemon's own turn to move, is not.
    const kind = l => String(l || '').split('|')[1];
    const who = l => (/^p[1-4][a-d]?: /.test(String(l || '').split('|')[2] || '') ? String(l || '').split('|')[2] : null);
    const opensAction = l => ACTION_START.has(kind(l))
      || /^\|-activate\|[^|]+\|confusion$|^\|-curestatus\|[^|]+\|(slp|frz)\|\[msg\]$|^\|detailschange\|/.test(String(l || ''));
    const isOrder = (a, b) => Boolean(who(a) && who(b) && who(a) !== who(b) && opensAction(a) === opensAction(b));
    const priorityShifter = sets.some(team => team.some((set) => {
      if (dex.abilities.get(set.ability).onModifyPriority) return true;
      const megaStone = dex.items.get(set.item).megaStone;
      const megaSpecies = megaStone && Object.values(megaStone)[0];
      return !!(megaSpecies && Object.values(dex.species.get(megaSpecies).abilities || {}).some(a => dex.abilities.get(a).onModifyPriority));
    }));
    const crossPriority = (() => {
      if (!((built.report.hidden || []).includes(t) || (base.report.hidden || []).includes(t))
        || kind(diff.actual) !== 'move' || kind(diff.expected) !== 'move') return false;
      const ma = dex.moves.get(String(diff.actual).split('|')[3]);
      const me = dex.moves.get(String(diff.expected).split('|')[3]);
      return ma.exists && me.exists && ma.priority !== me.priority && !ma.onModifyPriority && !me.onModifyPriority && !priorityShifter;
    })();
    const order = !crossPriority && isOrder(diff.actual, diff.expected);
    const hpDiff = ['-damage', '-heal', '-sethp'].includes(kind(diff.expected));
    const statOrder = !order && !hpDiff ? ['spe', 'hp', 'def', 'spd', 'atk', 'spa'] : STAT_IDS;
    const hasCategory = (u, cat) => (sets[u.s][u.i].moves || []).some(m => dex.moves.get(m).category === cat);
    const deadOff = d => (d.stat === 'atk' && !hasCategory(d, 'Physical') && d.alive.length === SPAN)
      || (d.stat === 'spa' && !hasCategory(d, 'Special') && d.alive.length === SPAN);
    const dims = [];
    for (const u of cast) {
      const kn = knowledge.get(u.id);
      const values = valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties).values;
      for (const stat of statOrder) {
        dims.push({
          ...u, stat, alive: aliveOf(values[stat]), now: start[u.s][u.i][stat],
          sides: new Map(), gaps: new Map(), best: null, moved: false, passed: false,
        });
      }
    }
    dims.sort((a, b) => (order ? (a.stat !== 'spe') - (b.stat !== 'spe') : 0) || deadOff(a) - deadOff(b));
    const spots = (d) => {
      const n = d.alive.length;
      return n ? [...new Set([d.alive[0], d.alive[n - 1], d.alive[(n - 1) >> 1], d.alive[n >> 2], d.alive[(3 * n) >> 2]])] : [];
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
        if (from === knowledge && held.get(id)?.size) {
          for (const [stat, { value }] of held.get(id)) {
            if (list.some(c => c.stat === stat)) continue;
            const kept = restrictKnowledge(kn, stat, value);
            if (!emptied(kept)) {
              kn = kept;
              aim[stat] = value;
            }
          }
        }
        const ok = sp => sp && list.every(c => sp[c.stat] === c.value);
        const keepStats = (baseKn, stats) => stats.reduce((cur, st) => restrictKnowledge(cur, st, start[s][i][st]), baseKn);
        let spread = null;
        if (!list.some(c => c.stat === 'spe')) {
          const withSpe = restrictKnowledge(kn, 'spe', start[s][i].spe);
          if (list.every(c => FLAT.includes(c.stat))) {
            spread = closestSpread(keepStats(withSpe, ['hp', 'def', 'spd']), aim);
            if (!ok(spread)) spread = closestSpread(restrictKnowledge(withSpe, 'hp', start[s][i].hp), aim);
          }
          if (!ok(spread)) spread = closestSpread(withSpe, aim);
        } else if (order && list.every(c => c.stat === 'spe')) {
          spread = closestSpread(keepStats(kn, ['hp', 'def', 'spd']), aim);
          if (!ok(spread)) spread = closestSpread(restrictKnowledge(kn, 'hp', start[s][i].hp), aim);
        } else if (list.every(c => FLAT.includes(c.stat))) {
          spread = closestSpread(keepStats(kn, ['hp', 'def', 'spd']), aim);
          if (!ok(spread)) spread = closestSpread(restrictKnowledge(kn, 'hp', start[s][i].hp), aim);
        }
        if (!ok(spread)) spread = closestSpread(kn, aim);
        if (!ok(spread)) return null;
        out[s][i] = spread;
      }
      return out;
    };
    const nearNames = new Set([...near[0], ...near[1]].map((id) => {
      const u = unknown.find(x => x.id === id);
      return u ? `p${u.s + 1}:${u.name}` : null;
    }).filter(Boolean));
    const scaffoldLog = (sameTeam(start, picks) && budget === budgets[0] ? built.inputLog : base.inputLog) || built.inputLog;
    const plain = await replayWith(scaffoldLog, packOf(start), t, channel, nearNames);
    const plainJson = plain ? JSON.stringify(plain) : null;
    const actorOf = l => [...namedIn(`|x|${(/^p[1-4][a-d]?: /.test(String(l || '').split('|')[2] || '') ? String(l).split('|')[2] : '')}`)][0];
    const hiddenOnTurn = (built.report.hidden || []).includes(t) || (base.report.hidden || []).includes(t);
    const disputed = hiddenOnTurn ? new Set([actorOf(diff.expected), actorOf(diff.actual)].filter(Boolean)) : new Set();
    const survival = SURVIVAL.test(diff.actual) || SURVIVAL.test(diff.expected);
    const clamped = survival || [diff.expected, diff.actual].some(l => /^\|(-enditem|-ability|-activate)\|/.test(String(l || '')) || /\b0 fnt\b/.test(String(l || '')));
    const needsRebuild = (changes, chosen) => {
      const speMoved = chosen.some((team, s) => team.some((e, i) => e.spe !== start[s][i].spe));
      return (hiddenOnTurn && speMoved)
        || changes.some(c => disputed.has(c.id) || (survival && rank(c) <= 2))
        || (clamped && changes.some(c => rank(c) >= 0 && rank(c) <= 1 && c.stat !== 'spe' && !deadOff(c)));
    };
    const hasHanded = () => Object.keys(handed.subs).length > 0 || handed.variants.some(Boolean);
    const retryBudget = () => (budget.maxBacktracks > budgets[1].maxBacktracks ? budget : budgets[1]);
    const done = new Map([[signature(start), null]]);
    const probe = async (changes, from = knowledge, { reuse = false, tie = false } = {}) => {
      const chosen = build(changes, from);
      const sig = chosen && signature(chosen);
      if (!chosen) return null;
      if (done.has(sig)) {
        const cached = done.get(sig);
        if (!tie || (cached && cached.level >= 1)) {
          return (reuse || tie) ? (cached ? { ...cached, cached: true } : null) : null;
        }
      }
      done.set(sig, null);
      const useBudget = tie ? retryBudget() : budget;
      const mustRebuild = tie || needsRebuild(changes, chosen);
      let same = false;
      if (plain && !mustRebuild) {
        const cur = JSON.stringify(await replayWith(scaffoldLog, packOf(chosen), t, channel, nearNames));
        if (cur === plainJson) {
          same = true;
        } else if (from === knowledge && changes.length === 1) {
          const [c] = changes;
          const speMoved = chosen.some((team, s) => team.some((e, i) => e.spe !== start[s][i].spe));
          const hiddenBefore = speMoved && ((built.report.hidden || []).some(h => h <= t) || (base.report.hidden || []).some(h => h <= t));
          if (!hiddenBefore && STAT_IDS.some(k => k !== c.stat && chosen[c.s][c.i][k] !== start[c.s][c.i][k])) {
            const without = chosen.map(team => team.map(e => ({ ...e })));
            without[c.s][c.i] = { ...chosen[c.s][c.i], [c.stat]: start[c.s][c.i][c.stat] };
            const fullChosen = await replayWith(scaffoldLog, packOf(chosen), t, -1);
            const fullWithout = fullChosen && await replayWith(scaffoldLog, packOf(without), t, -1);
            if (fullChosen && fullWithout && JSON.stringify(fullChosen) === JSON.stringify(fullWithout)) same = true;
          }
        }
      }
      let b = same ? null : await rebuild(chosen, useBudget);
      let fresh = false;
      if (b && !b.report.complete && (reach(b)[0] < t || tie) && hasHanded() && affordable()) {
        const again = await rebuild(chosen, retryBudget(), { given: null });
        if (further(reach(again), reach(b))) [b, fresh] = [again, true];
      }
      const stop = b && b.report.diffs[0];
      onProgress(`  fallback on turn ${t}: ${changes.map(c => `${c.name} ${c.stat} ${c.value}`).join(', ')} - ${same ? 'plays out the same'
        : b.report.complete ? 'reproduces it' : `stops at ${reach(b).join('.')}: wanted ${stop?.expected}, got ${stop?.actual}`}${fresh ? ' with the dice before it searched again' : ''}, ${clock()}`);
      const res = {
        chosen, b, same, fresh, resampled: false, changes,
        level: fresh ? levelOf(retryBudget()) : levelOf(useBudget),
      };
      done.set(sig, res);
      return res;
    };

    const baseReach = reach(base);
    const goalReach = further(baseReach, target) ? baseReach : target;
    const baseOutcome = outcome(base);
    const wantHp = hpTokenOf(diff.expected);
    const gapAtLine = (b) => {
      if (!wantHp || !b || b.report.complete) return null;
      const r = reach(b);
      if (r[0] !== baseReach[0] || r[1] !== baseReach[1]) return null;
      const gotHp = hpTokenOf(b.report.diffs[0]?.actual);
      if (!gotHp || gotHp.who !== wantHp.who || gotHp.kind !== wantHp.kind) return null;
      return gotHp.rank - wantHp.rank;
    };
    const baseGap = gapAtLine(base);
    const baseSide = baseGap === null || baseGap === 0 ? 'same' : baseGap < 0 ? 'low' : 'high';
    const closer = (b1, b2) => {
      const [r1, r2] = [reach(b1), reach(b2)];
      if (r1[0] !== r2[0] || r1[1] !== r2[1]) return further(r1, r2);
      const [g1, g2] = [gapAtLine(b1), gapAtLine(b2)];
      return g1 !== null && (g2 === null || Math.abs(g1) < Math.abs(g2));
    };
    let found = null;
    let ahead = null;
    const beam = [];
    const addBeam = (changes, got) => {
      const g = gapAtLine(got.b);
      if (g === null || (baseGap !== null && Math.abs(g) >= Math.abs(baseGap))) return false;
      const abs = Math.abs(g);
      const hadBest = beam[0]?.abs ?? Infinity;
      beam.push({ changes, chosen: got.chosen, b: got.b, abs });
      beam.sort((x, y) => x.abs - y.abs);
      if (beam.length > 3) beam.length = 3;
      return abs < hadBest;
    };
    const judge = (changes, got, d = null) => {
      const r = reach(got.b);
      const pastLine = further(r, goalReach);
      const changed = outcome(got.b) !== baseOutcome;
      if (d) {
        const { value } = changes[0];
        if (r[0] >= t && changed) d.moved = true;
        if (pastLine) d.passed = true;
        if (changed && !further(baseReach, r) && (!d.best || closer(got.b, d.best.b))) d.best = { value, b: got.b };
        const g = gapAtLine(got.b);
        if (g !== null) d.gaps.set(value, g);
      }
      if (got.b.report.complete) found = { got, by: changes };
      else if (pastLine && (!ahead || further(r, reach(ahead.got.b)))) ahead = { got, by: changes };
      else if (r[0] === baseReach[0] && r[1] === baseReach[1]) addBeam(changes, got);
    };
    const sideOf = (got) => {
      if (got.same) return baseSide;
      if (further(baseReach, reach(got.b))) return 'early';
      if (outcome(got.b) === baseOutcome) return baseSide;
      const g = gapAtLine(got.b);
      if (g !== null && g !== 0) return g < 0 ? 'low' : 'high';
      return 'other';
    };
    const dimOf = (u, stat) => dims.find(x => x.id === u.id && x.stat === stat) || (() => {
      const kn = knowledge.get(u.id);
      const values = valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties).values;
      return { ...u, stat, alive: aliveOf(values[stat]), now: start[u.s][u.i][stat] };
    })();
    const escort = async (moves, got, prevStop = base.report.diffs[0]) => {
      const stop = got.b?.report.diffs[0];
      const earlier = stop && prevStop && further([prevStop.turn, prevStop.index], [stop.turn, stop.index]);
      const swapped = stop && prevStop && stop.turn === prevStop.turn && stop.index === prevStop.index && who(stop.actual) !== who(prevStop.actual);
      if (moves.length >= 4 || moves.some(c => c.stat !== 'spe') || (!earlier && !swapped) || !isOrder(stop.actual, stop.expected)) return;
      for (const id of namedIn(`|${who(stop.expected)}|${who(stop.actual)}`)) {
        if (moves.some(c => c.id === id)) continue;
        const o = dimOf(unknown.find(u => u.id === id), 'spe');
        const ends = [...new Set([o.alive[0], o.alive[o.alive.length - 1]])].filter(v => v !== undefined && v !== o.now)
          .sort((x, y) => Math.abs(y - o.now) - Math.abs(x - o.now));
        for (const ov of ends) {
          if (found || ahead || !affordable()) return;
          const changes = [...moves, { ...o, value: ov }];
          const pair = await probe(changes);
          if (pair?.b) judge(changes, pair);
          if (pair?.b && !found && !ahead) await escort(changes, pair, stop);
        }
      }
    };
    const tryValue = async (d, value, { escorted = true } = {}) => {
      if (value === d.now) {
        d.sides.set(value, baseSide);
        if (baseGap !== null) d.gaps.set(value, baseGap);
        return baseSide;
      }
      if (d.sides.has(value)) return d.sides.get(value);
      const changes = [{ ...d, value }];
      const got = await probe(changes, knowledge, { reuse: true });
      if (!got) return null;
      if (got.b && !got.cached) judge(changes, got, d);
      d.sides.set(value, sideOf(got));
      if (!got.cached && escorted && got.b && !found && !ahead) await escort(changes, got);
      return d.sides.get(value);
    };

    // Matched speed pairs at the cutoff sort, read off the simulator's own
    // speed tables there: first the least-collateral strict inversion allowed
    // by earlier orders, then exact speed ties (`ta[va] === tb[vb]`), ranked
    // by Stat Points disturbed outside Speed so the 66-point cap does not
    // strip bulk or offence before an unintrusive pair is tried.
    if (order && cutoffSpeeds.length) {
      const allPokemon = [];
      for (const [s, team] of sets.entries()) {
        for (const [i, set] of team.entries()) allPokemon.push({ s, i, id: `p${s + 1}:${i}`, name: set.name || set.species });
      }
      const idOfLine = (l) => {
        const src = kind(l) === 'switch' ? stood.get(String(l || '').split('|')[2]?.slice(0, 3)) : l;
        const first = String(src || '').split('|')[2] || '';
        const ident = /^p[1-4][a-d]?: /.test(first) ? first : tagsOf(String(src || '')).of;
        const m = /^(p[1-4])[a-d]?: (.+)$/.exec(ident || '');
        return m ? allPokemon.find(p => `p${p.s + 1}` === m[1] && p.name === m[2])?.id : null;
      };
      const turnLines = (() => {
        const from = (plain || []).indexOf(`|turn|${t}`);
        return from < 0 ? [] : plain.slice(from + 1);
      })();
      const at = turnLines.indexOf(diff.actual);
      const nextLine = at < 0 ? null : turnLines.slice(at + 1).find(l => ['move', 'cant', 'switch', 'drag'].includes(kind(l))
        && who(l) && who(l) !== who(diff.actual) && who(l) !== who(diff.expected));
      const prevMove = at > 0 && !ACTION_START.has(kind(diff.actual))
        ? turnLines.slice(0, at).findLast(l => kind(l) === 'move' && who(l) && who(l) !== who(diff.expected)) : null;
      const spe = id => dims.find(d => d.id === id && d.stat === 'spe');
      const collateralOf = (d) => {
        const map = new Map();
        const kn = knowledge.get(d.id);
        const baseEv = start[d.s][d.i];
        for (const v of d.alive) {
          const sp = spreadAt(kn, 'spe', v, baseEv);
          if (!sp) continue;
          let col = 0;
          for (const x of STAT_IDS) if (x !== 'spe') col += Math.abs(sp[x] - baseEv[x]);
          map.set(v, col);
        }
        return map;
      };
      const idA = idOfLine(diff.expected);
      const fa = idA && cutoffSpeeds.find(x => x.id === idA);
      const rivals = [...new Set([idOfLine(diff.actual), nextLine && idOfLine(nextLine), prevMove && idOfLine(prevMove)].filter(Boolean))];
      for (const idB of rivals) {
        if (!fa || idB === idA || found || ahead || !affordable()) continue;
        const fb = cutoffSpeeds.find(x => x.id === idB);
        if (!fb || fa.owner === fb.owner) continue;
        const da = spe(fa.owner);
        const db = spe(fb.owner);
        if (da && db && da.alive.length && db.alive.length) {
          if (fa.table[da.now] === fb.table[db.now] && hasHanded() && affordable()) {
            const fresh = await rebuild(start, retryBudget(), { given: null });
            if (fresh.report.complete || further(reach(fresh), goalReach)) {
              onProgress(`  fallback on turn ${t}: the tied guess alone gets past the line with the dice before it searched again, ${clock()}`);
              const upTo = fresh.report.complete ? Math.max(t, 1) : (fresh.report.diffs[0]?.turn ?? 0) - 1;
              return stays(prefixPins(fresh.pins, upTo), levelOf(retryBudget()), fresh);
            }
          }
          const colA = collateralOf(da);
          const colB = collateralOf(db);
          const pairRules = [...orders.values()].filter(o => (o.fast === da.id && o.slow === db.id) || (o.fast === db.id && o.slow === da.id));
          const okOrders = (va, vb) => pairRules.every((o) => {
            const [lhs, rhs] = o.fast === da.id ? [o.tf[va], o.ts[vb]] : [o.tf[vb], o.ts[va]];
            return o.strict ? lhs > rhs : lhs >= rhs;
          });
          const strict = [];
          const ties = [];
          for (const va of da.alive) {
            if (!colA.has(va)) continue;
            for (const vb of db.alive) {
              if (!colB.has(vb) || !okOrders(va, vb) || (va === da.now && vb === db.now)) continue;
              const col = colA.get(va) + colB.get(vb);
              const dist = Math.abs(va - da.now) + Math.abs(vb - db.now);
              if (fa.table[va] > fb.table[vb]) strict.push({ va, vb, col, dist });
              else if (fa.table[va] === fb.table[vb]) ties.push({ va, vb, col, dist, speed: fa.table[va] });
            }
          }
          const rankPair = (x, y) => x.col - y.col || x.dist - y.dist;
          strict.sort(rankPair);
          ties.sort(rankPair);
          if (strict.length && !found && !ahead && affordable()) {
            const { va, vb } = strict[0];
            const changes = [{ ...da, value: va }, { ...db, value: vb }];
            const got = await probe(changes);
            if (got?.b) judge(changes, got);
            if (got?.b && !found && !ahead && sideOf(got) === 'early') await escort(changes, got);
          }
          const seenSpeeds = new Set();
          for (const { va, vb, speed } of ties) {
            if (seenSpeeds.has(speed)) continue;
            seenSpeeds.add(speed);
            if (seenSpeeds.size > 3 || found || ahead || !affordable()) break;
            const changes = [{ ...da, value: va }, { ...db, value: vb }];
            const got = await probe(changes, knowledge, { tie: true });
            if (got?.b && !got.cached) judge(changes, got);
          }
        } else if ((da && !db) || (!da && db)) {
          const d = da || db;
          if (!d.alive.length) continue;
          const aNow = evOf(start, fa.owner)?.spe ?? 0;
          const bNow = evOf(start, fb.owner)?.spe ?? 0;
          const curDiff = da ? fa.table[da.now] - fb.table[bNow] : fa.table[aNow] - fb.table[db.now];
          if (curDiff === 0 && hasHanded() && affordable()) {
            const fresh = await rebuild(start, retryBudget(), { given: null });
            if (fresh.report.complete || further(reach(fresh), goalReach)) {
              onProgress(`  fallback on turn ${t}: the tied guess alone gets past the line with the dice before it searched again, ${clock()}`);
              const upTo = fresh.report.complete ? Math.max(t, 1) : (fresh.report.diffs[0]?.turn ?? 0) - 1;
              return stays(prefixPins(fresh.pins, upTo), levelOf(retryBudget()), fresh);
            }
          }
          const col = collateralOf(d);
          const candidates = d.alive.filter(v => v !== d.now && col.has(v))
            .map(v => ({
              v,
              col: col.get(v),
              dist: Math.abs(v - d.now),
              diff: da ? fa.table[v] - fb.table[bNow] : fa.table[aNow] - fb.table[v],
            }))
            .filter(x => x.diff >= 0)
            .sort((x, y) => x.col - y.col || x.dist - y.dist);
          for (const [cand, isTie] of [[candidates.find(x => x.diff > 0), false], [candidates.find(x => x.diff === 0), true]]) {
            if (!cand || found || ahead || !affordable()) continue;
            const changes = [{ ...d, value: cand.v }];
            const got = await probe(changes, knowledge, { tie: isTie });
            if (got?.b && !got.cached) judge(changes, got, d);
          }
        }
      }
    }

    const orderPairs = (() => {
      if (!order) return [];
      const actor = l => [...namedIn(`|x|${who(l) || ''}`)][0];
      const turnLines = (() => {
        const from = (plain || []).indexOf(`|turn|${t}`);
        return from < 0 ? [] : plain.slice(from + 1);
      })();
      const at = turnLines.indexOf(diff.actual);
      const next = at < 0 ? null : turnLines.slice(at + 1).find(l => ['move', 'cant', 'switch', 'drag'].includes(kind(l))
        && who(l) && who(l) !== who(diff.actual) && who(l) !== who(diff.expected));
      const spe = id => dims.find(d => d.id === id && d.stat === 'spe');
      const da = spe(actor(diff.expected));
      return [spe(actor(diff.actual)), next ? spe(actor(next)) : null]
        .filter(db => da && db && da.id !== db.id && da.alive.length && db.alive.length)
        .map(db => [da, db]);
    })();
    if (orderPairs.length && disputed.size && !found && !ahead) {
      for (const [da, db] of orderPairs) {
        const top = d => d.alive[d.alive.length - 1];
        for (const [va, vb] of [[top(da), db.alive[0]], [da.alive[0], top(db)], [da.alive[0], db.alive[0]], [top(da), top(db)]]) {
          if (found || ahead || !affordable()) break;
          const changes = [{ ...da, value: va }, { ...db, value: vb }];
          const got = await probe(changes);
          if (got?.b) judge(changes, got);
          if (got?.b && !found && !ahead) await escort(changes, got);
        }
      }
    }

    const halving = async ({ d, i: i0, j: j0, sLo: s0, sHi: s1, refGap }) => {
      let [i, j, sLo, sHi] = [i0, j0, s0, s1];
      while (j - i > 1 && !found && !ahead && affordable()) {
        const m = (i + j) >> 1;
        const side = await tryValue(d, d.alive[m], { escorted: false });
        if (!side) break;
        if (refGap !== null && (side === 'low' || side === 'high')) {
          const g = d.gaps.get(d.alive[m]);
          if (g !== undefined && Math.abs(g) > Math.abs(refGap) && Math.sign(g) === Math.sign(refGap)) break;
        }
        if (side === sLo) i = m;
        else if (side === sHi) j = m;
        else if ((sLo === 'early' || sHi === 'early') && (side === 'low' || side === 'high')) {
          if (sLo === 'early' && sHi !== side) { i = m; sLo = side; }
          else if (sHi === 'early' && sLo !== side) { j = m; sHi = side; }
          else break;
        } else break;
      }
    };
    const segPriority = (a, b) => ((a === 'low' && b === 'high') || (a === 'high' && b === 'low') ? 0
      : a === 'early' || b === 'early' ? 1 : 2);
    const safeHi = d => d.alive.findLast(v => v >= d.now && (v === d.now || d.sides.get(v) === baseSide)) ?? d.now;
    const safeLo = d => d.alive.find(v => v <= d.now && (v === d.now || d.sides.get(v) === baseSide)) ?? d.now;
    const walkedSpe = new Set();
    const pairedSpe = new Set();
    const sweepDims = async (subset) => {
      const halve = [];
      for (const d of subset) {
        const n = d.alive.length;
        if (n < 2 || found || ahead || !affordable()) continue;
        const kNow = d.alive.indexOf(d.now);
        if (kNow >= 0) {
          d.sides.set(d.now, baseSide);
          if (baseGap !== null) d.gaps.set(d.now, baseGap);
        }
        await tryValue(d, d.alive[0]);
        if (!found && !ahead && affordable()) await tryValue(d, d.alive[n - 1]);
        const anchors = [...new Set([0, ...(kNow > 0 && kNow < n - 1 ? [kNow] : []), n - 1])]
          .filter(idx => d.sides.get(d.alive[idx]));
        for (let k = 0; k + 1 < anchors.length && !found && !ahead && affordable(); k++) {
          const [ia, ib] = [anchors[k], anchors[k + 1]];
          if (ib - ia <= 1) continue;
          const [sLo, sHi] = [d.sides.get(d.alive[ia]), d.sides.get(d.alive[ib])];
          if (!sLo || !sHi || sLo === sHi) continue;
          const refGap = ia === kNow || ib === kNow ? baseGap : null;
          const seg = { d, i: ia, j: ib, sLo, sHi, refGap, prio: segPriority(sLo, sHi) };
          if (seg.prio === 0 || (order && d.stat === 'spe')) await halving(seg);
          else halve.push(seg);
        }
        if (order && d.stat === 'spe') {
          walkedSpe.add(d);
          if (!found && !ahead && affordable()) {
            for (const [da, db] of orderPairs) {
              const key = `${da.id}|${db.id}`;
              if (pairedSpe.has(key) || !walkedSpe.has(da) || !walkedSpe.has(db)) continue;
              pairedSpe.add(key);
              const top = x => x.alive[x.alive.length - 1];
              for (const [va, vb] of [[safeHi(da), safeLo(db)], [safeLo(da), safeHi(db)], [top(da), db.alive[0]], [da.alive[0], top(db)]]) {
                if (found || ahead || !affordable()) break;
                const changes = [{ ...da, value: va }, { ...db, value: vb }];
                const got = await probe(changes);
                if (got?.b) judge(changes, got);
                if (got?.b && !found && !ahead && sideOf(got) === 'early') await escort(changes, got);
              }
            }
          }
        }
      }
      halve.sort((x, y) => x.prio - y.prio);
      for (const h of halve) await halving(h);
      for (const d of subset) {
        if (found || ahead || !affordable()) break;
        if (d.alive.length) await tryValue(d, d.alive[(d.alive.length - 1) >> 1]);
      }
    };
    const groups = order
      ? [dims.filter(d => d.stat === 'spe'), dims.filter(d => d.stat !== 'spe' && rank(d) <= 5), dims.filter(d => d.stat !== 'spe' && rank(d) > 5)]
      : [dims.filter(d => rank(d) <= 5), dims.filter(d => rank(d) > 5)];
    for (const group of groups) {
      if (group.length && !found && !ahead && affordable()) await sweepDims(group);
    }

    // 1D-first subdivision of moved stats (and moved pairs / survival pairs)
    // before multi-stat `runCoupledBatch`.
    const bisectOrder = (arr) => {
      const out = [];
      const q = [[0, arr.length - 1]];
      while (q.length) {
        const [lo, hi] = q.shift();
        if (lo > hi) continue;
        const mid = (lo + hi) >> 1;
        out.push(arr[mid]);
        q.push([lo, mid - 1], [mid + 1, hi]);
      }
      return out;
    };
    const furthest = (a, b) => (closer(b.best.b, a.best.b) ? 1 : closer(a.best.b, b.best.b) ? -1 : 0);
    const moved = dims.filter(d => d.moved && d.best).sort(furthest);
    const rests = new Map(moved.map(d => [d, bisectOrder(d.alive).filter(v => v !== d.now && !d.sides.has(v))]));
    const atLine = moved.filter(d => !further(baseReach, reach(d.best.b)));
    const earlyMoved = moved.filter(d => further(baseReach, reach(d.best.b)));
    const coarseCap = atLine.length >= 2 ? 3 : Infinity;
    for (const d of atLine) {
      for (const value of rests.get(d).slice(0, coarseCap)) {
        if (found || ahead || !affordable()) break;
        await tryValue(d, value, { escorted: false });
      }
    }
    for (let x = 0; x < atLine.length && !found && !ahead; x++) {
      for (let y = x + 1; y < atLine.length && !found && !ahead; y++) {
        const [a, b] = [atLine[x], atLine[y]];
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
    if (coarseCap < Infinity) {
      for (const d of atLine) {
        for (const value of rests.get(d).slice(coarseCap)) {
          if (found || ahead || !affordable()) break;
          await tryValue(d, value, { escorted: false });
        }
      }
    }
    for (const d of earlyMoved) {
      for (const value of rests.get(d)) {
        if (found || ahead || !affordable()) break;
        await tryValue(d, value, { escorted: false });
      }
    }
    const atSet = new Set(atLine);
    for (let x = 0; x < moved.length && !found && !ahead; x++) {
      for (let y = x + 1; y < moved.length && !found && !ahead; y++) {
        const [a, b] = [moved[x], moved[y]];
        if (atSet.has(a) && atSet.has(b)) continue;
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
    if (survival && !found && !ahead && affordable()) {
      const heldUp = SURVIVAL.test(diff.actual);
      const endsOf = (d) => {
        const ends = [...new Set([d.alive[0], d.alive[d.alive.length - 1]])];
        return (near[0].has(d.id) ? heldUp : !heldUp) ? ends.reverse() : ends;
      };
      const pairDims = dims.filter(d => d.alive.length > 1
        && (near[0].has(d.id) ? ['hp', 'def', 'spd'].includes(d.stat) : rank(d) <= 2 && ['atk', 'spa'].includes(d.stat)));
      for (let x = 0; x < pairDims.length && !found && !ahead; x++) {
        for (let y = x + 1; y < pairDims.length && !found && !ahead; y++) {
          const [a, b] = [pairDims[x], pairDims[y]];
          for (const va of endsOf(a)) {
            for (const vb of endsOf(b)) {
              if (found || ahead || !affordable()) break;
              const changes = [{ ...a, value: va }, { ...b, value: vb }];
              const got = await probe(changes);
              if (got?.b) judge(changes, got);
            }
          }
        }
      }
    }
    if (!found && !ahead && affordable()) {
      const wantTurns = splitTurns(through.filter(l => typeof l === 'string'));
      const basePlain = await replayWith(base.inputLog, packOf(start), Math.max(t, 1), channel, nearNames);
      const basePlainStr = basePlain ? JSON.stringify(basePlain) : null;
      const runCoupledBatch = async (rawChanges, limit) => {
        const queued = [];
        const queuedSigs = new Set();
        for (const changes of rawChanges) {
          if (queued.length >= limit) break;
          const chosen = build(changes, knowledge);
          if (!chosen) continue;
          const sig = signature(chosen);
          if (done.has(sig) || queuedSigs.has(sig)) continue;
          queuedSigs.add(sig);
          queued.push({ changes, chosen });
        }
        const scored = [];
        for (const item of queued) {
          if (Date.now() >= deadline) break;
          const simLines = await replayWith(base.inputLog, packOf(item.chosen), Math.max(t, 1), channel, nearNames);
          if (basePlainStr && !needsRebuild(item.changes, item.chosen) && JSON.stringify(simLines) === basePlainStr) {
            done.set(signature(item.chosen), { chosen: item.chosen, b: null, same: true, fresh: false, resampled: false, changes: item.changes, level: 0 });
            continue;
          }
          scored.push({ ...item, score: scoreSimLines(simLines, wantTurns) });
        }
        scored.sort((x, y) => betterSimScore(x.score, y.score));
        let improvedBeam = false;
        for (const item of scored) {
          if (found || ahead || !affordable()) break;
          const bestBefore = beam[0]?.abs ?? Infinity;
          const got = await probe(item.changes);
          if (got?.b) {
            judge(item.changes, got);
            if ((beam[0]?.abs ?? Infinity) < bestBefore) improvedBeam = true;
          }
        }
        return improvedBeam;
      };

      const candidates = [];
      for (const u of cast) {
        if (rank(u) > 2) continue;
        const spentNow = STAT_IDS.reduce((s, x) => s + start[u.s][u.i][x], 0);
        if (spentNow < BUDGET - 8) continue;
        const uDims = dims.filter(d => d.id === u.id && !deadOff(d) && d.alive.length > 1);
        for (const d1 of uDims) {
          for (const v1 of [...new Set([d1.best?.value, d1.alive[d1.alive.length - 1], d1.alive[(d1.alive.length - 1) >> 1]])]) {
            if (v1 === undefined || !(v1 > d1.now) || spentNow + (v1 - d1.now) <= BUDGET) continue;
            const need = spentNow + (v1 - d1.now) - BUDGET;
            for (const d2 of uDims) {
              if (d2.stat === d1.stat || d2.now <= d2.alive[0]) continue;
              const v2 = d2.alive.find(v => v >= Math.max(d2.alive[0], d2.now - need)) ?? d2.alive[0];
              if (v2 < d2.now) candidates.push([{ ...d1, value: v1 }, { ...d2, value: v2 }]);
            }
          }
        }
      }
      const earlyDims = dims.filter(d => !d.moved && (rank(d) <= 1 || d.stat === 'spe') && [...d.sides.values()].includes('early'));
      for (const a of earlyDims) {
        const mates = dims.filter(b => b !== a && b.id === a.id && b.alive.length > 1 && (b.alive.length < SPAN || b.stat === 'hp'));
        for (const b of mates) {
          for (const va of spots(a).filter(v => v !== a.now)) {
            for (const vb of spots(b).filter(v => v !== b.now)) {
              candidates.push([{ ...a, value: va }, { ...b, value: vb }]);
            }
          }
        }
      }
      if (clamped) {
        const paired = dims.filter(d => rank(d) >= 0 && rank(d) <= 1 && d.stat !== 'spe' && !deadOff(d) && d.alive.length > 1);
        for (let x = 0; x < paired.length; x++) {
          for (let y = x + 1; y < paired.length; y++) {
            const [a, b] = [paired[x], paired[y]];
            for (const va of [a.alive[a.alive.length - 1], a.alive[0]]) {
              for (const vb of [b.alive[b.alive.length - 1], b.alive[0]]) {
                candidates.push([{ ...a, value: va }, { ...b, value: vb }]);
              }
            }
          }
        }
      }
      const active = dims.filter(d => !deadOff(d) && d.alive.length > 1
        && (d.moved || (rank(d) <= 5 && [...d.sides.values()].some(s => s && s !== baseSide))))
        .sort((a, b) => (b.moved - a.moved) || (rank(a) - rank(b)))
        .slice(0, 10);
      const valsOf = d => [...new Set([d.best?.value, ...spots(d)])].filter(v => v !== undefined && v !== d.now).slice(0, 4);
      for (const bm of beam.slice(0, 2)) {
        for (const d of active) {
          if (bm.changes.some(c => c.id === d.id && c.stat === d.stat)) continue;
          for (const vd of valsOf(d)) candidates.push([...bm.changes, { ...d, value: vd }]);
        }
      }
      const pairList = [];
      for (let x = 0; x < active.length; x++) {
        for (let y = x + 1; y < active.length; y++) pairList.push([active[x], active[y]]);
      }
      pairList.sort(([a1, b1], [a2, b2]) => ((a1.id === b1.id) - (a2.id === b2.id)));
      for (const [a, b] of pairList) {
        for (const va of valsOf(a)) {
          for (const vb of valsOf(b)) candidates.push([{ ...a, value: va }, { ...b, value: vb }]);
        }
      }
      const improved = await runCoupledBatch(candidates, 28 * W);
      if (improved && !found && !ahead && affordable() && beam.length) {
        const ext = [];
        const top = beam[0];
        for (const d of active) {
          if (top.changes.some(c => c.id === d.id && c.stat === d.stat)) continue;
          for (const vd of valsOf(d)) ext.push([...top.changes, { ...d, value: vd }]);
        }
        await runCoupledBatch(ext, 12 * W);
      }
    }
    if (!found && !ahead && /^\|-(damage|heal|sethp)\|/.test(String(diff.expected || '')) && affordable()) {
      for (const entry of [...done.values()]) {
        if (found || ahead || !affordable()) break;
        if (!entry?.b || entry.b.report.complete) continue;
        const r = reach(entry.b);
        if (r[0] !== t || r[1] !== diff.index) continue;
        const alt = await rebuild(entry.chosen, budget, { resample: 1 });
        if (further(reach(alt), r)) {
          entry.b = alt;
          entry.resampled = true;
          judge(entry.changes, entry);
        }
      }
    }

    // A spread found under the dice of the turns before can owe the line to
    // dice that land differently under it; the guess itself, with those dice
    // searched again, says whether it does.
    if ((found || ahead) && hasHanded()) {
      const cand = found || ahead;
      const subsKept = !cand.got.fresh && !cand.got.resampled
        && Object.entries(handed.subs).every(([k, v]) => cand.got.b.pins?.subs?.[k] === v)
        && handed.variants.every((v, k) => (cand.got.b.pins?.variants?.[k] || 0) === (v || 0));
      let preSame = false;
      if (subsKept && t > 1) {
        const r1 = await replayWith(scaffoldLog, packOf(cand.got.chosen), t - 1, -1);
        const r2 = r1 !== null ? await replayWith(scaffoldLog, packOf(start), t - 1, -1) : null;
        preSame = r1 !== null && r2 !== null && JSON.stringify(r1) === JSON.stringify(r2);
      }
      if (!preSame) {
        const fresh = await rebuild(start, retryBudget(), { given: null });
        if (fresh.report.complete || further(reach(fresh), goalReach)) {
          onProgress(`  fallback on turn ${t}: the guess alone gets past the line with the dice before it searched again, ${clock()}`);
          const upTo = fresh.report.complete ? Math.max(t, 1) : (fresh.report.diffs[0]?.turn ?? 0) - 1;
          return stays(prefixPins(fresh.pins, upTo), levelOf(retryBudget()), fresh);
        }
      }
    }
    const win = found || ahead;
    if (win) {
      const passed = dims.filter(d => d.passed);
      const by = passed.length ? passed : win.by;
      const text = `${what} (moved by ${named(by)})`;
      if (!gaps.get(mark)?.found) {
        const diceStoppedByCap = activeDiceBudget !== budgets[maxNonResample]
          && (dice.report.stop === 'probes' || dice.report.stop === 'backtracks');
        let read = further(reach(dice), target);
        const checks = [
          ...(proven?.exact ? [[proven.picks, proven.pins, proven.exact]] : []),
          ...(diceStoppedByCap ? [[start, handed, null]] : []),
        ];
        for (const [chosen, given, ex] of checks) {
          if (read) break;
          const b = counted(await reconstruct({
            formatid, packedTeams: packOf(chosen), playerNames, observed: through, channel, exact: ex, forced: built.forced,
            seed: roundSeed, pins: given, sampleSeed: roundSample,
            maxProbes: budgets[maxNonResample].maxProbes, maxBacktracks: budgets[1].maxBacktracks,
            threads, deadline, ...searchLimits,
          }), true, ex);
          read = b.report.complete || further(reach(b), target);
        }
        if (!read) gap(mark, { turn: t, what: text, who: whoIn(text, by), reason: 'no evidence hook reads this line, and the fallback found a spread that reproduces it' }, true);
      }
      onProgress(`  fallback on turn ${t}: ${found ? 'reproduced' : `past the line, stopping at ${reach(ahead.got.b).join('.')}`} in ${spent} rebuilds, ${clock()}`);
      const fullNorm = list => list && list.map(l => l.replace(/\|(\d+)\/\1(?=[|\s]|$)/g, '|100/100'));
      const chosenPicks = win.got.chosen.map(team => team.map(e => ({ ...e })));
      const winTurn = Math.max(t, 1);
      const winBase = fullNorm(await replayWith(win.got.b.inputLog, packOf(chosenPicks), winTurn, -1));
      const spreads = new Map();
      const byId = new Map();
      for (const c of win.by) byId.set(c.id, [...(byId.get(c.id) || []), c]);
      for (const [id, list] of byId) {
        const { s, i } = list[0];
        const orig = start[s][i];
        const cur = chosenPicks[s][i];
        const kn = knowledge.get(id);
        const asked = new Set(list.map(c => c.stat));
        if (winBase) {
          for (const stat of [...asked, ...STAT_IDS.filter(x => !asked.has(x))]) {
            if (cur[stat] === orig[stat]) continue;
            const cand = { ...cur, [stat]: orig[stat] };
            if (!containsSpread(kn, cand)) continue;
            const trial = chosenPicks.map(team => team.map(e => ({ ...e })));
            trial[s][i] = cand;
            const gotLog = fullNorm(await replayWith(win.got.b.inputLog, packOf(trial), winTurn, -1));
            if (gotLog && JSON.stringify(gotLog) === JSON.stringify(winBase)) cur[stat] = orig[stat];
          }
        }
        const coords = new Map();
        for (const stat of asked) if (cur[stat] !== orig[stat]) coords.set(stat, cur[stat]);
        if (coords.size) spreads.set(id, coords);
      }
      const upTo = win.got.b.report.complete ? Math.max(t, 1) : (win.got.b.report.diffs[0]?.turn ?? 0) - 1;
      const nextPins = win.got.resampled
        ? prefixPins({ subs: win.got.b.pins.subs, turns: win.got.b.pins.turns, variants: win.got.b.pins.variants, seed: roundSeed }, upTo)
        : prefixPins(win.got.b.pins, upTo);
      return {
        picks: chosenPicks,
        pins: nextPins,
        held: spreads,
        level: win.got.level ?? (win.got.fresh ? levelOf(retryBudget()) : levelOf(budget)),
        built: win.got.b,
      };
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
    if (done.size > 1 && !budgetCut(built, base, dice)) {
      if ((searched.get(sampleMark) || 0) >= 2) {
        spend.fruitless.add(sampleMark);
      } else {
        failedAtKn.set(sampleMark, castKnSig);
      }
    }
    return null;
  };

  const past = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
  let deepest = null;
  let stalled = 0;
  let stop = null;
  let lastMark = null;
  const constrainHeld = (kn, id) => {
    const coords = held.get(id);
    if (!coords?.size) return { kn, active: null };
    let at = kn;
    const active = new Map();
    for (const [stat, { value }] of coords) {
      const restricted = restrictKnowledge(at, stat, value);
      if (!emptied(restricted)) {
        at = restricted;
        active.set(stat, value);
      }
    }
    return { kn: at, active: active.size ? active : null };
  };
  const repairOrders = (targetPicks, orderList) => {
    if (ordersAllow(targetPicks)) return;
    const rules = [...orders.values()];
    const counts = new Map(orderList.map(([s, i]) => [`p${s + 1}:${i}`, spreadsLeft(knowledge.get(`p${s + 1}:${i}`))]));
    const ranked = orderList.slice().sort((a, b) => {
      const ia = `p${a[0] + 1}:${a[1]}`;
      const ib = `p${b[0] + 1}:${b[1]}`;
      return Number(held.has(ib)) - Number(held.has(ia)) || counts.get(ia) - counts.get(ib);
    });
    let cond = cloneKnowledge(knowledge);
    for (const [k, [s, i]] of ranked.entries()) {
      const id = `p${s + 1}:${i}`;
      const kn = cond.get(id);
      const aim = aimFor(kn, picks[s][i]);
      const pick = heldSpread(kn, id, aim) || closestSpread(kn, aim);
      if (!pick) continue;
      targetPicks[s][i] = pick;
      const step = cloneKnowledge(cond);
      pinKnowledge(step.get(id), pick);
      if (orderSpeeds(step, rules)) {
        for (const rem of ranked.slice(k + 1)) tighten(step.get(`p${rem[0] + 1}:${rem[1]}`));
      }
      if (!ranked.slice(k + 1).some(([s2, i2]) => emptied(step.get(`p${s2 + 1}:${i2}`)))) cond = step;
    }
  };
  // Every guess a round has rebuilt from.
  const visited = new Set();
  // The first mix of two guesses no round has rebuilt from: each Pokemon of
  // `order` that differs takes its spread from `a` or `b`, then each stat that
  // differs its value from one or the other, fewest taken from `b` first.
  const mixOf = async (a, b, order, verifiedTurn = 0) => {
    const allowed = (m, list) => list.every(([s, i]) => containsSpread(knowledge.get(`p${s + 1}:${i}`), m[s][i])) && ordersAllow(m);
    const label = ([s, i]) => sets[s][i].name || sets[s][i].species;
    const differ = order.filter(([s, i]) => !sameSpread(a[s][i], b[s][i]));
    const byCount = n => [...Array(2 ** n).keys()].slice(1, -1).sort((x, y) => bits(x) - bits(y) || x - y);
    const bits = x => { let c = 0; for (; x; x &= x - 1) c++; return c; };
    const cands = [];
    if (differ.length > 1 && differ.length <= 6) {
      for (const mask of byCount(differ.length)) {
        const m = a.map(team => team.map(e => ({ ...e })));
        differ.forEach(([s, i], j) => { if (mask & (1 << j)) m[s][i] = { ...b[s][i] }; });
        if (!visited.has(signature(m)) && allowed(m, differ)) {
          cands.push({ picks: m, what: differ.map((d, j) => `${label(d)} from the ${mask & (1 << j) ? 'last' : 'new'}`).join(', ') });
          if (cands.length >= 16) break;
        }
      }
    }
    if (cands.length < 16) {
      const cells = differ.flatMap(([s, i]) => STAT_IDS.filter(x => a[s][i][x] !== b[s][i][x]).map(x => [s, i, x]));
      if (cells.length > 1 && cells.length <= 10) {
        for (const mask of byCount(cells.length)) {
          const m = a.map(team => team.map(e => ({ ...e })));
          cells.forEach(([s, i, x], j) => { if (mask & (1 << j)) m[s][i][x] = b[s][i][x]; });
          if (!visited.has(signature(m)) && allowed(m, differ)) {
            const taken = cells.filter((_, j) => mask & (1 << j)).map(([s, i, x]) => `${label([s, i])}'s ${x} ${b[s][i][x]}`);
            cands.push({ picks: m, what: `${taken.join(', ')} from the last` });
            if (cands.length >= 16) break;
          }
        }
      }
    }
    if (cands.length <= 1 || !(verifiedTurn >= 1) || !built?.inputLog) return cands[0] || null;
    const wantTurns = splitTurns(cutAt(verifiedTurn).filter(l => typeof l === 'string'));
    let best = cands[0];
    let bestScore = null;
    for (const cand of cands) {
      if (Date.now() >= deadline) break;
      const simLines = await replayWith(built.inputLog, packOf(cand.picks), verifiedTurn, channel);
      const sc = scoreSimLines(simLines, wantTurns);
      if (!bestScore || betterSimScore(sc, bestScore) < 0) {
        best = cand;
        bestScore = sc;
        if (sc[0] === Infinity) break;
      }
    }
    return best;
  };
  while (stalled < maxRounds && rounds < 4 * maxRounds && (!rounds || Date.now() < deadline)) {
    rounds++;
    work.rounds++;
    visited.add(signature(picks));
    const packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const searchStart = Date.now();
    const resample = budgets[level].resample || 0;
    roundSample = resample ? sampleSeed + (++resamples) : activeSample;
    roundSeed = roundSample === activeSample ? seed : sampler(roundSample ^ 0x5eed).seed();
    const validPins = !resample && pins && (!pins.seed || pins.seed === roundSeed) ? pins : null;
    const roundExact = validPins ? exact : null;
    built = counted(await reconstruct({
      formatid, packedTeams, playerNames, observed, channel, exact: roundExact, forced: built?.forced ?? forced,
      seed: roundSeed,
      pins: validPins,
      sampleSeed: roundSample,
      maxProbes: budgets[level].maxProbes,
      maxBacktracks: budgets[level].maxBacktracks,
      threads,
      deadline,
      ...searchLimits,
    }), false, roundExact);
    const diff = built.report.diffs[0];
    const at = built.report.complete ? [Infinity, Infinity] : [diff?.turn ?? -1, diff?.index ?? -1];
    if (roundSample !== activeSample && (!reached || past(at, reached))) {
      activeSample = roundSample;
      seed = roundSeed;
    }
    if (level > floor && !budgets[level].resample && reached && past(at, reached)) floor = level;
    reached = at;
    const advanced = !deepest || past(at, deepest);
    if (advanced) deepest = at;
    else stalled++;
    onProgress(`round ${rounds}${level ? ` (search ${level + 1})` : ''}, ${((Date.now() - searchStart) / 1000).toFixed(1)}s: ${built.report.complete ? 'the whole log reproduces'
      : `reproduces through turn ${built.report.verifiedThroughTurn} - wanted ${diff?.expected}, got ${diff?.actual}`}`);
    if (built.report.complete) break;

    const cache = new Map();
    const evidenceStart = Date.now();
    const passesBefore = work.passes;
    evidenceTurn = Math.max(evidenceTurn, diff?.turn ?? 0);
    const { seen, lent: lentNow, passes: read, scaffoldOrders, cutoffSpeeds } = await settle(built.inputLog, knowledge, cache, false, true);
    lent = lentNow;
    for (const [id, coords] of [...held]) {
      const kn = knowledge.get(id);
      if (!kn) continue;
      for (const [stat, { value }] of [...coords]) {
        if (emptied(restrictKnowledge(kn, stat, value))) coords.delete(stat);
      }
      if (!coords.size) held.delete(id);
    }

    const ordered = new Set([...orders.values()].flatMap(o => [o.fast, o.slow]));
    const order = [];
    for (const [s, team] of sets.entries()) {
      if (known[s]) continue;
      for (const i of team.keys()) {
        const id = `p${s + 1}:${i}`;
        if (seen.has(id) || ordered.has(id) || !containsSpread(knowledge.get(id), picks[s][i])) order.push([s, i]);
      }
    }
    const lentIds = new Set([...lent.entries()].flatMap(([k, ls]) => (ls.length ? [k, ...ls] : [])));
    const unconstrained = id => spreadsLeft(knowledge.get(id)) === spreadsLeft(blank.get(id))
      && !ordered.has(id) && !lentIds.has(id);
    const baseOrder = [
      ...order.filter(([s, i]) => !unconstrained(`p${s + 1}:${i}`)),
      ...order.filter(([s, i]) => unconstrained(`p${s + 1}:${i}`)),
    ];
    const byHeld = list => (list.some(([s, i]) => hasHeldSpe(`p${s + 1}:${i}`))
      ? list.slice().sort((a, b) => Number(hasHeldSpe(`p${b[0] + 1}:${b[1]}`)) - Number(hasHeldSpe(`p${a[0] + 1}:${a[1]}`)))
      : list.slice());
    let next = picks.map(team => team.map(e => ({ ...e })));
    const tryBudget = Math.max(32, 16 * order.length) * S * W;
    let tries = tryBudget;
    let checks = 128 * S * W;
    const seq = byHeld(baseOrder);
    const blocked = new Map();
    const isDead = map => [...map.values()].some(kn => !kn.known && emptied(kn));
    const blocks = (map, n) => {
      for (const [s2, i2] of seq.slice(n > 0 ? n : 1)) {
        if (emptied(map.get(`p${s2 + 1}:${i2}`))) blocked.set(`${s2}:${i2}`, (blocked.get(`${s2}:${i2}`) || 0) + 1);
      }
      return seq.some(([s2, i2]) => emptied(map.get(`p${s2 + 1}:${i2}`)));
    };
    const choose = async (n, cond, beforeTurn = Infinity, preferPrev = null) => {
      if (n === seq.length) {
        tries--;
        work.passes++;
        const proof = await evidencePass({ inputLog: built.inputLog, observed: lines, channel, knowledge: cond, cache, exact: true, beforeTurn });
        return proof.exact ? { ...proof, beforeTurn } : null;
      }
      const [s, i] = seq[n];
      const id = `p${s + 1}:${i}`;
      const kn = cond.get(id);
      if (spreadsLeft(kn) === 1) {
        const only = closestSpread(kn, picks[s][i]);
        if (!only) return null;
        const found = await choose(n + 1, cond, beforeTurn, preferPrev);
        if (found) next[s][i] = only;
        return found;
      }
      const evKn = knowledge.get(id);
      const tried = [];
      const byKey = new Map();
      const keptOrders = beforeTurn < Infinity ? keep.filter(o => !(o.turn >= beforeTurn)) : keep;
      const heldPass = constrainHeld(kn, id);
      const passesForId = heldPass.active ? [[heldPass.kn, heldPass.active], [kn, null]] : [[kn, null]];
      for (const [curKn, activeHeld] of passesForId) {
        const triedAims = [];
        const mid = aimFor(curKn, picks[s][i]);
        if (keptOrders.length && !evKn.dom.spe.includes(0) && curKn.dom.spe[picks[s][i].spe]) mid.spe = picks[s][i].spe;
        const withHeldAim = (a) => {
          if (!activeHeld) return a;
          const copy = { ...a };
          for (const [st, val] of activeHeld) copy[st] = val;
          return copy;
        };
        const core = preferPrev?.(id) ? [picks[s][i], mid] : [mid, picks[s][i]];
        const aims = [
          ...core,
          aimFor(curKn, picks[s][i], 0.25), aimFor(curKn, picks[s][i], 0.75),
          aimFor(curKn, picks[s][i], 0), aimFor(curKn, picks[s][i], 1),
        ].map(withHeldAim);
        for (const aim of aims) {
          if (triedAims.some(a => sameSpread(a, aim))) continue;
          triedAims.push(aim);
          if (tries <= 0 || checks <= 0) { limits.add('guessTries'); return null; }
          checks--;
          const first = closestSpread(curKn, aim);
          if (!first) continue;
          const k = keyOf(first.hp, first.def, first.spd);
          const cacheKey = `${activeHeld ? 'h' : 'f'}|${k}`;
          let entry = byKey.get(cacheKey);
          if (!entry) {
            if (maskKeys(curKn.keys).length === 1 && !activeHeld) {
              entry = { keyed: cond, pinned: curKn, flatFixed: FLAT.every(x => aliveOf(curKn.dom[x]).length === 1), blocked: false };
            } else {
              const keyed = cloneKnowledge(cond);
              if (activeHeld) keyed.set(id, cloneKnowledge(new Map([[id, curKn]])).get(id));
              const pinned = keyed.get(id);
              pinned.keys.fill(0);
              pinned.keys[k] = 1;
              if (tighten(pinned) && orderSpeeds(keyed, [...orders.values(), ...keptOrders])) {
                for (const [oid, okn] of keyed) if (oid !== id && !okn.known) tighten(okn);
              }
              if (emptied(pinned) || blocks(keyed, n) || isDead(keyed)) {
                entry = { keyed, pinned, flatFixed: false, blocked: true };
                byKey.set(cacheKey, entry);
                continue;
              }
              tries--;
              const settled = await settle(built.inputLog, keyed, cache, false, false, keep, beforeTurn);
              if (!settled.passes) tries++;
              const flatFixed = FLAT.every(x => aliveOf(pinned.dom[x]).length === 1);
              entry = { keyed, pinned, flatFixed, blocked: blocks(keyed, n) || isDead(keyed) };
            }
            byKey.set(cacheKey, entry);
          }
          if (entry.blocked) continue;
          const pick = closestSpread(entry.pinned, aim);
          if (!pick || tried.some(t => sameSpread(t, pick))) continue;
          tried.push(pick);
          const narrowed = cloneKnowledge(entry.keyed);
          pinKnowledge(narrowed.get(id), pick);
          if (n < seq.length - 1 && !entry.flatFixed) {
            if (orderSpeeds(narrowed, [...orders.values(), ...keptOrders])) {
              for (const [oid, okn] of narrowed) if (oid !== id && !okn.known) tighten(okn);
            }
            if (blocks(narrowed, n) || isDead(narrowed)) continue;
            tries--;
            const settled = await settle(built.inputLog, narrowed, cache, false, false, keep, beforeTurn);
            if (!settled.passes) tries++;
            if (blocks(narrowed, n) || isDead(narrowed)) continue;
          }
          const found = await choose(n + 1, narrowed, beforeTurn, preferPrev);
          if (found) { next[s][i] = pick; return found; }
        }
      }
      return null;
    };

    const mark = markOf(diff);
    let keep = advanced && !failed.has(mark) ? scaffoldOrders : [];
    const within = (beforeTurn = Infinity) => {
      const cond = cloneKnowledge(knowledge);
      const activeKeep = beforeTurn < Infinity ? keep.filter(o => !(o.turn >= beforeTurn)) : keep;
      if (activeKeep.length) {
        orderSpeeds(cond, [...orders.values(), ...activeKeep]);
        for (const kn of cond.values()) tighten(kn);
        const losesHeld = [...held].some(([id, coords]) => coords.size && cond.has(id) && !holdsIn(cond.get(id), coords));
        if (losesHeld || [...cond.values()].some(emptied)) { keep = []; return cloneKnowledge(knowledge); }
      }
      return cond;
    };
    const pickGuesses = async (beforeTurn = Infinity, preferPrev = null) => {
      let found = await choose(0, within(beforeTurn), beforeTurn, preferPrev);
      const moved = new Set();
      while (!found && tries > 0 && checks > 0) {
        const key = [...blocked].filter(([k]) => !moved.has(k)).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (key === undefined) break;
        moved.add(key);
        blocked.clear();
        seq.unshift(...seq.splice(seq.findIndex(([s, i]) => `${s}:${i}` === key), 1));
        found = await choose(0, within(beforeTurn), beforeTurn, preferPrev);
      }
      return found;
    };
    let proof = await pickGuesses();
    const isUnchanged = () => next.every((team, s) => team.every((e, i) => sameSpread(e, picks[s][i])));
    if (keep.length && (!proof
      || ((isUnchanged() || visited.has(signature(next))) && (failed.has(mark) || !built.report.limits.length)))) {
      keep = [];
      next = picks.map(team => team.map(e => ({ ...e })));
      tries = tryBudget;
      checks = 128 * S * W;
      seq.splice(0, seq.length, ...byHeld(baseOrder));
      blocked.clear();
      proof = await pickGuesses();
    }
    const failTurn = diff?.turn ?? 0;
    const onFailingTurn = (() => {
      if (!(failTurn >= 1)) return new Set();
      const turns = splitTurns(lines);
      const stood = new Map();
      for (const l of turns.slice(0, failTurn).flat()) {
        const [, kind, ident] = String(l).split('|');
        if (['switch', 'drag', 'replace'].includes(kind) && /^p[1-4][a-d]: /.test(ident || '')) stood.set(ident.slice(0, 3), `|switch|${ident}`);
      }
      const out = new Set();
      for (const line of [...(turns[failTurn] || []), ...stood.values()]) {
        for (const part of String(line || '').split('|')) {
          const m = /^(?:\[\w+\]\s*)?(p[1-4])[a-d]?: (.+)$/.exec(part.trim());
          if (!m) continue;
          const s = Number(m[1].slice(1)) - 1;
          if (!sets[s] || known[s]) continue;
          for (const [i, set] of sets[s].entries()) {
            if ((set.name || set.species) === m[2]) out.add(`p${s + 1}:${i}`);
          }
        }
      }
      for (const id of [...out]) for (const l of lent.get(id) || []) out.add(l);
      return out;
    })();
    const preferPrev = id => !onFailingTurn.has(id) || failed.has(mark);
    const prefixBudget = Math.max(16, 4 * order.length) * S * W;
    if (!proof && failTurn >= 1) {
      keep = scaffoldOrders.filter(o => !(o.turn >= failTurn));
      next = picks.map(team => team.map(e => ({ ...e })));
      tries = prefixBudget;
      checks = 128 * S * W;
      seq.splice(0, seq.length, ...byHeld(baseOrder));
      blocked.clear();
      proof = await pickGuesses(failTurn, preferPrev);
      if (!proof && keep.length) {
        keep = [];
        next = picks.map(team => team.map(e => ({ ...e })));
        tries = prefixBudget;
        checks = 128 * S * W;
        seq.splice(0, seq.length, ...byHeld(baseOrder));
        blocked.clear();
        proof = await pickGuesses(failTurn, preferPrev);
      }
    }
    if (proof) {
      for (const [s, i] of order) {
        const id = `p${s + 1}:${i}`;
        const coords = held.get(id);
        if (!coords) continue;
        for (const [stat, { value }] of [...coords]) {
          if (next[s][i][stat] !== value) coords.delete(stat);
        }
        if (!coords.size) held.delete(id);
      }
      const unprovedTurn = (proof.beforeTurn ?? Infinity) < Infinity
        ? ([...proof.exact.entries()].find(([, v]) => v.partial || v.proved !== undefined)?.[0] ?? Infinity)
        : Infinity;
      const maxTurn = Math.min(proof.beforeTurn ?? Infinity, proof.coupled ?? Infinity, unprovedTurn);
      const coupledAt = scaffoldLimit(next, scaffoldOrders, maxTurn);
      exact = proof.exact;
      if (exact && coupledAt < Infinity) {
        for (const k of [...exact.keys()]) if (k >= coupledAt) exact.delete(k);
        if (!exact.size) exact = null;
      }
      const rolls = sameTeam(next, picks) ? null : proof.rolls;
      pins = exact ? handOn(built, rolls, coupledAt) : null;
    } else {
      if (!advanced) {
        for (const [id, coords] of [...held]) {
          for (const [stat, h] of [...coords]) {
            if (rounds > h.round + 1) coords.delete(stat);
          }
          if (!coords.size) held.delete(id);
        }
      }
      for (const [s, i] of order) {
        const id = `p${s + 1}:${i}`;
        const kn = knowledge.get(id);
        if (failTurn >= 1 && !held.has(id) && preferPrev(id) && containsSpread(kn, picks[s][i])) {
          next[s][i] = { ...picks[s][i] };
        } else {
          const aim = aimFor(kn, picks[s][i]);
          next[s][i] = heldSpread(kn, id, aim) || closestSpread(kn, aim) || next[s][i];
        }
      }
      repairOrders(next, order);
      if (failTurn >= 1) {
        ({ exact, pins } = await certifyPrefix(built, next, scaffoldOrders, failTurn, cache, picks));
      } else {
        exact = null;
        pins = null;
      }
    }
    onProgress(`  evidence and new guesses, ${((Date.now() - evidenceStart) / 1000).toFixed(1)}s, ${work.passes - passesBefore} passes${exact ? `, ${exact.size} turns exact` : ''}${pins ? `, ${Object.keys(pins.subs).length} dice handed on` : ''}`);
    let unchanged = next.every((team, s) => team.every((e, i) => sameSpread(e, picks[s][i])));
    const sameMark = mark !== null && mark === lastMark;
    lastMark = mark;
    const again = failed.has(mark);
    failed.add(mark);
    if (unchanged || again || read < 2) {
      const rawStart = picks.map((team, s) => team.map((e, i) => (containsSpread(knowledge.get(`p${s + 1}:${i}`), e) ? e : next[s][i])));
      const start = !ordersAllow(rawStart) && ordersAllow(next) ? next : rawStart;
      const found = await fallback(seen, start, exact ? { picks: next, exact, pins } : null, cutoffSpeeds);
      if (found) {
        activeSample = roundSample;
        seed = roundSeed;
        for (const [id, coords] of found.held) {
          const map = held.get(id) || new Map();
          for (const [stat, value] of coords) map.set(stat, { value, at, round: rounds });
          if (map.size) held.set(id, map);
        }
        picks = found.picks;
        const foundBeforeTurn = found.built
          ? (found.built.report.complete ? Math.max(failTurn, 1) + 1 : found.built.report.diffs[0]?.turn ?? failTurn)
          : 0;
        if (found.built && foundBeforeTurn >= 1 && ordersAllow(found.picks)) {
          const cert = await certifyPrefix(found.built, found.picks, [], foundBeforeTurn, new Map(), found.picks);
          exact = cert.exact;
          pins = cert.exact && found.pins ? { ...found.pins, proof: cert.pins?.proof } : (found.pins ?? cert.pins);
        } else {
          exact = null;
          pins = found.pins;
        }
        level = Math.max(found.level, floor);
        floor = Math.max(floor, found.level);
        continue;
      }
    }
    if (unchanged && level + 1 >= budgets.length && held.size && !releasedAt.has(mark)) {
      releasedAt.add(mark);
      held.clear();
      for (const [s, i] of order) {
        const id = `p${s + 1}:${i}`;
        const kn = knowledge.get(id);
        next[s][i] = closestSpread(kn, aimFor(kn, picks[s][i])) || next[s][i];
      }
      repairOrders(next, order);
      unchanged = next.every((team, s) => team.every((e, i) => sameSpread(e, picks[s][i])));
      if (!unchanged) {
        exact = null;
        pins = null;
      }
    }
    const revisited = !unchanged && visited.has(signature(next));
    if (unchanged || (revisited && sameMark)) {
      if (++level >= budgets.length) { stop = 'searches'; break; }
    } else if (again || read < 2) {
      level = Math.min(level + 1, budgets.length - 1);
    } else {
      level = floor;
    }
    if (revisited) {
      const mix = await mixOf(next, picks, order, built.report.verifiedThroughTurn);
      if (mix) {
        onProgress(`  back to a guess already tried; mixing it with the last one: ${mix.what}`);
        next = mix.picks;
        ({ exact, pins } = await certifyPrefix(built, next, scaffoldOrders, failTurn, cache, picks));
      }
    }
    picks = next;
  }
  // Why the rounds ended: the log reproduces; every search budget was tried on
  // a guess the evidence did not move (`searches`); `maxRounds` rounds got no
  // further (`stalled`); four times that many ran in all (`rounds`); the
  // deadline. Each but the first is a limit.
  if (!stop) {
    stop = built.report.complete ? 'complete' : stalled >= maxRounds ? 'stalled' : rounds >= 4 * maxRounds ? 'rounds' : 'deadline';
  }
  if (stop !== 'complete') limits.add(stop);

  // A side with an Illusion user can have sent it in disguised as a teammate,
  // and the line that gives it away can be one only its own Stat Points
  // explain - a Speed no Stat Point of the teammate reaches. The rebuild alone
  // cannot prefer that reading before its Stat Points are narrowed under it,
  // so a battle that did not rebuild is inferred again under each reading of a
  // switch-in as the Illusion user, and the first that rebuilds is kept. The
  // plain reading's search ran out without proving it wrong (audit A50), so
  // every Pokemon also keeps what the plain reading left it.
  const triedReadings = new Map();
  if (!built.report.complete && readings && Date.now() < deadline) {
    const packed = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const given = [...(forced || [])];
    const stays = disguisableStays(formatid, packed, channel, observed, guessed);
    const plainValid = !stays.valid || stays.valid(given);
    const failing = Math.max(built.report.diffs[0]?.turn ?? 0, deepest?.[0] ?? 0) || Infinity;
    for (const { at, turn } of stays) {
      if ((plainValid && turn > failing) || (built.forced || []).includes(at)) continue;
      const nextForced = [...given, at];
      if (stays.canExtend && !stays.canExtend(nextForced)) continue;
      onProgress(`reading the switch-in at line ${at} as the Illusion user`);
      const other = absorb(await inferSpreads({ ...options, forced: nextForced, readings: false, fixedReadings: true }));
      triedReadings.set([...nextForced].sort((a, b) => a - b).join(','), other);
      if (!other.complete) continue;
      const plainImpossible = [...knowledge.values()].some(kn => !kn.known && emptied(kn));
      if (plainValid && !plainImpossible) {
        for (const p of other.pokemon) {
          if (p.known) continue;
          uniteKnowledge(other.knowledge.get(p.id), knowledge.get(p.id));
          tighten(other.knowledge.get(p.id));
          Object.assign(p, summarise(other.knowledge.get(p.id)));
        }
      }
      ahead?.cancel();
      return spareDisguises(Object.assign(other, { work, warnings, lost }), triedReadings);
    }
  }

  const last = built.report.diffs[0];
  const rebuiltPast = at => built.report.complete || (last && (last.turn !== at[0] ? last.turn > at[0] : last.index > at[1]));

  const final = cloneKnowledge(blank);
  watched = final;
  const result = await settle(built.inputLog, final, new Map(), true);
  let narrowedFinal = false;
  for (const [id, kn] of final) {
    const had = knowledge.get(id);
    narrowedFinal = intersectKnowledge(kn, maskKeys(had.keys), had.dom, had.ties) || narrowedFinal;
  }
  orderSpeeds(final, [...orders.values()]);
  for (const kn of final.values()) tighten(kn);
  if (narrowedFinal && ![...final.values()].some(kn => !kn.known && emptied(kn))) {
    await settle(built.inputLog, final, new Map(), false);
    orderSpeeds(final, [...orders.values()]);
    for (const kn of final.values()) tighten(kn);
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

  const plain = await spareDisguises({
    complete: built.report.complete,
    rounds,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    built,
    picks,
    pokemon,
    events: result.events,
    checks: [...result.checks, ...[...gaps.values()].filter(g => g.found || !rebuiltPast(g.at)).map(g => g.entry)],
    cutoff: result.cutoff,
    passes: result.passes,
    knowledge: final,
    work,
    warnings,
    lost,
    stop,
  }, triedReadings);

  // Where the search starts decides, more than anything, whether a hard battle
  // rebuilds: the same battle can give up from one start and rebuild from
  // another. So a search that gave up starts once more, from the spreads people
  // run (`usage`), with a budget of its own; and one that gave up from both
  // once more from the first guess, with the fallback and the joint guesses
  // `WIDE` times wider (`wide`). More of either is no better everywhere - the
  // fallback can hold a guess that gets past one line and leads nowhere - so
  // it is a start of its own, after the two, not a wider first one: a battle
  // either rebuilds takes the path it always took. Every spread any of them
  // removed was removed by evidence, so each Pokemon keeps only what all
  // left, and the rebuild is the one that reproduced the log, if one did:
  // never worse than the first search alone. One that gave up from all three
  // runs the three once more with every limit `WIDE` times wider (`widest`),
  // as `--budget` widens them, and no wider after that: a battle any earlier
  // start rebuilds never gets there.
  if (plain.complete || wide || start !== 'default' || Date.now() >= deadline) {
    ahead?.cancel();
    return plain;
  }
  const starts = [plain];
  for (const next of restarts()) {
    if (next.key !== 'usage' && (starts.some(r => r.complete) || Date.now() >= deadline)) break;
    onProgress(next.note);
    starts.push(absorb(await (ahead?.take(next.key) ?? inferSpreads(next.options))));
  }
  ahead?.cancel();
  const kept = starts.find(r => r.complete) || plain;
  for (const partner of starts) {
    if (partner === kept) continue;
    for (const p of kept.pokemon) {
      if (p.known) continue;
      const kn = kept.knowledge.get(p.id);
      const other = partner.knowledge.get(p.id);
      if (!kn || !other) continue;
      intersectKnowledge(kn, maskKeys(other.keys), other.dom, other.ties);
      tighten(kn);
      Object.assign(p, summarise(kn), { contains: evs => containsSpread(kn, evs) });
    }
  }
  return Object.assign(kept, { work, warnings, lost, limits: [...limits].sort() });

  /**
   * The starts a search that gives up runs next, in order, each run only while
   * none before it rebuilt the log (above): from the spreads people run, where
   * that is another start; the fallback and the joint guesses wider; every
   * limit wider. `need` is how many starts each runs next in turn.
   */
  function restarts() {
    const from = { plain: firstGuesses('default'), usual: usage ? firstGuesses('usage') : null };
    const differs = from.usual && sets.some((team, s) => team.some((set, i) => !sameSpread(from.usual[s][i], from.plain[s][i])));
    const list = [];
    if (differs) {
      list.push({
        key: 'usage', need: 0, note: 'the search gave up; searching again from the spreads people run',
        options: { ...options, start: 'usage', spend: { rebuilds: FALLBACK_TOTAL * budgetScale, fruitless: new Set() } },
      });
    }
    // Not for the inferences run again under another reading of an Illusion
    // (`readings: false`): a battle that rebuilds keeps its path.
    if (!readings) return list;
    list.push({
      key: 'wide', need: 0, note: `the search gave up; searching once more with ${WIDE} times the fallback's rebuilds and the joint guess tries`,
      options: { ...options, wide: true, spend: { rebuilds: FALLBACK_TOTAL * WIDE * budgetScale, fruitless: new Set() } },
    });
    if (!widest) {
      list.push({
        key: 'widest', need: list.length, note: `the search gave up from every start; searching from each again with every limit ${WIDE} times wider`,
        options: { ...options, widest: true, budgetScale: budgetScale * WIDE, spend: { rebuilds: FALLBACK_TOTAL * WIDE * budgetScale, fruitless: new Set() } },
      });
    }
    return list;
  }

  /**
   * A switch-in nothing settles could have been the Illusion user in disguise
   * (`unsettledStays`), and one the search read as the Illusion user because
   * that reading got further is not proved one either: a search that ran out
   * proves nothing (audit A50). Each such switch-in can be read either way,
   * and each way gives the turns after it other attackers and targets on both
   * sides: a disguised hit narrowed its target's defences under the attacker
   * shown. So with up to `MAX_READINGS` of them, every assignment of them is
   * inferred - each one shown or the Illusion user - and every Pokemon of both
   * sides keeps whatever any reading leaves it. With more, every Pokemon keeps
   * every spread. A reading is kept whether or not it
   * rebuilds, and one the deadline cut short widens every Pokemon to every
   * spread.
   */
  async function spareDisguises(res, memo = new Map()) {
    // The readings below add to `limits`, which `res` carries a copy of.
    const done = () => Object.assign(res, { limits: [...limits].sort() });
    if (!readings) return done();
    const packed = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const given = [...(forced || [])];
    const base = res.built.forced || [];
    const late = () => {
      if (Date.now() < deadline) return false;
      limits.add('deadline');
      return true;
    };
    const unite = (from, sides, spare = null) => {
      for (const s of sides) {
        if (known[s]) continue;
        for (const [i, set] of sets[s].entries()) {
          const id = `p${s + 1}:${i}`;
          if (spare === s && toID(set.ability) === 'illusion') continue;
          uniteKnowledge(res.knowledge.get(id), from.get(id));
          tighten(res.knowledge.get(id));
          Object.assign(res.pokemon.find(p => p.id === id), summarise(res.knowledge.get(id)));
        }
      }
    };
    const stays = disguisableStays(formatid, packed, channel, observed, guessed);
    const turnOf = at => stays.find(x => x.at === at)?.turn ?? 0;
    const chosen = base.filter(at => !given.includes(at));
    const unsettled = unsettledDisguises(formatid, packed, channel, observed, guessed).filter(x => !base.includes(x.at));
    const open = [...chosen, ...unsettled.map(x => x.at)];
    let seeded = !stays.valid || stays.valid(base);
    const merge = (from, sides, spare = null) => {
      if (!seeded) {
        for (const s of sides) {
          if (known[s]) continue;
          for (const [i, set] of sets[s].entries()) {
            const id = `p${s + 1}:${i}`;
            if (spare === s && toID(set.ability) === 'illusion') continue;
            const kn = res.knowledge.get(id);
            kn.keys.fill(0);
            for (const st of FLAT) kn.dom[st].fill(0);
            kn.ties = {};
          }
        }
        seeded = true;
      }
      unite(from, sides, spare);
    };
    if (!open.length) {
      if (!seeded) merge(blank, [0, 1]);
      return done();
    }
    const read = async (ats) => {
      const nextForced = [...given, ...ats];
      const key = [...nextForced].sort((a, b) => a - b).join(',');
      if (memo.has(key)) return memo.get(key);
      const out = absorb(await inferSpreads({ ...options, forced: nextForced, readings: false, fixedReadings: true }));
      memo.set(key, out);
      return out;
    };
    const has = new Set(base);
    const resImpossible = [...res.knowledge.values()].some(kn => !kn.known && emptied(kn));
    if (resImpossible) seeded = false;
    if (open.length <= MAX_READINGS) {
      onProgress(`reading ${open.length} switch-in(s) each way, as the Pokemon shown and as the Illusion user`);
      for (let mask = 0; mask < 1 << open.length; mask++) {
        const ats = open.filter((_, k) => mask & (1 << k));
        const same = seeded && ats.length === chosen.length && ats.every(at => has.has(at));
        if (same) continue;
        if (stays.valid && !stays.valid([...given, ...ats])) continue;
        const other = late() ? null : await read(ats);
        const otherImpossible = other && [...other.knowledge.values()].some(kn => !kn.known && emptied(kn));
        if (!otherImpossible) merge(other ? other.knowledge : blank, [0, 1]);
        if (other?.complete && !res.complete) {
          Object.assign(res, { complete: true, built: other.built, picks: other.picks, stop: other.stop });
          for (const p of res.pokemon) p.used = other.pokemon.find(q => q.id === p.id)?.used ?? p.used;
        }
      }
      if (!seeded) merge(blank, [0, 1]);
    } else {
      onProgress(`${open.length} switch-ins could each be the Illusion user: every Pokemon keeps every spread`);
      merge(blank, [0, 1]);
    }
    res.checks.push({
      turn: Math.min(...open.map(turnOf)),
      what: `the switch-ins at lines ${open.join(', ')}`,
      reason: 'each could have been the Illusion user, so every reading of them was kept',
    });
    return done();
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
 * One game's inference narrowed by the other games of its best-of set. Both
 * players bring one team to every game of a set, Stat Points included
 * (`bestOfFromLog` in `replay-source.mjs`), so what is still possible for a
 * Pokemon is what every game leaves it. Every spread a game removes is one the
 * simulator proved could not have produced that game, so the intersection
 * keeps the real spread whenever each game does.
 *
 * A game goes in only when it is certainly the same set and the same team -
 * the same set, format and player on each side, both sheets alike in every
 * field but gender - and only when it rebuilt line for line, as the game
 * narrowed must have too. A game that never reproduced its whole log can stand
 * on a reading the rest of the log would have overturned - an Illusion user
 * taken for what it showed - or on a mechanic the inference does not model, and
 * either can have removed the real spread; a complete rebuild is what vouches
 * for the rest. Two different replays that both claim one game of the set
 * leave it uncombined. A game whose Pokemon were assumed to spend all 66
 * points narrows only a game that assumed the same.
 *
 * @param game    a recording: `bestOf`, `complete`, `p1`, `p2`, `format`, `inference`
 * @param others  other recordings, of any set, each with a `recording` name
 * @returns `{ inference, combined, skipped }`: the game's inference with each
 *          inferred Pokemon's surviving set intersected with what every
 *          combined game leaves it, the events and checks of every one of those
 *          games, each marked with its `game`, and `inference.combined` naming
 *          them; `combined` lists the other games, `skipped` every other game
 *          of the set left out and why. With nothing combined, the inference as
 *          it was.
 */
export function combineGames(game, others) {
  const own = game.bestOf;
  const inf = game.inference;
  const out = { inference: inf || null, combined: [], skipped: [] };
  if (!own || !inf) return out;
  const mates = others.filter(o => o !== game && o.bestOf?.set === own.set);
  const skip = (o, reason) => out.skipped.push({ game: o.bestOf.game, recording: o.recording || null, reason });

  const games = [game, ...mates];
  for (const [i, a] of games.entries()) {
    const twin = games.slice(i + 1).find(b => b.bestOf.game === a.bestOf.game && a.bestOf.replay && b.bestOf.replay && a.bestOf.replay !== b.bestOf.replay);
    if (twin) {
      for (const o of mates) skip(o, `two different replays are both game ${a.bestOf.game} of this set`);
      return out;
    }
  }

  const assumes = rec => rec.inference.pokemon.some(p => p.knowledge?.spent);
  const whyNot = (o) => {
    if (o.format !== game.format) return 'it is another format';
    if (o.p1 !== game.p1 || o.p2 !== game.p2) return 'its players are not on the same sides';
    if (![0, 1].every(s => sameSheet(o.bestOf.sheets?.[s], own.sheets?.[s]))) return 'its team sheets are not this game\'s';
    if (game.complete !== true || inf.complete !== true) return 'this game did not rebuild line for line';
    if (!o.inference) return 'it inferred no Stat Points';
    if (o.complete !== true || o.inference.complete !== true) return 'it did not rebuild line for line';
    if (assumes(o) && !assumes(game)) return 'it assumed every Stat Point spent';
    const misplaced = inf.pokemon.some((p) => {
      const q = o.inference.pokemon.find(x => x.id === p.id);
      return q && toID(q.species) !== toID(p.species);
    });
    if (misplaced) return 'its Pokemon are not in this game\'s order';
    return '';
  };
  const using = [];
  for (const o of mates) {
    // Another copy of this game, or of one already taken, says nothing new.
    if (o.bestOf.game === own.game || using.some(u => u.bestOf.game === o.bestOf.game)) continue;
    const reason = whyNot(o);
    if (reason) skip(o, reason);
    else using.push(o);
  }
  if (!using.length) return out;

  const pokemon = inf.pokemon.map((p) => {
    if (!p.knowledge) return p;
    const kn = unpackKnowledge(p.knowledge);
    let seen = p.seen;
    for (const o of using) {
      const q = o.inference.pokemon.find(x => x.id === p.id);
      if (!q?.knowledge) continue;
      const other = unpackKnowledge(q.knowledge);
      intersectKnowledge(kn, maskKeys(other.keys), other.dom, other.ties);
      seen ||= q.seen;
    }
    tighten(kn);
    return { ...p, seen, ...summarise(kn), knowledge: packKnowledge(kn) };
  });
  out.combined = using.map(o => ({ game: o.bestOf.game, replay: o.bestOf.replay, recording: o.recording || null }))
    .sort((a, b) => a.game - b.game);
  // Every game's events and checks, each marked with its game, in the set's
  // order. The sheets are alike set for set, so a Pokemon has the same id in
  // every game; another game's cuts are kept for the Pokemon narrowed here.
  const ids = new Set(inf.pokemon.map(p => p.id));
  const sources = [game, ...using].sort((a, b) => a.bestOf.game - b.bestOf.game);
  const mark = (rec, list) => (list || []).map(e => ({ ...e, game: rec.bestOf.game }));
  out.inference = {
    ...inf,
    pokemon,
    events: sources.flatMap(rec => (rec === game ? mark(rec, inf.events)
      : mark(rec, rec.inference.events).map(e => ({ ...e, cuts: e.cuts.filter(c => ids.has(c.id)) })).filter(e => e.cuts.length))),
    checks: sources.flatMap(rec => mark(rec, rec.inference.checks)),
    combined: { of: own.of, games: sources.map(rec => rec.bestOf.game), with: out.combined },
  };
  return out;
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
