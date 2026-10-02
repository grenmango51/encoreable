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

export function freshKnowledge(set, known, spent = false) {
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

export function cloneKnowledge(map) {
  const out = new Map();
  for (const [id, kn] of map) {
    out.set(id, {
      known: kn.known,
      spent: kn.spent,
      keys: kn.keys.slice(),
      dom: { atk: kn.dom.atk.slice(), spa: kn.dom.spa.slice(), spe: kn.dom.spe.slice() },
      ties: cloneTies(kn.ties),
    });
  }
  return out;
}

export function pinKnowledge(kn, evs) {
  const e = fullEvs(evs);
  kn.keys.fill(0);
  kn.keys[keyOf(e.hp, e.def, e.spd)] = 1;
  for (const s of FLAT) { kn.dom[s].fill(0); kn.dom[s][e[s]] = 1; }
  kn.ties = {};
}

/** Narrow `kn` to what a pass left alive. Returns whether anything moved. */
export function intersectKnowledge(kn, keys, flat, ties = {}) {
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
 * Every spread `other` leaves added to `kn`, a stat at a time: it holds every
 * spread either leaves, and can hold more. A tie either holds is kept, as what
 * each key allows in one or the other.
 */
export function uniteKnowledge(kn, other) {
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
 * The 66-point budget and the ties, pushed through every stat: a value that
 * cannot fit beside any surviving choice for everything else is gone.
 */
export function tighten(kn) {
  let moved = false;
  for (let round = 0; round < 8; round++) {
    if (!kn.keys.includes(1) || FLAT.some(s => !kn.dom[s].includes(1))) {
      const any = kn.keys.includes(1) || FLAT.some(s => kn.dom[s].includes(1));
      kn.keys.fill(0);
      for (const s of FLAT) kn.dom[s].fill(0);
      return moved || any;
    }
    let changed = false;
    if (Object.keys(kn.ties || {}).length) {
      const sup = supported(maskKeys(kn.keys), kn.dom, kn.ties);
      const keep = new Uint8Array(KEYS);
      for (const k of sup.keys) keep[k] = 1;
      for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !keep[k]) { kn.keys[k] = 0; changed = true; }
      for (const s of FLAT) {
        for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !sup.dom[s][v]) { kn.dom[s][v] = 0; changed = true; }
      }
      if (changed) { moved = true; continue; }
    }
    const fits = budgetTest(maskKeys(kn.keys), kn.dom, kn.spent);
    for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !fits.key(k)) { kn.keys[k] = 0; changed = true; }
    for (const [j, s] of FLAT.entries()) {
      for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !fits.flat[j](v)) { kn.dom[s][v] = 0; changed = true; }
    }
    if (!changed) break;
    moved = true;
  }
  return moved;
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
    const allowed = tied.map((s, j) => [(ties[s][2 * k] & words[j][0]) >>> 0, ties[s][2 * k + 1] & words[j][1]]);
    const sig = `${room}|${allowed.join('|')}`;
    let got = memo.get(sig);
    if (!got) {
      const own = sums(allowed.map(([lo, hi]) => wordValues(lo, hi)));
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

/** The whole spreads left for one Pokemon, counted the way it is assumed to spend. */
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
    const { lists, sig } = listsFor(k, dom, ties, words);
    let by = memo.get(sig);
    if (!by) {
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

export function spreadsLeft(kn, keys = maskKeys(kn.keys), dom = kn.dom) {
  const count = spreadCount(keys, dom, kn.ties);
  return kn.spent ? count.spent : count.total;
}

/**
 * Each stat's range across the whole spreads that survive, as `{ min, max }`, or
 * null for a stat with nothing left. A value counts only if it fits the budget
 * beside some surviving choice for everything else - the rule `tighten` pushes
 * through, read here without moving anything.
 */
export function rangesOf(keys, dom, spent = false, ties = {}) {
  const out = Object.fromEntries(STAT_IDS.map(s => [s, null]));
  const { keys: list, dom: flat } = supported(keys, dom, ties);
  if (!list.length || FLAT.some(s => !flat[s].includes(1))) return out;
  const fits = budgetTest(list, flat, spent);
  const lo = { hp: SPAN, def: SPAN, spd: SPAN };
  const hi = { hp: -1, def: -1, spd: -1 };
  for (const k of list) {
    if (!fits.key(k)) continue;
    lo.hp = Math.min(lo.hp, KEY_HP[k]); hi.hp = Math.max(hi.hp, KEY_HP[k]);
    lo.def = Math.min(lo.def, KEY_DEF[k]); hi.def = Math.max(hi.def, KEY_DEF[k]);
    lo.spd = Math.min(lo.spd, KEY_SPD[k]); hi.spd = Math.max(hi.spd, KEY_SPD[k]);
  }
  if (hi.hp < 0) return out;
  for (const s of ['hp', 'def', 'spd']) out[s] = { min: lo[s], max: hi[s] };
  for (const [j, s] of FLAT.entries()) {
    const values = aliveOf(flat[s]).filter(fits.flat[j]);
    if (values.length) out[s] = { min: values[0], max: values[values.length - 1] };
  }
  return out;
}

/** What survives for one Pokemon, as a range per stat plus the spread count. */
export function summarise(kn) {
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

/** The surviving spread nearest `prev`, counting Stat Points moved. */
export function closestSpread(kn, prev) {
  if (pairsOf(kn.ties).length) return closestPaired(kn, prev);
  if (FLAT.some(s => kn.ties?.[s])) return closestTied(kn, prev);
  const A = aliveOf(kn.dom.atk);
  const S = aliveOf(kn.dom.spa);
  const E = aliveOf(kn.dom.spe);
  if (!A.length || !S.length || !E.length) return null;
  const best = new Array(3 * (SPAN - 1) + 1).fill(null);
  for (const a of A) {
    for (const s of S) {
      for (const e of E) {
        const cost = Math.abs(a - prev.atk) + Math.abs(s - prev.spa) + Math.abs(e - prev.spe);
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
    const cost = Math.abs(KEY_HP[k] - prev.hp) + Math.abs(KEY_DEF[k] - prev.def) + Math.abs(KEY_SPD[k] - prev.spd) + f.cost;
    if (!win || cost < win.cost) win = { cost, k, f };
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.f.a, def: KEY_DEF[win.k], spa: win.f.s, spd: KEY_SPD[win.k], spe: win.f.e };
}

/** `closestSpread` where a tie lets each key keep its own values of a stat. */
function closestTied(kn, prev) {
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
        const cost = b.cost + Math.abs(v - prev[s]);
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
  let win = null;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const keyCost = Math.abs(KEY_HP[k] - prev.hp) + Math.abs(KEY_DEF[k] - prev.def) + Math.abs(KEY_SPD[k] - prev.spd);
    if (win && keyCost >= win.cost) continue;
    const lists = tied.map((s, j) => wordValues((kn.ties[s][2 * k] & words[j][0]) >>> 0, kn.ties[s][2 * k + 1] & words[j][1]));
    if (lists.some(l => !l.length)) continue;
    const pick = (j, sum, cost, vals) => {
      if (j === tied.length) {
        const r = room - sum;
        if (r < 0) return;
        const f = kn.spent ? best[r] : upTo[Math.min(r, upTo.length - 1)];
        if (!f) return;
        const total = keyCost + cost + f.cost;
        if (!win || total < win.cost) win = { cost: total, k, vals: { ...vals, ...f.vals } };
        return;
      }
      for (const v of lists[j]) pick(j + 1, sum + v, cost + Math.abs(v - prev[tied[j]]), { ...vals, [tied[j]]: v });
    };
    pick(0, 0, 0, {});
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.vals.atk, def: KEY_DEF[win.k], spa: win.vals.spa, spd: KEY_SPD[win.k], spe: win.vals.spe };
}

/** `closestSpread` with a pair tie: the cheapest whole choice of flat values per total, per key. */
function closestPaired(kn, prev) {
  const pairs = pairsOf(kn.ties);
  const words = FLAT.map(s => maskWords(kn.dom[s]));
  const memo = new Map();
  let win = null;
  for (let k = 0; k < KEYS; k++) {
    if (!kn.keys[k]) continue;
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    const keyCost = Math.abs(KEY_HP[k] - prev.hp) + Math.abs(KEY_DEF[k] - prev.def) + Math.abs(KEY_SPD[k] - prev.spd);
    if (win && keyCost >= win.cost) continue;
    const { lists, sig } = listsFor(k, kn.dom, kn.ties, words);
    let best = memo.get(sig);
    if (!best) {
      const vals = FLAT.map(s => lists[s] || aliveOf(kn.dom[s]));
      const at = [];
      const v = {};
      for (const x of vals[0]) {
        v.atk = x;
        for (const y of vals[1]) {
          v.spa = y;
          for (const z of vals[2]) {
            v.spe = z;
            if (!pairsAllow(pairs, v)) continue;
            const cost = Math.abs(x - prev.atk) + Math.abs(y - prev.spa) + Math.abs(z - prev.spe);
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
    if (!win || keyCost + f.cost < win.cost) win = { cost: keyCost + f.cost, k, vals: f.vals };
  }
  if (!win) return null;
  return { hp: KEY_HP[win.k], atk: win.vals.atk, def: KEY_DEF[win.k], spa: win.vals.spa, spd: KEY_SPD[win.k], spe: win.vals.spe };
}

export const sameSpread = (a, b) => STAT_IDS.every(s => a[s] === b[s]);


/**
 * Where to aim the next guess. The nearest survivor to a guess the evidence
 * just removed sits on the edge of what survives, where the next observation
 * is most likely to cut again - so a stat the evidence has narrowed aims at the
 * middle of its range, and a stat nothing has touched keeps the old value.
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
    const values = aliveOf(FLAT.includes(s) ? kn.dom[s] : seen[s]);
    aim[s] = values.length && values.length < SPAN ? values[Math.floor((values.length - 1) * q + 0.5)] : prev[s];
  }
  return aim;
}
