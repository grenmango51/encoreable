# Evidence catalog — every effect that can reveal a hidden stat, found before a replay does

**Read first:** `engineering.md` §7.5 (Stat Points by elimination), §7.6 (closed team sheets),
§9 (open tasks).
**Status:** plan, not started.
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

What is built, what is known to be missing, and what nobody has checked yet. "Unverified" means
a search of `scripts/lib/inference/` found no special handling. A generic hook may already cover
it, and Phase 3 settles that.

| # | Mechanism | Sink | Hook today | Status |
|---|---|---|---|---|
| M1 | damage taken | hidden % line | `actions.getDamage` rows per (attacking stat, defending stat) | built |
| M2 | damage dealt | known exact line | the same rows, attacker side | built |
| M3 | a hidden stat read inside a damage calculation, other than the attack/defence pair | either HP line | `analyseHit` sees the read and marks the hit `supported: false`, and `onChange` then treats it as "HP went down" (`band('down')`) | **gap**: seen, then thrown away |
| M4 | an HP change that is a fraction of max HP (chip, heal, weather, status) | hidden % line | `effectChange`, fractions scaled only when the amount proves them | built |
| M5 | a hidden amount carried over to an exact line | known exact line | recoil, drain, Leech Seed, Shell Bell, Pain Split, Strength Sap | built; Counter family, Final Gambit, Wish, Endeavor, Liquid Ooze unverified |
| M6 | an HP threshold crossed or not | a line present or absent | pinch Berries (`runEvent('Update')`), Focus Sash, Sturdy, Endure (`Damage` event) | built; Substitute breaking, Berserk, Emergency Exit unverified |
| M7 | order | order of lines | `speed.mjs`, every sort by speed | built |
| M8 | a stat moved between Pokemon | later damage and HP lines | none | unverified: Power Split, Guard Split, Speed Swap, Transform, Imposter |
| M9 | a stat named or compared in a message | what a line names | none | only Shell Side Arm has a legal user |

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

The first items are already known:

1. **M3, Speed inside a damage calculation.** Gyro Ball and Electro Ball read Speed in
   `basePowerCallback`. Add Speed as a third dimension of the hit's rows, a flat domain memoised
   like Attack, and accept that read in `analyseHit`'s `supported` test. Then extend the same
   dimension to any other stat the reads observer catches.
2. **M5, the Counter family.** Counter, Mirror Coat, Metal Burst and Comeuppance return a
   multiple of the damage the user just took. When the hidden Pokemon returns it onto a known
   one, the exact line gives that damage exactly.
3. **M5, Wish.** It heals half its user's max HP into a slot. Landing on a known Pokemon, it
   gives the hidden user's HP stat almost outright.
4. **M6, Substitute and Emergency Exit.** Whether a hit breaks a hidden Pokemon's Substitute
   ties the damage to a quarter of its max HP. Whether a hidden Golisopod switches out ties it
   to half.

### Phase 5 — Closed team sheets

Run the same probe with item, ability and nature varied instead of Stat Points, over the Phase 1
pool. The rows say which unknown each effect reveals and through which sink. That replaces the
hand-written candidate list in `engineering.md` §9 (closed sheets). The cost of carrying those
unknowns in `knowledge.mjs` (21 natures, items as a dimension) is decided there. The catalog only
says which candidates are worth a dimension at all.

---

## 4. Files this plan would add

`CLAUDE.md` applies at execution time: **ask for each new file by name, one at a time.
Approving this plan does not count.** The rows below are where the table would put each one. They
are not permission to create them.

| What | Where the table would put it | Open question |
|---|---|---|
| the probe and coverage run | `scripts/local-<name>.mjs` + one `package.json` script + `<name>.bat`, or a flag on `npm run reconstruct` | new command or flag: a new command that is a variant of an existing one is a flag |
| template building, perturbing, diffing | inside that command, or `scripts/lib/inference/<name>.mjs` if a second command shares it | shared or not |
| probe battles worth keeping as tests | `recordings/local/probes/<battleid>.log.json` | which ones, since the rest can be regenerated |
| the coverage summary | §5 of this file | — |
| Phase 0 scripts | the session scratchpad, deleted afterwards | — |

---

## 5. Coverage

Not run yet. Phase 3 fills this in.

| Mechanism | Effects probed | USED | UNUSED | UNSOUND |
|---|---|---|---|---|

---

## 6. Limits

- **The template has to make the effect fire.** The static scan catches effects that did not,
  but an effect whose template is wrong and whose source reads nothing obvious can still slip
  through.
- **A diff shows that a stat can be observed, not how to use it.** Each new mechanism is still
  real work. What this plan changes is that the list is known before it starts.
- **Interactions between two effects** are not probed. They mostly come for free, because the
  hooks sit inside shared simulator code (Foul Play under Wonder Room needed no hook of its own).
  The probe finds missing hooks, not missing combinations.
- **Possible under the pinned simulator.** As in `engineering.md` §9, a server running different
  mechanics makes every row a statement about the wrong battle.
- **Cost, estimated rather than measured:** about 500 moves × 2 roles × about 13 perturbations ×
  about 30 ms per battle comes to minutes on one thread, before abilities, items and templates
  set up by hand.
