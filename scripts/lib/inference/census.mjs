/**
 * The census: what an inference did, counted rather than timed - the same on
 * every machine and nearly free, so `npm run score` keeps it in every record
 * and `--census` prints it. Each count names a unit of work and, where a
 * shortcut declined, why: damage rows run, the row slots a hit's classes have
 * and how many were computed, the HP states a hit merged into classes or could
 * not, the passes each caller of a settle asked for and how many moved
 * nothing, the probes each turn's dice search spent and whether it solved the
 * turn, the lines the evidence set aside and why; and the simulator events
 * each kind of work cost. Work that produced nothing, or shortcuts that
 * declined for one reason, show here, where a profile only shows where time
 * went. Nothing decides anything by it. Kinds nest: a settle's events hold its
 * passes', and a pass's hold its damage rows'.
 *
 * Counts belong to the thread they are made on: a start another thread ran
 * ahead and the inference took (`charge` in `infer.mjs`) is not in them.
 */

const counts = new Map();
let hits = [];
const HITS = 5;
let events = () => 0;

/** Where the simulator's event count is read (`infer.mjs` owns the meter). */
export const useEvents = (read) => { events = read; };
export const eventsNow = () => events();

export function count(key, n = 1) {
  if (n) counts.set(key, (counts.get(key) || 0) + n);
}

/** `fn`, with the simulator events it cost counted under `key events`. */
export function costing(key, fn) {
  const from = events();
  try { return fn(); } finally { count(`${key} events`, events() - from); }
}

/** A hit and the row slots its classes span: the biggest few are kept. */
export function bigHit(what, slots, dims) {
  if (hits.length >= HITS && slots <= hits[hits.length - 1].slots) return;
  hits.push({ what, slots, dims });
  hits.sort((a, b) => b.slots - a.slots);
  if (hits.length > HITS) hits.length = HITS;
}

/** Start over: an inference that is not inside another. */
export function clearCensus() {
  counts.clear();
  hits = [];
}

export function takeCensus() {
  return { counts: Object.fromEntries([...counts].sort((a, b) => a[0].localeCompare(b[0]))), hits: hits.slice() };
}
