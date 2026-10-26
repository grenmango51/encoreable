/**
 * Known-team Gen 9 OU fixture for the pinned simulator.
 *
 * Export text and scripted choices are validated by Showdown. Metadata records
 * the pinned rules; it does not replace the simulator's validator or mechanics.
 */

const PIN = 'a5df8274e85b0889bf2a9b3422a08b39732374fc';

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

const OU_SEED = 'sodium,c0ffee00c0ffee00c0ffee00c0ffee00';

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
  },
  seed: OU_SEED,
  p1: OU_P1_EXPORT,
  p2: OU_P2_EXPORT,
  plan: OU_PLAN,
};

const FORMATS = { gen9ou: OU };

module.exports = { PIN, OU_P1_EXPORT, OU_P2_EXPORT, OU_SEED, OU_PLAN, OU, FORMATS };
