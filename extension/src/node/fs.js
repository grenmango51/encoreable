/**
 * `fs` for a page, which has no file system.
 *
 * The simulator's only read is `fs.readdirSync(MODS_DIR)` in `sim/dex.ts`
 * `includeMods`, answered with the mod folders the build saw, in the order Node
 * listed them. `scripts/lib/replay-source.mjs` reads its source with
 * `readFileSync`; the engine puts a replay or a recording in `memory` under a
 * name first, so that code runs unchanged. Anything else fails with `ENOENT`,
 * which the simulator already treats as "not there".
 */

import { mods } from 'encoreable:build-info';
import { normalize } from './path.js';

/** Virtual files, by normalised path. */
export const memory = new Map();

function enoent(syscall, p) {
  const err = new Error(`ENOENT: no such file or directory, ${syscall} '${p}' - the extension has no file system`);
  err.code = 'ENOENT';
  err.syscall = syscall;
  err.path = p;
  return err;
}

export function readdirSync(dir) {
  if (/\/data\/mods$/.test(normalize(dir))) return mods.slice();
  throw enoent('scandir', dir);
}
export function existsSync(p) { return memory.has(normalize(p)); }
export function readFileSync(p) {
  const key = normalize(p);
  if (memory.has(key)) return memory.get(key);
  throw enoent('open', p);
}
export function writeFileSync(p, data) { memory.set(normalize(p), String(data)); }
export function mkdirSync() {}
export function statSync(p) {
  const key = normalize(p);
  if (!memory.has(key)) throw enoent('stat', p);
  return { isFile: () => true, isDirectory: () => false, size: memory.get(key).length, mtimeMs: 0 };
}

export const promises = {
  readFile: async p => readFileSync(p),
  writeFile: async (p, d) => writeFileSync(p, d),
};

export default { memory, readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync, promises };
