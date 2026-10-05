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
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

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
