'use strict';

/**
 * The fixed cast, the witness moves and the hand-set battles of `npm run catalog`
 * (scripts/local-catalog.mjs, docs/evidence-catalog.md).
 *
 * Every auto template is built from what is here, so every run builds the same
 * battles. p1 is the known side and p2 the hidden one; the hidden Pokemon whose
 * Stat Points a probe varies always stands in p2a.
 *
 * Speed. No two of the cast tie, and every one of them is slower than 56, the
 * lowest Speed a Pokemon of base Speed 36 can have. The command prefers hidden
 * Pokemon of at least that base, so the order of a turn does not depend on the
 * hidden Pokemon's Speed unless the effect makes it.
 *
 * Items. Each of the cast holds a rock or the like, which only lengthens a
 * condition its holder sets and so changes nothing in a probe of four turns. A
 * move that takes, swaps, burns or names an item then has one to act on.
 *
 * Abilities. The hidden ally and bench hold the first ability their species
 * lists, which is what a replay with no team sheet assumes for them
 * (`setsFromLog`), so a closed-sheet rebuild assumes them right.
 */

const spread = (evs = {}) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...evs });
const member = (species, gender, ability, item, evs) => ({
  name: species, species, gender, ability, item, nature: 'Serious', level: 50, evs: spread(evs),
});

const cast = {
  // p1a in every auto template: bulky, slow, and its ability does nothing
  // without a Berry to eat. Speed 50.
  known: member('Snorlax', 'M', 'Gluttony', 'Heat Rock', { hp: 20, atk: 20, def: 10, spd: 16 }),
  // p1a instead, when Snorlax is immune to the move being probed (Ghost). Speed 50.
  knownAlt: member('Slowbro', 'M', 'Oblivious', 'Heat Rock', { hp: 20, def: 20, spd: 26 }),
  // p1b. Speed 40.
  knownAlly: member('Torkoal', 'M', 'Shell Armor', 'Damp Rock', { hp: 32, def: 32 }),
  // p1c, sent in only when something forces p1a out. Speed 55.
  knownBench: member('Mudsdale', 'M', 'Own Tempo', 'Light Clay', { hp: 32, def: 32 }),
  // p2a when the probe needs a hidden Pokemon that is not a move's learner or an
  // ability's holder: a Water type, so no move type is barred from it. Speed 98-130.
  hidden: member('Blastoise', 'F', 'Torrent', 'Smooth Rock', {}),
  // p2b. Speed 49.
  hiddenAlly: member('Avalugg', 'F', 'Own Tempo', 'Icy Rock', { hp: 32, def: 32, spe: 1 }),
  // p2c. Speed 53.
  hiddenBench: member('Slowking', 'F', 'Oblivious', 'Terrain Extender', { hp: 32, spd: 30, spe: 3 }),
  // p2b or p2c instead, when the hidden Pokemon is of the same species as one
  // of them - Slowking-Galar, whose name the log prints as Slowking. Speed 55.
  hiddenSpare: member('Mudsdale', 'F', 'Own Tempo', 'Light Clay', { hp: 32, def: 32 }),
};

/**
 * Known Pokemon for the order witnesses, which need one within a point of the
 * hidden Pokemon's Speed. The command takes the first whose Speed range covers
 * the Speed it wants, and sets its Speed Stat Points to hit it; with those, each
 * still spends at most 66.
 */
const pacers = [
  member('Shuckle', 'M', 'Sturdy', 'Heat Rock', { hp: 18, def: 16 }),
  member('Snorlax', 'M', 'Gluttony', 'Heat Rock', { hp: 18, def: 16 }),
  member('Ampharos', 'M', 'Plus', 'Heat Rock', { hp: 18, def: 16 }),
  member('Goodra', 'M', 'Hydration', 'Heat Rock', { hp: 18, def: 16 }),
  member('Arcanine', 'M', 'Justified', 'Heat Rock', { hp: 18, def: 16 }),
  member('Garchomp', 'M', 'Sand Veil', 'Heat Rock', { hp: 18, def: 16 }),
  member('Crobat', 'M', 'Inner Focus', 'Heat Rock', { hp: 18, def: 16 }),
  member('Ninjask', 'M', 'Infiltrator', 'Heat Rock', { hp: 18, def: 16 }),
  { ...member('Deoxys-Speed', '', 'Pressure', 'Heat Rock', { hp: 18, def: 16 }), name: 'Deoxys' },
  member('Regieleki', '', 'Transistor', 'Heat Rock', { hp: 18, def: 16 }),
  { ...member('Regieleki', '', 'Transistor', 'Heat Rock', { hp: 18, def: 16 }), nature: 'Timid' },
];

/**
 * Hits used as witnesses, one physical and one special per type, none with a
 * secondary effect or with every secondary switched off by the dice.
 */
const hits = {
  Normal: ['Strength', 'Round'],
  Fire: ['Fire Punch', 'Flamethrower'],
  Water: ['Waterfall', 'Hydro Pump'],
  Electric: ['Thunder Punch', 'Thunderbolt'],
  Grass: ['Leaf Blade', 'Energy Ball'],
  Ice: ['Ice Punch', 'Ice Beam'],
  Fighting: ['Brick Break', 'Aura Sphere'],
  Poison: ['Poison Jab', 'Sludge Bomb'],
  Ground: ['High Horsepower', 'Earth Power'],
  Flying: ['Drill Peck', 'Air Slash'],
  Psychic: ['Zen Headbutt', 'Psychic'],
  Bug: ['X-Scissor', 'Bug Buzz'],
  Rock: ['Stone Edge', 'Power Gem'],
  Ghost: ['Shadow Claw', 'Shadow Ball'],
  Dragon: ['Dragon Claw', 'Dragon Pulse'],
  Dark: ['Crunch', 'Dark Pulse'],
  Steel: ['Iron Head', 'Flash Cannon'],
  Fairy: ['Play Rough', 'Moonblast'],
};

const witnessMoves = {
  // The default witness hits, in order of preference: the first the target is
  // not immune to by type.
  physical: ['Strength', 'Dragon Claw', 'Waterfall'],
  special: ['Round', 'Dragon Pulse', 'Hydro Pump'],
  // A hit that lands before a priority-0 move, for a move that answers damage
  // taken this turn.
  priorityPhysical: 'Quick Attack',
  prioritySpecial: 'Vacuum Wave',
  // Halves what it hits whatever the Stat Points, so it wears a Pokemon down
  // without saying anything about them: the first its target is not immune to.
  halving: ['Super Fang', "Nature's Madness"],
  status: {
    burn: 'Will-O-Wisp', paralysis: 'Thunder Wave', toxic: 'Toxic', sleep: 'Hypnosis', confusion: 'Confuse Ray', taunt: 'Taunt',
  },
  // A hit that knocks out whatever it lands on: the first the target is not
  // immune to.
  lethal: ['Guillotine', 'Sheer Cold', 'Fissure'],
};

/**
 * Abilities that seldom act in these battles unless the probe is about them -
 * no weather, no terrain, no Berry, no ally to protect - in order of
 * preference. A move's hidden user holds the first of these its species has,
 * or else Run Away, which no species needs to have for the simulator to run it:
 * an ability that acts (Intimidate, Static, Refrigerate) would put its own
 * changes, and its own gaps, on the move's card. An item's or a nature's hidden
 * holder is picked among species whose first ability is one of these, because
 * that is the one a replay with no team sheet assumes. Some still stop a
 * witness - Own Tempo the confusion one, Insomnia the sleep one - in the
 * effect's battle and its control alike, so they can hide a change but never
 * make one. An ability's control holds Run Away instead (`baselineAbility`).
 */
const quietAbilities = [
  'Run Away', 'Honey Gather', 'Ball Fetch', 'Keen Eye', 'Illuminate', 'Inner Focus', 'Shell Armor', 'Battle Armor',
  'Gluttony', 'Sturdy', 'Rock Head', 'Torrent', 'Blaze', 'Overgrow', 'Swarm', 'Sniper', 'Super Luck', 'Steadfast',
  'Big Pecks', 'Hyper Cutter', 'Own Tempo', 'Oblivious', 'Early Bird', 'Tangled Feet', 'Suction Cups', 'Sticky Hold',
  'Leaf Guard', 'Insomnia', 'Vital Spirit', 'Limber', 'Immunity', 'Water Veil', 'Magma Armor', 'Klutz',
  'Telepathy', 'Plus', 'Minus', 'Sand Veil', 'Snow Cloak', 'Swift Swim', 'Chlorophyll', 'Sand Rush', 'Slush Rush',
  'Solar Power', 'Rain Dish', 'Ice Body', 'Hydration', 'Flower Veil', 'Sweet Veil', 'Aroma Veil', 'Pastel Veil',
  'Friend Guard', 'Overcoat', 'Soundproof', 'Bulletproof', 'Clear Body', 'White Smoke', 'Pressure', 'Anticipation',
  'Forewarn', 'Unnerve', 'Levitate',
];

/**
 * Hand-set entries, keyed by effect id. An effect with no entry gets the auto
 * templates only. Each field is optional:
 *
 *   templates  battles added to the auto templates, in the shape below
 *   unfireable why no battle in this format can make the effect act, citing
 *              node_modules/pokemon-showdown file:line
 *   mechanism  { stat: 'M1'..'M9' } overriding the rule for that stat
 *   note       shown on the effect's card as written
 *
 * A template names its role, both teams (a cast key or a set; p2[0] is the
 * hidden Pokemon, whose Stat Points the probe sets), each turn's choices, and
 * `control`: the same battle with the effect taken out, as a patch of the teams
 * and, where the effect is a choice, of the turns. `why` is quoted on the card.
 */
const QUIET = { p1: 'move splash, move splash', p2: 'move splash, move splash' };
const withMoves = (key, moves) => ({ ...cast[key], evs: { ...cast[key].evs }, moves });
const set = (species, gender, ability, item, evs, moves) => ({ ...member(species, gender, ability, item, evs), moves });

/**
 * A race under a condition: the known lead sets it, the hidden Pokemon and a
 * known Pokemon fast enough to fall between its Speed at 0 and at 32 Stat
 * Points under it all Splash, and the control is the same race without the
 * ability.
 */
const race = (setter, holder, pacer, why) => ({
  templates: [{
    name: 'race-under-it',
    role: 'holder-hidden',
    p1: [setter, pacer, 'knownBench'],
    p2: [holder, 'hiddenAlly', 'hiddenBench'],
    turns: [QUIET, QUIET, QUIET],
    control: { p2: [{ ability: 'Run Away' }] },
    why,
  }],
});

const entries = {
  'ability:swiftswim': race(
    set('Pelipper', 'M', 'Drizzle', 'Heat Rock', {}, ['Splash']),
    set('Basculegion', 'M', 'Swift Swim', 'Smooth Rock', {}, ['Splash']),
    set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 10 }, ['Splash']),
    'Rain doubles the holder\'s Speed, 196 to 260, around a known 230: who moves first depends on its Speed Stat Points.',
  ),
  'ability:chlorophyll': race(
    set('Torkoal', 'M', 'Drought', 'Heat Rock', { hp: 32, def: 32 }, ['Splash']),
    set('Leafeon', 'F', 'Chlorophyll', 'Smooth Rock', {}, ['Splash']),
    set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 32 }, ['Splash']),
    'Sun doubles the holder\'s Speed, 230 to 294, around a known 252.',
  ),
  'ability:sandrush': race(
    set('Tyranitar', 'M', 'Sand Stream', 'Heat Rock', {}, ['Splash']),
    set('Excadrill', 'M', 'Sand Rush', 'Smooth Rock', {}, ['Splash']),
    set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 20 }, ['Splash']),
    'Sand doubles the holder\'s Speed, 216 to 280, around a known 240.',
  ),
  'ability:slushrush': race(
    set('Abomasnow', 'M', 'Snow Warning', 'Heat Rock', {}, ['Splash']),
    set('Beartic', 'M', 'Slush Rush', 'Smooth Rock', {}, ['Splash']),
    set('Crobat', 'M', 'Inner Focus', 'Heat Rock', { spe: 20 }, ['Splash']),
    'Snow doubles the holder\'s Speed, 140 to 204, around a known 170.',
  ),
  'ability:quickfeet': {
    templates: [{
      name: 'race-burned',
      role: 'holder-hidden',
      p1: [set('Snorlax', 'M', 'Gluttony', 'Heat Rock', {}, ['Will-O-Wisp', 'Splash']), set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 30 }, ['Splash']), 'knownBench'],
      p2: [set('Jolteon', 'M', 'Quick Feet', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move willowisp 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: 'Burned, the holder runs at one and a half times its Speed, 225 to 273, around a known 250.',
    }],
  },
  'move:speedswap': {
    templates: [{
      name: 'swapped-race',
      role: 'user-hidden',
      p1: ['known', set('Arcanine', 'M', 'Justified', 'Heat Rock', {}, ['Splash']), 'knownBench'],
      p2: [withMoves('hidden', ['Speed Swap', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move speedswap 1, move splash' }, QUIET, QUIET],
      control: { turns: [QUIET, QUIET, QUIET] },
      why: 'Speed Swap hands Snorlax the hidden Pokemon\'s Speed, 98 to 130, and Snorlax then races a known 115: the known side\'s order carries the hidden Speed.',
    }],
  },
  'move:healpulse': {
    templates: [{
      name: 'healed-from-a-quarter',
      role: 'target-hidden',
      p1: [withMoves('known', ['Super Fang', 'Heal Pulse', 'Splash']), 'knownAlly', 'knownBench'],
      p2: ['hidden', 'hiddenAlly', 'hiddenBench'],
      turns: [
        { p1: 'move superfang 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move superfang 1, move splash', p2: 'move splash, move splash' },
        { p1: 'move healpulse 1, move splash', p2: 'move splash, move splash' },
      ],
      control: { turns: [{ p1: 'move superfang 1, move splash', p2: 'move splash, move splash' }, { p1: 'move superfang 1, move splash', p2: 'move splash, move splash' }, QUIET] },
      why: 'Twice halved, so the heal is not capped, the hidden Pokemon is healed by half its max HP: a share of max HP, which a percentage shows the same whatever the max.',
    }],
  },
  'move:sleeptalk': {
    templates: [{
      name: 'talks-in-its-sleep',
      role: 'user-hidden',
      p1: [withMoves('known', ['Hypnosis', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Sleep Talk', 'Strength']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move hypnosis 1, move splash', p2: 'move strength 1, move splash' }, { p1: 'move splash, move splash', p2: 'move sleeptalk, move splash' }, QUIET],
      control: { p2: [{ moves: ['Strength', 'Splash'] }], turns: [{ p1: 'move hypnosis 1, move splash', p2: 'move strength 1, move splash' }, QUIET, QUIET] },
      why: 'Put to sleep, the hidden Pokemon calls its other move through Sleep Talk, which hits like the move itself.',
    }],
  },
  'move:steelroller': {
    templates: [{
      name: 'rolls-the-terrain',
      role: 'user-hidden',
      p1: [withMoves('known', ['Electric Terrain', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Steel Roller', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move electricterrain, move splash', p2: 'move splash, move splash' }, { p1: 'move splash, move splash', p2: 'move steelroller 1, move splash' }, QUIET],
      control: { turns: [{ p1: 'move electricterrain, move splash', p2: 'move splash, move splash' }, QUIET, QUIET] },
      why: 'Steel Roller only works on a terrain, which the known lead sets first.',
    }],
  },
  'ability:liquidooze': {
    templates: [{
      name: 'drained',
      role: 'holder-hidden',
      p1: [withMoves('known', ['Giga Drain', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Swalot', 'M', 'Liquid Ooze', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move gigadrain 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: 'Liquid Ooze turns the drain into damage to the known drainer, whose exact HP then shows how much the hit dealt.',
    }, {
      name: 'seeded',
      role: 'holder-hidden',
      p1: [withMoves('known', ['Leech Seed', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Swalot', 'M', 'Liquid Ooze', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move leechseed 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: 'The known seeder takes, as damage, the eighth of the holder\'s max HP it would have healed.',
    }, {
      name: 'sapped',
      role: 'holder-hidden',
      p1: [withMoves('known', ['Strength Sap', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Swalot', 'M', 'Liquid Ooze', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move strengthsap 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: 'The known user takes, as damage, the holder\'s Attack it would have healed.',
    }],
  },
  'item:bindingband': {
    templates: [{
      name: 'bound',
      role: 'other-hidden',
      p1: [{ ...withMoves('known', ['Fire Spin', 'Splash']), item: 'Binding Band' }, 'knownAlly', 'knownBench'],
      p2: ['hidden', 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move firespin 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p1: [{ item: 'Heat Rock' }] },
      why: 'Bound, the hidden Pokemon loses a sixth of its max HP each turn instead of an eighth.',
    }],
  },
  'item:expertbelt': {
    templates: [{
      name: 'super-effective',
      role: 'holder-hidden',
      p1: ['known', 'knownAlly', 'knownBench'],
      p2: [{ ...withMoves('hidden', ['Brick Break', 'Splash']), item: 'Expert Belt' }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move brickbreak 1, move splash' }, QUIET, QUIET],
      control: { p2: [{ item: '' }] },
      why: 'A super-effective hit lands a fifth harder with Expert Belt.',
    }],
  },
  'item:bigroot': {
    templates: [{
      name: 'drains',
      role: 'holder-hidden',
      p1: [withMoves('known', ['Super Fang', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [{ ...withMoves('hidden', ['Giga Drain', 'Splash']), item: 'Big Root' }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move superfang 1, move splash', p2: 'move splash, move splash' }, { p1: 'move splash, move splash', p2: 'move gigadrain 1, move splash' }, QUIET],
      control: { p2: [{ item: '' }] },
      why: 'Halved first so the heal is not capped, the hidden Pokemon drains a third more with Big Root.',
    }],
  },
  'ability:blaze': {
    templates: [{
      name: 'in-a-pinch',
      role: 'holder-hidden',
      p1: [withMoves('known', ['Super Fang', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Charizard', 'M', 'Blaze', 'Smooth Rock', {}, ['Flamethrower', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move superfang 1, move splash', p2: 'move splash, move splash' }, { p1: 'move superfang 1, move splash', p2: 'move splash, move splash' }, { p1: 'move splash, move splash', p2: 'move flamethrower 1, move splash' }],
      control: { p2: [{ ability: 'Run Away' }] },
      why: 'Twice halved, the holder is below a third of its HP and its Fire move lands half again as hard.',
    }],
  },
  'ability:solarpower': {
    templates: [{
      name: 'in-the-sun',
      role: 'holder-hidden',
      p1: [set('Torkoal', 'M', 'Drought', 'Heat Rock', { hp: 32, def: 32 }, ['Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Charizard', 'M', 'Solar Power', 'Smooth Rock', {}, ['Flamethrower', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move flamethrower 1, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: 'In the sun the holder\'s Special Attack is half again higher, and it loses an eighth of its max HP each turn.',
    }],
  },
  'move:strengthsap': {
    templates: [{
      name: 'known-user-hurt',
      role: 'target-hidden',
      p1: [withMoves('known', ['Strength Sap', 'Splash']), withMoves('knownAlly', ['Super Fang', 'Splash']), 'knownBench'],
      p2: ['hidden', 'hiddenAlly', 'hiddenBench'],
      turns: [
        { p1: 'move splash, move superfang -1', p2: 'move splash, move splash' },
        { p1: 'move strengthsap 1, move splash', p2: 'move splash, move splash' },
        QUIET,
      ],
      control: { turns: [{ p1: 'move splash, move superfang -1', p2: 'move splash, move splash' }, QUIET, QUIET] },
      why: 'The known user is first halved by its own ally, so the heal is not capped at full HP and equals the hidden target\'s Attack.',
    }],
  },
  'move:counter': {
    templates: [{
      name: 'known-user-hit-first',
      role: 'target-hidden',
      p1: [withMoves('known', ['Counter', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Strength', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move counter, move splash', p2: 'move strength 1, move splash' }, QUIET, QUIET],
      control: { turns: [{ p1: 'move splash, move splash', p2: 'move strength 1, move splash' }, QUIET, QUIET] },
      why: 'The known user hands back twice what its exact HP shows it took, the same whatever the hidden spread, and the hidden Pokemon\'s percentage then shows its max HP.',
    }],
  },
  'move:substitute': {
    templates: [{
      name: 'broken-at-the-edge',
      role: 'user-hidden',
      p1: [withMoves('known', ['Dragon Rage', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Substitute', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [
        { p1: 'move splash, move splash', p2: 'move substitute, move splash' },
        { p1: 'move dragonrage 1, move splash', p2: 'move splash, move splash' },
        QUIET,
      ],
      control: { turns: [QUIET, { p1: 'move dragonrage 1, move splash', p2: 'move splash, move splash' }, QUIET] },
      why: 'Dragon Rage deals 40 whatever the stats, and the Substitute holds a quarter of the hidden Pokemon\'s max HP, 38 to 46: whether it breaks depends on the HP Stat Points.',
    }],
  },
  'item:focussash': {
    templates: [{
      name: 'lethal-at-the-edge',
      role: 'holder-hidden',
      p1: [{ ...member('Garchomp', 'M', 'Sand Veil', 'Heat Rock', { hp: 2, atk: 32, def: 32 }), moves: ['Iron Tail', 'Splash'] }, 'knownAlly', 'knownBench'],
      p2: [{ ...member('Whimsicott', 'F', 'Infiltrator', 'Focus Sash', {}), moves: ['Splash'] }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move irontail 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ item: '' }] },
      why: 'A hit that knocks the holder out at some Stat Points and not at others, so whether the Sash is spent depends on them.',
    }],
  },
};

module.exports = { cast, pacers, hits, witnessMoves, quietAbilities, entries };
