/**
 * Finding recorded battles.
 *
 * The server writes each finished battle to `runtime/logs/<month>/<format>/<date>/`
 * as a `.log.json` carrying the inputLog - the seed, both packed teams, and every
 * choice. That is the input to every branching command.
 *
 * `runtime/` is generated: `provision-local-server.mjs` rebuilds it from
 * `node_modules/pokemon-showdown`, and deleting it to reset the server is a
 * normal thing to do. So recordings worth keeping are archived to `recordings/`,
 * which is tracked and outside the generated tree.
 *
 * Both directories are searched. On a name collision `recordings/` wins, so an
 * archived copy is authoritative once it exists.
 */

import fs from 'fs';
import path from 'path';

/** Every `.log.json` under `dir`, recursively. Missing directories yield none. */
function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.log.json')) out.push(full);
  }
  return out;
}

/** Every `.log.json` under one directory, newest first. */
export function listLogFilesIn(dir) {
  return walk(dir).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/**
 * Every recording, newest first, de-duplicated by file name with the archived
 * copy preferred.
 */
export function listLogFiles(root) {
  const archived = walk(path.join(root, 'recordings'));
  const generated = walk(path.join(root, 'runtime', 'logs'));

  const seen = new Set(archived.map(f => path.basename(f)));
  const all = [...archived, ...generated.filter(f => !seen.has(path.basename(f)))];

  return all.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** The most recently written recording, or null if there are none. */
export function newestLogFile(root) {
  return listLogFiles(root)[0] || null;
}

/**
 * The newest recording that ran at least `turns` turns, falling back to the
 * newest of all if none did.
 *
 * A battle is only worth branching at turn N if it reached turn N, and a short
 * one - two sides that opened with Memento, say - reaches almost nothing.
 * Defaulting to newest-overall then fails on a recording the caller never chose.
 * The turn count is written into the log file, so this costs one read each.
 */
export function newestLogFileWithTurns(root, turns) {
  const files = listLogFiles(root);
  for (const file of files) {
    try {
      if (Number(JSON.parse(fs.readFileSync(file, 'utf8')).turns) >= turns) return file;
    } catch { /* unreadable recording - try the next */ }
  }
  return files[0] || null;
}

/**
 * Copy a recording into `recordings/` so it survives a rebuild of `runtime/`.
 * Returns the archived path. Existing archives are left alone.
 */
export function archiveLogFile(root, file) {
  const dest = path.join(root, 'recordings', path.basename(file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  return dest;
}

/**
 * One line naming a recording that was reconstructed rather than played, or null.
 *
 * A reconstructed log reproduces its replay line for line, but its dice were
 * chosen and the opponent's HP was sampled from inside the band a percentage
 * allows (ENGINEERING.md 7). It is a faithful reading of someone else's battle,
 * not a record of one this server ran, and every command that loads one says so -
 * `npm run live` reaches for the newest recording by default, and the newest is
 * exactly what a fresh reconstruction will be.
 */
export function reconstructedBanner(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!data.reconstructed) return null;
  const through = data.complete
    ? 'every turn matches the replay'
    : `matches the replay through turn ${data.verifiedThroughTurn}`;
  return `RECONSTRUCTED from ${data.reconstructedFrom || 'a replay'} - ${through}, ` +
    `opponent HP sampled within the percentage shown (sample ${data.sampleSeed}).`;
}

/** A repo-relative path with forward slashes, for pasting back as an argument. */
export function posix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Read the inputLog out of a `.log.json`, normalised to a single string. */
export function readInputLog(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(data.inputLog) ? data.inputLog.join('\n') : String(data.inputLog || '');
  if (!raw.trim()) throw new Error(`${file} contains no inputLog`);
  return raw;
}
