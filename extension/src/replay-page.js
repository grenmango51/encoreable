/**
 * "Play from here" on replay.pokemonshowdown.com. A MAIN-world content script:
 * the turn on screen lives in the replay viewer's `window.battle`.
 *
 * The button sits right after the viewer's own "Go to turn..." button, in the
 * same row and the same style. The viewer re-renders `.replay-controls` as it
 * plays, so the button is put back whenever a re-render drops or moves it.
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

  function controls() {
    const span = document.createElement('span');
    span.id = 'encoreable-controls';
    span.style.cssText = 'margin-left: 3px';
    const button = document.createElement('button');
    button.className = 'button';
    button.name = 'encoreablePlayFromHere';
    button.innerHTML = '<i class="fa fa-code-fork" aria-hidden="true"></i> Play from here';
    button.title = 'Rebuild this battle and play it forward from the turn on screen, both sides, in the real battle UI (Encoreable)';
    status = document.createElement('small');
    status.style.cssText = 'opacity: .8; margin-left: 6px';
    button.addEventListener('click', () => {
      const turn = Math.max(1, Number(window.battle && window.battle.turn) || 1);
      status.textContent = `opening turn ${turn} in a new tab...`;
      window.postMessage({ encoreable: 'play-from-here', replay: { id: replayId() }, turn }, location.origin);
    });
    span.append(button, status);
    return span;
  }

  window.addEventListener('message', (event) => {
    const msg = event.source === window && event.data;
    if (!msg || msg.encoreable !== 'play-from-here-sent' || !status) return;
    status.textContent = msg.error ? `could not open: ${msg.error}` : `opened turn ${msg.turn} in a new tab`;
  });

  /** The viewer's "Go to turn..." button. */
  const goToTurn = () => [...document.querySelectorAll('.replay-controls button')]
    .find(b => /go to turn/i.test(b.textContent));

  function place() {
    if (!isChampions()) return;
    const anchor = goToTurn();
    if (!anchor) return;
    const mine = document.getElementById('encoreable-controls');
    if (mine && mine.previousElementSibling === anchor) return;
    if (mine) mine.remove();
    anchor.after(controls());
  }

  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', place);
  place();
})();
