/**
 * The extension's service worker. It holds no battle - Manifest V3 stops it
 * when idle - only the recordings store and the hand-off that opens a branch in
 * a new play.pokemonshowdown.com tab.
 *
 * A request to open ("this recording at turn 6", "this replay at the turn on
 * screen") is parked in `chrome.storage.session` against the tab it created,
 * and the tab's bridge collects it once the page is up.
 */

import * as store from './store.js';

const PLAY = 'https://play.pokemonshowdown.com/';
const pendingKey = tabId => `pending:${tabId}`;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html') });
});

async function openInPlay(request) {
  const tab = await chrome.tabs.create({ url: PLAY });
  await chrome.storage.session.set({ [pendingKey(tab.id)]: request });
  return { tabId: tab.id };
}

const handlers = {
  list: () => store.list(),
  get: ({ id }) => store.get(id),
  put: ({ name, text, source }) => store.put({ name, text, source }),
  remove: ({ id }) => store.remove(id),
  open: ({ recordingId, replay, turn }) => openInPlay({ recordingId, replay, turn: Number(turn) || 1, at: Date.now() }),
  pending: async (_msg, sender) => {
    const key = pendingKey(sender.tab && sender.tab.id);
    const found = (await chrome.storage.session.get(key))[key] || null;
    if (found) await chrome.storage.session.remove(key);
    if (found && found.recordingId) {
      const row = await store.get(found.recordingId);
      if (!row) return { ...found, error: `recording "${found.recordingId}" is not in the store any more` };
      return { ...found, recording: { name: row.name, text: row.text } };
    }
    return found;
  },
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const fn = msg && handlers[msg.op];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(msg, sender))
    .then(result => respond({ ok: true, result }), err => respond({ ok: false, error: String(err && err.message || err) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.session.remove(pendingKey(tabId)); });
