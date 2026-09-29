/**
 * Step 3 - entry points (`docs/extension.md` 5).
 *
 * S4 in the browser: each saved Bo3 replay in `recordings/showdown/full-sheets/`
 * is rebuilt twice from the same inputs - the replay page and the `alt` fixture
 * teams - once by `npm run reconstruct` in Node and once by the extension's
 * Worker on the live play.pokemonshowdown.com, probe threads and all. Both must
 * MATCH at the turn counts in `engineering.md` 7.4, and the two input logs must
 * be the same bytes.
 *
 * Then the ways in: a recording is imported into the extension's store and
 * exported back byte for byte, opened at a turn from the recordings page, and
 * a live replay page grows a "Play from here" button that opens the play page
 * on that replay.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

import { click, connect, declineConsent, launchChrome, sleep } from './harness.mjs';
import { posix } from '../../scripts/lib/recordings.mjs';

const require = createRequire(import.meta.url);

const EXPECTED = [
  { match: /hoaianhgianlan\.html$/, turns: 10 },
  { match: /hoaianhgianlan \(1\)\.html$/, turns: 6 },
];

function nodeReconstruct(root, file) {
  const out = path.join(os.tmpdir(), `encoreable-s4-${process.pid}-${path.basename(file).replace(/\W+/g, '_')}.json`);
  const started = Date.now();
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'local-reconstruct.mjs'), '--from', file, '--teams', 'alt', '--out', out], {
      cwd: root, stdio: 'pipe',
    });
  } catch (err) {
    // A PARTIAL result exits non-zero and still writes its file.
    if (!fs.existsSync(out)) throw new Error(`npm run reconstruct failed: ${String(err.stderr || err.message).slice(0, 300)}`);
  }
  const data = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  return { data, seconds: (Date.now() - started) / 1000 };
}

async function s4(page, root) {
  const { TEAM_SETS } = require(path.join(root, 'scripts', 'fixtures', 'teams.js'));
  const dir = path.join(root, 'recordings', 'showdown', 'full-sheets');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.join(dir, f)).sort();
  let ok = files.length === EXPECTED.length;
  for (const file of files) {
    const name = posix(root, file);
    const expected = EXPECTED.find(e => e.match.test(file));
    const node = nodeReconstruct(root, file);
    const html = fs.readFileSync(file, 'utf8');
    const browser = await page.evaluate(`encoreable.call('reconstructReplay', {
      source: { name: ${JSON.stringify(path.basename(file))}, html: ${JSON.stringify(html)} },
      teams: [{ text: ${JSON.stringify(TEAM_SETS.alt.p1)} }, { text: ${JSON.stringify(TEAM_SETS.alt.p2)} }],
      threads: navigator.hardwareConcurrency,
    })`);
    const r = browser.report;
    const sameLog = JSON.stringify(browser.recording.inputLog) === JSON.stringify(node.data.inputLog);
    const pass = browser.ok && r.complete && r.turns === expected?.turns && node.data.complete && sameLog;
    if (!pass) ok = false;
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`);
    console.log(`         page: ${r.complete ? 'MATCH' : `PARTIAL through turn ${r.verifiedThroughTurn}`}  ${r.turns} turns  ${browser.seconds.toFixed(1)}s  ` +
      `forced ${r.forcedDraws}/${r.drawsSeen} draws, input log replays to the same battle: ${browser.selfConsistent ? 'yes' : 'NO'}`);
    console.log(`         node: ${node.data.complete ? 'MATCH' : 'PARTIAL'}  ${node.data.turns} turns  (${node.seconds.toFixed(1)}s including start-up)` +
      `  - input logs ${sameLog ? 'identical' : 'DIFFER'}; expected ${expected?.turns} turns`);
    for (const d of r.diffs) console.log(`         turn ${d.turn}: observed ${d.expected}  rebuilt ${d.actual}`);
  }
  return ok;
}

const IMPORT = 'recordings/local/branched/gen9championsvgc2026regmb-199.log.json';
const IMPORT_TURN = 3;

/** A page target that was not there before, whose URL starts with `match`. */
async function newTarget(port, known, match, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const found = list.find(t => t.type === 'page' && !known.has(t.id) && t.url.startsWith(match));
    if (found) return found;
    await sleep(250);
  }
  throw new Error(`no new tab on ${match} appeared`);
}
const targetIds = async port => new Set((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(t => t.id));

/** Waits for a branch in a play tab, or the banner's explanation of why there is none. */
async function branchOrReason(tab, ms) {
  return tab.waitFor(`(() => {
    const b = window.encoreable && encoreable.branches()[0];
    const banner = document.getElementById('encoreable-banner');
    const text = banner ? banner.innerText : '';
    if (b) {
      const room = app.rooms[b.rooms[0]];
      if (room && room.battle && room.request) return { branch: b, turn: room.battle.turn, banner: text };
    }
    if (banner && banner.dataset.kind === 'error') return { banner: text };
    return null;
  })()`, ms);
}

async function recordingsPage(chrome, root) {
  const known = await targetIds(chrome.port);
  const created = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?chrome-extension://${chrome.extensionId}/recordings.html`, { method: 'PUT' })).json();
  const page = await connect(chrome.port, created);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('DOM.enable');
  await page.waitFor(`document.readyState === 'complete' && !!document.getElementById('import')`, 15000);

  // Import through the page's own file input, as a person would.
  const file = path.join(root, IMPORT);
  const { root: doc } = await page.send('DOM.getDocument', {});
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#import' });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [file] });
  const id = path.basename(file).replace(/\.log\.json$/, '');
  await page.waitFor(`!!document.querySelector('tr[data-id=${JSON.stringify(id)}]')`, 15000);
  const stored = await page.evaluate(`chrome.runtime.sendMessage({ op: 'get', id: ${JSON.stringify(id)} })`);
  const sameBytes = stored.ok && stored.result.text === fs.readFileSync(file, 'utf8');
  console.log(`  [${sameBytes ? 'PASS' : 'FAIL'}] imported ${posix(root, file)} through the recordings page; the store gives back ${sameBytes ? 'the same bytes' : 'DIFFERENT bytes'}`);

  // Open it at a turn with the row's own controls; a new play tab branches it.
  await page.evaluate(`document.querySelector('tr[data-id=${JSON.stringify(id)}] input[type=number]').value = '${IMPORT_TURN}'`);
  await click(page, `tr[data-id=${JSON.stringify(id)}] button.primary`);
  const tabRow = await newTarget(chrome.port, known, 'https://play.pokemonshowdown.com/');
  const tab = await connect(chrome.port, tabRow);
  await tab.send('Runtime.enable');
  const got = await branchOrReason(tab, 60000).catch(err => ({ banner: err.message }));
  const opened = !!got.branch && got.turn === IMPORT_TURN;
  console.log(`  [${opened ? 'PASS' : 'FAIL'}] Open at turn ${IMPORT_TURN} -> ${got.branch ? `a new play tab branched it at turn ${got.turn} (${got.branch.rooms.join(', ')})` : `no branch: ${got.banner}`}`);
  tab.close();
  page.close();
  return sameBytes && opened;
}

async function replayButton(chrome) {
  const list = await (await fetch('https://replay.pokemonshowdown.com/search.json?format=gen9championsvgc2026regmbbo3')).json();
  const id = list[0] && list[0].id;
  if (!id) {
    console.log('  [SKIP] no recent Champions replay on the replay server');
    return true;
  }
  const known = await targetIds(chrome.port);
  const created = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?https://replay.pokemonshowdown.com/${id}`, { method: 'PUT' })).json();
  const page = await connect(chrome.port, created);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.waitFor(`!!document.querySelector('.replay-controls')`, 30000);
  await declineConsent(page, 5000);
  const hasButton = await page.waitFor(`!!document.querySelector('#encoreable-controls button')`, 15000).catch(() => false);
  // The viewer's own Skip turn button, from team preview to turn 1.
  const skip = await page.evaluate(`(() => { const b = [...document.querySelectorAll('.replay-controls button')].find(x => /Skip turn/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
  await page.waitFor('window.battle && battle.turn >= 1', 15000).catch(() => {});
  const turn = await page.evaluate('window.battle && battle.turn');
  await click(page, '#encoreable-controls button');
  const tabRow = await newTarget(chrome.port, known, 'https://play.pokemonshowdown.com/').catch(() => null);
  const said = await page.evaluate(`(document.querySelector('#encoreable-controls small') || {}).textContent || ''`);
  if (said) console.log(`  the button says: ${said}`);
  let outcome = 'no play tab opened';
  let settled = false;
  if (tabRow) {
    const tab = await connect(chrome.port, tabRow);
    await tab.send('Runtime.enable');
    const got = await branchOrReason(tab, 240000).catch(async () => ({
      banner: `still working after 4 minutes - banner: ${await tab.evaluate(`(document.getElementById('encoreable-banner') || {}).innerText || '(none)'`).catch(() => '?')}`,
    }));
    // A replay the inference cannot follow to that turn is a known ceiling (engineering.md 7.4), said plainly.
    settled = !!got.branch || /rebuilt only through turn/.test(got.banner || '');
    outcome = got.branch ? `rebuilt and branched at turn ${got.turn}` : `not branched: ${got.banner}`;
    tab.close();
  }
  const ok = hasButton && settled;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] live replay ${id}: button ${hasButton ? 'shown' : 'MISSING'}, ` +
    `turn ${turn} on screen${skip ? '' : ' (no Skip turn button)'}, ${outcome}`);
  page.close();
  return ok;
}

export async function run({ root, dist, headful }) {
  const chrome = await launchChrome({ headful, extension: dist });
  let ok = true;
  try {
    const page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.navigate', { url: 'https://play.pokemonshowdown.com/' });
    await page.waitFor('window.app && app.socket && app.socket.readyState === 1 && window.encoreable', 45000);
    await declineConsent(page);

    console.log('  S4 - a saved ladder replay, rebuilt in the page and in Node\n');
    if (!await s4(page, root)) ok = false;

    console.log('\n  Ways in\n');
    if (!await recordingsPage(chrome, root)) ok = false;
    if (!await replayButton(chrome)) ok = false;
    page.close();
  } finally {
    await chrome.close();
  }
  return ok;
}
