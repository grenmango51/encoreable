/**
 * Adds a "Play from here" button to the replay control row.
 *
 * It uses the player's own two mechanisms rather than sitting beside them:
 *
 *  - `Replays.update` rebuilds the whole row on every play, pause and seek
 *    (replay-embed.ts:180). Wrapping it means the button is drawn by the same
 *    call that draws Play and Pause, with the same lifecycle. Adding it once
 *    would last until the next click.
 *  - The delegated handler at replay-embed.ts:75 reads `data-action` off any
 *    clicked button and calls `Replays[action]()`, so `Replays.branch` is all
 *    that a click needs. A `data-action` naming no method would throw.
 *
 * `Battle.subscribe` is deliberately untouched: it replaces the single
 * subscriber (battle.ts:1247) and `Replays.init` already holds it.
 *
 * The button appears from turn 1 to the last turn inclusive. Branching stops at
 * the *start* of the chosen turn, before either side has committed, so the final
 * turn is a real position - the one whose choices ended the battle. Turn 0 is
 * team preview, which is a different kind of decision.
 */

(function () {
  var BUTTON_CLASS = 'branch-button';
  var busy = false;
  var lastTurn = 0;
  var inputLog = '';

  function readPlainScript(className) {
    var el = document.querySelector('script.' + className);
    // The writer escapes `</` so it cannot close the tag early.
    return el ? el.textContent.split('<\\/').join('</') : '';
  }

  function highestTurn(log) {
    var best = 0;
    var lines = log.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = /^\|turn\|(\d+)/.exec(lines[i]);
      if (m && Number(m[1]) > best) best = Number(m[1]);
    }
    return best;
  }

  function status(text, isError) {
    var row = document.querySelector('.replay-controls');
    if (!row) return;
    var el = document.querySelector('.branch-status');
    if (!el) {
      el = document.createElement('div');
      el.className = 'branch-status';
      el.style.padding = '6px 0';
      row.parentNode.insertBefore(el, row.nextSibling);
    }
    el.style.color = isError ? '#a00' : '';
    el.textContent = text;
  }

  function inRange(turn) {
    return turn >= 1 && turn <= lastTurn;
  }

  function addButton(replays) {
    var row = document.querySelector('.replay-controls');
    if (!row || !replays.battle) return;
    if (!inRange(replays.battle.turn)) return;
    if (row.querySelector('.' + BUTTON_CLASS)) return;

    // A leading space matches the spacing between the player's own buttons.
    row.appendChild(document.createTextNode(' '));

    var button = document.createElement('button');
    button.className = BUTTON_CLASS;
    button.setAttribute('data-action', 'branch');
    button.disabled = busy;
    button.innerHTML = '<i class="fa fa-code-fork"></i> ' +
      (busy ? 'Opening...' : 'Play from here');
    row.appendChild(button);
  }

  function install(replays) {
    inputLog = readPlainScript('branch-input-log');
    lastTurn = highestTurn(readPlainScript('battle-log-data'));
    if (!inputLog || !lastTurn) return;

    replays.branch = function () {
      if (busy) return;
      var turn = this.battle.turn;
      if (!inRange(turn)) return;

      busy = true;
      this.update();
      status('Opening a live battle at turn ' + turn + '...');

      fetch('/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputLog: inputLog, turn: turn }),
      }).then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      }).then(function (result) {
        if (!result.ok || result.body.error) {
          throw new Error(result.body.error || 'the server returned ' + result.body);
        }
        var slots = (result.body.slots || [])
          .map(function (s) { return s[0] + ' ' + s[1]; })
          .join('   ');
        status('Turn ' + result.body.turn + ' is live in ' + result.body.roomid +
          '   ' + slots + '   - two windows are opening.');
      }).catch(function (err) {
        status('Could not open the battle: ' + err.message, true);
      }).then(function () {
        busy = false;
        replays.update();
      });
    };

    var originalUpdate = replays.update;
    replays.update = function (state) {
      originalUpdate.call(this, state);
      addButton(this);
    };
    replays.update();
  }

  var waited = 0;
  var poll = setInterval(function () {
    // `window.onload` is claimed by replay-embed, and jQuery arrives through a
    // document.write chain, so polling is the only load-order-proof hook.
    if (window.Replays && window.Replays.battle) {
      clearInterval(poll);
      install(window.Replays);
    } else if (++waited > 200) {
      clearInterval(poll);
    }
  }, 150);
})();
