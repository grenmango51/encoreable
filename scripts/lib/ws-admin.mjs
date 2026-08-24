/**
 * A scripted connection to the local server, used to drive the commands no
 * browser can reasonably issue.
 *
 * `/importinputlog` carries two packed teams and runs 1.5-3KB. It is registered
 * as a multi-line command (`chat-commands/core.ts:1849`), so the whole log goes
 * in one frame - and the multi-line path is only taken when the text actually
 * contains a newline. The operator never sees the log at all.
 *
 * The command needs the `importinputlog` permission, which
 * `provision-local-server.mjs` grants to the default group. So this connects as
 * an ordinary guest, with no rank.
 */

const WS_URL = 'ws://127.0.0.1:8000/showdown/websocket';

/** Default name for the scripted connection. Not a rank - just a name. */
export const ADMIN_NAME = 'Encoreable';

export class WsAdmin {
  constructor({ name = ADMIN_NAME, verbose = false } = {}) {
    this.name = name;
    this.verbose = verbose;
    this.ws = null;
    this.named = false;
    this.group = '';
    this.popups = [];
    this.errors = [];
    this._listeners = new Set();
    this._namedResolve = null;
  }

  log(...args) {
    if (this.verbose) console.log(`[${this.name}]`, ...args);
  }

  /** Register a `(roomid, line) => void` observer. Returns an unsubscribe fn. */
  on(handler) {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.onerror = () => reject(new Error('cannot reach the local server on 127.0.0.1:8000'));
      this.ws.onopen = () => resolve();
      this.ws.onmessage = (e) => {
        for (const block of String(e.data).split('\n\n')) this._handleBlock(block);
      };
    });
  }

  _handleBlock(block) {
    const lines = block.split('\n');
    let roomid = '';
    if (lines[0]?.startsWith('>')) roomid = lines.shift().slice(1);
    for (const line of lines) this._handleLine(roomid, line);
  }

  _handleLine(roomid, line) {
    if (!line.startsWith('|')) return;
    const parts = line.split('|');
    const cmd = parts[1];

    if (cmd === 'challstr') {
      // noguestsecurity is on, so an empty assertion is accepted
      this.send('', `/trn ${this.name},0,`);
    } else if (cmd === 'updateuser') {
      const identity = parts[2] || '';
      const who = identity.replace(/^[^A-Za-z0-9]+/, '');
      if (who === this.name && parts[3] === '1' && !this.named) {
        // The identity carries any group symbol as a prefix.
        this.group = identity.slice(0, identity.length - who.length).trim();
        this.named = true;
        this.log('named');
        this._namedResolve?.();
      }
    } else if (cmd === 'popup') {
      const text = parts.slice(2).join('|');
      this.popups.push(text);
      this.log('popup:', text);
    } else if (cmd === 'error') {
      const text = parts.slice(2).join('|');
      this.errors.push(text);
      this.log('error:', text);
    }

    this.log(roomid ? `<${roomid}> ${line}` : line);
    for (const handler of this._listeners) handler(roomid, line, parts);
  }

  send(roomid, message) {
    this.ws.send(`${roomid || ''}|${message}`);
  }

  waitNamed(timeoutMs = 10000) {
    if (this.named) return Promise.resolve();
    return this._await(timeoutMs, 'the server never confirmed the admin name', (resolve) => {
      this._namedResolve = resolve;
    });
  }

  /**
   * Waits until `predicate(roomid, line, parts)` returns a truthy value, and
   * resolves with it.
   */
  waitFor(predicate, { timeoutMs = 30000, what = 'a server message' } = {}) {
    return this._await(timeoutMs, `timed out waiting for ${what}`, (resolve) => (
      this.on((roomid, line, parts) => {
        const hit = predicate(roomid, line, parts);
        if (hit) resolve(hit);
      })
    ));
  }

  /**
   * `register(resolve)` hooks up whatever fires on success and may return an
   * unsubscribe function. Exactly one of resolve/timeout wins, and the hook is
   * torn down either way.
   */
  _await(timeoutMs, message, register) {
    return new Promise((resolve, reject) => {
      let off = null;
      let timer = null;
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off?.();
        resolve(value ?? true);
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off?.();
        const tail = this.popups.length ? ` Last popup: ${this.popups[this.popups.length - 1]}` : '';
        reject(new Error(message + '.' + tail));
      }, timeoutMs);

      off = register(finish);
      if (settled) off?.();
    });
  }

  close() {
    try { this.ws?.close(); } catch { /* already gone */ }
  }
}
