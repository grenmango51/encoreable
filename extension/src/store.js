/**
 * Recordings, in IndexedDB on the extension's own origin - shared by the
 * background worker and the recordings page, and out of reach of the sites the
 * content scripts run on.
 *
 * A recording is kept as the exact text of its `.log.json`, so exporting gives
 * back the bytes that were imported. It cannot be regenerated (`CLAUDE.md`), so
 * the only way one leaves is an explicit delete.
 */

const DB = 'encoreable';
const STORE = 'recordings';

let opening = null;

function db() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('savedAt', 'savedAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => { opening = null; });
  return opening;
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** What the list shows, read out of a recording's JSON. */
export function describe(text) {
  const data = JSON.parse(text);
  const inputLog = Array.isArray(data.inputLog) ? data.inputLog : String(data.inputLog || '').split('\n');
  const start = inputLog.find(l => l.startsWith('>start '));
  const formatid = data.format || (start ? JSON.parse(start.slice(start.indexOf('{'))).formatid : '');
  if (!inputLog.some(l => l.startsWith('>'))) throw new Error('this file has no inputLog - it is not a recording');
  return {
    players: [data.p1 || '', data.p2 || ''],
    turns: Number(data.turns) || null,
    format: formatid,
    winner: data.winner || null,
    reconstructed: !!data.reconstructed,
    complete: data.complete ?? null,
    verifiedThroughTurn: data.verifiedThroughTurn ?? null,
    set: data.bestOf?.set || null,
    game: data.bestOf?.game ?? null,
  };
}

/** Stores a recording's text under `name`, replacing one with the same name. */
export async function put({ name, text, source = '' }) {
  const meta = describe(text);
  const id = String(name).replace(/\.log\.json$/i, '');
  const row = { id, name: `${id}.log.json`, text, source, savedAt: Date.now(), ...meta };
  await tx('readwrite', s => s.put(row));
  return { id, ...meta };
}

export async function list() {
  const rows = await tx('readonly', s => s.getAll());
  return rows.map(({ text, ...meta }) => ({ ...meta, bytes: text.length })).sort((a, b) => b.savedAt - a.savedAt);
}

export async function get(id) {
  return tx('readonly', s => s.get(id));
}

/** Every recording of one best-of set (`bestOf.set`), name and text. */
export async function ofSet(set) {
  const rows = await tx('readonly', s => s.getAll());
  return rows.filter(r => set && r.set === set).map(({ name, text }) => ({ name, text }));
}

export async function remove(id) {
  await tx('readwrite', s => s.delete(id));
  return true;
}
