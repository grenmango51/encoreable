/**
 * Protocol log helpers.
 *
 * Room logs carry chat, joins, wall-clock timestamps and html that a bare
 * simulator log never emits, and `|t:|` ticks differ between two replays of the
 * same battle purely because they ran at different seconds. Strip all of it
 * before comparing two logs.
 */

const ROOM_ONLY = new Set([
  '', 'init', 'title', 'users', 'j', 'J', 'join', 'l', 'L', 'leave', 'c', 'c:', 'chat',
  ':', 't:', 'uhtml', 'uhtmlchange', 'html', 'raw', 'expire', 'askreg', 'inactive',
  'inactiveoff', 'n', 'N', 'name', 'unlink', 'notify', 'seed', 'message', 'error',
  'debug', 'bigerror', 'chatmsg', 'chatmsg-raw', 'controlshtml', 'fieldhtml',
  // `request` rides the channel-1 stream, which the omniscient log never carried.
  // `tempnotify` is how a Bo3 room asks for the next game - room furniture that
  // arrives after `|win|` and that no simulator emits.
  'request', 'tempnotify',
]);

/** The battle-mechanics lines of a log, with room-level noise removed. */
export function battleLines(log) {
  const lines = Array.isArray(log) ? log : String(log).split('\n');
  return lines.filter((line) => {
    if (!line.startsWith('|')) return false;
    return !ROOM_ONLY.has(line.split('|')[1]);
  }).map((line) => {
    // the server appends a rating field to |player| that the sim does not
    if (line.startsWith('|player|')) return line.split('|').slice(0, 5).join('|');
    return line;
  });
}

/** First position where two line arrays disagree, or null if identical. */
export function firstDivergence(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { index: i, expected: a[i], actual: b[i] };
  }
  return null;
}

/** Every position where two line arrays disagree. */
export function allDivergences(a, b) {
  const rows = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) rows.push({ index: i, before: a[i], after: b[i] });
  }
  return rows;
}
