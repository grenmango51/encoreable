/**
 * Step 2 - the fake room (`docs/extension.md` 5).
 *
 * The built extension is installed in a throwaway Chrome, which opens the live
 * play.pokemonshowdown.com as a guest. A recording is branched at turn 4 and
 * played forward in the two rooms the extension opens, one per side, by real
 * mouse clicks on the client's own buttons: a move, a target, a forced switch,
 * one Cancel. Part way through, the page is reloaded with a fake room in the
 * URL, and the branch has to come back where it was. At the end the branch's
 * log is handed to `scripts/lib/verify-branch.mjs`.
 *
 * Passes when verify-branch accepts the branch, the reload restores it at the
 * same turn, and no WebSocket frame the page sent names a fake room.
 *
 * `runKnownFormatRooms` is the standard-format companion. For every admitted
 * standard EV/IV profile it finds a finished recording of that format, derives
 * the input log from the recorded sets (a team seed is never regenerated), and
 * plays one turn from turn 3 in the live client's own rooms.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import { click, connect, declineConsent, launchChrome, sleep, stepOff } from './harness.mjs';
import { verifyBranch } from '../../scripts/lib/verify-branch.mjs';
import { posix } from '../../scripts/lib/recordings.mjs';

const RECORDING = 'recordings/local/branched/gen9championsvgc2026regmb-200.log.json';
const TURN = 4;
const MAX_DECISIONS = 60;

const FAKE = /encoreable\d+-p[12]/;

/** Waits for the Showdown client to be up with the extension hooked into it. */
async function clientReady(page) {
  await page.waitFor(`window.app && app.socket && app.socket.readyState === 1 && window.encoreable && app.__encoreableHooked`, 45000);
}

/**
 * The decision the side's room is showing, if any, as a selector to click.
 * Rotates through the enabled buttons by turn so the branch is not one move
 * spammed.
 */
function nextButton(page, roomid) {
  return page.evaluate(`(() => {
    const room = app.rooms[${JSON.stringify(roomid)}];
    if (!room || !room.battle) return { gone: true };
    if (room.battle.ended) return { ended: true };
    const scope = '#' + room.el.id + ' .battle-controls';
    if (!room.battle.atQueueEnd) return { busy: true, skip: scope + ' button[name=goToEnd]' };
    const visible = sel => [...document.querySelectorAll(scope + ' ' + sel)].filter(e => e.offsetParent !== null && !e.disabled);
    const turn = room.battle.turn || 0;
    const pick = (sel, list) => ({ sel: scope + ' ' + sel, index: turn % list.length, count: list.length, text: list[turn % list.length].textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) });
    const targets = visible('button[name=chooseMoveTarget]').filter(b => b.textContent.trim());
    if (targets.length) return pick('button[name=chooseMoveTarget]:not([disabled])', targets);
    const switches = visible('button[name=chooseSwitch]');
    const moves = visible('button[name=chooseMove]');
    if (moves.length) return pick('button[name=chooseMove]:not([disabled])', moves);
    if (switches.length) return pick('button[name=chooseSwitch]', switches);
    return { waiting: true, text: (document.querySelector(scope) || {}).innerText?.replace(/\\s+/g, ' ').slice(0, 80) };
  })()`);
}

async function focus(page, roomid) {
  await page.evaluate(`app.focusRoom(${JSON.stringify(roomid)})`);
  await sleep(300);
}

export async function run({ root, dist, headful, verbose }) {
  const file = path.join(root, RECORDING);
  const recording = JSON.parse(fs.readFileSync(file, 'utf8'));
  const original = recording.inputLog.join('\n');
  const chrome = await launchChrome({ headful, extension: dist });
  const results = { verified: false, reloadRestored: false, leaks: [], decisions: 0, undo: false };
  try {
    const page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    const wire = [];
    page.on('Network.webSocketFrameSent', p => wire.push(p.response.payloadData));

    await page.send('Page.navigate', { url: 'https://play.pokemonshowdown.com/' });
    await clientReady(page);
    console.log(`  client up, extension hooked (${await declineConsent(page)} consent dialog)`);

    const opened = await page.evaluate(`encoreable.openBranch({ inputLog: ${JSON.stringify(original)}, turn: ${TURN}, source: ${JSON.stringify(posix(root, file))} })`);
    console.log(`  branched ${posix(root, file)} at turn ${opened.turn} -> ${opened.rooms.join(', ')}`);
    const rooms = { p1: opened.rooms[0], p2: opened.rooms[1] };

    let reloaded = false;
    let lastTurn = opened.turn;
    for (let guard = 0; guard < MAX_DECISIONS * 4 && results.decisions < MAX_DECISIONS; guard++) {
      let acted = false;
      let ended = false;
      for (const side of ['p1', 'p2']) {
        await focus(page, rooms[side]);
        for (let k = 0; k < 6; k++) {
          const next = await nextButton(page, rooms[side]);
          if (next.ended) { ended = true; break; }
          if (next.busy) {
            // The client holds a new request until its animation reaches the end.
            await click(page, next.skip);
            await sleep(300);
            continue;
          }
          if (next.gone || next.waiting || !next.sel) {
            if (verbose && guard % 10 === 0) console.log(`    ${side} idle: ${JSON.stringify(next)}`);
            break;
          }
          await stepOff(page);
          const hit = await click(page, next.sel, next.index);
          if (!hit) break;
          if (verbose) console.log(`    ${side} turn ${await page.evaluate(`app.rooms[${JSON.stringify(rooms[side])}].battle.turn`)}: ${hit.text}`);
          acted = true;
          results.decisions++;
          await sleep(250);
        }
        // Once, cancel a finished choice and make it again.
        if (!results.undo && side === 'p1' && acted) {
          await stepOff(page);
          const cancel = await click(page, `#${await page.evaluate(`app.rooms[${JSON.stringify(rooms.p1)}].el.id`)} button[name=undoChoice]`);
          if (cancel) {
            await sleep(500);
            results.undo = true;
            console.log('  cancelled p1\'s choice with the client\'s Cancel button, choosing again');
            for (let k = 0; k < 6; k++) {
              const next = await nextButton(page, rooms.p1);
              if (!next.sel) break;
              await stepOff(page);
              await click(page, next.sel, next.index);
              await sleep(250);
            }
          }
        }
        if (ended) break;
      }

      const state = await page.evaluate(`(() => { const r = app.rooms[${JSON.stringify(rooms.p1)}]; return r && r.battle ? { turn: r.battle.turn, ended: r.battle.ended } : null; })()`);
      if (ended || (state && state.ended)) break;
      if (state && state.turn !== lastTurn) lastTurn = state.turn;

      // After the first new turn, reload with a fake room in the URL.
      if (!reloaded && state && state.turn >= opened.turn + 1) {
        reloaded = true;
        await focus(page, rooms.p2);
        const before = await page.evaluate(`encoreable.exportLog(encoreable.branches()[0].n).then(l => ({ url: location.pathname, turn: l.turn }))`);
        await page.send('Page.reload', {});
        await sleep(1500);
        await clientReady(page);
        const restored = await page.waitFor(`(() => {
          const a = app.rooms[${JSON.stringify(rooms.p1)}], b = app.rooms[${JSON.stringify(rooms.p2)}];
          return a && b && a.battle && b.battle && b.request && b.battle.atQueueEnd
            ? { turn: b.battle.turn, focused: app.curRoom && app.curRoom.id } : null;
        })()`, 30000).catch(() => null);
        results.reloadRestored = !!restored && restored.turn === before.turn;
        console.log(`  reloaded at ${before.url} on turn ${before.turn}: ${restored ? `both rooms rebuilt at turn ${restored.turn}, ${restored.focused} focused` : 'NOT rebuilt'}`);
        continue;
      }
      if (!acted) await sleep(400);
    }

    const n = await page.evaluate(`encoreable.branches()[0] && encoreable.branches()[0].n`);
    const played = await page.evaluate(`encoreable.exportLog(${JSON.stringify(n)})`);
    console.log(`  branch ${played.ended ? `ended on turn ${played.turn}, won by ${played.winner || 'nobody'}` : `stopped on turn ${played.turn}`} after ${results.decisions} clicks`);

    const tmp = path.join(os.tmpdir(), `encoreable-branch-${process.pid}.log.json`);
    fs.writeFileSync(tmp, JSON.stringify(played));
    try {
      const verdict = await verifyBranch({ original, turn: TURN, playedFile: tmp });
      results.verified = verdict.ok;
      console.log(verdict.text.split('\n').map(l => `    ${l}`).join('\n'));
    } finally {
      fs.rmSync(tmp, { force: true });
    }

    results.leaks = wire.filter(f => FAKE.test(f));
    console.log(`  WebSocket frames sent: ${wire.length}, naming a fake room: ${results.leaks.length}`);
    for (const f of results.leaks) console.log(`    LEAK ${f.slice(0, 160)}`);
    page.close();
  } finally {
    await chrome.close();
  }

  const ok = results.verified && results.reloadRestored && results.leaks.length === 0 && results.undo;
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'}: verify-branch ${results.verified ? 'accepts' : 'rejects'} the branch; ` +
    `reload ${results.reloadRestored ? 'restores' : 'does not restore'} it; Cancel ${results.undo ? 'used' : 'not reached'}; ` +
    `${results.leaks.length} leaked frame(s)`);
  return ok;
}

const KNOWN_TURN = 3;
const KNOWN_CLICKS = 24;
// Read-only probes that may not be in this checkout yet. Ignored when absent.
const EXTRA_RECORDINGS = '/home/user/.t3/worktrees/encoreable/campaign-format-expansion/recordings';
const SHOTS = '/tmp/encoreable-format-rooms';

const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const fuzzyName = (a, b) => {
  const x = normName(a);
  const y = normName(b);
  return !!(x && y && (x === y || x.startsWith(y) || y.startsWith(x)));
};

function walkLogs(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkLogs(full, out);
    else if (entry.name.endsWith('.log.json')) out.push(full);
  }
  return out;
}

function recordingDirs(root) {
  const dirs = [];
  const primary = path.join(root, 'recordings');
  if (fs.existsSync(primary)) dirs.push(primary);
  if (fs.existsSync(EXTRA_RECORDINGS)) {
    const extraReal = fs.realpathSync(EXTRA_RECORDINGS);
    if (!dirs.some(dir => fs.realpathSync(dir) === extraReal)) dirs.push(EXTRA_RECORDINGS);
  }
  return dirs;
}

function formatIdOf(data) {
  const raw = data && data.inputLog;
  const lines = Array.isArray(raw) ? raw : String(raw || '').split('\n');
  const start = lines.find(line => typeof line === 'string' && line.startsWith('>start '));
  if (!start) return '';
  try { return JSON.parse(start.replace(/^>start\s+/, '')).formatid || ''; }
  catch { return ''; }
}

function protocolFact(data, kind) {
  const log = Array.isArray(data.log) ? data.log : String(data.log || '').split('\n');
  const line = log.find(entry => entry.startsWith(`|${kind}|`));
  return line ? line.split('|')[2] || '' : '';
}

function isComplete(data) {
  const turns = Number(data && data.turns);
  if (!Number.isFinite(turns) || turns < KNOWN_TURN) return false;
  if (data.winner) return true;
  const log = Array.isArray(data.log) ? data.log.join('\n') : String(data.log || '');
  return log.includes('\n|win|') || log.startsWith('|win|');
}

/** True when both initial player lines carry a team seed and no packed team. */
function seedOnlyRecording(data) {
  const lines = Array.isArray(data.inputLog) ? data.inputLog : String(data.inputLog || '').split('\n');
  const found = {};
  for (const line of lines) {
    const header = /^>player (p[12]) /.exec(line);
    if (!header || found[header[1]]) continue;
    try {
      const opts = JSON.parse(line.slice(header[0].length));
      const packed = typeof opts.team === 'string' && opts.team;
      found[header[1]] = !packed && opts.seed != null && opts.seed !== '';
    } catch { found[header[1]] = false; }
  }
  return found.p1 === true && found.p2 === true;
}

function standardProfiles(profiles) {
  return (profiles || []).filter(profile => profile
    && profile.statModel === 'standard-ev-iv'
    && profile.capabilities
    && profile.capabilities.exactReplay
    && profile.capabilities.branching);
}

async function loadRecordingInput(root) {
  const local = path.join(root, 'scripts/lib/recording-input.mjs');
  const file = fs.existsSync(local) ? local : EXTRA_RECORDINGS && fs.existsSync(path.join(path.dirname(EXTRA_RECORDINGS), 'scripts/lib/recording-input.mjs'))
    ? path.join(path.dirname(EXTRA_RECORDINGS), 'scripts/lib/recording-input.mjs')
    : '';
  if (!file) throw new Error('scripts/lib/recording-input.mjs is absent from this checkout and from the parent worktree');
  if (path.resolve(file) !== path.resolve(local)) console.log(`  recording-input ${file}`);
  return import(pathToFileURL(file).href);
}

/**
 * The derived log keeps the recorded seed and replaces a seed-only team with
 * the server's `p1team` / `p2team`. It must not leave the seed in place, and
 * it must not ask the generator for a new team.
 */
function assertMaterialized(data, derived, profile) {
  const prov = derived.provenance;
  const mat = derived.materialization;
  if (!prov || !prov.admitted || !prov.capabilityGranted) {
    throw new Error(`not admitted for branching (${prov && prov.admissionError || 'capability not granted'})`);
  }
  if (prov.formatid !== profile.formatid) throw new Error(`materialized format is ${prov.formatid}`);
  if (prov.statModel !== 'standard-ev-iv') throw new Error(`stat model is ${prov.statModel}`);
  if (prov.gameType !== profile.gameType) throw new Error(`game type is ${prov.gameType}`);
  if (!mat || mat.generatorInvoked) throw new Error('team generator ran while deriving the input log');
  if (mat.mode !== 'packed-passthrough' && mat.mode !== 'recorded-teams') {
    throw new Error(`unknown materialization mode ${mat.mode}`);
  }
  const raw = Array.isArray(data.inputLog) ? data.inputLog.join('\n') : String(data.inputLog || '');
  let seedOnly = false;
  for (const player of prov.players || []) {
    if (player.slot !== 'p1' && player.slot !== 'p2') continue;
    const line = derived.lines[player.lineIndex];
    let opts;
    try { opts = JSON.parse(String(line).replace(/^>player p[1-4] /, '')); }
    catch { throw new Error(`${player.slot} derived player line is not JSON`); }
    if (opts.seed != null && opts.seed !== '') throw new Error(`${player.slot} derived line still carries a team seed`);
    if (typeof opts.team !== 'string' || opts.team.length < 8) throw new Error(`${player.slot} derived line has no packed team`);
    if (!player.teamSeed) continue;
    seedOnly = true;
    if (mat.mode !== 'recorded-teams') throw new Error(`${player.slot} seed-only team was not taken from the recorded sets`);
    if (player.teamSeedUsed) throw new Error(`${player.slot} team seed was used to generate a team`);
    const slot = mat.slots[player.slot];
    if (!slot || slot.droppedSeed !== true || slot.source !== `${player.slot}team` || slot.packed !== opts.team) {
      throw new Error(`${player.slot} packed team is not the recorded ${player.slot}team`);
    }
    if (String(line).includes(String(player.teamSeed))) throw new Error(`${player.slot} line still contains its team seed`);
    if (!raw.includes(String(player.teamSeed))) throw new Error(`${player.slot} recording was rewritten`);
  }
  if (seedOnly && mat.mode !== 'recorded-teams') throw new Error('a seed-only team was not replaced from the server sets');
}

function candidatesFor(root, formatid) {
  const primary = path.join(root, 'recordings');
  const primaryReal = fs.existsSync(primary) ? fs.realpathSync(primary) : '';
  const found = [];
  for (const dir of recordingDirs(root)) {
    for (const file of walkLogs(dir)) {
      let data;
      try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (formatIdOf(data) !== formatid || !isComplete(data)) continue;
      let inRoot = false;
      try { inRoot = !!primaryReal && fs.realpathSync(file).startsWith(primaryReal + path.sep); } catch { inRoot = false; }
      found.push({ file, data, inRoot, seedOnly: seedOnlyRecording(data) });
    }
  }
  found.sort((a, b) => {
    if (a.seedOnly !== b.seedOnly) return a.seedOnly ? -1 : 1;
    if (a.inRoot !== b.inRoot) return a.inRoot ? -1 : 1;
    return path.basename(b.file).localeCompare(path.basename(a.file));
  });
  return found;
}

async function prepareFormat(root, profile, inputLogFromRecording, truncateAtTurn, verbose) {
  const files = candidatesFor(root, profile.formatid);
  if (!files.length) {
    throw new Error(`no finished recording of at least ${KNOWN_TURN} turns in ${recordingDirs(root).join(', ') || '(no recordings directory)'}`);
  }
  const slots = profile.gameType === 'doubles' ? 2 : profile.gameType === 'singles' ? 1 : 0;
  if (!slots) throw new Error(`game type ${profile.gameType} is not a 1-slot or 2-slot format`);
  const errors = [];
  for (const item of files) {
    try {
      const derived = inputLogFromRecording(item.data, { capability: 'branching' });
      assertMaterialized(item.data, derived, profile);
      const tier = protocolFact(item.data, 'tier');
      const gameType = protocolFact(item.data, 'gametype');
      const gen = protocolFact(item.data, 'gen');
      if (!tier) throw new Error('recording has no |tier|');
      if (gameType !== profile.gameType) throw new Error(`|gametype| ${gameType} !== ${profile.gameType}`);
      if (Number(gen) !== profile.gen) throw new Error(`|gen| ${gen} !== ${profile.gen}`);
      const cut = await truncateAtTurn(derived.inputLog, KNOWN_TURN);
      if (cut.ended || !cut.awaitingChoice || cut.turn !== KNOWN_TURN || cut.errors.length) {
        throw new Error(`turn ${KNOWN_TURN} is not a move choice (turn ${cut.turn}, ended ${!!cut.ended}${cut.errors.length ? `, ${cut.errors[0]}` : ''})`);
      }
      for (const side of cut.position) {
        const alive = (side.active || []).filter(Boolean);
        if (alive.length !== slots) throw new Error(`${side.id} has ${alive.length} active at turn ${KNOWN_TURN}, expected ${slots}`);
      }
      return { ...item, derived, cut, tier, slots };
    } catch (err) {
      const message = err && err.code ? `${err.code}: ${err.message}` : (err && err.message || String(err));
      errors.push(`${path.basename(item.file)}: ${message.split('\n')[0]}`);
      if (verbose) console.log(`    skip ${path.basename(item.file)}: ${message.split('\n')[0]}`);
    }
  }
  throw new Error(errors.join(' | '));
}

/** Runs in the page. `spec` is the turn-3 position and the format the room must show. */
function inspectFormatRoom(spec) {
  const problems = [];
  const snapshots = {};
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fuzzy = (a, b) => {
    const x = norm(a);
    const y = norm(b);
    return !!(x && y && (x === y || x.startsWith(y) || y.startsWith(x)));
  };
  const monName = p => p && (p.name || p.speciesForme || p.species || (p.ident || '').slice(4) || (p.details || '').split(',')[0] || '');
  const findMon = (list, name) => (list || []).filter(Boolean).find(p => fuzzy(monName(p), name) || fuzzy(p.speciesForme, name) || fuzzy((p.details || '').split(',')[0], name));
  const sides = spec.only ? [spec.only] : ['p1', 'p2'];
  for (const side of sides) {
    const roomid = spec.rooms[side];
    const room = window.app && app.rooms[roomid];
    const battle = room && room.battle;
    if (!room || !battle || !battle.mySide) {
      problems.push(`${side} room is not open`);
      continue;
    }
    const snap = {
      tier: battle.tier,
      gameType: battle.gameType,
      gen: battle.gen,
      format: battle.format && battle.format.id,
      side: battle.mySide.sideid || battle.mySide.id,
      controlled: battle.pokemonControlled,
      active: (battle.mySide.active || []).filter(Boolean).map(monName),
      foeActive: ((battle.farSide && battle.farSide.active) || []).filter(Boolean).map(p => `${monName(p)} ${p.hp}/${p.maxhp}`),
      whatdo: '',
      buttons: 0,
    };
    if (battle.tier !== spec.tier) problems.push(`${side} tier ${JSON.stringify(battle.tier)} !== ${JSON.stringify(spec.tier)}`);
    if (battle.gameType !== spec.gameType) problems.push(`${side} game type ${battle.gameType} !== ${spec.gameType}`);
    if (Number(battle.gen) !== Number(spec.gen)) problems.push(`${side} gen ${battle.gen} !== ${spec.gen}`);
    if (battle.format && battle.format.id && battle.format.id !== spec.formatid) {
      problems.push(`${side} format ${battle.format.id} !== ${spec.formatid}`);
    }
    if (!String(roomid).includes(spec.formatid)) problems.push(`${side} room id ${roomid} does not name ${spec.formatid}`);
    if (snap.side !== side) problems.push(`${side} viewpoint is ${snap.side || 'unset'}`);
    const active = (battle.mySide.active || []).filter(Boolean);
    if (active.length !== spec.slots) problems.push(`${side} has ${active.length} active Pokémon, expected ${spec.slots}`);
    if (battle.pokemonControlled !== spec.slots) problems.push(`${side} controls ${battle.pokemonControlled} slot(s), expected ${spec.slots}`);
    if (!battle.farSide || battle.farSide.active.length !== spec.slots) {
      problems.push(`${side} opponent has ${battle.farSide ? battle.farSide.active.length : 0} slot(s), expected ${spec.slots}`);
    }
    const request = room.request;
    if (!request || request.requestType !== 'move' || !request.active || request.active.length !== spec.slots) {
      problems.push(`${side} request is ${(request && request.requestType) || 'missing'} with ${request && request.active ? request.active.length : 0} active`);
    }
    const buttons = [...room.el.querySelectorAll('.battle-controls button[name=chooseMove], .battle-controls button[name=chooseSwitch]')]
      .filter(button => button.offsetParent && !button.disabled);
    snap.buttons = buttons.length;
    if (!buttons.length) problems.push(`${side} has no visible native move or switch button`);
    const whatdo = room.el.querySelector('.battle-controls .whatdo');
    const whatdoText = whatdo && whatdo.offsetParent ? whatdo.innerText.replace(/\s+/g, ' ').trim() : '';
    snap.whatdo = whatdoText.slice(0, 180);
    const who = /What will\s+(.+?)\s+do\?/.exec(whatdoText);
    const hp = /HP\s+(\d+)\s*\/\s*(\d+)/.exec(whatdoText);
    const expectSide = (spec.position || []).find(entry => entry.id === side);
    const expectFoe = (spec.position || []).find(entry => entry.id !== side);
    if (!who || !hp) problems.push(`${side} chooser does not show its own exact HP: ${whatdoText.slice(0, 180) || '(no prompt)'}`);
    else {
      const mon = findMon(expectSide && expectSide.active, who[1]);
      if (!mon) problems.push(`${side} chooser is for ${who[1]}, who is not active`);
      else if (Number(hp[1]) !== mon.hp || Number(hp[2]) !== mon.maxhp) {
        problems.push(`${side} chooser shows ${who[1]} ${hp[1]}/${hp[2]}, expected ${mon.hp}/${mon.maxhp}`);
      }
    }
    const expectMons = [...((expectSide && expectSide.active) || []), ...((expectSide && expectSide.bench) || [])].filter(Boolean);
    const mine = battle.myPokemon || [];
    snap.party = mine.map(p => `${monName(p)} ${p.hp}/${p.maxhp}`);
    if (mine.length !== expectMons.length) problems.push(`${side} own party has ${mine.length} Pokémon, the position has ${expectMons.length}`);
    for (const mon of expectMons) {
      const row = findMon(mine, mon.name);
      if (!row) problems.push(`${side} own party is missing ${mon.name}`);
      else if (row.hp !== mon.hp || row.maxhp !== mon.maxhp) {
        problems.push(`${side} ${mon.name} is ${row.hp}/${row.maxhp} on its own side, expected ${mon.hp}/${mon.maxhp}`);
      }
    }
    for (const mon of ((expectFoe && expectFoe.active) || []).filter(Boolean)) {
      const shown = findMon(battle.farSide && battle.farSide.active, mon.name);
      if (!shown) problems.push(`${side} cannot see opposing ${mon.name}`);
      else if (shown.hp === mon.hp && shown.maxhp === mon.maxhp && mon.maxhp !== 100) {
        problems.push(`${side} shows opposing ${mon.name}'s exact ${mon.hp}/${mon.maxhp}`);
      }
      const bar = [...room.el.querySelectorAll('.statbar')].find(el => fuzzy(el.innerText, mon.name));
      const text = bar ? bar.innerText.replace(/\s+/g, ' ') : '';
      if (mon.maxhp !== 100 && text.includes(`${mon.hp}/${mon.maxhp}`)) {
        problems.push(`${side} statbar prints opposing ${mon.name} as ${mon.hp}/${mon.maxhp}`);
      }
    }
    if (room.el.querySelector('.sp-panel, .sp-slider, .sp-summary, .sp-reset')) {
      problems.push(`${side} shows Champions Stat Point controls`);
    }
    if ((room.el.innerText || '').includes('Stat Points')) problems.push(`${side} log mentions Stat Points`);
    try {
      const poke = active[0];
      const tips = room.tooltips || (battle.scene && battle.scene.tooltips);
      if (tips && poke && tips.showPokemonTooltip) tips.showPokemonTooltip(poke, null, true);
      const tooltip = (document.querySelector('#tooltipwrapper') || {}).innerText || '';
      snap.tooltip = tooltip.replace(/\s+/g, ' ').slice(0, 160);
      if (/Stat Points|\bsp-slider\b|\bsp-panel\b/.test(tooltip)) problems.push(`${side} tooltip has Champions Stat Point controls`);
    } catch (err) {
      snap.tooltip = String(err && err.message || err).slice(0, 160);
    }
    if (window.BattleTooltips && BattleTooltips.hideTooltip) BattleTooltips.hideTooltip();
    snapshots[side] = snap;
  }
  return { problems, snapshots };
}

function readChooser(roomid) {
  const room = window.app && app.rooms[roomid];
  const whatdo = room && room.el.querySelector('.battle-controls .whatdo');
  const text = whatdo && whatdo.offsetParent ? whatdo.innerText.replace(/\s+/g, ' ').trim() : '';
  const who = /What will\s+(.+?)\s+do\?/.exec(text);
  const hp = /HP\s+(\d+)\s*\/\s*(\d+)/.exec(text);
  if (!who || !hp) return { text: text.slice(0, 180) };
  return { name: who[1], hp: Number(hp[1]), maxhp: Number(hp[2]), text: text.slice(0, 180) };
}

async function shoot(page, name) {
  const file = path.join(SHOTS, name);
  try {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`  screenshot ${file}`);
    return file;
  } catch (err) {
    console.log(`  screenshot failed (${name}): ${err.message}`);
    return '';
  }
}

async function settleRoom(page, roomid) {
  for (let i = 0; i < 12; i++) {
    const state = await page.evaluate(`(() => {
      const room = app.rooms[${JSON.stringify(roomid)}];
      if (!room || !room.battle) return null;
      const scope = '#' + room.el.id + ' .battle-controls';
      const buttons = [...document.querySelectorAll(scope + ' button')].filter(el => el.offsetParent && !el.disabled);
      const ready = buttons.some(el => el.name === 'chooseMove' || el.name === 'chooseSwitch');
      return { atQueueEnd: !!room.battle.atQueueEnd, ready, skip: scope + ' button[name=goToEnd]' };
    })()`);
    if (state && state.atQueueEnd && state.ready) return;
    if (state && !state.atQueueEnd) await click(page, state.skip);
    await sleep(300);
  }
}

function sourceLabel(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return file;
  return rel.split(path.sep).join('/');
}

function chooserMatches(seen, side, position) {
  const expect = ((position.find(entry => entry.id === side) || {}).active || []).filter(Boolean);
  const problems = [];
  if (seen.length < expect.length) {
    problems.push(`${side} chooser showed ${seen.length} active slot(s), expected ${expect.length}: ${JSON.stringify(seen)}`);
    return problems;
  }
  for (const mon of expect) {
    const row = seen.find(item => fuzzyName(item.name, mon.name));
    if (!row) problems.push(`${side} never offered a move for ${mon.name}`);
    else if (row.hp !== mon.hp || row.maxhp !== mon.maxhp) {
      problems.push(`${side} chooser showed ${row.name} ${row.hp}/${row.maxhp}, expected ${mon.hp}/${mon.maxhp}`);
    }
  }
  return problems;
}

async function playOneTurn(page, rooms, openedTurn, verbose) {
  const seen = { p1: [], p2: [] };
  const kinds = { p1: { move: 0, switch: 0 }, p2: { move: 0, switch: 0 } };
  let clicks = 0;
  let advanced = false;
  let idle = 0;
  for (let guard = 0; guard < 40 && clicks < KNOWN_CLICKS && !advanced; guard++) {
    let acted = false;
    for (const side of ['p1', 'p2']) {
      const turn = await page.evaluate(`(() => { const r = app.rooms[${JSON.stringify(rooms[side])}]; return r && r.battle ? r.battle.turn : null; })()`);
      if (turn != null && turn >= openedTurn + 1) { advanced = true; break; }
      await focus(page, rooms[side]);
      for (let k = 0; k < 6 && clicks < KNOWN_CLICKS; k++) {
        const turnNow = await page.evaluate(`(() => { const r = app.rooms[${JSON.stringify(rooms[side])}]; return r && r.battle ? r.battle.turn : null; })()`);
        if (turnNow != null && turnNow >= openedTurn + 1) { advanced = true; break; }
        const next = await nextButton(page, rooms[side]);
        if (next.ended) return { seen, kinds, clicks, advanced: true, ended: true };
        if (next.busy) {
          await click(page, next.skip);
          clicks++;
          acted = true;
          await sleep(250);
          continue;
        }
        if (!next.sel) break;
        const chooser = await page.evaluate(`window.__encoreableReadChooser(${JSON.stringify(rooms[side])})`);
        if (chooser && chooser.name && !seen[side].some(item => item.name === chooser.name)) seen[side].push(chooser);
        await stepOff(page);
        const hit = await click(page, next.sel, next.index || 0);
        if (!hit) break;
        clicks++;
        acted = true;
        const kind = next.sel.includes('chooseMoveTarget') ? 'target' : next.sel.includes('chooseSwitch') ? 'switch' : 'move';
        if (kind === 'move' || kind === 'switch') kinds[side][kind]++;
        if (verbose) console.log(`    ${side} ${kind}: ${hit.text}`);
        await sleep(300);
      }
      if (advanced) break;
    }
    if (advanced) break;
    if (!acted) {
      idle++;
      if (idle >= 4) break;
      await sleep(400);
    } else idle = 0;
  }
  return { seen, kinds, clicks, advanced, ended: false };
}

/**
 * Open one native room pair per admitted standard EV/IV format and play a
 * single turn from turn 3. Champions `run` is unchanged.
 *
 * @param {{root: string, dist: string, headful?: boolean, verbose?: boolean}} opts
 */
export async function runKnownFormatRooms({ root, dist, headful = false, verbose = false }) {
  const failures = [];
  let profiles;
  let inputLogFromRecording;
  let truncateAtTurn;
  try {
    const profileMod = await import(pathToFileURL(path.join(root, 'scripts/lib/format-profile.mjs')).href);
    const inputMod = await loadRecordingInput(root);
    inputLogFromRecording = inputMod.inputLogFromRecording;
    ({ truncateAtTurn } = await import(pathToFileURL(path.join(root, 'scripts/lib/truncate.mjs')).href));
    profiles = standardProfiles(profileMod.FORMAT_PROFILES);
  } catch (err) {
    console.log(`  [FAIL] setup\n         ${err.message}`);
    return false;
  }
  console.log(`  admitted standard-ev-iv: ${profiles.map(profile => `${profile.formatid} (${profile.gameType})`).join(', ') || '(none)'}`);
  if (!profiles.length) {
    console.log('  [FAIL] no admitted standard-ev-iv format');
    return false;
  }
  const ready = [];
  for (const profile of profiles) {
    try {
      const item = await prepareFormat(root, profile, inputLogFromRecording, truncateAtTurn, verbose);
      ready.push({ profile, ...item });
      console.log(`  [ready] ${profile.formatid} ${sourceLabel(root, item.file)} ${item.derived.materialization.mode}${item.seedOnly ? ' seed-only' : ''} turn ${KNOWN_TURN}`);
    } catch (err) {
      failures.push(`${profile.formatid}: ${err.message}`);
      console.log(`  [FAIL] ${profile.formatid}\n         ${err.message}`);
    }
  }
  if (!ready.length) {
    console.log(`\n  FAIL: ${failures.length} format(s) had no playable recording`);
    return false;
  }
  if (!fs.existsSync(path.join(dist, 'manifest.json')) || !fs.existsSync(path.join(dist, 'sim-worker.js'))) {
    console.log('  [FAIL] built extension is missing extension/dist/manifest.json or sim-worker.js');
    return false;
  }

  const chrome = await launchChrome({ headful: !!headful, extension: dist });
  let page;
  try {
    page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    const wire = [];
    page.on('Network.webSocketFrameSent', params => {
      if (params && params.response && params.response.payloadData) wire.push(String(params.response.payloadData));
    });
    if (verbose) {
      page.on('Runtime.consoleAPICalled', params => {
        if (params.type !== 'error' && params.type !== 'warning') return;
        const text = (params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
        if (text) console.log(`    page ${params.type}: ${text}`);
      });
    }
    await page.send('Page.navigate', { url: 'https://play.pokemonshowdown.com/' });
    await clientReady(page);
    console.log(`  client up, extension hooked (${await declineConsent(page)} consent dialog)`);
    await page.evaluate(`window.__encoreableInspect = ${inspectFormatRoom.toString()}; window.__encoreableReadChooser = ${readChooser.toString()};`);

    for (const item of ready) {
      const id = item.profile.formatid;
      const mark = wire.length;
      try {
        const label = sourceLabel(root, item.file);
        const opened = await page.evaluate(`encoreable.openBranch({ inputLog: ${JSON.stringify(item.derived.inputLog)}, turn: ${KNOWN_TURN}, source: ${JSON.stringify(label)} })`);
        if (!opened || opened.turn !== KNOWN_TURN || !opened.rooms || opened.rooms.length !== 2) {
          throw new Error(`openBranch returned ${JSON.stringify(opened)}`);
        }
        const rooms = { p1: opened.rooms[0], p2: opened.rooms[1] };
        if (!rooms.p1.includes(id) || !rooms.p2.includes(id)) throw new Error(`rooms ${opened.rooms.join(', ')} are not ${id}`);
        console.log(`  branched ${label} at turn ${opened.turn} -> ${opened.rooms.join(', ')}`);
        const spec = {
          formatid: id,
          gameType: item.profile.gameType,
          gen: item.profile.gen,
          tier: item.tier,
          slots: item.slots,
          position: item.cut.position,
          rooms,
        };
        for (const side of ['p1', 'p2']) {
          await focus(page, rooms[side]);
          await settleRoom(page, rooms[side]);
          await shoot(page, `${id}-${side}.png`);
          const inspected = await page.evaluate(`window.__encoreableInspect(${JSON.stringify({ ...spec, only: side })})`);
          if (verbose) console.log(`    ${side} ${JSON.stringify(inspected && inspected.snapshots)}`);
          if (!inspected || inspected.problems.length) {
            throw new Error((inspected && inspected.problems || ['room inspection returned nothing']).join('\n'));
          }
        }
        const played = await playOneTurn(page, rooms, opened.turn, verbose);
        await focus(page, rooms.p1);
        await shoot(page, `${id}-after.png`);
        const choiceProblems = ['p1', 'p2'].flatMap(side => chooserMatches(played.seen[side], side, item.cut.position));
        if (choiceProblems.length) throw new Error(choiceProblems.join('\n'));
        for (const side of ['p1', 'p2']) {
          if (played.kinds[side].move + played.kinds[side].switch < 1) {
            throw new Error(`${side} did not click a move or switch button`);
          }
        }
        if (!played.advanced) throw new Error(`turn did not advance after ${played.clicks} clicks`);
        if (played.clicks > KNOWN_CLICKS) throw new Error(`exceeded ${KNOWN_CLICKS} clicks`);

        const exported = await page.evaluate(`encoreable.exportLog(${JSON.stringify(opened.n)})`);
        const tmp = path.join(os.tmpdir(), `encoreable-format-${id}-${process.pid}.log.json`);
        fs.writeFileSync(tmp, JSON.stringify(exported));
        try {
          const verdict = await verifyBranch({ original: item.derived.inputLog, turn: KNOWN_TURN, playedFile: tmp });
          console.log(verdict.text.split('\n').map(line => `    ${line}`).join('\n'));
          if (!verdict.ok) throw new Error('verify-branch rejected the continuation');
          const sides = new Set((verdict.added || []).map(line => (/^>(p[12]) /.exec(line) || [])[1]).filter(Boolean));
          if (!sides.has('p1') || !sides.has('p2')) throw new Error(`continuation choices are missing a side (${[...sides].join(', ') || 'none'})`);
        } finally {
          fs.rmSync(tmp, { force: true });
        }
        const leaks = wire.slice(mark).filter(frame => FAKE.test(frame));
        if (leaks.length) {
          for (const frame of leaks) console.log(`    LEAK ${frame.slice(0, 160)}`);
          throw new Error(`${leaks.length} WebSocket frame(s) named a fake room`);
        }
        console.log(`  [PASS] ${id} ${item.slots === 2 ? '2 active slots' : '1 active slot'}, ${played.clicks} clicks, no fake-room frame`);
      } catch (err) {
        await shoot(page, `${id}-fail.png`);
        const message = String(err && err.message || err);
        failures.push(`${id}: ${message.split('\n')[0]}`);
        console.log(`  [FAIL] ${id}\n${message.split('\n').map(line => `         ${line}`).join('\n')}`);
      }
    }
    if (!wire.length) {
      failures.push('no WebSocket frames were observed');
      console.log('  [FAIL] websocket\n         no frames were captured, so a fake-room command would not have been seen');
    } else {
      const leaks = wire.filter(frame => FAKE.test(frame));
      console.log(`  WebSocket frames sent: ${wire.length}, naming a fake room: ${leaks.length}`);
      if (leaks.length) failures.push(`${leaks.length} leaked frame(s)`);
    }
  } catch (err) {
    failures.push(`browser: ${err.message}`);
    console.log(`  [FAIL] browser\n         ${err.message}`);
  } finally {
    if (page) page.close();
    await chrome.close();
  }

  const ok = failures.length === 0;
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'}: ${profiles.length} admitted standard format(s), ${ready.length} opened, ${failures.length} failure(s)`);
  for (const failure of failures) console.log(`    ${failure}`);
  return ok;
}
