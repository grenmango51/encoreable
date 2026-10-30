/**
 * The grade of the inference: every battle in `scripts/fixtures/benchmark.js`,
 * each from every viewpoint, inferred and checked against the answers it was
 * played with.
 *
 *   npm run score                            the quick slice, compared with the baseline
 *   npm run score -- --tier full             every battle
 *   npm run score -- --only fuzz:204         one battle, every view
 *   npm run score -- --views p2@p1           only some views
 *   npm run score -- --tier full --shard 3/12 --out <file>   one share of a run, for one machine
 *   npm run score -- --merge <file>...       the shares put together, graded and compared
 *   npm run score -- --tier full --accept    write this run as the new baseline
 *
 * Flags: --tier quick|full --only <id>[,<id>...] --views <v>[,<v>...] --threads <n>
 *        --shard <i>/<n> --out <file> --merge <file>... --baseline <file> --accept
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
 *   CRASH     the inference threw, or the battle's input log does not replay it
 *   REMOVED   a real spread is not among what the inference kept, for any
 *             Pokemon of an inferred side, seen or not - never allowed
 *   PASS      the rebuild reproduces the whole log
 *   GAVE UP   it does not, and a search limit left something untried
 *   NO MATCH  it does not, and no such limit was hit
 * Then for every Pokemon of an inferred side: how many spreads it kept, and
 * which stats are down to one value. And what the case cost: rounds, rebuilds
 * and probes, which are the same on every machine, and seconds, which are not
 * and are never compared.
 *
 * The baseline, `scripts/fixtures/score-baseline.json`, holds each case's
 * result and spreads as of the last accepted run. A run fails when any case is
 * REMOVED, when a case's result gets worse, or when a Pokemon keeps more
 * spreads than it did; a case the baseline has and the run does not is a
 * CRASH. A change that makes something worse on purpose - a soundness fix that
 * keeps more spreads - accepts a new baseline in the same commit, so the diff
 * shows what got worse.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { battleLines } from './lib/protocol.mjs';
import { inferSpreads } from './lib/inference/infer.mjs';
import { FUZZ_TURNS, fuzzRecipe, fuzzTeams, playFuzz } from './lib/fuzz.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Teams } = require('pokemon-showdown');
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
 * A battle as an input log, with a check that the log replays it: a recording's
 * against the log it was saved with, a fuzz battle's against the battle as it
 * was played.
 */
async function battleOf(id) {
  if (id.startsWith('fuzz:')) {
    fuzzPool ||= fuzzTeams().teams;
    const played = await playFuzz(fuzzRecipe(Number(id.slice(5)), fuzzPool, FUZZ_TURNS));
    const replayed = await replayInputLog(played.inputLog);
    const same = battleLines(replayed.channels[1]).join('\n') === battleLines(played.ch1).join('\n');
    return { inputLog: played.inputLog, replayed, same };
  }
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, id), 'utf8'));
  const inputLog = Array.isArray(data.inputLog) ? data.inputLog : String(data.inputLog || '').split('\n');
  const replayed = await replayInputLog(inputLog);
  const saved = Array.isArray(data.log) ? data.log : String(data.log || '').split('\n');
  const same = !data.log || battleLines(replayed.omniscient).join('\n') === battleLines(saved).join('\n');
  return { inputLog, replayed, same };
}

/** One battle from one view, graded. */
async function runCase(id, view) {
  const started = Date.now();
  const base = { id, view };
  try {
    const { infer, channel } = VIEWS[view];
    const { inputLog, replayed, same } = await battleOf(id);
    if (!same) return { ...base, result: 'CRASH', error: 'the input log does not replay the battle', seconds: 0 };
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
    const inf = await inferSpreads({
      formatid, sets, known, playerNames: players.map(p => p.name), observed: replayed.channels[channel], channel,
      sampleSeed: 1, threads: 1,
    });
    const pokemon = [];
    for (const p of inf.pokemon) {
      if (p.known) continue;
      const [s, i] = [Number(p.side[1]) - 1, Number(p.id.split(':')[1])];
      const real = Object.fromEntries(STATS.map(x => [x, truth[s][i].evs?.[x] || 0]));
      pokemon.push({
        id: p.id, species: p.species, seen: p.seen, kept: p.contains(real), spreads: p.spreads,
        exact: STATS.filter(x => p.stats[x]?.count === 1),
      });
    }
    const limits = inf.limits || [];
    const result = pokemon.some(p => !p.kept) ? 'REMOVED' : inf.complete ? 'PASS'
      : limits.some(l => SEARCH_LIMITS.has(l)) ? 'GAVE UP' : 'NO MATCH';
    return {
      ...base, result, stop: inf.stop, limits, pokemon,
      work: { rounds: inf.work.rounds, rebuilds: inf.work.rebuilds, probes: inf.work.probes },
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    };
  } catch (err) {
    return { ...base, result: 'CRASH', error: String(err?.stack || err).split('\n').slice(0, 3).join(' | '), seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
  }
}

// ------------------------------------------------------------- the run

/** Every case of the tier, in list order, then view order. */
function casesOf({ tier, only, views }) {
  const battles = BATTLES.filter(b => (only ? only.includes(b.id) : tier === 'full' || b.quick));
  if (only) for (const id of only) if (!battles.some(b => b.id === id)) throw new Error(`${id} is not in the benchmark list`);
  return battles.flatMap(b => views.map(view => ({ id: b.id, view })));
}

/** The cases on a pool of worker threads; results in case order. */
async function runCases(cases, threads) {
  const out = new Array(cases.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  const size = Math.max(1, Math.min(threads, cases.length));
  await Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { role: WORKER_ROLE } });
    const feed = () => {
      if (next >= cases.length) { worker.postMessage(null); return; }
      const at = next++;
      worker.postMessage({ at, ...cases[at] });
    };
    worker.on('message', ({ at, record }) => {
      out[at] = record;
      done++;
      console.error(`[${done}/${cases.length}] ${record.id} ${record.view}: ${record.result} ${record.seconds}s (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      feed();
    });
    worker.on('error', reject);
    worker.on('exit', resolve);
    feed();
  })));
  return out;
}

const commitOf = () => {
  try { return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; }
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
  return {
    cases: records.length,
    removed: inferred.filter(p => !p.kept).length,
    results: Object.fromEntries(['PASS', 'NO MATCH', 'GAVE UP', 'CRASH', 'REMOVED'].map(r => [r, count(r)])),
    exactShare: seen.length ? seen.reduce((t, p) => t + p.exact.length, 0) / (seen.length * STATS.length) : null,
    medianLog10Spreads: median(seen.map(p => Math.log10(Math.max(1, p.spreads)))),
    probes: records.reduce((t, x) => t + (x.work?.probes || 0), 0),
    rebuilds: records.reduce((t, x) => t + (x.work?.rebuilds || 0), 0),
    seconds: { median: median(seconds), p95: quantile(seconds, 0.95), max: seconds.length ? Math.max(...seconds) : null },
  };
}

const pct = x => (x === null ? '-' : `${(100 * x).toFixed(1)}%`);

function printGrade(records, tier) {
  const views = [...new Set(records.map(r => r.view))];
  const rows = [...views.map(v => [v, grade(records.filter(r => r.view === v))]), ['all', grade(records)]];
  console.log('');
  console.log(`score: ${tier} tier, ${records.length} case(s), ${new Set(records.map(r => r.id)).size} battle(s)`);
  console.log('');
  console.log('view              cases  removed  PASS  NO MATCH  GAVE UP  CRASH  exact stats  median spreads   probes   seconds median/p95/max');
  for (const [name, g] of rows) {
    console.log(`${name.padEnd(16)} ${String(g.cases).padStart(6)} ${String(g.removed).padStart(8)} ${String(g.results.PASS).padStart(5)}` +
      ` ${String(g.results['NO MATCH']).padStart(9)} ${String(g.results['GAVE UP']).padStart(8)} ${String(g.results.CRASH).padStart(6)}` +
      ` ${pct(g.exactShare).padStart(12)} ${(g.medianLog10Spreads === null ? '-' : `10^${g.medianLog10Spreads.toFixed(2)}`).padStart(15)}` +
      ` ${String(g.probes).padStart(8)}   ${g.seconds.median}/${g.seconds.p95}/${g.seconds.max}`);
  }
  const wide = views.filter(v => { const g = grade(records.filter(r => r.view === v)); return !g.removed && !g.results.CRASH; });
  console.log('');
  console.log(`accurate: ${grade(records).removed} real spread(s) removed (must be 0)`);
  console.log(`wide: ${wide.length} of ${views.length} view(s) with nothing removed and nothing crashed`);
  console.log('closed team sheets: not graded yet');
  for (const r of records.filter(x => x.result === 'REMOVED' || x.result === 'CRASH')) {
    const lost = (r.pokemon || []).filter(p => !p.kept).map(p => `${p.id} ${p.species}`);
    console.log(`  ${r.result} ${r.id} ${r.view}${lost.length ? `: real spread removed for ${lost.join(', ')}` : ''}${r.error ? `: ${r.error}` : ''}`);
  }
}

// ------------------------------------------------------- the ratchet

const keyOf = r => `${r.id} ${r.view}`;

/** What the baseline holds of a case: its result and each Pokemon's spreads. */
const baselineOf = records => Object.fromEntries(records.map(r => [keyOf(r), {
  result: r.result,
  spreads: Object.fromEntries((r.pokemon || []).map(p => [p.id, p.spreads])),
}]));

/** Every case that got worse than the baseline, and every one that got better. */
function compare(records, baseline) {
  const worse = [];
  const better = [];
  const now = new Map(records.map(r => [keyOf(r), r]));
  for (const [key, was] of Object.entries(baseline.cases)) {
    const r = now.get(key);
    if (!r) continue;
    if (RANK[r.result] > RANK[was.result]) worse.push(`${key}: ${was.result} -> ${r.result}`);
    else if (RANK[r.result] < RANK[was.result]) better.push(`${key}: ${was.result} -> ${r.result}`);
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

async function main() {
  const merge = flag('--merge') ? process.argv.slice(process.argv.indexOf('--merge') + 1).filter(a => !a.startsWith('--')) : null;
  let run;
  if (merge) {
    const parts = merge.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
    const tiers = new Set(parts.map(p => p.tier));
    if (tiers.size !== 1) throw new Error(`--merge: shares of different tiers (${[...tiers].join(', ')})`);
    const records = parts.flatMap(p => p.records);
    const cases = casesOf({ tier: parts[0].tier, only: parts[0].only, views: parts[0].views });
    const have = new Map(records.map(r => [keyOf(r), r]));
    // A case no share carries counts against the run: the denominator is the list.
    run = { ...parts[0], shard: null, records: cases.map(c => have.get(keyOf(c)) || { ...c, result: 'CRASH', error: 'no share carried this case' }) };
  } else {
    const tier = opt('--tier', 'quick');
    if (!['quick', 'full'].includes(tier)) throw new Error('--tier quick|full');
    const only = opt('--only') ? opt('--only').split(',') : null;
    const views = opt('--views') ? opt('--views').split(',') : Object.keys(VIEWS);
    for (const v of views) if (!VIEWS[v]) throw new Error(`no view ${v} - have ${Object.keys(VIEWS).join(', ')}`);
    let cases = casesOf({ tier, only, views });
    let shard = null;
    if (opt('--shard')) {
      const [i, n] = opt('--shard').split('/').map(Number);
      if (!(n >= 1 && i >= 1 && i <= n)) throw new Error('--shard <i>/<n>, 1 <= i <= n');
      shard = { i, n };
      cases = cases.filter((_, k) => k % n === i - 1);
    }
    const threads = Number(opt('--threads', String(Math.max(1, os.availableParallelism() - 1))));
    console.error(`score: ${cases.length} case(s) on ${threads} thread(s)`);
    run = { commit: commitOf(), tier, only, views, shard, host: os.hostname(), records: await runCases(cases, threads) };
  }

  const out = opt('--out') || path.join(OUT_DIR, `${run.tier}-${run.commit || 'local'}${run.shard ? `-${run.shard.i}of${run.shard.n}` : ''}.json`);
  fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(run));
  console.error(`wrote ${out}`);
  if (run.shard) return;

  printGrade(run.records, run.tier);

  const baselineFile = path.resolve(ROOT, opt('--baseline', BASELINE));
  const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
  let failed = run.records.some(r => r.result === 'REMOVED');
  if (baseline) {
    const { worse, better } = compare(run.records, baseline);
    console.log('');
    console.log(`against the baseline (${baseline.commit}): ${worse.length} worse, ${better.length} better`);
    for (const w of worse) console.log(`  WORSE  ${w}`);
    for (const b of better.slice(0, 40)) console.log(`  better ${b}`);
    if (better.length > 40) console.log(`  ... and ${better.length - 40} more better`);
    if (worse.length) failed = true;
  } else {
    console.log('\nno baseline yet: run with --tier full --accept to write one');
  }
  if (flag('--accept')) {
    if (run.tier !== 'full' || run.only || run.views.length !== Object.keys(VIEWS).length) {
      throw new Error('--accept needs a full run of every view');
    }
    const cases = baselineOf(run.records);
    const sorted = Object.fromEntries(Object.keys(cases).sort().map(k => [k, cases[k]]));
    fs.writeFileSync(baselineFile, `${JSON.stringify({ commit: run.commit, grade: grade(run.records), cases: sorted }, null, 1)}\n`);
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
  parentPort.on('message', async (job) => {
    if (!job) { process.exit(0); return; }
    parentPort.postMessage({ at: job.at, record: await runCase(job.id, job.view) });
  });
}
