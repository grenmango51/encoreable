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
 * The two are games 1 and 2 of one best-of-3, and the `alt` fixture holds the
 * real Stat Points. Rebuilt again with p2's inferred, in Node and in the page,
 * the Worker's combination of the two games has to be Node's, keep every real
 * spread, and refuse a game whose sheet differs; and game 2, opened from the
 * store beside game 1, has to open combined with it.
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
import { combineGames } from '../../scripts/lib/inference/infer.mjs';
import { containsSpread, maskKeys, rangesOfValues, unpackKnowledge, valuesOf } from '../../scripts/lib/inference/knowledge.mjs';
import { posix } from '../../scripts/lib/recordings.mjs';

const require = createRequire(import.meta.url);

const EXPECTED = [
  { match: /hoaianhgianlan\.html$/, turns: 10 },
  { match: /hoaianhgianlan \(1\)\.html$/, turns: 6 },
];

function nodeReconstruct(root, file, more = []) {
  const out = path.join(os.tmpdir(), `encoreable-s4-${process.pid}-${path.basename(file).replace(/\W+/g, '_')}.json`);
  const started = Date.now();
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'local-reconstruct.mjs'), '--from', file, '--teams', 'alt', ...more, '--out', out], {
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

/** What `combineGames` reads of a recording. */
const asGame = (name, rec) => ({
  recording: name, bestOf: rec.bestOf, complete: rec.complete, p1: rec.p1, p2: rec.p2, format: rec.format, inference: rec.inference,
});

/** Each stat's range as the Stat Point block prints it, from a packed surviving set. */
function printedRanges(packed) {
  const kn = unpackKnowledge(packed);
  const r = rangesOfValues(valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties).values);
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(s => (!r[s] ? 'none' : r[s].min === r[s].max ? `${r[s].min}` : `${r[s].min}–${r[s].max}`));
}

/** Games 1 and 2 of one best-of-3, p2's Stat Points inferred, combined in Node, in the Worker and through the store. */
async function bestOfSet(chrome, page, root) {
  const { TEAM_SETS } = require(path.join(root, 'scripts', 'fixtures', 'teams.js'));
  const { Teams, toID } = require('pokemon-showdown');
  // The fixture names a Mega by its Mega forme, the sheet by its base species.
  const sameSpecies = (a, b) => toID(a).startsWith(toID(b)) || toID(b).startsWith(toID(a));
  const dir = path.join(root, 'recordings', 'showdown', 'full-sheets');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.join(dir, f));
  const games = [EXPECTED[0], EXPECTED[1]].map(e => files.find(f => e.match.test(f)));
  if (games.some(f => !f)) {
    console.log('  [FAIL] the two games of the set are not both in recordings/showdown/full-sheets/');
    return false;
  }
  let ok = true;
  const built = [];
  for (const file of games) {
    const node = nodeReconstruct(root, file, ['--infer', 'p2']);
    const browser = await page.evaluate(`encoreable.call('reconstructReplay', {
      source: { name: ${JSON.stringify(path.basename(file))}, html: ${JSON.stringify(fs.readFileSync(file, 'utf8'))} },
      teams: [{ text: ${JSON.stringify(TEAM_SETS.alt.p1)} }, null], infer: 'p2', threads: navigator.hardwareConcurrency,
    })`);
    const rec = browser.recording;
    const pass = rec.complete && node.data.complete && JSON.stringify(rec.bestOf) === JSON.stringify(node.data.bestOf) && !!rec.bestOf;
    if (!pass) ok = false;
    built.push({ file, node: node.data, page: rec, name: `reconstructed-${path.basename(file).replace(/\.html$/, '')}` });
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${posix(root, file)}, p2 inferred: page ${rec.complete ? 'MATCH' : 'PARTIAL'} in ${browser.seconds.toFixed(1)}s, ` +
      `node ${node.data.complete ? 'MATCH' : 'PARTIAL'}; game ${rec.bestOf?.game} of ${rec.bestOf?.set} in both`);
  }
  const [one, two] = built;

  // The Worker's combination is Node's, and keeps every real spread.
  const node = combineGames(asGame(two.name, two.node), [asGame(one.name, one.node)]);
  const combined = await page.evaluate(`encoreable.call('combineSet', ${JSON.stringify(asGame(two.name, two.page))}, [${JSON.stringify(asGame(one.name, one.page))}])`);
  const real = Teams.unpack(Teams.pack(Teams.import(TEAM_SETS.alt.p2)));
  const same = JSON.stringify(combined.inference.pokemon.map(p => p.knowledge)) === JSON.stringify(node.inference.pokemon.map(p => p.knowledge));
  let kept = 0;
  for (const p of combined.inference.pokemon) {
    const alone = two.page.inference.pokemon.find(q => q.id === p.id);
    const truth = real.find(s => sameSpecies(s.species, p.species));
    const survives = !!truth && containsSpread(unpackKnowledge(p.knowledge), truth.evs);
    if (survives) kept++;
    console.log(`         ${p.species.padEnd(12)} game 2 alone ${alone.spreads.toLocaleString('en').padStart(11)}, with game 1 ${p.spreads.toLocaleString('en').padStart(11)}` +
      `  ${printedRanges(p.knowledge).join(' / ')}${survives ? '  (real spread survives)' : '  REAL SPREAD ELIMINATED'}`);
  }
  const combinedOk = same && kept === combined.inference.pokemon.length && JSON.stringify(combined.inference.combined?.games) === '[1,2]';
  if (!combinedOk) ok = false;
  console.log(`  [${combinedOk ? 'PASS' : 'FAIL'}] game 2 combined with game 1 in the Worker: surviving sets ${same ? 'identical to' : 'DIFFERENT from'} Node's, ` +
    `${kept}/${combined.inference.pokemon.length} real spreads survive`);

  // A game that is not certainly the same team is left out.
  const otherItem = { ...asGame(one.name, one.page), bestOf: { ...one.page.bestOf, sheets: [one.page.bestOf.sheets[0], one.page.bestOf.sheets[1].replace(/\|Blastoisinite\|/, '|Leftovers|')] } };
  const otherSet = { ...asGame(one.name, one.page), bestOf: { ...one.page.bestOf, set: `${one.page.bestOf.set}0` } };
  const partial = { ...asGame(one.name, one.page), complete: false };
  const refusals = [];
  for (const [label, other] of [['an item changed on a sheet', otherItem], ['another set', otherSet], ['a game that did not rebuild', partial]]) {
    const r = await page.evaluate(`encoreable.call('combineSet', ${JSON.stringify(asGame(two.name, two.page))}, [${JSON.stringify(other)}])`);
    refusals.push(!r.combined.length && !r.inference.combined);
    console.log(`  [${refusals[refusals.length - 1] ? 'PASS' : 'FAIL'}] game 1 with ${label}: ${r.combined.length ? 'COMBINED' : `not combined${r.skipped[0] ? ` - ${r.skipped[0].reason}` : ''}`}`);
  }
  if (refusals.some(x => !x)) ok = false;

  // Through the store: game 2 opened beside game 1 opens combined with it.
  const known = await targetIds(chrome.port);
  const created = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?chrome-extension://${chrome.extensionId}/recordings.html`, { method: 'PUT' })).json();
  const store = await connect(chrome.port, created);
  await store.send('Runtime.enable');
  await store.waitFor(`document.readyState === 'complete' && !!document.getElementById('import')`, 15000);
  for (const g of built) {
    await store.evaluate(`chrome.runtime.sendMessage({ op: 'put', name: ${JSON.stringify(g.name)}, source: 'check', text: ${JSON.stringify(`${JSON.stringify(g.page, null, 2)}\n`)} })`);
  }
  await store.evaluate(`chrome.runtime.sendMessage({ op: 'open', recordingId: ${JSON.stringify(two.name)}, turn: 2 })`);
  const tab = await connect(chrome.port, await newTarget(chrome.port, known, 'https://play.pokemonshowdown.com/'));
  await tab.send('Runtime.enable');
  const got = await branchOrReason(tab, 60000).catch(err => ({ banner: err.message }));
  const block = got.branch ? await tab.evaluate(`(() => {
    const el = app.rooms[${JSON.stringify(got.branch.rooms[0])}].el.querySelector('.sp-summary');
    return el && { title: el.querySelector('strong').textContent, rows: [...el.querySelectorAll('tr')].slice(1).map(tr => [...tr.children].slice(1).map(td => td.textContent.trim())) };
  })()`) : null;
  const want = combined.inference.pokemon.map(p => printedRanges(p.knowledge));
  const opened = !!block && JSON.stringify(got.branch.combined?.games) === '[1,2]' && JSON.stringify(block.rows) === JSON.stringify(want);
  if (!opened) ok = false;
  console.log(`  [${opened ? 'PASS' : 'FAIL'}] game 2 opened from the store: ${got.branch ? `games ${JSON.stringify(got.branch.combined?.games)} combined, block "${block?.title}", ` +
    `its ranges ${block && JSON.stringify(block.rows) === JSON.stringify(want) ? 'the combined ones' : 'NOT the combined ones'}` : `no branch: ${got.banner}`}`);
  console.log(`         banner: ${got.banner}`);
  tab.close();
  store.close();
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

    console.log('\n  A best-of-3 set - its two games combined\n');
    if (!await bestOfSet(chrome, page, root)) ok = false;

    console.log('\n  Ways in\n');
    if (!await recordingsPage(chrome, root)) ok = false;
    if (!await replayButton(chrome)) ok = false;
    page.close();
  } finally {
    await chrome.close();
  }
  return ok;
}
