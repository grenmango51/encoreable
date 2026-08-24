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
 *   2. connect to the local server as `~`                      (lib/ws-admin.mjs)
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

import { launchPair } from './lib/browser.mjs';
import { truncateAtTurn, positionText } from './lib/truncate.mjs';
import { WsAdmin } from './lib/ws-admin.mjs';
import { verifyBranch } from './lib/verify-branch.mjs';

const ROOT = process.cwd();
const RUNTIME_LOGS = path.join(ROOT, 'runtime', 'logs');
const CLIENT = 'http://127.0.0.1:8080/testclient.html?~~127.0.0.1:8000';

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

// ------------------------------------------------------------- room plumbing

async function importInputLog(admin, inputLog) {
  const pending = admin.waitFor((roomid, line, parts) => {
    if (parts[1] === 'init' && parts[2] === 'battle' && roomid.startsWith('battle-')) return { roomid };
    if (parts[1] === 'error' || parts[1] === 'popup') {
      const text = parts.slice(2).join('|');
      if (/importinputlog|denied|permission|Invalid input log/i.test(text)) return { error: text };
    }
    return null;
  }, { timeoutMs: 20000, what: 'the imported battle room' });

  // One frame, newlines intact: `/importinputlog ` is registered as a multi-line
  // command and the multi-line path is only taken when the text contains "\n".
  admin.send('', `/importinputlog ${inputLog}`);

  const hit = await pending;
  if (hit.error) throw new Error(`the server refused the import: ${hit.error}`);
  return hit.roomid;
}

function watchRoom(admin, roomid, names) {
  const wanted = new Map(names.map(n => [toId(n), n]));
  const present = new Set();
  const slots = new Map();
  const problems = [];

  admin.on((room, line, parts) => {
    if (room !== roomid) return;
    const cmd = parts[1];

    if (cmd === 'users') {
      for (const entry of (parts[2] || '').split(',').slice(1)) {
        const id = toId(entry);
        if (wanted.has(id)) present.add(id);
      }
    } else if (cmd === 'j' || cmd === 'J' || cmd === 'join') {
      const id = toId(parts[2] || '');
      if (wanted.has(id)) present.add(id);
    } else if (cmd === 'l' || cmd === 'L' || cmd === 'leave') {
      present.delete(toId(parts[2] || ''));
    } else if (cmd === 'player' && parts[3]) {
      slots.set(parts[2], parts[3]);
    } else if (line.includes('already has a team')) {
      problems.push(line);
    }
  });

  return { present, slots, problems, wanted };
}

const toId = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

async function waitUntil(check, { timeoutMs, what }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
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
  const cut = await truncateAtTurn(original, target);
  if (cut.errors.length) {
    throw new Error(`re-simulating the log produced choice errors: ${cut.errors.join(' ')}`);
  }
  if (cut.ended) {
    throw new Error(
      `this battle is over by turn ${cut.turn}, so there is nothing to play on from. ` +
      `Pick an earlier turn with --at.`
    );
  }
  if (cut.turn < target) {
    console.log(`Note: the log only reaches turn ${cut.turn}, so branching from there instead of ${target}.`);
  }
  if (!cut.awaitingChoice) {
    throw new Error(`the position at turn ${cut.turn} is not waiting for both sides' moves - refusing to import it`);
  }

  console.log(`\nPosition at turn ${cut.turn} (${cut.kept}/${cut.total} recorded choices kept):\n`);
  console.log(positionText(cut.position));

  if (flag('--dry-run')) {
    console.log(`\n--dry-run: stopping here. Truncated input log is ${cut.inputLog.length} bytes.`);
    return;
  }

  // --- 2. server + admin ---------------------------------------------------
  console.log('');
  const started = await ensureServers();
  if (started) await new Promise(r => setTimeout(r, 1500));

  const admin = new WsAdmin({ verbose: flag('--verbose') });
  await admin.connect();
  await admin.waitNamed();

  // --- 3+4. import and learn the roomid ------------------------------------
  const roomid = await importInputLog(admin, cut.inputLog);
  console.log(`Imported as ${roomid}`);

  const room = watchRoom(admin, roomid, cut.players);

  // --- 5. two browsers -----------------------------------------------------
  const [leftName, rightName] = cut.players;
  const url = (name) => `${CLIENT}&autoname=${encodeURIComponent(name)}&autojoin=${encodeURIComponent(roomid)}`;
  console.log('Opening two browser windows side by side...');
  await launchPair({ left: url(leftName), right: url(rightName), tag: roomid.replace(/[^a-z0-9]/gi, '') });

  await waitUntil(() => room.present.size >= 2, {
    timeoutMs: 60000,
    what: `${leftName} and ${rightName} to appear in ${roomid} (seen: ${[...room.present].join(', ') || 'nobody'})`,
  });
  console.log('Both windows are in the room.');

  // --- 6. hand them their slots -------------------------------------------
  // `invitebattle` joins a user straight into a slot - no invite handshake - when
  // they are already in the room and the slot has a team from the imported log
  // (chat-commands/core.ts:1236). `restoreplayers` issues one per slot, using the
  // names the input log carried.
  admin.send(roomid, '/restoreplayers');

  await waitUntil(() => room.slots.size >= 2, {
    timeoutMs: 20000,
    what: `both slots to fill (filled: ${[...room.slots.entries()].map(([s, n]) => `${s}=${n}`).join(', ') || 'none'})`,
  });

  if (room.problems.length) {
    throw new Error(`the battle rejected a player: ${room.problems.join(' ')}`);
  }

  console.log('');
  console.log('--- LIVE BRANCH READY ---');
  for (const [slot, name] of [...room.slots.entries()].sort()) {
    console.log(`  ${slot}  ${name}${slot === 'p1' ? '   (left window)' : '   (right window)'}`);
  }
  console.log(`\nRoom: ${roomid}   Turn: ${cut.turn}`);
  console.log('Pick moves in both windows. The turn resolves once both sides are in.');
  console.log('There is no clock - do not turn one on with /timer.');
  console.log('\nWhen the battle ends, its full input log lands in runtime/logs. Check the branch with:');
  console.log(`  node scripts/local-live.mjs --from ${path.relative(ROOT, logFile).replace(/\\/g, '/')} --at ${cut.turn} --verify <new log.json>`);

  admin.close();
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
