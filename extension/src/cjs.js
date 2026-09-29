/**
 * A CommonJS loader for the simulator, so it runs in the page as it runs in Node.
 *
 * The build embeds the pinned `pokemon-showdown` compiled files as text, byte
 * for byte. Each is evaluated when first required, inside the same wrapper Node
 * uses - `(exports, require, module, __filename, __dirname)` - and under its
 * own `//# sourceURL`. That matters beyond tidiness: `rng-command.js` tells
 * which function asked for a random draw by reading stack frames, by class and
 * method name, and a bundler renames self-referencing classes (`Battle` becomes
 * `_Battle`). Evaluated as written, the frames read as they do in Node.
 *
 * Paths are virtual: the simulator lives under `/ps/` (its `dist/` folder),
 * `rng-command.js` under `/encoreable/`. The data files a Champions battle needs
 * are embedded; `require` of anything else fails with `MODULE_NOT_FOUND`, which
 * `sim/dex.ts` already reads as "that mod has no such file".
 */

import files from 'encoreable:sim-files';
import { packages } from 'encoreable:build-info';
import fs from './node/fs.js';
import path from './node/path.js';
import util from './node/util.js';
import os from './node/os.js';

const BUILTINS = {
  fs, 'node:fs': fs,
  path, 'node:path': path,
  util, 'node:util': util,
  os, 'node:os': os,
  // `sim/prng.ts` requires it only when `globalThis.crypto` is missing; a worker has it.
  crypto: globalThis.crypto, 'node:crypto': globalThis.crypto,
};

const cache = new Map();

function notFound(request, from) {
  const err = new Error(`Cannot find module '${request}' from '${from}' - not embedded in the extension`);
  err.code = 'MODULE_NOT_FOUND';
  return err;
}

function resolveFile(from, request) {
  let base;
  if (request.startsWith('/')) base = path.normalize(request);
  else if (request.startsWith('./') || request.startsWith('../')) base = path.join(path.dirname(from), request);
  else if (request in packages) return packages[request];
  else return null;
  for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
    if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate;
  }
  return null;
}

function makeRequire(from) {
  function require(request) {
    if (Object.prototype.hasOwnProperty.call(BUILTINS, request)) return BUILTINS[request];
    const file = resolveFile(from, request);
    if (!file) throw notFound(request, from);
    return load(file);
  }
  require.resolve = (request) => {
    if (Object.prototype.hasOwnProperty.call(BUILTINS, request)) return request;
    const file = resolveFile(from, request);
    if (!file) throw notFound(request, from);
    return file;
  };
  require.cache = cache;
  return require;
}

function load(file) {
  const cached = cache.get(file);
  if (cached) return cached.exports;
  const module = { id: file, filename: file, exports: {}, loaded: false, children: [] };
  cache.set(file, module);
  try {
    const wrapper = (0, eval)(
      `(function (exports, require, module, __filename, __dirname) {${files[file]}\n})\n//# sourceURL=${file}`
    );
    wrapper.call(module.exports, module.exports, makeRequire(file), module, file, path.dirname(file));
  } catch (err) {
    cache.delete(file);
    throw err;
  }
  module.loaded = true;
  return module.exports;
}

/** `require` as seen from the root, for the extension's own modules. */
export const simRequire = makeRequire('/');

/** The simulator's public surface: what `require('pokemon-showdown')` gives in Node. */
export const SIM_ENTRY = '/ps/encoreable-sim.js';
export const RNG_COMMAND = '/encoreable/scripts/server/rng-command.js';
