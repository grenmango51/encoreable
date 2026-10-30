/**
 * Fuzz battles: two Reg M-C teams from real team sheets, random Stat Points,
 * Showdown's own random player choosing, every choice and die from the
 * battle's number alone. The catalog's `--fuzz` infers them; `npm run score`
 * grades the inference on them from every viewpoint, since every answer is
 * known.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { traceOn, markDraws } from './rng-control.mjs';
import { loadSource, setsFromSheet } from './replay-source.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex, Teams, TeamValidator, toID } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const { PRNG } = require('pokemon-showdown/dist/sim/prng.js');
const { RandomPlayerAI } = require('pokemon-showdown/dist/sim/tools/random-player-ai.js');
const TEAMS = require('../fixtures/teams.js');

const ROOT = process.cwd();
const FORMAT = 'gen9championsvgc2026regmc';
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const BASE = Object.fromEntries(STATS.map(s => [s, 2]));
const dex = Dex.forFormat(FORMAT);

export const FUZZ_SOURCES = ['recordings/showdown/mine-open', 'recordings/showdown/full-sheets'];
export const FUZZ_TURNS = 12;

/**
 * The seed of one generator, four 16-bit words, from a battle's number and a
 * salt: every choice a fuzz battle makes comes from its number alone.
 */
export function seedFor(n, salt) {
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
export function fuzzTeams() {
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
export function randomSpread(rng, total) {
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
export function fuzzRecipe(n, teams, cap) {
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
export class FuzzPlayer extends RandomPlayerAI {
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
export function describeChoice(request, choice) {
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

/**
 * One fuzz battle, in-process in the real format, up to the start of turn
 * `cap + 1`: player 1's view of it, its input log, which replays it whole, and
 * the choices and dice it was played with.
 */
export async function playFuzz(recipe) {
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
    return { ch1: channels[1], inputLog: [...battle.inputLog], turns: battle.turn, ended: battle.ended, choices, dice };
  } finally {
    stream.destroy?.();
    await Promise.race([drain, Promise.resolve()]);
  }
}

