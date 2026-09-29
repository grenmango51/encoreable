/**
 * Step 4 - RNG control (`docs/extension.md` 5).
 *
 * The panel `npm run live` injects (`scripts/client/rng-panel.js`) runs on the
 * live client; its `/rng` commands are answered by `rng-command.js` inside the
 * extension's Worker. Every row the panel offers on p1's active Pokemon and
 * their moves is armed through the panel's own controls, as a person would:
 * hover, then click. Each row has to show armed from the state the engine
 * pushes back, and the damage-roll rows have to show their sixteen values.
 * Then the turn is played in both rooms.
 *
 * "Fires as it does under `npm run live`" is tested against Node: the branch's
 * input log, `>rng` lines and all, is re-simulated there with the same
 * `rng-command.js`, and every rule's matched and forced counts must agree with
 * the page's. verify-branch must accept the branch too. A real battle's
 * tooltips must stay vanilla: no panel rows outside a fake room.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

import { click, connect, declineConsent, launchChrome, sleep, stepOff } from './harness.mjs';
import { verifyBranch } from '../../scripts/lib/verify-branch.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');
const rngEngine = require('../../scripts/server/rng-command.js');
rngEngine.teachStream(BattleStream);

const RECORDING = 'recordings/local/branched/gen9championsvgc2026regmb-200.log.json';
const TURN = 4;

async function hover(page, selector, index = 0) {
  const box = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.offsetParent !== null)[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!box) return false;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await sleep(150);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(500);
  return true;
}

const rowsShown = page => page.evaluate(`[...document.querySelectorAll('#tooltipwrapper .rng-row')].map(r => ({
  index: Number(r.dataset.rngIndex),
  label: r.querySelector('.rng-label').textContent.trim(),
  armed: r.querySelector('.rng-arm').checked,
  slider: !!r.querySelector('.rng-slider'),
  value: r.querySelector('.rng-value').textContent.trim(),
  picks: r.querySelectorAll('.rng-pick').length,
}))`);

/** Arms every row of the tooltip `selector` opens, through the tooltip's own controls. */
async function armAll(page, selector, index, where) {
  if (!await hover(page, selector, index)) return { rows: 0, armed: 0, rolls: [] };
  const first = await rowsShown(page);
  let armed = 0;
  const rolls = [];
  for (const row of first) {
    const sel = `#tooltipwrapper .rng-row[data-rng-index="${row.index}"]`;
    // A slider arms at the stop it shows when clicked; a pick row arms at the button clicked.
    const target = row.slider ? `${sel} .rng-slider` : `${sel} .rng-pick:last-child`;
    const hit = await click(page, target);
    if (!hit) continue;
    const ok = await page.waitFor(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); return r && r.querySelector('.rng-arm').checked; })()`, 5000).catch(() => false);
    if (ok) armed++;
    else console.log(`    ${where} row "${row.label}" did not show armed`);
    if (row.label === 'Roll') {
      const value = await page.waitFor(`(() => { const v = document.querySelector(${JSON.stringify(`${sel} .rng-value`)}); return v && /\\d/.test(v.textContent) && v.textContent; })()`, 5000).catch(() => '');
      rolls.push(value);
    }
  }
  return { rows: first.length, armed, labels: first.map(r => r.label), rolls };
}

export async function run({ root, dist, headful, verbose }) {
  const recording = JSON.parse(fs.readFileSync(path.join(root, RECORDING), 'utf8'));
  const original = recording.inputLog.join('\n');
  const chrome = await launchChrome({ headful, extension: dist });
  let ok = false;
  try {
    const page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.navigate', { url: 'https://play.pokemonshowdown.com/' });
    await page.waitFor('window.app && app.socket && app.socket.readyState === 1 && window.encoreable && window.__rngPanelLoaded', 45000);
    await declineConsent(page);

    const opened = await page.evaluate(`encoreable.openBranch({ inputLog: ${JSON.stringify(original)}, turn: ${TURN}, source: 'rng check' })`);
    const [p1, p2] = opened.rooms;
    await page.evaluate(`app.focusRoom(${JSON.stringify(p1)})`);
    await page.waitFor(`app.rooms[${JSON.stringify(p1)}].battle.atQueueEnd && document.querySelector('#room-${p1} button[name=chooseMove]')`, 20000);
    const scope = `#room-${p1}`;

    // Every row: each move of the Pokemon choosing first, then both active Pokemon.
    let rows = 0;
    let armed = 0;
    const rolls = [];
    const moves = await page.evaluate(`document.querySelectorAll('${scope} .battle-controls button[name=chooseMove]').length`);
    for (let i = 0; i < moves; i++) {
      const r = await armAll(page, `${scope} .battle-controls button[name=chooseMove]`, i, `move ${i + 1}`);
      rows += r.rows; armed += r.armed; rolls.push(...r.rolls);
      console.log(`  move ${i + 1}: ${r.armed}/${r.rows} rows armed (${r.labels.join(', ')})${r.rolls.length ? ` - roll readouts ${r.rolls.join(', ')}` : ''}`);
    }
    for (let i = 0; i < 2; i++) {
      const r = await armAll(page, `${scope} [data-tooltip^="activepokemon|0|${i}"]`, 0, `active ${i}`);
      rows += r.rows; armed += r.armed;
      console.log(`  active Pokemon ${i + 1}: ${r.armed}/${r.rows} rows armed (${r.labels.join(', ')})`);
    }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    await sleep(800);
    const badge = await page.evaluate(`(document.querySelector('${scope} .rng-badge') || {}).textContent || ''`);
    const n = opened.n;
    const before = JSON.parse((await page.evaluate(`encoreable.rng(${n}, 'state')`)).global[0].replace(/^\|queryresponse\|rng\|/, ''));
    console.log(`  ${armed} of ${rows} rows armed through the panel; the engine holds ${before.rules.length} rule(s); the controls badge says "${badge.trim()}"`);

    // Play the turn: each side's first move at its first target.
    for (const room of [p1, p2]) {
      await page.evaluate(`app.focusRoom(${JSON.stringify(room)})`);
      await sleep(400);
      for (let k = 0; k < 6; k++) {
        const sel = `#room-${room} .battle-controls`;
        await stepOff(page);
        const hit = await click(page, `${sel} button[name=chooseMoveTarget]:not([disabled])`)
          || await click(page, `${sel} button[name=chooseMove]:not([disabled])`)
          || await click(page, `${sel} button[name=chooseSwitch]`);
        if (!hit) break;
        if (verbose) console.log(`    ${room.slice(-2)} clicked ${hit.text}`);
        await sleep(300);
      }
      if (verbose) {
        console.log(`    ${room.slice(-2)} controls: ${await page.evaluate(`(document.querySelector('#room-${room} .battle-controls') || {}).innerText?.replace(/\\s+/g, ' ').slice(0, 120)`)}`);
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(os.tmpdir(), `encoreable-rng-${room.slice(-2)}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    await sleep(1500);

    const after = JSON.parse((await page.evaluate(`encoreable.rng(${n}, 'state')`)).global[0].replace(/^\|queryresponse\|rng\|/, ''));
    const played = await page.evaluate(`encoreable.exportLog(${n})`);

    // The same input log in Node, through the same rng-command.js.
    const stream = new BattleStream({ keepAlive: true });
    const drain = (async () => { for await (const c of stream) void c; })();
    for (const line of played.inputLog) await stream.write(line);
    const node = rngEngine.snapshot(stream.battle);
    await stream.writeEnd();
    await drain;

    const fired = r => `#${r.id} ${r.text}: matched ${r.matched}, forced ${r.forced}`;
    const pageRules = after.rules.map(fired);
    const nodeRules = node.rules.map(fired);
    const same = JSON.stringify(pageRules) === JSON.stringify(nodeRules) && after.forced === node.forced && after.draws === node.draws;
    const firedCount = after.rules.filter(r => r.forced > 0).length;
    console.log(`  turn ${played.turn}: ${firedCount} of ${after.rules.length} rules forced a draw, ${after.forced} draws forced of ${after.draws}`);
    console.log(`  Node, same input log: ${node.rules.filter(r => r.forced > 0).length} rules forced, ${node.forced} of ${node.draws} draws - ${same ? 'identical rule by rule' : 'DIFFERENT'}`);
    if (!same) {
      for (let i = 0; i < Math.max(pageRules.length, nodeRules.length); i++) {
        if (pageRules[i] !== nodeRules[i]) console.log(`    page ${pageRules[i]}\n    node ${nodeRules[i]}`);
      }
    }

    const tmp = path.join(os.tmpdir(), `encoreable-rng-${process.pid}.log.json`);
    fs.writeFileSync(tmp, JSON.stringify(played));
    const verdict = await verifyBranch({ original, turn: TURN, playedFile: tmp });
    fs.rmSync(tmp, { force: true });
    console.log(`  verify-branch: ${verdict.ok ? 'VERIFIED' : 'NOT VERIFIED'} (${verdict.added.length} new line(s), ${verdict.added.filter(l => l.startsWith('>rng')).length} of them >rng)`);

    // A real battle room's tooltips stay vanilla.
    const vanilla = await page.evaluate(`window.__rngPanelRooms('battle-gen9championsvgc2026regmb-2689618002') === false && window.__rngPanelRooms(${JSON.stringify(p1)}) === true`);
    console.log(`  panel serves fake rooms only: ${vanilla ? 'yes' : 'NO'}`);

    ok = rows > 0 && armed === rows && before.rules.length === rows && rolls.every(Boolean) && same && firedCount > 0 && verdict.ok && vanilla;
    page.close();
  } finally {
    await chrome.close();
  }
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}
