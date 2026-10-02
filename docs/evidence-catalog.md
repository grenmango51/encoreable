# Evidence catalog — every effect that can reveal a hidden stat, found before a replay does

**Read first:** `engineering.md` §7.5 (Stat Points by elimination), §7.6 (closed team sheets),
§9 (open tasks).
**Status:** Phases 0–3 and 5 built as `npm run catalog` (§4); its first full run is the two
reports `evidence-open-sheets.md` and `evidence-closed-sheets.md`, summarised in §5. Phase 4, fixing
what they list, not started.
**Target format:** `gen9championsvgc2026regmc`, Reg M-C, live on play.pokemonshowdown.com.
**Verified against:** `pokemon-showdown` at upstream commit `a5df827` (2026-09-22), the commit
`package.json` pins; `scripts/lib/inference/` as of commit `e6d3501` plus the working tree of
2026-09-29.

---

## 0. What this changes

Until now, inference has grown one mechanism at a time: a replay narrows less than it should,
or a real spread gets removed, we find out why, and we add what was missing. Strength Sap, Pain
Split, Leech Seed, Shell Bell, Focus Sash and Wonder Room all came in that way.

This plan turns that around. List every effect the format allows. Ask the simulator which ones
let a hidden stat reach the log, and through which line. Compare that list with what the
evidence pass already uses, and work through the gaps in order of how often they come up in
real games. The same list then becomes the regression suite, and the same probe, pointed at
items, abilities and natures, sets the work for closed team sheets.

The rule from §7.5 does not change: **the simulator decides everything**. The catalog only
decides what to build next.

---

## 1. Why the list is finite

A hidden stat can reach a replay in only five ways. Every effect sends some stat into one or
more of them.

| Where it shows | What it can carry | Example |
|---|---|---|
| a hidden Pokemon's percentage line | its HP, Defence and Special Defence through damage taken; its HP stat through rounding | Earthquake leaves Farigiraf at 58% |
| a known Pokemon's exact line | the hidden side's Attack or Special Attack through damage dealt; any hidden amount carried over to the known side | Water Spout takes Basculegion to 155/195 |
| the order of lines | Speed | Basculegion acted before Pelipper |
| whether a line appears at all | an HP threshold that was or was not crossed | a quarter Berry eaten, a Focus Sash that held |
| what a line names | which stat, item or ability (closed sheets) | a Choice Scarf shown by speed order |

A **mechanism** is one way of turning a sink back into narrowed stats. Each mechanism is one hook
in `evidence.mjs`, not one hook per move. So a new move only means new work when it brings a new
mechanism.

---

## 2. Where the evidence pass stands

What is built and what the first catalog run (§5) found. "Unverified" means neither a search of
`scripts/lib/inference/` nor the run settled it.

| # | Mechanism | Sink | Hook today | Status after the run |
|---|---|---|---|---|
| M1 | damage taken | hidden % line | `actions.getDamage` rows per (attacking stat, defending stat) | built; **unsound** for a hit boosted by an "-ate" ability (Pixilate, Refrigerate, and the Megas that gain one) |
| M2 | damage dealt | known exact line | the same rows, attacker side | built; the same "-ate" defect |
| M3 | a hidden stat read inside a damage calculation, other than the attack/defence pair | either HP line | `analyseHit` sees the read and marks the hit `supported: false`, and `onChange` then treats it as "HP went down" (`band('down')`) | **gap**, and worse than unused: Gyro Ball and Electro Ball leave the rebuild unable to reproduce the hit |
| M4 | an HP change that is a fraction of max HP (chip, heal, weather, status) | hidden % line | `effectChange`, fractions scaled only when the amount proves them | built; a Toxic tick after the first (n × ⌊max HP/16⌋) breaks the rebuild; a move's HP cost (Substitute) is not read |
| M5 | a hidden amount carried over to an exact line | known exact line | recoil, drain, Leech Seed, Shell Bell, Pain Split, Strength Sap | built; **unsound** for the Counter family (Counter, Mirror Coat, Metal Burst, Comeuppance) |
| M6 | an HP threshold crossed or not | a line present or absent | pinch Berries (`runEvent('Update')`), Focus Sash, Sturdy, Endure (`Damage` event) | built; Substitute breaking not read, and it breaks the rebuild |
| M7 | order | order of lines | `speed.mjs`, every sort by speed | built |
| M8 | a stat moved between Pokemon | later damage and HP lines | none | **unsound**: Power Split, Guard Split, Power Trick, Transform, Imposter; Speed Swap unverified |
| M9 | a stat named or compared in a message | what a line names | none | only Shell Side Arm has a legal user |

A confusion self-hit, which the inference models (`actions.getConfusionDamage`), turns out to narrow
little: in a battle with three of them only the first cut anything, and the HP they carry is listed
unused.

Reg M-C's legal pool on upstream master: 293 species that pass `checkSpecies`, 203 abilities in
their slots, 510 moves at least one of them can learn (`checkCanLearn`), 166 items. Against Reg
M-B that is 29 species, 16 abilities, 18 items and 15 moves added, and one move (Pound) gone.
Who can use each candidate:

| Effect | Mechanism | Legal users in M-C |
|---|---|---|
| Substitute | M6 | 292 |
| Endeavor | M5 | 90 |
| Night Shade | M4 | 45 |
| Counter | M5 | 41 |
| Gyro Ball | M3 (Speed in base power) | 33 |
| Wish | M5 (heals half the user's max HP into a slot) | 26 |
| Electro Ball | M3 (Speed in base power) | 25 |
| Super Fang | M4 | 15 |
| Mirror Coat | M5 | 14 |
| Final Gambit | M5 (damage is the user's own HP) | 8 |
| Seismic Toss | M4 | 8 |
| Metal Burst | M5 | 7 |
| Power Split | M8 | 7 |
| Guard Split | M8 | 6 |
| Comeuppance | M5 | 4 |
| Speed Swap | M8 | 3 |
| Shell Side Arm | M9 | 1 (Slowbro-Galar) |
| Berserk | M6 | 1 (Drampa) |
| Emergency Exit | M6 (switches out on falling below half HP) | 1 (Golisopod) |
| Liquid Ooze | M5 (a drain from the holder becomes exact damage to the drainer) | 1 (Swalot) |
| Imposter | M8 | 1 (Ditto) |
| Revival Blessing, Milk Drink | M4 | 1 each (Pawmot, Gogoat) |
| Rocky Helmet, Binding Band | M4 (a sixth of the attacker's, or the bound target's, max HP) | items, any holder |

These have **no legal holder in Reg M-C**, so they are out of scope until a regulation allows them:
Protosynthesis, Quark Drive, Beast Boost, Download, Anger Shell, Wimp Out, Ruination, and the move
Photon Geyser. The items Choice Band, Choice Specs, Assault Vest and Booster Energy are
nonstandard in M-C, as they were in M-B. `engineering.md` §9 names Choice Band, Specs and Assault
Vest as closed-sheet candidates. Phase 5 corrects that list against this pool.

The rest of what M-C adds should need no new mechanism, which Phase 3 confirms: the damage
modifiers (Filter, Stakeout, Punk Rock, Steely Spirit, Grass Pelt, Normal Gem, the terrain Seeds
and Surges) run inside `getDamage`, and Eject Button, Red Card, Air Balloon, Rattled, Thermal
Exchange, Guard Dog, Libero and Run Away read no stat.

---

## 3. Phases

### The simulator

The pinned commit has Reg M-C as the `champions` mod and keeps Reg M-B as `championsregmb`
(`engineering.md` §2.1), so the probe builds M-C templates while the recordings, all Reg M-B,
still replay. `npm run replay` records new battles in M-C.

### Phase 0 — Prototype in the scratchpad

Build Phases 1–3 as scratch scripts, only for the effects in the 21 battles in `recordings/local/`
and the two Bo3 replays in `recordings/showdown/full-sheets/`, and read the coverage table they
produce. Move anything into the repo only if that table is worth having (§4).

**Done when:** the table exists for those effects, and M3 (Gyro Ball) comes out as a gap without
anyone telling the probe to look for it.

### Phase 1 — The legal pool

Build the pool for `gen9championsvgc2026regmc` from the validator, not from `isNonstandard`
alone: `Past` flags on abilities and species do not show who can actually use what.

- species: every one that passes `checkSpecies`;
- abilities: those species' ability slots;
- moves: what each species can learn (`checkCanLearn`);
- items: those that pass validation on some legal holder;
- conditions: the weather, terrains, rooms, side conditions and statuses those effects create,
  reached from the effects themselves.

Each effect carries its legal holders or learners and a weight. The weight is the learner count
until `plan.md` §10's Smogon usage data is wired in, and usage from then on.

**Done when:** the pool reproduces the counts in §2 and contains every effect seen in the 21
recordings.

### Phase 2 — The probe

For each effect, and for each role (the user hidden, the target hidden):

1. **A template battle.** Doubles, with Champions mechanics (`gen9championsdoublescustomgame`,
   `engineering.md` §2.1). One known Pokemon and one hidden Pokemon that uses or holds the
   effect. The choices are scripted, and every die is pinned through `>rng`
   (`scripts/lib/rng-control.mjs`), so accuracy, crits and rolls stay fixed and only the spread
   changes.
2. **Perturb.** Around a base spread, set each of the six stats to 0 and to 32, one at a time.
   Also try the current HP levels `analyseHit` already probes: max, max − 1, half, a third, a
   quarter, 1. Effects that compare two stats (Shell Side Arm) also get a pairwise pass.
3. **Diff what a replay would show.** Use the spectator channel (percentages on both sides) and
   the known side's channel (exact for the known side), filtered and diffed by
   `scripts/lib/protocol.mjs`.
4. **Record** one row per change seen: effect, role, stat, sink, and the line that changed.

A **static scan** backs the probe up. Stringify every handler of every effect in the pool
(`fn.toString()`) and look for stat reads (`maxhp`, `.hp`, `getStat(`, `storedStats`, `speed`,
`calculateStat`) and for outputs (`damage(`, `heal(`, `sethp(`, `boost(`, `add(`). An effect the
scan flags but the probe saw no change for either did not fire in its template or truly reveals
nothing. It gets a template set up by hand, or a written reason.

**Done when:** every effect in the pool has one of three outcomes:
- one or more channel rows;
- "no channel", recorded together with the template that made it fire;
- a place on the hand-set list.

### Phase 3 — Coverage

Run each channel row's probe battle through `inferSpreads` with the hidden side withheld, and
give the row a verdict:

| Verdict | Test | Meaning |
|---|---|---|
| UNSOUND | `contains(realSpread)` is false | a real spread was removed. A defect, fixed before anything else |
| UNUSED | sound, and the effect's event in `inference.events` moved neither the probed stat's range nor the count | the log carries it, and the evidence pass ignores it |
| USED | sound, and the effect's event moved the probed stat | covered |

The coverage table goes in §5 of this file, as a summary with counts per mechanism and the UNSOUND
and UNUSED rows by name.

### Phase 4 — Work the gaps

UNSOUND rows come first, then UNUSED rows ordered by weight × information. An exact HP stat is
worth more than one inequality on one stat. Each fix goes in at the mechanism level, as one
hook. It never special-cases a move. The whole probe suite runs again after each fix, against
the 21 recordings and their 83 real spreads as well.

The work list is `evidence-open-sheets.md` §2 and `evidence-closed-sheets.md` §2; §5 below gives
their head. Three of the four items this plan expected are on it, one changed:

1. **M3, Speed inside a damage calculation.** Gyro Ball and Electro Ball read Speed in
   `basePowerCallback`. Add Speed as a third dimension of the hit's rows, a flat domain memoised
   like Attack, and accept that read in `analyseHit`'s `supported` test. Then extend the same
   dimension to any other stat the reads observer catches.
2. **M5, the Counter family** is unsound, not merely unused. Counter, Mirror Coat, Metal Burst
   and Comeuppance return a multiple of the damage the user just took, and the inference computes
   that damage from the scaffold's guess for every candidate alike, so a line that disagrees with
   the guess removes every spread, the real one included.
3. **Wish** can only land on its own side's slot, so a hidden Wish heals a hidden Pokemon and
   shows as a percentage (M4), never on a known Pokemon's exact line as this plan had it.
4. **M6, Substitute.** Whether a hit breaks a hidden Pokemon's Substitute ties the damage to a
   quarter of its max HP; the inference does not read it, and the rebuild then fails.

### Phase 5 — Closed team sheets

Run the same probe with item, ability and nature varied instead of Stat Points, over the Phase 1
pool. The rows say which unknown each effect reveals and through which sink. That replaces the
hand-written candidate list in `engineering.md` §9 (closed sheets). The cost of carrying those
unknowns in `knowledge.mjs` (21 natures, items as a dimension) is decided there. The catalog only
says which candidates are worth a dimension at all.

---

## 4. The engine: `npm run catalog`

| File | What it holds |
|---|---|
| `scripts/local-catalog.mjs` | the command: pool, battles, differences, rebuilds, closed-sheet reading, reports |
| `scripts/fixtures/catalog.js` | the fixed cast, the witness moves, and the battles set up by hand |
| `catalog.bat` | the double-click entry point |
| `docs/evidence-open-sheets.md` | generated: Stat Points, every effect, and the work list for the inference |
| `docs/evidence-closed-sheets.md` | generated: names, silent sinks and hazards, and the work list for closed sheets |

No probe battle is kept in `recordings/`: every one is rebuilt from the fixture on every run.

**How it answers the question.**

1. **The pool** is the validator's (Phase 1). Formes that exist only in battle, Megas among them,
   are not brought and are left out; their Stones are items like any other. A Mega Stone or an
   item made for one species is weighed by that species alone, not by everyone who could hold it.
2. **Every battle is in the real format**, `gen9championsvgc2026regmc`, in-process. That matters:
   the known side's view of a real battle shows the hidden side as a percentage, as a replay does.
   The Doubles Custom Game has `debug: true` and so prints every HP exactly on every channel
   (`sim/battle.ts:227`), which would make every HP stat readable at switch-in.
3. **The cast is fixed** (`scripts/fixtures/catalog.js`): a known actor, a known ally and bench, the
   hidden Pokemon in p2a with a hidden ally and bench. Every one of the cast is slower than any
   hidden Pokemon the command picks, so turn order depends on the hidden Speed only when an effect
   makes it; items are rocks that only lengthen weather; the hidden side's other Pokemon hold the
   first ability their species lists, which is what a closed-sheet rebuild assumes. Dice are fixed
   by rule: every move hits, none crits, every roll is the highest, every chance an effect takes
   comes up, and the hidden Pokemon wins its speed ties.
4. **Templates.** A move is used by the hidden Pokemon and, where it can reach one, by the known
   side on it, each in five battles: alone (`quiet`); after its user is halved and takes a priority
   hit (`before`, for the Counter family and for heals that would otherwise be capped); followed by
   a hit each way (`after`); against a known Pokemon one point faster than the hidden one is after
   the move (`pace`, for anything that changes turn order); and followed by the hidden Pokemon
   switching out and back (`pivot`). An item, ability or nature sits on the hidden Pokemon, or an
   item or ability on the known one, through a battery of witnesses: hits dealt and taken, a trade,
   each status, a one-hit KO, three order witnesses, a pivot, two moves in a row, and a hit of every
   type its handlers name. A few effects also have a battle set up by hand, where no general battle
   reaches their edge (Focus Sash, Substitute breaking, Strength Sap on a hurt user).
5. **Worlds and changes.** Each battle is run with one hidden Stat Point at 0 and then at 32, the
   rest at 2, and so is its control, the same battle without the effect. A change is a line of the
   known side's view that differs between the worlds and not the same way in the control. Lines
   are matched by the turn, by what printed them and by the Pokemon they name, never by position;
   an HP line that moves by the same exact amount in both worlds, read off the omniscient channel,
   only repeats an earlier difference and is dropped.
6. **Coverage.** Each world with a change is rebuilt from its log alone by `inferSpreads`, as
   `--infer p2` rebuilds a replay. The inference uses the change when one world's log rules out
   the other world's spread, which differs only in that stat. Where the battle's own lines already
   carry the stat, the effect's own line must also have cut the hidden Pokemon in an event, or the
   verdict is MASKED: it cannot be told whether that line is ignored or only redundant.
7. **Closed sheets.** Every battle is read by `setsFromLog` from the spectator channel and judged
   box by box against the truth; what the control also shows is dropped. For an item, ability or
   nature on the hidden Pokemon, any change against the control before a line names it is a silent
   sink, and that witness is rebuilt with the sets `setsFromLog` reads — no item, the first ability
   listed, a neutral nature — to see whether the real spread survives. It is a hazard only if the
   same rebuild with the true set gets through; otherwise the fault is the inference's, and the
   open-sheet list has it. A witness whose control does not survive that rebuild either is reported
   as the battle's defect, not the effect's.
8. **Reports** are rendered from the records alone and sorted, with no timestamps, so `--check`
   can compare a fresh run with them line for line. `--dump` prints the battle behind any row.

---

## 5. Coverage

The first full run, on `pokemon-showdown` `a5df827` and `scripts/lib/inference/` as of commit
`e6d3501`. The reports hold every card and the whole work list; this is their head.

**Open sheets** (`evidence-open-sheets.md`). Of 510 moves, 418 showed a Stat Point in some line,
77 acted with nothing stat-dependent, 15 never acted in any template; of 203 abilities, 62, 48 and 93;
of 166 items, 137, 5 and 24. Per effect, role, stat and mechanism:

| Mechanism | Effects | USED | UNUSED | UNSOUND | REBUILD-FAILED | MASKED |
|---|---|---|---|---|---|---|
| M1 | 494 | 1024 | 2 | 25 | 15 | 1 |
| M2 | 516 | 601 | 0 | 21 | 6 | 7 |
| M3 | 5 | 4 | 0 | 0 | 3 | 0 |
| M4 | 69 | 60 | 0 | 0 | 2 | 11 |
| M5 | 36 | 48 | 0 | 5 | 0 | 7 |
| M6 | 18 | 15 | 0 | 0 | 3 | 1 |
| M7 | 70 | 64 | 0 | 3 | 3 | 2 |
| M8 | 4 | 0 | 0 | 8 | 0 | 0 |
| M9 | 2 | 5 | 0 | 0 | 0 | 0 |

Almost everything the log carries is read. What is not, in the order Phase 4 takes it:

1. **UNSOUND — the real spread removed.**
   - *"-ate" abilities*: a Normal move turned into another type and boosted — Pixilate,
     Refrigerate, and the Mega Stones whose Mega gains one (Gardevoirite, Altarianite, Salamencite,
     Pinsirite, Glalitite, Feraligite). The dry run misses the 1.2× boost, so a Sylveon's hit is
     read as coming from more Attack than it has. The boost applies only while
     `move.typeChangerBoosted === this.effect` (`data/abilities.ts:71`, Aerilate, and five more
     like it), and the dry run hands `getDamage` a deep clone of the move (`evidence.mjs:1118`),
     whose copy of the ability is not the same object.
   - *The Counter family*: Counter, Mirror Coat, Metal Burst, Comeuppance (M5, §3 Phase 4).
   - *Stats moved between Pokemon* (M8): Power Split, Guard Split, Power Trick, Transform, Imposter.
     Transform's user keeps its own max HP, yet the evidence pass sizes it by the forme it copied
     (`evidence.mjs:265` keys its stat table on `pokemon.species`).
   - *Illusion*, on either side.
2. **REBUILD-FAILED — the rebuild cannot reproduce the log.** Gyro Ball and Electro Ball (M3); a
   Toxic tick after the first; a Substitute broken or not; Thrash and Petal Dance's lock length;
   Beat Up; Effect Spore's choice of status; confusion self-hits.
3. **ERROR.** Fickle Beam: the evidence pass's dry run re-rolls the power boost and writes its
   `[anim]` tag into the real log.
4. **UNUSED and MASKED.** Confusion self-hits (above). Heals and chip that a battle's own hits
   already pin — Recover and its kind, Wish, Regenerator, Leftovers on the known side — are MASKED:
   the battle cannot say whether they are read.
5. **NOT SHOWN** — 132 effects no template made act, from Sleep Talk and Snore (weight 292, 251)
   down: each needs a battle set up by hand, or a written reason.

**Closed sheets** (`evidence-closed-sheets.md`).

- *`setsFromLog` reads wrong.* Rocky Helmet is put on the Pokemon it hurt when the holder is on
  the other side: the `[of]` holder is looked up on the side being read only. A Mega's ability is
  read into the base set when the base species can also have it (Speed Boost, Protean, Snow
  Warning).
- *It misses what a line names.* The ability a Pokemon had before Entrainment, Role Play, Skill
  Swap, Simple Beam, Worry Seed, Trace, Mummy or Wandering Spirit replaced it; the item Poltergeist
  names; the item Magician takes; abilities that announce themselves in `|cant|` or `-block`
  (Armor Tail, Queenly Majesty, Sweet Veil, Aroma Veil) or in `-start` (Flash Fire).
- *Silent sinks and hazards.* 131 abilities, 48 items and all 25 natures change the log before any
  line names them; today's assumptions then remove the real spread or break the rebuild for 42
  abilities (Huge Power, Hustle, Technician, Multiscale, Fluffy, Heatproof, Stall…), 63 item
  witnesses (Choice Scarf through order; the type-boosting items, Muscle Band, Wise Glasses, Light
  Ball, Iron Ball, Metronome through damage) and 28 nature witnesses. Where the rebuild fails with
  the true set too, the defect is the inference's and is left to the open list (`TRUE-SET-FAILS`).

---

## 6. Limits

- **The template has to make the effect act.** An effect no template made act is listed NOT
  SHOWN, and one that acted with no stat-dependent line is NO CHANNEL *in these battles*: a
  threshold is only probed at the HP the templates leave the hidden Pokemon on, and an effect that
  needs a setup no template gives it (a Berry to eat, a terrain, a sleeping user) needs one written
  by hand. The static scan flags handlers that read a stat no battle showed.
- **MASKED is not a verdict on the inference.** It means the battle's own lines already told the
  worlds apart, so the effect's line could not be seen being used or ignored.
- **One hidden Pokemon, one stat at a time**, at 0 and 32. A stat that only matters jointly with
  another, or away from the extremes, is not probed.
- **A diff shows that a stat can be observed, not how to use it.** Each new mechanism is still
  real work. What this plan changes is that the list is known before it starts.
- **Interactions between two effects** are not probed. They mostly come for free, because the
  hooks sit inside shared simulator code (Foul Play under Wonder Room needed no hook of its own).
  The probe finds missing hooks, not missing combinations.
- **Possible under the pinned simulator.** As in `engineering.md` §9, a server running different
  mechanics makes every row a statement about the wrong battle.
- **Cost.** The battles are fast — every move's, without the rebuilds, in 75 s on 13 threads.
  The rebuilds are not: a full run takes about an hour on 13 threads (moves 36 min, abilities 13,
  items 10, natures 1), and so does `--check`. `--kind` with `--out`, then `--records`, splits it.
