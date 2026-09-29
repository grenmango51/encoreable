/**
 * What every extension check drives: a throwaway Chrome, a DevTools Protocol
 * connection to it, and a loopback static server.
 *
 * The Chrome profile is a fresh temporary directory each run and is deleted on
 * close, so a check never sees the operator's own browser state.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { findBrowser } from '../../scripts/lib/browser.mjs';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * The browser-level DevTools connection over `--remote-debugging-pipe`: fd 3
 * in, fd 4 out, one NUL-terminated JSON message each. Chrome 137+ ignores
 * `--load-extension` in branded builds, and `Extensions.loadUnpacked` is only
 * accepted on a pipe, so this is how a check installs the built extension.
 */
function pipeClient(proc) {
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let buf = '';
  let id = 0;
  const waiting = new Map();
  inp.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const w = msg.id && waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      if (msg.error) w.rej(new Error(msg.error.message));
      else w.res(msg.result);
    }
  });
  inp.on('error', () => {});
  out.on('error', () => {});
  return {
    send: (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, { res, rej });
      out.write(`${JSON.stringify({ id: n, method, params })}\0`);
    }),
  };
}

/**
 * Starts Chrome with remote debugging on an OS-chosen port. `extension` is an
 * unpacked extension folder to install; `args` are extra command-line switches.
 */
export async function launchChrome({ headful = false, args = [], extension = null } = {}) {
  const browser = findBrowser();
  if (!browser || browser.type === 'firefox') throw new Error('extension checks need Chrome or Edge');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'encoreable-check-'));
  const proc = spawn(browser.path, [
    '--remote-debugging-port=0',
    ...(extension ? ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging'] : []),
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
    ...(headful ? [] : ['--headless=new']),
    ...args,
    'about:blank',
  ], { stdio: extension ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore' });

  let extensionId = null;
  if (extension) {
    const pipe = pipeClient(proc);
    extensionId = (await pipe.send('Extensions.loadUnpacked', { path: path.resolve(extension) })).id;
  }

  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  let port = null;
  while (Date.now() < deadline && !port) {
    try { port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || null; } catch {}
    if (!port) await sleep(100);
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not open a DevTools port');
  }

  const close = async () => {
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await sleep(1000);
    } catch {}
    try { proc.kill(); } catch {}
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); }
    }
  };
  return { port, proc, profile, extensionId, close };
}

/** Declines the site's consent dialog, which covers the page and takes every click until answered. */
export async function declineConsent(page, ms = 10000) {
  return page.evaluate(`new Promise(res => {
    const end = Date.now() + ${ms};
    (function poll() {
      const btn = [...document.querySelectorAll('button, a')].find(b => /^\\s*Do not consent\\s*$/i.test(b.textContent));
      if (btn) { btn.click(); return setTimeout(() => res('declined'), 800); }
      if (Date.now() > end) return res('no dialog');
      setTimeout(poll, 250);
    })();
  })`);
}

/**
 * Moves the pointer off whatever it is on and waits for the tooltip to go. A
 * tooltip carrying RNG controls stays up while the pointer is in it, and it can
 * sit over the next button a person means to click; they would step off first.
 */
export async function stepOff(page) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await page.waitFor(`!document.querySelector('#tooltipwrapper .tooltip')`, 3000).catch(() => {});
}

/** A real mouse click at the centre of the first visible element matching `selector`. */
export async function click(page, selector, index = 0) {
  const box = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.offsetParent !== null);
    const el = els[${index}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60) };
  })()`);
  if (!box) return null;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
  return box;
}

/** A CDP session. `target` is a target id, a `/json/list` row, or a URL substring to find one. */
export async function connect(port, target = null) {
  let row = target && typeof target === 'object' ? target : null;
  if (!row) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pages = list.filter(t => t.type === 'page');
    row = (target && pages.find(t => t.id === target || t.url.includes(target))) || pages[0];
  }
  if (!row) throw new Error('no page target to connect to');
  const ws = new WebSocket(row.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ''}`));
      else res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  };

  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  };
  const waitFor = async (expression, ms = 20000) => {
    const end = Date.now() + ms;
    let last = null;
    while (Date.now() < end) {
      try {
        const v = await evaluate(expression);
        if (v) return v;
      } catch (err) { last = err; }
      await sleep(200);
    }
    throw new Error(`timed out waiting for: ${expression}${last ? ` (last error: ${last.message})` : ''}`);
  };
  // A page with an open battle raises beforeunload; a check always means to leave.
  on('Page.javascriptDialogOpening', () => { send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });

  return { send, on, evaluate, waitFor, close: () => ws.close(), target: row };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

/** Serves `dir` on a loopback port. `routes` maps a URL path to a string body. */
export async function serveStatic(dir, routes = {}) {
  dir = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath in routes) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(urlPath)] || 'text/html' });
      res.end(routes[urlPath]);
      return;
    }
    const file = path.join(dir, urlPath);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}
