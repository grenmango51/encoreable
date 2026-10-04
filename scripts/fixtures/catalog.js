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
 *   reason     why the effect cannot carry a Stat Point on an open sheet; the
 *              card prints it, and NOT SHOWN with a reason is not work
 *   mechanism  { stat: 'M1'..'M9' } overriding the rule for that stat
 *   note       shown on the effect's card as written
 *
 * A template names its role, both teams (a cast key or a set; p2[0] is the
 * hidden Pokemon, whose Stat Points the probe sets), each turn's choices, and
 * `control`: the same battle with the effect taken out, as a patch of the teams
 * and, where the effect is a choice, of the turns. `why` is quoted on the card.
 * `dice`, if given, are `>rng force` rules tried before the battle's own.
 * What the probe varies, each optional:
 *
 *   stat       the one stat to vary; every stat when left out
 *   worlds     the two values it takes, `[a, b]` with a < b, instead of 0 and
 *              32; or 'sweep', every value 0-32, each two adjacent ones the
 *              known side's view tells apart asked about as a pair (needs `stat`)
 *   probe      'p2b' to vary the hidden Pokemon's ally instead of p2a; every
 *              other hidden Stat Point stays at 2
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

/**
 * An ability that changes a hit: the hidden holder's hit on the known p1a, or
 * the known p1a's hit on the hidden holder, after the turns in `before`; the
 * control is the same battle with the holder on Run Away. `stat` is the one the
 * hit carries.
 */
const abilityHit = ({ name, stat, p1 = ['known', 'knownAlly', 'knownBench'], p2, before = [], hit, after = [], control, why }) => ({
  templates: [{
    name,
    role: 'holder-hidden',
    stat,
    p1,
    p2: p2.length === 3 ? p2 : [...p2, 'hiddenAlly', 'hiddenBench'].slice(0, 3),
    turns: [...before, hit, ...after, QUIET],
    control: control || { p2: [{ ability: 'Run Away' }] },
    why,
  }],
});
const hiddenHits = use => ({ p1: 'move splash, move splash', p2: `move ${use} 1, move splash` });
const knownHits = use => ({ p1: `move ${use} 1, move splash`, p2: 'move splash, move splash' });

const entries = {
  'ability:ironfist': abilityHit({
    name: 'punch', stat: 'atk',
    p2: [set('Conkeldurr', 'M', 'Iron Fist', 'Smooth Rock', {}, ['Mach Punch', 'Splash'])],
    hit: hiddenHits('machpunch'),
    why: "Iron Fist makes the hidden Conkeldurr's Mach Punch 1.2 times as strong, and the known Pokemon's exact HP shows its Attack.",
  }),
  'ability:sheerforce': abilityHit({
    name: 'secondary-dropped', stat: 'atk',
    p2: [set('Mawile', 'F', 'Sheer Force', 'Smooth Rock', {}, ['Iron Head', 'Splash'])],
    hit: hiddenHits('ironhead'),
    why: "Sheer Force drops Iron Head's flinch and makes it 1.3 times as strong; the known Pokemon's exact HP shows the hidden Mawile's Attack.",
  }),
  'ability:strongjaw': abilityHit({
    name: 'bite', stat: 'atk',
    p2: [set('Tyrantrum', 'M', 'Strong Jaw', 'Smooth Rock', {}, ['Crunch', 'Splash'])],
    hit: hiddenHits('crunch'),
    why: "Strong Jaw makes the hidden Tyrantrum's Crunch 1.5 times as strong; the known Pokemon's exact HP shows its Attack.",
  }),
  'ability:sharpness': abilityHit({
    name: 'slice', stat: 'atk',
    p2: [set('Gallade', 'M', 'Sharpness', 'Smooth Rock', {}, ['Psycho Cut', 'Splash'])],
    hit: hiddenHits('psychocut'),
    why: "Sharpness makes the hidden Gallade's Psycho Cut 1.5 times as strong; the known Pokemon's exact HP shows its Attack.",
  }),
  'ability:adaptability': abilityHit({
    name: 'stab', stat: 'atk',
    p2: [set('Basculegion', 'M', 'Adaptability', 'Smooth Rock', {}, ['Waterfall', 'Splash'])],
    hit: hiddenHits('waterfall'),
    why: "Adaptability makes the hidden Basculegion's same-type Waterfall twice, not 1.5 times, as strong; the known Pokemon's exact HP shows its Attack.",
  }),
  'ability:reckless': abilityHit({
    name: 'recoil-move', stat: 'atk',
    p2: [set('Staraptor', 'M', 'Reckless', 'Smooth Rock', {}, ['Brave Bird', 'Splash'])],
    hit: hiddenHits('bravebird'),
    why: "Reckless makes the hidden Staraptor's Brave Bird 1.2 times as strong; the known Pokemon's exact HP shows its Attack, and the recoil its share of that.",
  }),
  'ability:megalauncher': abilityHit({
    name: 'pulse', stat: 'spa',
    p2: [set('Clawitzer', 'M', 'Mega Launcher', 'Smooth Rock', {}, ['Dragon Pulse', 'Splash'])],
    hit: hiddenHits('dragonpulse'),
    why: "Mega Launcher makes the hidden Clawitzer's Dragon Pulse 1.5 times as strong; the known Pokemon's exact HP shows its Special Attack.",
  }),
  'ability:stakeout': abilityHit({
    name: 'fresh-target', stat: 'spa',
    p2: [set('Thievul', 'M', 'Stakeout', 'Smooth Rock', {}, ['Dark Pulse', 'Splash'])],
    hit: { p1: 'switch 3, move splash', p2: 'move darkpulse 1, move splash' },
    why: "The known Mudsdale switches in and is hit the same turn, so Stakeout doubles the hidden Thievul's Special Attack against it; its exact HP shows the hidden Special Attack.",
  }),
  'ability:contrary': abilityHit({
    name: 'leaf-storm-twice', stat: 'spa',
    p2: [set('Serperior', 'M', 'Contrary', 'Smooth Rock', {}, ['Leaf Storm', 'Splash'])],
    hit: hiddenHits('leafstorm'),
    after: [hiddenHits('leafstorm')],
    why: "Contrary turns Leaf Storm's drop into a +2, so the hidden Serperior's second Leaf Storm hits at twice its Special Attack; both exact lines show it.",
  }),
  'ability:sandforce': abilityHit({
    name: 'in-sand', stat: 'atk',
    p1: [set('Tyranitar', 'M', 'Sand Stream', 'Heat Rock', { hp: 20, def: 20 }, ['Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Excadrill', 'M', 'Sand Force', 'Smooth Rock', {}, ['Iron Head', 'Splash'])],
    hit: hiddenHits('ironhead'),
    why: "In the known Tyranitar's sand, Sand Force makes the hidden Excadrill's Iron Head 1.3 times as strong; Tyranitar's exact HP shows its Attack.",
  }),
  'ability:heavymetal': abilityHit({
    name: 'heavier-slam', stat: 'atk',
    p1: ['knownAlt', 'knownAlly', 'knownBench'],
    p2: [set('Aggron', 'M', 'Heavy Metal', 'Smooth Rock', {}, ['Heavy Slam', 'Splash'])],
    hit: hiddenHits('heavyslam'),
    why: "Heavy Metal doubles the hidden Aggron's weight, so its Heavy Slam on the known Slowbro has 120 power instead of 100; Slowbro's exact HP shows Aggron's Attack.",
  }),
  'ability:defiant': abilityHit({
    name: 'intimidated', stat: 'atk',
    p1: [set('Gyarados', 'M', 'Intimidate', 'Heat Rock', { hp: 20, def: 20 }, ['Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Kingambit', 'M', 'Defiant', 'Smooth Rock', {}, ['Iron Head', 'Splash'])],
    hit: hiddenHits('ironhead'),
    why: "The known Gyarados's Intimidate sets off Defiant, so the hidden Kingambit hits at +1 where its control hits at -1; Gyarados's exact HP shows its Attack.",
  }),
  'ability:guarddog': abilityHit({
    name: 'intimidated', stat: 'atk',
    p1: [set('Gyarados', 'M', 'Intimidate', 'Heat Rock', { hp: 20, def: 20 }, ['Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Mabosstiff', 'M', 'Guard Dog', 'Smooth Rock', {}, ['Crunch', 'Splash'])],
    hit: hiddenHits('crunch'),
    why: "Guard Dog turns the known Gyarados's Intimidate into +1 Attack for the hidden Mabosstiff; Gyarados's exact HP shows its Attack.",
  }),
  'ability:competitive': abilityHit({
    name: 'intimidated', stat: 'spa',
    p1: [set('Gyarados', 'M', 'Intimidate', 'Heat Rock', { hp: 20, def: 20 }, ['Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Milotic', 'F', 'Competitive', 'Smooth Rock', {}, ['Ice Beam', 'Splash'])],
    hit: hiddenHits('icebeam'),
    why: "The known Gyarados's Intimidate sets off Competitive, so the hidden Milotic's Ice Beam comes at +2 Special Attack; Gyarados's exact HP shows it.",
  }),
  'ability:plus': abilityHit({
    name: 'with-minus', stat: 'spa',
    p2: [set('Ampharos', 'M', 'Plus', 'Smooth Rock', {}, ['Thunderbolt', 'Splash']), set('Manectric', 'M', 'Minus', 'Icy Rock', { hp: 32, def: 32 }, ['Splash']), 'hiddenBench'],
    hit: hiddenHits('thunderbolt'),
    why: "With a Minus ally, Plus makes the hidden Ampharos's Special Attack 1.5 times as high; the known Pokemon's exact HP shows it.",
  }),
  'ability:minus': abilityHit({
    name: 'with-plus', stat: 'spa',
    p2: [set('Manectric', 'M', 'Minus', 'Smooth Rock', {}, ['Thunderbolt', 'Splash']), set('Ampharos', 'M', 'Plus', 'Icy Rock', { hp: 32, def: 32 }, ['Splash']), 'hiddenBench'],
    hit: hiddenHits('thunderbolt'),
    why: "With a Plus ally, Minus makes the hidden Manectric's Special Attack 1.5 times as high; the known Pokemon's exact HP shows it.",
  }),
  'ability:solidrock': abilityHit({
    name: 'super-effective', stat: 'spd',
    p1: [withMoves('known', ['Water Pulse', 'Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Rhyperior', 'M', 'Solid Rock', 'Smooth Rock', {}, ['Splash'])],
    hit: knownHits('waterpulse'),
    why: "Solid Rock takes a quarter off the known Snorlax's four-times effective Water Pulse; the hidden Rhyperior's percentage shows its Special Defence and HP.",
  }),
  'ability:filter': abilityHit({
    name: 'super-effective', stat: 'spd',
    p1: [set('Gengar', 'M', 'Cursed Body', 'Heat Rock', { hp: 20, spa: 20 }, ['Sludge Bomb', 'Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Mr. Mime', 'M', 'Filter', 'Smooth Rock', {}, ['Splash'])],
    hit: knownHits('sludgebomb'),
    why: "Filter takes a quarter off the known Gengar's super-effective Sludge Bomb; the hidden Mr. Mime's percentage shows its Special Defence and HP.",
  }),
  'ability:unaware': abilityHit({
    name: 'ignores-bulk-up', stat: 'def',
    p1: [set('Machamp', 'M', 'Guts', 'Heat Rock', { hp: 20, atk: 20 }, ['Bulk Up', 'Strength', 'Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Clefable', 'F', 'Unaware', 'Smooth Rock', {}, ['Splash'])],
    before: [{ p1: 'move bulkup, move splash', p2: 'move splash, move splash' }],
    hit: knownHits('strength'),
    why: "Unaware ignores the known Machamp's +1 Attack when it hits the hidden Clefable; the percentage shows Clefable's Defence and HP.",
  }),
  'ability:grasspelt': abilityHit({
    name: 'on-grass', stat: 'def',
    p1: [set('Rillaboom', 'M', 'Grassy Surge', 'Heat Rock', { hp: 20, atk: 20 }, ['Strength', 'Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Gogoat', 'M', 'Grass Pelt', 'Smooth Rock', {}, ['Splash'])],
    hit: knownHits('strength'),
    why: "On the known Rillaboom's Grassy Terrain, Grass Pelt makes the hidden Gogoat's Defence 1.5 times as high; its percentage shows Defence and HP.",
  }),
  'ability:marvelscale': abilityHit({
    name: 'paralysed', stat: 'def',
    p1: [withMoves('known', ['Thunder Wave', 'Strength', 'Splash']), 'knownAlly', 'knownBench'],
    p2: [set('Milotic', 'F', 'Marvel Scale', 'Smooth Rock', {}, ['Splash'])],
    before: [{ p1: 'move thunderwave 1, move splash', p2: 'move splash, move splash' }],
    hit: knownHits('strength'),
    why: "Paralysed, the hidden Milotic's Marvel Scale makes its Defence 1.5 times as high; its percentage after the known Snorlax's Strength shows Defence and HP.",
  }),
  'ability:friendguard': abilityHit({
    name: 'guards-the-ally', stat: 'def',
    p1: [withMoves('known', ['Strength', 'Splash']), 'knownAlly', 'knownBench'],
    p2: ['hidden', set('Vivillon', 'M', 'Friend Guard', 'Icy Rock', { hp: 32, def: 32 }, ['Splash']), 'hiddenBench'],
    hit: knownHits('strength'),
    control: { p2: [{}, { ability: 'Run Away' }] },
    why: "The hidden Vivillon's Friend Guard takes a quarter off the known Snorlax's Strength on its ally Blastoise, whose percentage shows its Defence and HP.",
  }),
  'ability:galewings': {
    templates: [{
      name: 'priority-race',
      role: 'holder-hidden',
      stat: 'spe',
      p1: [set('Weavile', 'M', 'Pressure', 'Heat Rock', { spe: 7 }, ['Ice Shard', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Talonflame', 'M', 'Gale Wings', 'Smooth Rock', {}, ['Tailwind', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move iceshard 1, move splash', p2: 'move tailwind, move splash' }, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: "At full HP Gale Wings gives the hidden Talonflame's Tailwind +1, the priority of the known Weavile's Ice Shard, so the two race: Talonflame's 146 to 178 against Weavile's 152.",
    }],
  },
  'ability:prankster': {
    templates: [{
      name: 'priority-race',
      role: 'holder-hidden',
      stat: 'spe',
      p1: [set('Weavile', 'M', 'Pressure', 'Heat Rock', { spe: 7 }, ['Ice Shard', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [set('Whimsicott', 'M', 'Prankster', 'Smooth Rock', {}, ['Tailwind', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move iceshard 1, move splash', p2: 'move tailwind, move splash' }, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: "Prankster gives the hidden Whimsicott's Tailwind +1, the priority of the known Weavile's Ice Shard, so the two race: Whimsicott's 136 to 168 against Weavile's 152.",
    }],
  },
  'ability:rattled': {
    templates: [{
      name: 'race-after-a-bite',
      role: 'holder-hidden',
      stat: 'spe',
      p1: [withMoves('known', ['Crunch', 'Splash']), set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 6 }, ['Splash']), 'knownBench'],
      p2: [set('Persian-Alola', 'M', 'Rattled', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move crunch 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: "Hit by a Dark move, Rattled raises the hidden Persian's Speed a stage, 135 to 167 becoming 202 to 250, around the known Regieleki's 226.",
    }],
  },
  'ability:steadfast': {
    templates: [{
      name: 'race-after-a-flinch',
      role: 'holder-hidden',
      stat: 'spe',
      p1: [set('Dragapult', 'M', 'Clear Body', 'Heat Rock', { spe: 27 }, ['Splash']), set('Incineroar', 'M', 'Blaze', 'Damp Rock', { hp: 32 }, ['Fake Out', 'Splash']), 'knownBench'],
      p2: [set('Lucario', 'M', 'Steadfast', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move fakeout 1', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: "Flinched by the known Incineroar's Fake Out, Steadfast raises the hidden Lucario's Speed a stage, 110 to 142 becoming 165 to 213, around the known Dragapult's 189.",
    }],
  },
  'ability:unburden': {
    templates: [{
      name: 'race-after-knock-off',
      role: 'holder-hidden',
      stat: 'spe',
      p1: [withMoves('known', ['Knock Off', 'Splash']), set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 12 }, ['Splash']), 'knownBench'],
      p2: [set('Slurpuff', 'M', 'Unburden', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move knockoff 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: "Its item knocked off, Unburden doubles the hidden Slurpuff's Speed, 92 to 124 becoming 184 to 248, around the known Regieleki's 232.",
    }],
  },
  'ability:surgesurfer': {
    templates: [{
      name: 'race-on-electric-terrain',
      role: 'holder-hidden',
      stat: 'spe',
      p1: [withMoves('known', ['Electric Terrain', 'Splash']), { ...set('Regieleki', '', 'Transistor', 'Heat Rock', { spe: 24 }, ['Splash']), nature: 'Timid' }, 'knownBench'],
      p2: [set('Raichu-Alola', 'M', 'Surge Surfer', 'Smooth Rock', {}, ['Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move electricterrain, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      control: { p2: [{ ability: 'Run Away' }] },
      why: "On the known Snorlax's Electric Terrain, Surge Surfer doubles the hidden Raichu's Speed, 130 to 162 becoming 260 to 324, around the known Regieleki's 268.",
    }],
  },
  'item:whiteherb': {
    templates: [{
      name: 'restored-after-overheat',
      role: 'holder-hidden',
      stat: 'spa',
      p1: ['known', 'knownAlly', 'knownBench'],
      p2: [set('Charizard', 'M', 'Blaze', 'White Herb', {}, ['Overheat', 'Flamethrower', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [hiddenHits('overheat'), hiddenHits('flamethrower'), QUIET],
      control: { p2: [{ item: '' }] },
      why: "White Herb restores the hidden Charizard's Special Attack after Overheat, so its Flamethrower hits at full where its control's hits at -2; the known Pokemon's exact HP shows it.",
    }],
  },
  'move:snore': {
    templates: [{
      name: 'snores-asleep',
      role: 'user-hidden',
      stat: 'spa',
      p1: [withMoves('known', ['Hypnosis', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Snore', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move hypnosis 1, move splash', p2: 'move splash, move splash' }, hiddenHits('snore'), QUIET],
      control: { turns: [{ p1: 'move hypnosis 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET] },
      why: 'Put to sleep, the hidden Pokemon can still Snore, a special hit the known Pokemon\'s exact HP reads.',
    }],
  },
  'move:belch': {
    templates: [{
      name: 'after-a-berry',
      role: 'user-hidden',
      stat: 'spa',
      p1: ['known', 'knownAlly', 'knownBench'],
      p2: [set('Swalot', 'M', 'Gluttony', 'Sitrus Berry', {}, ['Stuff Cheeks', 'Belch', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move stuffcheeks, move splash' }, hiddenHits('belch'), QUIET],
      control: { turns: [{ p1: 'move splash, move splash', p2: 'move stuffcheeks, move splash' }, QUIET, QUIET] },
      why: 'Once the hidden Swalot has eaten its Berry with Stuff Cheeks it can Belch, a special hit the known Pokemon\'s exact HP reads.',
    }],
  },
  'move:spitup': {
    templates: [{
      name: 'after-stockpile',
      role: 'user-hidden',
      stat: 'spa',
      p1: ['known', 'knownAlly', 'knownBench'],
      p2: [set('Swalot', 'M', 'Gluttony', 'Smooth Rock', {}, ['Stockpile', 'Spit Up', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move stockpile, move splash' }, hiddenHits('spitup'), QUIET],
      control: { turns: [{ p1: 'move splash, move splash', p2: 'move stockpile, move splash' }, QUIET, QUIET] },
      why: 'After one Stockpile the hidden Swalot\'s Spit Up is a 100-power special hit, which the known Pokemon\'s exact HP reads.',
    }],
  },
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
      turns: [
        { p1: 'move hypnosis 1, move splash', p2: 'move strength 1, move splash' },
        { p1: 'move splash, move splash', p2: 'move sleeptalk, move splash' },
        { p1: 'move splash, move splash', p2: 'move strength 1, move splash' },
      ],
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
  'move:superfang': {
    templates: [{
      name: 'halved-from-full',
      role: 'target-hidden',
      stat: 'hp',
      worlds: 'sweep',
      p1: [withMoves('known', ['Super Fang', 'Splash']), 'knownAlly', 'knownBench'],
      p2: ['hidden', 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move superfang 1, move splash', p2: 'move splash, move splash' }, QUIET],
      control: { turns: [QUIET, QUIET] },
      why: 'From full HP Super Fang leaves the hidden Pokemon on half its max HP rounded up, which the display shades `50/100g` for an odd max HP and `50/100y` for an even one: a parity that 0 and 32 share.',
    }],
  },
  'move:helpinghand': {
    templates: [{
      name: 'boosts-the-ally',
      role: 'user-hidden',
      probe: 'p2b',
      stat: 'atk',
      p1: ['known', 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Helping Hand', 'Splash']), withMoves('hiddenAlly', ['Strength', 'Splash']), 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move helpinghand -2, move strength 1' }, QUIET],
      control: { turns: [{ p1: 'move splash, move splash', p2: 'move splash, move strength 1' }, QUIET] },
      why: "The hidden Pokemon's Helping Hand makes its ally's hit half again as strong, and the known Pokemon's exact HP shows the ally's Attack.",
    }],
  },
  'ability:unseenfist': {
    templates: [{
      name: 'through-protect',
      role: 'holder-hidden',
      stat: 'atk',
      p1: [withMoves('known', ['Protect', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [{ ...member('Golurk', 'F', 'No Guard', 'Golurkite', {}), moves: ['Drain Punch', 'Splash'] }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move protect, move splash', p2: 'move drainpunch 1 mega, move splash' }, QUIET],
      control: { turns: [{ p1: 'move protect, move splash', p2: 'move splash mega, move splash' }, QUIET] },
      why: "Mega Evolved, the hidden Golurk's contact move hits through the known Pokemon's Protect for a quarter of its damage (bypassProtect in modifyDamage), so its exact HP shows Golurk's Attack.",
    }],
  },
  'ability:piercingdrill': {
    templates: [{
      name: 'through-protect',
      role: 'holder-hidden',
      stat: 'atk',
      p1: [withMoves('known', ['Protect', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [{ ...member('Excadrill', 'F', 'Sand Rush', 'Excadrite', {}), moves: ['Iron Head', 'Splash'] }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move protect, move splash', p2: 'move ironhead 1 mega, move splash' }, QUIET],
      control: { turns: [{ p1: 'move protect, move splash', p2: 'move splash mega, move splash' }, QUIET] },
      why: "Mega Evolved, the hidden Excadrill's contact move hits through the known Pokemon's Protect for a quarter of its damage, so its exact HP shows Excadrill's Attack.",
    }],
  },
  'ability:megasol': {
    templates: [{
      name: 'weather-ball-in-its-own-sun',
      role: 'holder-hidden',
      stat: 'spa',
      p1: ['known', 'knownAlly', 'knownBench'],
      p2: [{ ...member('Meganium', 'F', 'Overgrow', 'Meganiumite', {}), moves: ['Weather Ball', 'Splash'] }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move splash, move splash', p2: 'move weatherball 1 mega, move splash' }, QUIET],
      control: { turns: [{ p1: 'move splash, move splash', p2: 'move splash mega, move splash' }, QUIET] },
      why: "With no sun on the field, Mega Meganium's Weather Ball is a 100-power Fire move boosted as in sun, and the known Pokemon's exact HP shows its Special Attack.",
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
  'move:wish': {
    templates: [{
      name: 'partner-healed',
      role: 'user-hidden',
      p1: [withMoves('known', ['Super Fang', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Wish', 'Splash']), withMoves('hiddenAlly', ['Ally Switch', 'Splash']), 'hiddenBench'],
      turns: [
        { p1: 'move superfang 2, move splash', p2: 'move wish, move splash' },
        { p1: 'move splash, move splash', p2: 'move splash, move allyswitch' },
        QUIET,
      ],
      control: { turns: [{ p1: 'move superfang 2, move splash', p2: 'move splash, move splash' }, { p1: 'move splash, move splash', p2: 'move splash, move allyswitch' }, QUIET] },
      why: 'The halved partner is switched into the wisher\'s slot and healed by half the wisher\'s max HP, which its percentage then shows.',
    }],
  },
  'move:painsplit': {
    templates: [{
      name: 'with-the-partner',
      role: 'user-hidden',
      p1: [withMoves('known', ['Super Fang', 'Splash']), 'knownAlly', 'knownBench'],
      p2: [withMoves('hidden', ['Pain Split', 'Splash']), 'hiddenAlly', 'hiddenBench'],
      turns: [
        { p1: 'move superfang 2, move splash', p2: 'move splash, move splash' },
        { p1: 'move splash, move splash', p2: 'move painsplit -2, move splash' },
        QUIET,
      ],
      control: { turns: [{ p1: 'move superfang 2, move splash', p2: 'move splash, move splash' }, QUIET, QUIET] },
      why: 'Both shown as percentages, the hidden Pokemon and its halved partner are set to the average of their HP, which each percentage then shows.',
    }],
  },
  'item:shellbell': {
    templates: [{
      name: 'spread-on-both',
      role: 'other-hidden',
      p1: [{ ...withMoves('known', ['Hyper Voice', 'Splash']), item: 'Shell Bell' }, withMoves('knownAlly', ['Super Fang', 'Splash']), 'knownBench'],
      p2: ['hidden', 'hiddenAlly', 'hiddenBench'],
      turns: [
        { p1: 'move splash, move superfang -1', p2: 'move splash, move splash' },
        { p1: 'move hypervoice, move splash', p2: 'move splash, move splash' },
        QUIET,
      ],
      control: { p1: [{ item: 'Heat Rock' }] },
      why: 'Halved first, the known holder heals by an eighth of what its spread move dealt both hidden Pokemon together, which its exact HP shows.',
    }, {
      name: 'two-hits',
      role: 'other-hidden',
      p1: [{ ...withMoves('known', ['Double Hit', 'Splash']), item: 'Shell Bell' }, withMoves('knownAlly', ['Super Fang', 'Splash']), 'knownBench'],
      p2: ['hidden', 'hiddenAlly', 'hiddenBench'],
      turns: [
        { p1: 'move splash, move superfang -1', p2: 'move splash, move splash' },
        { p1: 'move doublehit 1, move splash', p2: 'move splash, move splash' },
        QUIET,
      ],
      control: { p1: [{ item: 'Heat Rock' }] },
      why: 'Halved first, the known holder heals by an eighth of what both hits dealt the hidden Pokemon together, which its exact HP shows.',
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
  'item:focusband': {
    templates: [{
      name: 'lethal-at-the-edge',
      role: 'holder-hidden',
      p1: [{ ...member('Garchomp', 'M', 'Sand Veil', 'Heat Rock', { hp: 2, atk: 32, def: 32 }), moves: ['Iron Tail', 'Splash'] }, 'knownAlly', 'knownBench'],
      p2: [{ ...member('Whimsicott', 'F', 'Infiltrator', 'Focus Band', {}), moves: ['Splash'] }, 'hiddenAlly', 'hiddenBench'],
      turns: [{ p1: 'move irontail 1, move splash', p2: 'move splash, move splash' }, QUIET, QUIET],
      dice: ['proc p2:whimsicott - -'],
      control: { p2: [{ item: '' }] },
      why: 'A hit that knocks the holder out at some Stat Points and not at others; with its chance granted, the Band then saves it only where the hit was lethal.',
    }],
  },
};

/**
 * Effects that cannot carry a Stat Point on an open sheet, or cannot act in
 * this format, with the handler that says so. Each is its entry's `reason`.
 */
const reasons = {
  'ability:battlearmor': 'onCriticalHit:false is a crit gate; the hit that follows is an ordinary M1 line.',
  'ability:battlebond': 'Cannot act: onSourceAfterFaint and onModifyMove need Greninja-Ash (species id greninjabond); Greninja-Bond is isNonstandard "Past", and plain Greninja can hold Battle Bond only in an event slot the validator refuses.',
  'ability:corrosion': 'A status and type gate in Pokemon#setStatus (poison on Steel and Poison); the tick it allows is the ordinary poison channel.',
  'ability:effectspore': 'onDamagingHit puts to sleep, paralyses or poisons by dice: a chance and a status. Its UNUSED cell is the order of two hidden Pokemon, both Speeds unknown, which no effect creates.',
  'ability:flamebody': 'onDamagingHit burns by a 30% chance: a chance and a status; the burn\'s tick and halved Attack are the Will-O-Wisp witness.',
  'ability:forecast': 'onWeatherChange changes only Castform\'s forme and type, on the same base stats: a type.',
  'ability:gluttony': 'Only the quarter-HP Berries read abilityState.gluttony (Figy, Wiki, Aguav, Iapapa, Mago and the stat Berries), and none of them is in the legal item pool.',
  'ability:grassysurge': 'O:Atk cell: the terrain heals the known Rillaboom by its own max HP / 16; the hidden Pokemon\'s Attack is carried only by the hit before it. The hidden side\'s HP and Def cells are USED.',
  'ability:harvest': 'onResidual only gives the Berry back (setItem); eating it again is the Berry\'s own channel.',
  'ability:infiltrator': 'onModifyMove sets infiltrates, which bypasses screens and Substitute and so only removes a multiplier; the hit is an ordinary M1 or M2 line.',
  'ability:merciless': 'onModifyCritRatio makes a hit on a poisoned target crit: crit rate.',
  'ability:mimicry': 'onTerrainChange changes only the holder\'s type: a type.',
  'ability:mirrorarmor': 'onTryBoost bounces a stat drop (its source.hp read only asks whether the source is alive); the reflected drop is an ordinary stage change.',
  'ability:pickup': 'onResidual only gives an item back (setItem); nothing reads a stat.',
  'ability:poisonpoint': 'onDamagingHit poisons by a 30% chance: a chance and a status; the poison tick is the Toxic witness.',
  'ability:poisontouch': 'onSourceDamagingHit poisons by a 30% chance: a chance and a status.',
  'ability:purepower': 'O:Spe cell: the known holder doubles its own Attack; the hidden Pokemon\'s Splash line appears or not with its survival (HP and Def, USED), and the move reads no Speed.',
  'ability:scrappy': 'onModifyMove lets Normal and Fighting hit Ghosts and blocks Intimidate: a type immunity gate; the damage it lets through is an ordinary M2 line.',
  'ability:screencleaner': 'onStart removes Reflect, Light Screen and Aurora Veil and prints |-activate|, reading no stat; voluntary switch-ins go p1 then p2 whatever the Speed, so no order carries Speed either.',
  'ability:shadowtag': 'onFoeTrapPokemon and onFoeMaybeTrapPokemon only trap an adjacent foe (tryTrap, maybeTrapped): a switch gate; nothing it does reads a stat.',
  'ability:shedskin': 'onResidual cures a status by a 33% chance; its hp read only asks whether the holder is alive.',
  'ability:shellarmor': 'onCriticalHit:false is a crit gate; the hit that follows is an ordinary M1 line.',
  'ability:skilllink': 'onModifyMove sets a multi-hit move to its most hits: a hit count; each hit is an ordinary M2 line.',
  'ability:stamina': 'O:Atk cell: onDamagingHit raises the known holder\'s Defence, so a later hit repeats the Attack the first hit already showed. The hidden holder\'s HP and Def are USED.',
  'ability:static': 'onDamagingHit paralyses by a 30% chance: a chance and a status; the halved Speed is the Thunder Wave witness.',
  'ability:stench': 'onModifyMove adds a 10% flinch: a chance.',
  'ability:stickyhold': 'onTakeItem blocks taking the item (and Knock Off\'s 1.5x): an item gate; its hp read only asks whether the holder is alive.',
  'ability:superluck': 'onModifyCritRatio +1: crit rate.',
  'ability:symbiosis': 'onAllyAfterUseItem only passes the holder\'s item to its ally (takeItem, setItem).',
  'item:aspearberry': 'onUpdate and onEat cure a freeze: a status.',
  'item:choicescarf': 'H:SpA cell: the Scarf reads only Speed (onModifySpe, USED); Special Attack is carried by the hit lines that masked it. Its witnesses that attack after a first Splash stay locked into Splash, which the card shows as overridden.',
  'item:damprock': 'Lengthens rain, in the weather condition: a duration, no handler of its own.',
  'item:ejectbutton': 'onAfterMoveSecondary reads target.hp only to ask whether the holder is alive, and switches it out; the holder\'s percentage is the hit\'s before it.',
  'item:heatrock': 'Lengthens sun: a duration.',
  'item:icyrock': 'Lengthens snow: a duration.',
  'item:kingsrock': 'onModifyMove adds a 10% flinch: a chance.',
  'item:leek': 'onModifyCritRatio +2 for Farfetch\'d and Sirfetch\'d: crit rate.',
  'item:leftovers': 'O:Atk cell: the known holder heals its own max HP / 16; the hidden attacker\'s Attack is carried only by the hit before it. H:HP is USED.',
  'item:leppaberry': 'onEat restores 10 PP; its hp read only asks whether the holder has fainted.',
  'item:lightclay': 'Lengthens screens: a duration.',
  'item:oranberry': 'H:Def cell: Oran heals a flat 10 (HP is USED); Defence is carried only by the hit before it.',
  'item:redcard': 'onAfterMoveSecondary reads source.hp and target.hp only to ask whether both are alive, and forces a switch; the Atk channel is USED.',
  'item:scopelens': 'onModifyCritRatio +1: crit rate.',
  'item:smoothrock': 'Lengthens sand: a duration.',
  'item:terrainextender': 'Lengthens terrain: a duration.',
  'move:healingwish': 'onTryHit faints its user, and the replacement is healed to full (100/100 at any max HP) and cured; nothing it prints depends on a Stat Point.',
  'move:recycle': 'onHit only gives back lastItem (setItem) and prints |-item|; nothing it does reads a stat, and a Berry eaten again is that Berry\'s own channel.',
  'move:rest': 'Heals to full: a hidden user shows 100/100 at every max HP and a known one its own exact line; the sleep is a status.',
  'move:sludgewave': 'Def cell: the move is special, so its own lines read SpD and HP (USED) and the target\'s poison tick; Defence is carried only by the physical witness hit that masked it.',
};
for (const [key, reason] of Object.entries(reasons)) entries[key] = { ...(entries[key] || {}), reason };

module.exports = { cast, pacers, hits, witnessMoves, quietAbilities, entries };
