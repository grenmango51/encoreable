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
 *
 * With the team sheets (`sheets`, per side: `members` with each Pokemon's
 * `name`, `moves` as ids, `maxhp` and whether it has `illusion`, and whether
 * the log shows that side's HP `exact`), a disguise no hit broke is seen
 * through too, from its switch-in to its next one: when the Pokemon shown uses
 * a move its sheet does not have and the Illusion user's does, or shows the
 * Illusion user's exact max HP and not its own. `forced` names switch-ins, by
 * line index, to read as the Illusion user without that proof - a guess the
 * rebuild tests by whether the battle then plays out as the log shows.
 */
export function unmaskIllusion(lines, sheets = null, forced = null) {
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
    const listed = disguises[slot.slice(0, 2)];
    if (listed && !listed.includes(shown.name)) listed.push(shown.name);
    const from = `${slot}: ${shown.name}`;
    const to = `${slot}: ${name}`;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[| ])${escaped}(?=\\||$)`, 'g');
    for (let j = shown.at; j < i; j++) out[j] = String(out[j]).replace(pattern, `$1${to}`);
    const head = String(out[shown.at]).split('|');
    head[3] = parts[3];
    out[shown.at] = head.join('|');
  }
  if (sheets) for (const side of ['p1', 'p2']) unmaskBySheet(out, side, sheets[side], disguises, forced);
  return { lines: out, disguises };
}

const idOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Every switch-in that could be an Illusion user in disguise: on a side whose
 * sheet has exactly one, a teammate of it shown coming in, as
 * `{ at, turn }` - the line's index and the turn it is in.
 */
export function illusionStays(lines, sheets) {
  const out = [];
  let turn = 0;
  for (const [at, line] of lines.entries()) {
    const parts = String(line).split('|');
    if (parts[1] === 'turn') turn = Number(parts[2]) || turn;
    if (parts[1] !== 'switch' && parts[1] !== 'drag') continue;
    const m = /^(p[1-4])[a-d]: (.+)$/.exec(parts[2] || '');
    const sheet = m && sheets?.[m[1]];
    const users = (sheet?.members || []).filter(p => p.illusion);
    if (users.length === 1 && m[2] !== users[0].name && sheet.members.some(p => p.name === m[2])) out.push({ at, turn });
  }
  return out;
}

/**
 * The switch-ins `illusionStays` lists that nothing settles, as
 * `{ at, turn, side, name }`. A stay is the Pokemon shown when it took a hit
 * from another Pokemon's move and stood, with no `|replace|` after it - a hit
 * always breaks Illusion - used a move only its own sheet has, showed its own
 * exact max HP and not the Illusion user's, or came in while the Illusion user
 * was seen elsewhere or had fainted. None is the Illusion user once as many
 * other Pokemon have been shown on its side as the side brought: it copies only
 * a Pokemon brought with it, so it was not brought. One read as the Illusion
 * user is not listed. Any other could have been either, so what it showed is
 * evidence for neither.
 */
export function unsettledStays(lines, sheets) {
  const seen = unmaskIllusion(lines, sheets).lines.map(String);
  const brought = {};
  const others = { p1: new Set(), p2: new Set() };
  for (const line of seen) {
    const q = line.split('|');
    if (q[1] === 'teamsize') brought[q[2]] = Number(q[3]);
    const who = /^(p[1-4])[a-d]: (.+)$/.exec(q[2] || '');
    const zoroark = who && sheets[who[1]]?.members.find(p => p.illusion);
    if ((q[1] === 'switch' || q[1] === 'drag') && zoroark && who[2] !== zoroark.name) others[who[1]]?.add(who[2]);
  }
  const out = [];
  for (const stay of illusionStays(lines, sheets)) {
    const parts = seen[stay.at].split('|');
    const m = /^((p[1-4])[a-d]): (.+)$/.exec(parts[2] || '');
    if (!m) continue;
    const [, slot, side, name] = m;
    const zoroark = sheets[side].members.find(p => p.illusion);
    const shown = sheets[side].members.find(p => p.name === name);
    if (!shown || name === zoroark.name || others[side]?.size >= brought[side]) continue;
    const hp = /^\d+\/(\d+)/.exec(parts[4] || '');
    const zoroarkIs = (line) => {
      const who = /^(p[1-4])[a-d]: (.+)$/.exec(line.split('|')[2] || '');
      return !!who && who[1] === side && who[2] === zoroark.name;
    };
    let settled = !!(sheets[side].exact && hp && Number(hp[1]) === shown.maxhp && shown.maxhp !== zoroark.maxhp)
      || seen.slice(0, stay.at).some(line => line.startsWith('|faint|') && zoroarkIs(line));
    let mover = null;
    for (let j = stay.at + 1; j < seen.length && !settled; j++) {
      const q = seen[j].split('|');
      if (q[1] === 'move') mover = q[2];
      if (zoroarkIs(seen[j])) settled = true;
      if (!String(q[2] || '').startsWith(`${slot}: `)) continue;
      if (['switch', 'drag', 'replace', 'faint'].includes(q[1])) break;
      if (q[1] === '-damage' && !seen[j].includes('[from]') && !/^0\b/.test(q[3] || '') && mover && mover !== q[2]) settled = true;
      if (q[1] === 'move' && !seen[j].includes('[from]')) {
        const move = idOf(q[3]);
        if (move !== 'struggle' && shown.moves.has(move) && !zoroark.moves.has(move)) settled = true;
      }
    }
    if (!settled) out.push({ ...stay, side, name });
  }
  return out;
}

/** Name `who` as `as` in every field of lines `from` to `to`, exclusive. */
function rename(out, slot, who, as, from, to) {
  const escaped = `${slot}: ${who}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[| ])${escaped}(?=\\||$)`, 'g');
  for (let j = from; j < to; j++) out[j] = String(out[j]).replace(pattern, `$1${slot}: ${as}`);
}

/**
 * One side's disguises the sheet gives away. A stay - a Pokemon's time in a
 * slot, from its switch-in to the next - is the Illusion user's when it proves
 * it, and is not judged once something lets a Pokemon use moves not on its
 * sheet: Transform, Mimic, Sketch. Moves another effect called (`[from]`) and
 * Struggle prove nothing.
 */
function unmaskBySheet(out, side, sheet, disguises, forced) {
  const users = (sheet?.members || []).filter(m => m.illusion);
  if (users.length !== 1) return;
  const zoroark = users[0];
  const byName = new Map(sheet.members.map(m => [m.name, m]));
  const stays = new Map();
  const close = (slot, end) => {
    const stay = stays.get(slot);
    stays.delete(slot);
    if (!stay || !stay.proved || stay.spoiled) return;
    rename(out, slot, stay.name, zoroark.name, stay.at, end);
    if (disguises[side] && !disguises[side].includes(stay.name)) disguises[side].push(stay.name);
  };
  for (let i = 0; i < out.length; i++) {
    const parts = String(out[i]).split('|');
    const m = /^(p[1-4][a-d]): (.+)$/.exec(parts[2] || '');
    if (!m || !m[1].startsWith(side)) continue;
    const [, slot, name] = m;
    const kind = parts[1];
    if (kind === 'switch' || kind === 'drag' || kind === 'replace') {
      close(slot, i);
      const shown = byName.get(name);
      if (kind === 'replace' || name === zoroark.name || !shown) continue;
      const hp = /^\d+\/(\d+)/.exec(parts[4] || '');
      const max = hp ? Number(hp[1]) : null;
      stays.set(slot, {
        at: i, name, spoiled: false,
        proved: !!forced?.has(i) || !!(sheet.exact && max && max !== shown.maxhp && max === zoroark.maxhp),
      });
      continue;
    }
    const stay = stays.get(slot);
    if (!stay || name !== stay.name) continue;
    if (kind === 'faint') { close(slot, i + 1); continue; }
    if (kind === '-transform' || (kind === '-activate' && /^move: (Mimic|Sketch)$/.test(parts[3] || ''))) stay.spoiled = true;
    if (kind === 'move' && !out[i].includes('[from]')) {
      const move = idOf(parts[3]);
      const shown = byName.get(stay.name);
      if (move !== 'struggle' && !shown.moves.has(move) && zoroark.moves.has(move)) stay.proved = true;
    }
  }
  for (const slot of [...stays.keys()]) close(slot, out.length);
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
