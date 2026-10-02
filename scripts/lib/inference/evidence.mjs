/**
 * One evidence pass: replay a rebuilt battle with the simulator hooked, and
 * remove every spread the verified part of it rules out. The simulator is
 * asked, per surviving spread and in the real position, at:
 *
 *   - every damage calculation. At the moment the real hit is computed, the same
 *     `getDamage` is run again for every surviving attacking and defending stat,
 *     under the dry-run guards `damageLadder` established (docs/engineering.md 4): a
 *     cloned move, no dice consumed, no messages, state restored. The in-flight
 *     move is cloned, so weather, Helping Hand, screens and boosts are exactly
 *     the real ones. `modifyDamage` is memoised on the value it receives, since
 *     everything after that point is the same whatever the stats were.
 *   - every HP change. Each candidate carries the set of exact HP values it
 *     could be sitting on, because the replay shows the opponent only as a
 *     percentage. A change maps each value through every damage roll, and the
 *     line the log printed next keeps only what the simulator's own `getHealth`
 *     would have printed.
 *   - every held-item check, for a pinch Berry that fired or stayed uneaten.
 *
 * Speed order comes from `speed.mjs`. Where the simulator cannot be asked - an
 * HP change of unknown shape - the candidate may move anywhere the next printed
 * line allows, which loses precision and never eliminates a spread that fits.
 * With every guess pinned, the pass also names one exact HP path through the
 * verified turns and the damage roll behind each hit on it, which is what the
 * next round is handed.
 */

import { createRequire } from 'module';

import { battleLines, firstDivergence } from '../protocol.mjs';
import { install } from '../rng-control.mjs';
import {
  ROLLS, SOFT_PRETURN, cloneMove, hpRank, identName, identSide, override, restoreItems, restoreMove, saveLog, snapItems,
  splitTurns, withDice,
} from '../reconstruct.mjs';
import {
  FLAT, KEY_DIM, KEY_HP, SPAN, STAT_IDS, aliveOf, fullEvs, maskKeys, newTie, pairName, rangesOf, spreadCount, supported, tieHas, tieWords,
} from './knowledge.mjs';
import { attachSpeed } from './speed.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, toID } = require('pokemon-showdown');

const HP_BITS = 4096;

/** Every fraction of max HP an effect is written as - `baseMaxhp / 16`, `* 3 / 4`. */
const FRACTIONS = (() => {
  const seen = new Set();
  const out = [];
  for (const d of [2, 3, 4, 6, 8, 10, 12, 16]) {
    for (let n = 1; n < d; n++) {
      const f = n / d;
      if (!seen.has(f)) { seen.add(f); out.push(f); }
    }
  }
  return out;
})();

// ------------------------------------------------------- reading the replay

/** The lines one channel shows, each tagged with its index in the raw log. */
function channelView(raw, channel) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const split = /^\|split\|p([1-4])$/.exec(raw[i]);
    if (split) {
      const at = channel === -1 || Number(split[1]) === channel ? i + 1 : i + 2;
      if (raw[at]) out.push({ line: raw[at], at });
      i += 2;
      continue;
    }
    if (raw[i]) out.push({ line: raw[i], at: i });
  }
  return out;
}

/**
 * Where a rebuilt log stops agreeing with the observed one, as a raw-log index.
 * Compared exactly the way `playThrough` compares, so the verified prefix here
 * is the one the reconstruction report means.
 */
function verifiedPrefix(view, observed) {
  const want = splitTurns(observed.filter(l => typeof l === 'string'));
  const got = [[]];
  for (const entry of view) {
    got[got.length - 1].push(entry);
    if (/^\|turn\|\d+/.test(entry.line)) got.push([]);
  }
  for (let k = 0; k < want.length; k++) {
    const soft = (line) => {
      const kind = String(line).split('|')[1];
      return kind === 'player' || (k === 0 && SOFT_PRETURN.has(kind));
    };
    const a = battleLines(want[k]).filter(l => !soft(l));
    const b = (got[k] || [])
      .map(e => ({ at: e.at, line: battleLines([e.line])[0] }))
      .filter(e => e.line !== undefined && !soft(e.line));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]?.line) continue;
      const next = b[i]?.at ?? got[k + 1]?.[0]?.at ?? Infinity;
      return { cutoffAt: next, observedLine: a[i] ?? null, observedAfter: a.slice(i + 1), turn: k };
    }
  }
  return { cutoffAt: Infinity, observedLine: null, observedAfter: [], turn: null };
}

const HP_FIELD = { '-damage': 3, '-heal': 3, '-sethp': 3, switch: 4, drag: 4, replace: 4 };

function hpLine(line) {
  const parts = String(line || '').split('|');
  const at = HP_FIELD[parts[1]];
  // `|replace|`, Illusion breaking, names the Pokemon without its HP.
  if (at === undefined || !parts[at]) return null;
  return {
    kind: parts[1],
    side: identSide(parts[2]),
    slot: 'abcd'.indexOf(String(parts[2] || '')[2]),
    name: identName(parts[2]),
    token: String(parts[at] || '').split(' ')[0],
    changes: at === 3,
  };
}

// -------------------------------------------------------- one evidence pass

async function replayRaw(lines) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  for (const line of lines) await stream.write(line);
  const raw = [...stream.battle.log];
  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return raw;
}

/**
 * Replay one input log and remove every spread the verified part of it rules
 * out. `knowledge` is read, never written; the caller intersects the result.
 */
export async function evidencePass({ inputLog, observed, channel, knowledge, cache, record, exact = false }) {
  const lines = (Array.isArray(inputLog) ? inputLog : String(inputLog).split('\n'))
    .map(l => String(l).trimEnd())
    .filter(l => l.startsWith('>'));
  let pre = cache.get('raw');
  if (!pre) { pre = await replayRaw(lines); cache.set('raw', pre); }
  const view = channelView(pre, channel);
  const prefix = verifiedPrefix(view, observed);

  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  let ctx = null;
  try {
    for (const line of lines) {
      if (!ctx && /^>p[1-4] /.test(line)) {
        ctx = attachInference(stream.battle, { view, prefix, channel, knowledge, cache, record });
      }
      await stream.write(line);
      // Draw ordinals count from installation, and `playThrough` installs right
      // after `>start`, so a roll found here is addressed the way a pin is.
      if (line.startsWith('>start')) install(stream.battle);
      if (ctx?.state.ended) break;
    }
    if (!ctx) throw new Error('the input log makes no choices, so there is nothing to infer from');
    ctx.finish();
    if (exact) {
      const found = ctx.paths(pre);
      ctx.exact = found && exactTurns(pre, found.tokens, prefix);
      ctx.rolls = found?.rolls || null;
    }
    const clock = l => (String(l).startsWith('|t:|') ? '|t:|' : l);
    const drift = firstDivergence(stream.battle.log.map(clock), pre.slice(0, stream.battle.log.length).map(clock));
    if (drift) throw new Error(`inference perturbed the battle at raw line ${drift.index}: ${drift.actual} -> ${drift.expected}`);
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
  return { ...ctx.result(), exact: ctx.exact || null, rolls: ctx.rolls || null };
}

/**
 * The verified turns of a scaffold as the omniscient channel shows them, with
 * every hidden HP replaced by the exact value an evidence path chose.
 */
function exactTurns(raw, tokens, prefix) {
  const view = channelView(raw, -1);
  const turns = new Map();
  let k = 0;
  let lines = [];
  // A path that ends a Pokemon on 0 HP prints it fainted, whatever HP the
  // scaffold left it on.
  const withHp = (line, token) => {
    if (token === undefined) return line;
    const parts = line.split('|');
    const at = HP_FIELD[parts[1]];
    const field = String(parts[at] || '');
    parts[at] = token === '0' ? '0 fnt' : `${token}${field.includes(' ') ? field.slice(field.indexOf(' ')) : ''}`;
    return parts.join('|');
  };
  for (const entry of view) {
    if (prefix.turn !== null && k > prefix.turn) break;
    // The omniscient view shows a split line's secret half one index before
    // the half the observing channel shows.
    const split = /^\|split\|/.test(raw[entry.at - 1] || '');
    const cut = entry.at === prefix.cutoffAt || (split && entry.at === prefix.cutoffAt - 1);
    if (prefix.turn !== null && k === prefix.turn && (cut || entry.at > prefix.cutoffAt)) {
      // The failing line itself is proved only when it is a hidden HP the path
      // chose; anything else there is the scaffold's mistake, not the truth.
      if (cut && tokens.has(entry.at)) lines.push(withHp(entry.line, tokens.get(entry.at)));
      break;
    }
    lines.push(withHp(entry.line, tokens.get(entry.at)));
    if (/^\|turn\|\d+/.test(entry.line)) {
      turns.set(k, { lines, partial: false });
      k++;
      lines = [];
    }
  }
  if (prefix.turn !== null && lines.length) turns.set(prefix.turn, { lines, partial: true });
  return turns;
}

function attachInference(battle, { view, prefix, channel, knowledge, cache, record }) {
  const st = install(battle);
  const actions = battle.actions;
  const state = { ended: false, dry: 0, hold: 0 };
  const events = [];
  const pendingHits = new Map();
  // Hits on a fresh Substitute, until the line says whether it broke.
  const subGates = new Map();
  const damageContext = new Map();
  const healContext = new Map();
  let viewPos = 0;
  let hitOrdinal = 0;
  let changeOrdinal = 0;
  let seq = 0;

  const memo = (key, make) => {
    let value = cache.get(key);
    if (value === undefined) { value = make(); cache.set(key, value); }
    return value;
  };

  // Every place the simulator and one of this pass's own shortcuts disagreed,
  // so the shortcut was not used there. Each is a line of evidence given up.
  const checks = [];
  const noted = new Set();
  const note = (what, reason) => {
    const key = `${battle.turn}|${what}|${reason}`;
    if (noted.has(key)) return;
    noted.add(key);
    checks.push({ turn: battle.turn, what, reason });
  };

  // ------------------------------------------------------------ who is who

  const recs = [];
  const byPokemon = new Map();
  const byIdent = new Map();
  // The stored-stat writes of the handler running right now, when one is being
  // asked about per candidate.
  let writes = null;
  for (const side of battle.sides) {
    for (const [index, pokemon] of side.pokemon.entries()) {
      const id = `${side.id}:${index}`;
      const kn = knowledge.get(id);
      if (!kn) continue;
      const byForme = new Map();
      // Max HP is set once, from the species the Pokemon entered the battle as:
      // a Mega Evolution or a Transform changes every other stat, never HP.
      const hpSpecies = pokemon.species;
      const rec = {
        id,
        side: side.id,
        pokemon,
        name: pokemon.name,
        kn,
        knKeys: maskKeys(kn.keys),
        exact: channel === -1 || side.id === `p${channel}`,
        chain: null,
        flat: { atk: kn.dom.atk.slice(), spa: kn.dom.spa.slice(), spe: kn.dom.spe.slice() },
        ties: Object.fromEntries(Object.entries(kn.ties || {}).map(([x, t]) => [x, t.slice()])),
        pending: [],
        history: [],
        shown: [],
        // A stat as the simulator computes it for this Pokemon's current forme.
        stat(stat, sp) {
          const species = stat === 'hp' ? hpSpecies : pokemon.species;
          let table = byForme.get(species);
          if (!table) {
            table = {};
            for (const s of STAT_IDS) {
              table[s] = Int32Array.from({ length: SPAN }, (_, v) => battle.statModify(
                species.baseStats, { ...pokemon.set, evs: { ...fullEvs(pokemon.set.evs), [s]: v } }, s));
            }
            byForme.set(species, table);
          }
          return table[stat][sp];
        },
      };
      recs.push(rec);
      byPokemon.set(pokemon, rec);
      byIdent.set(`${side.id}:${pokemon.name}`, rec);

      // A max HP its own Stat Points do not give - a species with a fixed HP -
      // says nothing about its HP Stat Points.
      if (rec.stat('hp', fullEvs(pokemon.set.evs).hp) !== pokemon.baseMaxhp) {
        rec.fixedHp = pokemon.baseMaxhp;
        note(`${pokemon.species.name}'s max HP`, 'is not the one its Stat Points give, so HP lines say nothing about them');
      }

      // A stat the simulator writes outside `setSpecies` - Power Split, Guard
      // Split, Power Trick, Speed Swap, Transform - is no longer the one this
      // Pokemon's own Stat Points give, until its next `setSpecies` (a switch
      // out). Where the write was asked about per candidate (`askWrites`,
      // `transformInto`), `deps` says what the stat depends on now; any other
      // write leaves it `unmapped`, and whatever reads it is set aside. Writes
      // are watched rather than values compared: an average that happens to
      // equal the old value still stops depending on the spread.
      rec.deps = {};
      rec.unmapped = new Set();
      let settingSpecies = 0;
      pokemon.storedStats = new Proxy(pokemon.storedStats, {
        set(target, key, value) {
          target[key] = value;
          if (!state.dry && !settingSpecies) {
            if (writes) writes.push([rec, key]);
            else rec.unmapped.add(key);
          }
          return true;
        },
      });
      const setSpecies = pokemon.setSpecies;
      override(pokemon, 'setSpecies', function (...args) {
        settingSpecies++;
        try {
          return setSpecies.apply(this, args);
        } finally {
          settingSpecies--;
          if (!state.dry && !args[2]) {
            rec.deps = {};
            rec.unmapped.clear();
          }
        }
      });
    }
  }
  const maxHp = (rec, hp) => rec.fixedHp ?? rec.stat('hp', hp);
  const byId = new Map(recs.map(rec => [rec.id, rec]));

  /**
   * What one stored stat of a Pokemon is, as a function of one candidate value:
   * `{ owner, stat, at(v) }`, the stored stat when `owner`'s `stat` Stat Points
   * are v; `CONSTANT` when it is the same whatever the spread - a known
   * Pokemon's, or one copied from it; or null when no one candidate value says.
   */
  const CONSTANT = { owner: null };
  function depOf(rec, stat) {
    if (rec.unmapped.has(stat)) return null;
    if (rec.deps[stat]) return rec.deps[stat];
    if (rec.kn.known) return CONSTANT;
    return { owner: rec, stat, at: v => rec.stat(stat, v) };
  }
  const ownValue = dep => fullEvs(dep.owner.pokemon.set.evs)[dep.stat];
  /** Whether a stored stat is still the one the Pokemon's own Stat Points give. */
  const plain = (rec, stat) => !rec.unmapped.has(stat) && !rec.deps[stat];
  // A Pokemon by the species it is, not one it has transformed into.
  const label = rec => rec.pokemon.baseSpecies.name;
  const countOf = (rec) => {
    const count = spreadCount(rec.chain ? rec.chain.keys() : rec.knKeys, rec.flat, rec.ties);
    return rec.kn.spent ? count.spent : count.total;
  };

  // What an event did to one Pokemon: the spread count before and after, each
  // stat's range after, and which of those ranges it moved.
  const measure = rec => ({ count: countOf(rec), stats: rangesOf(rec.chain ? rec.chain.keys() : rec.knKeys, rec.flat, rec.kn.spent, rec.ties) });
  const sameRange = (a, b) => (a === null ? b === null : b !== null && a.min === b.min && a.max === b.max);
  function cutOf(rec, before) {
    const after = measure(rec);
    if (after.count === before.count) return null;
    return {
      id: rec.id,
      pokemon: label(rec),
      before: before.count,
      after: after.count,
      stats: after.stats,
      narrowed: STAT_IDS.filter(s => !sameRange(before.stats[s], after.stats[s])),
    };
  }

  function initChain(rec) {
    rec.chain = new Map();
    for (const k of rec.knKeys) rec.chain.set(k, [maxHp(rec, KEY_HP[k])]);
  }

  /** The HP values behind one printed display, read off the simulator's `getHealth`. */
  function interval(rec, M, token) {
    return memo(`show|${rec.exact ? 'x' : 's'}|${M}|${token}`, () => {
      const want = hpRank(token, rec.exact);
      if (!want || (rec.exact && want.max !== null && want.max !== M)) return null;
      const p = rec.pokemon;
      const saved = [p.hp, p.maxhp];
      const rankAt = (h) => {
        p.hp = h;
        p.maxhp = M;
        const shown = p.getHealth();
        return hpRank(String(rec.exact ? shown.secret : shown.shared).split(' ')[0], rec.exact)?.rank ?? -1;
      };
      try {
        let lo = 0;
        let hi = M;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (rankAt(mid) < want.rank) lo = mid + 1; else hi = mid; }
        const first = lo;
        hi = M;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rankAt(mid) > want.rank) hi = mid - 1; else lo = mid; }
        return rankAt(first) === want.rank ? [first, lo] : null;
      } finally {
        [p.hp, p.maxhp] = saved;
      }
    });
  }

  // ------------------------------------------------------------ dry runs

  /**
   * Run `fn` dry on damage roll `roll`. Any other die it throws takes the face
   * the real calculation's die with the same range took (`draws`), so a chance
   * inside the calculation - Fickle Beam doubling its power - lands as it did.
   */
  function withRoll(roll, fn, draws = null) {
    const undo = override(battle, 'random', (m, n) => (m === 16 && n === undefined ? roll : (n === undefined ? 0 : m)));
    const prevDry = st.dry;
    st.dry = { roll, draws: draws ? draws.map(d => ({ ...d, used: false })) : null };
    try { return fn(); } finally { st.dry = prevDry; undo(); }
  }

  function patchAll(patches) {
    const undo = [];
    for (const { pokemon, stats, hp, maxhp } of patches) {
      const saved = { stored: { ...pokemon.storedStats }, hp: pokemon.hp, maxhp: pokemon.maxhp, baseMaxhp: pokemon.baseMaxhp };
      for (const [s, v] of Object.entries(stats || {})) pokemon.storedStats[s] = v;
      if (maxhp !== undefined) { pokemon.maxhp = maxhp; pokemon.baseMaxhp = maxhp; }
      if (hp !== undefined) pokemon.hp = hp;
      undo.push(() => {
        Object.assign(pokemon.storedStats, saved.stored);
        pokemon.hp = saved.hp;
        pokemon.maxhp = saved.maxhp;
        pokemon.baseMaxhp = saved.baseMaxhp;
      });
    }
    return () => { for (const u of undo.reverse()) u(); };
  }

  /** Everything a dry run may disturb on the battle itself. */
  function guarded(fn) {
    state.dry++;
    // No dry run touches the generator: a die it throws takes the bottom of
    // its range, unless a caller handed it the real run's (`withRoll`).
    const dry = st.dry;
    st.dry ||= { roll: 0, draws: null };
    const saved = {
      log: saveLog(battle),
      faints: battle.faintQueue.length,
      move: battle.activeMove,
      target: battle.activeTarget,
      user: battle.activePokemon,
      lastDamage: battle.lastDamage,
    };
    try {
      return fn();
    } finally {
      saved.log();
      battle.faintQueue.length = saved.faints;
      battle.activeMove = saved.move;
      battle.activeTarget = saved.target;
      battle.activePokemon = saved.user;
      battle.lastDamage = saved.lastDamage;
      st.dry = dry;
      state.dry--;
    }
  }

  /**
   * The move one dry calculation runs on: a fresh copy of the one taken before
   * the real calculation, so no dry run sees another's changes - Beat Up takes
   * an ally off its list each time. Where that copy did not reproduce the real
   * hit, the real move itself, handed back afterwards as it was.
   */
  function onMove(hit, fn) {
    if (!hit.onReal) {
      const copy = cloneMove(hit.clone);
      copy.moveHitData = undefined;
      return fn(copy);
    }
    const move = hit.move;
    const snap = cloneMove(move);
    const hitData = move.moveHitData;
    move.moveHitData = undefined;
    move.willCrit = hit.crit;
    try {
      return fn(move);
    } finally {
      restoreMove(move, snap);
      move.moveHitData = hitData;
    }
  }

  /**
   * Sixteen damage values for one set of stats. `getDamage` runs once; every
   * roll re-runs only `modifyDamage`, memoised on the value it is handed.
   */
  function dryRow(hit, patches, post) {
    return guarded(() => {
      const undoPatch = patchAll(patches);
      let row = null;
      const origModify = actions.modifyDamage;
      const undoModify = override(actions, 'modifyDamage', function (base, pokemon, target, move, suppress) {
        let cached = post.get(base);
        if (!cached) {
          cached = [];
          for (let r = 0; r < ROLLS; r++) {
            restoreItems(hit.items);
            cached.push(withRoll(r, () => origModify.call(this, base, pokemon, target, move, suppress), hit.draws));
          }
          post.set(base, cached);
        }
        row = cached;
        return cached[0];
      });
      try {
        restoreItems(hit.items);
        const out = withRoll(0, () => onMove(hit, move => hit.getDamage.call(actions, hit.source, hit.target, move, true)), hit.draws);
        return row || new Array(ROLLS).fill(typeof out === 'number' ? out : null);
      } finally {
        undoModify();
        undoPatch();
        restoreItems(hit.items);
      }
    });
  }

  const rowKey = (a, d, hp, h, si) => `${a}|${d}|${hp ?? '-'}|${h ?? '-'}|${si}`;

  /** The stored stat a calculation asking for `stat` reads right now. */
  const roomStat = stat => (!battle.field.pseudoWeather.wonderroom ? stat
    : stat === 'def' ? 'spd' : stat === 'spd' ? 'def' : stat);

  /**
   * A confusion self-hit, as a hit on itself: the simulator's own
   * `getConfusionDamage`, run again for every surviving Attack and Defence and
   * all sixteen rolls. It reads nothing but the Pokemon's own stats, each its
   * own Stat Points' or a constant - one Transform or Imposter copied from a
   * known Pokemon; a stat that stands on anything else is not used.
   */
  function selfHit(pokemon, basePower, real, items, getConfusionDamage) {
    const T = byPokemon.get(pokemon);
    const ord = hitOrdinal++;
    if (!T.chain) initChain(T);
    const def = roomStat('def');
    const hit = {
      S: T, T, A: T, source: pokemon, target: pokemon, real, items, ord, supported: true,
      off: 'atk', offDim: false, offBy: 'source', def, targetHp: false, sourceHp: false, sStates: [null],
      clone: { name: 'confusion' }, what: `${label(T)} hurt itself in its confusion`,
    };
    const varOf = (stat) => {
      const dep = depOf(T, stat);
      if (!dep) return undefined;
      if (!dep.owner) return null;
      return dep.owner === T && dep.stat === stat ? dep : undefined;
    };
    const atkVar = varOf('atk');
    const defVar = varOf(def);
    const rowAt = (a, d) => memo(`conf|${ord}|${a}|${d}`, () => guarded(() => {
      const stats = {};
      if (atkVar) stats.atk = T.stat('atk', a);
      if (defVar) stats[def] = T.stat(def, d);
      const undo = patchAll([{ pokemon, stats }]);
      try {
        return Array.from({ length: ROLLS }, (_, r) => withRoll(r, () => getConfusionDamage.call(actions, pokemon, basePower)));
      } finally {
        undo();
      }
    }));
    const own = fullEvs(pokemon.set.evs);
    const moved = atkVar === undefined || defVar === undefined;
    if (moved || !rowAt(own.atk, own[def]).includes(real)) {
      hit.supported = false;
      note(hit.what, moved ? 'a stat it read was moved by another effect, so the hit was not used'
        : 'no dry calculation reproduced the real damage, so the hit was not used');
      return hit;
    }
    if (!atkVar) hit.off = null;
    hit.aVals = atkVar ? aliveOf(T.flat.atk) : [0];
    const dVals = new Set([...T.chain.keys()].map(k => KEY_DIM[def][k]));
    hit.rows = new Map();
    for (const a of hit.aVals) {
      for (const d of dVals) hit.rows.set(rowKey(a, d, null, null, 0), rowAt(a, d));
    }
    return hit;
  }
  const sameRow = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  /**
   * What one real damage calculation depends on, and its value for every
   * surviving stat. Computed before the real result lands, in the real position.
   */
  function analyseHit(source, target, move, clone, crit, real, items, getDamage, draws, hpBefore) {
    const S = byPokemon.get(source);
    const T = byPokemon.get(target);
    const ord = hitOrdinal++;
    const hit = { S, T, source, target, move, clone, crit, real, items, getDamage, draws, ord, supported: false };
    clone.willCrit = crit;
    if (!T.chain) initChain(T);
    const what = `${label(S)}'s ${clone.name} hit ${label(T)}`;

    // Every row below is a dry calculation standing in for the real one. At the
    // stats this replay is running with, the two answer the same question, so
    // the dry one must deal the real damage on the roll the real one took - not
    // merely on some roll, since a boosted low roll and an unboosted high one
    // can share a value. When the copy of the move does not, the real move is
    // used instead; when neither does, the hit is not used at all.
    // Both are asked at the HP the Pokemon had going in: Final Gambit knocks its
    // own user out before it returns that HP as damage.
    const faces = draws.filter(d => d.from === ROLLS && d.to === -1);
    const fits = row => (faces.length === 1 ? row[faces[0].value] === real : row.includes(real));
    const goingIn = [...hpBefore].filter(([p, hp]) => p.hp !== hp).map(([pokemon, hp]) => ({ pokemon, hp }));
    const check = memo(`check|${ord}`, () => {
      if (fits(dryRow(hit, goingIn, new Map()))) return 'copy';
      hit.onReal = true;
      try {
        return fits(dryRow(hit, goingIn, new Map())) ? 'real' : 'none';
      } finally {
        hit.onReal = false;
      }
    });
    if (check === 'none') {
      note(what, 'no dry calculation reproduced the real damage, so the hit was not used');
      return hit;
    }
    if (check === 'real') {
      hit.onReal = true;
      note(what, 'the copied move did not reproduce the real damage, so the real move was used');
    }

    const shape = memo(`hit|${ord}`, () => {
      // Which stats the calculation reads, observed rather than assumed: Body
      // Press, Foul Play and Psyshock read something else, and Wonder Room swaps.
      const reads = [];
      const undo = [];
      for (const p of new Set([source, target])) {
        const calc = p.calculateStat;
        const get = p.getStat;
        undo.push(override(p, 'calculateStat', function (stat, ...rest) { reads.push([p, toID(stat)]); return calc.call(this, stat, ...rest); }));
        undo.push(override(p, 'getStat', function (stat, ...rest) { reads.push([p, toID(stat)]); return get.call(this, stat, ...rest); }));
      }
      let base;
      try { base = dryRow(hit, [], new Map()); } finally { for (const u of undo.reverse()) u(); }

      // Whose stat attacks, and which, is the move's to say: Foul Play attacks
      // with the target's Attack, Body Press with the user's Defence, Psyshock
      // hits Defence with a special move. Under Wonder Room a stat asked for as
      // one defence is read from the other (`calculateStat`), so the Stat Points
      // that matter are the other defence's.
      //
      // Each stat read stands on one candidate value at most (`depOf`): the
      // Pokemon's own Stat Points, or after Power Split the average's other
      // side, or none once Transform copied a known Pokemon's. A hit's rows
      // vary two of them: the target's defence, a dimension of its joint key,
      // and one more - the attacking stat as a flat domain, or for Body Press a
      // dimension of the attacker's key. The target's Speed, which Gyro Ball and
      // Electro Ball read, is that one more when no hidden attacking stat is.
      const physical = clone.category === 'Physical';
      const wantDef = clone.overrideDefensiveStat || (physical ? 'def' : 'spd');
      const shaped = source !== target && clone.overrideDefensivePokemon !== 'source';
      const vars = new Map();
      const unmapped = new Set();
      for (const [p, s] of reads) {
        const rec = byPokemon.get(p);
        const key = roomStat(s);
        const dep = depOf(rec, key);
        if (!dep) { unmapped.add(label(rec)); continue; }
        if (!dep.owner) continue;
        const v = `${dep.owner.id}|${dep.stat}`;
        if (!vars.has(v)) vars.set(v, { owner: dep.owner.id, stat: dep.stat, readers: [] });
        const reader = { who: p === source ? 'source' : 'target', key };
        if (!vars.get(v).readers.some(r => r.who === reader.who && r.key === reader.key)) vars.get(v).readers.push(reader);
      }
      // One more candidate value can come beside those two, of any Pokemon: a
      // hidden user of Gyro Ball brings its Speed beside its Attack; after Guard
      // Split your Defence stands on the hidden attacker's, and after your
      // Imposter copied the opponent's other Pokemon, on that one's. It is
      // carried like the attacker's HP, as a source state the victim's line
      // narrows.
      const isDim = x => x.stat === 'def' || x.stat === 'spd';
      const dims = [...vars.values()].filter(x => x.owner === T.id && isDim(x));
      const others = [...vars.values()].filter(x => !dims.includes(x));
      const offVar = others.find(x => FLAT.includes(x.stat)) || others[0] || null;
      const extraVar = others.find(x => x !== offVar) || null;
      const supported = shaped && !unmapped.size && dims.length <= 1 && others.length <= 2
        && (!offVar || FLAT.includes(offVar.stat) || offVar.owner !== T.id);
      const def = dims[0]?.stat || roomStat(wantDef);
      const off = offVar ? offVar.stat : null;
      const readers = [...vars.values()].flatMap(x => x.readers.map(r => ({ ...r, by: x === offVar ? 'a' : x === extraVar ? 'x' : 'd' })));

      // HP matters to Water Spout, Multiscale, Brine, pinch abilities, and max
      // HP to a one-hit knockout. Ask rather than list: the row either moves
      // with them or it does not.
      const probe = (p) => [...new Set([p.maxhp, p.maxhp - 1, Math.ceil(p.maxhp / 2),
        Math.floor(p.maxhp / 2), Math.floor(p.maxhp / 3), Math.floor(p.maxhp / 4), 1])].filter(h => h >= 1);
      const moves = p => probe(p).some(h => !sameRow(dryRow(hit, [{ pokemon: p, hp: h }], new Map()), base))
        || !sameRow(dryRow(hit, [{ pokemon: p, maxhp: p.maxhp + 1 }], new Map()), base);
      const targetHp = moves(target);
      const sourceHp = moves(source);
      // A damage callback that reads no stat and no HP hands on an amount the
      // battle kept from earlier - Counter, Mirror Coat, Metal Burst and
      // Comeuppance return what the user was dealt. That amount was the
      // replay's own, and another spread would have been dealt another.
      const carried = !!clone.damageCallback && !reads.length && !targetHp && !sourceHp;
      return {
        off, offOwner: offVar?.owner ?? null, extra: extraVar ? { owner: extraVar.owner, stat: extraVar.stat } : null,
        def, readers, supported: supported && !carried, carried,
        moved: [...unmapped], targetHp, sourceHp,
      };
    });
    Object.assign(hit, shape);
    if (hit.moved.length) note(what, `${hit.moved.join(' and ')} had a stat it read moved where no one candidate value says what it became, so it was not used`);
    if (!hit.supported) return hit;

    // The attacking stat is a flat domain (Attack, Special Attack) or, for Body
    // Press, a dimension of the user's joint key.
    const A = hit.offOwner ? byId.get(hit.offOwner) : S;
    hit.A = A;
    hit.offDim = hit.off === 'def' || hit.off === 'spd';
    if (hit.offDim && !A.chain) initChain(A);
    hit.aVals = !hit.off || A.kn.known ? [0]
      : hit.offDim ? [...new Set([...A.chain.keys()].map(k => KEY_DIM[hit.off][k]))].sort((x, y) => x - y)
        : aliveOf(A.flat[hit.off]);
    const dVals = new Set();
    const tStates = new Map();
    for (const [k, hs] of T.chain) {
      dVals.add(KEY_DIM[hit.def][k]);
      if (hit.targetHp) for (const h of hs) tStates.set(`${KEY_HP[k]}|${h}`, [KEY_HP[k], h]);
    }
    // The source states: the HP the attacker could be on, when the hit reads
    // it, and the value of the one more candidate, when there is one - each as
    // `[maxhp, hp, extra]`, null where the hit reads no such thing. The
    // attacker's own key dimension goes with its own HP, key by key.
    const sStates = [];
    const X = hit.extra ? byId.get(hit.extra.owner) : null;
    const xDim = !!X && !FLAT.includes(hit.extra.stat);
    if (X && xDim && !X.chain) initChain(X);
    if (hit.sourceHp || X) {
      if (!S.chain) initChain(S);
      const seen = new Set();
      const add = (M, h, x) => {
        const id = `${M}|${h}|${x}`;
        if (!seen.has(id)) { seen.add(id); sStates.push([M, h, x]); }
      };
      const values = !X ? [null] : xDim ? [...new Set([...X.chain.keys()].map(k => KEY_DIM[hit.extra.stat][k]))] : aliveOf(X.flat[hit.extra.stat]);
      for (const [k, hs] of S.chain) {
        const M = hit.sourceHp ? maxHp(S, KEY_HP[k]) : null;
        for (const h of hit.sourceHp ? hs : [null]) {
          if (X === S && xDim) add(M, h, KEY_DIM[hit.extra.stat][k]);
          else for (const x of values) add(M, h, x);
        }
      }
    }
    const targetStates = hit.targetHp ? [...tStates.values()] : [null];
    hit.sStates = sStates.length ? sStates : [null];

    hit.rows = new Map();
    for (const t of targetStates) {
      for (const [si, s] of hit.sStates.entries()) {
        const hpKey = `${t ? t.join(':') : '-'}|${s ? s.join(':') : '-'}`;
        const post = new Map();
        for (const a of hit.aVals) {
          for (const d of dVals) {
            const row = memo(`row|${ord}|${a}|${d}|${hpKey}`, () => {
              const sp = { pokemon: source, stats: {} };
              const tp = { pokemon: target, stats: {} };
              for (const r of hit.readers) {
                const pokemon = r.who === 'source' ? source : target;
                (r.who === 'source' ? sp : tp).stats[r.key] = depOf(byPokemon.get(pokemon), r.key).at(r.by === 'a' ? a : r.by === 'x' ? s[2] : d);
              }
              if (t) { tp.maxhp = maxHp(T, t[0]); tp.hp = t[1]; }
              const patches = [sp, tp];
              if (s && s[0] !== null) patches.push({ pokemon: source, maxhp: s[0], hp: s[1] });
              return dryRow(hit, patches, post);
            });
            hit.rows.set(rowKey(a, d, t && t[0], t && t[1], si), row);
          }
        }
      }
    }
    return hit;
  }

  // ------------------------------------------------------ HP transitions

  /** Group a chain by what a transition depends on: HP stat, one defence, current HP. */
  function groupsOf(rec, dim) {
    const out = new Map();
    for (const [k, hs] of rec.chain) {
      const hp = KEY_HP[k];
      const d = dim ? KEY_DIM[dim][k] : 0;
      for (const h of hs) {
        const g = (hp * SPAN + d) * HP_BITS + h;
        if (!out.has(g)) out.set(g, [hp, d, h]);
      }
    }
    return out;
  }

  /** The simulator's own `Damage` event for one candidate: Focus Sash, Sturdy, Endure. */
  function damageEvent(hit, ctx, T, M, h, x, granted = false) {
    return memo(`dmgev|${hit.ord}|${M}|${h}|${x}|${granted}`, () => guarded(() => {
      const undo = patchAll([{ pokemon: T.pokemon, maxhp: M, hp: h }]);
      const after = snapItems([T.pokemon]);
      try {
        restoreItems(ctx.items);
        return withRoll(0, () => battle.runEvent('Damage', T.pokemon, ctx.source, ctx.effect, x, true), granted ? null : ctx.dice);
      } finally {
        restoreItems(after);
        undo();
      }
    }));
  }

  /**
   * A hit on `T`, as every (attacking stat, attacker HP state) it could have
   * come through. The two are packed into one `via`: `a + SPAN * state`.
   */
  function moveChange(T, hit, dealt, ctx) {
    const clamp = x => (typeof x === 'number' && x !== 0 ? Math.max(1, x) : x);
    const modified = clamp(hit.real) !== clamp(dealt);
    const table = new Map();
    const rolls = new Map();
    // Which pairs a display that says the Pokemon survived a lethal hit allows:
    // lethal before the `Damage` event, and left standing by it with every
    // chance in it granted - each die at the bottom of its range, where
    // `randomChance` succeeds - since the line proves a Focus Band's came up
    // whatever this replay's die did. Such a pair is left on 1 HP.
    const lethal = new Map();
    for (const [g, [hp, d, h]] of groupsOf(T, hit.def)) {
      const M = maxHp(T, hp);
      const pairs = [];
      const rs = [];
      const fatal = [];
      for (const a of hit.aVals) {
        for (let si = 0; si < hit.sStates.length; si++) {
          const row = hit.rows.get(rowKey(a, d, hit.targetHp ? hp : null, hit.targetHp ? h : null, si));
          if (!row) continue;
          const v = (a + SPAN * si) * HP_BITS;
          for (const [r, value] of row.entries()) {
            rs.push(r);
            let x = clamp(value);
            fatal.push(typeof x === 'number' && x >= h && h - Math.trunc(clamp(damageEvent(hit, ctx, T, M, h, x, true))) >= 1 ? 1 : 0);
            if (typeof x !== 'number' || x <= 0) { pairs.push(v + h); continue; }
            if (modified || x >= h) x = clamp(damageEvent(hit, ctx, T, M, h, x));
            if (typeof x !== 'number' || x <= 0) { pairs.push(v + h); continue; }
            pairs.push(v + Math.max(0, h - Math.trunc(x)));
          }
        }
      }
      table.set(g, Int32Array.from(pairs));
      rolls.set(g, Uint8Array.from(rs));
      lethal.set(g, Uint8Array.from(fatal));
    }
    const via = !hit.off || hit.A.kn.known ? null
      : hit.offDim ? { rec: hit.A, dim: hit.off } : { rec: hit.A, stat: hit.off };
    const S = hit.S;
    S.hitsThisMove = S.hitMove === ctx.effect ? S.hitsThisMove + 1 : 1;
    S.hitMove = ctx.effect;
    return {
      dim: hit.def,
      table,
      rolls,
      lethal,
      rollAt: hit.rollAt,
      via,
      dealtBy: S,
      sourceStates: hit.sourceHp || hit.extra ? hit.sStates : null,
      extra: hit.extra || null,
      move: ctx.effect,
      // Recoil and drain read the user's own attacking stat off the same hit;
      // one that belongs to the target or to a key dimension says nothing there.
      off: hit.A === S && !hit.offDim ? hit.off : null,
      hits: S.hitsThisMove,
      what: hit.what || `${label(hit.S)}'s ${hit.clone.name} hit ${label(T)}`,
    };
  }

  /** An HP change whose amount the simulator computed from one number we can scale. */
  /** The HP `run` leaves one candidate on, with the battle handed back untouched. */
  function dryHp(T, M, h, source, run) {
    return guarded(() => {
      const undo = patchAll([{ pokemon: T.pokemon, maxhp: M, hp: h }]);
      const saved = {
        faintQueued: T.pokemon.faintQueued,
        switchFlag: T.pokemon.switchFlag,
        hurtThisTurn: T.pokemon.hurtThisTurn,
        sourceLast: source?.lastDamage,
      };
      const items = snapItems([T.pokemon]);
      // A candidate on `h` HP is standing, whatever the real Pokemon did: one
      // already queued to faint would skip `faint()`, which is what sets HP to 0.
      T.pokemon.faintQueued = false;
      try {
        run();
        return T.pokemon.hp;
      } finally {
        T.pokemon.faintQueued = saved.faintQueued;
        T.pokemon.switchFlag = saved.switchFlag;
        T.pokemon.hurtThisTurn = saved.hurtThisTurn;
        if (source) source.lastDamage = saved.sourceLast;
        restoreItems(items);
        undo();
      }
    });
  }

  function amountChange(T, kind, amounts, ctx, what) {
    const ord = changeOrdinal;
    const table = new Map();
    for (const [g, [hp, , h]] of groupsOf(T, null)) {
      const M = maxHp(T, hp);
      const out = new Set();
      for (const amount of amounts(M)) {
        out.add(memo(`amt|${ord}|${M}|${h}|${amount}`, () => dryHp(T, M, h, ctx.source, () => withRoll(0, () => {
          if (kind === 'heal') battle.heal(amount, T.pokemon, ctx.source, ctx.effect);
          else if (ctx.direct) battle.directDamage(amount, T.pokemon, ctx.source, ctx.effect);
          else battle.spreadDamage([amount], [T.pokemon], ctx.source, ctx.effect);
        }, ctx.dice))));
      }
      table.set(g, Int32Array.from(out));
    }
    return { dim: null, table, via: null, what };
  }

  /** An HP change the simulator computes from the Pokemon's own max HP: `run` once per candidate. */
  function runChange(T, tag, run, what) {
    const ord = changeOrdinal;
    const table = new Map();
    for (const [g, [hp, , h]] of groupsOf(T, null)) {
      const M = maxHp(T, hp);
      table.set(g, Int32Array.of(memo(`${tag}|${ord}|${M}|${h}`, () => dryHp(T, M, h, T.pokemon, run))));
    }
    return { dim: null, table, via: null, what };
  }

  /**
   * An HP change whose amount is another Pokemon's stat: `amounts` maps each
   * surviving value of that stat to the amount the simulator computed from it,
   * and the display keeps only the values that print what the log shows.
   */
  function statAmountChange(T, kind, amounts, via, ctx, what) {
    const ord = changeOrdinal;
    const table = new Map();
    for (const [g, [hp, , h]] of groupsOf(T, null)) {
      const M = maxHp(T, hp);
      const pairs = [];
      for (const [a, amount] of amounts) {
        const h2 = memo(`stat|${ord}|${M}|${h}|${amount}`, () => dryHp(T, M, h, ctx.source, () => {
          if (kind === 'heal') battle.heal(amount, T.pokemon, ctx.source, ctx.effect);
          else battle.spreadDamage([amount], [T.pokemon], ctx.source, ctx.effect);
        }));
        pairs.push(a * HP_BITS + h2);
      }
      table.set(g, Int32Array.from(pairs));
    }
    return { dim: null, table, via, what };
  }

  /**
   * Recoil or drain after a hit on a Pokemon shown only as a percentage. The
   * damage dealt is hidden, but every candidate attacking stat left a set of
   * amounts it could have dealt, and the simulator turns each into the HP the
   * attacker's own line has to show. `run(d)` is that simulator call.
   */
  function dealtChange(S, last, what, tag, run) {
    const ord = changeOrdinal;
    const known = S.kn.known || !last.off;
    const table = new Map();
    const dealtOf = new Map();
    for (const [g, [hp, , h]] of groupsOf(S, null)) {
      const M = maxHp(S, hp);
      const pairs = [];
      const amounts = [];
      for (const [a, dealt] of last.byA) {
        if (!known && !S.flat[last.off][a]) continue;
        for (const d of dealt) {
          const h2 = memo(`${tag}|${ord}|${M}|${h}|${d}`, () => dryHp(S, M, h, S.pokemon, () => run(d)));
          pairs.push(a * HP_BITS + h2);
          amounts.push(d);
        }
      }
      table.set(g, Int32Array.from(pairs));
      dealtOf.set(g, Int32Array.from(amounts));
    }
    return { dim: null, table, dealtOf, victim: last.change, hurt: last.victim, via: known ? null : { rec: S, stat: last.off }, what };
  }

  /** Recoil: `applyRecoilDamage` computes and applies it in one call. */
  const recoilChange = (S, last, what) =>
    dealtChange(S, last, what, 'rcl', d => actions.applyRecoilDamage(d, last.move, S.pokemon));

  /**
   * Drain: the simulator heals the attacker inside `spreadDamage`, from the
   * damage the victim really took. So the victim is handed exactly `d` - HP one
   * above it, max HP above that so no Focus Sash can fire - and the attacker's
   * HP is read afterwards.
   */
  const drainChange = (S, last, what) => dealtChange(S, last, what, 'drn', (d) => {
    const V = last.victim.pokemon;
    const saved = {
      hp: V.hp, maxhp: V.maxhp, baseMaxhp: V.baseMaxhp,
      hurtThisTurn: V.hurtThisTurn, faintQueued: V.faintQueued, switchFlag: V.switchFlag,
    };
    const items = snapItems([V]);
    try {
      V.hp = d + 1;
      V.maxhp = Math.max(V.maxhp, d + 2);
      V.baseMaxhp = V.maxhp;
      battle.spreadDamage([d], [V], S.pokemon, last.move);
    } finally {
      Object.assign(V, saved);
      restoreItems(items);
    }
  });

  const band = (dir, what) => ({ band: dir, what });

  /** The HP amounts an effect's handlers write as plain numbers, read off their source. */
  const fixed = new Map();
  function fixedAmounts(effect) {
    if (!effect) return new Set();
    if (!fixed.has(effect)) {
      const out = new Set();
      for (const value of Object.values(effect)) {
        if (typeof value !== 'function') continue;
        for (const m of String(value).matchAll(/\b(?:heal|damage|directDamage)\((\d+)\)/g)) out.add(Number(m[1]));
      }
      fixed.set(effect, out);
    }
    return fixed.get(effect);
  }

  /**
   * A hit that hands back damage its user took: Counter and Mirror Coat twice
   * the last such hit, Metal Burst and Comeuppance half as much again. When the
   * user's HP is shown exactly, what it took is the replay's own, the same for
   * every spread. When it is shown as a percentage and the Pokemon it hits back
   * is shown exactly, that one's line says what the user took from it: one of
   * the amounts that one's own hit on it could have dealt, each handed to the
   * move as the simulator keeps it (`asDealt`). Anything else is not used.
   */
  function carriedChange(T, hit, ctx) {
    const U = hit.S;
    const what = `${label(U)}'s ${hit.clone.name} hit ${label(T)}`;
    if (U.exact && typeof ctx.raw === 'number') return amountChange(T, 'damage', () => [ctx.raw], ctx, what);
    const last = T.lastDealt;
    if (T.exact && last?.byA.size && last.victim === U && last.hits === 1 && last.turn === battle.turn) {
      return dealtChange(T, last, what, 'ctr', d => asDealt(U.pokemon, d, () => withRoll(0, () => {
        const amount = hit.clone.damageCallback.call(battle, U.pokemon, T.pokemon);
        battle.spreadDamage([amount], [T.pokemon], U.pokemon, ctx.effect);
      }, ctx.dice)));
    }
    note(what, 'its damage was carried over from an earlier hit, so it was not used');
    return band('down', what);
  }

  /**
   * Run `run` as if the last hit `p` took from a foe had dealt `d`: the
   * simulator's record of it (`attackedBy`) is rewritten, and every volatile
   * that keeps its own record is told the hit again through its own
   * `DamagingHit` handler - Counter's and Mirror Coat's. All of it is put back.
   */
  function asDealt(p, d, run) {
    const entry = p.getLastDamagedBy(true);
    if (!entry) return run();
    const was = entry.damage;
    const kept = Object.entries(p.volatiles)
      .map(([id, st]) => [battle.dex.conditions.getByID(id), st])
      .filter(([c]) => c?.onDamagingHit);
    const saved = kept.map(([, st]) => ({ ...st }));
    try {
      entry.damage = d;
      const move = battle.dex.moves.get(entry.move);
      for (const [c, st] of kept) battle.singleEvent('DamagingHit', c, st, p, entry.source, move, d);
      return run();
    } finally {
      entry.damage = was;
      kept.forEach(([, st], i) => {
        for (const k of Object.keys(st)) delete st[k];
        Object.assign(st, saved[i]);
      });
    }
  }

  /**
   * `oozed` is the heal a Liquid Ooze damage replaced: the same amount, read
   * the same way, through the simulator's own Liquid Ooze. `dice` are what the
   * real `Damage` event threw; `wisher` made the Wish a heal came from.
   */
  function effectChange(T, kind, raw, effect, other, direct = false, oozed = null, dice = null, wisher = null) {
    const asEffect = x => (typeof x === 'string' ? battle.dex.conditions.getByID(x) : x);
    const shown = asEffect(effect);
    const e = oozed ? asEffect(oozed) : shown;
    const id = e?.id || '';
    const healed = kind === 'heal' || !!oozed;
    const ctx = { source: other || null, effect: shown, direct, dice };
    const what = `${shown?.name || id || kind} on ${label(T)}`;
    const dir = kind === 'heal' ? 'up' : 'down';
    if (typeof raw !== 'number' || !(raw > 0)) return band(dir, what);

    // A move's cost to its own user, rounded from the user's max HP - Struggle's
    // quarter, Mind Blown's, Chloroblast's and Steel Beam's half - is the
    // simulator's own `applyRecoilDamage`, run for each candidate.
    const active = battle.activeMove;
    if (kind === 'damage' && active && T.pokemon === battle.activePokemon
      && ((active.struggleRecoil && id === 'strugglerecoil') || (active.mindBlownRecoil && id === active.id)
        || (active.chloroblastRecoil && id === 'recoil'))) {
      return runChange(T, 'cost', () => actions.applyRecoilDamage(0, active, T.pokemon), `${active.name}'s cost to ${label(T)}`);
    }
    // Wish heals half its maker's max HP: the Pokemon's own share when it made
    // it, a fixed amount when its maker's HP stat is known, and otherwise one
    // amount per HP Stat Point its maker could have, which the healed
    // Pokemon's display narrows both ways.
    if (id === 'wish' && kind === 'heal' && wisher && wisher !== T.pokemon) {
      const W = byPokemon.get(wisher);
      if (!W) return band(dir, what);
      if (W.kn.known) return amountChange(T, kind, () => [raw], ctx, what);
      const hps = [...new Set([...(W.chain ? W.chain.keys() : W.knKeys)].map(k => KEY_HP[k]))];
      const amounts = new Map(hps.map(v => [v, maxHp(W, v) / 2]));
      if (amounts.get(fullEvs(wisher.set.evs).hp) !== raw) {
        note(what, 'its maker\'s max HP at its own Stat Points did not give the amount healed, so it was not used');
        return band(dir, what);
      }
      return statAmountChange(T, kind, amounts, { rec: W, dim: 'hp' }, ctx, `Wish from ${label(W)} on ${label(T)}`);
    }

    // Drain and recoil are a share of damage dealt. That share is exact when the
    // Pokemon that took the damage is one whose HP the log shows exactly;
    // otherwise it is one of the amounts the hit could have dealt, and the line
    // it prints says which. A recoil summed over several hits says nothing usable.
    if (id === 'drain' || id === 'recoil') {
      const hurt = id === 'drain' ? byPokemon.get(other) : null;
      const exactVictim = hurt ? hurt.exact : T.pokemon.side.foe.active.every(p => !p || byPokemon.get(p)?.exact);
      if (exactVictim) return amountChange(T, kind, () => [raw], ctx, what);
      const last = T.lastDealt;
      if (id === 'recoil' && last?.byA.size && last.move === battle.activeMove && last.hits === 1) return recoilChange(T, last, what);
      if (id === 'drain' && last?.byA.size && last.move === battle.activeMove && last.victim === hurt) return drainChange(T, last, what);
      return band(dir, what);
    }
    // Leech Seed drains an eighth of the seeded Pokemon's HP, which scales like
    // any fraction below. What the seeder gets back is the amount it really
    // took: exact when the seeded Pokemon's HP is, and otherwise one of the
    // amounts its own line allowed - the seeder's line then says which.
    if (id === 'leechseed' && healed) {
      const seeded = byPokemon.get(other);
      if (seeded?.exact) return amountChange(T, kind, () => [raw], ctx, what);
      const last = T.lastDealt;
      if (last?.byA.size && last.victim === seeded && last.move === e && last.turn === battle.turn) {
        return dealtChange(T, last, what, 'lsd', d => battle.heal(d, T.pokemon, other, e));
      }
      return band(dir, what);
    }
    // Shell Bell gives back an eighth of everything the holder's move dealt:
    // exact when every Pokemon it hurt is shown exactly, and otherwise, for a
    // single hit on one Pokemon, one of the amounts that hit could have dealt.
    if (id === 'shellbell' && healed) {
      const hurt = T.victimMove === battle.activeMove ? [...T.victims] : [];
      if (hurt.length && hurt.every(r => r.exact)) return amountChange(T, kind, () => [raw], ctx, what);
      // One of them shown as a percentage: the others' damage is exact, and the
      // amounts its hit could have dealt come on top.
      const hidden = hurt.filter(r => !r.exact);
      const last = hidden.length === 1 ? T.dealtTo?.get(hidden[0]) : null;
      if (last?.byA.size && last.move === battle.activeMove && last.hits === 1) {
        const V = last.victim.pokemon;
        const move = battle.activeMove;
        const rest = hurt.filter(r => r.exact).reduce((sum, r) => sum + (T.dealtEach?.get(r) || 0), 0);
        return dealtChange(T, last, what, 'shb', d => battle.singleEvent('AfterMoveSecondarySelf', e, T.pokemon.itemState, T.pokemon, V, { ...move, totalDamage: rest + d }));
      }
      return band(dir, what);
    }
    // Strength Sap heals by the target's Attack: a known amount when that
    // Attack is known, and otherwise one amount per Attack still possible,
    // taken before the move lowered it (`sapFor`).
    if (id === 'strengthsap' && healed) {
      const sapped = byPokemon.get(other);
      if (sapped?.kn.known) return amountChange(T, kind, () => [raw], ctx, what);
      const sap = sapFor.get(T.pokemon);
      sapFor.delete(T.pokemon);
      if (!sapped || sap?.rec !== sapped) return band(dir, what);
      return statAmountChange(T, kind, sap.amounts, { rec: sapped, stat: 'atk' }, ctx, `Strength Sap on ${label(sapped)}'s Attack`);
    }

    // An amount the effect's own code writes as a number - Oran Berry's 10 HP -
    // is the same whatever the spread.
    if (Number.isInteger(raw) && fixedAmounts(e).has(raw)) return amountChange(T, kind, () => [raw], ctx, what);

    const M0 = T.pokemon.baseMaxhp;
    // Toxic's nth tick is n sixteenths of max HP with the sixteenth rounded
    // down first (`clampIntRange(baseMaxhp / 16, 1) * stage`), and the stage is
    // the same whatever the spread.
    if (id === 'tox' && kind === 'damage' && Number.isInteger(raw)) {
      const stage = raw / Math.max(1, Math.floor(M0 / 16));
      if (Number.isInteger(stage)) return amountChange(T, kind, M => [stage * Math.max(1, Math.floor(M / 16))], ctx, what);
    }

    // Everything else that scales is written as a fraction of max HP. A raw
    // amount that is not a whole number proves the fraction was passed unrounded;
    // a whole one could have been rounded either way, so both are kept.
    const k = FRACTIONS.find(f => Math.abs(raw - M0 * f) < 1e-9);
    if (k === undefined) return band(dir, what);
    const whole = Number.isInteger(raw);
    const change = amountChange(T, kind, M => (whole ? [...new Set([Math.floor(M * k), Math.ceil(M * k)])] : [M * k]), ctx, what);
    // What Leech Seed takes from a Pokemon shown as a percentage is what its
    // seeder gets back, so the amounts that fit this line are handed on.
    const seeder = id === 'leechseed' && kind === 'damage' && !T.exact ? byPokemon.get(other) : null;
    if (seeder) Object.assign(change, { dealtBy: seeder, move: e, off: null, hits: 1 });
    return change;
  }

  function onChange(rec, kind, info) {
    sync();
    if (state.ended) return;
    rec.moved = (rec.moved || 0) + 1;
    if (!rec.chain) initChain(rec);
    for (const change of rec.pending.splice(0)) apply(rec, change, null);
    let change;
    if (kind === 'damage') {
      const ctx = {
        ...(damageContext.get(rec.pokemon) || { effect: info.effect, source: info.source, items: snapItems([rec.pokemon]) }),
        dice: damageDice.get(rec.pokemon) || null,
      };
      damageContext.delete(rec.pokemon);
      damageDice.delete(rec.pokemon);
      const effect = typeof ctx.effect === 'string' ? battle.dex.conditions.getByID(ctx.effect) : ctx.effect;
      const hit = pendingHits.get(rec.pokemon);
      pendingHits.delete(rec.pokemon);
      if (effect?.effectType === 'Move' && !ctx.direct) {
        change = hit?.supported ? moveChange(rec, hit, info.d, { ...ctx, effect })
          : hit?.carried ? carriedChange(rec, hit, { ...ctx, effect })
            : band('down', `${effect.name} hit ${label(rec)}`);
        const src = ctx.source && ctx.source !== rec.pokemon ? byPokemon.get(ctx.source) : null;
        if (src) {
          if (src.victimMove !== effect) { src.victimMove = effect; src.victims = new Set(); src.dealtEach = new Map(); }
          src.victims.add(rec);
          src.dealtEach.set(rec, (src.dealtEach.get(rec) || 0) + info.d);
        }
      } else {
        change = effectChange(rec, 'damage', ctx.raw ?? info.d, effect, ctx.source, ctx.direct, ctx.oozed, ctx.dice);
      }
    } else if (kind === 'heal') {
      const ctx = healContext.get(rec.pokemon);
      healContext.delete(rec.pokemon);
      change = effectChange(rec, 'heal', ctx?.raw ?? info.d, ctx?.effect ?? info.effect, ctx?.source ?? info.source, false, null, null, ctx?.wisher);
    } else if (rec.painSplit) {
      change = rec.painSplit;
      rec.painSplit = null;
    } else {
      change = band('any', `HP set on ${label(rec)}`);
    }
    change.turn = battle.turn;
    changeOrdinal++;
    rec.pending.push(change);
  }

  /**
   * The HP values a display allows. One that follows a survived lethal hit - a
   * Focus Sash, Sturdy, Endure - allows exactly 1.
   */
  function allowed(rec, M, token, survived) {
    const band = interval(rec, M, token);
    if (!band || !survived) return band;
    return band[0] <= 1 && band[1] >= 1 ? [1, 1] : null;
  }

  /**
   * Move every candidate of `rec` through one change. With a printed display,
   * only the HP values it could print survive, and an attacking stat survives
   * only if some candidate reached the display through it.
   */
  /** Whether a key survives a change that allows only some values of one key dimension. */
  const dimAllowed = (change, k) => !change.allowDims || change.allowDims.values.has(KEY_DIM[change.allowDims.dim][k]);

  /**
   * The flat stat a change reads of the very Pokemon it moves - its own Attack
   * in its recoil, its drain, a Foul Play on it or its confusion self-hit - or
   * null. Such a change says which values of that stat go with which key.
   */
  const tiedStat = (rec, change) => (change.table && change.via && change.via.rec === rec && !change.via.dim ? change.via.stat : null);

  /** Keep, for each key in `byKey`, only the values of `stat` it lists. */
  function tie(rec, stat, byKey) {
    let t = rec.ties[stat];
    if (!t) {
      t = newTie();
      rec.ties[stat] = t;
      for (const [k, vs] of byKey) [t[2 * k], t[2 * k + 1]] = tieWords(vs);
      return;
    }
    for (const [k, vs] of byKey) {
      const [lo, hi] = tieWords(vs);
      t[2 * k] &= lo;
      t[2 * k + 1] &= hi;
    }
  }

  function apply(rec, change, token, survived = false) {
    const noted = record && (token !== null || change.gate);
    // Each Pokemon this event can move, measured before it moves it.
    const befores = new Map();
    const touch = (r) => { if (noted && !befores.has(r)) befores.set(r, measure(r)); };
    touch(rec);
    if (token !== null && change.via) touch(change.via.rec);
    const next = new Map();
    const supported = change.via ? new Uint8Array(SPAN) : null;
    const dealt = change.dealtBy && token !== null && !change.noDealt ? new Map() : null;
    const dealtOk = change.dealtOf && token !== null ? new Set() : null;
    const sourceOk = change.sourceStates && token !== null ? new Set() : null;
    // A hit that reads its attacker's own HP - Water Spout, a pinch ability -
    // beside the attacker's own flat stat says which values of that stat go
    // with which of the attacker's keys.
    const sourceTied = sourceOk && change.via && change.via.rec === change.dealtBy && change.via.rec !== rec && !change.via.dim
      ? new Set() : null;
    const done = new Map();
    const allowAt = new Map();
    const tied = tiedStat(rec, change);
    const held = tied ? rec.ties[tied] : null;
    const byKey = tied && token !== null ? new Map() : null;
    for (const [k, hs] of rec.chain) {
      const hp = KEY_HP[k];
      const M = maxHp(rec, hp);
      let allow = null;
      if (token !== null) {
        if (!allowAt.has(M)) allowAt.set(M, allowed(rec, M, token, survived));
        allow = allowAt.get(M);
        if (!allow) continue;
      }
      if (!dimAllowed(change, k)) continue;
      const d = change.dim ? KEY_DIM[change.dim][k] : 0;
      const out = new Set();
      const vs = byKey ? new Set() : null;
      for (const h of hs) {
        const g = (hp * SPAN + d) * HP_BITS + h;
        let res = done.get(g);
        if (!res) {
          res = { hs: [], via: [] };
          if (change.same) {
            const fits = (!change.allowSet || change.allowSet.has(M * HP_BITS + h)) && (!change.allow || change.allow(M, h));
            if (fits && (!allow || (h >= allow[0] && h <= allow[1]))) res.hs.push(h);
          } else if (change.band) {
            let lo = change.band === 'up' ? h : 0;
            let hi = change.band === 'down' ? h : M;
            if (allow) { lo = Math.max(lo, allow[0]); hi = Math.min(hi, allow[1]); }
            for (let x = lo; x <= hi; x++) res.hs.push(x);
          } else {
            const pairs = change.table.get(g) || [];
            const amounts = dealtOk ? change.dealtOf.get(g) : null;
            const fatal = survived ? change.lethal?.get(g) : null;
            const hsSeen = new Set();
            const viaSeen = new Set();
            const pv = [];
            for (let j = 0; j < pairs.length; j++) {
              if (fatal && !fatal[j]) continue;
              const packed = pairs[j];
              const h2 = fatal ? 1 : packed % HP_BITS;
              if (allow && (h2 < allow[0] || h2 > allow[1])) continue;
              const tag = Math.floor(packed / HP_BITS);
              const v = tag % SPAN;
              if (amounts) dealtOk.add(v * HP_BITS + amounts[j]);
              if (sourceOk) sourceOk.add(Math.floor(tag / SPAN));
              if (sourceTied) sourceTied.add(tag);
              hsSeen.add(h2);
              viaSeen.add(v);
              if (tied) pv.push(h2, v);
              if (dealt) {
                if (!dealt.has(v)) dealt.set(v, new Set());
                dealt.get(v).add(h - h2);
              }
            }
            res.hs = [...hsSeen];
            res.via = [...viaSeen];
            res.pv = pv;
          }
          done.set(g, res);
        }
        if (tied && res.pv) {
          for (let j = 0; j < res.pv.length; j += 2) {
            const v = res.pv[j + 1];
            if (held && !tieHas(held, k, v)) continue;
            out.add(res.pv[j]);
            if (vs) vs.add(v);
            if (supported) supported[v] = 1;
          }
          continue;
        }
        for (const h2 of res.hs) out.add(h2);
        if (supported) for (const v of res.via) supported[v] = 1;
      }
      if (out.size) {
        next.set(k, [...out]);
        if (byKey) byKey.set(k, vs);
      }
    }
    if (byKey) tie(rec, tied, byKey);
    if (dealtOk) {
      change.victim.dealtOk = dealtOk;
      narrowDealt(change.hurt, change.victim, dealtOk, change);
    }
    rec.history.push({ change, token, survived, pre: rec.chain, seq: seq++ });
    rec.chain = next;
    if (dealt) {
      change.dealtBy.lastDealt = { move: change.move, off: change.off, hits: change.hits, byA: dealt, change, victim: rec, turn: change.turn };
      (change.dealtBy.dealtTo ||= new Map()).set(rec, change.dealtBy.lastDealt);
    }
    if (supported && token !== null) narrowVia(change.via, supported);
    // The victim's display also says which HP the attacker could have been on,
    // and which value the one more candidate could have, when the hit depended
    // on them.
    if (sourceOk) {
      const S = change.dealtBy;
      const states = [...sourceOk].map(si => change.sourceStates[si]);
      const X = change.extra ? byId.get(change.extra.owner) : null;
      const xDim = !!X && !FLAT.includes(change.extra.stat);
      const allowSet = change.sourceStates[0][0] === null ? null : new Set(states.map(([M, h]) => M * HP_BITS + h));
      const allowDims = xDim ? { dim: change.extra.stat, values: new Set(states.map(s => s[2])) } : null;
      const narrow = (R, c) => {
        for (const p of R.pending.splice(0)) apply(R, p, null);
        if (!R.chain) initChain(R);
        touch(R);
        apply(R, { same: true, ...c, what: change.what, turn: change.turn }, null);
      };
      if (allowSet || X === S) narrow(S, { allowSet, allowDims: X === S ? allowDims : null });
      if (sourceTied && S.chain && (allowSet || X === S)) {
        const byState = new Map();
        for (const tag of sourceTied) {
          const si = Math.floor(tag / SPAN);
          if (!byState.has(si)) byState.set(si, new Set());
          byState.get(si).add(tag % SPAN);
        }
        // The attacker's own second flat stat - a Gyro Ball user's Speed beside
        // its Attack - goes with the values of the first it came with.
        if (X === S && !xDim) {
          const name = pairName(change.via.stat, change.extra.stat);
          const first = name.startsWith(`${change.via.stat}|`);
          const m = new Uint8Array(SPAN * SPAN);
          for (const [si, values] of byState) {
            const x = change.sourceStates[si][2];
            for (const v of values) m[first ? v * SPAN + x : x * SPAN + v] = 1;
          }
          const had = S.ties[name];
          if (had) for (let i = 0; i < had.length; i++) had[i] &= m[i];
          else S.ties[name] = m;
        }
        if (allowSet || xDim) {
          const byKey = new Map();
          for (const [k, hs] of S.chain) {
            const M = maxHp(S, KEY_HP[k]);
            const vs = new Set();
            for (const [si, values] of byState) {
              const [sM, sH, sX] = change.sourceStates[si];
              if (sM !== null && (sM !== M || !hs.includes(sH))) continue;
              if (xDim && X === S && sX !== KEY_DIM[change.extra.stat][k]) continue;
              for (const v of values) vs.add(v);
            }
            byKey.set(k, vs);
          }
          tie(S, change.via.stat, byKey);
        }
      }
      if (X && X !== S && xDim) narrow(X, { allowDims });
      if (X && !xDim) {
        touch(X);
        const ok = new Uint8Array(SPAN);
        for (const s of states) ok[s[2]] = 1;
        narrowVia({ rec: X, stat: change.extra.stat }, ok);
      }
    }
    if (noted) {
      const cuts = [...befores].map(([r, before]) => cutOf(r, before)).filter(Boolean);
      if (cuts.length) events.push({ turn: change.turn ?? battle.turn, what: change.what, ...(token !== null ? { shown: token } : {}), cuts });
    }
  }

  /**
   * What a share of the damage dealt showed, put back on the Pokemon that took
   * it while that hit is still the last thing that moved its HP: of the HP it
   * was left on, only what some amount the share allows could leave survives.
   * The backward walk checks the same thing over every turn at the end.
   */
  function narrowDealt(V, vChange, ok, by) {
    const entry = V?.history.at(-1);
    if (!entry || entry.change !== vChange || V.pending.length || !vChange.table) return;
    const before = record ? measure(V) : null;
    const next = new Map();
    for (const [k, hs] of entry.pre) {
      const now = V.chain.get(k);
      if (!now) continue;
      const left = new Set(now);
      const hp = KEY_HP[k];
      const d = vChange.dim ? KEY_DIM[vChange.dim][k] : 0;
      const out = new Set();
      for (const h of hs) {
        const g = (hp * SPAN + d) * HP_BITS + h;
        const fatal = entry.survived ? vChange.lethal?.get(g) : null;
        const pairs = vChange.table.get(g) || [];
        for (let j = 0; j < pairs.length; j++) {
          if (fatal && !fatal[j]) continue;
          const h2 = fatal ? 1 : pairs[j] % HP_BITS;
          const v = Math.floor(pairs[j] / HP_BITS) % SPAN;
          if (left.has(h2) && ok.has(v * HP_BITS + h - h2)) out.add(h2);
        }
      }
      if (out.size) next.set(k, [...out]);
    }
    V.chain = next;
    if (!record) return;
    const cut = cutOf(V, before);
    if (cut) events.push({ turn: by.turn ?? battle.turn, what: by.what, cuts: [cut] });
  }

  /** Keep only the attacking-stat values a hit's display left reachable. */
  function narrowVia(via, ok) {
    if (via.dim) {
      const A = via.rec;
      const dim = via.dim === 'hp' ? KEY_HP : KEY_DIM[via.dim];
      if (!A.chain) initChain(A);
      for (const k of [...A.chain.keys()]) if (!ok[dim[k]]) A.chain.delete(k);
      return;
    }
    const dom = via.rec.flat[via.stat];
    for (let v = 0; v < SPAN; v++) if (dom[v] && !ok[v]) dom[v] = 0;
  }

  /**
   * Whose HP a printed line shows: the Pokemon in that slot, which is the one
   * the line names or, under Illusion, the one disguised as it.
   */
  function recOf(line, at) {
    const p = battle.sides.find(s => s.id === line.side)?.active[line.slot];
    if (p && (p.name === line.name || p.illusion?.name === line.name || unmaskedAfter(p, line, at))) return byPokemon.get(p);
    return byIdent.get(`${line.side}:${line.name}`);
  }

  /**
   * Whether the line at `at` named `p` by its disguise: Illusion had broken by
   * the time the line is read, and a `|replace|` naming `p` in that slot comes
   * after it, before anything switches in there.
   */
  function unmaskedAfter(p, line, at) {
    const ident = `${line.side}${'abcd'[line.slot]}: `;
    for (const entry of view) {
      if (entry.at <= at) continue;
      const [, kind, who] = entry.line.split('|');
      if (!String(who || '').startsWith(ident)) continue;
      if (kind === 'replace') return identName(who) === p.name;
      if (kind === 'switch' || kind === 'drag') return false;
    }
    return false;
  }

  /**
   * A printed HP line: settle what is pending for that Pokemon against it. One
   * read `ahead` of the cutoff is evidence but not a line of the scaffold's, so
   * it is never handed on as proved.
   */
  function observe(line, token, at, ahead = false, survived = false) {
    const rec = recOf(line, at);
    if (!rec) return;
    const first = !rec.chain;
    if (first) initChain(rec);
    const due = rec.pending.splice(0);
    if (line.changes) {
      if (!due.length) due.push(band(line.kind === '-heal' ? 'up' : line.kind === '-damage' ? 'down' : 'any', `${line.kind} on ${label(rec)}`));
      for (const change of due.slice(0, -1)) apply(rec, change, null);
      apply(rec, due[due.length - 1], token, survived);
    } else {
      for (const change of due) apply(rec, change, null);
      apply(rec, { same: true, what: first ? `${label(rec)} came in` : `${label(rec)} shown`, turn: battle.turn }, token);
    }
    rec.shown.push({ at, hist: rec.history.length - 1, ahead });
    rec.lastToken = token;
  }

  /**
   * Whether a hit broke a Substitute, for every candidate. A fresh Substitute
   * holds a quarter of its owner's max HP, rounded down (Substitute's
   * `onStart`), and breaks when the hit deals at least that: so the line that
   * says whether it broke narrows the owner's HP and the hit's two stats, with
   * the owner's HP left where it was.
   */
  function subChange(T, hit, broke) {
    const table = new Map();
    const rolls = new Map();
    for (const [g, [hp, d, h]] of groupsOf(T, hit.def)) {
      const holds = Math.floor(maxHp(T, hp) / 4);
      const pairs = [];
      const rs = [];
      for (const a of hit.aVals) {
        for (let si = 0; si < hit.sStates.length; si++) {
          const row = hit.rows.get(rowKey(a, d, hit.targetHp ? hp : null, hit.targetHp ? h : null, si));
          if (!row) continue;
          for (const [r, value] of row.entries()) {
            if ((typeof value === 'number' && Math.max(1, value) >= holds) !== broke) continue;
            pairs.push((a + SPAN * si) * HP_BITS + h);
            rs.push(r);
          }
        }
      }
      table.set(g, Int32Array.from(pairs));
      rolls.set(g, Uint8Array.from(rs));
    }
    const via = !hit.off || hit.A.kn.known ? null
      : hit.offDim ? { rec: hit.A, dim: hit.off } : { rec: hit.A, stat: hit.off };
    return {
      dim: hit.def, table, rolls, rollAt: hit.rollAt, via, noDealt: true,
      dealtBy: hit.S, sourceStates: hit.sourceHp || hit.extra ? hit.sStates : null, extra: hit.extra || null,
      turn: battle.turn, what: `${label(hit.S)}'s ${hit.clone.name} ${broke ? 'broke' : 'did not break'} ${label(T)}'s Substitute`,
    };
  }

  /** The line saying whether a hit broke a Substitute: `[ident, broke]`, or null. */
  const subOutcome = (line) => {
    const m = /^\|(-end|-activate)\|(p[1-4][a-d]: [^|]+)\|(?:move: )?Substitute(\||$)/.exec(String(line || ''));
    return m ? [m[2], m[1] === '-end'] : null;
  };

  /**
   * The Pokemon a line announces survived a lethal hit - a Focus Sash, Focus
   * Band, Sturdy, Endure - as `side:name`, or null. Its next HP line is that hit's, and the
   * simulator's own `Damage` event decides per candidate whether it survives.
   */
  // Only the announcement itself, which ends the line: a Traced Sturdy names
  // Sturdy too, and says nothing about a hit.
  const SURVIVAL = /^\|(-enditem|-ability|-activate)\|(p[1-4])[a-d]: ([^|]+)\|(Focus Sash|item: Focus Band|Sturdy|ability: Sturdy|move: Endure)$/;
  const survivor = (line) => {
    const m = SURVIVAL.exec(String(line || ''));
    return m ? `${m[2]}:${m[3]}` : null;
  };

  /**
   * The replay's HP line for the Pokemon the rebuild's cutoff line is about,
   * when the replay first announces that it survived a lethal hit and the
   * rebuild's hit left it standing without one. Nothing else may stand between.
   */
  function survivedLine(mine) {
    for (const line of [prefix.observedLine, ...prefix.observedAfter]) {
      const hp = hpLine(line);
      if (hp) return hp.side === mine.side && hp.name === mine.name && hp.kind === mine.kind ? hp : null;
      if (survivor(line) !== `${mine.side}:${mine.name}`) return null;
    }
    return null;
  }

  let survived = null;
  function sync() {
    if (state.dry || state.hold) return;
    while (!state.ended && viewPos < view.length && view[viewPos].at < battle.log.length) {
      const entry = view[viewPos++];
      if (entry.at > prefix.cutoffAt) { state.ended = true; break; }
      const atCut = entry.at === prefix.cutoffAt;
      const mine = hpLine(entry.line);
      const direct = atCut ? hpLine(prefix.observedLine) : mine;
      const shown = direct || (atCut && mine ? survivedLine(mine) : null);
      if (mine && shown && shown.side === mine.side && shown.name === mine.name && shown.kind === mine.kind) {
        const lethal = !direct || survived === `${mine.side}:${mine.name}`;
        observe(mine, shown.token, entry.at, !direct, lethal);
      }
      survived = mine ? null : survivor(entry.line) || survived;
      const outcome = subOutcome(atCut ? prefix.observedLine : entry.line);
      if (outcome && subOutcome(entry.line)?.[0] === outcome[0]) {
        const [ident, broke] = outcome;
        const rec = recOf({ side: identSide(ident), slot: 'abcd'.indexOf(ident[2]), name: identName(ident) }, entry.at);
        const hit = rec && subGates.get(rec.pokemon);
        if (hit) {
          subGates.delete(rec.pokemon);
          for (const change of rec.pending.splice(0)) apply(rec, change, null);
          apply(rec, subChange(rec, hit, broke), rec.lastToken ?? null);
        }
      }
      if (atCut) { state.ended = true; break; }
    }
  }

  // ------------------------------------------------------------ the hooks

  // The ordinal of the draw a real hit's damage roll took, so the roll an
  // evidence path chose for it can be written back as a pin.
  let rollDraws = null;
  const origRandomizer = battle.randomizer;
  battle.randomizer = function (base) {
    if (rollDraws && !st.dry) rollDraws.push(st.draws);
    return origRandomizer.call(this, base);
  };

  const origGetDamage = actions.getDamage;
  actions.getDamage = function (source, target, move, suppress) {
    if (state.dry || state.ended || typeof move !== 'object' || !move || move.category === 'Status'
      || !byPokemon.has(source) || !byPokemon.has(target)) {
      return origGetDamage.call(this, source, target, move, suppress);
    }
    sync();
    const clone = cloneMove(move);
    const pre = snapItems([source, target]);
    const hpBefore = new Map([[source, source.hp], [target, target.hp]]);
    const draws = [];
    rollDraws = draws;
    // Every die the real calculation throws, for the dry ones to throw alike.
    let real;
    let thrown;
    try {
      ({ value: real, thrown } = withDice(st, () => origGetDamage.call(this, source, target, move, suppress)));
    } finally {
      rollDraws = null;
    }
    if (typeof real !== 'number' || state.ended) return real;
    const crit = !!target.getMoveHitData(move).crit;
    const post = snapItems([source, target]);
    try {
      const hit = analyseHit(source, target, move, clone, crit, real, pre, origGetDamage, thrown, hpBefore);
      hit.rollAt = draws.length === 1 ? draws[0] : null;
      // A hit a Substitute takes moves no HP; the line after it says whether it
      // broke. Only the first hit on a Substitute is read: after it, what the
      // Substitute holds depends on the damage it already took.
      const sub = target.volatiles.substitute;
      if (sub && source !== target && !move.flags?.bypasssub && !move.infiltrates) {
        const T = byPokemon.get(target);
        const fresh = T.sub !== sub && sub.hp === Math.floor(target.maxhp / 4);
        T.sub = sub;
        if (fresh && hit.supported) subGates.set(target, hit);
        else subGates.delete(target);
      } else {
        pendingHits.set(target, hit);
      }
    } finally {
      restoreItems(post);
    }
    return real;
  };

  // A confusion self-hit rolls its damage outside `getDamage`.
  const origConfusion = actions.getConfusionDamage;
  actions.getConfusionDamage = function (pokemon, basePower) {
    const rec = byPokemon.get(pokemon);
    if (state.dry || state.ended || !rec || rec.kn.known) return origConfusion.call(this, pokemon, basePower);
    sync();
    const pre = snapItems([pokemon]);
    const draws = [];
    rollDraws = draws;
    let real;
    try {
      real = origConfusion.call(this, pokemon, basePower);
    } finally {
      rollDraws = null;
    }
    if (typeof real !== 'number' || state.ended) return real;
    const hit = selfHit(pokemon, basePower, real, pre, origConfusion);
    hit.rollAt = draws.length === 1 ? draws[0] : null;
    pendingHits.set(pokemon, hit);
    return real;
  };

  const origSpread = battle.spreadDamage;
  battle.spreadDamage = function (damage, targetArray, source, effect, instafaint) {
    if (!state.dry && !state.ended && targetArray) {
      for (const [i, t] of targetArray.entries()) {
        if (!t || !byPokemon.has(t)) continue;
        // Liquid Ooze deals what the heal it replaced would have given.
        const oozed = effect?.id === 'liquidooze' ? healContext.get(t)?.effect : null;
        damageContext.set(t, { effect, source, raw: damage[i], oozed, items: snapItems([t]) });
      }
    }
    return origSpread.call(this, damage, targetArray, source, effect, instafaint);
  };

  // A move's HP cost - Substitute's quarter, Belly Drum's half - goes through
  // `directDamage`, which floors what it is handed and runs no `Damage` event.
  const origDirect = battle.directDamage;
  battle.directDamage = function (damage, target, source, effect) {
    if (!state.dry && !state.ended) {
      let t = target;
      let s = source;
      let e = effect;
      if (this.event) { t ||= this.event.target; s ||= this.event.source; e ||= this.effect; }
      if (t && byPokemon.has(t)) damageContext.set(t, { effect: e, source: s, raw: damage, direct: true, items: snapItems([t]) });
    }
    return origDirect.call(this, damage, target, source, effect);
  };

  const origHeal = battle.heal;
  battle.heal = function (damage, target, source, effect) {
    if (!state.dry && !state.ended) {
      let t = target;
      let s = source;
      let e = effect;
      if (this.event) { t ||= this.event.target; s ||= this.event.source; e ||= this.effect; }
      if (t && byPokemon.has(t)) {
        const ctx = { raw: damage, source: s, effect: e, wisher: this.effectState?.source ?? null };
        healContext.set(t, ctx);
        const healed = origHeal.call(this, damage, target, source, effect);
        if (!healed && healContext.get(t) === ctx) healContext.delete(t);
        return healed;
      }
    }
    return origHeal.call(this, damage, target, source, effect);
  };

  for (const rec of recs) {
    const p = rec.pokemon;
    const damage = p.damage;
    const heal = p.heal;
    const sethp = p.sethp;
    override(p, 'damage', function (d, source, effect) {
      const out = damage.call(this, d, source, effect);
      if (!state.dry && !state.ended) onChange(rec, 'damage', { d, source, effect });
      return out;
    });
    override(p, 'heal', function (d, source, effect) {
      const before = this.hp;
      const out = heal.call(this, d, source, effect);
      if (!state.dry && !state.ended && this.hp !== before) onChange(rec, 'heal', { d, source, effect });
      return out;
    });
    override(p, 'sethp', function (d) {
      const before = this.hp;
      const out = sethp.call(this, d);
      if (!state.dry && !state.ended && this.hp !== before) onChange(rec, 'sethp', { d });
      return out;
    });
  }

  // A held item that acts on `Update` - a Sitrus or pinch Berry - fires or not
  // on the HP the Pokemon is on right then. The simulator is asked, for each
  // max HP the Pokemon could have, up to which HP its item would fire: the
  // item's own `onUpdate`, dry. The condition only grows truer as HP falls, so
  // a bisection finds the edge. Whether the item really fired then keeps only
  // the HP that agrees - checked where the HP last moved, before the berry's
  // own heal is applied.
  const itemFires = (rec, M, h) => guarded(() => {
    const p = rec.pokemon;
    const undo = patchAll([{ pokemon: p, maxhp: M, hp: h }]);
    const items = snapItems([p]);
    const boosts = { ...p.boosts };
    const held = p.item;
    try {
      battle.singleEvent('Update', p.getItem(), p.itemState, p);
      return p.item !== held;
    } finally {
      restoreItems(items);
      Object.assign(p.boosts, boosts);
      undo();
    }
  });
  const fireEdge = (rec, M) => {
    if (!itemFires(rec, M, 1)) return 0;
    if (itemFires(rec, M, M)) return M;
    let lo = 1;
    let hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (itemFires(rec, M, mid)) lo = mid; else hi = mid; }
    return lo;
  };
  // The dice a real `Damage` event throws - Focus Band's - per Pokemon, for
  // every dry re-run of it to throw alike.
  const damageDice = new Map();
  let itemChecks = 0;
  const origUpdate = battle.runEvent;
  battle.runEvent = function (eventid, target, ...rest) {
    const rec = eventid === 'Update' && !state.dry && !state.ended ? byPokemon.get(target) : null;
    if (!rec || rec.exact || !rec.moved || rec.checked === rec.moved || !target.item || !target.getItem().onUpdate) {
      return origUpdate.call(this, eventid, target, ...rest);
    }
    rec.checked = rec.moved;
    sync();
    if (state.ended) return origUpdate.call(this, eventid, target, ...rest);
    const ord = itemChecks++;
    const edge = new Map();
    for (const k of rec.chain ? rec.chain.keys() : rec.knKeys) {
      const M = maxHp(rec, KEY_HP[k]);
      if (!edge.has(M)) edge.set(M, memo(`edge|${ord}|${rec.id}|${M}`, () => fireEdge(rec, M)));
    }
    // An edge of 0 or of the whole bar says nothing about HP.
    if ([...edge].every(([M, t]) => t === 0 || t === M)) return origUpdate.call(this, eventid, target, ...rest);
    const name = target.getItem().name;
    const gate = { same: true, gate: true, turn: battle.turn, what: `${name} on ${label(rec)}`, fired: null };
    gate.allow = (M, h) => gate.fired === null || !edge.has(M) || (h <= edge.get(M)) === gate.fired;
    rec.pending.push(gate);
    const held = target.item;
    try {
      return origUpdate.call(this, eventid, target, ...rest);
    } finally {
      gate.fired = target.item !== held;
      gate.what = `${name} ${gate.fired ? 'fired' : 'did not fire'} on ${label(rec)}`;
    }
  };
  const runEventBefore = battle.runEvent;
  battle.runEvent = function (eventid, target, ...rest) {
    if (eventid !== 'Damage' || state.dry || state.ended || !byPokemon.has(target)) return runEventBefore.call(this, eventid, target, ...rest);
    const { value, thrown } = withDice(st, () => runEventBefore.call(this, eventid, target, ...rest));
    damageDice.set(target, thrown);
    return value;
  };

  // Two moves whose effect reads a Pokemon's hidden side, asked as they hit.
  //
  // Strength Sap heals its user by the target's Attack as it stood before the
  // move lowered it, so that Attack is taken per surviving value here and the
  // heal is scaled from it (`effectChange`).
  //
  // Pain Split sets both Pokemon to the average of their HP. With one shown
  // exactly and the other as a percentage, the simulator's own `onHit` is run
  // again for every HP the hidden one could be on: each leaves it on some HP,
  // and leaves the exact one on some HP too, which has to be the one the log
  // shows - the scaffold's own where it reproduces the log, and the replay's
  // where the scaffold first goes wrong on exactly that line. Its displays wait
  // until the move is done (`state.hold`), because that is when the exact one's
  // HP is known; and the link holds even when the hidden one's own display lies
  // past the cutoff (`final`). With both shown as percentages, `onHit` is run
  // for every pair of HPs the two could be on, and each keeps the HPs some
  // pair leaves it on that both displays allow (`jointPainSplit`).
  const sapFor = new Map();
  let painOrdinal = 0;

  /** Pain Split between two Pokemon both shown as percentages: `real` runs it, `dry` again per pair. */
  function jointPainSplit(A, B, real, dry) {
    sync();
    if (state.ended) return real();
    for (const R of [A, B]) {
      if (!R.chain) initChain(R);
      for (const c of R.pending.splice(0)) apply(R, c, null);
    }
    const ord = painOrdinal++;
    const ga = [...groupsOf(A, null)];
    const gb = [...groupsOf(B, null)];
    const what = `Pain Split between ${label(A)} and ${label(B)}`;
    const changes = new Map([[A, { dim: null, table: new Map(), via: null, final: true, what }], [B, { dim: null, table: new Map(), via: null, final: true, what }]]);
    if (ga.length * gb.length > 60000) {
      note(what, 'the two could be on too many HPs together, so it was not used');
      return real();
    }
    for (const [R, change] of changes) R.painSplit = change;
    const start = battle.log.length;
    state.hold++;
    try {
      return real();
    } finally {
      state.hold--;
      // What each display says, where the replay shows it.
      const tokenOf = (R) => {
        const mine = line => line?.kind === '-sethp' && line.side === R.side && line.name === R.name;
        const at = view.find(v => v.at >= start && v.at < battle.log.length && mine(hpLine(v.line)))?.at;
        if (at === undefined) return null;
        if (at < prefix.cutoffAt) return hpLine(view.find(v => v.at === at).line).token;
        if (at === prefix.cutoffAt && mine(hpLine(prefix.observedLine))) return hpLine(prefix.observedLine).token;
        return null;
      };
      const tokens = new Map([[A, tokenOf(A)], [B, tokenOf(B)]]);
      const fits = (R, M, h) => {
        const token = tokens.get(R);
        if (token === null) return true;
        const band = allowed(R, M, token, false);
        return !!band && h >= band[0] && h <= band[1];
      };
      const sets = new Map([[A, new Map()], [B, new Map()]]);
      for (const [g1, [hp1, , h1]] of ga) {
        const M1 = maxHp(A, hp1);
        for (const [g2, [hp2, , h2]] of gb) {
          const M2 = maxHp(B, hp2);
          const [x, y] = memo(`pain2|${ord}|${M1}|${h1}|${M2}|${h2}`, () => guarded(() => {
            const undo = patchAll([{ pokemon: A.pokemon, maxhp: M1, hp: h1 }, { pokemon: B.pokemon, maxhp: M2, hp: h2 }]);
            try {
              dry();
              return [A.pokemon.hp, B.pokemon.hp];
            } finally {
              undo();
            }
          }));
          if (!fits(A, M1, x) || !fits(B, M2, y)) continue;
          if (!sets.get(A).has(g1)) sets.get(A).set(g1, new Set());
          if (!sets.get(B).has(g2)) sets.get(B).set(g2, new Set());
          sets.get(A).get(g1).add(x);
          sets.get(B).get(g2).add(y);
        }
      }
      for (const [R, change] of changes) {
        for (const [g] of (R === A ? ga : gb)) change.table.set(g, Int32Array.from(sets.get(R).get(g) || []));
        if (R.painSplit) {
          R.painSplit = null;
          change.turn = battle.turn;
          R.pending.push(change);
        }
      }
    }
  }
  const origSingle = battle.singleEvent;
  battle.singleEvent = function (eventid, effect, effectState, target, source, ...rest) {
    if (eventid !== 'Hit' || state.dry || state.ended || !effect || typeof target !== 'object' || typeof source !== 'object') {
      return origSingle.call(this, eventid, effect, effectState, target, source, ...rest);
    }
    const T = byPokemon.get(target);
    const S = byPokemon.get(source);
    if (effect.id === 'strengthsap' && T && S && !T.kn.known) {
      const sapAt = a => guarded(() => {
        const undo = patchAll([{ pokemon: target, stats: { atk: T.stat('atk', a) } }]);
        try { return target.getStat('atk', false, true); } finally { undo(); }
      });
      const real = guarded(() => target.getStat('atk', false, true));
      if (plain(T, 'atk') && sapAt(fullEvs(target.set.evs).atk) === real) {
        const amounts = new Map();
        for (const a of aliveOf(T.flat.atk)) amounts.set(a, sapAt(a));
        sapFor.set(source, { rec: T, amounts });
      } else {
        note(`Strength Sap on ${label(T)}`, 'its Attack is not the one its Stat Points give, so the heal was not used');
      }
    }
    if (effect.id === 'painsplit' && T && S && T !== S && !T.exact && !S.exact) {
      return jointPainSplit(T, S, () => origSingle.call(this, eventid, effect, effectState, target, source, ...rest),
        () => origSingle.call(battle, eventid, effect, effectState, target, source, ...rest));
    }
    if (effect.id !== 'painsplit' || !T || !S || T === S || T.exact === S.exact) {
      return origSingle.call(this, eventid, effect, effectState, target, source, ...rest);
    }
    sync();
    if (state.ended) return origSingle.call(this, eventid, effect, effectState, target, source, ...rest);
    const X = T.exact ? S : T;
    const Y = T.exact ? T : S;
    if (!X.chain) initChain(X);
    for (const c of X.pending.splice(0)) apply(X, c, null);
    const ord = painOrdinal++;
    const outcome = new Map();
    for (const [g, [hp, , h]] of groupsOf(X, null)) {
      const M = maxHp(X, hp);
      outcome.set(g, memo(`pain|${ord}|${M}|${h}`, () => guarded(() => {
        const undo = patchAll([{ pokemon: X.pokemon, maxhp: M, hp: h }, { pokemon: Y.pokemon }]);
        try {
          origSingle.call(battle, eventid, effect, effectState, target, source, ...rest);
          return [X.pokemon.hp, Y.pokemon.hp];
        } finally {
          undo();
        }
      })));
    }
    const change = { dim: null, table: new Map(), via: null, final: true, what: `Pain Split between ${label(X)} and ${label(Y)}` };
    X.painSplit = change;
    const start = battle.log.length;
    state.hold++;
    try {
      return origSingle.call(this, eventid, effect, effectState, target, source, ...rest);
    } finally {
      state.hold--;
      if (X.painSplit) {
        X.painSplit = null;
        change.turn = battle.turn;
        X.pending.push(change);
      }
      const isY = line => line?.kind === '-sethp' && line.side === Y.side && line.name === Y.name;
      const yAt = view.find(v => v.at >= start && v.at < battle.log.length && isY(hpLine(v.line)))?.at;
      let yHp = null;
      if (yAt !== undefined && yAt < prefix.cutoffAt) yHp = Y.pokemon.hp;
      else if (yAt !== undefined && yAt === prefix.cutoffAt && isY(hpLine(prefix.observedLine))) {
        const m = /^(\d+)\//.exec(hpLine(prefix.observedLine).token);
        if (m) yHp = Number(m[1]);
      }
      for (const [g, [hX, hY]] of outcome) {
        change.table.set(g, yHp === null || hY === yHp ? Int32Array.of(hX) : new Int32Array(0));
      }
    }
  };

  // A handler that writes stored stats - Power Split's and Guard Split's
  // `onHit`, Speed Swap's, Power Trick's volatile starting and ending - is
  // asked before it runs, the way Pain Split is: run dry once per value of each
  // candidate value its Pokemon's stats stand on, and each stat it writes is
  // read off as a function of the one value that moved it (`deps`). One that
  // moves with two - a split between two hidden Pokemon - stays unmapped.
  const MOVABLE = ['atk', 'def', 'spa', 'spd', 'spe'];
  const writer = new Map();
  const writesStats = (effect, eventid) => {
    const handler = effect?.[`on${eventid}`];
    if (typeof handler !== 'function') return false;
    if (!writer.has(handler)) writer.set(handler, /storedStats(\.\w+|\[[^\]]+\])\s*=(?!=)/.test(String(handler)));
    return writer.get(handler);
  };
  let writeOrdinal = 0;
  function askWrites(involved, run) {
    const vars = new Map();
    for (const rec of involved) {
      for (const s of MOVABLE) {
        const dep = depOf(rec, s);
        if (!dep) return null;
        if (dep.owner) vars.set(`${dep.owner.id}|${dep.stat}`, dep);
      }
    }
    const tables = new Map();
    for (const [key, variable] of vars) {
      for (let v = 0; v < SPAN; v++) {
        const after = guarded(() => {
          const undo = patchAll(involved.map((rec) => {
            const stats = {};
            for (const s of MOVABLE) {
              const dep = depOf(rec, s);
              if (dep.owner === variable.owner && dep.stat === variable.stat) stats[s] = dep.at(v);
            }
            return { pokemon: rec.pokemon, stats };
          }));
          const items = snapItems(involved.map(rec => rec.pokemon));
          try {
            run();
            return involved.map(rec => MOVABLE.map(s => rec.pokemon.storedStats[s]));
          } finally {
            restoreItems(items);
            undo();
          }
        });
        for (const [i, rec] of involved.entries()) {
          for (const [j, s] of MOVABLE.entries()) {
            const at = `${rec.id}|${s}`;
            if (!tables.has(at)) tables.set(at, new Map());
            if (!tables.get(at).has(key)) tables.get(at).set(key, new Int32Array(SPAN));
            tables.get(at).get(key)[v] = after[i][j];
          }
        }
      }
    }
    return { vars: [...vars.keys()], tables };
  }

  /** Settle what each written stat now depends on, checked at the replay's own Stat Points. */
  function settleWrites(written, asked, what) {
    for (const [rec, s] of written) {
      const actual = rec.pokemon.storedStats[s];
      const byVar = asked?.tables.get(`${rec.id}|${s}`);
      const moving = asked && (byVar || !asked.vars.length)
        ? asked.vars.filter(key => { const t = byVar.get(key); return t.some(x => x !== t[0]); }) : null;
      let dep = null;
      if (moving && moving.length === 0) dep = CONSTANT;
      if (moving && moving.length === 1) {
        const [ownerId, stat] = moving[0].split('|');
        const values = byVar.get(moving[0]);
        dep = { owner: byId.get(ownerId), stat, at: v => values[v] };
      }
      const fits = dep && (dep.owner ? dep.at(ownValue(dep)) === actual
        : !asked.vars.length || asked.vars.every(key => byVar.get(key)[0] === actual));
      if (fits) {
        rec.deps[s] = dep;
        rec.unmapped.delete(s);
      } else {
        delete rec.deps[s];
        rec.unmapped.add(s);
        note(`${what} on ${label(rec)}'s ${s}`, 'no one candidate value says what it wrote, so what reads it is set aside');
      }
    }
  }

  const statSingle = battle.singleEvent;
  battle.singleEvent = function (eventid, effect, effectState, target, source, ...rest) {
    const run = () => statSingle.call(this, eventid, effect, effectState, target, source, ...rest);
    if (state.dry || state.ended || !writesStats(effect, eventid)) return run();
    const involved = [...new Set([target, source])].filter(p => p && typeof p === 'object' && byPokemon.has(p)).map(p => byPokemon.get(p));
    const ord = writeOrdinal++;
    const asked = memo(`writes|${ord}`, () => askWrites(involved, run));
    const outer = writes;
    writes = [];
    try {
      return run();
    } finally {
      const written = [...new Map(writes.map(([rec, s]) => [`${rec.id}|${s}`, [rec, s]])).values()];
      writes = outer;
      settleWrites(written, asked, effect.name);
    }
  };

  // Transform and Imposter copy the other Pokemon's stats in `transformInto`,
  // so each copied stat stands on whatever the original stood on: nothing, for
  // one of the known side, and the hidden one's own Stat Points when the known
  // side copies it.
  for (const rec of recs) {
    const transformInto = rec.pokemon.transformInto;
    override(rec.pokemon, 'transformInto', function (pokemon, ...rest) {
      const from = byPokemon.get(pokemon);
      if (state.dry || state.ended || !from) return transformInto.call(this, pokemon, ...rest);
      const copied = Object.fromEntries(MOVABLE.map(s => [s, depOf(from, s)]));
      const outer = writes;
      writes = [];
      try {
        return transformInto.call(this, pokemon, ...rest);
      } finally {
        const written = writes;
        writes = outer;
        for (const [r, s] of written) {
          const dep = r === rec ? copied[s] : null;
          if (dep && (!dep.owner || dep.at(ownValue(dep)) === r.pokemon.storedStats[s])) {
            r.deps[s] = dep;
            r.unmapped.delete(s);
          } else {
            delete r.deps[s];
            r.unmapped.add(s);
            note(`Transform on ${label(r)}'s ${s}`, 'no one candidate value says what it copied, so what reads it is set aside');
          }
        }
      }
    });
  }

  const speed = attachSpeed(battle, {
    state, sync, memo, guarded, recs, byPokemon, byIdent, view, prefix, record, events, label, measure, cutOf, note, depOf, ownValue,
  });

  /**
   * An attacking stat survives a hit only if a candidate it moved there can
   * still reach every later display of that Pokemon. The forward pass checks
   * each display on its own; walking each HP history back from what survived
   * the last one keeps only whole paths - which is what makes two unknown
   * Pokemon hitting each other consistent across turns, not just within one.
   */
  function backward() {
    for (const rec of recs) {
      if (!rec.history.length) continue;
      let alive = new Map(rec.chain);
      rec.alive = [];
      for (let i = rec.history.length - 1; i >= 0; i--) {
        rec.alive[i] = alive;
        const { change, token, survived, pre } = rec.history[i];
        const seen = change.via && token !== null ? new Uint8Array(SPAN) : null;
        const tied = tiedStat(rec, change);
        const held = tied ? rec.ties[tied] : null;
        const byKey = tied && token !== null ? new Map() : null;
        const prev = new Map();
        const allowAt = new Map();
        for (const [k, hs] of pre) {
          const later = alive.get(k);
          if (!later) continue;
          const hp = KEY_HP[k];
          const M = maxHp(rec, hp);
          let allow = null;
          if (token !== null) {
            if (!allowAt.has(M)) allowAt.set(M, allowed(rec, M, token, survived));
            allow = allowAt.get(M);
            if (!allow) continue;
          }
          const d = change.dim ? KEY_DIM[change.dim][k] : 0;
          const fatalOf = survived ? change.lethal : null;
          const keep = [];
          const vs = byKey ? new Set() : null;
          for (const h of hs) {
            let ok = false;
            if (change.same) {
              ok = later.includes(h) && dimAllowed(change, k) && (!change.allowSet || change.allowSet.has(M * HP_BITS + h)) && (!change.allow || change.allow(M, h));
            } else if (change.band) {
              let lo = change.band === 'up' ? h : 0;
              let hi = change.band === 'down' ? h : M;
              if (allow) { lo = Math.max(lo, allow[0]); hi = Math.min(hi, allow[1]); }
              ok = later.some(x => x >= lo && x <= hi);
            } else {
              const g = (hp * SPAN + d) * HP_BITS + h;
              const fatal = fatalOf?.get(g);
              for (const [j, packed] of (change.table.get(g) || []).entries()) {
                if (fatal && !fatal[j]) continue;
                const h2 = fatal ? 1 : packed % HP_BITS;
                if (!later.includes(h2)) continue;
                const v = Math.floor(packed / HP_BITS) % SPAN;
                if (held && !tieHas(held, k, v)) continue;
                if (change.dealtOk && !change.dealtOk.has(v * HP_BITS + h - h2)) continue;
                ok = true;
                if (vs) vs.add(v);
                if (!seen && !vs) break;
                if (seen) seen[v] = 1;
              }
            }
            if (ok) keep.push(h);
          }
          if (keep.length) {
            prev.set(k, keep);
            if (byKey) byKey.set(k, vs);
          }
        }
        if (byKey) tie(rec, tied, byKey);
        if (seen) narrowVia(change.via, seen);
        alive = prev;
      }
      rec.pathKeys = new Set(alive.keys());
    }
  }

  /** What the backward walk removed, as one event per Pokemon. */
  function wholePaths() {
    const before = record ? new Map(recs.map(rec => [rec, measure(rec)])) : null;
    backward();
    for (const rec of recs) {
      if (rec.pathKeys && rec.chain) for (const k of [...rec.chain.keys()]) if (!rec.pathKeys.has(k)) rec.chain.delete(k);
    }
    if (!record) return;
    const cuts = recs.map(rec => cutOf(rec, before.get(rec))).filter(Boolean);
    if (cuts.length) {
      events.push({ turn: battle.turn, what: 'every turn at once - recoil, attacker HP and later displays checked against earlier hits', cuts });
    }
  }

  /**
   * One exact HP path per Pokemon through everything the verified log showed,
   * when every spread is pinned. Chosen in the order the changes happened, so a
   * hit that depended on its attacker's HP takes the attacker's chosen HP, and a
   * hit whose recoil was printed deals an amount the recoil allows. Where more
   * than one value fits, the scaffold's own is kept.
   *
   * Returns the exact HP tokens by raw-log index, and for every hit on the path
   * the damage roll that produces it, keyed by the draw ordinal that roll took.
   */
  function paths(raw) {
    const entries = [];
    for (const rec of recs) for (const [i, e] of rec.history.entries()) entries.push({ rec, i, e });
    entries.sort((x, y) => x.e.seq - y.e.seq);
    const cur = new Map();
    const chosen = new Map(recs.map(rec => [rec, []]));
    const rolls = new Map();
    const secretAt = new Map();
    for (const rec of recs) {
      for (const { at, hist } of rec.shown) {
        const split = at >= 2 && /^\|split\|/.test(raw[at - 2] || '');
        const exactAt = split && raw[at] !== raw[at - 1] && !rec.exact ? at - 1 : at;
        secretAt.set(`${rec.id}|${hist}`, exactAt);
      }
    }
    const scaffoldHp = (rec, hist) => {
      const at = secretAt.get(`${rec.id}|${hist}`);
      const m = at === undefined ? null : /^(\d+)\//.exec(String(hpLine(raw[at])?.token || ''));
      return m ? Number(m[1]) : null;
    };
    for (const { rec, i, e } of entries) {
      const alive = rec.alive?.[i];
      if (!alive) return null;
      let state = cur.get(rec);
      if (!state) {
        const [k, hs] = [...e.pre.entries()][0] || [];
        if (k === undefined) return null;
        state = [k, hs[0]];
      }
      const [k, h] = state;
      const later = alive.get(k) || [];
      const M = maxHp(rec, KEY_HP[k]);
      const d = e.change.dim ? KEY_DIM[e.change.dim][k] : 0;
      const options = [];
      const rollOf = new Map();
      if (e.change.same) {
        if (later.includes(h) && dimAllowed(e.change, k) && (!e.change.allowSet || e.change.allowSet.has(M * HP_BITS + h)) && (!e.change.allow || e.change.allow(M, h))) options.push(h);
      } else if (e.change.band) {
        const lo = e.change.band === 'up' ? h : 0;
        const hi = e.change.band === 'down' ? h : M;
        for (const x of later) if (x >= lo && x <= hi) options.push(x);
      } else {
        const attacker = e.change.sourceStates ? cur.get(e.change.dealtBy) : null;
        const extra = e.change.extra && !FLAT.includes(e.change.extra.stat) ? cur.get(byId.get(e.change.extra.owner)) : null;
        const g = (KEY_HP[k] * SPAN + d) * HP_BITS + h;
        const packs = e.change.table.get(g) || [];
        const rs = e.change.rolls?.get(g);
        const fatal = e.survived ? e.change.lethal?.get(g) : null;
        for (let j = 0; j < packs.length; j++) {
          if (fatal && !fatal[j]) continue;
          const packed = packs[j];
          const h2 = fatal ? 1 : packed % HP_BITS;
          if (!later.includes(h2)) continue;
          const tag = Math.floor(packed / HP_BITS);
          if (e.change.dealtOk && !e.change.dealtOk.has((tag % SPAN) * HP_BITS + h - h2)) continue;
          if (e.change.sourceStates) {
            const [sM, sH, sX] = e.change.sourceStates[Math.floor(tag / SPAN)];
            if (attacker && sM !== null && (sM !== maxHp(e.change.dealtBy, KEY_HP[attacker[0]]) || sH !== attacker[1])) continue;
            if (extra && sX !== null && sX !== KEY_DIM[e.change.extra.stat][extra[0]]) continue;
          }
          options.push(h2);
          if (rs && !rollOf.has(h2)) rollOf.set(h2, rs[j]);
        }
      }
      if (!options.length) return null;
      const own = e.token !== null ? scaffoldHp(rec, i) : null;
      const h2 = options.includes(own) ? own : options[0];
      chosen.get(rec)[i] = h2;
      cur.set(rec, [k, h2]);
      if (e.change.rollAt !== null && e.change.rollAt !== undefined && rollOf.has(h2)) rolls.set(e.change.rollAt, rollOf.get(h2));
    }

    const tokens = new Map();
    for (const rec of recs) {
      if (rec.exact) continue;
      const k = cur.get(rec)?.[0];
      if (k === undefined) continue;
      for (const { hist, ahead } of rec.shown) {
        if (ahead) continue;
        const h = chosen.get(rec)[hist];
        if (h === undefined) return null;
        tokens.set(secretAt.get(`${rec.id}|${hist}`), h ? `${h}/${maxHp(rec, KEY_HP[k])}` : '0');
      }
    }
    return { tokens, rolls };
  }

  return {
    state,
    paths,
    finish() {
      sync();
      state.ended = true;
      // A change already settled against a line the log shows stands even when
      // its own Pokemon's display lies past the cutoff.
      for (const rec of recs) {
        const last = rec.pending.findLastIndex(c => c.final);
        for (const c of rec.pending.splice(0, last + 1)) apply(rec, c, null);
      }
      wholePaths();
      speed.apply(speed.rules());
      for (const rec of recs) {
        if (!rec.chain || !Object.keys(rec.ties).length) continue;
        const sup = supported(rec.chain.keys(), rec.flat, rec.ties);
        const keep = new Set(sup.keys);
        for (const k of [...rec.chain.keys()]) if (!keep.has(k)) rec.chain.delete(k);
        for (const x of FLAT) rec.flat[x] = sup.dom[x];
      }
    },
    result() {
      return {
        recs: recs.map(rec => ({
          id: rec.id,
          keys: rec.chain ? [...rec.chain.keys()] : rec.knKeys,
          flat: rec.flat,
          ties: rec.ties,
          seen: !!rec.chain,
        })),
        // In the order they were applied: every HP event as the battle ran, then
        // the whole-path check, then speed order, which needs every turn's sort.
        events,
        checks,
        cutoff: prefix.cutoffAt === Infinity ? null : { turn: prefix.turn, observed: prefix.observedLine },
      };
    },
  };
}
