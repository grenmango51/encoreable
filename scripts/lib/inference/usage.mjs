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

/** The spreads people run with this set's species and nature, most run first. */
export function usualSpreads(usage, dex, set) {
  if (!usage) return [];
  const nature = set.nature || 'Serious';
  return (usage[countedAs(dex, set)] || [])
    .filter(([n]) => n === nature)
    .map(([, sp, weight]) => {
      const v = sp.split('/').map(Number);
      return { evs: { hp: v[0], atk: v[1], def: v[2], spa: v[3], spd: v[4], spe: v[5] }, weight };
    });
}

/**
 * The spreads people run that a Pokemon can still have, most run first, each
 * with its share of them; and the share of all the spreads people run with its
 * species and nature that are still possible.
 */
export function likelySpreads(usual, contains) {
  const total = usual.reduce((t, u) => t + u.weight, 0);
  const alive = usual.filter(u => contains(u.evs));
  const left = alive.reduce((t, u) => t + u.weight, 0);
  return {
    likely: alive.map(u => ({ evs: u.evs, share: u.weight / left })),
    covered: total ? left / total : 0,
  };
}
