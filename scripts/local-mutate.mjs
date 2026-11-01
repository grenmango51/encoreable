/**
 * Planted bugs: how often a green score would be a false green. A planted bug
 * (a mutant) is one small mechanical change to the code that decides what a
 * replay removes - `<` for `<=`, `||` for `&&`, a `!` dropped, a statement
 * deleted - chosen by a fixed rule, never by hand. The quick slice of
 * `npm run score` is run against it. A mutant the score notices (a real spread
 * removed, a result or a Pokemon's spreads worse than the baseline, a crash, a
 * hang) is caught. One that only makes the slice look better - fewer spreads
 * left, a case that now rebuilds - is the most dangerous: it removes more, and
 * the gate would take it for an improvement. One that changes nothing on the
 * slice is a blind spot of the benchmark, or a change that makes no
 * difference. Every mutant not caught is then hunted: fuzz
 * battles beyond the benchmark are graded with and without it, and a battle on
 * which it does worse than the real code is one the benchmark lacks. That
 * battle, added to `scripts/fixtures/benchmark.js` with the mutant it caught,
 * is the only thing this command produces; no test is written.
 *
 *   npm run mutate -- --list                                   how many mutants each file gives, and a sample
 *   npm run mutate -- --sample 300 --shard 3/27 --out <file>   screen one share of a 300-mutant sample
 *   npm run mutate -- --merge <file>...                        the shares together: caught, missed, and how
 *   npm run mutate -- --hunt <mutant> --seeds 1001-1030        battles beyond the benchmark that catch it
 *   npm run mutate -- --hunt real --seeds 1001-1030            the real code's grades of them, kept for every hunt
 *
 * Flags: --sample <n> --seed <s> --shard <i>/<n> --out <file> --threads <n>
 *        --views <v>[,<v>...] --timeout <minutes> --merge <file>... --hunt <id> --seeds <a>-<b>
 *
 * A mutant's id is `<file>:<line>:<column>:<kind>`. Each runs in a copy of
 * `scripts/` under the system's temporary directory, beside links to the rest
 * of the checkout, so mutants on a shared disk never touch one another. The
 * views default to the two one-sided ones, the fast ones; a mutant that only a
 * spectator's view would catch is hunted with `--views`.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const ROOT = process.cwd();
const TARGETS = [
  'scripts/lib/inference/evidence.mjs',
  'scripts/lib/inference/knowledge.mjs',
  'scripts/lib/inference/speed.mjs',
  'scripts/lib/inference/infer.mjs',
];
const VIEWS = 'p2@p1,p1@p2';
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const RANK = { PASS: 0, 'GAVE UP': 1, 'NO MATCH': 1, CRASH: 2, REMOVED: 3 };

function opt(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}

// ------------------------------------------------------------------ mutants

/**
 * The source with every comment, string, template and regex literal blanked
 * to spaces (newlines kept), so offsets still match: what is left is code.
 */
function codeOnly(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let last = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2) + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
      last = 'x';
      continue;
    }
    if (c === '/' && (!last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && (inClass || src[j] !== '/') && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j++;
      }
      while (/[a-z]/.test(src[j + 1] || '')) j++;
      blank(i, j + 1);
      i = j + 1;
      last = 'x';
      continue;
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out.join('');
}

// Operators read longest first, so `<=` is never read as `<`; only those with
// a swap are mutated.
const OPERATORS = ['>>>=', '===', '!==', '>>>', '<<=', '>>=', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '<<', '>>', '<', '>'];
const SWAP = { '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===', '&&': '||', '||': '&&' };

/** Every mutant of one file, in source order. */
function mutantsOf(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const code = codeOnly(src);
  const found = [];
  const add = (at, len, to, kind) => found.push({ file, at, len, to, kind });
  for (let i = 0; i < code.length;) {
    const op = OPERATORS.find(o => code.startsWith(o, i));
    if (op) {
      if (SWAP[op]) add(i, op.length, SWAP[op], `${op}→${SWAP[op]}`);
      i += op.length;
      continue;
    }
    i++;
  }
  for (const m of code.matchAll(/Math\.(min|max)\b/g)) add(m.index + 5, 3, m[1] === 'min' ? 'max' : 'min', `${m[1]}→${m[1] === 'min' ? 'max' : 'min'}`);
  for (const m of code.matchAll(/\b(true|false)\b/g)) add(m.index, m[1].length, m[1] === 'true' ? 'false' : 'true', `${m[1]}→${m[1] === 'true' ? 'false' : 'true'}`);
  for (const m of code.matchAll(/!(?=[\w$(])/g)) add(m.index, 1, '', 'drop !');
  for (const m of code.matchAll(/([+-]) 1\b/g)) add(m.index + 2, 1, '0', `${m[1]} 1→${m[1]} 0`);
  // A whole statement on one line, not a declaration: deleted.
  let offset = 0;
  for (const line of code.split('\n')) {
    const body = line.trim();
    if (body.endsWith(';') && !/^(const|let|var|function|class|import|export|async function)\b/.test(body) && !/^[)\]}]/.test(body)) {
      const start = offset + line.indexOf(body);
      add(start, body.length, ';', 'delete statement');
    }
    offset += line.length + 1;
  }
  const lineOf = (at) => { let n = 1; for (let k = 0; k < at; k++) if (src[k] === '\n') n++; return n; };
  return found.sort((a, b) => a.at - b.at).map((m) => {
    const line = lineOf(m.at);
    const column = m.at - src.lastIndexOf('\n', m.at - 1);
    return { ...m, line, column, id: `${path.basename(file)}:${line}:${column}:${m.kind}` };
  });
}

function allMutants() {
  return TARGETS.flatMap(mutantsOf);
}

/** The source of a file with one mutant in it. */
function mutated(m) {
  const src = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
  return src.slice(0, m.at) + m.to + src.slice(m.at + m.len);
}

/** Whether a mutant still parses: one that does not is no mutant. */
function parses(m, dir) {
  const file = path.join(dir, path.basename(m.file));
  fs.writeFileSync(file, mutated(m));
  return spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' }).status === 0;
}

/**
 * `n` mutants that parse, in an order fixed by `seed`: every share of a run
 * draws the same sample.
 */
function sample(n, seed) {
  const order = allMutants()
    .map(m => ({ m, key: crypto.createHash('sha256').update(`${seed}:${m.id}`).digest('hex') }))
    .sort((a, b) => a.key.localeCompare(b.key)).map(x => x.m);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encoreable-parse-'));
  const out = [];
  try {
    for (const m of order) {
      if (out.length >= n) break;
      if (parses(m, dir)) out.push(m);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/**
 * A checkout with one mutant in it: `scripts/` copied with the change, every
 * other entry a link to this checkout's own.
 */
function checkoutWith(m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encoreable-mutant-'));
  for (const entry of fs.readdirSync(ROOT)) {
    if (entry === 'scripts' || entry === '.cache') continue;
    fs.symlinkSync(path.join(ROOT, entry), path.join(dir, entry));
  }
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  if (m) fs.writeFileSync(path.join(dir, m.file), mutated(m));
  return dir;
}

/** `npm run score` with these arguments in a checkout, cut off after `minutes`. */
function score(dir, args, minutes) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/local-score.mjs', ...args], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, minutes * 60000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout }); });
  });
}

// ------------------------------------------------------------------ screen

/** One mutant against the quick slice: caught, how, or missed. */
async function screen(m, { threads, views, minutes }) {
  const dir = checkoutWith(m);
  const started = Date.now();
  try {
    const out = path.join(dir, 'mutant-run.json');
    const res = await score(dir, ['--tier', 'quick', '--views', views, '--threads', String(threads), '--out', out], minutes);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (res.signal) return { ...m, caught: 'hang', seconds };
    const lines = res.stdout.split('\n');
    const removed = lines.find(l => l.startsWith('accurate:'))?.match(/^accurate: (\d+) real/)?.[1];
    const worse = lines.filter(l => l.trim().startsWith('WORSE')).map(l => l.trim().slice(6).trim());
    const better = Number(lines.find(l => l.startsWith('against the baseline'))?.match(/, (\d+) better/)?.[1] || 0);
    const betterLines = lines.filter(l => l.trim().startsWith('better ')).map(l => l.trim().slice(7).trim());
    const crashed = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')).records.filter(r => r.result === 'CRASH').map(r => `${r.id} ${r.view}`) : [];
    let caught = null;
    if (Number(removed) > 0) caught = 'removed';
    else if (crashed.length) caught = 'crash';
    else if (worse.length) caught = 'worse';
    else if (res.code !== 0) caught = 'error';
    // A change only for the better is still a change: the code removes more,
    // and a real spread it removes in a battle the slice lacks would pass as an
    // improvement. It is noticed, not caught, and hunted like a missed one.
    return {
      ...m, caught, noticed: !caught && better > 0, seconds,
      evidence: caught ? [...worse.slice(0, 5), ...crashed.slice(0, 3)] : betterLines.slice(0, 5),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ hunt

/** The worst a case did against another run of it: a removed spread, a worse result, a wider Pokemon. */
function worseThan(mut, real) {
  if (mut.result === 'REMOVED' && real.result !== 'REMOVED') return 'removed a real spread';
  if (RANK[mut.result] > RANK[real.result]) return `${real.result} -> ${mut.result}`;
  for (const p of mut.pokemon || []) {
    const q = (real.pokemon || []).find(x => x.id === p.id);
    if (q && p.spreads > q.spreads) return `${p.id} ${p.species} keeps ${p.spreads}, real code ${q.spreads}`;
  }
  return null;
}

async function hunt(id, { seeds, threads, views, minutes }) {
  // `real` grades the battles with the real code only, for the cache.
  const m = id === 'real' ? null : allMutants().find(x => x.id === id);
  if (m === undefined) throw new Error(`no mutant ${id}`);
  const [a, b] = seeds.split('-').map(Number);
  const only = Array.from({ length: b - a + 1 }, (_, k) => `fuzz:${a + k}`).join(',');
  const args = out => ['--only', only, '--views', views, '--threads', String(threads), '--out', out];
  const realDir = checkoutWith(null);
  const mutDir = m ? checkoutWith(m) : null;
  try {
    // The real code's grades of these battles are the same for every mutant:
    // played once and kept beside the checkout, shared by every host.
    const cached = path.join(ROOT, '.cache', 'mutate', `real-${a}-${b}-${views.replace(/[^\w@,-]/g, '')}.json`);
    if (!fs.existsSync(cached)) {
      console.error(`grading fuzz ${a}-${b} (${views}) with the real code`);
      await score(realDir, args(path.join(realDir, 'real.json')), minutes);
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      fs.copyFileSync(path.join(realDir, 'real.json'), `${cached}.${process.pid}`);
      fs.renameSync(`${cached}.${process.pid}`, cached);
    }
    if (!m) return null;
    console.error(`hunting ${id} on fuzz ${a}-${b}, views ${views}`);
    await score(mutDir, args(path.join(mutDir, 'mutant.json')), minutes);
    const read = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).records : []);
    const real = new Map(read(cached).map(r => [`${r.id} ${r.view}`, r]));
    const caught = [];
    for (const r of read(path.join(mutDir, 'mutant.json'))) {
      const base = real.get(`${r.id} ${r.view}`);
      const why = base && base.result !== 'REMOVED' && worseThan(r, base);
      if (why) caught.push({ battle: r.id, view: r.view, why });
    }
    return { ...m, seeds, views, caught };
  } finally {
    fs.rmSync(realDir, { recursive: true, force: true });
    if (mutDir) fs.rmSync(mutDir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ report

function report(results) {
  const caught = results.filter(r => r.caught);
  const noticed = results.filter(r => !r.caught && r.noticed);
  const missed = results.filter(r => !r.caught && !r.noticed);
  const by = k => caught.filter(r => r.caught === k).length;
  console.log(`planted bugs: ${results.length}; caught ${caught.length} (${(100 * caught.length / Math.max(1, results.length)).toFixed(1)}%) -` +
    ` removed a real spread ${by('removed')}, worse than the baseline ${by('worse')}, crash ${by('crash')}, hang ${by('hang')}, error ${by('error')};` +
    ` only better than the baseline ${noticed.length}; no change ${missed.length}`);
  for (const file of TARGETS.map(f => path.basename(f))) {
    const here = results.filter(r => path.basename(r.file) === file);
    if (here.length) console.log(`  ${file.padEnd(16)} ${here.filter(r => r.caught).length} of ${here.length} caught`);
  }
  const line = r => fs.readFileSync(path.join(ROOT, r.file), 'utf8').split('\n')[r.line - 1].trim().slice(0, 140);
  console.log(`\nonly better (${noticed.length}), the most dangerous: hunt each with npm run mutate -- --hunt "<id>" --seeds 1001-1030`);
  for (const r of noticed) console.log(`  ${r.id}\n      ${line(r)}\n      ${r.evidence?.[0] || ''}`);
  console.log(`\nno change on the slice (${missed.length}): hunted the same way`);
  for (const r of missed) console.log(`  ${r.id}\n      ${line(r)}`);
}

// ------------------------------------------------------------------ main

async function main() {
  const threads = Number(opt('threads', String(Math.max(1, os.availableParallelism() - 1))));
  const views = opt('views', VIEWS);
  const minutes = Number(opt('timeout', '20'));
  if (process.argv.includes('--list')) {
    const all = allMutants();
    for (const file of TARGETS) console.log(`${file}: ${all.filter(m => m.file === file).length} mutants`);
    const kinds = {};
    for (const m of all) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
    console.log(Object.entries(kinds).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', '));
    for (const m of sample(Number(opt('sample', '10')), opt('seed', '1'))) console.log(`  ${m.id}`);
    return;
  }
  if (process.argv.includes('--merge')) {
    const after = process.argv.slice(process.argv.indexOf('--merge') + 1);
    const end = after.findIndex(x => x.startsWith('--'));
    const files = end < 0 ? after : after.slice(0, end);
    report(files.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')).results));
    return;
  }
  if (opt('hunt')) {
    const res = await hunt(opt('hunt'), { seeds: opt('seeds', '1001-1030'), threads, views, minutes: Number(opt('timeout', '120')) });
    if (!res) { console.log('graded with the real code'); return; }
    if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(res, null, 1));
    console.log(res.caught.length
      ? `${res.id}: caught by\n${res.caught.map(c => `  ${c.battle} ${c.view}: ${c.why}`).join('\n')}`
      : `${res.id}: no battle of fuzz ${res.seeds} (${res.views}) catches it`);
    return;
  }
  const picked = sample(Number(opt('sample', '100')), opt('seed', '1'));
  let mine = picked;
  if (opt('shard')) {
    const [i, n] = opt('shard').split('/').map(Number);
    mine = picked.filter((_, k) => k % n === i - 1);
  }
  const results = [];
  for (const [k, m] of mine.entries()) {
    const r = await screen(m, { threads, views, minutes });
    results.push(r);
    console.error(`[${k + 1}/${mine.length}] ${m.id}: ${r.caught || (r.noticed ? 'ONLY BETTER' : 'NO CHANGE')} ${r.seconds}s`);
    if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify({ sample: picked.length, seed: opt('seed', '1'), results }));
  }
  report(results);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
