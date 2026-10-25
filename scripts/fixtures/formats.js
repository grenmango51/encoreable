'use strict';

/**
 * Format fixtures for the pinned simulator.
 *
 * pokemon-showdown package.json pin: a5df8274e85b0889bf2a9b3422a08b39732374fc.
 * Read from Dex at that commit. This file does not import the simulator.
 *
 * gen9vgc2026regf is absent (Dex.formats.get exists === false). The Gen 9 VGC
 * doubles formats at the pin are gen9vgc2023regc, gen9vgc2023regd (both mod
 * gen9predlc, searchShow false), gen9vgc2025regi (mod gen9, searchShow false),
 * and gen9vgc2024regg (mod gen9, searchShow true). The fixture uses
 * gen9vgc2024regg, the searchable standard ladder format.
 *
 * Teams are Showdown export text. VGC and OU plans are choose() strings that
 * TeamValidator.validateTeam accepted (synchronous here; null means valid) and
 * that Battle strictChoices played. Genders are written on gendered species so
 * a battle does not roll them from its PRNG.
 *
 * Random Battle teams are not in this file. Generate them with the pinned
 * Teams.generate and keep the battle input log. See RANDOM.generator.
 */

const PIN = 'a5df8274e85b0889bf2a9b3422a08b39732374fc';

const VGC_P1_EXPORT = `
Incineroar (M) @ Safety Goggles
Ability: Intimidate
Level: 50
Tera Type: Water
EVs: 236 HP / 4 Atk / 76 Def / 148 SpD / 4 Spe
Careful Nature
IVs: 31 HP / 31 Atk / 31 Def / 0 SpA / 31 SpD / 31 Spe
- Fake Out
- Protect
- Parting Shot
- Will-O-Wisp

Landorus-Therian (M) @ Life Orb
Ability: Intimidate
Level: 50
Tera Type: Flying
EVs: 4 HP / 252 Atk / 252 Spe
Adamant Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Stealth Rock
- Earthquake
- Rock Slide
- U-turn

Gholdengo @ Leftovers
Ability: Good as Gold
Level: 50
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 SpA
Modest Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect

Amoonguss (F) @ Sitrus Berry
Ability: Regenerator
Level: 50
Tera Type: Water
EVs: 244 HP / 188 Def / 76 SpD
Bold Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 0 Spe
- Spore
- Rage Powder
- Pollen Puff
- Sludge Bomb

Urshifu-Rapid-Strike (M) @ Choice Scarf
Ability: Unseen Fist
Level: 50
Tera Type: Water
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Surging Strikes
- Close Combat
- Aqua Jet
- U-turn

Tornadus (M) @ Covert Cloak
Ability: Prankster
Level: 50
Tera Type: Ghost
EVs: 252 HP / 4 Def / 252 Spe
Timid Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Tailwind
- Bleakwind Storm
- Taunt
- Protect
`.trim();

const VGC_P2_EXPORT = `
Rillaboom (M) @ Miracle Seed
Ability: Grassy Surge
Level: 50
Tera Type: Fire
EVs: 252 HP / 116 Atk / 4 Def / 4 SpD / 132 Spe
Adamant Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Fake Out
- Grassy Glide
- Wood Hammer
- Protect

Garchomp (F) @ Clear Amulet
Ability: Rough Skin
Level: 50
Tera Type: Ground
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Earthquake
- Rock Slide
- Stealth Rock
- Protect

Flutter Mane @ Booster Energy
Ability: Protosynthesis
Level: 50
Tera Type: Fairy
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Moonblast
- Shadow Ball
- Dazzling Gleam
- Protect

Kingambit (M) @ Black Glasses
Ability: Supreme Overlord
Level: 50
Tera Type: Dark
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect

Pelipper (F) @ Focus Sash
Ability: Drizzle
Level: 50
Tera Type: Ground
EVs: 252 HP / 4 Def / 252 SpA
Modest Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Hurricane
- Weather Ball
- Tailwind
- Wide Guard

Farigiraf (M) @ Mental Herb
Ability: Armor Tail
Level: 50
Tera Type: Water
EVs: 244 HP / 148 Def / 76 SpD
Relaxed Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 0 Spe
- Trick Room
- Psychic
- Helping Hand
- Protect
`.trim();

const OU_P1_EXPORT = `
Great Tusk @ Leftovers
Ability: Protosynthesis
Level: 100
Tera Type: Steel
EVs: 200 HP / 80 Def / 80 SpD / 140 Spe
Jolly Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Stealth Rock
- Earthquake
- Knock Off
- Rapid Spin

Gholdengo @ Heavy-Duty Boots
Ability: Good as Gold
Level: 100
Tera Type: Steel
EVs: 160 HP / 20 Def / 180 SpA / 20 SpD / 80 Spe
Modest Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Shadow Ball
- Make It Rain
- Recover
- Nasty Plot

Dragapult (M) @ Choice Specs
Ability: Infiltrator
Level: 100
Tera Type: Ghost
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Slowking-Galar (M) @ Colbur Berry
Ability: Regenerator
Level: 100
Tera Type: Water
EVs: 248 HP / 8 Def / 252 SpD
Sassy Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 0 Spe
- Slack Off
- Future Sight
- Chilly Reception
- Ice Beam

Kingambit (F) @ Black Glasses
Ability: Supreme Overlord
Level: 100
Tera Type: Dark
EVs: 248 HP / 252 Atk / 8 SpD
Adamant Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Swords Dance

Iron Valiant @ Booster Energy
Ability: Quark Drive
Level: 100
Tera Type: Fairy
EVs: 68 Atk / 188 SpA / 252 Spe
Naive Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Close Combat
- Moonblast
- Knock Off
- Encore
`.trim();

const OU_P2_EXPORT = `
Clefable (F) @ Rocky Helmet
Ability: Magic Guard
Level: 100
Tera Type: Steel
EVs: 244 HP / 180 Def / 44 SpD
Bold Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Moonblast
- Thunder Wave
- Moonlight
- Calm Mind

Ting-Lu @ Leftovers
Ability: Vessel of Ruin
Level: 100
Tera Type: Poison
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Stealth Rock
- Earthquake
- Ruination
- Whirlwind

Dragonite (M) @ Heavy-Duty Boots
Ability: Multiscale
Level: 100
Tera Type: Normal
EVs: 252 Atk / 4 SpD / 252 Spe
Adamant Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Dragon Dance
- Extreme Speed
- Earthquake
- Ice Spinner

Heatran (F) @ Air Balloon
Ability: Flash Fire
Level: 100
Tera Type: Grass
EVs: 180 HP / 44 Def / 196 SpD / 36 Spe
Calm Nature
IVs: 31 HP / 0 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Magma Storm
- Earth Power
- Taunt
- Will-O-Wisp

Gliscor (M) @ Toxic Orb
Ability: Poison Heal
Level: 100
Tera Type: Water
EVs: 244 HP / 36 Def / 228 SpD
Impish Nature
IVs: 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Earthquake
- Spikes
- Protect
- Toxic

Samurott-Hisui (M) @ Focus Sash
Ability: Sharpness
Level: 100
Tera Type: Water
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
IVs: 31 HP / 31 Atk / 31 Def / 0 SpA / 31 SpD / 31 Spe
- Ceaseless Edge
- Razor Shell
- Knock Off
- Aqua Jet
`.trim();

const VGC_SEED = 'sodium,a5df8274e85b0889bf2a9b3422a08b39';
const OU_SEED = 'sodium,c0ffee00c0ffee00c0ffee00c0ffee00';
const RANDOM_SEED = 'sodium,b0b51ed0b0b51ed0b0b51ed0b0b51ed0';

// Doubles targets: +1 opponent left, +2 opponent right. Self, side, and
// all-adjacent moves take no target. A one-slot force-switch in doubles is
// `pass` for the slot that is not switching. Switch indexes are the party
// after Team Preview, and a switch swaps that party slot with the active.
// Each Protect below is a first use and is not the last action of its turn
// (Protect fails when nothing else will act, and a consecutive use is 1/3).
const VGC_PLAN = [
  {
    phase: 'teampreview',
    p1: 'team 2, 1, 3, 4',
    p2: 'team 2, 1, 3, 4',
    what: 'Bring Landorus-Therian, Incineroar, Gholdengo, Amoonguss against Garchomp, Rillaboom, Flutter Mane, Kingambit. Urshifu-Rapid-Strike, Tornadus, Pelipper, and Farigiraf stay out.',
  },
  {
    phase: 'move',
    p1: 'move stealthrock, move willowisp +1',
    p2: 'move stealthrock, move protect',
    what: 'Both sides set Stealth Rock. Incineroar burns Garchomp. Rillaboom Protects.',
  },
  {
    phase: 'move',
    p1: 'switch 3, move willowisp +1',
    p2: 'switch 4, move grassyglide +2',
    what: 'Landorus-Therian switches to Gholdengo. Garchomp switches to Kingambit. Incineroar burns Kingambit. Rillaboom Grassy Glides Incineroar.',
  },
  {
    phase: 'move',
    p1: 'move nastyplot terastallize, move protect',
    p2: 'move protect, move woodhammer +2',
    what: 'Gholdengo Terastallizes Steel and uses Nasty Plot. Incineroar Protects Rillaboom\'s Wood Hammer. Kingambit Protects.',
  },
  {
    phase: 'move',
    p1: 'move nastyplot, move partingshot +1',
    p2: 'move suckerpunch +2, switch 3',
    what: 'Gholdengo uses Nasty Plot again. Incineroar Parting Shots Kingambit. Rillaboom switches to Flutter Mane. Kingambit\'s Sucker Punch fails because neither foe attacks.',
  },
  {
    phase: 'switch',
    p1: 'pass, switch 4',
    p2: null,
    what: 'Parting Shot asks only p1 to switch. Slot 1 passes. Amoonguss replaces Incineroar.',
  },
];

const OU_PLAN = [
  {
    phase: 'teampreview',
    p1: 'team 1, 2, 3, 4, 5, 6',
    p2: 'team 4, 1, 2, 3, 5, 6',
    what: 'Bring all six. Great Tusk leads. Heatran leads for p2, then Clefable, Ting-Lu, Dragonite, Gliscor, Samurott-Hisui.',
  },
  {
    phase: 'move',
    p1: 'move stealthrock',
    p2: 'move willowisp',
    what: 'Great Tusk sets Stealth Rock. Heatran burns Great Tusk.',
  },
  {
    phase: 'move',
    p1: 'switch 2',
    p2: 'switch 5',
    what: 'Great Tusk switches to Gholdengo. Heatran switches to Gliscor, which is poisoned by Toxic Orb on the way in.',
  },
  {
    phase: 'move',
    p1: 'move nastyplot terastallize',
    p2: 'move spikes',
    what: 'Gholdengo Terastallizes Steel and uses Nasty Plot. Gliscor sets one layer of Spikes.',
  },
  {
    phase: 'move',
    p1: 'switch 3',
    p2: 'move toxic',
    what: 'Gholdengo switches to Dragapult. Gliscor poisons Dragapult. Dragapult takes the Spikes on the way in.',
  },
];

const STAT_RULES = {
  evLimit: 510,
  perStatValidatorCeiling: 255,
  mainlinePerStatCap: 252,
  ivMin: 0,
  ivMax: 31,
};

const VGC = {
  id: 'gen9vgc2024regg',
  name: '[Gen 9] VGC 2024 Reg G',
  mod: 'gen9',
  gameType: 'doubles',
  gen: 9,
  team: null,
  searchShow: true,
  challengeShow: true,
  tournamentShow: true,
  rated: true,
  bestOfDefault: true,
  ruleset: ['Flat Rules', '!! Adjust Level = 50', 'Min Source Gen = 9', 'VGC Timer', 'Open Team Sheets', 'Limit One Restricted'],
  banlist: [],
  restricted: ['Restricted Legendary'],
  resolved: {
    minTeamSize: 4,
    maxTeamSize: 6,
    pickedTeamSize: 4,
    minLevel: 1,
    maxLevel: 100,
    defaultLevel: 100,
    adjustLevel: 50,
    adjustLevelDown: null,
    evLimit: 510,
    maxMoveCount: 4,
    minSourceGen: 9,
    timer: {
      starting: 420,
      dcTimer: true,
      grace: 90,
      addPerTurn: 0,
      maxPerTurn: 55,
      maxFirstTurn: 90,
      timeoutAutoChoose: true,
    },
  },
  clauses: {
    teamPreview: true,
    openTeamSheets: true,
    forceOpenTeamSheets: false,
    speciesClause: true,
    nicknameClause: true,
    itemClause: 1,
    sleepClause: false,
    sleepMovesClause: false,
    terastalClause: false,
    teraLegal: true,
    evasionAbilitiesClause: false,
    ohkoClause: false,
    hpPercentageMod: false,
    cancelMod: true,
    obtainable: true,
  },
  stats: {
    ...STAT_RULES,
    level: 50,
    levelRule: '!! Adjust Level = 50 replaces Flat Rules Adjust Level Down = 50. Every Pokemon is set to level 50.',
    bring: 'Mainline is six Pokemon. The format minimum is 4 and the preview brings 4.',
    restricted: 'Limit One Restricted allows one Restricted Legendary. Flat Rules bans Mythical and Greninja-Bond. These teams bring none.',
  },
  extension: {
    modData: 'base data/ (dexes.gen9 is the base dex)',
    randomGenerator: false,
  },
  seed: VGC_SEED,
  p1: VGC_P1_EXPORT,
  p2: VGC_P2_EXPORT,
  plan: VGC_PLAN,
};

const OU = {
  id: 'gen9ou',
  name: '[Gen 9] OU',
  mod: 'gen9',
  gameType: 'singles',
  gen: 9,
  team: null,
  searchShow: true,
  challengeShow: true,
  tournamentShow: true,
  rated: true,
  bestOfDefault: false,
  ruleset: ['Standard', 'Evasion Abilities Clause', 'Sleep Moves Clause', '!Sleep Clause Mod'],
  banlist: ['Uber', 'AG', 'Arena Trap', 'Moody', 'Shadow Tag', "King's Rock", 'Razor Fang', 'Baton Pass', 'Last Respects', 'Shed Tail', 'Tera Blast'],
  restricted: [],
  resolved: {
    minTeamSize: 1,
    maxTeamSize: 6,
    pickedTeamSize: null,
    minLevel: 1,
    maxLevel: 100,
    defaultLevel: 100,
    adjustLevel: null,
    adjustLevelDown: null,
    evLimit: 510,
    maxMoveCount: 4,
    minSourceGen: 9,
    timer: null,
  },
  clauses: {
    teamPreview: true,
    openTeamSheets: false,
    forceOpenTeamSheets: false,
    speciesClause: true,
    nicknameClause: true,
    itemClause: null,
    sleepClause: false,
    sleepMovesClause: true,
    terastalClause: false,
    teraLegal: true,
    teraBlastBanned: true,
    evasionAbilitiesClause: true,
    evasionMovesClause: true,
    evasionItemsClause: true,
    ohkoClause: true,
    endlessBattleClause: true,
    hpPercentageMod: true,
    cancelMod: true,
    obtainable: true,
  },
  stats: {
    ...STAT_RULES,
    level: 100,
    levelRule: 'Default and max level are 100. A level 50 set whose EV total is divisible by 4 is rejected as an import mistake.',
    bring: 'Team Preview has no picked-team cap, so a six-Pokemon team chooses all six. The format minimum is 1.',
  },
  extension: {
    modData: 'base data/ (dexes.gen9 is the base dex)',
    randomGenerator: false,
  },
  seed: OU_SEED,
  p1: OU_P1_EXPORT,
  p2: OU_P2_EXPORT,
  plan: OU_PLAN,
};

const RANDOM = {
  id: 'gen9randombattle',
  name: '[Gen 9] Random Battle',
  mod: 'gen9',
  gameType: 'singles',
  gen: 9,
  team: 'random',
  searchShow: true,
  challengeShow: true,
  tournamentShow: true,
  rated: true,
  bestOfDefault: true,
  ruleset: ['PotD', 'Obtainable', 'Species Clause', 'HP Percentage Mod', 'Cancel Mod', 'Sleep Clause Mod', 'Illusion Level Mod'],
  banlist: [],
  restricted: [],
  resolved: {
    minTeamSize: 1,
    maxTeamSize: 6,
    pickedTeamSize: null,
    minLevel: 1,
    maxLevel: 100,
    defaultLevel: 100,
    adjustLevel: null,
    adjustLevelDown: null,
    evLimit: 510,
    maxMoveCount: 4,
    minSourceGen: 9,
    timer: null,
  },
  clauses: {
    teamPreview: false,
    openTeamSheets: false,
    speciesClause: true,
    sleepClause: true,
    sleepMovesClause: false,
    terastalClause: false,
    teraLegal: true,
    illusionLevelMod: true,
    potd: true,
    hpPercentageMod: true,
    cancelMod: true,
    obtainable: true,
  },
  stats: STAT_RULES,
  extension: {
    modData: 'base data/ (dexes.gen9 is the base dex)',
    randomGenerator: false,
    generatorModule: 'data/random-battles/gen9/teams.js',
    replayPackedTeam: true,
    replaySeedOnlyPlayerLine: false,
  },
  seed: RANDOM_SEED,
  p1: null,
  p2: null,
  plan: null,
  generator: {
    formatTeam: 'random',
    module: 'data/random-battles/gen9/teams',
    className: 'RandomTeams',
    method: 'randomTeam',
    call: "Teams.generate('gen9randombattle', { seed: RANDOM_SEED })",
    validateSuppliedTeam: 'rejected',
    validateNullTeam: 'calls the generator; null means it ran',
    potd: 'The PotD rule forces a species only when global.Config.potd is non-empty. require("pokemon-showdown") does not load config.js, so the seed alone selects the team.',
    inputLog: 'Battle.getTeam writes the generation seed onto the player options and does not put the packed team on the >player line. A >start seed is the battle PRNG, not the team seed, unless the player options carry the same seed. Replaying a seed-only >player line calls the generator again. A >player line with a packed team does not.',
  },
};

const VGC_FORMAT_SURVEY = [
  { id: 'gen9vgc2026regf', exists: false },
  { id: 'gen9vgc2023regc', exists: true, mod: 'gen9predlc', gameType: 'doubles', searchShow: false },
  { id: 'gen9vgc2023regd', exists: true, mod: 'gen9predlc', gameType: 'doubles', searchShow: false },
  { id: 'gen9vgc2025regi', exists: true, mod: 'gen9', gameType: 'doubles', searchShow: false },
  { id: 'gen9vgc2024regg', exists: true, mod: 'gen9', gameType: 'doubles', searchShow: true },
];

const FORMATS = {
  gen9vgc2024regg: VGC,
  gen9ou: OU,
  gen9randombattle: RANDOM,
};

module.exports = {
  PIN,
  VGC_P1_EXPORT,
  VGC_P2_EXPORT,
  OU_P1_EXPORT,
  OU_P2_EXPORT,
  VGC_SEED,
  OU_SEED,
  RANDOM_SEED,
  VGC_PLAN,
  OU_PLAN,
  VGC,
  OU,
  RANDOM,
  VGC_FORMAT_SURVEY,
  FORMATS,
};
