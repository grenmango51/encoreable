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
 *   npm run catalog -- --check --fresh           the same, every effect played again
 *
 * A run reuses the record of every effect whose fingerprint is unchanged, from
 * .cache/catalog/ (see runAll): a change to the inference or the rebuild plays
 * every effect again, a change to the reports or to one effect's battles does
 * not.
 *   npm run catalog -- --dump move:counter user-hidden/before def 32
 *                                                the battle behind one row, and its rebuild
 *   npm run catalog -- --fuzz 100 --seed 1 --out <dir>
 *                                                random battles, p2's Stat Points inferred
 *
 * Flags: --pool --list --only <ids> --kind <kind> --sheets open|closed --inputs <file>
 *        --out <dir> --no-coverage --check --fresh --threads <n> --verbose --records <file>...
 *        --dump <effect> <role/template> <stat|-> <value> [--control] [--hazard]
 *        --fuzz <count> --seed <from> [--turns <n>] [--counts <file>]
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { battleLines } from './lib/protocol.mjs';
import { traceOn, markDraws } from './lib/rng-control.mjs';
import { inferSpreads } from './lib/inference/infer.mjs';
import { loadSource, setsFromLog, setsFromSheet } from './lib/replay-source.mjs';

const require = createRequire(import.meta.url);
const { Battle, BattleStream, Dex, Teams, TeamValidator, toID } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const { PRNG } = require('pokemon-showdown/dist/sim/prng.js');
const { RandomPlayerAI } = require('pokemon-showdown/dist/sim/tools/random-player-ai.js');
const FIXTURE = require('./fixtures/catalog.js');
const TEAMS = require('./fixtures/teams.js');

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
  // An ability only a Mega Evolution has is reached through its Stone: its
  // holders are the species that Mega Evolve with a Stone in the pool, each
  // with the forme it becomes.
  const legal = new Set(species.map(s => s.id));
  const megaOf = new Map();
  for (const id of users.item.keys()) {
    const stone = dex.items.get(id);
    if (!stone.megaStone) continue;
    for (const [base, forme] of Object.entries(stone.megaStone)) {
      const from = dex.species.get(base);
      if (!legal.has(from.id)) continue;
      for (const name of Object.values(dex.species.get(forme).abilities)) {
        const ability = dex.abilities.get(name);
        if (!ability.exists || users.ability.has(ability.id)) continue;
        if (!megaOf.has(ability.id)) megaOf.set(ability.id, []);
        megaOf.get(ability.id).push({ species: from.id, forme: dex.species.get(forme).name, stone: stone.name });
      }
    }
  }
  for (const [id, list] of megaOf) for (const m of list) add('ability', id, m.species);

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
        ...(kind === 'ability' && megaOf.has(id) ? { mega: megaOf.get(id) } : {}),
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

/**
 * Why the battle could not take a scripted choice, where the battle itself
 * decided it: the slot's Pokemon is locked into a move (a charge turn, a
 * recharge, a rampage), cannot switch out because something traps it, has the
 * move barred (Taunt, Disable, Gravity, a Choice lock), copied another's moves
 * by transforming, or is not the Pokemon the turn was written for - the one it
 * was written for fainted or was forced out, or the one it was to switch to has
 * fainted. Null when none of these explains it: then the template asked for a
 * choice the battle never offered, which is the template's defect.
 */
function whyRefused(side, wanted) {
  const req = side.activeRequest;
  if (!req?.active) return null;
  const parts = String(wanted || '').split(',').map(s => s.trim());
  for (const [i, slot] of req.active.entries()) {
    const mon = side.active[i];
    if (!mon || mon.fainted || !slot) continue;
    const part = parts[i] || '';
    const sw = /^switch (\d)/.exec(part);
    if (sw) {
      const to = req.side.pokemon[Number(sw[1]) - 1];
      if (slot.trapped || slot.maybeTrapped) return `${mon.name} is trapped`;
      if (to?.condition.endsWith(' fnt')) return `${to.ident.slice(4)}, to switch to, has fainted`;
      continue;
    }
    const want = /^move ([^\s,]+)/.exec(part)?.[1];
    if (!want || want === 'struggle') continue;
    const offered = slot.moves.find(m => m.id === want);
    if (offered && !offered.disabled) continue;
    const locked = mon.getLockedMove();
    if (locked && locked !== want) return locked === 'recharge' ? `${mon.name} must recharge` : `${mon.name} is locked into ${mon.battle.dex.moves.get(locked).name}`;
    if (mon.transformed && !mon.moveSlots.some(m => m.id === want)) return `${mon.name} transformed and has another's moves`;
    if (!mon.baseMoveSlots.some(m => m.id === want)) return `${mon.name} came in for the Pokemon the turn was written for`;
    return `${mon.name}'s ${mon.battle.dex.moves.get(want).name} is barred`;
  }
  return null;
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
  const probed = template.probeIndex || 0;
  const teams = [template.p1, template.p2.map((set, i) => (i === probed ? { ...set, evs: { ...evs } } : set))];
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
          const error = side.choice.error.replace(/^\[[^\]]+\]\s*/, '');
          refused.push({ turn: t + 1, side: side.id, choice, error, fallback, cause: whyRefused(side, choice) });
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
  const sig = JSON.stringify([template.p1, template.p2, template.turns, template.dice, template.probeIndex || 0, evs]);
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

/**
 * The target a request offers for a move: its own, except Curse, which a user
 * that is not a Ghost type uses on itself (`getMoves`, sim/pokemon.ts).
 */
const offeredTarget = (move, user) => (move.id === 'curse' && !user.types.includes('Ghost') ? 'self' : move.target);

/** A move's aim in a choice, by its user: its foe in slot a, itself, or its ally. */
function aim(move, user) {
  const target = offeredTarget(move, user);
  if (['normal', 'any', 'adjacentFoe'].includes(target)) return ' 1';
  if (target === 'adjacentAlly') return ' -2';
  if (target === 'adjacentAllyOrSelf') return ' -1';
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
      const use = `move ${move.id}${aim(move, userHidden ? hiddenSpecies : dex.species.get(knownName))}`;
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
    // An ability only a Mega has: its holder carries the Stone and Mega Evolves
    // on turn 1, and its control is the Mega forme itself from the start, with
    // Run Away, so the two differ in the ability alone.
    const megaFor = s => (s && effect.mega ? effect.mega.find(m => m.species === s.id) || null : null);
    const hiddenMega = holderHidden ? megaFor(hiddenSpecies) : null;
    const knownMega = holderHidden ? null : megaFor(holder);
    const apply = (withEffect) => {
      const hidden = hiddenFrom(hiddenSpecies, hiddenAbilityBase, '', []);
      const known = { ...knownBase, evs: { ...knownBase.evs } };
      if (effect.kind === 'item') {
        if (holderHidden) hidden.item = withEffect ? effect.name : '';
        else known.item = withEffect ? effect.name : FIXTURE.cast.known.item;
      } else if (effect.kind === 'ability') {
        const mega = hiddenMega || knownMega;
        const set = holderHidden ? hidden : known;
        if (mega) {
          set.item = mega.stone;
          set.ability = withEffect ? quietAbility(holderHidden ? hiddenSpecies : holder) : baselineAbility();
          if (!withEffect) set.species = mega.forme;
        } else if (holderHidden) hidden.ability = withEffect ? effect.name : baselineAbility();
        else known.ability = withEffect ? effect.name : knownBase.ability;
      } else if (effect.kind === 'nature') {
        hidden.nature = withEffect ? effect.name : 'Serious';
      }
      return { hidden, known };
    };
    const hiddenName = hiddenMega ? hiddenMega.forme : hiddenSpecies.name;
    const knownName = knownMega ? knownMega.forme : knownBase.species;
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
        // The side whose Pokemon Mega Evolves on turn 1: the hidden holder of a
        // Stone, or the holder of an ability only its Mega has.
        const megaSide = !withEffect ? null
          : (effect.kind === 'item' && holderHidden && dex.items.get(effect.id).megaStone) || hiddenMega ? 'p2' : knownMega ? 'p1' : null;
        return {
          p1: [p1a, castSet('knownAlly', ['Splash']), castSet('knownBench', ['Splash'])],
          p2: [{ ...hidden, moves: [...new Set(['Splash', ...(w.p2 || [])])].slice(0, 4) }, ...hiddenMates(hiddenSpecies)],
          turns: megaSide ? turns.map((t, i) => (i === 0 ? { ...t, [megaSide]: t[megaSide].replace(/^(move [^\s,]+(?: -?\d)?)/, '$1 mega') } : t)) : turns,
          dice: diceFor([...(w.p1 || []), ...(w.p2 || [])], hidden.name),
        };
      };
      const withEffect = build(true);
      const control = build(false);
      if (!withEffect || !control) continue;
      const mega = hiddenMega || knownMega;
      out.push({
        key: `${role}/${w.name}`, role, name: w.name, source: 'auto', why: null, effectTurn: 1, user: null, moveId: null, pace: w.pace || null, ...withEffect, control,
        ...(mega ? { megaControl: { forme: mega.forme, base: dex.species.get(mega.forme).baseSpecies } } : {}),
      });
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
  const dice = [...(t.dice || []), ...diceFor(moves.filter(m => toID(m) !== effect.id), p2[0].name)];
  const control = t.control ? { p1: patch(p1, t.control.p1), p2: patch(p2, t.control.p2), turns: t.control.turns || turns, dice } : null;
  const probeIndex = t.probe === 'p2b' ? 1 : 0;
  if (t.worlds && t.worlds !== 'sweep' && !(Array.isArray(t.worlds) && t.worlds.length === 2 && t.worlds.every(v => Number.isInteger(v) && v >= 0 && v <= 32) && t.worlds[0] < t.worlds[1])) {
    throw new Error(`${effect.key} ${t.role}/${t.name}: worlds is two Stat Points, lower first, or 'sweep'`);
  }
  if (t.stat && !STATS.includes(t.stat)) throw new Error(`${effect.key} ${t.role}/${t.name}: no stat ${t.stat}`);
  if (t.worlds === 'sweep' && !t.stat) throw new Error(`${effect.key} ${t.role}/${t.name}: a sweep names its stat`);
  return {
    key: `${t.role}/${t.name}`, role: t.role, name: t.name, source: 'fixture', why: t.why || null, effectTurn: t.effectTurn || 1,
    user: effect.kind === 'move' ? (t.role === 'user-hidden' ? 'p2a' : 'p1a') : null, moveId: effect.kind === 'move' ? effect.id : null,
    p1, p2, turns, dice, control,
    stat: t.stat || null, worlds: t.worlds || null, probeIndex,
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
 * A battle of a Mega-only ability, or its control, written so the two compare
 * line for line: the control is the Mega forme from the start, so the Mega
 * Evolution's own lines are dropped and the forme's name reads as the base
 * species'. Any other template's lines are returned as they are.
 */
function alike(template, lines) {
  const m = template.megaControl;
  if (!m) return lines;
  return lines.filter(l => !/^\|(?:-mega|detailschange)\|/.test(l)).map(l => l.split(`${m.forme}, `).join(`${m.base}, `));
}

/**
 * Whether the effect acted at all in a template, read off the battle at base
 * Stat Points against its control: for a move, its own line printed and was not
 * followed by a failure; and in any case, the log differs from the control's by
 * more than the effect's own line.
 */
function fired(template, base, control) {
  const out = {
    acted: true, visible: false, failedBy: null, calls: 0,
    refused: base.refused.filter(r => !r.cause).map(r => `T${r.turn} ${r.side}: ${r.error}`),
    overridden: base.refused.filter(r => r.cause).map(r => `T${r.turn} ${r.side}: ${r.cause}`),
  };
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
    out.visible = diffLogs(readLog(alike(template, control.ch1)), readLog(alike(template, base.ch1))).some(c => c.type !== 'order' && !own(c));
  }
  return out;
}

/**
 * The pairs of worlds a template asks about one stat: 0 and 32 unless it names
 * two values; for a sweep, every value 0-32 is played, and each two adjacent
 * values the known side's view tells apart make a pair, so a boundary between
 * two shares of max HP, or a parity, is asked about where it falls.
 */
async function worldPairs(template, stat) {
  if (template.worlds !== 'sweep') return [template.worlds || [0, 32]];
  const views = [];
  for (let v = 0; v <= 32; v++) views.push(battleLines((await cachedRun(template, world(stat, v))).ch1).join('\n'));
  const pairs = [];
  for (let v = 0; v < 32; v++) if (views[v] !== views[v + 1]) pairs.push([v, v + 1]);
  return pairs;
}

/**
 * One template through the probe: the base battle, and for every stat it
 * varies each pair of worlds, each against the control's. What survives is the
 * effect's.
 */
async function probeTemplate(template) {
  const base = await runBattle(template, BASE, { watch: true });
  const controlBase = template.control ? await cachedRun(template.control, BASE) : null;
  const stats = {};
  for (const stat of template.stat ? [template.stat] : STATS) {
    stats[stat] = [];
    // A sweep's worlds were played already, to find its pairs.
    const play = template.worlds === 'sweep' ? cachedRun : runBattle;
    for (const [lo, hi] of await worldPairs(template, stat)) {
      const e0 = await play(template, world(stat, lo));
      const e32 = await play(template, world(stat, hi));
      const c0 = template.control ? await cachedRun(template.control, world(stat, lo)) : null;
      const c32 = template.control ? await cachedRun(template.control, world(stat, hi)) : null;
      const inEffect = diffLogs(readLog(e0.ch1), readLog(e32.ch1));
      const inControl = c0 ? diffLogs(readLog(c0.ch1), readLog(c32.ch1)) : [];
      const exact = [e0, e32, c0, c32].map(r => (r ? readLog(r.all) : null));
      const changes = effectChanges(inEffect, inControl, exact);
      stats[stat].push({ values: [lo, hi], e0, e32, changes, masked: inControl.length > 0, unstable: e0.draws !== e32.draws || !!e0.error || !!e32.error });
    }
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
    const p = inf.pokemon.find(x => x.id === `p2:${template.probeIndex || 0}`);
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
  const [lo, hi] = entry.values;
  const id = `p2:${template.probeIndex || 0}`;
  for (const [value, run, other] of [[lo, entry.e0, hi], [hi, entry.e32, lo]]) {
    const r = await inferWorld(template, run);
    if (r.error) { worlds.push({ value, error: r.error }); continue; }
    const cutBy = [];
    for (const c of entry.changes) {
      const line = (value === lo ? c.at0 : c.at32) ?? '';
      const kind = line.split('|')[1];
      const figure = HP_FIELD[kind] !== undefined ? String(line.split('|')[HP_FIELD[kind]] || '').split(' ')[0] : null;
      for (const e of r.inf.events) {
        if (e.turn !== c.turn) continue;
        const cut = e.cuts.find(x => x.id === id && x.after < x.before);
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
      narrowedBy: [...new Set(r.inf.events.filter(e => e.cuts.some(x => x.id === id && x.narrowed.includes(stat))).map(e => e.what))],
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
  const changes = diffLogs(readLog(alike(template, control.ch1)), readLog(alike(template, base.ch1)))
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
    open: { outcome: null, stats: [], reason: entry?.unfireable || null, why: entry?.reason || null },
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
    const probed = template.probeIndex || 0;
    const slot = probed === 1 ? 'p2b' : 'p2a';
    const subject = battleLines(probe.base.ch1).find(l => l.startsWith(`|switch|${slot}: `))?.split('|')[2] || `${slot}: ${template.p2[probed].name}`;
    for (const l of battleLines(probe.base.ch1)) {
      const from = fromTag(l.split('|'));
      if (from && !from.includes(':')) seen.add(from);
      const m = /^\|(?:-start|-status|-weather|-fieldstart|-sidestart)\|(?:[^|]*\|)?(?:move: )?([^|]+)/.exec(l);
      if (m) seen.add(toID(m[1]));
    }
    record.templates.push({
      key: template.key, role: template.role, name: template.name, source: template.source, why: template.why,
      hidden: `${template.p2[probed].species}${template.p2[probed].item ? ` @ ${template.p2[probed].item}` : ''} (${template.p2[probed].ability}, ${template.p2[probed].nature})`,
      ...(probed ? { probe: slot } : {}),
      known: `${template.p1[0].species}${template.p1[0].item ? ` @ ${template.p1[0].item}` : ''} (${template.p1[0].ability})`,
      acted: act.acted, visible: act.visible, failedBy: act.failedBy, calls: act.calls, refused: act.refused, overridden: act.overridden,
      unstable: STATS.filter(s => probe.stats[s]?.some(e => e.unstable)),
    });

    if (sheets.open && effect.kind !== 'nature') {
      const wonderRoom = probe.base.ch1.some(l => l.includes('|-fieldstart|move: Wonder Room'));
      for (const [stat, pairs] of Object.entries(probe.stats)) for (const entryStat of pairs) {
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
        // Two worlds that drew different dice cannot say whether the line is
        // used, but each must still keep its own real spread.
        const failed = entryStat.e0.error || entryStat.e32.error;
        const covered = coverage && !failed ? await cover(template, stat, entryStat, effect.name) : null;
        const verdict = !covered ? (entryStat.unstable ? 'UNSTABLE' : null)
          : !entryStat.unstable || ['UNSOUND', 'ERROR'].includes(covered.verdict) ? covered.verdict : 'UNSTABLE';
        // The hidden Pokemon's ally, probed, is a role of its own.
        const [lo, hi] = entryStat.values;
        record.open.stats.push({
          role: probed ? 'ally-hidden' : template.role, template: template.key, stat,
          ...(lo !== 0 || hi !== 32 ? { values: [lo, hi] } : {}), ...(template.worlds === 'sweep' ? { sweep: true } : {}),
          masked: entryStat.masked, unstable: entryStat.unstable, rows, verdict, worlds: covered?.worlds || null,
        });
        say(`  ${effect.key} ${template.key} ${stat}${lo !== 0 || hi !== 32 ? ` ${lo}|${hi}` : ''}: ${rows.length} change(s)${verdict ? `, ${verdict}` : ''}`);
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


/**
 * Conditions have no battle of their own: their card is the rows other
 * effects' battles printed under them, in the order of those effects' keys -
 * not the order the threads finished them in, which no two runs share.
 */
function conditionRecords(records, pool) {
  const byCondition = new Map();
  for (const r of [...records].sort((a, b) => a.key.localeCompare(b.key))) {
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
const ROLE_LETTER = { 'user-hidden': 'U', 'target-hidden': 'T', 'holder-hidden': 'H', 'other-hidden': 'O', 'ally-hidden': 'A' };
/** A stat as a row names it: `HP`, or `HP 13|14` for two worlds other than 0 and 32. */
const statLabel = s => `${STAT_NAME[s.stat]}${s.values ? ` ${s.values[0]}|${s.values[1]}` : ''}`;
const pairOf = s => (s.values ? `${s.values[0]}|${s.values[1]}` : '0|32');
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

/** The written reasons an entry gives for single rows of its card, by `<role letter>:<Stat>` or `read:<Stat>`. */
const cellsOf = (entries, key) => entries?.[key]?.cells || {};
const cellOf = g => `${ROLE_LETTER[g.role]}:${STAT_NAME[g.stat]}`;

function openCard(record, entries) {
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
    const printed = new Set();
    for (const s of [...record.open.stats].sort((a, b) => a.role.localeCompare(b.role) || STATS.indexOf(a.stat) - STATS.indexOf(b.stat) || a.template.localeCompare(b.template) || (a.values?.[0] ?? 0) - (b.values?.[0] ?? 0))) {
      // A sweep shows its first boundary of each verdict; the line under the
      // table lists every one.
      const key = `${s.role}|${s.template}|${s.stat}|${s.verdict}`;
      if (s.sweep && printed.has(key)) continue;
      printed.add(key);
      for (const [i, r] of s.rows.slice(0, 3).entries()) {
        out.push(`| ${ROLE_LETTER[s.role]} | ${esc(statLabel(s))} | ${s.template.split('/')[1]} | ${r.sink} | ${r.turn} | ${code(r.at0)} | ${code(r.at32)} | ${r.spectator} | ${r.mechanism} | ${r.own ? 'own' : 'modified'} | ${i === 0 ? `${s.verdict || 'not rebuilt'}${s.verdict === 'USED' && s.masked ? ' (own event)' : ''}` : '〃'} | ${i === 0 ? worldsText(s) : ''} | ${i === 0 ? usedByOf(s) : ''} |`);
      }
      if (s.rows.length > 3) out.push(`| ${ROLE_LETTER[s.role]} | ${esc(statLabel(s))} | ${s.template.split('/')[1]} | … | | ${s.rows.length - 3} more changed line(s) | | | | | | | |`);
    }
    out.push('');
  }
  const shown = record.templates.filter(t => !t.acted || !t.visible || t.refused.length || t.overridden?.length || t.unstable.length);
  if (shown.length && record.kind !== 'condition') {
    out.push('Templates: ' + record.templates.map(t => `${t.key}${t.source === 'fixture' ? ' (hand-set)' : ''}${!t.acted ? ` failed (${code(t.failedBy)})` : !t.visible ? ' changed nothing' : ''}${t.refused.length ? ` · refused ${esc(t.refused.join('; '))}` : ''}${t.overridden?.length ? ` · the battle overrode ${esc(t.overridden.join('; '))}` : ''}${t.unstable.length ? ` · dice differ for ${t.unstable.join(', ')}` : ''}`).join(' · '));
    out.push('');
  }
  // Every boundary a sweep found, by verdict.
  const swept = new Map();
  for (const s of record.open.stats.filter(x => x.sweep)) {
    const k = `${s.template}|${s.stat}`;
    if (!swept.has(k)) swept.set(k, []);
    swept.get(k).push(s);
  }
  for (const [k, list] of swept) {
    const [template, stat] = k.split('|');
    const by = new Map();
    for (const s of list) by.set(s.verdict || 'not rebuilt', [...(by.get(s.verdict || 'not rebuilt') || []), pairOf(s)]);
    out.push(`Sweep of ${STAT_NAME[stat]} in ${template}, ${list.length} boundaries: ${[...by].map(([v, pairs]) => `${v} at ${pairs.join(', ')}`).join('; ')}.`, '');
  }
  for (const t of record.templates.filter(x => x.why)) out.push(`Template ${t.key}${t.probe ? ` (probes ${t.probe})` : ''}: ${t.why}`, '');
  if (record.open.why) out.push(`Reason: ${record.open.why}`, '');
  for (const [cell, why] of Object.entries(cellsOf(entries, record.key))) out.push(`Reason for ${cell}: ${why}`, '');
  if (record.note) out.push(`Note: ${record.note}`, '');
  return out;
}

/** Stats a handler reads that no battle showed a change for. */
function unreadStats(record) {
  if (!record.scan) return [];
  const shown = new Set(record.open.stats.map(s => s.stat));
  return record.scan.stats.filter(s => !shown.has(s));
}

function renderOpen(records, pool, entries = FIXTURE.entries) {
  const out = header('Evidence, open team sheets — what every legal effect lets reach the log about Stat Points', pool);
  const open = records.filter(r => r.kind !== 'nature');
  const cellReason = (r, cell) => cellsOf(entries, r.key)[cell] || null;
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
  out.push('| UNSTABLE | ~ | the two worlds drew a different number of dice, speed ties aside, so the difference is not only the stat: rebuilt only to check that each world keeps its real spread, which it does |');
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
  out.push('holds it and acts on the hidden Pokemon, `A` a hand-set battle that varies the hidden Pokemon\'s ally (p2b) instead.');
  out.push('A hand-set battle may also name its two worlds, or sweep a stat over every value 0–32 and ask about each two');
  out.push('adjacent values the known side\'s view tells apart; such a row names its pair, `HP 13|14`. A card may carry a');
  out.push('written **Reason** the effect cannot carry a Stat Point on an open sheet, or a **Reason for** one row of it —');
  out.push('`T:Spe` for a verdict row, `read:HP` for a stat its handlers read unseen — which takes that row off the work list;');
  out.push('and a template a choice **the battle overrode** — a lock, a trap, a barred move, a Pokemon that had left — with');
  out.push('why. At most three changed lines per stat are shown. `npm run catalog -- --dump <effect> <role/template> <stat>');
  out.push('<value>` prints the battle behind any row and what the rebuild made of it.');
  out.push('');

  // Summary.
  const VERDICTS = ['USED', 'UNUSED', 'UNSOUND', 'REBUILD-FAILED', 'MASKED', 'ERROR', 'UNSTABLE'];
  out.push('## 1. Summary', '', '### 1.1 By kind', '');
  out.push(`| Kind | Effects | CHANNEL | NO CHANNEL | NOT SHOWN | of them with a reason | UNFIREABLE | ${VERDICTS.join(' | ')} |`);
  out.push(`|---|---|---|---|---|---|---|${VERDICTS.map(() => '---|').join('')}`);
  const all = open.flatMap(r => groupsOf(r).map(g => ({ r, ...g })));
  for (const kind of ['move', 'ability', 'item']) {
    const list = open.filter(r => r.kind === kind);
    const o = v => list.filter(r => r.open.outcome === v).length;
    const here = all.filter(g => g.r.kind === kind);
    out.push(`| ${kind} | ${list.length} | ${o('CHANNEL')} | ${o('NO CHANNEL')} | ${o('NOT SHOWN')} | ${list.filter(r => r.open.outcome === 'NOT SHOWN' && r.open.why).length} | ${o('UNFIREABLE')} | ${VERDICTS.map(x => here.filter(g => g.verdict === x).length).join(' | ')} |`);
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

  // What is left, against what has a written reason it cannot carry a Stat Point.
  const left = verdict => all.filter(g => g.verdict === verdict);
  const reasonedRow = g => !!cellReason(g.r, cellOf(g));
  const notShownAll = open.filter(r => r.open.outcome === 'NOT SHOWN');
  const reads = open.filter(r => r.kind !== 'condition' && r.open.outcome !== 'NOT SHOWN').flatMap(r => unreadStats(r).map(stat => ({ r, stat })));
  const reasonedRead = x => !!cellReason(x.r, `read:${STAT_NAME[x.stat]}`);
  const asideOf = r => [...new Set(r.open.stats.flatMap(s => (s.worlds || []).flatMap(w => w.setAside || [])))];
  const asides = open.filter(r => asideOf(r).length).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  // Every boundary a sweep found that is not USED, one per (effect, template, stat).
  const sweeps = [];
  for (const r of open) {
    const by = new Map();
    for (const s of r.open.stats.filter(x => x.sweep && x.verdict !== 'USED')) {
      const k = `${s.template}|${s.stat}`;
      if (!by.has(k)) by.set(k, { r, template: s.template, stat: s.stat, list: [] });
      by.get(k).list.push(s);
    }
    sweeps.push(...by.values());
  }
  sweeps.sort((a, b) => b.r.weight - a.r.weight || a.r.key.localeCompare(b.r.key) || a.template.localeCompare(b.template));
  const sweepReason = x => cellReason(x.r, `sweep:${STAT_NAME[x.stat]}`);
  const boundaries = sweeps.flatMap(x => x.list.map(s => ({ ...x, s })));
  out.push('### 1.3 What is left', '');
  out.push('| List | Rows | With a written reason | Work |', '|---|---|---|---|');
  for (const [label, list, reasoned] of [
    ['UNUSED (§2.2)', left('UNUSED'), reasonedRow],
    ['MASKED (§2.4)', left('MASKED'), reasonedRow],
    ['NOT SHOWN (§2.5)', notShownAll, r => !!r.open.why],
    ['Scan reads with no change (§2.6)', reads, reasonedRead],
    ['Set aside by the inference (§2.7)', asides, r => !!cellReason(r, 'aside')],
    ['Sweep boundaries not USED (§2.8)', boundaries, x => !!sweepReason(x)],
  ]) {
    const n = list.filter(reasoned).length;
    out.push(`| ${label} | ${list.length} | ${n} | ${list.length - n} |`);
  }
  out.push('', 'UNUSED and MASKED count (effect, role, stat, mechanism), as in 1.1; NOT SHOWN and a set-aside row count effects; a scan read counts (effect, stat); a sweep counts its boundaries. A row with a written reason is listed under its section apart from the work.', '');

  // Work lists, one row per effect, role, stat and mechanism, heaviest first.
  out.push('## 2. Work list', '');
  out.push('One row per effect, role, stat and mechanism, with the verdict §0 gives it. `Templates` names the battles that');
  out.push('gave that verdict; `npm run catalog -- --dump <effect> <role>/<template> <stat> <value>` shows any of them.', '');
  const picked = verdicts => all.filter(g => verdicts.includes(g.verdict))
    .map(g => ({ ...g, those: g.list.filter(s => s.verdict === g.verdict) }))
    .sort((a, b) => b.r.weight - a.r.weight || a.r.key.localeCompare(b.r.key) || a.role.localeCompare(b.role) || STATS.indexOf(a.stat) - STATS.indexOf(b.stat) || a.mech.localeCompare(b.mech));
  const names = those => [...new Set(those.map(s => s.template.split('/')[1]))].join(', ');
  const withReason = (list) => {
    if (!list.length) return;
    out.push('Not work — with a written reason:', '');
    out.push('| Effect | Weight | Role | Stat | Mech | Templates | Reason |', '|---|---|---|---|---|---|---|');
    for (const u of list) out.push(`| \`${u.r.key}\` | ${u.r.weight} | ${ROLE_LETTER[u.role]} | ${STAT_NAME[u.stat]} | ${u.mech} | ${names(u.those)} | ${esc(cellReason(u.r, cellOf(u)))} |`);
    out.push('');
  };
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
  const unused = picked(['UNUSED']).filter(u => !reasonedRow(u)).map(u => ({ ...u, info: Math.max(...u.those.flatMap(s => s.rows.map(x => INFO[x.sink] || 1))) }))
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
  withReason(picked(['UNUSED']).filter(reasonedRow));
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
  const masked = picked(['MASKED']).filter(u => !reasonedRow(u));
  if (!masked.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Role | Stat | Mech | Templates | The effect\'s line, at 0 |', '|---|---|---|---|---|---|---|');
    for (const u of masked) {
      const row = u.those.flatMap(s => s.rows).find(x => x.own) || u.those[0].rows[0];
      out.push(`| \`${u.r.key}\` | ${u.r.weight} | ${ROLE_LETTER[u.role]} | ${STAT_NAME[u.stat]} | ${u.mech} | ${names(u.those)} | ${code(row.at0 ?? row.at32)} |`);
    }
    out.push('');
  }
  withReason(picked(['MASKED']).filter(reasonedRow));
  out.push('### 2.5 NOT SHOWN — no template made the effect act where a replay would see it', '');
  out.push('Each needs a hand-set template (`scripts/fixtures/catalog.js`), or a written reason that it cannot carry a Stat Point on an open sheet.', '');
  const notShown = open.filter(r => r.open.outcome === 'NOT SHOWN').sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  const work = notShown.filter(r => !r.open.why);
  if (!work.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Scan reads | Why, per template |', '|---|---|---|---|');
    for (const r of work) {
      const why = [...new Set(r.templates.map(t => (!t.acted ? `failed: ${t.failedBy}` : 'changed nothing')))].slice(0, 3).join('; ');
      out.push(`| \`${r.key}\` | ${r.weight} | ${r.scan?.reads.length ? r.scan.reads.join(', ') : '—'} | ${esc(why)} |`);
    }
    out.push('');
  }
  const reasoned = notShown.filter(r => r.open.why);
  if (reasoned.length) {
    out.push('Not work — NOT SHOWN with a written reason:', '');
    out.push('| Effect | Weight | Reason |', '|---|---|---|');
    for (const r of reasoned) out.push(`| \`${r.key}\` | ${r.weight} | ${esc(r.open.why)} |`);
    out.push('');
  }
  out.push('### 2.6 Scan reads with no change', '');
  out.push('The handlers read the stat and no battle here changed a line with it: a template that reaches the read, or a written reason.', '');
  const flagged = [...new Set(reads.filter(x => !reasonedRead(x)).map(x => x.r))];
  if (!flagged.length) out.push('None.', '');
  else {
    out.push('| Effect | Outcome | Stats read, unseen |', '|---|---|---|');
    for (const r of flagged) out.push(`| \`${r.key}\` | ${r.open.outcome} | ${reads.filter(x => x.r === r && !reasonedRead(x)).map(x => STAT_NAME[x.stat]).join(', ')} |`);
    out.push('');
  }
  const readReasons = reads.filter(reasonedRead);
  if (readReasons.length) {
    out.push('Not work — with a written reason:', '');
    out.push('| Effect | Outcome | Stat | Reason |', '|---|---|---|---|');
    for (const x of readReasons) out.push(`| \`${x.r.key}\` | ${x.r.open.outcome} | ${STAT_NAME[x.stat]} | ${esc(cellReason(x.r, `read:${STAT_NAME[x.stat]}`))} |`);
    out.push('');
  }
  out.push('### 2.7 Set aside by the inference\'s own check', '');
  out.push('Where a shortcut of the evidence pass gave another answer than the simulator, at the stats the rebuild was running with, and the line was not used rather than trusted. Each is evidence given up, never a spread removed: work to use it.', '');
  const asideText = (r) => {
    const lines = asideOf(r);
    return `${esc(lines.slice(0, 3).join('; '))}${lines.length > 3 ? `; and ${lines.length - 3} more` : ''}`;
  };
  const asideWork = asides.filter(r => !cellReason(r, 'aside'));
  const asideReasons = asides.filter(r => cellReason(r, 'aside'));
  if (!asideWork.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | What was set aside, and why |', '|---|---|---|');
    for (const r of asideWork) out.push(`| \`${r.key}\` | ${r.weight} | ${asideText(r)} |`);
    out.push('');
  }
  if (asideReasons.length) {
    out.push('Not work — with a written reason:', '');
    out.push('| Effect | Weight | What was set aside | Reason |', '|---|---|---|---|');
    for (const r of asideReasons) out.push(`| \`${r.key}\` | ${r.weight} | ${asideText(r)} | ${esc(cellReason(r, 'aside'))} |`);
    out.push('');
  }
  out.push('### 2.8 Sweep boundaries not USED', '');
  out.push('A boundary between two adjacent values the sweep played that the inference did not show telling apart through the effect\'s own line: MASKED where the battle\'s other lines already told them apart, UNSTABLE where the two worlds threw a different number of dice.', '');
  const sweepRow = x => `| \`${x.r.key}\` | ${x.r.weight} | ${x.template.split('/')[1]} | ${STAT_NAME[x.stat]} | ${esc([...new Set(x.list.map(s => s.verdict || 'not rebuilt'))].map(v => `${v} at ${x.list.filter(s => (s.verdict || 'not rebuilt') === v).map(pairOf).join(', ')}`).join('; '))}`;
  const sweepWork = sweeps.filter(x => !sweepReason(x));
  const sweepReasons = sweeps.filter(x => sweepReason(x));
  if (!sweepWork.length) out.push('None.', '');
  else {
    out.push('| Effect | Weight | Template | Stat | Boundaries |', '|---|---|---|---|---|');
    for (const x of sweepWork) out.push(`${sweepRow(x)} |`);
    out.push('');
  }
  if (sweepReasons.length) {
    out.push('Not work — with a written reason:', '');
    out.push('| Effect | Weight | Template | Stat | Boundaries | Reason |', '|---|---|---|---|---|---|');
    for (const x of sweepReasons) out.push(`${sweepRow(x)} | ${esc(sweepReason(x))} |`);
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
        out.push(`| ${r.name} | ${r.meta.category} | ${r.meta.users} | ${r.open.outcome}${r.open.why ? `: ${esc(r.open.why)}` : ''} | ${esc(r.templates.map(t => `${ROLE_LETTER[t.role]} ${t.name}: ${!t.acted ? `failed (${t.failedBy})` : t.visible ? 'acted' : 'changed nothing'}`).join('; '))} |`);
      }
      out.push('', '### 3.3 Every other move', '');
      for (const r of rest.filter(x => x.open.outcome === 'CHANNEL')) out.push(...openCard(r, entries));
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
      for (const r of list.filter(x => x.open.outcome !== 'CHANNEL')) out.push(`| ${r.name} | ${r.meta.users} | ${r.open.outcome}${r.open.why ? `: ${esc(r.open.why)}` : ''} | ${r.scan?.reads.join(', ') || '—'} |`);
      out.push('', `### ${num}.2 Cards`, '');
      for (const r of list.filter(x => x.open.outcome === 'CHANNEL')) out.push(...openCard(r, entries));
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

// --------------------------------------------------------------- the fuzzer

const FUZZ_ROLE = 'catalog-fuzz';
const FUZZ_SOURCES = ['recordings/showdown/mine-open', 'recordings/showdown/full-sheets'];
const FUZZ_TURNS = 12;

/**
 * The seed of one generator, four 16-bit words, from a battle's number and a
 * salt: every choice a fuzz battle makes comes from its number alone.
 */
function seedFor(n, salt) {
  let x = BigInt.asUintN(64, BigInt(n) * 0x9E3779B97F4A7C15n + BigInt(salt) * 0xD1B54A32D192ED03n);
  const words = [];
  for (let i = 0; i < 4; i++) {
    x = BigInt.asUintN(64, x + 0x9E3779B97F4A7C15n);
    let z = x;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn);
    z ^= z >> 31n;
    words.push(Number(z & 0xFFFFn) || 1);
  }
  return words.join(',');
}

/**
 * Every Reg M-C team the fuzzer draws from: the team sheets of the replays in
 * recordings/showdown/mine-open/ and full-sheets/, and the fixture teams of
 * scripts/fixtures/teams.js. A Mega forme is brought as the species it Mega
 * Evolves from; a team the validator refuses (a Reg M-B game's) is left out,
 * and one brought twice is kept once. Sorted by label, so the same files give
 * the same pool.
 */
function fuzzTeams() {
  const validator = TeamValidator.get(FORMAT);
  const teams = [];
  const refused = [];
  const seen = new Set();
  const add = (label, sets) => {
    const team = sets.map((set) => {
      const given = dex.species.get(set.species || set.name);
      const species = given.battleOnly && given.requiredItem && toID(given.requiredItem) === toID(set.item)
        ? dex.species.get(Array.isArray(given.battleOnly) ? given.battleOnly[0] : given.battleOnly) : given;
      return {
        name: species.baseSpecies, species: species.name, item: set.item || '', ability: set.ability || '',
        moves: [...set.moves], nature: set.nature || 'Serious', gender: '', level: 50, evs: { ...BASE },
      };
    });
    const sig = team.map(s => [s.species, s.item, s.ability, s.nature, [...s.moves].sort().join('/')].join(':')).sort().join(' ');
    if (seen.has(sig)) return;
    seen.add(sig);
    const problems = validator.validateTeam(team.map(s => ({ ...s, gender: dex.species.get(s.species).gender || '' })));
    if (problems?.length) refused.push({ label, problem: problems[0] });
    else teams.push({ label, sets: team });
  };
  for (const dir of FUZZ_SOURCES) {
    const at = path.join(ROOT, dir);
    if (!fs.existsSync(at)) continue;
    for (const file of fs.readdirSync(at).filter(f => /\.(html|json)$/.test(f)).sort()) {
      const source = loadSource(path.join(at, file));
      for (const [i, sheet] of source.sheets.entries()) if (sheet) add(`${path.basename(dir)}/${file} p${i + 1}`, setsFromSheet(sheet));
    }
  }
  for (const [key, sides] of Object.entries(TEAMS.TEAM_SETS)) {
    for (const [side, text] of Object.entries(sides)) add(`teams.js ${key} ${side}`, Teams.import(text));
  }
  teams.sort((a, b) => a.label.localeCompare(b.label));
  return { teams, refused };
}

/**
 * Random Stat Points for one Pokemon: `total` of them, each stat at most 32,
 * dealt one at a time to stats weighted unevenly, so some spreads are lopsided
 * and some even.
 */
function randomSpread(rng, total) {
  const weight = STATS.map(() => rng.random() ** 2 + 0.05);
  const evs = Object.fromEntries(STATS.map(s => [s, 0]));
  for (let k = 0; k < total; k++) {
    const open = STATS.filter(s => evs[s] < 32);
    let r = rng.random() * open.reduce((t, s) => t + weight[STATS.indexOf(s)], 0);
    const pick = open.find(s => (r -= weight[STATS.indexOf(s)]) < 0) || open[open.length - 1];
    evs[pick]++;
  }
  return evs;
}

/**
 * Everything one fuzz battle is, from its number: two different teams, a
 * gender and random Stat Points for every Pokemon - in about half the battles
 * every Pokemon spends all 66, in the rest each spends a random amount - the
 * battle's seed and each player's.
 */
function fuzzRecipe(n, teams, cap) {
  const rng = new PRNG(seedFor(n, 1));
  const i = rng.random(teams.length);
  let j = teams.length > 1 ? rng.random(teams.length - 1) : 0;
  if (teams.length > 1 && j >= i) j++;
  const spendAll = rng.random() < 0.5;
  const build = team => team.sets.map((set) => {
    const species = dex.species.get(set.species);
    const gender = species.gender || (rng.random() < 0.5 ? 'M' : 'F');
    return { ...set, moves: [...set.moves], gender, evs: randomSpread(rng, spendAll ? 66 : rng.random(0, 67)) };
  });
  return { n, labels: [teams[i].label, teams[j].label], spendAll, sides: [build(teams[i]), build(teams[j])], seed: seedFor(n, 2), ai: [seedFor(n, 3), seedFor(n, 4)], cap };
}

/**
 * Pokemon Showdown's own random player: every choice it makes is one the
 * request offers. It is asked directly, request by request, and its team
 * preview brings four in a seeded order rather than `default`.
 */
class FuzzPlayer extends RandomPlayerAI {
  constructor(seed) {
    super({ write() {} }, { move: 0.85, mega: 0.5, seed });
    this.chosen = null;
  }

  choose(choice) {
    this.chosen = choice;
  }

  chooseTeamPreview(team) {
    const order = team.map((_, i) => i + 1);
    this.prng.shuffle(order);
    return `team ${order.join('')}`;
  }
}

/**
 * A choice the random player made, in words: each slot's move by name with its
 * target and a Mega Evolution, or the Pokemon it switches to.
 */
function describeChoice(request, choice) {
  return String(choice).split(',').map((part, i) => {
    const words = part.trim().split(/\s+/);
    // A request lists the active Pokemon first, in slot order.
    const who = request.active ? request.side.pokemon[i]?.ident.slice(4) || `slot ${i + 1}` : '';
    if (words[0] === 'move') {
      const move = request.active?.[i]?.moves[Number(words[1]) - 1];
      return `${who} ${move?.move || words[1]}${words.slice(2).length ? ` ${words.slice(2).join(' ')}` : ''}`.trim();
    }
    if (words[0] === 'switch') return `${who ? `${who} ` : ''}to ${request.side.pokemon[Number(words[1]) - 1]?.ident.slice(4) || words[1]}`;
    return part.trim();
  }).join(', ');
}

/** One fuzz battle, in-process in the real format, up to the start of turn `cap + 1`. */
async function playFuzz(recipe) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) { /* discard */ } })();
  const players = recipe.ai.map(seed => new FuzzPlayer(seed));
  const choices = [];
  try {
    await stream.write(`>start ${JSON.stringify({ formatid: FORMAT, seed: recipe.seed })}`);
    const battle = stream.battle;
    // Install before >player: even gender rolls belong to the ordinal stream.
    const dice = traceOn(battle);
    const push = dice.push;
    dice.push = row => {
      const stack = {};
      Error.captureStackTrace(stack, dice.push);
      const site = String(stack.stack).split('\n').find(l => / at /.test(l) && !/rng-command|(?:Battle|PRNG)\.(?:random|randomChance|sample|sampleNoReplace|shuffle)\b/.test(l));
      return push.call(dice, { ...row, kind: `${battle.effect?.id || 'draw'}:${site?.trim().replace(/ \(.*/, '').replace(/^at /, '') || 'random'}` });
    };
    markDraws(battle, 0);
    for (const [i, team] of recipe.sides.entries()) {
      await stream.write(`>player p${i + 1} ${JSON.stringify({ name: i ? 'Hidden' : 'Known', team: Teams.pack(team) })}`);
    }
    for (let guard = 0; guard < 4000 && !battle.ended && battle.turn <= recipe.cap; guard++) {
      const owing = battle.sides.filter(s => s.activeRequest && !s.activeRequest.wait && !s.isChoiceDone());
      if (!owing.length) throw new Error('battle: no side owes a choice and the battle goes on');
      for (const side of owing) {
        const ai = players[side.n];
        for (let tries = 0; ; tries++) {
          ai.chosen = null;
          try {
            ai.receiveRequest(side.activeRequest);
          } catch (err) {
            throw new Error(`chooser: ${err.message}`);
          }
          if (!ai.chosen) throw new Error(`chooser: no choice for ${side.id}`);
          const request = side.activeRequest;
          const asked = JSON.stringify(request);
          const turn = battle.turn;
          const offered = {
            pokemon: request.side.pokemon.map(p => ({ name: p.ident.slice(4), moves: p.moves })),
            active: request.active?.map(p => p?.moves?.map(m => m.id || toID(m.move))),
          };
          // A forced replacement is still part of the turn that fainted it.
          markDraws(battle, turn);
          await stream.write(`>${side.id} ${ai.chosen}`);
          if (!side.choice.error) {
            choices.push({ turn, side: side.id, raw: ai.chosen, offered, choice: describeChoice(request, ai.chosen) });
            break;
          }
          // An unavailable choice (a trap the request could not show) updates
          // the request in place, as for a player, and the random player asks
          // again, free to undo the slots it had already chosen; an invalid
          // one leaves the request as it was.
          const updated = JSON.stringify(side.activeRequest) !== asked;
          if (!updated || tries > 4) throw new Error(`chooser: ${side.id} "${ai.chosen}": ${side.choice.error}`);
          side.choice.cantUndo = false;
        }
      }
    }
    const channels = extractChannelMessages(battle.log.join('\n'), [1]);
    return { ch1: channels[1], turns: battle.turn, ended: battle.ended, choices, dice };
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
}

/** Every name a fuzz battle prints a Pokemon under, longest first, so a signature can drop them. */
function namesIn(recipe) {
  const names = new Set();
  for (const set of recipe.sides.flat()) {
    const species = dex.species.get(set.species);
    names.add(set.name);
    names.add(species.name);
    for (const forme of Object.values(dex.items.get(set.item).megaStone || {})) names.add(forme);
  }
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length);
}

/** A line or a message with its Pokemon and its numbers taken out, so failures of one kind share it. */
function normalised(text, names) {
  let out = String(text ?? '');
  for (const name of names) out = out.split(name).join('X');
  return out.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

/**
 * The event that removed a real spread: the first, in the order the evidence
 * pass applied them (each event's ranges are what every event before it left),
 * that cut the Pokemon's range of a stat past its real value; or else the last
 * that cut it at all, since a spread can be removed with every stat still in
 * range; or none, when the spread was lost after the recorded pass - a later
 * pass, or the search's own knowledge.
 */
function removedBy(inf, id, real) {
  let last = null;
  for (const e of inf.events) {
    const cut = e.cuts.find(c => c.id === id);
    if (!cut || !(cut.after < cut.before)) continue;
    last = e;
    const past = STATS.filter(s => cut.stats?.[s] && (real[s] < cut.stats[s].min || real[s] > cut.stats[s].max));
    if (past.length) return { turn: e.turn, what: e.what, stats: past, how: 'range' };
  }
  return last ? { turn: last.turn, what: last.what, stats: [], how: 'last cut' } : null;
}

const WORK_KEYS = ['rounds', 'rebuilds', 'fallback', 'probes', 'backtracks', 'dieBacktracks'];
const workText = work => work ? WORK_KEYS.map(k => `${k}=${work[k]}`).join(' ') : 'unavailable';
const warningText = w => `round ${w.round}, turn ${w.turn}, ${(w.pokemon || []).join(', ') || 'no Pokemon named'}: expected ${w.expected ?? '(nothing)'}, actual ${w.actual ?? '(nothing)'}`;
function printWork(label, value) {
  console.log(`${label}: ${workText(value.work)}; warnings=${value.warnings?.length ?? 'unavailable'}`);
  for (const w of value.warnings || []) console.log(`  warning: ${warningText(w)}`);
}

/** Names, targets and flags, rather than move/bench indices from two requests. */
function canonicalChoice(raw, offered) {
  if (/^team\b/.test(raw)) return null;
  return raw.split(',').map((part, slot) => {
    const [action, arg, ...flags] = part.trim().split(/\s+/);
    if (action === 'pass') return `${slot}:pass`;
    if (action === 'switch') {
      const name = offered.pokemon[Number(arg) - 1]?.name;
      return name ? `${slot}:switch:${name}` : null;
    }
    if (action !== 'move') return null;
    const move = offered.active?.[slot]?.[Number(arg) - 1];
    const name = offered.pokemon[slot]?.name;
    if (!move || !name) return null;
    return `${slot}:${name}:${toID(move)}:${flags.map(f => /^[+-]?\d+$/.test(f) ? String(Number(f)) : f).sort().join(' ')}`;
  });
}

/** Read roster/move indices from the returned recipe and its switch log. No replay. */
function rebuiltOffers(built) {
  const rosters = {};
  for (const line of Array.isArray(built.inputLog) ? built.inputLog : String(built.inputLog).split('\n')) {
    const m = /^>player (p[12]) (.*)$/.exec(line);
    if (m) rosters[m[1]] = Teams.unpack(JSON.parse(m[2]).team).map(p => ({ name: p.name || p.species, moves: p.moves.map(toID) }));
  }
  for (const c of built.choices || []) {
    if (c.turn !== 0 || !/^team /.test(c.choice)) continue;
    const indices = c.choice.slice(5).replace(/\s/g, '').split(',').map(Number);
    if (indices.some(i => !rosters[c.side]?.[i - 1])) continue;
    rosters[c.side] = indices.map(i => rosters[c.side][i - 1]);
  }
  const offers = new Map();
  const snapshot = turn => {
    for (const [side, pokemon] of Object.entries(rosters)) {
      offers.set(`${turn}:${side}`, { pokemon: pokemon.map(p => ({ ...p })), active: pokemon.slice(0, 2).map(p => p.moves) });
    }
  };
  snapshot(0);
  let turn = 0;
  for (const line of built.rawLog || []) {
    const sw = /^\|(?:switch|drag)\|(p[12])([ab]): ([^|]+)\|/.exec(line);
    if (sw) {
      const roster = rosters[sw[1]];
      const at = roster?.findIndex(p => p.name === sw[3]);
      const slot = sw[2] === 'a' ? 0 : 1;
      if (at >= 0) [roster[slot], roster[at]] = [roster[at], roster[slot]];
    }
    const t = /^\|turn\|(\d+)$/.exec(line);
    if (t) { turn = Number(t[1]); snapshot(turn); }
    // The simulator offers a locked move as slot 1, even when its sheet slot
    // differs. Read the executed name from the log that explicitly labels it.
    const locked = /^\|move\|(p[12])([ab]): [^|]+\|([^|]+)\|/.exec(line);
    if (locked && (line.includes('[from] lockedmove') || toID(locked[3]) === 'struggle')) {
      const offered = offers.get(`${turn}:${locked[1]}`);
      if (offered) offered.active[locked[2] === 'a' ? 0 : 1] = [toID(locked[3])];
    }
  }
  return offers;
}

/** Only the existing real-spread retry can be aligned with the played dice. */
function diagnoseTruth(played, built, turn) {
  const offers = rebuiltOffers(built);
  const real = played.choices.filter(c => c.turn === turn && !/^team\b/.test(c.raw));
  const canonical = (c, original = false) => {
    const offered = original ? c.offered : offers.get(`${turn}:${c.side}`);
    if (!original && offered) {
      const request = real.find(r => r.side === c.side)?.offered;
      const unsupported = c.choice.split(',').some((part, slot) => {
        if (!/^\s*move\b/.test(part) || request?.pokemon[slot]?.name !== offered.pokemon[slot]?.name) return false;
        const a = request.active?.[slot], b = offered.active?.[slot];
        return !a || !b || [...a].map(toID).sort().join(',') !== [...b].map(toID).sort().join(',');
      });
      // Other dynamic move lists (for example Transform) need a live request;
      // do not turn a missing request description into a choice difference.
      if (unsupported) return null;
    }
    return offered ? canonicalChoice(original ? c.raw : c.choice, offered) : null;
  };
  const expected = real.map(c => ({ side: c.side, raw: c.raw, description: c.choice, choice: canonical(c, true) }));
  const describe = choices => choices.map(c => ({ side: c.side, raw: c.choice, choice: canonical(c) }));
  const compare = choices => {
    const actual = describe(choices);
    // Multiple requests in one turn need request-time rosters, which the public
    // diagnostic API does not retain. Say unavailable rather than guess indices.
    const ambiguous = ['p1', 'p2'].some(s => real.filter(c => c.side === s).length > 1 || choices.filter(c => c.side === s).length > 1);
    const valid = !ambiguous && [...expected, ...actual].every(c => c.choice && c.choice.every(x => x !== null));
    const key = list => JSON.stringify(list.map(c => [c.side, c.choice]).sort((a, b) => a[0].localeCompare(b[0])));
    const hiddenExpected = expected.filter(c => c.side === 'p2');
    const hiddenActual = actual.filter(c => c.side === 'p2');
    const hiddenValid = hiddenExpected.length === 1 && hiddenActual.length === 1 && [...hiddenExpected, ...hiddenActual].every(c => c.choice && c.choice.every(x => x !== null));
    return {
      actual, status: !valid ? 'unavailable' : key(expected) === key(actual) ? 'same' : 'different',
      hiddenStatus: !hiddenValid ? 'unavailable' : key(hiddenExpected) === key(hiddenActual) ? 'same' : 'different',
    };
  };
  const selected = compare((built.choices || []).filter(c => c.turn === turn && !/^team\b/.test(c.choice)));
  const tried = built.variantsTried?.turn === turn ? built.variantsTried.variants.map(v => ({
    variant: v.variant, searched: v.searched !== null, ...compare(v.choices.filter(c => !/^team\b/.test(c.choice))),
  })) : [];
  const out = { turn, choices: { expected, selected, tried, realVariantTried: tried.some(v => v.hiddenStatus === 'same') ? true : tried.length && tried.every(v => v.hiddenStatus === 'different') ? false : null }, dice: null };
  if (selected.status !== 'same') {
    out.dice = { status: 'choices differ or unavailable; dice not aligned' };
    return out;
  }
  const original = played.dice.filter(d => d.mark <= turn);
  const rebuilt = (built.dice || []).filter(d => d.mark <= turn);
  const signature = d => d ? { i: d.i, turn: d.mark, from: d.from, to: d.to, chance: d.chance } : null;
  const mismatches = [];
  let alignmentBreak = null;
  for (let j = 0; j < Math.max(original.length, rebuilt.length); j++) {
    const a = original[j], b = rebuilt[j];
    if (JSON.stringify(signature(a)) !== JSON.stringify(signature(b))) {
      alignmentBreak = { original: signature(a), rebuilt: signature(b) };
      break;
    }
    if (a.mark === turn && a.value !== b.value) mismatches.push({ ...signature(a), kind: a.kind, original: a.value, rebuilt: b.value });
  }
  // A different signature anywhere up to the failure invalidates the ordinal
  // comparison. Equal ranges alone cannot identify a mechanic's random call.
  out.dice = alignmentBreak ? { status: 'signature alignment break; no dice cause inferred', alignmentBreak }
    : { status: mismatches.length ? 'aligned signatures, differing faces (not a cause attribution)' : 'aligned signatures, no differing face', first: mismatches[0] || null, mismatches };
  return out;
}

function diagnosticLines(d) {
  if (!d) return [];
  if (d.error) return [`truth turn ${d.turn}: diagnosis unavailable: ${d.error}`];
  const out = [`truth turn ${d.turn}: selected choices ${d.choices.selected.status}; real hidden choice variant tried=${d.choices.realVariantTried ?? 'unavailable'}`];
  for (const c of d.choices.expected) out.push(`played ${c.side}: ${c.description} [${c.raw}]`);
  for (const c of d.choices.selected.actual) out.push(`rebuilt ${c.side}: ${JSON.stringify(c.choice)} [${c.raw}]`);
  const shown = [...new Set([...d.choices.tried.slice(0, 3), d.choices.tried.find(v => v.status === 'same'), d.choices.tried.find(v => v.hiddenStatus === 'same')].filter(Boolean))];
  for (const v of shown) out.push(`variant ${v.variant}: ${v.status}, dice searched=${v.searched}; ${v.actual.map(c => `${c.side} ${JSON.stringify(c.choice)} [${c.raw}]`).join('; ')}`);
  if (shown.length < d.choices.tried.length) out.push(`${d.choices.tried.length - shown.length} more variants; --out JSON includes every comparison`);
  out.push(d.dice.status);
  if (d.dice.alignmentBreak) out.push(`signatures: ${JSON.stringify(d.dice.alignmentBreak)}`);
  for (const x of d.dice.mismatches || []) out.push(`die ${x.i} ${x.kind}, random(${x.from},${x.to}), chance=${x.chance}: played ${x.original}, rebuilt ${x.rebuilt}`);
  return out;
}

/**
 * One fuzz battle and its rebuild: played, then p2's Stat Points inferred from
 * p1's view with p1 known, as the catalog rebuilds a world and as
 * `npm run reconstruct -- --infer p2` rebuilds a replay. Three things are
 * checked - every real spread of p2 the log showed survives, the rebuild
 * reproduces the whole log, nothing throws - and each failure gets a
 * signature, so failures of one kind group together.
 */
async function fuzzOne(n, teams, cap, { detail = false } = {}) {
  const recipe = fuzzRecipe(n, teams, cap);
  const names = namesIn(recipe);
  const result = {
    seed: n, teams: recipe.labels, spendAll: recipe.spendAll,
    spreads: recipe.sides.map(team => team.map(set => `${set.species} ${STATS.map(s => set.evs[s]).join('/')}`)),
    turns: null, ended: null, complete: null, verifiedThroughTurn: null, diff: null, lost: [], error: null, signatures: [],
    work: null, warnings: null, warningCount: null,
  };
  let played;
  try {
    played = await playFuzz(recipe);
  } catch (err) {
    const stage = /^chooser: /.test(err.message) ? 'chooser' : 'battle';
    result.error = { stage, message: err.message };
    result.signatures.push(`THROW (${stage}): ${normalised(err.message.split('\n')[0], names)}`);
    return result;
  }
  result.turns = played.turns;
  result.ended = played.ended;
  let inf;
  try {
    inf = await inferSpreads({
      formatid: FORMAT, sets: [recipe.sides[0], recipe.sides[1].map(({ evs, ...set }) => set)], known: [true, false],
      playerNames: ['Known', 'Hidden'], observed: played.ch1, channel: 1, threads: 1,
    });
  } catch (err) {
    result.error = { stage: 'inference', message: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') };
    result.signatures.push(`THROW (inference): ${normalised(err.message.split('\n')[0], names)}`);
    return result;
  }
  const report = inf.built.report;
  result.work = inf.work;
  result.warnings = inf.warnings;
  result.warningCount = inf.warnings.length;
  result.complete = inf.complete;
  result.verifiedThroughTurn = report.verifiedThroughTurn ?? null;
  const diff = report.diffs[0];
  if (!inf.complete) {
    result.diff = diff ? { turn: diff.turn, observed: diff.expected ?? null, rebuilt: diff.actual ?? null } : null;
    result.choices = played.choices.filter(c => c.turn === diff?.turn).map(c => `${c.side}: ${c.choice}`);
    // The same log rebuilt with p2's real Stat Points known: when that fails
    // too, compare that retry with the played battle. A failed search under the
    // real spreads does not prove that no matching rebuild exists.
    try {
      const truth = await inferSpreads({
        formatid: FORMAT, sets: recipe.sides, known: [true, true],
        playerNames: ['Known', 'Hidden'], observed: played.ch1, channel: 1, threads: 1,
      });
      const d = truth.built.report.diffs[0];
      result.truth = {
        complete: truth.complete, verifiedThroughTurn: truth.built.report.verifiedThroughTurn ?? null,
        diff: d ? { turn: d.turn, observed: d.expected ?? null, rebuilt: d.actual ?? null } : null,
        work: truth.work, warnings: truth.warnings, warningCount: truth.warnings.length,
        diagnosis: null,
      };
      if (!truth.complete) {
        try { result.truth.diagnosis = diagnoseTruth(played, truth.built, d?.turn ?? null); }
        catch (err) { result.truth.diagnosis = { turn: d?.turn ?? null, error: err.message }; }
      }
    } catch (err) {
      result.truth = { error: err.message.split('\n')[0], work: null, warnings: null, warningCount: null };
    }
    const line = diff?.expected ?? diff?.actual ?? '';
    const parts = String(line).split('|');
    const from = parts.find(p => p.startsWith('[from]'));
    const whose = result.truth.error ? 'real spreads threw' : result.truth.complete ? 'inferred spread only' : 'real spreads too';
    result.signatures.push(`NO MATCH (${whose}): ${diff?.expected ? '' : 'an extra '}${parts[1] || 'nothing'}${from ? ` ${normalised(from, names)}` : ''}`);
  }
  for (const [i, set] of recipe.sides[1].entries()) {
    const p = inf.pokemon.find(x => x.id === `p2:${i}`);
    if (!p?.seen || p.contains(set.evs)) continue;
    const event = removedBy(inf, p.id, set.evs);
    result.lost.push({ id: p.id, species: set.species, real: STATS.map(s => set.evs[s]).join('/'), spreads: p.spreads, event });
    result.signatures.push(!event ? 'UNSOUND: no recorded event cut it'
      : `UNSOUND${event.how === 'range' ? '' : ' (last cut)'}: ${normalised(event.what, names)}`);
  }
  result.signatures = [...new Set(result.signatures)];
  if (detail) {
    result.detail = {
      log: battleLines(played.ch1),
      pokemon: inf.pokemon.filter(p => !p.known).map(p => ({
        id: p.id, species: p.species, seen: p.seen, spreads: p.spreads,
        real: STATS.map(s => recipe.sides[1][Number(p.id.split(':')[1])].evs[s]).join('/'),
        kept: p.contains(recipe.sides[1][Number(p.id.split(':')[1])].evs),
        ranges: STATS.map(s => (p.stats[s] ? `${STAT_NAME[s]} ${p.stats[s].min}-${p.stats[s].max}` : `${STAT_NAME[s]} -`)).join(', '),
      })),
      events: inf.events.map(e => `T${e.turn} ${e.what}${e.cuts.filter(c => c.id.startsWith('p2:') && c.after < c.before).map(c => ` [${c.id} ${c.before} -> ${c.after}]`).join('')}`),
      checks: (inf.checks || []).map(c => `T${c.turn} ${c.what} - ${c.reason}`),
    };
  }
  return result;
}

/** The fuzz report: failures grouped by signature and ranked by count, then every battle. */
function renderFuzz(results, { from, count, cap, teams, refused, countsLines = [] }) {
  const out = [`# Fuzz — ${count} random Reg M-C battles from seed ${from}`, ''];
  out.push(`Generated by \`npm run catalog -- --fuzz ${count} --seed ${from}${cap !== FUZZ_TURNS ? ` --turns ${cap}` : ''}\`. Battle k is seed ${from} + k;`);
  out.push(`\`npm run catalog -- --fuzz 1 --seed <seed>${cap !== FUZZ_TURNS ? ` --turns ${cap}` : ''}\` replays one and prints what the inference made of it.`);
  out.push(`Each battle is played by Pokemon Showdown's random player up to turn ${cap}, then p2's Stat Points are inferred from p1's`);
  out.push('view with p1 known. Checked: every real spread of a p2 Pokemon the log showed survives; the rebuild is a MATCH;');
  out.push('nothing throws. A rebuild that is no MATCH is made again with p2\'s real Stat Points known: `inferred spread only`');
  out.push('when that one matches; `real spreads too` when the retry also fails. The latter compares the played choices');
  out.push('with the tried variants and, only when choices and draw signatures align, reports differing die faces. These comparisons do not attribute a search rule or a mechanics cause.', '');
  out.push(`**Teams** (${teams.length}): ${teams.map(t => t.label).join('; ')}.`);
  if (refused.length) out.push(`Left out, refused by the validator: ${refused.map(r => `${r.label} (${r.problem})`).join('; ')}.`);
  out.push('');
  const n = results.length;
  const match = results.filter(r => r.complete).length;
  const kept = results.filter(r => !r.error && !r.lost.length).length;
  const threw = results.filter(r => r.error).length;
  out.push('| Battles | MATCH | Every real spread kept | Threw |', '|---|---|---|---|', `| ${n} | ${match} | ${kept} | ${threw} |`, '');
  const groups = new Map();
  for (const r of results) {
    for (const sig of r.signatures) {
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(r);
    }
  }
  const ranked = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  out.push('## Failures, by signature', '');
  if (!ranked.length) out.push('None.', '');
  else {
    out.push('| Rank | Signature | Battles | Seeds |', '|---|---|---|---|');
    for (const [i, [sig, list]] of ranked.entries()) out.push(`| ${i + 1} | ${esc(sig)} | ${list.length} | ${list.slice(0, 8).map(r => r.seed).join(', ')}${list.length > 8 ? ', …' : ''} |`);
    out.push('');
    for (const [i, [sig, list]] of ranked.entries()) {
      out.push(`### ${i + 1}. ${sig}`, '');
      const r = list[0];
      out.push(`${list.length} battle(s). Rerun the first: \`npm run catalog -- --fuzz 1 --seed ${r.seed}${cap !== FUZZ_TURNS ? ` --turns ${cap}` : ''}\`.`, '');
      if (sig.startsWith('THROW')) out.push(`Seed ${r.seed}: ${code(r.error.message.split('\n')[0])}${r.error.stack ? ` at ${code(r.error.stack)}` : ''}`);
      else if (sig.startsWith('NO MATCH')) {
        out.push(`Seed ${r.seed}, turn ${r.diff?.turn ?? '—'} (verified through turn ${r.verifiedThroughTurn ?? '—'}): observed ${code(r.diff?.observed)}, rebuilt ${code(r.diff?.rebuilt)}.`);
        if (r.choices?.length) out.push(`The players chose, that turn: ${r.choices.map(c => code(c)).join('; ')}.`);
        if (r.truth?.error) out.push(`With p2's real Stat Points the rebuild threw: ${code(r.truth.error)}.`);
        else if (r.truth && !r.truth.complete) out.push(`With p2's real Stat Points the rebuild fails too, on turn ${r.truth.diff?.turn ?? '—'}: observed ${code(r.truth.diff?.observed)}, rebuilt ${code(r.truth.diff?.rebuilt)}.`);
        else if (r.truth) out.push('With p2\'s real Stat Points the rebuild is a MATCH.');
        for (const line of diagnosticLines(r.truth?.diagnosis)) out.push(esc(line));
      }
      else {
        for (const x of r.lost) out.push(`Seed ${r.seed}: ${x.species} (${x.id}) on ${x.real} lost, ${x.spreads} spreads left; ${x.event ? `turn ${x.event.turn}, ${code(x.event.what)}${x.event.stats.length ? `, past its ${x.event.stats.map(s => STAT_NAME[s]).join(', ')}` : ' (the last event that cut it)'}` : 'no recorded event cut it'}.`);
      }
      out.push('');
    }
  }
  out.push('## Every battle', '');
  out.push('| Seed | Known team (p1) | Hidden team (p2) | Spent all 66 | Turns | MATCH | Real spreads | Signatures | Guess work; warnings | Truth retry work; warnings |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    out.push(`| ${r.seed} | ${esc(r.teams[0])} | ${esc(r.teams[1])} | ${r.spendAll ? 'yes' : 'no'} | ${r.turns ?? '—'} | ${r.complete === null ? '—' : r.complete ? 'yes' : `no, through ${r.verifiedThroughTurn}`} | ${r.error ? '—' : r.lost.length ? `${r.lost.length} lost` : 'kept'} | ${esc(r.signatures.join('; ')) || '—'} | ${workText(r.work)}; ${r.warningCount ?? 'unavailable'} | ${r.truth ? `${workText(r.truth.work)}; ${r.truth.warningCount ?? 'unavailable'}` : 'not run'} |`);
  }
  for (const r of results) {
    for (const [label, value] of [['guess', r], ['truth retry', r.truth]]) {
      for (const w of value?.warnings || []) out.push('', `Seed ${r.seed}, ${label} warning: ${esc(warningText(w))}`);
    }
    if (r.truth?.diagnosis) out.push('', `Seed ${r.seed}:`, ...diagnosticLines(r.truth.diagnosis).map(esc));
  }
  if (countsLines.length) out.push('', '## Counts against previous run', '', ...countsLines.map(esc));
  return `${out.join('\n').trimEnd()}\n`;
}

async function serveFuzz() {
  const { teams, cap } = workerData;
  parentPort.on('message', async (n) => {
    try {
      parentPort.postMessage({ n, result: await fuzzOne(n, teams, cap) });
    } catch (err) {
      parentPort.postMessage({ n, error: `${err.message}\n${err.stack}` });
    }
  });
}

/** An opt-in numeric snapshot, independent of worker count and solver revision. */
function fuzzCounts(file, { from, count, cap, teams }) {
  if (!file) return () => [];
  const at = path.resolve(ROOT, file);
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const metadata = {
    schema: 1, format: FORMAT, from, count, cap,
    simulator: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies['pokemon-showdown'],
    teams: hash(JSON.stringify(teams)),
    recipe: hash([seedFor, randomSpread, fuzzRecipe, FuzzPlayer].map(String).join('\n')),
  };
  const keys = [...WORK_KEYS, 'warnings'];
  const previous = fs.existsSync(at) ? JSON.parse(fs.readFileSync(at, 'utf8')) : null;
  if (previous && JSON.stringify(previous.metadata) !== JSON.stringify(metadata)) {
    throw new Error(`incompatible --counts metadata in ${at}; use a different file for this seed range, turn cap, team pool or simulator`);
  }
  if (previous) {
    if (!Array.isArray(previous.rows) || new Set(previous.rows.map(r => r.seed)).size !== previous.rows.length) throw new Error(`invalid --counts rows in ${at}`);
    for (const row of previous.rows) {
      if (!Number.isInteger(row.seed) || row.seed < from || row.seed >= from + count) throw new Error(`invalid --counts seed in ${at}`);
      for (const label of ['guess', 'truth']) {
        if (row[label] != null && !keys.every(k => Number.isSafeInteger(row[label][k]) && row[label][k] >= 0)) throw new Error(`invalid --counts ${label} for seed ${row.seed} in ${at}`);
      }
    }
  }
  return results => {
    const numeric = value => value?.work && Array.isArray(value.warnings)
      ? { ...Object.fromEntries(WORK_KEYS.map(k => [k, value.work[k]])), warnings: value.warnings.length } : null;
    const rows = results.map(r => ({ seed: r.seed, guess: numeric(r), truth: numeric(r.truth), error: r.error?.stage || r.truth?.error || null }));
    const old = new Map((previous?.rows || []).map(r => [r.seed, r]));
    const lines = [];
    const signed = n => n >= 0 ? `+${n}` : String(n);
    const values = (a, b) => keys.map(k => `${k}=${b ? signed(a[k] - b[k]) : a[k]}`).join(' ');
    for (const label of ['guess', 'truth']) {
      const totals = Object.fromEntries(keys.map(k => [k, 0]));
      const deltas = { ...totals };
      let available = 0, paired = 0;
      for (const row of rows) {
        const a = row[label], b = old.get(row.seed)?.[label];
        if (a) { available++; for (const k of keys) totals[k] += a[k]; }
        if (a && b) { paired++; for (const k of keys) deltas[k] += a[k] - b[k]; }
        lines.push(`seed ${row.seed} ${label}: ${a ? values(a) : 'unavailable'}; delta ${!previous ? 'no previous run' : a && b ? values(a, b) : 'unavailable (missing/error/not run)'}`);
      }
      lines.push(`${label} totals (${available}/${count} available): ${available ? values(totals) : 'unavailable'}; paired delta (${paired}/${count} comparable): ${paired ? keys.map(k => `${k}=${signed(deltas[k])}`).join(' ') : 'unavailable'}`);
    }
    // Never silently turn an error or an absent truth retry into zero work.
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, `${JSON.stringify({ metadata, rows }, null, 1)}\n`);
    for (const line of lines) console.error(line);
    console.error(`wrote counts ${at}`);
    return lines;
  };
}

/** `--fuzz <count> --seed <from>`: battles from..from+count-1 on the worker threads, then the report. */
async function runFuzz({ count, from, cap, threads, outDir, verbose, countsFile }) {
  const { teams, refused } = fuzzTeams();
  if (!teams.length) throw new Error('no team in the pool passes the validator');
  const saveCounts = fuzzCounts(countsFile, { from, count, cap, teams });
  console.error(`fuzz: ${count} battle(s) from seed ${from}, ${teams.length} teams, up to turn ${cap}, ${threads} thread(s)`);
  if (count === 1) {
    const r = await fuzzOne(from, teams, cap, { detail: true });
    const { detail, ...rest } = r;
    console.log(`seed ${from}: ${rest.teams[0]} (p1, known) against ${rest.teams[1]} (p2, inferred)${rest.spendAll ? ', every Pokemon spends 66' : ''}`);
    for (const [s, list] of rest.spreads.entries()) for (const x of list) console.log(`  p${s + 1} ${x}`);
    if (rest.error) console.log(`threw (${rest.error.stage}): ${rest.error.message}${rest.error.stack ? `\n  ${rest.error.stack}` : ''}`);
    printWork('guess work', rest);
    if (detail) {
      if (verbose) for (const l of detail.log) console.log(l);
      console.log(`played to turn ${rest.turns}${rest.ended ? ', the battle ended' : ''}; rebuild ${rest.complete ? 'MATCH' : `verified through turn ${rest.verifiedThroughTurn}`}`);
      if (rest.diff) console.log(`  turn ${rest.diff.turn}: observed ${rest.diff.observed}\n          rebuilt  ${rest.diff.rebuilt}`);
      for (const c of rest.choices || []) console.log(`  chosen that turn, ${c}`);
      if (rest.truth) {
        printWork('truth retry work', rest.truth);
        console.log(rest.truth.error ? `  with p2's real Stat Points the rebuild threw: ${rest.truth.error}`
          : rest.truth.complete ? '  with p2\'s real Stat Points the rebuild is a MATCH'
            : `  with p2's real Stat Points the rebuild fails too, turn ${rest.truth.diff?.turn}: observed ${rest.truth.diff?.observed}\n          rebuilt  ${rest.truth.diff?.rebuilt}`);
        for (const line of diagnosticLines(rest.truth.diagnosis)) console.log(`  ${line}`);
      }
      for (const p of detail.pokemon) console.log(`  ${p.id} ${p.species.padEnd(16)} ${p.seen ? `${String(p.spreads).padStart(10)} spreads, real ${p.real} ${p.kept ? 'kept' : 'LOST'}  ${p.ranges}` : 'not seen'}`);
      for (const e of detail.events) console.log(`  ${e}`);
      for (const c of detail.checks) console.log(`  not used: ${c}`);
    }
    console.log(rest.signatures.length ? `signatures: ${rest.signatures.join('; ')}` : 'no failure');
    saveCounts([r]);
    if (outDir) {
      const dir = path.resolve(ROOT, outDir);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `fuzz-${from}.json`), `${JSON.stringify(r, null, 1)}\n`);
      console.log(`wrote ${path.join(dir, `fuzz-${from}.json`)}`);
    }
    return;
  }
  const queue = Array.from({ length: count }, (_, k) => from + k);
  const results = [];
  const size = Math.max(1, Math.min(threads, queue.length));
  const started = Date.now();
  await Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { role: FUZZ_ROLE, teams, cap } });
    const next = () => {
      const n = queue.shift();
      if (n === undefined) { worker.terminate().then(resolve); return; }
      worker.postMessage(n);
    };
    worker.on('message', (msg) => {
      if (msg.error) { reject(new Error(`seed ${msg.n}: ${msg.error}`)); return; }
      results.push(msg.result);
      const r = msg.result;
      console.error(`[${results.length}/${count}] seed ${r.seed}: ${r.error ? `threw (${r.error.stage})` : `${r.complete ? 'MATCH' : `through turn ${r.verifiedThroughTurn}`}, ${r.lost.length ? `${r.lost.length} real spread(s) LOST` : 'real spreads kept'}`} ${((Date.now() - started) / 1000).toFixed(0)}s; guess ${workText(r.work)} warnings=${r.warningCount ?? 'unavailable'}${r.truth ? `; truth ${workText(r.truth.work)} warnings=${r.truth.warningCount ?? 'unavailable'}` : ''}`);
      if (verbose) for (const s of r.signatures) console.error(`    ${s}`);
      next();
    });
    worker.on('error', reject);
    next();
  })));
  results.sort((a, b) => a.seed - b.seed);
  const countsLines = saveCounts(results);
  const text = renderFuzz(results, { from, count, cap, teams, refused, countsLines });
  if (outDir) {
    const dir = path.resolve(ROOT, outDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fuzz.json'), `${JSON.stringify(results, null, 1)}\n`);
    fs.writeFileSync(path.join(dir, 'fuzz.md'), text);
    console.error(`wrote ${dir}: fuzz.md, fuzz.json`);
  } else process.stdout.write(text);
}

// ------------------------------------------------------ the regression list

const REGRESS_ROLE = 'catalog-regress';

/**
 * Every battle the open-sheet work saw fail, one per mechanism
 * (docs/engineering.md §12.5, S3), with the commit that fixed it: a fuzz seed,
 * checked as `--fuzz 1 --seed <n>` checks it, or a catalog world, named as
 * `--dump` names it and rebuilt as the catalog's coverage rebuilds it. Each
 * fails on the code just before its commit - seed 14 on that commit with the
 * trial taken out, since the score component that broke it came in with the
 * fix. Seeds 1-100 are the ones the search was tuned on, so this list is what
 * a change to the evidence, the loop, the search or the order reader is run
 * against before the hour-long fuzz and the full catalog.
 */
const REGRESSIONS = [
  { fuzz: 2, fixed: '6ee4066', what: "a flinched Mawile's unseen Sucker Punch: the unseen choices walked furthest first" },
  { fuzz: 14, fixed: 'fa26745', what: 'a draw that only gets more of a line right in place: held on trial, not kept for good' },
  { fuzz: 19, fixed: 'fa26745', what: "a full paralysis after a speed tie, two dice together: the search's third score component" },
  { fuzz: 24, fixed: 'c8a0113', what: "which of two Tyranitars' Sand Stream announces first, the known one's: read from the switch-in order" },
  { fuzz: 44, fixed: '6ee4066', what: 'a turn that needs a bigger dice search on every new guess: a new guess starts from the budget it needed' },
  { fuzz: 56, fixed: '6ee4066', what: 'a Focus Sash only the rebuild announced: the HP line after it read' },
  { fuzz: 68, fixed: '6ee4066', what: 'a long battle that pins a line a round: a round counted only when it stalls' },
  { fuzz: 73, fixed: 'c8a0113', what: "which of two Tyranitars' Sand Stream announces first, the hidden one's: read from the switch-in order" },
  { fuzz: 83, fixed: '6ee4066', what: "Muddy Water's secondary on one target and not the other: two chances tried together" },
  { fuzz: 88, fixed: '6ee4066', what: 'the replacements after a Perish Song under Trick Room: instaswitch read as a switch' },
  { world: ['item:ironball', 'holder-hidden/W-confusion', 'spe', 0], fixed: '109a270', what: "a turn-2 speed tie and turn 1's confusion duration: the trial dice handed to the backtrack" },
  { world: ['move:zingzap', 'user-hidden/after', 'spe', 32], fixed: 'fa26745', what: "a flinched Pokemon's order: read when every move it has sorts at one priority in both sorts" },
  { world: ['item:gengarite', 'holder-hidden/W-confusion', 'atk', 0], fixed: 'fa26745', what: 'confusion self-hits on two turns: one Attack along each HP path' },
  { world: ['item:greninjite', 'holder-hidden/W-trade', 'def', 32], fixed: '00aff08', what: 'Quick Attacks into the hidden Mega Greninja: the guess asked under the full search and on its proven HP path before a stat is moved' },
  { world: ['move:earthquake', 'user-hidden/quiet', 'atk', 32], fixed: 'fa26745', what: "a spread hit's line on the hidden ally: the set-aside check rebuilds the guess the evidence chose on its own HP path" },
];

/** How an entry is named, and the command that shows it in full. */
const regressName = r => (r.fuzz !== undefined ? `seed ${r.fuzz}` : r.world.join(' '));
const regressRerun = r => `npm run catalog -- ${r.fuzz !== undefined ? `--fuzz 1 --seed ${r.fuzz}` : `--dump ${r.world.join(' ')}`}`;

/** A line of the log, or a stand-in where the rebuild or the replay printed none. */
const lineOr = text => text ?? '(no line)';

/**
 * What a fuzz entry failed on: exactly what `--fuzz 1 --seed <n>` checks -
 * it threw, its rebuild is no MATCH, a real spread was lost - each in words.
 */
async function fuzzFailures(n, teams) {
  const r = await fuzzOne(n, teams, FUZZ_TURNS);
  const failures = [];
  if (r.error) failures.push(`threw (${r.error.stage}): ${r.error.message.split('\n')[0]}`);
  else if (!r.complete) {
    const truth = r.truth?.error ? `with the real Stat Points it threw: ${r.truth.error}`
      : r.truth?.complete ? 'with the real Stat Points it is a MATCH'
        : `with the real Stat Points it fails too, on turn ${r.truth?.diff?.turn ?? '-'}`;
    failures.push(`no MATCH, verified through turn ${r.verifiedThroughTurn ?? '-'}; turn ${r.diff?.turn ?? '-'}: observed ${lineOr(r.diff?.observed)}, rebuilt ${lineOr(r.diff?.rebuilt)}; ${truth}`);
  }
  for (const x of r.lost) {
    failures.push(`real spread lost: ${x.species} (${x.id}) on ${x.real}, ${x.spreads} spreads left${x.event ? `, turn ${x.event.turn}: ${x.event.what}` : ', no recorded event cut it'}`);
  }
  return failures;
}

/**
 * What a catalog world failed on: the battle `--dump` plays for it, rebuilt
 * from the known side's view by `inferWorld` as the coverage rebuilds it. It
 * fails when the battle or the rebuild throws, the rebuild is no MATCH, the
 * hidden Pokemon's real spread is removed, or a line is set aside - evidence
 * given up, which the open-sheet report lists as work. Four of these worlds
 * failed only that way: the fallback got past the line on another spread and
 * labelled it one no hook reads.
 */
async function worldFailures(effect, entries, [key, templateKey, stat, value]) {
  const template = await namedTemplate(effect, entries[key], templateKey);
  const evs = world(stat, Number(value));
  const run = await runBattle(template, evs);
  if (run.error) return [`battle error: ${run.error}`];
  const r = await inferWorld(template, run);
  if (r.error) return [`threw (inference): ${r.error.split('\n')[0]}`];
  const failures = [];
  if (!r.complete) failures.push(`no MATCH; turn ${r.diff?.turn ?? '-'}: observed ${lineOr(r.diff?.observed)}, rebuilt ${lineOr(r.diff?.rebuilt)}`);
  if (!r.p.contains(evs)) failures.push(`real spread lost: ${r.p.species} on ${STATS.map(s => evs[s]).join('/')}, ${r.p.spreads} spreads left`);
  for (const c of r.inf.checks || []) failures.push(`set aside, turn ${c.turn}: ${c.what} - ${c.reason}`);
  return failures;
}

async function serveRegress() {
  const { teams, inputs } = workerData;
  const entries = loadEntries(inputs);
  parentPort.on('message', async ({ i, effect }) => {
    const r = REGRESSIONS[i];
    const started = Date.now();
    let failures;
    try {
      failures = r.fuzz !== undefined ? await fuzzFailures(r.fuzz, teams) : await worldFailures(effect, entries, r.world);
    } catch (err) {
      failures = [`threw: ${err.message.split('\n')[0]}`];
    }
    parentPort.postMessage({ i, failures, seconds: (Date.now() - started) / 1000 });
  });
}

/**
 * `--regress`: every entry of the list on the worker threads, then one line
 * each in the list's order - pass or FAIL, its seconds, the mechanism it
 * stands for and the commit that fixed it, and under a failure what failed
 * and the command that shows it - and the count. Any failure sets the exit
 * code.
 */
async function runRegress({ threads, inputs }) {
  if (!REGRESSIONS.length) throw new Error('the regression list is empty');
  const started = Date.now();
  const { teams } = fuzzTeams();
  const pool = REGRESSIONS.some(r => r.world) ? buildPool() : null;
  const effects = REGRESSIONS.map((r) => {
    if (!r.world) return null;
    const effect = pool.effects.find(e => e.key === r.world[0]);
    if (!effect) throw new Error(`regression list: not in the Reg M-C pool: ${r.world[0]}`);
    return effect;
  });
  const queue = REGRESSIONS.map((_, i) => i);
  const results = new Array(REGRESSIONS.length);
  const size = Math.max(1, Math.min(threads, queue.length));
  console.error(`regress: ${REGRESSIONS.length} entries, ${size} thread(s)`);
  let done = 0;
  await Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { role: REGRESS_ROLE, teams, inputs } });
    const next = () => {
      const i = queue.shift();
      if (i === undefined) { worker.terminate().then(resolve); return; }
      worker.postMessage({ i, effect: effects[i] });
    };
    worker.on('message', (msg) => {
      results[msg.i] = msg;
      done++;
      console.error(`[${done}/${REGRESSIONS.length}] ${regressName(REGRESSIONS[msg.i])}: ${msg.failures.length ? 'FAIL' : 'pass'} ${msg.seconds.toFixed(0)}s`);
      next();
    });
    worker.on('error', reject);
    next();
  })));
  const width = Math.max(...REGRESSIONS.map(r => regressName(r).length));
  for (const [i, r] of REGRESSIONS.entries()) {
    const { failures, seconds } = results[i];
    console.log(`${failures.length ? 'FAIL' : 'pass'} ${`${seconds.toFixed(0)}s`.padStart(5)}  ${regressName(r).padEnd(width)}  ${r.what} (${r.fixed})`);
    for (const f of failures) console.log(`      ${f}`);
    if (failures.length) console.log(`      rerun: ${regressRerun(r)}`);
  }
  const failed = results.filter(x => x.failures.length).length;
  console.log(`regress: ${REGRESSIONS.length - failed} of ${REGRESSIONS.length} pass${failed ? `, ${failed} FAIL` : ''}, in ${((Date.now() - started) / 1000).toFixed(0)}s on ${size} thread(s)`);
  if (failed) process.exitCode = 1;
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

/**
 * The record cache: one file per effect in `.cache/catalog/`, kept under the
 * fingerprint of everything that makes that effect's record - this file up to
 * its reports, `scripts/lib/`, `scripts/server/`, the fixtures but the
 * catalog's entries, the simulator as pinned, Node, the run's options, and the
 * effect's own entry less its `cells`, which only a report reads. A run reuses
 * every record whose fingerprint still matches and plays only the rest;
 * `--fresh` plays them all. Any change to the inference or the rebuild changes
 * every fingerprint, so it is checked in full; a change to how the reports
 * read, or to one effect's battles, is not.
 */
const CACHE = path.join(ROOT, '.cache', 'catalog');

/** A value as text, its keys in order and its functions as their source. */
function stable(value) {
  if (typeof value === 'function') return `fn:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

const filesUnder = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap(d => (d.isDirectory() ? filesUnder(path.join(dir, d.name)) : [path.join(dir, d.name)]));

/** What every effect's record stands on besides its own entry. */
function codeFingerprint() {
  const hash = crypto.createHash('sha256');
  const own = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const reports = own.search(/^\/\/ -+ reports\r?$/m);
  if (reports < 0) throw new Error('local-catalog.mjs has no reports section to leave out of its fingerprint');
  hash.update(own.slice(0, reports));
  const files = [...filesUnder('scripts/lib'), ...filesUnder('scripts/server'), ...filesUnder('scripts/fixtures')]
    .filter(f => path.basename(f) !== 'catalog.js').sort();
  for (const file of files) hash.update(`\0${file}\0`).update(fs.readFileSync(path.join(ROOT, file)));
  const { entries, ...shared } = FIXTURE;
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages['node_modules/pokemon-showdown'];
  return hash.update(stable({ shared, simulator: [lock?.resolved, lock?.integrity], node: process.version })).digest('hex');
}

const fingerprintOf = (code, effect, entry, options) => {
  const { cells, ...made } = entry || {};
  return crypto.createHash('sha256').update(code).update(stable({ effect, entry: made, options })).digest('hex');
};
const cacheFile = key => path.join(CACHE, `${key.replace(/[^a-z0-9]+/gi, '-')}.json`);

async function runAll(effects, { threads, inputs, coverage, sheets, verbose, fresh }) {
  const all = effects.filter(e => e.kind !== 'condition');
  const records = new Map();
  const entries = loadEntries(inputs);
  const code = codeFingerprint();
  const prints = new Map(all.map(e => [e.key, fingerprintOf(code, e, entries[e.key], { coverage, sheets })]));
  const queue = [];
  for (const effect of all) {
    let cached = null;
    if (!fresh) {
      try { cached = JSON.parse(fs.readFileSync(cacheFile(effect.key), 'utf8')); } catch { /* not cached */ }
    }
    if (cached?.fingerprint === prints.get(effect.key)) records.set(effect.key, cached.record);
    else queue.push(effect);
  }
  console.log(`catalog: ${records.size} record(s) from the cache, ${queue.length} to play`);
  if (!queue.length) return records;
  fs.mkdirSync(CACHE, { recursive: true });
  const size = Math.max(1, Math.min(threads, queue.length));
  const total = queue.length;
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
      fs.writeFileSync(cacheFile(msg.key), JSON.stringify({ fingerprint: prints.get(msg.key), record: msg.record }));
      console.log(`[${done}/${total}] ${msg.key} ${msg.record.open.outcome} ${((Date.now() - started) / 1000).toFixed(0)}s`);
      next();
    });
    worker.on('error', reject);
    next();
  })));
  return records;
}

/** One template of an effect by its `<role>/<name>`, as the catalog plays it: a pace template with its pacer found. */
async function namedTemplate(effect, entry, templateKey) {
  const templates = templatesFor(effect, entry);
  const planned = templates.find(t => t.key === templateKey);
  if (!planned) throw new Error(`${effect.key} has no template ${templateKey}; it has ${templates.map(t => t.key).join(', ')}`);
  const found = planned.pace ? await resolvePace(planned) : planned;
  if (!found) throw new Error(`${effect.key} ${templateKey}: no pacer reaches the hidden Pokemon's Speed`);
  return found;
}

/**
 * The battle behind one row, for working the list: the template, the known
 * side's view of one world, and what the rebuild made of it.
 * `--dump <effect> <role/template> <stat> <value> [--control] [--hazard]`; a stat
 * of `-` is the base spread, and `--hazard` rebuilds it the way a closed-sheet
 * replay is rebuilt, from the sets `setsFromLog` reads.
 */
async function dumpWorld(pool, [key, templateKey, stat, value], { control, entries, hazard }) {
  const effect = pool.effects.find(e => e.key === key);
  if (!effect) throw new Error(`not in the Reg M-C pool: ${key}`);
  const found = await namedTemplate(effect, entries[key], templateKey);
  const template = control ? found.control : found;
  const evs = STATS.includes(stat) ? world(stat, Number(value)) : BASE;
  const show = set => `${set.name} (${set.species}) @ ${set.item || 'no item'}, ${set.ability}, ${set.nature}, ${STATS.map(s => `${set.evs[s]} ${STAT_NAME[s]}`).join(' / ')}: ${set.moves.join(', ')}`;
  console.log(`${key} ${templateKey}${control ? ' (control)' : ''}, hidden Pokemon on ${STATS.map(s => evs[s]).join('/')}`);
  for (const [i, team] of [template.p1, template.p2].entries()) for (const set of team) console.log(`  p${i + 1} ${show(i === 1 && set === team[template.probeIndex || 0] ? { ...set, evs } : set)}`);
  for (const [i, t] of template.turns.entries()) console.log(`  T${i + 1}: p1 ${t.p1} | p2 ${t.p2}`);
  console.log(`  dice: ${template.dice.join('; ')}`);
  const run = await runBattle(template, evs);
  if (run.error) console.log(`battle error: ${run.error}`);
  for (const r of run.refused) console.log(`  ${r.cause ? 'overridden' : 'refused'} T${r.turn} ${r.side} "${r.choice}": ${r.error}${r.cause ? ` (${r.cause})` : ''} -> ${r.fallback}`);
  console.log('--- channel 1');
  for (const line of battleLines(run.ch1)) console.log(line);
  const r = hazard ? await (async () => {
    const read = setsFromLog(run.ch1, 'p2', FORMAT);
    for (const [i, set] of read.sets.entries()) console.log(`  read off the log: ${set.name} @ ${set.item || 'no item'}, ${set.ability}, ${set.nature}: ${set.moves.join(', ')}  (${read.assumed[i].notes.join(', ')})`);
    return inferWorld({ ...template, p2: read.sets }, run);
  })() : await inferWorld(template, run);
  console.log(`--- rebuilt from it${hazard ? ', with the sets read off the log' : ''}`);
  if (r.error) { console.log(`error: ${r.error}`); return; }
  printWork('inference work', r.inf);
  console.log(`complete ${r.complete}${r.diff ? `, first wrong line on turn ${r.diff.turn}: wanted ${r.diff.observed}, got ${r.diff.rebuilt}` : ''}`);
  console.log(`hidden Pokemon: ${r.p.spreads} spreads, real spread ${r.p.contains(evs) ? 'kept' : 'REMOVED'}; ${STATS.map(s => `${STAT_NAME[s]} ${r.p.stats[s] ? `${r.p.stats[s].min}-${r.p.stats[s].max}` : 'none'}`).join(', ')}`);
  for (const e of r.inf.events) {
    const cut = e.cuts.find(c => c.id === 'p2:0');
    console.log(`  T${e.turn} ${e.what}${e.shown ? ` (shown ${e.shown})` : ''}${cut ? `: ${cut.before} -> ${cut.after}${cut.narrowed.length ? `, ${cut.narrowed.map(s => `${STAT_NAME[s]} ${cut.stats[s] ? `${cut.stats[s].min}-${cut.stats[s].max}` : 'none'}`).join(', ')}` : ''}` : ''}`);
  }
  for (const c of r.inf.checks || []) console.log(`  check T${c.turn}: ${c.what} - ${c.reason}`);
  if (r.inf.cutoff) console.log(`  evidence read up to turn ${r.inf.cutoff.turn}, where the rebuild printed another line than ${r.inf.cutoff.observed}`);
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
  if (opt('--fuzz')) {
    const count = Number(opt('--fuzz'));
    const from = Number(opt('--seed', '1'));
    const cap = Number(opt('--turns', String(FUZZ_TURNS)));
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(from) || from < 0 || !Number.isInteger(cap) || cap < 1) {
      throw new Error('--fuzz <count> --seed <from> [--turns <n>]: whole numbers, count and turns at least 1');
    }
    const threads = Number(opt('--threads', String(Math.max(1, os.availableParallelism() - 1))));
    await runFuzz({ count, from, cap, threads, outDir: opt('--out'), verbose: flag('--verbose'), countsFile: opt('--counts') });
    return;
  }
  if (flag('--regress')) {
    await runRegress({ threads: Number(opt('--threads', String(Math.max(1, os.availableParallelism() - 1)))), inputs });
    return;
  }
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
    const byKey = await runAll(effects, { threads, inputs, coverage, sheets, verbose: flag('--verbose'), fresh: flag('--fresh') });
    const records = [...byKey.values()];
    const conditions = partial ? [] : conditionRecords(records, pool);
    all = [...records, ...conditions].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.key.localeCompare(b.key));
  }
  const open = renderOpen(all, pool, loadEntries(inputs));
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
} else if (workerData?.role === FUZZ_ROLE) {
  serveFuzz();
} else if (workerData?.role === REGRESS_ROLE) {
  serveRegress();
}
