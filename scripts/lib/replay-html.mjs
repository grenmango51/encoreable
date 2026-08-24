/**
 * Writes a Showdown replay page.
 *
 * Same shape as a replay downloaded from play.pokemonshowdown.com: the protocol
 * log sits in a `battle-log-data` script tag and `replay-embed.js` renders it.
 *
 * Two things worth knowing:
 *
 *  - The player code is loaded from play.pokemonshowdown.com, so the page needs
 *    a network connection to animate. The log itself is complete and local -
 *    open the file in a text editor to read every line offline. The vendored
 *    client cannot serve the player as-is: its `config/config.js` is a
 *    placeholder, `data/pokedex-mini*.js` are absent, and its per-file
 *    `battledata.js` references `BattleTextParser` without defining it, because
 *    upstream deploys a bundle. Pass `--embed <base-url>` once the client is
 *    built with `node build`.
 *  - The container is not given `class="wrapper"`. The embed only builds its
 *    battle DOM when no `.wrapper` exists (replay-embed.js, `Replays.init`), so
 *    claiming that class produces an empty page.
 */

const UPSTREAM = 'https://play.pokemonshowdown.com';

export function buildReplayHtml({ title, formatid, log, embedBase = UPSTREAM }) {
  return `<!DOCTYPE html>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
html,body {font-family:Verdana,sans-serif;font-size:10pt;margin:0;padding:0;}
body {padding:12px 0;}
</style>
<input type="hidden" name="replayid" value="${escapeHtml(formatid)}-local" />
<script type="text/plain" class="battle-log-data">${log.replace(/<\//g, '<\\/')}</script>
<script src="${embedBase}/js/replay-embed.js"></script>
`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
