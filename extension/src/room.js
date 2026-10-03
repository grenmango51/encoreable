/**
 * The fake room. A MAIN-world content script on play.pokemonshowdown.com, run
 * at `document_start`, so it is in place before the client's first send.
 *
 * The live client builds a battle room from any `>roomid` frame that opens with
 * `|init|battle` (`docs/extension.md` P3), and every message it sends passes
 * through `app.send` (P1). So the server is replaced at that one point:
 *
 *   - a branch is a battle in the simulator Worker (`engine.js`), shown as two
 *     rooms, one per side, each fed its own channel - exact HP for its own
 *     Pokemon only, as two players see it on the real server
 *   - `app.send` swallows everything that *names* a fake room, not just what
 *     is addressed to one (P5): `/choose`, `/undo` and `/forfeit` go to the
 *     Worker, chat is echoed locally, and `/noreply /leave`, `/join` and
 *     `/cmd fullformat` never reach the socket
 *   - the branch's input log is kept in sessionStorage after every change, so
 *     a reload - which makes the router `/join` the room in the URL - rebuilds
 *     the battle by re-simulating it, instead of asking a server that never
 *     heard of it
 *
 * Nothing addressed to a fake room is ever sent. Everything else is untouched.
 */
import { annotate, install as installSpreads, loadPanel } from './spread-panel.js';

(() => {
  'use strict';
  if (window.encoreable) return;

  const FAKE_ROOM = /\bbattle-[a-z0-9]+-encoreable(\d+)-(p[12])\b/;
  const STORE = 'encoreable:branch:';
  const COUNTER = 'encoreable:next';
  const SIDES = ['p1', 'p2'];

  const branches = new Map();   // n -> { n, key, formatid, players, source, start, inference, panel, closed: Set }
  const pending = new Map();
  let nextCall = 0;
  let workerReady = null;
  let workerUrl = null;
  const log = (...a) => console.debug('[encoreable]', ...a);

  // ------------------------------------------------------------ storage

  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
    remove(k) { try { sessionStorage.removeItem(k); } catch {} },
  };

  function allocate() {
    let n = Number(store.get(COUNTER)) || 1;
    while (branches.has(n) || store.get(STORE + n)) n++;
    store.set(COUNTER, n + 1);
    return n;
  }

  // ------------------------------------------------------------- worker

  // The isolated-world bridge knows the extension's URL; this world does not.
  window.addEventListener('message', (event) => {
    const msg = event.source === window && event.data;
    if (msg && msg.encoreable === 'worker-url' && /^chrome-extension:\/\//.test(msg.url)) workerUrl = msg.url;
  });

  function askWorkerUrl() {
    return new Promise((resolve, reject) => {
      if (workerUrl) return resolve(workerUrl);
      window.postMessage({ encoreable: 'worker-url?' }, location.origin);
      const started = Date.now();
      const wait = () => {
        if (workerUrl) return resolve(workerUrl);
        if (Date.now() - started > 5000) return reject(new Error('the extension did not answer - is it installed and enabled?'));
        setTimeout(wait, 50);
      };
      wait();
    });
  }

  function worker() {
    if (workerReady) return workerReady;
    workerReady = (async () => {
      const url = await askWorkerUrl();
      const source = await (await fetch(url)).text();
      // A blob Worker in the page: the site sends no Content-Security-Policy (P2).
      const w = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      await new Promise((resolve, reject) => {
        w.onerror = e => reject(new Error(e.message || 'the simulator worker failed to start'));
        w.onmessage = (event) => {
          const msg = event.data;
          if (msg.push === 'ready') return resolve();
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        };
      });
      return w;
    })();
    workerReady.catch(() => { workerReady = null; });
    return workerReady;
  }

  async function call(method, ...args) {
    const w = await worker();
    return new Promise((resolve, reject) => {
      const id = ++nextCall;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, method, args });
    });
  }

  // -------------------------------------------------------------- rooms

  const roomId = (b, side) => `battle-${b.formatid}-encoreable${b.n}-${side}`;
  const title = (b, side) => `[${side}] ${b.players[0]} vs. ${b.players[1]}`;

  function deliver(roomid, lines, { init = false } = {}) {
    if (!lines || !lines.length || !window.app) return;
    if (!init && !app.rooms[roomid]) return;
    app.receive(`>${roomid}\n${lines.join('\n')}`);
  }

  /**
   * A side's new lines, as the server would send them: a `|request|` is its own
   * message (`player.sendRoom`), and the client reads a message as a request
   * only when it opens with one.
   */
  function deliverFrames(b, frames) {
    for (const side of SIDES) {
      if (b.closed.has(side)) continue;
      const id = roomId(b, side);
      let batch = [];
      for (const line of frames[side]) {
        if (line.startsWith('|request|')) {
          deliver(id, batch);
          deliver(id, [line]);
          batch = [];
        } else {
          batch.push(line);
        }
      }
      deliver(id, batch);
    }
  }

  function notice(roomid, text) {
    const safe = String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    deliver(roomid, [`|raw|<div class="broadcast-blue"><strong>Encoreable:</strong> ${safe}</div>`]);
  }

  function persist(b, summary) {
    store.set(STORE + b.n, {
      n: b.n, formatid: b.formatid, players: b.players, source: b.source, start: b.start, inference: b.inference,
      inputLog: summary.inputLog,
    });
  }

  /** The Stat Point panel needs the branch's battle; a branch shows without one rather than not at all. */
  async function withPanel(b) {
    try {
      await loadPanel(b, call);
    } catch (err) {
      b.panel = null;
      log('no Stat Point panel:', err);
    }
    return b;
  }

  /** Builds (or rebuilds) both rooms of a branch from what the Worker opened. */
  function show(b, opened, focusSide = 'p1') {
    for (const side of ['p2', 'p1']) {
      const id = roomId(b, side);
      const view = opened.sides[side];
      deliver(id, ['|init|battle', `|title|${title(b, side)}`, ...annotate(view.scrollback, b, side)], { init: true });
      if (view.request) deliver(id, [view.request]);
      b.closed.delete(side);
    }
    if (app.rooms[roomId(b, focusSide)]) app.focusRoom(roomId(b, focusSide));
  }

  /**
   * Opens a branch: `inputLog` cut at the start of `turn`, every later roll fresh.
   * `source` is a label kept with it (a file name, a replay id); `inference` is
   * the recording's, when its Stat Points were worked out from a replay.
   */
  async function openBranch({ inputLog, turn, source = '', inference = null }) {
    if (!window.app || !app.receive) throw new Error('the Showdown client is not loaded yet');
    const opened = await call('branch', String(inputLog), Number(turn));
    const b = {
      n: allocate(), key: opened.key, formatid: opened.formatid, players: opened.players, source,
      start: opened.turn, inference, closed: new Set(),
    };
    branches.set(b.n, b);
    persist(b, opened);
    await withPanel(b);
    show(b, opened, 'p1');
    log('opened branch', b.n, 'at turn', opened.turn, 'from', source || '(unnamed)');
    return { n: b.n, rooms: SIDES.map(s => roomId(b, s)), turn: opened.turn };
  }

  /** A branch known to this page, or one rebuilt from sessionStorage after a reload. */
  async function ensure(n) {
    if (branches.has(n)) return branches.get(n);
    const saved = store.get(STORE + n);
    if (!saved) return null;
    const opened = await call('open', saved.inputLog);
    const b = {
      n, key: opened.key, formatid: saved.formatid, players: saved.players, source: saved.source,
      start: saved.start, inference: saved.inference || null, closed: new Set(SIDES),
    };
    branches.set(n, b);
    await withPanel(b);
    b.opened = opened;
    log('rebuilt branch', n, 'at turn', opened.turn);
    return b;
  }

  async function dispose(b) {
    branches.delete(b.n);
    store.remove(STORE + b.n);
    if (b.panel) await call('spreadPanelClose', b.panel.handle).catch(() => {});
    await call('close', b.key).catch(() => {});
  }

  // ------------------------------------------------------ the swallower

  async function addressed(b, side, text) {
    const roomid = roomId(b, side);
    const [cmd, ...rest] = text.startsWith('/') ? text.slice(1).split(' ') : [null];
    const arg = rest.join(' ');
    let result = null;
    switch (cmd) {
      case 'choose':
        result = await call('choose', b.key, side, arg);
        break;
      case 'undo':
        result = await call('undo', b.key, side, arg);
        break;
      case 'forfeit':
        result = await call('forfeit', b.key, side);
        break;
      case 'leave':
      case 'part':
        deliver(roomid, ['|deinit|']);
        return closed(b, side);
      case 'rng': {
        // The RNG panel (`scripts/client/rng-panel.js`), or a typed `/rng`. The
        // server keeps one room for both players, so its state push reaches both;
        // here each side is its own room, and each gets the push addressed to it.
        const other = side === 'p1' ? 'p2' : 'p1';
        const r = await call('rngCommand', b.key, arg, [roomid, roomId(b, other)]);
        deliver(roomid, r.room);
        for (const line of r.global) {
          app.receive(line);
          const push = /^\|queryresponse\|rng\|([\s\S]*)$/.exec(line);
          if (push && !b.closed.has(other)) {
            app.receive(`|queryresponse|rng|${JSON.stringify({ ...JSON.parse(push[1]), roomid: roomId(b, other) })}`);
          }
        }
        persist(b, r);
        return;
      }
      case 'timer':
        return notice(roomid, 'there is no battle timer in an analysis room - take as long as you like.');
      case 'savereplay':
        return notice(roomid, 'replays of a branch are not uploaded. Its input log is kept with the branch.');
      case null:
        return deliver(roomid, [`|c| ${app.user.get('name')}|${text}`]);
      case 'me':
        return deliver(roomid, [`|c| ${app.user.get('name')}|${text}`]);
      default:
        return notice(roomid, `/${cmd} goes nowhere here - this room has no server behind it.`);
    }
    deliverFrames(b, result.frames);
    persist(b, result);
  }

  async function closed(b, side) {
    b.closed.add(side);
    if (SIDES.every(s => b.closed.has(s))) await dispose(b);
  }

  async function handle(text, room, match) {
    const n = Number(match[1]);
    const side = match[2];
    const addressedHere = typeof room === 'string' && FAKE_ROOM.test(room);
    const raw = room === true ? text.replace(/^\|/, '') : text;

    if (addressedHere) {
      const b = await ensure(n);
      if (!b) return deliver(match[0], ['|noinit|nonexistent|This Encoreable branch is gone - it lived in a tab that was closed.']);
      return addressed(b, side, raw);
    }

    // Global commands that name a fake room.
    const [cmd] = raw.replace(/^\/noreply /, '/').split(' ');
    if (cmd === '/leave' || cmd === '/part') {
      const b = branches.get(n);
      if (b) await closed(b, side);
      return;
    }
    if (cmd === '/join' || cmd === '/j') {
      const b = await ensure(n);
      if (!b) {
        deliver(match[0], ['|noinit|nonexistent|This Encoreable branch is gone - it lived in a tab that was closed.'], { init: true });
        return;
      }
      show(b, b.opened || await call('view', b.key), side);
      delete b.opened;
      return;
    }
    // `/cmd fullformat <room>` (Rematch) and anything else: never answered, never sent.
    log('swallowed', raw);
  }

  function report(err) {
    console.error('[encoreable]', err);
    banner(`${err.message || err}`, { error: true });
  }

  // ------------------------------------------------------------ banner

  let bannerEl = null;
  /** One line of status across the top of the page; `null` text removes it. */
  function banner(text, { error = false, done = false } = {}) {
    if (text === null) { bannerEl?.remove(); bannerEl = null; return; }
    if (!document.body) return;
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'encoreable-banner';
      bannerEl.setAttribute('role', 'status');
      bannerEl.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:10000;max-width:min(720px,90vw);' +
        'padding:6px 32px 6px 12px;border-radius:6px;font:13px/1.4 Verdana,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:pre-wrap';
      const close = document.createElement('button');
      close.textContent = '×';
      close.setAttribute('aria-label', 'Dismiss');
      close.style.cssText = 'position:absolute;top:2px;right:6px;border:0;background:none;font-size:16px;cursor:pointer;color:inherit';
      close.onclick = () => banner(null);
      bannerEl.append(document.createElement('span'), close);
      document.body.append(bannerEl);
    }
    bannerEl.dataset.kind = error ? 'error' : done ? 'done' : 'working';
    bannerEl.style.background = error ? '#fbe3e4' : done ? '#e2f5e3' : '#e8f0fb';
    bannerEl.style.color = error ? '#8a1f11' : '#123';
    bannerEl.firstChild.textContent = `Encoreable: ${text}`;
    if (done) setTimeout(() => { if (bannerEl && bannerEl.firstChild.textContent === `Encoreable: ${text}`) banner(null); }, 6000);
  }

  // ---------------------------------------------------- ways in: opening

  const toId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  /** The species each side showed at team preview. */
  function previewSpecies(log) {
    const out = { p1: [], p2: [] };
    for (const line of String(log).split('\n')) {
      const m = /^\|poke\|(p[12])\|([^,|]+)/.exec(line);
      if (m) out[m[1]].push(toId(m[2].replace(/-\*$/, '')));
    }
    return out;
  }

  /** Species in a packed team: the second field, or the nickname when it is empty. */
  const packedSpecies = packed => String(packed).split(']').filter(Boolean).map((set) => {
    const f = set.split('|');
    return toId(f[1] || f[0]);
  });

  /** A team from this browser's teambuilder that is one side of the replay, Stat Points and all. */
  function ownTeam(log) {
    const teams = (window.Storage && Array.isArray(Storage.teams)) ? Storage.teams : [];
    const sides = previewSpecies(log);
    for (const side of ['p1', 'p2']) {
      const want = sides[side];
      if (!want.length) continue;
      for (const t of teams) {
        if (!t || !t.team || !/champions/.test(t.format || '')) continue;
        const have = packedSpecies(t.team);
        const fits = want.every(w => have.some(h => h === w || h.startsWith(w) || w.startsWith(h)));
        if (fits && have.length === want.length) return { side, packed: t.team, name: t.name };
      }
    }
    return null;
  }

  const saving = new Map();
  let nextSave = 0;
  window.addEventListener('message', (event) => {
    const msg = event.source === window && event.data;
    if (!msg || msg.encoreable !== 'saved') return;
    const p = saving.get(msg.replyId);
    if (!p) return;
    saving.delete(msg.replyId);
    if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
  });
  function saveRecording(name, recording, source) {
    return new Promise((resolve, reject) => {
      const replyId = ++nextSave;
      saving.set(replyId, { resolve, reject });
      window.postMessage({ encoreable: 'save-recording', replyId, name, source, text: `${JSON.stringify(recording, null, 2)}\n` }, location.origin);
    });
  }

  /** Fetches a replay, rebuilds it into a recording in the Worker, keeps it, and branches it. */
  async function openReplay({ id }, turn) {
    banner(`fetching replay ${id}...`);
    const res = await fetch(`https://replay.pokemonshowdown.com/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error(`replay ${id} is not on the replay server (HTTP ${res.status})`);
    const replay = await res.json();
    const mine = ownTeam(replay.log);
    const teams = [null, null];
    if (mine) teams[mine.side === 'p1' ? 0 : 1] = { packed: mine.packed };
    const infer = mine ? (mine.side === 'p1' ? 'p2' : 'p1') : 'both';
    banner(`rebuilding ${id} from the replay` + (mine
      ? ` with your team "${mine.name}" as ${mine.side} - working out the other side's Stat Points...`
      : ' - neither team is in your teambuilder, so both sides\' Stat Points are worked out; this can take a while...'));
    const built = await call('reconstructReplay', {
      source: { name: id, log: replay.log }, teams, infer, threads: navigator.hardwareConcurrency || 4,
    });
    const rec = built.recording;
    const name = `reconstructed-${id}`;
    await saveRecording(name, rec, `replay.pokemonshowdown.com/${id}`).catch(err => log('could not save', err));
    const reach = rec.complete ? rec.turns : rec.verifiedThroughTurn;
    if (turn > reach) {
      throw new Error(`${id} was rebuilt only through turn ${reach} of ${rec.turns}, so it cannot be branched at turn ${turn}. ` +
        `It is saved as "${name}"; open it at turn ${reach} or earlier from the Encoreable recordings page.`);
    }
    const opened = await openBranch({ inputLog: rec.inputLog.join('\n'), turn, source: `replay ${id}`, inference: rec.inference || null });
    banner(`${id}: rebuilt (${rec.complete ? 'matches the replay line for line' : `verified through turn ${reach}`}) and branched at turn ${opened.turn}.`, { done: true });
    return opened;
  }

  function clientUp() {
    return new Promise((resolve) => {
      const check = () => (window.app && app.rooms && app.rooms[''] && document.body ? resolve() : setTimeout(check, 100));
      check();
    });
  }

  /** A request the background parked for this tab: a stored recording or a replay, and a turn. */
  async function takeRequest(request) {
    await clientUp();
    if (request.error) throw new Error(request.error);
    if (request.recording) {
      banner(`opening ${request.recording.name} at turn ${request.turn}...`);
      const data = JSON.parse(request.recording.text);
      const inputLog = Array.isArray(data.inputLog) ? data.inputLog.join('\n') : String(data.inputLog);
      const opened = await openBranch({ inputLog, turn: request.turn, source: request.recording.name, inference: data.inference || null });
      banner(`${request.recording.name} branched at turn ${opened.turn}.`, { done: true });
      return opened;
    }
    if (request.replay) return openReplay(request.replay, request.turn);
    return null;
  }

  window.addEventListener('message', (event) => {
    const msg = event.source === window && event.data;
    if (msg && msg.encoreable === 'open' && msg.request) takeRequest(msg.request).catch(report);
  });

  function hookApp(a) {
    if (!a || a.__encoreableHooked) return;
    a.__encoreableHooked = true;
    const original = a.send;
    Object.defineProperty(a, 'send', {
      configurable: true,
      writable: true,
      value: function send(data, room) {
        const text = String(data);
        const match = (typeof room === 'string' && FAKE_ROOM.exec(room)) || FAKE_ROOM.exec(text);
        if (match) {
          handle(text, room, match).catch(report);
          return undefined;
        }
        return original.apply(this, arguments);
      },
    });
  }

  // The RNG panel serves fake rooms only; a real battle's tooltips stay vanilla.
  window.__rngPanelRooms = roomid => FAKE_ROOM.test(String(roomid));

  // So does the Stat Point panel.
  installSpreads({
    call,
    branchOf: (roomid) => {
      const m = FAKE_ROOM.exec(String(roomid || ''));
      return m ? branches.get(Number(m[1])) || null : null;
    },
  });

  // `App.initialize` runs `window.app = this` before it sends anything.
  let appRef = window.app;
  if (appRef) hookApp(appRef);
  Object.defineProperty(window, 'app', {
    configurable: true,
    enumerable: true,
    get() { return appRef; },
    set(value) { appRef = value; hookApp(value); },
  });

  window.encoreable = {
    version: 1,
    openBranch,
    openReplay: (id, turn) => openReplay({ id }, Number(turn) || 1),
    branches: () => [...branches.values()].map(b => ({ n: b.n, players: b.players, source: b.source, rooms: SIDES.map(s => roomId(b, s)) })),
    exportLog: n => call('exportLog', branches.get(Number(n))?.key),
    rng: (n, target) => {
      const b = branches.get(Number(n));
      if (!b) throw new Error(`no branch ${n}`);
      return call('rngCommand', b.key, target, SIDES.map(s => roomId(b, s)));
    },
    call,
  };
})();
