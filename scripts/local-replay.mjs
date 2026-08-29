/**
 * Omniscient replay harness.
 *
 * 1. Brings up the local Showdown server and client host if they are not running.
 * 2. Plays a scripted Champions Reg M-B doubles battle through the real server
 *    with two websocket clients.
 * 3. Reads the battle log the server writes on `end()`, which carries the
 *    inputLog (seed + both packed teams + every choice).
 * 4. Re-simulates that inputLog in a fresh headless battle and takes
 *    `battle.getDebugLog()` - the channel -1 log, exact HP for both sides.
 * 5. Writes a replay page from the re-simulated log and reports what was
 *    recovered.
 *
 * Usage:
 *   node scripts/local-replay.mjs                 play a battle, then replay it
 *   node scripts/local-replay.mjs --from <file>   rebuild from an existing log.json
 *   node scripts/local-replay.mjs --no-open       do not launch a browser
 *   node scripts/local-replay.mjs --verbose       print every choice made
 *   node scripts/local-replay.mjs --fight         p2 attacks instead of exploding
 *   node scripts/local-replay.mjs --embed <url>   serve the replay player from <url>
 *
 * With --force, the same recording is replayed twice from a chosen turn - once
 * plain and once with the RNG controller armed - and the two are compared. Both
 * runs carry the same fresh `>reseed`, so every difference between them is a
 * forced draw and nothing else:
 *
 *   node scripts/local-replay.mjs --from <file> --force "crit Glalie" --at 3
 *   node scripts/local-replay.mjs --from <file> --force "miss any" --force "maxdmg any"
 *   node scripts/local-replay.mjs --from <file> --force "crit Glalie icespinner p2:Gholdengo"
 *
 * The continuation seed is fresh on every run unless --seed is given, so pass
 * one when you want the same comparison twice.
 *
 * The rules are armed *before* the reseed on purpose. `>reseed` replaces the
 * generator object, so a run that forces nothing is how a broken accessor
 * announces itself (ENGINEERING.md 4.2).
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';

import { WsPlayer, makePolicy } from './lib/ws-player.mjs';
import { listLogFilesIn, archiveLogFile, posix } from './lib/recordings.mjs';
import { buildReplayHtml } from './lib/replay-html.mjs';
import { battleLines, firstDivergence } from './lib/protocol.mjs';
import { buildControlled, replayControlled, verdict } from './lib/rng-control.mjs';

const require = createRequire(import.meta.url);
const { Teams, BattleStream, Dex } = require('pokemon-showdown');
const { P1_EXPORT, P2_EXPORT } = require('./fixtures/teams.js');

const ROOT = process.cwd();
const RUNTIME_LOGS = path.join(ROOT, 'runtime', 'logs');
const REPLAY_DIR = path.join(ROOT, 'replays');
const FORMAT = 'gen9championsvgc2026regmb';

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
/** Every value of a repeatable option, in the order they were given. */
const opts = name => argv.reduce((acc, a, i) => (a === name && argv[i + 1] ? acc.concat(argv[i + 1]) : acc), []);

const VERBOSE = flag('--verbose');

// ---------------------------------------------------------------- server setup

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, () => resolve(true)).on('error', () => resolve(false));
    req.setTimeout(400, () => { req.destroy(); resolve(false); });
  });
}

async function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function ensureServers() {
  if (await isPortOpen(8000) && await isPortOpen(8080)) {
    console.log('Local servers already up on 8000 & 8080.');
    return;
  }
  console.log('Starting local Showdown server and client host...');
  spawn(process.execPath, ['scripts/local-serve.mjs'], { cwd: ROOT, stdio: 'ignore', detached: true }).unref();
  if (!await waitForPort(8000) || !await waitForPort(8080)) {
    throw new Error('servers did not come up on 8000/8080');
  }
  console.log('Servers up.');
}

// ------------------------------------------------------------- fixture battle

async function playFixtureBattle() {
  const uid = Math.floor(1000 + Math.random() * 9000);
  const p1 = new WsPlayer({
    name: `Ghosts${uid}`,
    team: Teams.pack(Teams.import(P1_EXPORT)),
    format: FORMAT,
    // Attack rather than set up, so both sides take damage and the log carries
    // exact HP numbers for p1 as well as p2.
    policy: makePolicy([
      'shadowball', 'matchagotcha', 'throatchop', 'weatherball',
      'dragonpulse', 'electroshot', 'flashcannon',
    ]),
    verbose: VERBOSE,
  });
  const p2 = new WsPlayer({
    name: `Boom${uid}`,
    team: Teams.pack(Teams.import(P2_EXPORT)),
    format: FORMAT,
    // Default is the fast fixture: everything on p2 removes itself turn one.
    // --fight trades speed for a longer battle that actually deals damage.
    policy: makePolicy(flag('--fight')
      ? ['makeitrain', 'meteormash', 'icespinner', 'moonblast', 'shadowball', 'psychicfangs']
      : ['explosion', 'selfdestruct', 'mistyexplosion', 'memento', 'healingwish', 'lunardance']),
    verbose: VERBOSE,
  });

  await Promise.all([p1.connect(), p2.connect()]);
  await Promise.all([p1.waitNamed(), p2.waitNamed()]);

  p1.useTeam();
  p2.useTeam();
  await new Promise(r => setTimeout(r, 300));

  const incoming = p2.waitChallengeFrom();
  p1.challenge(p2.name);
  const from = await incoming;
  p2.accept(from);

  await Promise.all([p1.waitBattle(), p2.waitBattle()]);
  console.log(`Battle room: ${p1.battleRoom}`);

  const winner = await Promise.race([p1.waitFinished(), p2.waitFinished()]);
  console.log(`Battle finished. Winner: ${winner ?? 'tie'}`);

  // give the server a moment to run end() -> logBattle() -> disk
  await new Promise(r => setTimeout(r, 1500));
  p1.close();
  p2.close();

  const rejected = [...p1._errors, ...p2._errors];
  if (rejected.length) {
    console.log(`\nWARNING: ${rejected.length} choice(s) were rejected and skipped:`);
    for (const e of new Set(rejected)) console.log(`  ${e}`);
  }
  return { winner, roomid: p1.battleRoom, rejected };
}

// ------------------------------------------------------------------ log files

const findLogFiles = () => listLogFilesIn(RUNTIME_LOGS);

async function waitForNewLog(since, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const newest = findLogFiles()[0];
    if (newest && fs.statSync(newest).mtimeMs > since) return newest;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

// -------------------------------------------------------------- re-simulation

async function resimulate(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) void chunk; })();
  await stream.write(inputLog);
  const battle = stream.battle;
  if (!battle) throw new Error('re-simulation produced no battle');
  const result = {
    debugLog: battle.getDebugLog(),
    inputLog: battle.inputLog.join('\n'),
    ended: battle.ended,
    turns: battle.turn,
    seed: battle.prngSeed,
  };
  await stream.writeEnd();
  await drain;
  return result;
}

// --------------------------------------------------------------------- report

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function unpackFromInputLog(inputLog) {
  const sides = {};
  for (const line of inputLog.split('\n')) {
    const m = /^>player (p\d) (.*)$/.exec(line);
    if (!m) continue;
    const options = JSON.parse(m[2]);
    sides[m[1]] = { name: options.name, sets: Teams.unpack(options.team) };
  }
  return sides;
}

function seedFromInputLog(inputLog) {
  const m = /^>start (.*)$/m.exec(inputLog);
  if (!m) return null;
  return JSON.parse(m[1]).seed ?? null;
}

function spTotal(set) {
  return STATS.reduce((a, k) => a + (set.evs?.[k] ?? 0), 0);
}

function describeSet(set) {
  const sp = STATS.map(k => `${k} ${set.evs?.[k] ?? 0}`).join(' / ');
  const ivs = STATS.map(k => (set.ivs?.[k] ?? 31)).join('/');
  return [
    `    ${set.species || set.name}  @ ${set.item || '(none)'}`,
    `      ability ${set.ability}   nature ${set.nature}   level ${set.level || 50}`,
    `      stat points  ${sp}   (total ${spTotal(set)})`,
    `      ivs ${ivs}`,
    `      moves ${set.moves.join(', ')}`,
  ].join('\n');
}

function exactHpEvidence(debugLog) {
  const seen = { p1: new Set(), p2: new Set() };
  const re = /\|(?:-damage|-heal|-sethp)\|(p[12])[a-c]: [^|]+\|(\d+)\/(\d+)/g;
  let m;
  while ((m = re.exec(debugLog))) {
    if (m[3] !== '100') seen[m[1]].add(`${m[2]}/${m[3]}`);
  }
  return seen;
}

/**
 * The decisive check. Champions computes HP as `baseStat + StatPoints + 75` at
 * level 50 (data/mods/champions/scripts.ts, statModify). If the stat points
 * recovered from the input log reproduce every max-HP integer the log reports -
 * for both sides - then the recovered spreads are the real ones, not a guess.
 */
function hpMatchesRecoveredStatPoints(debugLog, sides) {
  const dex = Dex.mod('champions');
  const rows = [];
  const re = /\|(?:switch|drag|replace)\|(p[12])[a-c]: [^|]+\|([^,|]+)[^|]*\|(\d+)\/(\d+)/g;
  let m;
  while ((m = re.exec(debugLog))) {
    const [, side, speciesName, , maxHp] = m;
    const species = dex.species.get(speciesName);
    const set = sides[side]?.sets.find(s => (
      dex.species.get(s.species || s.name).baseSpecies === species.baseSpecies
    ));
    if (!set || !species.exists) continue;
    const expected = species.baseStats.hp + (set.evs?.hp ?? 0) + 75;
    const observed = Number(maxHp);
    if (!rows.some(r => r.side === side && r.species === species.name)) {
      rows.push({ side, species: species.name, expected, observed, ok: expected === observed });
    }
  }
  return rows;
}

// ----------------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });

  let logFile = opt('--from');

  // The page is served from the client host so its branch button can reach
  // /branch, so the servers have to be up either way.
  await ensureServers();

  if (!logFile) {
    const before = Date.now();
    const { roomid } = await playFixtureBattle();
    logFile = await waitForNewLog(before);
    if (!logFile) {
      throw new Error(
        `no battle log appeared under runtime/logs after ${roomid}. Check that ` +
        `runtime/config/config.js has logchallenges = true, then restart the server with npm run stop.`
      );
    }
  }

  console.log(`\nBattle log: ${path.relative(ROOT, logFile)}`);
  const logData = JSON.parse(fs.readFileSync(logFile, 'utf8'));

  // runtime/ is generated and gets deleted to reset the server, so keep a copy
  // of the recording outside it.
  const archived = archiveLogFile(ROOT, logFile);
  if (archived !== logFile) console.log(`Archived to:  ${posix(ROOT, archived)}`);

  const inputLog = Array.isArray(logData.inputLog) ? logData.inputLog.join('\n') : String(logData.inputLog || '');
  if (!inputLog.trim()) throw new Error('battle log contains no inputLog');

  console.log('Re-simulating the input log in a fresh battle...');
  const sim = await resimulate(inputLog);

  const inputLogRoundTrips = sim.inputLog.trim() === inputLog.trim();
  const serverLines = battleLines(logData.log || []);
  const simLines = battleLines(sim.debugLog);
  const logDiff = firstDivergence(serverLines, simLines);

  const sides = unpackFromInputLog(inputLog);
  const seed = seedFromInputLog(inputLog);
  const hp = exactHpEvidence(sim.debugLog);
  const hpRows = hpMatchesRecoveredStatPoints(sim.debugLog, sides);

  const names = Object.values(sides).map(s => s.name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  console.log('\n================ RECOVERED FROM THE LOG ================\n');
  console.log(`  RNG seed:      ${seed}`);
  console.log(`  Turns:         ${sim.turns}`);
  console.log(`  Battle ended:  ${sim.ended}`);
  for (const [slot, side] of Object.entries(sides)) {
    console.log(`\n  ${slot} - ${side.name}  (${side.sets.length} Pokemon)`);
    for (const set of side.sets) console.log(describeSet(set));
  }

  console.log('\n================ CHECKS ================\n');
  const spOk = Object.values(sides).every(s => s.sets.every(set => spTotal(set) === 66));
  console.log(`  [${inputLogRoundTrips ? 'PASS' : 'FAIL'}] input log round-trips byte-identically through a fresh battle`);
  console.log(`  [${logDiff ? 'FAIL' : 'PASS'}] re-simulated protocol log matches the server's (${simLines.length} battle lines compared)`);
  if (logDiff) {
    console.log(`         first divergence at line ${logDiff.index}`);
    console.log(`         server: ${logDiff.expected}`);
    console.log(`         resim:  ${logDiff.actual}`);
  }
  console.log(`  [${spOk ? 'PASS' : 'FAIL'}] every recovered spread sums to the 66 stat-point budget`);

  const perSide = { p1: 0, p2: 0 };
  for (const [side, set] of Object.entries(hp)) perSide[side] = set.size;
  const exactHp = /\|(?:switch|drag|replace)\|p[12][a-c]: [^|]+\|[^|]*\|\d+\/(\d+)/g;
  let anyPercent = false;
  for (const m of sim.debugLog.matchAll(exactHp)) if (m[1] === '100') anyPercent = true;
  console.log(`  [${anyPercent ? 'FAIL' : 'PASS'}] no HP is reported as a percentage anywhere in the log`);
  console.log(`         (mid-battle HP changes seen: p1 ${perSide.p1}, p2 ${perSide.p2})`);

  const allOk = hpRows.length && hpRows.every(r => r.ok);
  console.log(`  [${allOk ? 'PASS' : 'FAIL'}] recovered stat points reproduce every max-HP integer in the log`);
  for (const r of hpRows) {
    console.log(`         ${r.ok ? 'ok  ' : 'BAD '} ${r.side} ${r.species.padEnd(14)} expected ${r.expected}  log says ${r.observed}`);
  }

  // --------------------------------------------------------- RNG control

  const forces = opts('--force');
  let page = { log: sim.debugLog, inputLog, tag: '' };

  if (forces.length) {
    const turn = Number(opt('--at') || 1);
    const built = await buildControlled(inputLog, turn, forces, {
      seed: opt('--seed'),
    });
    const base = await replayControlled(built.baseline);
    const ctrl = await replayControlled(built.controlled);
    const r = ctrl.rng;

    console.log('\n================ RNG CONTROL ================\n');
    console.log(`  Armed at turn ${built.turn}, both runs reseeded to ${built.seed}`);
    for (const a of built.arms) console.log(`    ${a.line}`);
    console.log(`\n  draws ${r.draws}   forced ${r.forced}   could not force ${r.skipped}`);
    console.log(`  baseline ${verdict(base)} through turn ${base.turns}   ` +
      `controlled ${verdict(ctrl)} through turn ${ctrl.turns}`);

    console.log(`\n  [${r.reseeds > 0 && r.drawsSinceReseed > 0 ? 'PASS' : 'FAIL'}] ` +
      `control survived the reseed (${r.reseeds} reseed(s), ${r.drawsSinceReseed} draws after the last one)`);
    console.log(`  [${r.forced > 0 ? 'PASS' : 'FAIL'}] at least one draw was actually substituted`);

    const back = await replayControlled(ctrl.inputLog + '\n');
    const same = back.inputLog === ctrl.inputLog;
    const rediff = firstDivergence(battleLines(ctrl.debugLog), battleLines(back.debugLog));
    console.log(`  [${same && !rediff ? 'PASS' : 'FAIL'}] the controlled battle replays byte-identically ` +
      `(re-forced ${back.rng ? back.rng.forced : 0} draws)`);

    if (r.notes.length) {
      console.log('\n  What the interceptor did:');
      for (const n of r.notes) console.log(`    ${n}`);
    }
    if (r.rules.length) {
      console.log('\n  Still armed at the end:');
      for (const a of r.rules) console.log(`    #${a.id} ${a.text}  matched ${a.matched}, forced ${a.forced}`);
    }

    // Forcing a crit inserts a line, which shifts every line after it - a
    // positional diff would call the whole rest of the battle changed. Compare
    // the two as multisets instead, so only genuinely new or missing lines show.
    const before = battleLines(base.debugLog);
    const after = battleLines(ctrl.debugLog);
    const missingFrom = (these, those) => {
      const bag = new Map();
      for (const l of those) bag.set(l, (bag.get(l) || 0) + 1);
      return these.filter((l) => {
        const n = bag.get(l) || 0;
        if (!n) return true;
        bag.set(l, n - 1);
        return false;
      });
    };
    const gone = missingFrom(before, after);
    const fresh = missingFrom(after, before);
    console.log(`\n  Battle lines only in the plain run: ${gone.length}`);
    for (const l of gone.slice(0, 8)) console.log(`    - ${l}`);
    console.log(`  Battle lines only in the controlled run: ${fresh.length}`);
    for (const l of fresh.slice(0, 8)) console.log(`    + ${l}`);

    page = { log: ctrl.debugLog, inputLog: ctrl.inputLog, tag: '-forced' };
  }

  const outFile = path.join(REPLAY_DIR, `${FORMAT}-${names.join('-vs-')}-${stamp}${page.tag}.html`);
  fs.writeFileSync(outFile, buildReplayHtml({
    title: `${Dex.formats.get(FORMAT).name} replay: ${names.join(' vs. ')}`,
    formatid: FORMAT,
    log: page.log,
    inputLog: page.inputLog,
    ...(opt('--embed') ? { embedBase: opt('--embed') } : {}),
  }), 'utf8');

  const url = `http://127.0.0.1:8080/replays/${encodeURIComponent(path.basename(outFile))}`;
  console.log(`\nReplay written: ${path.relative(ROOT, outFile)}`);
  console.log(`Served at:      ${url}`);
  console.log('The control row carries a "Play from here" button from turn 1 to the last turn.');

  if (!flag('--no-open')) {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    console.log('Opening in your default browser.');
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
