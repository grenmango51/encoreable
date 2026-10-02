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

export function attachSpeed(battle, {
  state, sync, memo, guarded, recs, byPokemon, byIdent, view, prefix, record, events, label, measure, cutOf, note, depOf, ownValue,
}) {
  const byId = new Map(recs.map(rec => [rec.id, rec]));
  const sorts = [];
  const executed = [];
  const tainted = new Set();
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

  const queue = battle.queue;
  const origSort = queue.sort;
  queue.sort = function () {
    const out = origSort.call(this);
    if (!state.dry && !state.ended) {
      sync();
      const entry = { turn: battle.turn, list: this.list.map(a => ({ action: a, order: a.order, priority: a.priority || 0, pokemon: a.pokemon || null })), speeds: new Map() };
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
  for (const name of ['prioritizeAction', 'changeAction']) {
    const orig = queue[name];
    queue[name] = function (...args) {
      tainted.add(battle.turn);
      return orig.apply(this, args);
    };
  }

  const origRun = battle.runAction;
  battle.runAction = function (action) {
    if (state.dry || state.ended) return origRun.call(this, action);
    sync();
    const start = battle.log.length;
    const sort = lastSort;
    try {
      return origRun.call(this, action);
    } finally {
      executed.push({ action, pokemon: action.pokemon || null, start, end: battle.log.length, sort });
    }
  };

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
    const visible = (ex) => {
      const rec = ex.pokemon && byPokemon.get(ex.pokemon);
      if (!rec || ex.end > upTo) return false;
      const me = new RegExp(`(^|\\|| )${rec.side}[a-d]: ${rec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||$)`);
      for (let i = firstAt(ex.start); i < view.length && view[i].at < ex.end; i++) {
        if (me.test(view[i].line)) return true;
      }
      return false;
    };
    for (let i = firstAt(0); i < view.length && view[i].at < upTo; i++) {
      if (/\|(move: )?(After You|Quash|Instruct)(\||$)/.test(view[i].line)) {
        tainted.add(executed.find(ex => ex.start <= view[i].at && view[i].at < ex.end)?.sort?.turn);
      }
    }
    const shown = new Map(executed.map(ex => [ex.action, { ex, on: visible(ex) }]));
    const order = new Map(executed.map((ex, i) => [ex.action, i]));
    const rules = [];
    for (const [i, ex] of executed.entries()) {
      const S = ex.sort;
      if (!S || tainted.has(S.turn) || !shown.get(ex.action)?.on) continue;
      const at = S.list.findIndex(item => item.action === ex.action);
      if (at < 0) continue;
      const x = S.list[at];
      for (const y of S.list.slice(at + 1)) {
        if (!y.pokemon || y.pokemon === x.pokemon || y.order !== x.order || y.priority !== x.priority) continue;
        const later = order.get(y.action);
        if (later === undefined || later <= i || !shown.get(y.action)?.on) continue;
        const X = byPokemon.get(x.pokemon);
        const Y = byPokemon.get(y.pokemon);
        const rule = ruleOf(X, Y, S.speeds, S.turn, `${label(X)} acted before ${label(Y)}`);
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

    // The log diverged on who moved: the observed order is the true one. A
    // side with Illusion can print one Pokemon's name for another, so a name
    // the replay's line gives on that side says nobody for certain.
    const cut = view.find(e => e.at === prefix.cutoffAt);
    const disguisable = sideId => !!battle.sides.find(side => side.id === sideId)?.pokemon.some(p => p.baseAbility === 'illusion');
    const who = line => /^\|(move|cant)\|/.test(String(line || '')) ? String(line).split('|')[2] : null;
    const was = who(prefix.observedLine);
    const got = who(cut?.line);
    if (was && got && was !== got && !disguisable(identSide(was))) {
      const ex = executed.find(e => e.start <= prefix.cutoffAt && prefix.cutoffAt < e.end);
      const P = byIdent.get(`${identSide(was)}:${identName(was)}`);
      const S = ex?.sort;
      const x = S?.list.find(item => item.action === ex.action);
      const y = S?.list.find(item => item.pokemon === P?.pokemon && item.order === x?.order && item.priority === x?.priority);
      const Q = x && byPokemon.get(x.pokemon);
      const rule = P && Q && y && !tainted.has(S.turn) ? ruleOf(P, Q, S.speeds, S.turn, `${label(P)} acted before ${label(Q)}`) : null;
      if (rule) rules.push(rule);
    }

    // The log diverged inside an event sort: the rebuild's handler for Q wrote
    // its line where the replay shows P's. That proves P went first only if
    // the replay shows Q's line too, after P's and before the next action - a
    // handler can stay silent in the real battle (a Leftovers heal at full HP),
    // and then the replay's order says nothing about it.
    const whose = (line) => {
      const first = String(line).split('|')[2] || '';
      const ident = /^p[1-4][a-d]?: /.test(first) ? first : tagsOf(String(line)).of;
      return ident ? byIdent.get(`${identSide(ident)}:${identName(ident)}`) : null;
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
        const x = P && !disguisable(P.side) && entry.items.find(it => it.rec === P
          && (entry.kind === 'eachEvent'
            || (it.effect && (it.effect === hit.item.effect || prefix.observedLine.includes(it.effect.name)))));
        let later = false;
        for (const line of prefix.observedAfter) {
          if (ACTION_START.has(line.split('|')[1])) break;
          if (line === rebuilt) { later = true; break; }
        }
        if (x && later) eventRule(entry, x, hit.item);
        break;
      }
    }
    return rules;
  }

  function applySpeed(rules) {
    let sweep = 0;
    let moved = true;
    while (moved && sweep++ < 16) {
      moved = false;
      for (const rule of rules) {
        const { fast, slow, tf, ts } = rule;
        const before = record && sweep === 1 ? [measure(fast), measure(slow)] : null;
        let maxFast = -Infinity;
        let minSlow = Infinity;
        for (let v = 0; v < SPAN; v++) {
          if (fast.flat.spe[v]) maxFast = Math.max(maxFast, tf[v]);
          if (slow.flat.spe[v]) minSlow = Math.min(minSlow, ts[v]);
        }
        for (let v = 0; v < SPAN; v++) {
          if (fast.flat.spe[v] && tf[v] < minSlow) { fast.flat.spe[v] = 0; moved = true; }
          if (slow.flat.spe[v] && ts[v] > maxFast) { slow.flat.spe[v] = 0; moved = true; }
        }
        if (before) {
          const cuts = [cutOf(fast, before[0]), cutOf(slow, before[1])].filter(Boolean);
          if (cuts.length) events.push({ turn: rule.turn, what: rule.what || `${label(fast)} acted before ${label(slow)}`, cuts });
        }
      }
    }
  }

  return { rules: speedRules, apply: applySpeed };
}
