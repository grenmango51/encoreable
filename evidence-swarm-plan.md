# Evidence by hand: every move, ability and item, read one at a time

**For:** one agent, working alone, with no earlier conversation.
**Task:** read the source of every move, ability and item that Reg M-C allows — 879 of them,
listed in §6 — and write down, for each one, whether it can let a replay reveal something hidden
about a Pokemon, and in what situation.
**Output:** this file, and only this file. Every entry in §6 has two lines ending in `: TODO`, 1,758 in all. Replace each one.
**Done when:** no line in §6 ends in `: TODO`, the Progress log (§7) has a line for every checkpoint, and
the Summary (§8) is filled.
**Verified against:** `pokemon-showdown` at commit `a5df827`, as installed in `node_modules/`, on
2026-10-02. Format `gen9championsvgc2026regmc` ("[Gen 9 Champions] VGC 2026 Reg M-C").

**This task is about being complete.** 879 entries means 879 entries. Each one is read from its own
source and decided on its own. An entry skipped, guessed from its name, copied from a neighbour, or
filled by a program is a failed entry, and one failed entry fails the task.

---

## 1. Why this exists

Encoreable rebuilds a Pokemon Showdown replay into a playable battle. The opponent's team is
partly hidden, so the hidden parts are worked out from the battle log: every number the log prints
that depends on a hidden value rules some values out. `npm run catalog` already tried every effect
in a few small test battles (`docs/evidence-open-sheets.md`, `docs/evidence-closed-sheets.md`), but a
test battle only shows what that one situation shows. This file asks the other question: **in any
situation at all, can this effect make the log depend on something hidden?** It is answered by
reading the code and thinking, not by running battles.

Two kinds of replay matter:

| Sheet | What the replay publishes | What stays hidden |
|---|---|---|
| **Open** (Bo3, `\|showteam\|`) | species, item, ability, moves, nature, for both sides | each Pokemon's six **Stat Points**: HP, Atk, Def, SpA, SpD, Spe, 0–32 each, at most 66 in total |
| **Closed** (Bo1) | nothing until the battle shows it | the **item**, **ability**, **nature**, every **move not yet used**, and the Stat Points |

Every entry gets one answer per sheet:

- **Open** — can this effect make the log depend on a Stat Point (of anyone: the user, the target,
  a partner, a Pokemon on the bench)?
- **Closed** — can this effect reveal, or wrongly suggest, which item, ability, nature or move a
  Pokemon has? Stat Points are already covered by the Open answer; do not repeat them here.

---

## 2. What you need to know about the log

**Where a hidden value can show.** Only in these places:

| Where | What it can carry | Example |
|---|---|---|
| a hidden Pokemon's HP line | its HP stat, Def, SpD — through damage taken, healing, rounding | `\|-damage\|p2a: Blastoise\|58/100` |
| the uploader's own exact HP line | the hidden side's Atk or SpA through damage dealt; any hidden amount passed across (drain, recoil, Counter) | `\|-damage\|p1a: Snorlax\|197/255` |
| the order of lines | Speed | one `\|move\|` line before another |
| whether a line appears at all | an HP threshold crossed or not, a chance that depends on a stat, a KO that did or did not happen | a Berry eaten, a Focus Sash that held, `\|faint\|` |
| what a line names | an item, ability, move, or a stat | `[from] item: Leftovers`, `\|-ability\|...\|Intimidate`, `\|-item\|` |

**Numbers you will need.**

- Stats (Champions, level 50, `data/mods/champions/scripts.ts` → `statModify`):
  `HP = base + StatPoints + 75`; every other stat `= base + StatPoints + 20`, then nature ×1.1 or ×0.9.
  One Stat Point is exactly one stat point.
- HP display (`sim/pokemon.ts` → `getHealth`): the uploader's own side prints exact `hp/maxhp`; the
  other side prints `floor(100 × hp / maxhp)` (at least 1) out of 100, and at exactly 20 it adds
  `y` or `r`, at exactly 50 `g` or `y`, depending on whether `hp × 5 > maxhp` or `hp × 2 > maxhp`.
- Damage: `sim/battle-actions.ts` → `getDamage` then `modifyDamage`. Speed and order:
  `sim/pokemon.ts` → `getStat`, `getActionSpeed`; `sim/battle.ts` → `comparePriority`, `speedSort`.
- Statuses, weather, terrain, volatiles: `data/conditions.ts` and the `condition` blocks inside
  each move in `data/moves.ts`.

**The Champions mod overrides the base data.** Each entry in §6 names its source lines. Where it
names a line in `data/mods/champions/…`, read that first: it replaces the base entry, and a field it
leaves out (`inherit: true`) comes from `data/<file>.ts`.

---

## 3. Rules

1. **Every entry, in order, both lines.** Work from entry 1 to entry 879. Fill `Open:` and
   `Closed:` for each. Never skip one to come back later.
2. **Read the source for every entry.** Open each line §6 names and read every handler in it
   (`on…`, `damageCallback`, `basePowerCallback`, `condition`, `secondary`, `self`). Then follow
   what it calls. An answer from the name or from memory is not an answer.
3. **Never group, never copy, never refer.** No "same as above", "see Blaze", "like the other
   plates", "similar", "N/A", "etc.", "…". Each entry is complete on its own. Writing the same
   sentence twice is fine; pointing at another entry is not.
4. **No programs.** Do not write or run anything that produces entries. You may search and read
   files. The point is that every entry was thought about.
5. **A wrong NO is the worst mistake.** NO hides a clue forever; a wrong YES only costs a check.
   When unsure, write CONDITIONAL or YES and say what you are unsure of.
6. **Think about situations, not only the plain case.** An effect that shows nothing on its own
   may show something in rain, at low HP, after a stat drop, next to a certain partner, against a
   certain type, on a critical hit, under Trick Room, or when it is copied, swapped or stolen.
   Each of those is a CONDITIONAL answer.
7. **Think about exact numbers.** A percentage display rounds, and the rounding itself can carry a
   Stat Point. Halves, quarters, sixteenths and the 20/50 colour markers all matter (§4, Super Fang).
8. **The test battles are a hint, never proof.** A card in `docs/evidence-open-sheets.md` that shows
   a change supports YES. A card that says NO CHANNEL or NOT SHOWN does **not** support NO: those
   battles tried few situations and only Stat Points 0 against 32.
9. **Files.** Edit only this file, and inside it only the `TODO`s, §7 and §8. Never create, delete,
   rename or move a file. Never edit code or any other document. Never commit. Keep notes in your
   head or your chat, not in files.
10. **Checkpoints.** Every 50 entries §6 has a checkpoint. At each one: count the lines still ending in `: TODO` in
    §6, write the count in §7, and re-read this section before going on.

---

## 4. How to answer

Each answer starts with one flag:

| Flag | Meaning |
|---|---|
| `YES` | whenever the effect acts, something hidden can reach the log |
| `CONDITIONAL` | only in a situation that has to arise — say exactly which |
| `NO` | in no situation — say why in one sentence, naming the handler or its absence |

After `YES` or `CONDITIONAL` write, for each situation:

- **When** — the situation (`whenever it hits`, `in rain`, `below 1/3 HP`, `when the holder is hit by contact`).
- **Reveals** — what, and whose. Open: which Stat Point(s) of which Pokemon. Closed: which box
  (item, ability, nature, move) of which Pokemon, and whether a line names it or it shows silently.
- **Line** — the log line that carries it.
- **How** — one sentence: the handler and what it does with the value.

Separate several situations with ` · When …`.

**Worked examples.** These are the standard to meet. They are not entries; the entries are in §6.

- `ability:swiftswim` — Swift Swim
  - Open: CONDITIONAL — When rain is up: Reveals the holder's Spe. Line: the order of `|move|`
    lines against Pokemon of known Speed. How: `onModifySpe` doubles Speed in `raindance` or
    `primordialsea`, so who it outspeeds bounds its Speed Stat Points.
  - Closed: CONDITIONAL — When rain is up and the holder moves before a Pokemon it could not
    outspeed with any Speed Stat Points: Reveals the holder's ability (Swift Swim, or another Speed
    doubler), silently — Swift Swim prints no line. Line: the order of `|move|` lines. How:
    `onModifySpe`, as for Open.
- `move:superfang` — Super Fang
  - Open: YES — When it hits a Pokemon at full HP: Reveals whether the target's max HP is odd or
    even, so the parity of its HP Stat Points. Line: `|-damage|` showing `50/100g` (odd) or
    `50/100y` (even). How: `damageCallback` takes `floor(hp / 2)`, leaving `ceil(maxhp / 2)`, and
    `getHealth` marks 50 with `g` only when `hp × 2 > maxhp`. · When it hits at other HP: the same
    rounding narrows the target's current HP, and with it the HP stat.
  - Closed: NO — the move names itself and its damage does not depend on any item, ability or nature.
- `move:leechseed` — Leech Seed
  - Open: YES — When the seeded Pokemon is hidden: Reveals its HP stat. Line: `|-damage|…|[from]
    Leech Seed` each turn, and the seeder's `|-heal|…|[silent]`. How: the residual takes
    `baseMaxhp / 8` and the seeder heals the amount taken, which the uploader's exact HP line shows
    exactly when the uploader seeded it.
  - Closed: CONDITIONAL — When the seeder holds Big Root: Reveals the seeder's item, silently: the
    heal is 1.3 times larger. Line: the seeder's `|-heal|`. How: Big Root's `onTryHeal` boosts drain
    heals.
- `item:choicescarf` — Choice Scarf
  - Open: YES — When the holder acts: Reveals the holder's Spe through order, scaled by 1.5. Line:
    the order of `|move|` lines. How: `onModifySpe` multiplies Speed by 1.5.
  - Closed: CONDITIONAL — When the holder moves before a Pokemon it could not outspeed unboosted, or
    repeats one move every turn: Reveals the item, silently. Line: order of `|move|` lines. How:
    `onModifySpe`; the choice lock shows as the same move each turn.
- `move:protect` — Protect
  - Open: NO — `onTryHit` blocks the move and prints `|-activate|…|move: Protect`; nothing it prints
    depends on a stat.
  - Closed: NO — it names itself and depends on no item, ability or nature.

---

## 5. A checklist for every entry

Ask each question. Any YES leads to a `YES` or `CONDITIONAL` answer.

1. Does a handler read a stat, HP or max HP (`getStat`, `storedStats`, `hp`, `maxhp`, `baseMaxhp`,
   `getActionSpeed`, a comparison of two Pokemon's stats)?
2. Does it change damage dealt or taken (base power, attack or defense modifiers, final modifiers,
   critical-hit rules, type changes)?
3. Does it change turn order (priority, Speed modifiers, Trick Room, moving first or last)?
4. Does it heal or hurt by a fraction of max HP, or by an amount tied to damage dealt or taken?
5. Does it fire at an HP threshold (full HP, 1/2, 1/3, 1/4, a hit that would knock out)?
6. Does it depend on weather, terrain, a status, a stat stage, a partner, a switch, being hit,
   contact, a type, an item or an ability?
7. Does it move, copy, swap or average stats or HP between Pokemon (Transform, Power Split)?
8. Does it name itself or another hidden thing in a line (`|-item|`, `|-enditem|`, `|-ability|`,
   `[from] item:`, `[from] ability:`)? Whose?
9. Does it change something silently that a later line then shows?
10. Can rounding — of a percentage, a half, a quarter, a sixteenth, the 20/50 markers — expose a
    narrow range or a parity?
11. Which other effects combine with it to reveal more (rain and Swift Swim; Trick and a Choice
    item; Helping Hand and the partner's hit)? Write the strongest ones as `When` situations.

---

## 6. The entries

879 entries: 510 moves, 203 abilities, 166 items, in the order `npm run catalog -- --list` gives.
Each heading gives the id, the name, how many legal Pokemon can use it, and the source lines to
read. Replace both `TODO`s in every entry; at the start 1,758 lines end in `: TODO`.

### Moves (510)

#### 1. `move:accelerock` · Accelerock · 2 legal users · `data/moves.ts:34`
- Open: TODO
- Closed: TODO

#### 2. `move:acidarmor` · Acid Armor · 16 legal users · `data/moves.ts:66`
- Open: TODO
- Closed: TODO

#### 3. `move:acidspray` · Acid Spray · 28 legal users · `data/moves.ts:98`
- Open: TODO
- Closed: TODO

#### 4. `move:acrobatics` · Acrobatics · 63 legal users · `data/moves.ts:117`
- Open: TODO
- Closed: TODO

#### 5. `move:acupressure` · Acupressure · 6 legal users · `data/moves.ts:137`
- Open: TODO
- Closed: TODO

#### 6. `move:aerialace` · Aerial Ace · 75 legal users · `data/moves.ts:168`
- Open: TODO
- Closed: TODO

#### 7. `move:afteryou` · After You · 14 legal users · `data/moves.ts:195`
- Open: TODO
- Closed: TODO

#### 8. `move:agility` · Agility · 75 legal users · `data/moves.ts:219`
- Open: TODO
- Closed: TODO

#### 9. `move:aircutter` · Air Cutter · 43 legal users · `data/moves.ts:236`
- Open: TODO
- Closed: TODO

#### 10. `move:airslash` · Air Slash · 55 legal users · `data/moves.ts:250`
- Open: TODO
- Closed: TODO

#### 11. `move:alluringvoice` · Alluring Voice · 35 legal users · `data/moves.ts:282`
- Open: TODO
- Closed: TODO

#### 12. `move:allyswitch` · Ally Switch · 27 legal users · `data/moves.ts:302`
- Open: TODO
- Closed: TODO

#### 13. `move:amnesia` · Amnesia · 34 legal users · `data/moves.ts:359`
- Open: TODO
- Closed: TODO

#### 14. `move:ancientpower` · Ancient Power · 25 legal users · `data/moves.ts:396`
- Open: TODO
- Closed: TODO

#### 15. `move:appleacid` · Apple Acid · 1 legal users · `data/moves.ts:421`, `data/mods/champions/moves.ts:18`
- Open: TODO
- Closed: TODO

#### 16. `move:aquacutter` · Aqua Cutter · 5 legal users · `data/moves.ts:439`
- Open: TODO
- Closed: TODO

#### 17. `move:aquajet` · Aqua Jet · 21 legal users · `data/moves.ts:453`
- Open: TODO
- Closed: TODO

#### 18. `move:aquaring` · Aqua Ring · 11 legal users · `data/moves.ts:466`
- Open: TODO
- Closed: TODO

#### 19. `move:aquastep` · Aqua Step · 1 legal users · `data/moves.ts:490`
- Open: TODO
- Closed: TODO

#### 20. `move:aquatail` · Aqua Tail · 16 legal users · `data/moves.ts:511`
- Open: TODO
- Closed: TODO

#### 21. `move:armorcannon` · Armor Cannon · 1 legal users · `data/moves.ts:524`
- Open: TODO
- Closed: TODO

#### 22. `move:aromaticmist` · Aromatic Mist · 13 legal users · `data/moves.ts:591`
- Open: TODO
- Closed: TODO

#### 23. `move:assurance` · Assurance · 59 legal users · `data/moves.ts:643`
- Open: TODO
- Closed: TODO

#### 24. `move:attract` · Attract · 83 legal users · `data/moves.ts:706`
- Open: TODO
- Closed: TODO

#### 25. `move:aurasphere` · Aura Sphere · 15 legal users · `data/moves.ts:762`
- Open: TODO
- Closed: TODO

#### 26. `move:aurawheel` · Aura Wheel · 1 legal users · `data/moves.ts:775`
- Open: TODO
- Closed: TODO

#### 27. `move:auroraveil` · Aurora Veil · 7 legal users · `data/moves.ts:830`
- Open: TODO
- Closed: TODO

#### 28. `move:avalanche` · Avalanche · 37 legal users · `data/moves.ts:908`
- Open: TODO
- Closed: TODO

#### 29. `move:axekick` · Axe Kick · 1 legal users · `data/moves.ts:931`
- Open: TODO
- Closed: TODO

#### 30. `move:babydolleyes` · Baby-Doll Eyes · 28 legal users · `data/moves.ts:951`
- Open: TODO
- Closed: TODO

#### 31. `move:banefulbunker` · Baneful Bunker · 1 legal users · `data/moves.ts:985`, `data/mods/champions/moves.ts:43`
- Open: TODO
- Closed: TODO

#### 32. `move:barbbarrage` · Barb Barrage · 2 legal users · `data/moves.ts:1038`
- Open: TODO
- Closed: TODO

#### 33. `move:batonpass` · Baton Pass · 58 legal users · `data/moves.ts:1092`
- Open: TODO
- Closed: TODO

#### 34. `move:beakblast` · Beak Blast · 1 legal users · `data/moves.ts:1119`, `data/mods/champions/moves.ts:47`
- Open: TODO
- Closed: TODO

#### 35. `move:beatup` · Beat Up · 23 legal users · `data/moves.ts:1150`
- Open: TODO
- Closed: TODO

#### 36. `move:belch` · Belch · 18 legal users · `data/moves.ts:1197`, `data/mods/champions/moves.ts:52`
- Open: TODO
- Closed: TODO

#### 37. `move:bellydrum` · Belly Drum · 10 legal users · `data/moves.ts:1216`
- Open: TODO
- Closed: TODO

#### 38. `move:bind` · Bind · 5 legal users · `data/moves.ts:1337`
- Open: TODO
- Closed: TODO

#### 39. `move:bite` · Bite · 74 legal users · `data/moves.ts:1351`
- Open: TODO
- Closed: TODO

#### 40. `move:bitterblade` · Bitter Blade · 1 legal users · `data/moves.ts:1368`
- Open: TODO
- Closed: TODO

#### 41. `move:bittermalice` · Bitter Malice · 1 legal users · `data/moves.ts:1381`
- Open: TODO
- Closed: TODO

#### 42. `move:blastburn` · Blast Burn · 10 legal users · `data/moves.ts:1414`
- Open: TODO
- Closed: TODO

#### 43. `move:blazekick` · Blaze Kick · 9 legal users · `data/moves.ts:1430`
- Open: TODO
- Closed: TODO

#### 44. `move:blizzard` · Blizzard · 66 legal users · `data/moves.ts:1491`
- Open: TODO
- Closed: TODO

#### 45. `move:block` · Block · 13 legal users · `data/moves.ts:1511`
- Open: TODO
- Closed: TODO

#### 46. `move:bodypress` · Body Press · 55 legal users · `data/moves.ts:1572`
- Open: TODO
- Closed: TODO

#### 47. `move:bodyslam` · Body Slam · 164 legal users · `data/moves.ts:1585`
- Open: TODO
- Closed: TODO

#### 48. `move:bonerush` · Bone Rush · 1 legal users · `data/moves.ts:1674`, `data/mods/champions/moves.ts:89`
- Open: TODO
- Closed: TODO

#### 49. `move:boomburst` · Boomburst · 8 legal users · `data/moves.ts:1690`
- Open: TODO
- Closed: TODO

#### 50. `move:bounce` · Bounce · 24 legal users · `data/moves.ts:1703`
- Open: TODO
- Closed: TODO

> **Checkpoint 1 — 50 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 51. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 51. `move:bravebird` · Brave Bird · 20 legal users · `data/moves.ts:1775`
- Open: TODO
- Closed: TODO

#### 52. `move:breakingswipe` · Breaking Swipe · 31 legal users · `data/moves.ts:1789`
- Open: TODO
- Closed: TODO

#### 53. `move:brickbreak` · Brick Break · 108 legal users · `data/moves.ts:1822`
- Open: TODO
- Closed: TODO

#### 54. `move:brutalswing` · Brutal Swing · 59 legal users · `data/moves.ts:1859`
- Open: TODO
- Closed: TODO

#### 55. `move:bugbite` · Bug Bite · 33 legal users · `data/moves.ts:1911`
- Open: TODO
- Closed: TODO

#### 56. `move:bugbuzz` · Bug Buzz · 29 legal users · `data/moves.ts:1935`
- Open: TODO
- Closed: TODO

#### 57. `move:bulkup` · Bulk Up · 52 legal users · `data/moves.ts:1954`
- Open: TODO
- Closed: TODO

#### 58. `move:bulldoze` · Bulldoze · 108 legal users · `data/moves.ts:1972`
- Open: TODO
- Closed: TODO

#### 59. `move:bulletpunch` · Bullet Punch · 7 legal users · `data/moves.ts:1991`
- Open: TODO
- Closed: TODO

#### 60. `move:bulletseed` · Bullet Seed · 34 legal users · `data/moves.ts:2004`
- Open: TODO
- Closed: TODO

#### 61. `move:burningjealousy` · Burning Jealousy · 26 legal users · `data/moves.ts:2071`
- Open: TODO
- Closed: TODO

#### 62. `move:burnup` · Burn Up · 8 legal users · `data/moves.ts:2092`, `data/mods/champions/moves.ts:109`
- Open: TODO
- Closed: TODO

#### 63. `move:calmmind` · Calm Mind · 96 legal users · `data/moves.ts:2136`
- Open: TODO
- Closed: TODO

#### 64. `move:ceaselessedge` · Ceaseless Edge · 1 legal users · `data/moves.ts:2220`
- Open: TODO
- Closed: TODO

#### 65. `move:charge` · Charge · 24 legal users · `data/moves.ts:2264`
- Open: TODO
- Closed: TODO

#### 66. `move:chargebeam` · Charge Beam · 38 legal users · `data/moves.ts:2318`
- Open: TODO
- Closed: TODO

#### 67. `move:charm` · Charm · 79 legal users · `data/moves.ts:2339`
- Open: TODO
- Closed: TODO

#### 68. `move:chillingwater` · Chilling Water · 71 legal users · `data/moves.ts:2377`
- Open: TODO
- Closed: TODO

#### 69. `move:chillyreception` · Chilly Reception · 2 legal users · `data/moves.ts:2396`
- Open: TODO
- Closed: TODO

#### 70. `move:circlethrow` · Circle Throw · 7 legal users · `data/moves.ts:2451`
- Open: TODO
- Closed: TODO

#### 71. `move:clangingscales` · Clanging Scales · 1 legal users · `data/moves.ts:2480`
- Open: TODO
- Closed: TODO

#### 72. `move:clangoroussoul` · Clangorous Soul · 1 legal users · `data/moves.ts:2498`, `data/mods/champions/moves.ts:121`
- Open: TODO
- Closed: TODO

#### 73. `move:clearsmog` · Clear Smog · 8 legal users · `data/moves.ts:2554`
- Open: TODO
- Closed: TODO

#### 74. `move:closecombat` · Close Combat · 55 legal users · `data/moves.ts:2571`
- Open: TODO
- Closed: TODO

#### 75. `move:coaching` · Coaching · 26 legal users · `data/moves.ts:2590`
- Open: TODO
- Closed: TODO

#### 76. `move:coil` · Coil · 6 legal users · `data/moves.ts:2606`
- Open: TODO
- Closed: TODO

#### 77. `move:comeuppance` · Comeuppance · 4 legal users · `data/moves.ts:2681`
- Open: TODO
- Closed: TODO

#### 78. `move:confuseray` · Confuse Ray · 78 legal users · `data/moves.ts:2728`
- Open: TODO
- Closed: TODO

#### 79. `move:copycat` · Copycat · 30 legal users · `data/moves.ts:2849`
- Open: TODO
- Closed: TODO

#### 80. `move:corrosivegas` · Corrosive Gas · 6 legal users · `data/moves.ts:2914`, `data/mods/champions/moves.ts:149`
- Open: TODO
- Closed: TODO

#### 81. `move:cosmicpower` · Cosmic Power · 6 legal users · `data/moves.ts:2935`
- Open: TODO
- Closed: TODO

#### 82. `move:cottonguard` · Cotton Guard · 6 legal users · `data/moves.ts:2953`
- Open: TODO
- Closed: TODO

#### 83. `move:cottonspore` · Cotton Spore · 4 legal users · `data/moves.ts:2970`
- Open: TODO
- Closed: TODO

#### 84. `move:counter` · Counter · 41 legal users · `data/moves.ts:2987`
- Open: TODO
- Closed: TODO

#### 85. `move:courtchange` · Court Change · 1 legal users · `data/moves.ts:3032`
- Open: TODO
- Closed: TODO

#### 86. `move:covet` · Covet · 25 legal users · `data/moves.ts:3099`
- Open: TODO
- Closed: TODO

#### 87. `move:crabhammer` · Crabhammer · 3 legal users · `data/moves.ts:3129`, `data/mods/champions/moves.ts:153`
- Open: TODO
- Closed: TODO

#### 88. `move:crosschop` · Cross Chop · 7 legal users · `data/moves.ts:3174`
- Open: TODO
- Closed: TODO

#### 89. `move:crosspoison` · Cross Poison · 10 legal users · `data/moves.ts:3188`
- Open: TODO
- Closed: TODO

#### 90. `move:crunch` · Crunch · 72 legal users · `data/moves.ts:3206`
- Open: TODO
- Closed: TODO

#### 91. `move:crushclaw` · Crush Claw · 4 legal users · `data/moves.ts:3225`, `data/mods/champions/moves.ts:157`
- Open: TODO
- Closed: TODO

#### 92. `move:curse` · Curse · 103 legal users · `data/moves.ts:3266`, `data/mods/champions/moves.ts:165`
- Open: TODO
- Closed: TODO

#### 93. `move:darkestlariat` · Darkest Lariat · 3 legal users · `data/moves.ts:3323`
- Open: TODO
- Closed: TODO

#### 94. `move:darkpulse` · Dark Pulse · 77 legal users · `data/moves.ts:3338`
- Open: TODO
- Closed: TODO

#### 95. `move:dazzlinggleam` · Dazzling Gleam · 52 legal users · `data/moves.ts:3378`
- Open: TODO
- Closed: TODO

#### 96. `move:decorate` · Decorate · 8 legal users · `data/moves.ts:3391`
- Open: TODO
- Closed: TODO

#### 97. `move:defog` · Defog · 12 legal users · `data/moves.ts:3447`
- Open: TODO
- Closed: TODO

#### 98. `move:destinybond` · Destiny Bond · 25 legal users · `data/moves.ts:3482`
- Open: TODO
- Closed: TODO

#### 99. `move:detect` · Detect · 29 legal users · `data/moves.ts:3526`
- Open: TODO
- Closed: TODO

#### 100. `move:dig` · Dig · 120 legal users · `data/moves.ts:3585`
- Open: TODO
- Closed: TODO

> **Checkpoint 2 — 100 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 101. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 101. `move:direclaw` · Dire Claw · 1 legal users · `data/moves.ts:3629`, `data/mods/champions/moves.ts:215`
- Open: TODO
- Closed: TODO

#### 102. `move:disable` · Disable · 34 legal users · `data/moves.ts:3648`, `data/mods/champions/moves.ts:226`
- Open: TODO
- Closed: TODO

#### 103. `move:discharge` · Discharge · 24 legal users · `data/moves.ts:3730`
- Open: TODO
- Closed: TODO

#### 104. `move:dive` · Dive · 32 legal users · `data/moves.ts:3747`
- Open: TODO
- Closed: TODO

#### 105. `move:doubleedge` · Double-Edge · 129 legal users · `data/moves.ts:3879`
- Open: TODO
- Closed: TODO

#### 106. `move:doublehit` · Double Hit · 25 legal users · `data/moves.ts:3893`
- Open: TODO
- Closed: TODO

#### 107. `move:doubleshock` · Double Shock · 1 legal users · `data/moves.ts:3945`, `data/mods/champions/moves.ts:254`
- Open: TODO
- Closed: TODO

#### 108. `move:doubleteam` · Double Team · 40 legal users · `data/moves.ts:3985`
- Open: TODO
- Closed: TODO

#### 109. `move:dracometeor` · Draco Meteor · 18 legal users · `data/moves.ts:4002`
- Open: TODO
- Closed: TODO

#### 110. `move:dragoncheer` · Dragon Cheer · 22 legal users · `data/moves.ts:4056`, `data/mods/champions/moves.ts:266`
- Open: TODO
- Closed: TODO

#### 111. `move:dragonclaw` · Dragon Claw · 28 legal users · `data/moves.ts:4087`, `data/mods/champions/moves.ts:270`
- Open: TODO
- Closed: TODO

#### 112. `move:dragondance` · Dragon Dance · 21 legal users · `data/moves.ts:4100`
- Open: TODO
- Closed: TODO

#### 113. `move:dragondarts` · Dragon Darts · 1 legal users · `data/moves.ts:4118`
- Open: TODO
- Closed: TODO

#### 114. `move:dragonpulse` · Dragon Pulse · 43 legal users · `data/moves.ts:4163`
- Open: TODO
- Closed: TODO

#### 115. `move:dragonrush` · Dragon Rush · 17 legal users · `data/moves.ts:4191`
- Open: TODO
- Closed: TODO

#### 116. `move:dragontail` · Dragon Tail · 33 legal users · `data/moves.ts:4208`
- Open: TODO
- Closed: TODO

#### 117. `move:drainingkiss` · Draining Kiss · 60 legal users · `data/moves.ts:4222`
- Open: TODO
- Closed: TODO

#### 118. `move:drainpunch` · Drain Punch · 57 legal users · `data/moves.ts:4236`
- Open: TODO
- Closed: TODO

#### 119. `move:drillpeck` · Drill Peck · 5 legal users · `data/moves.ts:4267`
- Open: TODO
- Closed: TODO

#### 120. `move:drillrun` · Drill Run · 15 legal users · `data/moves.ts:4280`
- Open: TODO
- Closed: TODO

#### 121. `move:drumbeating` · Drum Beating · 1 legal users · `data/moves.ts:4294`
- Open: TODO
- Closed: TODO

#### 122. `move:dualwingbeat` · Dual Wingbeat · 30 legal users · `data/moves.ts:4328`
- Open: TODO
- Closed: TODO

#### 123. `move:dynamicpunch` · Dynamic Punch · 12 legal users · `data/moves.ts:4354`
- Open: TODO
- Closed: TODO

#### 124. `move:earthpower` · Earth Power · 46 legal users · `data/moves.ts:4371`
- Open: TODO
- Closed: TODO

#### 125. `move:earthquake` · Earthquake · 96 legal users · `data/moves.ts:4390`
- Open: TODO
- Closed: TODO

#### 126. `move:eerieimpulse` · Eerie Impulse · 23 legal users · `data/moves.ts:4441`
- Open: TODO
- Closed: TODO

#### 127. `move:eeriespell` · Eerie Spell · 1 legal users · `data/moves.ts:4458`
- Open: TODO
- Closed: TODO

#### 128. `move:electricterrain` · Electric Terrain · 23 legal users · `data/moves.ts:4497`
- Open: TODO
- Closed: TODO

#### 129. `move:electrify` · Electrify · 1 legal users · `data/moves.ts:4556`, `data/mods/champions/moves.ts:295`
- Open: TODO
- Closed: TODO

#### 130. `move:electroball` · Electro Ball · 25 legal users · `data/moves.ts:4588`
- Open: TODO
- Closed: TODO

#### 131. `move:electroshot` · Electro Shot · 1 legal users · `data/moves.ts:4630`
- Open: TODO
- Closed: TODO

#### 132. `move:electroweb` · Electroweb · 26 legal users · `data/moves.ts:4660`
- Open: TODO
- Closed: TODO

#### 133. `move:encore` · Encore · 63 legal users · `data/moves.ts:4724`, `data/mods/champions/moves.ts:307`
- Open: TODO
- Closed: TODO

#### 134. `move:endeavor` · Endeavor · 90 legal users · `data/moves.ts:4784`
- Open: TODO
- Closed: TODO

#### 135. `move:endure` · Endure · 292 legal users · `data/moves.ts:4805`
- Open: TODO
- Closed: TODO

#### 136. `move:energyball` · Energy Ball · 94 legal users · `data/moves.ts:4840`
- Open: TODO
- Closed: TODO

#### 137. `move:entrainment` · Entrainment · 17 legal users · `data/moves.ts:4859`
- Open: TODO
- Closed: TODO

#### 138. `move:eruption` · Eruption · 4 legal users · `data/moves.ts:4888`
- Open: TODO
- Closed: TODO

#### 139. `move:expandingforce` · Expanding Force · 29 legal users · `data/moves.ts:4943`
- Open: TODO
- Closed: TODO

#### 140. `move:explosion` · Explosion · 11 legal users · `data/moves.ts:4966`
- Open: TODO
- Closed: TODO

#### 141. `move:extrasensory` · Extrasensory · 14 legal users · `data/moves.ts:4980`
- Open: TODO
- Closed: TODO

#### 142. `move:extremespeed` · Extreme Speed · 4 legal users · `data/moves.ts:5019`
- Open: TODO
- Closed: TODO

#### 143. `move:facade` · Facade · 288 legal users · `data/moves.ts:5032`
- Open: TODO
- Closed: TODO

#### 144. `move:fairylock` · Fairy Lock · 1 legal users · `data/moves.ts:5050`
- Open: TODO
- Closed: TODO

#### 145. `move:fakeout` · Fake Out · 33 legal users · `data/moves.ts:5087`, `data/mods/champions/moves.ts:352`
- Open: TODO
- Closed: TODO

#### 146. `move:faketears` · Fake Tears · 64 legal users · `data/moves.ts:5110`
- Open: TODO
- Closed: TODO

#### 147. `move:featherdance` · Feather Dance · 20 legal users · `data/moves.ts:5156`
- Open: TODO
- Closed: TODO

#### 148. `move:feint` · Feint · 35 legal users · `data/moves.ts:5173`
- Open: TODO
- Closed: TODO

#### 149. `move:fellstinger` · Fell Stinger · 5 legal users · `data/moves.ts:5202`
- Open: TODO
- Closed: TODO

#### 150. `move:ficklebeam` · Fickle Beam · 1 legal users · `data/moves.ts:5218`
- Open: TODO
- Closed: TODO

> **Checkpoint 3 — 150 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 151. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 151. `move:fierydance` · Fiery Dance · 1 legal users · `data/moves.ts:5237`
- Open: TODO
- Closed: TODO

#### 152. `move:finalgambit` · Final Gambit · 8 legal users · `data/moves.ts:5301`
- Open: TODO
- Closed: TODO

#### 153. `move:fireblast` · Fire Blast · 61 legal users · `data/moves.ts:5321`
- Open: TODO
- Closed: TODO

#### 154. `move:firefang` · Fire Fang · 38 legal users · `data/moves.ts:5338`
- Open: TODO
- Closed: TODO

#### 155. `move:firelash` · Fire Lash · 1 legal users · `data/moves.ts:5360`, `data/mods/champions/moves.ts:376`
- Open: TODO
- Closed: TODO

#### 156. `move:firepunch` · Fire Punch · 54 legal users · `data/moves.ts:5442`
- Open: TODO
- Closed: TODO

#### 157. `move:firespin` · Fire Spin · 30 legal users · `data/moves.ts:5459`
- Open: TODO
- Closed: TODO

#### 158. `move:firstimpression` · First Impression · 6 legal users · `data/moves.ts:5473`, `data/mods/champions/moves.ts:384`
- Open: TODO
- Closed: TODO

#### 159. `move:fissure` · Fissure · 14 legal users · `data/moves.ts:5513`
- Open: TODO
- Closed: TODO

#### 160. `move:flail` · Flail · 50 legal users · `data/moves.ts:5529`
- Open: TODO
- Closed: TODO

#### 161. `move:flamecharge` · Flame Charge · 27 legal users · `data/moves.ts:5587`
- Open: TODO
- Closed: TODO

#### 162. `move:flamethrower` · Flamethrower · 70 legal users · `data/moves.ts:5608`
- Open: TODO
- Closed: TODO

#### 163. `move:flareblitz` · Flare Blitz · 27 legal users · `data/moves.ts:5642`
- Open: TODO
- Closed: TODO

#### 164. `move:flashcannon` · Flash Cannon · 41 legal users · `data/moves.ts:5678`
- Open: TODO
- Closed: TODO

#### 165. `move:flatter` · Flatter · 13 legal users · `data/moves.ts:5697`
- Open: TODO
- Closed: TODO

#### 166. `move:fling` · Fling · 121 legal users · `data/moves.ts:5733`
- Open: TODO
- Closed: TODO

#### 167. `move:flipturn` · Flip Turn · 21 legal users · `data/moves.ts:5787`
- Open: TODO
- Closed: TODO

#### 168. `move:flowertrick` · Flower Trick · 1 legal users · `data/moves.ts:5881`
- Open: TODO
- Closed: TODO

#### 169. `move:fly` · Fly · 25 legal users · `data/moves.ts:5894`
- Open: TODO
- Closed: TODO

#### 170. `move:flyingpress` · Flying Press · 1 legal users · `data/moves.ts:5935`
- Open: TODO
- Closed: TODO

#### 171. `move:focusblast` · Focus Blast · 96 legal users · `data/moves.ts:5952`
- Open: TODO
- Closed: TODO

#### 172. `move:focusenergy` · Focus Energy · 50 legal users · `data/moves.ts:5971`
- Open: TODO
- Closed: TODO

#### 173. `move:focuspunch` · Focus Punch · 61 legal users · `data/moves.ts:6001`
- Open: TODO
- Closed: TODO

#### 174. `move:followme` · Follow Me · 4 legal users · `data/moves.ts:6039`
- Open: TODO
- Closed: TODO

#### 175. `move:forestscurse` · Forest's Curse · 1 legal users · `data/moves.ts:6125`
- Open: TODO
- Closed: TODO

#### 176. `move:foulplay` · Foul Play · 69 legal users · `data/moves.ts:6144`
- Open: TODO
- Closed: TODO

#### 177. `move:freezedry` · Freeze-Dry · 8 legal users · `data/moves.ts:6158`, `data/mods/champions/moves.ts:413`
- Open: TODO
- Closed: TODO

#### 178. `move:frenzyplant` · Frenzy Plant · 10 legal users · `data/moves.ts:6242`
- Open: TODO
- Closed: TODO

#### 179. `move:frostbreath` · Frost Breath · 9 legal users · `data/moves.ts:6258`
- Open: TODO
- Closed: TODO

#### 180. `move:futuresight` · Future Sight · 28 legal users · `data/moves.ts:6391`
- Open: TODO
- Closed: TODO

#### 181. `move:gastroacid` · Gastro Acid · 6 legal users · `data/moves.ts:6426`
- Open: TODO
- Closed: TODO

#### 182. `move:gigadrain` · Giga Drain · 79 legal users · `data/moves.ts:6559`
- Open: TODO
- Closed: TODO

#### 183. `move:gigaimpact` · Giga Impact · 270 legal users · `data/moves.ts:6573`
- Open: TODO
- Closed: TODO

#### 184. `move:gigatonhammer` · Gigaton Hammer · 1 legal users · `data/moves.ts:6589`
- Open: TODO
- Closed: TODO

#### 185. `move:glaiverush` · Glaive Rush · 1 legal users · `data/moves.ts:6647`
- Open: TODO
- Closed: TODO

#### 186. `move:glare` · Glare · 5 legal users · `data/moves.ts:6679`
- Open: TODO
- Closed: TODO

#### 187. `move:grassknot` · Grass Knot · 93 legal users · `data/moves.ts:7537`
- Open: TODO
- Closed: TODO

#### 188. `move:grassyglide` · Grassy Glide · 30 legal users · `data/moves.ts:7655`
- Open: TODO
- Closed: TODO

#### 189. `move:grassyterrain` · Grassy Terrain · 26 legal users · `data/moves.ts:7673`
- Open: TODO
- Closed: TODO

#### 190. `move:gravapple` · Grav Apple · 1 legal users · `data/moves.ts:7731`, `data/mods/champions/moves.ts:462`
- Open: TODO
- Closed: TODO

#### 191. `move:gravity` · Gravity · 22 legal users · `data/moves.ts:7754`
- Open: TODO
- Closed: TODO

#### 192. `move:growth` · Growth · 18 legal users · `data/moves.ts:7860`, `data/mods/champions/moves.ts:470`
- Open: TODO
- Closed: TODO

#### 193. `move:guardsplit` · Guard Split · 6 legal users · `data/moves.ts:7949`
- Open: TODO
- Closed: TODO

#### 194. `move:guardswap` · Guard Swap · 16 legal users · `data/moves.ts:7972`
- Open: TODO
- Closed: TODO

#### 195. `move:guillotine` · Guillotine · 2 legal users · `data/moves.ts:8001`
- Open: TODO
- Closed: TODO

#### 196. `move:gunkshot` · Gunk Shot · 40 legal users · `data/moves.ts:8017`
- Open: TODO
- Closed: TODO

#### 197. `move:gyroball` · Gyro Ball · 33 legal users · `data/moves.ts:8047`
- Open: TODO
- Closed: TODO

#### 198. `move:hammerarm` · Hammer Arm · 16 legal users · `data/moves.ts:8085`
- Open: TODO
- Closed: TODO

#### 199. `move:hardpress` · Hard Press · 22 legal users · `data/moves.ts:8137`
- Open: TODO
- Closed: TODO

#### 200. `move:haze` · Haze · 30 legal users · `data/moves.ts:8156`
- Open: TODO
- Closed: TODO

> **Checkpoint 4 — 200 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 201. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 201. `move:headlongrush` · Headlong Rush · 3 legal users · `data/moves.ts:8208`
- Open: TODO
- Closed: TODO

#### 202. `move:headsmash` · Head Smash · 11 legal users · `data/moves.ts:8226`
- Open: TODO
- Closed: TODO

#### 203. `move:healbell` · Heal Bell · 1 legal users · `data/moves.ts:8240`
- Open: TODO
- Closed: TODO

#### 204. `move:healingwish` · Healing Wish · 10 legal users · `data/moves.ts:8348`
- Open: TODO
- Closed: TODO

#### 205. `move:healpulse` · Heal Pulse · 16 legal users · `data/moves.ts:8399`
- Open: TODO
- Closed: TODO

#### 206. `move:heatcrash` · Heat Crash · 12 legal users · `data/moves.ts:8476`
- Open: TODO
- Closed: TODO

#### 207. `move:heatwave` · Heat Wave · 40 legal users · `data/moves.ts:8516`
- Open: TODO
- Closed: TODO

#### 208. `move:heavyslam` · Heavy Slam · 32 legal users · `data/moves.ts:8533`
- Open: TODO
- Closed: TODO

#### 209. `move:helpinghand` · Helping Hand · 183 legal users · `data/moves.ts:8573`
- Open: TODO
- Closed: TODO

#### 210. `move:hex` · Hex · 54 legal users · `data/moves.ts:8607`
- Open: TODO
- Closed: TODO

#### 211. `move:highhorsepower` · High Horsepower · 38 legal users · `data/moves.ts:8885`
- Open: TODO
- Closed: TODO

#### 212. `move:highjumpkick` · High Jump Kick · 8 legal users · `data/moves.ts:8898`
- Open: TODO
- Closed: TODO

#### 213. `move:horndrill` · Horn Drill · 3 legal users · `data/moves.ts:8979`
- Open: TODO
- Closed: TODO

#### 214. `move:hornleech` · Horn Leech · 2 legal users · `data/moves.ts:8995`
- Open: TODO
- Closed: TODO

#### 215. `move:howl` · Howl · 17 legal users · `data/moves.ts:9009`, `data/mods/champions/moves.ts:510`
- Open: TODO
- Closed: TODO

#### 216. `move:hurricane` · Hurricane · 45 legal users · `data/moves.ts:9026`
- Open: TODO
- Closed: TODO

#### 217. `move:hydrocannon` · Hydro Cannon · 10 legal users · `data/moves.ts:9055`
- Open: TODO
- Closed: TODO

#### 218. `move:hydropump` · Hydro Pump · 51 legal users · `data/moves.ts:9071`
- Open: TODO
- Closed: TODO

#### 219. `move:hyperbeam` · Hyper Beam · 268 legal users · `data/moves.ts:9113`
- Open: TODO
- Closed: TODO

#### 220. `move:hypervoice` · Hyper Voice · 75 legal users · `data/moves.ts:9207`
- Open: TODO
- Closed: TODO

#### 221. `move:hypnosis` · Hypnosis · 24 legal users · `data/moves.ts:9220`
- Open: TODO
- Closed: TODO

#### 222. `move:icebeam` · Ice Beam · 69 legal users · `data/moves.ts:9302`
- Open: TODO
- Closed: TODO

#### 223. `move:icefang` · Ice Fang · 33 legal users · `data/moves.ts:9347`
- Open: TODO
- Closed: TODO

#### 224. `move:icehammer` · Ice Hammer · 3 legal users · `data/moves.ts:9369`
- Open: TODO
- Closed: TODO

#### 225. `move:icepunch` · Ice Punch · 55 legal users · `data/moves.ts:9387`
- Open: TODO
- Closed: TODO

#### 226. `move:iceshard` · Ice Shard · 11 legal users · `data/moves.ts:9404`
- Open: TODO
- Closed: TODO

#### 227. `move:icespinner` · Ice Spinner · 21 legal users · `data/moves.ts:9417`
- Open: TODO
- Closed: TODO

#### 228. `move:iciclecrash` · Icicle Crash · 8 legal users · `data/moves.ts:9437`
- Open: TODO
- Closed: TODO

#### 229. `move:iciclespear` · Icicle Spear · 16 legal users · `data/moves.ts:9454`
- Open: TODO
- Closed: TODO

#### 230. `move:icywind` · Icy Wind · 78 legal users · `data/moves.ts:9470`
- Open: TODO
- Closed: TODO

#### 231. `move:imprison` · Imprison · 57 legal users · `data/moves.ts:9489`
- Open: TODO
- Closed: TODO

#### 232. `move:infernalparade` · Infernal Parade · 1 legal users · `data/moves.ts:9543`, `data/mods/champions/moves.ts:539`
- Open: TODO
- Closed: TODO

#### 233. `move:inferno` · Inferno · 7 legal users · `data/moves.ts:9563`
- Open: TODO
- Closed: TODO

#### 234. `move:infestation` · Infestation · 5 legal users · `data/moves.ts:9595`
- Open: TODO
- Closed: TODO

#### 235. `move:ingrain` · Ingrain · 8 legal users · `data/moves.ts:9609`
- Open: TODO
- Closed: TODO

#### 236. `move:instruct` · Instruct · 1 legal users · `data/moves.ts:9641`
- Open: TODO
- Closed: TODO

#### 237. `move:irondefense` · Iron Defense · 87 legal users · `data/moves.ts:9705`
- Open: TODO
- Closed: TODO

#### 238. `move:ironhead` · Iron Head · 71 legal users · `data/moves.ts:9722`, `data/mods/champions/moves.ts:543`
- Open: TODO
- Closed: TODO

#### 239. `move:irontail` · Iron Tail · 92 legal users · `data/moves.ts:9739`
- Open: TODO
- Closed: TODO

#### 240. `move:jawlock` · Jaw Lock · 1 legal users · `data/moves.ts:9789`
- Open: TODO
- Closed: TODO

#### 241. `move:jetpunch` · Jet Punch · 1 legal users · `data/moves.ts:9805`
- Open: TODO
- Closed: TODO

#### 242. `move:kingsshield` · King's Shield · 1 legal users · `data/moves.ts:9905`, `data/mods/champions/moves.ts:562`
- Open: TODO
- Closed: TODO

#### 243. `move:knockoff` · Knock Off · 76 legal users · `data/moves.ts:9959`
- Open: TODO
- Closed: TODO

#### 244. `move:kowtowcleave` · Kowtow Cleave · 1 legal users · `data/moves.ts:9985`
- Open: TODO
- Closed: TODO

#### 245. `move:lashout` · Lash Out · 54 legal users · `data/moves.ts:10048`
- Open: TODO
- Closed: TODO

#### 246. `move:lastresort` · Last Resort · 33 legal users · `data/moves.ts:10066`
- Open: TODO
- Closed: TODO

#### 247. `move:lastrespects` · Last Respects · 3 legal users · `data/moves.ts:10091`
- Open: TODO
- Closed: TODO

#### 248. `move:lavaplume` · Lava Plume · 7 legal users · `data/moves.ts:10106`
- Open: TODO
- Closed: TODO

#### 249. `move:leafblade` · Leaf Blade · 11 legal users · `data/moves.ts:10136`
- Open: TODO
- Closed: TODO

#### 250. `move:leafstorm` · Leaf Storm · 27 legal users · `data/moves.ts:10150`
- Open: TODO
- Closed: TODO

> **Checkpoint 5 — 250 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 251. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 251. `move:leechlife` · Leech Life · 12 legal users · `data/moves.ts:10188`
- Open: TODO
- Closed: TODO

#### 252. `move:leechseed` · Leech Seed · 24 legal users · `data/moves.ts:10202`
- Open: TODO
- Closed: TODO

#### 253. `move:lifedew` · Life Dew · 14 legal users · `data/moves.ts:10286`
- Open: TODO
- Closed: TODO

#### 254. `move:lightofruin` · Light of Ruin · 1 legal users · `data/moves.ts:10299`, `data/mods/champions/moves.ts:579`
- Open: TODO
- Closed: TODO

#### 255. `move:lightscreen` · Light Screen · 126 legal users · `data/moves.ts:10315`
- Open: TODO
- Closed: TODO

#### 256. `move:liquidation` · Liquidation · 40 legal users · `data/moves.ts:10375`
- Open: TODO
- Closed: TODO

#### 257. `move:lockon` · Lock-On · 1 legal users · `data/moves.ts:10394`
- Open: TODO
- Closed: TODO

#### 258. `move:lowkick` · Low Kick · 65 legal users · `data/moves.ts:10442`
- Open: TODO
- Closed: TODO

#### 259. `move:lowsweep` · Low Sweep · 47 legal users · `data/moves.ts:10482`
- Open: TODO
- Closed: TODO

#### 260. `move:luminacrash` · Lumina Crash · 1 legal users · `data/moves.ts:10529`
- Open: TODO
- Closed: TODO

#### 261. `move:lunge` · Lunge · 21 legal users · `data/moves.ts:10607`
- Open: TODO
- Closed: TODO

#### 262. `move:machpunch` · Mach Punch · 6 legal users · `data/moves.ts:10645`
- Open: TODO
- Closed: TODO

#### 263. `move:magicpowder` · Magic Powder · 1 legal users · `data/moves.ts:10738`
- Open: TODO
- Closed: TODO

#### 264. `move:magicroom` · Magic Room · 26 legal users · `data/moves.ts:10754`
- Open: TODO
- Closed: TODO

#### 265. `move:magneticflux` · Magnetic Flux · 2 legal users · `data/moves.ts:10826`
- Open: TODO
- Closed: TODO

#### 266. `move:magnetrise` · Magnet Rise · 6 legal users · `data/moves.ts:10853`
- Open: TODO
- Closed: TODO

#### 267. `move:makeitrain` · Make It Rain · 1 legal users · `data/moves.ts:10934`, `data/mods/champions/moves.ts:607`
- Open: TODO
- Closed: TODO

#### 268. `move:matchagotcha` · Matcha Gotcha · 2 legal users · `data/moves.ts:11027`
- Open: TODO
- Closed: TODO

#### 269. `move:meanlook` · Mean Look · 14 legal users · `data/moves.ts:11492`
- Open: TODO
- Closed: TODO

#### 270. `move:megahorn` · Megahorn · 15 legal users · `data/moves.ts:11581`
- Open: TODO
- Closed: TODO

#### 271. `move:megakick` · Mega Kick · 57 legal users · `data/moves.ts:11594`
- Open: TODO
- Closed: TODO

#### 272. `move:memento` · Memento · 19 legal users · `data/moves.ts:11620`
- Open: TODO
- Closed: TODO

#### 273. `move:metalburst` · Metal Burst · 7 legal users · `data/moves.ts:11655`
- Open: TODO
- Closed: TODO

#### 274. `move:metalsound` · Metal Sound · 22 legal users · `data/moves.ts:11706`
- Open: TODO
- Closed: TODO

#### 275. `move:meteorassault` · Meteor Assault · 1 legal users · `data/moves.ts:11723`, `data/mods/champions/moves.ts:633`
- Open: TODO
- Closed: TODO

#### 276. `move:meteorbeam` · Meteor Beam · 18 legal users · `data/moves.ts:11739`
- Open: TODO
- Closed: TODO

#### 277. `move:meteormash` · Meteor Mash · 3 legal users · `data/moves.ts:11763`
- Open: TODO
- Closed: TODO

#### 278. `move:milkdrink` · Milk Drink · 1 legal users · `data/moves.ts:11823`, `data/mods/champions/moves.ts:646`
- Open: TODO
- Closed: TODO

#### 279. `move:minimize` · Minimize · 5 legal users · `data/moves.ts:11917`
- Open: TODO
- Closed: TODO

#### 280. `move:mirrorcoat` · Mirror Coat · 14 legal users · `data/moves.ts:11983`
- Open: TODO
- Closed: TODO

#### 281. `move:mistyexplosion` · Misty Explosion · 19 legal users · `data/moves.ts:12132`
- Open: TODO
- Closed: TODO

#### 282. `move:mistyterrain` · Misty Terrain · 31 legal users · `data/moves.ts:12151`
- Open: TODO
- Closed: TODO

#### 283. `move:moonblast` · Moonblast · 17 legal users · `data/moves.ts:12209`, `data/mods/champions/moves.ts:662`
- Open: TODO
- Closed: TODO

#### 284. `move:moonlight` · Moonlight · 5 legal users · `data/moves.ts:12242`
- Open: TODO
- Closed: TODO

#### 285. `move:morningsun` · Morning Sun · 5 legal users · `data/moves.ts:12278`
- Open: TODO
- Closed: TODO

#### 286. `move:mortalspin` · Mortal Spin · 1 legal users · `data/moves.ts:12314`
- Open: TODO
- Closed: TODO

#### 287. `move:mountaingale` · Mountain Gale · 1 legal users · `data/moves.ts:12362`, `data/mods/champions/moves.ts:675`
- Open: TODO
- Closed: TODO

#### 288. `move:muddywater` · Muddy Water · 31 legal users · `data/moves.ts:12398`
- Open: TODO
- Closed: TODO

#### 289. `move:mudshot` · Mud Shot · 64 legal users · `data/moves.ts:12417`
- Open: TODO
- Closed: TODO

#### 290. `move:mudslap` · Mud-Slap · 68 legal users · `data/moves.ts:12436`
- Open: TODO
- Closed: TODO

#### 291. `move:mysticalfire` · Mystical Fire · 26 legal users · `data/moves.ts:12509`
- Open: TODO
- Closed: TODO

#### 292. `move:nastyplot` · Nasty Plot · 69 legal users · `data/moves.ts:12548`
- Open: TODO
- Closed: TODO

#### 293. `move:nightdaze` · Night Daze · 1 legal users · `data/moves.ts:12677`, `data/mods/champions/moves.ts:683`
- Open: TODO
- Closed: TODO

#### 294. `move:nightshade` · Night Shade · 45 legal users · `data/moves.ts:12725`
- Open: TODO
- Closed: TODO

#### 295. `move:nightslash` · Night Slash · 37 legal users · `data/moves.ts:12739`, `data/mods/champions/moves.ts:687`
- Open: TODO
- Closed: TODO

#### 296. `move:nobleroar` · Noble Roar · 5 legal users · `data/moves.ts:12769`
- Open: TODO
- Closed: TODO

#### 297. `move:noretreat` · No Retreat · 1 legal users · `data/moves.ts:12787`
- Open: TODO
- Closed: TODO

#### 298. `move:nuzzle` · Nuzzle · 9 legal users · `data/moves.ts:12841`
- Open: TODO
- Closed: TODO

#### 299. `move:octolock` · Octolock · 1 legal users · `data/moves.ts:12960`, `data/mods/champions/moves.ts:703`
- Open: TODO
- Closed: TODO

#### 300. `move:outrage` · Outrage · 59 legal users · `data/moves.ts:13082`
- Open: TODO
- Closed: TODO

> **Checkpoint 6 — 300 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 301. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 301. `move:overdrive` · Overdrive · 2 legal users · `data/moves.ts:13098`
- Open: TODO
- Closed: TODO

#### 302. `move:overheat` · Overheat · 31 legal users · `data/moves.ts:13110`
- Open: TODO
- Closed: TODO

#### 303. `move:painsplit` · Pain Split · 60 legal users · `data/moves.ts:13128`
- Open: TODO
- Closed: TODO

#### 304. `move:paraboliccharge` · Parabolic Charge · 5 legal users · `data/moves.ts:13151`
- Open: TODO
- Closed: TODO

#### 305. `move:partingshot` · Parting Shot · 10 legal users · `data/moves.ts:13165`
- Open: TODO
- Closed: TODO

#### 306. `move:payback` · Payback · 85 legal users · `data/moves.ts:13186`
- Open: TODO
- Closed: TODO

#### 307. `move:perishsong` · Perish Song · 7 legal users · `data/moves.ts:13233`
- Open: TODO
- Closed: TODO

#### 308. `move:petalblizzard` · Petal Blizzard · 10 legal users · `data/moves.ts:13278`
- Open: TODO
- Closed: TODO

#### 309. `move:petaldance` · Petal Dance · 7 legal users · `data/moves.ts:13291`
- Open: TODO
- Closed: TODO

#### 310. `move:phantomforce` · Phantom Force · 27 legal users · `data/moves.ts:13307`
- Open: TODO
- Closed: TODO

#### 311. `move:pinmissile` · Pin Missile · 14 legal users · `data/moves.ts:13372`
- Open: TODO
- Closed: TODO

#### 312. `move:playrough` · Play Rough · 57 legal users · `data/moves.ts:13420`
- Open: TODO
- Closed: TODO

#### 313. `move:pluck` · Pluck · 7 legal users · `data/moves.ts:13439`
- Open: TODO
- Closed: TODO

#### 314. `move:poisonfang` · Poison Fang · 6 legal users · `data/moves.ts:13463`
- Open: TODO
- Closed: TODO

#### 315. `move:poisonjab` · Poison Jab · 56 legal users · `data/moves.ts:13495`
- Open: TODO
- Closed: TODO

#### 316. `move:poisonpowder` · Poison Powder · 25 legal users · `data/moves.ts:13512`
- Open: TODO
- Closed: TODO

#### 317. `move:pollenpuff` · Pollen Puff · 28 legal users · `data/moves.ts:13562`
- Open: TODO
- Closed: TODO

#### 318. `move:poltergeist` · Poltergeist · 32 legal users · `data/moves.ts:13595`
- Open: TODO
- Closed: TODO

#### 319. `move:populationbomb` · Population Bomb · 2 legal users · `data/moves.ts:13613`
- Open: TODO
- Closed: TODO

#### 320. `move:pounce` · Pounce · 50 legal users · `data/moves.ts:13627`
- Open: TODO
- Closed: TODO

#### 321. `move:powergem` · Power Gem · 17 legal users · `data/moves.ts:13707`
- Open: TODO
- Closed: TODO

#### 322. `move:powersplit` · Power Split · 7 legal users · `data/moves.ts:13759`
- Open: TODO
- Closed: TODO

#### 323. `move:powerswap` · Power Swap · 17 legal users · `data/moves.ts:13782`
- Open: TODO
- Closed: TODO

#### 324. `move:powertrick` · Power Trick · 3 legal users · `data/moves.ts:13811`
- Open: TODO
- Closed: TODO

#### 325. `move:powertrip` · Power Trip · 6 legal users · `data/moves.ts:13851`
- Open: TODO
- Closed: TODO

#### 326. `move:powerwhip` · Power Whip · 14 legal users · `data/moves.ts:13893`
- Open: TODO
- Closed: TODO

#### 327. `move:protect` · Protect · 292 legal users · `data/moves.ts:13961`, `data/mods/champions/moves.ts:763`
- Open: TODO
- Closed: TODO

#### 328. `move:psychic` · Psychic · 97 legal users · `data/moves.ts:14041`
- Open: TODO
- Closed: TODO

#### 329. `move:psychicfangs` · Psychic Fangs · 30 legal users · `data/moves.ts:14060`
- Open: TODO
- Closed: TODO

#### 330. `move:psychicnoise` · Psychic Noise · 26 legal users · `data/moves.ts:14079`
- Open: TODO
- Closed: TODO

#### 331. `move:psychicterrain` · Psychic Terrain · 24 legal users · `data/moves.ts:14095`
- Open: TODO
- Closed: TODO

#### 332. `move:psychocut` · Psycho Cut · 14 legal users · `data/moves.ts:14173`
- Open: TODO
- Closed: TODO

#### 333. `move:psychup` · Psych Up · 69 legal users · `data/moves.ts:14211`
- Open: TODO
- Closed: TODO

#### 334. `move:psyshieldbash` · Psyshield Bash · 1 legal users · `data/moves.ts:14244`, `data/mods/champions/moves.ts:779`
- Open: TODO
- Closed: TODO

#### 335. `move:psyshock` · Psyshock · 50 legal users · `data/moves.ts:14264`
- Open: TODO
- Closed: TODO

#### 336. `move:pyroball` · Pyro Ball · 1 legal users · `data/moves.ts:14438`
- Open: TODO
- Closed: TODO

#### 337. `move:quash` · Quash · 7 legal users · `data/moves.ts:14454`
- Open: TODO
- Closed: TODO

#### 338. `move:quickattack` · Quick Attack · 52 legal users · `data/moves.ts:14476`
- Open: TODO
- Closed: TODO

#### 339. `move:quickguard` · Quick Guard · 23 legal users · `data/moves.ts:14489`
- Open: TODO
- Closed: TODO

#### 340. `move:quiverdance` · Quiver Dance · 21 legal users · `data/moves.ts:14532`
- Open: TODO
- Closed: TODO

#### 341. `move:ragefist` · Rage Fist · 1 legal users · `data/moves.ts:14583`, `data/mods/champions/moves.ts:791`
- Open: TODO
- Closed: TODO

#### 342. `move:ragepowder` · Rage Powder · 25 legal users · `data/moves.ts:14598`
- Open: TODO
- Closed: TODO

#### 343. `move:ragingbull` · Raging Bull · 4 legal users · `data/moves.ts:14633`
- Open: TODO
- Closed: TODO

#### 344. `move:ragingfury` · Raging Fury · 3 legal users · `data/moves.ts:14664`
- Open: TODO
- Closed: TODO

#### 345. `move:raindance` · Rain Dance · 208 legal users · `data/moves.ts:14679`
- Open: TODO
- Closed: TODO

#### 346. `move:rapidspin` · Rapid Spin · 11 legal users · `data/moves.ts:14694`
- Open: TODO
- Closed: TODO

#### 347. `move:razorshell` · Razor Shell · 8 legal users · `data/moves.ts:14761`
- Open: TODO
- Closed: TODO

#### 348. `move:recover` · Recover · 23 legal users · `data/moves.ts:14806`
- Open: TODO
- Closed: TODO

#### 349. `move:recycle` · Recycle · 12 legal users · `data/moves.ts:14821`
- Open: TODO
- Closed: TODO

#### 350. `move:reflect` · Reflect · 77 legal users · `data/moves.ts:14842`
- Open: TODO
- Closed: TODO

> **Checkpoint 7 — 350 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 351. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 351. `move:reflecttype` · Reflect Type · 3 legal users · `data/moves.ts:14883`
- Open: TODO
- Closed: TODO

#### 352. `move:rest` · Rest · 292 legal users · `data/moves.ts:14957`
- Open: TODO
- Closed: TODO

#### 353. `move:reversal` · Reversal · 66 legal users · `data/moves.ts:15077`
- Open: TODO
- Closed: TODO

#### 354. `move:revivalblessing` · Revival Blessing · 1 legal users · `data/moves.ts:15110`
- Open: TODO
- Closed: TODO

#### 355. `move:risingvoltage` · Rising Voltage · 21 legal users · `data/moves.ts:15137`
- Open: TODO
- Closed: TODO

#### 356. `move:roar` · Roar · 70 legal users · `data/moves.ts:15157`
- Open: TODO
- Closed: TODO

#### 357. `move:rockblast` · Rock Blast · 31 legal users · `data/moves.ts:15188`
- Open: TODO
- Closed: TODO

#### 358. `move:rockpolish` · Rock Polish · 6 legal users · `data/moves.ts:15222`
- Open: TODO
- Closed: TODO

#### 359. `move:rockslide` · Rock Slide · 108 legal users · `data/moves.ts:15239`
- Open: TODO
- Closed: TODO

#### 360. `move:rocktomb` · Rock Tomb · 101 legal users · `data/moves.ts:15288`
- Open: TODO
- Closed: TODO

#### 361. `move:rockwrecker` · Rock Wrecker · 1 legal users · `data/moves.ts:15307`
- Open: TODO
- Closed: TODO

#### 362. `move:roleplay` · Role Play · 9 legal users · `data/moves.ts:15323`
- Open: TODO
- Closed: TODO

#### 363. `move:roost` · Roost · 27 legal users · `data/moves.ts:15428`
- Open: TODO
- Closed: TODO

#### 364. `move:round` · Round · 252 legal users · `data/moves.ts:15498`
- Open: TODO
- Closed: TODO

#### 365. `move:sacredsword` · Sacred Sword · 4 legal users · `data/moves.ts:15560`
- Open: TODO
- Closed: TODO

#### 366. `move:safeguard` · Safeguard · 81 legal users · `data/moves.ts:15575`
- Open: TODO
- Closed: TODO

#### 367. `move:saltcure` · Salt Cure · 1 legal users · `data/moves.ts:15632`, `data/mods/champions/moves.ts:836`
- Open: TODO
- Closed: TODO

#### 368. `move:sandstorm` · Sandstorm · 62 legal users · `data/moves.ts:15699`, `data/mods/champions/moves.ts:853`
- Open: TODO
- Closed: TODO

#### 369. `move:sandtomb` · Sand Tomb · 20 legal users · `data/moves.ts:15714`
- Open: TODO
- Closed: TODO

#### 370. `move:scald` · Scald · 20 legal users · `data/moves.ts:15761`
- Open: TODO
- Closed: TODO

#### 371. `move:scaleshot` · Scale Shot · 26 legal users · `data/moves.ts:15779`
- Open: TODO
- Closed: TODO

#### 372. `move:scaryface` · Scary Face · 122 legal users · `data/moves.ts:15800`
- Open: TODO
- Closed: TODO

#### 373. `move:scorchingsands` · Scorching Sands · 30 legal users · `data/moves.ts:15817`
- Open: TODO
- Closed: TODO

#### 374. `move:screech` · Screech · 53 legal users · `data/moves.ts:15847`
- Open: TODO
- Closed: TODO

#### 375. `move:seedbomb` · Seed Bomb · 57 legal users · `data/moves.ts:15959`
- Open: TODO
- Closed: TODO

#### 376. `move:seismictoss` · Seismic Toss · 8 legal users · `data/moves.ts:15991`
- Open: TODO
- Closed: TODO

#### 377. `move:selfdestruct` · Self-Destruct · 27 legal users · `data/moves.ts:16006`
- Open: TODO
- Closed: TODO

#### 378. `move:shadowball` · Shadow Ball · 110 legal users · `data/moves.ts:16020`
- Open: TODO
- Closed: TODO

#### 379. `move:shadowclaw` · Shadow Claw · 63 legal users · `data/moves.ts:16059`, `data/mods/champions/moves.ts:869`
- Open: TODO
- Closed: TODO

#### 380. `move:shadowpunch` · Shadow Punch · 10 legal users · `data/moves.ts:16102`
- Open: TODO
- Closed: TODO

#### 381. `move:shadowsneak` · Shadow Sneak · 19 legal users · `data/moves.ts:16115`
- Open: TODO
- Closed: TODO

#### 382. `move:shedtail` · Shed Tail · 3 legal users · `data/moves.ts:16161`
- Open: TODO
- Closed: TODO

#### 383. `move:sheercold` · Sheer Cold · 5 legal users · `data/moves.ts:16198`
- Open: TODO
- Closed: TODO

#### 384. `move:shellsidearm` · Shell Side Arm · 1 legal users · `data/moves.ts:16214`
- Open: TODO
- Closed: TODO

#### 385. `move:shellsmash` · Shell Smash · 6 legal users · `data/moves.ts:16255`
- Open: TODO
- Closed: TODO

#### 386. `move:shelter` · Shelter · 1 legal users · `data/moves.ts:16315`
- Open: TODO
- Closed: TODO

#### 387. `move:shiftgear` · Shift Gear · 1 legal users · `data/moves.ts:16330`
- Open: TODO
- Closed: TODO

#### 388. `move:simplebeam` · Simple Beam · 3 legal users · `data/moves.ts:16482`
- Open: TODO
- Closed: TODO

#### 389. `move:sing` · Sing · 7 legal users · `data/moves.ts:16505`
- Open: TODO
- Closed: TODO

#### 390. `move:skillswap` · Skill Swap · 50 legal users · `data/moves.ts:16590`
- Open: TODO
- Closed: TODO

#### 391. `move:skittersmack` · Skitter Smack · 58 legal users · `data/moves.ts:16607`
- Open: TODO
- Closed: TODO

#### 392. `move:skyattack` · Sky Attack · 12 legal users · `data/moves.ts:16651`
- Open: TODO
- Closed: TODO

#### 393. `move:slackoff` · Slack Off · 9 legal users · `data/moves.ts:16809`
- Open: TODO
- Closed: TODO

#### 394. `move:slash` · Slash · 36 legal users · `data/moves.ts:16837`, `data/mods/champions/moves.ts:901`
- Open: TODO
- Closed: TODO

#### 395. `move:sleeppowder` · Sleep Powder · 24 legal users · `data/moves.ts:16851`
- Open: TODO
- Closed: TODO

#### 396. `move:sleeptalk` · Sleep Talk · 292 legal users · `data/moves.ts:16866`
- Open: TODO
- Closed: TODO

#### 397. `move:sludgebomb` · Sludge Bomb · 48 legal users · `data/moves.ts:16920`
- Open: TODO
- Closed: TODO

#### 398. `move:sludgewave` · Sludge Wave · 29 legal users · `data/moves.ts:16937`
- Open: TODO
- Closed: TODO

#### 399. `move:smackdown` · Smack Down · 39 legal users · `data/moves.ts:16954`
- Open: TODO
- Closed: TODO

#### 400. `move:smartstrike` · Smart Strike · 16 legal users · `data/moves.ts:17000`
- Open: TODO
- Closed: TODO

> **Checkpoint 8 — 400 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 401. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 401. `move:snaptrap` · Snap Trap · 1 legal users · `data/moves.ts:17071`, `data/mods/champions/moves.ts:917`
- Open: TODO
- Closed: TODO

#### 402. `move:snarl` · Snarl · 47 legal users · `data/moves.ts:17085`
- Open: TODO
- Closed: TODO

#### 403. `move:snipeshot` · Snipe Shot · 1 legal users · `data/moves.ts:17138`, `data/mods/champions/moves.ts:922`
- Open: TODO
- Closed: TODO

#### 404. `move:snore` · Snore · 251 legal users · `data/moves.ts:17152`
- Open: TODO
- Closed: TODO

#### 405. `move:snowscape` · Snowscape · 34 legal users · `data/moves.ts:17173`, `data/mods/champions/moves.ts:926`
- Open: TODO
- Closed: TODO

#### 406. `move:soak` · Soak · 10 legal users · `data/moves.ts:17186`
- Open: TODO
- Closed: TODO

#### 407. `move:solarbeam` · Solar Beam · 109 legal users · `data/moves.ts:17224`
- Open: TODO
- Closed: TODO

#### 408. `move:solarblade` · Solar Blade · 15 legal users · `data/moves.ts:17260`
- Open: TODO
- Closed: TODO

#### 409. `move:sparklingaria` · Sparkling Aria · 1 legal users · `data/moves.ts:17357`
- Open: TODO
- Closed: TODO

#### 410. `move:speedswap` · Speed Swap · 3 legal users · `data/moves.ts:17430`
- Open: TODO
- Closed: TODO

#### 411. `move:spicyextract` · Spicy Extract · 1 legal users · `data/moves.ts:17450`
- Open: TODO
- Closed: TODO

#### 412. `move:spikes` · Spikes · 22 legal users · `data/moves.ts:17500`
- Open: TODO
- Closed: TODO

#### 413. `move:spikyshield` · Spiky Shield · 2 legal users · `data/moves.ts:17532`, `data/mods/champions/moves.ts:938`
- Open: TODO
- Closed: TODO

#### 414. `move:spiritbreak` · Spirit Break · 1 legal users · `data/moves.ts:17602`
- Open: TODO
- Closed: TODO

#### 415. `move:spiritshackle` · Spirit Shackle · 1 legal users · `data/moves.ts:17620`, `data/mods/champions/moves.ts:947`
- Open: TODO
- Closed: TODO

#### 416. `move:spite` · Spite · 58 legal users · `data/moves.ts:17639`
- Open: TODO
- Closed: TODO

#### 417. `move:spitup` · Spit Up · 13 legal users · `data/moves.ts:17662`
- Open: TODO
- Closed: TODO

#### 418. `move:stealthrock` · Stealth Rock · 51 legal users · `data/moves.ts:17814`
- Open: TODO
- Closed: TODO

#### 419. `move:steelbeam` · Steel Beam · 22 legal users · `data/moves.ts:17876`
- Open: TODO
- Closed: TODO

#### 420. `move:steelroller` · Steel Roller · 11 legal users · `data/moves.ts:17893`
- Open: TODO
- Closed: TODO

#### 421. `move:steelwing` · Steel Wing · 24 legal users · `data/moves.ts:17914`
- Open: TODO
- Closed: TODO

#### 422. `move:stickyweb` · Sticky Web · 3 legal users · `data/moves.ts:17935`
- Open: TODO
- Closed: TODO

#### 423. `move:stockpile` · Stockpile · 15 legal users · `data/moves.ts:17960`
- Open: TODO
- Closed: TODO

#### 424. `move:stompingtantrum` · Stomping Tantrum · 75 legal users · `data/moves.ts:18049`
- Open: TODO
- Closed: TODO

#### 425. `move:stoneaxe` · Stone Axe · 1 legal users · `data/moves.ts:18069`
- Open: TODO
- Closed: TODO

#### 426. `move:stoneedge` · Stone Edge · 66 legal users · `data/moves.ts:18096`
- Open: TODO
- Closed: TODO

#### 427. `move:storedpower` · Stored Power · 62 legal users · `data/moves.ts:18110`
- Open: TODO
- Closed: TODO

#### 428. `move:stormthrow` · Storm Throw · 6 legal users · `data/moves.ts:18130`, `data/mods/champions/moves.ts:967`
- Open: TODO
- Closed: TODO

#### 429. `move:strengthsap` · Strength Sap · 7 legal users · `data/moves.ts:18174`, `data/mods/champions/moves.ts:979`
- Open: TODO
- Closed: TODO

#### 430. `move:stringshot` · String Shot · 24 legal users · `data/moves.ts:18194`
- Open: TODO
- Closed: TODO

#### 431. `move:strugglebug` · Struggle Bug · 28 legal users · `data/moves.ts:18233`
- Open: TODO
- Closed: TODO

#### 432. `move:stuffcheeks` · Stuff Cheeks · 4 legal users · `data/moves.ts:18252`, `data/mods/champions/moves.ts:983`
- Open: TODO
- Closed: TODO

#### 433. `move:stunspore` · Stun Spore · 26 legal users · `data/moves.ts:18274`
- Open: TODO
- Closed: TODO

#### 434. `move:substitute` · Substitute · 292 legal users · `data/moves.ts:18304`
- Open: TODO
- Closed: TODO

#### 435. `move:suckerpunch` · Sucker Punch · 45 legal users · `data/moves.ts:18396`
- Open: TODO
- Closed: TODO

#### 436. `move:sunnyday` · Sunny Day · 210 legal users · `data/moves.ts:18416`
- Open: TODO
- Closed: TODO

#### 437. `move:supercellslam` · Supercell Slam · 10 legal users · `data/moves.ts:18445`
- Open: TODO
- Closed: TODO

#### 438. `move:superfang` · Super Fang · 15 legal users · `data/moves.ts:18461`
- Open: TODO
- Closed: TODO

#### 439. `move:superpower` · Superpower · 56 legal users · `data/moves.ts:18477`
- Open: TODO
- Closed: TODO

#### 440. `move:surf` · Surf · 68 legal users · `data/moves.ts:18526`
- Open: TODO
- Closed: TODO

#### 441. `move:swagger` · Swagger · 50 legal users · `data/moves.ts:18555`
- Open: TODO
- Closed: TODO

#### 442. `move:swallow` · Swallow · 12 legal users · `data/moves.ts:18573`
- Open: TODO
- Closed: TODO

#### 443. `move:sweetkiss` · Sweet Kiss · 18 legal users · `data/moves.ts:18599`
- Open: TODO
- Closed: TODO

#### 444. `move:sweetscent` · Sweet Scent · 24 legal users · `data/moves.ts:18614`
- Open: TODO
- Closed: TODO

#### 445. `move:switcheroo` · Switcheroo · 18 legal users · `data/moves.ts:18644`
- Open: TODO
- Closed: TODO

#### 446. `move:swordsdance` · Swords Dance · 80 legal users · `data/moves.ts:18691`
- Open: TODO
- Closed: TODO

#### 447. `move:synthesis` · Synthesis · 17 legal users · `data/moves.ts:18725`
- Open: TODO
- Closed: TODO

#### 448. `move:syrupbomb` · Syrup Bomb · 1 legal users · `data/moves.ts:18761`, `data/mods/champions/moves.ts:1003`
- Open: TODO
- Closed: TODO

#### 449. `move:tailslap` · Tail Slap · 7 legal users · `data/moves.ts:18842`
- Open: TODO
- Closed: TODO

#### 450. `move:tailwind` · Tailwind · 44 legal users · `data/moves.ts:18875`
- Open: TODO
- Closed: TODO

> **Checkpoint 9 — 450 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 451. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 451. `move:taunt` · Taunt · 101 legal users · `data/moves.ts:18974`
- Open: TODO
- Closed: TODO

#### 452. `move:tearfullook` · Tearful Look · 8 legal users · `data/moves.ts:19017`
- Open: TODO
- Closed: TODO

#### 453. `move:teatime` · Teatime · 2 legal users · `data/moves.ts:19035`
- Open: TODO
- Closed: TODO

#### 454. `move:teeterdance` · Teeter Dance · 5 legal users · `data/moves.ts:19099`
- Open: TODO
- Closed: TODO

#### 455. `move:temperflare` · Temper Flare · 26 legal users · `data/moves.ts:19185`
- Open: TODO
- Closed: TODO

#### 456. `move:terrainpulse` · Terrain Pulse · 11 legal users · `data/moves.ts:19265`
- Open: TODO
- Closed: TODO

#### 457. `move:thief` · Thief · 157 legal users · `data/moves.ts:19302`
- Open: TODO
- Closed: TODO

#### 458. `move:thrash` · Thrash · 34 legal users · `data/moves.ts:19373`
- Open: TODO
- Closed: TODO

#### 459. `move:throatchop` · Throat Chop · 68 legal users · `data/moves.ts:19389`
- Open: TODO
- Closed: TODO

#### 460. `move:thunder` · Thunder · 66 legal users · `data/moves.ts:19438`
- Open: TODO
- Closed: TODO

#### 461. `move:thunderbolt` · Thunderbolt · 72 legal users · `data/moves.ts:19467`
- Open: TODO
- Closed: TODO

#### 462. `move:thunderfang` · Thunder Fang · 37 legal users · `data/moves.ts:19517`
- Open: TODO
- Closed: TODO

#### 463. `move:thunderpunch` · Thunder Punch · 65 legal users · `data/moves.ts:19557`
- Open: TODO
- Closed: TODO

#### 464. `move:thunderwave` · Thunder Wave · 80 legal users · `data/moves.ts:19591`
- Open: TODO
- Closed: TODO

#### 465. `move:tickle` · Tickle · 30 legal users · `data/moves.ts:19607`
- Open: TODO
- Closed: TODO

#### 466. `move:tidyup` · Tidy Up · 2 legal users · `data/moves.ts:19625`
- Open: TODO
- Closed: TODO

#### 467. `move:topsyturvy` · Topsy-Turvy · 2 legal users · `data/moves.ts:19655`
- Open: TODO
- Closed: TODO

#### 468. `move:torchsong` · Torch Song · 1 legal users · `data/moves.ts:19680`
- Open: TODO
- Closed: TODO

#### 469. `move:torment` · Torment · 25 legal users · `data/moves.ts:19701`
- Open: TODO
- Closed: TODO

#### 470. `move:toxic` · Toxic · 31 legal users · `data/moves.ts:19733`
- Open: TODO
- Closed: TODO

#### 471. `move:toxicspikes` · Toxic Spikes · 27 legal users · `data/moves.ts:19749`
- Open: TODO
- Closed: TODO

#### 472. `move:toxicthread` · Toxic Thread · 1 legal users · `data/moves.ts:19789`, `data/mods/champions/moves.ts:1063`
- Open: TODO
- Closed: TODO

#### 473. `move:trailblaze` · Trailblaze · 109 legal users · `data/moves.ts:19807`
- Open: TODO
- Closed: TODO

#### 474. `move:transform` · Transform · 1 legal users · `data/moves.ts:19828`
- Open: TODO
- Closed: TODO

#### 475. `move:triattack` · Tri Attack · 20 legal users · `data/moves.ts:19845`
- Open: TODO
- Closed: TODO

#### 476. `move:trick` · Trick · 61 legal users · `data/moves.ts:19865`
- Open: TODO
- Closed: TODO

#### 477. `move:trickortreat` · Trick-or-Treat · 4 legal users · `data/moves.ts:19912`, `data/mods/champions/moves.ts:1069`
- Open: TODO
- Closed: TODO

#### 478. `move:trickroom` · Trick Room · 48 legal users · `data/moves.ts:19940`
- Open: TODO
- Closed: TODO

#### 479. `move:triplearrows` · Triple Arrows · 1 legal users · `data/moves.ts:19981`
- Open: TODO
- Closed: TODO

#### 480. `move:tripleaxel` · Triple Axel · 14 legal users · `data/moves.ts:20005`
- Open: TODO
- Closed: TODO

#### 481. `move:tropkick` · Trop Kick · 1 legal users · `data/moves.ts:20057`, `data/mods/champions/moves.ts:1082`
- Open: TODO
- Closed: TODO

#### 482. `move:twinbeam` · Twin Beam · 1 legal users · `data/moves.ts:20121`
- Open: TODO
- Closed: TODO

#### 483. `move:upperhand` · Upper Hand · 28 legal users · `data/moves.ts:20187`
- Open: TODO
- Closed: TODO

#### 484. `move:uproar` · Uproar · 87 legal users · `data/moves.ts:20210`
- Open: TODO
- Closed: TODO

#### 485. `move:uturn` · U-turn · 75 legal users · `data/moves.ts:20268`
- Open: TODO
- Closed: TODO

#### 486. `move:vacuumwave` · Vacuum Wave · 20 legal users · `data/moves.ts:20282`
- Open: TODO
- Closed: TODO

#### 487. `move:venoshock` · Venoshock · 28 legal users · `data/moves.ts:20357`
- Open: TODO
- Closed: TODO

#### 488. `move:voltswitch` · Volt Switch · 23 legal users · `data/moves.ts:20432`
- Open: TODO
- Closed: TODO

#### 489. `move:volttackle` · Volt Tackle · 3 legal users · `data/moves.ts:20446`
- Open: TODO
- Closed: TODO

#### 490. `move:waterfall` · Waterfall · 35 legal users · `data/moves.ts:20488`
- Open: TODO
- Closed: TODO

#### 491. `move:waterpulse` · Water Pulse · 51 legal users · `data/moves.ts:20589`
- Open: TODO
- Closed: TODO

#### 492. `move:watershuriken` · Water Shuriken · 1 legal users · `data/moves.ts:20606`
- Open: TODO
- Closed: TODO

#### 493. `move:waterspout` · Water Spout · 1 legal users · `data/moves.ts:20661`
- Open: TODO
- Closed: TODO

#### 494. `move:wavecrash` · Wave Crash · 8 legal users · `data/moves.ts:20679`
- Open: TODO
- Closed: TODO

#### 495. `move:weatherball` · Weather Ball · 66 legal users · `data/moves.ts:20692`
- Open: TODO
- Closed: TODO

#### 496. `move:whirlpool` · Whirlpool · 32 legal users · `data/moves.ts:20746`
- Open: TODO
- Closed: TODO

#### 497. `move:whirlwind` · Whirlwind · 31 legal users · `data/moves.ts:20760`
- Open: TODO
- Closed: TODO

#### 498. `move:wideguard` · Wide Guard · 20 legal users · `data/moves.ts:20808`
- Open: TODO
- Closed: TODO

#### 499. `move:wildcharge` · Wild Charge · 37 legal users · `data/moves.ts:20873`
- Open: TODO
- Closed: TODO

#### 500. `move:willowisp` · Will-O-Wisp · 55 legal users · `data/moves.ts:20887`
- Open: TODO
- Closed: TODO

> **Checkpoint 10 — 500 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 501. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 501. `move:wish` · Wish · 26 legal users · `data/moves.ts:20915`, `data/mods/champions/moves.ts:1130`
- Open: TODO
- Closed: TODO

#### 502. `move:wonderroom` · Wonder Room · 39 legal users · `data/moves.ts:20969`
- Open: TODO
- Closed: TODO

#### 503. `move:woodhammer` · Wood Hammer · 7 legal users · `data/moves.ts:21018`
- Open: TODO
- Closed: TODO

#### 504. `move:worryseed` · Worry Seed · 14 legal users · `data/moves.ts:21050`
- Open: TODO
- Closed: TODO

#### 505. `move:wrap` · Wrap · 9 legal users · `data/moves.ts:21081`
- Open: TODO
- Closed: TODO

#### 506. `move:xscissor` · X-Scissor · 32 legal users · `data/moves.ts:21118`
- Open: TODO
- Closed: TODO

#### 507. `move:yawn` · Yawn · 37 legal users · `data/moves.ts:21131`
- Open: TODO
- Closed: TODO

#### 508. `move:zapcannon` · Zap Cannon · 8 legal users · `data/moves.ts:21163`
- Open: TODO
- Closed: TODO

#### 509. `move:zenheadbutt` · Zen Headbutt · 87 legal users · `data/moves.ts:21180`
- Open: TODO
- Closed: TODO

#### 510. `move:zingzap` · Zing Zap · 1 legal users · `data/moves.ts:21197`
- Open: TODO
- Closed: TODO


### Abilities (203)

#### 511. `ability:adaptability` · Adaptability · 3 legal holders · `data/abilities.ts:43`
- Open: TODO
- Closed: TODO

#### 512. `ability:aftermath` · Aftermath · 1 legal holders · `data/abilities.ts:78`
- Open: TODO
- Closed: TODO

#### 513. `ability:analytic` · Analytic · 2 legal holders · `data/abilities.ts:110`
- Open: TODO
- Closed: TODO

#### 514. `ability:angerpoint` · Anger Point · 7 legal holders · `data/abilities.ts:131`
- Open: TODO
- Closed: TODO

#### 515. `ability:anticipation` · Anticipation · 2 legal holders · `data/abilities.ts:174`
- Open: TODO
- Closed: TODO

#### 516. `ability:armortail` · Armor Tail · 1 legal holders · `data/abilities.ts:215`
- Open: TODO
- Closed: TODO

#### 517. `ability:aromaveil` · Aroma Veil · 9 legal holders · `data/abilities.ts:234`
- Open: TODO
- Closed: TODO

#### 518. `ability:battlearmor` · Battle Armor · 2 legal holders · `data/abilities.ts:355`
- Open: TODO
- Closed: TODO

#### 519. `ability:battlebond` · Battle Bond · 1 legal holders · `data/abilities.ts:362`
- Open: TODO
- Closed: TODO

#### 520. `ability:berserk` · Berserk · 1 legal holders · `data/abilities.ts:414`, `data/mods/champions/abilities.ts:8`
- Open: TODO
- Closed: TODO

#### 521. `ability:bigpecks` · Big Pecks · 1 legal holders · `data/abilities.ts:445`
- Open: TODO
- Closed: TODO

#### 522. `ability:blaze` · Blaze · 11 legal holders · `data/abilities.ts:460`
- Open: TODO
- Closed: TODO

#### 523. `ability:bulletproof` · Bulletproof · 2 legal holders · `data/abilities.ts:480`
- Open: TODO
- Closed: TODO

#### 524. `ability:cheekpouch` · Cheek Pouch · 4 legal holders · `data/abilities.ts:492`
- Open: TODO
- Closed: TODO

#### 525. `ability:chlorophyll` · Chlorophyll · 6 legal holders · `data/abilities.ts:512`
- Open: TODO
- Closed: TODO

#### 526. `ability:clearbody` · Clear Body · 3 legal holders · `data/abilities.ts:523`
- Open: TODO
- Closed: TODO

#### 527. `ability:cloudnine` · Cloud Nine · 2 legal holders · `data/abilities.ts:543`
- Open: TODO
- Closed: TODO

#### 528. `ability:competitive` · Competitive · 4 legal holders · `data/abilities.ts:645`
- Open: TODO
- Closed: TODO

#### 529. `ability:compoundeyes` · Compound Eyes · 20 legal holders · `data/abilities.ts:666`
- Open: TODO
- Closed: TODO

#### 530. `ability:contrary` · Contrary · 2 legal holders · `data/abilities.ts:678`
- Open: TODO
- Closed: TODO

#### 531. `ability:corrosion` · Corrosion · 2 legal holders · `data/abilities.ts:691`
- Open: TODO
- Closed: TODO

#### 532. `ability:cudchew` · Cud Chew · 4 legal holders · `data/abilities.ts:742`
- Open: TODO
- Closed: TODO

#### 533. `ability:curiousmedicine` · Curious Medicine · 1 legal holders · `data/abilities.ts:772`
- Open: TODO
- Closed: TODO

#### 534. `ability:cursedbody` · Cursed Body · 6 legal holders · `data/abilities.ts:784`
- Open: TODO
- Closed: TODO

#### 535. `ability:cutecharm` · Cute Charm · 5 legal holders · `data/abilities.ts:798`
- Open: TODO
- Closed: TODO

#### 536. `ability:damp` · Damp · 3 legal holders · `data/abilities.ts:811`
- Open: TODO
- Closed: TODO

#### 537. `ability:defiant` · Defiant · 5 legal holders · `data/abilities.ts:901`
- Open: TODO
- Closed: TODO

#### 538. `ability:disguise` · Disguise · 1 legal holders · `data/abilities.ts:970`
- Open: TODO
- Closed: TODO

#### 539. `ability:drizzle` · Drizzle · 2 legal holders · `data/abilities.ts:1078`
- Open: TODO
- Closed: TODO

#### 540. `ability:drought` · Drought · 2 legal holders · `data/abilities.ts:1088`
- Open: TODO
- Closed: TODO

#### 541. `ability:dryskin` · Dry Skin · 2 legal holders · `data/abilities.ts:1098`
- Open: TODO
- Closed: TODO

#### 542. `ability:earlybird` · Early Bird · 2 legal holders · `data/abilities.ts:1126`
- Open: TODO
- Closed: TODO

#### 543. `ability:eartheater` · Earth Eater · 1 legal holders · `data/abilities.ts:1133`
- Open: TODO
- Closed: TODO

#### 544. `ability:effectspore` · Effect Spore · 1 legal holders · `data/abilities.ts:1161`
- Open: TODO
- Closed: TODO

#### 545. `ability:electricsurge` · Electric Surge · 1 legal holders · `data/abilities.ts:1179`
- Open: TODO
- Closed: TODO

#### 546. `ability:electromorphosis` · Electromorphosis · 1 legal holders · `data/abilities.ts:1188`
- Open: TODO
- Closed: TODO

#### 547. `ability:emergencyexit` · Emergency Exit · 1 legal holders · `data/abilities.ts:1250`, `data/mods/champions/abilities.ts:22`
- Open: TODO
- Closed: TODO

#### 548. `ability:filter` · Filter · 1 legal holders · `data/abilities.ts:1283`
- Open: TODO
- Closed: TODO

#### 549. `ability:flamebody` · Flame Body · 3 legal holders · `data/abilities.ts:1316`
- Open: TODO
- Closed: TODO

#### 550. `ability:flashfire` · Flash Fire · 9 legal holders · `data/abilities.ts:1341`
- Open: TODO
- Closed: TODO

> **Checkpoint 11 — 550 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 551. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 551. `ability:flowerveil` · Flower Veil · 2 legal holders · `data/abilities.ts:1419`
- Open: TODO
- Closed: TODO

#### 552. `ability:fluffy` · Fluffy · 1 legal holders · `data/abilities.ts:1458`
- Open: TODO
- Closed: TODO

#### 553. `ability:forecast` · Forecast · 1 legal holders · `data/abilities.ts:1470`
- Open: TODO
- Closed: TODO

#### 554. `ability:forewarn` · Forewarn · 1 legal holders · `data/abilities.ts:1504`
- Open: TODO
- Closed: TODO

#### 555. `ability:friendguard` · Friend Guard · 22 legal holders · `data/abilities.ts:1533`
- Open: TODO
- Closed: TODO

#### 556. `ability:frisk` · Frisk · 12 legal holders · `data/abilities.ts:1545`
- Open: TODO
- Closed: TODO

#### 557. `ability:furcoat` · Fur Coat · 2 legal holders · `data/abilities.ts:1578`
- Open: TODO
- Closed: TODO

#### 558. `ability:galewings` · Gale Wings · 1 legal holders · `data/abilities.ts:1588`
- Open: TODO
- Closed: TODO

#### 559. `ability:gluttony` · Gluttony · 8 legal holders · `data/abilities.ts:1618`
- Open: TODO
- Closed: TODO

#### 560. `ability:goodasgold` · Good as Gold · 1 legal holders · `data/abilities.ts:1630`
- Open: TODO
- Closed: TODO

#### 561. `ability:gooey` · Gooey · 2 legal holders · `data/abilities.ts:1642`
- Open: TODO
- Closed: TODO

#### 562. `ability:grasspelt` · Grass Pelt · 1 legal holders · `data/abilities.ts:1697`
- Open: TODO
- Closed: TODO

#### 563. `ability:grassysurge` · Grassy Surge · 1 legal holders · `data/abilities.ts:1707`
- Open: TODO
- Closed: TODO

#### 564. `ability:guarddog` · Guard Dog · 1 legal holders · `data/abilities.ts:1727`
- Open: TODO
- Closed: TODO

#### 565. `ability:guts` · Guts · 7 legal holders · `data/abilities.ts:1770`
- Open: TODO
- Closed: TODO

#### 566. `ability:harvest` · Harvest · 2 legal holders · `data/abilities.ts:1800`
- Open: TODO
- Closed: TODO

#### 567. `ability:healer` · Healer · 3 legal holders · `data/abilities.ts:1817`, `data/mods/champions/abilities.ts:34`
- Open: TODO
- Closed: TODO

#### 568. `ability:heatproof` · Heatproof · 2 legal holders · `data/abilities.ts:1833`
- Open: TODO
- Closed: TODO

#### 569. `ability:heavymetal` · Heavy Metal · 1 legal holders · `data/abilities.ts:1858`
- Open: TODO
- Closed: TODO

#### 570. `ability:hospitality` · Hospitality · 2 legal holders · `data/abilities.ts:1874`
- Open: TODO
- Closed: TODO

#### 571. `ability:hugepower` · Huge Power · 2 legal holders · `data/abilities.ts:1886`
- Open: TODO
- Closed: TODO

#### 572. `ability:hungerswitch` · Hunger Switch · 1 legal holders · `data/abilities.ts:1896`
- Open: TODO
- Closed: TODO

#### 573. `ability:hustle` · Hustle · 5 legal holders · `data/abilities.ts:1908`
- Open: TODO
- Closed: TODO

#### 574. `ability:hydration` · Hydration · 2 legal holders · `data/abilities.ts:1925`
- Open: TODO
- Closed: TODO

#### 575. `ability:hypercutter` · Hyper Cutter · 4 legal holders · `data/abilities.ts:1940`
- Open: TODO
- Closed: TODO

#### 576. `ability:icebody` · Ice Body · 7 legal holders · `data/abilities.ts:1955`
- Open: TODO
- Closed: TODO

#### 577. `ability:illuminate` · Illuminate · 2 legal holders · `data/abilities.ts:2037`
- Open: TODO
- Closed: TODO

#### 578. `ability:illusion` · Illusion · 2 legal holders · `data/abilities.ts:2055`
- Open: TODO
- Closed: TODO

#### 579. `ability:immunity` · Immunity · 1 legal holders · `data/abilities.ts:2096`
- Open: TODO
- Closed: TODO

#### 580. `ability:imposter` · Imposter · 1 legal holders · `data/abilities.ts:2115`
- Open: TODO
- Closed: TODO

#### 581. `ability:infiltrator` · Infiltrator · 8 legal holders · `data/abilities.ts:2131`
- Open: TODO
- Closed: TODO

#### 582. `ability:innerfocus` · Inner Focus · 11 legal holders · `data/abilities.ts:2153`
- Open: TODO
- Closed: TODO

#### 583. `ability:insomnia` · Insomnia · 7 legal holders · `data/abilities.ts:2168`
- Open: TODO
- Closed: TODO

#### 584. `ability:intimidate` · Intimidate · 23 legal holders · `data/abilities.ts:2193`
- Open: TODO
- Closed: TODO

#### 585. `ability:ironfist` · Iron Fist · 6 legal holders · `data/abilities.ts:2236`
- Open: TODO
- Closed: TODO

#### 586. `ability:justified` · Justified · 4 legal holders · `data/abilities.ts:2249`
- Open: TODO
- Closed: TODO

#### 587. `ability:keeneye` · Keen Eye · 11 legal holders · `data/abilities.ts:2260`
- Open: TODO
- Closed: TODO

#### 588. `ability:klutz` · Klutz · 3 legal holders · `data/abilities.ts:2278`
- Open: TODO
- Closed: TODO

#### 589. `ability:leafguard` · Leaf Guard · 3 legal holders · `data/abilities.ts:2291`
- Open: TODO
- Closed: TODO

#### 590. `ability:levitate` · Levitate · 9 legal holders · `data/abilities.ts:2311`
- Open: TODO
- Closed: TODO

#### 591. `ability:libero` · Libero · 1 legal holders · `data/abilities.ts:2318`
- Open: TODO
- Closed: TODO

#### 592. `ability:lightmetal` · Light Metal · 2 legal holders · `data/abilities.ts:2334`
- Open: TODO
- Closed: TODO

#### 593. `ability:lightningrod` · Lightning Rod · 5 legal holders · `data/abilities.ts:2343`
- Open: TODO
- Closed: TODO

#### 594. `ability:limber` · Limber · 8 legal holders · `data/abilities.ts:2368`
- Open: TODO
- Closed: TODO

#### 595. `ability:liquidooze` · Liquid Ooze · 1 legal holders · `data/abilities.ts:2402`
- Open: TODO
- Closed: TODO

#### 596. `ability:liquidvoice` · Liquid Voice · 1 legal holders · `data/abilities.ts:2416`
- Open: TODO
- Closed: TODO

#### 597. `ability:longreach` · Long Reach · 1 legal holders · `data/abilities.ts:2428`
- Open: TODO
- Closed: TODO

#### 598. `ability:magicbounce` · Magic Bounce · 2 legal holders · `data/abilities.ts:2437`
- Open: TODO
- Closed: TODO

#### 599. `ability:magicguard` · Magic Guard · 3 legal holders · `data/abilities.ts:2465`
- Open: TODO
- Closed: TODO

#### 600. `ability:magician` · Magician · 2 legal holders · `data/abilities.ts:2477`
- Open: TODO
- Closed: TODO

> **Checkpoint 12 — 600 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 601. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 601. `ability:magmaarmor` · Magma Armor · 1 legal holders · `data/abilities.ts:2501`
- Open: TODO
- Closed: TODO

#### 602. `ability:marvelscale` · Marvel Scale · 1 legal holders · `data/abilities.ts:2534`
- Open: TODO
- Closed: TODO

#### 603. `ability:megalauncher` · Mega Launcher · 1 legal holders · `data/abilities.ts:2546`
- Open: TODO
- Closed: TODO

#### 604. `ability:merciless` · Merciless · 1 legal holders · `data/abilities.ts:2572`
- Open: TODO
- Closed: TODO

#### 605. `ability:mimicry` · Mimicry · 1 legal holders · `data/abilities.ts:2581`
- Open: TODO
- Closed: TODO

#### 606. `ability:minus` · Minus · 2 legal holders · `data/abilities.ts:2643`
- Open: TODO
- Closed: TODO

#### 607. `ability:mirrorarmor` · Mirror Armor · 1 legal holders · `data/abilities.ts:2657`
- Open: TODO
- Closed: TODO

#### 608. `ability:moldbreaker` · Mold Breaker · 8 legal holders · `data/abilities.ts:2689`
- Open: TODO
- Closed: TODO

#### 609. `ability:moody` · Moody · 2 legal holders · `data/abilities.ts:2701`
- Open: TODO
- Closed: TODO

#### 610. `ability:motordrive` · Motor Drive · 1 legal holders · `data/abilities.ts:2735`
- Open: TODO
- Closed: TODO

#### 611. `ability:moxie` · Moxie · 8 legal holders · `data/abilities.ts:2749`
- Open: TODO
- Closed: TODO

#### 612. `ability:multiscale` · Multiscale · 1 legal holders · `data/abilities.ts:2760`
- Open: TODO
- Closed: TODO

#### 613. `ability:mummy` · Mummy · 1 legal holders · `data/abilities.ts:2779`
- Open: TODO
- Closed: TODO

#### 614. `ability:naturalcure` · Natural Cure · 5 legal holders · `data/abilities.ts:2811`, `data/mods/champions/abilities.ts:49`
- Open: TODO
- Closed: TODO

#### 615. `ability:noguard` · No Guard · 3 legal holders · `data/abilities.ts:2970`
- Open: TODO
- Closed: TODO

#### 616. `ability:oblivious` · Oblivious · 4 legal holders · `data/abilities.ts:3008`
- Open: TODO
- Closed: TODO

#### 617. `ability:opportunist` · Opportunist · 1 legal holders · `data/abilities.ts:3041`
- Open: TODO
- Closed: TODO

#### 618. `ability:overcoat` · Overcoat · 3 legal holders · `data/abilities.ts:3108`
- Open: TODO
- Closed: TODO

#### 619. `ability:overgrow` · Overgrow · 11 legal holders · `data/abilities.ts:3124`
- Open: TODO
- Closed: TODO

#### 620. `ability:owntempo` · Own Tempo · 8 legal holders · `data/abilities.ts:3144`
- Open: TODO
- Closed: TODO

#### 621. `ability:pickpocket` · Pickpocket · 4 legal holders · `data/abilities.ts:3239`
- Open: TODO
- Closed: TODO

#### 622. `ability:pickup` · Pickup · 6 legal holders · `data/abilities.ts:3262`
- Open: TODO
- Closed: TODO

#### 623. `ability:pixilate` · Pixilate · 1 legal holders · `data/abilities.ts:3296`
- Open: TODO
- Closed: TODO

#### 624. `ability:plus` · Plus · 3 legal holders · `data/abilities.ts:3317`
- Open: TODO
- Closed: TODO

#### 625. `ability:poisonheal` · Poison Heal · 1 legal holders · `data/abilities.ts:3331`
- Open: TODO
- Closed: TODO

#### 626. `ability:poisonpoint` · Poison Point · 5 legal holders · `data/abilities.ts:3344`
- Open: TODO
- Closed: TODO

#### 627. `ability:poisontouch` · Poison Touch · 3 legal holders · `data/abilities.ts:3370`
- Open: TODO
- Closed: TODO

#### 628. `ability:prankster` · Prankster · 6 legal holders · `data/abilities.ts:3425`
- Open: TODO
- Closed: TODO

#### 629. `ability:pressure` · Pressure · 7 legal holders · `data/abilities.ts:3437`
- Open: TODO
- Closed: TODO

#### 630. `ability:protean` · Protean · 2 legal holders · `data/abilities.ts:3497`
- Open: TODO
- Closed: TODO

#### 631. `ability:psychicsurge` · Psychic Surge · 2 legal holders · `data/abilities.ts:3580`
- Open: TODO
- Closed: TODO

#### 632. `ability:punkrock` · Punk Rock · 2 legal holders · `data/abilities.ts:3589`
- Open: TODO
- Closed: TODO

#### 633. `ability:purepower` · Pure Power · 1 legal holders · `data/abilities.ts:3608`
- Open: TODO
- Closed: TODO

#### 634. `ability:purifyingsalt` · Purifying Salt · 1 legal holders · `data/abilities.ts:3618`
- Open: TODO
- Closed: TODO

#### 635. `ability:queenlymajesty` · Queenly Majesty · 1 legal holders · `data/abilities.ts:3716`
- Open: TODO
- Closed: TODO

#### 636. `ability:quickdraw` · Quick Draw · 1 legal holders · `data/abilities.ts:3735`
- Open: TODO
- Closed: TODO

#### 637. `ability:quickfeet` · Quick Feet · 1 legal holders · `data/abilities.ts:3748`
- Open: TODO
- Closed: TODO

#### 638. `ability:raindish` · Rain Dish · 2 legal holders · `data/abilities.ts:3759`
- Open: TODO
- Closed: TODO

#### 639. `ability:rattled` · Rattled · 1 legal holders · `data/abilities.ts:3771`
- Open: TODO
- Closed: TODO

#### 640. `ability:receiver` · Receiver · 1 legal holders · `data/abilities.ts:3787`
- Open: TODO
- Closed: TODO

#### 641. `ability:reckless` · Reckless · 3 legal holders · `data/abilities.ts:3799`
- Open: TODO
- Closed: TODO

#### 642. `ability:refrigerate` · Refrigerate · 1 legal holders · `data/abilities.ts:3812`
- Open: TODO
- Closed: TODO

#### 643. `ability:regenerator` · Regenerator · 8 legal holders · `data/abilities.ts:3833`, `data/mods/champions/abilities.ts:63`
- Open: TODO
- Closed: TODO

#### 644. `ability:ripen` · Ripen · 2 legal holders · `data/abilities.ts:3842`
- Open: TODO
- Closed: TODO

#### 645. `ability:rivalry` · Rivalry · 2 legal holders · `data/abilities.ts:3881`
- Open: TODO
- Closed: TODO

#### 646. `ability:rockhead` · Rock Head · 5 legal holders · `data/abilities.ts:3906`
- Open: TODO
- Closed: TODO

#### 647. `ability:roughskin` · Rough Skin · 2 legal holders · `data/abilities.ts:3938`
- Open: TODO
- Closed: TODO

#### 648. `ability:runaway` · Run Away · 1 legal holders · `data/abilities.ts:3950`, `data/mods/champions/abilities.ts:71`
- Open: TODO
- Closed: TODO

#### 649. `ability:sandforce` · Sand Force · 2 legal holders · `data/abilities.ts:3956`
- Open: TODO
- Closed: TODO

#### 650. `ability:sandrush` · Sand Rush · 3 legal holders · `data/abilities.ts:3974`
- Open: TODO
- Closed: TODO

> **Checkpoint 13 — 650 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 651. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 651. `ability:sandspit` · Sand Spit · 1 legal holders · `data/abilities.ts:3988`
- Open: TODO
- Closed: TODO

#### 652. `ability:sandstream` · Sand Stream · 2 legal holders · `data/abilities.ts:3997`
- Open: TODO
- Closed: TODO

#### 653. `ability:sandveil` · Sand Veil · 6 legal holders · `data/abilities.ts:4006`
- Open: TODO
- Closed: TODO

#### 654. `ability:sapsipper` · Sap Sipper · 7 legal holders · `data/abilities.ts:4023`
- Open: TODO
- Closed: TODO

#### 655. `ability:scrappy` · Scrappy · 4 legal holders · `data/abilities.ts:4079`
- Open: TODO
- Closed: TODO

#### 656. `ability:screencleaner` · Screen Cleaner · 1 legal holders · `data/abilities.ts:4099`
- Open: TODO
- Closed: TODO

#### 657. `ability:seedsower` · Seed Sower · 1 legal holders · `data/abilities.ts:4119`
- Open: TODO
- Closed: TODO

#### 658. `ability:sharpness` · Sharpness · 3 legal holders · `data/abilities.ts:4174`
- Open: TODO
- Closed: TODO

#### 659. `ability:shedskin` · Shed Skin · 3 legal holders · `data/abilities.ts:4187`
- Open: TODO
- Closed: TODO

#### 660. `ability:sheerforce` · Sheer Force · 10 legal holders · `data/abilities.ts:4202`
- Open: TODO
- Closed: TODO

#### 661. `ability:shellarmor` · Shell Armor · 4 legal holders · `data/abilities.ts:4222`
- Open: TODO
- Closed: TODO

#### 662. `ability:shielddust` · Shield Dust · 20 legal holders · `data/abilities.ts:4229`
- Open: TODO
- Closed: TODO

#### 663. `ability:skilllink` · Skill Link · 1 legal holders · `data/abilities.ts:4297`
- Open: TODO
- Closed: TODO

#### 664. `ability:slushrush` · Slush Rush · 1 legal holders · `data/abilities.ts:4347`
- Open: TODO
- Closed: TODO

#### 665. `ability:sniper` · Sniper · 4 legal holders · `data/abilities.ts:4358`
- Open: TODO
- Closed: TODO

#### 666. `ability:snowcloak` · Snow Cloak · 5 legal holders · `data/abilities.ts:4370`
- Open: TODO
- Closed: TODO

#### 667. `ability:snowwarning` · Snow Warning · 4 legal holders · `data/abilities.ts:4387`
- Open: TODO
- Closed: TODO

#### 668. `ability:solarpower` · Solar Power · 2 legal holders · `data/abilities.ts:4396`
- Open: TODO
- Closed: TODO

#### 669. `ability:solidrock` · Solid Rock · 2 legal holders · `data/abilities.ts:4414`
- Open: TODO
- Closed: TODO

#### 670. `ability:soundproof` · Soundproof · 4 legal holders · `data/abilities.ts:4436`
- Open: TODO
- Closed: TODO

#### 671. `ability:speedboost` · Speed Boost · 4 legal holders · `data/abilities.ts:4453`
- Open: TODO
- Closed: TODO

#### 672. `ability:stakeout` · Stakeout · 2 legal holders · `data/abilities.ts:4476`
- Open: TODO
- Closed: TODO

#### 673. `ability:stall` · Stall · 1 legal holders · `data/abilities.ts:4496`
- Open: TODO
- Closed: TODO

#### 674. `ability:stalwart` · Stalwart · 1 legal holders · `data/abilities.ts:4503`
- Open: TODO
- Closed: TODO

#### 675. `ability:stamina` · Stamina · 2 legal holders · `data/abilities.ts:4514`
- Open: TODO
- Closed: TODO

#### 676. `ability:stancechange` · Stance Change · 1 legal holders · `data/abilities.ts:4523`
- Open: TODO
- Closed: TODO

#### 677. `ability:static` · Static · 7 legal holders · `data/abilities.ts:4536`
- Open: TODO
- Closed: TODO

#### 678. `ability:steadfast` · Steadfast · 5 legal holders · `data/abilities.ts:4549`
- Open: TODO
- Closed: TODO

#### 679. `ability:steelyspirit` · Steely Spirit · 1 legal holders · `data/abilities.ts:4589`
- Open: TODO
- Closed: TODO

#### 680. `ability:stench` · Stench · 1 legal holders · `data/abilities.ts:4602`
- Open: TODO
- Closed: TODO

#### 681. `ability:stickyhold` · Sticky Hold · 2 legal holders · `data/abilities.ts:4622`
- Open: TODO
- Closed: TODO

#### 682. `ability:strongjaw` · Strong Jaw · 2 legal holders · `data/abilities.ts:4661`
- Open: TODO
- Closed: TODO

#### 683. `ability:sturdy` · Sturdy · 9 legal holders · `data/abilities.ts:4673`
- Open: TODO
- Closed: TODO

#### 684. `ability:suctioncups` · Suction Cups · 1 legal holders · `data/abilities.ts:4692`
- Open: TODO
- Closed: TODO

#### 685. `ability:superluck` · Super Luck · 1 legal holders · `data/abilities.ts:4703`
- Open: TODO
- Closed: TODO

#### 686. `ability:supersweetsyrup` · Supersweet Syrup · 1 legal holders · `data/abilities.ts:4712`
- Open: TODO
- Closed: TODO

#### 687. `ability:supremeoverlord` · Supreme Overlord · 1 legal holders · `data/abilities.ts:4730`
- Open: TODO
- Closed: TODO

#### 688. `ability:surgesurfer` · Surge Surfer · 1 legal holders · `data/abilities.ts:4755`
- Open: TODO
- Closed: TODO

#### 689. `ability:swarm` · Swarm · 7 legal holders · `data/abilities.ts:4766`
- Open: TODO
- Closed: TODO

#### 690. `ability:sweetveil` · Sweet Veil · 10 legal holders · `data/abilities.ts:4786`
- Open: TODO
- Closed: TODO

#### 691. `ability:swiftswim` · Swift Swim · 5 legal holders · `data/abilities.ts:4808`
- Open: TODO
- Closed: TODO

#### 692. `ability:symbiosis` · Symbiosis · 3 legal holders · `data/abilities.ts:4837`
- Open: TODO
- Closed: TODO

#### 693. `ability:synchronize` · Synchronize · 7 legal holders · `data/abilities.ts:4857`
- Open: TODO
- Closed: TODO

#### 694. `ability:tangledfeet` · Tangled Feet · 2 legal holders · `data/abilities.ts:4890`
- Open: TODO
- Closed: TODO

#### 695. `ability:technician` · Technician · 10 legal holders · `data/abilities.ts:4916`
- Open: TODO
- Closed: TODO

#### 696. `ability:telepathy` · Telepathy · 5 legal holders · `data/abilities.ts:4931`
- Open: TODO
- Closed: TODO

#### 697. `ability:thermalexchange` · Thermal Exchange · 1 legal holders · `data/abilities.ts:4990`
- Open: TODO
- Closed: TODO

#### 698. `ability:thickfat` · Thick Fat · 4 legal holders · `data/abilities.ts:5014`
- Open: TODO
- Closed: TODO

#### 699. `ability:torrent` · Torrent · 11 legal holders · `data/abilities.ts:5046`
- Open: TODO
- Closed: TODO

#### 700. `ability:toughclaws` · Tough Claws · 3 legal holders · `data/abilities.ts:5066`
- Open: TODO
- Closed: TODO

> **Checkpoint 14 — 700 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 701. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 701. `ability:toxicdebris` · Toxic Debris · 1 legal holders · `data/abilities.ts:5104`
- Open: TODO
- Closed: TODO

#### 702. `ability:trace` · Trace · 1 legal holders · `data/abilities.ts:5118`
- Open: TODO
- Closed: TODO

#### 703. `ability:unaware` · Unaware · 2 legal holders · `data/abilities.ts:5214`
- Open: TODO
- Closed: TODO

#### 704. `ability:unburden` · Unburden · 6 legal holders · `data/abilities.ts:5235`
- Open: TODO
- Closed: TODO

#### 705. `ability:unnerve` · Unnerve · 7 legal holders · `data/abilities.ts:5258`
- Open: TODO
- Closed: TODO

#### 706. `ability:vitalspirit` · Vital Spirit · 2 legal holders · `data/abilities.ts:5315`
- Open: TODO
- Closed: TODO

#### 707. `ability:voltabsorb` · Volt Absorb · 2 legal holders · `data/abilities.ts:5340`
- Open: TODO
- Closed: TODO

#### 708. `ability:wanderingspirit` · Wandering Spirit · 1 legal holders · `data/abilities.ts:5354`
- Open: TODO
- Closed: TODO

#### 709. `ability:waterabsorb` · Water Absorb · 3 legal holders · `data/abilities.ts:5363`
- Open: TODO
- Closed: TODO

#### 710. `ability:waterbubble` · Water Bubble · 1 legal holders · `data/abilities.ts:5377`
- Open: TODO
- Closed: TODO

#### 711. `ability:weakarmor` · Weak Armor · 7 legal holders · `data/abilities.ts:5448`
- Open: TODO
- Closed: TODO

#### 712. `ability:whitesmoke` · White Smoke · 1 legal holders · `data/abilities.ts:5473`
- Open: TODO
- Closed: TODO

#### 713. `ability:zerotohero` · Zero to Hero · 1 legal holders · `data/abilities.ts:5625`
- Open: TODO
- Closed: TODO


### Items (166)

#### 714. `item:abomasite` · Abomasite · 1 legal holders · `data/items.ts:22`, `data/mods/champions/items.ts:6`
- Open: TODO
- Closed: TODO

#### 715. `item:absolite` · Absolite · 1 legal holders · `data/items.ts:34`, `data/mods/champions/items.ts:10`
- Open: TODO
- Closed: TODO

#### 716. `item:absolitez` · Absolite Z · 1 legal holders · `data/items.ts:46`, `data/mods/champions/items.ts:14`
- Open: TODO
- Closed: TODO

#### 717. `item:aerodactylite` · Aerodactylite · 1 legal holders · `data/items.ts:135`, `data/mods/champions/items.ts:34`
- Open: TODO
- Closed: TODO

#### 718. `item:aggronite` · Aggronite · 1 legal holders · `data/items.ts:147`, `data/mods/champions/items.ts:38`
- Open: TODO
- Closed: TODO

#### 719. `item:airballoon` · Air Balloon · 293 legal holders · `data/items.ts:185`
- Open: TODO
- Closed: TODO

#### 720. `item:alakazite` · Alakazite · 1 legal holders · `data/items.ts:215`, `data/mods/champions/items.ts:46`
- Open: TODO
- Closed: TODO

#### 721. `item:altarianite` · Altarianite · 1 legal holders · `data/items.ts:238`, `data/mods/champions/items.ts:50`
- Open: TODO
- Closed: TODO

#### 722. `item:ampharosite` · Ampharosite · 1 legal holders · `data/items.ts:250`, `data/mods/champions/items.ts:54`
- Open: TODO
- Closed: TODO

#### 723. `item:aspearberry` · Aspear Berry · 293 legal holders · `data/items.ts:292`
- Open: TODO
- Closed: TODO

#### 724. `item:audinite` · Audinite · 1 legal holders · `data/items.ts:334`, `data/mods/champions/items.ts:66`
- Open: TODO
- Closed: TODO

#### 725. `item:babiriberry` · Babiri Berry · 293 legal holders · `data/items.ts:355`
- Open: TODO
- Closed: TODO

#### 726. `item:banettite` · Banettite · 1 legal holders · `data/items.ts:379`, `data/mods/champions/items.ts:74`
- Open: TODO
- Closed: TODO

#### 727. `item:barbaracite` · Barbaracite · 1 legal holders · `data/items.ts:391`, `data/mods/champions/items.ts:78`
- Open: TODO
- Closed: TODO

#### 728. `item:baxcalibrite` · Baxcalibrite · 1 legal holders · `data/items.ts:403`, `data/mods/champions/items.ts:82`
- Open: TODO
- Closed: TODO

#### 729. `item:beedrillite` · Beedrillite · 1 legal holders · `data/items.ts:422`, `data/mods/champions/items.ts:90`
- Open: TODO
- Closed: TODO

#### 730. `item:bigroot` · Big Root · 293 legal holders · `data/items.ts:482`
- Open: TODO
- Closed: TODO

#### 731. `item:bindingband` · Binding Band · 293 legal holders · `data/items.ts:498`
- Open: TODO
- Closed: TODO

#### 732. `item:blackbelt` · Black Belt · 293 legal holders · `data/items.ts:508`
- Open: TODO
- Closed: TODO

#### 733. `item:blackglasses` · Black Glasses · 293 legal holders · `data/items.ts:523`
- Open: TODO
- Closed: TODO

#### 734. `item:blastoisinite` · Blastoisinite · 1 legal holders · `data/items.ts:556`, `data/mods/champions/items.ts:106`
- Open: TODO
- Closed: TODO

#### 735. `item:blazikenite` · Blazikenite · 1 legal holders · `data/items.ts:568`, `data/mods/champions/items.ts:110`
- Open: TODO
- Closed: TODO

#### 736. `item:brightpowder` · Bright Powder · 293 legal holders · `data/items.ts:659`
- Open: TODO
- Closed: TODO

#### 737. `item:cameruptite` · Cameruptite · 1 legal holders · `data/items.ts:732`, `data/mods/champions/items.ts:126`
- Open: TODO
- Closed: TODO

#### 738. `item:chandelurite` · Chandelurite · 1 legal holders · `data/items.ts:761`, `data/mods/champions/items.ts:134`
- Open: TODO
- Closed: TODO

#### 739. `item:charcoal` · Charcoal · 293 legal holders · `data/items.ts:773`
- Open: TODO
- Closed: TODO

#### 740. `item:charizarditex` · Charizardite X · 1 legal holders · `data/items.ts:788`, `data/mods/champions/items.ts:138`
- Open: TODO
- Closed: TODO

#### 741. `item:charizarditey` · Charizardite Y · 1 legal holders · `data/items.ts:800`, `data/mods/champions/items.ts:142`
- Open: TODO
- Closed: TODO

#### 742. `item:chartiberry` · Charti Berry · 293 legal holders · `data/items.ts:812`
- Open: TODO
- Closed: TODO

#### 743. `item:cheriberry` · Cheri Berry · 293 legal holders · `data/items.ts:836`
- Open: TODO
- Closed: TODO

#### 744. `item:chesnaughtite` · Chesnaughtite · 1 legal holders · `data/items.ts:865`, `data/mods/champions/items.ts:146`
- Open: TODO
- Closed: TODO

#### 745. `item:chestoberry` · Chesto Berry · 293 legal holders · `data/items.ts:877`
- Open: TODO
- Closed: TODO

#### 746. `item:chilanberry` · Chilan Berry · 293 legal holders · `data/items.ts:898`
- Open: TODO
- Closed: TODO

#### 747. `item:chimechite` · Chimechite · 1 legal holders · `data/items.ts:938`, `data/mods/champions/items.ts:150`
- Open: TODO
- Closed: TODO

#### 748. `item:choicescarf` · Choice Scarf · 293 legal holders · `data/items.ts:983`
- Open: TODO
- Closed: TODO

#### 749. `item:chopleberry` · Chople Berry · 293 legal holders · `data/items.ts:1030`
- Open: TODO
- Closed: TODO

#### 750. `item:clefablite` · Clefablite · 1 legal holders · `data/items.ts:1088`, `data/mods/champions/items.ts:170`
- Open: TODO
- Closed: TODO

> **Checkpoint 15 — 750 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 751. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 751. `item:cobaberry` · Coba Berry · 293 legal holders · `data/items.ts:1109`
- Open: TODO
- Closed: TODO

#### 752. `item:colburberry` · Colbur Berry · 293 legal holders · `data/items.ts:1133`
- Open: TODO
- Closed: TODO

#### 753. `item:crabominite` · Crabominite · 1 legal holders · `data/items.ts:1214`, `data/mods/champions/items.ts:186`
- Open: TODO
- Closed: TODO

#### 754. `item:damprock` · Damp Rock · 293 legal holders · `data/items.ts:1261`
- Open: TODO
- Closed: TODO

#### 755. `item:delphoxite` · Delphoxite · 1 legal holders · `data/items.ts:1378`, `data/mods/champions/items.ts:206`
- Open: TODO
- Closed: TODO

#### 756. `item:dragalgite` · Dragalgite · 1 legal holders · `data/items.ts:1470`, `data/mods/champions/items.ts:222`
- Open: TODO
- Closed: TODO

#### 757. `item:dragonfang` · Dragon Fang · 293 legal holders · `data/items.ts:1482`
- Open: TODO
- Closed: TODO

#### 758. `item:dragoninite` · Dragoninite · 1 legal holders · `data/items.ts:1511`, `data/mods/champions/items.ts:226`
- Open: TODO
- Closed: TODO

#### 759. `item:drampanite` · Drampanite · 1 legal holders · `data/items.ts:1560`, `data/mods/champions/items.ts:234`
- Open: TODO
- Closed: TODO

#### 760. `item:eelektrossite` · Eelektrossite · 1 legal holders · `data/items.ts:1657`, `data/mods/champions/items.ts:262`
- Open: TODO
- Closed: TODO

#### 761. `item:ejectbutton` · Eject Button · 293 legal holders · `data/items.ts:1680`, `data/mods/champions/items.ts:266`
- Open: TODO
- Closed: TODO

#### 762. `item:electricseed` · Electric Seed · 293 legal holders · `data/items.ts:1799`
- Open: TODO
- Closed: TODO

#### 763. `item:emboarite` · Emboarite · 1 legal holders · `data/items.ts:1834`, `data/mods/champions/items.ts:290`
- Open: TODO
- Closed: TODO

#### 764. `item:excadrite` · Excadrite · 1 legal holders · `data/items.ts:1889`, `data/mods/champions/items.ts:302`
- Open: TODO
- Closed: TODO

#### 765. `item:expertbelt` · Expert Belt · 293 legal holders · `data/items.ts:1901`
- Open: TODO
- Closed: TODO

#### 766. `item:fairyfeather` · Fairy Feather · 293 legal holders · `data/items.ts:1927`
- Open: TODO
- Closed: TODO

#### 767. `item:falinksite` · Falinksite · 1 legal holders · `data/items.ts:1972`, `data/mods/champions/items.ts:306`
- Open: TODO
- Closed: TODO

#### 768. `item:feraligite` · Feraligite · 1 legal holders · `data/items.ts:1991`, `data/mods/champions/items.ts:314`
- Open: TODO
- Closed: TODO

#### 769. `item:floettite` · Floettite · 1 legal holders · `data/items.ts:2189`, `data/mods/champions/items.ts:342`
- Open: TODO
- Closed: TODO

#### 770. `item:focusband` · Focus Band · 293 legal holders · `data/items.ts:2253`
- Open: TODO
- Closed: TODO

#### 771. `item:focussash` · Focus Sash · 293 legal holders · `data/items.ts:2269`
- Open: TODO
- Closed: TODO

#### 772. `item:froslassite` · Froslassite · 1 legal holders · `data/items.ts:2333`, `data/mods/champions/items.ts:354`
- Open: TODO
- Closed: TODO

#### 773. `item:galladite` · Galladite · 1 legal holders · `data/items.ts:2374`, `data/mods/champions/items.ts:366`
- Open: TODO
- Closed: TODO

#### 774. `item:garchompite` · Garchompite · 1 legal holders · `data/items.ts:2406`, `data/mods/champions/items.ts:374`
- Open: TODO
- Closed: TODO

#### 775. `item:garchompitez` · Garchompite Z · 1 legal holders · `data/items.ts:2418`, `data/mods/champions/items.ts:378`
- Open: TODO
- Closed: TODO

#### 776. `item:gardevoirite` · Gardevoirite · 1 legal holders · `data/items.ts:2430`, `data/mods/champions/items.ts:382`
- Open: TODO
- Closed: TODO

#### 777. `item:gengarite` · Gengarite · 1 legal holders · `data/items.ts:2442`, `data/mods/champions/items.ts:386`
- Open: TODO
- Closed: TODO

#### 778. `item:glalitite` · Glalitite · 1 legal holders · `data/items.ts:2496`, `data/mods/champions/items.ts:390`
- Open: TODO
- Closed: TODO

#### 779. `item:glimmoranite` · Glimmoranite · 1 legal holders · `data/items.ts:2508`, `data/mods/champions/items.ts:394`
- Open: TODO
- Closed: TODO

#### 780. `item:golisopite` · Golisopite · 1 legal holders · `data/items.ts:2529`, `data/mods/champions/items.ts:402`
- Open: TODO
- Closed: TODO

#### 781. `item:golurkite` · Golurkite · 1 legal holders · `data/items.ts:2541`, `data/mods/champions/items.ts:406`
- Open: TODO
- Closed: TODO

#### 782. `item:grassyseed` · Grassy Seed · 293 legal holders · `data/items.ts:2595`
- Open: TODO
- Closed: TODO

#### 783. `item:greninjite` · Greninjite · 1 legal holders · `data/items.ts:2625`, `data/mods/champions/items.ts:414`
- Open: TODO
- Closed: TODO

#### 784. `item:gyaradosite` · Gyaradosite · 1 legal holders · `data/items.ts:2738`, `data/mods/champions/items.ts:434`
- Open: TODO
- Closed: TODO

#### 785. `item:habanberry` · Haban Berry · 293 legal holders · `data/items.ts:2750`
- Open: TODO
- Closed: TODO

#### 786. `item:hardstone` · Hard Stone · 293 legal holders · `data/items.ts:2774`
- Open: TODO
- Closed: TODO

#### 787. `item:hawluchanite` · Hawluchanite · 1 legal holders · `data/items.ts:2789`, `data/mods/champions/items.ts:438`
- Open: TODO
- Closed: TODO

#### 788. `item:heatrock` · Heat Rock · 293 legal holders · `data/items.ts:2841`
- Open: TODO
- Closed: TODO

#### 789. `item:heracronite` · Heracronite · 1 legal holders · `data/items.ts:2877`, `data/mods/champions/items.ts:462`
- Open: TODO
- Closed: TODO

#### 790. `item:houndoominite` · Houndoominite · 1 legal holders · `data/items.ts:2901`, `data/mods/champions/items.ts:470`
- Open: TODO
- Closed: TODO

#### 791. `item:icyrock` · Icy Rock · 293 legal holders · `data/items.ts:3010`
- Open: TODO
- Closed: TODO

#### 792. `item:ironball` · Iron Ball · 293 legal holders · `data/items.ts:3050`
- Open: TODO
- Closed: TODO

#### 793. `item:kangaskhanite` · Kangaskhanite · 1 legal holders · `data/items.ts:3117`, `data/mods/champions/items.ts:498`
- Open: TODO
- Closed: TODO

#### 794. `item:kasibberry` · Kasib Berry · 293 legal holders · `data/items.ts:3129`
- Open: TODO
- Closed: TODO

#### 795. `item:kebiaberry` · Kebia Berry · 293 legal holders · `data/items.ts:3153`
- Open: TODO
- Closed: TODO

#### 796. `item:kingsrock` · King's Rock · 293 legal holders · `data/items.ts:3209`
- Open: TODO
- Closed: TODO

#### 797. `item:leek` · Leek · 2 legal holders · `data/items.ts:3322`, `data/mods/champions/items.ts:522`
- Open: TODO
- Closed: TODO

#### 798. `item:leftovers` · Leftovers · 293 legal holders · `data/items.ts:3338`
- Open: TODO
- Closed: TODO

#### 799. `item:leppaberry` · Leppa Berry · 293 legal holders · `data/items.ts:3352`
- Open: TODO
- Closed: TODO

#### 800. `item:lifeorb` · Life Orb · 293 legal holders · `data/items.ts:3404`
- Open: TODO
- Closed: TODO

> **Checkpoint 16 — 800 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 801. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 801. `item:lightball` · Light Ball · 1 legal holders · `data/items.ts:3421`
- Open: TODO
- Closed: TODO

#### 802. `item:lightclay` · Light Clay · 293 legal holders · `data/items.ts:3444`
- Open: TODO
- Closed: TODO

#### 803. `item:lopunnite` · Lopunnite · 1 legal holders · `data/items.ts:3469`, `data/mods/champions/items.ts:538`
- Open: TODO
- Closed: TODO

#### 804. `item:lucarionite` · Lucarionite · 1 legal holders · `data/items.ts:3497`, `data/mods/champions/items.ts:550`
- Open: TODO
- Closed: TODO

#### 805. `item:lucarionitez` · Lucarionite Z · 1 legal holders · `data/items.ts:3509`, `data/mods/champions/items.ts:554`
- Open: TODO
- Closed: TODO

#### 806. `item:lumberry` · Lum Berry · 293 legal holders · `data/items.ts:3537`
- Open: TODO
- Closed: TODO

#### 807. `item:magnet` · Magnet · 293 legal holders · `data/items.ts:3689`
- Open: TODO
- Closed: TODO

#### 808. `item:malamarite` · Malamarite · 1 legal holders · `data/items.ts:3754`, `data/mods/champions/items.ts:586`
- Open: TODO
- Closed: TODO

#### 809. `item:manectite` · Manectite · 1 legal holders · `data/items.ts:3775`, `data/mods/champions/items.ts:594`
- Open: TODO
- Closed: TODO

#### 810. `item:mawilite` · Mawilite · 1 legal holders · `data/items.ts:3833`, `data/mods/champions/items.ts:610`
- Open: TODO
- Closed: TODO

#### 811. `item:medichamite` · Medichamite · 1 legal holders · `data/items.ts:3865`, `data/mods/champions/items.ts:618`
- Open: TODO
- Closed: TODO

#### 812. `item:meganiumite` · Meganiumite · 1 legal holders · `data/items.ts:3877`, `data/mods/champions/items.ts:622`
- Open: TODO
- Closed: TODO

#### 813. `item:mentalherb` · Mental Herb · 293 legal holders · `data/items.ts:3889`
- Open: TODO
- Closed: TODO

#### 814. `item:meowsticite` · Meowsticite · 2 legal holders · `data/items.ts:3927`, `data/mods/champions/items.ts:626`
- Open: TODO
- Closed: TODO

#### 815. `item:metagrossite` · Metagrossite · 1 legal holders · `data/items.ts:3943`, `data/mods/champions/items.ts:634`
- Open: TODO
- Closed: TODO

#### 816. `item:metalcoat` · Metal Coat · 293 legal holders · `data/items.ts:3961`
- Open: TODO
- Closed: TODO

#### 817. `item:metronome` · Metronome · 293 legal holders · `data/items.ts:3993`
- Open: TODO
- Closed: TODO

#### 818. `item:miracleseed` · Miracle Seed · 293 legal holders · `data/items.ts:4135`
- Open: TODO
- Closed: TODO

#### 819. `item:mistyseed` · Misty Seed · 293 legal holders · `data/items.ts:4200`
- Open: TODO
- Closed: TODO

#### 820. `item:muscleband` · Muscle Band · 293 legal holders · `data/items.ts:4239`
- Open: TODO
- Closed: TODO

#### 821. `item:mysticwater` · Mystic Water · 293 legal holders · `data/items.ts:4254`
- Open: TODO
- Closed: TODO

#### 822. `item:nevermeltice` · Never-Melt Ice · 293 legal holders · `data/items.ts:4296`
- Open: TODO
- Closed: TODO

#### 823. `item:normalgem` · Normal Gem · 293 legal holders · `data/items.ts:4324`
- Open: TODO
- Closed: TODO

#### 824. `item:occaberry` · Occa Berry · 293 legal holders · `data/items.ts:4347`
- Open: TODO
- Closed: TODO

#### 825. `item:oranberry` · Oran Berry · 293 legal holders · `data/items.ts:4397`
- Open: TODO
- Closed: TODO

#### 826. `item:passhoberry` · Passho Berry · 293 legal holders · `data/items.ts:4449`
- Open: TODO
- Closed: TODO

#### 827. `item:payapaberry` · Payapa Berry · 293 legal holders · `data/items.ts:4473`
- Open: TODO
- Closed: TODO

#### 828. `item:pechaberry` · Pecha Berry · 293 legal holders · `data/items.ts:4497`
- Open: TODO
- Closed: TODO

#### 829. `item:persimberry` · Persim Berry · 293 legal holders · `data/items.ts:4518`
- Open: TODO
- Closed: TODO

#### 830. `item:pidgeotite` · Pidgeotite · 1 legal holders · `data/items.ts:4557`, `data/mods/champions/items.ts:678`
- Open: TODO
- Closed: TODO

#### 831. `item:pinsirite` · Pinsirite · 1 legal holders · `data/items.ts:4604`, `data/mods/champions/items.ts:682`
- Open: TODO
- Closed: TODO

#### 832. `item:poisonbarb` · Poison Barb · 293 legal holders · `data/items.ts:4646`
- Open: TODO
- Closed: TODO

#### 833. `item:psychicseed` · Psychic Seed · 293 legal holders · `data/items.ts:4903`
- Open: TODO
- Closed: TODO

#### 834. `item:pyroarite` · Pyroarite · 1 legal holders · `data/items.ts:4958`, `data/mods/champions/items.ts:750`
- Open: TODO
- Closed: TODO

#### 835. `item:quickclaw` · Quick Claw · 293 legal holders · `data/items.ts:4989`
- Open: TODO
- Closed: TODO

#### 836. `item:raichunitex` · Raichunite X · 2 legal holders · `data/items.ts:5035`, `data/mods/champions/items.ts:762`
- Open: TODO
- Closed: TODO

#### 837. `item:raichunitey` · Raichunite Y · 2 legal holders · `data/items.ts:5047`, `data/mods/champions/items.ts:766`
- Open: TODO
- Closed: TODO

#### 838. `item:rawstberry` · Rawst Berry · 293 legal holders · `data/items.ts:5068`
- Open: TODO
- Closed: TODO

#### 839. `item:redcard` · Red Card · 293 legal holders · `data/items.ts:5146`
- Open: TODO
- Closed: TODO

#### 840. `item:rindoberry` · Rindo Berry · 293 legal holders · `data/items.ts:5203`
- Open: TODO
- Closed: TODO

#### 841. `item:rockyhelmet` · Rocky Helmet · 293 legal holders · `data/items.ts:5295`
- Open: TODO
- Closed: TODO

#### 842. `item:roseliberry` · Roseli Berry · 293 legal holders · `data/items.ts:5360`
- Open: TODO
- Closed: TODO

#### 843. `item:sablenite` · Sablenite · 1 legal holders · `data/items.ts:5429`, `data/mods/champions/items.ts:814`
- Open: TODO
- Closed: TODO

#### 844. `item:salamencite` · Salamencite · 1 legal holders · `data/items.ts:5506`, `data/mods/champions/items.ts:830`
- Open: TODO
- Closed: TODO

#### 845. `item:sceptilite` · Sceptilite · 1 legal holders · `data/items.ts:5518`, `data/mods/champions/items.ts:834`
- Open: TODO
- Closed: TODO

#### 846. `item:scizorite` · Scizorite · 1 legal holders · `data/items.ts:5530`, `data/mods/champions/items.ts:838`
- Open: TODO
- Closed: TODO

#### 847. `item:scolipite` · Scolipite · 1 legal holders · `data/items.ts:5542`, `data/mods/champions/items.ts:842`
- Open: TODO
- Closed: TODO

#### 848. `item:scopelens` · Scope Lens · 293 legal holders · `data/items.ts:5554`
- Open: TODO
- Closed: TODO

#### 849. `item:scovillainite` · Scovillainite · 1 legal holders · `data/items.ts:5566`, `data/mods/champions/items.ts:846`
- Open: TODO
- Closed: TODO

#### 850. `item:scraftinite` · Scraftinite · 1 legal holders · `data/items.ts:5578`, `data/mods/champions/items.ts:850`
- Open: TODO
- Closed: TODO

> **Checkpoint 17 — 850 of 879 done.** Count the lines in §6 still ending in `: TODO` and write the count in §7.
> Re-read §3 before entry 851. Every entry is read from its own source and decided on its own:
> no skipping, no grouping, no "same as above", no programs. A wrong NO is the worst mistake.

#### 851. `item:sharpbeak` · Sharp Beak · 293 legal holders · `data/items.ts:5606`
- Open: TODO
- Closed: TODO

#### 852. `item:sharpedonite` · Sharpedonite · 1 legal holders · `data/items.ts:5621`, `data/mods/champions/items.ts:854`
- Open: TODO
- Closed: TODO

#### 853. `item:shedshell` · Shed Shell · 293 legal holders · `data/items.ts:5633`
- Open: TODO
- Closed: TODO

#### 854. `item:shellbell` · Shell Bell · 293 legal holders · `data/items.ts:5650`
- Open: TODO
- Closed: TODO

#### 855. `item:shucaberry` · Shuca Berry · 293 legal holders · `data/items.ts:5690`
- Open: TODO
- Closed: TODO

#### 856. `item:silkscarf` · Silk Scarf · 293 legal holders · `data/items.ts:5714`
- Open: TODO
- Closed: TODO

#### 857. `item:silverpowder` · Silver Powder · 293 legal holders · `data/items.ts:5729`
- Open: TODO
- Closed: TODO

#### 858. `item:sitrusberry` · Sitrus Berry · 293 legal holders · `data/items.ts:5744`
- Open: TODO
- Closed: TODO

#### 859. `item:skarmorite` · Skarmorite · 1 legal holders · `data/items.ts:5766`, `data/mods/champions/items.ts:862`
- Open: TODO
- Closed: TODO

#### 860. `item:slowbronite` · Slowbronite · 2 legal holders · `data/items.ts:5808`, `data/mods/champions/items.ts:870`
- Open: TODO
- Closed: TODO

#### 861. `item:smoothrock` · Smooth Rock · 293 legal holders · `data/items.ts:5820`
- Open: TODO
- Closed: TODO

#### 862. `item:softsand` · Soft Sand · 293 legal holders · `data/items.ts:5857`
- Open: TODO
- Closed: TODO

#### 863. `item:spelltag` · Spell Tag · 293 legal holders · `data/items.ts:5902`, `data/mods/champions/items.ts:882`
- Open: TODO
- Closed: TODO

#### 864. `item:staraptite` · Staraptite · 1 legal holders · `data/items.ts:5977`, `data/mods/champions/items.ts:898`
- Open: TODO
- Closed: TODO

#### 865. `item:starminite` · Starminite · 1 legal holders · `data/items.ts:6021`, `data/mods/champions/items.ts:906`
- Open: TODO
- Closed: TODO

#### 866. `item:steelixite` · Steelixite · 1 legal holders · `data/items.ts:6068`, `data/mods/champions/items.ts:914`
- Open: TODO
- Closed: TODO

#### 867. `item:swampertite` · Swampertite · 1 legal holders · `data/items.ts:6180`, `data/mods/champions/items.ts:946`
- Open: TODO
- Closed: TODO

#### 868. `item:tangaberry` · Tanga Berry · 293 legal holders · `data/items.ts:6222`
- Open: TODO
- Closed: TODO

#### 869. `item:terrainextender` · Terrain Extender · 293 legal holders · `data/items.ts:6283`
- Open: TODO
- Closed: TODO

#### 870. `item:twistedspoon` · Twisted Spoon · 293 legal holders · `data/items.ts:7377`
- Open: TODO
- Closed: TODO

#### 871. `item:tyranitarite` · Tyranitarite · 1 legal holders · `data/items.ts:7392`, `data/mods/champions/items.ts:978`
- Open: TODO
- Closed: TODO

#### 872. `item:venusaurite` · Venusaurite · 1 legal holders · `data/items.ts:7469`, `data/mods/champions/items.ts:998`
- Open: TODO
- Closed: TODO

#### 873. `item:victreebelite` · Victreebelite · 1 legal holders · `data/items.ts:7481`, `data/mods/champions/items.ts:1002`
- Open: TODO
- Closed: TODO

#### 874. `item:wacanberry` · Wacan Berry · 293 legal holders · `data/items.ts:7493`
- Open: TODO
- Closed: TODO

#### 875. `item:whiteherb` · White Herb · 293 legal holders · `data/items.ts:7658`
- Open: TODO
- Closed: TODO

#### 876. `item:widelens` · Wide Lens · 293 legal holders · `data/items.ts:7713`
- Open: TODO
- Closed: TODO

#### 877. `item:wiseglasses` · Wise Glasses · 293 legal holders · `data/items.ts:7754`
- Open: TODO
- Closed: TODO

#### 878. `item:yacheberry` · Yache Berry · 293 legal holders · `data/items.ts:7769`
- Open: TODO
- Closed: TODO

#### 879. `item:zoomlens` · Zoom Lens · 293 legal holders · `data/items.ts:7825`
- Open: TODO
- Closed: TODO

> **Last entry done.** Count the lines in §6 still ending in `: TODO`. If the count is not 0, go back and fill every one
> before writing §8.

---

## 7. Progress log

One line per checkpoint, written when you reach it, and one after entry 879.

| Checkpoint | Entries done | Lines in §6 ending in `: TODO` |
|---|---|---|

---

## 8. Summary

Filled only after no line in §6 ends in `: TODO`.

| Kind | Entries | Open YES | Open CONDITIONAL | Open NO | Closed YES | Closed CONDITIONAL | Closed NO |
|---|---|---|---|---|---|---|---|
| Moves | 510 | | | | | | |
| Abilities | 203 | | | | | | |
| Items | 166 | | | | | | |

**The twenty most useful findings.** The entries whose answer would let a replay reveal the most, most
often, in real games, each with its entry number and one sentence on why.

1. 

**Situations that came up again and again.** The conditions that unlocked the most `CONDITIONAL`
answers (rain, low HP, a would-be knockout, a Choice item, …), each with the entry numbers it unlocked.

1. 
