/**
 * Per-draw RNG control for a running battle.
 *
 * Every random decision in a battle is one `prng.rng.next()` call:
 *
 *   accuracy    randomChance(accuracy, 100)        battle-actions.ts:738   hitStepAccuracy
 *   crit        randomChance(1, critMult[ratio])   battle-actions.ts:1641  getDamage
 *   damage      random(16)                         battle.ts:2390          randomizer
 *   secondary   random(100)                        battle-actions.ts:1343  secondaries
 *   selfboost   random(100)                        battle-actions.ts:1325  selfDrops
 *
 * and `randomChance(n, d)` is just `random(d) < n` (prng.ts:116).
 *
 * This module swaps `battle.prng.rng` for a scripted source that ALWAYS draws
 * from the real RNG - so the stream stays aligned and no unrelated decision
 * shifts - and substitutes its own 32-bit value only for the draws named in the
 * plan. Which draw is which is established by wrapping the five call sites above
 * to declare a "zone", plus a denominator filter, so an unrelated draw inside the
 * same function cannot be hijacked.
 *
 * The simulator computes every consequence itself. Nothing here writes damage,
 * sets a status, or decides a hit.
 */

const POW32 = 2 ** 32;

// The extreme draws are useful because they force a known outcome without
// knowing the denominator: raw 0 always yields 0, raw POW32-1 always yields d-1.
const MIN_DRAW = 0;
const MAX_DRAW = POW32 - 1;

/** Raw value that makes `random(denominator)` return exactly `value`. */
function rawFor(value, denominator) {
  return Math.floor((value + 0.5) * POW32 / denominator);
}

const KINDS = {
  accuracy: {
    denominator: d => d === 100,
    // miss needs random(100) >= accuracy; hit needs < accuracy
    raw: want => (want === 'miss' ? MAX_DRAW : MIN_DRAW),
    describe: want => (want === 'miss' ? 'miss' : 'hit'),
  },
  crit: {
    denominator: d => d >= 1 && d <= 24,
    // crit needs random(critMult) < 1, i.e. exactly 0
    raw: want => (want ? MIN_DRAW : MAX_DRAW),
    describe: want => (want ? 'critical hit' : 'no crit'),
  },
  damage: {
    denominator: d => d === 16,
    raw: want => rawFor(want, 16),
    describe: want => `damage roll ${want}`,
  },
  secondary: {
    denominator: d => d === 100,
    raw: want => (want === 'proc' ? MIN_DRAW : MAX_DRAW),
    describe: want => (want === 'proc' ? 'secondary fires' : 'secondary skipped'),
  },
  selfboost: {
    denominator: d => d === 100,
    raw: want => (want === 'proc' ? MIN_DRAW : MAX_DRAW),
    describe: want => (want === 'proc' ? 'self-boost fires' : 'self-boost skipped'),
  },
};

/**
 * @param battle a live Battle, already constructed by `>start`
 * @param plan   [{ kind, move, nth = 1, want }]
 * @returns { applied, plan, unmatched() }
 */
export function attachRngControl(battle, plan = []) {
  for (const step of plan) {
    if (!KINDS[step.kind]) throw new Error(`unknown draw kind "${step.kind}"`);
  }

  const remaining = plan.map((step, i) => ({ ...step, nth: step.nth ?? 1, id: i, done: false }));
  const applied = [];
  const counts = new Map();

  // --- which call site are we inside, and for which move ---------------------
  const zones = [];
  const zone = () => zones[zones.length - 1] ?? null;
  const inZone = (kind, moveId, fn) => {
    zones.push({ kind, moveId });
    try {
      return fn();
    } finally {
      zones.pop();
    }
  };

  // --- the scripted RNG -----------------------------------------------------
  let denominator = null;   // set by the prng.random wrapper, read by next()
  const realRng = battle.prng.rng;

  battle.prng.rng = {
    getSeed: () => realRng.getSeed(),
    next: () => {
      const real = realRng.next();      // always draw, so the stream stays aligned
      const z = zone();
      if (!z || denominator === null) return real;

      const kind = KINDS[z.kind];
      if (!kind.denominator(denominator)) return real;

      const key = `${z.kind}:${z.moveId}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);

      const step = remaining.find(s => (
        !s.done && s.kind === z.kind && s.nth === n &&
        (!s.move || s.move === z.moveId)
      ));
      if (!step) return real;

      step.done = true;
      applied.push({
        kind: z.kind,
        move: z.moveId,
        nth: n,
        want: step.want,
        description: kind.describe(step.want),
        turn: battle.turn,
      });
      return kind.raw(step.want, denominator);
    },
  };

  // `random(from, to)` calls `rng.next()` before it knows anything, so the
  // denominator has to be captured on the way in.
  const realRandom = battle.prng.random.bind(battle.prng);
  battle.prng.random = (from, to) => {
    const previous = denominator;
    denominator = (to === undefined) ? from : null;
    try {
      return realRandom(from, to);
    } finally {
      denominator = previous;
    }
  };

  // --- declare the zones ----------------------------------------------------
  const actions = battle.actions;

  const originalAccuracy = actions.hitStepAccuracy;
  actions.hitStepAccuracy = function (targets, pokemon, move) {
    return inZone('accuracy', move?.id, () => originalAccuracy.call(this, targets, pokemon, move));
  };

  const originalGetDamage = actions.getDamage;
  actions.getDamage = function (source, target, move, suppressMessages) {
    const id = typeof move === 'string' ? move : move?.id;
    return inZone('crit', id, () => originalGetDamage.call(this, source, target, move, suppressMessages));
  };

  const originalSecondaries = actions.secondaries;
  actions.secondaries = function (targets, source, move, moveData, isSelf) {
    return inZone('secondary', move?.id, () => originalSecondaries.call(this, targets, source, move, moveData, isSelf));
  };

  const originalSelfDrops = actions.selfDrops;
  actions.selfDrops = function (targets, source, move, moveData, isSecondary) {
    return inZone('selfboost', move?.id, () => originalSelfDrops.call(this, targets, source, move, moveData, isSecondary));
  };

  // `randomizer` runs inside `getDamage`, after the crit draw, so it pushes a
  // more specific zone on top rather than replacing it.
  const originalRandomizer = battle.randomizer;
  battle.randomizer = function (baseDamage) {
    const z = zone();
    return inZone('damage', z?.moveId, () => originalRandomizer.call(this, baseDamage));
  };

  return {
    applied,
    unmatched: () => remaining.filter(s => !s.done),
  };
}
