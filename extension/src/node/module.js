/**
 * `createRequire`, the way `scripts/lib/*.mjs` reach the simulator in Node. In
 * the extension it hands back the embedded simulator and `rng-command.js`
 * through the CommonJS loader, so those files are bundled unchanged and share
 * one instance of each with the engine.
 */

import { simRequire, SIM_ENTRY, RNG_COMMAND } from '../cjs.js';

export function createRequire() {
  return function require(id) {
    if (id === 'pokemon-showdown') return simRequire(SIM_ENTRY);
    // `pokemon-showdown/dist/sim/battle.js` and the like: the package's `dist/` is `/ps/`.
    const deep = /^pokemon-showdown\/dist\/(.+)$/.exec(id);
    if (deep) return simRequire(`/ps/${deep[1]}`);
    if (/(^|\/)rng-command(\.js)?$/.test(id)) return simRequire(RNG_COMMAND);
    throw new Error(`createRequire: '${id}' is not available in the extension`);
  };
}

export default { createRequire };
