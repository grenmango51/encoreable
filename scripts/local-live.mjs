/**
 * Live branch - play a recorded battle forward from any turn, both sides, in the
 * real Showdown battle interface.
 *
 * One command puts a recorded position into a live battle room and opens two
 * browser windows sitting on it, each with its own move buttons. Both sides
 * commit blind and the turn resolves when both are in, which is ordinary
 * Showdown behaviour - the operator simply happens to be both players.
 *
 *   1. truncate the recorded input log at the chosen turn      (lib/truncate.mjs)
 *   2. connect to the local server as an ordinary guest        (lib/ws-admin.mjs)
 *   3. /importinputlog  ->  a live room at that position
 *   4. read the new roomid out of the |init|battle frame
 *   5. open two Chrome profiles, each /join <roomid> under its own name
 *   6. /restoreplayers  ->  both users take their original slots
 *
 * Exact HP needs no server patch: as a player you see your own side exactly and
 * the opponent as percentages, so between the two windows every value is on
 * screen.
 *
 * Usage:
 *   node scripts/local-live.mjs                       newest log, turn 4
 *   node scripts/local-live.mjs --at 6
 *   node scripts/local-live.mjs --from <log.json> --at 3
 *   node scripts/local-live.mjs --at 4 --dry-run      truncate and print only
 *   node scripts/local-live.mjs --verify <log.json>   check a played-out branch
 *   node scripts/local-live.mjs --at 4 --verbose
 */

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';

import { launchBranch, prepareBranch } from './lib/branch-launch.mjs';
import { positionText } from './lib/truncate.mjs';
import { verifyBranch } from './lib/verify-branch.mjs';

const ROOT = process.cwd();
const RUNTIME_LOGS = path.join(ROOT, 'runtime', 'logs');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

// ------------------------------------------------------------------ log files

function newestLogFile() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.log.json')) out.push(full);
    }
  };
  walk(RUNTIME_LOGS);
  if (!out.length) return null;
  return out.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/** A repo-relative path with forward slashes, for pasting back as an argument. */
function posix(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function readInputLog(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(data.inputLog) ? data.inputLog.join('\n') : String(data.inputLog || '');
  if (!raw.trim()) throw new Error(`${path.relative(ROOT, file)} contains no inputLog`);
  return raw;
}

// -------------------------------------------------------------------- servers

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, () => resolve(true)).on('error', () => resolve(false));
    req.setTimeout(400, () => { req.destroy(); resolve(false); });
  });
}

async function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function ensureServers() {
  if ((await isPortOpen(8000)) && (await isPortOpen(8080))) {
    console.log('Local servers active on ports 8000 & 8080.');
    return false;
  }
  console.log('Starting local Showdown server and client host...');
  spawn(process.execPath, ['scripts/local-play.mjs'], { cwd: ROOT, stdio: 'inherit', detached: true }).unref();
  if (!(await waitForPort(8000)) || !(await waitForPort(8080))) {
    throw new Error('the local servers did not come up within 20s');
  }
  console.log('Servers are up.');
  return true;
}

// ----------------------------------------------------------------------- main

async function main() {
  if (flag('--verify')) {
    const report = await verifyBranch({
      original: readInputLog(opt('--from') || newestLogFile()),
      turn: Number(opt('--at', '4')),
      playedFile: opt('--verify'),
    });
    console.log(report.text);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  const logFile = opt('--from') || newestLogFile();
  if (!logFile) throw new Error('no battle log found - run `npm run battle` to record one first');
  const target = Number(opt('--at', '4'));

  console.log(`Battle log: ${path.relative(ROOT, logFile)}`);
  const original = readInputLog(logFile);

  // --- 1. truncate ---------------------------------------------------------
  const cut = await prepareBranch(original, target);
  if (cut.turn < target) {
    console.log(`Note: the log only reaches turn ${cut.turn}, so branching from there instead of ${target}.`);
  }

  console.log(`\nPosition at turn ${cut.turn} (${cut.kept}/${cut.total} recorded choices kept):\n`);
  console.log(positionText(cut.position));

  if (flag('--dry-run')) {
    console.log(`\n--dry-run: stopping here. Truncated input log is ${cut.inputLog.length} bytes.`);
    return;
  }

  // --- 2. servers ----------------------------------------------------------
  console.log('');
  const started = await ensureServers();
  if (started) await new Promise(r => setTimeout(r, 1500));

  // --- 3-6. import, open two windows, fill both slots ----------------------
  const branch = await launchBranch({
    inputLog: original,
    turn: target,
    cut,
    verbose: flag('--verbose'),
    say: msg => console.log(msg),
  });

  console.log('');
  console.log('--- LIVE BRANCH READY ---');
  for (const [slot, name] of branch.slots) {
    console.log(`  ${slot}  ${name}${slot === 'p1' ? '   (left window)' : '   (right window)'}`);
  }
  console.log(`\nRoom: ${branch.roomid}   Turn: ${branch.turn}`);
  console.log(`Continuation seed: ${branch.seed}`);
  console.log('Pick moves in both windows. The turn resolves once both sides are in.');
  console.log('There is no clock - do not turn one on with /timer.');
  console.log('\nWhen the battle ends, its full input log lands in runtime/logs. Check the branch with:');
  console.log(`  node scripts/local-live.mjs --from ${posix(logFile)} --at ${branch.turn} --verify <new log.json>`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
