/**
 * `isDeepStrictEqual`, which `sim/dex-species.ts` uses to let a modded species
 * reuse its parent's object when the two are identical. Same rules as Node's:
 * same prototype, same own enumerable keys, values equal all the way down.
 */

export function isDeepStrictEqual(a, b, seen = new Map()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map || a instanceof Set) {
    if (a.size !== b.size) return false;
    const other = [...b.entries()];
    return [...a.entries()].every(([k, v], i) => (
      isDeepStrictEqual(k, other[i][0], seen) && isDeepStrictEqual(v, other[i][1], seen)
    ));
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!isDeepStrictEqual(a[k], b[k], seen)) return false;
  }
  return true;
}

export default { isDeepStrictEqual };
