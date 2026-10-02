/**
 * What is known about each Pokemon's Stat Points: every spread still possible.
 *
 * A spread is six numbers, 0-32 each, at most 66 together. HP, Defence and
 * Special Defence are one joint key, because they are what decides the HP a
 * Pokemon is left on; Attack, Special Attack and Speed are flat domains. This
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
  return { known, spent: !known && spent, keys, dom };
}

export function cloneKnowledge(map) {
  const out = new Map();
  for (const [id, kn] of map) {
    out.set(id, {
      known: kn.known,
      spent: kn.spent,
      keys: kn.keys.slice(),
      dom: { atk: kn.dom.atk.slice(), spa: kn.dom.spa.slice(), spe: kn.dom.spe.slice() },
    });
  }
  return out;
}

export function pinKnowledge(kn, evs) {
  const e = fullEvs(evs);
  kn.keys.fill(0);
  kn.keys[keyOf(e.hp, e.def, e.spd)] = 1;
  for (const s of FLAT) { kn.dom[s].fill(0); kn.dom[s][e[s]] = 1; }
}

/** Narrow `kn` to what a pass left alive. Returns whether anything moved. */
export function intersectKnowledge(kn, keys, flat) {
  let moved = false;
  const keep = new Uint8Array(KEYS);
  for (const k of keys) keep[k] = 1;
  for (let k = 0; k < KEYS; k++) if (kn.keys[k] && !keep[k]) { kn.keys[k] = 0; moved = true; }
  for (const s of FLAT) {
    for (let v = 0; v < SPAN; v++) if (kn.dom[s][v] && !flat[s][v]) { kn.dom[s][v] = 0; moved = true; }
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
 * The 66-point budget, pushed through every stat: a value that cannot fit beside
 * any surviving choice for everything else is gone.
 */
/**
 * Every spread `other` leaves added to `kn`, a stat at a time: it holds every
 * spread either leaves, and can hold more.
 */
export function uniteKnowledge(kn, other) {
  for (let k = 0; k < KEYS; k++) if (other.keys[k]) kn.keys[k] = 1;
  for (const s of FLAT) for (let v = 0; v < SPAN; v++) if (other.dom[s][v]) kn.dom[s][v] = 1;
}

export function tighten(kn) {
  let moved = false;
  for (let round = 0; round < 8; round++) {
    if (!kn.keys.includes(1) || FLAT.some(s => !kn.dom[s].includes(1))) {
      const any = kn.keys.includes(1) || FLAT.some(s => kn.dom[s].includes(1));
      kn.keys.fill(0);
      for (const s of FLAT) kn.dom[s].fill(0);
      return moved || any;
    }
    const fits = budgetTest(maskKeys(kn.keys), kn.dom, kn.spent);
    let changed = false;
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
 * How many whole spreads survive: every alive (hp, def, spd) beside every alive
 * (atk, spa, spe) that fits the budget. `spent` counts the ones using all 66.
 */
export function spreadCount(keys, dom) {
  const a = aliveOf(dom.atk);
  const s = aliveOf(dom.spa);
  const e = aliveOf(dom.spe);
  const pair = new Float64Array(2 * (SPAN - 1) + 1);
  for (const x of a) for (const y of s) pair[x + y]++;
  const flat = new Float64Array(3 * (SPAN - 1) + 1);
  for (let t = 0; t < pair.length; t++) if (pair[t]) for (const z of e) flat[t + z] += pair[t];
  const upTo = new Float64Array(flat.length);
  let run = 0;
  for (let t = 0; t < flat.length; t++) { run += flat[t]; upTo[t] = run; }
  let total = 0;
  let spent = 0;
  for (const k of keys) {
    const room = BUDGET - KEY_SUM[k];
    if (room < 0) continue;
    total += upTo[Math.min(room, flat.length - 1)];
    if (room < flat.length) spent += flat[room];
  }
  return { total, spent };
}

export const maskKeys = (mask) => {
  const out = [];
  for (let k = 0; k < KEYS; k++) if (mask[k]) out.push(k);
  return out;
};

/** The whole spreads left for one Pokemon, counted the way it is assumed to spend. */
export function spreadsLeft(kn, keys = maskKeys(kn.keys), dom = kn.dom) {
  const count = spreadCount(keys, dom);
  return kn.spent ? count.spent : count.total;
}

/**
 * Each stat's range across the whole spreads that survive, as `{ min, max }`, or
 * null for a stat with nothing left. A value counts only if it fits the budget
 * beside some surviving choice for everything else - the rule `tighten` pushes
 * through, read here without moving anything.
 */
export function rangesOf(keys, flat, spent = false) {
  const out = Object.fromEntries(STAT_IDS.map(s => [s, null]));
  const list = Array.isArray(keys) ? keys : [...keys];
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
  const keys = maskKeys(kn.keys);
  const count = spreadCount(keys, kn.dom);
  const seen = { hp: new Uint8Array(SPAN), def: new Uint8Array(SPAN), spd: new Uint8Array(SPAN) };
  for (const k of keys) { seen.hp[KEY_HP[k]] = 1; seen.def[KEY_DEF[k]] = 1; seen.spd[KEY_SPD[k]] = 1; }
  const stats = {};
  for (const s of STAT_IDS) {
    const values = aliveOf(FLAT.includes(s) ? kn.dom[s] : seen[s]);
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
