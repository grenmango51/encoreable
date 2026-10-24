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
 *   s4  a saved replay: .html, or a replay link's .json      -> everything
 *
 * `--infer p1|p2|both` withholds one more thing: that side's Stat Points. They
 * are inferred from the replay (docs/engineering.md 7.5) instead of read from a
 * fixture - `p2` is "I know my team, not theirs", `both` knows neither. On a
 * recording the real spreads stay available as the check; on a replay, the
 * fixture named by `--teams` is the check when it has that side.
 *
 * `--certify` then rebuilds the replay once per end of each inferred range,
 * with a spread at that end: a rebuild that reproduces the log proves the end
 * possible, and the range prints `?` beside an end it could not prove.
 * `--outside` with it also rebuilds one Stat Point beyond each end, which no
 * rebuild should reproduce: one that does is a spread removed wrongly.
 *
 * A game of a best-of set is written with the set it belongs to (`bestOf`).
 * `--with <file>`, once per other game, names a `.log.json` this command wrote
 * for another game of the same set: both games are one team, so what both
 * leave is printed after what this one leaves (`combineGames`). The file
 * written keeps this game's own.
 *
 * Usage:
 *   node scripts/local-reconstruct.mjs --rung s1
 *   node scripts/local-reconstruct.mjs --rung s3 --from recordings/local/scripted/<x>.log.json
 *   node scripts/local-reconstruct.mjs --rung s1 --all
 *   node scripts/local-reconstruct.mjs --from "recordings/showdown/full-sheets/<replay>.html" --teams alt
 *   node scripts/local-reconstruct.mjs --from "recordings/showdown/full-sheets/<replay>.html" --infer p2
 *   node scripts/local-reconstruct.mjs --from "recordings/showdown/mine-open/<replay id>.json" --teams <yours> --infer p1
 *   node scripts/local-reconstruct.mjs --from "<game 2>.html" --infer p2 --with "<game 1>.log.json"
 *   node scripts/local-reconstruct.mjs --rung s3 --all --infer p2
 *   node scripts/local-reconstruct.mjs --saved
 *   node scripts/local-reconstruct.mjs --rung s3 --all --infer p2 --sheets closed
 *   node scripts/local-reconstruct.mjs --saved --sheets closed
 *
 * `--saved` is the scoreboard over your own saved games: every replay in
 * recordings/showdown/mine-open/ and mine-closed/ whose one side is a team in
 * scripts/fixtures/teams.js, rebuilt with that side known and the other side
 * inferred, and one line per game - MATCH or how far it got, and how long.
 *
 * `--sheets closed` reads every source as if the inferred side published no
 * team sheet: its sets come off the log (`setsFromLog`), every box - item,
 * ability, nature, each move - is reported as read or assumed against the truth
 * where one is known, and a run of several sources ends with every one whose
 * real spread those assumptions removed. An assumed ability the rebuild shows
 * announcing itself where the replay does not is ruled out, and the side is
 * inferred again under the next.
 *
 * Every source prints what its rebuild spent: rounds, rebuilds, probes and
 * backtracks (`inferSpreads`' `work`), and how many turns the evidence proved
 * failed again on their own dice (its `warnings`), each named when there is
 * one source. `--counts <file>` holds those numbers between runs: each
 * source's differences against the counts the file has are printed as signed
 * numbers, with their totals, and this run's counts replace them.
 *
 * Flags: --from <file> --rung s1|s2|s3 --all --saved --sheets open|closed --teams <fixture> --infer p1|p2|both
 *        --all-spent --certify --outside --with <file> --sample <n> --max-probes <n> --threads <n> --out <file>
 *        --counts <file> --dry-run --verbose
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

import { battleLines } from './lib/protocol.mjs';
import { listLogFiles, newestLogFile, posix as toPosix } from './lib/recordings.mjs';
import { certifyRanges, combineGames, inferSpreads, inferenceRecord } from './lib/inference/infer.mjs';
import { containsSpread, unpackKnowledge } from './lib/inference/knowledge.mjs';
import { reconstruct, splitTurns, tagsOf, unpackTeams } from './lib/reconstruct.mjs';
import {
  alignSpeciesToSheet, bestOfFromLog, crossCheckLog, crossCheckSheet, loadSource, maxHpFromLog, sameSpecies, setsFromLog, setsFromSheet,
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

// ------------------------------------------------------- sets read off a log

const isNeutral = (dex, nature) => !nature || !dex.natures.get(nature).plus;

/**
 * One line per box of every Pokemon whose set was read off the log - item,
 * ability, nature and each move - saying whether the log named it or it was
 * assumed, and, where the truth is known (a recording's real sets, a fixture, a
 * published sheet), whether it is right. `wrong` lists every assumption or
 * reading the truth contradicts.
 */
function setReport(read, truth, formatid, side) {
  const dex = Dex.forFormat(formatid);
  const lines = [];
  const wrong = [];
  const row = (head, box, how, what, against) => lines.push(`     ${head.padEnd(14)} ${box.padEnd(8)} ${how.padEnd(9)}${what.padEnd(22)} ${against}`);
  for (const [j, set] of read.sets.entries()) {
    const real = truth?.find(t => sameSpecies(t.species || t.name, set.species)) || null;
    const boxes = read.boxes[j];
    const head = [set.name, ''];
    let first = true;
    const name = () => { const h = first ? head[0] : head[1]; first = false; return h; };
    const verdict = (box, mine, theirs, same) => {
      if (!real) return '';
      if (same) return `truth ${theirs || 'none'}`;
      wrong.push({ side, pokemon: set.name, species: set.species, box, how: boxes[box] || 'read', mine, truth: theirs || 'none' });
      return `truth ${theirs || 'none'}  WRONG`;
    };
    row(name(), 'item', boxes.item, set.item || 'none',
      verdict('item', set.item || 'none', real?.item && dex.items.get(real.item).name, toID(set.item) === toID(real?.item)));
    const ruled = boxes.ruledOut?.length ? `  (${boxes.ruledOut.map(r => `${r.ability} ruled out${r.why ? `: ${r.why}` : ''}`).join('; ')})` : '';
    row(name(), 'ability', boxes.ability === 'only' ? 'only one' : boxes.ability, set.ability,
      `${verdict('ability', set.ability, real?.ability && dex.abilities.get(real.ability).name, toID(set.ability) === toID(real?.ability))}${ruled}`);
    const natureOf = n => (isNeutral(dex, n) ? 'neutral' : dex.natures.get(n).name);
    row(name(), 'nature', boxes.nature, natureOf(set.nature),
      verdict('nature', natureOf(set.nature), real ? natureOf(real.nature) : null, !real || natureOf(set.nature) === natureOf(real.nature)));
    const realMoves = (real?.moves || []).map(m => dex.moves.get(m).name);
    for (const move of set.moves) {
      if (move === boxes.standIn) {
        row(name(), 'move', 'assumed', move, 'it never used a move; this one stands in for the choices it made');
        continue;
      }
      const has = realMoves.some(m => toID(m) === toID(move));
      row(name(), 'move', 'read', move, real ? (has ? 'truth has it' : verdict('move', move, realMoves.join(', '), false)) : '');
    }
    const unseen = realMoves.filter(m => !set.moves.some(s => s !== boxes.standIn && toID(s) === toID(m)));
    if (real && unseen.length) row(name(), 'move', 'unseen', '', `truth ${unseen.join(', ')}`);
  }
  return { lines, wrong };
}


/**
 * An assumed ability the rebuild shows announcing itself on switch-in where the
 * replay does not: the first line the rebuild gets wrong names that ability on
 * a Pokemon whose set was read off the log, the ability has a switch-in
 * handler in the simulator (`onStart` or `onSwitchIn`), and nothing in the
 * replay's turn could have made it stay silent - Pressure, Intimidate, Unnerve
 * and Mold Breaker always print; a weather or terrain setter prints unless that
 * weather or terrain is already up, so it is ruled out only when the replay's
 * turn never starts it. Everything before that line matched, so the Pokemon
 * had switched in exactly as the replay shows. Null when the line is anything
 * else.
 */
function announcedAbility(diff, reads, observed, formatid) {
  const line = String(diff?.actual || '');
  if (!line.startsWith('|')) return null;
  const dex = Dex.forFormat(formatid);
  const p = line.split('|');
  const tags = tagsOf(line);
  let who = null;
  let ability = null;
  let field = null;
  if (p[1] === '-ability' && !tags.from) { who = p[2]; ability = p[3]; }
  else if (/^ability: /.test(tags.from || '') && ['-weather', '-fieldstart', '-item'].includes(p[1])) {
    who = tags.of;
    ability = tags.from.slice(9);
    if (p[1] !== '-item') field = `|${p[1]}|${p[2]}`;
  }
  const m = /^(p[12])[a-d]?: (.+)$/.exec(String(who || ''));
  if (!m || !ability) return null;
  const i = Number(m[1][1]) - 1;
  const read = reads[i];
  const j = read ? read.sets.findIndex(s => s.name === m[2]) : -1;
  if (j < 0 || read.boxes[j].ability !== 'assumed' || toID(read.sets[j].ability) !== toID(ability)) return null;
  const handler = dex.abilities.get(ability);
  if (!handler.onStart && !handler.onSwitchIn) return null;
  const turn = splitTurns(observed.filter(l => typeof l === 'string'))[diff.turn] || [];
  if (turn.includes(line)) return null;
  if (field && turn.some(l => l.startsWith(`${field}|`) && !l.includes('[upkeep]'))) return null;
  return {
    side: i,
    name: m[2],
    ability: handler.name,
    why: `the rebuild announces it on turn ${diff.turn} (${line}) and the replay does not`,
  };
}

// -------------------------------------------------------------- one run

async function runOne({
  file, rung: requestedRung, teamsKey, teamSet, sampleSeed, maxProbes, threads, write, outDir, infer, allSpent, showEvents, certify, outside,
  closed = false, withFiles = [],
}) {
  let rung = requestedRung;
  const source = loadSource(file);
  const label = path.basename(file);
  const inferred = infer === 'both' ? ['p1', 'p2'] : infer ? [infer] : [];
  const supplied = i => !inferred.includes(`p${i + 1}`);
  // With closed sheets an inferred side's published sheet is withheld like its
  // Stat Points: its sets are read off the log, and the sheet is only the truth.
  const publishedSheets = source.sheets || [null, null];
  source.sheets = publishedSheets.map((sheet, i) => (closed && !supplied(i) ? null : sheet));
  const bestOf = source.kind === 'replay' ? bestOfFromLog(source.lines, source.replayId) : null;

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
    const set = teamSet || TEAM_SETS[teamsKey];
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

  // Identify the actual inputs, while allowing solver edits and thread counts
  // to be compared. Capture the teams before inference replaces their spreads.
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const countsConfig = {
    rung, format: source.formatid, channel, infer, closed, allSpent, sampleSeed, maxProbes,
    seed, seedPlan, source: hash(fs.readFileSync(file)),
    teams: hash(JSON.stringify(packedTeams)),
    simulator: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies['pokemon-showdown'],
    node: process.versions.node,
  };

  const started = Date.now();
  let built;
  let inference = null;
  const inferenceWork = {};
  const inferenceWarnings = [];
  let inferSets = null;
  let certified = null;
  let truthSets = [null, null];
  const readOffLog = [false, false];
  const setReports = [];
  if (inferred.length) {
    // What the inferred side's sheet publishes, and nothing else. Its real
    // spreads - a recording's own, or the fixture's - are kept only as the check.
    // A side with no sheet - a replay that published none, or any source read
    // with closed sheets - says only what the battle showed: its sets are read
    // off the log, and everything else is an assumption, named and held against
    // the truth where one is known.
    truthSets = [0, 1].map(i => (!supplied(i) && packedTeams[i] ? Teams.unpack(packedTeams[i]) : null));
    // An assumed ability the rebuild shows announcing itself where the replay
    // shows nothing is ruled out, and the side is read again without it.
    const ruledOut = [{}, {}];
    const reads = [null, null];
    const readSets = () => [0, 1].map((i) => {
      readOffLog[i] = !supplied(i) && (closed || (source.kind === 'replay' && !source.sheets?.[i]));
      if (supplied(i)) return Teams.unpack(packedTeams[i]);
      if (readOffLog[i]) {
        reads[i] = setsFromLog(observed, `p${i + 1}`, source.formatid, { ruledOut: ruledOut[i], standIn: true });
        return reads[i].sets;
      }
      if (source.kind === 'replay' && source.sheets?.[i]) {
        return withLogIdentity(setsFromSheet(source.sheets[i]), observed, `p${i + 1}`, source.formatid);
      }
      return Teams.unpack(packedTeams[i]).map(s => ({ ...s, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }));
    });
    let sets;
    for (;;) {
      sets = readSets();
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
      // Rejecting an assumed ability starts another inference of this source;
      // its earlier search still cost work, even though its answer is discarded.
      for (const [key, count] of Object.entries(inference.work)) inferenceWork[key] = (inferenceWork[key] || 0) + count;
      inferenceWarnings.push(...inference.warnings);
      const out = !inference.built.report.complete && announcedAbility(inference.built.report.diffs[0], reads, observed, source.formatid);
      const already = ruledOut[out?.side]?.[out?.name] || [];
      if (!out || already.some(r => r.ability === out.ability)) break;
      ruledOut[out.side][out.name] = [...already, { ability: out.ability, why: out.why }];
      chatty(`${out.name}: ${out.ability} ruled out - ${out.why}; inferring again`);
    }
    for (const i of [0, 1]) {
      if (!reads[i]) continue;
      say(`  p${i + 1}'s sets are read off the log${closed ? ', its team sheet withheld' : ' - it published no team sheet'}:`);
      const report = setReport(reads[i], truthSets[i] || publishedSheets[i], source.formatid, `p${i + 1}`);
      for (const line of report.lines) say(line);
      setReports.push(report);
    }
    inferSets = sets;
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
  const work = inference ? { ...inferenceWork, warnings: inferenceWarnings.length }
    : { rebuilds: 1, probes: built.cost.probes, backtracks: built.cost.backtracks, dieBacktracks: built.cost.dieBacktracks };
  say(`     work: ${COUNTS.filter(([k]) => k in work).map(([k, name]) => `${name} ${work[k]}`).join(', ')}`);
  // A proved turn that failed again under its own dice and choices: the
  // evidence's guess does not fit its own proof. A whole suite prints only how
  // many, above.
  if (inference && showEvents) {
    for (const w of inferenceWarnings) {
      say(`     warning: round ${w.round}, turn ${w.turn} was proved and fails again on its own dice - observed ${w.expected ?? '(nothing)'}, ` +
          `rebuilt ${w.actual ?? '(nothing)'}${w.pokemon.length ? ` (${w.pokemon.join(', ')})` : ''}`);
    }
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
  let spreadTruth = false;
  const removed = [];
  if (inference && certify) {
    certified = await certifyRanges(inference, {
      formatid: source.formatid, sets: inferSets, playerNames: source.players, observed, channel, sampleSeed, threads, outside, onProgress: chatty,
    });
  }
  if (inference) {
    say(`     Stat Points of ${inferred.join(' and ')} inferred in ${inference.rounds} round(s), ` +
        `${inference.events.length} events narrowed them`);
    for (const p of inference.pokemon) {
      if (p.known || !p.seen) continue;
      const side = Number(p.side[1]) - 1;
      const real = truthSets[side]?.find(s => toID(s.species || s.name).startsWith(toID(p.species))
        || toID(p.species).startsWith(toID(s.species || s.name)));
      const kept = real ? p.contains(real.evs) : null;
      if (real) spreadTruth = true;
      if (kept === false) { truthKept = false; removed.push(`${p.side} ${p.species}`); }
      const wrong = Object.entries(certified?.[p.id] || {}).filter(([, c]) => c.outside?.length);
      if (wrong.length) truthKept = false;
      // With --certify, an end no rebuild proved carries a `?`.
      const mark = (s, end) => (certified?.[p.id]?.[s] && !certified[p.id][s][end] ? '?' : '');
      const ranges = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
        .map(s => (p.stats[s] ? `${s} ${p.stats[s].min}${mark(s, 'min')}-${p.stats[s].max}${mark(s, 'max')}` : `${s} -`)).join('  ');
      say(`       ${p.side} ${p.species.padEnd(14)} ${p.spreads.toLocaleString('en')} of ${p.from.toLocaleString('en')} left  ${ranges}` +
          `${kept === null ? '' : kept ? '  (real spread survives)' : '  REAL SPREAD ELIMINATED'}`);
      for (const [s, c] of wrong) say(`         a spread with ${s} ${c.outside.join(' or ')}, outside the range, rebuilds the log: a possible spread was removed`);
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

  // The other games of its best-of set: one team, so what every game leaves.
  if (inference && withFiles.length) {
    const others = withFiles.map(f => ({ recording: toPosix(ROOT, f), ...JSON.parse(fs.readFileSync(f, 'utf8')) }));
    const game = {
      recording: label, bestOf, complete: r.complete, p1: source.players[0], p2: source.players[1], format: source.formatid,
      inference: inferenceRecord(inference, inferred),
    };
    const set = combineGames(game, others);
    for (const o of others) {
      if (!bestOf || o.bestOf?.set !== bestOf.set) say(`     ${o.recording}: not combined - ${bestOf ? 'it is not a game of this set' : 'this replay names no best-of set'}`);
    }
    for (const s of set.skipped) say(`     game ${s.game} (${s.recording}): not combined - ${s.reason}`);
    if (set.combined.length) {
      say(`     game ${bestOf.game} of this best-of-${bestOf.of} with ${set.combined.map(g => `game ${g.game} (${g.recording})`).join(' and ')}:`);
      for (const p of set.inference.pokemon) {
        if (!p.seen) continue;
        const side = Number(p.side[1]) - 1;
        const real = truthSets[side]?.find(s => toID(s.species || s.name).startsWith(toID(p.species))
          || toID(p.species).startsWith(toID(s.species || s.name)));
        const kept = real ? containsSpread(unpackKnowledge(p.knowledge), real.evs) : null;
        if (kept === false) truthKept = false;
        const ranges = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
          .map(s => (p.stats[s] ? `${s} ${p.stats[s].min}-${p.stats[s].max}` : `${s} -`)).join('  ');
        say(`       ${p.side} ${p.species.padEnd(14)} ${p.spreads.toLocaleString('en')} of ${p.from.toLocaleString('en')} left  ${ranges}` +
            `${kept === null ? '' : kept ? '  (real spread survives)' : '  REAL SPREAD ELIMINATED'}`);
      }
    }
  }

  let outFile = null;
  if (write) {
    const base = path.basename(file).replace(/\.log\.json$|\.html$|\.json$/i, '');
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
      bestOf: bestOf || undefined,
      p1team: unpackTeams(packedTeams)[0],
      p2team: unpackTeams(packedTeams)[1],
      inference: inference ? inferenceRecord(inference, inferred, certified) : undefined,
      inputLog: built.inputLog,
      log: built.log,
      format: source.formatid,
      timestamp: new Date().toISOString(),
    }, null, 2)}\n`);
    say(`     wrote ${toPosix(ROOT, outFile)}`);
  }

  return {
    file, label, rung, ok: r.complete && selfConsistent && truthKept, report: r, accuracy, selfConsistent, outFile, seconds,
    removed, spreadTruth, setWrong: setReports.flatMap(x => x.wrong), readOffLog: readOffLog.some(Boolean), work, countsConfig,
  };
}

// ---------------------------------------------------------------- work counts

/**
 * What a source's rebuild spent, in the order a line names them
 * (`inferSpreads`' `work`), and how many proved turns failed again (its
 * `warnings`).
 */
const COUNTS = [
  ['rounds', 'rounds'], ['rebuilds', 'rebuilds'], ['fallback', 'fallback rebuilds'], ['probes', 'probes'],
  ['backtracks', 'backtracks'], ['dieBacktracks', 'die backtracks'], ['warnings', 'warnings'],
];

/**
 * Each source's work against the counts an earlier run wrote to `file`, as
 * signed differences and their totals, and then this run's counts written
 * there in their place. Nothing is judged: a gain in precision can rightly
 * cost more rounds, so the numbers are only shown.
 */
function compareCounts(file, results) {
  const now = {};
  for (const r of results) if (r.work) now[toPosix(ROOT, r.file)] = { label: r.label, config: r.countsConfig, work: r.work };
  if (fs.existsSync(file)) {
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    const legacy = snapshot.schema === undefined;
    if (!legacy && (snapshot.schema !== 2 || !snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries))) {
      throw new Error(`invalid --counts snapshot in ${file}`);
    }
    const was = legacy ? snapshot : snapshot.entries;
    const signed = n => (n > 0 ? `+${n}` : String(n));
    const total = Object.fromEntries(COUNTS.map(([k]) => [k, 0]));
    const available = Object.fromEntries(COUNTS.map(([k]) => [k, 0]));
    let compared = 0;
    say('');
    say(`work against ${file}:`);
    for (const key of [...new Set([...Object.keys(now), ...Object.keys(was)])]) {
      const [a, b] = [was[key], now[key]];
      const label = (b || a).label || key;
      if (!a || !b) { say(`  ${label}: ${a ? 'no counts this run' : 'not in the earlier run'}`); continue; }
      if (legacy || !a.config || !b.config) {
        say(`  ${label}: comparison unavailable (earlier configuration not recorded); starting a new baseline`);
        continue;
      }
      const changed = [...new Set([...Object.keys(a.config), ...Object.keys(b.config)])]
        .filter(k => JSON.stringify(a.config[k]) !== JSON.stringify(b.config[k]));
      if (changed.length) {
        say(`  ${label}: incompatible configuration (${changed.join(', ')} changed); starting a new baseline`);
        continue;
      }
      compared++;
      const moved = COUNTS.filter(([k]) => k in a.work || k in b.work).map(([k, name]) => {
        if (![a.work[k], b.work[k]].every(v => Number.isSafeInteger(v) && v >= 0)) return `${name} unavailable`;
        const d = b.work[k] - a.work[k];
        total[k] += d;
        available[k]++;
        return `${name} ${signed(d)}`;
      });
      say(`  ${label}: ${moved.join(', ')}`);
    }
    say(`  total (${compared} comparable sources): ${COUNTS.map(([k, name]) => `${name} ${available[k] ? signed(total[k]) : 'unavailable'}`).join(', ')}`);
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema: 2, entries: now }, null, 1)}\n`);
  say(`wrote this run's counts to ${file}`);
}

// ---------------------------------------------------------------- scoreboard

const SAVED_FOLDERS = ['mine-open', 'mine-closed'];

/**
 * Every saved game of yours that a fixture team can be put to: the replay, the
 * fixture team whose six species are one side's six at team preview, and the
 * other side, which is the one inferred. A game no fixture team matches is
 * listed as skipped, not run.
 */
function savedJobs() {
  const jobs = [];
  const skipped = [];
  for (const folder of SAVED_FOLDERS) {
    const dir = path.join(ROOT, 'recordings', 'showdown', folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!/\.html$/i.test(name) && !(/\.json$/i.test(name) && !/\.log\.json$/i.test(name))) continue;
      const file = path.join(dir, name);
      const lines = loadSource(file).lines;
      const previewed = ['p1', 'p2'].map(side => lines
        .filter(l => l.startsWith(`|poke|${side}|`))
        .map(l => l.split('|')[3].split(',')[0]));
      const found = [];
      for (const [key, set] of Object.entries(TEAM_SETS)) {
        for (const text of [set.p1, set.p2].filter(Boolean)) {
          const team = Teams.import(text);
          for (const i of [0, 1]) {
            if (previewed[i].length && team.every(s => previewed[i].some(sp => sameSpecies(sp, s.species || s.name)))) {
              found.push({ key, text, side: i });
            }
          }
        }
      }
      const sides = new Set(found.map(m => m.side));
      if (sides.size !== 1) {
        skipped.push({ label: `${folder}/${name}`, why: found.length ? 'a fixture team matches both sides' : 'no team in teams.js matches either side' });
        continue;
      }
      const mine = found[0];
      jobs.push({ file, label: `${folder}/${name}`, teamsKey: mine.key, teamSet: { p1: mine.text }, infer: `p${2 - mine.side}` });
    }
  }
  return { jobs, skipped };
}

/**
 * What closed sheets cost across a run: every source whose real spread the sets
 * read off the log removed, with the boxes the truth contradicts, and the
 * sources that rebuilt only part of the way under them.
 */
function closedSummary(results) {
  const read = results.filter(r => r.readOffLog);
  const removed = read.filter(r => r.removed?.length);
  const describe = w => `${w.pokemon} ${w.box} ${w.how} ${w.mine}, truth ${w.truth}`;
  say('');
  say(`closed sheets: ${read.length} source${read.length === 1 ? '' : 's'} read off the log, ` +
      `${read.filter(r => r.setWrong.length).length} with a box the truth contradicts`);
  // A replay knows no real spread for the side it infers, so only a source with
  // one - a recording, a fixture of that side - can show a spread removed.
  const checked = read.filter(r => r.spreadTruth).length;
  say(`real spread removed under the sets read off the log: ${removed.length} ` +
      `of ${checked} source${checked === 1 ? '' : 's'} with a real spread to check it against`);
  for (const r of removed) {
    say(`  ${r.label}: ${r.removed.join(', ')}`);
    const blamed = r.setWrong.filter(w => r.removed.some(x => x.startsWith(`${w.side} `) && sameSpecies(x.slice(3), w.species)));
    for (const w of blamed) say(`      ${describe(w)}`);
  }
  const stopped = read.filter(r => r.report && !r.report.complete);
  say(`rebuilt only part of the way under them: ${stopped.length}`);
  for (const r of stopped) say(`  ${r.label}: verified through turn ${r.report.verifiedThroughTurn}/${r.report.turns}`);
  const failed = read.length ? results.filter(r => r.error) : [];
  for (const r of failed) say(`  ${r.label}: ERROR ${r.error}`);
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
  const sheets = (opt('--sheets', 'open') || 'open').toLowerCase();
  if (!['open', 'closed'].includes(sheets)) throw new Error('--sheets takes open or closed');
  const closed = sheets === 'closed';
  if (closed && !infer && !flag('--saved')) throw new Error('--sheets closed reads the inferred side off the log - pass --infer');
  const withFiles = argv.flatMap((a, i) => (a === '--with' && argv[i + 1] ? [path.resolve(ROOT, argv[i + 1])] : []));
  if (withFiles.length && !infer) throw new Error('--with combines inferred Stat Points, so it needs --infer');

  const saved = flag('--saved') ? savedJobs() : null;
  let files;
  if (saved) {
    files = saved.jobs.map(j => j.file);
  } else if (flag('--all')) {
    files = listLogFiles(ROOT).filter(f => !path.basename(f).startsWith('reconstructed-'));
  } else {
    const from = opt('--from');
    files = [from ? path.resolve(ROOT, from) : newestLogFile(ROOT)];
  }
  if (!files.length || !files[0]) throw new Error('no source found - pass --from <file>');
  const many = files.length > 1 || !!saved;

  // A saved replay is always S4 whatever `--rung` said - the rung only chooses
  // how much of a recording to withhold, and a replay withholds everything by
  // being what it is. Naming it here keeps the header from claiming otherwise.
  const heading = files.every(f => /\.html$/i.test(f) || (/\.json$/i.test(f) && !/\.log\.json$/i.test(f))) ? 's4' : rung;
  const inferredHeading = saved ? ', your side known and the other side\'s Stat Points inferred' :
    infer ? `, Stat Points of ${infer === 'both' ? 'both sides' : infer} inferred` : '';
  say(`reconstruct: rung ${heading}${inferredHeading}` +
    `${(infer || saved) && flag('--all-spent') ? ', every point assumed spent' : ''}` +
    `${closed ? ', the inferred side read off the log as if it published no team sheet' : ''}, ` +
    `${files.length} source${files.length === 1 ? '' : 's'}, sample seed ${sampleSeed}`);

  const results = [];
  for (const [n, file] of files.entries()) {
    const job = saved?.jobs[n];
    if (job) say(`## ${job.label}  (${job.teamsKey} is p${job.infer === 'p1' ? 2 : 1}, ${job.infer} inferred)`);
    try {
      results.push(await runOne({
        file, rung, teamsKey: job?.teamsKey || teamsKey, teamSet: job?.teamSet, sampleSeed, maxProbes, threads,
        write: write && !many,
        outDir,
        infer: job?.infer || infer,
        allSpent: flag('--all-spent'),
        showEvents: !many,
        certify: !!(job?.infer || infer) && flag('--certify'),
        outside: flag('--outside'),
        closed,
        withFiles,
      }));
    } catch (err) {
      say(`  ${path.basename(file)}: ERROR ${err.message}`);
      if (VERBOSE) console.error(err);
      results.push({ file, label: path.basename(file), rung, ok: false, error: err.message });
    }
    if (job) results[results.length - 1].label = job.label;
  }

  if (saved) {
    say('');
    say(`scoreboard: ${results.filter(r => r.ok).length}/${results.length} of your saved games rebuilt line-for-line`);
    for (const r of results) {
      const verdict = r.error ? 'ERROR' : r.ok ? 'MATCH' : r.report?.complete ? 'FAIL' : `turn ${r.report?.verifiedThroughTurn}/${r.report?.turns}`;
      const sets = closed && r.readOffLog ? `  (${r.setWrong.length} box${r.setWrong.length === 1 ? '' : 'es'} wrong against the truth)` : '';
      say(`  ${verdict.padEnd(11)} ${r.seconds ? `${r.seconds}s`.padStart(7) : '      -'}  ${r.label}${r.error ? ` - ${r.error}` : ''}${sets}`);
    }
    for (const s of saved.skipped) say(`  skipped              ${s.label} - ${s.why}`);
    if (closed) closedSummary(results);
    if (results.some(r => !r.ok)) process.exitCode = 1;
  } else if (results.length > 1) {
    const passed = results.filter(r => r.ok).length;
    say('');
    say(`${passed}/${results.length} reconstructions matched line-for-line`);
    for (const r of results.filter(x => !x.ok)) {
      say(`  FAIL ${r.label}${r.error ? ` - ${r.error}` : ''}` +
          `${r.report ? ` - verified through turn ${r.report.verifiedThroughTurn}/${r.report.turns}` : ''}`);
    }
    if (closed) closedSummary(results);
    if (passed !== results.length) process.exitCode = 1;
  } else if (!results[0]?.ok) {
    process.exitCode = 1;
  }
  if (opt('--counts')) compareCounts(path.resolve(ROOT, opt('--counts')), results);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
