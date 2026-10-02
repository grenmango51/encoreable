/**
 * Reconstruct - turn a replay plus both teams into a branchable battle.
 *
 * A replay carries no input log: no seed, no choices, and the opponent's HP only
 * as a Champions percentage. This rebuilds the input log anyway, and writes a
 * `.log.json` that every other command in this project already understands - so
 * `npm run replay`, `npm run live` and "Play from here" work on someone else's
 * ladder game with no changes at all.
 *
 * The four rungs exist because each one adds exactly one unknown, and the
 * battles in recordings/local/ are ground truth for the first three:
 *
 *   s1  a recording's log, both teams, and the real seed   -> choices only
 *   s2  the same, seed withheld                            -> choices + RNG
 *   s3  the same, observed as p1's view (opponent as %)     -> + exact HP
 *   s4  a saved .html replay                               -> everything
 *
 * `--infer p1|p2|both` withholds one more thing: that side's Stat Points. They
 * are inferred from the replay (docs/engineering.md 7.5) instead of read from a
 * fixture - `p2` is "I know my team, not theirs", `both` knows neither. On a
 * recording the real spreads stay available as the check; on a replay, the
 * fixture named by `--teams` is the check when it has that side.
 *
 * Usage:
 *   node scripts/local-reconstruct.mjs --rung s1
 *   node scripts/local-reconstruct.mjs --rung s3 --from recordings/local/scripted/<x>.log.json
 *   node scripts/local-reconstruct.mjs --rung s1 --all
 *   node scripts/local-reconstruct.mjs --from "recordings/showdown/full-sheets/<replay>.html" --teams alt
 *   node scripts/local-reconstruct.mjs --from "recordings/showdown/full-sheets/<replay>.html" --infer p2
 *   node scripts/local-reconstruct.mjs --rung s3 --all --infer p2
 *
 * Flags: --from <file> --rung s1|s2|s3 --all --teams <fixture> --infer p1|p2|both
 *        --all-spent --sample <n> --max-probes <n> --threads <n> --out <file> --dry-run --verbose
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { battleLines } from './lib/protocol.mjs';
import { listLogFiles, newestLogFile, posix as toPosix } from './lib/recordings.mjs';
import { inferSpreads } from './lib/inference/infer.mjs';
import { reconstruct, unpackTeams } from './lib/reconstruct.mjs';
import {
  alignSpeciesToSheet, crossCheckLog, crossCheckSheet, loadSource, maxHpFromLog, setsFromLog, setsFromSheet,
  teamsForSides, unreplayableChoices, withLogIdentity,
} from './lib/replay-source.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams, toID } = require('pokemon-showdown');
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
 * derivable by counting (docs/engineering.md 5.8), so the log is replayed one line at
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

async function runOne({ file, rung: requestedRung, teamsKey, sampleSeed, maxProbes, threads, write, outDir, infer, allSpent, showEvents }) {
  let rung = requestedRung;
  const source = loadSource(file);
  const label = path.basename(file);
  const inferred = infer === 'both' ? ['p1', 'p2'] : infer ? [infer] : [];

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
    // the other, so the side whose HP the log states outright is the view it
    // was saved from. A replay the server published states neither side's:
    // that is a spectator's view. Stat points come from a fixture, or for an
    // inferred side from nowhere at all.
    const exactSides = new Set([...maxHpFromLog(observed).keys()].map(key => key.slice(0, 2)));
    channel = !exactSides.size ? 0 : exactSides.size === 1 && exactSides.has('p2') ? 2 : 1;
    const set = TEAM_SETS[teamsKey];
    if (!set && inferred.length < 2) {
      throw new Error(`no fixture team set "${teamsKey}" - have ${Object.keys(TEAM_SETS).join(', ')}`);
    }
    // A fixture's own team can sit on either side of someone else's replay.
    packedTeams = teamsForSides(observed, [set?.p1, set?.p2].map(text => (text ? Teams.pack(Teams.import(text)) : null)))
      .map((packed, i) => (packed ? alignSpeciesToSheet(packed, source.sheets?.[i]) : null));
    rung = 's4';
  }

  // Cross-check the supplied teams against what the replay published, before
  // anything else runs. A team from the wrong game is caught here. An inferred
  // side supplied nothing, so there is nothing of it to check.
  const supplied = i => !inferred.includes(`p${i + 1}`);
  const problems = [];
  for (const [i, sheet] of (source.sheets || []).entries()) {
    if (!supplied(i) || !packedTeams[i]) continue;
    const found = sheet ? crossCheckSheet(sheet, packedTeams[i]) : crossCheckLog(observed, `p${i + 1}`, source.formatid, packedTeams[i]);
    for (const p of found) problems.push(`p${i + 1} ${p}`);
  }
  const statedMax = maxHpFromLog(observed);
  if (statedMax.size) {
    const dex = Dex.forFormat(source.formatid);
    for (const [i, packed] of packedTeams.entries()) {
      if (!supplied(i)) continue;
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
  let built;
  let inference = null;
  let truthSets = [null, null];
  const readOffLog = [false, false];
  if (inferred.length) {
    // What the inferred side's sheet publishes, and nothing else. Its real
    // spreads - a recording's own, or the fixture's - are kept only as the check.
    // A replay with no sheet for that side says only what the battle showed: its
    // sets are read off the log, and everything else is an assumption, named.
    const sets = [0, 1].map((i) => {
      readOffLog[i] = !supplied(i) && source.kind === 'replay' && !source.sheets?.[i];
      if (supplied(i)) return Teams.unpack(packedTeams[i]);
      if (source.kind === 'replay' && source.sheets?.[i]) {
        return withLogIdentity(setsFromSheet(source.sheets[i]), observed, `p${i + 1}`, source.formatid);
      }
      if (source.kind === 'replay') {
        const read = setsFromLog(observed, `p${i + 1}`, source.formatid);
        say(`  p${i + 1} published no team sheet - its sets are read off the log:`);
        for (const [j, set] of read.sets.entries()) {
          const shown = [set.item && `@ ${set.item}`, set.ability, set.moves.join(' / ')].filter(Boolean).join('  ');
          say(`     ${set.name.padEnd(14)} ${shown}${read.assumed[j].notes.length ? `   assumed: ${read.assumed[j].notes.join(', ')}` : ''}`);
        }
        return read.sets;
      }
      return Teams.unpack(packedTeams[i]).map(s => ({ ...s, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }));
    });
    truthSets = [0, 1].map(i => (!supplied(i) && packedTeams[i] ? Teams.unpack(packedTeams[i]) : null));
    inference = await inferSpreads({
      formatid: source.formatid,
      sets,
      known: [supplied(0), supplied(1)],
      playerNames: source.players,
      observed,
      channel,
      sampleSeed,
      maxProbes,
      allSpent,
      threads,
      onProgress: chatty,
    });
    built = inference.built;
    packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: inference.picks[s][i] }))));
  } else {
    built = await reconstruct({
      formatid: source.formatid,
      packedTeams,
      playerNames: source.players,
      observed,
      channel,
      seed,
      seedPlan,
      sampleSeed,
      maxProbes,
      threads,
      onProgress: chatty,
    });
  }
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
      `forced ${r.forcedDraws}/${r.drawsSeen} draws  variants ${r.variantsUsed}  backtracks ${r.backtracks}`);
  say(`     input log replays to the same battle: ${selfConsistent ? 'yes' : 'NO'}`);
  if (accuracy && accuracy.readings) {
    say(`     opponent HP: ${accuracy.readings} readings, exact ${accuracy.exact} (${accuracy.exactPct}%), ` +
        `|err| mean ${accuracy.meanAbsErr}, max ${accuracy.maxErr}`);
  }
  if (inexpressible.length) {
    say(`     warning: the source's own input log is unreplayable - ${inexpressible.join(', ')} ` +
        `recorded with no target (docs/engineering.md 6.1). The real choice cannot be expressed, ` +
        `so this battle is reproduced by forcing its draws rather than by matching choices.`);
  }
  for (const note of r.notes) say(`     note: ${note}`);
  for (const d of r.diffs.slice(0, 3)) {
    say(`     turn ${d.turn} diverged at line ${d.index}`);
    say(`        observed: ${d.expected ?? '(nothing)'}`);
    say(`        rebuilt : ${d.actual ?? '(nothing)'}`);
  }

  // Did every real spread survive? A spread the replay could have come from
  // must never be eliminated, so a miss here is a defect, not a hard replay.
  let truthKept = true;
  if (inference) {
    say(`     Stat Points of ${inferred.join(' and ')} inferred in ${inference.rounds} round(s), ` +
        `${inference.events.length} events narrowed them`);
    for (const p of inference.pokemon) {
      if (p.known || !p.seen) continue;
      const side = Number(p.side[1]) - 1;
      const real = truthSets[side]?.find(s => toID(s.species || s.name).startsWith(toID(p.species))
        || toID(p.species).startsWith(toID(s.species || s.name)));
      const kept = real ? p.contains(real.evs) : null;
      if (kept === false) truthKept = false;
      const ranges = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
        .map(s => (p.stats[s] ? `${s} ${p.stats[s].min}-${p.stats[s].max}` : `${s} -`)).join('  ');
      say(`       ${p.side} ${p.species.padEnd(14)} ${p.spreads.toLocaleString('en')} of ${p.from.toLocaleString('en')} left  ${ranges}` +
          `${kept === null ? '' : kept ? '  (real spread survives)' : '  REAL SPREAD ELIMINATED'}`);
      if (!p.spreads) {
        say(readOffLog[side]
          ? '         no spread fits the set read off the log, so one of its assumptions is wrong - the events say which observation ruled it out'
          : '         no spread fits the published set - a mechanic the inference does not model, or a defect');
      }
    }
    // Where a shortcut of the evidence pass disagreed with the simulator, so
    // that line of evidence was given up rather than trusted.
    for (const c of inference.checks || []) say(`       not used, turn ${c.turn}: ${c.what} - ${c.reason}`);
    // Which event narrowed what, and to which ranges. A whole suite prints only
    // the totals above; every event is in the written log either way.
    if (showEvents) {
      for (const e of inference.events) {
        say(`       turn ${e.turn}: ${e.what}${e.shown ? ` (shown ${e.shown})` : ''}`);
        for (const c of e.cuts) {
          const moved = c.narrowed.map(s => `${s} ${c.stats[s] ? `${c.stats[s].min}-${c.stats[s].max}` : 'none'}`).join(', ');
          say(`         ${c.pokemon} ${c.before.toLocaleString('en')} -> ${c.after.toLocaleString('en')}${moved ? `  ${moved}` : ''}`);
        }
      }
    }
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
      inference: inference ? {
        inferred,
        complete: inference.complete,
        rounds: inference.rounds,
        pokemon: inference.pokemon.filter(p => !p.known).map(({ contains, known, ...rest }) => rest),
        events: inference.events,
        checks: inference.checks,
      } : undefined,
      inputLog: built.inputLog,
      log: built.log,
      format: source.formatid,
      timestamp: new Date().toISOString(),
    }, null, 2)}\n`);
    say(`     wrote ${toPosix(ROOT, outFile)}`);
  }

  return {
    file, label, rung, ok: r.complete && selfConsistent && truthKept, report: r, accuracy, selfConsistent, outFile, seconds,
  };
}

// ------------------------------------------------------------------- main

async function main() {
  const rung = (opt('--rung', 's1') || 's1').toLowerCase();
  const teamsKey = opt('--teams', 'alt');
  const sampleSeed = Number(opt('--sample', '1'));
  const maxProbes = Number(opt('--max-probes', '4000'));
  const threads = opt('--threads') ? Number(opt('--threads')) : undefined;
  const write = !flag('--dry-run');
  const outDir = path.join(ROOT, 'recordings', 'reconstructed');
  const infer = opt('--infer') ? opt('--infer').toLowerCase() : null;
  if (infer && !['p1', 'p2', 'both'].includes(infer)) throw new Error('--infer takes p1, p2 or both');

  let files;
  if (flag('--all')) {
    files = listLogFiles(ROOT).filter(f => !path.basename(f).startsWith('reconstructed-'));
  } else {
    const from = opt('--from');
    files = [from ? path.resolve(ROOT, from) : newestLogFile(ROOT)];
  }
  if (!files.length || !files[0]) throw new Error('no source found - pass --from <file>');

  // A saved replay is always S4 whatever `--rung` said - the rung only chooses
  // how much of a recording to withhold, and a replay withholds everything by
  // being what it is. Naming it here keeps the header from claiming otherwise.
  const heading = files.every(f => f.toLowerCase().endsWith('.html')) ? 's4' : rung;
  say(`reconstruct: rung ${heading}${infer ? `, Stat Points of ${infer === 'both' ? 'both sides' : infer} inferred` : ''}` +
    `${infer && flag('--all-spent') ? ', every point assumed spent' : ''}, ` +
    `${files.length} source${files.length === 1 ? '' : 's'}, sample seed ${sampleSeed}`);

  const results = [];
  for (const file of files) {
    try {
      results.push(await runOne({
        file, rung, teamsKey, sampleSeed, maxProbes, threads,
        write: write && !flag('--all'),
        outDir,
        infer,
        allSpent: flag('--all-spent'),
        showEvents: !flag('--all'),
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
