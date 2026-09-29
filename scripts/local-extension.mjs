/**
 * Build the Chrome extension into `extension/dist/`, and prove it against the
 * Node reference.
 *
 * The extension carries its own simulator: the pinned `pokemon-showdown`
 * compiled files, embedded as text and run in the page by a CommonJS loader
 * (`extension/src/cjs.js`) exactly as Node runs them. esbuild bundles only the
 * extension's own code and the `scripts/lib` modules it reuses; it never
 * rewrites a simulator file. Node built-ins resolve to the stand-ins in
 * `extension/src/node/`.
 *
 * What is embedded:
 *   - `sim/`, `lib/streams` and `lib/utils`, `config/formats`, and every data
 *     file in `data/` and the Champions mods (`BUNDLED_MODS`)
 *   - `ts-chacha20`, the simulator's one dependency
 *   - `scripts/server/rng-command.js`
 * and two files written here: `/ps/lib/index.js`, the two members of `lib/`
 * the simulator uses, and `/ps/encoreable-sim.js`, the public surface
 * `require('pokemon-showdown')` returns. Random-battle generators and the other
 * mods are not embedded; nothing a Champions battle does loads them.
 *
 * Usage:
 *   node scripts/local-extension.mjs                 build extension/dist/
 *   node scripts/local-extension.mjs --check         build, then run every check
 *   node scripts/local-extension.mjs --check sim     build, then run the named checks
 *   node scripts/local-extension.mjs --headful       show the Chrome window during checks
 *   node scripts/local-extension.mjs --verbose       print per-recording detail
 *
 * Load the result in Chrome at chrome://extensions with "Load unpacked" and the
 * `extension/dist` folder.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const ROOT = process.cwd();
const EXT = path.join(ROOT, 'extension');
const SRC = path.join(EXT, 'src');
const DIST = path.join(EXT, 'dist');
const PS = path.join(ROOT, 'node_modules', 'pokemon-showdown', 'dist');

/** Mods whose data is embedded. Every mod is still listed, so every format loads. */
const BUNDLED_MODS = ['champions', 'championsregmb'];

const CHECKS = ['sim', 'room', 'entry', 'rng', 'package'];

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);

// ------------------------------------------------------------ embedded files

const LIB_INDEX = `'use strict';
// The two members of lib/ the simulator uses (sim/battle-stream.ts). The real
// index also loads the server's process manager, SQL and network layers.
module.exports = { Streams: require('./streams'), Utils: require('./utils') };
`;

const SIM_ENTRY = `'use strict';
// What require('pokemon-showdown') gives in Node (sim/index.ts): the simulator,
// and of lib/ the two members anything here uses.
const battle = require('./sim/battle');
const stream = require('./sim/battle-stream');
const dex = require('./sim/dex');
module.exports = {
  Battle: battle.Battle,
  extractChannelMessages: battle.extractChannelMessages,
  BattleStream: stream.BattleStream,
  getPlayerStreams: stream.getPlayerStreams,
  Pokemon: require('./sim/pokemon').Pokemon,
  PRNG: require('./sim/prng').PRNG,
  Side: require('./sim/side').Side,
  Dex: dex.Dex,
  toID: dex.toID,
  Teams: require('./sim/teams').Teams,
  TeamValidator: require('./sim/team-validator').TeamValidator,
  Utils: require('./lib/utils'),
  Streams: require('./lib/streams'),
};
`;

const PACKAGES = { 'ts-chacha20': '/node_modules/ts-chacha20/build/src/chacha20.js' };

const jsIn = dir => fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));

/** Virtual path -> source text, for every file the loader can require. */
function embeddedFiles() {
  const files = {};
  const addPs = (abs) => {
    const rel = path.relative(PS, abs).split(path.sep).join('/');
    files[`/ps/${rel}`] = fs.readFileSync(abs, 'utf8');
  };
  jsIn(path.join(PS, 'sim')).forEach(addPs);
  addPs(path.join(PS, 'lib', 'streams.js'));
  addPs(path.join(PS, 'lib', 'utils.js'));
  addPs(path.join(PS, 'config', 'formats.js'));
  jsIn(path.join(PS, 'data')).forEach(addPs);
  for (const mod of BUNDLED_MODS) jsIn(path.join(PS, 'data', 'mods', mod)).forEach(addPs);
  files['/ps/lib/index.js'] = LIB_INDEX;
  files['/ps/encoreable-sim.js'] = SIM_ENTRY;
  files[PACKAGES['ts-chacha20']] = fs.readFileSync(require.resolve('ts-chacha20'), 'utf8');
  files['/encoreable/scripts/server/rng-command.js'] =
    fs.readFileSync(path.join(ROOT, 'scripts', 'server', 'rng-command.js'), 'utf8');
  // Node strips a UTF-8 byte-order mark before wrapping a module; so does the loader.
  for (const k of Object.keys(files)) files[k] = files[k].replace(/^﻿/, '');
  return files;
}

/**
 * Every literal `require` an embedded file makes that the loader cannot answer.
 * These are the lazily loaded paths a Champions battle never takes (random-battle
 * generators, other mods); a new one after an upgrade is worth a look.
 */
function unresolvedRequires(files) {
  const builtins = new Set(['fs', 'path', 'util', 'os', 'crypto', 'node:fs', 'node:path', 'node:util', 'node:os', 'node:crypto']);
  const missing = new Map();
  for (const [file, text] of Object.entries(files)) {
    for (const m of text.matchAll(/\brequire\("([^"]+)"\)/g)) {
      const req = m[1];
      if (builtins.has(req) || req in PACKAGES) continue;
      const base = req.startsWith('.') ? path.posix.join(path.posix.dirname(file), req) : req;
      if ([base, `${base}.js`, `${base}/index.js`].some(c => c in files)) continue;
      if (!missing.has(req)) missing.set(req, file);
    }
  }
  return missing;
}

// ------------------------------------------------------------------- esbuild

const NODE_BUILTINS = {
  fs: 'fs', path: 'path', crypto: 'crypto', util: 'util', os: 'os', module: 'module', worker_threads: 'worker_threads',
};

function extensionPlugin(files) {
  const mods = fs.readdirSync(path.join(PS, 'data', 'mods'), { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  return {
    name: 'encoreable',
    setup(build) {
      build.onResolve({ filter: /^encoreable:/ }, args => ({ path: args.path, namespace: 'encoreable' }));
      build.onLoad({ filter: /.*/, namespace: 'encoreable' }, (args) => {
        if (args.path === 'encoreable:sim-files') {
          return { contents: `export default ${JSON.stringify(files)};`, loader: 'js' };
        }
        if (args.path === 'encoreable:build-info') {
          return {
            contents: `export const mods = ${JSON.stringify(mods)};\nexport const packages = ${JSON.stringify(PACKAGES)};`,
            loader: 'js',
          };
        }
        return undefined;
      });
      build.onResolve({ filter: /^(node:)?(fs|path|crypto|util|os|module|worker_threads)$/ }, (args) => {
        const name = NODE_BUILTINS[args.path.replace(/^node:/, '')];
        return { path: path.join(SRC, 'node', `${name}.js`) };
      });
      // The engine reaches the simulator and rng-command.js through the loader only.
      build.onResolve({ filter: /pokemon-showdown|rng-command/ }, args => ({
        errors: [{ text: `"${args.path}" must be reached through extension/src/cjs.js, not bundled (imported by ${args.importer})` }],
      }));
    },
  };
}

/** The esbuild options every extension bundle shares. */
export function bundleOptions(files = embeddedFiles()) {
  return {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    define: { 'import.meta.url': '"file:///encoreable/"' },
    plugins: [extensionPlugin(files)],
  };
}

// ---------------------------------------------------------------------- build

const ENTRIES = [
  { in: 'worker.js', out: 'sim-worker.js' },
  { in: 'room.js', out: 'room.js' },
  { in: 'bridge.js', out: 'bridge.js' },
  { in: 'replay-page.js', out: 'replay-page.js' },
  { in: 'background.js', out: 'background.js' },
  { in: 'recordings.js', out: 'recordings.js' },
  // The RNG panel `npm run live` injects, unchanged; its transport is `app.send`, which room.js answers.
  { in: path.join('..', '..', 'scripts', 'client', 'rng-panel.js'), out: 'rng-panel.js' },
];

/**
 * Copied into `dist/` as they are. The simulator and `ts-chacha20` are embedded
 * whole, so their MIT notices travel with them.
 */
const STATIC = [
  { from: path.join(EXT, 'manifest.json'), to: 'manifest.json' },
  { from: path.join(SRC, 'recordings.html'), to: 'recordings.html' },
  { from: path.join(ROOT, 'node_modules', 'pokemon-showdown', 'LICENSE'), to: 'licenses/pokemon-showdown.txt' },
  { from: path.join(ROOT, 'node_modules', 'ts-chacha20', 'LICENSE'), to: 'licenses/ts-chacha20.txt' },
];

export async function build({ quiet = false } = {}) {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const started = Date.now();
  const files = embeddedFiles();
  const result = await esbuild.build({
    ...bundleOptions(files),
    entryPoints: ENTRIES.filter(e => fs.existsSync(path.join(SRC, e.in)))
      .map(e => ({ in: path.join(SRC, e.in), out: e.out.replace(/\.js$/, '') })),
    outdir: DIST,
  });
  for (const w of result.warnings) {
    if (!quiet) console.warn(`  warning: ${w.text}${w.location ? ` (${path.relative(ROOT, w.location.file)}:${w.location.line})` : ''}`);
  }

  for (const f of STATIC) {
    if (!fs.existsSync(f.from)) throw new Error(`missing ${path.relative(ROOT, f.from)}`);
    fs.mkdirSync(path.dirname(path.join(DIST, f.to)), { recursive: true });
    fs.copyFileSync(f.from, path.join(DIST, f.to));
  }

  if (!quiet) {
    const size = Object.values(files).reduce((n, t) => n + t.length, 0);
    console.log(`Built extension/dist/ in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(${Object.keys(files).length} simulator files embedded, ${(size / 1048576).toFixed(1)} MB)`);
    for (const [file, meta] of Object.entries(result.metafile.outputs)) {
      console.log(`  ${path.relative(ROOT, file).replace(/\\/g, '/')} ${(meta.bytes / 1048576).toFixed(1)} MB`);
    }
    if (flag('--verbose')) {
      for (const [req, from] of unresolvedRequires(files)) console.log(`  not embedded: ${req} (first required by ${from})`);
    }
  }
  return result;
}

// --------------------------------------------------------------------- checks

async function runChecks(names) {
  let failed = 0;
  for (const name of names) {
    const file = path.join(EXT, 'check', `${name}.mjs`);
    if (!fs.existsSync(file)) {
      console.log(`\n[SKIP] ${name} - extension/check/${name}.mjs does not exist yet`);
      continue;
    }
    console.log(`\n================ CHECK: ${name} ================\n`);
    const mod = await import(pathToFileURL(file).href);
    const ok = await mod.run({ root: ROOT, dist: DIST, headful: flag('--headful'), verbose: flag('--verbose') });
    if (!ok) failed++;
  }
  return failed;
}

async function main() {
  await build();
  const i = argv.indexOf('--check');
  if (i < 0) return;
  const named = argv.slice(i + 1).filter(a => !a.startsWith('--'));
  const unknown = named.filter(n => !CHECKS.includes(n));
  if (unknown.length) throw new Error(`unknown check: ${unknown.join(', ')} (known: ${CHECKS.join(', ')})`);
  const failed = await runChecks(named.length ? named : CHECKS);
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
