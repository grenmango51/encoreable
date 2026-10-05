/** `os.cpus`, for the worker count `scripts/lib/reconstruct.mjs` picks. */

export function cpus() {
  const n = (globalThis.navigator && navigator.hardwareConcurrency) || 4;
  return Array.from({ length: n }, () => ({ model: 'browser', speed: 0 }));
}

export function availableParallelism() {
  return cpus().length;
}

export default { cpus, availableParallelism };
