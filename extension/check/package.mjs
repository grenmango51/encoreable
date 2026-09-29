/**
 * Step 5 - packaging (`docs/extension.md` 5).
 *
 * Statically, `extension/dist/` must be a Manifest V3 extension whose every
 * referenced file is in the package; hold only code, JSON, HTML and licence
 * text (no sprites, sounds or other Nintendo assets); load no code from a
 * remote URL; and carry none of the Showdown client, which is AGPLv3 and comes
 * from the live page instead.
 *
 * Then a copy of the folder, somewhere outside the checkout, is loaded unpacked
 * into a Chrome profile made for this run and used end to end with nothing else
 * running: no local server, no Node in the loop. The recordings page lists an
 * empty store, and the play page opens a branch and plays a turn in the Worker.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { connect, declineConsent, launchChrome } from './harness.mjs';

const ALLOWED_EXT = new Set(['.js', '.json', '.html', '.txt']);
const RECORDING = 'recordings/local/scripted/gen9championsvgc2026regmb-25.log.json';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function staticChecks(dist) {
  const problems = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) problems.push(`manifest_version is ${manifest.manifest_version}, not 3`);

  const referenced = new Set();
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) referenced.add(js);
  if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
  for (const war of manifest.web_accessible_resources || []) for (const r of war.resources || []) referenced.add(r);
  const files = walk(dist).map(f => path.relative(dist, f).split(path.sep).join('/'));
  for (const f of files.filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dist, f), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const src = /\bsrc="([^"]+)"/.exec(m[1]);
      if (!src) { problems.push(`${f}: an inline <script> - Manifest V3 forbids it`); continue; }
      if (/^[a-z]+:\/\//i.test(src[1])) problems.push(`${f}: loads ${src[1]}`);
      referenced.add(src[1]);
    }
  }
  for (const r of referenced) if (!files.includes(r)) problems.push(`manifest or page references ${r}, which is not in the package`);

  const wrongKind = files.filter(f => !ALLOWED_EXT.has(path.extname(f)));
  for (const f of wrongKind) problems.push(`${f}: not code, JSON, HTML or a licence - assets are not shipped`);

  const REMOTE_CODE = /(importScripts|import\s*\(|new\s+Worker\s*\(|\.src\s*=|appendChild\([^)]*script)\s*['"`]?\s*https?:\/\//;
  const CLIENT_CODE = /GNU Affero|AGPL|\bclass BattleScene\b|\bvar BattleScene = |\bclass BattleTooltips\b|\bvar BattleTooltips = |\bclass BattleLog\b/;
  const urls = new Map();
  for (const f of files.filter(x => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dist, f), 'utf8');
    if (REMOTE_CODE.test(text)) problems.push(`${f}: loads code from a remote URL`);
    const client = CLIENT_CODE.exec(text);
    if (client) problems.push(`${f}: carries Showdown client code ("${client[0]}")`);
    for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) urls.set(m[0], (urls.get(m[0]) || 0) + 1);
  }
  const licences = ['licenses/pokemon-showdown.txt', 'licenses/ts-chacha20.txt'].filter(l => !files.includes(l));
  for (const l of licences) problems.push(`${l} is missing - the embedded code's MIT notice has to ship with it`);

  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(dist, f)).size, 0);
  return { manifest, files, problems, urls, bytes };
}

export async function run({ root, dist, headful }) {
  const s = staticChecks(dist);
  console.log(`  Manifest V${s.manifest.manifest_version}, ${s.files.length} files, ${(s.bytes / 1048576).toFixed(1)} MB: ${s.files.join(', ')}`);
  console.log(`  permissions: ${(s.manifest.permissions || []).join(', ') || 'none'}; content scripts on ${[...new Set((s.manifest.content_scripts || []).flatMap(c => c.matches))].join(', ')}`);
  console.log(`  URL hosts named in the code (data and links, none loaded as code): ${[...s.urls.keys()].map(u => u.replace(/^https?:\/\//, '')).sort().join(', ')}`);
  for (const p of s.problems) console.log(`  [FAIL] ${p}`);
  if (!s.problems.length) console.log('  [PASS] every referenced file is in the package; no assets, no remote code, no client code; licences shipped');

  // A copy outside the checkout, so nothing can be reached through the repo.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'encoreable-package-'));
  fs.cpSync(dist, copy, { recursive: true });
  const chrome = await launchChrome({ headful, extension: copy });
  let loaded = false;
  try {
    const localRequests = [];
    const created = await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?chrome-extension://${chrome.extensionId}/recordings.html`, { method: 'PUT' })).json();
    const list = await connect(chrome.port, created);
    await list.send('Runtime.enable');
    const empty = await list.waitFor(`!document.getElementById('empty').hidden && document.querySelectorAll('#rows tr').length === 0`, 15000).catch(() => false);
    list.close();

    const page = await connect(chrome.port, 'about:blank');
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    page.on('Network.requestWillBeSent', (p) => { if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(p.request.url)) localRequests.push(p.request.url); });
    await page.send('Page.navigate', { url: 'https://play.pokemonshowdown.com/' });
    await page.waitFor('window.app && window.encoreable', 45000);
    await declineConsent(page);
    const recording = JSON.parse(fs.readFileSync(path.join(root, RECORDING), 'utf8'));
    const played = await page.evaluate(`(async () => {
      const o = await encoreable.openBranch({ inputLog: ${JSON.stringify(recording.inputLog.join('\n'))}, turn: 2, source: 'package check' });
      const b = encoreable.branches()[0];
      const before = (await encoreable.exportLog(b.n)).inputLog.length;
      // Both sides choose through the client's own send path, as its buttons do.
      for (const id of o.rooms) {
        const room = app.rooms[id];
        await new Promise(r => { const t = setInterval(() => { if (room.request) { clearInterval(t); r(); } }, 100); });
        app.send('/choose default|' + room.request.rqid, id);
      }
      // A turn is played once both choices are committed to the input log;
      // a faint can leave the turn number where it was, waiting on a switch.
      let log;
      for (let i = 0; i < 50; i++) {
        log = await encoreable.exportLog(b.n);
        if (log.inputLog.length >= before + 2) break;
        await new Promise(r => setTimeout(r, 100));
      }
      return { from: o.turn, committed: log.inputLog.length - before, turn: log.turn, rooms: o.rooms.filter(r => !!app.rooms[r]).length };
    })()`);
    loaded = !!chrome.extensionId && empty && played.rooms === 2 && played.from === 2 && played.committed >= 2 && localRequests.length === 0;
    console.log(`  [${loaded ? 'PASS' : 'FAIL'}] loaded unpacked from ${copy} into a new profile as ${chrome.extensionId}: ` +
      `recordings page ${empty ? 'lists an empty store' : 'did NOT render'}; ${RECORDING} branched at turn ${played.from} ` +
      `in ${played.rooms} rooms, and turn ${played.from} was played (${played.committed} choices committed); ` +
      `${localRequests.length} request(s) to a local server`);
    page.close();
  } finally {
    await chrome.close();
    fs.rmSync(copy, { recursive: true, force: true });
  }
  return !s.problems.length && loaded;
}
