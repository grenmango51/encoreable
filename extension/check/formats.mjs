// Built-extension check for admitted formats. `npm run extension -- --check`
// runs this once `formats` is listed in CHECKS; this file does not register
// itself. The Node harness in scripts/lib/format-regression.mjs is the
// reference. One headless Chrome then compares resim, branch, choice and
// spreadPanel, and requires Gen 8 and standard-format inference to be rejected.

import fs from 'node:fs';
import path from 'node:path';
import { battleLines, firstDivergence } from '../../scripts/lib/protocol.mjs';
import { workerCases } from '../../scripts/lib/format-regression.mjs';
import { connect, launchChrome, serveStatic } from './harness.mjs';

const PAGE = `<!doctype html><meta charset="utf-8"><title>format check</title>
<script>
window.__simReady = (async () => {
  const source = await (await fetch('/sim-worker.js')).text();
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  const pending = new Map();
  let next = 0;
  await new Promise((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message || 'worker failed'));
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.push === 'ready') return resolve();
      const waiting = pending.get(msg.id);
      if (!waiting) return;
      pending.delete(msg.id);
      clearTimeout(waiting.timer);
      msg.error ? waiting.reject(new Error(msg.error)) : waiting.resolve(msg.result);
    };
  });
  window.__sim = (method, ...rest) => {
    const timeoutMs = rest.length && typeof rest[rest.length - 1] === 'number' ? rest.pop() : 20000;
    const args = rest;
    return new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('worker timed out'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, args });
    });
  };
  return true;
})();
</script>`;

function linesOf(log) {
  return battleLines(String(log || '').split('\n'));
}

function sameLog(label, expected, actual) {
  const diff = firstDivergence(expected, actual);
  if (!diff) return '';
  return `${label} diverged at line ${diff.index}\n expected ${diff.expected}\n actual   ${diff.actual}`;
}

function choiceError(result, side) {
  const lines = result?.frames?.[side] || [];
  return lines.find(line => String(line).startsWith('|error|')) || '';
}

async function call(page, method, args, timeoutMs = 20000) {
  return page.evaluate(
    `window.__sim(${JSON.stringify(method)}, ...${JSON.stringify(args)}, ${Number(timeoutMs)})`,
  );
}

async function playRounds(page, key, view, rounds) {
  let current = view;
  for (const round of rounds) {
    for (const side of ['p1', 'p2']) {
      const choice = round[side];
      if (!choice) continue;
      const requestLine = current.sides?.[side]?.request;
      if (!requestLine) throw new Error(`no ${side} request while choosing ${choice}`);
      const rqid = JSON.parse(requestLine.slice(requestLine.indexOf('{'))).rqid;
      const chosen = await call(page, 'choose', [key, side, `${choice}|${rqid}`]);
      const error = choiceError(chosen, side);
      if (error) throw new Error(error);
      current = await call(page, 'view', [key]);
    }
  }
  return current;
}

async function compareBranch(page, label, inputLog, branch) {
  const opened = await call(page, 'branch', [inputLog, branch.turn, { seed: branch.seed }]);
  if (opened.inputLog.trim() !== branch.inputLog.trim()) {
    throw new Error(`${label} branch input does not match the Node cut`);
  }
  const cut = await call(page, 'resim', [opened.inputLog]);
  const cutDiff = sameLog(`${label} branch resim`, branch.lines, linesOf(cut.debugLog));
  if (cutDiff) throw new Error(cutDiff);
  const after = await playRounds(page, opened.key, opened, branch.rounds);
  if (after.inputLog.trim() !== branch.continuedInput.trim()) {
    throw new Error(`${label} continuation choices do not match Node`);
  }
  const continued = await call(page, 'resim', [after.inputLog]);
  const continuedDiff = sameLog(`${label} continuation`, branch.continuedLines, linesOf(continued.debugLog));
  if (continuedDiff) throw new Error(continuedDiff);
  await call(page, 'close', [opened.key]);
}

async function compareBattle(page, label, inputLog, lines, branches) {
  const played = await call(page, 'resim', [inputLog]);
  if (played.inputLog.trim() !== inputLog.trim()) throw new Error(`${label} input round-trip changed`);
  const logDiff = sameLog(`${label} resim`, lines, linesOf(played.debugLog));
  if (logDiff) throw new Error(logDiff);
  for (const branch of branches) await compareBranch(page, `${label} turn ${branch.turn}`, inputLog, branch);
}

async function expectRejected(page, method, args, pattern, timeoutMs = 12000) {
  const result = await page.evaluate(`window.__sim(${JSON.stringify(method)}, ...${JSON.stringify(args)}, ${Number(timeoutMs)}).then(
    () => ({ ok: true, error: '' }),
    (err) => ({ ok: false, error: String(err && err.message || err) })
  )`);
  if (result.ok || !pattern.test(result.error)) {
    const why = result.ok ? 'accepted a rejected format' : `failed as "${result.error.split('\n')[0]}"`;
    throw new Error(`${method} ${why}`);
  }
}

/**
 * @param {{root: string, dist: string, headful?: boolean, verbose?: boolean}} opts
 */
export async function run({ root, dist, headful, verbose }) {
  let reference;
  try {
    console.log('Node reference');
    reference = await workerCases({ root, say: console.log });
  } catch (err) {
    console.log(`  [FAIL] node reference\n         ${String(err.message || err).split('\n')[0]}`);
    return false;
  }
  const workerFile = path.join(dist, 'sim-worker.js');
  if (!fs.existsSync(workerFile)) {
    console.log('  [FAIL] built worker\n         extension/dist/sim-worker.js is missing');
    return false;
  }
  const server = await serveStatic(dist, { '/check.html': PAGE });
  const chrome = await launchChrome({ headful: !!headful });
  let page;
  try {
    page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    if (verbose) {
      page.on('Runtime.consoleAPICalled', (params) => {
        const text = (params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
        console.log(`page ${params.type}: ${text}`);
      });
    }
    await page.send('Page.navigate', { url: `${server.url}/check.html` });
    await page.waitFor('window.__simReady && window.__simReady.then(() => true)', 60000);
    for (const item of reference.cases) {
      await compareBattle(page, item.formatid, item.inputLog, item.lines, item.branches);
      const opened = await call(page, 'open', [item.inputLog]);
      const panel = await call(page, 'spreadPanel', [opened.key, null]);
      await call(page, 'close', [opened.key]);
      if (panel !== null) {
        throw new Error(`${item.formatid} spreadPanel returned a panel; a standard format must not feed the Champions SP UI`);
      }
      console.log(`  [PASS] worker ${item.formatid}`);
    }
    for (const item of reference.preserved) {
      await compareBattle(page, item.file, item.inputLog, item.lines, item.branch ? [item.branch] : []);
      console.log(`  [PASS] worker ${item.file}`);
    }
    const champions = await call(page, 'open', [reference.champions.inputLog]);
    const championsPanel = await call(page, 'spreadPanel', [champions.key, null]);
    await call(page, 'close', [champions.key]);
    if (!championsPanel?.pokemon?.length) throw new Error('champions spreadPanel did not return the SP panel');
    console.log('  [PASS] worker champions spread panel');

    const gen8 = `>start ${JSON.stringify({ formatid: 'gen8ou', seed: 'sodium,0123456789abcdeffedcba9876543210' })}\n`;
    await expectRejected(page, 'resim', [gen8], /Unsupported format/);
    await expectRejected(page, 'open', [gen8], /Unsupported format/);
    const custom = `>start ${JSON.stringify({
      formatid: 'gen9vgc2024regg', customRules: ['HP Percentage Mod'], seed: 'sodium,0123456789abcdeffedcba9876543210',
    })}\n`;
    await expectRejected(page, 'resim', [custom], /overrides of the supported format profile/);
    await expectRejected(page, 'reconstructReplay', [{
      source: { name: 'vgc-format-check.html', log: reference.rejection.protocol.join('\n') },
      teams: reference.rejection.packed.map(packed => ({ packed })),
    }], /Unsupported capability knownTeamReconstruction/);
    await expectRejected(page, 'reconstructReplay', [{
      source: { name: 'vgc-inference-check.html', log: reference.rejection.protocol.join('\n') },
      teams: reference.rejection.packed.map(packed => ({ packed })),
      infer: 'p1',
    }], /Unsupported capability openSpreadInference/);
    const wrongGen = reference.champions.protocol.map(line => (line.startsWith('|gen|') ? '|gen|8' : line));
    await expectRejected(page, 'reconstructReplay', [{
      source: { name: 'champions-wrong-gen.html', log: wrongGen.join('\n') },
      teams: reference.champions.packed.map(packed => ({ packed })),
    }], /Replay generation 8 disagrees/);
    console.log('  [PASS] worker rejections');
    return true;
  } catch (err) {
    console.log(`  [FAIL] worker\n         ${String(err.message || err).split('\n')[0]}`);
    return false;
  } finally {
    if (page) page.close();
    await chrome.close();
    await server.close();
  }
}
