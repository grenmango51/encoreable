/**
 * Evidence catalog - what every effect Reg M-C allows lets a replay show about a
 * hidden Pokemon, and whether the inference uses it (docs/evidence-catalog.md).
 *
 * The simulator decides everything. For every legal move, ability, item,
 * condition and nature this builds small battles in the real format, sets one
 * Stat Point of the hidden Pokemon to 0 and then to 32, and records which lines
 * of the known side's view change. A control - the same battle with the effect
 * taken out - says which of those changes the battle makes on its own. Each
 * world with a change left is then handed to `inferSpreads` exactly as
 * `npm run reconstruct -- --infer p2` hands it a replay, to ask whether the
 * inference tells the two worlds apart. The same battles, read by
 * `setsFromLog` the way a replay with no team sheet is read, say what the log
 * names and where it puts it, and a fixed battery of witness battles says what
 * an item, ability or nature changes in the log without naming itself - and
 * whether today's assumption about it then removes the real spread.
 *
 * Nothing here fixes what it finds. The two reports it writes are the list of
 * what to fix: docs/evidence-open-sheets.md and docs/evidence-closed-sheets.md.
 *
 * Usage:
 *   npm run catalog                              every effect; writes both reports
 *   npm run catalog -- --only move:gyroball,item:choicescarf --out <dir>
 *   npm run catalog -- --check                   a full run, compared with the reports
 *   npm run catalog -- --dump move:counter user-hidden/before def 32
 *                                                the battle behind one row, and its rebuild
 *
 * Flags: --pool --list --only <ids> --kind <kind> --sheets open|closed --inputs <file>
 *        --out <dir> --no-coverage --check --threads <n> --verbose --records <file>...
 *        --dump <effect> <role/template> <stat|-> <0|32> [--control] [--hazard]
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { battleLines } from './lib/protocol.mjs';
import './lib/rng-control.mjs';
import { inferSpreads } from './lib/inference/infer.mjs';
import { setsFromLog } from './lib/replay-source.mjs';

const require = createRequire(import.meta.url);
const { Battle, BattleStream, Dex, Teams, TeamValidator, toID } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const FIXTURE = require('./fixtures/catalog.js');

const ROOT = process.cwd();
const FORMAT = 'gen9championsvgc2026regmc';
const SEED = '1,2,3,4';
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_NAME = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const KINDS = ['move', 'ability', 'item', 'condition', 'nature'];
const WORKER_ROLE = 'catalog-worker';
const OPEN_REPORT = 'docs/evidence-open-sheets.md';
const CLOSED_REPORT = 'docs/evidence-closed-sheets.md';

/** Every Stat Point at 2, the base the probe varies one stat around. */
const BASE = Object.fromEntries(STATS.map(s => [s, 2]));
const world = (stat, value) => ({ ...BASE, [stat]: value });

const dex = Dex.forFormat(FORMAT);

// ------------------------------------------------------------------ the pool

/**
 * The legal pool, from the validator rather than from `isNonstandard`: every
 * species that passes `checkSpecies`, their ability slots, every move one of
 * them can learn, every item one of them can hold. Formes that exist only in
 * battle (Megas, and the like) are not brought, so they are left out; their
 * Stones are items like any other. Conditions are reached from the effects
 * themselves - the data fields that name one, and the handlers that set one.
 */
function buildPool() {
  const validator = TeamValidator.get(FORMAT);
  const blank = (s, extra = {}) => ({
    name: s.name, species: s.name, item: '', ability: s.abilities[0] || '', moves: [], nature: 'Serious',
    evs: {}, ivs: {}, level: 50, ...extra,
  });
  const species = dex.species.all().filter(s => s.exists && !s.battleOnly && !validator.checkSpecies(blank(s), s, s, {}));
  const users = { move: new Map(), ability: new Map(), item: new Map() };
  const add = (kind, id, holder) => {
    if (!users[kind].has(id)) users[kind].set(id, new Set());
    users[kind].get(id).add(holder);
  };
  for (const s of species) {
    for (const name of Object.values(s.abilities)) {
      const ability = dex.abilities.get(name);
      if (ability.exists) add('ability', ability.id, s.id);
    }
  }
  for (const move of dex.moves.all()) {
    if (!move.exists) continue;
    for (const s of species) if (!validator.checkCanLearn(move, s)) add('move', move.id, s.id);
  }
  for (const item of dex.items.all()) {
    if (!item.exists) continue;
    for (const s of species) if (!validator.checkItem(blank(s, { item: item.name }), item, {})) add('item', item.id, s.id);
  }

  // Weight is how many legal Pokemon can use an effect, until usage data
  // replaces it (plan.md §10). Every species can hold a Mega Stone or an item
  // made for one species, but only that species gets anything from it.
  const effects = [];
  for (const kind of ['move', 'ability', 'item']) {
    const table = { move: dex.moves, ability: dex.abilities, item: dex.items }[kind];
    for (const [id, holders] of users[kind]) {
      const data = table.get(id);
      const locked = kind === 'item' ? [data.megaEvolves, ...(data.itemUser || [])].filter(Boolean).map(s => dex.species.get(s).id) : [];
      const using = locked.length ? [...holders].filter(s => locked.some(l => s === l || dex.species.get(s).baseSpecies === dex.species.get(l).baseSpecies)) : [...holders];
      effects.push({
        key: `${kind}:${id}`, kind, id, name: data.name, weight: using.length, users: [...holders].sort(),
        ...(kind === 'move' ? { category: data.category, type: data.type } : {}),
      });
    }
  }

  const creators = new Map();
  for (const e of effects) {
    for (const c of conditionsOf(e.kind, e.id)) {
      if (!creators.has(c)) creators.set(c, new Set());
      creators.get(c).add(e.key);
    }
  }
  const weightOf = new Map(effects.map(e => [e.key, e.weight]));
  for (const [id, from] of creators) {
    const setters = [...from].sort();
    effects.push({
      key: `condition:${id}`, kind: 'condition', id, name: dex.conditions.get(id).name || id,
      weight: setters.reduce((t, k) => t + (weightOf.get(k) || 0), 0), users: setters,
    });
  }
  for (const nature of dex.natures.all()) {
    effects.push({
      key: `nature:${nature.id}`, kind: 'nature', id: nature.id, name: nature.name, weight: 1, users: [],
      plus: nature.plus || null, minus: nature.minus || null,
    });
  }
  effects.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.id.localeCompare(b.id));
  return { species: species.map(s => s.id), effects };
}

/** Results that depend only on the data, worked out once per effect. */
const once = (fn) => {
  const memo = new Map();
  return (kind, id) => {
    const key = `${kind}:${id}`;
    if (!memo.has(key)) memo.set(key, fn(kind, id));
    return memo.get(key);
  };
};

/** The conditions one effect creates, by data field or by the call that sets one. */
const conditionsOf = once((kind, id) => {
  const data = { move: dex.moves, ability: dex.abilities, item: dex.items }[kind].get(id);
  const out = new Set();
  const put = (name) => {
    if (!name || typeof name !== 'string') return;
    const c = dex.conditions.get(name);
    if (c.exists) out.add(c.id);
  };
  const fields = obj => {
    if (!obj) return;
    for (const f of ['weather', 'terrain', 'pseudoWeather', 'sideCondition', 'slotCondition', 'status', 'volatileStatus']) put(obj[f]);
  };
  fields(data);
  fields(data.self);
  fields(data.secondary);
  for (const s of data.secondaries || []) { fields(s); fields(s.self); }
  const call = /(?:setWeather|setTerrain|addPseudoWeather|addSideCondition|addSlotCondition|trySetStatus|setStatus|addVolatile)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const { source } of handlersOf(data)) {
    for (const m of source.matchAll(call)) put(m[1]);
  }
  return out;
});

// ------------------------------------------------------------ the static scan

/** Every handler of an effect, and of the condition a move carries, as source. */
function handlersOf(data) {
  const out = [];
  const walk = (obj, prefix) => {
    for (const [name, value] of Object.entries(obj || {})) {
      if (typeof value === 'function') out.push({ name: `${prefix}${name}`, source: value.toString() });
    }
  };
  walk(data, '');
  walk(data?.condition, 'condition.');
  return out;
}

const READS = [
  ['maxhp', /\b(?:base)?[mM]axhp\b/, 'hp'],
  ['hp', /\.hp\b/, 'hp'],
  ['getStat', /\bgetStat\(\s*['"`](\w+)/g, null],
  ['storedStats', /\bstoredStats(?:\.(\w+)|\[['"`](\w+)['"`]\])/g, null],
  ['speed', /\.speed\b|\bgetActionSpeed\b/, 'spe'],
  ['calculateStat', /\bcalculateStat\(\s*['"`](\w+)/g, null],
];
const WRITES_STATS = /storedStats(?:\.\w+|\[[^\]]+\])\s*=[^=]|\btransformInto\(/;

/**
 * What an effect's handlers read and write, from their source on the merged
 * `champions` data. A read the probe saw no change for is flagged on the card:
 * either the effect did not reach it in these battles, or it truly shows nothing.
 */
const scan = once((kind, id) => {
  const table = { move: dex.moves, ability: dex.abilities, item: dex.items, condition: dex.conditions }[kind];
  const data = table?.get(id);
  if (!data?.exists) return { handlers: [], reads: [], stats: [], moved: [], types: [], superEffective: false };
  const handlers = handlersOf(data);
  const reads = new Set();
  const stats = new Set();
  const stored = new Set();
  const types = new Set();
  for (const { source } of handlers) {
    for (const [name, re, stat] of READS) {
      if (re.global) {
        for (const m of source.matchAll(re)) {
          const found = m[1] || m[2];
          const s = STATS.includes(found) ? found : null;
          reads.add(s ? `${name}:${s}` : name);
          if (s) stats.add(s);
          if (s && name === 'storedStats') stored.add(s);
        }
      } else if (re.test(source)) {
        reads.add(name);
        if (stat) stats.add(stat);
      }
    }
    for (const m of source.matchAll(/\.type === ['"`](\w+)['"`]|hasType\(['"`](\w+)['"`]\)|type === ['"`](\w+)['"`]/g)) {
      const t = m[1] || m[2] || m[3];
      if (dex.types.get(t).exists) types.add(dex.types.get(t).name);
    }
  }
  // The stats it moves between Pokemon: the stored stats it writes, or all
  // but HP for one that transforms its user.
  const writes = handlers.filter(h => WRITES_STATS.test(h.source));
  const moved = writes.some(h => /transformInto\(/.test(h.source)) ? STATS.filter(s => s !== 'hp')
    : writes.length ? STATS.filter(s => stored.has(s)) : [];
  return {
    handlers: handlers.map(h => h.name),
    reads: [...reads].sort(),
    stats: STATS.filter(s => stats.has(s)),
    moved,
    types: [...types].sort(),
    superEffective: handlers.some(h => /typeMod\s*>\s*0|getEffectiveness\([^)]*\)\s*>\s*0/.test(h.source)),
  };
});

// ------------------------------------------------------------- the battles

/**
 * Dice, fixed by rule rather than by ordinal, so a perturbation that changes how
 * many draws a turn takes does not shift the rest: every move hits, none crits,
 * every roll is the highest, and every chance a probed effect takes comes up.
 * A confused Pokemon hits itself, a paralysed one moves, a sleeper stays asleep,
 * and the hidden Pokemon wins every speed tie it is in. The witness hits never
 * proc, so their own secondaries stay out of the way.
 */
function diceFor(quietMoves, hiddenName) {
  return [
    ...[...new Set(quietMoves)].map(m => `noproc any ${toID(m)} -`),
    'hit any - -', 'nocrit any - -', 'maxdmg any - -', 'confused any - -', 'nopara any - -', 'stay any - -',
    'protect any - -', `wins p2:${toID(hiddenName)} - -`, 'proc any - -',
  ];
}

/**
 * Counts every handler call, per effect, while one battle runs: the listeners
 * `runEvent` collects, and every `singleEvent` whose effect has that handler.
 * The data objects themselves are frozen, so the listeners are what is wrapped.
 */
function countHandlers(battle) {
  const calls = new Map();
  const count = (effect) => {
    if (!effect?.id) return;
    const kind = { Move: 'move', Ability: 'ability', Item: 'item' }[effect.effectType] || 'condition';
    const key = `${kind}:${effect.id}`;
    calls.set(key, (calls.get(key) || 0) + 1);
  };
  const find = battle.findEventHandlers;
  battle.findEventHandlers = function (...args) {
    const handlers = find.apply(this, args);
    for (const h of handlers) {
      if (typeof h.callback !== 'function') continue;
      const { callback, effect } = h;
      h.callback = function (...a) { count(effect); return callback.apply(this, a); };
    }
    return handlers;
  };
  const single = battle.singleEvent;
  battle.singleEvent = function (eventid, effect, ...rest) {
    if (effect && typeof effect[`on${eventid}`] === 'function') count(effect);
    return single.call(this, eventid, effect, ...rest);
  };
  return calls;
}

/**
 * A choice that the battle will take for a side whose scripted one it refused:
 * the scripted move where it is still selectable, otherwise the first move that
 * is, aimed at the foe in slot a; `pass` for a slot with nothing to do.
 */
function fallbackChoice(side, wanted) {
  const req = side.activeRequest;
  if (!req?.active) return 'default';
  const parts = String(wanted || '').split(',').map(s => s.trim());
  return req.active.map((slot, i) => {
    const mon = side.active[i];
    if (!mon || mon.fainted || !slot) return 'pass';
    const usable = slot.moves.filter(m => !m.disabled);
    if (!usable.length) return 'pass';
    const want = /^move (\S+)/.exec(parts[i] || '')?.[1];
    const move = usable.find(m => m.id === want) || usable[0];
    const needs = ['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf'].includes(move.target);
    return `move ${move.id}${needs ? (move.target === 'adjacentAlly' ? ' -2' : move.target === 'adjacentAllyOrSelf' ? ' -1' : ' 1') : ''}`;
  }).join(', ');
}

/** The switch-ins a side owes after a faint or a pivot: the first Pokemon able to come in. */
function forcedChoice(side) {
  const req = side.activeRequest;
  const taken = new Set();
  return req.forceSwitch.map((must, i) => {
    if (!must) return 'pass';
    const at = req.side.pokemon.findIndex((p, j) => j >= req.forceSwitch.length && !taken.has(j) && !p.condition.endsWith(' fnt') && !p.active);
    if (at < 0) return 'pass';
    taken.add(at);
    return `switch ${at + 1}`;
  }).join(', ');
}

/**
 * One battle of a template, in-process and in the real format, with the hidden
 * Pokemon on `evs`. Returns the two channels a replay can be read from - the
 * known side's (1) and a spectator's (0) - and the omniscient one, where every
 * HP is exact, as raw lines; the draw count; and every refused choice, so a
 * template that did not play as written says so.
 */
async function runBattle(template, evs, { watch = false, speedAt = null } = {}) {
  const teams = [template.p1, template.p2.map((set, i) => (i === 0 ? { ...set, evs: { ...evs } } : set))];
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  const refused = [];
  try {
    await stream.write(`>start ${JSON.stringify({ formatid: FORMAT, seed: SEED })}`);
    const battle = stream.battle;
    const calls = watch ? countHandlers(battle) : null;
    await stream.write(`>player p1 ${JSON.stringify({ name: 'Known', team: Teams.pack(teams[0]) })}`);
    await stream.write(`>player p2 ${JSON.stringify({ name: 'Hidden', team: Teams.pack(teams[1]) })}`);
    for (const rule of template.dice) await stream.write(`>rng force ${rule}`);
    // Draws taken to break speed ties are counted apart: a tie the rules
    // settle is not a die that differs between two worlds.
    const prng = battle.prng;
    const shuffle = prng.shuffle;
    let tieDraws = 0;
    prng.shuffle = function (...args) {
      const before = battle.__rng.draws;
      try { return shuffle.apply(this, args); } finally { tieDraws += battle.__rng.draws - before; }
    };
    for (const [i, team] of teams.entries()) await stream.write(`>p${i + 1} team ${team.map((_, j) => j + 1).join('')}`);
    const settle = async () => {
      for (let guard = 0; guard < 8 && !battle.ended; guard++) {
        const owing = battle.sides.filter(s => s.activeRequest?.forceSwitch && !s.isChoiceDone());
        if (!owing.length) return;
        for (const side of owing) await stream.write(`>${side.id} ${forcedChoice(side)}`);
      }
    };
    // The hidden Pokemon's Speed as the simulator has it at the start of one
    // turn, boosts and modifiers included, for a pace template's pacer.
    let speed = null;
    const measure = () => { speed = battle.p2.active[0] && !battle.p2.active[0].fainted ? battle.p2.active[0].getStat('spe') : null; };
    for (const [t, turn] of template.turns.entries()) {
      if (battle.ended) break;
      if (speedAt === t + 1) measure();
      for (const side of battle.sides) {
        if (battle.ended || side.isChoiceDone() || side.activeRequest?.wait) continue;
        const choice = turn[side.id] || 'default';
        await stream.write(`>${side.id} ${choice}`);
        if (side.choice.error) {
          const fallback = fallbackChoice(side, choice);
          refused.push({ turn: t + 1, side: side.id, choice, error: side.choice.error.replace(/^\[[^\]]+\]\s*/, ''), fallback });
          await stream.write(`>${side.id} ${fallback}`);
          if (side.choice.error) await stream.write(`>${side.id} default`);
        }
      }
      await settle();
    }
    if (speedAt > template.turns.length) measure();
    const channels = extractChannelMessages(battle.log.join('\n'), [1, 0, -1]);
    return { ch1: channels[1], ch0: channels[0], all: channels[-1], draws: (battle.__rng?.draws ?? 0) - tieDraws, calls, refused, ended: battle.ended, speed };
  } catch (err) {
    return { error: err.message, ch1: [], ch0: [], all: [], draws: 0, calls: null, refused };
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
}

const runCache = new Map();
/** Battles are pure functions of their recipe, so a control shared by many effects runs once. */
function cachedRun(template, evs) {
  const sig = JSON.stringify([template.p1, template.p2, template.turns, template.dice, evs]);
  if (!runCache.has(sig)) {
    if (runCache.size > 6000) runCache.clear();
    runCache.set(sig, runBattle(template, evs));
  }
  return runCache.get(sig);
}

// --------------------------------------------------------- reading a log

const HP_FIELD = { '-damage': 3, '-heal': 3, '-sethp': 3, switch: 4, drag: 4, replace: 4 };
const ACTION = new Set(['move', 'cant', 'switch', 'drag', 'detailschange', '-mega']);

/** `p2a: Blastoise` -> `p2a`, and the side. */
const slotOf = ident => /^(p[1-4][a-d]?)/.exec(String(ident || ''))?.[1] || '';
const sideOf = ident => String(ident || '').slice(0, 2);

/** `[from] item: Leftovers` -> `item:leftovers`; `[from] brn` -> `brn`. */
function fromTag(parts) {
  const tag = parts.find(p => p.startsWith('[from]'));
  if (!tag) return null;
  const text = tag.slice(6).trim();
  const m = /^(move|item|ability): *(.*)$/i.exec(text);
  return m ? `${m[1].toLowerCase()}:${toID(m[2])}` : toID(text);
}

/**
 * What a line announces by name, as a printer: `-ability|p2a: X|Intimidate` is
 * Intimidate's, `-enditem|p2a: X|Sitrus Berry` the Berry's.
 */
function namedPrinter(parts) {
  const kind = parts[1];
  if (['-ability', '-item', '-enditem'].includes(kind) && parts[3]) return `from:${kind === '-ability' ? 'ability' : 'item'}:${toID(parts[3])}`;
  const m = /^(move|item|ability): *(.*)$/i.exec(parts[3] || '');
  if (['-activate', '-start', '-end', '-singleturn', '-singlemove'].includes(kind) && m) return `from:${m[1].toLowerCase()}:${toID(m[2])}`;
  return null;
}

/**
 * A log as the probe compares it. Each line gets a key that says when and by
 * what it was printed - the turn, the action or effect that printed it, its
 * kind, the Pokemon it names, and how many such lines came before - so one
 * extra line never shifts every line after it. The turn's phases come from the
 * blank separators the simulator prints before the actions and before the
 * residual effects. Within an action every line is the action's unless it
 * carries `[from]`; outside one, a line with no tag belongs to the effect the
 * line before it named - Leech Seed's heal to its drain. Each turn also keeps,
 * per phase, the order its units came in: a unit is one Pokemon's action, or
 * one effect on one Pokemon.
 */
function readLog(raw) {
  const entries = new Map();
  const units = new Map();
  const count = new Map();
  const lastHp = new Map();
  let turn = 0;
  let phase = 'start';
  let ctx = 'start';
  for (const line of raw) {
    if (line === '|') {
      if (phase === 'pre') phase = 'actions';
      else if (phase === 'actions') { phase = 'residual'; ctx = 'residual'; }
      continue;
    }
    const parts = line.split('|');
    const kind = parts[1];
    if (kind === 'turn') { turn = Number(parts[2]); phase = 'pre'; ctx = 'turn'; continue; }
    if (kind === 'upkeep') { phase = 'post'; ctx = 'post'; continue; }
    if (!battleLines([line]).length) continue;
    const who = parts[2] || '';
    const from = fromTag(parts);
    if (ACTION.has(kind) && !from && /^p[1-4][a-d]: /.test(who)) {
      const what = kind === 'move' ? toID(parts[3]) : kind === 'cant' ? 'cant' : kind;
      ctx = `${who}>${what}`;
    }
    const inAction = phase === 'actions' && ctx.includes('>');
    const printer = from ? `from:${from}` : (!inAction && namedPrinter(parts)) || ctx;
    if (!inAction && printer.startsWith('from:')) ctx = printer;
    const actor = inAction ? ctx : printer;
    const unit = `${phase}|${actor.includes('>') ? actor.slice(0, actor.indexOf('>')) : `${actor}@${slotOf(who)}`}`;
    if (!units.has(turn)) units.set(turn, []);
    if (!units.get(turn).includes(unit)) units.get(turn).push(unit);
    const base = `${turn}|${printer}|${kind}|${who}`;
    const n = count.get(base) || 0;
    count.set(base, n + 1);
    const at = HP_FIELD[kind];
    const field = at === undefined ? null : String(parts[at] || '');
    const token = field === null ? null : field.split(' ')[0];
    const shape = at === undefined ? line : parts.map((p, i) => (i === at ? '*' : p)).join('|');
    // How far this line moved its Pokemon's HP, and out of what, where the log
    // states HP exactly.
    let moved = null;
    let max = null;
    if (token !== null) {
      const [hp, of] = token.split('/').map(Number);
      max = of || null;
      const mon = `${sideOf(who)}:${who.slice(who.indexOf(': ') + 2)}`;
      if (lastHp.has(mon)) moved = hp - lastHp.get(mon);
      lastHp.set(mon, hp);
    }
    entries.set(`${base}|${n}`, { key: `${base}|${n}`, pos: entries.size, turn, printer, kind, who, line, token, field, shape, moved, max });
  }
  return { entries, units };
}

/**
 * Where two worlds part because a Pokemon faints in one of them only: the
 * position, in each world, of the HP line that knocked it out (printed in both,
 * as `0 fnt` in one), or else of the start of that turn.
 */
function knockout(a, b, keys) {
  const faintKey = keys.find(k => (a.entries.get(k) || b.entries.get(k)).kind === 'faint' && !(a.entries.has(k) && b.entries.has(k)));
  if (!faintKey) return null;
  const f = a.entries.get(faintKey) || b.entries.get(faintKey);
  const fnt = e => / fnt$/.test(e.field || '');
  const ko = keys.find((k) => {
    const x = a.entries.get(k);
    const y = b.entries.get(k);
    return x && y && x.turn === f.turn && x.who === f.who && fnt(x) !== fnt(y);
  });
  if (ko) return [a.entries.get(ko).pos, b.entries.get(ko).pos];
  const start = r => [...r.entries.values()].find(e => e.turn === f.turn)?.pos ?? Infinity;
  return [start(a), start(b)];
}

/**
 * Every line two worlds print differently: a changed HP figure, a line whose
 * other content changed, a line printed in one world only, and units of one
 * turn that came in a different order.
 */
function diffLogs(a, b) {
  const out = [];
  const keys = [...a.entries.keys(), ...[...b.entries.keys()].filter(k => !a.entries.has(k))];
  // Once a Pokemon faints in one world only, every line one world prints and
  // the other does not after the hit that knocked it out is a consequence of
  // that knockout, not a line of its own. The knockout is kept.
  const cut = knockout(a, b, keys);
  const after = (x, y) => cut && (x ? x.pos > cut[0] : y.pos > cut[1]);
  for (const key of keys) {
    const x = a.entries.get(key);
    const y = b.entries.get(key);
    if (x && y && x.line === y.line) continue;
    const e = x || y;
    const type = !x || !y ? 'presence' : x.shape === y.shape && x.token !== y.token ? 'hp' : 'content';
    if (type === 'presence' && e.kind !== 'faint' && after(x, y)) continue;
    out.push({ key, type, turn: e.turn, printer: e.printer, kind: e.kind, who: e.who, at0: x?.line ?? null, at32: y?.line ?? null });
  }
  for (const [turn, list] of a.units) {
    const other = b.units.get(turn) || [];
    const both = list.filter(u => other.includes(u));
    for (let i = 0; i < both.length; i++) {
      for (let j = i + 1; j < both.length; j++) {
        if (other.indexOf(both[i]) < other.indexOf(both[j])) continue;
        const [u, v] = [both[i], both[j]].sort();
        const shown = unit => unit.slice(unit.indexOf('|') + 1);
        out.push({
          key: `${turn}|order|${u}|${v}`, type: 'order', turn, printer: 'order', kind: 'order', who: '',
          at0: `${shown(both[i])} before ${shown(both[j])}`, at32: `${shown(both[j])} before ${shown(both[i])}`,
        });
      }
    }
  }
  return out;
}

/**
 * The difference of differences. A change the control makes too, line for
 * line, is the battle's, not the effect's. So is an HP line that only repeats
 * an earlier difference, read off the omniscient channel, where every HP is
 * exact: one that moves its Pokemon by the same amount out of the same max HP
 * in both worlds, so it differs only because it started from other HP (Leech
 * Seed's eighth of the known Pokemon's HP, after a hit that left it lower); and
 * one the control also prints that moves by the same amounts there as here (a
 * hit after Super Fang lands on half the HP, and says no more than the same hit
 * from full).
 *
 * `exact` holds the omniscient reads of the effect's two worlds and the
 * control's, in that order.
 */
function effectChanges(inEffect, inControl, exact) {
  const control = new Map(inControl.map(c => [`${c.type}|${c.key}`, c]));
  const [e0, e32, c0, c32] = exact;
  const out = [];
  for (const c of inEffect) {
    const d = control.get(`${c.type}|${c.key}`);
    if (d && d.at0 === c.at0 && d.at32 === c.at32) continue;
    if (c.type === 'hp') {
      const at = x => x?.entries.get(c.key) || null;
      const [x, y] = [at(e0), at(e32)];
      if (x && y && x.moved !== null && x.moved === y.moved && x.max === y.max) continue;
      if (at(c0) && at(c32) && x?.moved === at(c0).moved && y?.moved === at(c32).moved) continue;
    }
    out.push({ ...c, inControl: !!d });
  }
  return out;
}

/**
 * Whether the effect printed a change itself - its own action, its own `[from]`
 * tag, or a line that names it - or only changed a line something else printed
 * (`modified`): a hit that lands harder after Swords Dance, or through the
 * other defence under Wonder Room. The conditions an effect creates print for
 * it: a burn's damage is Will-O-Wisp's. An order that turns on the stat with the
 * effect and not without it is the effect's own.
 */
function printedBy(effect, c) {
  if (c.type === 'order') return !c.inControl;
  if (effect.kind === 'nature') return false;
  const prefix = { move: 'move', item: 'item', ability: 'ability' }[effect.kind];
  const made = [...conditionsOf(effect.kind, effect.id)];
  const mine = p => p === `from:${prefix}:${effect.id}` || p === `from:${effect.id}` || made.some(id => p === `from:${id}` || p === `from:move:${id}`)
    || (effect.kind === 'move' && p.endsWith(`>${effect.id}`));
  if (mine(c.printer)) return true;
  const names = line => String(line || '').split('|').some(f => f === effect.name || f === `${prefix}: ${effect.name}`);
  return names(c.at0) || names(c.at32);
}

// ------------------------------------------------------------- the cast

const QUIET_TURN = { p1: 'move splash, move splash', p2: 'move splash, move splash' };
const TARGETS_FOE = new Set(['normal', 'any', 'adjacentFoe', 'allAdjacentFoes', 'allAdjacent', 'randomNormal', 'foeSide']);
const baseName = species => dex.species.get(species).baseSpecies;
const HIDDEN_CAST = new Set([FIXTURE.cast.hiddenAlly.species, FIXTURE.cast.hiddenBench.species].map(s => toID(baseName(s))));

const castSet = (key, moves) => ({ ...FIXTURE.cast[key], evs: { ...FIXTURE.cast[key].evs }, moves: [...new Set(moves)].slice(0, 4) });

/** The hidden Pokemon's ally and bench, with the spare in place of one that shares its name. */
const hiddenMates = (species) => ['hiddenAlly', 'hiddenBench']
  .map(key => (baseName(FIXTURE.cast[key].species) === species.baseSpecies ? 'hiddenSpare' : key))
  .map(key => castSet(key, ['Splash']));
const bulk = s => s.baseStats.hp + s.baseStats.def + s.baseStats.spd;
const genderOf = s => (s.gender === 'M' || s.gender === 'F' ? s.gender : s.gender === 'N' ? '' : 'F');
const quiet = new Set(FIXTURE.quietAbilities);
/** The first quiet ability a species has, or Run Away, for a hidden Pokemon whose ability the probe is not about. */
const quietAbility = (s) => {
  const own = Object.values(s.abilities);
  return FIXTURE.quietAbilities.find(a => own.includes(a)) || 'Run Away';
};
/** The ability a replay with no team sheet assumes: the first the species lists. */
const firstAbility = s => Object.values(s.abilities)[0];
const immune = (moveName, speciesName) => {
  const move = dex.moves.get(moveName);
  return move.category !== 'Status' && !dex.getImmunity(move.type, dex.species.get(speciesName));
};
const firstHit = (list, target) => list.find(m => !immune(m, target)) || list[0];

/**
 * The hidden Pokemon for a move or an ability, chosen by a fixed rule so every
 * run picks the same one: among the legal users, one fast enough that the cast
 * never races it (base Speed 36 or more), with a quiet ability (for an item's
 * or a nature's holder, a quiet first ability), the bulkiest, and then by id.
 * None of the hidden cast's own species, so no two Pokemon on the hidden side
 * share a name.
 */
function pickUser(ids, { anyAbility = false, firstQuiet = false } = {}) {
  const pool = ids.map(id => dex.species.get(id)).filter(s => s.exists && !HIDDEN_CAST.has(toID(s.baseSpecies)) && !s.requiredItem);
  const calm = s => (anyAbility ? 1 : firstQuiet ? Number(quiet.has(firstAbility(s))) : Number(Object.values(s.abilities).some(a => quiet.has(a))));
  const score = s => [s.baseStats.spe >= 36 ? 1 : 0, calm(s), bulk(s)];
  pool.sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || a.id.localeCompare(b.id);
  });
  return pool[0] || null;
}

// A set named after its species prints under the base species' name, so the
// truth is written the way the log will show it.
const hiddenFrom = (species, ability, item, moves) => ({
  name: species.baseSpecies, species: species.name, gender: genderOf(species), ability, item, nature: 'Serious', level: 50,
  evs: { ...BASE }, moves: [...new Set(moves)].slice(0, 4),
});

/** A move's aim in a choice: its foe in slot a, itself, or its ally. */
function aim(move) {
  if (['normal', 'any', 'adjacentFoe'].includes(move.target)) return ' 1';
  if (move.target === 'adjacentAlly') return ' -2';
  if (move.target === 'adjacentAllyOrSelf') return ' -1';
  return '';
}

// ------------------------------------------------------------ templates

/**
 * A move's auto templates, per role. The hidden Pokemon uses it
 * (`user-hidden`), or the known side uses it and the hidden Pokemon is what it
 * acts on or lives with (`target-hidden`: a move that can reach a foe, or one
 * that sets up the field or a side):
 *
 *   quiet   the move, then three turns of Splash - what it does by itself
 *   before  its user is halved first (Super Fang says nothing about Stat
 *           Points), then takes a +1 priority hit and uses the move - for a
 *           move that answers damage taken, or heals what was lost
 *   after   the move, then the known actor hits the hidden one and the hidden
 *           one hits back - for a move whose mark shows in a later hit
 *   pace    the move, with the known actor one point of Speed faster than the
 *           hidden Pokemon is after it - for a move that changes turn order
 *   pivot   (target hidden) the move, then the hidden Pokemon switches out and
 *           back in - for a hazard, or anything that meets it on the way in
 *
 * The control is the same battle with the move replaced by Splash.
 */
function moveTemplates(effect) {
  const move = dex.moves.get(effect.id);
  const reachesHidden = TARGETS_FOE.has(move.target) || ['all', 'allySide'].includes(move.target);
  const roles = ['user-hidden', ...(reachesHidden ? ['target-hidden'] : [])];
  const answers = handlersOf(move).some(h => /["'`]Special["'`]|lastDamagedBy/.test(h.source));
  const learner = pickUser(effect.users);
  const W = FIXTURE.witnessMoves;
  const out = [];
  for (const role of roles) {
    const userHidden = role === 'user-hidden';
    const hiddenSpecies = userHidden && learner ? learner : dex.species.get(FIXTURE.cast.hidden.species);
    const hiddenAbility = userHidden && learner ? quietAbility(learner) : FIXTURE.cast.hidden.ability;
    const knownKey = userHidden && immune(move.name, FIXTURE.cast.known.species) ? 'knownAlt' : 'known';
    const knownName = FIXTURE.cast[knownKey].species;
    const names = ['quiet', 'before', ...(answers ? ['before-special'] : []), 'after', 'pace', ...(userHidden ? [] : ['pivot'])];
    for (const name of names) {
      const toHidden = firstHit(W.physical, hiddenSpecies.name);
      const toKnown = firstHit(W.physical, knownName);
      const prio = name === 'before-special' ? W.prioritySpecial : W.priorityPhysical;
      const use = `move ${move.id}${aim(move)}`;
      const extra = { p1: [], p2: [] };
      const turns = [];
      const userSide = userHidden ? 'p2' : 'p1';
      const foeSide = userHidden ? 'p1' : 'p2';
      let effectTurn = 1;
      if (name === 'quiet' || name === 'pace') {
        turns.push({ [userSide]: `${use}, move splash`, [foeSide]: 'move splash, move splash' }, QUIET_TURN, QUIET_TURN, QUIET_TURN);
      } else if (name.startsWith('before')) {
        const halve = firstHit(W.halving, userHidden ? hiddenSpecies.name : knownName);
        extra[foeSide].push(halve, prio);
        turns.push(
          { [userSide]: 'move splash, move splash', [foeSide]: `move ${toID(halve)} 1, move splash` },
          { [userSide]: `${use}, move splash`, [foeSide]: `move ${toID(prio)} 1, move splash` },
          QUIET_TURN, QUIET_TURN,
        );
        effectTurn = 2;
      } else if (name === 'pivot') {
        turns.push(
          { [userSide]: `${use}, move splash`, [foeSide]: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'switch 3, move splash' },
          { p1: 'move splash, move splash', p2: 'switch 3, move splash' },
          QUIET_TURN,
        );
      } else {
        extra.p1.push(toHidden);
        extra.p2.push(toKnown);
        turns.push(
          { [userSide]: `${use}, move splash`, [foeSide]: 'move splash, move splash' },
          { p1: `move ${toID(toHidden)} 1, move splash`, p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: `move ${toID(toKnown)} 1, move splash` },
          QUIET_TURN,
        );
      }
      const effectMoves = { p1: userHidden ? [] : [move.name], p2: userHidden ? [move.name] : [] };
      const build = (withMove) => {
        const moves = side => [...(withMove ? effectMoves[side] : []), 'Splash', ...extra[side]];
        return {
          p1: [castSet(knownKey, moves('p1')), castSet('knownAlly', ['Splash']), castSet('knownBench', ['Splash'])],
          p2: [hiddenFrom(hiddenSpecies, hiddenAbility, FIXTURE.cast.hidden.item, moves('p2')), ...hiddenMates(hiddenSpecies)],
          turns: withMove ? turns : turns.map((t, i) => (i === effectTurn - 1 ? { ...t, [userSide]: 'move splash, move splash' } : t)),
          dice: diceFor([...extra.p1, ...extra.p2].filter(m => toID(m) !== move.id), hiddenSpecies.baseSpecies),
        };
      };
      out.push({
        key: `${role}/${name}`, role, name, source: 'auto', why: null, effectTurn,
        user: userHidden ? 'p2a' : 'p1a', moveId: move.id, pace: name === 'pace' ? effectTurn + 1 : null,
        ...build(true), control: build(false),
      });
    }
  }
  return out;
}

/**
 * A pace template's known actor, now that the battle says how fast the hidden
 * Pokemon is once the effect has acted: a pacer one point faster than that, so
 * the order around it turns on the hidden Pokemon's Speed. It takes the known
 * actor's place, moves and all. Null when no pacer reaches that Speed.
 */
async function resolvePace(template) {
  const probe = await runBattle(template, BASE, { speedAt: template.pace });
  if (probe.speed === null || probe.speed === undefined) return null;
  const pacer = pacerAt(probe.speed + 1);
  if (!pacer) return null;
  const swap = t => ({ ...t, p1: [{ ...pacer, moves: t.p1[0].moves }, ...t.p1.slice(1)] });
  return { ...swap(template), control: swap(template.control), paceSpeed: probe.speed + 1 };
}

/** The hidden Pokemon's own Speed stat, from the simulator's stat model. */
let statBattle = null;
function statOf(set, stat) {
  statBattle ||= new Battle({ formatid: FORMAT, seed: SEED });
  const species = dex.species.get(set.species);
  return statBattle.spreadModify(species.baseStats, { ...set, level: 50 })[stat];
}

/** A pacer at exactly `speed`, for the order witnesses, or null when none can reach it. */
function pacerAt(speed) {
  for (const pacer of FIXTURE.pacers) {
    for (let spe = 0; spe <= 32; spe++) {
      const set = { ...pacer, evs: { ...pacer.evs, spe } };
      if (statOf(set, 'spe') === speed) return set;
    }
  }
  return null;
}

/**
 * The hidden holder of an item: its own species for a Mega Stone or an item
 * only one species uses, a species the item's type is super effective on for
 * a resist Berry, and otherwise the cast's hidden Pokemon.
 */
function itemHolder(effect, sc) {
  const item = dex.items.get(effect.id);
  const legal = effect.users.map(id => dex.species.get(id));
  const locked = item.megaEvolves || item.itemUser?.[0];
  if (locked) {
    const s = dex.species.get(locked);
    return legal.find(x => x.id === s.id) || s;
  }
  if (sc.superEffective && sc.types.length) {
    const weak = pickUser(legal.filter(s => sc.types.some(t => dex.getEffectiveness(t, s) > 0 && dex.getImmunity(t, s))).map(s => s.id), { firstQuiet: true });
    if (weak) return weak;
  }
  if (legal.some(s => s.name === FIXTURE.cast.hidden.species)) return dex.species.get(FIXTURE.cast.hidden.species);
  return pickUser(effect.users, { firstQuiet: true }) || dex.species.get(FIXTURE.cast.hidden.species);
}

/**
 * The ability a holder's control has instead: Run Away, which does nothing in a
 * trainer battle. Any other would act somewhere in the battery - Own Tempo stops
 * the confusion witness, Shed Skin cures a status, an announcement prints a
 * line - and the control would differ for reasons of its own.
 */
const baselineAbility = () => 'Run Away';

/**
 * The witness battery, for an item, ability or nature on the hidden Pokemon
 * (`holder-hidden`), or an item or ability on the known actor, acting on the
 * hidden one (`other-hidden`). Each witness is one situation in which such an
 * effect usually shows; the control is the same battle without it. Types the
 * effect's handlers name get a hit of that type each way.
 */
function batteryTemplates(effect) {
  const sc = effect.kind === 'nature' ? { types: [], superEffective: false } : scan(effect.kind, effect.id);
  const out = [];
  const placements = effect.kind === 'nature' ? ['holder-hidden'] : ['holder-hidden', 'other-hidden'];
  for (const role of placements) {
    const holderHidden = role === 'holder-hidden';
    let hiddenSpecies = dex.species.get(FIXTURE.cast.hidden.species);
    if (holderHidden && effect.kind === 'item') hiddenSpecies = itemHolder(effect, sc);
    if (holderHidden && effect.kind === 'ability') hiddenSpecies = pickUser(effect.users, { anyAbility: true }) || dex.species.get(effect.users[0]);
    // The holder of an item or a nature keeps the ability a replay assumes it
    // has, its first, when that one is quiet.
    const hiddenAbilityBase = hiddenSpecies.name === FIXTURE.cast.hidden.species ? FIXTURE.cast.hidden.ability
      : quiet.has(firstAbility(hiddenSpecies)) ? firstAbility(hiddenSpecies) : quietAbility(hiddenSpecies);
    // A known holder of an ability is one of its legal holders, so that a log
    // naming it can be read as that Pokemon's; any species can hold an item.
    const knownCast = new Set([FIXTURE.cast.knownAlly.species, FIXTURE.cast.knownBench.species].map(s => toID(baseName(s))));
    const knownUsers = effect.users.filter(id => !knownCast.has(toID(dex.species.get(id).baseSpecies)));
    const holder = !holderHidden && effect.kind === 'ability' ? pickUser(knownUsers, { anyAbility: true }) || dex.species.get(knownUsers[0] || effect.users[0]) : null;
    const knownBase = holder
      ? { ...FIXTURE.cast.known, name: holder.baseSpecies, species: holder.name, gender: genderOf(holder) || '', ability: baselineAbility() }
      : { ...FIXTURE.cast.known };
    const apply = (withEffect) => {
      const hidden = hiddenFrom(hiddenSpecies, hiddenAbilityBase, '', []);
      const known = { ...knownBase, evs: { ...knownBase.evs } };
      if (effect.kind === 'item') {
        if (holderHidden) hidden.item = withEffect ? effect.name : '';
        else known.item = withEffect ? effect.name : FIXTURE.cast.known.item;
      } else if (effect.kind === 'ability') {
        if (holderHidden) hidden.ability = withEffect ? effect.name : baselineAbility();
        else known.ability = withEffect ? effect.name : knownBase.ability;
      } else if (effect.kind === 'nature') {
        hidden.nature = withEffect ? effect.name : 'Serious';
      }
      return { hidden, known };
    };
    const hiddenName = hiddenSpecies.name;
    const knownName = knownBase.species;
    const physTo = t => firstHit(FIXTURE.witnessMoves.physical, t);
    const specTo = t => firstHit(FIXTURE.witnessMoves.special, t);
    const W = FIXTURE.witnessMoves;
    const hits = (p1, p2) => ({ p1: p1 ? `move ${p1} 1, move splash` : 'move splash, move splash', p2: p2 ? `move ${p2} 1, move splash` : 'move splash, move splash' });
    const witnesses = [
      { name: 'W-phys-dealt', p2: [physTo(knownName)], turns: m => [hits(null, m.p2[0]), QUIET_TURN, QUIET_TURN] },
      { name: 'W-spec-dealt', p2: [specTo(knownName)], turns: m => [hits(null, m.p2[0]), QUIET_TURN, QUIET_TURN] },
      { name: 'W-phys-taken', p1: [physTo(hiddenName)], turns: m => Array(4).fill(hits(m.p1[0], null)) },
      { name: 'W-spec-taken', p1: [specTo(hiddenName)], turns: m => Array(4).fill(hits(m.p1[0], null)) },
    ];
    // Order: a known Pokemon a point faster or slower than the hidden one would
    // be without the effect (what a closed-sheet replay assumes), and one a
    // point faster than it is with the effect, so the order turns on its Speed.
    if (holderHidden) {
      witnesses.push(
        { name: 'W-order-up', offset: +1, turns: () => [QUIET_TURN, QUIET_TURN] },
        { name: 'W-order-down', offset: -1, turns: () => [QUIET_TURN, QUIET_TURN] },
        { name: 'W-pace', pace: 1, turns: () => [QUIET_TURN, QUIET_TURN] },
      );
    }
    if (effect.kind !== 'nature') {
      witnesses.push({ name: 'W-trade', p1: [W.priorityPhysical], p2: [physTo(knownName)], turns: m => [hits(m.p1[0], m.p2[0]), hits(m.p1[0], m.p2[0]), QUIET_TURN] });
      for (const type of sc.types) {
        const [phys] = FIXTURE.hits[type] || [];
        if (!phys) continue;
        witnesses.push(
          { name: `W-${type}-dealt`, p2: [phys], turns: m => [hits(null, m.p2[0]), QUIET_TURN, QUIET_TURN] },
          { name: `W-${type}-taken`, p1: [phys], turns: m => [hits(m.p1[0], null), hits(m.p1[0], null), QUIET_TURN] },
        );
      }
    }
    if (holderHidden && effect.kind !== 'nature') {
      // Given the status, and then attacking on every turn left, so the status
      // shows in what it does to an attack and no Splash is barred by Taunt.
      for (const [status, moveName] of Object.entries(W.status)) {
        witnesses.push({ name: `W-${status}`, p1: [moveName], p2: [physTo(knownName)], turns: m => [hits(m.p1[0], null), hits(null, m.p2[0]), hits(null, m.p2[0]), hits(null, m.p2[0])] });
      }
      witnesses.push(
        { name: 'W-lethal', p1: [firstHit(W.lethal, hiddenName)], turns: m => [hits(m.p1[0], null), QUIET_TURN] },
        { name: 'W-pivot', p1: [physTo(hiddenName)], turns: m => [hits(m.p1[0], null), { p1: 'move splash, move splash', p2: 'switch 3, move splash' }, { p1: 'move splash, move splash', p2: 'switch 3, move splash' }, QUIET_TURN] },
        { name: 'W-two-moves', p2: [physTo(knownName), specTo(knownName)], turns: m => [hits(null, m.p2[0]), hits(null, m.p2[1]), QUIET_TURN] },
      );
    }

    for (const w of witnesses) {
      const ids = { p1: (w.p1 || []).map(toID), p2: (w.p2 || []).map(toID) };
      const turns = w.turns(ids);
      const build = (withEffect) => {
        const { hidden, known } = apply(withEffect);
        let p1a = { ...known, evs: { ...known.evs }, moves: [...new Set(['Splash', ...(w.p1 || [])])].slice(0, 4) };
        if (w.offset) {
          const base = apply(false).hidden;
          const pacer = pacerAt(statOf(base, 'spe') + w.offset);
          if (!pacer) return null;
          p1a = { ...pacer, moves: ['Splash'] };
        }
        const mega = effect.kind === 'item' && holderHidden && withEffect && dex.items.get(effect.id).megaStone;
        return {
          p1: [p1a, castSet('knownAlly', ['Splash']), castSet('knownBench', ['Splash'])],
          p2: [{ ...hidden, moves: [...new Set(['Splash', ...(w.p2 || [])])].slice(0, 4) }, ...hiddenMates(hiddenSpecies)],
          turns: mega ? turns.map((t, i) => (i === 0 ? { ...t, p2: t.p2.replace(/^(move \S+(?: -?\d)?)/, '$1 mega') } : t)) : turns,
          dice: diceFor([...(w.p1 || []), ...(w.p2 || [])], hidden.name),
        };
      };
      const withEffect = build(true);
      const control = build(false);
      if (!withEffect || !control) continue;
      out.push({ key: `${role}/${w.name}`, role, name: w.name, source: 'auto', why: null, effectTurn: 1, user: null, moveId: null, pace: w.pace || null, ...withEffect, control });
    }
  }
  return out;
}

/** A hand-set template from the fixture, with its cast keys filled in and its control patched. */
function fixtureTemplate(effect, t) {
  const side = list => list.map(m => (typeof m === 'string' ? castSet(m, ['Splash']) : { ...m, evs: { ...BASE, ...m.evs }, moves: [...m.moves] }));
  const p1 = side(t.p1);
  const p2 = side(t.p2);
  const moves = [...p1, ...p2].flatMap(s => s.moves).filter(m => m !== 'Splash');
  const patch = (team, fix = []) => team.map((set, i) => ({ ...set, ...(fix[i] || {}) }));
  const turns = t.turns;
  const dice = diceFor(moves.filter(m => toID(m) !== effect.id), p2[0].name);
  const control = t.control ? { p1: patch(p1, t.control.p1), p2: patch(p2, t.control.p2), turns: t.control.turns || turns, dice } : null;
  return {
    key: `${t.role}/${t.name}`, role: t.role, name: t.name, source: 'fixture', why: t.why || null, effectTurn: t.effectTurn || 1,
    user: effect.kind === 'move' ? (t.role === 'user-hidden' ? 'p2a' : 'p1a') : null, moveId: effect.kind === 'move' ? effect.id : null,
    p1, p2, turns, dice, control,
  };
}

/**
 * Every template of an effect. Each set in them is one a real team could hold -
 * at most 32 in a stat and 66 in all - because the inference holds the known
 * side to that budget too, and a set past it would leave nothing possible.
 */
function templatesFor(effect, entry) {
  const auto = effect.kind === 'move' ? moveTemplates(effect)
    : ['item', 'ability', 'nature'].includes(effect.kind) ? batteryTemplates(effect) : [];
  const all = [...auto, ...(entry?.templates || []).map(t => fixtureTemplate(effect, t))];
  for (const t of all) {
    for (const set of [...t.p1, ...t.p2, ...(t.control ? [...t.control.p1, ...t.control.p2] : [])]) {
      const evs = STATS.map(s => set.evs[s] || 0);
      if (evs.some(v => v > 32) || evs.reduce((a, b) => a + b, 0) > 66) throw new Error(`${effect.key} ${t.key}: ${set.name} spends ${evs.join('/')}, past what a team may`);
    }
  }
  return all;
}

// ------------------------------------------------------ the open-sheet probe

/** Which stat a move reads for attack and defence, as the move data says, under Wonder Room if it is up. */
function statsOfHit(moveId, wonderRoom) {
  const move = dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status') return null;
  const physical = move.category === 'Physical';
  let def = move.overrideDefensiveStat || (physical ? 'def' : 'spd');
  if (wonderRoom) def = def === 'def' ? 'spd' : def === 'spd' ? 'def' : def;
  return { off: move.overrideOffensiveStat || (physical ? 'atk' : 'spa'), offByTarget: move.overrideOffensivePokemon === 'target', def };
}

/**
 * The mechanism a change goes through (docs/evidence-catalog.md §2), by rule
 * from what printed it and whose line it is. M8 is a change, on a later turn,
 * in a stat the effect's handlers move between Pokemon.
 */
function mechanismOf(change, stat, { subject, effectTurn, moved, wonderRoom }) {
  if (change.type === 'order') return 'M7';
  if (change.type === 'presence') return 'M6';
  if (change.type === 'content') return 'M9';
  if (moved.includes(stat) && change.turn > effectTurn) return 'M8';
  const onSubject = change.who === subject;
  const known = sideOf(change.who) === 'p1';
  const act = /^(p[1-4][a-d]: [^>]+)>(\w+)$/.exec(change.printer);
  if (act) {
    const [, by, moveId] = act;
    const hit = statsOfHit(moveId, wonderRoom);
    // A move that moves its own user's HP: on the hidden Pokemon, a share of
    // its max HP; on a known one, an amount the hidden Pokemon decided - the
    // Attack Strength Sap heals by.
    if (by === change.who) return known ? 'M5' : stat === 'hp' ? 'M4' : 'M5';
    if (hit && by === subject) {
      if (stat === hit.off && !hit.offByTarget) return 'M2';
      if (known && ['hp', 'def', 'spd'].includes(stat)) return 'M5';
      return 'M3';
    }
    if (hit && onSubject) {
      if (stat === 'hp' || stat === hit.def) return 'M1';
      if (stat === hit.off && hit.offByTarget) return 'M2';
      return 'M3';
    }
    // A known Pokemon's line, or its hit on another hidden one, that moves with
    // the hidden Pokemon's stat: an amount the hidden one handed on to it.
    if (sideOf(by) === 'p1') return 'M5';
    return 'M?';
  }
  if (change.printer === 'from:confusion' && onSubject) return stat === 'atk' ? 'M2' : ['hp', 'def'].includes(stat) ? 'M1' : 'M?';
  if (known) return 'M5';
  // On the hidden Pokemon: a share of its max HP, or an amount some other stat
  // of its decided - the damage it dealt, for Shell Bell.
  if (onSubject) return stat === 'hp' ? 'M4' : 'M5';
  return 'M?';
}

const SINK = { order: 'order', presence: 'presence', content: 'names' };
const sinkOf = change => SINK[change.type] || (sideOf(change.who) === 'p2' ? 'hidden %' : 'known exact');

/** How a spectator - a published replay - sees the same change. */
function spectatorOf(change, s0, s32) {
  if (change.type === 'order') return 'same';
  const x = s0.entries.get(change.key)?.line ?? null;
  const y = s32.entries.get(change.key)?.line ?? null;
  if (x === null && y === null) return 'absent';
  if (x === y) return 'hidden';
  return x === change.at0 && y === change.at32 ? 'same' : 'as %';
}

/**
 * Whether the effect acted at all in a template, read off the battle at base
 * Stat Points against its control: for a move, its own line printed and was not
 * followed by a failure; and in any case, the log differs from the control's by
 * more than the effect's own line.
 */
function fired(template, base, control) {
  const out = { acted: true, visible: false, failedBy: null, calls: 0, refused: base.refused.map(r => `T${r.turn} ${r.side}: ${r.error}`) };
  if (base.error) return { ...out, acted: false, failedBy: `battle error: ${base.error}` };
  const lines = battleLines(base.ch1);
  if (template.moveId) {
    const name = dex.moves.get(template.moveId).name;
    const at = lines.findIndex(l => l.startsWith(`|move|${template.user}: `) && l.split('|')[3] === name);
    if (at < 0) {
      const cant = lines.find(l => l.startsWith(`|cant|${template.user}: `));
      out.acted = false;
      out.failedBy = cant || `no |move| line for ${name}`;
    } else {
      for (const l of lines.slice(at + 1)) {
        const kind = l.split('|')[1];
        if (['move', 'cant', 'switch', 'upkeep', 'turn'].includes(kind)) break;
        if (['-fail', '-miss', '-immune', '-notarget'].includes(kind) || (kind === '-activate' && /\|move: (Protect|Detect|Max Guard)$/.test(l))) {
          out.acted = false;
          out.failedBy = l;
          break;
        }
      }
    }
  }
  if (base.calls) {
    for (const [key, n] of base.calls) if (key === template.effectKey || key === template.conditionKey) out.calls += n;
  }
  if (control && !control.error) {
    // The user's own action on the effect's turn is the effect's line in one
    // battle and Splash's in the other; only what follows from it counts.
    const own = c => template.moveId && c.turn === template.effectTurn && c.printer.startsWith(`${template.user}: `)
      && (c.printer.endsWith(`>${template.moveId}`) || c.printer.endsWith('>splash'))
      && ['move', '-nothing', '-fail', '-miss', '-notarget', '-immune'].includes(c.kind);
    out.visible = diffLogs(readLog(control.ch1), readLog(base.ch1)).some(c => c.type !== 'order' && !own(c));
  }
  return out;
}

/**
 * One template through the probe: the base battle, and for every stat the two
 * worlds, each against the control's. What survives is the effect's.
 */
async function probeTemplate(template) {
  const base = await runBattle(template, BASE, { watch: true });
  const controlBase = template.control ? await cachedRun(template.control, BASE) : null;
  const stats = {};
  for (const stat of STATS) {
    const e0 = await runBattle(template, world(stat, 0));
    const e32 = await runBattle(template, world(stat, 32));
    const c0 = template.control ? await cachedRun(template.control, world(stat, 0)) : null;
    const c32 = template.control ? await cachedRun(template.control, world(stat, 32)) : null;
    const inEffect = diffLogs(readLog(e0.ch1), readLog(e32.ch1));
    const inControl = c0 ? diffLogs(readLog(c0.ch1), readLog(c32.ch1)) : [];
    const exact = [e0, e32, c0, c32].map(r => (r ? readLog(r.all) : null));
    const changes = effectChanges(inEffect, inControl, exact);
    stats[stat] = { e0, e32, changes, masked: inControl.length > 0, unstable: e0.draws !== e32.draws || !!e0.error || !!e32.error };
  }
  return { base, controlBase, stats };
}

// --------------------------------------------------------------- coverage

/**
 * One world rebuilt from its log alone, the known side's view, with the hidden
 * side's Stat Points withheld - `--infer p2` on a replay of it.
 */
async function inferWorld(template, run) {
  const sets = [template.p1, template.p2.map(({ evs, ...set }) => set)];
  try {
    const inf = await inferSpreads({
      formatid: FORMAT, sets, known: [true, false], playerNames: ['Known', 'Hidden'], observed: run.ch1, channel: 1, threads: 1,
    });
    const p = inf.pokemon.find(x => x.id === 'p2:0');
    const diff = inf.built.report.diffs[0];
    return { inf, p, complete: inf.complete, diff: diff ? { turn: diff.turn, observed: diff.expected ?? null, rebuilt: diff.actual ?? null } : null };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Whether the inference tells the two worlds apart. It does when, given one
 * world's log, it removes the other world's spread - which differs from the
 * real one only in the probed stat. That is the question the probe asked of the
 * log, now asked of the inference. When the control's own battle already tells
 * the worlds apart - its lines carry the stat too - that test cannot see the
 * effect's part, so the effect's own lines must also have cut the hidden
 * Pokemon: an event on the same turn that read the same HP figure or is named
 * after the effect, or for an order change, a speed event.
 */
async function cover(template, stat, entry, effectName) {
  const worlds = [];
  for (const [value, run, other] of [[0, entry.e0, 32], [32, entry.e32, 0]]) {
    const r = await inferWorld(template, run);
    if (r.error) { worlds.push({ value, error: r.error }); continue; }
    const cutBy = [];
    for (const c of entry.changes) {
      const line = (value === 0 ? c.at0 : c.at32) ?? '';
      const kind = line.split('|')[1];
      const figure = HP_FIELD[kind] !== undefined ? String(line.split('|')[HP_FIELD[kind]] || '').split(' ')[0] : null;
      for (const e of r.inf.events) {
        if (e.turn !== c.turn) continue;
        const cut = e.cuts.find(x => x.id === 'p2:0' && x.after < x.before);
        if (!cut) continue;
        const named = !!effectName && e.what.includes(effectName);
        const match = c.type === 'order' ? /acted before|came before/.test(e.what) : named || (c.type === 'hp' ? e.shown === figure : true);
        if (match) cutBy.push(e.what);
      }
    }
    worlds.push({
      value,
      complete: r.complete,
      sound: r.p.contains(world(stat, value)),
      tellsApart: !r.p.contains(world(stat, other)),
      spreads: r.p.spreads,
      range: r.p.stats[stat] ? [r.p.stats[stat].min, r.p.stats[stat].max] : null,
      diff: r.diff,
      cutBy: [...new Set(cutBy)],
      narrowedBy: [...new Set(r.inf.events.filter(e => e.cuts.some(x => x.id === 'p2:0' && x.narrowed.includes(stat))).map(e => e.what))],
      setAside: (r.inf.checks || []).map(c => `${c.what} - ${c.reason}`),
    });
  }
  // Told apart, but only by the battle's own lines as far as can be seen: the
  // effect's line cut nothing more, so it is either unused or has nothing left
  // to add. That cannot be settled in this battle, and it is said so.
  let verdict;
  const errored = worlds.find(w => w.error);
  const apart = worlds.some(w => w.tellsApart);
  if (errored) verdict = 'ERROR';
  else if (worlds.some(w => !w.sound)) verdict = 'UNSOUND';
  else if (apart && (!entry.masked || worlds.some(w => w.cutBy.length))) verdict = 'USED';
  else if (apart) verdict = 'MASKED';
  else if (worlds.some(w => !w.complete)) verdict = 'REBUILD-FAILED';
  else verdict = 'UNUSED';
  return { verdict, worlds };
}

// ------------------------------------------------------------ closed sheets

/**
 * Whether a line names something: one of its fields is that name, bare or as
 * `item: X`, `ability: X`, `move: X`, with any `[from]`-style tag taken off.
 * Whole fields, so Blaze Kick does not name Blaze.
 */
const nameIn = (line, name) => String(line).split('|')
  .map(f => f.replace(/^\[\w+\]\s*/, '').trim())
  .some(f => f === name || /^(item|ability|move): /.test(f) && f.slice(f.indexOf(': ') + 2) === name);

/**
 * What `setsFromLog` reads for every Pokemon of both sides, against the truth
 * of the template. Only boxes the log could have filled are judged: a held item,
 * an ability it read rather than assumed, and the moves it saw.
 */
function readBoxes(template, raw) {
  const lines = battleLines(raw);
  const out = [];
  for (const [s, side] of ['p1', 'p2'].entries()) {
    const read = setsFromLog(lines, side, FORMAT);
    const truth = s === 0 ? template.p1 : template.p2;
    for (const [j, set] of read.sets.entries()) {
      const real = truth.find(t => t.name === set.name);
      if (!real) continue;
      const ident = `${side}`;
      const names = line => new RegExp(`\\|${ident}[a-d]: ${set.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||$)`).test(line)
        || line.includes(`[of] ${ident}a: ${set.name}`) || line.includes(`[of] ${ident}b: ${set.name}`);
      const namedBy = name => (name ? lines.find(l => nameIn(l, name) && names(l)) || null : null);
      const box = (kind, value, truthValue, verdict, line) => out.push({ side, pokemon: set.name, box: kind, value, truth: truthValue, verdict, line });
      const same = (a, b, table) => toID(table.get(a).name || a) === toID(table.get(b).name || b);

      if (set.item) box('item', set.item, real.item || null, real.item && same(set.item, real.item, dex.items) ? 'READ' : 'MISREAD', namedBy(set.item));
      else if (real.item && namedBy(real.item)) box('item', null, real.item, 'MISSED', namedBy(real.item));

      // An ability `setsFromLog` assumed is not a reading; one it read is.
      const assumed = read.assumed[j].notes.some(n => n.startsWith('ability '));
      const species = dex.species.get(real.species);
      const single = Object.keys(species.abilities).length === 1;
      if (!assumed && !single) box('ability', set.ability, real.ability, same(set.ability, real.ability, dex.abilities) ? 'READ' : 'MISREAD', namedBy(set.ability));
      else if (assumed && namedBy(real.ability)) box('ability', null, real.ability, 'MISSED', namedBy(real.ability));

      const realMoves = new Set(real.moves.map(toID));
      for (const m of set.moves) if (!realMoves.has(toID(m))) box('move', m, null, 'MISREAD', namedBy(m));
      for (const m of real.moves) {
        const used = lines.find(l => l.startsWith(`|move|${side}`) && names(l) && l.split('|')[3] === m && !l.includes('[from]'));
        if (used) box('move', set.moves.includes(m) ? m : null, m, set.moves.includes(m) ? 'READ' : 'MISSED', used);
      }
    }
  }
  return out;
}

const boxKey = b => `${b.side}|${b.pokemon}|${b.box}|${b.value}|${b.truth}|${b.verdict}`;

/**
 * The names an effect adds to what `setsFromLog` reads, and the boxes it puts
 * them in: every box judgement in the effect's battle that its control does not
 * also have. A box filled with a value that belongs to another Pokemon is FALSE.
 */
function namesOf(template, base, control) {
  const mine = readBoxes(template, base.ch0);
  const theirs = new Set(control ? readBoxes(template.control, control.ch0).map(boxKey) : []);
  const owners = new Map();
  for (const set of [...template.p1, ...template.p2]) {
    if (set.item) owners.set(`item|${toID(set.item)}`, set.name);
    owners.set(`ability|${toID(set.ability)}`, set.name);
  }
  // A move read right is news only when it is the effect: a bench Pokemon
  // coming in after a knockout and using Splash is not.
  const effectMove = template.moveId ? dex.moves.get(template.moveId).name : null;
  return mine.filter(b => !theirs.has(boxKey(b)))
    .filter(b => !(b.box === 'move' && b.verdict === 'READ' && b.value !== effectMove))
    .map((b) => {
      const owner = b.value ? owners.get(`${b.box}|${toID(b.value)}`) : null;
      return b.verdict === 'MISREAD' && owner && owner !== b.pokemon ? { ...b, verdict: 'FALSE', owner } : b;
    });
}

/**
 * Silence and hazard, for an item, ability or nature on the hidden Pokemon: what
 * changes against the control before any line names the effect, and - for each
 * witness where something does - whether the rebuild a Bo1 replay gets today
 * (the sets `setsFromLog` reads, everything unseen assumed) still keeps the
 * real spread.
 */
async function silenceOf(effect, template, base, control, coverage) {
  if (base.error || !control || control.error) return null;
  const lines = battleLines(base.ch1);
  const namedAt = lines.findIndex(l => nameIn(l, effect.name));
  let namedTurn = null;
  if (namedAt >= 0) namedTurn = lines.slice(0, namedAt).filter(l => l.startsWith('|turn|')).length;
  // A line naming the control's own ability is the control's, not the effect's.
  const theirs = effect.kind === 'ability' ? template.control.p2[0].ability : null;
  const changes = diffLogs(readLog(control.ch1), readLog(base.ch1))
    .filter(c => !nameIn(c.at0 || '', effect.name) && !nameIn(c.at32 || '', effect.name))
    .filter(c => !theirs || !nameIn(c.at0 || '', theirs))
    .filter(c => namedTurn === null || c.turn < namedTurn);
  const out = {
    witness: template.name, namedTurn, named: namedAt >= 0 ? lines[namedAt] : null,
    sinks: [...new Set(changes.map(c => sinkOf(c)))].sort(),
    example: changes[0] ? { without: changes[0].at0, with: changes[0].at32 } : null,
    hazard: null,
  };
  if (!changes.length || !coverage) return out;
  out.hazard = await hazardOf(template, base);
  // A hazard is the assumption's only if the true set gets through: when the
  // rebuild with the real item, ability and nature fails the same way, the
  // fault is the inference's, and the open-sheet report already lists it.
  if (out.hazard.verdict !== 'SAFE') {
    const truth = await inferWorld(template, base);
    if (truth.error || !truth.complete || !truth.p.contains(BASE)) out.hazard = { ...out.hazard, verdict: 'TRUE-SET-FAILS' };
  }
  // The control is a check on the battle only where it holds what a replay
  // would assume; a control with another ability than the first listed would
  // fail that rebuild for its own reasons.
  const set = template.control.p2[0];
  const assumable = effect.kind !== 'ability' || toID(set.ability) === toID(Object.values(dex.species.get(set.species).abilities)[0]);
  out.controlHazard = assumable ? await hazardOf(template.control, control) : null;
  return out;
}

async function hazardOf(template, run) {
  const observed = run.ch1;
  const read = setsFromLog(observed, 'p2', FORMAT);
  try {
    const inf = await inferSpreads({
      formatid: FORMAT, sets: [template.p1, read.sets], known: [true, false], playerNames: ['Known', 'Hidden'], observed, channel: 1, threads: 1,
    });
    const p = inf.pokemon.find(x => x.id === 'p2:0');
    const cutting = inf.events.filter(e => e.cuts.some(c => c.id === 'p2:0'));
    if (!p.spreads || !p.contains(BASE)) return { verdict: 'HAZARD-UNSOUND', spreads: p.spreads, event: cutting.length ? `turn ${cutting[cutting.length - 1].turn}: ${cutting[cutting.length - 1].what}` : null };
    if (!inf.complete) {
      const diff = inf.built.report.diffs[0];
      return { verdict: 'HAZARD-REBUILD', spreads: p.spreads, event: diff ? `turn ${diff.turn}: wanted ${diff.expected}, got ${diff.actual}` : null };
    }
    return { verdict: 'SAFE', spreads: p.spreads, event: null };
  } catch (err) {
    return { verdict: 'ERROR', spreads: null, event: err.message };
  }
}

// ------------------------------------------------------------- one effect

/** Everything the catalog says about one effect, as one record. */
async function catalogEffect(effect, { entry, coverage, sheets, say }) {
  const record = {
    key: effect.key, kind: effect.kind, name: effect.name, weight: effect.weight,
    meta: {
      users: effect.users.length,
      ...(effect.kind === 'move' ? { category: effect.category, type: effect.type } : {}),
      ...(effect.kind === 'nature' ? { plus: effect.plus, minus: effect.minus } : {}),
    },
    scan: effect.kind === 'nature' ? null : scan(effect.kind, effect.id),
    templates: [],
    open: { outcome: null, stats: [], reason: entry?.unfireable || null },
    closed: { names: [], silence: [] },
    conditionsSeen: [],
    note: entry?.note || null,
  };
  if (effect.kind === 'condition') return record;
  const seen = new Set();
  for (const planned of templatesFor(effect, entry)) {
    const template = planned.pace ? await resolvePace(planned) : planned;
    if (!template) continue;
    template.effectKey = effect.key;
    template.conditionKey = effect.kind === 'move' ? `condition:${effect.id}` : null;
    const probe = await probeTemplate(template);
    const act = fired(template, probe.base, probe.controlBase);
    const subject = battleLines(probe.base.ch1).find(l => l.startsWith('|switch|p2a: '))?.split('|')[2] || `p2a: ${template.p2[0].name}`;
    for (const l of battleLines(probe.base.ch1)) {
      const from = fromTag(l.split('|'));
      if (from && !from.includes(':')) seen.add(from);
      const m = /^\|(?:-start|-status|-weather|-fieldstart|-sidestart)\|(?:[^|]*\|)?(?:move: )?([^|]+)/.exec(l);
      if (m) seen.add(toID(m[1]));
    }
    record.templates.push({
      key: template.key, role: template.role, name: template.name, source: template.source, why: template.why,
      hidden: `${template.p2[0].species}${template.p2[0].item ? ` @ ${template.p2[0].item}` : ''} (${template.p2[0].ability}, ${template.p2[0].nature})`,
      known: `${template.p1[0].species}${template.p1[0].item ? ` @ ${template.p1[0].item}` : ''} (${template.p1[0].ability})`,
      acted: act.acted, visible: act.visible, failedBy: act.failedBy, calls: act.calls, refused: act.refused,
      unstable: STATS.filter(s => probe.stats[s].unstable),
    });

    if (sheets.open && effect.kind !== 'nature') {
      const wonderRoom = probe.base.ch1.some(l => l.includes('|-fieldstart|move: Wonder Room'));
      for (const stat of STATS) {
        const entryStat = probe.stats[stat];
        // A pace battle asks about turn order; its other changes are the
        // other templates' to report, where nothing races the hidden Pokemon.
        if (template.pace) entryStat.changes = entryStat.changes.filter(c => c.type === 'order');
        if (!entryStat.changes.length) continue;
        const s0 = readLog(entryStat.e0.ch0);
        const s32 = readLog(entryStat.e32.ch0);
        const rows = entryStat.changes.map(c => ({
          sink: sinkOf(c),
          mechanism: entry?.mechanism?.[stat] || mechanismOf(c, stat, { subject, effectTurn: template.effectTurn, moved: record.scan?.moved || [], wonderRoom }),
          turn: c.turn, own: printedBy(effect, c), at0: c.at0, at32: c.at32, spectator: spectatorOf(c, s0, s32), printer: c.printer,
        })).sort((a, b) => Number(b.own) - Number(a.own) || a.turn - b.turn);
        const covered = coverage && !entryStat.unstable ? await cover(template, stat, entryStat, effect.name) : null;
        record.open.stats.push({
          role: template.role, template: template.key, stat, masked: entryStat.masked, unstable: entryStat.unstable, rows,
          verdict: covered ? covered.verdict : entryStat.unstable ? 'UNSTABLE' : null, worlds: covered?.worlds || null,
        });
        say(`  ${effect.key} ${template.key} ${stat}: ${rows.length} change(s)${covered ? `, ${covered.verdict}` : ''}`);
      }
    }

    if (sheets.closed) {
      if (!probe.base.error) {
        for (const b of namesOf(template, probe.base, probe.controlBase)) record.closed.names.push({ template: template.key, ...b });
      }
      if (template.role === 'holder-hidden' && ['item', 'ability', 'nature'].includes(effect.kind)) {
        const s = await silenceOf(effect, template, probe.base, probe.controlBase, coverage);
        if (s) record.closed.silence.push(s);
      }
    }
  }
  record.conditionsSeen = [...seen].sort();

  const rowsAny = record.open.stats.length > 0;
  const acted = record.templates.some(t => t.acted && t.visible);
  record.open.outcome = entry?.unfireable ? 'UNFIREABLE' : rowsAny ? 'CHANNEL' : acted ? 'NO CHANNEL' : 'NOT SHOWN';
  record.closed.names = dedupeNames(record.closed.names);
  return record;
}

/** One judgement per box, from the first template that made it. */
function dedupeNames(names) {
  const seen = new Set();
  return names.filter((n) => {
    const k = `${n.side}|${n.pokemon === undefined ? '' : n.pokemon}|${n.box}|${n.value}|${n.truth}|${n.verdict}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --------------------------------------------------------------- the verdicts

const GLYPH = { USED: '✓', UNUSED: '✗', UNSOUND: '‼', 'REBUILD-FAILED': '↻', MASKED: '○', ERROR: '!', UNSTABLE: '~', null: '?' };
const INFO = { 'known exact': 3, 'hidden %': 2, order: 1, presence: 1, names: 1 };

/** A stat's one verdict for a role, over every template that showed it: the worst defect, else the best use. */
function statVerdict(entries) {
  if (!entries.length) return null;
  const vs = entries.map(e => e.verdict);
  if (vs.includes('UNSOUND')) return 'UNSOUND';
  if (vs.includes('ERROR')) return 'ERROR';
  for (const v of ['USED', 'REBUILD-FAILED', 'UNUSED', 'MASKED', 'UNSTABLE']) if (vs.includes(v)) return v;
  return null;
}


/** Conditions have no battle of their own: their card is the rows other effects' battles printed under them. */
function conditionRecords(records, pool) {
  const byCondition = new Map();
  for (const r of records) {
    for (const s of r.open.stats) {
      for (const row of s.rows) {
        const m = /^from:(?:move:)?(\w+)$/.exec(row.printer);
        if (!m) continue;
        const id = m[1];
        if (!byCondition.has(id)) byCondition.set(id, []);
        byCondition.get(id).push({ from: r.key, role: s.role, template: s.template, stat: s.stat, verdict: s.verdict, row });
      }
    }
  }
  const seen = new Set(records.flatMap(r => r.conditionsSeen));
  return pool.effects.filter(e => e.kind === 'condition').map((e) => {
    const rows = byCondition.get(e.id) || [];
    // No battle is a condition's own, so there is no telling here whether one
    // acted: only whether changes were printed under its name, and whether a
    // line was tagged with it at all (a flinch prints `|cant|`, and is not).
    return {
      key: e.key, kind: 'condition', name: e.name, weight: e.weight, meta: { setters: e.users },
      scan: scan('condition', e.id), templates: [],
      open: { outcome: rows.length ? 'CHANNEL' : 'NO ROWS', tagged: seen.has(e.id), stats: [], rowsFrom: rows, reason: null },
      closed: { names: [], silence: [] }, conditionsSeen: [], note: null,
    };
  });
}

// ------------------------------------------------------------------ reports

const esc = text => String(text ?? '').replace(/\|/g, '\\|');
const code = text => (text === null || text === undefined ? '—' : `\`${esc(text)}\``);
const ROLE_LETTER = { 'user-hidden': 'U', 'target-hidden': 'T', 'holder-hidden': 'H', 'other-hidden': 'O' };
const simCommit = () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return (String(pkg.dependencies['pokemon-showdown']).split('#')[1] || '').slice(0, 7);
};

function header(title, pool) {
  const n = kind => pool.effects.filter(e => e.kind === kind).length;
  return [
    `# ${title}`,
    '',
    '**Generated** by `npm run catalog` (`scripts/local-catalog.mjs`). Do not edit by hand:',
    '`npm run catalog -- --check` fails when this file and a fresh run disagree.',
    `**Format:** \`${FORMAT}\`, simulator \`pokemon-showdown\` at \`${simCommit()}\`.`,
    `**Pool:** ${pool.species.length} species, ${n('ability')} abilities, ${n('move')} moves, ${n('item')} items, ${n('condition')} conditions, ${n('nature')} natures.`,
    '**Read with:** `evidence-catalog.md` §1–§2.',
    '',
  ];
}

function roleStats(record) {
  const byRole = new Map();
  for (const s of record.open.stats) {
    if (!byRole.has(s.role)) byRole.set(s.role, new Map());
    const m = byRole.get(s.role);
    if (!m.has(s.stat)) m.set(s.stat, []);
    m.get(s.stat).push(s);
  }
  return byRole;
}

/** The mechanism a template's change for one stat goes through: its first own line's, else its first line's. */
const primary = s => (s.rows.find(r => r.own) || s.rows[0]).mechanism;

/**
 * Every (role, stat, mechanism) an effect showed, with the templates behind it.
 * A stat is judged per mechanism: Gyro Ball's Speed through its damage is one
 * question and through turn order another, and one answered well must not hide
 * the other.
 */
function groupsOf(record) {
  const out = new Map();
  for (const s of record.open.stats) {
    const key = `${s.role}|${s.stat}|${primary(s)}`;
    if (!out.has(key)) out.set(key, { role: s.role, stat: s.stat, mech: primary(s), list: [] });
    out.get(key).list.push(s);
  }
  return [...out.values()].map(g => ({ ...g, verdict: statVerdict(g.list), own: g.list.some(s => s.rows.some(r => r.own)) }));
}

function grid(record) {
  const groups = groupsOf(record);
  const rows = ['| | HP | Atk | Def | SpA | SpD | Spe |', '|---|---|---|---|---|---|---|'];
  for (const role of [...new Set(groups.map(g => g.role))].sort()) {
    const cells = STATS.map((stat) => {
      const here = groups.filter(g => g.role === role && g.stat === stat).sort((a, b) => a.mech.localeCompare(b.mech));
      if (!here.length) return '·';
      return here.map(g => (g.own ? `${GLYPH[g.verdict]} ${g.mech}` : `(${GLYPH[g.verdict]} ${g.mech})`)).join(' ');
    });
    rows.push(`| ${role.replace('-', ' ')} | ${cells.join(' | ')} |`);
  }
  return rows;
}

/** A move that is only a standard hit: target-hidden HP and its defence through M1, user-hidden its attacking stat through M2, every one USED. */
function standardHit(record) {
  if (record.kind !== 'move' || record.meta.category === 'Status' || record.open.outcome !== 'CHANNEL') return false;
  const move = dex.moves.get(record.key.slice(5));
  const want = statsOfHit(move.id, false);
  if (!want || want.offByTarget) return false;
  const byRole = roleStats(record);
  const shape = new Map([...byRole].map(([role, stats]) => [role, [...stats.keys()].sort().join(',')]));
  const expect = { 'user-hidden': [want.off].sort().join(','), 'target-hidden': ['hp', want.def].sort().join(',') };
  if (shape.get('user-hidden') !== expect['user-hidden']) return false;
  if (byRole.has('target-hidden') && shape.get('target-hidden') !== expect['target-hidden']) return false;
  return record.open.stats.every(s => s.verdict === 'USED' && s.rows.every(r => (s.role === 'user-hidden' ? r.mechanism === 'M2' : r.mechanism === 'M1')));
}

function usedByOf(s) {
  if (!s.worlds) return '—';
  const what = [...new Set(s.worlds.flatMap(w => (s.masked ? w.cutBy || [] : w.narrowedBy || [])))];
  return what.length ? what.slice(0, 2).map(esc).join('; ') : '—';
}

function worldsText(s) {
  if (!s.worlds) return '—';
  return s.worlds.map((w) => {
    if (w.error) return `${w.value}: error`;
    const range = w.range ? `${w.range[0]}–${w.range[1]}` : 'none';
    return `${w.value}: ${range}${w.complete ? '' : ' (partial)'}${w.sound ? '' : ' LOST'}`;
  }).join(' · ');
}

function openCard(record) {
  const out = [];
  const meta = record.kind === 'move' ? `${record.meta.category} · ${record.meta.type} · ${record.meta.users} users` : `${record.meta.users} ${record.kind === 'condition' ? 'setters' : 'holders'}`;
  out.push(`#### ${record.name} · \`${record.key}\``, '');
  out.push(`${meta} · weight ${record.weight} · outcome ${record.open.outcome}`);
  if (record.scan?.reads.length) out.push(`Scan: reads ${record.scan.reads.map(r => `\`${r}\``).join(', ')}${record.scan.moved.length ? `; moves ${record.scan.moved.map(s => STAT_NAME[s]).join(', ')} between Pokemon` : ''}.`);
  const unread = unreadStats(record);
  if (unread.length) out.push(`Scan flag: reads ${unread.map(s => STAT_NAME[s]).join(', ')} and no battle here changed a line with it.`);
  out.push('');
  if (record.open.stats.length) {
    out.push(...grid(record), '');
    out.push('| Role | Stat | Template | Sink | Turn | At 0 | At 32 | Spectator | Mech | Line | Verdict | Worlds (range of the stat) | Used by |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of [...record.open.stats].sort((a, b) => a.role.localeCompare(b.role) || STATS.indexOf(a.stat) - STATS.indexOf(b.stat) || a.template.localeCompare(b.template))) {
      for (const [i, r] of s.rows.slice(0, 3).entries()) {
        out.push(`| ${ROLE_LETTER[s.role]} | ${STAT_NAME[s.stat]} | ${s.template.split('/')[1]} | ${r.sink} | ${r.turn} | ${code(r.at0)} | ${code(r.at32)} | ${r.spectator} | ${r.mechanism} | ${r.own ? 'own' : 'modified'} | ${i === 0 ? `${s.verdict || 'not rebuilt'}${s.verdict === 'USED' && s.masked ? ' (own event)' : ''}` : '〃'} | ${i === 0 ? worldsText(s) : ''} | ${i === 0 ? usedByOf(s) : ''} |`);
      }
      if (s.rows.length > 3) out.push(`| ${ROLE_LETTER[s.role]} | ${STAT_NAME[s.stat]} | ${s.template.split('/')[1]} | … | | ${s.rows.length - 3} more changed line(s) | | | | | | | |`);
    }
    out.push('');
  }
  const shown = record.templates.filter(t => !t.acted || !t.visible || t.refused.length || t.unstable.length);
  if (shown.length && record.kind !== 'condition') {
    out.push('Templates: ' + record.templates.map(t => `${t.key}${t.source === 'fixture' ? ' (hand-set)' : ''}${!t.acted ? ` failed (${code(t.failedBy)})` : !t.visible ? ' changed nothing' : ''}${t.refused.length ? ` · refused ${esc(t.refused.join('; '))}` : ''}${t.unstable.length ? ` · dice differ for ${t.unstable.join(', ')}` : ''}`).join(' · '));
    out.push('');
  }
  for (const t of record.templates.filter(x => x.why)) out.push(`Template ${t.key}: ${t.why}`, '');
  if (record.note) out.push(`Note: ${record.note}`, '');
  return out;
}

/** Stats a handler reads that no battle showed a change for. */
function unreadStats(record) {
  if (!record.scan) return [];
  const shown = new Set(record.open.stats.map(s => s.stat));
  return record.scan.stats.filter(s => !shown.has(s));
}

function renderOpen(records, pool) {
  const out = header('Evidence, open team sheets — what every legal effect lets reach the log about Stat Points', pool);
  const open = records.filter(r => r.kind !== 'nature');
  out.push('## 0. How to read a card', '');
  out.push('Each effect was put in small battles in the real format, its **templates**. In each, the hidden Pokemon (p2a)');
  out.push('had every Stat Point at 2 except one, set to 0 in one world and 32 in the other. A **change** is a line of the');
  out.push('known side\'s view that differs between the two worlds, less what the **control** — the same battle without the');
  out.push('effect — changes the same way. An HP line that moves its Pokemon by the same exact amount in both worlds, or by');
  out.push('the same amounts as in the control, only repeats an earlier difference and is dropped. A change is `own` when the');
  out.push('effect printed it (its move, its `[from]` tag, a line naming it) and `modified` when it changed a line something');
  out.push('else printed: a hit that lands harder after Swords Dance. A stat seen only through modified lines is bracketed in');
  out.push('the grid.');
  out.push('');
  out.push('Each stat with changes was then rebuilt from each world\'s log alone by `inferSpreads`, the way');
  out.push('`npm run reconstruct -- --infer p2` rebuilds a replay. **Verdicts:**');
  out.push('');
  out.push('| Verdict | Glyph | Meaning |');
  out.push('|---|---|---|');
  out.push('| USED | ✓ | given one world\'s log, the inference removes the other world\'s spread, which differs only in this stat. Where the control\'s own lines also tell the worlds apart, an event of the inference must also have read the effect\'s line and cut the hidden Pokemon |');
  out.push('| UNUSED | ✗ | both worlds rebuild, the real spread survives in each, and neither rules out the other: the log carries the stat and the inference does not tell them apart |');
  out.push('| UNSOUND | ‼ | the real spread was removed in one of the worlds — a defect, first on the work list |');
  out.push('| REBUILD-FAILED | ↻ | not told apart, and a world\'s log did not rebuild to the end; its first wrong line is listed. Often the same gap: an unused stat leaves the rebuild without a spread that reproduces the line |');
  out.push('| MASKED | ○ | the worlds were told apart, but the control\'s lines already do that and no event read the effect\'s own line to cut more: unused, or with nothing left to add — this battle cannot say which |');
  out.push('| ERROR | ! | the rebuild threw |');
  out.push('| UNSTABLE | ~ | the two worlds drew a different number of dice, speed ties aside, so the difference is not only the stat; not rebuilt |');
  out.push('');
  out.push('A stat is judged per role and per mechanism: the worst defect over the templates that showed it through that');
  out.push('mechanism, else the best use. So Gyro Ball\'s Speed through its damage (M3) and through turn order (M7) are two');
  out.push('verdicts, and one does not hide the other. The grid gives each, bracketed when only a modified line showed it.');
  out.push('');
  out.push('The inference checks its own shortcuts as it goes: where one gives another answer than the simulator at the stats');
  out.push('the rebuild is running with, the line is set aside, not trusted. A line set aside can leave a stat UNUSED or');
  out.push('REBUILD-FAILED, never UNSOUND; §2.7 lists every one.');
  out.push('');
  out.push('**Outcomes:** CHANNEL — at least one change. NO CHANNEL — the effect acted and changed the log, but nothing it changed');
  out.push('depends on a Stat Point in these battles. NOT SHOWN — no template made it change the log: it failed, or did nothing');
  out.push('these battles could see; the card says which. **Sinks:** `hidden %` an HP figure of the hidden side, `known exact`');
  out.push('one of the known side, `order` two units of a turn swapped, `presence` a line printed in one world only, `names` a');
  out.push('line whose words changed. **Spectator:** how a published replay (channel 0) shows the change — `same`, `as %`,');
  out.push('`hidden` (it shows no change), `absent`. **Mechanisms** are `evidence-catalog.md` §2\'s, assigned by rule from what');
  out.push('printed the line; `M?` fits none. Roles: `U` user hidden, `T` target hidden, `H` holder hidden, `O` the known side');
  out.push('holds it and acts on the hidden Pokemon. At most three changed lines per stat are shown. `npm run catalog -- --dump');
  out.push('<effect> <role/template> <stat> <0|32>` prints the battle behind any row and what the rebuild made of it.');
  out.push('');

  // Summary.
  const VERDICTS = ['USED', 'UNUSED', 'UNSOUND', 'REBUILD-FAILED', 'MASKED', 'ERROR', 'UNSTABLE'];
  out.push('## 1. Summary', '', '### 1.1 By kind', '');
  out.push(`| Kind | Effects | CHANNEL | NO CHANNEL | NOT SHOWN | UNFIREABLE | ${VERDICTS.join(' | ')} |`);
  out.push(`|---|---|---|---|---|---|${VERDICTS.map(() => '---|').join('')}`);
  const all = open.flatMap(r => groupsOf(r).map(g => ({ r, ...g })));
  for (const kind of ['move', 'ability', 'item']) {
    const list = open.filter(r => r.kind === kind);
    const o = v => list.filter(r => r.open.outcome === v).length;
    const here = all.filter(g => g.r.kind === kind);
    out.push(`| ${kind} | ${list.length} | ${o('CHANNEL')} | ${o('NO CHANNEL')} | ${o('NOT SHOWN')} | ${o('UNFIREABLE')} | ${VERDICTS.map(x => here.filter(g => g.verdict === x).length).join(' | ')} |`);
  }
  const conditions = open.filter(r => r.kind === 'condition');
  out.push('', `The verdict columns count (effect, role, stat, mechanism): a stat is judged once for each mechanism it showed through. Of the ${conditions.length} conditions, which have no battles of their own, ${conditions.filter(r => r.open.outcome === 'CHANNEL').length} had changes printed under their name, counted above under the effect that set them (§6).`, '');
  out.push('### 1.2 By mechanism', '');
  out.push(`| Mechanism | Effects | ${VERDICTS.slice(0, 5).join(' | ')} | Only through lines the battle prints anyway |`);
  out.push('|---|---|---|---|---|---|---|---|');
  for (const m of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M?']) {
    const here = all.filter(g => g.mech === m);
    out.push(`| ${m} | ${new Set(here.map(g => g.r.key)).size} | ${VERDICTS.slice(0, 5).map(x => here.filter(g => g.verdict === x).length).join(' | ')} | ${here.filter(g => !g.own).length} |`);
  }
  out.push('', 'Counted per (effect, role, stat, mechanism), as in 1.1.', '');

  // Work lists, one row per effect, role, stat and mechanism, heaviest first.
  out.push('## 2. Work list', '');
  out.push('One row per effect, role, stat and mechanism, with the verdict §0 gives it. `Templates` names the battles that');
  out.push('gave that verdict; `npm run catalog -- --dump <effect> <role>/<template> <stat> <0|32>` shows any of them.', '');
  const picked = verdicts => all.filter(g => verdicts.includes(g.verdict))
    .map(g => ({ ...g, those: g.list.filter(s => s.verdict === g.verdict) }))
    .sort((a, b) => b.r.weight - a.r.weight || a.r.key.localeCompare(b.r.key) || a.role.localeCompare(b.role) || STATS.indexOf(a.stat) - STATS.indexOf(b.stat) || a.mech.localeCompare(b.mech));
  const names = those => [...new Set(those.map(s => s.template.split('/')[1]))].join(', ');
  out.push('### 2.1 UNSOUND — fix before anything else', '');
  const unsound = picked(['UNSOUND']);
  if (!unsound.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Role | Stat | Mech | Templates | First that lost it | Where its rebuild broke |', '|---|---|---|---|---|---|---|---|');
    for (const u of unsound) {
      const s = u.those[0];
      const w = s.worlds.find(x => !x.sound);
      out.push(`| \`${u.r.key}\` | ${u.r.weight} | ${ROLE_LETTER[u.role]} | ${STAT_NAME[u.stat]} | ${u.mech} | ${names(u.those)} | ${s.template.split('/')[1]}, world ${w.value} | ${w.diff ? `turn ${w.diff.turn}: wanted ${code(w.diff.observed)}, got ${code(w.diff.rebuilt)}` : 'it rebuilt'} |`);
    }
    out.push('');
  }
  out.push('### 2.2 UNUSED, by score', '');
  out.push('Score = weight × information: 3 for a `known exact` line, 2 for `hidden %`, 1 otherwise.', '');
  const unused = picked(['UNUSED']).map(u => ({ ...u, info: Math.max(...u.those.flatMap(s => s.rows.map(x => INFO[x.sink] || 1))) }))
    .map(u => ({ ...u, score: u.r.weight * u.info }))
    .sort((a, b) => b.score - a.score || a.r.key.localeCompare(b.r.key) || a.role.localeCompare(b.role) || STATS.indexOf(a.stat) - STATS.indexOf(b.stat));
  if (!unused.length) out.push('None.', '');
  else {
    out.push('| Rank | Effect | Role | Stat | Sink | Mech | Templates | Weight | Info | Score |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [i, u] of unused.entries()) {
      const sinks = [...new Set(u.those.flatMap(s => s.rows.map(x => x.sink)))].join(', ');
      out.push(`| ${i + 1} | \`${u.r.key}\` | ${ROLE_LETTER[u.role]} | ${STAT_NAME[u.stat]} | ${sinks} | ${u.mech} | ${names(u.those)} | ${u.r.weight} | ${u.info} | ${u.score} |`);
    }
    out.push('');
  }
  out.push('### 2.3 REBUILD-FAILED and ERROR', '');
  out.push('The first line the rebuild got wrong, as its last round compared it: turns the inference had already pinned are compared on exact HP, so a hidden figure can show exactly here.', '');
  const failed = picked(['REBUILD-FAILED', 'ERROR']);
  if (!failed.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Role | Stat | Mech | Templates | First that failed | Observed | Rebuilt |', '|---|---|---|---|---|---|---|---|---|');
    for (const u of failed) {
      const s = u.those[0];
      const w = s.worlds.find(x => x.error || !x.complete);
      const where = `${s.template.split('/')[1]}, world ${w.value}${w.error ? '' : `, turn ${w.diff?.turn ?? '—'}`}`;
      const error = w.error && w.error.length > 160 ? `${w.error.slice(0, 160)}…` : w.error;
      out.push(`| \`${u.r.key}\` | ${u.r.weight} | ${ROLE_LETTER[u.role]} | ${STAT_NAME[u.stat]} | ${u.mech} | ${names(u.those)} | ${where} | ${error ? esc(error) : code(w.diff?.observed)} | ${error ? '—' : code(w.diff?.rebuilt)} |`);
    }
    out.push('');
  }
  out.push('### 2.4 MASKED — told apart by the battle itself; the effect\'s own line cut nothing more', '');
  out.push('Each needs a battle in which nothing else carries the stat, to say whether the inference reads the line.', '');
  const masked = picked(['MASKED']);
  if (!masked.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Role | Stat | Mech | Templates | The effect\'s line, at 0 |', '|---|---|---|---|---|---|---|');
    for (const u of masked) {
      const row = u.those.flatMap(s => s.rows).find(x => x.own) || u.those[0].rows[0];
      out.push(`| \`${u.r.key}\` | ${u.r.weight} | ${ROLE_LETTER[u.role]} | ${STAT_NAME[u.stat]} | ${u.mech} | ${names(u.those)} | ${code(row.at0 ?? row.at32)} |`);
    }
    out.push('');
  }
  out.push('### 2.5 NOT SHOWN — no template made the effect act where a replay would see it', '');
  out.push('Each needs a hand-set template (`scripts/fixtures/catalog.js`), or a written reason that it cannot act in this format.', '');
  const notShown = open.filter(r => r.open.outcome === 'NOT SHOWN').sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  if (!notShown.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Scan reads | Why, per template |', '|---|---|---|---|');
    for (const r of notShown) {
      const why = [...new Set(r.templates.map(t => (!t.acted ? `failed: ${t.failedBy}` : 'changed nothing')))].slice(0, 3).join('; ');
      out.push(`| \`${r.key}\` | ${r.weight} | ${r.scan?.reads.length ? r.scan.reads.join(', ') : '—'} | ${esc(why)} |`);
    }
    out.push('');
  }
  out.push('### 2.6 Scan reads with no change', '');
  out.push('The handlers read the stat and no battle here changed a line with it: a template that reaches the read, or a written reason.', '');
  const flagged = open.filter(r => r.kind !== 'condition' && r.open.outcome !== 'NOT SHOWN' && unreadStats(r).length);
  if (!flagged.length) out.push('None.', '');
  else {
    out.push('| Effect | Outcome | Stats read, unseen |', '|---|---|---|');
    for (const r of flagged) out.push(`| \`${r.key}\` | ${r.open.outcome} | ${unreadStats(r).map(s => STAT_NAME[s]).join(', ')} |`);
    out.push('');
  }
  out.push('### 2.7 Set aside by the inference\'s own check', '');
  out.push('Where a shortcut of the evidence pass gave another answer than the simulator, at the stats the rebuild was running with, and the line was not used rather than trusted. Each is evidence given up, never a spread removed: work to use it.', '');
  const asideOf = r => [...new Set(r.open.stats.flatMap(s => (s.worlds || []).flatMap(w => w.setAside || [])))];
  const aside = open.filter(r => asideOf(r).length).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  if (!aside.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | What was set aside, and why |', '|---|---|---|');
    for (const r of aside) {
      const lines = asideOf(r);
      out.push(`| \`${r.key}\` | ${r.weight} | ${esc(lines.slice(0, 3).join('; '))}${lines.length > 3 ? `; and ${lines.length - 3} more` : ''} |`);
    }
    out.push('');
  }

  // Per kind.
  const sections = [['move', '3. Moves'], ['ability', '4. Abilities'], ['item', '5. Items'], ['condition', '6. Conditions']];
  for (const [kind, title] of sections) {
    const list = open.filter(r => r.kind === kind);
    out.push(`## ${title}`, '');
    if (kind === 'move') {
      const standard = list.filter(standardHit);
      out.push('### 3.1 Standard hits', '', 'Target hidden: HP and the defence it hits, through M1. User hidden: the attacking stat, through M2. Every one USED.', '');
      out.push('| Move | Type | Cat | Users | Hidden user | HP | Atk | Def | SpA | SpD | Spe |', '|---|---|---|---|---|---|---|---|---|---|---|');
      for (const r of standard) {
        const byRole = roleStats(r);
        const cells = STATS.map(stat => ['user-hidden', 'target-hidden'].filter(role => byRole.get(role)?.has(stat)).map(role => `${ROLE_LETTER[role]}✓`).join(' ') || '·');
        const user = r.templates.find(t => t.role === 'user-hidden')?.hidden.split(' ')[0] || '—';
        out.push(`| ${r.name} | ${r.meta.type} | ${r.meta.category.slice(0, 4)} | ${r.meta.users} | ${user} | ${cells.join(' | ')} |`);
      }
      out.push('');
      const rest = list.filter(r => !standardHit(r));
      out.push('### 3.2 No channel and not shown', '');
      out.push('| Move | Cat | Users | Outcome | Templates |', '|---|---|---|---|---|');
      for (const r of rest.filter(x => x.open.outcome !== 'CHANNEL')) {
        out.push(`| ${r.name} | ${r.meta.category} | ${r.meta.users} | ${r.open.outcome} | ${esc(r.templates.map(t => `${ROLE_LETTER[t.role]} ${t.name}: ${!t.acted ? `failed (${t.failedBy})` : t.visible ? 'acted' : 'changed nothing'}`).join('; '))} |`);
      }
      out.push('', '### 3.3 Every other move', '');
      for (const r of rest.filter(x => x.open.outcome === 'CHANNEL')) out.push(...openCard(r));
    } else if (kind === 'condition') {
      out.push('A condition has no battle of its own. Its rows are the changes other effects\' battles printed with it in `[from]`.', '');
      out.push('A line tagged with a condition\'s name is `[from] <it>`, or one that starts it; a condition that acts through `|cant|` or `-singleturn` (a flinch, Protect) is never tagged, and says nothing here either way.', '');
      out.push('| Condition | Weight | Tagged in a battle | Set by | Changes printed under it |', '|---|---|---|---|---|');
      for (const r of list) {
        const rows = r.open.rowsFrom;
        const summary = [...new Set(rows.map(x => `${STAT_NAME[x.stat]} ${x.row.mechanism} ${x.verdict || 'not covered'} (${x.from} ${ROLE_LETTER[x.role]})`))].slice(0, 4).join('; ');
        out.push(`| ${r.name} \`${r.key}\` | ${r.weight} | ${r.open.tagged ? 'yes' : 'no'} | ${r.meta.setters.slice(0, 4).join(', ')}${r.meta.setters.length > 4 ? ` +${r.meta.setters.length - 4}` : ''} | ${esc(summary) || '—'} |`);
      }
      out.push('');
    } else {
      const num = title.split('.')[0];
      out.push(`### ${num}.1 No channel and not shown`, '');
      out.push(`| ${kind === 'item' ? 'Item' : 'Ability'} | Holders | Outcome | Scan reads |`, '|---|---|---|---|');
      for (const r of list.filter(x => x.open.outcome !== 'CHANNEL')) out.push(`| ${r.name} | ${r.meta.users} | ${r.open.outcome} | ${r.scan?.reads.join(', ') || '—'} |`);
      out.push('', `### ${num}.2 Cards`, '');
      for (const r of list.filter(x => x.open.outcome === 'CHANNEL')) out.push(...openCard(r));
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function renderClosed(records, pool) {
  const out = header('Evidence, closed team sheets — what every legal effect names, where it goes, and what it gives away', pool);
  out.push('## 0. How to read a card', '');
  out.push('A Bo1 replay publishes no team sheet, so a Pokemon\'s item, ability, nature and unused moves are unknown. Every');
  out.push('battle of the open-sheet probe, at base Stat Points, was read by `setsFromLog` from the spectator channel, the');
  out.push('way `npm run reconstruct` reads such a replay. Only what an effect adds is listed: a box judgement its control');
  out.push('battle also has belongs to the battle.');
  out.push('');
  out.push('| Verdict | Meaning |', '|---|---|');
  out.push('| READ | a line names it, and the right Pokemon\'s box holds it |');
  out.push('| MISSED | a line names it, and the box stays empty or assumed |');
  out.push('| MISREAD | a box holds a value that is not that Pokemon\'s |');
  out.push('| FALSE | a box holds a value that belongs to another Pokemon in the battle |');
  out.push('| SILENT-SINK | an item, ability or nature on the hidden Pokemon changed the log, against its control, before any line named it |');
  out.push('| HAZARD-UNSOUND | rebuilt from that log with today\'s assumptions (no item, the first ability listed, a neutral nature), the hidden Pokemon loses its real spread |');
  out.push('| HAZARD-REBUILD | the same rebuild does not reproduce the log |');
  out.push('| TRUE-SET-FAILS | not a hazard: the rebuild fails as badly with the real item, ability and nature, so the fault is the inference\'s, and the open-sheet report lists it |');
  out.push('| SAFE | the same rebuild keeps the real spread |');
  out.push('');
  out.push('Witnesses: `W-phys-dealt`/`W-spec-dealt` the hidden Pokemon hits the known one; `-taken` it is hit four times;');
  out.push('`W-trade` it is hit by a priority move and hits back; `W-burn` … `W-taunt` it is given that status and then');
  out.push('attacks; `W-lethal` a one-hit KO; `W-order-up`/`-down` a known Pokemon one point of Speed faster or slower;');
  out.push('`W-pivot` it switches out and back; `W-two-moves` two different moves in a row; `W-<Type>-…` a hit of a type');
  out.push('its handlers name. A control\'s own rebuild is shown when it is not SAFE, since then the hazard is not the effect\'s.');
  out.push('');

  const names = records.flatMap(r => r.closed.names.map(n => ({ r, n })));
  const silence = records.flatMap(r => r.closed.silence.map(s => ({ r, s })));
  out.push('## 1. Summary', '');
  out.push('| Kind | Effects | READ | MISSED | MISREAD | FALSE | Silent (no line names it) | SILENT-SINK witnesses | HAZARD-UNSOUND | HAZARD-REBUILD | TRUE-SET-FAILS |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const kind of KINDS) {
    const list = records.filter(r => r.kind === kind);
    const nv = v => names.filter(x => x.r.kind === kind && x.n.verdict === v).length;
    const sv = silence.filter(x => x.r.kind === kind);
    const silent = list.filter(r => ['item', 'ability', 'nature'].includes(kind) && r.closed.silence.length && r.closed.silence.every(s => !s.named)).length;
    out.push(`| ${kind} | ${list.length} | ${nv('READ')} | ${nv('MISSED')} | ${nv('MISREAD')} | ${nv('FALSE')} | ${silent} | ${sv.filter(x => x.s.sinks.length).length} | ${sv.filter(x => x.s.hazard?.verdict === 'HAZARD-UNSOUND').length} | ${sv.filter(x => x.s.hazard?.verdict === 'HAZARD-REBUILD').length} | ${sv.filter(x => x.s.hazard?.verdict === 'TRUE-SET-FAILS').length} |`);
  }
  out.push('');

  out.push('## 2. Work list', '');
  out.push('### 2.1 MISREAD and FALSE — `setsFromLog` puts something in the wrong box', '');
  const wrong = names.filter(x => x.n.verdict === 'MISREAD' || x.n.verdict === 'FALSE');
  if (!wrong.length) out.push('None.', '');
  else {
    out.push('| Effect | Template | Pokemon | Box | Read | Truth | Verdict | Line |', '|---|---|---|---|---|---|---|---|');
    for (const { r, n } of wrong) out.push(`| \`${r.key}\` | ${n.template} | ${n.side} ${esc(n.pokemon)} | ${n.box} | ${esc(n.value)} | ${esc(n.truth ?? '—')} | ${n.verdict}${n.owner ? ` (${esc(n.owner)}'s)` : ''} | ${code(n.line)} |`);
    out.push('');
  }
  out.push('### 2.2 MISSED — the log names it and `setsFromLog` does not read it', '');
  const missed = names.filter(x => x.n.verdict === 'MISSED');
  if (!missed.length) out.push('None.', '');
  else {
    out.push('| Effect | Template | Pokemon | Box | Truth | Line |', '|---|---|---|---|---|---|');
    for (const { r, n } of missed) out.push(`| \`${r.key}\` | ${n.template} | ${n.side} ${esc(n.pokemon)} | ${n.box} | ${esc(n.truth)} | ${code(n.line)} |`);
    out.push('');
  }
  out.push('### 2.3 HAZARD — today\'s assumption about the effect removes the real spread or breaks the rebuild', '');
  out.push('Only where the same witness without the effect rebuilds SAFE, so the hazard is the effect\'s.', '');
  const bad = x => ['HAZARD-UNSOUND', 'HAZARD-REBUILD', 'ERROR'].includes(x.s.hazard?.verdict);
  const controlSafe = x => !x.s.controlHazard || x.s.controlHazard.verdict === 'SAFE';
  const hazards = silence.filter(x => bad(x) && controlSafe(x));
  if (!hazards.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Witness | Sinks | Verdict | Last event that cut the hidden Pokemon, or where the rebuild broke |', '|---|---|---|---|---|---|');
    for (const { r, s } of hazards.sort((a, b) => b.r.weight - a.r.weight || a.r.key.localeCompare(b.r.key) || a.s.witness.localeCompare(b.s.witness))) {
      out.push(`| \`${r.key}\` | ${r.weight} | ${s.witness} | ${s.sinks.join(', ')} | ${s.hazard.verdict} | ${esc(s.hazard.event) || '—'} |`);
    }
    out.push('');
  }
  const shared = silence.filter(x => x.s.controlHazard && x.s.controlHazard.verdict !== 'SAFE');
  if (shared.length) {
    out.push('Witness battles whose control, without the effect, does not rebuild SAFE either — a defect of the battle or of the rebuild, not of the effect:', '');
    out.push('| Effect | Witness | Effect\'s rebuild | Control\'s rebuild | Control: last event, or where it broke |', '|---|---|---|---|---|');
    for (const { r, s } of shared) out.push(`| \`${r.key}\` | ${s.witness} | ${s.hazard?.verdict || '—'} | ${s.controlHazard.verdict} | ${esc(s.controlHazard.event) || '—'} |`);
    out.push('');
  }
  out.push('### 2.4 SILENT-SINK, by weight — candidate dimensions for closed-sheet inference', '');
  const sinks = records.filter(r => r.closed.silence.some(s => s.sinks.length)).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  if (!sinks.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Named by a line | Witnesses with a silent change |', '|---|---|---|---|');
    for (const r of sinks) {
      const ws = r.closed.silence.filter(s => s.sinks.length).map(s => `${s.witness} (${s.sinks.join(', ')})`);
      out.push(`| \`${r.key}\` | ${r.weight} | ${r.closed.silence.some(s => s.named) ? 'yes' : 'never'} | ${ws.join('; ')} |`);
    }
    out.push('');
  }

  out.push('## 3. Moves', '', '### 3.1 Move box only', '');
  out.push('Named by its own `|move|` line and read into its user\'s move box, in every placement it was used, and naming nothing else.', '');
  const moves = records.filter(r => r.kind === 'move');
  const moveOnly = r => r.closed.names.length > 0 && r.closed.names.every(n => n.box === 'move' && n.verdict === 'READ' && n.truth === r.name);
  out.push('| Move | Users | Hidden user READ | Known user READ |', '|---|---|---|---|');
  for (const r of moves.filter(moveOnly)) {
    const where = side => (r.closed.names.some(n => n.side === side) ? 'READ' : '—');
    out.push(`| ${r.name} | ${r.meta.users} | ${where('p2')} | ${where('p1')} |`);
  }
  out.push('', '### 3.2 Moves that name something else, or are not read', '');
  for (const r of moves.filter(x => !moveOnly(x))) {
    out.push(`#### ${r.name} · \`${r.key}\``, '');
    if (!r.closed.names.length) out.push('No box judgement differs from the control: the move printed nothing that names it for a Pokemon.', '');
    else {
      out.push('| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |', '|---|---|---|---|---|---|---|');
      for (const n of r.closed.names) out.push(`| ${n.template} | ${n.side} ${esc(n.pokemon)} | ${n.box} | ${esc(n.value ?? '—')} | ${esc(n.truth ?? '—')} | ${n.verdict} | ${code(n.line)} |`);
      out.push('');
    }
  }
  for (const [kind, title] of [['ability', '4. Abilities'], ['item', '5. Items']]) {
    out.push(`## ${title}`, '');
    for (const r of records.filter(x => x.kind === kind)) {
      out.push(`#### ${r.name} · \`${r.key}\``, '');
      const holderNames = r.closed.names.filter(n => n.box === kind && n.truth && toID(n.truth) === toID(r.name));
      const named = r.closed.silence.find(s => s.named);
      out.push(`${r.meta.users} holders · weight ${r.weight}. Named by: ${named ? `${code(named.named)} (${named.witness}, turn ${named.namedTurn})` : 'no line, in any witness'}.`);
      if (holderNames.length) out.push(`Box: ${[...new Set(holderNames.map(n => `${n.verdict} (${n.side} ${n.template.split('/')[0]})`))].join(', ')}.`);
      const others = r.closed.names.filter(n => !(n.box === kind && n.truth && toID(n.truth) === toID(r.name)));
      if (others.some(n => n.verdict !== 'READ')) out.push(`Other boxes: ${others.filter(n => n.verdict !== 'READ').map(n => `${n.verdict} ${n.side} ${esc(n.pokemon)} ${n.box} ${esc(n.value ?? n.truth)}`).join('; ')}.`);
      out.push('');
      const ws = r.closed.silence.filter(s => s.sinks.length);
      if (ws.length) {
        out.push('| Witness | Sinks | Without → with | Named? | Hazard | Control |', '|---|---|---|---|---|---|');
        for (const s of ws) out.push(`| ${s.witness} | ${s.sinks.join(', ')} | ${code(s.example?.without)} → ${code(s.example?.with)} | ${s.named ? `turn ${s.namedTurn}` : 'no'} | ${s.hazard?.verdict || 'not run'} | ${s.controlHazard && s.controlHazard.verdict !== 'SAFE' ? s.controlHazard.verdict : ''} |`);
        out.push('');
      } else out.push('No witness changed the log before it was named.', '');
    }
  }
  out.push('## 6. Natures', '');
  out.push('| Nature | + | − | Silent sinks (witness) | Hazard under "neutral" |', '|---|---|---|---|---|');
  for (const r of records.filter(x => x.kind === 'nature')) {
    const ws = r.closed.silence.filter(s => s.sinks.length);
    const hazard = ws.filter(s => s.hazard && s.hazard.verdict !== 'SAFE').map(s => `${s.hazard.verdict} on ${s.witness}`);
    out.push(`| ${r.name} | ${STAT_NAME[r.meta.plus] || '—'} | ${STAT_NAME[r.meta.minus] || '—'} | ${ws.map(s => `${s.sinks.join(', ')} (${s.witness})`).join('; ') || 'none'} | ${hazard.join('; ') || (ws.length ? 'SAFE' : '—')} |`);
  }
  out.push('', '## 7. Conditions', '');
  out.push('| Condition | Set by | Tagged in a battle |', '|---|---|---|');
  for (const r of records.filter(x => x.kind === 'condition')) out.push(`| ${r.name} \`${r.key}\` | ${r.meta.setters.slice(0, 4).join(', ')}${r.meta.setters.length > 4 ? ` +${r.meta.setters.length - 4}` : ''} | ${r.open.tagged ? 'yes' : 'no'} |`);
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ----------------------------------------------------------- workers and main

function loadEntries(extra) {
  const entries = { ...FIXTURE.entries };
  for (const file of extra) Object.assign(entries, require(path.resolve(ROOT, file)).entries || {});
  return entries;
}

async function serve() {
  const { inputs, coverage, sheets, verbose } = workerData;
  const entries = loadEntries(inputs);
  const say = verbose ? (...a) => parentPort.postMessage({ log: a.join(' ') }) : () => {};
  parentPort.on('message', async (effect) => {
    try {
      const record = await catalogEffect(effect, { entry: entries[effect.key], coverage, sheets, say });
      parentPort.postMessage({ key: effect.key, record });
    } catch (err) {
      parentPort.postMessage({ key: effect.key, error: `${err.message}\n${err.stack}` });
    }
  });
}

async function runAll(effects, { threads, inputs, coverage, sheets, verbose }) {
  const queue = effects.filter(e => e.kind !== 'condition');
  const records = new Map();
  const size = Math.max(1, Math.min(threads, queue.length));
  const started = Date.now();
  let done = 0;
  await Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { role: WORKER_ROLE, inputs, coverage, sheets, verbose } });
    const next = () => {
      const effect = queue.shift();
      if (!effect) { worker.terminate().then(resolve); return; }
      worker.postMessage(effect);
    };
    worker.on('message', (msg) => {
      if (msg.log) { console.log(msg.log); return; }
      done++;
      if (msg.error) {
        console.error(`  ${msg.key}: ${msg.error}`);
        reject(new Error(`${msg.key} failed`));
        return;
      }
      records.set(msg.key, msg.record);
      console.log(`[${done}/${effects.filter(e => e.kind !== 'condition').length}] ${msg.key} ${msg.record.open.outcome} ${((Date.now() - started) / 1000).toFixed(0)}s`);
      next();
    });
    worker.on('error', reject);
    next();
  })));
  return records;
}

/**
 * The battle behind one row, for working the list: the template, the known
 * side's view of one world, and what the rebuild made of it.
 * `--dump <effect> <role/template> <stat> <0|32> [--control] [--hazard]`; a stat
 * of `-` is the base spread, and `--hazard` rebuilds it the way a closed-sheet
 * replay is rebuilt, from the sets `setsFromLog` reads.
 */
async function dumpWorld(pool, [key, templateKey, stat, value], { control, entries, hazard }) {
  const effect = pool.effects.find(e => e.key === key);
  if (!effect) throw new Error(`not in the Reg M-C pool: ${key}`);
  const templates = templatesFor(effect, entries[key]);
  const planned = templates.find(t => t.key === templateKey);
  if (!planned) throw new Error(`${key} has no template ${templateKey}; it has ${templates.map(t => t.key).join(', ')}`);
  const found = planned.pace ? await resolvePace(planned) : planned;
  if (!found) throw new Error(`${key} ${templateKey}: no pacer reaches the hidden Pokemon's Speed`);
  const template = control ? found.control : found;
  const evs = STATS.includes(stat) ? world(stat, Number(value)) : BASE;
  const show = set => `${set.name} (${set.species}) @ ${set.item || 'no item'}, ${set.ability}, ${set.nature}, ${STATS.map(s => `${set.evs[s]} ${STAT_NAME[s]}`).join(' / ')}: ${set.moves.join(', ')}`;
  console.log(`${key} ${templateKey}${control ? ' (control)' : ''}, hidden Pokemon on ${STATS.map(s => evs[s]).join('/')}`);
  for (const [i, team] of [template.p1, template.p2].entries()) for (const set of team) console.log(`  p${i + 1} ${show(i === 1 && set === team[0] ? { ...set, evs } : set)}`);
  for (const [i, t] of template.turns.entries()) console.log(`  T${i + 1}: p1 ${t.p1} | p2 ${t.p2}`);
  console.log(`  dice: ${template.dice.join('; ')}`);
  const run = await runBattle(template, evs);
  if (run.error) console.log(`battle error: ${run.error}`);
  for (const r of run.refused) console.log(`  refused T${r.turn} ${r.side} "${r.choice}": ${r.error} -> ${r.fallback}`);
  console.log('--- channel 1');
  for (const line of battleLines(run.ch1)) console.log(line);
  const r = hazard ? await (async () => {
    const read = setsFromLog(run.ch1, 'p2', FORMAT);
    for (const [i, set] of read.sets.entries()) console.log(`  read off the log: ${set.name} @ ${set.item || 'no item'}, ${set.ability}, ${set.nature}: ${set.moves.join(', ')}  (${read.assumed[i].notes.join(', ')})`);
    return inferWorld({ ...template, p2: read.sets }, run);
  })() : await inferWorld(template, run);
  console.log(`--- rebuilt from it${hazard ? ', with the sets read off the log' : ''}`);
  if (r.error) { console.log(`error: ${r.error}`); return; }
  console.log(`complete ${r.complete}${r.diff ? `, first wrong line on turn ${r.diff.turn}: wanted ${r.diff.observed}, got ${r.diff.rebuilt}` : ''}`);
  console.log(`hidden Pokemon: ${r.p.spreads} spreads, real spread ${r.p.contains(evs) ? 'kept' : 'REMOVED'}; ${STATS.map(s => `${STAT_NAME[s]} ${r.p.stats[s] ? `${r.p.stats[s].min}-${r.p.stats[s].max}` : 'none'}`).join(', ')}`);
  for (const e of r.inf.events) {
    const cut = e.cuts.find(c => c.id === 'p2:0');
    console.log(`  T${e.turn} ${e.what}${e.shown ? ` (shown ${e.shown})` : ''}${cut ? `: ${cut.before} -> ${cut.after}${cut.narrowed.length ? `, ${cut.narrowed.map(s => `${STAT_NAME[s]} ${cut.stats[s] ? `${cut.stats[s].min}-${cut.stats[s].max}` : 'none'}`).join(', ')}` : ''}` : ''}`);
  }
  for (const c of r.inf.checks || []) console.log(`  check T${c.turn}: ${c.what} - ${c.reason}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = name => argv.includes(name);
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const inputs = argv.flatMap((a, i) => (a === '--inputs' && argv[i + 1] ? [argv[i + 1]] : []));
  const started = Date.now();
  const pool = buildPool();
  if (flag('--pool')) {
    const n = kind => pool.effects.filter(e => e.kind === kind).length;
    console.log(`species ${pool.species.length}, abilities ${n('ability')}, moves ${n('move')}, items ${n('item')}, conditions ${n('condition')}, natures ${n('nature')}`);
    console.log('evidence-catalog.md §2: species 293, abilities 203, moves 510, items 166');
    return;
  }
  let effects = pool.effects;
  const dump = argv.indexOf('--dump');
  if (dump >= 0) {
    await dumpWorld(pool, argv.slice(dump + 1, dump + 5), { control: flag('--control'), hazard: flag('--hazard'), entries: loadEntries(inputs) });
    return;
  }
  const only = opt('--only');
  if (only) {
    const want = new Set(only.split(',').map(s => s.trim()));
    const unknown = [...want].filter(k => !effects.some(e => e.key === k));
    if (unknown.length) throw new Error(`not in the Reg M-C pool: ${unknown.join(', ')}`);
    effects = effects.filter(e => want.has(e.key));
  }
  if (opt('--kind')) effects = effects.filter(e => e.kind === opt('--kind'));
  if (flag('--list')) {
    for (const e of effects) console.log(`${e.key.padEnd(34)} ${e.kind.padEnd(10)} weight ${e.weight}`);
    console.log(`${effects.length} effects`);
    return;
  }
  const sheetsOpt = opt('--sheets');
  const sheets = { open: !sheetsOpt || sheetsOpt === 'open', closed: !sheetsOpt || sheetsOpt === 'closed' };
  const coverage = !flag('--no-coverage');
  const threads = Number(opt('--threads', String(Math.max(1, os.availableParallelism() - 1))));
  const partial = effects.length !== pool.effects.length;
  const check = flag('--check');
  const outDir = opt('--out');
  if (check && (partial || outDir || opt('--records'))) throw new Error('--check runs every effect and compares with the committed reports; it takes no --only, --kind, --out or --records');
  if (!check && !outDir && !opt('--records') && (partial || !coverage || sheetsOpt)) throw new Error('a partial run writes only to --out <dir>; the reports in docs/ come from a full run');

  let all;
  const saved = argv.flatMap((a, i) => (a === '--records' && argv[i + 1] ? [argv[i + 1]] : []));
  if (saved.length) {
    // Runs' records, read back and put together - the pool run a kind at a
    // time, say - to render without running a battle. Conditions are worked out
    // again from the rest once every other effect is there.
    const byKey = new Map();
    for (const file of saved) {
      for (const r of JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'))) if (r.kind !== 'condition') byKey.set(r.key, r);
    }
    const records = [...byKey.values()];
    const whole = pool.effects.every(e => e.kind === 'condition' || byKey.has(e.key));
    if (!whole && !outDir) throw new Error(`${saved.join(', ')} do not cover the whole pool; render them with --out <dir>`);
    all = [...records, ...(whole ? conditionRecords(records, pool) : [])].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.key.localeCompare(b.key));
    console.log(`catalog: rendering ${all.length} record(s) from ${saved.join(', ')}`);
  } else {
    console.log(`catalog: ${effects.length} effect(s), ${threads} thread(s)${coverage ? '' : ', no coverage'}${sheetsOpt ? `, ${sheetsOpt} sheets only` : ''}`);
    const byKey = await runAll(effects, { threads, inputs, coverage, sheets, verbose: flag('--verbose') });
    const records = [...byKey.values()];
    const conditions = partial ? [] : conditionRecords(records, pool);
    all = [...records, ...conditions].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.key.localeCompare(b.key));
  }
  const open = renderOpen(all, pool);
  const closed = renderClosed(all, pool);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  if (check) {
    let bad = 0;
    for (const [file, text] of [[OPEN_REPORT, open], [CLOSED_REPORT, closed]]) {
      const had = fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n') : '';
      if (had === text) { console.log(`${file}: matches`); continue; }
      bad++;
      const a = had.split('\n');
      const b = text.split('\n');
      const at = a.findIndex((l, i) => l !== b[i]);
      const card = [...a.slice(0, at + 1)].reverse().find(l => l.startsWith('#')) || '(top)';
      console.log(`${file}: differs first under "${card}"`);
      console.log(`  committed: ${a[at] ?? '(end)'}`);
      console.log(`  fresh    : ${b[at] ?? '(end)'}`);
    }
    if (bad) process.exitCode = 1;
    return;
  }
  const dir = outDir ? path.resolve(ROOT, outDir) : null;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'records.json'), `${JSON.stringify(all, null, 1)}\n`);
    fs.writeFileSync(path.join(dir, 'open.md'), open);
    fs.writeFileSync(path.join(dir, 'closed.md'), closed);
    console.log(`wrote ${path.relative(ROOT, dir) || dir}: records.json, open.md, closed.md`);
  } else {
    fs.writeFileSync(path.join(ROOT, OPEN_REPORT), open);
    fs.writeFileSync(path.join(ROOT, CLOSED_REPORT), closed);
    console.log(`wrote ${OPEN_REPORT}, ${CLOSED_REPORT}`);
  }
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
} else if (workerData?.role === WORKER_ROLE) {
  serve();
}
