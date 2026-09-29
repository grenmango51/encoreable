/**
 * "Play from here" on replay.pokemonshowdown.com. A MAIN-world content script:
 * the turn on screen lives in the replay viewer's `window.battle`.
 *
 * The viewer re-renders `.replay-controls` as it plays, so the button sits in
 * its own row just after it and is put back whenever a re-render drops it.
 * A click sends the replay id and the turn to the extension, which opens a
 * play.pokemonshowdown.com tab that rebuilds the battle and branches it there.
 * Only Champions replays get the button: reconstruction needs the Stat Point
 * model (`engineering.md` 7.5).
 */
(() => {
  'use strict';
  if (window.__encoreableReplay) return;
  window.__encoreableReplay = true;

  const replayId = () => decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''));
  const isChampions = () => /^(?:[a-z0-9]+-)?gen9champions[a-z0-9]*-\d+/.test(replayId());

  let status = null;

  function row() {
    const div = document.createElement('div');
    div.id = 'encoreable-controls';
    div.style.cssText = 'margin: 6px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap';
    const button = document.createElement('button');
    button.className = 'button';
    button.name = 'encoreablePlayFromHere';
    button.innerHTML = '<strong>Play from here</strong>';
    button.title = 'Rebuild this battle and play it forward from the turn on screen, both sides, in the real battle UI (Encoreable)';
    status = document.createElement('small');
    status.style.cssText = 'opacity: .8';
    button.addEventListener('click', () => {
      const turn = Math.max(1, Number(window.battle && window.battle.turn) || 1);
      status.textContent = `opening turn ${turn} in a new tab...`;
      window.postMessage({ encoreable: 'play-from-here', replay: { id: replayId() }, turn }, location.origin);
    });
    div.append(button, status);
    return div;
  }

  window.addEventListener('message', (event) => {
    const msg = event.source === window && event.data;
    if (!msg || msg.encoreable !== 'play-from-here-sent' || !status) return;
    status.textContent = msg.error ? `could not open: ${msg.error}` : `opened turn ${msg.turn} in a new tab`;
  });

  function place() {
    if (!isChampions()) return;
    const controls = document.querySelector('.replay-controls');
    if (!controls) return;
    const mine = document.getElementById('encoreable-controls');
    if (mine && mine.previousElementSibling === controls) return;
    if (mine) mine.remove();
    controls.after(row());
  }

  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', place);
  place();
})();
