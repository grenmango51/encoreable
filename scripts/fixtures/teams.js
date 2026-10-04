'use strict';

/**
 * Test-fixture teams for the omniscient replay harness.
 *
 * Kept as Showdown export text so they can be pasted straight in or out of the
 * teambuilder. They are packed at runtime by `Teams.import` / `Teams.pack`.
 *
 * Stat Points live in the `EVs:` line. Champions budget is 66 with a cap of 32
 * per stat, and every spread below sums to exactly 66.
 */

// p1 — leads Gengar-Mega + Sinistcha (the two Ghost types).
const P1_EXPORT = `
Gengar-Mega @ Gengarite
Ability: Shadow Tag
Level: 50
EVs: 32 HP / 19 Def / 15 SpD
Modest Nature
- Perish Song
- Protect
- Disable
- Shadow Ball

Sinistcha @ Kasib Berry
Ability: Hospitality
Level: 50
EVs: 31 HP / 7 Def / 28 SpD
Relaxed Nature
- Matcha Gotcha
- Life Dew
- Rage Powder
- Protect

Incineroar @ Passho Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 16 Def / 18 SpD
Sassy Nature
- Parting Shot
- Protect
- Fake Out
- Throat Chop

Politoed @ Sitrus Berry
Ability: Drizzle
Level: 50
EVs: 32 HP / 24 Def / 8 SpA / 2 SpD
Bold Nature
- Perish Song
- Protect
- Weather Ball
- Encore

Sableye @ Roseli Berry
Ability: Prankster
Level: 50
EVs: 32 HP / 9 Def / 25 SpD
Sassy Nature
- Rain Dance
- Fake Out
- Encore
- Protect

Archaludon @ Leftovers
Ability: Stamina
Level: 50
EVs: 32 HP / 1 Def / 5 SpA / 25 SpD / 3 Spe
Modest Nature
- Dragon Pulse
- Electro Shot
- Flash Cannon
- Protect
`.trim();

// p2 — the first four Pokemon exist to remove themselves from the field quickly.
// Reg M-C requires a six-Pokemon team, but Team Preview brings only four, so the
// last two are there for legality and are never selected.
const P2_EXPORT = `
Glalie @ Glalitite
Ability: Inner Focus
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Explosion
- Ice Spinner
- Protect
- Taunt

Whimsicott @ Focus Sash
Ability: Prankster
Level: 50
EVs: 32 HP / 32 Def / 2 SpA
Bold Nature
- Memento
- Encore
- Moonblast
- Tailwind

Gholdengo @ Life Orb
Ability: Good as Gold
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Protect
- Memento
- Make It Rain
- Shadow Ball

Metagross-Mega @ Metagrossite
Ability: Tough Claws
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Explosion
- Meteor Mash
- Psychic Fangs
- Protect

Basculegion (M) @ Sitrus Berry
Ability: Swift Swim
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Adamant Nature
- Protect
- Wave Crash
- Last Respects
- Aqua Jet

Kingambit @ Black Glasses
Ability: Defiant
Level: 50
EVs: 32 HP / 32 Atk / 2 SpD
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Protect
`.trim();


// p1 alt — weather-flexible offense: Charizardite Y sun or Pelipper rain, with
// Grimmsnarl screens and Archaludon as the Electro Shot win condition.
const P1_ALT_EXPORT = `
Charizard (M) @ Charizardite Y
Ability: Blaze
Level: 50
EVs: 24 HP / 16 Def / 9 SpA / 17 Spe
Modest Nature
- Protect
- Heat Wave
- Solar Beam
- Weather Ball

Grimmsnarl (M) @ Light Clay
Ability: Prankster
Level: 50
EVs: 32 HP / 19 Def / 15 SpD
Sassy Nature
- Spirit Break
- Light Screen
- Reflect
- Parting Shot

Archaludon (F) @ Leftovers
Ability: Stamina
Level: 50
EVs: 32 HP / 1 Def / 1 SpA / 25 SpD / 7 Spe
Calm Nature
- Electro Shot
- Dragon Pulse
- Flash Cannon
- Protect

Basculegion (M) @ Choice Scarf
Ability: Adaptability
Level: 50
EVs: 28 Atk / 14 Def / 24 Spe
Jolly Nature
- Wave Crash
- Last Respects
- Aqua Jet
- Flip Turn

Pelipper (F) @ Sitrus Berry
Ability: Drizzle
Level: 50
EVs: 32 HP / 23 SpA / 11 Spe
Modest Nature
- Hurricane
- Weather Ball
- Tailwind
- Wide Guard

Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Rock Slide
- Earthquake
- Dragon Claw
- Protect
`.trim();

// p2 alt — rain plus a Trick Room mode: Pelipper sets the weather for Blastoise
// -Mega's Water Spout, Farigiraf and Sinistcha flip speed for the slow attackers.
const P2_ALT_EXPORT = `
Blastoise-Mega @ Blastoisinite
Ability: Rain Dish
Level: 50
EVs: 32 HP / 2 Def / 32 SpA
Quiet Nature
- Water Spout
- Dragon Pulse
- Aura Sphere
- Protect

Gholdengo @ Life Orb
Ability: Good as Gold
Level: 50
EVs: 32 HP / 32 SpA / 2 SpD
Modest Nature
- Nasty Plot
- Shadow Ball
- Make It Rain
- Protect

Farigiraf @ Sitrus Berry
Ability: Armor Tail
Level: 50
EVs: 32 HP / 17 Def / 17 SpD
Bold Nature
- Hyper Voice
- Trick Room
- Helping Hand
- Roar

Pelipper @ Focus Sash
Ability: Drizzle
Level: 50
EVs: 2 HP / 32 Def / 32 SpD
Calm Nature
- Rain Dance
- Hurricane
- Wide Guard
- Tailwind

Sinistcha @ Leftovers
Ability: Hospitality
Level: 50
EVs: 2 HP / 32 Def / 32 SpD
Calm Nature
- Matcha Gotcha
- Life Dew
- Rage Powder
- Trick Room

Dragalge-Mega @ Dragalgite
Ability: Adaptability
Level: 50
EVs: 32 HP / 32 SpA / 2 SpD
Quiet Nature
- Toxic
- Flip Turn
- Dragon Pulse
- Sludge Wave
`.trim();

// cundangcap, Reg M-C — Charizardite Y sun with Venusaur, Scarf Garchomp,
// Incineroar, Toxapex and Sylveon. The games in recordings/showdown/mine-open/.
const MC_SUN_EXPORT = `
Charizard @ Charizardite Y
Ability: Blaze
Level: 50
EVs: 12 HP / 14 Def / 8 SpA / 32 Spe
Timid Nature
- Protect
- Heat Wave
- Weather Ball
- Ancient Power

Garchomp @ Choice Scarf
Ability: Rough Skin
Level: 50
EVs: 30 Atk / 4 Def / 32 Spe
Adamant Nature
- Dragon Claw
- Earthquake
- Rock Slide
- Stomping Tantrum

Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 26 Def / 6 SpD / 2 Spe
Impish Nature
- Flare Blitz
- Fake Out
- Throat Chop
- Parting Shot

Venusaur @ Life Orb
Ability: Chlorophyll
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Modest Nature
- Protect
- Leaf Storm
- Sludge Bomb
- Earth Power

Toxapex @ Leftovers
Ability: Regenerator
Level: 50
EVs: 32 HP / 18 Def / 16 SpD
Relaxed Nature
- Baneful Bunker
- Wide Guard
- Toxic
- Infestation

Sylveon @ Fairy Feather
Ability: Pixilate
Level: 50
EVs: 19 HP / 30 Def / 14 SpA / 3 Spe
Modest Nature
- Detect
- Yawn
- Hyper Voice
- Quick Attack
`.trim();

// cundangcap, Reg M-C — Pelipper rain and Farigiraf Trick Room behind Armor
// Tail, Mega Kangaskhan and Mega Mawile, Archaludon, Grapploct.
const MC_RAIN_EXPORT = `
Farigiraf @ Sitrus Berry
Ability: Armor Tail
Level: 50
EVs: 32 HP / 21 Def / 1 SpA / 12 SpD
Relaxed Nature
- Psychic
- Rain Dance
- Helping Hand
- Trick Room

Archaludon @ Leftovers
Ability: Stamina
Level: 50
EVs: 32 HP / 9 SpA / 25 SpD
Modest Nature
- Flash Cannon
- Dragon Pulse
- Electro Shot
- Protect

Pelipper @ Damp Rock
Ability: Drizzle
Level: 50
EVs: 32 HP / 32 SpA / 2 SpD
Modest Nature
- Weather Ball
- Hurricane
- Tailwind
- Protect

Mawile @ Mawilite
Ability: Hyper Cutter
Level: 50
Shiny: Yes
EVs: 32 HP / 32 Atk / 2 SpD
Adamant Nature
- Iron Head
- Play Rough
- Sucker Punch
- Protect

Kangaskhan @ Kangaskhanite
Ability: Scrappy
Level: 50
EVs: 14 HP / 32 Atk / 12 Def / 8 SpD
Adamant Nature
- Double-Edge
- Hammer Arm
- Crunch
- Fake Out

Grapploct @ Life Orb
Ability: Technician
Level: 50
Shiny: Yes
EVs: 32 HP / 32 Atk / 2 SpD
Adamant Nature
- Storm Throw
- Stomping Tantrum
- Mach Punch
- Detect
`.trim();

// cundangcap, Reg M-C — Tyranitar sand with Sand Rush Excadrill, Mega
// Salamence, Sinistcha's Trick Room and Rage Powder, Primarina, Gholdengo.
const MC_SAND_EXPORT = `
Tyranitar @ Tyranitarite
Ability: Sand Stream
Level: 50
EVs: 12 HP / 26 Atk / 1 SpD / 27 Spe
Adamant Nature
- Rock Slide
- Knock Off
- Low Kick
- Protect

Excadrill @ Focus Sash
Ability: Sand Rush
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Adamant Nature
- High Horsepower
- Swords Dance
- Iron Head
- Protect

Salamence @ Salamencite
Ability: Intimidate
Level: 50
EVs: 1 HP / 32 SpA / 1 SpD / 32 Spe
Timid Nature
- Hyper Voice
- Flamethrower
- Tailwind
- Protect

Sinistcha @ Sitrus Berry
Ability: Hospitality
Level: 50
EVs: 31 HP / 10 Def / 25 SpD
Calm Nature
- Matcha Gotcha
- Rage Powder
- Trick Room
- Protect

Primarina @ Life Orb
Ability: Liquid Voice
Level: 50
EVs: 26 HP / 3 Def / 14 SpA / 23 Spe
Modest Nature
- Moonblast
- Hyper Voice
- Dazzling Gleam
- Protect

Gholdengo @ Leftovers
Ability: Good as Gold
Level: 50
EVs: 31 HP / 2 Def / 17 SpA / 1 SpD / 15 Spe
Modest Nature
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect
`.trim();

// cundangcap, Reg M-C — Politoed rain with Perish Song from Politoed and Mega
// Gengar, Vivillon's Sleep Powder and Rage Powder, Incineroar, Rillaboom,
// Kommo-o.
const MC_PERISH_EXPORT = `
Vivillon @ Focus Sash
Ability: Compound Eyes
Level: 50
EVs: 9 Def / 25 SpA / 32 Spe
Timid Nature
- Sleep Powder
- Rage Powder
- Hurricane
- Protect

Politoed @ Sitrus Berry
Ability: Drizzle
Level: 50
EVs: 32 HP / 24 Def / 10 SpD
Calm Nature
- Weather Ball
- Perish Song
- Encore
- Protect

Gengar @ Gengarite
Ability: Cursed Body
Level: 50
EVs: 30 HP / 18 Def / 11 SpD / 7 Spe
Modest Nature
- Shadow Ball
- Sludge Bomb
- Perish Song
- Protect

Incineroar @ Passho Berry
Ability: Intimidate
Level: 50
EVs: 31 HP / 21 Def / 14 SpD
Relaxed Nature
- Protect
- Fake Out
- Flare Blitz
- Parting Shot

Rillaboom @ Occa Berry
Ability: Grassy Surge
Level: 50
EVs: 32 HP / 5 Atk / 29 SpD
Adamant Nature
- Fake Out
- Grassy Glide
- U-turn
- Protect

Kommo-o @ Leftovers
Ability: Soundproof
Level: 50
EVs: 10 HP / 1 Def / 22 SpA / 1 SpD / 32 Spe
Modest Nature
- Clanging Scales
- Clangorous Soul
- Aura Sphere
- Protect
`.trim();

// Named matchups. `fixture` is the scripted harness pair; `alt` is a
// full-length battle between two real teams. The rest are your own teams for
// replays against someone who did not share a sheet: one side only, which
// `--teams` gives to whichever side its species match.
const TEAM_SETS = {
  fixture: { p1: P1_EXPORT, p2: P2_EXPORT },
  alt: { p1: P1_ALT_EXPORT, p2: P2_ALT_EXPORT },
  'mc-sun': { p1: MC_SUN_EXPORT },
  'mc-rain': { p1: MC_RAIN_EXPORT },
  'mc-sand': { p1: MC_SAND_EXPORT },
  'mc-perish': { p1: MC_PERISH_EXPORT },
};

module.exports = {
  P1_EXPORT, P2_EXPORT, P1_ALT_EXPORT, P2_ALT_EXPORT, MC_SUN_EXPORT, MC_RAIN_EXPORT, MC_SAND_EXPORT, MC_PERISH_EXPORT, TEAM_SETS,
};
