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
  // `tempnotify` and `tempnotifyoff` are how a Bo3 room asks for the next game -
  // room furniture that arrives after `|win|` and that no simulator emits.
  'request', 'tempnotify', 'tempnotifyoff',
]);

/**
 * Messages the retired `>eval` RNG controller wrote into the battle itself.
 * Recordings made with it still carry them; no simulator emits them.
 */
const RNG_MESSAGE = /^\|-message\|#rng /;

/**
 * How the room announces a player who stopped playing (`server/room-battle.ts`,
 * `forfeitPlayer`). The simulator only sees the `>forcelose` that follows, and
 * prints the `|win|`.
 */
const FORFEIT_MESSAGE = /^\|-message\|.+ (forfeited|lost due to inactivity|forfeited by changing their name|lost by having an inappropriate name)\.$/;

/**
 * Wording that differs between simulator versions for the same event. Upstream
 * names the stat an ability kept from dropping by id (`atk`); 0.11.11, which
 * recorded every battle in `recordings/local/` until the pin moved to an upstream
 * commit (docs/engineering.md 6.5), named it (`Attack`). A comparison can mix the
 * two, so both sides are brought to the id.
 */
const UNBOOST_BY_NAME = /^(\|-fail\|[^|]*\|unboost\|)(Attack|Defense)(\||$)/;
const STAT_ID = { Attack: 'atk', Defense: 'def' };

/** The battle-mechanics lines of a log, with room-level noise removed. */
export function battleLines(log) {
  const lines = Array.isArray(log) ? log : String(log).split('\n');
  return lines.filter((line) => {
    if (!line.startsWith('|') || RNG_MESSAGE.test(line) || FORFEIT_MESSAGE.test(line)) return false;
    return !ROOM_ONLY.has(line.split('|')[1]);
  }).map((line) => {
    // the server appends a rating field to |player| that the sim does not
    if (line.startsWith('|player|')) return line.split('|').slice(0, 5).join('|');
    return line.replace(UNBOOST_BY_NAME, (all, head, name, tail) => `${head}${STAT_ID[name]}${tail}`);
  });
}

/**
 * A log with every Illusion seen through. A Pokemon with Illusion is sent in
 * shown as someone else - that one's name and details - until a hit breaks it
 * and `|replace|` shows who it really was. Every line from its switch-in to the
 * `|replace|` names it by the real name here. `disguises` lists, per side, the
 * names it was shown as. Lines are compared as shown: the simulator prints the
 * same disguise. What was really sent in, and who really acted, is read here.
 */
export function unmaskIllusion(lines) {
  const out = lines.slice();
  const shownAt = new Map();
  const disguises = { p1: [], p2: [] };
  for (let i = 0; i < out.length; i++) {
    const parts = String(out[i]).split('|');
    const m = /^(p[1-4][a-d]): (.+)$/.exec(parts[2] || '');
    if (!m) continue;
    const [, slot, name] = m;
    if (parts[1] === 'switch' || parts[1] === 'drag') { shownAt.set(slot, { at: i, name }); continue; }
    if (parts[1] !== 'replace') continue;
    const shown = shownAt.get(slot);
    shownAt.delete(slot);
    if (!shown || shown.name === name) continue;
    disguises[slot.slice(0, 2)]?.push(shown.name);
    const from = `${slot}: ${shown.name}`;
    const to = `${slot}: ${name}`;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[| ])${escaped}(?=\\||$)`, 'g');
    for (let j = shown.at; j < i; j++) out[j] = String(out[j]).replace(pattern, `$1${to}`);
    const head = String(out[shown.at]).split('|');
    head[3] = parts[3];
    out[shown.at] = head.join('|');
  }
  return { lines: out, disguises };
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
