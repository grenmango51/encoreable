# Closed team sheets — the build plan

**For:** one agent, working alone, with no earlier conversation.
**Task:** infer the opponent's item, ability and nature, and its Stat Points under each, from a
replay with no team sheet, by elimination with the simulator deciding, the way `engineering.md`
§7.5 infers Stat Points from an open one; and prove it with battles built for the purpose.
**Read first:** `CLAUDE.md`, `engineering.md` §7.5–§7.6 and §9, `evidence-catalog.md` §4,
`evidence-closed-sheets.md` §0–§2, and `open-sheet-plan.md`, whose harness this plan uses.
**Starts after:** `open-sheet-plan.md` Phase 1 at the least, and ideally all of it: closed sheets
multiply every open-sheet gap by the number of sets a Pokemon could have.
**Done when:** every item in §7 holds.
**Verified against:** `pokemon-showdown` at `a5df827`, `scripts/lib/replay-source.mjs` and
`scripts/lib/inference/` as of 2026-10-03.

---

## 0. What changes

Today a replay with no team sheet is read by `setsFromLog` (`scripts/lib/replay-source.mjs`): what a
line names is read, and the rest is **assumed** — no item, the species' first ability, a neutral
nature. The inference then runs as if those were known. When an assumption is wrong, it can remove
the real spread, or every spread: the catalog finds 56 ability, 67 item and 28 nature witnesses where
it removes the real spread, and 11 more ability witnesses where the rebuild breaks
(`evidence-closed-sheets.md` §2.3), and on the Bo1 replay in `recordings/showdown/mine-closed/`
Gardevoir ends with nothing because it outsped a Charizard-Mega-Y that no neutral, itemless
Gardevoir can outspeed (`engineering.md` §7.6).

This plan replaces assumption with elimination:

> **A set — item, ability, nature — that could have produced the log is never removed, and neither is
> any spread under it.**

That is §7.5's rule with the set added to the unknown. Each Pokemon's unknown becomes a list of
candidate sets, each with its own surviving spreads. A candidate goes only when the simulator says
no spread under it could have produced the log.

### When a replay is closed

`gen9championsvgc2026regmc` (Bo1) has `Open Team Sheets` as an opt-in rule: each player is asked,
and if either declines, no `|showteam|` is printed. `gen9championsvgc2026regmcbo3` has
`Force Open Team Sheets`. So a closed replay is a Bo1 game where someone declined. The format's
`Flat Rules` include `Item Clause = 1`, so no two Pokemon on one team hold the same item, and
`Species Clause`.

### Scope

**In:** one side unknown (`--infer p2`), the uploader's view, Reg M-C; item, ability and nature,
and Stat Points under each.

**Out:** a ranking of the survivors (`plan.md` §10, usage priors): this plan says what is possible,
never what is likely. Also out: filling the moves the log never showed (a branch plays with the moves
seen), `--infer both`, and a stranger's replay.

---

## 1. Where it stands

| What | Today | Source |
|---|---|---|
| Names read | species, forme, moves used, an item or ability a line names | `setsFromLog` |
| Misread | Rocky Helmet put on the Pokemon it hurt; a Mega's ability put on the base set (Snow Warning, Speed Boost, Protean, Intimidate); a move named in an Armor Tail or Queenly Majesty `\|cant\|` read as the blocked Pokemon's; Illusion's moves on the disguise | `evidence-closed-sheets.md` §2.1 |
| Missed | the ability Entrainment, Role Play, Skill Swap, Simple Beam, Worry Seed, Trace, Mummy or Wandering Spirit replaced or showed; the item Poltergeist names or Magician takes; Armor Tail, Queenly Majesty, Aroma Veil, Sweet Veil, Flash Fire | §2.2 |
| Also wrong, found by the review | Covet's item; both items of a Trick; any item that moved and was named later; a Flung or stolen Berry; Symbiosis's item; Receiver's, Damp's and Flower Veil's lines; Prankster's `-hint`; a contact ability credited to the attacker | Appendix B §B.1 |
| Silent | 129 abilities, 47 items and every nature change the log before a line names them; the review adds the duration items (Light Clay, the weather rocks, Terrain Extender), Binding Band, Spell Tag, Acrobatics' no-item doubling and Choice Scarf's forced Struggle, which no witness reached | §2.4, Appendix B §B.2 |
| Hazard | the assumption removes the real spread in 56 ability, 67 item and 28 nature witnesses, and breaks the rebuild in 11 more ability witnesses; in every one the true set rebuilds | §2.3 |
| Inference | one fixed set per Pokemon; nature only in the first guess | `infer.mjs`, `knowledge.mjs` |

The by-hand review in `evidence-by-hand.md` also gives a Closed answer per effect. It was
checked the same way as the Open answers (`open-sheet-plan.md` §1); what survived is in Appendix B.

---

## 2. Rules

All of `open-sheet-plan.md` §2, and:

1. **The set is unknown like the spread.** No code path may pick an item, ability or nature and treat
   it as known unless a line named it or the rules force it. A default is a scaffold guess, never a
   fact.
2. **Elimination is per candidate, and by the simulator.** A candidate set goes when, with that set
   in the battle, the simulator produces a log that no surviving spread can make match. Never by a
   rule of ours such as "Choice Scarf multiplies Speed by 1.5".
3. **Unread costs precision, never soundness.** Where a candidate cannot be checked — a line its
   own shortcut cannot evaluate — it stays.

---

## 3. The design

### 3.1 The candidates

For each Pokemon on the unknown side:

| Box | Candidates at the start | Narrowed at once by |
|---|---|---|
| item | every item `TeamValidator` allows that species to hold, plus none | a line naming it (fixed); `Item Clause` (an item a teammate showed is out); a Mega Evolution (its Stone) |
| ability | the species' ability slots; after Mega Evolution, the Mega's | a line naming it (fixed); a species with one ability |
| nature | 21 classes: neutral, and the 20 (raised, lowered) pairs | nothing |
| Stat Points | every spread, under each surviving (item, ability, nature) | §7.5, per candidate |

The five neutral natures behave alike, so they are one class. Each other class is exactly one
nature, printed with its pair: `Timid (+Spe −Atk)`.

### 3.2 Which candidates matter in this battle

Most items and many abilities never act in a given battle. A candidate that changes nothing behaves
exactly like the one the scaffold has, and can be neither ruled in nor out. So, before any
inference:

- **Inert by its handlers, not by its log.** For each candidate item and ability, replay the battle
  with that candidate in the packed team and wrap every handler it has (`on…`, `condition`,
  `secondary`). The candidate is *inert in this battle* only if no handler of it fired with an
  effect: no `chainModify`, no changed return value, no line, no HP change, no state written.
  An identical log is **not** enough: at the scaffold's spread a Choice Scarf can leave the log
  unchanged because its holder outsped anyway, while under it many slower spreads also fit. Choice
  Scarf's Speed handler acts on every Speed taken, so it is always active; a Fire booster is inert
  only if no Fire move was used. When in doubt, active.
- An inert candidate joins the scaffold's class: it survives exactly when that class does (per
  nature class), and is reported as "not distinguishable here". Only the active candidates are
  evaluated on their own. Expect a handful per Pokemon.

Natures always change stats, but only the stats the evidence reads matter: two nature classes that
differ only in a stat no event of the battle read are one class for this battle.

### 3.3 Five kinds of evidence

| Kind | What it is | How it is evaluated | Example |
|---|---|---|---|
| **Named** | a line names the item or ability | `setsFromLog`, fixed to read the right box (Phase 1) | `[from] item: Leftovers` |
| **Would have named** | with the candidate in the battle, the simulator prints a line naming it that the replay does not have, or the replay names something it would have stopped | replay with the candidate; the first divergence is a naming line, and its presence does not depend on the spread (below) | no Leftovers heal at a turn's end while below 100%, so not Leftovers |
| **Illegal choice** | with the candidate, a choice the replay shows is refused | replay with the candidate; the simulator refuses the input log's choice | two different moves without a switch, so no Choice item |
| **Silent** | the candidate changes a damage, a speed, an HP amount, without naming itself | the evidence pass, with the candidate set during each dry run, per candidate spread | Muscle Band's hit is 1.1 times larger; Choice Scarf's Pokemon outspeeds |
| **Impossible die** | the replay shows an outcome that has no chance under the candidate | replay with the candidate: the dice search cannot produce the line, since a roll that always succeeds cannot be made to fail (`chanceEntry` in `reconstruct.mjs`) | a 100%-accurate move missed: Bright Powder, Sand Veil in sand, Snow Cloak in snow or Tangled Feet; Skill Link with fewer than five hits; a guaranteed crit absent: Battle Armor, Shell Armor |

**Dice under a candidate.** Some candidates throw dice of their own — Quick Claw every turn it is
held, King's Rock and Stench a flinch chance on each hit — and so shift every later die of a raw
replay. A replay with a candidate therefore goes through `reconstruct`'s dice handling: the
scaffold's pins, addressed by ordinal, handed over as `handOn` does, and re-searched from the turn
where the sequence of draws changes. A divergence is evidence against the candidate only when it
comes before any draw drifted and the line it is on depends on no die. Otherwise the candidate goes
through the search, and a search that fails is not proof — it has a budget — so the candidate stays.

**Spread dependence of a naming line.** Most naming triggers depend only on what the log already
shows: contact, a move type, a status, the weather, HP below full (a display under 100). Those
eliminate outright. A trigger at an HP threshold — Sitrus or Oran Berry at a half, Focus Sash at
full, Sturdy — depends on the exact HP, which depends on the spread. Those are evaluated per HP
candidate with the hooks §7.5 already has for them (`runEvent('Update')`, the `Damage` event), under
that candidate.

**Silent candidates in the dry runs.** The evidence pass already re-runs every hit, HP change and
speed sort per candidate spread, with the Pokemon's stored stats patched and restored
(`patchAll` in `evidence.mjs`). A candidate set is patched the same way: the item or ability field
and its state set for the dry run and restored after, the nature through the stat table
(`rec.stat`). Stateless modifiers — type boosters, Expert Belt, Muscle Band, Wise Glasses, Choice
Scarf's Speed, Iron Ball, Technician, Huge Power, Hustle, Thick Fat — patch exactly. A candidate
with state of its own (Metronome's count, a Choice lock, Unburden, a consumed item) is evaluated
by replaying with it instead, like a naming candidate, until a hook for its state is written; the
evidence pass sets its lines aside meanwhile.

**Every dry-run shortcut is checked** at the scaffold's own set and stats against the real
calculation, as for spreads (`engineering.md` §7.5). A disagreement sets the line aside.

### 3.4 Natures in the stat model

The knowledge model (`knowledge.mjs`) keeps a joint key of HP, Defence and Special Defence and flat
lists for Attack, Special Attack and Speed, each over Stat Points 0–32. A nature multiplies a stat,
so a candidate is a (nature class, spread) pair.

**Build it as one knowledge per nature class.** Each Pokemon's knowledge becomes a map from nature
class to today's structure. The evidence pass evaluates every class: its stat table is `rec.stat`
with that nature. A class whose knowledge empties is removed. Ranges are reported per class and
united. Most classes empty quickly — one hit taken pins a Defence, one hit dealt an Attack — so the
cost is many classes for a few events, then few.

A hit between two unknown Pokemon of the same side (a spread move on the ally) reads two natures at
once. Read it per pair of surviving classes, or set it aside; it is rare under `--infer p2`.

Only if this is too slow on the probe recordings (§5), fold the nature into the stat domains
instead: each non-HP stat takes the up to 99 distinct values `(base + SP + 20) × {0.9, 1, 1.1}` gives,
with one constraint across the five stats, like the 66-point budget: at most one raised and one
lowered, both or neither. Write down the measurement that justified the change.

### 3.5 Items and abilities in the knowledge

The candidates that §3.2 found active are a small list per Pokemon. Carry knowledge per
(item class, ability, nature class) that survives, but evaluate each box's candidates against the
other boxes' *union*: an item goes only when no ability and nature beside it survive with it. In
practice: start with nature classes × active items × active abilities, pruned by the named and
illegal-choice evidence first, which needs no spreads.

### 3.6 The scaffold

The rebuild still needs one set and one spread per Pokemon that reproduce the log. Pick the set for
the next round the way §7.5 picks a spread: from what survives, preferring a named box, then the
inert class, then the class with the most spreads. Mercifulbird's Gardevoir has no neutral itemless
spread; the scaffold must move to Choice Scarf or a `+Spe` class on its own.

### 3.7 What the inference reports

`inference.pokemon[i]` gains `sets`: per box, the surviving candidates; whether each item and
ability was named, eliminated by which event, or not distinguishable here; and per surviving
(item, ability, nature class) its spread count and ranges. `packKnowledge` packs each. The report
of `npm run reconstruct` prints, per Pokemon:

```
Gardevoir   item     Choice Scarf, with any nature that fits
                     none, or any item that did nothing in this battle: only with a +Spe nature
                     (with any other nature, ruled out on turn 1: Gardevoir acted before Charizard)
            nature   Timid (+Spe −Atk) · Hasty (+Spe −Def) · Jolly (+Spe −SpA) · Naive (+Spe −SpD);
                     the others only with Choice Scarf
            ability  as named, or the species' candidates not distinguishable here
            spreads  per surviving (item, nature): count and ranges
```

The extension's spread panel reads the union of the spreads until it has a set picker; that is
outside this plan.

---

## 4. The test battles

The same three tiers as `open-sheet-plan.md` §3, with the set withheld too.

### 4.1 Effect battles — the catalog's closed sheets

`npm run catalog` already plays every item, ability and nature on the hidden Pokemon through its
witnesses, reads each with `setsFromLog`, and rebuilds it under today's assumptions (HAZARD
verdicts). Phase 4 changes that rebuild to the closed inference, and the verdicts become:

| Verdict | Meaning |
|---|---|
| SOUND | the true set survives, and the true spread under it |
| PINNED | sound, and the box holds the truth alone |
| NARROWED | sound, and the box lost candidates through this witness |
| OPEN | sound, and the witness narrowed nothing in the box |
| UNSOUND | the true set or its spread was removed — a defect, first on the work list |
| REBUILD-FAILED | no set and spread reproduced the log |

The report's work list becomes UNSOUND first, then silent sinks that stay OPEN, by weight. Hand-set
closed battles go in `scripts/fixtures/catalog.js` as for open sheets; Appendix B lists them.

### 4.2 Probe recordings, read as closed — `recordings/local/probes/`

A flag on `npm run reconstruct`, `--sheets closed`, reads a local recording as a closed replay: the
unknown side's sets are read off the uploader's view by `setsFromLog`, and the truth stays in the
input log for the check. With `--all`, every local recording becomes a closed-sheet test with ground
truth: the 21 recordings, the eight probes from `open-sheet-plan.md` Phase 6, and the closed probes
below.

A recording passes when it is a MATCH, the true set of every unknown Pokemon survives with its true
spread, and every box the README row names is narrowed as far as written there.

### 4.3 Real replays — `recordings/showdown/mine-closed/`

The Bo1 replay already there (Reg M-B), and from the user, as they find time:

- **Six Bo1 Reg M-C games** (`gen9championsvgc2026regmc`) where Open Team Sheets was declined — the
  user can decline it themselves — against six different opponents, with their own teams as export
  text in `scripts/fixtures/teams.js`;
- **one or two closed games against a friend who shares the complete set** — item, ability, nature
  and Stat Points — filed in `showdown/full-sheets/` (`recordings/README.md`: both complete sheets
  win over what the replay shows). These are the only real closed replays with a truth to check.

As links or battle-room downloads, as for open sheets. A closed replay without a shared sheet has no
truth for the opponent, so it passes when it is a MATCH, nothing is emptied, and `--certify` proves
at least one witness per surviving item and ability; a shared one must also keep the true set and
spread.

---

## 5. Phases

### Phase 0 — The flag

`--sheets closed` on `npm run reconstruct` (§4.2), with today's assumptions still in place, and a
report line per box: read, assumed, or (later) inferred, against the truth.

**Done when:** `npm run reconstruct -- --all --rung s3 --infer p2 --sheets closed` runs and lists
every recording whose real spread today's assumptions remove. That list is the baseline.

### Phase 1 — Read every name right

Fix `setsFromLog` for every line in Appendix B §B.1, which includes `evidence-closed-sheets.md`
§2.1–§2.2. Two changes carry most of it:

- **What a Pokemon brought, not what it holds.** Follow every item that moves — Trick, Switcheroo,
  Thief, Covet, Magician, Pickpocket, Symbiosis, Fling, Bug Bite, Pluck — so that a line naming an
  item is credited to the Pokemon that brought it to the battle. An ability that moves (Skill Swap,
  Role Play, Entrainment, Simple Beam, Worry Seed, Trace, Mummy, Wandering Spirit, Receiver) is
  followed the same way.
- **Who a line is about.** `[of]` names the holder for Rocky Helmet, the retaliation Berries and the
  contact abilities, on either side; `|cant|…|ability: X|Move|[of] Y` and `-block` name the blocker's
  ability and Y's move; an ability seen after Mega Evolution is the Mega's.

Each line shape in §B.1 becomes a case in a closed effect battle (§4.1), so the catalog's READ, MISSED
and MISREAD verdicts cover it.

**Done when:** `evidence-closed-sheets.md` §2.1 and §2.2 are empty after a catalog run, Appendix B
§B.1 is read, and Phase 0's baseline has not grown.

### Phase 2 — Candidates, named and illegal-choice evidence

Make the unknown side's sets candidate lists (§3.1), with the equivalence replay (§3.2) and the
three kinds of evidence that need no spread: would-have-named for triggers that do not depend on HP,
illegal choices, and impossible dice (Appendix B §B.2). `Item Clause`. Spreads are still inferred
under one set: the scaffold's. `--certify` also rebuilds once per surviving item and ability that
acted in the battle, so each has a witness, and `--outside` once per eliminated one, which must not
reproduce the log.

**Done when:** for every recording under `--sheets closed`, the true item and ability are among the
candidates left, the report shows each eliminated candidate with the turn that removed it, and no
`--outside` rebuild of an eliminated candidate reproduces its log.

### Phase 3 — Natures

Per-class knowledge (§3.4) through `knowledge.mjs`, `evidence.mjs` and `infer.mjs`; the scaffold
picks its nature from the survivors (§3.6). The 66-point budget, ties, `--all-spent`, `--certify`
and `--outside` all work per class.

**Done when:** under `--sheets closed`, every recording keeps its true nature and its true spread
under it; on open sheets nothing changes (one class, the known nature); Mercifulbird's Gardevoir
keeps the `+Spe` classes; the time per recording is written down beside today's.

### Phase 4 — Silent items and abilities

Each active candidate (§3.2) evaluated in the dry runs (§3.3), class by class from Appendix B §B.2,
heaviest first: the Choice Scarf and Iron Ball through order; the type boosters, Expert Belt, Muscle
Band, Wise Glasses, Metronome, Light Ball, Big Root through amounts; then the abilities
(Technician, Hustle, Huge Power, Pure Power, Tough Claws, Thick Fat, Heatproof, Fluffy, Multiscale,
Fur Coat, Stall, the "-ate" abilities, Guts, Magic Guard, Prankster, Steely Spirit, Supreme
Overlord, Slush Rush and the other weather Speed abilities). The catalog's closed rebuild switches to
the closed inference (§4.1).

**Done when:** `evidence-closed-sheets.md` has no UNSOUND and no REBUILD-FAILED; every HAZARD row of
today's report is SOUND; Mercifulbird's Gardevoir keeps Choice Scarf and the `+Spe` classes and
loses what its turns rule out.

### Phase 5 — Thresholds and stateful candidates

Would-have-named for HP-threshold triggers, per HP candidate under the candidate set (Berries, Focus
Sash, Sturdy, Ripen doubling a Berry, Cheek Pouch healing on one). Then the candidates §3.3 left to
replay because they carry state: Metronome, Choice items' lock, Unburden, consumed items, Harvest,
Cud Chew. Each either gets a dry-run hook or stays evaluated by replay.

**Done when:** each class in Appendix B §B.2 has a hand-set battle that is SOUND and NARROWED.

### Phase 6 — Closed probe recordings

Build these like `open-sheet-plan.md` §3.2, p2 hidden, with sets chosen to be silent and to collide
with the assumptions:

| # | Name in the README | What it tests |
|---|---|---|
| 1 | silent boosters | a type booster, Expert Belt, Muscle Band and Technician on attackers whose moves never name them; the inference must keep them and drop "no item" where the damage rules it out |
| 2 | speed sets | Choice Scarf, Iron Ball, `+Spe` and `−Spe` natures, Prankster, a weather Speed ability, Trick Room; Mercifulbird's Gardevoir rebuilt on purpose |
| 3 | names everywhere | Rocky Helmet across sides, a Mega with an ability its base can have, Trace, Skill Swap, Entrainment, Poltergeist, Magician, Armor Tail, Illusion |
| 4 | would have named | a Pokemon below full HP for many turns with no Leftovers line, a contact hit with no Rocky Helmet, a Berry that should have fired and did not, two different moves without a switch |
| 5 | natures only | four Pokemon with the same item, ability and spread pattern and four different natures, each hit and racing enough that its class is pinned |
| 6 | a real Bo1 | ten turns of ordinary play with common Reg M-C sets |

**Done when:** all six pass §4.2, and the eight open probes and 21 recordings pass it too.

### Phase 7 — Real replays and the write-up

Run every `mine-closed` replay (§4.3). Then update `engineering.md` §7.6 (how a set is inferred) and
§9, `evidence-catalog.md` §3 Phase 5 and §5, `recordings/local/probes/README.md`, the README's
command table for `--sheets closed`, and regenerate both reports.

**Done when:** every replay passes §4.3, and the documents describe the code as built.

---

## 6. Files

| File | Change | `CLAUDE.md` row |
|---|---|---|
| `scripts/local-reconstruct.mjs` | Phase 0: `--sheets closed`; the report of sets | existing command |
| `scripts/lib/replay-source.mjs` | Phase 1: `setsFromLog`; Phase 2: candidate lists | existing machinery |
| `scripts/lib/reconstruct.mjs` | Phase 2: replay with a candidate set; equivalence | existing machinery |
| `scripts/lib/inference/*.mjs` | Phases 2–5 | existing machinery |
| `scripts/local-catalog.mjs` | Phase 4: closed verdicts from the closed inference | existing command |
| `scripts/fixtures/catalog.js` | Phases 4–5: hand-set closed battles | existing fixture |
| `scripts/fixtures/teams.js` | Phase 7: the user's teams | existing fixture |
| `recordings/local/probes/<battleid>.log.json`, its `README.md` | Phase 6 | battle our local server recorded |
| `recordings/showdown/mine-closed/` | Phase 7: replays the user gives | replay page saved from play.pokemonshowdown.com |
| `extension/src/…` | only if a change above breaks `npm run extension -- --check` | existing extension code |
| documents and reports | Phase 7 | existing |

No new file outside these. If one seems needed, ask the user for it by name first.

---

## 7. Done when

1. `npm run reconstruct -- --all --rung s3 --infer p2 --sheets closed` is a MATCH on every recording,
   and every unknown Pokemon keeps its true item, ability, nature, and its true spread under them.
2. The same without `--sheets closed` is unchanged from `open-sheet-plan.md` §6.
3. `evidence-closed-sheets.md` has nothing MISREAD, FALSE, MISSED, UNSOUND or REBUILD-FAILED; every
   silent class has a hand-set battle that is NARROWED.
4. Every `mine-closed` replay passes §4.3, Mercifulbird's among them.
5. `npm run catalog -- --check` and `npm run extension -- --check` pass, and the documents match.

---

## Appendix B — the closed-sheet evidence to read

Built from the catalog's closed report and the by-hand review, each claim checked against the
simulator source, and every line shape below printed by a battle and fed to the real `setsFromLog`.

### B.1 Names `setsFromLog` reads wrong or misses

Phase 1 fixes all of these. "Today" is what `setsFromLog` does now.

| Line | Names | Today |
|---|---|---|
| `\|-damage\|X\|…\|[from] item: Rocky Helmet\|[of] Y` (and the retaliation Berries) | Y's item, Y on either side | looked up on the side being read only: the item goes to X |
| `\|-ability\|X\|A\|…` after `-mega` / `\|detailschange\|` | the Mega's ability (each Mega forme has one, so it is known on Mega Evolution) | read into the base set when the base species can have it: Abomasite (Snow Warning), Blazikenite (Speed Boost), Greninjite (Protean), Scraftinite (Intimidate) |
| `\|cant\|X\|ability: A\|Move\|[of] Y` — Armor Tail, Queenly Majesty, Damp | X's ability, Y's move | ability missed, move written into X's moves |
| `\|-block\|X\|ability: A\|[of] H` — Aroma Veil, Sweet Veil, Flower Veil | H's ability | missed |
| `\|-start\|X\|ability: Flash Fire` | X's ability | missed |
| `\|-ability\|X\|New\|Old\|[from] move: Entrainment\|Role Play\|Simple Beam\|Worry Seed\|[of] Y` | X had Old; for Entrainment and Role Play, Y has New | missed |
| `\|-activate\|X\|Skill Swap\|A\|B\|[of] Y` | X had B, Y had A (between allies the abilities are left blank: nothing to read) | missed |
| `\|-ability\|X\|A\|Trace\|[from] ability: Trace\|[of] Y` | Y's ability is A | missed (X's Trace is read) |
| `\|-activate\|X\|ability: Mummy\|Y\|[ability] A`, Wandering Spirit's `Skill Swap` line | Y's ability | missed |
| `\|-activate\|X\|ability: Receiver\|A` | the fainted ally's ability | missed |
| `\|-activate\|X\|move: Poltergeist\|Item` | X's item | missed (only `item: `-prefixed `-activate` is read) |
| `\|-item\|X\|Item\|[from] ability: Magician\|[of] Y` | Y's item | missed |
| `\|-item\|U\|Item\|[from] move: Covet\|[of] T` — Covet prints no `-enditem` | T's item | missed |
| `\|-item\|T\|I\|[from] move: Trick` and `\|-item\|U\|J\|[from] move: Trick` (both held; Switcheroo alike) | U brought I, T brought J | both skipped on purpose; neither box is read |
| any `-enditem` or `[from] item:` naming an item a Trick, Switcheroo, Thief or Covet moved | the item's original holder brought it | credited to the new holder (Trick then Knock Off: verified wrong) |
| `\|-heal\|T\|…\|[from] item: Sitrus Berry\|[of] F` after Fling | F's item | the target gets the flinger's Berry |
| `\|-heal\|U\|…\|[from] item: Oran Berry` after `-enditem\|T\|…\|[from] stealeat` (Bug Bite, Pluck) | T's item | the user gets the stolen Berry |
| `\|-activate\|H\|ability: Symbiosis\|Item\|[of] A` | H's item | ability read, item missed |
| `[from] ability:` of a contact ability (Cursed Body, Cute Charm, Flame Body, Poison Point, Static; Poison Touch the other way) | the holder named in `[of]` | falls back to the line's subject, which is the attacker, when the attacker's species can also have it |
| `\|-hint\|Since gen 7, Dark is immune to Prankster moves.` after `-immune` | the user's Prankster | `-hint` is never read |
| a move used through Illusion | the Illusion user's move | written into the disguise's moves (`unmaskIllusion` exists; use it for moves too) |

### B.2 Silent effects — the candidate classes

Each class is one way a candidate changes the log without naming itself. Phase 4 evaluates them in
the dry runs; Phase 5 the ones with state. Weight order inside each row is by legal holders.

| Class | Members (Reg M-C legal) | What changes |
|---|---|---|
| attacker × type | Black Belt, Black Glasses, Charcoal, Dragon Fang, Fairy Feather, Hard Stone, Magnet, Metal Coat, Miracle Seed, Mystic Water, Never-Melt Ice, Poison Barb, Sharp Beak, Silk Scarf, Silver Powder, Soft Sand, Spell Tag, Twisted Spoon; Steely Spirit (an ally's Steel); Pixilate, Refrigerate, and through Mega Stones Aerilate and Dragonize | damage of moves of one type |
| attacker × category | Muscle Band, Wise Glasses, Light Ball (Pikachu), Huge Power, Pure Power, Hustle, Guts when statused, Plus and Minus beside a partner with either | damage of physical or special moves |
| attacker × move property | Technician (power ≤ 60), Iron Fist, Strong Jaw, Sharpness, Mega Launcher, Reckless, Tough Claws, Punk Rock, Liquid Voice, Sheer Force, Adaptability (STAB), Analytic (moving last), Stakeout (target just switched in), Sniper (on a crit), Sand Force (in sand), Supreme Overlord (fainted allies), Rivalry (gender), Blaze, Torrent, Overgrow and Swarm (at a third of max HP), Expert Belt (super-effective), Metronome (the same move again: state) | damage of the moves the property names |
| defender | Thick Fat, Heatproof, Water Bubble, Purifying Salt, Dry Skin (Fire), Fluffy, Multiscale, Fur Coat, Filter, Solid Rock, Friend Guard (on the ally), Grass Pelt, Marvel Scale, Unaware, Punk Rock (sound taken) | damage taken |
| weight and screens | Heavy Metal, Light Metal (Heavy Slam, Heat Crash, Low Kick, Grass Knot); Infiltrator (screens, Substitute) | damage of those moves |
| move needs an item, or none | Acrobatics doubles with no item; Knock Off ×1.5 on a removable item; Thief or Covet that steals nothing (the user holds one); Fling, Poltergeist, Trick, Stuff Cheeks, Teatime, Belch, Recycle that fail | damage, or a line present or absent |
| speed and priority | Choice Scarf, Iron Ball; Swift Swim, Chlorophyll, Sand Rush, Slush Rush, Surge Surfer, Quick Feet, Unburden; Prankster, Gale Wings (Flying at full HP), Stall; every nature | order |
| Choice lock | Choice Scarf, the only Choice item in the pool | two different moves with no switch rule it out; after Taunt, Disable, Torment or Gigaton Hammer a forced Struggle with other moves left rules it in. Void under Magic Room or Klutz |
| HP amounts | Big Root (drain ×1.3), Binding Band (trap damage a sixth, not an eighth), Mega Launcher's Heal Pulse (three quarters), Ripen (a Berry doubled), Cheek Pouch | heal and damage lines |
| duration | Damp Rock, Heat Rock, Smooth Rock, Icy Rock, Light Clay, Terrain Extender | the weather, screen or terrain ends on its eighth turn, not its fifth |
| a line absent or present | Magic Guard (no indirect damage), Rock Head (no recoil), Shield Dust and Sheer Force (no secondary), Inner Focus (no flinch), Clear Body, White Smoke, Hyper Cutter, Big Pecks (no drop; most also name themselves), Contrary (the sign flips), Corrosion (poison on Poison and Steel), Long Reach (no contact effect), Stalwart and Overcoat (not redirected), Overcoat and Sand Rush (no sand damage), Run Away and Shed Shell (a switch while trapped), King's Rock and Stench (a flinch from a move without one), Scrappy (a Normal or Fighting hit on a Ghost), Levitate and Iron Ball (grounding: hazards, terrain moves, Smack Down's line, Rising Voltage's hint), Early Bird, Poison Heal | the line |
| impossible die | Bright Powder, Sand Veil, Snow Cloak, Tangled Feet (a 100%-accurate move missed); Battle Armor, Shell Armor (a guaranteed crit absent, Frost Breath, Storm Throw, Flower Trick); Skill Link (fewer than five hits rules it out); Merciless (no crit on a poisoned target rules it out); No Guard (a miss rules it out) | the rebuild has no die for the line under the wrong candidate |
| nature | 21 classes | every stat read: hits, order, Strength Sap's heal, Foul Play, Body Press, Psyshock, Gyro Ball, Electro Ball, Shell Side Arm's category, the stats Power Split, Guard Split, Speed Swap and Power Trick move |

**Never distinguishable by one replay:** Klutz (behaves as "no item" until Fling fails), Magma Armor,
Super Luck, Scope Lens, Leek, Wide Lens, Zoom Lens — each only moves a chance. They stay candidates,
reported as "not distinguishable here"; a die that rules one out (above) still does.

**Not a candidate at all:** Battle Bond (Greninja-Bond does not exist in Gen 9) and Gluttony (no
Berry it acts on is in the pool: the only HP Berries are Sitrus and Oran).

### B.3 The closed effect battles to write

One hand-set battle per class of §B.2, in `scripts/fixtures/catalog.js`, with the effect on the hidden
Pokemon and its control without it, as the catalog's closed witnesses are built. Each must come out
SOUND and NARROWED in Phase 4–5. The heaviest first:

1. Choice Scarf: a race the neutral, itemless holder loses and the scarfed one wins (the
   Mercifulbird shape); and a Taunt that forces Struggle.
2. A type booster: a hit of its type whose damage no itemless spread reaches.
3. Muscle Band and Wise Glasses: a hit of each category.
4. Iron Ball: a race the holder loses that no spread loses, and a Spikes switch-in on a Flying holder.
5. Light Clay, a weather rock, Terrain Extender: the condition running past turn 5.
6. Binding Band: two turns of Fire Spin on a hidden Pokemon.
7. Big Root: a Giga Drain.
8. Acrobatics with and without an item.
9. Covet, Thief, Trick and Switcheroo with items on both sides, then Knock Off on the new holder.
10. A 100%-accurate move missing a Bright Powder holder; Frost Breath on a Shell Armor holder.
11. Technician, Iron Fist, Strong Jaw, Sharpness, Tough Claws, Reckless, Sheer Force on a holder
    whose species has another ability first.
12. Thick Fat, Heatproof, Fluffy, Multiscale, Fur Coat, Filter, Friend Guard on the defending side.
13. Heavy Metal and Light Metal under Heavy Slam and Low Kick.
14. Each nature class against a battle that reads all five stats: two hits dealt, two taken, a race.

### B.4 What the review named that cannot happen in Reg M-C

The review cites these, but none of them is in the legal pool. Ignore any claim built on them.

- **Abilities:** Iron Barbs, Full Metal Body, Well-Baked Body, Storm Drain, Dazzling, Dancer, Wind
  Rider, Triage, Pastel Veil, Galvanize, Comatose, Quark Drive, Wind Power, Desolate Land,
  Protosynthesis, Propeller Tail, Water Compaction, Truant, Wonder Guard, Commander, Persistent,
  Water Veil, Serene Grace, Gulp Missile, Lingering Aroma, Toxic Boost, Ice Scales, Hadron Engine,
  Neutralizing Gas, Ice Face, Multitype, RKS System, Flare Boost, Download, Beast Boost. Simple is
  not brought but is given by Simple Beam. Aerilate and Unseen Fist are reachable, through Pinsirite,
  Salamencite and Golurkite.
- **Items:** Covert Cloak, Clear Amulet, Protective Pads, Punching Glove, Throat Spray, Power Herb,
  Loaded Dice, Safety Goggles, Grip Claw, Booster Energy, Float Stone, Heavy-Duty Boots, Choice Band,
  Choice Specs, Flame Orb, Toxic Orb, Razor Claw, Eject Pack, Griseous Orb, Destiny Knot, Ability
  Shield, Macho Brace, Weakness Policy, Absorb Bulb, Mirror Herb, Metal Powder, Quick Powder, Room
  Service, Utility Umbrella, Assault Vest, and every pinch Berry but Sitrus and Oran.
- **Moves:** Snatch, Heal Block, Crafty Shield, Silk Trap, Telekinesis, Embargo, Jump Kick, Obstruct,
  Hyperspace Hole, Natural Gift, Incinerate, Thousand Arrows.
- **Also wrong in the review:** this format has no hail; Sand Attack and Smokescreen are `Past`;
  Anger Point prints `-setboost`; Contrary prints no ability line.
