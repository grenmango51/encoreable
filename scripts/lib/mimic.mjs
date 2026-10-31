/**
 * Mimic battles: a real public game played again with Stat Points we chose, so
 * every answer is known and the game still looks like one people play. The
 * teams are the game's own open team sheets. Each Pokemon gets a spread people
 * run with its nature (Smogon's usage stats, `scripts/fixtures/usage-spreads.json`)
 * or, now and then, a random one, so rare spreads are tested too. Each player
 * makes the real player's choice for the turn - the move, its target, a Mega
 * Evolution, a switch, a replacement - while it is still legal; once the game
 * drifts from the real one (a Pokemon faints a turn early), Showdown's random
 * player chooses what the real game cannot say.
 *
 * Choices are tied to the Pokemon and the turn, not the slot, so a Pokemon that
 * comes in on another side of the field still does what it did.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { FuzzPlayer, broughtAs, playFuzz, randomSpread, seedFor } from './fuzz.mjs';
import { unmaskIllusion } from './protocol.mjs';
import { loadSource, setsFromSheet } from './replay-source.mjs';

const require = createRequire(import.meta.url);
const { Dex, TeamValidator, toID } = require('pokemon-showdown');
const { PRNG } = require('pokemon-showdown/dist/sim/prng.js');

const ROOT = process.cwd();
const FORMAT = 'gen9championsvgc2026regmc';
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const dex = Dex.forFormat(FORMAT);

export const MIMIC_DIR = 'recordings/showdown/others-open';
export const USAGE_FILE = 'scripts/fixtures/usage-spreads.json';
// A mimic battle stops where the real game did, and never later than this.
export const MIMIC_TURNS = 12;
// The share of Pokemon given a spread people run, when one with their nature is known.
const USUAL = 0.8;
// The targets a choice must name in doubles.
const AIMED = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

const baseOf = name => dex.species.get(String(name).split(',')[0]).baseSpecies;

/**
 * What each real player chose, read off a game's log: the four each brought, in
 * the order they came out, and per turn, per Pokemon, its move with its target
 * and whether it Mega Evolved, or the Pokemon it switched to; each side's
 * replacements in the order they came in; and the moves each Pokemon used. A move another effect called
 * (`[from]`) is no choice, and a Pokemon is named by its species, so a nickname
 * or a broken Illusion reads the same.
 */
export function readIntents(lines) {
  const log = unmaskIllusion(lines).lines;
  const turns = [];
  const order = { p1: [], p2: [] };
  const habits = { p1: new Map(), p2: new Map() };
  const at = {};
  let turn = 0;
  let choosing = true;
  let last = 0;
  const of = side => ((turns[turn] ||= { p1: { acts: new Map(), later: [] }, p2: { acts: new Map(), later: [] } })[side]);
  const who = (field) => {
    const m = /^(p[12])([a-d]): /.exec(String(field || ''));
    return m && at[m[1] + m[2]] ? { side: m[1], base: at[m[1] + m[2]] } : null;
  };
  for (const line of log) {
    const parts = String(line).split('|');
    const kind = parts[1];
    if (kind === 'turn') {
      turn = Number(parts[2]);
      last = Math.max(last, turn);
      choosing = true;
      continue;
    }
    if (kind === 'switch' || kind === 'drag') {
      const m = /^(p[12])([a-d]): /.exec(parts[2] || '');
      if (!m) continue;
      const [side, slot] = [m[1], m[1] + m[2]];
      const base = baseOf(parts[3]);
      if (!order[side].includes(base)) order[side].push(base);
      if (kind === 'switch' && turn > 0) {
        if (choosing && at[slot]) of(side).acts.set(at[slot], { switchTo: base });
        else if (!choosing) of(side).later.push(base);
      }
      at[slot] = base;
      continue;
    }
    if (kind === 'detailschange' || kind === '-mega') {
      const actor = who(parts[2]);
      if (actor && kind === '-mega') {
        choosing = false;
        const acts = of(actor.side).acts;
        acts.set(actor.base, { ...acts.get(actor.base), mega: true });
      }
      continue;
    }
    if (kind === 'cant') choosing = false;
    if (kind !== 'move') continue;
    choosing = false;
    if (parts.slice(5).some(f => f.startsWith('[from]'))) continue;
    const actor = who(parts[2]);
    if (!actor) continue;
    const acts = of(actor.side).acts;
    if (acts.get(actor.base)?.move) continue;
    acts.set(actor.base, { ...acts.get(actor.base), move: toID(parts[3]), target: who(parts[4]) });
    const used = habits[actor.side].get(actor.base) || [];
    if (!used.includes(toID(parts[3]))) used.push(toID(parts[3]));
    habits[actor.side].set(actor.base, used);
  }
  return { turns, order, habits, last };
}

/**
 * The spreads people run, by species and nature, as Smogon counted them, or
 * null when the fixture is missing.
 */
let usage;
export function usageSpreads() {
  if (usage !== undefined) return usage;
  const file = path.join(ROOT, USAGE_FILE);
  usage = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return usage;
}

/** A spread for one Pokemon: one people run with its nature, else a random full one. */
function spreadFor(set, rng, spreads) {
  const pool = (spreads?.[set.species] || []).filter(([nature]) => nature === set.nature);
  if (pool.length && rng.random() < USUAL) {
    let r = rng.random() * pool.reduce((t, [, , w]) => t + w, 0);
    const [, sp] = pool.find(([, , w]) => (r -= w) < 0) || pool[pool.length - 1];
    const values = sp.split('/').map(Number);
    return Object.fromEntries(STATS.map((s, i) => [s, values[i]]));
  }
  return randomSpread(rng, 66);
}

/** A battle's number from its id: the seeds of everything it plays. */
const numberOf = id => Number.parseInt(crypto.createHash('sha256').update(id).digest('hex').slice(0, 12), 16);

/**
 * Everything one mimic battle is: the real game's teams with a gender and a
 * spread for every Pokemon, the real choices, and the seeds - from the replay
 * file alone (or a source already loaded). Null when the replay is no game to mimic: a side without a
 * sheet, or a team the format refuses.
 */
export function mimicRecipe(id, source = loadSource(path.join(ROOT, MIMIC_DIR, `${id.replace(/^mimic:/, '')}.json`))) {
  const replayId = id.replace(/^mimic:/, '');
  if (!source.sheets[0] || !source.sheets[1]) return null;
  const n = numberOf(id);
  const rng = new PRNG(seedFor(n, 1));
  const spreads = usageSpreads()?.spreads;
  const sides = source.sheets.map(sheet => setsFromSheet(sheet).map((set) => {
    const species = broughtAs(set);
    const gender = species.gender || (/^[MF]$/.test(set.gender) ? set.gender : (rng.random() < 0.5 ? 'M' : 'F'));
    const sheetSet = {
      name: set.name && set.name !== set.species ? set.name : species.baseSpecies,
      species: species.name, item: set.item || '', ability: set.ability || '', moves: [...set.moves],
      nature: set.nature || 'Serious', gender, level: 50,
    };
    return { ...sheetSet, evs: spreadFor(sheetSet, rng, spreads) };
  }));
  const validator = TeamValidator.get(FORMAT);
  if (sides.some(team => validator.validateTeam(team)?.length)) return null;
  const intents = readIntents(source.lines);
  return {
    id, replayId, sides, intents, seed: seedFor(n, 2), ai: [seedFor(n, 3), seedFor(n, 4)],
    cap: Math.min(Math.max(intents.last, 1), MIMIC_TURNS),
  };
}

/**
 * A player that makes the real player's choice wherever it is legal, and
 * Showdown's random player's elsewhere: slot by slot first, then, if that whole
 * choice is refused, the random player's own.
 */
export class MimicPlayer extends FuzzPlayer {
  constructor(seed, side, intents) {
    super(seed);
    this.side = side;
    this.intents = intents;
    this.fallsBack = true;
    this.used = new Map();
  }

  receiveRequest(request, tries = 0) {
    this.note = null;
    super.receiveRequest(request);
    if (tries > 0 || !this.chosen || request.wait) return;
    const random = String(this.chosen).split(',').map(s => s.trim());
    let parts;
    this.habitual = 0;
    if (request.teamPreview) parts = [this.preview(request)];
    else if (request.forceSwitch) parts = request.forceSwitch.map((must, i) => (must ? this.replacement(request, i) : null));
    else if (request.active) parts = request.active.map((active, i) => this.action(request, active, i, random[i]));
    else return;
    const followed = parts.filter(Boolean).length - this.habitual;
    this.note = { followed, habit: this.habitual, slots: parts.length };
    if (followed) this.chosen = parts.map((p, i) => p || random[i]).join(', ');
  }

  /** The four the real player brought, in the order they came out, then the rest. */
  preview(request) {
    const team = request.side.pokemon.map(p => baseOf(p.details));
    const seen = this.intents.order[this.side].filter(b => team.includes(b));
    const order = [...seen, ...team.filter(b => !seen.includes(b))];
    return `team ${order.map(b => team.indexOf(b) + 1).join('')}`;
  }

  /** The Pokemon the real player brought in at this point of the turn, if it can come in. */
  replacement(request, i) {
    const turn = this.battle.turn;
    const queue = this.intents.turns[turn]?.[this.side]?.later || [];
    const key = `${turn}`;
    const taken = this.used.get(key) || 0;
    const pokemon = request.side.pokemon;
    for (let k = taken; k < queue.length; k++) {
      const slot = pokemon.findIndex((p, j) => j >= request.forceSwitch.length && baseOf(p.details) === queue[k] && !p.condition.endsWith(' fnt'));
      if (slot < 0) continue;
      this.used.set(key, k + 1);
      return pokemon[i].reviving ? null : `switch ${slot + 1}`;
    }
    return null;
  }

  /**
   * What the real player had this Pokemon do this turn, if it can do it here.
   * A move whose real target is not on the field, or not named in the log (a
   * charging turn), aims where a target can be; a Mega Evolution before a move
   * the log never shows (a flinch) goes with the random player's move.
   */
  action(request, active, i, random) {
    const pokemon = request.side.pokemon;
    if (pokemon[i].condition.endsWith(' fnt') || pokemon[i].commanding) return null;
    const base = baseOf(pokemon[i].details);
    const intent = this.intents.turns[this.battle.turn]?.[this.side]?.acts.get(base);
    if (!intent) return this.habit(request, active, i, base);
    if (intent.switchTo) {
      if (active.trapped) return null;
      const slot = pokemon.findIndex((p, j) => j >= request.active.length && baseOf(p.details) === intent.switchTo && !p.condition.endsWith(' fnt'));
      return slot < 0 ? null : `switch ${slot + 1}`;
    }
    const mega = intent.mega && active.canMegaEvo ? ' mega' : '';
    if (!intent.move) return mega && /^move /.test(random) && !/ mega$/.test(random) ? `${random}${mega}` : null;
    const k = (active.moves || []).findIndex(m => toID(m.id || m.move) === intent.move && !m.disabled);
    if (k < 0) return null;
    let choice = `move ${k + 1}`;
    const target = active.moves[k].target;
    if (request.active.length > 1 && AIMED.has(target)) {
      const aim = this.aim(target, intent.target, i);
      if (!aim) return null;
      choice += ` ${aim}`;
    }
    return choice + mega;
  }

  /**
   * With nothing real for this turn, a move the real player used with this
   * Pokemon some other turn, if it can use one now.
   */
  habit(request, active, i, base) {
    const used = this.intents.habits[this.side].get(base) || [];
    const ks = (active.moves || []).map((m, k) => (used.includes(toID(m.id || m.move)) && !m.disabled ? k : -1)).filter(k => k >= 0);
    if (!ks.length) return null;
    const k = this.prng.sample(ks);
    let choice = `move ${k + 1}`;
    const target = active.moves[k].target;
    if (request.active.length > 1 && AIMED.has(target)) {
      const aim = this.aim(target, null, i);
      if (!aim) return null;
      choice += ` ${aim}`;
    }
    this.habitual++;
    return choice;
  }

  /**
   * The target a choice names, as a slot of the foe's or minus one of ours: the
   * real one where it stands now, if the move can aim there, else a foe the
   * random player picks, or the ally.
   */
  aim(target, wanted, i) {
    const foe = this.side === 'p1' ? 'p2' : 'p1';
    const standing = side => this.battle[side].active.map((p, k) => (p && !p.fainted ? k : -1)).filter(k => k >= 0);
    if (wanted) {
      const at = this.battle[wanted.side].active.findIndex(p => p && !p.fainted && p.baseSpecies.baseSpecies === wanted.base);
      const ally = wanted.side === this.side;
      const fits = target === 'adjacentFoe' ? !ally : target === 'adjacentAlly' ? ally && at !== i : target === 'adjacentAllyOrSelf' ? ally : true;
      if (at >= 0 && fits) return ally ? -(at + 1) : at + 1;
    }
    if (target === 'adjacentAlly' || target === 'adjacentAllyOrSelf') {
      const ally = standing(this.side).find(k => k !== i);
      return ally !== undefined ? -(ally + 1) : target === 'adjacentAllyOrSelf' ? -(i + 1) : null;
    }
    const foes = standing(foe);
    return foes.length ? this.prng.sample(foes) + 1 : 1;
  }
}

/**
 * One mimic battle, played: what `playFuzz` returns, and how many slots made
 * the real player's choice for the turn, and how many one from another turn.
 */
export async function playMimic(recipe) {
  const players = recipe.ai.map((seed, i) => new MimicPlayer(seed, `p${i + 1}`, recipe.intents));
  const played = await playFuzz(recipe, players);
  const counted = played.choices.filter(c => c.slots);
  return {
    ...played,
    followed: counted.reduce((t, c) => t + c.followed, 0),
    habit: counted.reduce((t, c) => t + c.habit, 0),
    slots: counted.reduce((t, c) => t + c.slots, 0),
  };
}
