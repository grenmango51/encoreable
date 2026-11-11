/**
 * The grade of the inference: every battle in `scripts/fixtures/benchmark.js`,
 * each from every viewpoint, inferred and checked against the answers it was
 * played with.
 *
 *   npm run score                            the quick slice, compared with the baseline
 *   npm run score -- --tier full             every battle
 *   npm run score -- --only fuzz:204         one battle, every view
 *   npm run score -- --views p2@p1           only some views
 *   npm run score -- --tier full --hosts a,b,c --remote 'ssh {host} ...'   cases handed out over machines as their threads free up
 *   npm run score -- --merge <file>...       saved runs put together, graded and compared
 *   npm run score -- --tier full --accept    write this run as the new baseline
 *   npm run score -- --tier full --budget 10  every search limit ten times as wide: what the limits cost
 *   npm run score -- --only fuzz:220 --views p2@p1 --trace   every step of the search, on stderr: why a case gave up
 *   npm run score -- --mimic-dir <dir>      every game in <dir> as a mimic battle, not the benchmark (a corpus sweep)
 *   npm run score -- --mimic-dir a,b,c --log <file>   one queue over several folders, in that order, each record
 *                                           added to <file> as it ends: run again to go on from where it stopped
 *
 * Flags: --tier quick|fast|full --timings <run.json> --only <id>[,<id>...] --views <v>[,<v>...] --threads <n> --budget <n>
 *        --trace --mimic-dir <dir>[,<dir>...] --log <file> --hosts <a,b,...> --remote <command> --out <file> --merge <file>...
 *        --baseline <file> --accept
 *
 * A view is who is inferred and from whose screen:
 *   p2@p1           player 2's Stat Points, from player 1's channel (p1 known)
 *   p1@p2           player 1's, from player 2's
 *   both@spectator  both sides', from a spectator's channel - a public replay
 * Each inferred side has its open team sheet: species, items, abilities, moves
 * and natures are known, Stat Points are not. Closed sheets are not graded yet.
 *
 * Each case is one battle from one view, and gets one result, the first that
 * applies:
 *   CRASH     the inference threw, the battle's input log does not replay it, or
 *             a Pokemon's count of spreads left disagrees with its membership
 *             test (`miscount`): the count is what precision is measured with
 *   REMOVED   a real spread is not among what the inference kept, for any
 *             Pokemon of an inferred side, seen or not - never allowed
 *   PASS      the rebuild reproduces the whole log
 *   GAVE UP   it does not, and a search limit left something untried
 *   NO MATCH  it does not, and no such limit was hit
 * Then for every Pokemon of an inferred side: how many spreads it kept, and
 * which stats are down to one value, and, when its real spread is one people
 * run (`usage-spreads.json`, which also gives the search its first guess),
 * where it ranks among those that survive. And what the case cost: rounds,
 * rebuilds and probes, which are the same on every machine, and seconds, which
 * are not and are never compared.
 *
 * The baseline, `scripts/fixtures/score-baseline.json`, holds each case's
 * result and spreads as of the last accepted run. A run fails when any case is
 * REMOVED, when a case's result gets worse, when a Pokemon keeps more spreads
 * than it did, or when a case breaks more proofs it was handed than it did (a
 * turn the evidence called exact that the simulator plays otherwise); a case the baseline has and the run does not is a
 * CRASH. A change that makes something worse on purpose - a soundness fix that
 * keeps more spreads - accepts a new baseline in the same commit, so the diff
 * shows what got worse.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { execFileSync, spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { battleLines } from './lib/protocol.mjs';
import { loadSource } from './lib/replay-source.mjs';
import { inferSpreads } from './lib/inference/infer.mjs';
import { FUZZ_TURNS, fuzzRecipe, fuzzTeams, playFuzz } from './lib/fuzz.mjs';
import { USAGE_FILE, mimicRecipe, playMimic, usageSpreads } from './lib/mimic.mjs';
import { likelySpreads, usualSpreads } from './lib/inference/usage.mjs';
import { spareThreads } from './lib/speculate.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const { BATTLES } = require('./fixtures/benchmark.js');

const ROOT = process.cwd();
const WORKER_ROLE = 'score-worker';
const BASELINE = 'scripts/fixtures/score-baseline.json';
const OUT_DIR = '.cache/score';
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const VIEWS = {
  'p2@p1': { infer: ['p2'], channel: 1 },
  'p1@p2': { infer: ['p1'], channel: 2 },
  'both@spectator': { infer: ['p1', 'p2'], channel: 0 },
};
// A search limit that left a candidate untried. The rounds' own endings -
// `searches`, `stalled`, `rounds` - end every inference that does not rebuild,
// so they tell a give-up from a dead end no better than the result does.
const SEARCH_LIMITS = new Set(['probes', 'redrawProbes', 'variants', 'choiceRounds', 'backtracks', 'dieBacktracks',
  'fallbackRebuilds', 'fallbackTotal', 'guessTries', 'deadline']);
const RANK = { PASS: 0, 'GAVE UP': 1, 'NO MATCH': 1, CRASH: 2, REMOVED: 3 };

// ------------------------------------------------------------------ one case

/** Play an input log in-process: the whole log, and each channel's view of it. */
async function replayInputLog(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  try {
    for (const line of inputLog.map(l => l.trimEnd()).filter(l => l.startsWith('>'))) await stream.write(line);
    const raw = stream.battle.log.join('\n');
    const channels = extractChannelMessages(raw, [-1, 0, 1, 2]);
    return { omniscient: channels[-1], channels };
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
}

let fuzzPool = null;

/**
 * The fuzz battles' team pool, as a hash: a fuzz battle's number picks from this
 * pool, which is read off the sheets in the repo, so a sheet added there
 * changes what every number plays.
 */
function poolPrint() {
  fuzzPool ||= fuzzTeams().teams;
  return crypto.createHash('sha256').update(JSON.stringify(fuzzPool.map(t => [t.label, Teams.pack(t.sets)]))).digest('hex').slice(0, 16);
}

/**
 * The spreads mimic battles draw from, as a hash: a new month of usage stats
 * plants other spreads in every mimic battle.
 */
function usagePrint() {
  const file = path.join(ROOT, USAGE_FILE);
  // The content, not the bytes: a Windows checkout ends its lines differently.
  return fs.existsSync(file)
    ? crypto.createHash('sha256').update(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')))).digest('hex').slice(0, 16) : null;
}

/**
 * A battle as an input log, and the battle it plays here. A fuzz or mimic
 * battle's input log must play the battle as it was played (`same`). A
 * recording is graded on the battle its input log plays under the pinned
 * simulator, which a few no longer play the way they were saved (`asSaved`):
 * either way it is a battle the real teams played, which is all a grade needs.
 */
async function battleOf(id, mimicDir = null) {
  if (id.startsWith('fuzz:')) {
    fuzzPool ||= fuzzTeams().teams;
    const played = await playFuzz(fuzzRecipe(Number(id.slice(5)), fuzzPool, FUZZ_TURNS));
    const replayed = await replayInputLog(played.inputLog);
    const same = battleLines(replayed.channels[1]).join('\n') === battleLines(played.ch1).join('\n');
    return { inputLog: played.inputLog, replayed, same, asSaved: null };
  }
  if (id.startsWith('mimic:')) {
    const name = `${id.slice('mimic:'.length)}.json`;
    const dirs = mimicDir ? mimicDirsOf(mimicDir) : [];
    const file = dirs.map(d => path.join(d, name)).find(f => fs.existsSync(f)) || (dirs.length ? path.join(dirs[0], name) : null);
    const recipe = file ? mimicRecipe(id, loadSource(file)) : mimicRecipe(id);
    if (!recipe) throw new Error(`${id}: no open sheet for a side, or a team the format refuses`);
    const played = await playMimic(recipe);
    const replayed = await replayInputLog(played.inputLog);
    const same = battleLines(replayed.channels[1]).join('\n') === battleLines(played.ch1).join('\n');
    return { inputLog: played.inputLog, replayed, same, asSaved: null };
  }
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, id), 'utf8'));
  const inputLog = Array.isArray(data.inputLog) ? data.inputLog : String(data.inputLog || '').split('\n');
  const replayed = await replayInputLog(inputLog);
  const saved = Array.isArray(data.log) ? data.log : String(data.log || '').split('\n');
  // A branched recording's log repeats `|player|` where the branch began.
  const lines = l => battleLines(l).filter(x => !x.startsWith('|player|')).join('\n');
  const asSaved = !data.log || lines(replayed.omniscient) === lines(saved);
  return { inputLog, replayed, same: true, asSaved };
}

// Every spread there is: at most 32 in a stat, at most 66 in all.
const ALL_SPREADS = 136663185;
const COUNT_SAMPLES = 2000;

/**
 * Whether a Pokemon's count of spreads left agrees with its own membership
 * test, which is separate code: of `COUNT_SAMPLES` spreads drawn evenly from
 * every spread there is, about count / ALL_SPREADS of them must be possible. The
 * count is what the grade calls precision, so a count that goes wrong would
 * pass for a precision gain; this catches one wrong by far more than chance
 * allows. Null when they agree, else what disagrees. The draws are fixed by
 * `key`, so a case grades the same every time.
 */
function miscount(p, key) {
  let x = Number.parseInt(crypto.createHash('sha256').update(key).digest('hex').slice(0, 8), 16) >>> 0;
  const next = () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let hits = 0;
  for (let n = 0; n < COUNT_SAMPLES;) {
    const v = STATS.map(() => Math.floor(next() * 33));
    if (v.reduce((a, b) => a + b, 0) > 66) continue;
    n++;
    if (p.contains(Object.fromEntries(STATS.map((s, i) => [s, v[i]])))) hits++;
  }
  const share = p.spreads / ALL_SPREADS;
  const expected = COUNT_SAMPLES * share;
  const spread = Math.sqrt(expected * (1 - share));
  if (Math.abs(hits - expected) <= 6 * spread + 3) return null;
  return `counts ${p.spreads.toLocaleString('en')} spreads left, but ${hits} of ${COUNT_SAMPLES} spreads drawn at random are possible (about ${Math.round(expected)} expected)`;
}

/** One battle from one view, graded. */
async function runCase(id, view, { budget = 1, trace = false, mimicDir = null, parallel = null } = {}) {
  const started = Date.now();
  const base = { id, view };
  try {
    const { infer, channel } = VIEWS[view];
    const { inputLog, replayed, same, asSaved } = await battleOf(id, mimicDir);
    if (!same) return { ...base, result: 'CRASH', error: 'the input log does not replay the battle', seconds: 0 };
    // The battle the case plays, as a hash: a change to the fuzz generator, the
    // mimic replay, a recording or the pin can play another battle under the
    // same name, and its baseline is then not this battle's.
    base.battle = crypto.createHash('sha256').update(battleLines(replayed.omniscient).join('\n')).digest('hex').slice(0, 16);
    const start = inputLog.find(l => l.startsWith('>start '));
    const formatid = JSON.parse(start.slice(start.indexOf('{'))).formatid;
    const players = [];
    for (const line of inputLog) {
      const m = /^>player (p[12]) /.exec(line);
      if (m && !players[Number(m[1][1]) - 1]) players[Number(m[1][1]) - 1] = JSON.parse(line.slice(line.indexOf('{')));
    }
    const truth = players.map(p => Teams.unpack(p.team));
    const known = [0, 1].map(s => !infer.includes(`p${s + 1}`));
    const zero = Object.fromEntries(STATS.map(s => [s, 0]));
    const sets = truth.map((team, s) => team.map(set => (known[s] ? set : { ...set, evs: { ...zero } })));
    const usage = usageSpreads()?.spreads || null;
    const dex = Dex.forFormat(formatid);
    const inf = await inferSpreads({
      formatid, sets, known, playerNames: players.map(p => p.name), observed: replayed.channels[channel], channel,
      sampleSeed: 1, threads: 1, budgetScale: budget, usage, parallel,
      truth: Object.fromEntries(truth.flatMap((team, s) => (known[s] ? [] : team.map((set, i) => [`p${s + 1}:${i}`, set.evs || {}])))),
      ...(trace ? { onProgress: m => process.stderr.write(`[${id} ${view}] ${m}\n`) } : {}),
    });
    const pokemon = [];
    for (const p of inf.pokemon) {
      if (p.known) continue;
      const [s, i] = [Number(p.side[1]) - 1, Number(p.id.split(':')[1])];
      const real = Object.fromEntries(STATS.map(x => [x, truth[s][i].evs?.[x] || 0]));
      // Where the real spread ranks among the spreads people run that survive:
      // only for a Pokemon whose real spread is one people run.
      const isReal = e => STATS.every(x => e[x] === real[x]);
      const usual = usualSpreads(usage, dex, truth[s][i]);
      const { likely } = likelySpreads(usual, p.contains);
      const rank = usual.some(u => isReal(u.evs)) ? likely.findIndex(l => isReal(l.evs)) + 1 || null : undefined;
      pokemon.push({
        id: p.id, species: p.species, seen: p.seen, kept: p.contains(real), spreads: p.spreads,
        // The spread the rebuild used: when the rebuild reproduces the log, it is
        // a spread the log allows, so it must have survived too.
        witness: p.contains(p.used),
        exact: STATS.filter(x => p.stats[x]?.count === 1),
        ...(rank === undefined ? {} : { rank, likely: likely.length }),
        miscounted: miscount(p, `${id} ${view} ${p.id}`),
      });
    }
    // Every Pokemon of an inferred side is graded, once: one the inference left
    // out, or called known, would hide what it removed.
    const expected = truth.flatMap((team, s) => (known[s] ? [] : team.map((_, i) => `p${s + 1}:${i}`)));
    const graded = pokemon.map(p => p.id);
    const missing = expected.filter(x => graded.filter(y => y === x).length !== 1);
    const stray = graded.filter(x => !expected.includes(x));
    if (missing.length || stray.length) {
      return { ...base, result: 'CRASH', error: `the inference graded ${graded.join(', ') || 'no Pokemon'}, expected ${expected.join(', ')}`, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
    }
    // Each check on its own, so one failing does not hide another; `result`
    // sums them up.
    const limits = inf.limits || [];
    const sound = pokemon.every(p => p.kept) && (!inf.complete || pokemon.every(p => p.witness));
    const limitHit = limits.some(l => SEARCH_LIMITS.has(l));
    const wrongCount = pokemon.find(p => p.miscounted);
    const result = !sound ? 'REMOVED' : wrongCount ? 'CRASH' : inf.complete ? 'PASS' : limitHit ? 'GAVE UP' : 'NO MATCH';
    return {
      ...base, result, sound, complete: inf.complete, limitHit, asSaved, stop: inf.stop, limits, pokemon,
      ...(wrongCount ? { error: `${wrongCount.id} ${wrongCount.species}: ${wrongCount.miscounted}` } : {}),
      work: { rounds: inf.work.rounds, rebuilds: inf.work.rebuilds, probes: inf.work.probes, passes: inf.work.passes ?? null },
      // Each proof a rebuild was handed that broke under its own dice and
      // choices: the evidence called a turn exact that the simulator plays
      // otherwise. It removes nothing, but it is a bug in what is handed on,
      // whatever the result.
      // Each real spread a step removed on the way, whatever the result kept:
      // the step, and the events that did it.
      ...(inf.lost?.length ? { lost: inf.lost } : {}),
      broken: (inf.warnings || []).length,
      ...(inf.warnings?.length ? { brokenAt: inf.warnings.slice(0, 3).map(w => `turn ${w.turn}: ${w.expected} / ${w.actual}`) } : {}),
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    };
  } catch (err) {
    return { ...base, result: 'CRASH', error: String(err?.stack || err).split('\n').slice(0, 3).join(' | '), seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
  }
}

// ------------------------------------------------------------- the run

/** The folders of `--mimic-dir`, which may name several, comma-separated. */
const mimicDirsOf = mimicDir => mimicDir.split(',');

/** Every case of the tier, in list order, then view order. */
function casesOf({ tier, only, views, mimicDir = null }) {
  // Games outside the benchmark - a sample of the crawled corpus - are graded
  // from their own directory, all of them unless `only` names some. None has a
  // baseline: a sweep looks for what was removed, crashed or gave up.
  if (mimicDir) {
    const ids = only || mimicDirsOf(mimicDir).flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => `mimic:${f.slice(0, -'.json'.length)}`));
    for (const id of ids) if (!id.startsWith('mimic:')) throw new Error(`--mimic-dir grades mimic battles only, not ${id}`);
    const once = new Set();
    for (const id of ids) {
      if (once.has(id)) throw new Error(`--mimic-dir: ${id} is in two folders`);
      once.add(id);
    }
    return ids.flatMap(id => views.map(view => ({ id, view })));
  }
  const battles = BATTLES.filter(b => (only ? only.includes(b.id) : tier !== 'quick' || b.quick));
  // Any fuzz number plays a battle, so one outside the list can be graded too:
  // it has no baseline to compare with (`npm run mutate -- --hunt`).
  for (const id of only || []) {
    if (battles.some(b => b.id === id)) continue;
    if (/^fuzz:\d+$/.test(id)) battles.push({ id });
    else throw new Error(`${id} is not in the benchmark list`);
  }
  // The fast tier: every battle from both players' views only. The
  // spectator's cases are nine tenths of the full tier's work and its longest
  // ones take hours, while a player's view takes minutes and shows most of
  // what a change breaks; the full tier still grades everything before a
  // merge.
  const shown = (b, view) => tier !== 'fast' || only || VIEWS[view].infer.length === 1;
  return battles.flatMap(b => views.filter(view => shown(b, view)).map(view => ({ id: b.id, view })));
}

/**
 * The cases longest first, by the seconds each took in an earlier run (one it
 * lacks counts as that run's median): the longest start first, so they end
 * nearest the rest.
 */
function longestFirst(cases, timings) {
  const seconds = new Map((timings?.records || []).map(r => [keyOf(r), r.seconds || 0]));
  const known = [...seconds.values()].sort((a, b) => a - b);
  const typical = known.length ? known[Math.floor(known.length / 2)] : 0;
  const cost = c => seconds.get(keyOf(c)) ?? typical;
  return cases.map((c, k) => ({ c, k, t: cost(c) })).sort((a, b) => b.t - a.t || a.k - b.k).map(x => x.c);
}

/**
 * Cases on a pool of worker threads, each asking `take` for its next - `{ at,
 * id, view, ... }`, or null when none is left - and handing its record to
 * `put`. A thread with no case left is a thread to spare: the cases still
 * running begin the starts their search would run next on it
 * (`speculate.mjs`), which changes how soon they end, never what they find.
 */
async function runPool(threads, most, take, put) {
  const size = Math.max(1, Math.min(threads, most));
  const spare = new Int32Array(new SharedArrayBuffer(4));
  spare[0] = Math.max(0, threads - size);
  await Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { role: WORKER_ROLE, spare } });
    const feed = async () => worker.postMessage(await take());
    worker.on('message', ({ at, record }) => {
      put(at, record);
      feed();
    });
    worker.on('error', reject);
    worker.on('exit', () => {
      Atomics.add(spare, 0, 1);
      resolve();
    });
    feed();
  })));
}

const progress = (done, total, record, started, host = '') => `[${done}/${total}] ${record.id} ${record.view}: ${record.result} ${record.seconds}s (${((Date.now() - started) / 1000).toFixed(0)}s)${host && ` ${host}`}`;

/** The cases on this machine's threads; results in case order. */
async function runCases(cases, threads, job, onRecord = null) {
  const out = new Array(cases.length);
  const started = Date.now();
  let next = 0;
  let done = 0;
  await runPool(threads, cases.length, async () => {
    if (next >= cases.length) return null;
    const at = next++;
    return { at, ...job, ...cases[at] };
  }, (at, record) => {
    out[at] = record;
    onRecord?.(record);
    console.error(progress(++done, cases.length, record, started));
  });
  return out;
}

// What a machine serving a run (`--serve`) says on stdout starts with this:
// anything else there - the shell's, npm's - is not for the run.
const TAG = '@score ';
// How long, after the first machine says it is there, each machine gets one
// case only, until every machine's threads have asked: the longest cases go
// one to a machine, not all to the first ones up.
const GATHER_MS = 120_000;
const RETRY_MS = 300_000;

/**
 * This machine's threads, for a run handed out from elsewhere (`--hosts`): a
 * line on stdout for each thread that wants a case, and one back on stdin, the
 * case or null; a line on stdout for each record. It ends when its threads
 * have no case left, or at once when its stdin closes.
 */
async function serve(threads) {
  const say = msg => process.stdout.write(`${TAG}${JSON.stringify(msg)}\n`);
  // How long one thread takes over a fixed loop: crude, but it tells a
  // machine slowed down - throttled, or busy with another's work - from one
  // that is not.
  const t = process.hrtime.bigint();
  let x = 0;
  for (let i = 0; i < 1e8; i++) x = (x * 31 + i) | 0;
  const pace = Number(process.hrtime.bigint() - t) / 1e6 + (x & 0);
  const waiting = [];
  readline.createInterface({ input: process.stdin }).on('line', line => waiting.shift()?.(JSON.parse(line)));
  process.stdin.on('close', () => process.exit(1));
  say({ hello: { host: os.hostname(), threads, pace, commit: commitOf(), dirty: dirtyOf(), pool: poolPrint(), usage: usagePrint() } });
  await runPool(threads, threads, () => new Promise((resolve) => {
    waiting.push(resolve);
    say({ want: true });
  }), (at, record) => say({ at, record }));
  process.exit(0);
}

/**
 * The cases handed out over machines, each started by `remote` (`{host}` the
 * machine's name) with `node scripts/local-score.mjs --serve` after it, in
 * this checkout's commit. A thread that is free takes the longest case left,
 * so a faster or larger machine takes more and none waits on a deal made in
 * advance; while several want one, the machine running fewest goes first.
 * A machine more than twice as slow as the fastest (`pace`) takes the
 * shortest case left instead: a long one there would end the run late. A
 * machine that stops gives back the cases it held, to whichever takes next,
 * or to machines that ended well once all have ended; a case lost twice is a
 * CRASH. A machine that stops while cases wait and others still work - one
 * rebooted, or taken back by its user - is asked again every `RETRY_MS`: a
 * sweep of days would otherwise end on the few machines that never stopped. Results in case order; `onRecord` gets each one a machine sends, as
 * it comes.
 */
async function runHosts(cases, hosts, remote, job, onRecord = null) {
  const out = new Array(cases.length);
  const queue = cases.map((_, at) => at);
  const lost = new Map();
  const me = { commit: commitOf(), dirty: dirtyOf(), pool: poolPrint(), usage: usagePrint() };
  const started = Date.now();
  const sessions = [];
  const wants = [];
  let done = 0;
  let open = false;
  let gather = null;
  // Stopping the run stops the machines' share of it: each ends when its stdin closes.
  const children = new Set();
  process.on('exit', () => { for (const c of children) c.kill(); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));
  const dispatch = () => {
    if (!open && sessions.every(s => s.ended || s.asked >= s.hello?.threads)) open = true;
    const fastest = Math.min(...sessions.filter(s => s.hello).map(s => s.hello.pace));
    for (;;) {
      let k = -1;
      for (let j = 0; j < wants.length; j++) {
        const s = wants[j];
        if (!s.ended && (open || !s.held.size) && (k < 0 || s.held.size < wants[k].held.size)) k = j;
      }
      if (k < 0) break;
      const [s] = wants.splice(k, 1);
      const at = s.hello.pace > 2 * fastest ? queue.pop() : queue.shift();
      if (at === undefined) { s.send(null); continue; }
      s.held.add(at);
      s.send({ at, ...job, ...cases[at] });
    }
    for (let j = wants.length; j--;) if (wants[j].ended) wants.splice(j, 1);
    if (!queue.length || !working()) wake();
  };
  // Machines waiting to be asked again: woken once nothing waits for them, so
  // a run never ends late on a timer.
  const sleepers = new Set();
  const wake = () => { for (const w of [...sleepers]) w(); };
  const working = () => sessions.some(s => !s.ended);
  const pause = () => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
    const timer = setTimeout(done, RETRY_MS);
    sleepers.add(done);
  });
  const start = host => new Promise((resolve) => {
    const child = spawn('sh', ['-c', `exec ${remote.replaceAll('{host}', host)} node scripts/local-score.mjs --serve`], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    const s = { host, hello: null, asked: 0, ended: false, held: new Set(), send: m => child.stdin.write(`${JSON.stringify(m)}\n`) };
    sessions.push(s);
    child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stderr }).on('line', line => console.error(`[${host}] ${line}`));
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.startsWith(TAG)) return;
      const msg = JSON.parse(line.slice(TAG.length));
      if (msg.hello) {
        const off = Object.keys(me).filter(k => msg.hello[k] !== me[k]);
        if (off.length) {
          console.error(`[${host}] left out: another checkout (${off.join(', ')})`);
          child.kill();
          return;
        }
        s.hello = msg.hello;
        console.error(`[${host}] ${s.hello.threads} thread(s), pace ${s.hello.pace.toFixed(0)} ms`);
        gather ??= setTimeout(() => { open = true; dispatch(); }, GATHER_MS);
      } else if (msg.want) {
        s.asked++;
        wants.push(s);
      } else if (s.held.delete(msg.at)) {
        out[msg.at] = msg.record;
        onRecord?.(msg.record);
        console.error(progress(++done, cases.length, msg.record, started, host));
      }
      dispatch();
    });
    child.on('close', (code) => {
      children.delete(child);
      s.ended = true;
      s.well = code === 0 && !!s.hello;
      for (const at of s.held) {
        lost.set(at, (lost.get(at) || 0) + 1);
        if (lost.get(at) < 2) queue.push(at);
        else out[at] = { ...cases[at], result: 'CRASH', error: `lost twice, last on ${host}`, seconds: 0 };
      }
      queue.sort((a, b) => a - b);
      if (s.held.size) console.error(`[${host}] stopped (${code}) holding ${s.held.size} case(s)`);
      s.held.clear();
      dispatch();
      resolve();
    });
  });
  await Promise.all(hosts.map(async (host) => {
    await start(host);
    while (queue.length && working()) {
      await pause();
      if (!queue.length || !working()) break;
      await start(host);
    }
  }));
  // Cases given back once no machine was left to take them.
  for (let before = -1; queue.length && queue.length !== before;) {
    before = queue.length;
    const well = [...new Set(sessions.filter(s => s.well).map(s => s.host))].slice(0, queue.length);
    await Promise.all(well.map(start));
  }
  clearTimeout(gather);
  return out.map((r, at) => r || { ...cases[at], result: 'CRASH', error: 'no machine ran this case' });
}

const commitOf = () => {
  try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
};

/** Whether the checkout has changes the commit does not name - then two runs at one commit can differ. */
const dirtyOf = () => {
  try { return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== ''; } catch { return null; }
};

// ------------------------------------------------------------- the grade

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

/** The headline of a set of cases. */
function grade(records) {
  const count = r => records.filter(x => x.result === r).length;
  const inferred = records.flatMap(x => x.pokemon || []);
  const seen = inferred.filter(p => p.seen);
  const seconds = records.map(x => x.seconds).filter(x => x !== undefined);
  const ranked = seen.filter(p => p.rank !== undefined);
  return {
    cases: records.length,
    removed: inferred.filter(p => !p.kept).length,
    witnessesRemoved: records.filter(x => x.complete).flatMap(x => x.pokemon).filter(p => !p.witness).length,
    results: Object.fromEntries(['PASS', 'NO MATCH', 'GAVE UP', 'CRASH', 'REMOVED'].map(r => [r, count(r)])),
    exactShare: seen.length ? seen.reduce((t, p) => t + p.exact.length, 0) / (seen.length * STATS.length) : null,
    medianLog10Spreads: median(seen.map(p => Math.log10(Math.max(1, p.spreads)))),
    probes: records.reduce((t, x) => t + (x.work?.probes || 0), 0),
    rebuilds: records.reduce((t, x) => t + (x.work?.rebuilds || 0), 0),
    passes: records.reduce((t, x) => t + (x.work?.passes || 0), 0),
    broken: records.reduce((t, x) => t + (x.broken || 0), 0),
    brokenCases: records.filter(x => x.broken).length,
    seconds: { median: median(seconds), p95: quantile(seconds, 0.95), max: seconds.length ? seconds.reduce((a, b) => Math.max(a, b)) : null },
    ranked: ranked.length,
    first: ranked.length ? ranked.filter(p => p.rank === 1).length / ranked.length : null,
    top3: ranked.length ? ranked.filter(p => p.rank && p.rank <= 3).length / ranked.length : null,
  };
}

const pct = x => (x === null ? '-' : `${(100 * x).toFixed(1)}%`);

function printGrade(records, tier) {
  const views = [...new Set(records.map(r => r.view))];
  const rows = [...views.map(v => [v, grade(records.filter(r => r.view === v))]), ['all', grade(records)]];
  console.log('');
  console.log(`score: ${tier} tier, ${records.length} case(s), ${new Set(records.map(r => r.id)).size} battle(s)`);
  console.log('');
  console.log('view              cases  removed  PASS  NO MATCH  GAVE UP  CRASH  exact stats  median spreads   probes   passes   seconds median/p95/max');
  for (const [name, g] of rows) {
    console.log(`${name.padEnd(16)} ${String(g.cases).padStart(6)} ${String(g.removed).padStart(8)} ${String(g.results.PASS).padStart(5)}` +
      ` ${String(g.results['NO MATCH']).padStart(9)} ${String(g.results['GAVE UP']).padStart(8)} ${String(g.results.CRASH).padStart(6)}` +
      ` ${pct(g.exactShare).padStart(12)} ${(g.medianLog10Spreads === null ? '-' : `10^${g.medianLog10Spreads.toFixed(2)}`).padStart(15)}` +
      ` ${String(g.probes).padStart(8)} ${String(g.passes).padStart(8)}   ${g.seconds.median}/${g.seconds.p95}/${g.seconds.max}`);
  }
  const wide = views.filter(v => { const g = grade(records.filter(r => r.view === v)); return !g.removed && !g.results.CRASH; });
  console.log('');
  console.log(`accurate: ${grade(records).removed} real spread(s) removed, ${grade(records).witnessesRemoved} rebuilt spread(s) removed (both must be 0)`);
  console.log(`wide: ${wide.length} of ${views.length} view(s) with nothing removed and nothing crashed`);
  const all = grade(records);
  if (all.ranked) console.log(`likely: of ${all.ranked} seen Pokemon whose real spread is one people run, ${pct(all.first)} have it ranked first, ${pct(all.top3)} in the top 3`);
  console.log(`consistent: ${all.broken} broken proof(s), in ${all.brokenCases} case(s) (each one a bug in what the evidence hands on)`);
  for (const r of records.filter(x => x.broken).sort((a, b) => b.broken - a.broken).slice(0, 20)) {
    console.log(`  BROKEN ${r.id} ${r.view}: ${r.broken}, first ${r.brokenAt?.[0] || '?'}`);
  }
  console.log('closed team sheets: not graded yet');
  for (const r of records.filter(x => x.result === 'REMOVED' || x.result === 'CRASH')) {
    const lost = (r.pokemon || []).filter(p => !p.kept).map(p => `${p.id} ${p.species}`);
    const witness = r.complete ? (r.pokemon || []).filter(p => !p.witness).map(p => `${p.id} ${p.species}`) : [];
    console.log(`  ${r.result} ${r.id} ${r.view}${lost.length ? `: real spread removed for ${lost.join(', ')}` : ''}` +
      `${witness.length ? `: the spread the rebuild used was removed for ${witness.join(', ')}` : ''}${r.error ? `: ${r.error}` : ''}`);
  }
}

// ------------------------------------------------------- the ratchet

const keyOf = r => `${r.id} ${r.view}`;

/** What the baseline holds of a case: its result and each Pokemon's spreads. */
const baselineOf = records => Object.fromEntries(records.map(r => [keyOf(r), {
  result: r.result,
  ...(r.battle ? { battle: r.battle } : {}),
  ...(r.broken ? { broken: r.broken } : {}),
  spreads: Object.fromEntries((r.pokemon || []).map(p => [p.id, p.spreads])),
}]));

/**
 * Every case that got worse than the baseline, and every one that got better.
 * A full run of the benchmark must carry every case the baseline holds: one
 * dropped from the list is dropped only by accepting a new baseline. A case
 * that plays another battle than its baseline's is worse until accepted.
 */
function compare(records, baseline, { whole = false } = {}) {
  const worse = [];
  const better = [];
  const now = new Map(records.map(r => [keyOf(r), r]));
  for (const [key, was] of Object.entries(baseline.cases)) {
    const r = now.get(key);
    if (!r) {
      if (whole) worse.push(`${key}: in the baseline but not in this run`);
      continue;
    }
    if (was.battle && r.battle && was.battle !== r.battle) worse.push(`${key}: plays another battle than its baseline (${was.battle} -> ${r.battle})`);
    if (RANK[r.result] > RANK[was.result]) worse.push(`${key}: ${was.result} -> ${r.result}`);
    else if (RANK[r.result] < RANK[was.result]) better.push(`${key}: ${was.result} -> ${r.result}`);
    // Broken proofs ratchet once the baseline counts them: none counted is
    // none there.
    if (baseline.counts?.broken && r.broken !== undefined) {
      const before = was.broken || 0;
      if (r.broken > before) worse.push(`${key}: ${r.broken} broken proof(s), was ${before}: ${r.brokenAt?.[0] || ''}`);
      else if (r.broken < before) better.push(`${key}: ${r.broken} broken proof(s), was ${before}`);
    }
    for (const p of r.pokemon || []) {
      const before = was.spreads?.[p.id];
      if (before === undefined || before === p.spreads) continue;
      (p.spreads > before ? worse : better).push(`${key}: ${p.id} ${p.species} keeps ${p.spreads.toLocaleString()} spreads, was ${before.toLocaleString()}`);
    }
  }
  return { worse, better };
}

// ------------------------------------------------------------- main

function opt(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}
const flag = name => process.argv.includes(name);

/**
 * The records a run logged so far (`--log`), by case: the file starts with
 * what the run is - commit, pool, usage, budget, tier, views, folders - and a
 * run that is not the same refuses to go on from it. A last line cut short by
 * a stop is dropped, and so its case runs again. Only records a machine sent
 * are logged: a case lost with its machine runs again too.
 */
function readLog(file, head) {
  if (head.dirty !== false) throw new Error('--log: a checkout with uncommitted changes, or one that does not say, cannot be told apart from another at its commit');
  if (!fs.existsSync(file) || !fs.statSync(file).size) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ head })}\n`);
    return new Map();
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const was = JSON.parse(lines[0]).head;
  const off = Object.keys(head).filter(k => JSON.stringify(was?.[k]) !== JSON.stringify(head[k]));
  if (off.length) throw new Error(`--log: ${file} is another run's (${off.join(', ')})`);
  const logged = new Map();
  for (const line of lines.slice(1)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    logged.set(keyOf(record), record);
  }
  // A cut line has no newline: the next record must not start on it.
  if (lines.at(-1) !== '') fs.appendFileSync(file, '\n');
  return logged;
}

/** A run as JSON, one record at a time: one string of a sweep of a few hundred thousand cases is longer than V8 holds. */
function writeRun(file, run) {
  const { records, ...rest } = run;
  const head = JSON.stringify(rest);
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, `${head.slice(0, -1)}${head === '{}' ? '' : ','}"records":[`);
    records.forEach((r, k) => fs.writeSync(fd, `${k ? ',' : ''}${JSON.stringify(r)}`));
    fs.writeSync(fd, ']}');
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const threads = Number(opt('--threads', String(Math.max(1, os.availableParallelism() - 1))));
  if (flag('--serve')) return serve(threads);
  let merge = null;
  if (flag('--merge')) {
    const after = process.argv.slice(process.argv.indexOf('--merge') + 1);
    const end = after.findIndex(a => a.startsWith('--'));
    merge = end < 0 ? after : after.slice(0, end);
  }
  let run;
  if (merge) {
    const parts = merge.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
    const tiers = new Set(parts.map(p => p.tier));
    if (parts.some(p => p.dirty !== false)) throw new Error('--merge: a share from a checkout with uncommitted changes, or one that does not say, cannot be told apart from another at its commit');
    if (tiers.size !== 1) throw new Error(`--merge: shares of different tiers (${[...tiers].join(', ')})`);
    for (const k of ['commit', 'pool', 'usage', 'only', 'views', 'budget', 'mimicDir']) {
      if (new Set(parts.map(p => JSON.stringify(p[k]))).size !== 1) throw new Error(`--merge: shares of different ${k}`);
    }
    const records = parts.flatMap(p => p.records);
    const cases = casesOf({ tier: parts[0].tier, only: parts[0].only, views: parts[0].views, mimicDir: parts[0].mimicDir });
    const wanted = new Set(cases.map(keyOf));
    const have = new Map();
    for (const r of records) {
      if (!wanted.has(keyOf(r))) throw new Error(`--merge: ${keyOf(r)} is no case of this run`);
      if (have.has(keyOf(r))) throw new Error(`--merge: ${keyOf(r)} is in two shares`);
      have.set(keyOf(r), r);
    }
    // A case no share carries counts against the run: the denominator is the list.
    run = { ...parts[0], shard: null, records: cases.map(c => have.get(keyOf(c)) || { ...c, result: 'CRASH', error: 'no share carried this case' }) };
  } else {
    const tier = opt('--tier', 'quick');
    if (!['quick', 'fast', 'full'].includes(tier)) throw new Error('--tier quick|fast|full');
    const only = opt('--only') ? opt('--only').split(',') : null;
    const views = opt('--views') ? [...new Set(opt('--views').split(','))] : Object.keys(VIEWS);
    for (const v of views) if (!VIEWS[v]) throw new Error(`no view ${v} - have ${Object.keys(VIEWS).join(', ')}`);
    const mimicDir = opt('--mimic-dir') ? opt('--mimic-dir').split(',').map(d => path.resolve(d)).join(',') : null;
    let cases = casesOf({ tier, only, views, mimicDir });
    const timings = opt('--timings') && fs.existsSync(opt('--timings')) ? JSON.parse(fs.readFileSync(opt('--timings'), 'utf8')) : null;
    cases = longestFirst(cases, timings);
    const budget = Number(opt('--budget', '1'));
    if (!(Number.isInteger(budget) && budget >= 1)) throw new Error('--budget <n>: a whole number, at least 1');
    const job = { budget, trace: flag('--trace'), mimicDir };
    const hosts = opt('--hosts') ? opt('--hosts').split(/[\s,]+/).filter(Boolean) : null;
    if (hosts && !opt('--remote')) throw new Error('--hosts needs --remote <command>, {host} the machine');
    const logFile = opt('--log') ? path.resolve(opt('--log')) : null;
    const logged = logFile ? readLog(logFile, { commit: commitOf(), dirty: dirtyOf(), pool: poolPrint(), usage: usagePrint(), budget, tier, only, views, mimicDir }) : new Map();
    const todo = cases.filter(c => !logged.has(keyOf(c)));
    const onRecord = logFile ? record => fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`) : null;
    console.error(`score: ${todo.length} case(s)${logged.size ? ` (${cases.length - todo.length} more already in ${logFile})` : ''} on ${hosts ? `${hosts.length} machine(s)` : `${threads} thread(s)`}`);
    const fresh = !todo.length ? [] : hosts ? await runHosts(todo, hosts, opt('--remote'), job, onRecord) : await runCases(todo, threads, job, onRecord);
    const now = new Map(fresh.map(r => [keyOf(r), r]));
    const records = cases.map(c => now.get(keyOf(c)) || logged.get(keyOf(c)));
    run = { commit: commitOf(), dirty: dirtyOf(), pool: poolPrint(), usage: usagePrint(), budget, tier, only, views, mimicDir, host: os.hostname(), ...(hosts ? { hosts } : {}), records };
  }

  const out = opt('--out') || path.join(OUT_DIR, `${run.tier}-${run.commit || 'local'}${run.budget > 1 ? `-budget${run.budget}` : ''}.json`);
  fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
  writeRun(path.resolve(ROOT, out), run);
  console.error(`wrote ${out}`);

  printGrade(run.records, run.tier);

  // A crash proves nothing either way, and a missing share is one: never a pass.
  let failed = run.records.some(r => r.result === 'REMOVED' || r.result === 'CRASH');
  // A sweep grades games outside the benchmark: compared with nothing.
  if (run.mimicDir) {
    if (flag('--accept')) throw new Error('--accept: a sweep (--mimic-dir) is never a baseline');
    console.log('\na sweep: compared with no baseline');
    if (failed) process.exitCode = 1;
    return;
  }
  const baselineFile = path.resolve(ROOT, opt('--baseline', BASELINE));
  const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
  // A wider budget is an experiment: it is compared with the baseline but
  // never fails on what it improves or worsens, and is never a baseline.
  const experiment = (run.budget || 1) > 1;
  if (experiment) console.log(`
budget x${run.budget}: every search limit ${run.budget} times as wide`);
  if (baseline && baseline.pool !== run.pool && !flag('--accept')) {
    throw new Error(`the fuzz team pool changed (${baseline.pool} -> ${run.pool}): fuzz numbers play different battles, so a new baseline must be accepted`);
  }
  if (baseline?.usage && baseline.usage !== run.usage && !flag('--accept')) {
    throw new Error(`the usage spreads changed (${baseline.usage} -> ${run.usage}): mimic battles plant other spreads, so a new baseline must be accepted`);
  }
  if (baseline) {
    const whole = run.tier === 'full' && !run.only && run.views.length === Object.keys(VIEWS).length;
    const { worse, better } = compare(run.records, baseline, { whole });
    console.log('');
    console.log(`against the baseline (${baseline.commit}): ${worse.length} worse, ${better.length} better`);
    for (const w of worse) console.log(`  WORSE  ${w}`);
    for (const b of better.slice(0, 40)) console.log(`  better ${b}`);
    if (better.length > 40) console.log(`  ... and ${better.length - 40} more better`);
    if (worse.length && !experiment) failed = true;
  } else {
    console.log('\nno baseline yet: run with --tier full --accept to write one');
    if (!flag('--accept') && !experiment) failed = true;
  }
  if (flag('--accept')) {
    if (experiment) throw new Error('--accept: a run with a wider budget is never a baseline');
    if (run.tier !== 'full' || run.only || run.mimicDir || new Set(run.views).size !== Object.keys(VIEWS).length
      || !Object.keys(VIEWS).every(v => run.views.includes(v))) {
      throw new Error('--accept needs a full run of every view');
    }
    if (run.dirty !== false) throw new Error('--accept: a run from a checkout with uncommitted changes is never a baseline');
    if (run.records.some(r => r.result === 'REMOVED')) throw new Error('--accept: a run that removed a possible spread is never a baseline');
    const crashed = run.records.filter(r => r.result === 'CRASH');
    if (crashed.length) throw new Error(`--accept: ${crashed.length} case(s) crashed or were carried by no share, e.g. ${keyOf(crashed[0])}: ${crashed[0].error || ''}`);
    const cases = baselineOf(run.records);
    const sorted = Object.fromEntries(Object.keys(cases).sort().map(k => [k, cases[k]]));
    fs.writeFileSync(baselineFile, `${JSON.stringify({ commit: run.commit, pool: run.pool, usage: run.usage, ...(run.records.every(r => r.broken !== undefined || r.result === 'CRASH') ? { counts: { broken: true } } : {}), grade: grade(run.records), cases: sorted }, null, 1)}\n`);
    console.log(`wrote the baseline to ${path.relative(ROOT, baselineFile)}`);
    return;
  }
  if (failed) process.exitCode = 1;
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
} else if (workerData?.role === WORKER_ROLE) {
  const parallel = spareThreads({ shared: workerData.spare });
  parentPort.on('message', async (job) => {
    if (!job) { process.exit(0); return; }
    const record = await runCase(job.id, job.view, { ...job, parallel });
    parallel.release();
    parentPort.postMessage({ at: job.at, record });
  });
}
