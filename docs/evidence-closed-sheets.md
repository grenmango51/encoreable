# Evidence, closed team sheets — what every legal effect names, where it goes, and what it gives away

**Generated** by `npm run catalog` (`scripts/local-catalog.mjs`). Do not edit by hand:
`npm run catalog -- --check` fails when this file and a fresh run disagree.
**Format:** `gen9championsvgc2026regmc`, simulator `pokemon-showdown` at `a5df827`.
**Pool:** 293 species, 203 abilities, 510 moves, 166 items, 94 conditions, 25 natures.
**Read with:** `evidence-catalog.md` §1–§2.

## 0. How to read a card

A Bo1 replay publishes no team sheet, so a Pokemon's item, ability, nature and unused moves are unknown. Every
battle of the open-sheet probe, at base Stat Points, was read by `setsFromLog` from the spectator channel, the
way `npm run reconstruct` reads such a replay. Only what an effect adds is listed: a box judgement its control
battle also has belongs to the battle.

| Verdict | Meaning |
|---|---|
| READ | a line names it, and the right Pokemon's box holds it |
| MISSED | a line names it, and the box stays empty or assumed |
| MISREAD | a box holds a value that is not that Pokemon's |
| FALSE | a box holds a value that belongs to another Pokemon in the battle |
| SILENT-SINK | an item, ability or nature on the hidden Pokemon changed the log, against its control, before any line named it |
| HAZARD-UNSOUND | rebuilt from that log with today's assumptions (no item, the first ability listed, a neutral nature), the hidden Pokemon loses its real spread |
| HAZARD-REBUILD | the same rebuild does not reproduce the log |
| TRUE-SET-FAILS | not a hazard: the rebuild fails as badly with the real item, ability and nature, so the fault is the inference's, and the open-sheet report lists it |
| SAFE | the same rebuild keeps the real spread |

Witnesses: `W-phys-dealt`/`W-spec-dealt` the hidden Pokemon hits the known one; `-taken` it is hit four times;
`W-trade` it is hit by a priority move and hits back; `W-burn` … `W-taunt` it is given that status and then
attacks; `W-lethal` a one-hit KO; `W-order-up`/`-down` a known Pokemon one point of Speed faster or slower;
`W-pivot` it switches out and back; `W-two-moves` two different moves in a row; `W-<Type>-…` a hit of a type
its handlers name. A control's own rebuild is shown when it is not SAFE, since then the hazard is not the effect's.

## 1. Summary

| Kind | Effects | READ | MISSED | MISREAD | FALSE | Silent (no line names it) | SILENT-SINK witnesses | HAZARD-UNSOUND | HAZARD-REBUILD | TRUE-SET-FAILS |
|---|---|---|---|---|---|---|---|---|---|---|
| move | 510 | 1389 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ability | 203 | 109 | 17 | 6 | 0 | 131 | 172 | 42 | 14 | 37 |
| item | 166 | 130 | 2 | 4 | 2 | 48 | 74 | 63 | 0 | 4 |
| condition | 94 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| nature | 25 | 0 | 0 | 0 | 0 | 25 | 44 | 28 | 0 | 0 |

## 2. Work list

### 2.1 MISREAD and FALSE — `setsFromLog` puts something in the wrong box

| Effect | Template | Pokemon | Box | Read | Truth | Verdict | Line |
|---|---|---|---|---|---|---|---|
| `ability:armortail` | holder-hidden/W-trade | p2 Farigiraf | move | Quick Attack | — | MISREAD | `\|cant\|p2a: Farigiraf\|ability: Armor Tail\|Quick Attack\|[of] p1a: Snorlax` |
| `ability:illusion` | holder-hidden/W-phys-dealt | p2 Slowking | move | Strength | — | MISREAD | `\|move\|p2a: Slowking\|Strength\|p1a: Snorlax` |
| `ability:illusion` | holder-hidden/W-spec-dealt | p2 Slowking | move | Round | — | MISREAD | `\|move\|p2a: Slowking\|Round\|p1a: Snorlax` |
| `ability:illusion` | other-hidden/W-phys-taken | p1 Mudsdale | move | Strength | — | MISREAD | `\|move\|p1a: Mudsdale\|Strength\|p2a: Blastoise` |
| `ability:illusion` | other-hidden/W-spec-taken | p1 Mudsdale | move | Round | — | MISREAD | `\|move\|p1a: Mudsdale\|Round\|p2a: Blastoise` |
| `ability:queenlymajesty` | holder-hidden/W-trade | p2 Tsareena | move | Quick Attack | — | MISREAD | `\|cant\|p2a: Tsareena\|ability: Queenly Majesty\|Quick Attack\|[of] p1a: Snorlax` |
| `item:abomasite` | holder-hidden/W-phys-dealt | p2 Abomasnow | ability | Snow Warning | Soundproof | MISREAD | `\|-weather\|Snowscape\|[from] ability: Snow Warning\|[of] p2a: Abomasnow` |
| `item:blazikenite` | holder-hidden/W-phys-dealt | p2 Blaziken | ability | Speed Boost | Blaze | MISREAD | `\|-ability\|p2a: Blaziken\|Speed Boost\|boost` |
| `item:greninjite` | holder-hidden/W-phys-dealt | p2 Greninja | ability | Protean | Torrent | MISREAD | `\|-start\|p2a: Greninja\|typechange\|Normal\|[from] ability: Protean` |
| `item:rockyhelmet` | holder-hidden/W-phys-taken | p1 Snorlax | item | Rocky Helmet | Heat Rock | FALSE (Blastoise's) | `\|-damage\|p1a: Snorlax\|83/100\|[from] item: Rocky Helmet\|[of] p2a: Blastoise` |
| `item:rockyhelmet` | other-hidden/W-phys-dealt | p2 Blastoise | item | Rocky Helmet | — | FALSE (Snorlax's) | `\|-damage\|p2a: Blastoise\|83/100\|[from] item: Rocky Helmet\|[of] p1a: Snorlax` |
| `item:scraftinite` | holder-hidden/W-phys-dealt | p2 Scrafty | ability | Intimidate | Run Away | MISREAD | `\|-ability\|p2a: Scrafty\|Intimidate\|boost` |

### 2.2 MISSED — the log names it and `setsFromLog` does not read it

| Effect | Template | Pokemon | Box | Truth | Line |
|---|---|---|---|---|---|
| `move:entrainment` | user-hidden/quiet | p1 Snorlax | ability | Gluttony | `\|-ability\|p1a: Snorlax\|Klutz\|Gluttony\|[from] move: Entrainment\|[of] p2a: Audino` |
| `move:entrainment` | user-hidden/quiet | p2 Audino | ability | Klutz | `\|-ability\|p1a: Snorlax\|Klutz\|Gluttony\|[from] move: Entrainment\|[of] p2a: Audino` |
| `move:entrainment` | target-hidden/quiet | p2 Blastoise | ability | Torrent | `\|-ability\|p2a: Blastoise\|Gluttony\|Torrent\|[from] move: Entrainment\|[of] p1a: Snorlax` |
| `move:entrainment` | target-hidden/pace | p1 Ampharos | ability | Plus | `\|-ability\|p2a: Blastoise\|Plus\|Torrent\|[from] move: Entrainment\|[of] p1a: Ampharos` |
| `move:poltergeist` | user-hidden/quiet | p1 Slowbro | item | Heat Rock | `\|-activate\|p1a: Slowbro\|move: Poltergeist\|Heat Rock` |
| `move:poltergeist` | target-hidden/quiet | p2 Blastoise | item | Smooth Rock | `\|-activate\|p2a: Blastoise\|move: Poltergeist\|Smooth Rock` |
| `move:roleplay` | user-hidden/quiet | p1 Snorlax | ability | Gluttony | `\|-ability\|p2a: Mr. Rime\|Gluttony\|Tangled Feet\|[from] move: Role Play\|[of] p1a: Snorlax` |
| `move:roleplay` | user-hidden/quiet | p2 Mr. Rime | ability | Tangled Feet | `\|-ability\|p2a: Mr. Rime\|Gluttony\|Tangled Feet\|[from] move: Role Play\|[of] p1a: Snorlax` |
| `move:roleplay` | user-hidden/pace | p1 Ampharos | ability | Plus | `\|-ability\|p2a: Mr. Rime\|Plus\|Tangled Feet\|[from] move: Role Play\|[of] p1a: Ampharos` |
| `move:roleplay` | target-hidden/quiet | p2 Blastoise | ability | Torrent | `\|-ability\|p1a: Snorlax\|Torrent\|Gluttony\|[from] move: Role Play\|[of] p2a: Blastoise` |
| `move:simplebeam` | user-hidden/quiet | p1 Snorlax | ability | Gluttony | `\|-ability\|p1a: Snorlax\|Simple\|Gluttony\|[from] move: Simple Beam` |
| `move:simplebeam` | target-hidden/quiet | p2 Blastoise | ability | Torrent | `\|-ability\|p2a: Blastoise\|Simple\|Torrent\|[from] move: Simple Beam` |
| `move:skillswap` | user-hidden/quiet | p1 Snorlax | ability | Gluttony | `\|-activate\|p2a: Umbreon\|Skill Swap\|Gluttony\|Inner Focus\|[of] p1a: Snorlax` |
| `move:skillswap` | user-hidden/quiet | p2 Umbreon | ability | Inner Focus | `\|-activate\|p2a: Umbreon\|Skill Swap\|Gluttony\|Inner Focus\|[of] p1a: Snorlax` |
| `move:skillswap` | user-hidden/pace | p1 Ampharos | ability | Plus | `\|-activate\|p2a: Umbreon\|Skill Swap\|Plus\|Inner Focus\|[of] p1a: Ampharos` |
| `move:skillswap` | target-hidden/quiet | p2 Blastoise | ability | Torrent | `\|-activate\|p1a: Snorlax\|Skill Swap\|Torrent\|Gluttony\|[of] p2a: Blastoise` |
| `move:worryseed` | user-hidden/quiet | p1 Snorlax | ability | Gluttony | `\|-ability\|p1a: Snorlax\|Insomnia\|Gluttony\|[from] move: Worry Seed` |
| `move:worryseed` | target-hidden/quiet | p2 Blastoise | ability | Torrent | `\|-ability\|p2a: Blastoise\|Insomnia\|Torrent\|[from] move: Worry Seed` |
| `ability:armortail` | holder-hidden/W-trade | p2 Farigiraf | ability | Armor Tail | `\|cant\|p2a: Farigiraf\|ability: Armor Tail\|Quick Attack\|[of] p1a: Snorlax` |
| `ability:aromaveil` | holder-hidden/W-taunt | p2 Alcremie | ability | Aroma Veil | `\|-block\|p2a: Alcremie\|ability: Aroma Veil\|[of] p2a: Alcremie` |
| `ability:flashfire` | holder-hidden/W-burn | p2 Armarouge | ability | Flash Fire | `\|-start\|p2a: Armarouge\|ability: Flash Fire` |
| `ability:flashfire` | other-hidden/W-Fire-dealt | p1 Armarouge | ability | Flash Fire | `\|-start\|p1a: Armarouge\|ability: Flash Fire` |
| `ability:illusion` | holder-hidden/W-spec-taken | p2 Slowking | move | Splash | `\|move\|p2a: Slowking\|Splash\|p2a: Slowking` |
| `ability:illusion` | other-hidden/W-phys-dealt | p1 Mudsdale | move | Splash | `\|move\|p1a: Mudsdale\|Splash\|p1a: Mudsdale` |
| `ability:magician` | holder-hidden/W-phys-dealt | p1 Snorlax | item | Heat Rock | `\|-item\|p2a: Delphox\|Heat Rock\|[from] ability: Magician\|[of] p1a: Snorlax` |
| `ability:mummy` | holder-hidden/W-phys-taken | p1 Snorlax | ability | Gluttony | `\|-activate\|p2a: Cofagrigus\|ability: Mummy\|p1a: Snorlax\|[ability] Gluttony` |
| `ability:mummy` | other-hidden/W-phys-dealt | p2 Blastoise | ability | Torrent | `\|-activate\|p1a: Cofagrigus\|ability: Mummy\|p2a: Blastoise\|[ability] Torrent` |
| `ability:queenlymajesty` | holder-hidden/W-trade | p2 Tsareena | ability | Queenly Majesty | `\|cant\|p2a: Tsareena\|ability: Queenly Majesty\|Quick Attack\|[of] p1a: Snorlax` |
| `ability:sweetveil` | holder-hidden/W-sleep | p2 Tsareena | ability | Sweet Veil | `\|-block\|p2a: Tsareena\|ability: Sweet Veil\|[of] p2a: Tsareena` |
| `ability:trace` | holder-hidden/W-phys-dealt | p1 Snorlax | ability | Gluttony | `\|-ability\|p2a: Gardevoir\|Gluttony\|Trace\|[from] ability: Trace\|[of] p1a: Snorlax` |
| `ability:trace` | holder-hidden/W-order-up | p1 Ampharos | ability | Plus | `\|-ability\|p2a: Gardevoir\|Plus\|Trace\|[from] ability: Trace\|[of] p1a: Ampharos` |
| `ability:trace` | holder-hidden/W-pivot | p1 Torkoal | ability | Shell Armor | `\|-ability\|p2a: Gardevoir\|Shell Armor\|Trace\|[from] ability: Trace\|[of] p1b: Torkoal` |
| `ability:trace` | other-hidden/W-phys-dealt | p2 Blastoise | ability | Torrent | `\|-ability\|p1a: Gardevoir\|Torrent\|Trace\|[from] ability: Trace\|[of] p2a: Blastoise` |
| `ability:wanderingspirit` | holder-hidden/W-phys-taken | p1 Snorlax | ability | Gluttony | `\|-activate\|p1a: Snorlax\|Skill Swap\|Wandering Spirit\|Gluttony\|[of] p2a: Runerigus` |
| `ability:wanderingspirit` | other-hidden/W-phys-dealt | p2 Blastoise | ability | Torrent | `\|-activate\|p2a: Blastoise\|Skill Swap\|Wandering Spirit\|Torrent\|[of] p1a: Runerigus` |
| `item:alakazite` | holder-hidden/W-phys-dealt | p1 Snorlax | ability | Gluttony | `\|-ability\|p2a: Alakazam\|Gluttony\|Trace\|[from] ability: Trace\|[of] p1a: Snorlax` |
| `item:meowsticite` | holder-hidden/W-phys-dealt | p1 Snorlax | ability | Gluttony | `\|-ability\|p2a: Meowstic\|Gluttony\|Trace\|[from] ability: Trace\|[of] p1a: Snorlax` |

### 2.3 HAZARD — today's assumption about the effect removes the real spread or breaks the rebuild

Only where the same witness without the effect rebuilds SAFE, so the hazard is the effect's.

| Effect | Weight | Witness | Sinks | Verdict | Last event that cut the hidden Pokemon, or where the rebuild broke |
|---|---|---|---|---|---|
| `item:blackbelt` | 293 | W-Fighting-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Brick Break hit Snorlax |
| `item:blackglasses` | 293 | W-Dark-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Crunch hit Snorlax |
| `item:charcoal` | 293 | W-Fire-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Fire Punch hit Snorlax |
| `item:choicescarf` | 293 | W-order-up | order | HAZARD-UNSOUND | turn 1: Blastoise acted before Ampharos |
| `item:dragonfang` | 293 | W-Dragon-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Dragon Claw hit Snorlax |
| `item:fairyfeather` | 293 | W-Fairy-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Play Rough hit Snorlax |
| `item:hardstone` | 293 | W-Rock-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Stone Edge hit Snorlax |
| `item:ironball` | 293 | W-burn | order | HAZARD-UNSOUND | turn 2: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-Flying-taken | order | HAZARD-UNSOUND | turn 3: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-Ground-taken | order | HAZARD-UNSOUND | turn 3: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-order-down | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `item:ironball` | 293 | W-pace | order | HAZARD-UNSOUND | turn 1: Shuckle acted before Blastoise |
| `item:ironball` | 293 | W-paralysis | order | HAZARD-UNSOUND | turn 2: Torkoal acted before Blastoise |
| `item:ironball` | 293 | W-phys-taken | presence | HAZARD-UNSOUND | turn 3: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-sleep | order, presence | HAZARD-UNSOUND | turn 2: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-spec-taken | order | HAZARD-UNSOUND | turn 3: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-taunt | order | HAZARD-UNSOUND | turn 2: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-toxic | order | HAZARD-UNSOUND | turn 2: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-trade | order | HAZARD-UNSOUND | turn 3: Snorlax acted before Blastoise |
| `item:ironball` | 293 | W-two-moves | order | HAZARD-UNSOUND | turn 3: Snorlax acted before Blastoise |
| `item:magnet` | 293 | W-Electric-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Thunder Punch hit Snorlax |
| `item:metalcoat` | 293 | W-Steel-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Iron Head hit Snorlax |
| `item:metronome` | 293 | W-burn | known exact | HAZARD-UNSOUND | turn 4: Blastoise's Strength hit Snorlax |
| `item:metronome` | 293 | W-paralysis | known exact | HAZARD-UNSOUND | turn 4: Blastoise's Strength hit Snorlax |
| `item:metronome` | 293 | W-taunt | known exact | HAZARD-UNSOUND | turn 4: Blastoise's Strength hit Snorlax |
| `item:metronome` | 293 | W-toxic | known exact | HAZARD-UNSOUND | — |
| `item:metronome` | 293 | W-trade | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Strength hit Snorlax |
| `item:miracleseed` | 293 | W-Grass-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Leaf Blade hit Snorlax |
| `item:muscleband` | 293 | W-burn | known exact | HAZARD-UNSOUND | turn 4: brn on Blastoise |
| `item:muscleband` | 293 | W-paralysis | known exact | HAZARD-UNSOUND | turn 4: Snorlax acted before Blastoise |
| `item:muscleband` | 293 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `item:muscleband` | 293 | W-sleep | known exact | HAZARD-UNSOUND | turn 4: Blastoise's Strength hit Snorlax |
| `item:muscleband` | 293 | W-taunt | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Strength hit Snorlax |
| `item:muscleband` | 293 | W-toxic | known exact | HAZARD-UNSOUND | — |
| `item:muscleband` | 293 | W-trade | known exact | HAZARD-UNSOUND | turn 2: Snorlax's Quick Attack hit Blastoise |
| `item:muscleband` | 293 | W-two-moves | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Round hit Snorlax |
| `item:mysticwater` | 293 | W-Water-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Waterfall hit Snorlax |
| `item:nevermeltice` | 293 | W-Ice-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Ice Punch hit Snorlax |
| `item:poisonbarb` | 293 | W-Poison-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Poison Jab hit Snorlax |
| `item:sharpbeak` | 293 | W-Flying-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Drill Peck hit Snorlax |
| `item:silkscarf` | 293 | W-burn | known exact | HAZARD-UNSOUND | turn 4: brn on Blastoise |
| `item:silkscarf` | 293 | W-Normal-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `item:silkscarf` | 293 | W-paralysis | known exact | HAZARD-UNSOUND | turn 4: Snorlax acted before Blastoise |
| `item:silkscarf` | 293 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `item:silkscarf` | 293 | W-sleep | known exact | HAZARD-UNSOUND | turn 4: Blastoise's Strength hit Snorlax |
| `item:silkscarf` | 293 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Round hit Snorlax |
| `item:silkscarf` | 293 | W-taunt | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Strength hit Snorlax |
| `item:silkscarf` | 293 | W-toxic | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Strength hit Snorlax |
| `item:silkscarf` | 293 | W-trade | known exact | HAZARD-UNSOUND | turn 2: Snorlax's Quick Attack hit Blastoise |
| `item:silkscarf` | 293 | W-two-moves | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Round hit Snorlax |
| `item:silverpowder` | 293 | W-Bug-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's X-Scissor hit Snorlax |
| `item:softsand` | 293 | W-Ground-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's High Horsepower hit Snorlax |
| `item:twistedspoon` | 293 | W-Psychic-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Zen Headbutt hit Snorlax |
| `item:wiseglasses` | 293 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Round hit Snorlax |
| `item:wiseglasses` | 293 | W-two-moves | known exact | HAZARD-UNSOUND | turn 2: Blastoise's Round hit Snorlax |
| `ability:technician` | 10 | W-paralysis | order, presence | HAZARD-REBUILD | turn 1: wanted \|-status\|p2a: Grapploct\|par, got \|-immune\|p2a: Grapploct\|[from] ability: Limber |
| `ability:technician` | 10 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Grapploct's Round hit Snorlax |
| `ability:technician` | 10 | W-two-moves | known exact | HAZARD-UNSOUND | turn 2: Grapploct's Round hit Snorlax |
| `ability:aromaveil` | 9 | W-sleep | known exact, presence | HAZARD-REBUILD | turn 1: wanted \|-status\|p2a: Alcremie\|slp\|[from] move: Hypnosis, got \|-block\|p2a: Alcremie\|ability: Sweet Veil\|[of] p2a: Alcremie |
| `ability:unburden` | 6 | W-sleep | known exact, presence | HAZARD-REBUILD | turn 1: wanted \|-status\|p2a: Slurpuff\|slp\|[from] move: Hypnosis, got \|-block\|p2a: Slurpuff\|ability: Sweet Veil\|[of] p2a: Slurpuff |
| `ability:hustle` | 5 | W-burn | known exact | HAZARD-UNSOUND | turn 2: Flapple's Strength hit Snorlax |
| `ability:hustle` | 5 | W-paralysis | known exact | HAZARD-UNSOUND | turn 2: Flapple's Strength hit Snorlax |
| `ability:hustle` | 5 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Flapple's Strength hit Snorlax |
| `ability:hustle` | 5 | W-sleep | known exact | HAZARD-UNSOUND | turn 4: Flapple's Strength hit Snorlax |
| `ability:hustle` | 5 | W-taunt | known exact | HAZARD-UNSOUND | turn 2: Flapple's Strength hit Snorlax |
| `ability:hustle` | 5 | W-trade | known exact | HAZARD-UNSOUND | turn 1: Flapple's Strength hit Snorlax |
| `ability:hustle` | 5 | W-two-moves | known exact | HAZARD-UNSOUND | turn 1: Flapple's Strength hit Snorlax |
| `ability:rockhead` | 5 | W-lethal | presence | HAZARD-REBUILD | turn 1: wanted \|-damage\|p2a: Aggron\|0 fnt, got \|-immune\|p2a: Aggron\|[from] ability: Sturdy |
| `ability:magicguard` | 3 | W-burn | presence | HAZARD-REBUILD | turn 1: wanted \|upkeep, got \|-damage\|p2a: Clefable\|94/100 brn\|[from] brn |
| `ability:magicguard` | 3 | W-toxic | presence | HAZARD-REBUILD | turn 1: wanted \|upkeep, got \|-damage\|p2a: Clefable\|94/100 tox\|[from] psn |
| `ability:dryskin` | 2 | W-Fire-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Fire Punch hit Toxicroak |
| `ability:heatproof` | 2 | W-burn | hidden % | HAZARD-UNSOUND | turn 1: brn on Sinistcha |
| `ability:heatproof` | 2 | W-Fire-taken | hidden %, presence | HAZARD-UNSOUND | turn 1: Snorlax's Fire Punch hit Sinistcha |
| `ability:hugepower` | 2 | W-burn | known exact | HAZARD-UNSOUND | turn 2: Azumarill's Strength hit Snorlax |
| `ability:hugepower` | 2 | W-paralysis | known exact | HAZARD-UNSOUND | turn 2: Azumarill's Strength hit Snorlax |
| `ability:hugepower` | 2 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Azumarill's Strength hit Snorlax |
| `ability:hugepower` | 2 | W-sleep | known exact | HAZARD-UNSOUND | turn 4: Azumarill's Strength hit Snorlax |
| `ability:hugepower` | 2 | W-taunt | known exact | HAZARD-UNSOUND | turn 2: Azumarill's Strength hit Snorlax |
| `ability:hugepower` | 2 | W-trade | known exact | HAZARD-UNSOUND | turn 1: Azumarill's Strength hit Snorlax |
| `ability:hugepower` | 2 | W-two-moves | known exact | HAZARD-UNSOUND | turn 1: Azumarill's Strength hit Snorlax |
| `ability:filter` | 1 | W-spec-taken | presence | HAZARD-REBUILD | turn 1: wanted \|-damage\|p2a: Mr. Mime\|78/100, got \|-immune\|p2a: Mr. Mime\|[from] ability: Soundproof |
| `ability:fluffy` | 1 | W-phys-taken | hidden %, presence | HAZARD-UNSOUND | turn 1: Snorlax's Dragon Claw hit Houndstone |
| `ability:fluffy` | 1 | W-pivot | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Dragon Claw hit Houndstone |
| `ability:heavymetal` | 1 | W-lethal | presence | HAZARD-REBUILD | turn 1: wanted \|-damage\|p2a: Aggron\|0 fnt, got \|-immune\|p2a: Aggron\|[from] ability: Sturdy |
| `ability:liquidvoice` | 1 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Primarina's Round hit Snorlax |
| `ability:liquidvoice` | 1 | W-two-moves | known exact | HAZARD-UNSOUND | turn 2: Primarina's Round hit Snorlax |
| `ability:multiscale` | 1 | W-phys-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Strength hit Dragonite |
| `ability:multiscale` | 1 | W-pivot | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Strength hit Dragonite |
| `ability:multiscale` | 1 | W-spec-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Round hit Dragonite |
| `ability:multiscale` | 1 | W-trade | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Quick Attack hit Dragonite |
| `ability:quickdraw` | 1 | W-confusion | presence | HAZARD-REBUILD | turn 2: wanted \|-activate\|p2a: Slowbro\|ability: Quick Draw, got \|-activate\|p2a: Slowbro\|confusion |
| `ability:stall` | 1 | W-burn | order | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-confusion | hidden %, presence | HAZARD-REBUILD | turn 1: wanted \|move\|p1a: Snorlax\|Confuse Ray\|p2a: Sableye, got \|-activate\|p2a: Sableye\|move: Struggle |
| `ability:stall` | 1 | W-lethal | presence | HAZARD-REBUILD | turn 1: wanted \|move\|p1a: Snorlax\|Sheer Cold\|p2a: Sableye, got \|-activate\|p2a: Sableye\|move: Struggle |
| `ability:stall` | 1 | W-order-down | order | HAZARD-UNSOUND | turn 1: Torkoal acted before Sableye |
| `ability:stall` | 1 | W-order-up | order | HAZARD-UNSOUND | turn 1: Torkoal acted before Sableye |
| `ability:stall` | 1 | W-pace | order | HAZARD-UNSOUND | turn 1: Torkoal acted before Sableye |
| `ability:stall` | 1 | W-paralysis | order | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-phys-dealt | order | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-phys-taken | order, presence | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-pivot | order | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-sleep | known exact, order, presence | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-spec-dealt | order | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-spec-taken | order, presence | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-taunt | order, presence | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:stall` | 1 | W-trade | order | HAZARD-UNSOUND | turn 1: Torkoal acted before Sableye |
| `ability:stall` | 1 | W-two-moves | order | HAZARD-UNSOUND | turn 1: Snorlax acted before Sableye |
| `ability:steelyspirit` | 1 | W-Steel-dealt | known exact | HAZARD-UNSOUND | turn 1: Perrserker's Iron Head hit Snorlax |
| `ability:supremeoverlord` | 1 | W-lethal | presence | HAZARD-REBUILD | turn 1: wanted \|-end\|p2a: Kingambit\|fallenundefined\|[silent], got \|-ohko |
| `ability:supremeoverlord` | 1 | W-pivot | presence | HAZARD-REBUILD | turn 2: wanted \|-end\|p2a: Kingambit\|fallenundefined\|[silent], got \|switch\|p2a: Slowking\|Slowking, L50, F\|100/100 |
| `item:lightball` | 1 | W-burn | known exact | HAZARD-UNSOUND | turn 2: Pikachu's Strength hit Snorlax |
| `item:lightball` | 1 | W-paralysis | known exact | HAZARD-UNSOUND | turn 2: Pikachu's Strength hit Snorlax |
| `item:lightball` | 1 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Pikachu's Strength hit Snorlax |
| `item:lightball` | 1 | W-sleep | known exact | HAZARD-UNSOUND | turn 4: Pikachu's Strength hit Snorlax |
| `item:lightball` | 1 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Pikachu's Round hit Snorlax |
| `item:lightball` | 1 | W-taunt | known exact | HAZARD-UNSOUND | turn 2: Pikachu's Strength hit Snorlax |
| `item:lightball` | 1 | W-trade | known exact | HAZARD-UNSOUND | turn 1: Pikachu's Strength hit Snorlax |
| `item:lightball` | 1 | W-two-moves | known exact | HAZARD-UNSOUND | turn 1: Pikachu's Strength hit Snorlax |
| `nature:adamant` | 1 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `nature:brave` | 1 | W-order-down | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:brave` | 1 | W-pace | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:brave` | 1 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `nature:gentle` | 1 | W-phys-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Strength hit Blastoise |
| `nature:hasty` | 1 | W-order-up | order | HAZARD-UNSOUND | turn 1: Blastoise acted before Ampharos |
| `nature:hasty` | 1 | W-phys-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Strength hit Blastoise |
| `nature:jolly` | 1 | W-order-up | order | HAZARD-UNSOUND | turn 1: Blastoise acted before Ampharos |
| `nature:lax` | 1 | W-spec-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Round hit Blastoise |
| `nature:lonely` | 1 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `nature:lonely` | 1 | W-phys-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Strength hit Blastoise |
| `nature:mild` | 1 | W-phys-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Strength hit Blastoise |
| `nature:mild` | 1 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Round hit Snorlax |
| `nature:modest` | 1 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Round hit Snorlax |
| `nature:naive` | 1 | W-order-up | order | HAZARD-UNSOUND | turn 1: Blastoise acted before Ampharos |
| `nature:naive` | 1 | W-spec-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Round hit Blastoise |
| `nature:naughty` | 1 | W-phys-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Strength hit Snorlax |
| `nature:naughty` | 1 | W-spec-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Round hit Blastoise |
| `nature:quiet` | 1 | W-order-down | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:quiet` | 1 | W-pace | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:quiet` | 1 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Round hit Snorlax |
| `nature:rash` | 1 | W-spec-dealt | known exact | HAZARD-UNSOUND | turn 1: Blastoise's Round hit Snorlax |
| `nature:rash` | 1 | W-spec-taken | hidden % | HAZARD-UNSOUND | turn 1: Snorlax's Round hit Blastoise |
| `nature:relaxed` | 1 | W-order-down | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:relaxed` | 1 | W-pace | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:sassy` | 1 | W-order-down | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:sassy` | 1 | W-pace | order | HAZARD-UNSOUND | turn 1: Ampharos acted before Blastoise |
| `nature:timid` | 1 | W-order-up | order | HAZARD-UNSOUND | turn 1: Blastoise acted before Ampharos |

Witness battles whose control, without the effect, does not rebuild SAFE either — a defect of the battle or of the rebuild, not of the effect:

| Effect | Witness | Effect's rebuild | Control's rebuild | Control: last event, or where it broke |
|---|---|---|---|---|
| `ability:poisonheal` | W-toxic | HAZARD-REBUILD | HAZARD-REBUILD | turn 1: wanted \|-damage\|p2a: Gliscor\|172/182 tox\|[from] psn, got \|-damage\|p2a: Gliscor\|171/182 tox\|[from] psn |
| `ability:stall` | W-toxic | TRUE-SET-FAILS | HAZARD-REBUILD | turn 2: wanted \|-damage\|p2a: Sableye\|131/157 tox\|[from] psn, got \|-damage\|p2a: Sableye\|130/157 tox\|[from] psn |
| `item:lightball` | W-toxic | TRUE-SET-FAILS | HAZARD-REBUILD | turn 1: wanted \|-damage\|p2a: Pikachu\|133/142 tox\|[from] psn, got \|-damage\|p2a: Pikachu\|134/142 tox\|[from] psn |

### 2.4 SILENT-SINK, by weight — candidate dimensions for closed-sheet inference

| Effect | Weight | Named by a line | Witnesses with a silent change |
|---|---|---|---|
| `item:blackbelt` | 293 | never | W-Fighting-dealt (known exact) |
| `item:blackglasses` | 293 | never | W-Dark-dealt (known exact) |
| `item:charcoal` | 293 | never | W-Fire-dealt (known exact) |
| `item:choicescarf` | 293 | never | W-phys-dealt (presence); W-spec-dealt (presence); W-order-up (order); W-trade (presence); W-burn (presence); W-paralysis (order, presence); W-toxic (presence); W-sleep (presence); W-taunt (presence); W-two-moves (presence) |
| `item:dragonfang` | 293 | never | W-Dragon-dealt (known exact) |
| `item:fairyfeather` | 293 | never | W-Fairy-dealt (known exact) |
| `item:hardstone` | 293 | never | W-Rock-dealt (known exact) |
| `item:ironball` | 293 | never | W-phys-taken (presence); W-spec-taken (order); W-order-down (order); W-pace (order); W-trade (order); W-Flying-taken (order); W-Ground-taken (order); W-burn (order); W-paralysis (order); W-toxic (order); W-sleep (order, presence); W-confusion (presence); W-taunt (order); W-two-moves (order) |
| `item:magnet` | 293 | never | W-Electric-dealt (known exact) |
| `item:metalcoat` | 293 | never | W-Steel-dealt (known exact) |
| `item:metronome` | 293 | never | W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-taunt (known exact) |
| `item:miracleseed` | 293 | never | W-Grass-dealt (known exact) |
| `item:muscleband` | 293 | never | W-phys-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `item:mysticwater` | 293 | never | W-Water-dealt (known exact) |
| `item:nevermeltice` | 293 | never | W-Ice-dealt (known exact) |
| `item:poisonbarb` | 293 | never | W-Poison-dealt (known exact) |
| `item:sharpbeak` | 293 | never | W-Flying-dealt (known exact) |
| `item:silkscarf` | 293 | never | W-phys-dealt (known exact); W-spec-dealt (known exact); W-trade (known exact); W-Normal-dealt (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `item:silverpowder` | 293 | never | W-Bug-dealt (known exact) |
| `item:softsand` | 293 | never | W-Ground-dealt (known exact) |
| `item:twistedspoon` | 293 | never | W-Psychic-dealt (known exact) |
| `item:wiseglasses` | 293 | never | W-spec-dealt (known exact); W-two-moves (known exact) |
| `ability:keeneye` | 11 | never | W-lethal (presence) |
| `ability:technician` | 10 | never | W-spec-dealt (known exact); W-paralysis (order, presence); W-two-moves (known exact) |
| `ability:aromaveil` | 9 | yes | W-sleep (known exact, presence) |
| `ability:guts` | 7 | never | W-burn (known exact, presence); W-paralysis (known exact, presence); W-toxic (known exact, presence) |
| `ability:pickup` | 6 | never | W-sleep (known exact, presence) |
| `ability:prankster` | 6 | never | W-order-up (order); W-pace (order) |
| `ability:unburden` | 6 | never | W-sleep (known exact, presence) |
| `ability:hustle` | 5 | never | W-phys-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:rockhead` | 5 | never | W-lethal (presence) |
| `ability:thickfat` | 4 | never | W-Fire-taken (hidden %); W-Ice-taken (hidden %) |
| `ability:magicguard` | 3 | never | W-burn (presence); W-toxic (presence) |
| `ability:noguard` | 3 | never | W-confusion (presence) |
| `ability:overcoat` | 3 | never | W-spec-taken (presence) |
| `ability:toughclaws` | 3 | never | W-phys-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:dryskin` | 2 | yes | W-Fire-taken (hidden %) |
| `ability:earlybird` | 2 | never | W-sleep (known exact, presence) |
| `ability:furcoat` | 2 | never | W-phys-taken (hidden %, names, presence); W-trade (hidden %); W-pivot (hidden %) |
| `ability:heatproof` | 2 | never | W-Fire-taken (hidden %, presence); W-burn (hidden %) |
| `ability:hugepower` | 2 | never | W-phys-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:illusion` | 2 | yes | W-phys-dealt (presence); W-spec-dealt (presence); W-phys-taken (presence); W-spec-taken (presence); W-order-up (presence); W-order-down (presence); W-pace (presence); W-trade (presence); W-burn (names, presence); W-paralysis (names, presence); W-toxic (names, presence); W-sleep (names, presence); W-confusion (names, presence); W-taunt (names, presence); W-lethal (presence); W-pivot (presence); W-two-moves (presence) |
| `ability:punkrock` | 2 | never | W-spec-dealt (known exact); W-spec-taken (hidden %, presence); W-two-moves (known exact) |
| `ability:rivalry` | 2 | never | W-phys-dealt (known exact); W-spec-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:stamina` | 2 | yes | W-lethal (presence) |
| `ability:filter` | 1 | never | W-spec-taken (presence) |
| `ability:fluffy` | 1 | never | W-phys-taken (hidden %, presence); W-pivot (hidden %) |
| `ability:heavymetal` | 1 | never | W-lethal (presence) |
| `ability:hungerswitch` | 1 | never | W-phys-dealt (presence); W-spec-dealt (presence); W-phys-taken (presence); W-spec-taken (presence); W-order-up (presence); W-order-down (presence); W-pace (presence); W-trade (presence); W-burn (presence); W-paralysis (presence); W-toxic (presence); W-sleep (presence); W-confusion (presence); W-taunt (presence); W-pivot (presence); W-two-moves (presence) |
| `ability:liquidvoice` | 1 | never | W-spec-dealt (known exact); W-two-moves (known exact) |
| `ability:merciless` | 1 | never | W-paralysis (order, presence) |
| `ability:multiscale` | 1 | never | W-phys-taken (hidden %); W-spec-taken (hidden %); W-trade (hidden %); W-pivot (hidden %) |
| `ability:pixilate` | 1 | never | W-phys-dealt (known exact); W-spec-dealt (known exact); W-trade (known exact); W-Normal-dealt (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:poisonheal` | 1 | never | W-toxic (presence) |
| `ability:purepower` | 1 | never | W-phys-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:purifyingsalt` | 1 | yes | W-Ghost-taken (hidden %); W-lethal (presence) |
| `ability:quickdraw` | 1 | yes | W-confusion (presence) |
| `ability:refrigerate` | 1 | never | W-phys-dealt (known exact); W-spec-dealt (known exact); W-trade (known exact); W-Normal-dealt (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `ability:stall` | 1 | never | W-phys-dealt (order); W-spec-dealt (order); W-phys-taken (order, presence); W-spec-taken (order, presence); W-order-up (order); W-order-down (order); W-pace (order); W-trade (order); W-burn (order); W-paralysis (order); W-toxic (order); W-sleep (known exact, order, presence); W-confusion (hidden %, presence); W-taunt (order, presence); W-lethal (presence); W-pivot (order); W-two-moves (order) |
| `ability:stalwart` | 1 | never | W-lethal (presence) |
| `ability:stancechange` | 1 | never | W-phys-dealt (known exact, presence); W-spec-dealt (known exact, presence); W-trade (known exact, presence); W-burn (known exact, presence); W-paralysis (known exact, presence); W-toxic (known exact, presence); W-sleep (known exact, presence); W-taunt (known exact, presence); W-two-moves (known exact, presence) |
| `ability:steelyspirit` | 1 | never | W-Steel-dealt (known exact) |
| `ability:supremeoverlord` | 1 | never | W-lethal (presence); W-pivot (presence) |
| `ability:waterbubble` | 1 | yes | W-Fire-taken (hidden %); W-Water-dealt (known exact) |
| `ability:zerotohero` | 1 | yes | W-pivot (presence) |
| `item:lightball` | 1 | never | W-phys-dealt (known exact); W-spec-dealt (known exact); W-trade (known exact); W-burn (known exact); W-paralysis (known exact); W-toxic (known exact); W-sleep (known exact); W-taunt (known exact); W-two-moves (known exact) |
| `nature:adamant` | 1 | never | W-phys-dealt (known exact); W-spec-dealt (known exact) |
| `nature:bold` | 1 | never | W-phys-dealt (known exact); W-phys-taken (hidden %) |
| `nature:brave` | 1 | never | W-phys-dealt (known exact); W-order-down (order); W-pace (order) |
| `nature:calm` | 1 | never | W-phys-dealt (known exact); W-spec-taken (hidden %) |
| `nature:careful` | 1 | never | W-spec-dealt (known exact); W-spec-taken (hidden %) |
| `nature:gentle` | 1 | never | W-phys-taken (hidden %); W-spec-taken (hidden %) |
| `nature:hasty` | 1 | never | W-phys-taken (hidden %); W-order-up (order) |
| `nature:impish` | 1 | never | W-spec-dealt (known exact); W-phys-taken (hidden %) |
| `nature:jolly` | 1 | never | W-spec-dealt (known exact); W-order-up (order) |
| `nature:lax` | 1 | never | W-phys-taken (hidden %); W-spec-taken (hidden %) |
| `nature:lonely` | 1 | never | W-phys-dealt (known exact); W-phys-taken (hidden %) |
| `nature:mild` | 1 | never | W-spec-dealt (known exact); W-phys-taken (hidden %) |
| `nature:modest` | 1 | never | W-phys-dealt (known exact); W-spec-dealt (known exact) |
| `nature:naive` | 1 | never | W-spec-taken (hidden %); W-order-up (order) |
| `nature:naughty` | 1 | never | W-phys-dealt (known exact); W-spec-taken (hidden %) |
| `nature:quiet` | 1 | never | W-spec-dealt (known exact); W-order-down (order); W-pace (order) |
| `nature:rash` | 1 | never | W-spec-dealt (known exact); W-spec-taken (hidden %) |
| `nature:relaxed` | 1 | never | W-phys-taken (hidden %); W-order-down (order); W-pace (order) |
| `nature:sassy` | 1 | never | W-spec-taken (hidden %); W-order-down (order); W-pace (order) |
| `nature:timid` | 1 | never | W-phys-dealt (known exact); W-order-up (order) |

## 3. Moves

### 3.1 Move box only

Named by its own `|move|` line and read into its user's move box, in every placement it was used, and naming nothing else.

| Move | Users | Hidden user READ | Known user READ |
|---|---|---|---|
| Accelerock | 2 | READ | READ |
| Acid Armor | 16 | READ | — |
| Acid Spray | 28 | READ | READ |
| Acrobatics | 63 | READ | READ |
| Acupressure | 6 | READ | — |
| Aerial Ace | 75 | READ | READ |
| After You | 14 | READ | READ |
| Agility | 75 | READ | — |
| Air Cutter | 43 | READ | READ |
| Air Slash | 55 | READ | READ |
| Alluring Voice | 35 | READ | READ |
| Ally Switch | 27 | READ | — |
| Amnesia | 34 | READ | — |
| Ancient Power | 25 | READ | READ |
| Apple Acid | 1 | READ | READ |
| Aqua Cutter | 5 | READ | READ |
| Aqua Jet | 21 | READ | READ |
| Aqua Ring | 11 | READ | — |
| Aqua Step | 1 | READ | READ |
| Aqua Tail | 16 | READ | READ |
| Armor Cannon | 1 | READ | READ |
| Aromatic Mist | 13 | READ | — |
| Assurance | 59 | READ | READ |
| Attract | 83 | READ | READ |
| Aura Sphere | 15 | READ | READ |
| Aura Wheel | 1 | READ | READ |
| Aurora Veil | 7 | READ | READ |
| Avalanche | 37 | READ | READ |
| Axe Kick | 1 | READ | READ |
| Baby-Doll Eyes | 28 | READ | READ |
| Baneful Bunker | 1 | READ | — |
| Barb Barrage | 2 | READ | READ |
| Baton Pass | 58 | READ | — |
| Beak Blast | 1 | READ | READ |
| Beat Up | 23 | READ | READ |
| Belch | 18 | READ | READ |
| Belly Drum | 10 | READ | — |
| Bind | 5 | READ | READ |
| Bite | 74 | READ | READ |
| Bitter Blade | 1 | READ | READ |
| Bitter Malice | 1 | READ | READ |
| Blast Burn | 10 | READ | READ |
| Blaze Kick | 9 | READ | READ |
| Blizzard | 66 | READ | READ |
| Block | 13 | READ | READ |
| Body Press | 55 | READ | READ |
| Body Slam | 164 | READ | READ |
| Bone Rush | 1 | READ | READ |
| Boomburst | 8 | READ | READ |
| Bounce | 24 | READ | READ |
| Brave Bird | 20 | READ | READ |
| Breaking Swipe | 31 | READ | READ |
| Brick Break | 108 | READ | READ |
| Brutal Swing | 59 | READ | READ |
| Bug Bite | 33 | READ | READ |
| Bug Buzz | 29 | READ | READ |
| Bulk Up | 52 | READ | — |
| Bulldoze | 108 | READ | READ |
| Bullet Punch | 7 | READ | READ |
| Bullet Seed | 34 | READ | READ |
| Burning Jealousy | 26 | READ | READ |
| Burn Up | 8 | READ | READ |
| Calm Mind | 96 | READ | — |
| Ceaseless Edge | 1 | READ | READ |
| Charge | 24 | READ | — |
| Charge Beam | 38 | READ | READ |
| Charm | 79 | READ | READ |
| Chilling Water | 71 | READ | READ |
| Chilly Reception | 2 | READ | READ |
| Circle Throw | 7 | READ | READ |
| Clanging Scales | 1 | READ | READ |
| Clangorous Soul | 1 | READ | — |
| Clear Smog | 8 | READ | READ |
| Close Combat | 55 | READ | READ |
| Coaching | 26 | READ | — |
| Coil | 6 | READ | — |
| Comeuppance | 4 | READ | — |
| Confuse Ray | 78 | READ | READ |
| Copycat | 30 | READ | — |
| Cosmic Power | 6 | READ | — |
| Cotton Guard | 6 | READ | — |
| Cotton Spore | 4 | READ | READ |
| Counter | 41 | READ | — |
| Court Change | 1 | READ | READ |
| Covet | 25 | READ | READ |
| Crabhammer | 3 | READ | READ |
| Cross Chop | 7 | READ | READ |
| Cross Poison | 10 | READ | READ |
| Crunch | 72 | READ | READ |
| Crush Claw | 4 | READ | READ |
| Curse | 103 | READ | READ |
| Darkest Lariat | 3 | READ | READ |
| Dark Pulse | 77 | READ | READ |
| Dazzling Gleam | 52 | READ | READ |
| Decorate | 8 | READ | READ |
| Defog | 12 | READ | READ |
| Destiny Bond | 25 | READ | — |
| Detect | 29 | READ | — |
| Dig | 120 | READ | READ |
| Dire Claw | 1 | READ | READ |
| Disable | 34 | READ | READ |
| Discharge | 24 | READ | READ |
| Dive | 32 | READ | READ |
| Double-Edge | 129 | READ | READ |
| Double Hit | 25 | READ | READ |
| Double Shock | 1 | READ | READ |
| Double Team | 40 | READ | — |
| Draco Meteor | 18 | READ | READ |
| Dragon Cheer | 22 | READ | — |
| Dragon Claw | 28 | READ | READ |
| Dragon Dance | 21 | READ | — |
| Dragon Darts | 1 | READ | READ |
| Dragon Pulse | 43 | READ | READ |
| Dragon Rush | 17 | READ | READ |
| Dragon Tail | 33 | READ | READ |
| Draining Kiss | 60 | READ | READ |
| Drain Punch | 57 | READ | READ |
| Drill Peck | 5 | READ | READ |
| Drill Run | 15 | READ | READ |
| Drum Beating | 1 | READ | READ |
| Dual Wingbeat | 30 | READ | READ |
| Dynamic Punch | 12 | READ | READ |
| Earth Power | 46 | READ | READ |
| Earthquake | 96 | READ | READ |
| Eerie Impulse | 23 | READ | READ |
| Eerie Spell | 1 | READ | READ |
| Electric Terrain | 23 | READ | READ |
| Electrify | 1 | READ | READ |
| Electro Ball | 25 | READ | READ |
| Electro Shot | 1 | READ | READ |
| Electroweb | 26 | READ | READ |
| Encore | 63 | READ | READ |
| Endeavor | 90 | READ | READ |
| Endure | 292 | READ | — |
| Energy Ball | 94 | READ | READ |
| Eruption | 4 | READ | READ |
| Expanding Force | 29 | READ | READ |
| Explosion | 11 | READ | READ |
| Extrasensory | 14 | READ | READ |
| Extreme Speed | 4 | READ | READ |
| Facade | 288 | READ | READ |
| Fairy Lock | 1 | READ | READ |
| Fake Out | 33 | READ | READ |
| Fake Tears | 64 | READ | READ |
| Feather Dance | 20 | READ | READ |
| Feint | 35 | READ | READ |
| Fell Stinger | 5 | READ | READ |
| Fickle Beam | 1 | READ | READ |
| Fiery Dance | 1 | READ | READ |
| Fire Blast | 61 | READ | READ |
| Fire Fang | 38 | READ | READ |
| Fire Lash | 1 | READ | READ |
| Fire Punch | 54 | READ | READ |
| Fire Spin | 30 | READ | READ |
| First Impression | 6 | READ | READ |
| Fissure | 14 | READ | READ |
| Flail | 50 | READ | READ |
| Flame Charge | 27 | READ | READ |
| Flamethrower | 70 | READ | READ |
| Flare Blitz | 27 | READ | READ |
| Flash Cannon | 41 | READ | READ |
| Flatter | 13 | READ | READ |
| Flip Turn | 21 | READ | READ |
| Flower Trick | 1 | READ | READ |
| Fly | 25 | READ | READ |
| Flying Press | 1 | READ | READ |
| Focus Blast | 96 | READ | READ |
| Focus Energy | 50 | READ | — |
| Focus Punch | 61 | READ | READ |
| Follow Me | 4 | READ | — |
| Forest's Curse | 1 | READ | READ |
| Foul Play | 69 | READ | READ |
| Freeze-Dry | 8 | READ | READ |
| Frenzy Plant | 10 | READ | READ |
| Frost Breath | 9 | READ | READ |
| Future Sight | 28 | READ | READ |
| Gastro Acid | 6 | READ | READ |
| Giga Drain | 79 | READ | READ |
| Giga Impact | 270 | READ | READ |
| Gigaton Hammer | 1 | READ | READ |
| Glaive Rush | 1 | READ | READ |
| Glare | 5 | READ | READ |
| Grass Knot | 93 | READ | READ |
| Grassy Glide | 30 | READ | READ |
| Grassy Terrain | 26 | READ | READ |
| Grav Apple | 1 | READ | READ |
| Gravity | 22 | READ | READ |
| Growth | 18 | READ | — |
| Guard Split | 6 | READ | READ |
| Guard Swap | 16 | READ | READ |
| Guillotine | 2 | READ | READ |
| Gunk Shot | 40 | READ | READ |
| Gyro Ball | 33 | READ | READ |
| Hammer Arm | 16 | READ | READ |
| Hard Press | 22 | READ | READ |
| Haze | 30 | READ | READ |
| Headlong Rush | 3 | READ | READ |
| Head Smash | 11 | READ | READ |
| Heal Bell | 1 | READ | — |
| Healing Wish | 10 | READ | — |
| Heal Pulse | 16 | READ | READ |
| Heat Crash | 12 | READ | READ |
| Heat Wave | 40 | READ | READ |
| Heavy Slam | 32 | READ | READ |
| Helping Hand | 183 | READ | — |
| Hex | 54 | READ | READ |
| High Horsepower | 38 | READ | READ |
| High Jump Kick | 8 | READ | READ |
| Horn Drill | 3 | READ | READ |
| Horn Leech | 2 | READ | READ |
| Howl | 17 | READ | — |
| Hurricane | 45 | READ | READ |
| Hydro Cannon | 10 | READ | READ |
| Hydro Pump | 51 | READ | READ |
| Hyper Beam | 268 | READ | READ |
| Hyper Voice | 75 | READ | READ |
| Hypnosis | 24 | READ | READ |
| Ice Beam | 69 | READ | READ |
| Ice Fang | 33 | READ | READ |
| Ice Hammer | 3 | READ | READ |
| Ice Punch | 55 | READ | READ |
| Ice Shard | 11 | READ | READ |
| Ice Spinner | 21 | READ | READ |
| Icicle Crash | 8 | READ | READ |
| Icicle Spear | 16 | READ | READ |
| Icy Wind | 78 | READ | READ |
| Imprison | 57 | READ | — |
| Infernal Parade | 1 | READ | READ |
| Inferno | 7 | READ | READ |
| Infestation | 5 | READ | READ |
| Ingrain | 8 | READ | — |
| Instruct | 1 | READ | READ |
| Iron Defense | 87 | READ | — |
| Iron Head | 71 | READ | READ |
| Iron Tail | 92 | READ | READ |
| Jaw Lock | 1 | READ | READ |
| Jet Punch | 1 | READ | READ |
| King's Shield | 1 | READ | — |
| Kowtow Cleave | 1 | READ | READ |
| Lash Out | 54 | READ | READ |
| Last Resort | 33 | READ | READ |
| Last Respects | 3 | READ | READ |
| Lava Plume | 7 | READ | READ |
| Leaf Blade | 11 | READ | READ |
| Leaf Storm | 27 | READ | READ |
| Leech Life | 12 | READ | READ |
| Leech Seed | 24 | READ | READ |
| Life Dew | 14 | READ | — |
| Light of Ruin | 1 | READ | READ |
| Light Screen | 126 | READ | READ |
| Liquidation | 40 | READ | READ |
| Lock-On | 1 | READ | READ |
| Low Kick | 65 | READ | READ |
| Low Sweep | 47 | READ | READ |
| Lumina Crash | 1 | READ | READ |
| Lunge | 21 | READ | READ |
| Mach Punch | 6 | READ | READ |
| Magic Powder | 1 | READ | READ |
| Magic Room | 26 | READ | READ |
| Magnetic Flux | 2 | READ | READ |
| Magnet Rise | 6 | READ | — |
| Make It Rain | 1 | READ | READ |
| Matcha Gotcha | 2 | READ | READ |
| Mean Look | 14 | READ | READ |
| Megahorn | 15 | READ | READ |
| Mega Kick | 57 | READ | READ |
| Memento | 19 | READ | READ |
| Metal Burst | 7 | READ | — |
| Metal Sound | 22 | READ | READ |
| Meteor Assault | 1 | READ | READ |
| Meteor Beam | 18 | READ | READ |
| Meteor Mash | 3 | READ | READ |
| Milk Drink | 1 | READ | — |
| Minimize | 5 | READ | — |
| Mirror Coat | 14 | READ | — |
| Misty Explosion | 19 | READ | READ |
| Misty Terrain | 31 | READ | READ |
| Moonblast | 17 | READ | READ |
| Moonlight | 5 | READ | — |
| Morning Sun | 5 | READ | — |
| Mortal Spin | 1 | READ | READ |
| Mountain Gale | 1 | READ | READ |
| Muddy Water | 31 | READ | READ |
| Mud Shot | 64 | READ | READ |
| Mud-Slap | 68 | READ | READ |
| Mystical Fire | 26 | READ | READ |
| Nasty Plot | 69 | READ | — |
| Night Daze | 1 | READ | READ |
| Night Shade | 45 | READ | READ |
| Night Slash | 37 | READ | READ |
| Noble Roar | 5 | READ | READ |
| No Retreat | 1 | READ | — |
| Nuzzle | 9 | READ | READ |
| Octolock | 1 | READ | READ |
| Outrage | 59 | READ | READ |
| Overdrive | 2 | READ | READ |
| Overheat | 31 | READ | READ |
| Pain Split | 60 | READ | READ |
| Parabolic Charge | 5 | READ | READ |
| Parting Shot | 10 | READ | READ |
| Payback | 85 | READ | READ |
| Perish Song | 7 | READ | READ |
| Petal Blizzard | 10 | READ | READ |
| Petal Dance | 7 | READ | READ |
| Phantom Force | 27 | READ | READ |
| Pin Missile | 14 | READ | READ |
| Play Rough | 57 | READ | READ |
| Pluck | 7 | READ | READ |
| Poison Fang | 6 | READ | READ |
| Poison Jab | 56 | READ | READ |
| Poison Powder | 25 | READ | READ |
| Pollen Puff | 28 | READ | READ |
| Population Bomb | 2 | READ | READ |
| Pounce | 50 | READ | READ |
| Power Gem | 17 | READ | READ |
| Power Split | 7 | READ | READ |
| Power Swap | 17 | READ | READ |
| Power Trick | 3 | READ | — |
| Power Trip | 6 | READ | READ |
| Power Whip | 14 | READ | READ |
| Protect | 292 | READ | — |
| Psychic | 97 | READ | READ |
| Psychic Fangs | 30 | READ | READ |
| Psychic Noise | 26 | READ | READ |
| Psychic Terrain | 24 | READ | READ |
| Psycho Cut | 14 | READ | READ |
| Psych Up | 69 | READ | READ |
| Psyshield Bash | 1 | READ | READ |
| Psyshock | 50 | READ | READ |
| Pyro Ball | 1 | READ | READ |
| Quash | 7 | READ | READ |
| Quick Attack | 52 | READ | READ |
| Quick Guard | 23 | READ | READ |
| Quiver Dance | 21 | READ | — |
| Rage Fist | 1 | READ | READ |
| Rage Powder | 25 | READ | — |
| Raging Bull | 4 | READ | READ |
| Raging Fury | 3 | READ | READ |
| Rain Dance | 208 | READ | READ |
| Rapid Spin | 11 | READ | READ |
| Razor Shell | 8 | READ | READ |
| Recover | 23 | READ | — |
| Recycle | 12 | READ | — |
| Reflect | 77 | READ | READ |
| Reflect Type | 3 | READ | READ |
| Rest | 292 | READ | — |
| Reversal | 66 | READ | READ |
| Revival Blessing | 1 | READ | — |
| Rising Voltage | 21 | READ | READ |
| Roar | 70 | READ | READ |
| Rock Blast | 31 | READ | READ |
| Rock Polish | 6 | READ | — |
| Rock Slide | 108 | READ | READ |
| Rock Tomb | 101 | READ | READ |
| Rock Wrecker | 1 | READ | READ |
| Roost | 27 | READ | — |
| Round | 252 | READ | READ |
| Sacred Sword | 4 | READ | READ |
| Safeguard | 81 | READ | READ |
| Salt Cure | 1 | READ | READ |
| Sandstorm | 62 | READ | READ |
| Sand Tomb | 20 | READ | READ |
| Scald | 20 | READ | READ |
| Scale Shot | 26 | READ | READ |
| Scary Face | 122 | READ | READ |
| Scorching Sands | 30 | READ | READ |
| Screech | 53 | READ | READ |
| Seed Bomb | 57 | READ | READ |
| Seismic Toss | 8 | READ | READ |
| Self-Destruct | 27 | READ | READ |
| Shadow Ball | 110 | READ | READ |
| Shadow Claw | 63 | READ | READ |
| Shadow Punch | 10 | READ | READ |
| Shadow Sneak | 19 | READ | READ |
| Shed Tail | 3 | READ | — |
| Sheer Cold | 5 | READ | READ |
| Shell Side Arm | 1 | READ | READ |
| Shell Smash | 6 | READ | — |
| Shelter | 1 | READ | — |
| Shift Gear | 1 | READ | — |
| Sing | 7 | READ | READ |
| Skitter Smack | 58 | READ | READ |
| Sky Attack | 12 | READ | READ |
| Slack Off | 9 | READ | — |
| Slash | 36 | READ | READ |
| Sleep Powder | 24 | READ | READ |
| Sleep Talk | 292 | READ | — |
| Sludge Bomb | 48 | READ | READ |
| Sludge Wave | 29 | READ | READ |
| Smack Down | 39 | READ | READ |
| Smart Strike | 16 | READ | READ |
| Snap Trap | 1 | READ | READ |
| Snarl | 47 | READ | READ |
| Snipe Shot | 1 | READ | READ |
| Snore | 251 | READ | READ |
| Soak | 10 | READ | READ |
| Solar Beam | 109 | READ | READ |
| Solar Blade | 15 | READ | READ |
| Sparkling Aria | 1 | READ | READ |
| Speed Swap | 3 | READ | READ |
| Spicy Extract | 1 | READ | READ |
| Spikes | 22 | READ | READ |
| Spiky Shield | 2 | READ | — |
| Spirit Break | 1 | READ | READ |
| Spirit Shackle | 1 | READ | READ |
| Spite | 58 | READ | READ |
| Spit Up | 13 | READ | READ |
| Stealth Rock | 51 | READ | READ |
| Steel Beam | 22 | READ | READ |
| Steel Roller | 11 | READ | READ |
| Steel Wing | 24 | READ | READ |
| Sticky Web | 3 | READ | READ |
| Stockpile | 15 | READ | — |
| Stomping Tantrum | 75 | READ | READ |
| Stone Axe | 1 | READ | READ |
| Stone Edge | 66 | READ | READ |
| Stored Power | 62 | READ | READ |
| Storm Throw | 6 | READ | READ |
| Strength Sap | 7 | READ | READ |
| String Shot | 24 | READ | READ |
| Struggle Bug | 28 | READ | READ |
| Stuff Cheeks | 4 | READ | — |
| Stun Spore | 26 | READ | READ |
| Substitute | 292 | READ | — |
| Sucker Punch | 45 | READ | READ |
| Sunny Day | 210 | READ | READ |
| Supercell Slam | 10 | READ | READ |
| Super Fang | 15 | READ | READ |
| Superpower | 56 | READ | READ |
| Surf | 68 | READ | READ |
| Swagger | 50 | READ | READ |
| Swallow | 12 | READ | — |
| Sweet Kiss | 18 | READ | READ |
| Sweet Scent | 24 | READ | READ |
| Switcheroo | 18 | READ | READ |
| Swords Dance | 80 | READ | — |
| Synthesis | 17 | READ | — |
| Syrup Bomb | 1 | READ | READ |
| Tail Slap | 7 | READ | READ |
| Tailwind | 44 | READ | READ |
| Taunt | 101 | READ | READ |
| Tearful Look | 8 | READ | READ |
| Teatime | 2 | READ | READ |
| Temper Flare | 26 | READ | READ |
| Terrain Pulse | 11 | READ | READ |
| Thief | 157 | READ | READ |
| Thrash | 34 | READ | READ |
| Throat Chop | 68 | READ | READ |
| Thunder | 66 | READ | READ |
| Thunderbolt | 72 | READ | READ |
| Thunder Fang | 37 | READ | READ |
| Thunder Punch | 65 | READ | READ |
| Thunder Wave | 80 | READ | READ |
| Tickle | 30 | READ | READ |
| Tidy Up | 2 | READ | — |
| Topsy-Turvy | 2 | READ | READ |
| Torch Song | 1 | READ | READ |
| Torment | 25 | READ | READ |
| Toxic | 31 | READ | READ |
| Toxic Spikes | 27 | READ | READ |
| Toxic Thread | 1 | READ | READ |
| Trailblaze | 109 | READ | READ |
| Transform | 1 | READ | READ |
| Tri Attack | 20 | READ | READ |
| Trick | 61 | READ | READ |
| Trick-or-Treat | 4 | READ | READ |
| Trick Room | 48 | READ | READ |
| Triple Arrows | 1 | READ | READ |
| Triple Axel | 14 | READ | READ |
| Trop Kick | 1 | READ | READ |
| Twin Beam | 1 | READ | READ |
| Upper Hand | 28 | READ | READ |
| Uproar | 87 | READ | READ |
| U-turn | 75 | READ | READ |
| Vacuum Wave | 20 | READ | READ |
| Venoshock | 28 | READ | READ |
| Volt Switch | 23 | READ | READ |
| Volt Tackle | 3 | READ | READ |
| Waterfall | 35 | READ | READ |
| Water Pulse | 51 | READ | READ |
| Water Shuriken | 1 | READ | READ |
| Water Spout | 1 | READ | READ |
| Wave Crash | 8 | READ | READ |
| Weather Ball | 66 | READ | READ |
| Whirlpool | 32 | READ | READ |
| Whirlwind | 31 | READ | READ |
| Wide Guard | 20 | READ | READ |
| Wild Charge | 37 | READ | READ |
| Will-O-Wisp | 55 | READ | READ |
| Wish | 26 | READ | — |
| Wonder Room | 39 | READ | READ |
| Wood Hammer | 7 | READ | READ |
| Wrap | 9 | READ | READ |
| X-Scissor | 32 | READ | READ |
| Yawn | 37 | READ | READ |
| Zap Cannon | 8 | READ | READ |
| Zen Headbutt | 87 | READ | READ |
| Zing Zap | 1 | READ | READ |

### 3.2 Moves that name something else, or are not read

#### Corrosive Gas · `move:corrosivegas`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | item | Heat Rock | Heat Rock | READ | `\|-enditem\|p1a: Snorlax\|Heat Rock\|[from] move: Corrosive Gas\|[of] p2a: Swalot` |
| user-hidden/quiet | p1 Torkoal | item | Damp Rock | Damp Rock | READ | `\|-enditem\|p1b: Torkoal\|Damp Rock\|[from] move: Corrosive Gas\|[of] p2a: Swalot` |
| user-hidden/quiet | p2 Swalot | move | Corrosive Gas | Corrosive Gas | READ | `\|move\|p2a: Swalot\|Corrosive Gas\|p1a: Snorlax\|[spread] p2b,p1a,p1b` |
| user-hidden/quiet | p2 Avalugg | item | Icy Rock | Icy Rock | READ | `\|-enditem\|p2b: Avalugg\|Icy Rock\|[from] move: Corrosive Gas\|[of] p2a: Swalot` |
| target-hidden/quiet | p1 Snorlax | move | Corrosive Gas | Corrosive Gas | READ | `\|move\|p1a: Snorlax\|Corrosive Gas\|p2b: Avalugg\|[spread] p1b,p2a,p2b` |
| target-hidden/quiet | p2 Blastoise | item | Smooth Rock | Smooth Rock | READ | `\|-enditem\|p2a: Blastoise\|Smooth Rock\|[from] move: Corrosive Gas\|[of] p1a: Snorlax` |
| target-hidden/pace | p1 Ampharos | move | Corrosive Gas | Corrosive Gas | READ | `\|move\|p1a: Ampharos\|Corrosive Gas\|p2a: Blastoise\|[spread] p1b,p2a,p2b` |

#### Entrainment · `move:entrainment`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | ability | — | Gluttony | MISSED | `\|-ability\|p1a: Snorlax\|Klutz\|Gluttony\|[from] move: Entrainment\|[of] p2a: Audino` |
| user-hidden/quiet | p2 Audino | ability | — | Klutz | MISSED | `\|-ability\|p1a: Snorlax\|Klutz\|Gluttony\|[from] move: Entrainment\|[of] p2a: Audino` |
| user-hidden/quiet | p2 Audino | move | Entrainment | Entrainment | READ | `\|move\|p2a: Audino\|Entrainment\|p1a: Snorlax` |
| target-hidden/quiet | p1 Snorlax | move | Entrainment | Entrainment | READ | `\|move\|p1a: Snorlax\|Entrainment\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | ability | — | Torrent | MISSED | `\|-ability\|p2a: Blastoise\|Gluttony\|Torrent\|[from] move: Entrainment\|[of] p1a: Snorlax` |
| target-hidden/pace | p1 Ampharos | ability | — | Plus | MISSED | `\|-ability\|p2a: Blastoise\|Plus\|Torrent\|[from] move: Entrainment\|[of] p1a: Ampharos` |
| target-hidden/pace | p1 Ampharos | move | Entrainment | Entrainment | READ | `\|move\|p1a: Ampharos\|Entrainment\|p2a: Blastoise` |

#### Final Gambit · `move:finalgambit`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p2 Sirfetch’d | move | Final Gambit | Final Gambit | READ | `\|move\|p2a: Sirfetch’d\|Final Gambit\|p1a: Snorlax` |
| user-hidden/pace | p1 Shuckle | ability | Sturdy | Sturdy | READ | `\|-ability\|p1a: Shuckle\|Sturdy` |
| target-hidden/quiet | p1 Snorlax | move | Final Gambit | Final Gambit | READ | `\|move\|p1a: Snorlax\|Final Gambit\|p2a: Blastoise` |
| target-hidden/pace | p1 Shuckle | move | Final Gambit | Final Gambit | READ | `\|move\|p1a: Shuckle\|Final Gambit\|p2a: Blastoise` |

#### Fling · `move:fling`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p2 Aggron | item | Smooth Rock | Smooth Rock | READ | `\|-enditem\|p2a: Aggron\|Smooth Rock\|[from] move: Fling` |
| user-hidden/quiet | p2 Aggron | move | Fling | Fling | READ | `\|move\|p2a: Aggron\|Fling\|p1a: Snorlax` |
| target-hidden/quiet | p1 Snorlax | item | Heat Rock | Heat Rock | READ | `\|-enditem\|p1a: Snorlax\|Heat Rock\|[from] move: Fling` |
| target-hidden/quiet | p1 Snorlax | move | Fling | Fling | READ | `\|move\|p1a: Snorlax\|Fling\|p2a: Blastoise` |
| target-hidden/pace | p1 Ampharos | item | Heat Rock | Heat Rock | READ | `\|-enditem\|p1a: Ampharos\|Heat Rock\|[from] move: Fling` |
| target-hidden/pace | p1 Ampharos | move | Fling | Fling | READ | `\|move\|p1a: Ampharos\|Fling\|p2a: Blastoise` |

#### Knock Off · `move:knockoff`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | item | Heat Rock | Heat Rock | READ | `\|-enditem\|p1a: Snorlax\|Heat Rock\|[from] move: Knock Off\|[of] p2a: Goodra` |
| user-hidden/quiet | p2 Goodra | move | Knock Off | Knock Off | READ | `\|move\|p2a: Goodra\|Knock Off\|p1a: Snorlax` |
| user-hidden/pace | p1 Ampharos | item | Heat Rock | Heat Rock | READ | `\|-enditem\|p1a: Ampharos\|Heat Rock\|[from] move: Knock Off\|[of] p2a: Goodra` |
| target-hidden/quiet | p1 Snorlax | move | Knock Off | Knock Off | READ | `\|move\|p1a: Snorlax\|Knock Off\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | item | Smooth Rock | Smooth Rock | READ | `\|-enditem\|p2a: Blastoise\|Smooth Rock\|[from] move: Knock Off\|[of] p1a: Snorlax` |
| target-hidden/pace | p1 Ampharos | move | Knock Off | Knock Off | READ | `\|move\|p1a: Ampharos\|Knock Off\|p2a: Blastoise` |

#### Poltergeist · `move:poltergeist`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Slowbro | item | — | Heat Rock | MISSED | `\|-activate\|p1a: Slowbro\|move: Poltergeist\|Heat Rock` |
| user-hidden/quiet | p2 Gourgeist | move | Poltergeist | Poltergeist | READ | `\|move\|p2a: Gourgeist\|Poltergeist\|p1a: Slowbro` |
| target-hidden/quiet | p1 Snorlax | move | Poltergeist | Poltergeist | READ | `\|move\|p1a: Snorlax\|Poltergeist\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | item | — | Smooth Rock | MISSED | `\|-activate\|p2a: Blastoise\|move: Poltergeist\|Smooth Rock` |
| target-hidden/pace | p1 Ampharos | move | Poltergeist | Poltergeist | READ | `\|move\|p1a: Ampharos\|Poltergeist\|p2a: Blastoise` |

#### Role Play · `move:roleplay`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | ability | — | Gluttony | MISSED | `\|-ability\|p2a: Mr. Rime\|Gluttony\|Tangled Feet\|[from] move: Role Play\|[of] p1a: Snorlax` |
| user-hidden/quiet | p2 Mr. Rime | ability | — | Tangled Feet | MISSED | `\|-ability\|p2a: Mr. Rime\|Gluttony\|Tangled Feet\|[from] move: Role Play\|[of] p1a: Snorlax` |
| user-hidden/quiet | p2 Mr. Rime | move | Role Play | Role Play | READ | `\|move\|p2a: Mr. Rime\|Role Play\|p1a: Snorlax` |
| user-hidden/pace | p1 Ampharos | ability | — | Plus | MISSED | `\|-ability\|p2a: Mr. Rime\|Plus\|Tangled Feet\|[from] move: Role Play\|[of] p1a: Ampharos` |
| target-hidden/quiet | p1 Snorlax | move | Role Play | Role Play | READ | `\|move\|p1a: Snorlax\|Role Play\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | ability | — | Torrent | MISSED | `\|-ability\|p1a: Snorlax\|Torrent\|Gluttony\|[from] move: Role Play\|[of] p2a: Blastoise` |
| target-hidden/pace | p1 Ampharos | move | Role Play | Role Play | READ | `\|move\|p1a: Ampharos\|Role Play\|p2a: Blastoise` |

#### Simple Beam · `move:simplebeam`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | ability | — | Gluttony | MISSED | `\|-ability\|p1a: Snorlax\|Simple\|Gluttony\|[from] move: Simple Beam` |
| user-hidden/quiet | p2 Audino | move | Simple Beam | Simple Beam | READ | `\|move\|p2a: Audino\|Simple Beam\|p1a: Snorlax` |
| target-hidden/quiet | p1 Snorlax | move | Simple Beam | Simple Beam | READ | `\|move\|p1a: Snorlax\|Simple Beam\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | ability | — | Torrent | MISSED | `\|-ability\|p2a: Blastoise\|Simple\|Torrent\|[from] move: Simple Beam` |
| target-hidden/pace | p1 Ampharos | move | Simple Beam | Simple Beam | READ | `\|move\|p1a: Ampharos\|Simple Beam\|p2a: Blastoise` |

#### Skill Swap · `move:skillswap`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | ability | — | Gluttony | MISSED | `\|-activate\|p2a: Umbreon\|Skill Swap\|Gluttony\|Inner Focus\|[of] p1a: Snorlax` |
| user-hidden/quiet | p2 Umbreon | ability | — | Inner Focus | MISSED | `\|-activate\|p2a: Umbreon\|Skill Swap\|Gluttony\|Inner Focus\|[of] p1a: Snorlax` |
| user-hidden/quiet | p2 Umbreon | move | Skill Swap | Skill Swap | READ | `\|move\|p2a: Umbreon\|Skill Swap\|p1a: Snorlax` |
| user-hidden/pace | p1 Ampharos | ability | — | Plus | MISSED | `\|-activate\|p2a: Umbreon\|Skill Swap\|Plus\|Inner Focus\|[of] p1a: Ampharos` |
| target-hidden/quiet | p1 Snorlax | move | Skill Swap | Skill Swap | READ | `\|move\|p1a: Snorlax\|Skill Swap\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | ability | — | Torrent | MISSED | `\|-activate\|p1a: Snorlax\|Skill Swap\|Torrent\|Gluttony\|[of] p2a: Blastoise` |
| target-hidden/pace | p1 Ampharos | move | Skill Swap | Skill Swap | READ | `\|move\|p1a: Ampharos\|Skill Swap\|p2a: Blastoise` |

#### Snowscape · `move:snowscape`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p2 Baxcalibur | move | Snowscape | Snowscape | READ | `\|move\|p2a: Baxcalibur\|Snowscape\|p2a: Baxcalibur` |
| user-hidden/before | p2 Baxcalibur | ability | Ice Body | Ice Body | READ | `\|-heal\|p2a: Baxcalibur\|36/100\|[from] ability: Ice Body` |
| target-hidden/quiet | p1 Snorlax | move | Snowscape | Snowscape | READ | `\|move\|p1a: Snorlax\|Snowscape\|p1a: Snorlax` |
| target-hidden/pace | p1 Ampharos | move | Snowscape | Snowscape | READ | `\|move\|p1a: Ampharos\|Snowscape\|p1a: Ampharos` |

#### Teeter Dance · `move:teeterdance`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p2 Tsareena | move | Teeter Dance | Teeter Dance | READ | `\|move\|p2a: Tsareena\|Teeter Dance\|p1a: Snorlax\|[spread] p2b,p1a,p1b` |
| user-hidden/quiet | p2 Avalugg | ability | Own Tempo | Own Tempo | READ | `\|-immune\|p2b: Avalugg\|confusion\|[from] ability: Own Tempo` |
| target-hidden/quiet | p1 Snorlax | move | Teeter Dance | Teeter Dance | READ | `\|move\|p1a: Snorlax\|Teeter Dance\|p2b: Avalugg\|[spread] p1b,p2a,p2b` |
| target-hidden/pace | p1 Ampharos | move | Teeter Dance | Teeter Dance | READ | `\|move\|p1a: Ampharos\|Teeter Dance\|p2a: Blastoise\|[spread] p1b,p2a,p2b` |

#### Worry Seed · `move:worryseed`

| Template | Pokemon | Box | Value | Truth | setsFromLog | Line |
|---|---|---|---|---|---|---|
| user-hidden/quiet | p1 Snorlax | ability | — | Gluttony | MISSED | `\|-ability\|p1a: Snorlax\|Insomnia\|Gluttony\|[from] move: Worry Seed` |
| user-hidden/quiet | p2 Torterra | move | Worry Seed | Worry Seed | READ | `\|move\|p2a: Torterra\|Worry Seed\|p1a: Snorlax` |
| target-hidden/quiet | p1 Snorlax | move | Worry Seed | Worry Seed | READ | `\|move\|p1a: Snorlax\|Worry Seed\|p2a: Blastoise` |
| target-hidden/quiet | p2 Blastoise | ability | — | Torrent | MISSED | `\|-ability\|p2a: Blastoise\|Insomnia\|Torrent\|[from] move: Worry Seed` |
| target-hidden/pace | p1 Ampharos | move | Worry Seed | Worry Seed | READ | `\|move\|p1a: Ampharos\|Worry Seed\|p2a: Blastoise` |

## 4. Abilities

#### Adaptability · `ability:adaptability`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Aftermath · `ability:aftermath`

1 holders · weight 1. Named by: `\|-damage\|p1a: Snorlax\|192/255\|[from] ability: Aftermath\|[of] p2a: Garbodor` (W-phys-taken, turn 3).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Analytic · `ability:analytic`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Anger Point · `ability:angerpoint`

7 holders · weight 7. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Anticipation · `ability:anticipation`

2 holders · weight 2. Named by: `\|-ability\|p2a: Toxicroak\|Anticipation` (W-lethal, turn 0).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Armor Tail · `ability:armortail`

1 holders · weight 1. Named by: `\|cant\|p2a: Farigiraf\|ability: Armor Tail\|Quick Attack\|[of] p1a: Snorlax` (W-trade, turn 1).
Box: MISSED (p2 holder-hidden).
Other boxes: MISREAD p2 Farigiraf move Quick Attack.

No witness changed the log before it was named.

#### Aroma Veil · `ability:aromaveil`

9 holders · weight 9. Named by: `\|-block\|p2a: Alcremie\|ability: Aroma Veil\|[of] p2a: Alcremie` (W-taunt, turn 1).
Box: MISSED (p2 holder-hidden).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-sleep | known exact, presence | `\|move\|p2a: Alcremie\|Strength\|p1a: Snorlax` → — | no | HAZARD-REBUILD |  |

#### Battle Armor · `ability:battlearmor`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Battle Bond · `ability:battlebond`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Berserk · `ability:berserk`

1 holders · weight 1. Named by: `\|-ability\|p2a: Drampa\|Berserk\|boost` (W-phys-taken, turn 2).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Big Pecks · `ability:bigpecks`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Blaze · `ability:blaze`

11 holders · weight 11. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Bulletproof · `ability:bulletproof`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Cheek Pouch · `ability:cheekpouch`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Chlorophyll · `ability:chlorophyll`

6 holders · weight 6. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Clear Body · `ability:clearbody`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Cloud Nine · `ability:cloudnine`

2 holders · weight 2. Named by: `\|-ability\|p2a: Altaria\|Cloud Nine` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Competitive · `ability:competitive`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Compound Eyes · `ability:compoundeyes`

20 holders · weight 20. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Contrary · `ability:contrary`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Corrosion · `ability:corrosion`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Cud Chew · `ability:cudchew`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Curious Medicine · `ability:curiousmedicine`

1 holders · weight 1. Named by: `\|-clearboost\|p2b: Avalugg\|[from] ability: Curious Medicine\|[of] p2a: Slowking` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Cursed Body · `ability:cursedbody`

6 holders · weight 6. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Cute Charm · `ability:cutecharm`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Damp · `ability:damp`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Defiant · `ability:defiant`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Disguise · `ability:disguise`

1 holders · weight 1. Named by: `\|-activate\|p2a: Mimikyu\|ability: Disguise` (W-phys-taken, turn 1).

No witness changed the log before it was named.

#### Drizzle · `ability:drizzle`

2 holders · weight 2. Named by: `\|-weather\|RainDance\|[from] ability: Drizzle\|[of] p2a: Politoed` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Drought · `ability:drought`

2 holders · weight 2. Named by: `\|-weather\|SunnyDay\|[from] ability: Drought\|[of] p2a: Ninetales` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Dry Skin · `ability:dryskin`

2 holders · weight 2. Named by: `\|-immune\|p2a: Toxicroak\|[from] ability: Dry Skin` (W-Water-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fire-taken | hidden % | `\|-damage\|p2a: Toxicroak\|63/100` → `\|-damage\|p2a: Toxicroak\|54/100` | no | HAZARD-UNSOUND |  |

#### Early Bird · `ability:earlybird`

2 holders · weight 2. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-sleep | known exact, presence | `\|cant\|p2a: Kangaskhan\|slp` → — | no | SAFE |  |

#### Earth Eater · `ability:eartheater`

1 holders · weight 1. Named by: `\|-immune\|p2a: Orthworm\|[from] ability: Earth Eater` (W-Ground-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Effect Spore · `ability:effectspore`

1 holders · weight 1. Named by: `\|-status\|p1a: Snorlax\|par\|[from] ability: Effect Spore\|[of] p2a: Vileplume` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Electric Surge · `ability:electricsurge`

1 holders · weight 1. Named by: `\|-fieldstart\|move: Electric Terrain\|[from] ability: Electric Surge\|[of] p2a: Pincurchin` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Electromorphosis · `ability:electromorphosis`

1 holders · weight 1. Named by: `\|-start\|p2a: Bellibolt\|Charge\|Strength\|[from] ability: Electromorphosis` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Emergency Exit · `ability:emergencyexit`

1 holders · weight 1. Named by: `\|-activate\|p2a: Golisopod\|ability: Emergency Exit` (W-phys-taken, turn 2).

No witness changed the log before it was named.

#### Filter · `ability:filter`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-spec-taken | presence | — → `\|-damage\|p2a: Mr. Mime\|78/100` | no | HAZARD-REBUILD |  |

#### Flame Body · `ability:flamebody`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Flash Fire · `ability:flashfire`

9 holders · weight 9. Named by: `\|-start\|p2a: Armarouge\|ability: Flash Fire` (W-Fire-taken, turn 1).
Box: READ (p2 holder-hidden), MISSED (p2 holder-hidden), MISSED (p1 other-hidden).

No witness changed the log before it was named.

#### Flower Veil · `ability:flowerveil`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Fluffy · `ability:fluffy`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-taken | hidden %, presence | `\|-damage\|p2a: Houndstone\|69/100` → `\|-damage\|p2a: Houndstone\|85/100` | no | HAZARD-UNSOUND |  |
| W-pivot | hidden % | `\|-damage\|p2a: Houndstone\|69/100` → `\|-damage\|p2a: Houndstone\|85/100` | no | HAZARD-UNSOUND |  |

#### Forecast · `ability:forecast`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Forewarn · `ability:forewarn`

1 holders · weight 1. Named by: `\|-activate\|p2a: Musharna\|ability: Forewarn\|Strength\|[of] p1a: Snorlax` (W-phys-taken, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Friend Guard · `ability:friendguard`

22 holders · weight 22. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Frisk · `ability:frisk`

12 holders · weight 12. Named by: `\|-item\|p1a: Snorlax\|Heat Rock\|[from] ability: Frisk\|[of] p2a: Gourgeist` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Fur Coat · `ability:furcoat`

2 holders · weight 2. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-taken | hidden %, names, presence | `\|-damage\|p2a: Furfrou\|34/100` → `\|-damage\|p2a: Furfrou\|66/100` | no | SAFE |  |
| W-trade | hidden % | `\|-damage\|p2a: Furfrou\|66/100` → `\|-damage\|p2a: Furfrou\|82/100` | no | SAFE |  |
| W-pivot | hidden % | `\|-damage\|p2a: Furfrou\|34/100` → `\|-damage\|p2a: Furfrou\|66/100` | no | SAFE |  |

#### Gale Wings · `ability:galewings`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Gluttony · `ability:gluttony`

8 holders · weight 8. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Good as Gold · `ability:goodasgold`

1 holders · weight 1. Named by: `\|-immune\|p2a: Gholdengo\|[from] ability: Good as Gold` (W-burn, turn 1).

No witness changed the log before it was named.

#### Gooey · `ability:gooey`

2 holders · weight 2. Named by: `\|-ability\|p2a: Goodra\|Gooey` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Grass Pelt · `ability:grasspelt`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Grassy Surge · `ability:grassysurge`

1 holders · weight 1. Named by: `\|-fieldstart\|move: Grassy Terrain\|[from] ability: Grassy Surge\|[of] p2a: Rillaboom` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Guard Dog · `ability:guarddog`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Guts · `ability:guts`

7 holders · weight 7. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-burn | known exact, presence | `\|-damage\|p1a: Snorlax\|224/255` → `\|-damage\|p1a: Snorlax\|163/255` | no | SAFE |  |
| W-paralysis | known exact, presence | `\|-damage\|p1a: Snorlax\|193/255` → `\|-damage\|p1a: Snorlax\|163/255` | no | SAFE |  |
| W-toxic | known exact, presence | `\|-damage\|p1a: Snorlax\|193/255` → `\|-damage\|p1a: Snorlax\|163/255` | no | TRUE-SET-FAILS |  |

#### Harvest · `ability:harvest`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Healer · `ability:healer`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Heatproof · `ability:heatproof`

2 holders · weight 2. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fire-taken | hidden %, presence | `\|-damage\|p2a: Sinistcha\|45/100` → `\|-damage\|p2a: Sinistcha\|71/100` | no | HAZARD-UNSOUND |  |
| W-burn | hidden % | `\|-damage\|p2a: Sinistcha\|93/100 brn\|[from] brn` → `\|-damage\|p2a: Sinistcha\|97/100 brn\|[from] brn` | no | HAZARD-UNSOUND |  |

#### Heavy Metal · `ability:heavymetal`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-lethal | presence | — → `\|faint\|p2a: Aggron` | no | HAZARD-REBUILD |  |

#### Hospitality · `ability:hospitality`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Huge Power · `ability:hugepower`

2 holders · weight 2. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | HAZARD-UNSOUND |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | HAZARD-UNSOUND |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|241/255` → `\|-damage\|p1a: Snorlax\|228/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | HAZARD-UNSOUND |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | HAZARD-UNSOUND |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|200/255` | no | HAZARD-UNSOUND |  |

#### Hunger Switch · `ability:hungerswitch`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-spec-dealt | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-phys-taken | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-spec-taken | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-order-up | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-order-down | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-pace | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-trade | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-burn | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-paralysis | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-toxic | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | TRUE-SET-FAILS |  |
| W-sleep | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-confusion | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-taunt | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-pivot | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |
| W-two-moves | presence | — → `\|-formechange\|p2a: Morpeko\|Morpeko-Hangry\|` | no | SAFE |  |

#### Hustle · `ability:hustle`

5 holders · weight 5. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | HAZARD-UNSOUND |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | HAZARD-UNSOUND |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|230/255` → `\|-damage\|p1a: Snorlax\|218/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | HAZARD-UNSOUND |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | HAZARD-UNSOUND |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|180/255` | no | HAZARD-UNSOUND |  |

#### Hydration · `ability:hydration`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Hyper Cutter · `ability:hypercutter`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Ice Body · `ability:icebody`

7 holders · weight 7. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Illuminate · `ability:illuminate`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Illusion · `ability:illusion`

2 holders · weight 2. Named by: `\|-end\|p2a: Zoroark\|Illusion` (W-phys-taken, turn 1).
Other boxes: MISREAD p2 Slowking move Strength; MISREAD p2 Slowking move Round; MISSED p2 Slowking move Splash; MISSED p1 Mudsdale move Splash; MISREAD p1 Mudsdale move Strength; MISREAD p1 Mudsdale move Round.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-spec-dealt | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-phys-taken | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | turn 1 | TRUE-SET-FAILS |  |
| W-spec-taken | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | turn 1 | TRUE-SET-FAILS |  |
| W-order-up | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-order-down | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | TRUE-SET-FAILS |  |
| W-pace | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-trade | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | turn 1 | TRUE-SET-FAILS |  |
| W-burn | names, presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-paralysis | names, presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | TRUE-SET-FAILS |  |
| W-toxic | names, presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-sleep | names, presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |
| W-confusion | names, presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | TRUE-SET-FAILS |  |
| W-taunt | names, presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | TRUE-SET-FAILS |  |
| W-lethal | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | turn 1 | TRUE-SET-FAILS |  |
| W-pivot | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | turn 1 | TRUE-SET-FAILS |  |
| W-two-moves | presence | `\|switch\|p2a: Zoroark\|Zoroark, L50, F\|100/100` → — | no | SAFE |  |

#### Immunity · `ability:immunity`

1 holders · weight 1. Named by: `\|-immune\|p2a: Snorlax\|[from] ability: Immunity` (W-toxic, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Imposter · `ability:imposter`

1 holders · weight 1. Named by: `\|-transform\|p2a: Ditto\|p1b: Torkoal\|[from] ability: Imposter` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Infiltrator · `ability:infiltrator`

8 holders · weight 8. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Inner Focus · `ability:innerfocus`

11 holders · weight 11. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Insomnia · `ability:insomnia`

7 holders · weight 7. Named by: `\|-immune\|p2a: Gourgeist\|[from] ability: Insomnia` (W-sleep, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Intimidate · `ability:intimidate`

23 holders · weight 23. Named by: `\|-ability\|p2a: Scrafty\|Intimidate\|boost` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Iron Fist · `ability:ironfist`

6 holders · weight 6. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Justified · `ability:justified`

4 holders · weight 4. Named by: `\|-ability\|p2a: Arcanine\|Justified\|boost` (W-Dark-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Keen Eye · `ability:keeneye`

11 holders · weight 11. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-lethal | presence | — → `\|faint\|p2a: Skarmory` | no | SAFE |  |

#### Klutz · `ability:klutz`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Leaf Guard · `ability:leafguard`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Levitate · `ability:levitate`

9 holders · weight 9. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Libero · `ability:libero`

1 holders · weight 1. Named by: `\|-start\|p2a: Cinderace\|typechange\|Normal\|[from] ability: Libero` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Light Metal · `ability:lightmetal`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Lightning Rod · `ability:lightningrod`

5 holders · weight 5. Named by: `\|-ability\|p2a: Rhyperior\|Lightning Rod\|boost` (W-Electric-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Limber · `ability:limber`

8 holders · weight 8. Named by: `\|-immune\|p2a: Grapploct\|[from] ability: Limber` (W-paralysis, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Liquid Ooze · `ability:liquidooze`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Liquid Voice · `ability:liquidvoice`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|213/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|190/255` → `\|-damage\|p1a: Snorlax\|176/255` | no | HAZARD-UNSOUND |  |

#### Long Reach · `ability:longreach`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Magic Bounce · `ability:magicbounce`

2 holders · weight 2. Named by: `\|move\|p2a: Espeon\|Will-O-Wisp\|p1a: Snorlax\|[from] ability: Magic Bounce\|[miss]` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Magic Guard · `ability:magicguard`

3 holders · weight 3. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-burn | presence | `\|-damage\|p2a: Clefable\|94/100 brn\|[from] brn` → — | no | HAZARD-REBUILD |  |
| W-toxic | presence | `\|-damage\|p2a: Clefable\|94/100 tox\|[from] psn` → — | no | HAZARD-REBUILD |  |

#### Magician · `ability:magician`

2 holders · weight 2. Named by: `\|-item\|p2a: Delphox\|Heat Rock\|[from] ability: Magician\|[of] p1a: Snorlax` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISSED p1 Snorlax item Heat Rock.

No witness changed the log before it was named.

#### Magma Armor · `ability:magmaarmor`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Marvel Scale · `ability:marvelscale`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Mega Launcher · `ability:megalauncher`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Merciless · `ability:merciless`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-paralysis | order, presence | — → `\|-status\|p2a: Toxapex\|par` | no | SAFE |  |

#### Mimicry · `ability:mimicry`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Minus · `ability:minus`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Mirror Armor · `ability:mirrorarmor`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Mold Breaker · `ability:moldbreaker`

8 holders · weight 8. Named by: `\|-ability\|p2a: Tinkaton\|Mold Breaker` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Moody · `ability:moody`

2 holders · weight 2. Named by: `\|-ability\|p2a: Glalie\|Moody\|boost` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Motor Drive · `ability:motordrive`

1 holders · weight 1. Named by: `\|-ability\|p2a: Emolga\|Motor Drive\|boost` (W-Electric-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Moxie · `ability:moxie`

8 holders · weight 8. Named by: no line, in any witness.
Box: READ (p1 other-hidden).

No witness changed the log before it was named.

#### Multiscale · `ability:multiscale`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-taken | hidden % | `\|-damage\|p2a: Dragonite\|58/100` → `\|-damage\|p2a: Dragonite\|79/100` | no | HAZARD-UNSOUND |  |
| W-spec-taken | hidden % | `\|-damage\|p2a: Dragonite\|82/100` → `\|-damage\|p2a: Dragonite\|91/100` | no | HAZARD-UNSOUND |  |
| W-trade | hidden % | `\|-damage\|p2a: Dragonite\|78/100` → `\|-damage\|p2a: Dragonite\|89/100` | no | HAZARD-UNSOUND |  |
| W-pivot | hidden % | `\|-damage\|p2a: Dragonite\|58/100` → `\|-damage\|p2a: Dragonite\|79/100` | no | HAZARD-UNSOUND |  |

#### Mummy · `ability:mummy`

1 holders · weight 1. Named by: `\|-activate\|p2a: Cofagrigus\|ability: Mummy\|p1a: Snorlax\|[ability] Gluttony` (W-phys-taken, turn 1).
Other boxes: MISSED p1 Snorlax ability Gluttony; MISSED p2 Blastoise ability Torrent.

No witness changed the log before it was named.

#### Natural Cure · `ability:naturalcure`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### No Guard · `ability:noguard`

3 holders · weight 3. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-confusion | presence | `\|-activate\|p2a: Machamp\|confusion` → — | no | SAFE |  |

#### Oblivious · `ability:oblivious`

4 holders · weight 4. Named by: `\|-immune\|p2a: Mamoswine\|[from] ability: Oblivious` (W-taunt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Opportunist · `ability:opportunist`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Overcoat · `ability:overcoat`

3 holders · weight 3. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-spec-taken | presence | — → `\|-damage\|p2a: Kommo-o\|81/100` | no | SAFE |  |

#### Overgrow · `ability:overgrow`

11 holders · weight 11. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Own Tempo · `ability:owntempo`

8 holders · weight 8. Named by: `\|-immune\|p2a: Tinkaton\|confusion\|[from] ability: Own Tempo` (W-confusion, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Pickpocket · `ability:pickpocket`

4 holders · weight 4. Named by: `\|-enditem\|p1a: Snorlax\|Heat Rock\|[silent]\|[from] ability: Pickpocket\|[of] p1a: Snorlax` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Pickup · `ability:pickup`

6 holders · weight 6. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-sleep | known exact, presence | `\|move\|p2a: Gourgeist\|Strength\|p1a: Snorlax` → — | no | SAFE |  |

#### Pixilate · `ability:pixilate`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|230/255` → `\|-damage\|p1a: Snorlax\|210/255` | no | TRUE-SET-FAILS |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-Normal-dealt | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|238/255` → `\|-damage\|p1a: Snorlax\|225/255` | no | TRUE-SET-FAILS |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|221/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | TRUE-SET-FAILS |  |

#### Plus · `ability:plus`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Poison Heal · `ability:poisonheal`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-toxic | presence | `\|-damage\|p2a: Gliscor\|94/100 tox\|[from] psn` → — | no | HAZARD-REBUILD | HAZARD-REBUILD |

#### Poison Point · `ability:poisonpoint`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Poison Touch · `ability:poisontouch`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Prankster · `ability:prankster`

6 holders · weight 6. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-order-up | order | `p1a: Ampharos before p2a: Grimmsnarl` → `p2a: Grimmsnarl before p1a: Ampharos` | no | SAFE |  |
| W-pace | order | `p1a: Ampharos before p2a: Grimmsnarl` → `p2a: Grimmsnarl before p1a: Ampharos` | no | SAFE |  |

#### Pressure · `ability:pressure`

7 holders · weight 7. Named by: `\|-ability\|p2a: Kingambit\|Pressure` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Protean · `ability:protean`

2 holders · weight 2. Named by: `\|-start\|p2a: Meowscarada\|typechange\|Normal\|[from] ability: Protean` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Psychic Surge · `ability:psychicsurge`

2 holders · weight 2. Named by: `\|-fieldstart\|move: Psychic Terrain\|[from] ability: Psychic Surge\|[of] p2a: Indeedee` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Punk Rock · `ability:punkrock`

2 holders · weight 2. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|229/255` → `\|-damage\|p1a: Snorlax\|222/255` | no | SAFE |  |
| W-spec-taken | hidden %, presence | `\|-damage\|p2a: Toxtricity\|74/100` → `\|-damage\|p2a: Toxtricity\|87/100` | no | SAFE |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|183/255` → `\|-damage\|p1a: Snorlax\|176/255` | no | SAFE |  |

#### Pure Power · `ability:purepower`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|239/255` → `\|-damage\|p1a: Snorlax\|224/255` | no | SAFE |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|223/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |

#### Purifying Salt · `ability:purifyingsalt`

1 holders · weight 1. Named by: `\|-immune\|p2a: Garganacl\|[from] ability: Purifying Salt` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Ghost-taken | hidden % | `\|-damage\|p2a: Garganacl\|81/100` → `\|-damage\|p2a: Garganacl\|90/100` | no | SAFE |  |
| W-lethal | presence | — → `\|faint\|p2a: Garganacl` | no | SAFE |  |

#### Queenly Majesty · `ability:queenlymajesty`

1 holders · weight 1. Named by: `\|cant\|p2a: Tsareena\|ability: Queenly Majesty\|Quick Attack\|[of] p1a: Snorlax` (W-trade, turn 1).
Box: MISSED (p2 holder-hidden).
Other boxes: MISREAD p2 Tsareena move Quick Attack.

No witness changed the log before it was named.

#### Quick Draw · `ability:quickdraw`

1 holders · weight 1. Named by: `\|-activate\|p2a: Slowbro\|ability: Quick Draw` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-confusion | presence | — → `\|-start\|p2a: Slowbro\|confusion` | turn 2 | HAZARD-REBUILD |  |

#### Quick Feet · `ability:quickfeet`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Rain Dish · `ability:raindish`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Rattled · `ability:rattled`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Receiver · `ability:receiver`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Reckless · `ability:reckless`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Refrigerate · `ability:refrigerate`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|232/255` → `\|-damage\|p1a: Snorlax\|213/255` | no | TRUE-SET-FAILS |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-Normal-dealt | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|236/255` → `\|-damage\|p1a: Snorlax\|221/255` | no | TRUE-SET-FAILS |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|186/255` | no | TRUE-SET-FAILS |  |

#### Regenerator · `ability:regenerator`

8 holders · weight 8. Named by: `\|-heal\|p2a: Hydrapple\|98/100\|[from] ability: Regenerator\|[silent]` (W-pivot, turn 2).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Ripen · `ability:ripen`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Rivalry · `ability:rivalry`

2 holders · weight 2. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | SAFE |  |
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|232/255` → `\|-damage\|p1a: Snorlax\|238/255` | no | SAFE |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | SAFE |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|228/255` → `\|-damage\|p1a: Snorlax\|235/255` | no | SAFE |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | SAFE |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | SAFE |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | SAFE |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|214/255` | no | SAFE |  |

#### Rock Head · `ability:rockhead`

5 holders · weight 5. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-lethal | presence | — → `\|faint\|p2a: Aggron` | no | HAZARD-REBUILD |  |

#### Rough Skin · `ability:roughskin`

2 holders · weight 2. Named by: `\|-damage\|p1a: Snorlax\|224/255\|[from] ability: Rough Skin\|[of] p2a: Garchomp` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Run Away · `ability:runaway`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sand Force · `ability:sandforce`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sand Rush · `ability:sandrush`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sand Spit · `ability:sandspit`

1 holders · weight 1. Named by: `\|-weather\|Sandstorm\|[from] ability: Sand Spit\|[of] p2a: Sandaconda` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Sand Stream · `ability:sandstream`

2 holders · weight 2. Named by: `\|-weather\|Sandstorm\|[from] ability: Sand Stream\|[of] p2a: Tyranitar` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Sand Veil · `ability:sandveil`

6 holders · weight 6. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sap Sipper · `ability:sapsipper`

7 holders · weight 7. Named by: `\|-ability\|p2a: Goodra\|Sap Sipper\|boost` (W-Grass-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Scrappy · `ability:scrappy`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Screen Cleaner · `ability:screencleaner`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Seed Sower · `ability:seedsower`

1 holders · weight 1. Named by: `\|-fieldstart\|move: Grassy Terrain\|[from] ability: Seed Sower\|[of] p2a: Arboliva` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Sharpness · `ability:sharpness`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Shed Skin · `ability:shedskin`

3 holders · weight 3. Named by: `\|-activate\|p2a: Scrafty\|ability: Shed Skin` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Sheer Force · `ability:sheerforce`

10 holders · weight 10. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Shell Armor · `ability:shellarmor`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Shield Dust · `ability:shielddust`

20 holders · weight 20. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Skill Link · `ability:skilllink`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Slush Rush · `ability:slushrush`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sniper · `ability:sniper`

4 holders · weight 4. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Snow Cloak · `ability:snowcloak`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Snow Warning · `ability:snowwarning`

4 holders · weight 4. Named by: `\|-weather\|Snowscape\|[from] ability: Snow Warning\|[of] p2a: Aurorus` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Solar Power · `ability:solarpower`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Solid Rock · `ability:solidrock`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Soundproof · `ability:soundproof`

4 holders · weight 4. Named by: `\|-immune\|p2a: Kommo-o\|[from] ability: Soundproof` (W-spec-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Speed Boost · `ability:speedboost`

4 holders · weight 4. Named by: `\|-ability\|p2a: Blaziken\|Speed Boost\|boost` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Stakeout · `ability:stakeout`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Stall · `ability:stall`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-spec-dealt | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-phys-taken | order, presence | `\|move\|p2a: Sableye\|Splash\|p2a: Sableye` → — | no | HAZARD-UNSOUND |  |
| W-spec-taken | order, presence | `\|move\|p2a: Sableye\|Splash\|p2a: Sableye` → — | no | HAZARD-UNSOUND |  |
| W-order-up | order | `p2a: Sableye before p2b: Avalugg` → `p2b: Avalugg before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-order-down | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-pace | order | `p2a: Sableye before p2b: Avalugg` → `p2b: Avalugg before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-trade | order | `p2a: Sableye before p2b: Avalugg` → `p2b: Avalugg before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-burn | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-paralysis | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-toxic | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | TRUE-SET-FAILS | HAZARD-REBUILD |
| W-sleep | known exact, order, presence | `\|move\|p2a: Sableye\|Splash\|p2a: Sableye` → — | no | HAZARD-UNSOUND |  |
| W-confusion | hidden %, presence | `\|move\|p2a: Sableye\|Splash\|p2a: Sableye` → — | no | HAZARD-REBUILD |  |
| W-taunt | order, presence | `\|move\|p2a: Sableye\|Splash\|p2a: Sableye` → — | no | HAZARD-UNSOUND |  |
| W-lethal | presence | `\|move\|p2a: Sableye\|Splash\|p2a: Sableye` → — | no | HAZARD-REBUILD |  |
| W-pivot | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |
| W-two-moves | order | `p2a: Sableye before p1a: Snorlax` → `p1a: Snorlax before p2a: Sableye` | no | HAZARD-UNSOUND |  |

#### Stalwart · `ability:stalwart`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-lethal | presence | — → `\|faint\|p2a: Archaludon` | no | SAFE |  |

#### Stamina · `ability:stamina`

2 holders · weight 2. Named by: `\|-ability\|p2a: Archaludon\|Stamina\|boost` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-lethal | presence | — → `\|faint\|p2a: Archaludon` | no | SAFE |  |

#### Stance Change · `ability:stancechange`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-spec-dealt | known exact, presence | `\|-damage\|p1a: Snorlax\|240/255` → `\|-damage\|p1a: Snorlax\|224/255` | no | SAFE |  |
| W-trade | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-burn | known exact, presence | `\|-damage\|p1a: Snorlax\|241/255` → `\|-damage\|p1a: Snorlax\|224/255` | no | SAFE |  |
| W-paralysis | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-toxic | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-sleep | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-taunt | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |
| W-two-moves | known exact, presence | `\|-damage\|p1a: Snorlax\|227/255` → `\|-damage\|p1a: Snorlax\|193/255` | no | SAFE |  |

#### Static · `ability:static`

7 holders · weight 7. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Steadfast · `ability:steadfast`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Steely Spirit · `ability:steelyspirit`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Steel-dealt | known exact | `\|-damage\|p1a: Snorlax\|180/255` → `\|-damage\|p1a: Snorlax\|143/255` | no | HAZARD-UNSOUND |  |

#### Stench · `ability:stench`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sticky Hold · `ability:stickyhold`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Strong Jaw · `ability:strongjaw`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sturdy · `ability:sturdy`

9 holders · weight 9. Named by: `\|-immune\|p2a: Aggron\|[from] ability: Sturdy` (W-lethal, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Suction Cups · `ability:suctioncups`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Super Luck · `ability:superluck`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Supersweet Syrup · `ability:supersweetsyrup`

1 holders · weight 1. Named by: `\|-ability\|p2a: Hydrapple\|Supersweet Syrup` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Supreme Overlord · `ability:supremeoverlord`

1 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-lethal | presence | — → `\|-end\|p2a: Kingambit\|fallenundefined\|[silent]` | no | HAZARD-REBUILD |  |
| W-pivot | presence | — → `\|-end\|p2a: Kingambit\|fallenundefined\|[silent]` | no | HAZARD-REBUILD |  |

#### Surge Surfer · `ability:surgesurfer`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Swarm · `ability:swarm`

7 holders · weight 7. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Sweet Veil · `ability:sweetveil`

10 holders · weight 10. Named by: `\|-block\|p2a: Tsareena\|ability: Sweet Veil\|[of] p2a: Tsareena` (W-sleep, turn 1).
Box: MISSED (p2 holder-hidden).

No witness changed the log before it was named.

#### Swift Swim · `ability:swiftswim`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Symbiosis · `ability:symbiosis`

3 holders · weight 3. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Synchronize · `ability:synchronize`

7 holders · weight 7. Named by: `\|-activate\|p2a: Umbreon\|ability: Synchronize` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Tangled Feet · `ability:tangledfeet`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Technician · `ability:technician`

10 holders · weight 10. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|237/255` → `\|-damage\|p1a: Snorlax\|229/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | order, presence | — → `\|-status\|p2a: Grapploct\|par` | no | HAZARD-REBUILD |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|184/255` → `\|-damage\|p1a: Snorlax\|176/255` | no | HAZARD-UNSOUND |  |

#### Telepathy · `ability:telepathy`

5 holders · weight 5. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Thermal Exchange · `ability:thermalexchange`

1 holders · weight 1. Named by: `\|-ability\|p2a: Baxcalibur\|Thermal Exchange\|boost` (W-Fire-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Thick Fat · `ability:thickfat`

4 holders · weight 4. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fire-taken | hidden % | `\|-damage\|p2a: Azumarill\|85/100` → `\|-damage\|p2a: Azumarill\|92/100` | no | SAFE |  |
| W-Ice-taken | hidden % | `\|-damage\|p2a: Azumarill\|85/100` → `\|-damage\|p2a: Azumarill\|92/100` | no | SAFE |  |

#### Torrent · `ability:torrent`

11 holders · weight 11. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Tough Claws · `ability:toughclaws`

3 holders · weight 3. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | SAFE |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | SAFE |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|231/255` → `\|-damage\|p1a: Snorlax\|224/255` | no | SAFE |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | SAFE |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | TRUE-SET-FAILS |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | SAFE |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | SAFE |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|206/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | SAFE |  |

#### Toxic Debris · `ability:toxicdebris`

1 holders · weight 1. Named by: `\|-activate\|p2a: Glimmora\|ability: Toxic Debris` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Trace · `ability:trace`

1 holders · weight 1. Named by: `\|-ability\|p2a: Gardevoir\|Gluttony\|Trace\|[from] ability: Trace\|[of] p1a: Snorlax` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).
Other boxes: MISSED p1 Snorlax ability Gluttony; MISSED p1 Ampharos ability Plus; MISSED p1 Torkoal ability Shell Armor; MISSED p2 Blastoise ability Torrent.

No witness changed the log before it was named.

#### Unaware · `ability:unaware`

2 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Unburden · `ability:unburden`

6 holders · weight 6. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-sleep | known exact, presence | `\|move\|p2a: Slurpuff\|Strength\|p1a: Snorlax` → — | no | HAZARD-REBUILD |  |

#### Unnerve · `ability:unnerve`

7 holders · weight 7. Named by: `\|-ability\|p2a: Tyranitar\|Unnerve` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Vital Spirit · `ability:vitalspirit`

2 holders · weight 2. Named by: `\|-immune\|p2a: Annihilape\|[from] ability: Vital Spirit` (W-sleep, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Volt Absorb · `ability:voltabsorb`

2 holders · weight 2. Named by: `\|-immune\|p2a: Jolteon\|[from] ability: Volt Absorb` (W-Electric-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Wandering Spirit · `ability:wanderingspirit`

1 holders · weight 1. Named by: `\|-activate\|p1a: Snorlax\|Skill Swap\|Wandering Spirit\|Gluttony\|[of] p2a: Runerigus` (W-phys-taken, turn 1).
Other boxes: MISSED p1 Snorlax ability Gluttony; MISSED p2 Blastoise ability Torrent.

No witness changed the log before it was named.

#### Water Absorb · `ability:waterabsorb`

3 holders · weight 3. Named by: `\|-immune\|p2a: Araquanid\|[from] ability: Water Absorb` (W-Water-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Water Bubble · `ability:waterbubble`

1 holders · weight 1. Named by: `\|-immune\|p2a: Araquanid\|[from] ability: Water Bubble` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fire-taken | hidden % | `\|-damage\|p2a: Araquanid\|68/100` → `\|-damage\|p2a: Araquanid\|84/100` | no | SAFE |  |
| W-Water-dealt | known exact | `\|-damage\|p1a: Snorlax\|201/255` → `\|-damage\|p1a: Snorlax\|150/255` | no | SAFE |  |

#### Weak Armor · `ability:weakarmor`

7 holders · weight 7. Named by: `\|-ability\|p2a: Skarmory\|Weak Armor\|boost` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### White Smoke · `ability:whitesmoke`

1 holders · weight 1. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Zero to Hero · `ability:zerotohero`

1 holders · weight 1. Named by: `\|-activate\|p2a: Palafin\|ability: Zero to Hero` (W-pivot, turn 3).

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-pivot | presence | — → `\|detailschange\|p2a: Palafin\|Palafin-Hero, L50, F` | turn 3 | SAFE |  |

## 5. Items

#### Abomasite · `item:abomasite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Abomasnow\|Abomasnow\|Abomasite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISREAD p2 Abomasnow ability Snow Warning.

No witness changed the log before it was named.

#### Absolite · `item:absolite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Absol\|Absol\|Absolite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Absolite Z · `item:absolitez`

293 holders · weight 1. Named by: `\|-mega\|p2a: Absol\|Absol\|Absolite Z` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Aerodactylite · `item:aerodactylite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Aerodactyl\|Aerodactyl\|Aerodactylite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Aggronite · `item:aggronite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Aggron\|Aggron\|Aggronite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Air Balloon · `item:airballoon`

293 holders · weight 293. Named by: `\|-item\|p2a: Blastoise\|Air Balloon` (W-phys-dealt, turn 0).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Alakazite · `item:alakazite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Alakazam\|Alakazam\|Alakazite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISSED p1 Snorlax ability Gluttony.

No witness changed the log before it was named.

#### Altarianite · `item:altarianite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Altaria\|Altaria\|Altarianite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Ampharosite · `item:ampharosite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Ampharos\|Ampharos\|Ampharosite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Aspear Berry · `item:aspearberry`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Audinite · `item:audinite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Audino\|Audino\|Audinite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Babiri Berry · `item:babiriberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Florges\|Babiri Berry\|[eat]` (W-Steel-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Banettite · `item:banettite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Banette\|Banette\|Banettite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Barbaracite · `item:barbaracite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Barbaracle\|Barbaracle\|Barbaracite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Baxcalibrite · `item:baxcalibrite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Baxcalibur\|Baxcalibur\|Baxcalibrite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Beedrillite · `item:beedrillite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Beedrill\|Beedrill\|Beedrillite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Big Root · `item:bigroot`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Binding Band · `item:bindingband`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Black Belt · `item:blackbelt`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fighting-dealt | known exact | `\|-damage\|p1a: Snorlax\|179/255` → `\|-damage\|p1a: Snorlax\|165/255` | no | HAZARD-UNSOUND |  |

#### Black Glasses · `item:blackglasses`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Dark-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Blastoisinite · `item:blastoisinite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Blastoise\|Blastoise\|Blastoisinite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Blazikenite · `item:blazikenite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Blaziken\|Blaziken\|Blazikenite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISREAD p2 Blaziken ability Speed Boost.

No witness changed the log before it was named.

#### Bright Powder · `item:brightpowder`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Cameruptite · `item:cameruptite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Camerupt\|Camerupt\|Cameruptite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Chandelurite · `item:chandelurite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Chandelure\|Chandelure\|Chandelurite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Charcoal · `item:charcoal`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fire-dealt | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|210/255` | no | HAZARD-UNSOUND |  |

#### Charizardite X · `item:charizarditex`

293 holders · weight 1. Named by: `\|-mega\|p2a: Charizard\|Charizard\|Charizardite X` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Charizardite Y · `item:charizarditey`

293 holders · weight 1. Named by: `\|-mega\|p2a: Charizard\|Charizard\|Charizardite Y` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Charti Berry · `item:chartiberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Dragonite\|Charti Berry\|[eat]` (W-Rock-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Cheri Berry · `item:cheriberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Cheri Berry\|[eat]` (W-paralysis, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Chesnaughtite · `item:chesnaughtite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Chesnaught\|Chesnaught\|Chesnaughtite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Chesto Berry · `item:chestoberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Chesto Berry\|[eat]` (W-sleep, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Chilan Berry · `item:chilanberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Chilan Berry\|[eat]` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Chimechite · `item:chimechite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Chimecho\|Chimecho\|Chimechite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Choice Scarf · `item:choicescarf`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | presence | `\|move\|p2a: Blastoise\|Splash\|p2a: Blastoise` → — | no | SAFE |  |
| W-spec-dealt | presence | `\|move\|p2a: Blastoise\|Splash\|p2a: Blastoise` → — | no | SAFE |  |
| W-order-up | order | `p1a: Ampharos before p2a: Blastoise` → `p2a: Blastoise before p1a: Ampharos` | no | HAZARD-UNSOUND |  |
| W-trade | presence | `\|move\|p2a: Blastoise\|Splash\|p2a: Blastoise` → — | no | SAFE |  |
| W-burn | presence | `\|move\|p2a: Blastoise\|Strength\|p1a: Snorlax` → — | no | SAFE |  |
| W-paralysis | order, presence | `\|move\|p2a: Blastoise\|Strength\|p1a: Snorlax` → — | no | SAFE |  |
| W-toxic | presence | `\|move\|p2a: Blastoise\|Strength\|p1a: Snorlax` → — | no | TRUE-SET-FAILS |  |
| W-sleep | presence | `\|move\|p2a: Blastoise\|Strength\|p1a: Snorlax` → — | no | SAFE |  |
| W-taunt | presence | `\|move\|p2a: Blastoise\|Strength\|p1a: Snorlax` → — | no | TRUE-SET-FAILS |  |
| W-two-moves | presence | `\|move\|p2a: Blastoise\|Round\|p1a: Snorlax` → — | no | SAFE |  |

#### Chople Berry · `item:chopleberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Aggron\|Chople Berry\|[eat]` (W-Fighting-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Clefablite · `item:clefablite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Clefable\|Clefable\|Clefablite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Coba Berry · `item:cobaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Kommo-o\|Coba Berry\|[eat]` (W-Flying-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Colbur Berry · `item:colburberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Metagross\|Colbur Berry\|[eat]` (W-Dark-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Crabominite · `item:crabominite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Crabominable\|Crabominable\|Crabominite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Damp Rock · `item:damprock`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Delphoxite · `item:delphoxite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Delphox\|Delphox\|Delphoxite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Dragalgite · `item:dragalgite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Dragalge\|Dragalge\|Dragalgite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Dragon Fang · `item:dragonfang`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Dragon-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Dragoninite · `item:dragoninite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Dragonite\|Dragonite\|Dragoninite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Drampanite · `item:drampanite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Drampa\|Drampa\|Drampanite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Eelektrossite · `item:eelektrossite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Eelektross\|Eelektross\|Eelektrossite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Eject Button · `item:ejectbutton`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Eject Button` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Electric Seed · `item:electricseed`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Emboarite · `item:emboarite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Emboar\|Emboar\|Emboarite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Excadrite · `item:excadrite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Excadrill\|Excadrill\|Excadrite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Expert Belt · `item:expertbelt`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Fairy Feather · `item:fairyfeather`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Fairy-dealt | known exact | `\|-damage\|p1a: Snorlax\|210/255` → `\|-damage\|p1a: Snorlax\|201/255` | no | HAZARD-UNSOUND |  |

#### Falinksite · `item:falinksite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Falinks\|Falinks\|Falinksite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Feraligite · `item:feraligite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Feraligatr\|Feraligatr\|Feraligite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Floettite · `item:floettite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Floette\|Floette\|Floettite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Focus Band · `item:focusband`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Focus Sash · `item:focussash`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Focus Sash` (W-lethal, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Froslassite · `item:froslassite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Froslass\|Froslass\|Froslassite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Galladite · `item:galladite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Gallade\|Gallade\|Galladite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Garchompite · `item:garchompite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Garchomp\|Garchomp\|Garchompite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Garchompite Z · `item:garchompitez`

293 holders · weight 1. Named by: `\|-mega\|p2a: Garchomp\|Garchomp\|Garchompite Z` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Gardevoirite · `item:gardevoirite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Gardevoir\|Gardevoir\|Gardevoirite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Gengarite · `item:gengarite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Gengar\|Gengar\|Gengarite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Glalitite · `item:glalitite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Glalie\|Glalie\|Glalitite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Glimmoranite · `item:glimmoranite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Glimmora\|Glimmora\|Glimmoranite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Golisopite · `item:golisopite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Golisopod\|Golisopod\|Golisopite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Golurkite · `item:golurkite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Golurk\|Golurk\|Golurkite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Grassy Seed · `item:grassyseed`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Greninjite · `item:greninjite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Greninja\|Greninja\|Greninjite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISREAD p2 Greninja ability Protean.

No witness changed the log before it was named.

#### Gyaradosite · `item:gyaradosite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Gyarados\|Gyarados\|Gyaradosite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Haban Berry · `item:habanberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Kommo-o\|Haban Berry\|[eat]` (W-Dragon-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Hard Stone · `item:hardstone`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Rock-dealt | known exact | `\|-damage\|p1a: Snorlax\|205/255` → `\|-damage\|p1a: Snorlax\|195/255` | no | HAZARD-UNSOUND |  |

#### Hawluchanite · `item:hawluchanite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Hawlucha\|Hawlucha\|Hawluchanite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Heat Rock · `item:heatrock`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Heracronite · `item:heracronite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Heracross\|Heracross\|Heracronite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Houndoominite · `item:houndoominite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Houndoom\|Houndoom\|Houndoominite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Icy Rock · `item:icyrock`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Iron Ball · `item:ironball`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-taken | presence | `\|move\|p2a: Blastoise\|Splash\|p2a: Blastoise` → — | no | HAZARD-UNSOUND |  |
| W-spec-taken | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-order-down | order | `p2a: Blastoise before p1a: Ampharos` → `p1a: Ampharos before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-pace | order | `p2a: Blastoise before p1a: Shuckle` → `p1a: Shuckle before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-trade | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-Flying-taken | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-Ground-taken | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-burn | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-paralysis | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-toxic | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-sleep | order, presence | `\|-curestatus\|p2a: Blastoise\|slp\|[msg]` → — | no | HAZARD-UNSOUND |  |
| W-confusion | presence | `\|-activate\|p2a: Blastoise\|confusion` → — | no | TRUE-SET-FAILS |  |
| W-taunt | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |
| W-two-moves | order | `p2a: Blastoise before p1a: Snorlax` → `p1a: Snorlax before p2a: Blastoise` | no | HAZARD-UNSOUND |  |

#### Kangaskhanite · `item:kangaskhanite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Kangaskhan\|Kangaskhan\|Kangaskhanite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Kasib Berry · `item:kasibberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Metagross\|Kasib Berry\|[eat]` (W-Ghost-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Kebia Berry · `item:kebiaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Florges\|Kebia Berry\|[eat]` (W-Poison-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### King's Rock · `item:kingsrock`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Leek · `item:leek`

293 holders · weight 2. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Leftovers · `item:leftovers`

293 holders · weight 293. Named by: `\|-heal\|p2a: Blastoise\|62/100\|[from] item: Leftovers` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Leppa Berry · `item:leppaberry`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Life Orb · `item:lifeorb`

293 holders · weight 293. Named by: `\|-damage\|p2a: Blastoise\|90/100\|[from] item: Life Orb` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Light Ball · `item:lightball`

293 holders · weight 1. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | HAZARD-UNSOUND |  |
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|240/255` → `\|-damage\|p1a: Snorlax\|227/255` | no | HAZARD-UNSOUND |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | HAZARD-UNSOUND |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|240/255` → `\|-damage\|p1a: Snorlax\|226/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | HAZARD-UNSOUND |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | TRUE-SET-FAILS | HAZARD-REBUILD |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | HAZARD-UNSOUND |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|225/255` → `\|-damage\|p1a: Snorlax\|196/255` | no | HAZARD-UNSOUND |  |

#### Light Clay · `item:lightclay`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Lopunnite · `item:lopunnite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Lopunny\|Lopunny\|Lopunnite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Lucarionite · `item:lucarionite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Lucario\|Lucario\|Lucarionite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Lucarionite Z · `item:lucarionitez`

293 holders · weight 1. Named by: `\|-mega\|p2a: Lucario\|Lucario\|Lucarionite Z` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Lum Berry · `item:lumberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Lum Berry\|[eat]` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Magnet · `item:magnet`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Electric-dealt | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|210/255` | no | HAZARD-UNSOUND |  |

#### Malamarite · `item:malamarite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Malamar\|Malamar\|Malamarite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Manectite · `item:manectite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Manectric\|Manectric\|Manectite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Mawilite · `item:mawilite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Mawile\|Mawile\|Mawilite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Medichamite · `item:medichamite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Medicham\|Medicham\|Medichamite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Meganiumite · `item:meganiumite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Meganium\|Meganium\|Meganiumite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Mental Herb · `item:mentalherb`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Mental Herb` (W-taunt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Meowsticite · `item:meowsticite`

293 holders · weight 2. Named by: `\|-mega\|p2a: Meowstic\|Meowstic\|Meowsticite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISSED p1 Snorlax ability Gluttony.

No witness changed the log before it was named.

#### Metagrossite · `item:metagrossite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Metagross\|Metagross\|Metagrossite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Metal Coat · `item:metalcoat`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Steel-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Metronome · `item:metronome`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|175/255` → `\|-damage\|p1a: Snorlax\|167/255` | no | HAZARD-UNSOUND |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|175/255` → `\|-damage\|p1a: Snorlax\|167/255` | no | HAZARD-UNSOUND |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|175/255` → `\|-damage\|p1a: Snorlax\|167/255` | no | HAZARD-UNSOUND |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|175/255` → `\|-damage\|p1a: Snorlax\|167/255` | no | HAZARD-UNSOUND |  |

#### Miracle Seed · `item:miracleseed`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Grass-dealt | known exact | `\|-damage\|p1a: Snorlax\|210/255` → `\|-damage\|p1a: Snorlax\|201/255` | no | HAZARD-UNSOUND |  |

#### Misty Seed · `item:mistyseed`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Muscle Band · `item:muscleband`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|235/255` → `\|-damage\|p1a: Snorlax\|233/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|211/255` | no | HAZARD-UNSOUND |  |

#### Mystic Water · `item:mysticwater`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Water-dealt | known exact | `\|-damage\|p1a: Snorlax\|195/255` → `\|-damage\|p1a: Snorlax\|183/255` | no | HAZARD-UNSOUND |  |

#### Never-Melt Ice · `item:nevermeltice`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Ice-dealt | known exact | `\|-damage\|p1a: Snorlax\|217/255` → `\|-damage\|p1a: Snorlax\|210/255` | no | HAZARD-UNSOUND |  |

#### Normal Gem · `item:normalgem`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Normal Gem\|[from] gem\|[move] Strength` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Occa Berry · `item:occaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Metagross\|Occa Berry\|[eat]` (W-Fire-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Oran Berry · `item:oranberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Oran Berry\|[eat]` (W-phys-taken, turn 2).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Passho Berry · `item:passhoberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Aggron\|Passho Berry\|[eat]` (W-Water-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Payapa Berry · `item:payapaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Kommo-o\|Payapa Berry\|[eat]` (W-Psychic-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Pecha Berry · `item:pechaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Pecha Berry\|[eat]` (W-toxic, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Persim Berry · `item:persimberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Persim Berry\|[eat]` (W-confusion, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Pidgeotite · `item:pidgeotite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Pidgeot\|Pidgeot\|Pidgeotite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Pinsirite · `item:pinsirite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Pinsir\|Pinsir\|Pinsirite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Poison Barb · `item:poisonbarb`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Poison-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Psychic Seed · `item:psychicseed`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Pyroarite · `item:pyroarite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Pyroar\|Pyroar\|Pyroarite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Quick Claw · `item:quickclaw`

293 holders · weight 293. Named by: `\|-activate\|p2a: Blastoise\|item: Quick Claw` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Raichunite X · `item:raichunitex`

293 holders · weight 2. Named by: `\|-mega\|p2a: Raichu\|Raichu\|Raichunite X` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Raichunite Y · `item:raichunitey`

293 holders · weight 2. Named by: `\|-mega\|p2a: Raichu\|Raichu\|Raichunite Y` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Rawst Berry · `item:rawstberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Rawst Berry\|[eat]` (W-burn, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Red Card · `item:redcard`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Red Card\|[of] p1a: Snorlax` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Rindo Berry · `item:rindoberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Rindo Berry\|[eat]` (W-Grass-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Rocky Helmet · `item:rockyhelmet`

293 holders · weight 293. Named by: `\|-damage\|p1a: Snorlax\|213/255\|[from] item: Rocky Helmet\|[of] p2a: Blastoise` (W-phys-taken, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).
Other boxes: FALSE p1 Snorlax item Rocky Helmet; FALSE p2 Blastoise item Rocky Helmet.

No witness changed the log before it was named.

#### Roseli Berry · `item:roseliberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Kommo-o\|Roseli Berry\|[eat]` (W-Fairy-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Sablenite · `item:sablenite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Sableye\|Sableye\|Sablenite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Salamencite · `item:salamencite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Salamence\|Salamence\|Salamencite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Sceptilite · `item:sceptilite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Sceptile\|Sceptile\|Sceptilite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Scizorite · `item:scizorite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Scizor\|Scizor\|Scizorite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Scolipite · `item:scolipite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Scolipede\|Scolipede\|Scolipite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Scope Lens · `item:scopelens`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Scovillainite · `item:scovillainite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Scovillain\|Scovillain\|Scovillainite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Scraftinite · `item:scraftinite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Scrafty\|Scrafty\|Scraftinite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).
Other boxes: MISREAD p2 Scrafty ability Intimidate.

No witness changed the log before it was named.

#### Sharp Beak · `item:sharpbeak`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Flying-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Sharpedonite · `item:sharpedonite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Sharpedo\|Sharpedo\|Sharpedonite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Shed Shell · `item:shedshell`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Shell Bell · `item:shellbell`

293 holders · weight 293. Named by: `\|-heal\|p2a: Blastoise\|81/100\|[from] item: Shell Bell\|[of] p1a: Snorlax` (W-trade, turn 1).
Box: READ (p2 holder-hidden), READ (p1 other-hidden).

No witness changed the log before it was named.

#### Shuca Berry · `item:shucaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Aggron\|Shuca Berry\|[eat]` (W-Ground-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Silk Scarf · `item:silkscarf`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-phys-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|234/255` → `\|-damage\|p1a: Snorlax\|230/255` | no | HAZARD-UNSOUND |  |
| W-trade | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-Normal-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-burn | known exact | `\|-damage\|p1a: Snorlax\|235/255` → `\|-damage\|p1a: Snorlax\|231/255` | no | HAZARD-UNSOUND |  |
| W-paralysis | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-toxic | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-sleep | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-taunt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Silver Powder · `item:silverpowder`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Bug-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Sitrus Berry · `item:sitrusberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Blastoise\|Sitrus Berry\|[eat]` (W-phys-taken, turn 2).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Skarmorite · `item:skarmorite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Skarmory\|Skarmory\|Skarmorite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Slowbronite · `item:slowbronite`

293 holders · weight 2. Named by: `\|-mega\|p2a: Slowbro\|Slowbro\|Slowbronite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Smooth Rock · `item:smoothrock`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Soft Sand · `item:softsand`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Ground-dealt | known exact | `\|-damage\|p1a: Snorlax\|207/255` → `\|-damage\|p1a: Snorlax\|198/255` | no | HAZARD-UNSOUND |  |

#### Spell Tag · `item:spelltag`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Staraptite · `item:staraptite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Staraptor\|Staraptor\|Staraptite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Starminite · `item:starminite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Starmie\|Starmie\|Starminite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Steelixite · `item:steelixite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Steelix\|Steelix\|Steelixite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Swampertite · `item:swampertite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Swampert\|Swampert\|Swampertite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Tanga Berry · `item:tangaberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Torterra\|Tanga Berry\|[eat]` (W-Bug-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Terrain Extender · `item:terrainextender`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Twisted Spoon · `item:twistedspoon`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-Psychic-dealt | known exact | `\|-damage\|p1a: Snorlax\|215/255` → `\|-damage\|p1a: Snorlax\|207/255` | no | HAZARD-UNSOUND |  |

#### Tyranitarite · `item:tyranitarite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Tyranitar\|Tyranitar\|Tyranitarite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Venusaurite · `item:venusaurite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Venusaur\|Venusaur\|Venusaurite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Victreebelite · `item:victreebelite`

293 holders · weight 1. Named by: `\|-mega\|p2a: Victreebel\|Victreebel\|Victreebelite` (W-phys-dealt, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Wacan Berry · `item:wacanberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Corviknight\|Wacan Berry\|[eat]` (W-Electric-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### White Herb · `item:whiteherb`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Wide Lens · `item:widelens`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

#### Wise Glasses · `item:wiseglasses`

293 holders · weight 293. Named by: no line, in any witness.

| Witness | Sinks | Without → with | Named? | Hazard | Control |
|---|---|---|---|---|---|
| W-spec-dealt | known exact | `\|-damage\|p1a: Snorlax\|234/255` → `\|-damage\|p1a: Snorlax\|232/255` | no | HAZARD-UNSOUND |  |
| W-two-moves | known exact | `\|-damage\|p1a: Snorlax\|194/255` → `\|-damage\|p1a: Snorlax\|192/255` | no | HAZARD-UNSOUND |  |

#### Yache Berry · `item:yacheberry`

293 holders · weight 293. Named by: `\|-enditem\|p2a: Kommo-o\|Yache Berry\|[eat]` (W-Ice-taken, turn 1).
Box: READ (p2 holder-hidden).

No witness changed the log before it was named.

#### Zoom Lens · `item:zoomlens`

293 holders · weight 293. Named by: no line, in any witness.

No witness changed the log before it was named.

## 6. Natures

| Nature | + | − | Silent sinks (witness) | Hazard under "neutral" |
|---|---|---|---|---|
| Adamant | Atk | SpA | known exact (W-phys-dealt); known exact (W-spec-dealt) | HAZARD-UNSOUND on W-phys-dealt |
| Bashful | — | — | none | — |
| Bold | Def | Atk | known exact (W-phys-dealt); hidden % (W-phys-taken) | SAFE |
| Brave | Atk | Spe | known exact (W-phys-dealt); order (W-order-down); order (W-pace) | HAZARD-UNSOUND on W-phys-dealt; HAZARD-UNSOUND on W-order-down; HAZARD-UNSOUND on W-pace |
| Calm | SpD | Atk | known exact (W-phys-dealt); hidden % (W-spec-taken) | SAFE |
| Careful | SpD | SpA | known exact (W-spec-dealt); hidden % (W-spec-taken) | SAFE |
| Docile | — | — | none | — |
| Gentle | SpD | Def | hidden % (W-phys-taken); hidden % (W-spec-taken) | HAZARD-UNSOUND on W-phys-taken |
| Hardy | — | — | none | — |
| Hasty | Spe | Def | hidden % (W-phys-taken); order (W-order-up) | HAZARD-UNSOUND on W-phys-taken; HAZARD-UNSOUND on W-order-up |
| Impish | Def | SpA | known exact (W-spec-dealt); hidden % (W-phys-taken) | SAFE |
| Jolly | Spe | SpA | known exact (W-spec-dealt); order (W-order-up) | HAZARD-UNSOUND on W-order-up |
| Lax | Def | SpD | hidden % (W-phys-taken); hidden % (W-spec-taken) | HAZARD-UNSOUND on W-spec-taken |
| Lonely | Atk | Def | known exact (W-phys-dealt); hidden % (W-phys-taken) | HAZARD-UNSOUND on W-phys-dealt; HAZARD-UNSOUND on W-phys-taken |
| Mild | SpA | Def | known exact (W-spec-dealt); hidden % (W-phys-taken) | HAZARD-UNSOUND on W-spec-dealt; HAZARD-UNSOUND on W-phys-taken |
| Modest | SpA | Atk | known exact (W-phys-dealt); known exact (W-spec-dealt) | HAZARD-UNSOUND on W-spec-dealt |
| Naive | Spe | SpD | hidden % (W-spec-taken); order (W-order-up) | HAZARD-UNSOUND on W-spec-taken; HAZARD-UNSOUND on W-order-up |
| Naughty | Atk | SpD | known exact (W-phys-dealt); hidden % (W-spec-taken) | HAZARD-UNSOUND on W-phys-dealt; HAZARD-UNSOUND on W-spec-taken |
| Quiet | SpA | Spe | known exact (W-spec-dealt); order (W-order-down); order (W-pace) | HAZARD-UNSOUND on W-spec-dealt; HAZARD-UNSOUND on W-order-down; HAZARD-UNSOUND on W-pace |
| Quirky | — | — | none | — |
| Rash | SpA | SpD | known exact (W-spec-dealt); hidden % (W-spec-taken) | HAZARD-UNSOUND on W-spec-dealt; HAZARD-UNSOUND on W-spec-taken |
| Relaxed | Def | Spe | hidden % (W-phys-taken); order (W-order-down); order (W-pace) | HAZARD-UNSOUND on W-order-down; HAZARD-UNSOUND on W-pace |
| Sassy | SpD | Spe | hidden % (W-spec-taken); order (W-order-down); order (W-pace) | HAZARD-UNSOUND on W-order-down; HAZARD-UNSOUND on W-pace |
| Serious | — | — | none | — |
| Timid | Spe | Atk | known exact (W-phys-dealt); order (W-order-up) | HAZARD-UNSOUND on W-order-up |

## 7. Conditions

| Condition | Set by | Tagged in a battle |
|---|---|---|
| Ally Switch `condition:allyswitch` | move:allyswitch | no |
| Aqua Ring `condition:aquaring` | move:aquaring | yes |
| Attract `condition:attract` | ability:cutecharm, move:attract | yes |
| Aurora Veil `condition:auroraveil` | move:auroraveil | no |
| Baneful Bunker `condition:banefulbunker` | move:banefulbunker | no |
| Beak Blast `condition:beakblast` | move:beakblast | no |
| brn `condition:brn` | ability:flamebody, move:beakblast, move:blazekick, move:fireblast +13 | yes |
| Charge `condition:charge` | ability:electromorphosis, move:charge | yes |
| Chilly Reception `condition:chillyreception` | move:chillyreception | yes |
| choicelock `condition:choicelock` | item:choicescarf | no |
| confusion `condition:confusion` | move:axekick, move:confuseray, move:dynamicpunch, move:flatter +5 | yes |
| Counter `condition:counter` | move:counter | no |
| Curse `condition:curse` | move:curse | no |
| Destiny Bond `condition:destinybond` | move:destinybond | no |
| Disable `condition:disable` | ability:cursedbody, move:disable | yes |
| Dragon Cheer `condition:dragoncheer` | move:dragoncheer | yes |
| Electric Terrain `condition:electricterrain` | ability:electricsurge, move:electricterrain | yes |
| Electrify `condition:electrify` | move:electrify | no |
| Encore `condition:encore` | move:encore | yes |
| Endure `condition:endure` | move:endure | no |
| Fairy Lock `condition:fairylock` | move:fairylock | no |
| Flash Fire `condition:flashfire` | ability:flashfire | no |
| flinch `condition:flinch` | move:airslash, move:bite, move:darkpulse, move:dragonrush +16 | no |
| Fling `condition:fling` | move:fling | no |
| Focus Energy `condition:focusenergy` | move:focusenergy | yes |
| Focus Punch `condition:focuspunch` | move:focuspunch | no |
| Follow Me `condition:followme` | move:followme | no |
| frz `condition:frz` | move:blizzard, move:icebeam, move:icefang, move:icepunch | yes |
| Gastro Acid `condition:gastroacid` | move:gastroacid | no |
| gem `condition:gem` | item:normalgem | yes |
| Glaive Rush `condition:glaiverush` | move:glaiverush | no |
| Grassy Terrain `condition:grassyterrain` | ability:grassysurge, ability:seedsower, move:grassyterrain | yes |
| Gravity `condition:gravity` | move:gravity | yes |
| Heal Block `condition:healblock` | move:psychicnoise | yes |
| Healing Wish `condition:healingwish` | move:healingwish | no |
| Helping Hand `condition:helpinghand` | move:helpinghand | no |
| Imprison `condition:imprison` | move:imprison | yes |
| Ingrain `condition:ingrain` | move:ingrain | yes |
| King's Shield `condition:kingsshield` | move:kingsshield | no |
| Leech Seed `condition:leechseed` | move:leechseed | yes |
| Light Screen `condition:lightscreen` | move:lightscreen | yes |
| lockedmove `condition:lockedmove` | move:outrage, move:petaldance, move:ragingfury, move:thrash | yes |
| Lock-On `condition:lockon` | move:lockon | no |
| Magic Room `condition:magicroom` | move:magicroom | no |
| Magnet Rise `condition:magnetrise` | move:magnetrise | yes |
| Metronome `condition:metronome` | item:metronome | no |
| Minimize `condition:minimize` | move:minimize | no |
| Mirror Coat `condition:mirrorcoat` | move:mirrorcoat | no |
| Misty Terrain `condition:mistyterrain` | move:mistyterrain | yes |
| mustrecharge `condition:mustrecharge` | move:blastburn, move:frenzyplant, move:gigaimpact, move:hydrocannon +3 | no |
| No Retreat `condition:noretreat` | move:noretreat | yes |
| Octolock `condition:octolock` | move:octolock | yes |
| par `condition:par` | ability:effectspore, ability:static, move:bodyslam, move:bounce +11 | yes |
| partiallytrapped `condition:partiallytrapped` | move:bind, move:firespin, move:infestation, move:sandtomb +3 | no |
| Perish Song `condition:perishsong` | move:perishsong | no |
| Power Trick `condition:powertrick` | move:powertrick | yes |
| Protect `condition:protect` | move:detect, move:protect | no |
| psn `condition:psn` | ability:effectspore, ability:poisonpoint, ability:poisontouch, move:banefulbunker +11 | yes |
| Psychic Terrain `condition:psychicterrain` | ability:psychicsurge, move:psychicterrain | yes |
| Quick Guard `condition:quickguard` | move:quickguard | no |
| Rage Powder `condition:ragepowder` | move:ragepowder | no |
| RainDance `condition:raindance` | ability:drizzle, move:raindance | yes |
| Reflect `condition:reflect` | move:reflect | yes |
| Revival Blessing `condition:revivalblessing` | move:revivalblessing | no |
| Roost `condition:roost` | move:roost | no |
| Safeguard `condition:safeguard` | move:safeguard | yes |
| Salt Cure `condition:saltcure` | move:saltcure | yes |
| Sandstorm `condition:sandstorm` | ability:sandspit, ability:sandstream, move:sandstorm | yes |
| slp `condition:slp` | ability:effectspore, move:hypnosis, move:rest, move:sing +2 | yes |
| Smack Down `condition:smackdown` | move:smackdown | no |
| Snowscape `condition:snowscape` | ability:snowwarning, move:chillyreception, move:snowscape | yes |
| Spikes `condition:spikes` | move:ceaselessedge, move:spikes | yes |
| Spiky Shield `condition:spikyshield` | move:spikyshield | yes |
| stall `condition:stall` | move:banefulbunker, move:detect, move:endure, move:kingsshield +4 | no |
| Stealth Rock `condition:stealthrock` | move:stealthrock, move:stoneaxe | yes |
| Sticky Web `condition:stickyweb` | move:stickyweb | yes |
| Stockpile `condition:stockpile` | move:stockpile | no |
| Substitute `condition:substitute` | move:shedtail, move:substitute | yes |
| SunnyDay `condition:sunnyday` | ability:drought, move:sunnyday | yes |
| Syrup Bomb `condition:syrupbomb` | move:syrupbomb | yes |
| Tailwind `condition:tailwind` | move:tailwind | yes |
| Taunt `condition:taunt` | move:taunt | yes |
| Torment `condition:torment` | move:torment | yes |
| tox `condition:tox` | move:poisonfang, move:toxic, move:toxicspikes | yes |
| Toxic Spikes `condition:toxicspikes` | ability:toxicdebris, move:toxicspikes | yes |
| trapped `condition:trapped` | move:block, move:jawlock, move:meanlook | no |
| Trick Room `condition:trickroom` | move:trickroom | no |
| twoturnmove `condition:twoturnmove` | move:bounce, move:dig, move:dive, move:electroshot +6 | no |
| Unburden `condition:unburden` | ability:unburden | no |
| Uproar `condition:uproar` | move:uproar | yes |
| Wide Guard `condition:wideguard` | move:wideguard | no |
| Wish `condition:wish` | move:wish | no |
| Wonder Room `condition:wonderroom` | move:wonderroom | no |
| Yawn `condition:yawn` | move:yawn | yes |
