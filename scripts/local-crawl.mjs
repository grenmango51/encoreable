/**
 * Public data for the benchmark: Reg M-C replays from Showdown's replay server,
 * and the spreads people run from Smogon's usage stats.
 *
 *   npm run crawl                                 the last 2 days of Reg M-C replays, Bo1 and Bo3, into .cache/crawl/
 *   npm run crawl -- --days 30 --out <dir>        reach back 30 days (the search keeps about a month)
 *   npm run crawl -- --usage 2026-09              rewrite scripts/fixtures/usage-spreads.json from that month's stats
 *   npm run crawl -- --pick 100 --day 2026-10-30  copy 100 Bo3 games of that day into recordings/showdown/others-open/
 *
 * Flags: --out <dir> --formats <id>[,<id>...] --days <n> --delay <ms> --usage <YYYY-MM>
 *        --pick <n> --day <YYYY-MM-DD>
 *
 * Replays are kept as one gzipped JSON line each, in a bundle per format and
 * per day of upload (`<out>/<format>/<YYYY-MM-DD>.jsonl.gz`), appended to as
 * they come; `ids.txt` beside them lists every replay already fetched, so a
 * crawl fetches only what is new. Each crawl also asks the live server which
 * Showdown commit it runs (`/version`) and adds it to `<out>/versions.jsonl`
 * when it changed: a replay was played on the version live when it was
 * uploaded. One crawl at a time holds the store (`<out>/.lock`).
 *
 * A picked game is a game 1 of a Bo3 (so no two share a set) with both open
 * team sheets, teams the format accepts and a mimic battle that plays; games
 * are taken in an order fixed by their ids, so the same day gives the same
 * pick. The command prints the benchmark ids to add to
 * `scripts/fixtures/benchmark.js`.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';

import { MIMIC_DIR, USAGE_FILE, mimicRecipe, playMimic } from './lib/mimic.mjs';

const require = createRequire(import.meta.url);
const { Dex } = require('pokemon-showdown');

const ROOT = process.cwd();
const SEARCH = 'https://replay.pokemonshowdown.com/search.json';
const REPLAY = 'https://replay.pokemonshowdown.com';
const LIVE = 'wss://sim3.psim.us/showdown/websocket';
const STATS = 'https://www.smogon.com/stats';
const FORMATS = ['gen9championsvgc2026regmcbo3', 'gen9championsvgc2026regmc'];
const USAGE_FORMAT = 'gen9championsvgc2026regmcbo3';
// Per species, the spreads kept: the most run first, until they cover this
// share of the species' teams, at most `USAGE_MAX` of them.
const USAGE_COVER = 0.9;
const USAGE_MAX = 50;

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A URL's JSON, retried with a growing wait on a refusal or a server error; null on a 404. */
async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'encoreable-crawl (github.com/grenmango51/encoreable)' } });
      if (res.status === 404) return null;
      if (res.ok) return await res.json();
      if (attempt >= 6 || (res.status < 500 && res.status !== 429)) throw new Error(`${url}: HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 6) throw err;
    }
    await sleep(5000 * attempt);
  }
}

/** The commit the live server runs, from `/version`, or null if it does not answer. */
function liveVersion() {
  return new Promise((resolve) => {
    let ws;
    const done = (v) => { clearTimeout(timer); try { ws?.close(); } catch { /* closed */ } resolve(v); };
    const timer = setTimeout(() => done(null), 20000);
    try {
      ws = new WebSocket(LIVE);
    } catch {
      done(null);
      return;
    }
    ws.onmessage = (e) => {
      const s = String(e.data);
      if (s.includes('|challstr|')) ws.send('|/version');
      const m = /Server version: <b>([^<(]*)\(commit <a href="[^"]*\/commits\/([0-9a-f]+)"/.exec(s);
      if (m) done({ version: m[1].trim(), commit: m[2] });
    };
    ws.onerror = () => done(null);
  });
}

const dayOf = t => new Date(t * 1000).toISOString().slice(0, 10);

/** Every line of a bundle, its gzip members one after another. */
function readBundle(file) {
  if (!fs.existsSync(file)) return [];
  return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// ------------------------------------------------------------------ crawl

/**
 * Hold the store for one crawl: two crawls appending to one bundle on a shared
 * disk can interleave. A lock older than two days is a crawl that died.
 */
function lock(out) {
  const at = path.join(out, '.lock');
  try {
    fs.mkdirSync(at);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const age = Date.now() - fs.statSync(at).mtimeMs;
    if (age < 2 * 86400e3) return null;
    fs.rmSync(at, { recursive: true, force: true });
    fs.mkdirSync(at);
  }
  fs.writeFileSync(path.join(at, 'owner'), `${os.hostname()} ${process.pid} ${new Date().toISOString()}\n`);
  const release = () => fs.rmSync(at, { recursive: true, force: true });
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(1));
  return release;
}

async function crawl({ out, formats, days, delay }) {
  fs.mkdirSync(out, { recursive: true });
  if (!lock(out)) {
    console.log(`another crawl holds ${path.join(out, '.lock')}: ${fs.readFileSync(path.join(out, '.lock', 'owner'), 'utf8').trim()}`);
    return;
  }
  const live = await liveVersion();
  const versions = path.join(out, 'versions.jsonl');
  const known = fs.existsSync(versions) ? fs.readFileSync(versions, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  if (live && known.at(-1)?.commit !== live.commit) {
    fs.appendFileSync(versions, `${JSON.stringify({ at: new Date().toISOString(), ...live })}\n`);
  }
  console.log(`live server: ${live ? `${live.version} (${live.commit})` : 'did not answer /version'}`);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  for (const format of formats) {
    const dir = path.join(out, format);
    fs.mkdirSync(dir, { recursive: true });
    const idsFile = path.join(dir, 'ids.txt');
    const have = new Set(fs.existsSync(idsFile) ? fs.readFileSync(idsFile, 'utf8').split('\n').filter(Boolean) : []);
    let before = null;
    let fetched = 0;
    let pages = 0;
    for (;;) {
      const page = await getJson(`${SEARCH}?format=${format}${before ? `&before=${before}` : ''}`);
      pages++;
      await sleep(delay);
      if (!page?.length) break;
      const fresh = page.filter(r => !have.has(r.id) && !r.password && r.uploadtime >= cutoff);
      const byDay = new Map();
      for (const entry of fresh) {
        const replay = await getJson(`${REPLAY}/${entry.id}.json`);
        await sleep(delay);
        have.add(entry.id);
        if (!replay?.log) continue;
        const kept = {
          id: replay.id, format: replay.format, formatid: replay.formatid || format, players: replay.players,
          rating: replay.rating ?? null, uploadtime: replay.uploadtime, log: replay.log,
        };
        const day = dayOf(kept.uploadtime);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(JSON.stringify(kept));
      }
      for (const [day, lines] of byDay) fs.appendFileSync(path.join(dir, `${day}.jsonl.gz`), zlib.gzipSync(`${lines.join('\n')}\n`));
      if (fresh.length) fs.appendFileSync(idsFile, `${fresh.map(r => r.id).join('\n')}\n`);
      fetched += [...byDay.values()].reduce((t, l) => t + l.length, 0);
      const oldest = Math.min(...page.map(r => r.uploadtime));
      if (oldest < cutoff || oldest === before) break;
      before = oldest;
      if (pages % 10 === 0) console.log(`${format}: ${fetched} new, back to ${new Date(oldest * 1000).toISOString()}`);
    }
    console.log(`${format}: ${fetched} new replays from ${pages} search pages; ${have.size} kept in all`);
  }
}

// ------------------------------------------------------------------ usage

async function usage(month) {
  const url = `${STATS}/${month}/chaos/${USAGE_FORMAT}-0.json`;
  const data = await getJson(url);
  if (!data) throw new Error(`${url}: not found`);
  const dex = Dex.forFormat('gen9championsvgc2026regmc');
  const merged = new Map();
  for (const [name, entry] of Object.entries(data.data)) {
    const species = dex.species.get(name);
    if (!species.exists) continue;
    // Smogon counts a Mega by its Mega forme; a team brings the species it evolves from.
    const brought = species.battleOnly ? (Array.isArray(species.battleOnly) ? species.battleOnly[0] : species.battleOnly) : species.name;
    const into = merged.get(brought) || new Map();
    for (const [key, weight] of Object.entries(entry.Spreads || {})) {
      const [nature, sp] = key.split(':');
      const values = String(sp).split('/').map(Number);
      if (values.length !== 6 || values.some(v => !Number.isInteger(v) || v < 0 || v > 32) || values.reduce((a, b) => a + b, 0) > 66) continue;
      into.set(`${nature}:${sp}`, (into.get(`${nature}:${sp}`) || 0) + weight);
    }
    merged.set(brought, into);
  }
  const spreads = {};
  for (const [species, into] of [...merged].sort(([a], [b]) => a.localeCompare(b))) {
    const all = [...into].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = all.reduce((t, [, w]) => t + w, 0);
    const kept = [];
    let covered = 0;
    for (const [key, weight] of all) {
      if (kept.length >= USAGE_MAX || covered >= USAGE_COVER * total) break;
      const w = Math.round(weight);
      if (w < 1) break;
      const [nature, sp] = key.split(':');
      kept.push([nature, sp, w]);
      covered += weight;
    }
    if (kept.length) spreads[species] = kept;
  }
  const fixture = { source: url, battles: data.info['number of battles'], spreads };
  fs.writeFileSync(path.join(ROOT, USAGE_FILE), `${JSON.stringify(fixture).replace(/\],"/g, '],\n"')}\n`);
  console.log(`${USAGE_FILE}: ${Object.keys(spreads).length} species from ${fixture.battles} battles (${url})`);
}

// ------------------------------------------------------------------ pick

async function pick({ out, n, day }) {
  const replays = readBundle(path.join(out, USAGE_FORMAT, `${day}.jsonl.gz`));
  if (!replays.length) throw new Error(`no ${USAGE_FORMAT} replays of ${day} in ${out}`);
  const hash = id => crypto.createHash('sha256').update(id).digest('hex');
  const seen = new Set();
  const ordered = [...new Map(replays.map(r => [r.id, r])).values()].sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
  const dir = path.join(ROOT, MIMIC_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const picked = [];
  for (const replay of ordered) {
    if (picked.length >= n) break;
    const lines = replay.log.split('\n');
    const heading = lines.filter(l => l.startsWith('|uhtml|bestof|')).at(-1) || '';
    if (!/Game 1</.test(heading)) continue;
    if (lines.filter(l => l.startsWith('|showteam|')).length < 2) continue;
    if (!lines.some(l => l === '|turn|3')) continue;
    const teams = lines.filter(l => l.startsWith('|showteam|')).map(l => l.split('|').slice(3).join('|')).sort().join('\n');
    if (seen.has(teams)) continue;
    const file = path.join(dir, `${replay.id}.json`);
    const existed = fs.existsSync(file);
    if (!existed) fs.writeFileSync(file, `${JSON.stringify(replay)}\n`);
    let ok = false;
    try {
      const recipe = mimicRecipe(`mimic:${replay.id}`);
      ok = !!recipe && (await playMimic(recipe)).turns > 1;
    } catch (err) {
      console.log(`${replay.id}: ${String(err.message).split('\n')[0]}`);
    }
    if (!ok) {
      if (!existed) fs.unlinkSync(file);
      continue;
    }
    seen.add(teams);
    picked.push(replay.id);
  }
  console.log(picked.map(id => `  'mimic:${id}',`).join('\n'));
  console.log(`${picked.length} games in ${MIMIC_DIR}/`);
}

// ------------------------------------------------------------------ main

const out = path.resolve(flag('out', path.join(ROOT, '.cache/crawl')));
if (flag('usage')) await usage(flag('usage'));
else if (flag('pick')) await pick({ out, n: Number(flag('pick')), day: flag('day') || dayOf(Date.now() / 1000 - 86400) });
else {
  await crawl({
    out,
    formats: (flag('formats') || FORMATS.join(',')).split(','),
    days: Number(flag('days', 2)),
    delay: Number(flag('delay', 1000)),
  });
}
