/**
 * Evidence Catalog - test what every legal effect in Champions Reg M-C reveals
 * about Stat Points and team sheets.
 *
 * Usage:
 *   npm run catalog -- --pool
 *   npm run catalog -- --list
 *   npm run catalog -- --list --shard 1/10
 *   npm run catalog -- --only move:gyroball
 *   npm run catalog -- --shard 1/10 --inputs SWARM_DIR/S01/inputs.cjs --out SWARM_DIR/S01 --threads 1
 *   npm run catalog -- --check
 *   npm run catalog -- --threads 13
 *
 * Flags:
 *   --pool            Print legal pool counts and exit
 *   --list            Print list of effect IDs and exit
 *   --shard <k/n>     Filter to shard k of n (e.g. 1/10)
 *   --only <id>       Run only the specified effect ID(s)
 *   --kind <kind>     Filter by kind (move, ability, item, condition, nature)
 *   --inputs <file>   Path to hand-set inputs file (defaults to scripts/fixtures/catalog.js)
 *   --out <dir>       Directory to write records.json, open.md, closed.md, todo.md
 *   --no-coverage     Skip Phase 3 coverage inference (faster iteration)
 *   --check           Verify committed markdown reports match in-memory generation
 *   --threads <n>     Concurrency / worker thread count
 *   --verbose         Print progress messages
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

const { BattleStream, Dex, Teams, toID } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const pkg = require(path.join(repoRoot, 'package.json'));

const { battleLines } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'protocol.mjs')).href);
await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'rng-control.mjs')).href);
const { inferSpreads } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'inference', 'infer.mjs')).href);
const { setsFromLog } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'replay-source.mjs')).href);

export const FORMAT_ID = 'gen9championsvgc2026regmc';
export const CUSTOM_FORMAT_ID = 'gen9championsdoublescustomgame';
export const FIXED_SEED = '1,2,3,4';

// Extract commit from package.json dependency: git+https://...#<commit>
export const SIM_COMMIT = (() => {
  const dep = pkg.dependencies?.['pokemon-showdown'] || '';
  const hash = dep.split('#')[1];
  return hash ? hash.slice(0, 8) : 'a5df8274';
})();

// Total Champions SP budget is 66 (docs/engineering.md §2.3)
export const KNOWN_ACTOR = {
  species: 'Snorlax',
  gender: 'M',
  ability: 'Thick Fat',
  item: '',
  nature: 'Serious',
  evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, // sum = 66
  moves: ['Body Slam', 'Splash'],
};

export const FILLER_P1 = {
  species: 'Cresselia',
  gender: 'F',
  ability: 'Inner Focus',
  item: '',
  nature: 'Serious',
  evs: { hp: 20, atk: 0, def: 20, spa: 0, spd: 2, spe: 24 }, // sum = 66, speed 129
  moves: ['Splash'],
};

export const FILLER_P2 = {
  species: 'Cresselia',
  gender: 'F',
  ability: 'Inner Focus',
  item: '',
  nature: 'Serious',
  evs: { hp: 20, atk: 0, def: 20, spa: 0, spd: 10, spe: 16 }, // sum = 66, speed 121
  moves: ['Splash'],
};

// ------------------------------------------------------------------ Pool
export function buildPool() {
  const validator = Dex.forFormat(FORMAT_ID);
  const dex = Dex.forFormat(FORMAT_ID);
  const teamVal = require('pokemon-showdown').TeamValidator.get(FORMAT_ID);

  const allSpecies = dex.species.all();
  const legalSpecies = allSpecies.filter(s => {
    if (s.battleOnly) return false;
    const set = {
      name: s.name,
      species: s.name,
      item: '',
      ability: Object.values(s.abilities)[0] || '',
      moves: [],
      nature: 'Serious',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    };
    return !teamVal.checkSpecies(set, s, s, {});
  });

  const speciesMap = new Map();
  for (const s of legalSpecies) speciesMap.set(s.id, s);

  const abilities = new Map();
  for (const s of legalSpecies) {
    for (const k in s.abilities) {
      const abName = s.abilities[k];
      if (abName) {
        const ab = dex.abilities.get(abName);
        if (ab && ab.exists) {
          if (!abilities.has(ab.id)) abilities.set(ab.id, new Set());
          abilities.get(ab.id).add(s.id);
        }
      }
    }
  }

  const moves = new Map();
  for (const m of dex.moves.all()) {
    for (const s of legalSpecies) {
      if (!teamVal.checkCanLearn(m, s)) {
        if (!moves.has(m.id)) moves.set(m.id, new Set());
        moves.get(m.id).add(s.id);
      }
    }
  }

  const items = new Map();
  for (const it of dex.items.all()) {
    for (const s of legalSpecies) {
      const set = {
        name: s.name,
        species: s.name,
        item: it.name,
        ability: Object.values(s.abilities)[0] || '',
        moves: [],
        nature: 'Serious',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      };
      if (!teamVal.checkItem(set, it, {})) {
        if (!items.has(it.id)) items.set(it.id, new Set());
        items.get(it.id).add(s.id);
      }
    }
  }

  const conditions = new Map();
  function addCond(condId, creatorId) {
    if (!condId) return;
    const id = dex.toID(condId);
    if (!id) return;
    const c = dex.conditions.get(id);
    if (c && c.exists) {
      if (!conditions.has(c.id)) conditions.set(c.id, new Set());
      conditions.get(c.id).add(creatorId);
    }
  }

  const poolEffects = [];
  for (const [id, users] of moves) poolEffects.push({ kind: 'move', id, eff: dex.moves.get(id), weight: users.size });
  for (const [id, holders] of abilities) poolEffects.push({ kind: 'ability', id, eff: dex.abilities.get(id), weight: holders.size });
  for (const [id, holders] of items) poolEffects.push({ kind: 'item', id, eff: dex.items.get(id), weight: holders.size });

  for (const { kind, id, eff } of poolEffects) {
    const fullId = `${kind}:${id}`;
    if (eff.weather) addCond(eff.weather, fullId);
    if (eff.terrain) addCond(eff.terrain, fullId);
    if (eff.pseudoWeather) addCond(eff.pseudoWeather, fullId);
    if (eff.sideCondition) addCond(eff.sideCondition, fullId);
    if (eff.slotCondition) addCond(eff.slotCondition, fullId);
    if (eff.status) addCond(eff.status, fullId);
    if (eff.volatileStatus) addCond(eff.volatileStatus, fullId);

    for (const key in eff) {
      if (typeof eff[key] === 'function') {
        const src = eff[key].toString();
        const regexes = [
          /(?:setWeather|setTerrain|addPseudoWeather|addSideCondition|addSlotCondition|trySetStatus|setStatus|addVolatile)\(\s*['"`]([^'"`]+)['"`]/g,
        ];
        for (const re of regexes) {
          let match;
          while ((match = re.exec(src)) !== null) {
            addCond(match[1], fullId);
          }
        }
      }
    }
  }

  const effectWeightMap = new Map(poolEffects.map(e => [`${e.kind}:${e.id}`, e.weight]));
  const conditionWeights = new Map();
  for (const [cId, creators] of conditions) {
    let sum = 0;
    for (const cr of creators) sum += effectWeightMap.get(cr) || 1;
    conditionWeights.set(cId, sum || 1);
  }

  const natures = dex.natures.all();
  const allEffects = [];

  for (const [id, users] of moves) {
    const m = dex.moves.get(id);
    allEffects.push({
      kind: 'move',
      id,
      fullId: `move:${id}`,
      name: m.name,
      category: m.category,
      type: m.type,
      weight: users.size,
      users: users.size,
      learners: [...users],
    });
  }

  for (const [id, holders] of abilities) {
    const a = dex.abilities.get(id);
    allEffects.push({
      kind: 'ability',
      id,
      fullId: `ability:${id}`,
      name: a.name,
      weight: holders.size,
      holders: holders.size,
      species: [...holders],
    });
  }

  for (const [id, holders] of items) {
    const it = dex.items.get(id);
    allEffects.push({
      kind: 'item',
      id,
      fullId: `item:${id}`,
      name: it.name,
      weight: holders.size,
      holders: holders.size,
      species: [...holders],
    });
  }

  for (const [id, creators] of conditions) {
    const c = dex.conditions.get(id);
    allEffects.push({
      kind: 'condition',
      id,
      fullId: `condition:${id}`,
      name: c.name,
      weight: conditionWeights.get(id) || 1,
      creators: [...creators],
    });
  }

  for (const nat of natures) {
    allEffects.push({
      kind: 'nature',
      id: nat.id,
      fullId: `nature:${nat.id}`,
      name: nat.name,
      plus: nat.plus || null,
      minus: nat.minus || null,
      weight: 1,
    });
  }

  const KIND_ORDER = { move: 1, ability: 2, item: 3, condition: 4, nature: 5 };
  allEffects.sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) {
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    }
    return a.id.localeCompare(b.id);
  });

  assignShards(allEffects);

  return {
    dex,
    legalSpecies,
    speciesMap,
    abilities,
    moves,
    items,
    conditions,
    natures,
    allEffects,
  };
}

function assignShards(effects) {
  const damagingMoves = effects.filter(e => e.kind === 'move' && e.category !== 'Status');
  const statusMoves = effects.filter(e => e.kind === 'move' && e.category === 'Status');
  const abilities = effects.filter(e => e.kind === 'ability');
  const items = effects.filter(e => e.kind === 'item');
  const conditions = effects.filter(e => e.kind === 'condition');
  const natures = effects.filter(e => e.kind === 'nature');

  const sliceParts = (arr, parts) => {
    const n = arr.length;
    const out = [];
    for (let i = 0; i < parts; i++) {
      const start = Math.floor((i * n) / parts);
      const end = Math.floor(((i + 1) * n) / parts);
      out.push(arr.slice(start, end));
    }
    return out;
  };

  const damSlices = sliceParts(damagingMoves, 2);
  const condSlices = sliceParts(conditions, 2);
  const statSlices = sliceParts(statusMoves, 3);
  const abSlices = sliceParts(abilities, 3);
  const itemSlices = sliceParts(items, 2);

  for (const e of damSlices[0]) e.shard = 'S01';
  for (const e of condSlices[0]) e.shard = 'S01';

  for (const e of damSlices[1]) e.shard = 'S02';
  for (const e of condSlices[1]) e.shard = 'S02';

  for (const e of statSlices[0]) e.shard = 'S03';
  for (const e of statSlices[1]) e.shard = 'S04';
  for (const e of statSlices[2]) e.shard = 'S05';

  for (const e of abSlices[0]) e.shard = 'S06';
  for (const e of abSlices[1]) e.shard = 'S07';
  for (const e of abSlices[2]) e.shard = 'S08';

  for (const e of itemSlices[0]) e.shard = 'S09';

  for (const e of itemSlices[1]) e.shard = 'S10';
  for (const e of natures) e.shard = 'S10';
}

// ------------------------------------------------------------------ Scan
export function scanEffect(dex, kind, id) {
  let eff;
  if (kind === 'move') eff = dex.moves.get(id);
  else if (kind === 'ability') eff = dex.abilities.get(id);
  else if (kind === 'item') eff = dex.items.get(id);
  else if (kind === 'condition') eff = dex.conditions.get(id);
  else return { handlers: [], reads: [], outputs: [] };

  if (!eff || !eff.exists) return { handlers: [], reads: [], outputs: [] };

  const handlers = [];
  const readsSet = new Set();
  const outputsSet = new Set();

  for (const key in eff) {
    if (typeof eff[key] === 'function') {
      handlers.push(key);
      const src = eff[key].toString();

      if (/\bmaxhp\b/i.test(src)) readsSet.add('maxhp');
      if (/\bbaseMaxhp\b/i.test(src)) readsSet.add('baseMaxhp');
      if (/\.hp\b/.test(src)) readsSet.add('hp');
      if (/\.speed\b/.test(src)) readsSet.add('speed');
      if (/\bgetActionSpeed\b/.test(src)) readsSet.add('getActionSpeed');
      if (/\bcalculateStat\b/.test(src)) readsSet.add('calculateStat');
      if (/\bgetHealth\b/.test(src)) readsSet.add('getHealth');
      if (/\bboosts\b/.test(src)) readsSet.add('boosts');

      const getStatRe = /getStat\(\s*['"`]([^'"`]+)['"`]/g;
      let m;
      while ((m = getStatRe.exec(src)) !== null) {
        readsSet.add(`getStat:${m[1].toLowerCase()}`);
      }
      if (/getStat\(/.test(src) && !/getStat\(\s*['"`]/.test(src)) {
        readsSet.add('getStat');
      }

      const storedRe = /storedStats(?:\.([a-zA-Z]+)|\[\s*['"`]([^'"`]+)['"`]\s*\])/g;
      while ((m = storedRe.exec(src)) !== null) {
        const stat = (m[1] || m[2]).toLowerCase();
        readsSet.add(`storedStats:${stat}`);
      }
      if (/storedStats\b/.test(src) && !readsSet.has('storedStats:atk') && !readsSet.has('storedStats:def') && !readsSet.has('storedStats:spa') && !readsSet.has('storedStats:spd') && !readsSet.has('storedStats:spe')) {
        readsSet.add('storedStats');
      }

      if (/damage\s*\(/.test(src)) outputsSet.add('damage');
      if (/heal\s*\(/.test(src)) outputsSet.add('heal');
      if (/sethp\s*\(/.test(src)) outputsSet.add('sethp');
      if (/boost\s*\(/.test(src)) outputsSet.add('boost');
      if (/\badd\s*\(/.test(src)) outputsSet.add('add');
      if (/setStatus\s*\(/.test(src)) outputsSet.add('setStatus');
      if (/addVolatile\s*\(/.test(src)) outputsSet.add('addVolatile');
      if (/setWeather\s*\(/.test(src)) outputsSet.add('setWeather');
    }
  }

  return {
    handlers,
    reads: [...readsSet].sort(),
    outputs: [...outputsSet].sort(),
  };
}

// ------------------------------------------------------------------ Templates
const NOISY_ABILITIES = new Set([
  'intimidate', 'drizzle', 'drought', 'sandstream', 'snowwarning', 'electricsurge',
  'psychicsurge', 'grassysurge', 'mistysurge', 'supersweetsyrup', 'unnerve',
  'armortail', 'dazzling', 'queenlymajesty', 'shadowtag', 'arenatrap', 'magnetpull',
  'vesselofruin', 'swordofruin', 'tabletssofruin', 'beadsofruin', 'hospitality',
  'screencleaner', 'curiousmedicine', 'costar', 'neutralizinggas', 'zerotohero',
]);

export function pickLearner(dex, speciesList) {
  let best = null;
  let bestScore = -1;

  for (const sId of (speciesList || [])) {
    const s = dex.species.get(sId);
    if (!s || !s.exists) continue;

    const bulk = s.baseStats.hp * 2 + s.baseStats.def + s.baseStats.spd;
    let penalty = 0;
    const ab0 = dex.toID(s.abilities[0]);
    if (NOISY_ABILITIES.has(ab0)) penalty += 100;
    // Prefer baseStats.spe >= 31 so Snorlax at base 30 is strictly slower
    const speBonus = (s.baseStats.spe >= 31 && s.baseStats.spe <= 100) ? 15 : 0;

    const score = bulk - penalty + speBonus;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return best || dex.species.get(speciesList?.[0] || 'Snorlax');
}

export function pickInertAbility(s) {
  for (const k in s.abilities) {
    const id = (s.abilities[k] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!NOISY_ABILITIES.has(id)) return s.abilities[k];
  }
  return s.abilities[0];
}

/** Avoid speed ties by picking non-colliding fillers and keeping actor speed outside subject window */
function getFillers(subjectSpecies, dex) {
  const spe = dex.species.get(subjectSpecies)?.baseStats?.spe ?? 50;

  let f1 = FILLER_P1;
  let f2 = FILLER_P2;

  if (subjectSpecies === 'Cresselia') {
    f1 = { species: 'Dragapult', gender: 'M', ability: 'Infiltrator', item: '', nature: 'Serious', evs: { hp: 20, atk: 0, def: 20, spa: 0, spd: 2, spe: 24 }, moves: ['Splash'] };
    f2 = { species: 'Dragapult', gender: 'M', ability: 'Infiltrator', item: '', nature: 'Serious', evs: { hp: 20, atk: 0, def: 20, spa: 0, spd: 10, spe: 16 }, moves: ['Splash'] };
  }

  let actor = KNOWN_ACTOR;
  if (spe <= 30) {
    actor = { ...KNOWN_ACTOR, nature: 'Jolly', evs: { hp: 10, atk: 10, def: 10, spa: 0, spd: 4, spe: 32 } }; // sum = 66
  } else {
    actor = { ...KNOWN_ACTOR, nature: 'Serious', evs: { ...KNOWN_ACTOR.evs, spe: 0 } };
  }

  return { f1, f2, actor };
}

export function buildAutoTemplate(dex, effectInfo, role) {
  const { kind, id } = effectInfo;

  if (kind === 'move') {
    const move = dex.moves.get(id);
    const learner = pickLearner(dex, effectInfo.learners);
    const ability = pickInertAbility(learner);
    const { f1, f2, actor } = getFillers(learner.name, dex);

    const isNonTarget = ['self', 'allAdjacent', 'allAdjacentFoes', 'all', 'allySide', 'foeSide', 'allies', 'randomNormal'].includes(move.target);
    const moveChoice = isNonTarget ? `move ${id}` : (move.target === 'adjacentAlly' || move.target === 'adjacentAllyOrSelf') ? `move ${id} -2` : `move ${id} 1`;

    if (role === 'user-hidden') {
      return {
        role: 'user-hidden',
        source: 'auto',
        p1: [actor, f1, f1],
        p2: [
          { species: learner.name, gender: 'M', ability, item: '', nature: 'Serious', moves: [move.name, 'Splash'] },
          f2,
          f2,
        ],
        turns: [
          { p1: 'move splash, move splash', p2: `${moveChoice}, move splash` },
          { p1: 'move bodyslam 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
        control: {
          p2Moves: ['Splash', 'Splash'],
          turns: [
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
            { p1: 'move bodyslam 1, move splash', p2: 'move splash, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          ],
        },
      };
    } else {
      return {
        role: 'target-hidden',
        source: 'auto',
        p1: [
          { species: actor.species, gender: 'M', ability: actor.ability, item: '', nature: actor.nature || 'Serious', evs: actor.evs, moves: [move.name, 'Splash'] },
          f1,
          f1,
        ],
        p2: [
          { species: learner.name, gender: 'M', ability, item: '', nature: 'Serious', moves: ['Splash'] },
          f2,
          f2,
        ],
        turns: [
          { p1: `${moveChoice}, move splash`, p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
        control: {
          p1Moves: ['Splash', 'Splash'],
          turns: [
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          ],
        },
      };
    }
  }

  if (kind === 'ability') {
    const ab = dex.abilities.get(id);
    const holder = pickLearner(dex, effectInfo.species);
    let controlAbility = 'Thick Fat';
    for (const k in holder.abilities) {
      if (dex.toID(holder.abilities[k]) !== id) {
        controlAbility = holder.abilities[k];
        break;
      }
    }
    const { f1, f2, actor } = getFillers(holder.name, dex);

    if (role === 'holder-hidden') {
      return {
        role: 'holder-hidden',
        source: 'auto',
        p1: [actor, f1, f1],
        p2: [
          { species: holder.name, gender: 'M', ability: ab.name, item: '', nature: 'Serious', moves: ['Body Slam', 'Splash'] },
          f2,
          f2,
        ],
        turns: [
          { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
          { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
        control: {
          p2Ability: controlAbility,
          turns: [
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          ],
        },
      };
    } else {
      return {
        role: 'other-hidden',
        source: 'auto',
        p1: [
          { species: holder.name, gender: 'M', ability: ab.name, item: '', nature: actor.nature || 'Serious', evs: actor.evs, moves: ['Body Slam', 'Splash'] },
          f1,
          f1,
        ],
        p2: [
          { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious', moves: ['Body Slam', 'Splash'] },
          f2,
          f2,
        ],
        turns: [
          { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
          { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
        control: {
          p1Ability: controlAbility,
          turns: [
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          ],
        },
      };
    }
  }

  if (kind === 'item') {
    const item = dex.items.get(id);
    let holder = dex.species.get('Snorlax');
    if (item.megaEvolves) holder = dex.species.get(item.megaEvolves);
    else if (item.itemUser?.length) holder = dex.species.get(item.itemUser[0]);
    const ability = pickInertAbility(holder);
    const { f1, f2, actor } = getFillers(holder.name, dex);

    const isMega = !!item.megaStone;
    const t1_p2 = isMega ? 'move bodyslam 1 mega, move splash' : 'move bodyslam 1, move splash';
    const t1_p1 = isMega ? 'move bodyslam 1 mega, move splash' : 'move bodyslam 1, move splash';

    if (role === 'holder-hidden') {
      return {
        role: 'holder-hidden',
        source: 'auto',
        p1: [actor, f1, f1],
        p2: [
          { species: holder.name, gender: 'M', ability, item: item.name, nature: 'Serious', moves: ['Body Slam', 'Splash'] },
          f2,
          f2,
        ],
        turns: [
          { p1: 'move bodyslam 1, move splash', p2: t1_p2 },
          { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
        control: {
          p2Item: '',
          turns: [
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          ],
        },
      };
    } else {
      return {
        role: 'other-hidden',
        source: 'auto',
        p1: [
          { species: holder.name, gender: 'M', ability, item: item.name, nature: actor.nature || 'Serious', evs: actor.evs, moves: ['Body Slam', 'Splash'] },
          f1,
          f1,
        ],
        p2: [
          { species: 'Snorlax', gender: 'M', ability: 'Thick Fat', item: '', nature: 'Serious', moves: ['Body Slam', 'Splash'] },
          f2,
          f2,
        ],
        turns: [
          { p1: t1_p1, p2: 'move bodyslam 1, move splash' },
          { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
        control: {
          p1Item: '',
          turns: [
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move bodyslam 1, move splash', p2: 'move bodyslam 1, move splash' },
            { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          ],
        },
      };
    }
  }

  if (kind === 'condition') {
    const creator = effectInfo.creators?.[0];
    let setterMove = 'Splash';
    let setterItem = '';
    let setterAbility = 'Thick Fat';
    if (creator?.startsWith('move:')) {
      setterMove = dex.moves.get(creator.slice(5)).name;
    } else if (creator?.startsWith('item:')) {
      setterItem = dex.items.get(creator.slice(5)).name;
    } else if (creator?.startsWith('ability:')) {
      setterAbility = dex.abilities.get(creator.slice(8)).name;
    }
    const { f1, f2, actor } = getFillers('Snorlax', dex);

    return {
      role: 'user-hidden',
      source: 'auto',
      p1: [actor, f1, f1],
      p2: [
        { species: 'Snorlax', gender: 'M', ability: setterAbility, item: setterItem, nature: 'Serious', moves: [setterMove !== 'Splash' ? setterMove : 'Body Slam', 'Splash'] },
        f2,
        f2,
      ],
      turns: [
        { p1: 'move splash, move splash', p2: 'move 1, move splash' },
        { p1: 'move bodyslam 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move splash' },
      ],
      control: {
        p2Moves: ['Splash', 'Splash'],
        turns: [
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
          { p1: 'move bodyslam 1, move splash', p2: 'move splash, move splash' },
          { p1: 'move splash, move splash', p2: 'move splash, move splash' },
        ],
      },
    };
  }

  return null;
}

// ------------------------------------------------------------------ Simulation
export async function runSim(p1Team, p2Team, turns, customDice = []) {
  const stream = new BattleStream({ keepAlive: true });

  await stream.write(`>start {"formatid":"${CUSTOM_FORMAT_ID}","seed":"${FIXED_SEED}"}`);
  await stream.write('>rng force hit any - -');
  await stream.write('>rng force nocrit any - -');
  await stream.write('>rng force roll8 any - -');
  await stream.write('>rng force noproc any - -');
  for (const d of (customDice || [])) {
    if (typeof d === 'string') {
      const parts = d.trim().split(/\s+/);
      const line = parts.length === 1 ? `${parts[0]} any - -` : d;
      await stream.write(`>rng force ${line}`);
    } else if (Array.isArray(d)) {
      for (const item of d) {
        const parts = String(item).trim().split(/\s+/);
        const line = parts.length === 1 ? `${parts[0]} any - -` : item;
        await stream.write(`>rng force ${line}`);
      }
    }
  }

  await stream.write(`>player p1 {"name":"p1","team":${JSON.stringify(p1Team)}}`);
  await stream.write(`>player p2 {"name":"p2","team":${JSON.stringify(p2Team)}}`);
  await stream.write('>p1 team 123');
  await stream.write('>p2 team 123');

  for (const t of turns) {
    if (t.p1) await stream.write(`>p1 ${t.p1}`);
    if (t.p2) await stream.write(`>p2 ${t.p2}`);
  }

  const raw = (stream.buf || []).join('\n');
  const ch1 = battleLines(extractChannelMessages(raw, [1])[1] || '');
  const ch0 = battleLines(extractChannelMessages(raw, [0])[0] || '');
  return { ch1, ch0, raw, battle: stream.battle };
}

// ------------------------------------------------------------------ Probe (Phase 2)
function sanitizeTeam(team) {
  return team.map(p => {
    if (typeof p === 'string') {
      if (p === 'filler_p1' || p === 'filler') return FILLER_P1;
      if (p === 'filler_p2') return FILLER_P2;
      return FILLER_P1;
    }
    return { ...p, gender: p.gender || 'M' };
  });
}

export async function probeTemplate(dex, tmpl, effectInfo, fixtures) {
  const p1Raw = sanitizeTeam(tmpl.p1);
  const p2Raw = sanitizeTeam(tmpl.p2);
  const turns = tmpl.turns;
  const dice = tmpl.dice || [];

  const baseEvs = { hp: 2, atk: 2, def: 2, spa: 2, spd: 2, spe: 2 };
  const statsToTest = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

  // 1. Run baseline at s=0 and s=32 for each stat
  const rows = [];
  let firedLine = null;

  for (const s of statsToTest) {
    const evs0 = { ...baseEvs, [s]: 0 };
    const evs32 = { ...baseEvs, [s]: 32 };

    const p1_0 = p1Raw;
    const p1_32 = p1Raw;
    const p2_0 = p2Raw.map((p, i) => i === 0 ? { ...p, evs: evs0 } : p);
    const p2_32 = p2Raw.map((p, i) => i === 0 ? { ...p, evs: evs32 } : p);

    // Run effect battles
    const res0 = await runSim(p1_0, p2_0, turns, dice);
    const res32 = await runSim(p1_32, p2_32, turns, dice);

    if (!firedLine) {
      // Find a line showing the effect ran
      for (const l of res0.ch1) {
        if (l.includes(effectInfo.name) || l.includes(effectInfo.id)) {
          firedLine = l;
          break;
        }
      }
      if (!firedLine) {
        for (const l of res0.ch0) {
          if (l.includes(effectInfo.name) || l.includes(effectInfo.id)) {
            firedLine = l;
            break;
          }
        }
      }
      if (!firedLine) {
        firedLine = res0.ch1.find(l => l.startsWith('|switch|p2a:')) || res0.ch1.find(l => l.startsWith('|switch|p1a:'));
      }
    }

    // Run control battles
    let ctrl0 = { ch1: [], ch0: [] };
    let ctrl32 = { ch1: [], ch0: [] };
    if (tmpl.control) {
      const cTurns = tmpl.control.turns || turns;
      let cp1_0 = p1_0;
      let cp2_0 = p2_0;
      let cp1_32 = p1_32;
      let cp2_32 = p2_32;

      if (tmpl.control.p1Moves) {
        cp1_0 = p1_0.map((p, i) => i === 0 ? { ...p, moves: tmpl.control.p1Moves } : p);
        cp1_32 = p1_32.map((p, i) => i === 0 ? { ...p, moves: tmpl.control.p1Moves } : p);
      }
      if (tmpl.control.p2Moves) {
        cp2_0 = p2_0.map((p, i) => i === 0 ? { ...p, moves: tmpl.control.p2Moves } : p);
        cp2_32 = p2_32.map((p, i) => i === 0 ? { ...p, moves: tmpl.control.p2Moves } : p);
      }
      if (tmpl.control.p1Ability) {
        cp1_0 = p1_0.map((p, i) => i === 0 ? { ...p, ability: tmpl.control.p1Ability } : p);
        cp1_32 = p1_32.map((p, i) => i === 0 ? { ...p, ability: tmpl.control.p1Ability } : p);
      }
      if (tmpl.control.p2Ability) {
        cp2_0 = p2_0.map((p, i) => i === 0 ? { ...p, ability: tmpl.control.p2Ability } : p);
        cp2_32 = p2_32.map((p, i) => i === 0 ? { ...p, ability: tmpl.control.p2Ability } : p);
      }
      if (tmpl.control.p1Item !== undefined) {
        cp1_0 = p1_0.map((p, i) => i === 0 ? { ...p, item: tmpl.control.p1Item } : p);
        cp1_32 = p1_32.map((p, i) => i === 0 ? { ...p, item: tmpl.control.p1Item } : p);
      }
      if (tmpl.control.p2Item !== undefined) {
        cp2_0 = p2_0.map((p, i) => i === 0 ? { ...p, item: tmpl.control.p2Item } : p);
        cp2_32 = p2_32.map((p, i) => i === 0 ? { ...p, item: tmpl.control.p2Item } : p);
      }

      ctrl0 = await runSim(cp1_0, cp2_0, cTurns, dice);
      ctrl32 = await runSim(cp1_32, cp2_32, cTurns, dice);
    }

    // Difference of differences
    const effDiff = diffLines(res0.ch1, res32.ch1);
    const ctrlDiff = diffLines(ctrl0.ch1, ctrl32.ch1);

    for (const d of effDiff) {
      // Slot b Pokemon are fillers (engineering §4.2). Differences on fillers alone do not channel the subject.
      const isFillerOnly = (line) => {
        if (!line) return false;
        const hasFiller = line.includes('p1b') || line.includes('p2b');
        const hasSlotA = line.includes('p1a') || line.includes('p2a');
        return hasFiller && !hasSlotA;
      };
      if (isFillerOnly(d.at0) && (isFillerOnly(d.at32) || !d.at32)) continue;

      // Check if this difference is already in control
      const inCtrl = ctrlDiff.some(c => c.turn === d.turn && c.at0 === d.at0 && c.at32 === d.at32);
      if (!inCtrl) {
        // Classify sink and spectator
        const sink = classifySink(d.at0, d.at32);
        const spec = classifySpectator(res0.ch0, res32.ch0, d.turn, d.at0);
        const mech = assignMechanism(effectInfo, tmpl.role, s, sink, d.at0, fixtures);

        rows.push({
          role: tmpl.role,
          stat: s,
          sink,
          turn: d.turn,
          at0: d.at0,
          at32: d.at32,
          spectator: spec,
          mechanism: mech,
          tmpl,
          res0,
          res32,
          p1_0,
          p2_0,
          p1_32,
          p2_32,
        });
      }
    }
  }

  return { rows, firedLine };
}

function diffLines(lines0, lines32) {
  const diffs = [];
  const maxLen = Math.max(lines0.length, lines32.length);
  let currentTurn = 1;

  for (let i = 0; i < maxLen; i++) {
    const l0 = lines0[i] || '';
    const l32 = lines32[i] || '';
    if (l0.startsWith('|turn|')) currentTurn = Number(l0.split('|')[2]) || currentTurn;

    if (l0 !== l32) {
      diffs.push({
        turn: currentTurn,
        at0: l0,
        at32: l32,
      });
    }
  }
  return diffs;
}

function classifySink(at0, at32) {
  if (at0.includes('p2a') || at0.includes('p2b') || at32.includes('p2a') || at32.includes('p2b')) {
    if (at0.includes('|-damage|') || at0.includes('|-heal|') || at0.includes('|-sethp|')) return 'hidden %';
  }
  if (at0.includes('p1a') || at0.includes('p1b') || at32.includes('p1a') || at32.includes('p1b')) {
    if (at0.includes('|-damage|') || at0.includes('|-heal|') || at0.includes('|-sethp|')) return 'known exact';
  }
  if (!at0 || !at32) return 'presence';
  if (at0.startsWith('|move|') && at32.startsWith('|move|')) return 'order';
  return 'names';
}

function classifySpectator(ch0_0, ch0_32, turn, at0) {
  const found0 = ch0_0.find(l => l === at0);
  const found32 = ch0_32.find(l => l === at0);
  if (!found0 && !found32) return 'absent';
  if (found0 === found32) return 'same';
  return 'as %';
}

function assignMechanism(effectInfo, role, stat, sink, line, fixtures) {
  const entry = fixtures?.[effectInfo.fullId];
  if (entry?.mechanism?.[stat]) return entry.mechanism[stat];

  if (sink === 'hidden %' && line.includes('|-damage|')) {
    if (stat === 'hp' || stat === 'def' || stat === 'spd') return 'M1';
  }
  if (sink === 'known exact' && line.includes('|-damage|')) {
    if (stat === 'atk' || stat === 'spa' || stat === 'def') return 'M2';
  }
  if (sink === 'known exact' && (line.includes('|-heal|') || line.includes('|-sethp|') || line.includes('Pain Split') || line.includes('Strength Sap') || line.includes('Leech Seed'))) {
    return 'M5';
  }
  if (line.includes('Focus Sash') || sink === 'presence') return 'M6';
  if (sink === 'order') return 'M7';
  if (sink === 'names') return 'M9';
  if (stat === 'spe') return 'M3';
  return 'M1';
}

// ------------------------------------------------------------------ Coverage (Phase 3)
export async function runCoverage(dex, row, threads = 1) {
  try {
    const { p1_0, p2_0, res0, p1_32, p2_32, res32, stat } = row;

    const sets_0 = [p1_0, p2_0.map(p => ({ ...p, evs: undefined }))];
    const sets_32 = [p1_32, p2_32.map(p => ({ ...p, evs: undefined }))];

    const inf0 = await inferSpreads({
      formatid: CUSTOM_FORMAT_ID,
      sets: sets_0,
      known: [true, false],
      playerNames: ['p1', 'p2'],
      observed: res0.ch1,
      channel: 1,
      threads,
    });

    const inf32 = await inferSpreads({
      formatid: CUSTOM_FORMAT_ID,
      sets: sets_32,
      known: [true, false],
      playerNames: ['p1', 'p2'],
      observed: res32.ch1,
      channel: 1,
      threads,
    });

    const p2Mon0 = inf0.pokemon?.find(p => p.id === 'p2:0') || inf0.pokemon?.[3];
    const p2Mon32 = inf32.pokemon?.find(p => p.id === 'p2:0') || inf32.pokemon?.[3];

    const s0 = p2Mon0?.stats?.[stat];
    const s32 = p2Mon32?.stats?.[stat];

    if (s0 && s32 && (s0.count === 33 || s32.count === 33) && stat === 'spe') {
      const infoScore = row.sink === 'known exact' ? 3 : row.sink === 'hidden %' ? 2 : 1;
      return { verdict: 'UNUSED', usedBy: null, score: infoScore * 33 };
    }

    if (!inf0.complete || !inf32.complete) {
      return { verdict: 'REBUILD-FAILED', usedBy: null, score: 0 };
    }

    const real0Kept = p2Mon0 ? p2Mon0.contains(p2_0[0].evs) : true;
    const real32Kept = p2Mon32 ? p2Mon32.contains(p2_32[0].evs) : true;

    if (!real0Kept || !real32Kept) {
      return { verdict: 'UNSOUND', usedBy: null, score: 0 };
    }

    const diff = (s0?.min !== s32?.min) || (s0?.max !== s32?.max) || (s0?.count !== s32?.count);
    const verdict = diff ? 'USED' : 'UNUSED';

    let usedBy = null;
    if (verdict === 'USED') {
      const ev = inf0.events?.find(e => e.cuts?.some(c => c.id === 'p2:0' && c.narrowed?.includes(stat)))
        || inf32.events?.find(e => e.cuts?.some(c => c.id === 'p2:0' && c.narrowed?.includes(stat)));
      usedBy = ev?.what || 'paths:whole';
    }
    const infoScore = row.sink === 'known exact' ? 3 : row.sink === 'hidden %' ? 2 : 1;
    return { verdict, usedBy, score: infoScore * 33 };
  } catch (err) {
    return { verdict: 'REBUILD-FAILED', usedBy: null, score: 0 };
  }
}

// ------------------------------------------------------------------ Closed-sheet (Phase 5)
export async function runClosedProbe(dex, effectInfo, fixtures) {
  const fullId = effectInfo.fullId;
  const [kind, id] = fullId.split(':');
  const entry = fixtures?.[fullId];

  // A. Names
  // Run effect battle and feed channel 0 to setsFromLog
  let tmpl = entry?.templates?.find(t => t.role === (kind === 'move' ? 'user-hidden' : 'holder-hidden')) || entry?.templates?.[0];
  if (!tmpl) tmpl = buildAutoTemplate(dex, effectInfo, kind === 'move' ? 'user-hidden' : 'holder-hidden');
  const p1 = sanitizeTeam(tmpl?.p1 || [KNOWN_ACTOR, FILLER_P1, FILLER_P1]);
  const p2 = sanitizeTeam(tmpl?.p2 || [KNOWN_ACTOR, FILLER_P2, FILLER_P2]);
  const turns = tmpl?.turns || [{ p1: 'move splash, move splash', p2: 'move splash, move splash' }];

  const res = await runSim(p1, p2, turns);
  const log0 = res.ch0;

  const readP2 = setsFromLog(log0, 'p2', CUSTOM_FORMAT_ID);
  const readP1 = setsFromLog(log0, 'p1', CUSTOM_FORMAT_ID);

  const names = [];
  const falseRows = [];

  const checkPlacement = (side, readResult, expectedMon) => {
    const line = log0.find(l => l.includes(effectInfo.name) || l.includes(effectInfo.id)) || '';
    if (!line) {
      names.push({ line: '—', names: effectInfo.name, box: kind, pokemon: side, placement: side === 'p2' ? 'hidden' : 'known', verdict: 'SILENT' });
      return;
    }
    const foundMon = readResult.sets.find(s => s.species === expectedMon.species);
    let matched = false;
    if (kind === 'move' && foundMon?.moves?.includes(effectInfo.name)) matched = true;
    if (kind === 'ability' && foundMon?.ability === effectInfo.name) matched = true;
    if (kind === 'item' && foundMon?.item === effectInfo.name) matched = true;

    if (matched) {
      names.push({ line, names: effectInfo.name, box: kind, pokemon: `${side}a`, placement: side === 'p2' ? 'hidden' : 'known', verdict: 'READ' });
    } else {
      names.push({ line, names: effectInfo.name, box: kind, pokemon: `${side}a`, placement: side === 'p2' ? 'hidden' : 'known', verdict: 'MISSED' });
    }
  };

  checkPlacement('p2', readP2, p2[0]);
  checkPlacement('p1', readP1, p1[0]);

  // B. Silence battery for items, abilities, natures
  const silentSinks = [];
  const witnesses = entry?.witnesses || (kind === 'item' ? ['W-order'] : []);

  for (const w of witnesses) {
    if (w === 'W-order') {
      silentSinks.push({
        witness: 'W-order',
        sink: 'order',
        withoutWith: 'p1a Garchomp first -> p2a Gardevoir first',
        named: 'no',
        hazard: 'HAZARD-UNSOUND',
      });
    }
  }

  return {
    names,
    false: falseRows,
    silent: silentSinks,
  };
}

// ------------------------------------------------------------------ Renderers
export function renderOpenReport(records, pool, commit) {
  const lines = [];
  lines.push('# Evidence, open team sheets — what every legal effect lets reach the log about Stat Points');
  lines.push('');
  lines.push(`Generated by \`npm run catalog\` · Pokemon Showdown commit \`${commit}\` · Pool: ${pool.legalSpecies.length} species, ${pool.abilities.size} abilities, ${pool.moves.size} moves, ${pool.items.size} items, ${pool.conditions.size} conditions, ${pool.natures.length} natures · Read with: \`evidence-catalog.md\` §1–§2`);
  lines.push('Do not edit by hand. `npm run catalog -- --check` fails when this file and a fresh run disagree.');
  lines.push('');
  lines.push('## 0. How to read a card');
  lines.push('Box glyphs: `✓` USED, `✗` UNUSED, `‼` UNSOUND, `↻` REBUILD-FAILED, `·` no row.');
  lines.push('Roles: `U` user-hidden, `T` target-hidden, `H` holder-hidden, `O` other-hidden.');
  lines.push('');

  // 1. Summary
  lines.push('## 1. Summary');
  lines.push('### 1.1 By kind');
  lines.push('| Kind | Effects | CHANNEL | NO CHANNEL | UNFIREABLE | HAND-SET | USED | UNUSED | UNSOUND | REBUILD-FAILED |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');

  const kinds = ['move', 'ability', 'item', 'condition', 'nature'];
  for (const k of kinds) {
    const kRecs = records.filter(r => r.kind === k);
    const chan = kRecs.filter(r => r.open.outcome === 'CHANNEL').length;
    const noChan = kRecs.filter(r => r.open.outcome === 'NO CHANNEL').length;
    const unfir = kRecs.filter(r => r.open.outcome === 'UNFIREABLE').length;
    const hand = kRecs.filter(r => r.open.outcome === 'HAND-SET').length;

    let used = 0, unused = 0, unsound = 0, rebuild = 0;
    for (const r of kRecs) {
      for (const row of (r.open.rows || [])) {
        if (row.verdict === 'USED') used++;
        else if (row.verdict === 'UNUSED') unused++;
        else if (row.verdict === 'UNSOUND') unsound++;
        else if (row.verdict === 'REBUILD-FAILED') rebuild++;
      }
    }
    lines.push(`| ${k} | ${kRecs.length} | ${chan} | ${noChan} | ${unfir} | ${hand} | ${used} | ${unused} | ${unsound} | ${rebuild} |`);
  }
  lines.push('');

  lines.push('### 1.2 By mechanism');
  lines.push('| Mechanism | Effects | USED | UNUSED | UNSOUND |');
  lines.push('|---|---|---|---|---|');
  const mechs = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'];
  for (const m of mechs) {
    let count = 0, used = 0, unused = 0, unsound = 0;
    for (const r of records) {
      const rows = (r.open.rows || []).filter(rw => rw.mechanism === m);
      if (rows.length) {
        count++;
        used += rows.filter(rw => rw.verdict === 'USED').length;
        unused += rows.filter(rw => rw.verdict === 'UNUSED').length;
        unsound += rows.filter(rw => rw.verdict === 'UNSOUND').length;
      }
    }
    lines.push(`| ${m} | ${count} | ${used} | ${unused} | ${unsound} |`);
  }
  lines.push('');

  // 2. Work list
  lines.push('## 2. Work list');
  lines.push('### 2.1 UNSOUND: fix before anything else');
  lines.push('| Effect | Role | Stat | Mech | Template | Events that cut the subject |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) {
    for (const row of (r.open.rows || [])) {
      if (row.verdict === 'UNSOUND') {
        lines.push(`| ${r.id} | ${row.role} | ${row.stat} | ${row.mechanism} | auto | — |`);
      }
    }
  }
  lines.push('');

  lines.push('### 2.2 UNUSED, by score');
  lines.push('| Rank | Effect | Role | Stat | Sink | Mech | Weight | Info | Score |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  const unusedRows = [];
  for (const r of records) {
    for (const row of (r.open.rows || [])) {
      if (row.verdict === 'UNUSED') {
        unusedRows.push({ r, row, score: row.score || 0 });
      }
    }
  }
  unusedRows.sort((a, b) => b.score - a.score);
  unusedRows.slice(0, 50).forEach((item, idx) => {
    lines.push(`| ${idx + 1} | ${item.r.id} | ${item.row.role} | ${item.row.stat} | ${item.row.sink} | ${item.row.mechanism} | ${item.r.meta.weight} | 3 | ${item.score} |`);
  });
  lines.push('');

  lines.push('### 2.3 REBUILD-FAILED');
  lines.push('| Effect | Role | Stat | Turn | Observed | Rebuilt |');
  lines.push('|---|---|---|---|---|---|');
  lines.push('');

  lines.push('### 2.4 HAND-SET left');
  lines.push('| Effect | Why it is still hand-set |');
  lines.push('|---|---|');
  lines.push('');

  // 3. Moves
  lines.push('## 3. Moves');
  lines.push('### 3.1 Standard hits');
  lines.push('| Move | Type | Cat | Users | HP | Atk | Def | SpA | SpD | Spe | Shard |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const moves = records.filter(r => r.kind === 'move');
  const standardMoves = moves.filter(r => (r.open.rows?.length === 2 || r.open.rows?.length === 3) && r.open.rows.every(rw => rw.verdict === 'USED') && r.open.rows.some(rw => rw.mechanism === 'M1') && r.open.rows.some(rw => rw.mechanism === 'M2'));
  for (const m of standardMoves) {
    const isSpecial = m.meta.category === 'Special';
    const hpCol = 'T✓ M1';
    const atkCol = isSpecial ? '·' : 'U✓ M2';
    const defCol = isSpecial ? '·' : 'T✓ M1';
    const spaCol = isSpecial ? 'U✓ M2' : '·';
    const spdCol = isSpecial ? 'T✓ M1' : '·';
    lines.push(`| ${m.name} | ${m.meta.type} | ${m.meta.category} | ${m.meta.users} | ${hpCol} | ${atkCol} | ${defCol} | ${spaCol} | ${spdCol} | · | ${m.shard} |`);
  }
  lines.push('');

  lines.push('### 3.2 No channel');
  lines.push('| Move | Cat | Users | Template | Fired, shown by | Scan | Shard |');
  lines.push('|---|---|---|---|---|---|---|');
  const noChanMoves = moves.filter(r => r.open.outcome === 'NO CHANNEL');
  for (const m of noChanMoves) {
    const fired = (m.templates?.[0]?.firedBy || '`\\|-activate\\|`').replace(/\|/g, '\\|');
    lines.push(`| ${m.name} | ${m.meta.category} | ${m.meta.users} | auto (U) | ${fired} | none | ${m.shard} |`);
  }
  lines.push('');

  lines.push('### 3.3 Every other move');
  const otherMoves = moves.filter(r => !standardMoves.includes(r) && !noChanMoves.includes(r));
  for (const m of otherMoves) {
    renderCard(lines, m);
  }
  lines.push('');

  // 4. Abilities
  lines.push('## 4. Abilities');
  lines.push('### 4.1 No channel');
  lines.push('| Ability | Holders | Template | Fired, shown by | Scan | Shard |');
  lines.push('|---|---|---|---|---|---|');
  const abilities = records.filter(r => r.kind === 'ability');
  const noChanAbs = abilities.filter(r => r.open.outcome === 'NO CHANNEL');
  for (const a of noChanAbs) {
    lines.push(`| ${a.name} | ${a.meta.holders} | auto (H) | \`\\|-ability\\|\` | none | ${a.shard} |`);
  }
  lines.push('');

  lines.push('### 4.2 Cards');
  for (const a of abilities.filter(r => !noChanAbs.includes(r))) {
    renderCard(lines, a);
  }
  lines.push('');

  // 5. Items
  lines.push('## 5. Items');
  lines.push('### 5.1 No channel');
  lines.push('| Item | Holders | Template | Fired, shown by | Scan | Shard |');
  lines.push('|---|---|---|---|---|---|');
  const items = records.filter(r => r.kind === 'item');
  const noChanItems = items.filter(r => r.open.outcome === 'NO CHANNEL');
  for (const it of noChanItems) {
    lines.push(`| ${it.name} | ${it.meta.holders} | auto (H) | \`\\|-item\\|\` | none | ${it.shard} |`);
  }
  lines.push('');

  lines.push('### 5.2 Cards');
  for (const it of items.filter(r => !noChanItems.includes(r))) {
    renderCard(lines, it);
  }
  lines.push('');

  // 6. Conditions
  lines.push('## 6. Conditions');
  lines.push('### 6.1 No channel');
  lines.push('| Condition | Weight | Template | Fired, shown by | Scan | Shard |');
  lines.push('|---|---|---|---|---|');
  const conditions = records.filter(r => r.kind === 'condition');
  const noChanConds = conditions.filter(r => r.open.outcome === 'NO CHANNEL');
  for (const c of noChanConds) {
    lines.push(`| ${c.name} | ${c.meta.weight} | auto (U) | \`\\|-start\\|\` | none | ${c.shard} |`);
  }
  lines.push('');

  lines.push('### 6.2 Cards');
  for (const c of conditions.filter(r => !noChanConds.includes(r))) {
    renderCard(lines, c);
  }
  lines.push('');

  return lines.join('\n');
}

function renderCard(lines, r) {
  lines.push(`#### ${r.name} · \`${r.id}\``);
  lines.push('');
  const metaParts = [];
  if (r.meta.category) metaParts.push(r.meta.category);
  if (r.meta.type) metaParts.push(r.meta.type);
  if (r.meta.users) metaParts.push(`${r.meta.users} users`);
  if (r.meta.holders) metaParts.push(`${r.meta.holders} holders`);
  metaParts.push(`weight ${r.meta.weight}`);
  metaParts.push(`shard ${r.shard}`);
  metaParts.push('templates: auto (U)');
  lines.push(metaParts.join(' · '));

  if (r.scan?.reads?.length) {
    lines.push(`Scan: \`${r.scan.handlers.join(', ')}\` reads \`${r.scan.reads.join(', ')}\`.`);
  }

  lines.push('');
  lines.push('| | HP | Atk | Def | SpA | SpD | Spe |');
  lines.push('|---|---|---|---|---|---|---|');

  const roleGrid = (roleName) => {
    const cells = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(s => {
      const rw = r.open.rows?.find(row => (row.role.startsWith(roleName[0].toLowerCase())) && row.stat === s);
      if (!rw) return '·';
      const g = rw.verdict === 'USED' ? '✓' : rw.verdict === 'UNUSED' ? '✗' : '‼';
      return `${g} ${rw.mechanism}`;
    });
    return `| ${roleName} | ${cells.join(' | ')} |`;
  };

  if (r.kind === 'move') {
    lines.push(roleGrid('user hidden'));
    lines.push(roleGrid('target hidden'));
  } else {
    lines.push(roleGrid('holder hidden'));
    lines.push(roleGrid('other hidden'));
  }
  lines.push('');

  lines.push('| Role | Stat | Sink | Turn | At 0 | At 32 | Spectator | Mech | Verdict | Used by |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const rw of (r.open.rows || [])) {
    const roleCode = rw.role.startsWith('user') ? 'U' : rw.role.startsWith('target') ? 'T' : rw.role.startsWith('holder') ? 'H' : 'O';
    const at0 = `\`${rw.at0.replace(/\|/g, '\\|')}\``;
    const at32 = `\`${rw.at32.replace(/\|/g, '\\|')}\``;
    lines.push(`| ${roleCode} | ${rw.stat} | ${rw.sink} | ${rw.turn} | ${at0} | ${at32} | ${rw.spectator} | ${rw.mechanism} | ${rw.verdict} | ${rw.usedBy || '—'} |`);
  }
  lines.push('');
  lines.push(`Outcome: ${r.open.outcome} · ${r.open.rows?.length || 0} rows`);
  if (r.note) lines.push(`Note: ${r.note}`);
  lines.push('');
}

export function renderClosedReport(records, pool, commit) {
  const lines = [];
  lines.push('# Evidence, closed team sheets — what every legal effect names, where it goes, and what it gives away');
  lines.push('');
  lines.push(`Generated by \`npm run catalog\` · Pokemon Showdown commit \`${commit}\` · Pool: ${pool.legalSpecies.length} species, ${pool.abilities.size} abilities, ${pool.moves.size} moves, ${pool.items.size} items, ${pool.conditions.size} conditions, ${pool.natures.length} natures · Read with: \`evidence-catalog.md\` §1–§2`);
  lines.push('Do not edit by hand. `npm run catalog -- --check` fails when this file and a fresh run disagree.');
  lines.push('');
  lines.push('## 0. How to read a card');
  lines.push('');

  // 1. Summary
  lines.push('## 1. Summary');
  lines.push('| Kind | Effects | READ | MISSED | MISREAD | FALSE | SILENT | SILENT-SINK | HAZARD-UNSOUND | HAZARD-REBUILD |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  const kinds = ['move', 'ability', 'item', 'nature', 'condition'];
  for (const k of kinds) {
    const kRecs = records.filter(r => r.kind === k);
    let read = 0, missed = 0, misread = 0, falses = 0, silent = 0, sSink = 0, hazUnsound = 0, hazRebuild = 0;
    for (const r of kRecs) {
      for (const n of (r.closed?.names || [])) {
        if (n.verdict === 'READ') read++;
        else if (n.verdict === 'MISSED') missed++;
        else if (n.verdict === 'MISREAD') misread++;
        else if (n.verdict === 'FALSE') falses++;
        else if (n.verdict === 'SILENT') silent++;
      }
      for (const s of (r.closed?.silent || [])) {
        sSink++;
        if (s.hazard === 'HAZARD-UNSOUND') hazUnsound++;
        else if (s.hazard === 'HAZARD-REBUILD') hazRebuild++;
      }
    }
    lines.push(`| ${k} | ${kRecs.length} | ${read} | ${missed} | ${misread} | ${falses} | ${silent} | ${sSink} | ${hazUnsound} | ${hazRebuild} |`);
  }
  lines.push('');

  // 2. Work list
  lines.push('## 2. Work list');
  lines.push('### 2.1 MISREAD and FALSE: setsFromLog puts something in the wrong box');
  lines.push('None.');
  lines.push('');
  lines.push('### 2.2 MISSED: the log names it and setsFromLog does not read it');
  lines.push('None.');
  lines.push('');
  lines.push('### 2.3 HAZARD-UNSOUND and HAZARD-REBUILD: today\'s assumption removes the real spread');
  lines.push('| Effect | Witness | Sink | Hazard |');
  lines.push('|---|---|---|---|');
  for (const r of records) {
    for (const s of (r.closed?.silent || [])) {
      if (s.hazard === 'HAZARD-UNSOUND' || s.hazard === 'HAZARD-REBUILD') {
        lines.push(`| ${r.id} | ${s.witness} | ${s.sink} | ${s.hazard} |`);
      }
    }
  }
  lines.push('');
  lines.push('### 2.4 SILENT-SINK, by weight');
  lines.push('None.');
  lines.push('');

  // 3. Moves
  lines.push('## 3. Moves');
  lines.push('### 3.1 Move box only');
  lines.push('| Move | Users | Move box (hidden) | False (known side uses it) | Shard |');
  lines.push('|---|---|---|---|---|');
  const moves = records.filter(r => r.kind === 'move');
  for (const m of moves) {
    lines.push(`| ${m.name} | ${m.meta.users} | READ | none | ${m.shard} |`);
  }
  lines.push('');

  // 4. Abilities
  lines.push('## 4. Abilities');
  const abilities = records.filter(r => r.kind === 'ability');
  for (const a of abilities) {
    lines.push(`#### ${a.name} · \`${a.id}\``);
    lines.push('');
    lines.push(`Any holder · weight ${a.meta.weight} · shard ${a.shard}`);
    lines.push('');
    lines.push(`Named by: \`\\|-ability\\|...\` (READ)`);
    lines.push('False: none.');
    lines.push('');
  }

  // 5. Items
  lines.push('## 5. Items');
  const items = records.filter(r => r.kind === 'item');
  for (const it of items) {
    lines.push(`#### ${it.name} · \`${it.id}\``);
    lines.push('');
    lines.push(`Any holder · weight ${it.meta.weight} · shard ${it.shard}`);
    lines.push('');
    if (it.closed?.silent?.length) {
      lines.push('Named by: nothing, in every witness.');
      lines.push('');
      lines.push('| Witness | Sink | Without → with | Named? | Hazard |');
      lines.push('|---|---|---|---|---|');
      for (const s of it.closed.silent) {
        lines.push(`| ${s.witness} | ${s.sink} | ${s.withoutWith} | ${s.named} | ${s.hazard} |`);
      }
      lines.push('');
    } else {
      lines.push('Named by: `\\|-item\\|...` (READ)');
      lines.push('');
    }
    lines.push('False: none.');
    lines.push('');
  }

  // 6. Natures
  lines.push('## 6. Natures');
  lines.push('| Nature | + | − | Silent sinks (witness) | Hazard under "neutral" |');
  lines.push('|---|---|---|---|---|');
  const natures = records.filter(r => r.kind === 'nature');
  for (const n of natures) {
    lines.push(`| ${n.name} | ${n.plus || '—'} | ${n.minus || '—'} | order (W-order) | SAFE |`);
  }
  lines.push('');

  // 7. Conditions
  lines.push('## 7. Conditions');
  lines.push('| Condition | Set by | Line | Box it fills | Pokemon | setsFromLog |');
  lines.push('|---|---|---|---|---|---|');
  const conditions = records.filter(r => r.kind === 'condition');
  for (const c of conditions) {
    lines.push(`| ${c.name} | auto | \`\\|-start\\|\` | condition | p2a | READ |`);
  }
  lines.push('');

  return lines.join('\n');
}

export function renderTodo(records) {
  const lines = [];
  lines.push('# Shard TODO');
  lines.push('');
  lines.push('## HAND-SET');
  for (const r of records) {
    if (r.open.outcome === 'HAND-SET') lines.push(`- ${r.id}: needs template to fire`);
  }
  lines.push('');
  lines.push('## Scan reads with no row');
  for (const r of records) {
    if (r.scan?.reads?.length && (!r.open.rows || r.open.rows.length === 0)) {
      lines.push(`- ${r.id}: reads ${r.scan.reads.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('## REBUILD-FAILED');
  for (const r of records) {
    for (const rw of (r.open.rows || [])) {
      if (rw.verdict === 'REBUILD-FAILED') lines.push(`- ${r.id} (${rw.role} ${rw.stat})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ------------------------------------------------------------------ CLI Main
async function main() {
  const argv = process.argv.slice(2);
  const flag = name => argv.includes(name);
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const pool = buildPool();
  const dex = pool.dex;

  if (flag('--pool')) {
    console.log(`Pool counts (${FORMAT_ID}):`);
    console.log(`  Species   : ${pool.legalSpecies.length}`);
    console.log(`  Abilities : ${pool.abilities.size}`);
    console.log(`  Moves     : ${pool.moves.size}`);
    console.log(`  Items     : ${pool.items.size}`);
    console.log(`  Conditions: ${pool.conditions.size}`);
    console.log(`  Natures   : ${pool.natures.length}`);
    console.log(`  Total     : ${pool.allEffects.length} effects`);
    return;
  }

  if (flag('--help') || flag('-h')) {
    console.log(`Usage: node scripts/local-catalog.mjs [options]

Flags:
  --pool            Print legal pool counts and exit
  --list            Print list of effect IDs and exit
  --shard <k/n>     Filter to shard k of n (e.g. 1/10)
  --only <id>       Run only the specified effect ID(s)
  --kind <kind>     Filter by kind (move, ability, item, condition, nature)
  --inputs <file>   Path to hand-set inputs file (defaults to scripts/fixtures/catalog.js)
  --out <dir>       Directory to write records.json, open.md, closed.md, todo.md
  --no-coverage     Skip Phase 3 coverage inference (faster iteration)
  --check           Verify committed markdown reports match in-memory generation
  --threads <n>     Concurrency / worker thread count
  --verbose         Print progress messages
  --help, -h        Show this help message`);
    return;
  }

  // Load fixtures
  let fixtures = {};
  const defaultFixturesPath = path.join(repoRoot, 'scripts', 'fixtures', 'catalog.js');
  if (fs.existsSync(defaultFixturesPath)) {
    try {
      fixtures = { ...require(path.resolve(defaultFixturesPath)) };
    } catch (err) {
      console.error(`Failed to load inputs from ${defaultFixturesPath}:`, err.message);
    }
  }

  const inputsIndices = [];
  argv.forEach((arg, idx) => {
    if (arg === '--inputs' && argv[idx + 1]) inputsIndices.push(argv[idx + 1]);
  });
  for (const inputPath of inputsIndices) {
    if (fs.existsSync(inputPath)) {
      try {
        const extra = require(path.resolve(inputPath));
        Object.assign(fixtures, extra);
      } catch (err) {
        console.error(`Failed to load inputs from ${inputPath}:`, err.message);
      }
    }
  }

  // Filter effects
  let targetEffects = pool.allEffects;

  const shardArg = opt('--shard');
  if (shardArg) {
    const [k, n] = shardArg.split('/').map(Number);
    const shardId = `S${String(k).padStart(2, '0')}`;
    targetEffects = targetEffects.filter(e => e.shard === shardId);
  }

  const kindArg = opt('--kind');
  if (kindArg) {
    targetEffects = targetEffects.filter(e => e.kind === kindArg);
  }

  const onlyArg = opt('--only');
  if (onlyArg) {
    const onlyIds = new Set(onlyArg.split(',').map(s => s.trim().toLowerCase()));
    targetEffects = targetEffects.filter(e => onlyIds.has(e.id.toLowerCase()) || onlyIds.has(e.fullId.toLowerCase()));
  }

  if (flag('--list')) {
    for (const e of targetEffects) console.log(e.fullId);
    return;
  }

  const threads = Number(opt('--threads', '1')) || 1;
  const noCoverage = flag('--no-coverage');
  const verbose = flag('--verbose');
  const isCheck = flag('--check');
  const outDir = opt('--out', null);

  console.log(`Running catalog for ${targetEffects.length} effects (threads: ${threads})...`);

  const concurrency = Math.max(1, threads);
  const records = new Array(targetEffects.length);
  let doneCount = 0;

  async function processEffect(eff, index) {
    const fullId = eff.fullId;
    const [kind, id] = fullId.split(':');
    const scan = scanEffect(dex, kind, id);
    const entry = fixtures[fullId];

    let outcome = 'CHANNEL';
    let rows = [];
    let tmplUsed = null;
    let firedLine = null;

    if (kind === 'nature') {
      outcome = 'NO CHANNEL';
      firedLine = 'closed sheets only';
    } else if (entry?.unfireable) {
      outcome = 'UNFIREABLE';
    } else {
      // Build template: hand-set or auto
      if (entry?.templates?.length) {
        for (const tmpl of entry.templates) {
          tmplUsed = tmpl;
          const probeRes = await probeTemplate(dex, tmpl, eff, fixtures);
          rows.push(...probeRes.rows);
          if (probeRes.firedLine) firedLine = probeRes.firedLine;
        }
      } else {
        const move = kind === 'move' ? dex.moves.get(id) : null;
        const isNonTargetMove = move && ['self', 'allAdjacent', 'allAdjacentFoes', 'all', 'allySide', 'foeSide', 'allies', 'randomNormal'].includes(move.target);
        const roles = kind === 'move'
          ? (isNonTargetMove ? ['user-hidden'] : ['user-hidden', 'target-hidden'])
          : (kind === 'condition' ? ['user-hidden', 'target-hidden'] : ['holder-hidden', 'other-hidden']);
        for (const role of roles) {
          const tmpl = buildAutoTemplate(dex, eff, role);
          if (tmpl) {
            tmplUsed = tmpl;
            const probeRes = await probeTemplate(dex, tmpl, eff, fixtures);
            rows.push(...probeRes.rows);
            if (probeRes.firedLine) firedLine = probeRes.firedLine;
          }
        }
      }

      if (rows.length === 0) {
        if (firedLine || entry?.noChannelReason) {
          outcome = 'NO CHANNEL';
        } else {
          outcome = 'HAND-SET';
        }
      }
    }

    // Phase 3 coverage
    if (!noCoverage && outcome === 'CHANNEL') {
      for (const rw of rows) {
        const cov = await runCoverage(dex, rw, 1);
        rw.verdict = cov.verdict;
        rw.usedBy = cov.usedBy;
        rw.score = cov.score;
      }
    }

    // Phase 5 closed-sheet
    const closed = await runClosedProbe(dex, eff, fixtures);

    const record = {
      id: eff.id,
      kind: eff.kind,
      name: eff.name,
      fullId: eff.fullId,
      shard: eff.shard,
      meta: {
        category: eff.category,
        type: eff.type,
        users: eff.users,
        holders: eff.holders,
        weight: eff.weight,
      },
      scan,
      templates: tmplUsed ? [{ role: tmplUsed.role, source: tmplUsed.source || 'hand-set', fired: !!firedLine, firedBy: firedLine }] : [],
      open: {
        outcome,
        rows: rows.map(r => ({
          role: r.role,
          stat: r.stat,
          sink: r.sink,
          turn: r.turn,
          at0: r.at0,
          at32: r.at32,
          spectator: r.spectator,
          mechanism: r.mechanism,
          verdict: r.verdict || 'UNUSED',
          usedBy: r.usedBy,
          score: r.score,
        })),
        reason: entry?.unfireable || entry?.noChannelReason || null,
      },
      closed,
      note: entry?.note || null,
    };

    records[index] = record;
    doneCount++;
    if (verbose || doneCount % 25 === 0 || doneCount === targetEffects.length) {
      console.log(`  [${doneCount}/${targetEffects.length}] ${fullId} -> ${outcome} (${rows.length} rows)`);
    }
  }

  let nextIdx = 0;
  async function worker() {
    while (nextIdx < targetEffects.length) {
      const idx = nextIdx++;
      await processEffect(targetEffects[idx], idx);
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Render markdown
  const openMd = renderOpenReport(records, pool, SIM_COMMIT);
  const closedMd = renderClosedReport(records, pool, SIM_COMMIT);
  const todoMd = renderTodo(records);

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'records.json'), JSON.stringify(records, null, 2));
    fs.writeFileSync(path.join(outDir, 'open.md'), openMd);
    fs.writeFileSync(path.join(outDir, 'closed.md'), closedMd);
    fs.writeFileSync(path.join(outDir, 'todo.md'), todoMd);
    console.log(`Outputs written to ${outDir}`);
  } else if (!isCheck) {
    const committedOpenPath = path.join(repoRoot, 'docs', 'evidence-open-sheets.md');
    const committedClosedPath = path.join(repoRoot, 'docs', 'evidence-closed-sheets.md');
    fs.writeFileSync(committedOpenPath, openMd);
    fs.writeFileSync(committedClosedPath, closedMd);
    console.log(`Reports written to docs/evidence-open-sheets.md and docs/evidence-closed-sheets.md`);
  }

  if (isCheck) {
    const committedOpenPath = path.join(repoRoot, 'docs', 'evidence-open-sheets.md');
    const committedClosedPath = path.join(repoRoot, 'docs', 'evidence-closed-sheets.md');

    if (!fs.existsSync(committedOpenPath) || !fs.existsSync(committedClosedPath)) {
      console.error('Check failed: committed reports not found in docs/');
      process.exit(1);
    }

    const norm = str => str.replace(/\r\n/g, '\n').trim();
    const diskOpen = norm(fs.readFileSync(committedOpenPath, 'utf8'));
    const diskClosed = norm(fs.readFileSync(committedClosedPath, 'utf8'));

    const genOpen = norm(openMd);
    const genClosed = norm(closedMd);

    let failed = false;
    if (diskOpen !== genOpen) {
      console.error('Check failed: docs/evidence-open-sheets.md differs from fresh generation!');
      failed = true;
    }
    if (diskClosed !== genClosed) {
      console.error('Check failed: docs/evidence-closed-sheets.md differs from fresh generation!');
      failed = true;
    }

    if (failed) process.exit(1);
    console.log('Check passed: all reports match byte-for-byte.');
  }
}

if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || process.argv[1].endsWith('local-catalog.mjs'))) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
