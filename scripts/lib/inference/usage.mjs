/**
 * What people run, as a prior: Smogon's count of every spread by species and
 * nature (`scripts/fixtures/usage-spreads.json`, passed in by the caller, so the
 * extension can do without). A prior only orders what the replay still allows
 * and picks where a search starts; it never removes a spread.
 */

/** The species a set is counted under: a Mega forme by the species it evolves from. */
function countedAs(dex, set) {
  const given = dex.species.get(set.species || set.name);
  const from = Array.isArray(given.battleOnly) ? given.battleOnly[0] : given.battleOnly;
  return from && given.requiredItem ? from : given.name;
}

/**
 * The spreads people run with this set's species and nature - or across every
 * nature when the set's nature is unknown - most run first.
 */
export function usualSpreads(usage, dex, set) {
  if (!usage) return [];
  const rows = usage[countedAs(dex, set)] || [];
  const matching = set.nature ? rows.filter(([n]) => n === set.nature) : rows;
  return matching.map(([n, sp, weight]) => {
    const v = sp.split('/').map(Number);
    const data = dex.natures.get(n);
    const nature = data.exists && data.plus ? data.name : 'Serious';
    return {
      evs: { hp: v[0], atk: v[1], def: v[2], spa: v[3], spd: v[4], spe: v[5] },
      ...(set.nature ? {} : { nature }),
      weight,
    };
  });
}

/**
 * Every distinct nature class for `dex`, ordered by how often people run it on
 * this species when `usage` is given, else `'Serious'` first and then the
 * natures boosting this species' higher base stats.
 */
export function orderedNatures(usage, dex, set) {
  const classes = ['Serious', ...dex.natures.all().filter(n => n.exists && n.plus).map(n => n.name)];
  const weights = new Map();
  if (usage) {
    for (const [n, , weight] of usage[countedAs(dex, set)] || []) {
      const data = dex.natures.get(n);
      const canonical = data.exists && data.plus ? data.name : 'Serious';
      weights.set(canonical, (weights.get(canonical) || 0) + weight);
    }
  }
  const base = dex.species.get(set.species || set.name).baseStats;
  const statScore = (n) => {
    const data = dex.natures.get(n);
    if (!data.plus) return 1e6; // 'Serious' first when no usage distinguishes
    return (base[data.plus] || 0) * 100 - (base[data.minus] || 0);
  };
  return classes.slice().sort((a, b) => (weights.get(b) || 0) - (weights.get(a) || 0)
    || statScore(b) - statScore(a)
    || a.localeCompare(b));
}

/**
 * The spreads people run that a Pokemon can still have, most run first, each
 * with its share of them; and the share of all the spreads people run with its
 * species and nature that are still possible.
 */
export function likelySpreads(usual, contains) {
  const total = usual.reduce((t, u) => t + u.weight, 0);
  const alive = usual.filter(u => contains(u.evs, u.nature));
  const left = alive.reduce((t, u) => t + u.weight, 0);
  return {
    likely: alive.map(u => ({ evs: u.evs, ...(u.nature ? { nature: u.nature } : {}), share: u.weight / left })),
    covered: total ? left / total : 0,
  };
}
