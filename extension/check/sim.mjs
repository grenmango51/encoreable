/**
 * Step 1 - the simulator in the browser (`docs/extension.md` 5).
 *
 * Every recording under `recordings/` is re-simulated twice: in Node, exactly
 * as `npm run replay` does, and in a page, inside the Worker the extension
 * ships, started the way the extension starts it (fetch, blob, `new Worker`).
 * The two must agree byte for byte - the input log exactly, the debug log
 * exactly apart from `|t:|` wall-clock ticks.
 *
 * `npm run replay`'s own two verdicts - the input log round-trips, and the
 * re-simulated protocol matches what the server logged - are reported beside
 * each recording. They are properties of the recording, so they come out the
 * same in both places; only the Node-versus-page comparison decides the check.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { connect, launchChrome, serveStatic } from './harness.mjs';
import { listLogFilesIn, posix } from '../../scripts/lib/recordings.mjs';
import { battleLines, firstDivergence } from '../../scripts/lib/protocol.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');
require('../../scripts/server/rng-command.js').teachStream(BattleStream);

/** `resimulate` in `scripts/local-replay.mjs`. */
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

const PAGE = `<!doctype html><meta charset="utf-8"><title>sim check</title>
<script>
window.__simReady = (async () => {
  const source = await (await fetch('/sim-worker.js')).text();
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  const pending = new Map();
  let next = 0;
  await new Promise((resolve, reject) => {
    worker.onerror = e => reject(new Error(e.message));
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.push === 'ready') return resolve();
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
    };
  });
  window.__sim = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
  return true;
})();
</script>`;

const withoutTicks = log => (Array.isArray(log) ? log : String(log).split('\n')).filter(l => !l.startsWith('|t:|'));

export async function run({ root, dist, headful, verbose }) {
  const files = listLogFilesIn(path.join(root, 'recordings')).sort();
  if (!files.length) {
    console.log('  no recordings under recordings/');
    return false;
  }

  const server = await serveStatic(dist, { '/check.html': PAGE });
  const chrome = await launchChrome({ headful });
  let failures = 0;
  try {
    const page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.navigate', { url: `${server.url}/check.html` });
    const t0 = Date.now();
    await page.waitFor('window.__simReady && window.__simReady.then(() => true)', 60000);
    console.log(`  Worker up in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(fs.statSync(path.join(dist, 'sim-worker.js')).size / 1048576).toFixed(1)} MB)\n`);

    for (const file of files) {
      const name = posix(root, file);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const recorded = Array.isArray(data.inputLog) ? data.inputLog.join('\n') : String(data.inputLog || '');
      let node;
      let page_;
      try {
        node = await resimulate(recorded);
        page_ = await page.evaluate(`__sim('resim', ${JSON.stringify(recorded)})`);
      } catch (err) {
        failures++;
        console.log(`  [FAIL] ${name}\n         ${String(err.message).split('\n')[0]}`);
        continue;
      }

      const inputSame = node.inputLog === page_.inputLog;
      const debugDiff = firstDivergence(withoutTicks(node.debugLog), withoutTicks(page_.debugLog));
      const ok = inputSame && !debugDiff && node.turns === page_.turns && node.ended === page_.ended;
      if (!ok) failures++;

      const roundTrips = node.inputLog === recorded.trim() || node.inputLog === recorded;
      const serverDiff = data.log ? firstDivergence(battleLines(data.log), battleLines(node.debugLog)) : null;
      const replayVerdict = [
        `round-trip ${roundTrips ? 'PASS' : 'FAIL'}`,
        data.log ? `server log ${serverDiff ? `FAIL at line ${serverDiff.index}` : 'PASS'}` : 'no server log',
      ].join(', ');

      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}  turn ${page_.turns}${page_.ended ? ' ended' : ''}, ` +
        `${withoutTicks(page_.debugLog).length} log lines  (replay: ${replayVerdict})`);
      if (!inputSame) console.log('         input log differs between Node and the page');
      if (debugDiff) {
        console.log(`         debug log differs at line ${debugDiff.index}`);
        console.log(`         node: ${debugDiff.expected}`);
        console.log(`         page: ${debugDiff.actual}`);
      }
      if (verbose && serverDiff) {
        console.log(`         server: ${serverDiff.expected}`);
        console.log(`         resim:  ${serverDiff.actual}`);
      }
    }
    page.close();
  } finally {
    await chrome.close();
    await server.close();
  }

  console.log(`\n  ${files.length - failures} of ${files.length} recordings re-simulate identically in the page and in Node`);
  return failures === 0;
}
