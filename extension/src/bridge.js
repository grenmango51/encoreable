/**
 * Isolated-world content script on play.pokemonshowdown.com and
 * replay.pokemonshowdown.com. The page-world scripts (`room.js`,
 * `replay-page.js`) cannot see `chrome.runtime`; this carries their messages to
 * the background worker and back, with `window.postMessage` on the page side.
 */

const send = msg => chrome.runtime.sendMessage(msg).then((reply) => {
  if (!reply || !reply.ok) throw new Error(reply ? reply.error : 'the extension did not answer');
  return reply.result;
});
const toPage = msg => window.postMessage({ encoreable: msg.type, ...msg }, location.origin);
const fromPage = (type, fn) => window.addEventListener('message', (event) => {
  if (event.source === window && event.data && event.data.encoreable === type) fn(event.data);
});

if (location.hostname === 'play.pokemonshowdown.com') {
  const WORKER_URL = chrome.runtime.getURL('sim-worker.js');
  const tell = () => window.postMessage({ encoreable: 'worker-url', url: WORKER_URL }, location.origin);
  fromPage('worker-url?', tell);
  tell();

  // A branch this tab was opened for, parked by the background worker. It parks
  // the request only once the tab exists, so a tab that loads fast asks again.
  (async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const request = await send({ op: 'pending' });
      if (request) return toPage({ type: 'open', request });
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  })().catch(err => toPage({ type: 'open', request: { error: err.message } }));

  fromPage('save-recording', ({ replyId, name, text, source }) => {
    send({ op: 'put', name, text, source })
      .then(result => toPage({ type: 'saved', replyId, result }))
      .catch(err => toPage({ type: 'saved', replyId, error: err.message }));
  });

  // The other games of a best-of set the store holds, to combine with the one opened.
  fromPage('set-games', ({ replyId, set }) => {
    send({ op: 'set', set })
      .then(result => toPage({ type: 'set-games-found', replyId, result }))
      .catch(err => toPage({ type: 'set-games-found', replyId, error: err.message }));
  });
}

if (location.hostname === 'replay.pokemonshowdown.com') {
  fromPage('play-from-here', ({ replay, turn }) => {
    send({ op: 'open', replay, turn })
      .then(() => toPage({ type: 'play-from-here-sent', turn }))
      .catch(err => toPage({ type: 'play-from-here-sent', error: err.message }));
  });
}
