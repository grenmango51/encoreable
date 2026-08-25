/**
 * Reconstruct - turn a replay plus both teams into a branchable battle.
 *
 * A replay carries no input log: no seed, no choices, and the opponent's HP only
 * as a Champions percentage. This rebuilds the input log anyway, and writes a
 * `.log.json` that every other command in this project already understands - so
 * `npm run replay`, `npm run live` and "Play from here" work on someone else's
 * ladder game with no changes at all.
 *
 * The four rungs exist because each one adds exactly one unknown, and the 14
 * recordings are ground truth for the first three:
 *
 *   s1  a recording's log, both teams, and the real seed   -> choices only
 *   s2  the same, seed withheld                            -> choices + RNG
 *   s3  the same, observed as p1's view (opponent as %)     -> + exact HP
 *   s4  a saved .html replay                               -> everything
 *
 * Usage:
 *   node scripts/local-reconstruct.mjs --rung s1
 *   node scripts/local-reconstruct.mjs --rung s3 --from recordings/<x>.log.json
 *   node scripts/local-reconstruct.mjs --rung s1 --all
 *   node scripts/local-reconstruct.mjs --from "samples/<replay>.html" --teams alt
 *
 * Flags: --from <file> --rung s1|s2|s3 --all --teams <fixture> --sample <n>
 *        --out <file> --dry-run --verbose --max-tries <n>
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { battleLines } from './lib/protocol.mjs';
import { listLogFiles, newestLogFile, posix as toPosix } from './lib/recordings.mjs';
import { reconstruct, unpackTeams } from './lib/reconstruct.mjs';
import {
  alignSpeciesToSheet, crossCheckSheet, loadSource, maxHpFromLog, pinGenders, unreplayableChoices,
} from './lib/replay-source.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const { TEAM_SETS } = require('./fixtures/teams.js');

const ROOT = process.cwd();

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const VERBOSE = flag('--verbose');
const say = (...a) => console.log(...a);
const chatty = (...a) => { if (VERBOSE) console.log(' ', ...a); };

// ------------------------------------------------------------- re-simulation

/**
 * Where an input log resets its own RNG, and to what.
 *
 * A recording produced by branching carries a `>reseed`: `npm run live` keeps
 * the position and rolls fresh dice from that turn on. Turn boundaries are not
 * derivable by counting (ENGINEERING.md 5.8), so the log is replayed one line at
 * a time and `battle.turn` is read off at the moment the reseed lands.
 */
async function reseedPlan(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  const plan = [];
  for (const line of inputLog.filter(l => String(l).startsWith('>'))) {
    if (line.startsWith('>reseed ')) plan.push({ turn: stream.battle.turn, seed: line.slice(8).trim() });
    await stream.write(line);
  }
  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return plan;
}

/** Replay an input log in-process and hand back both channel views. */
async function resimulate(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const sink = [];
  const drain = (async () => { for await (const chunk of stream) sink.push(chunk); })();
  const lines = (Array.isArray(inputLog) ? inputLog : String(inputLog).split('\n'))
    .map(l => l.trimEnd()).filter(l => l.startsWith('>'));
  for (const line of lines) await stream.write(line);
  const battle = stream.battle;
  const raw = [...battle.log];
  const channels = extractChannelMessages(raw.join('\n'), [-1, 1, 2]);
  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return { omniscient: channels[-1], p1: channels[1], p2: channels[2], turns: battle.turn };
}

// ------------------------------------------------------------------- metrics

const HP_LINES = new Set(['-damage', '-heal', '-sethp', 'switch', 'drag', 'replace']);

/** Exact HP for one side, by position in the log, out of an omniscient view. */
function hpReadings(omniscientLines, side) {
  const out = [];
  for (const [i, line] of omniscientLines.entries()) {
    const parts = line.split('|');
    if (!HP_LINES.has(parts[1])) continue;
    if (!String(parts[2]).startsWith(side)) continue;
    const field = parts[1] === 'switch' || parts[1] === 'drag' || parts[1] === 'replace' ? parts[4] : parts[3];
    const hp = String(field || '').split(' ')[0].split('/');
    if (hp.length !== 2) continue;
    out.push({ at: i, ident: parts[2], hp: Number(hp[0]), max: Number(hp[1]) });
  }
  return out;
}

/**
 * How close the sampled HP came to the truth.
 *
 * Only meaningful on a rung where the truth is known. The channel the
 * reconstruction was checked against cannot tell these apart - two HP values
 * behind the same percentage render identically - which is exactly why this
 * number is the honest measure of the approximation.
 */
function hpAccuracy(truthLines, builtLines, side) {
  const truth = hpReadings(battleLines(truthLines), side);
  const built = hpReadings(battleLines(builtLines), side);
  const n = Math.min(truth.length, built.length);
  let exact = 0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(truth[i].hp - built[i].hp);
    if (!err) exact++;
    sum += err;
    max = Math.max(max, err);
  }
  return {
    readings: n,
    unmatched: Math.abs(truth.length - built.length),
    exact,
    exactPct: n ? Math.round((100 * exact) / n) : 0,
    meanAbsErr: n ? Number((sum / n).toFixed(2)) : 0,
    maxErr: max,
  };
}

// -------------------------------------------------------------- one run

async function runOne({ file, rung: requestedRung, teamsKey, sampleSeed, maxTries, write, outDir }) {
  let rung = requestedRung;
  const source = loadSource(file);
  const label = path.basename(file);

  let packedTeams = source.packedTeams;
  let observed = source.lines;
  let channel = -1;
  let seed = null;
  let seedPlan = null;
  let truth = null;

  if (source.kind === 'recording') {
    if (!source.inputLog) throw new Error(`${label} has no inputLog`);
    const real = await resimulate(source.inputLog);
    truth = source.lines;
    if (rung === 's1') {
      // The rung that supplies the real seed supplies every reset of it too.
      seed = source.seed;
      seedPlan = await reseedPlan(source.inputLog);
      observed = source.lines;
    }
    else if (rung === 's2') { observed = source.lines; }
    else if (rung === 's3') { observed = real.p1; channel = 1; }
    else throw new Error(`rung ${rung} does not apply to a recording`);
  } else {
    // A saved replay: HP is exact for whoever uploaded it and a percentage for
    // the other, which is p1's view. Stat points must come from a fixture.
    channel = 1;
    const set = TEAM_SETS[teamsKey];
    if (!set) throw new Error(`no fixture team set "${teamsKey}" - have ${Object.keys(TEAM_SETS).join(', ')}`);
    packedTeams = [set.p1, set.p2]
      .map(text => Teams.pack(Teams.import(text)))
      .map((packed, i) => alignSpeciesToSheet(packed, source.sheets?.[i]));
    rung = 's4';
  }

  // Gender is stated in the log and drawn at random when a set omits it, so pin
  // it before anything is simulated (see pinGenders).
  packedTeams = packedTeams.map((packed, i) => pinGenders(packed, observed, `p${i + 1}`));

  // Cross-check the supplied teams against what the replay published, before
  // anything else runs. A team from the wrong game is caught here.
  const problems = [];
  for (const [i, sheet] of (source.sheets || []).entries()) {
    for (const p of crossCheckSheet(sheet, packedTeams[i])) problems.push(`p${i + 1} ${p}`);
  }
  const statedMax = maxHpFromLog(observed);
  if (statedMax.size) {
    const dex = Dex.forFormat(source.formatid);
    for (const [i, packed] of packedTeams.entries()) {
      for (const set of Teams.unpack(packed)) {
        const key = `p${i + 1} ${set.name || set.species}`;
        if (!statedMax.has(key)) continue;
        const base = dex.species.get(set.species || set.name).baseStats.hp;
        const mine = base + (set.evs?.hp || 0) + 75;
        if (mine !== statedMax.get(key)) {
          problems.push(`p${i + 1} ${set.species || set.name}: log says max HP ${statedMax.get(key)}, supplied spread gives ${mine}`);
        }
      }
    }
  }
  if (problems.length) {
    say(`  team check FAILED for ${label}:`);
    for (const p of problems) say(`    - ${p}`);
    return { file, label, rung, ok: false, teamCheck: problems };
  }

  // A source whose own input log the simulator would refuse cannot be
  // reproduced exactly - the choice that was really made is inexpressible - so
  // say so before the seed search papers over it.
  const inexpressible = source.inputLog
    ? unreplayableChoices(source.inputLog, Dex.forFormat(source.formatid))
    : [];

  const started = Date.now();
  const built = await reconstruct({
    formatid: source.formatid,
    packedTeams,
    playerNames: source.players,
    observed,
    channel,
    seed,
    seedPlan,
    sampleSeed,
    maxTries,
    onProgress: chatty,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // Independent proof: replaying the reconstructed input log from scratch must
  // reproduce the log we are about to write.
  const replayed = await resimulate(built.inputLog);
  const selfConsistent = battleLines(replayed.omniscient).join('\n') === battleLines(built.log).join('\n');

  const accuracy = truth ? hpAccuracy(truth, built.log, 'p2') : null;

  const r = built.report;
  const verdict = r.complete ? 'MATCH' : `PARTIAL (verified through turn ${r.verifiedThroughTurn})`;
  say(`  ${rung.toUpperCase()} ${label}`);
  say(`     ${verdict}  ${r.turns} turns  ${seconds}s  ` +
      `reseeds ${r.reseedCount}  variants ${r.variantsUsed}  seeds tried ${r.seedsTried}  backtracks ${r.backtracks}`);
  say(`     input log replays to the same battle: ${selfConsistent ? 'yes' : 'NO'}`);
  if (accuracy && accuracy.readings) {
    say(`     opponent HP: ${accuracy.readings} readings, exact ${accuracy.exact} (${accuracy.exactPct}%), ` +
        `|err| mean ${accuracy.meanAbsErr}, max ${accuracy.maxErr}`);
  }
  if (inexpressible.length) {
    say(`     warning: the source's own input log is unreplayable - ${inexpressible.join(', ')} ` +
        `recorded with no target (ENGINEERING.md 6.1). The real choice cannot be expressed, so ` +
        `this battle is reproduced by reseeding rather than by matching choices.`);
  }
  for (const note of r.notes) say(`     note: ${note}`);
  for (const d of r.diffs.slice(0, 3)) {
    say(`     turn ${d.turn} diverged at line ${d.index}`);
    say(`        observed: ${d.expected ?? '(nothing)'}`);
    say(`        rebuilt : ${d.actual ?? '(nothing)'}`);
  }

  let outFile = null;
  if (write) {
    const base = path.basename(file).replace(/\.log\.json$|\.html$/i, '');
    outFile = opt('--out') || path.join(outDir, `reconstructed-${base}.log.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify({
      reconstructed: true,
      reconstructedFrom: toPosix(ROOT, file),
      rung,
      verifiedThroughTurn: r.verifiedThroughTurn,
      complete: r.complete,
      sampleSeed,
      winner: r.winner,
      seed: built.seed,
      turns: r.turns,
      p1: source.players[0],
      p2: source.players[1],
      p1team: unpackTeams(packedTeams)[0],
      p2team: unpackTeams(packedTeams)[1],
      inputLog: built.inputLog,
      log: built.log,
      format: source.formatid,
      timestamp: new Date().toISOString(),
    }, null, 2)}\n`);
    say(`     wrote ${toPosix(ROOT, outFile)}`);
  }

  return {
    file, label, rung, ok: r.complete && selfConsistent, report: r, accuracy, selfConsistent, outFile, seconds,
  };
}

// ------------------------------------------------------------------- main

async function main() {
  const rung = (opt('--rung', 's1') || 's1').toLowerCase();
  const teamsKey = opt('--teams', 'alt');
  const sampleSeed = Number(opt('--sample', '1'));
  const maxTries = Number(opt('--max-tries', '2000'));
  const write = !flag('--dry-run');
  const outDir = path.join(ROOT, 'recordings');

  let files;
  if (flag('--all')) {
    files = listLogFiles(ROOT).filter(f => !path.basename(f).startsWith('reconstructed-'));
  } else {
    const from = opt('--from');
    files = [from ? path.resolve(ROOT, from) : newestLogFile(ROOT)];
  }
  if (!files.length || !files[0]) throw new Error('no source found - pass --from <file>');

  say(`reconstruct: rung ${rung}, ${files.length} source${files.length === 1 ? '' : 's'}, sample seed ${sampleSeed}`);

  const results = [];
  for (const file of files) {
    try {
      results.push(await runOne({
        file, rung, teamsKey, sampleSeed, maxTries,
        write: write && !flag('--all'),
        outDir,
      }));
    } catch (err) {
      say(`  ${path.basename(file)}: ERROR ${err.message}`);
      if (VERBOSE) console.error(err);
      results.push({ file, label: path.basename(file), rung, ok: false, error: err.message });
    }
  }

  if (results.length > 1) {
    const passed = results.filter(r => r.ok).length;
    say('');
    say(`${passed}/${results.length} reconstructions matched line-for-line`);
    for (const r of results.filter(x => !x.ok)) {
      say(`  FAIL ${r.label}${r.error ? ` - ${r.error}` : ''}` +
          `${r.report ? ` - verified through turn ${r.report.verifiedThroughTurn}/${r.report.turns}` : ''}`);
    }
    if (passed !== results.length) process.exitCode = 1;
  } else if (!results[0]?.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
