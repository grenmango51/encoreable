import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ACTION_KINDS } from './lib/inference/speed.mjs';

// 1. Provision to ensure config exists
import './provision-local-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const configPath = path.join(RUNTIME_DIR, 'config', 'config.js');
const QUEUE = 'runtime/sim/battle-queue.ts';
const queuePath = path.join(RUNTIME_DIR, 'sim', 'battle-queue.ts');
const READS_BATTLE = 'recordings/local/scripted/gen9championsvgc2026regmb-25.log.json';

/**
 * The kinds of action the simulator queues, read off its own source: the keys
 * of the order table `resolveAction` gives each kind, and the kinds it lets
 * through with none, which sort at the moves' 200. Null when either is not
 * where it was, or holds anything but plain names: the simulator changed, and
 * this reading has to be looked at again rather than pass on part of it.
 */
function queuedKinds(source) {
  const table = /const orders\b[^=]*=\s*\{([^}]*)\};/.exec(source);
  if (!table) return null;
  const free = /if \(!\[([^\]]*)\]\.includes\(action\.choice\)\)/.exec(source.slice(table.index));
  if (!free) return null;
  const kinds = [];
  for (const raw of table[1].split('\n')) {
    const line = raw.replace(/\/\/.*/, '').trim();
    if (!line) continue;
    const entry = /^(\w+)\s*:\s*\d+\s*,?$/.exec(line);
    if (!entry) return null;
    kinds.push(entry[1]);
  }
  for (const raw of free[1].split(',')) {
    const entry = /^'(\w+)'$/.exec(raw.trim());
    if (!entry) return null;
    kinds.push(entry[1]);
  }
  return kinds.length ? kinds : null;
}

/**
 * What does not agree between the kinds the simulator queues and the order
 * reader's two lists (`ACTION_KINDS`, speed.mjs), one message per kind. A kind
 * on neither list is one whose order is skipped without a word, as faint
 * replacements' was; a listed kind the simulator no longer queues means the
 * lists were written for another Showdown.
 */
function actionKindFailures(source, { read, ignored }) {
  const queued = queuedKinds(source);
  if (!queued) {
    return [`the action order table (resolveAction's \`orders\`, and the kinds it lets through with none) is not where scripts/local-check.mjs reads it in ${QUEUE}. The simulator changed: find the table and fix the reading there.`];
  }
  const out = [];
  const listed = new Set([...read, ...Object.keys(ignored)]);
  for (const kind of read) {
    if (Object.hasOwn(ignored, kind)) out.push(`speed.mjs lists the action kind '${kind}' both as read and as ignored. Keep one.`);
  }
  for (const [kind, why] of Object.entries(ignored)) {
    if (typeof why !== 'string' || !why.trim()) out.push(`speed.mjs ignores the action kind '${kind}' without saying why. Give the reason beside it in ACTION_KINDS.ignored.`);
  }
  for (const kind of queued) {
    if (!listed.has(kind)) out.push(`the simulator queues the action kind '${kind}' (${QUEUE}), and speed.mjs neither reads its order nor lists it as ignored. Read it there, or add it to ACTION_KINDS.ignored with why skipping it loses no order.`);
  }
  for (const kind of listed) {
    if (!queued.includes(kind)) out.push(`speed.mjs lists the action kind '${kind}' as ${read.includes(kind) ? 'read' : 'ignored'}, but the simulator no longer queues it (${QUEUE}). Find what took its place, classify that in speed.mjs, and drop '${kind}'.`);
  }
  return out;
}

/**
 * Whether a search that stops on a damage line is told which stats the line's
 * hit read: the evidence pass observes them, and the fallback moves those
 * first. A recorded battle with one Pokemon's HP and defences emptied takes a
 * hit the log does not show; the pass that stops there must name that
 * Pokemon's HP. Empty, the fallback probes in its own order, and nothing else
 * would notice. Null when it does, else what went wrong.
 */
async function readsFailure() {
  const require = createRequire(import.meta.url);
  const { BattleStream, Teams } = require('pokemon-showdown');
  const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
  const { evidencePass } = await import('./lib/inference/evidence.mjs');
  const { freshKnowledge } = await import('./lib/inference/knowledge.mjs');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', READS_BATTLE), 'utf8'));
  const inputLog = (Array.isArray(data.inputLog) ? data.inputLog : String(data.inputLog).split('\n'))
    .map(l => l.trimEnd()).filter(l => l.startsWith('>'));
  const stream = new BattleStream({ keepAlive: true });
  (async () => { for await (const chunk of stream) { /* discard */ } })();
  for (const line of inputLog) await stream.write(line);
  const observed = extractChannelMessages(stream.battle.log.join('\n'), [0])[0];
  stream.destroy?.();
  const teams = {};
  for (const line of inputLog) {
    const m = /^>player (p[12]) (.*)$/.exec(line);
    if (m) teams[m[1]] = Teams.unpack(JSON.parse(m[2]).team);
  }
  for (const side of ['p2', 'p1']) {
    for (const [i, set] of teams[side].entries()) {
      const weak = teams[side].map((x, j) => (j === i ? { ...x, evs: { ...x.evs, hp: 0, def: 0, spd: 0 } } : x));
      const scaffold = inputLog.map(line => (line.startsWith(`>player ${side} `)
        ? `>player ${side} ${JSON.stringify({ ...JSON.parse(line.slice(`>player ${side} `.length)), team: Teams.pack(weak) })}` : line));
      const knowledge = new Map();
      for (const s of ['p1', 'p2']) teams[s].forEach((x, j) => knowledge.set(`${s}:${j}`, freshKnowledge(x, false)));
      const { cutoff } = await evidencePass({ inputLog: scaffold, observed, channel: 0, knowledge, cache: new Map() });
      const line = String(cutoff?.observed || '').split('|');
      if (line[1] !== '-damage' || !line[2]?.startsWith(side) || !line[2].endsWith(`: ${set.name || set.species}`)) continue;
      const id = `${side}:${i}|hp`;
      return cutoff.reads.includes(id) ? null
        : `the evidence pass stopped on ${cutoff.observed} in ${READS_BATTLE} with ${set.name || set.species}'s HP and defences emptied, and handed on the reads [${cutoff.reads.join(', ')}], without ${id}. The fallback's probe order lost what the hit read: see turnReads in evidence.mjs.`;
    }
  }
  return `no Pokemon of ${READS_BATTLE} with its HP and defences emptied stops the evidence pass on a damage line it takes. Pick another battle for READS_BATTLE in scripts/local-check.mjs.`;
}

if (fs.existsSync(configPath)) {
  const content = fs.readFileSync(configPath, 'utf-8');
  if (!content.includes("'127.0.0.1'") && !content.includes('"127.0.0.1"')) {
    console.error('FAIL: bindaddress is not 127.0.0.1');
    process.exit(1);
  }
} else {
  console.error('FAIL: config.js not found.');
  process.exit(1);
}

// Every action kind the simulator queues is one the order reader reads or sets
// aside on purpose
if (!fs.existsSync(queuePath)) {
  console.error(`FAIL: ${QUEUE} not found.`);
  process.exit(1);
}
const kindFailures = actionKindFailures(fs.readFileSync(queuePath, 'utf-8'), ACTION_KINDS);
if (kindFailures.length) {
  for (const failure of kindFailures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`PASS: every action kind the simulator queues is read (${ACTION_KINDS.read.length}) or ignored with a reason (${Object.keys(ACTION_KINDS.ignored).length}) by the order reader.`);

// A search stopped on a damage line is told what the line's hit read.
const readsFail = await readsFailure();
if (readsFail) {
  console.error(`FAIL: ${readsFail}`);
  process.exit(1);
}
console.log(`PASS: the evidence pass hands a search stopped on a damage line the stats its hit read (${READS_BATTLE}).`);

// Test format loading dynamically from the provisioned runtime
import('file://' + path.join(RUNTIME_DIR, 'dist', 'sim', 'dex.js')).then((mod) => {
  const Dex = mod.default.Dex;
  const format = Dex.formats.get('gen9championsvgc2026regmc');
  if (!format.exists) {
    console.error('FAIL: Format gen9championsvgc2026regmc not found in the simulator.');
    process.exit(1);
  }
  console.log('PASS: loopback configuration and format verification successful.');
  process.exit(0);
}).catch(err => {
  console.error('Error verifying format:', err);
  process.exit(1);
});
