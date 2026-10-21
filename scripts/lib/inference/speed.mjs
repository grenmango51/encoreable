/**
 * Speed order, read off every sort the simulator makes by speed.
 *
 * Two items of one sort at the same order and priority ran fastest first, so
 * the one whose lines came first had at least the other's speed - and the
 * speed compared is the simulator's own at that moment, so Tailwind, Trick
 * Room, paralysis and Choice Scarf are all its. `attachSpeed` hooks the sorts
 * inside one evidence pass (`evidence.mjs`) and hands back the bounds.
 */

import { battleLines } from '../protocol.mjs';
import { ACTION_START, identName, identSide, override, tagsOf } from '../reconstruct.mjs';
import { SPAN } from './knowledge.mjs';

const OPENS_MOVE = /^\|(move|cant)\||^\|-activate\|[^|]+\|confusion$|^\|-curestatus\|[^|]+\|(slp|frz)\|\[msg\]$/;
const MEGA = new Set(['megaEvo', 'megaEvoX', 'megaEvoY']);

/**
 * The queued action a replay line shows starting, as `{ kind, ident }`, or
 * null: a move line, what stopped the move, or what only `onBeforeMove` prints
 * first - the confusion check, waking up, thawing out - open that Pokemon's
 * move; a forme change the next line names as Mega Evolution opens its Mega
 * Evolution; a forme change the next line names as the same Pokemon's own move
 * - Stance Change's, which `onModifyMove` prints before the move line - opens
 * that move; a switch no effect caused opens the switch out of that slot,
 * whoever it names coming in. `next` is the line after it.
 */
function opens(line, next) {
  const text = String(line || '');
  const parts = text.split('|');
  if (OPENS_MOVE.test(text)) return { kind: 'move', ident: parts[2] };
  if (parts[1] === 'detailschange') {
    const after = String(next || '').split('|');
    return after[1] === '-mega' && after[2] === parts[2] ? { kind: 'mega', ident: parts[2] } : null;
  }
  if (parts[1] === '-formechange') {
    const after = String(next || '').split('|');
    return after[1] === 'move' && after[2] === parts[2] && !after.slice(4).some(p => p.startsWith('[from]')) ? { kind: 'move', ident: parts[2] } : null;
  }
  if (parts[1] === 'switch' && !parts.slice(5).some(p => p.startsWith('[from]'))) return { kind: 'switch', ident: parts[2] };
  return null;
}

/**
 * Whether a queued action is of the kind `opens` names. A switch is a chosen
 * one or a replacement for a Pokemon that fainted, which the simulator queues
 * as `instaswitch` and sorts by the fainted Pokemon's speed.
 */
const SWITCHES = new Set(['switch', 'instaswitch']);
const ofKind = (action, kind) => (kind === 'mega' ? MEGA.has(action?.choice) : kind === 'switch' ? SWITCHES.has(action?.choice) : action?.choice === kind);

/** What a queued action did, as an order line says it: a switch is its Pokemon going out. */
const verbOf = action => (SWITCHES.has(action?.choice) ? 'switched out' : MEGA.has(action?.choice) ? 'Mega Evolved' : 'acted');

const HP_AT = { '-damage': 3, '-heal': 3, '-sethp': 3 };

/**
 * Two lines that differ at most in the HP a hidden Pokemon is shown on: the
 * same handler writing for the same Pokemon, its status included.
 */
function sameButHp(a, b) {
  if (a === b) return true;
  const x = String(a || '').split('|');
  const y = String(b || '').split('|');
  const at = HP_AT[x[1]];
  if (at === undefined || x.length !== y.length || x[1] !== y[1]) return false;
  const status = token => String(token || '').split(' ').slice(1).join(' ');
  return x.every((part, i) => (i === at ? status(part) === status(y[i]) : part === y[i]));
}

export function attachSpeed(battle, {
  state, sync, memo, guarded, recs, byPokemon, byIdent, view, prefix, record, events, label, measure, cutOf, note, depOf, ownValue,
  unmaskedAfter, frames,
}) {
  const byId = new Map(recs.map(rec => [rec.id, rec]));
  const sorts = [];
  const executed = [];
  const tainted = new Set();
  // Each action `queue.prioritizeAction` moved to the front, with the number
  // of sorts made before it did: from then on its place is not speed's, and
  // a sort made after it has it at the order prioritizing set.
  const prioritized = new Map();
  let lastSort = null;
  let sortOrdinal = 0;

  /**
   * The speeds a Pokemon could be on, as `{ owner, table }`: `table` is indexed
   * by `owner`'s Speed Stat Points - the Pokemon's own, or after Speed Swap
   * the other one's - and is one speed throughout for a Speed no candidate
   * moves, a known Pokemon's or one copied from it. `read` is the speed the
   * battle uses, asked with the stored Speed patched. Null where no table
   * stands in for it: at the replay's own Stat Points it has to give the speed
   * the battle really uses. Run dry, and keyed by id so a cached one outlives
   * the pass that made it.
   */
  const speedsOf = (rec, read) => guarded(() => {
    const dep = depOf(rec, 'spe');
    const p = rec.pokemon;
    const real = read();
    if (dep && !dep.owner) return { owner: rec.id, table: new Float64Array(SPAN).fill(real) };
    if (dep && dep.stat === 'spe') {
      const saved = p.storedStats.spe;
      const table = new Float64Array(SPAN);
      try {
        for (let s = 0; s < SPAN; s++) { p.storedStats.spe = dep.at(s); table[s] = read(); }
      } finally {
        p.storedStats.spe = saved;
      }
      if (table[ownValue(dep)] === real) return { owner: dep.owner.id, table };
    }
    note(`${label(rec)}'s Speed`, 'no one candidate value says what it is, so its turn order was not used');
    return null;
  });
  const speedTable = rec => memo(`spe|${sortOrdinal}|${rec.id}`, () => speedsOf(rec, () => rec.pokemon.getActionSpeed()));

  // The priority a queued move's Pokemon would be sorted at with each move it
  // has and Struggle, which it uses when none is left to it, asked of the
  // simulator the way the queue asks it of the move it chose. Run dry, and
  // keyed by sort so it outlives the pass. Two sorts that give a Pokemon the
  // same list sorted it at the same priority whatever move it chose.
  const movePriorities = (a) => memo(`pri|${sortOrdinal}|${a.pokemon.side.id}${a.pokemon.position}`, () => guarded(() => (
    [...a.pokemon.moveSlots.map(slot => slot.id), 'struggle'].map((id) => {
      const asked = { ...a, move: battle.dex.getActiveMove(id) };
      battle.getActionSpeed(asked);
      return asked.priority;
    }))));

  const queue = battle.queue;
  const origSort = queue.sort;
  let queueSorting = 0;
  queue.sort = function () {
    let out;
    queueSorting++;
    try {
      out = origSort.call(this);
    } finally {
      queueSorting--;
    }
    if (!state.dry && !state.ended) {
      sync();
      // Where each acting Pokemon stands as the queue is sorted: a switch line
      // names the Pokemon coming in, never the one in that slot.
      const entry = {
        turn: battle.turn,
        ordinal: sortOrdinal,
        list: this.list.map((a) => {
          const moves = a.choice === 'move' && a.pokemon ? movePriorities(a) : null;
          return {
            action: a, order: a.order, priority: a.priority || 0, pokemon: a.pokemon || null,
            side: a.pokemon?.side?.id ?? null, slot: a.pokemon ? a.pokemon.position : -1,
            priorities: moves ? moves.join('/') : null,
            lowest: moves ? Math.min(...moves) : null,
          };
        }),
        speeds: new Map(),
      };
      for (const item of entry.list) {
        const rec = item.pokemon && byPokemon.get(item.pokemon);
        if (rec && !entry.speeds.has(rec)) entry.speeds.set(rec, speedTable(rec));
      }
      sortOrdinal++;
      sorts.push(entry);
      lastSort = entry;
    }
    return out;
  };
  // Where an effect sets an action's place, the simulator says so in the
  // action's order: Quash writes 201, and After You, Instruct, Round, the
  // Pledges and Shell Trap prioritize the action, which writes 3. Gen 9
  // sorts the queue again before every move, so a sort made after that has
  // the action in a bracket of its own, and the rules below compare only
  // items one sort had at the same order and priority. `changeAction`
  // inserts an action where no sort put it, so its turn is set aside.
  const prioritize = queue.prioritizeAction;
  queue.prioritizeAction = function (action, ...rest) {
    if (!state.dry && !state.ended) prioritized.set(action, sortOrdinal);
    return prioritize.call(this, action, ...rest);
  };
  const changeAction = queue.changeAction;
  queue.changeAction = function (...args) {
    tainted.add(battle.turn);
    return changeAction.apply(this, args);
  };
  // Whether an action was moved to the front after sort `S` was made, so its
  // place in `S` is not where it ran.
  const movedAfter = (action, S) => (prioritized.get(action) ?? -1) > S.ordinal;

  // Who stands in each active slot, keyed `p2a`, and the name the log shows
  // it by: its disguise's while Illusion holds.
  const standingNow = () => new Map(battle.sides.flatMap(side => side.active.filter(Boolean)
    .map(p => [`${side.id}${'abcd'[p.position]}`, { pokemon: p, name: p.illusion ? p.illusion.name : p.name }])));

  const origRun = battle.runAction;
  battle.runAction = function (action) {
    if (state.dry || state.ended) return origRun.call(this, action);
    sync();
    const start = battle.log.length;
    const sort = lastSort;
    const standing = standingNow();
    try {
      return origRun.call(this, action);
    } finally {
      executed.push({ action, pokemon: action.pokemon || null, start, end: battle.log.length, sort, standing });
    }
  };
  // The disguise an action's Pokemon was shown by as the action began, as
  // `{ key, ident }`, or null when it was shown by its own name.
  const disguiseOf = (ex) => {
    for (const [key, s] of ex.standing) {
      if (s.pokemon === ex.pokemon && s.name !== s.pokemon.name) return { key, ident: `${key}: ${s.name}` };
    }
    return null;
  };
  // Every name a Pokemon was shown by while it acted: its own and its
  // disguises'.
  const shownNames = (rec) => {
    const names = new Set([rec.name]);
    for (const ex of executed) {
      for (const s of ex.standing.values()) if (s.pokemon === rec.pokemon) names.add(s.name);
    }
    return names;
  };
  const fieldOf = ident => new RegExp(`(^|\\|| )${ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||$)`);

  // The speed an event handler sorts by is the one `updateSpeed` cached, so
  // every candidate's is taken at that moment rather than when the sort runs.
  // A forme change (`setSpecies`, which Mega Evolution runs) caches the bare
  // Speed stat of the new forme until the next update.
  let speedUpdates = 0;
  for (const rec of recs) {
    const p = rec.pokemon;
    const setSpecies = p.setSpecies;
    override(p, 'setSpecies', function (...args) {
      const out = setSpecies.apply(this, args);
      if (!state.dry && !state.ended) {
        // A Transform's `setSpecies` is followed by the copied stats.
        rec.cachedSpeed = args[2] ? null : speedsOf(rec, () => this.storedStats.spe);
      }
      return out;
    });
    const update = p.updateSpeed;
    override(p, 'updateSpeed', function () {
      const out = update.call(this);
      if (!state.dry && !state.ended) {
        const at = speedUpdates++;
        rec.cachedSpeed = memo(`upd|${at}|${rec.id}`, () => speedsOf(rec, () => p.getActionSpeed()));
      }
      return out;
    });
  }

  // Sorts by speed outside the action queue: switch-in abilities and the end
  // of the turn (`fieldEvent`), weather's pass over every Pokemon
  // (`eachEvent`). Each keeps the order its items were sorted into and the log
  // span each item's handler wrote - a handler is dispatched through
  // `singleEvent` by `fieldEvent`, through `runEvent` by `eachEvent`.
  const eventSorts = [];
  const open = [];
  const origSpeedSort = battle.speedSort;
  battle.speedSort = function (list, comparator) {
    // A handler run again dry by `readHandlerSort` gets the order it asks for.
    if (forcing && state.dry && sameItems(list, forcing.keys)) {
      putInOrder(list, forcing.order);
      forcing = null;
      return undefined;
    }
    const out = origSpeedSort.call(this, list, comparator);
    const top = open[open.length - 1];
    if (top && !top.entry.items && !state.dry) {
      top.entry.items = list.map((item) => {
        const holder = item.effectHolder !== undefined ? item.effectHolder : item;
        return {
          holder,
          effect: item.effect || null,
          order: item.order || 4294967296,
          priority: item.priority || 0,
          rec: byPokemon.get(holder) || null,
        };
      });
      for (const it of top.entry.items) if (it.rec && it.rec.cachedSpeed) top.entry.speeds.set(it.rec, it.rec.cachedSpeed);
      if (frames && !queueSorting && !state.ended && top.entry.eventid === 'SwitchIn') readHandlerSort(list, comparator, true);
    } else if (frames && !queueSorting && !state.dry && !state.ended) {
      readHandlerSort(list, comparator);
    }
    return out;
  };

  for (const [name, dispatch] of [['fieldEvent', 'singleEvent'], ['eachEvent', 'runEvent']]) {
    const orig = battle[name];
    battle[name] = function (eventid, ...rest) {
      if (state.dry || state.ended) return orig.call(this, eventid, ...rest);
      const entry = { kind: name, eventid, turn: battle.turn, items: null, spans: [], speeds: new Map() };
      open.push({ entry, dispatch, depth: 0 });
      try {
        return orig.call(this, eventid, ...rest);
      } finally {
        open.pop();
        eventSorts.push(entry);
      }
    };
  }
  for (const [dispatch, targetAt] of [['singleEvent', 3], ['runEvent', 1]]) {
    const orig = battle[dispatch];
    battle[dispatch] = function (...args) {
      const top = open[open.length - 1];
      if (!top || top.dispatch !== dispatch || top.depth > 0 || state.dry) {
        if (top) top.depth++;
        try { return orig.apply(this, args); } finally { if (top) top.depth--; }
      }
      const span = { holder: args[targetAt], effect: dispatch === 'singleEvent' ? args[1] : null, start: battle.log.length };
      top.depth++;
      try {
        return orig.apply(this, args);
      } finally {
        top.depth--;
        span.end = battle.log.length;
        top.entry.spans.push(span);
      }
    };
  }

  // Every other sort a handler makes by speed - Magician's of the Pokemon its
  // move hit, a nested event's of its handlers - read by asking what the
  // other order would have printed. `frames` (evidence.mjs) is the code
  // running, innermost last; each frame is told the log length it was entered
  // and left at, so what it printed can be compared afterwards.
  const handlerSorts = [];
  let forcing = null;
  let handlerSortCount = 0;
  if (frames) {
    const push = frames.push;
    frames.push = function (...added) {
      for (const frame of added) frame.logAt = battle.log.length;
      return push.apply(this, added);
    };
    const splice = frames.splice;
    frames.splice = function (...args) {
      const removed = splice.apply(this, args);
      for (const frame of removed) frame.logEnd = battle.log.length;
      return removed;
    };
  }
  // The Pokemon whose speed a sorted item carries: a Pokemon itself, or the
  // one holding a handler's effect.
  const pokemonOf = item => (byPokemon.has(item) ? item : byPokemon.has(item?.effectHolder) ? item.effectHolder : null);
  // An item as running the same code again builds it anew: its Pokemon or
  // holder, and its effect.
  const keyOf = (item) => {
    const p = pokemonOf(item);
    return `${p ? byPokemon.get(p).id : item?.effectHolder?.id ?? ''}|${item?.effect?.id ?? ''}`;
  };
  const sameItems = (list, keys) => list.length === keys.length && list.map(keyOf).sort().join('\n') === [...keys].sort().join('\n');
  const putInOrder = (list, keys) => {
    const pool = list.slice();
    list.splice(0, list.length, ...keys.map(key => pool.splice(pool.findIndex(item => keyOf(item) === key), 1)[0]));
  };
  const varies = speeds => speeds.table.some(v => v !== speeds.table[0]);
  const alike = (a, b) => a.owner === b.owner && a.table.every((v, s) => v === b.table[s]);
  // Whether a table gives, at the replay's own Stat Points, the speed an item
  // was sorted by.
  const sortedBy = (speeds, item, speed = item.speed) => speeds.table[ownValue({ owner: byId.get(speeds.owner), stat: 'spe' })] === speed;

  /**
   * A sort a handler made: each two neighbours of different Pokemon, one of
   * them hidden, that the comparator ties at equal speed, so that speed alone
   * put them in this order. The handler runs again dry from where it was
   * entered, once in this sort's order and once per such pair with the two
   * swapped, and `speedRules` compares what each run printed.
   *
   * Switch-in effects are sorted the same way, by the action that switched
   * their Pokemon in, which runs again from the queue it started from. Each
   * handler there carries its Pokemon's speed less a fraction that only
   * breaks a tie, so two at one order and priority are in speed order.
   */
  function readHandlerSort(list, comparator, switchIn = false) {
    const frame = frames[frames.length - 1];
    if (!frame) return;
    if (switchIn ? frame.kind !== 'action' || frame.args?.[0]?.choice !== 'runSwitch' : frame.kind !== 'handler' && frame.kind !== 'event') return;
    const atSpeed = item => Object.create(item, { speed: { value: 0 } });
    const bracket = item => [item.order || 4294967296, item.priority || 0].join('|');
    const tied = switchIn
      ? (a, b) => bracket(a) === bracket(b)
      : (a, b) => (comparator || battle.comparePriority)(atSpeed(a), atSpeed(b)) === 0;
    const speedOf = item => (switchIn ? pokemonOf(item).speed : item.speed);
    const pairs = [];
    for (let i = 0; i + 1 < list.length; i++) {
      const X = byPokemon.get(pokemonOf(list[i]));
      const Y = byPokemon.get(pokemonOf(list[i + 1]));
      const fx = X?.cachedSpeed;
      const fy = Y?.cachedSpeed;
      if (!fx || !fy || X === Y || !(varies(fx) || varies(fy)) || alike(fx, fy)) continue;
      if (!sortedBy(fx, list[i], speedOf(list[i])) || !sortedBy(fy, list[i + 1], speedOf(list[i + 1]))) continue;
      if (tied(list[i], list[i + 1])) pairs.push({ i, X, Y });
    }
    if (!pairs.length) return;
    const keys = list.map(keyOf);
    const runs = memo(`hsort|${handlerSortCount++}`, () => {
      const kept = list.slice();
      const run = order => guarded(() => {
        const at = battle.log.length;
        forcing = { keys, order };
        try {
          frame.rerun();
          return battle.log.slice(at);
        } catch {
          return null;
        } finally {
          forcing = null;
        }
      });
      try {
        return {
          sorted: run(keys),
          swapped: pairs.map(({ i }) => run([...keys.slice(0, i), keys[i + 1], keys[i], ...keys.slice(i + 2)])),
        };
      } finally {
        list.splice(0, list.length, ...kept);
      }
    });
    const speeds = new Map(pairs.flatMap(({ X, Y }) => [[X, X.cachedSpeed], [Y, Y.cachedSpeed]]));
    handlerSorts.push({ frame, pairs, runs, speeds, turn: battle.turn, name: frame.effect?.name || 'a handler' });
  }

  // Whether the channel the replay was seen from reads `side`'s secret half of
  // a `|split|` line, as the replay's view of the log shows.
  const secrets = new Map();
  const readsSecret = (side) => {
    if (!secrets.has(side)) {
      let seen = false;
      for (const e of view) {
        if (battle.log[e.at - 1] === `|split|${side}`) { seen = true; break; }
        if (battle.log[e.at - 2] === `|split|${side}`) break;
      }
      secrets.set(side, seen);
    }
    return secrets.get(side);
  };
  // Raw lines that start at raw index `base`, as that channel shows them,
  // each with its raw index.
  const shownOf = (raw, base) => {
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const split = /^\|split\|(p[1-4])$/.exec(raw[i]);
      if (split) {
        const at = readsSecret(split[1]) ? i + 1 : i + 2;
        if (raw[at]) out.push({ line: raw[at], at: base + at });
        i += 2;
        continue;
      }
      if (raw[i]) out.push({ line: raw[i], at: base + i });
    }
    return out;
  };
  /**
   * "X went first, Y after" as a bound between the Pokemon whose Stat Points
   * each one's speed stands on - the two themselves, unless a Speed Swap
   * handed one the other's.
   */
  const ruleOf = (X, Y, speeds, turn, what) => {
    const fx = speeds.get(X);
    const fy = speeds.get(Y);
    if (!fx || !fy) return null;
    return { fast: byId.get(fx.owner), slow: byId.get(fy.owner), tf: fx.table, ts: fy.table, turn, what };
  };

  function speedRules() {
    const upTo = Math.min(prefix.cutoffAt, battle.log.length);
    const firstAt = (at) => {
      let lo = 0;
      let hi = view.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (view[mid].at < at) lo = mid + 1; else hi = mid; }
      return lo;
    };
    // Whether the line at raw index `at`, naming slot `key` by a disguise, was
    // `p`'s: a `|replace|` naming `p` in that slot comes after it, before
    // anything switches in there (`unmaskedAfter`).
    const settled = (p, key, at) => unmaskedAfter(p, { side: key.slice(0, 2), slot: 'abcd'.indexOf(key[2]) }, at);
    // An action the replay shows: one of its lines names the Pokemon acting,
    // by its own name or by the disguise it began the action in once a
    // `|replace|` settles that disguise as its, or for a switch, which names
    // the Pokemon coming in, shows a switch into the slot the one going out
    // stood in.
    const visible = (ex) => {
      const rec = ex.pokemon && byPokemon.get(ex.pokemon);
      if (!rec || ex.end > upTo) return false;
      const out = SWITCHES.has(ex.action?.choice) ? ex.sort?.list.find(item => item.action === ex.action) : null;
      if (SWITCHES.has(ex.action?.choice) && !(out?.slot >= 0)) return false;
      const me = out ? new RegExp(`^\\|switch\\|${out.side}${'abcd'[out.slot]}: `)
        : new RegExp(`(^|\\|| )${rec.side}[a-d]: ${rec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||$)`);
      const disguise = out ? null : disguiseOf(ex);
      const as = disguise && fieldOf(disguise.ident);
      for (let i = firstAt(ex.start); i < view.length && view[i].at < ex.end; i++) {
        if (me.test(view[i].line)) return true;
        if (as && as.test(view[i].line) && settled(ex.pokemon, disguise.key, view[i].at)) return true;
      }
      return false;
    };
    // A move a Pokemon used of its own choice: its move line, with no `[from]`
    // but a lock, naming that move - not one another effect called, nor one a
    // flinch or full paralysis kept it from showing. The line names the
    // Pokemon by its own name, or by `ident` when given.
    const ownMove = (line, rec, id, ident = null) => {
      const parts = String(line).split('|');
      const who = parts[2] || '';
      if (parts[1] !== 'move') return false;
      if (ident ? who !== ident : !new RegExp(`^${rec.side}[a-d]: `).test(who) || identName(who) !== rec.name) return false;
      const from = tagsOf(String(line)).from;
      return (!from || from === 'lockedmove') && String(parts[3]).toLowerCase().replace(/[^a-z0-9]/g, '') === id;
    };
    // An Encore begun on the Pokemon earlier in the turn, in the lines shown
    // before raw index `at`, naming it by any name it was shown by: its move
    // line then shows the encored move, not the one it chose.
    const encoredBefore = (rec, at) => {
      const names = shownNames(rec);
      for (let i = firstAt(at) - 1; i >= 0; i--) {
        const parts = view[i].line.split('|');
        if (parts[1] === 'turn') return false;
        if (parts[1] === '-start' && /Encore$/.test(parts[3] || '') && identSide(parts[2]) === rec.side && names.has(identName(parts[2]))) return true;
      }
      return false;
    };
    // The rebuild sorted the action at the priority the real one had: it is
    // no move, or the replay shows its Pokemon using the very move the rebuild
    // queued, of its own choice. A move the rebuild chose in place of one the
    // replay never shows sorts at a priority of its own.
    const sorted = (ex) => {
      if (ex.action?.choice !== 'move') return true;
      const rec = byPokemon.get(ex.pokemon);
      const id = ex.action.move?.id;
      if (!rec || !id || encoredBefore(rec, ex.start)) return false;
      const disguise = disguiseOf(ex);
      for (let i = firstAt(ex.start); i < view.length && view[i].at < Math.min(ex.end, upTo); i++) {
        if (ownMove(view[i].line, rec, id)) return true;
        if (disguise && ownMove(view[i].line, rec, id, disguise.ident) && settled(ex.pokemon, disguise.key, view[i].at)) return true;
      }
      return false;
    };
    const shown = new Map(executed.map((ex) => {
      const seen = visible(ex);
      return [ex.action, { ex, seen, on: seen && sorted(ex) }];
    }));
    const order = new Map(executed.map((ex, i) => [ex.action, i]));
    const rules = [];
    // Each action against those its last sort had after it at the same order
    // and priority, as that sort had them - never the order an effect wrote on
    // the action since, as Quash does - unless it was moved to the front after
    // that sort.
    for (const [i, ex] of executed.entries()) {
      const S = ex.sort;
      if (!S || tainted.has(S.turn) || movedAfter(ex.action, S) || !shown.get(ex.action)?.on) continue;
      const at = S.list.findIndex(item => item.action === ex.action);
      if (at < 0) continue;
      const x = S.list[at];
      for (const y of S.list.slice(at + 1)) {
        if (!y.pokemon || y.pokemon === x.pokemon || y.order !== x.order || y.priority !== x.priority) continue;
        const later = order.get(y.action);
        // The one that went second need not show its move: X went first, so
        // its real priority was no higher than X's, and no move it has sorts
        // below that.
        const second = shown.get(y.action);
        if (later === undefined || later <= i || !(second?.on || (second?.seen && y.lowest !== null && y.lowest >= x.priority))) continue;
        const X = byPokemon.get(x.pokemon);
        const Y = byPokemon.get(y.pokemon);
        const rule = ruleOf(X, Y, S.speeds, S.turn, `${label(X)} ${verbOf(x.action)} before ${label(Y)}`);
        if (rule) rules.push(rule);
      }
    }

    // Handlers of one event sorted at the same order and priority ran in speed
    // order, so a Pokemon whose handler wrote a line first had at least the
    // speed of one whose handler wrote a line after it.
    const shownIn = (span) => {
      for (let i = firstAt(span.start); i < view.length && view[i].at < span.end; i++) {
        if (view[i].at < upTo) return true;
      }
      return false;
    };
    // Each span belongs to the next item it can: handlers run in sorted order.
    const matched = (entry) => {
      const out = [];
      let next = 0;
      for (const span of entry.spans) {
        let j = next;
        while (j < entry.items.length && !(entry.items[j].holder === span.holder
          && (!span.effect || !entry.items[j].effect || entry.items[j].effect === span.effect))) j++;
        if (j === entry.items.length) continue;
        next = j + 1;
        out.push({ span, item: entry.items[j] });
      }
      return out;
    };
    const eventRule = (entry, x, y) => {
      if (!x.rec || !y.rec || x.rec === y.rec || x.order !== y.order || x.priority !== y.priority) return;
      const name = it => (entry.kind === 'eachEvent' ? entry.eventid : it.effect?.name || entry.eventid);
      const rule = ruleOf(x.rec, y.rec, entry.speeds, entry.turn, `${label(x.rec)}'s ${name(x)} came before ${label(y.rec)}'s ${name(y)}`);
      if (rule) rules.push(rule);
    };
    for (const entry of eventSorts) {
      if (!entry.items) continue;
      const shown = matched(entry).filter(m => m.item.rec && shownIn(m.span)).map(m => m.item);
      for (let a = 0; a < shown.length; a++) {
        for (let b = a + 1; b < shown.length; b++) eventRule(entry, shown[a], shown[b]);
      }
    }

    // A sort a handler made, read off what the other order would have
    // printed. The run in the sort's own order must print what the handler
    // printed. Then, at the first line where the run with a pair swapped
    // prints something else, the replay showing the handler's own line proves
    // the pair's order, and the replay showing the swapped run's line there,
    // at the cutoff, proves the other.
    for (const read of handlerSorts) {
      const { frame, runs } = read;
      if (frame.logAt === undefined || frame.logEnd === undefined || frame.logAt > upTo) continue;
      const real = battle.log.slice(frame.logAt, frame.logEnd);
      if (!runs.sorted || runs.sorted.length !== real.length || runs.sorted.some((line, i) => line !== real[i])) {
        note(`${read.name}'s order`, 'running the handler again did not print what it printed, so the order it sorted was not used');
        continue;
      }
      const mine = shownOf(runs.sorted, frame.logAt);
      for (const [k, { X, Y }] of read.pairs.entries()) {
        const theirs = runs.swapped[k] && shownOf(runs.swapped[k], frame.logAt);
        if (!theirs) continue;
        let j = 0;
        while (j < mine.length && j < theirs.length && sameButHp(mine[j].line, theirs[j].line)) j++;
        if (j >= mine.length || j >= theirs.length) continue;
        const what = (P, Q) => `${label(P)} came before ${label(Q)} in ${read.name}'s order`;
        let rule = null;
        if (mine[j].at < upTo) rule = ruleOf(X, Y, read.speeds, read.turn, what(X, Y));
        else if (mine[j].at === prefix.cutoffAt && prefix.observedLine) {
          const replayed = line => sameButHp(battleLines([line])[0], prefix.observedLine);
          if (replayed(theirs[j].line) && !replayed(mine[j].line)) rule = ruleOf(Y, X, read.speeds, read.turn, what(Y, X));
        }
        if (rule) rules.push(rule);
      }
    }

    // The log diverged on who moved: the observed order is the true one. A
    // side with Illusion can print one Pokemon's name for another, so a name
    // the replay's line gives on that side says nobody for certain.
    const cut = view.find(e => e.at === prefix.cutoffAt);
    const disguisable = sideId => !!battle.sides.find(side => side.id === sideId)?.pokemon.some(p => p.baseAbility === 'illusion');
    // Who stood where as the last action begun by the cutoff began: the
    // battle itself has run on past the cutoff.
    const standing = [...executed].reverse().find(e => e.start <= prefix.cutoffAt)?.standing || new Map();
    // Who a line at the cutoff names: the Pokemon then in that slot when it
    // shows that name, its own or the one it is disguised as; otherwise, on a
    // side with no Illusion user, the Pokemon of that name.
    const named = (ident) => {
      const s = standing.get(String(ident).slice(0, 3));
      if (s && (s.name === identName(ident) || s.pokemon.name === identName(ident))) return byPokemon.get(s.pokemon) || null;
      return disguisable(identSide(ident)) ? null : byIdent.get(`${identSide(ident)}:${identName(ident)}`) || null;
    };
    const was = opens(prefix.observedLine, prefix.observedAfter?.[0]);
    const cutAt = cut ? view.indexOf(cut) : -1;
    const got = cut ? opens(cut.line, view[cutAt + 1]?.line) : null;
    // The move P really chose this turn: its first own move line from here
    // to the turn's end, unless an Encore begun on it this turn before then
    // put another in its place. A rebuild that chose another for it sorted
    // another priority, and then the order says nothing about speed.
    const encore = (line, rec) => {
      const parts = String(line || '').split('|');
      return parts[1] === '-start' && /Encore$/.test(parts[3] || '') && identSide(parts[2]) === rec.side && shownNames(rec).has(identName(parts[2]));
    };
    const chosen = () => {
      const P = named(was.ident);
      if (!P || encoredBefore(P, prefix.cutoffAt)) return null;
      for (const line of [prefix.observedLine, ...(prefix.observedAfter || [])]) {
        const parts = String(line || '').split('|');
        if (parts[1] === 'turn' || encore(line, P)) return null;
        if (parts[1] === 'move' && parts[2] === was.ident && !String(line).includes('[from]')) return String(parts[3]).toLowerCase().replace(/[^a-z0-9]/g, '');
      }
      return null;
    };
    // Q's queued move is the one Q really chose when the replay, later in the
    // turn, shows Q using that very move of its own choice, with no Encore
    // begun on it before.
    const realLater = (rec, id) => {
      if (!rec || !id || encoredBefore(rec, prefix.cutoffAt)) return false;
      for (const line of [prefix.observedLine, ...(prefix.observedAfter || [])]) {
        const parts = String(line || '').split('|');
        if (parts[1] === 'turn' || encore(line, rec)) return false;
        if (ownMove(line, rec, id)) return true;
      }
      return false;
    };
    // The queued action the replay's line opens: P's move, P's Mega
    // Evolution, or the switch out of the slot the line names. A move P never
    // used - it flinched, or was fully paralysed - or one an Encore replaced
    // shows no move to say which it chose; `between` then says whether its
    // priority is proved anyway.
    const opened = (item, between) => {
      if (!ofKind(item.action, was.kind)) return false;
      if (was.kind === 'switch') return item.side === identSide(was.ident) && item.slot === 'abcd'.indexOf(String(was.ident)[2]);
      const P = named(was.ident);
      if (!P || item.pokemon !== P.pokemon) return false;
      if (was.kind === 'mega') return true;
      const move = chosen();
      return move ? item.action?.move?.id === move : between(item);
    };
    if (was && got && (was.ident !== got.ident || was.kind !== got.kind)) {
      const ex = executed.find(e => e.start <= prefix.cutoffAt && prefix.cutoffAt < e.end);
      const S = ex?.sort;
      const x = S?.list.find(item => item.action === ex.action);
      // P's action came after the action the replay shows just before it, and
      // before Q's. When those two were sorted at the same order and priority,
      // so was P's, whatever move it chose - provided every move P has would
      // be sorted at the same priority in both sorts.
      const before = x ? executed[executed.indexOf(ex) - 1] : null;
      const a = before?.sort && before.sort.turn === S.turn && shown.get(before.action)?.on && !movedAfter(before.action, before.sort)
        ? before.sort.list.find(item => item.action === before.action) : null;
      const between = item => !!a && a.order === x.order && a.priority === x.priority && item.priorities !== null
        && before.sort.list.find(it => it.action === item.action)?.priorities === item.priorities;
      const unseen = was.kind === 'move' && !chosen();
      const y = x && ofKind(x.action, got.kind)
        ? S.list.find(item => item !== x && item.pokemon && item.order === x.order
          && (item.priority === x.priority || unseen) && opened(item, between)) : null;
      const P = y && byPokemon.get(y.pokemon);
      const Q = x && byPokemon.get(x.pokemon);
      // Q's real priority is the one the rebuild sorted it at when the replay
      // shows it using the move the rebuild queued, or when P's move is seen
      // and no move Q has sorts below P's priority: P went first, so Q's real
      // priority was no higher than P's.
      const real = x && (x.action?.choice !== 'move' || realLater(Q, x.action.move?.id)
        || (!unseen && y && x.lowest !== null && x.lowest >= y.priority));
      const rule = P && Q && P !== Q && real && !tainted.has(S.turn) && !movedAfter(x.action, S) && !movedAfter(y.action, S) ? ruleOf(P, Q, S.speeds, S.turn, `${label(P)} ${verbOf(y.action)} before ${label(Q)}`) : null;
      if (rule) rules.push(rule);
    }

    // The log diverged inside an event sort: the rebuild's handler for Q wrote
    // its line where the replay shows P's. That proves P went first only if
    // the replay shows Q's line too, after P's and before the next action - a
    // handler can stay silent in the real battle (a Leftovers heal at full HP),
    // and then the replay's order says nothing about it. Q's line there is
    // the same handler's for the same Pokemon, on whatever HP it really had.
    const whose = (line) => {
      const first = String(line).split('|')[2] || '';
      const ident = /^p[1-4][a-d]?: /.test(first) ? first : tagsOf(String(line)).of;
      return ident ? named(ident) : null;
    };
    const rebuilt = cut && battleLines([cut.line])[0];
    if (rebuilt && prefix.observedLine && !was) {
      for (const entry of eventSorts) {
        if (!entry.items) continue;
        const hit = matched(entry).find(m => m.span.start <= prefix.cutoffAt && prefix.cutoffAt < m.span.end);
        if (!hit) continue;
        // P's handler is the one for the same effect as Q's - both Pokemon's
        // Perish Song counts, both Leftovers - or the one whose effect the
        // replay's line names; an each-Pokemon pass has one item per Pokemon
        // and no effect to name.
        const P = whose(prefix.observedLine);
        const x = P && entry.items.find(it => it.rec === P
          && (entry.kind === 'eachEvent'
            || (it.effect && (it.effect === hit.item.effect || prefix.observedLine.includes(it.effect.name)))));
        let later = false;
        for (const line of prefix.observedAfter) {
          if (ACTION_START.has(line.split('|')[1])) break;
          if (sameButHp(line, rebuilt)) { later = true; break; }
        }
        if (x && later) eventRule(entry, x, hit.item);
        break;
      }
    }
    return rules;
  }

  /**
   * One order as bounds on the two Speeds it compares, each narrowing the
   * other: no Speed of the faster one below the slower one's lowest
   * surviving speed, and no Speed of the slower one above the faster one's
   * highest. A tie can go either way, so equal speeds stay. The tables are
   * the simulator's speeds at that sort, so Trick Room's reversal, Tailwind,
   * paralysis and boosts are already in them. Returns whether anything went.
   */
  function bound({ fast, slow, tf, ts }) {
    let maxFast = -Infinity;
    let minSlow = Infinity;
    for (let v = 0; v < SPAN; v++) {
      if (fast.flat.spe[v]) maxFast = Math.max(maxFast, tf[v]);
      if (slow.flat.spe[v]) minSlow = Math.min(minSlow, ts[v]);
    }
    let moved = false;
    for (let v = 0; v < SPAN; v++) {
      if (fast.flat.spe[v] && tf[v] < minSlow) { fast.flat.spe[v] = 0; moved = true; }
      if (slow.flat.spe[v] && ts[v] > maxFast) { slow.flat.spe[v] = 0; moved = true; }
    }
    return moved;
  }

  /**
   * Every order read, each first on its own, then all of them again until
   * none moves a bound: two hidden Pokemon ordered against each other and
   * each against others pass what one learns on to the other, through as
   * many orders as link them.
   */
  function applySpeed(rules) {
    for (const rule of rules) {
      const before = record ? [measure(rule.fast), measure(rule.slow)] : null;
      bound(rule);
      if (before) {
        const cuts = [cutOf(rule.fast, before[0]), cutOf(rule.slow, before[1])].filter(Boolean);
        if (cuts.length) events.push({ turn: rule.turn, what: rule.what || `${label(rule.fast)} acted before ${label(rule.slow)}`, cuts });
      }
    }
    const linked = [...new Set(rules.flatMap(rule => [rule.fast, rule.slow]))];
    const before = record ? new Map(linked.map(rec => [rec, measure(rec)])) : null;
    let moved = true;
    while (moved) {
      moved = false;
      for (const rule of rules) moved = bound(rule) || moved;
    }
    if (before) {
      const cuts = linked.map(rec => cutOf(rec, before.get(rec))).filter(Boolean);
      if (cuts.length) events.push({ turn: battle.turn, what: 'every speed order at once, each bound passed on to the Pokemon ordered against it', cuts });
    }
  }

  return { rules: speedRules, apply: applySpeed };
}
