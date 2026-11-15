/**
 * What is known about each Pokemon's Stat Points: every spread still possible.
 *
 * A spread is six numbers, 0-32 each, at most 66 together. HP, Defence and
 * Special Defence are one joint key, because they are what decides the HP a
 * Pokemon is left on; Attack, Special Attack and Speed are flat domains, each
 * tied to the key where a hit read it against the same Pokemon's key. This
 * file holds that model, the 66-point budget pushed through it, the count of
 * whole spreads it allows, and how the next guess is picked from it. Nothing
 * here runs the simulator.
 *
 * A Pokemon marked `spent` is assumed to use all 66 points, as real sets do.
 * That is an assumption, not evidence, so it is only ever asked for.
 */

export const SPAN = 33;
export const BUDGET = 66;
export const KEYS = SPAN * SPAN * SPAN;
export const FLAT = ['atk', 'spa', 'spe'];
export const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// HP, Defence and Special Defence travel together: they are what decides the HP
// a Pokemon is left on, so they are one joint key. Attack, Special Attack and
// Speed are independent flat domains.
export const KEY_HP = new Uint8Array(KEYS);
export const KEY_DEF = new Uint8Array(KEYS);
export const KEY_SPD = new Uint8Array(KEYS);
export const KEY_SUM = new Uint8Array(KEYS);
for (let k = 0; k < KEYS; k++) {
  KEY_HP[k] = Math.floor(k / (SPAN * SPAN));
  KEY_DEF[k] = Math.floor(k / SPAN) % SPAN;
  KEY_SPD[k] = k % SPAN;
  KEY_SUM[k] = KEY_HP[k] + KEY_DEF[k] + KEY_SPD[k];
}
export const KEY_DIM = { def: KEY_DEF, spd: KEY_SPD };
export const keyOf = (hp, def, spd) => (hp * SPAN + def) * SPAN + spd;

export const fullEvs = evs => Object.fromEntries(STAT_IDS.map(s => [s, Number(evs?.[s]) || 0]));
export const aliveOf = (mask) => {
  const out = [];
  for (let v = 0; v < mask.length; v++) if (mask[v]) out.push(v);
  return out;
};

// ------------------------------------------------------------ ties

/**
 * A tie: which values of one flat stat each key still allows, once a hit read
 * that stat against the same Pokemon's key - its own Attack against its own HP
 * and Defence, in recoil, drain, Foul Play or a confusion self-hit. Two 32-bit
 * words per key: values 0-31 in the first, 32 in the second. A stat with no tie
 * allows every value of its domain beside every key.
 *
 * A hit can also read two flat stats of one Pokemon together - a Gyro Ball
 * user's Attack and its own Speed. That pair is a tie too, named `atk|spe`:
 * one byte per pair of values, the first-named stat's value times SPAN plus the
 * other's.
 */
export const newTie = () => new Uint32Array(KEYS * 2);
export const tieHas = (tie, k, v) => (v < 32 ? (tie[2 * k] >>> v) & 1 : tie[2 * k + 1] & 1) === 1;
export function tieWords(values) {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (v < 32) lo |= 1 << v;
    else hi = 1;
  }
  return [lo >>> 0, hi];
}
const maskWords = mask => tieWords(aliveOf(mask));
export const pairName = (a, b) => (FLAT.indexOf(a) < FLAT.indexOf(b) ? `${a}|${b}` : `${b}|${a}`);
const pairsOf = ties => Object.entries(ties || {}).filter(([n]) => n.includes('|')).map(([n, m]) => {
  const [a, b] = n.split('|');
  return { a, b, m };
});
/** Whether every pair tie allows the flat values in `vals`. */
const pairsAllow = (pairs, vals) => pairs.every(({ a, b, m }) => m[vals[a] * SPAN + vals[b]] === 1);
const cloneTies = ties => Object.fromEntries(Object.entries(ties || {}).map(([s, t]) => [s, t.slice()]));
const wordValues = (lo, hi) => {
  const out = [];
  for (let v = 0; v < 32; v++) if ((lo >>> v) & 1) out.push(v);
  if (hi & 1) out.push(32);
  return out;
};

/**
 * The keys and flat values that still make a whole spread together: a key
 * needs a value each tie allows beside it, and a tied value needs a key that
 * allows it.
 */
export function supported(keys, dom, ties = {}) {
  const tied = FLAT.filter(s => ties?.[s]);
  const pairs = pairsOf(ties);
  let list = [...keys];
  if (!tied.length && !pairs.length) return { keys: list, dom };
  const out = { ...dom };
  for (let round = 0; round < 8; round++) {
    let changed = false;
    const words = tied.map(s => maskWords(out[s]));
    const next = list.filter(k => tied.every((s, j) => ((ties[s][2 * k] & words[j][0]) | (ties[s][2 * k + 1] & words[j][1])) !== 0));
    if (next.length !== list.length) changed = true;
    list = next;
    for (const s of tied) {
      let lo = 0;
      let hi = 0;
      for (const k of list) { lo |= ties[s][2 * k]; hi |= ties[s][2 * k + 1]; }
      const mask = out[s].slice();
      for (let v = 0; v < SPAN; v++) {
        if (mask[v] && !(v < 32 ? (lo >>> v) & 1 : hi & 1)) { mask[v] = 0; changed = true; }
      }
      out[s] = mask;
    }
    for (const { a, b, m } of pairs) {
      const ma = out[a].slice();
      const mb = out[b].slice();
      for (let x = 0; x < SPAN; x++) {
        if (!ma[x]) continue;
        let ok = false;
        for (let y = 0; y < SPAN && !ok; y++) ok = out[b][y] === 1 && m[x * SPAN + y] === 1;
        if (!ok) { ma[x] = 0; changed = true; }
      }
      for (let y = 0; y < SPAN; y++) {
        if (!mb[y]) continue;
        let ok = false;
        for (let x = 0; x < SPAN && !ok; x++) ok = ma[x] === 1 && m[x * SPAN + y] === 1;
        if (!ok) { mb[y] = 0; changed = true; }
      }
      out[a] = ma;
      out[b] = mb;
    }
    if (!changed) break;
  }
  return { keys: list, dom: out };
}

// ------------------------------------------------------------ what is known

const NEUTRAL_NATURES = new Set(['hardy', 'docile', 'serious', 'bashful', 'quirky']);
const CANONICAL_NATURE_CACHE = new Map();

export const canonicalNatureName = (nature) => {
  if (!nature) return 'Serious';
  const hit = CANONICAL_NATURE_CACHE.get(nature);
  if (hit !== undefined) return hit;
  const low = String(nature).trim().toLowerCase();
  const out = !low || NEUTRAL_NATURES.has(low) ? 'Serious' : `${low[0].toUpperCase()}${low.slice(1)}`;
  CANONICAL_NATURE_CACHE.set(nature, out);
  return out;
};

export const candidateNatures = dex => ['Serious', ...dex.natures.all().filter(n => n.exists && n.plus).map(n => n.name)];

function freshSingleKnowledge(set, known, spent = false) {
  const keys = new Uint8Array(KEYS);
  const dom = { atk: new Uint8Array(SPAN), spa: new Uint8Array(SPAN), spe: new Uint8Array(SPAN) };
  if (known) {
    const e = fullEvs(set.evs);
    keys[keyOf(e.hp, e.def, e.spd)] = 1;
    for (const s of FLAT) dom[s][e[s]] = 1;
  } else {
    for (let k = 0; k < KEYS; k++) if (KEY_SUM[k] <= BUDGET) keys[k] = 1;
    for (const s of FLAT) dom[s].fill(1);
  }
  return { known, spent: !known && spent, keys, dom, ties: {} };
}

function cloneSingle(kn) {
  return {
    known: kn.known,
    spent: kn.spent,
    ...(kn.nature ? { nature: kn.nature } : {}),
    keys: kn.keys.slice(),
    dom: { atk: kn.dom.atk.slice(), spa: kn.dom.spa.slice(), spe: kn.dom.spe.slice() },
    ties: cloneTies(kn.ties),
  };
}

/** Keep `kn`'s flat and key summary equal to the union of its surviving natures. */
export function syncKnowledge(kn) {
  if (!kn?.natures) return;
  kn.keys.fill(0);
  for (const s of FLAT) kn.dom[s].fill(0);
  kn.ties = {};
  let first = true;
  for (const sub of kn.natures.values()) {
    if (!sub.keys.includes(1) || FLAT.some(s => !sub.dom[s].includes(1))) continue;
    if (first) {
      kn.keys.set(sub.keys);
      for (const s of FLAT) kn.dom[s].set(sub.dom[s]);
      kn.ties = cloneTies(sub.ties);
      first = false;
    } else {
      uniteSingleKnowledge(kn, sub);
    }
  }
}

export function freshKnowledge(set, known, spent = false, dex = null) {
  const kn = freshSingleKnowledge(set, known, spent);
  if (!known && !set?.nature && dex) {
    kn.natures = new Map(candidateNatures(dex).map(n => [n, { ...freshSingleKnowledge(set, false, spent), nature: n }]));
  }
  return kn;
}

export function cloneKnowledge(map) {
  const out = new Map();
  for (const [id, kn] of map) {
    const copy = cloneSingle(kn);
    if (kn.natures) copy.natures = new Map([...kn.natures].map(([n, sub]) => [n, cloneSingle(sub)]));
    out.set(id, copy);
  }
  return out;
}

export function pinKnowledge(kn, evs) {
  const e = fullEvs(evs);
  if (kn.natures) {
    if (evs?.nature) {
      kn.nature = canonicalNatureName(evs.nature);
      kn.natures = null;
    } else {
      for (const sub of kn.natures.values()) {
        if (containsSpread(sub, e)) pinKnowledge(sub, e);
        else { sub.keys.fill(0); for (const s of FLAT) sub.dom[s].fill(0); sub.ties = {}; }
      }
      syncKnowledge(kn);
      return;
    }
  }
  kn.keys.fill(0);
  kn.keys[keyOf(e.hp, e.def, e.spd)] = 1;
  for (const s of FLAT) { kn.dom[s].fill(0); kn.dom[s][e[s]] = 1; }
  kn.ties = {};
}

function intersectSingle(kn, keys, flat, ties = {}) {
  let moved = false;
  const keep = new Uint8Array(KEYS);
  for (const k of keys) keep[k] = 1;
  for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !keep[k]) { kn.keys[k] = 0; moved = true; }
  for (const s of FLAT) {
    for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !flat[s][v]) { kn.dom[s][v] = 0; moved = true; }
  }
  kn.ties ||= {};
  for (const [s, tie] of Object.entries(ties || {})) {
    const mine = kn.ties[s];
    if (!mine) { kn.ties[s] = tie.slice(); moved = true; continue; }
    const pair = s.includes('|');
    for (let i = 0; i < mine.length; i++) {
      const both = (mine[i] & tie[i]) >>> 0;
      if (both === mine[i]) continue;
      if (pair || kn.keys[i >> 1]) moved = true;
      mine[i] = both;
    }
  }
  return moved;
}

/** Narrow `kn` to what a pass left alive. Returns whether anything moved. */
export function intersectKnowledge(kn, keys, flat, ties = {}, natures = null) {
  if (!kn.natures) return intersectSingle(kn, keys, flat, ties);
  let moved = false;
  if (natures) {
    for (const [n, sub] of kn.natures) {
      const other = natures.get(n);
      if (!other) {
        if (sub.keys.includes(1) || FLAT.some(s => sub.dom[s].includes(1))) {
          sub.keys.fill(0);
          for (const s of FLAT) sub.dom[s].fill(0);
          sub.ties = {};
          moved = true;
        }
      } else {
        moved = intersectSingle(sub, maskKeys(other.keys), other.dom, other.ties) || moved;
      }
    }
  } else {
    for (const sub of kn.natures.values()) moved = intersectSingle(sub, keys, flat, ties) || moved;
  }
  if (moved) syncKnowledge(kn);
  return moved;
}

/** Which totals a set of stats can reach, one surviving value from each. */
function reach(masks) {
  let out = Uint8Array.of(1);
  for (const mask of masks) {
    const next = new Uint8Array(out.length + mask.length - 1);
    for (let t = 0; t < out.length; t++) {
      if (!out[t]) continue;
      for (let v = 0; v < mask.length; v++) if (mask[v]) next[t + v] = 1;
    }
    out = next;
  }
  return out;
}

/**
 * The budget as a test per key and per flat value: a value fits if some choice
 * for everything else that survives brings the total within 66 - or, for a
 * Pokemon assumed to spend every point, to exactly 66.
 */
function budgetTest(keys, dom, spent) {
  const keySums = new Uint8Array(3 * (SPAN - 1) + 1);
  for (const k of keys) keySums[KEY_SUM[k]] = 1;
  const within = (sums) => {
    if (spent) return need => need >= 0 && need < sums.length && sums[need] === 1;
    const upTo = new Uint8Array(sums.length);
    for (let t = 0, any = 0; t < sums.length; t++) { any |= sums[t]; upTo[t] = any; }
    return need => need >= 0 && upTo[Math.min(need, sums.length - 1)] === 1;
  };
  const flatFits = within(reach(FLAT.map(s => dom[s])));
  return {
    key: k => flatFits(BUDGET - KEY_SUM[k]),
    flat: FLAT.map((s, j) => {
      const rest = within(reach([keySums, ...FLAT.filter((_, i) => i !== j).map(x => dom[x])]));
      return v => rest(BUDGET - v);
    }),
  };
}

/**
 * `budgetTest` where ties hold: a key fits if some choice of flat values it
 * allows fits the budget beside it, and a flat value fits if some key allows
 * it with the rest fitting. With one tie on a key this is read off the sums of
 * the untied stats; with more, or a pair tie, each distinct set of choices
 * the keys allow is enumerated once, for the totals each value reaches.
 */
function tiedBudget(keys, dom, ties, spent) {
  const tied = FLAT.filter(s => ties[s]);
  const pairs = pairsOf(ties);
  const words = FLAT.map(s => maskWords(dom[s]));
  const keyOk = new Uint8Array(KEYS);
  const flatOk = Object.fromEntries(FLAT.map(s => [s, new Uint8Array(SPAN)]));
  const fit = (total, room) => (spent ? total === room : total <= room);
  if (tied.length === 1 && !pairs.length) {
    const t = tied[0];
    const free = FLAT.filter(x => x !== t);
    const vals = Object.fromEntries(free.map(x => [x, aliveOf(dom[x])]));
    if (free.some(x => !vals[x].length)) return { key: () => false, flat: FLAT.map(() => () => false) };
    // Every total the two untied stats reach, and each one's with the other's.
    const both = reach(free.map(x => dom[x]));
    const other = Object.fromEntries(free.map((x, i) => [x, reach([dom[free[1 - i]]])]));
    // Whether some total `totals` reaches, added to `base`, fits `room`: within
    // it, the least total does; spent to the point, the one total that lands
    // on it.
    const least = totals => totals.indexOf(1);
    const lowBoth = least(both);
    const lowOther = Object.fromEntries(free.map(x => [x, least(other[x])]));
    const fitsWith = (totals, low, base, room) => {
      if (!spent) return low >= 0 && base + low <= room;
      const need = room - base;
      return need >= 0 && need < totals.length && totals[need] === 1;
    };
    // Which tied values fit each room beside the untied stats: precomputed as a
    // bitmask per room so every key tests all 33 values at once, and the untied
    // stats are marked once per (room, value) that any surviving key reached.
    const j = FLAT.indexOf(t);
    const tie = ties[t];
    const w0 = words[j][0];
    const w1 = words[j][1] & 1;
    const fitLo = new Uint32Array(BUDGET + 1);
    const fitHi = new Uint8Array(BUDGET + 1);
    for (let room = 0; room <= BUDGET; room++) {
      let lo = 0;
      for (let v = 0; v < 32; v++) if (fitsWith(both, lowBoth, v, room)) lo |= 1 << v;
      fitLo[room] = lo >>> 0;
      if (fitsWith(both, lowBoth, 32, room)) fitHi[room] = 1;
    }
    const roomLo = new Uint32Array(BUDGET + 1);
    const roomHi = new Uint8Array(BUDGET + 1);
    for (const k of keys) {
      const room = BUDGET - KEY_SUM[k];
      if (room < 0) continue;
      const lo = (tie[2 * k] & w0 & fitLo[room]) >>> 0;
      const hi = tie[2 * k + 1] & w1 & fitHi[room];
      if (lo === 0 && hi === 0) continue;
      keyOk[k] = 1;
      roomLo[room] = (roomLo[room] | lo) >>> 0;
      roomHi[room] |= hi;
    }
    for (let room = 0; room <= BUDGET; room++) {
      const rLo = roomLo[room];
      const rHi = roomHi[room];
      if (rLo === 0 && rHi === 0) continue;
      for (let v = 0; v < SPAN; v++) {
        if (!(v < 32 ? (rLo >>> v) & 1 : rHi & 1)) continue;
        flatOk[t][v] = 1;
        for (const x of free) {
          for (const w of vals[x]) {
            if (!flatOk[x][w] && fitsWith(other[x], lowOther[x], v + w, room)) flatOk[x][w] = 1;
          }
        }
      }
    }
  } else {
    // Per signature, the totals the whole choices reach, and each flat value's
    // own; per signature and room, what fits.
    const TOTALS = 3 * (SPAN - 1) + 1;
    const memo = new Map();
    for (const k of keys) {
      const room = BUDGET - KEY_SUM[k];
      if (room < 0) continue;
      const sig = sigFor(k, ties, words);
      let by = memo.get(sig);
      if (!by) {
        const { lists } = listsFor(k, dom, ties, words);
        const vals = FLAT.map(x => lists[x] || aliveOf(dom[x]));
        const any = new Uint8Array(TOTALS);
        const at = FLAT.map(() => new Array(SPAN).fill(null));
        const v = {};
        for (const a of vals[0]) {
          v.atk = a;
          for (const b of vals[1]) {
            v.spa = b;
            for (const c of vals[2]) {
              v.spe = c;
              if (!pairsAllow(pairs, v)) continue;
              const t = a + b + c;
              any[t] = 1;
              (at[0][a] ||= new Uint8Array(TOTALS))[t] = 1;
              (at[1][b] ||= new Uint8Array(TOTALS))[t] = 1;
              (at[2][c] ||= new Uint8Array(TOTALS))[t] = 1;
            }
          }
        }
        by = { any, at, rooms: new Map() };
        memo.set(sig, by);
      }
      let ok = by.rooms.get(room);
      if (ok === undefined) {
        const fits = totals => totals.some((x, t) => x === 1 && fit(t, room));
        ok = fits(by.any);
        by.rooms.set(room, ok);
        if (ok) for (const [j, x] of FLAT.entries()) for (let w = 0; w < SPAN; w++) if (by.at[j][w] && fits(by.at[j][w])) flatOk[x][w] = 1;
      }
      if (ok) keyOk[k] = 1;
    }
  }
  return { key: k => keyOk[k] === 1, flat: FLAT.map(x => v => flatOk[x][v] === 1) };
}

function uniteSingleKnowledge(kn, other) {
  const tied = new Set([...Object.keys(kn.ties || {}), ...Object.keys(other.ties || {})]);
  const ties = {};
  for (const s of [...tied].filter(n => n.includes('|'))) {
    const [a, b] = s.split('|');
    const m = new Uint8Array(SPAN * SPAN);
    for (const src of [kn, other]) {
      const own = src.ties?.[s];
      for (let x = 0; x < SPAN; x++) {
        for (let y = 0; y < SPAN; y++) if (src.dom[a][x] && src.dom[b][y] && (!own || own[x * SPAN + y])) m[x * SPAN + y] = 1;
      }
    }
    ties[s] = m;
  }
  for (const s of [...tied].filter(n => !n.includes('|'))) {
    const tie = newTie();
    for (const src of [kn, other]) {
      const [lo, hi] = maskWords(src.dom[s]);
      const own = src.ties?.[s];
      for (let k = 0; k < KEYS; k++) {
        if (!src.keys[k]) continue;
        tie[2 * k] |= own ? own[2 * k] & lo : lo;
        tie[2 * k + 1] |= own ? own[2 * k + 1] & hi : hi;
      }
    }
    ties[s] = tie;
  }
  for (let k = 0; k < KEYS; k++) if (other.keys[k]) kn.keys[k] = 1;
  for (const s of FLAT) for (let v = 0; v < SPAN; v++) if (other.dom[s][v]) kn.dom[s][v] = 1;
  kn.ties = ties;
}

/**
 * Every spread `other` leaves added to `kn`, a stat at a time: it holds every
 * spread either leaves, and can hold more. A tie either holds is kept, as what
 * each key allows in one or the other.
 */
export function uniteKnowledge(kn, other) {
  if (kn.natures && other.natures) {
    for (const [n, sub] of other.natures) {
      if (kn.natures.has(n)) uniteSingleKnowledge(kn.natures.get(n), sub);
      else kn.natures.set(n, cloneSingle(sub));
    }
    syncKnowledge(kn);
    return;
  }
  if (kn.natures && other.nature) {
    const nat = canonicalNatureName(other.nature);
    if (kn.natures.has(nat)) uniteSingleKnowledge(kn.natures.get(nat), other);
    else kn.natures.set(nat, cloneSingle({ ...other, nature: nat }));
    syncKnowledge(kn);
    return;
  }
  uniteSingleKnowledge(kn, other);
}

function tightenSingle(kn) {
  let moved = false;
  for (let round = 0; round < 8; round++) {
    if (!kn.keys.includes(1) || FLAT.some(s => !kn.dom[s].includes(1))) {
      const any = kn.keys.includes(1) || FLAT.some(s => kn.dom[s].includes(1));
      kn.keys.fill(0);
      for (const s of FLAT) kn.dom[s].fill(0);
      return moved || any;
    }
    let changed = false;
    const hasTies = Object.keys(kn.ties || {}).length > 0;
    const keys = maskKeys(kn.keys);
    if (hasTies) {
      const sup = supported(keys, kn.dom, kn.ties);
      const keep = new Uint8Array(KEYS);
      for (const k of sup.keys) keep[k] = 1;
      for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !keep[k]) { kn.keys[k] = 0; changed = true; }
      for (const s of FLAT) {
        for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !sup.dom[s][v]) { kn.dom[s][v] = 0; changed = true; }
      }
      if (changed) { moved = true; continue; }
    }
    const fits = hasTies ? tiedBudget(keys, kn.dom, kn.ties, kn.spent) : budgetTest(keys, kn.dom, kn.spent);
    for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !fits.key(k)) { kn.keys[k] = 0; changed = true; }
    for (const [j, s] of FLAT.entries()) {
      for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !fits.flat[j](v)) { kn.dom[s][v] = 0; changed = true; }
    }
    if (!changed) break;
    moved = true;
  }
  return moved;
}

/**
 * The 66-point budget and the ties, pushed through every stat: a value that
 * cannot fit beside any surviving choice for everything else is gone.
 */
export function tighten(kn) {
  if (!kn.natures) return tightenSingle(kn);
  let moved = false;
  for (const sub of kn.natures.values()) moved = tightenSingle(sub) || moved;
  syncKnowledge(kn);
  return moved;
}

/**
 * Speed orders kept from earlier rounds, each `{ fast, slow, tf, ts }` as
 * evidence.mjs hands them on: the ids of the Pokemon whose Stat Points the two
 * speeds stand on, and each one's speed at every Speed Stat Point at that
 * sort. Bounds each Speed by the other the way speed.mjs does, all of them
 * again until none moves: an order between two Pokemon holds whatever was
 * guessed, so it is kept beside them, not only as the bounds it left on each
 * - a tie needs both orders at once, and a guess can rebuild only one of the
 * two lines that prove it. Returns whether anything went.
 */
export function orderSpeeds(map, orders) {
  const slicesFor = (kn) => {
    if (!kn) return null;
    if (!kn.natures) return kn.dom?.spe ? [{ sub: null, dom: kn.dom.spe, nat: kn.nature ? canonicalNatureName(kn.nature) : null }] : null;
    const out = [];
    for (const [nat, sub] of kn.natures) {
      if (sub.keys.includes(1) && sub.dom.spe.includes(1)) out.push({ sub, dom: sub.dom.spe, nat });
    }
    return out;
  };
  const tableFor = (nat, table, byNature) => (nat && byNature?.[nat]) || table;
  const self = [];
  const byPair = new Map();
  const seenRule = new Set();
  for (const o of orders) {
    if (!o.tf || !o.ts) continue;
    const rk = `${o.fast}|${o.slow}|${o.strict ? '>' : '>='}|${o.tfByNature || o.tsByNature ? `${o.turn ?? ''}|` : ''}${o.tf}|${o.ts}`;
    if (seenRule.has(rk)) continue;
    seenRule.add(rk);
    if (o.fast === o.slow) { self.push(o); continue; }
    const [a, b] = o.fast < o.slow ? [o.fast, o.slow] : [o.slow, o.fast];
    let entry = byPair.get(`${a}|${b}`);
    if (!entry) { entry = { a, b, rules: [] }; byPair.set(`${a}|${b}`, entry); }
    entry.rules.push(o);
  }
  let any = false;
  const touched = new Set();
  for (const { fast, tf, ts, tfByNature, tsByNature, strict } of self) {
    const fKn = map.get(fast);
    const slices = slicesFor(fKn);
    if (!slices) continue;
    for (const { sub, dom, nat } of slices) {
      const tFast = tableFor(nat, tf, tfByNature);
      const tSlow = tableFor(nat, ts, tsByNature);
      let subMoved = false;
      for (let v = 0; v < SPAN; v++) {
        if (dom[v] && (strict ? tFast[v] <= tSlow[v] : tFast[v] < tSlow[v])) { dom[v] = 0; any = true; subMoved = true; }
      }
      if (subMoved && sub) { tightenSingle(sub); touched.add(fKn); }
    }
  }
  for (let moved = true; moved;) {
    moved = false;
    for (const { a, b, rules } of byPair.values()) {
      const aKn = map.get(a);
      const bKn = map.get(b);
      const saList = slicesFor(aKn);
      const sbList = slicesFor(bKn);
      if (!saList || !sbList) continue;
      if (rules.length === 1) {
        const { fast, tf, ts, tfByNature, tsByNature, strict } = rules[0];
        const [fKn, sKn, fList, sList] = fast === a ? [aKn, bKn, saList, sbList] : [bKn, aKn, sbList, saList];
        let maxFast = -Infinity;
        let minSlow = Infinity;
        for (const { dom, nat } of fList) {
          const t = tableFor(nat, tf, tfByNature);
          for (let v = 0; v < SPAN; v++) if (dom[v]) maxFast = Math.max(maxFast, t[v]);
        }
        for (const { dom, nat } of sList) {
          const t = tableFor(nat, ts, tsByNature);
          for (let v = 0; v < SPAN; v++) if (dom[v]) minSlow = Math.min(minSlow, t[v]);
        }
        for (const { sub, dom, nat } of fList) {
          const t = tableFor(nat, tf, tfByNature);
          let subMoved = false;
          for (let v = 0; v < SPAN; v++) {
            if (dom[v] && (strict ? t[v] <= minSlow : t[v] < minSlow)) { dom[v] = 0; moved = true; subMoved = true; }
          }
          if (subMoved && sub) { tightenSingle(sub); touched.add(fKn); }
        }
        for (const { sub, dom, nat } of sList) {
          const t = tableFor(nat, ts, tsByNature);
          let subMoved = false;
          for (let v = 0; v < SPAN; v++) {
            if (dom[v] && (strict ? t[v] >= maxFast : t[v] > maxFast)) { dom[v] = 0; moved = true; subMoved = true; }
          }
          if (subMoved && sub) { tightenSingle(sub); touched.add(sKn); }
        }
        continue;
      }
      const okA = saList.map(() => new Uint8Array(SPAN));
      const okB = sbList.map(() => new Uint8Array(SPAN));
      for (let ia = 0; ia < saList.length; ia++) {
        const sa = saList[ia];
        for (let va = 0; va < SPAN; va++) {
          if (!sa.dom[va]) continue;
          for (let ib = 0; ib < sbList.length; ib++) {
            const sb = sbList[ib];
            for (let vb = 0; vb < SPAN; vb++) {
              if (!sb.dom[vb]) continue;
              let ok = true;
              for (let r = 0; r < rules.length; r++) {
                const o = rules[r];
                const lhs = o.fast === a
                  ? tableFor(sa.nat, o.tf, o.tfByNature)[va]
                  : tableFor(sb.nat, o.tf, o.tfByNature)[vb];
                const rhs = o.fast === a
                  ? tableFor(sb.nat, o.ts, o.tsByNature)[vb]
                  : tableFor(sa.nat, o.ts, o.tsByNature)[va];
                if (o.strict ? lhs <= rhs : lhs < rhs) { ok = false; break; }
              }
              if (ok) { okA[ia][va] = 1; okB[ib][vb] = 1; }
            }
          }
        }
      }
      for (let ia = 0; ia < saList.length; ia++) {
        const { sub, dom } = saList[ia];
        let subMoved = false;
        for (let v = 0; v < SPAN; v++) {
          if (dom[v] && !okA[ia][v]) { dom[v] = 0; moved = true; subMoved = true; }
        }
        if (subMoved && sub) { tightenSingle(sub); touched.add(aKn); }
      }
      for (let ib = 0; ib < sbList.length; ib++) {
        const { sub, dom } = sbList[ib];
        let subMoved = false;
        for (let v = 0; v < SPAN; v++) {
          if (dom[v] && !okB[ib][v]) { dom[v] = 0; moved = true; subMoved = true; }
        }
        if (subMoved && sub) { tightenSingle(sub); touched.add(bKn); }
      }
    }
    any = any || moved;
  }
  for (const kn of touched) syncKnowledge(kn);
  return any;
}

/** How many ways each total can be made, one value from each list. */
function sums(lists) {
  let out = Float64Array.of(1);
  for (const list of lists) {
    const next = new Float64Array(out.length + SPAN - 1);
    for (let t = 0; t < out.length; t++) if (out[t]) for (const v of list) next[t + v] += out[t];
    out = next;
  }
  return out;
}

/**
 * How many whole spreads survive: every alive (hp, def, spd) beside every alive
 * (atk, spa, spe) that fits the budget and every tie. `spent` counts the ones
 * using all 66.
 */
export function spreadCount(keys, dom, ties = {}) {
  if (pairsOf(ties).length) return pairedCount(keys, dom, ties);
  const tied = FLAT.filter(s => ties?.[s]);
  const flat = sums(FLAT.filter(s => !tied.includes(s)).map(s => aliveOf(dom[s])));
  const upTo = new Float64Array(flat.length);
  let run = 0;
  for (let t = 0; t < flat.length; t++) { run += flat[t]; upTo[t] = run; }
  const words = tied.map(s => maskWords(dom[s]));
  const memo = new Map();
  let total = 0;
  let spent = 0;
  for (const k of keys) {
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    if (!tied.length) {
      total += upTo[Math.min(room, flat.length - 1)];
      if (room < flat.length) spent += flat[room];
      continue;
    }
    let sig = `${room}`;
    for (let j = 0; j < tied.length; j++) {
      const t = ties[tied[j]];
      sig += `|${(t[2 * k] & words[j][0]) >>> 0},${t[2 * k + 1] & words[j][1]}`;
    }
    let got = memo.get(sig);
    if (!got) {
      const own = sums(tied.map((s, j) => wordValues((ties[s][2 * k] & words[j][0]) >>> 0, ties[s][2 * k + 1] & words[j][1])));
      got = [0, 0];
      for (let x = 0; x < own.length; x++) {
        if (!own[x] || x > room) continue;
        got[0] += own[x] * upTo[Math.min(room - x, upTo.length - 1)];
        if (room - x < flat.length) got[1] += own[x] * flat[room - x];
      }
      memo.set(sig, got);
    }
    total += got[0];
    spent += got[1];
  }
  return { total, spent };
}

export const maskKeys = (mask) => {
  const out = [];
  for (let k = 0; k < KEYS; k++) if (mask[k]) out.push(k);
  return out;
};

/** Signature shared by two keys whose ties allow the same flat values. */
function sigFor(k, ties, words) {
  let sig = '';
  for (let j = 0; j < FLAT.length; j++) {
    const t = ties?.[FLAT[j]];
    if (t) sig += `${(t[2 * k] & words[j][0]) >>> 0}.${t[2 * k + 1] & words[j][1]}|`;
    else sig += '-|';
  }
  return sig;
}

/**
 * The flat values each key allows - its domain, cut by any tie on that key -
 * as lists, with a signature that two keys allowing the same share.
 */
function listsFor(k, dom, ties, words) {
  const lists = {};
  let sig = '';
  for (const [j, s] of FLAT.entries()) {
    if (ties?.[s]) {
      const lo = (ties[s][2 * k] & words[j][0]) >>> 0;
      const hi = ties[s][2 * k + 1] & words[j][1];
      lists[s] = wordValues(lo, hi);
      sig += `${lo}.${hi}|`;
    } else {
      lists[s] = null;
      sig += '-|';
    }
  }
  return { lists, sig };
}

/** For each total of the three flat stats, the whole choices of them every pair tie allows. */
function pairedSums(lists, dom, pairs) {
  const vals = FLAT.map(s => lists[s] || aliveOf(dom[s]));
  const out = new Float64Array(3 * (SPAN - 1) + 1);
  const v = {};
  for (const x of vals[0]) {
    v.atk = x;
    for (const y of vals[1]) {
      v.spa = y;
      for (const z of vals[2]) {
        v.spe = z;
        if (pairsAllow(pairs, v)) out[x + y + z]++;
      }
    }
  }
  return out;
}

/** `spreadCount` with a pair tie: every key's own choices of the flat stats, enumerated. */
function pairedCount(keys, dom, ties) {
  const pairs = pairsOf(ties);
  const words = FLAT.map(s => maskWords(dom[s]));
  const memo = new Map();
  let total = 0;
  let spent = 0;
  for (const k of keys) {
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const sig = sigFor(k, ties, words);
    let by = memo.get(sig);
    if (!by) {
      const { lists } = listsFor(k, dom, ties, words);
      const at = pairedSums(lists, dom, pairs);
      const upTo = new Float64Array(at.length);
      let run = 0;
      for (let t = 0; t < at.length; t++) { run += at[t]; upTo[t] = run; }
      by = { at, upTo };
      memo.set(sig, by);
    }
    total += by.upTo[Math.min(room, by.upTo.length - 1)];
    if (room < by.at.length) spent += by.at[room];
  }
  return { total, spent };
}

/** The whole spreads left for one Pokemon, counted the way it is assumed to spend. */
export function spreadsLeft(kn, keys, dom) {
  if (kn.natures && keys === undefined && dom === undefined) {
    let sum = 0;
    for (const sub of kn.natures.values()) sum += spreadsLeft(sub);
    return sum;
  }
  const count = spreadCount(keys ?? maskKeys(kn.keys), dom ?? kn.dom, kn.ties);
  return kn.spent ? count.spent : count.total;
}

/**
 * Which values each stat takes across the whole spreads that survive, and which
 * HP-Defence and HP-Special Defence pairs do, each pair at HP times SPAN plus
 * the other. A value counts only if it fits the budget beside some surviving
 * choice for everything else - the rule `tighten` pushes through, read here
 * without moving anything.
 */
export function valuesOf(keys, dom, spent = false, ties = {}) {
  const values = Object.fromEntries(STAT_IDS.map(s => [s, new Uint8Array(SPAN)]));
  const grids = { def: new Uint8Array(SPAN * SPAN), spd: new Uint8Array(SPAN * SPAN) };
  const { keys: list, dom: flat } = supported(keys, dom, ties);
  if (!list.length || FLAT.some(s => !flat[s].includes(1))) return { values, grids };
  const fits = Object.keys(ties || {}).length ? tiedBudget(list, flat, ties, spent) : budgetTest(list, flat, spent);
  let any = false;
  for (const k of list) {
    if (!fits.key(k)) continue;
    any = true;
    values.hp[KEY_HP[k]] = 1;
    values.def[KEY_DEF[k]] = 1;
    values.spd[KEY_SPD[k]] = 1;
    grids.def[KEY_HP[k] * SPAN + KEY_DEF[k]] = 1;
    grids.spd[KEY_HP[k] * SPAN + KEY_SPD[k]] = 1;
  }
  if (!any) return { values, grids };
  for (const [j, s] of FLAT.entries()) for (const v of aliveOf(flat[s])) if (fits.flat[j](v)) values[s][v] = 1;
  return { values, grids };
}

/** `valuesOf` across every surviving nature of `kn`, or on `kn` directly when its nature is fixed. */
export function valuesOfKnowledge(kn) {
  if (!kn.natures) return valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties);
  const values = Object.fromEntries(STAT_IDS.map(s => [s, new Uint8Array(SPAN)]));
  const grids = { def: new Uint8Array(SPAN * SPAN), spd: new Uint8Array(SPAN * SPAN) };
  for (const sub of kn.natures.values()) {
    const got = valuesOf(maskKeys(sub.keys), sub.dom, sub.spent, sub.ties);
    for (const s of STAT_IDS) for (let v = 0; v < SPAN; v++) if (got.values[s][v]) values[s][v] = 1;
    for (const d of ['def', 'spd']) for (let i = 0; i < SPAN * SPAN; i++) if (got.grids[d][i]) grids[d][i] = 1;
  }
  return { values, grids };
}

/** Each stat's range across the whole spreads that survive, as `{ min, max }`, or null for a stat with nothing left. */
export function rangesOf(keys, dom, spent = false, ties = {}) {
  return rangesOfValues(valuesOf(keys, dom, spent, ties).values);
}

/** The ends of each stat's values from `valuesOf`. */
export function rangesOfValues(values) {
  const out = {};
  for (const s of STAT_IDS) {
    const alive = aliveOf(values[s]);
    out[s] = alive.length ? { min: alive[0], max: alive[alive.length - 1] } : null;
  }
  return out;
}

/** What survives for one Pokemon, as a range per stat plus the spread count. */
export function summarise(kn) {
  if (kn.natures) {
    let total = 0;
    let allSpent = 0;
    for (const sub of kn.natures.values()) {
      const c = spreadCount(maskKeys(sub.keys), sub.dom, sub.ties);
      total += c.total;
      allSpent += c.spent;
    }
    const { values } = valuesOfKnowledge(kn);
    const stats = {};
    for (const s of STAT_IDS) {
      const list = aliveOf(values[s]);
      stats[s] = list.length ? { min: list[0], max: list[list.length - 1], count: list.length } : null;
    }
    return { spreads: kn.spent ? allSpent : total, allSpent, stats };
  }
  const { keys, dom } = supported(maskKeys(kn.keys), kn.dom, kn.ties);
  const count = spreadCount(keys, dom, kn.ties);
  const seen = { hp: new Uint8Array(SPAN), def: new Uint8Array(SPAN), spd: new Uint8Array(SPAN) };
  for (const k of keys) { seen.hp[KEY_HP[k]] = 1; seen.def[KEY_DEF[k]] = 1; seen.spd[KEY_SPD[k]] = 1; }
  const stats = {};
  for (const s of STAT_IDS) {
    const values = aliveOf(FLAT.includes(s) ? dom[s] : seen[s]);
    stats[s] = values.length ? { min: values[0], max: values[values.length - 1], count: values.length } : null;
  }
  return { spreads: kn.spent ? count.spent : count.total, allSpent: count.spent, stats };
}

// ------------------------------------------------------------ the next guess

/** A first guess: bulk and the stat the nature boosts, the way most sets are built. */
export function defaultSpread(dex, set, hp) {
  const nature = dex.natures.get(set.nature || 'Serious');
  const base = dex.species.get(set.species || set.name).baseStats;
  const evs = { hp: Math.max(0, Math.min(32, hp ?? 32)), atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  let room = BUDGET - evs.hp;
  const put = (stat) => { const add = Math.max(0, Math.min(32 - evs[stat], room)); evs[stat] += add; room -= add; };
  put(nature.plus || (base.atk >= base.spa ? 'atk' : 'spa'));
  for (const stat of ['spe', 'def', 'spd', 'atk', 'spa']) if (stat !== nature.minus) put(stat);
  return evs;
}

const STEP = 1_000_000;

/**
 * Per-stat step cost for `closestSpread`: one `STEP` per Stat Point moved, plus
 * a tie-breaker so equal-distance moves shed unconstrained offensive stats
 * (`atk`, `spa`) before defences or Speed, and `hp` last.
 */
function statWeights(kn) {
  const pairs = pairsOf(kn.ties);
  const flatWidth = (s) => {
    let n = 0;
    for (let v = 0; v < SPAN; v++) n += kn.dom[s][v];
    const tied = Boolean(kn.ties?.[s]) || pairs.some(p => p.a === s || p.b === s);
    return tied && n === SPAN ? SPAN - 1 : n;
  };
  const seenHp = new Uint8Array(SPAN);
  const seenDef = new Uint8Array(SPAN);
  const seenSpd = new Uint8Array(SPAN);
  let floorHp = false;
  let floorDef = false;
  let floorSpd = false;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const hp = KEY_HP[k];
    const def = KEY_DEF[k];
    const spd = KEY_SPD[k];
    seenHp[hp] = 1;
    seenDef[def] = 1;
    seenSpd[spd] = 1;
    if (!kn.spent) {
      if (!floorHp && hp > 0 && !kn.keys[k - SPAN * SPAN]) floorHp = true;
      if (!floorDef && def > 0 && !kn.keys[k - SPAN]) floorDef = true;
      if (!floorSpd && spd > 0 && !kn.keys[k - 1]) floorSpd = true;
    }
  }
  const count = (arr) => { let n = 0; for (let v = 0; v < SPAN; v++) n += arr[v]; return n; };
  const wAtk = flatWidth('atk');
  const wSpa = flatWidth('spa');
  const wSpe = flatWidth('spe');
  const wHp = count(seenHp);
  const wDef = count(seenDef);
  const wSpd = count(seenSpd);
  if (kn.spent) {
    floorHp = wHp < SPAN;
    floorDef = wDef < SPAN;
    floorSpd = wSpd < SPAN;
  }
  return {
    atk: STEP + (wAtk < SPAN ? 10 + (SPAN - wAtk) * 2 : 2),
    spa: STEP + (wSpa < SPAN ? 11 + (SPAN - wSpa) * 2 : 3),
    def: STEP + (floorDef ? 300 + (SPAN - wDef) * 2 : 100),
    spd: STEP + (floorSpd ? 301 + (SPAN - wSpd) * 2 : 101),
    spe: STEP + (wSpe < SPAN ? 210 + (SPAN - wSpe) * 2 : 200),
    hp: STEP + (floorHp ? 500 + (SPAN - wHp) * 2 : 400),
  };
}

/** The surviving spread nearest `prev`, counting Stat Points moved. */
export function closestSpread(kn, prev) {
  if (kn.natures) {
    let best = null;
    for (const [n, sub] of kn.natures) {
      const cand = closestSpread(sub, prev);
      if (!cand) continue;
      const cost = STAT_IDS.reduce((t, s) => t + Math.abs(cand[s] - prev[s]), 0);
      const sameNat = prev?.nature && n === canonicalNatureName(prev.nature) ? 0 : 1;
      if (!best || cost < best.cost || (cost === best.cost && sameNat < best.sameNat)) {
        best = { cost, sameNat, spread: { ...cand, nature: n } };
      }
    }
    return best ? best.spread : null;
  }
  if (pairsOf(kn.ties).length) return closestPaired(kn, prev);
  if (FLAT.some(s => kn.ties?.[s])) return closestTied(kn, prev);
  const A = aliveOf(kn.dom.atk);
  const S = aliveOf(kn.dom.spa);
  const E = aliveOf(kn.dom.spe);
  if (!A.length || !S.length || !E.length) return null;
  const w = statWeights(kn);
  const best = new Array(3 * (SPAN - 1) + 1).fill(null);
  for (const a of A) {
    const ca = Math.abs(a - prev.atk) * w.atk;
    for (const s of S) {
      const cas = ca + Math.abs(s - prev.spa) * w.spa;
      for (const e of E) {
        const cost = cas + Math.abs(e - prev.spe) * w.spe;
        const sum = a + s + e;
        if (!best[sum] || cost < best[sum].cost) best[sum] = { cost, a, s, e };
      }
    }
  }
  const upTo = [];
  let run = null;
  for (let r = 0; r < best.length; r++) {
    if (best[r] && (!run || best[r].cost < run.cost)) run = best[r];
    upTo[r] = run;
  }
  let win = null;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const f = kn.spent ? best[room] : upTo[Math.min(room, upTo.length - 1)];
    if (!f) continue;
    const cost = Math.abs(KEY_HP[k] - prev.hp) * w.hp + Math.abs(KEY_DEF[k] - prev.def) * w.def + Math.abs(KEY_SPD[k] - prev.spd) * w.spd + f.cost;
    if (!win || cost < win.cost || (cost === win.cost && k > win.k)) win = { cost, k, f };
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.f.a, def: KEY_DEF[win.k], spa: win.f.s, spd: KEY_SPD[win.k], spe: win.f.e };
}

/** `closestSpread` where a tie lets each key keep its own values of a stat. */
function closestTied(kn, prev) {
  const w = statWeights(kn);
  const tied = FLAT.filter(s => kn.ties[s]);
  const free = FLAT.filter(s => !tied.includes(s));
  // The cheapest values of the untied stats for each exact total, and for each
  // total or less.
  let best = [{ cost: 0, vals: {} }];
  for (const s of free) {
    const values = aliveOf(kn.dom[s]);
    if (!values.length) return null;
    const next = [];
    best.forEach((b, t) => {
      if (!b) return;
      for (const v of values) {
        const cost = b.cost + Math.abs(v - prev[s]) * w[s];
        if (!next[t + v] || cost < next[t + v].cost) next[t + v] = { cost, vals: { ...b.vals, [s]: v } };
      }
    });
    best = next;
  }
  const upTo = [];
  let run = null;
  for (let r = 0; r <= 3 * (SPAN - 1); r++) {
    if (best[r] && (!run || best[r].cost < run.cost)) run = best[r];
    upTo[r] = run;
  }
  const words = tied.map(s => maskWords(kn.dom[s]));
  const memo = new Map();
  let win = null;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const keyCost = Math.abs(KEY_HP[k] - prev.hp) * w.hp + Math.abs(KEY_DEF[k] - prev.def) * w.def + Math.abs(KEY_SPD[k] - prev.spd) * w.spd;
    if (win && keyCost > win.cost) continue;
    let sig = `${room}`;
    let empty = false;
    for (let j = 0; j < tied.length; j++) {
      const t = kn.ties[tied[j]];
      const lo = (t[2 * k] & words[j][0]) >>> 0;
      const hi = t[2 * k + 1] & words[j][1];
      if (lo === 0 && (hi & 1) === 0) { empty = true; break; }
      sig += `|${lo},${hi}`;
    }
    if (empty) continue;
    let got = memo.get(sig);
    if (got === undefined) {
      const lists = tied.map((s, j) => wordValues((kn.ties[s][2 * k] & words[j][0]) >>> 0, kn.ties[s][2 * k + 1] & words[j][1]));
      got = null;
      const pick = (j, sum, cost, vals) => {
        if (j === tied.length) {
          const r = room - sum;
          if (r < 0) return;
          const f = kn.spent ? best[r] : upTo[Math.min(r, upTo.length - 1)];
          if (!f) return;
          const flatCost = cost + f.cost;
          if (!got || flatCost < got.cost) got = { cost: flatCost, vals: { ...vals, ...f.vals } };
          return;
        }
        for (const v of lists[j]) pick(j + 1, sum + v, cost + Math.abs(v - prev[tied[j]]) * w[tied[j]], { ...vals, [tied[j]]: v });
      };
      pick(0, 0, 0, {});
      memo.set(sig, got);
    }
    if (!got) continue;
    const total = keyCost + got.cost;
    if (!win || total < win.cost || (total === win.cost && k > win.k)) win = { cost: total, k, vals: got.vals };
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.vals.atk, def: KEY_DEF[win.k], spa: win.vals.spa, spd: KEY_SPD[win.k], spe: win.vals.spe };
}

/** `closestSpread` with a pair tie: the cheapest whole choice of flat values per total, per key. */
function closestPaired(kn, prev) {
  const w = statWeights(kn);
  const pairs = pairsOf(kn.ties);
  const words = FLAT.map(s => maskWords(kn.dom[s]));
  const memo = new Map();
  let win = null;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const keyCost = Math.abs(KEY_HP[k] - prev.hp) * w.hp + Math.abs(KEY_DEF[k] - prev.def) * w.def + Math.abs(KEY_SPD[k] - prev.spd) * w.spd;
    if (win && keyCost > win.cost) continue;
    const sig = sigFor(k, kn.ties, words);
    let best = memo.get(sig);
    if (!best) {
      const { lists } = listsFor(k, kn.dom, kn.ties, words);
      const vals = FLAT.map(s => lists[s] || aliveOf(kn.dom[s]));
      const at = [];
      const v = {};
      for (const x of vals[0]) {
        v.atk = x;
        const cx = Math.abs(x - prev.atk) * w.atk;
        for (const y of vals[1]) {
          v.spa = y;
          const cxy = cx + Math.abs(y - prev.spa) * w.spa;
          for (const z of vals[2]) {
            v.spe = z;
            if (!pairsAllow(pairs, v)) continue;
            const cost = cxy + Math.abs(z - prev.spe) * w.spe;
            if (!at[x + y + z] || cost < at[x + y + z].cost) at[x + y + z] = { cost, vals: { ...v } };
          }
        }
      }
      const upTo = [];
      let run = null;
      for (let r = 0; r <= 3 * (SPAN - 1); r++) {
        if (at[r] && (!run || at[r].cost < run.cost)) run = at[r];
        upTo[r] = run;
      }
      best = { at, upTo };
      memo.set(sig, best);
    }
    const f = kn.spent ? best.at[room] : best.upTo[Math.min(room, best.upTo.length - 1)];
    if (!f) continue;
    const total = keyCost + f.cost;
    if (!win || total < win.cost || (total === win.cost && k > win.k)) win = { cost: total, k, vals: f.vals };
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.vals.atk, def: KEY_DEF[win.k], spa: win.vals.spa, spd: KEY_SPD[win.k], spe: win.vals.spe };
}

export const sameSpread = (a, b) => STAT_IDS.every(s => a[s] === b[s]);


/**
 * Where to aim the next guess. The nearest survivor to a guess the evidence
 * just removed sits on the edge of what survives, where the next observation
 * is most likely to cut again - so a stat the evidence has narrowed aims at the
 * middle of its range, except a zero stat where zero still survives (whose top
 * end the 66-point budget alone can trim), and a stat nothing has touched keeps
 * the old value.
 */
export function aimFor(kn, prev, q = 0.5) {
  const seen = { hp: new Uint8Array(SPAN), def: new Uint8Array(SPAN), spd: new Uint8Array(SPAN) };
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    seen.hp[KEY_HP[k]] = 1;
    seen.def[KEY_DEF[k]] = 1;
    seen.spd[KEY_SPD[k]] = 1;
  }
  const aim = {};
  for (const s of STAT_IDS) {
    const mask = FLAT.includes(s) ? kn.dom[s] : seen[s];
    const values = aliveOf(mask);
    const at = (values.length - 1) * q;
    const i = q < 0.5 ? Math.floor(at) : q > 0.5 ? Math.ceil(at) : Math.round(at);
    const keepZero = prev[s] === 0 && mask[0] === 1 && q === 0.5;
    aim[s] = values.length && values.length < SPAN && !keepZero ? values[i] : prev[s];
  }
  return aim;
}

// ------------------------------------------------------------ one spread

/** Whether `evs` is one of the spreads `kn` still allows. */
export function containsSpread(kn, evs, nature = null) {
  if (kn.natures) {
    if (nature) {
      const sub = kn.natures.get(canonicalNatureName(nature));
      return !!sub && containsSpread(sub, evs);
    }
    for (const sub of kn.natures.values()) if (containsSpread(sub, evs)) return true;
    return false;
  }
  const e = fullEvs(evs);
  const sum = STAT_IDS.reduce((t, x) => t + e[x], 0);
  if (kn.spent ? sum !== BUDGET : sum > BUDGET) return false;
  const k = keyOf(e.hp, e.def, e.spd);
  return kn.keys[k] === 1
    && FLAT.every(x => kn.dom[x][e[x]] === 1 && (!kn.ties?.[x] || tieHas(kn.ties[x], k, e[x])))
    && pairsAllow(pairsOf(kn.ties), e);
}

/** A copy of `kn` with `stat` held at `value`, and the budget and ties pushed through. */
export function restrictKnowledge(kn, stat, value) {
  const at = cloneKnowledge(new Map([['x', kn]])).get('x');
  if (at.natures) {
    for (const sub of at.natures.values()) {
      if (FLAT.includes(stat)) {
        const keep = sub.dom[stat][value];
        sub.dom[stat].fill(0);
        sub.dom[stat][value] = keep;
      } else {
        const of = { hp: KEY_HP, def: KEY_DEF, spd: KEY_SPD }[stat];
        for (let k = 0; k < KEYS; k++) if (of[k] !== value) sub.keys[k] = 0;
      }
      tightenSingle(sub);
    }
    syncKnowledge(at);
    return at;
  }
  if (FLAT.includes(stat)) {
    at.dom[stat].fill(0);
    at.dom[stat][value] = kn.dom[stat][value];
  } else {
    const of = { hp: KEY_HP, def: KEY_DEF, spd: KEY_SPD }[stat];
    for (let k = 0; k < KEYS; k++) if (of[k] !== value) at.keys[k] = 0;
  }
  tighten(at);
  return at;
}

/**
 * A surviving spread with `stat` at `value`, the rest as near `prev` as the
 * knowledge allows - or null when none survives there.
 */
export function spreadAt(kn, stat, value, prev) {
  return closestSpread(restrictKnowledge(kn, stat, value), { ...prev, [stat]: value });
}

const OFFENSIVE = ['atk', 'spa', 'spe'];

/**
 * The spread the Stat Point sliders open on, inside what survives: the most the
 * nature's raised stat can have, then the most HP beside it, then the most a
 * third stat can have - the weaker of Defence and Special Defence when the
 * raised stat is Attack, Special Attack or Speed, the stronger of Attack and
 * Special Attack when it is a defence. A neutral nature starts from the
 * stronger attacking stat. The other stats then take the most they can,
 * highest base stat first and the nature's lowered stat last.
 */
export function typicalSpread(kn, baseStats, nature = {}) {
  const stronger = baseStats.atk >= baseStats.spa ? 'atk' : 'spa';
  const weaker = baseStats.def <= baseStats.spd ? 'def' : 'spd';
  const first = nature.plus || stronger;
  const order = [first, 'hp', OFFENSIVE.includes(first) ? weaker : stronger];
  const rest = STAT_IDS.filter(s => !order.includes(s))
    .sort((a, b) => (a === nature.minus) - (b === nature.minus) || baseStats[b] - baseStats[a]);
  let at = kn;
  const out = {};
  for (const stat of [...order, ...rest]) {
    const alive = aliveOf(valuesOfKnowledge(at).values[stat]);
    if (!alive.length) return null;
    out[stat] = alive[alive.length - 1];
    at = restrictKnowledge(at, stat, out[stat]);
  }
  return out;
}

// ------------------------------------------------------------ in a recording

const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (text) => {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

/** A 0/1 array as base64, eight to a byte. */
export function packBits(mask) {
  const out = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[i >> 3] |= 1 << (i & 7);
  return toBase64(out);
}

export function unpackBits(text, length) {
  const bytes = fromBase64(text);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

/**
 * What is known about one Pokemon as JSON a recording can carry: the keys, the
 * flat domains and each pair tie as bits, and each key tie as the distinct
 * words it holds with, per alive key in order, which one that key has.
 */
function packSingleKnowledge(kn) {
  const alive = maskKeys(kn.keys);
  const ties = {};
  for (const [name, tie] of Object.entries(kn.ties || {})) {
    if (name.includes('|')) { ties[name] = packBits(tie); continue; }
    const words = [];
    const seen = new Map();
    const at = new Uint16Array(alive.length);
    alive.forEach((k, i) => {
      const sig = `${tie[2 * k]}.${tie[2 * k + 1]}`;
      if (!seen.has(sig)) { seen.set(sig, words.length); words.push([tie[2 * k], tie[2 * k + 1]]); }
      at[i] = seen.get(sig);
    });
    ties[name] = { words, at: toBase64(new Uint8Array(at.buffer)) };
  }
  return { spent: kn.spent, keys: packBits(kn.keys), dom: Object.fromEntries(FLAT.map(s => [s, packBits(kn.dom[s])])), ties };
}

export function packKnowledge(kn) {
  const base = packSingleKnowledge(kn);
  if (!kn.natures) return base;
  const natures = {};
  for (const [n, sub] of kn.natures) {
    if (sub.keys.includes(1) && FLAT.every(s => sub.dom[s].includes(1))) natures[n] = packSingleKnowledge(sub);
  }
  return { ...base, natures };
}

function unpackSingleKnowledge(packed) {
  const keys = unpackBits(packed.keys, KEYS);
  const alive = maskKeys(keys);
  const ties = {};
  for (const [name, t] of Object.entries(packed.ties || {})) {
    if (name.includes('|')) { ties[name] = unpackBits(t, SPAN * SPAN); continue; }
    const raw = fromBase64(t.at);
    const at = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    const tie = newTie();
    alive.forEach((k, i) => { [tie[2 * k], tie[2 * k + 1]] = t.words[at[i]]; });
    ties[name] = tie;
  }
  const dom = Object.fromEntries(FLAT.map(s => [s, unpackBits(packed.dom[s], SPAN)]));
  return { known: false, spent: !!packed.spent, keys, dom, ties };
}

export function unpackKnowledge(packed) {
  const base = unpackSingleKnowledge(packed);
  if (packed.natures && typeof packed.natures === 'object') {
    base.natures = new Map(Object.entries(packed.natures).map(([n, p]) => [n, { ...unpackSingleKnowledge(p), nature: n }]));
  }
  return base;
}
