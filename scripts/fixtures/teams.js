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
// Reg M-B requires a six-Pokemon team, but Team Preview brings only four, so the
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

// Named matchups. `fixture` is the scripted harness pair; `alt` is a
// full-length battle between two real teams.
const TEAM_SETS = {
  fixture: { p1: P1_EXPORT, p2: P2_EXPORT },
  alt: { p1: P1_ALT_EXPORT, p2: P2_ALT_EXPORT },
};

module.exports = { P1_EXPORT, P2_EXPORT, P1_ALT_EXPORT, P2_ALT_EXPORT, TEAM_SETS };
