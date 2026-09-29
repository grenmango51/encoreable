# Evidence catalog, every effect: swarm execution plan

**For:** the agent that runs the swarm (the *orchestrator*), and the agents it starts. Assume no
earlier conversation.
**Carries out:** `docs/evidence-catalog.md` Phases 0, 1, 2, 3 and 5, for every effect Reg M-C
allows: every move, ability, item, condition and nature.
**Produces:** one new command (`npm run catalog`), one fixture of hand-set templates, and two
generated reports, `docs/evidence-open-sheets.md` and `docs/evidence-closed-sheets.md`.
`npm run catalog -- --check` then holds the code to those reports.
**Does not:** fix anything the reports find. That is Phase 4, and the reports are its work list.
**Verified against:** repo commit `72d2f03` (branch `chrome-extension`), `pokemon-showdown`
`a5df827`, on 2026-09-29.

---

## 0. Read first

| What | Why |
|---|---|
| `CLAUDE.md` (repo root) | Where files go. Each new file needs the user's approval by name, one at a time. |
| `docs/evidence-catalog.md`, all of it | This plan carries it out. Its rules do not change. This plan only adds the mechanics. |
| `docs/engineering.md` §2.1, §2.2, §4, §6.2, §7.5, §7.6, §9 | Format IDs, the stat model, RNG control, protocol hygiene, the inference, closed sheets, open tasks. |
| `scripts/lib/inference/infer.mjs`, `evidence.mjs`, `speed.mjs`, `knowledge.mjs` | What the evidence pass hooks today, and what an event looks like. |
| `scripts/lib/replay-source.mjs` `setsFromLog` | How a closed sheet's boxes are filled from the log today. |
| `scripts/lib/rng-control.mjs`, header of `scripts/server/rng-command.js` | How dice are fixed: by rule (`>rng force …`) or by ordinal (`>rng at n=v`). |

Terms used below:

| Term | Meaning |
|---|---|
| **effect** | One move, ability, item, condition or nature in the pool. Its id is `<kind>:<id>`, for example `move:gyroball`. |
| **role** | Who is hidden. For a move: `user-hidden` or `target-hidden`. For an ability or item: `holder-hidden` or `other-hidden`. |
| **subject** | The hidden Pokemon whose unknowns a probe varies. Always `p2a`. |
| **box** | Open sheets: one of the six Stat Point boxes (HP, Atk, Def, SpA, SpD, Spe). Closed sheets: the move, item, ability or nature box of one named Pokemon. |
| **sink** | Where a hidden value reaches the log (catalog §1): `hidden %`, `known exact`, `order`, `presence`, `names`. |
| **mechanism** | M1–M9 (catalog §2), plus M10 and up if the swarm finds new ones. |
| **template** | One battle recipe: two teams, the subject, each turn's choices, and the dice. |
| **control** | The same template with the effect taken out. |
| **witness** | A fixed closed-sheet template that shows whether an item, ability or nature changes the log (§4.5). |
| **row** | One observed change: effect, role, stat (or unknown), sink, and the line. |
| **card** | One effect's entry in a report. |
| **shard** | One tenth of the pool, owned by one agent in Wave 1. |
| `SWARM_DIR` | A folder in the orchestrator's session scratchpad, passed to every agent as an absolute path. |

---

## 1. The question each report answers

**Open team sheets** (`docs/evidence-open-sheets.md`). A Bo3 replay's `|showteam|` lines publish
everything except Stat Points, nicknames and shininess (engineering §7.5). So a Pokemon's only
unknown is its six Stat Point boxes. For every effect and every role, the report answers:

- Which boxes can reach the log?
- Through which sink, and by which mechanism?
- Does the evidence pass use it?

**Closed team sheets** (`docs/evidence-closed-sheets.md`). A Bo1 replay publishes no sheet
(engineering §7.6). The unknowns are item, ability, nature, any move not yet used, and Stat
Points. For every effect, the report answers:

- Which line names what?
- Which box does that name belong in, and for which Pokemon?
- Does `setsFromLog` put it there?
- What does the effect change in the log *before* any line names it? Those are the lines that
  today's assumptions (no item, first-listed ability, neutral nature) would misread.

---

## 2. Rules for every agent

1. **The simulator decides everything** (catalog §0). Every number in a report comes from a battle
   the simulator ran. None of our own damage, speed or HP arithmetic decides a verdict.
2. **CLAUDE.md.** A new repo file must be one of the five in §3.1, approved by the user by name,
   one file at a time, before it is written. Approving this plan does not count. Only the
   orchestrator asks. A shard agent never creates, edits or deletes a repo file.
3. **Inference behaviour does not change.** The only code change allowed in
   `scripts/lib/inference/` is §4.8's event tag. Afterwards,
   `npm run reconstruct -- --all --rung s3 --infer p2` must still give 21 MATCH, with 83 of 83
   real spreads surviving.
4. **Report findings; do not fix them.** This covers UNSOUND, UNUSED, MISREAD, MISSED, HAZARD and
   rebuild failures. Nobody changes `evidence.mjs`, `speed.mjs`, `knowledge.mjs`,
   `reconstruct.mjs` or `replay-source.mjs` beyond rule 3.
5. **Scratch goes in `SWARM_DIR`**, one subfolder per shard. It is deleted at the end of Wave 2.
6. **Use `--threads 1` for every shard run** while the ten shards run in parallel. This machine has
   14 hardware threads and 34 GB of RAM.
7. **Node is not on the PATH.** In PowerShell: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.
   In bash: `export PATH="/c/Program Files/nodejs:$PATH"`.
8. **Commit only if the user asks.** If they do, make one commit per wave.
9. **The repo is frozen during Wave 1.** Every shard reads the same code. A change mid-wave would
   make shards disagree.
10. **Spawned agents use the weakest model and effort that can do the job** (the user's global
    instruction). §7.1 gives a recommendation per wave.

---

## 3. Files

### 3.1 New files

Ask for each one **at the point it is first needed, by name, on its own, and wait for the
answer.** Ask in this order.

| # | Path | CLAUDE.md row | What it holds | Written in |
|---|---|---|---|---|
| 1 | `scripts/local-catalog.mjs` | Command a person runs | The whole pipeline in §4 | Wave 0 |
| 2 | `catalog.bat` | the same row | `@echo off` then `node scripts\local-catalog.mjs %*` | Wave 0 |
| 3 | `scripts/fixtures/catalog.js` | Team or format fixture loaded by Node (CommonJS) | Hand-set templates, written reasons, mechanism assignments and notes, keyed by effect id (§4.2) | Wave 0 creates its shape; Wave 2 fills it |
| 4 | `docs/evidence-open-sheets.md` | Document answering a question no document in `docs/` owns | The generated open-sheet report (§5.2) | Wave 2, by the command |
| 5 | `docs/evidence-closed-sheets.md` | the same row | The generated closed-sheet report (§5.3) | Wave 2, by the command |

Why none of these goes inside an existing file:

- **A command, not a flag on `reconstruct`.** It builds battles from nothing instead of
  rebuilding a source, and its output is a catalog, not an input log. This answers catalog §4's
  open question.
- **The machinery stays inside `local-catalog.mjs`**, because no second command uses it yet.
  When closed-sheet inference (engineering §9) needs the legal pool as its candidate set, the
  pool moves to `scripts/lib/inference/<name>.mjs`, with its own approval.
- **Two reports, not a section of the catalog.** At about 950 effects each, the cards are too big
  for `evidence-catalog.md`. They are also generated, not written by hand. Their summary goes in
  catalog §5.
- **No probe battles are kept** in `recordings/local/probes/`. Every template can be regenerated
  from `scripts/fixtures/catalog.js`. Keeping one would be a separate request per file.

If the user declines a file, fall back as follows:

| Declined | Fallback |
|---|---|
| 1 or 2 | A `--catalog` flag on `npm run reconstruct`, with the code inside `scripts/local-reconstruct.mjs`. |
| 3 | The hand-set entries become a constant inside `local-catalog.mjs`. |
| 4 or 5 | The reports stay in `SWARM_DIR`. Catalog §5 gets the summary and the work lists. |

### 3.2 Edits to existing files

| File | Edit | Wave |
|---|---|---|
| `package.json` | Add `"catalog": "node scripts/local-catalog.mjs"` | 0 |
| `scripts/lib/inference/evidence.mjs`, `speed.mjs` | The event tag (§4.8) | 0 |
| `docs/evidence-catalog.md` | Status line; §2's Status column from the run; §4 becomes the real file list; §5 gets the coverage summary; any new mechanism (M10+) is added to §2 | 2 |
| `docs/engineering.md` | §8: a command row and a file row. §9: both open-task lists point to the two reports as their work lists. | 2 |
| `README.md` | Command table row, a flags line, and two Documentation rows | 2 |

---

## 4. The command: `npm run catalog`

| Flag | What it does |
|---|---|
| *(none)* | Full run: every effect, both sheets. Writes the two reports. |
| `--list` | Prints the selected effects with kind, weight and shard, then exits. |
| `--pool` | Prints the pool counts next to catalog §2's, then exits. |
| `--shard k/n` | Only shard k of n (the rule is in §7.3). |
| `--only id[,id…]` | Only these effect ids. |
| `--kind move\|ability\|item\|condition\|nature` | Only that kind. |
| `--sheets open\|closed` | Only one of the two passes. Both run by default. |
| `--inputs <file>` | Repeatable. Loads a CommonJS file shaped like `scripts/fixtures/catalog.js`, after the fixture. Any id it names replaces the fixture's entry. |
| `--out <dir>` | Writes `records.json`, `open.md`, `closed.md` and `todo.md` there instead of `docs/`. |
| `--no-coverage` | Skips Phase 3. Use it while iterating on templates. |
| `--check` | Does a full run in memory and compares the result with the two committed reports. Exits 1 and names every card that differs. |
| `--threads n` | Same meaning as for `reconstruct`. |
| `--verbose` | Prints more detail. |

The stages run in this order: pool, templates, open-sheet probe, open-sheet coverage,
closed-sheet names/silence/hazard, records, render.

### 4.1 Pool (Phase 1)

Build the pool with the validator for `gen9championsvgc2026regmc` (`TeamValidator.get`), never
from `isNonstandard` alone (catalog Phase 1).

| Part | How it is built | Catalog §2 count |
|---|---|---|
| species | pass `checkSpecies` | 293 |
| abilities | the ability slots of those species | 203 |
| moves | `checkCanLearn` per species | 510 |
| items | pass validation on at least one legal holder | 166 |
| conditions | reached from the effects themselves (see below) | — |
| natures | all 25; 21 distinct effects (engineering §9); closed sheets only | — |

A scratch run on 2026-09-29 that called `checkSpecies` on every `dex.species.all()` entry got 390
species, 223 abilities and 529 moves. The catalog's filter excludes something that run kept,
probably formes that cannot be brought. Find the filter that gives 293, and write down what it
excludes.

**Conditions** come from each effect's data fields `weather`, `terrain`, `pseudoWeather`,
`sideCondition`, `slotCondition`, `status` and `volatileStatus`. They also come from handlers the
static scan (§4.3) finds calling `setWeather(`, `setTerrain(`, `addPseudoWeather(`,
`addSideCondition(`, `addSlotCondition(`, `trySetStatus(`, `setStatus(` or `addVolatile(`.

**Weight** (catalog Phase 1) is the learner or holder count, used until usage data arrives
(`plan.md` §10):

- An item's weight is the number of legal species that can hold it. That overweights generic
  items, and usage data will fix that.
- A condition's weight is the sum of the weights of the effects that create it.
- Every nature has weight 1.

**Ordering.** Effects are sorted by kind (move, ability, item, condition, nature), then by id.

**Done when** the counts match catalog §2 and every effect used in the 21 recordings and the two
Bo3 replays is in the pool. Any difference must be explained in one sentence, and catalog §2 gets
corrected in Wave 2.

### 4.2 Templates

**Auto template**, one per (effect, role):

- **Format:** `gen9championsdoublescustomgame`, level 50, the Champions stat model (catalog Phase
  2).
- **Sides:** p1 is known, p2 is hidden. The subject is `p2a`. Each side has an actor in slot a, a
  filler in slot b, and one bench Pokemon for effects that force or need a switch (Roar, U-turn,
  Eject Button, Emergency Exit).
- **Subject species**, chosen by a fixed rule so every run picks the same one:
  - for a move, a legal learner;
  - for an ability, a legal holder;
  - for an item, one fixed neutral holder, or the item's own species if it is locked to one.

  Prefer a species whose other abilities read no stat and print nothing on the probe's turns.
  Choose the species by that rule, not by picking one by eye.
- **Known actor:** one fixed, bulky species with a neutral ability and a fixed spread. The builder
  chooses it once and names it in the fixture header. It is chosen so a hit leaves it standing,
  with exact HP.
- **Fillers:** use an inert move. Splash is the first choice, if the Custom Game accepts it (it
  does not check learnsets). Probe the filler like any effect. Its own card must come out
  NO CHANNEL.
- **Roles:**
  - A move gets `user-hidden` (p2a uses it) and `target-hidden` (p1a uses it on p2a). A move that
    targets itself, its own side or the whole field gets only `user-hidden`.
  - An ability or item gets `holder-hidden` (p2a has it) and `other-hidden` (p1a has it and p2a is
    the Pokemon it acts on).
  - A condition is set by its setter's own template. Its roles are the Pokemon it touches.
- **Turns:**
  - T1 is the effect.
  - T2 and T3 are a witness exchange: p1a hits p2a, and p2a hits p1a. This lets a delayed or
    carried-over effect reach a line: Wish, Future Sight, Leech Seed, Substitute, a Berry, a
    status's end-of-turn damage.
  - The control (below) cancels the exchange's own dependence on stats.
- **Control:** the same template with the effect removed:
  - a move is replaced by the filler's inert move;
  - an item is replaced by no item;
  - an ability is replaced by the species' other slot, or by an inert ability;
  - a condition is never set.
- **Dice:** every draw is fixed through `>rng` (hit, no crit, one fixed damage roll, secondaries
  proc, speed ties to a fixed winner). Fix dice by rule, not by ordinal, because a perturbation
  can change how many draws a turn takes (a speed tie, a Berry). If a rule cannot express some
  draw, the template names the ordinal. The probe then checks that the draw sequence is the same
  under every perturbation. If it is not, the row is marked `dice-unstable` and not diffed.
- **HP levels:**
  - The catalog's HP levels are full, just below full, ≤ ½, ≤ ⅓, ≤ ¼, and near 1.
  - Reach them through real battle events on setup turns before T1. Examples: a known helper's
    Super Fang, False Swipe on a hit that would otherwise be lethal, or the subject paying its own
    cost (Substitute, Belly Drum).
  - Never set HP in-process. Phase 3 rebuilds the battle from its log, and a silent HP change
    cannot be rebuilt.
  - Exact fractions are not needed. What matters is being on each side of the thresholds that
    Berries, Sash, Sturdy, Multiscale and Water Spout read.
  - Only effects whose static scan reads current HP, or whose rows include M6, run at more than
    one HP level.

**Hand-set entries.** `scripts/fixtures/catalog.js`, and every shard's `inputs.cjs`, use this
shape:

```js
'use strict';

/**
 * Hand-set templates and written reasons for `npm run catalog`, keyed by effect id.
 * An effect with no entry gets the auto template. The known actor and the filler are named here.
 */
module.exports = {
  'move:counter': {
    templates: [{
      role: 'user-hidden',
      p1: [{ species: 'Snorlax', ability: 'Thick Fat', item: '', nature: 'Serious',
        evs: { hp: 20, atk: 10, def: 20, spa: 0, spd: 16, spe: 0 }, moves: ['Body Slam'] }, 'filler'],
      p2: [{ species: 'Hariyama', ability: 'Guts', item: '', nature: 'Serious', moves: ['Counter'] }, 'filler'],
      turns: [{ p1: 'move bodyslam 1, move splash', p2: 'move counter, move splash' }],
      dice: [['hit', 'nocrit', 'roll8', 'noproc']],
      hpLevels: false,
      why: 'Counter needs a physical hit taken first; the known actor gives it one.',
    }],
  },
  'move:<id>': { unfireable: 'Fails in doubles when … (data/moves.ts:1234)' },
  'ability:<id>': { noChannelReason: 'Reads maxhp only to … (data/abilities.ts:567)' },
  'move:<id>': { mechanism: { spe: 'M3' } },
  'item:<id>': { witnesses: ['W-contact'], note: 'One or two sentences for the card.' },
};
```

| Field | Use |
|---|---|
| `templates` | Replaces the auto template for the role(s) it names. The subject's `evs` are left out; the probe sets them. |
| `unfireable` | Why no template in this format can make the effect run, citing `file:line` in `node_modules/pokemon-showdown`. |
| `noChannelReason` | Why a stat the static scan found being read never reaches the log, with `file:line`. |
| `mechanism` | Overrides the per-stat mechanism: `'M1'`…`'M9'`, or `'M10: <one-line definition>'` for a new one. |
| `witnesses` | Extra closed-sheet witnesses (§4.5) to run for this effect. |
| `note` | Shown on the card, as written. |

The fixture's header comment documents this shape. The shard files are merged into it in Wave 2.

### 4.3 Open-sheet probe (Phase 2)

Run each template, and its control:

1. **Perturb the subject's spread.**
   - The base is 2 in every stat.
   - Each stat is then set to 0 and to 32, one at a time, with the rest at 2. That gives 13
     spreads. None totals more than 42, so every one is within the 66-point budget and can serve
     as a real spread in Phase 3.
   - The nature is neutral (Serious).
   - Some effects compare two stats: Shell Side Arm (catalog Phase 2), and anything the scan finds
     comparing two `getStat` or `storedStats` values. These also get a pairwise pass: each pair of
     stats at (0, 32) and at (32, 0).
2. **Run in-process** with `BattleStream` (no server). Read channel 1 (the known side) and
   channel 0 (spectator) with `extractChannelMessages` (`pokemon-showdown/dist/sim/battle.js`),
   filtered through `battleLines` (`scripts/lib/protocol.mjs`, engineering §6.2).
3. **Take a difference of differences.** For each stat s, a line counts only if it differs
   between s = 0 and s = 32 in the effect battle, and does not differ the same way in the control.
   Match lines by turn and by what printed them (the preceding `|move|`, or the `[from]` effect),
   not by index. That way one extra line does not shift every line after it.
4. **Record one row per change that survives:**
   - the effect, role and stat;
   - the sink and the turn;
   - the line at 0 and at 32 (channel 1);
   - how a spectator sees the same line: `same`, `as %` or `absent`;
   - the scan read that explains it, if there is one.
5. **Choose the sink:**

   | Sink | What changed |
   |---|---|
   | `hidden %` | an HP token on p2 |
   | `known exact` | an HP token on p1 |
   | `order` | the same lines came out in a different order |
   | `presence` | a line appeared or disappeared |
   | `names` | a line names a different stat, item or ability |

6. **Assign the mechanism by rule:**

   | Mechanism | Rule |
   |---|---|
   | M1 | `hidden %`, from a move hit's `-damage` on the subject; the stat is HP or the defence the hit uses |
   | M2 | `known exact`, from a move hit by the subject; the stat is the attacking stat the move uses (Body Press: the user's Def; Foul Play: the target's Atk) |
   | M3 | a move hit's damage line on either side, where the stat is neither of those, and is not HP read as the attacker's current HP |
   | M4 | `hidden %`, from a `-damage` or `-heal` with `[from]` (not a move hit) on the subject; the stat is HP |
   | M5 | `known exact`, an amount carried over from the subject: drain, recoil, Leech Seed, Shell Bell, or a move whose damage comes from damage taken or its user's HP |
   | M6 | `presence` |
   | M7 | `order` |
   | M8 | a later line changes after an effect the scan shows writing `storedStats`, calling `transformInto`, or swapping a stat |
   | M9 | `names` |
   | M? | none of the above. The shard agent assigns one, or proposes M10+ through `mechanism`. |

7. **Static scan** (catalog Phase 2). Stringify every handler of every pool effect with
   `fn.toString()`, on the merged `champions` data, so the mod's overrides are included.
   - It records **reads**: `maxhp`, `baseMaxhp`, `.hp`, `getStat(`, `storedStats`, `.speed`,
     `getActionSpeed`, `calculateStat`, `getHealth`, `boosts`.
   - It records **outputs**: `damage(`, `heal(`, `sethp(`, `boost(`, `add(`, `setStatus`,
     `addVolatile`, `setWeather`.
   - A read with no matching row puts `scan: reads X, no change seen` on the card, and the effect
     goes on `todo.md`.
8. **Test whether it fired.** The probe wraps the effect's handlers and counts the calls. The
   effect fired if at least one handler ran on the effect's turns and, for a move, the move did
   not fail (`-fail`, `-immune` or `-miss` naming it).
9. **Give each effect one outcome:**

   | Outcome | Meaning |
   |---|---|
   | CHANNEL | at least one row |
   | NO CHANNEL | it fired and no row survived; the card quotes the line that shows it fired |
   | UNFIREABLE | a written `unfireable` reason |
   | HAND-SET | the auto template did not fire. This is a working state. It is not allowed at the end. |

### 4.4 Open-sheet coverage (Phase 3)

Every (effect, role, stat) with a row has two worlds, s = 0 and s = 32, with the other stats at 2.
For each world:

1. Call `inferSpreads({ formatid, sets, known: [true, false], observed, channel: 1, threads })`.
   `observed` is that world's channel 1, and `sets` is both teams with p2's `evs` withheld. This
   is the `--infer p2` case, which is the project's scope (engineering §9).
2. If `complete` is false, the row is **REBUILD-FAILED**. The card records the turn and the
   observed and rebuilt lines from the reconstruction report. This is a reconstruction gap, not an
   evidence gap, and it has its own list.
3. Otherwise, if `contains(real)` is false in either world, the row is **UNSOUND**. The card
   lists the events that cut the subject (`inference.events`, where `cuts[].id` is `p2:0`).
4. Otherwise, compare the subject's `stats[s]` (`{ min, max, count }`) across the two worlds:
   - they differ: **USED**;
   - they are the same: **UNUSED**. The log tells 0 from 32, but inference does not.
5. **Used by:** the `what` of the events tagged with this effect (§4.8) that cut the subject. If
   the two worlds differ but no tagged event moved s, the column reads `whole paths` or `speed`,
   following the event that did.
6. **Work-list score** = weight × information. Information is 3 for `known exact`, 2 for
   `hidden %`, and 1 for `order`, `presence` or `names`. An exact amount is worth more than one
   inequality (catalog Phase 4).

**Cost (an estimate, not measured).** The synthetic battles in engineering §7.5 took 1–7 s each.
About 3,000 rows × 2 worlds comes to 3–6 hours on one thread. Split across ten shards at
`--threads 1`, that is 20–40 minutes each.

### 4.5 Closed-sheet probe (Phase 5)

This has three parts. All three reuse the §4.2 templates, and parts B and C add a fixed witness
battery.

**A. Names, for every effect.**

- Feed the effect battle's channel 0 to `setsFromLog(lines, 'p2', formatid)` and to
  `setsFromLog(lines, 'p1', formatid)`. Channel 0 is what a public Bo1 replay shows.
- Compare every box of every Pokemon with the template's truth.
- Run both placements, with the effect on the hidden side and on the known side, so a wrong
  attribution shows up in either direction.

| Verdict | Test |
|---|---|
| READ | a line names it, and the right Pokemon's right box holds the true value |
| MISSED | a line names it, and that box stays empty or assumed |
| MISREAD | a box holds a value that is not that Pokemon's: wrong Pokemon, wrong box, or an item it received by Trick instead of the one it brought |
| FALSE | a box is filled on a Pokemon the effect does not belong to: Rocky Helmet credited to the attacker, Volt Absorb to the attacker named in `[of]` |
| SILENT | no line names it |

"A line names X for Pokemon P" means some line contains both X's name and P's ident. That test is
string presence only. The truth of who holds X always comes from the template, never from our
reading of `[of]`.

**B. Silence, for items, abilities and natures.**

- For each one (call it X), run the witness battery with X on the subject, and again with the
  baseline: no item, the species' other ability (or an inert one), or a neutral nature.
- Diff channels 0 and 1.
- If a line changed and nothing in the battle names X, record a **SILENT-SINK** row: X, the
  witness, the sink and the line.
- If a line does name X, the row records that, and the first turn it happens.

| Witness | The subject… | Catches |
|---|---|---|
| `W-phys-dealt` | hits the known actor with a physical move | Atk modifiers, attacker-side contact effects |
| `W-spec-dealt` | hits it with a special move | SpA modifiers |
| `W-phys-taken` | is hit physically by the known actor | Def modifiers, contact punishers |
| `W-spec-taken` | is hit specially | SpD modifiers |
| `W-order` | acts in the same priority bracket as a known Pokemon of nearly equal Speed | Speed modifiers, priority changes |
| `W-residual` | ends a turn below half HP | end-of-turn heals and damage, pinch effects |
| `W-switch` | switches in | switch-in abilities and items |
| `W-status-used` | uses a status move | effects that forbid or change status moves |
| `W-status-taken` | is targeted by burn, paralysis or Taunt | immunities, curing Berries, Mental Herb |
| `W-lethal` | takes a hit that would knock it out | Sash- and Sturdy-like effects |
| `W-two-moves` | uses two different moves on consecutive turns | a Choice lock that fails, or does not |

A nature runs `W-phys-dealt`, `W-spec-dealt`, `W-phys-taken`, `W-spec-taken` and `W-order` for
its raised and lowered stats. The builder may add witnesses. A shard agent adds them per effect
through `witnesses`.

**C. Hazard, for every SILENT-SINK row.** Rebuild that witness battle the way `--infer p2` on a
Bo1 replay would: p2's sets from `setsFromLog` (today's assumptions), p1 known, channel 1
observed.

| Verdict | Test |
|---|---|
| HAZARD-UNSOUND | the real spread is removed, or the Pokemon is left with nothing. This is the MercifulBird Gardevoir case (engineering §7.6). |
| HAZARD-REBUILD | the rebuild fails, although it succeeds with the true set |
| SAFE | the real spread survives |

### 4.6 Records

`records.json` holds one record per effect, sorted by id. Both reports are rendered only from
records.

```json
{
  "id": "move:gyroball", "kind": "move", "name": "Gyro Ball", "shard": "S01",
  "meta": { "category": "Physical", "type": "Steel", "users": 33, "weight": 33 },
  "scan": { "handlers": ["basePowerCallback"], "reads": ["getStat:spe"], "outputs": [] },
  "templates": [{ "role": "user-hidden", "source": "auto", "fired": true, "firedBy": "|move|p2a: …|Gyro Ball|p1a: …" }],
  "open": {
    "outcome": "CHANNEL",
    "rows": [{ "role": "user-hidden", "stat": "spe", "sink": "known exact", "turn": 1,
      "at0": "…", "at32": "…", "spectator": "as %", "mechanism": "M3", "verdict": "UNUSED",
      "usedBy": null, "rebuild": null, "score": 99 }],
    "reason": null
  },
  "closed": {
    "names": [{ "line": "…", "names": "Gyro Ball", "box": "move", "pokemon": "p2a", "placement": "hidden", "verdict": "READ" }],
    "false": [],
    "silent": [],
    "reason": null
  },
  "note": null
}
```

### 4.7 Render and `--check`

- **Rendering is deterministic.** Everything is sorted. There are no timestamps, timings or
  absolute paths. The header names the simulator commit, read from `package.json`.
- **Protocol lines in table cells escape their pipes** as `\|`, the way the existing docs do
  (`\|showteam\|`). Unescaped pipes break the table.
- **`--check` runs everything in memory and renders it.** It then compares the result with the two
  committed reports, with line endings normalised. It prints each card that differs, with its
  first differing line, and exits 1.
- **This is the regression suite that catalog §0 promises.** It fails when:
  - a change to inference turns USED into UNUSED, or anything into UNSOUND;
  - a simulator upgrade changes a card;
  - a new legal effect arrives without a card.
- **The command also checks coverage:** every pool effect has exactly one card in each report.

### 4.8 The event tag

Every event in `inference.events` gets an `effect` field: the id of the move, item, ability or
condition whose line the event read.

- For a hit, it is the move.
- For a change marked `[from]`, it is that effect.
- For a speed event, it is the two actions compared.

The change is additive. Cuts, their order and every result stay the same. The only reader of
`inference.events` is `scripts/local-reconstruct.mjs`, which prints the events and writes them
into the `.log.json`. So the written file gains one field per event, and nothing else changes.
The S3 suite proves it (rule 3).

---

## 5. Report formats

### 5.1 What both reports share

- **The header:** a line saying it is generated, the command, the simulator commit, the pool
  counts, and "Read with: `evidence-catalog.md` §1–§2".
- **A line stating the file is generated:** "Do not edit by hand. `npm run catalog -- --check`
  fails when this file and a fresh run disagree."
- **Section 0 explains how to read a card:** the legend for roles, sinks, mechanisms and verdicts.
- **Section 1 is the summary.** Section 2 is the work list. Sections 3 onward hold one section
  per kind.
- **Every effect appears exactly once in each report,** under its kind. Within each table or
  group of cards, effects are in id order.
- **Box grid glyphs:** `✓` USED, `✗` UNUSED, `‼` UNSOUND, `↻` REBUILD-FAILED, `·` no row. The
  mechanism follows the glyph, for example `✗ M3`.

### 5.2 `docs/evidence-open-sheets.md`

```
# Evidence, open team sheets — what every legal effect lets reach the log about Stat Points

## 0. How to read a card
## 1. Summary
   1.1 By kind:      | Kind | Effects | CHANNEL | NO CHANNEL | UNFIREABLE | HAND-SET | USED | UNUSED | UNSOUND | REBUILD-FAILED |
   1.2 By mechanism: | Mechanism | Effects | USED | UNUSED | UNSOUND |      <- this table is copied into evidence-catalog.md §5
## 2. Work list
   2.1 UNSOUND: fix before anything else  | Effect | Role | Stat | Mech | Template | Events that cut the subject |
   2.2 UNUSED, by score                     | Rank | Effect | Role | Stat | Sink | Mech | Weight | Info | Score |
   2.3 REBUILD-FAILED                       | Effect | Role | Stat | Turn | Observed | Rebuilt |
   2.4 HAND-SET left                        | Effect | Why it is still hand-set |
## 3. Moves
   3.1 Standard hits (one row each)
   3.2 No channel (one row each)
   3.3 Every other move (one card each)
## 4. Abilities   (4.1 No channel, 4.2 Cards)
## 5. Items       (5.1 No channel, 5.2 Cards)
## 6. Conditions  (6.1 No channel, 6.2 Cards)
```

A **standard hit** has exactly two rows, both USED and nothing else: target-hidden gives HP plus
the defence it hits through M1, and user-hidden gives the attacking stat through M2. It gets one
row:

```markdown
| Move | Type | Cat | Users | HP | Atk | Def | SpA | SpD | Spe | Shard |
|---|---|---|---|---|---|---|---|---|---|---|
| Earthquake | Ground | Phys | 120 | T✓ M1 | U✓ M2 | T✓ M1 | · | · | · | S01 |
```

`U` means user-hidden, `T` target-hidden, `H` holder-hidden and `O` other-hidden.

A **no-channel** effect gets one row:

```markdown
| Move | Cat | Users | Template | Fired, shown by | Scan | Shard |
|---|---|---|---|---|---|---|
| Taunt | Status | 120 | auto (U) | `\|-start\|p1a: Snorlax\|move: Taunt` | none | S04 |
```

**Every other effect gets a full card.** Numbers here are illustrative; the command writes the
real ones.

```markdown
#### Gyro Ball · `move:gyroball`

Physical · Steel · 33 users · weight 33 · shard S01 · templates: auto (U), auto (T)
Scan: `basePowerCallback` reads `getStat('spe')` on the user and the target.

| | HP | Atk | Def | SpA | SpD | Spe |
|---|---|---|---|---|---|---|
| user hidden | · | ✓ M2 | · | · | · | ✗ M3 |
| target hidden | ✓ M1 | · | ✓ M1 | · | · | ✗ M3 |

| Role | Stat | Sink | Turn | At 0 | At 32 | Spectator | Mech | Verdict | Used by |
|---|---|---|---|---|---|---|---|---|---|
| U | Atk | known exact | 1 | `p1a 188/265` | `p1a 171/265` | as % | M2 | USED | Gyro Ball hit Snorlax |
| U | Spe | known exact | 1 | `p1a 171/265` | `p1a 203/265` | as % | M3 | UNUSED | — |
| T | HP | hidden % | 1 | `p2a 61/100` | `p2a 70/100` | same | M1 | USED | Gyro Ball hit Bronzong |
| T | Def | hidden % | 1 | `p2a 58/100` | `p2a 71/100` | same | M1 | USED | Gyro Ball hit Bronzong |
| T | Spe | hidden % | 1 | `p2a 66/100` | `p2a 60/100` | same | M3 | UNUSED | — |

Outcome: CHANNEL · 5 rows · gaps: M3 ×2
```

Then an optional `Note:` line (the fixture's `note`), and a `Template:` line when the card used a
hand-set template, quoting its `why`.

### 5.3 `docs/evidence-closed-sheets.md`

```
# Evidence, closed team sheets — what every legal effect names, where it goes, and what it gives away

## 0. How to read a card
## 1. Summary
   | Kind | Effects | READ | MISSED | MISREAD | FALSE | SILENT | SILENT-SINK | HAZARD-UNSOUND | HAZARD-REBUILD |
## 2. Work list
   2.1 MISREAD and FALSE: setsFromLog puts something in the wrong box
   2.2 MISSED: the log names it and setsFromLog does not read it
   2.3 HAZARD-UNSOUND and HAZARD-REBUILD: today's assumption removes the real spread
   2.4 SILENT-SINK, by weight: candidate dimensions for closed-sheet inference (engineering §9)
## 3. Moves
   3.1 Move box only (one row each)
   3.2 Moves that name or move something else (one card each)
## 4. Abilities (one card each)
## 5. Items (one card each)
## 6. Natures (one table)
## 7. Conditions (one row each)
```

A **move-box-only** move is named by its own `|move|` line, read into its user's move box, and
names nothing else. It gets one row:

```markdown
| Move | Users | Move box (hidden) | False (known side uses it) | Shard |
|---|---|---|---|---|
| Earthquake | 120 | READ | none | S01 |
```

**A move that names or moves something else gets a card.** Examples: Knock Off, Trick, Skill
Swap, Poltergeist, Thief, Transform, Sleep Talk's calls, Instruct.

```markdown
#### Knock Off · `move:knockoff`

Physical · Dark · 110 users · weight 110 · shard S02

| Placement | Line | Names | Box | Pokemon | setsFromLog |
|---|---|---|---|---|---|
| hidden uses it | `\|move\|p2a: Kingambit\|Knock Off\|p1a: Snorlax` | Knock Off | move | p2a (user) | READ |
| hidden uses it | `\|-enditem\|p1a: Snorlax\|Leftovers\|[from] move: Knock Off\|[of] p2a: Kingambit` | Leftovers | item | p1a (target) | READ |
| known uses it | `\|-enditem\|p2a: Kingambit\|Leftovers\|[from] move: Knock Off\|[of] p1a: Snorlax` | Leftovers | item | p2a (target) | READ |

False: none.
```

**An ability or item card** has four parts: *Named by*, *Before it is named*, *Hazard* and
*False*. Values here are illustrative.

```markdown
#### Choice Scarf · `item:choicescarf`

Any holder · weight 293 · shard S09

Named by: nothing, in every witness. Other effects' lines can name it: Trick, Switcheroo, Knock Off,
Thief, Poltergeist, Frisk (their cards).

| Witness | Sink | Without → with | Named? | Hazard |
|---|---|---|---|---|
| W-order | order | `p1a Garchomp` first → `p2a Gardevoir` first | no | HAZARD-UNSOUND |
| W-two-moves | presence | second move runs → `\|cant\|…` / move fails | no | SAFE |

False: none.
```

**Natures share one table:**

```markdown
| Nature | + | − | Silent sinks (witness) | Hazard under "neutral" |
|---|---|---|---|---|
| Timid | Spe | Atk | order (W-order); known exact (W-phys-dealt) | HAZARD-UNSOUND on W-order |
```

**Each condition gets one row.** A condition has no box of its own, but whatever set it may name
its setter:

```markdown
| Condition | Set by | Line | Box it fills | Pokemon | setsFromLog |
|---|---|---|---|---|---|
| Rain | Drizzle | `\|-weather\|RainDance\|[from] ability: Drizzle\|[of] p2a: Pelipper` | ability | p2a | READ |
```

### 5.4 `todo.md` (per shard, in `--out` only, never committed)

This is the shard agent's checklist. It lists, by effect:

- HAND-SET;
- scan reads with no row;
- `M?` rows;
- `dice-unstable` rows;
- REBUILD-FAILED;
- MISSED, MISREAD and FALSE;
- items and abilities whose battery found nothing although the scan shows a stat hook
  (`onModifyAtk`, `onModifySpe`, `onModifyDamage`, `onBasePower`, `onSourceModifyDamage`…).

---

## 6. What the shard agents do, and what they do not

The command does the mechanical work. The agents do the work that needs judgment:

- **Making things fire.** They write hand-set templates for effects the auto template cannot
  fire. Typical needs:
  - a precondition: sleep for Sleep Talk and Snore, an item for Fling or Poltergeist, an eaten
    Berry for Belch, a hit taken for Counter;
  - a delay: Future Sight, Wish, Perish Song, Yawn;
  - a field: a terrain for Steel Roller, a weather for Solar Beam's charge;
  - a switch: Pursuit-like effects, Emergency Exit;
  - two users: Pledge combinations.
- **Resolving scan flags.** They add a template that exercises the read, or write a
  `noChannelReason` citing the handler's `file:line`.
- **Assigning `M?` rows.** They use an existing mechanism, or propose `M10: <definition>`.
- **Confirming closed-sheet findings.** Each MISSED, MISREAD or FALSE gets confirmed by quoting the
  line. They add witnesses where the scan shows a hook the battery does not reach.
- **Reviewing plausibility.** A status move showing Atk USED, for example, is probably a template
  confound. They fix the template, or write a `note`.

They do not change code, fix inference, fix `setsFromLog`, edit the repo, or write outside their
`SWARM_DIR/SNN/`.

---

## 7. The swarm

### 7.1 Waves

| Wave | Who | Model (recommended) | What | Ends when |
|---|---|---|---|---|
| 0: build | the orchestrator itself, because it needs the user for approvals and makes the design calls every shard inherits | the strongest available (Opus): design-heavy, and touches inference | §7.2 steps 1–6 | §8.1 passes |
| 1: shards | 10 agents in parallel | Sonnet, medium effort: reads simulator source, writes templates as data, judges rows | §7.5 | each shard meets §8.2 |
| 2: merge | the orchestrator | the same session | §7.6 | §8.3 passes |

### 7.2 Orchestrator runbook

1. **Branch.** Ask the user which branch to work on. The suggestion is a new branch
   `evidence-catalog` off `72d2f03`.
2. **Set up `SWARM_DIR`.** Create `<your session scratchpad>/catalog-swarm/` with subfolders
   `S01` … `S10`.
3. **Prototype (Phase 0).** Build the pipeline in `SWARM_DIR/proto/` first, importing the repo's
   libraries by absolute path. Run it on the Phase 0 set: every move, item and ability on the
   fixture teams (`scripts/fixtures/teams.js`) and in the two Bo3 replays' `|showteam|` lines.
4. **Stop if the gate fails.** If the §8.1 gate does not pass on the prototype, stop and report
   to the user. A probe that misses Gyro Ball's M3 would miss it again in 950 cards.
5. **Move the prototype into the repo.** Ask for file 1 (§3.1). Once approved, move the code into
   `scripts/local-catalog.mjs`. Then ask for file 2 (`catalog.bat`) and file 3
   (`scripts/fixtures/catalog.js`), each on its own. Add the `package.json` script. Add the event
   tag (§4.8) and run the S3 suite.
6. **Re-run the §8.1 gate from the repo copy.**
7. **Check the shard lists.** For k = 1…10, run `npm run catalog -- --list --shard k/10`.
   Confirm the ten lists are disjoint and together match `--list`. Write each one to
   `SWARM_DIR/SNN/effects.txt`.
8. **Start Wave 1.** Start all ten shard agents in one message, with the §7.5 prompt, each with
   its own k and the absolute `SWARM_DIR`. Change nothing in the repo while they run.
9. **Run Wave 2** (§7.6) when all ten have reported.

### 7.3 Shards

`--shard k/10` uses this rule. Effects are sorted by (kind, id). Each kind's list is cut into
equal contiguous slices, `slice(floor(i·n/m), floor((i+1)·n/m))`. "Damaging" means any category
other than Status.

| Shard | Takes | About |
|---|---|---|
| S01 | damaging moves, 1st half; conditions, 1st half | 165 + 25 |
| S02 | damaging moves, 2nd half; conditions, 2nd half | 165 + 25 |
| S03 | status moves, 1st third | 60 |
| S04 | status moves, 2nd third | 60 |
| S05 | status moves, 3rd third | 60 |
| S06 | abilities, 1st third | 68 |
| S07 | abilities, 2nd third | 68 |
| S08 | abilities, 3rd third | 67 |
| S09 | items, 1st half | 83 |
| S10 | items, 2nd half; natures | 83 + 25 |

**Why this split.** Damaging moves mostly come out standard and need little hand work, so each
damaging shard also takes half the conditions. Status moves, abilities and conditions mostly need
a setup before they fire. The "About" column is an estimate: the pool decides the counts.

**Families split across shards.** Counter, Mirror Coat and Metal Burst, for example, may land in
different shards. That is expected. An agent may reuse another shard's template idea, but it
writes its own entry.

### 7.4 What each shard hands back

In `SWARM_DIR/SNN/`:

| File | What |
|---|---|
| `inputs.cjs` | The shard's entries in the §4.2 shape. Only its own effect ids. |
| `records.json`, `open.md`, `closed.md`, `todo.md` | Output of its last run (`--out SWARM_DIR/SNN`). |
| `report.md` | Its final message (§7.5, last step), saved as a file too. |

### 7.5 Shard agent prompt (send as written; fill in `{k}`, `{NN}`, `{SWARM_DIR}`, `{PLAN}`)

```
You are shard agent S{NN} of 10 in the evidence-catalog swarm for the Encoreable repo at
C:\Users\ANNGU\Downloads\Private_Test\Encorable.

Read first: {PLAN} (all of it; §2 rules, §4 pipeline, §5 formats, §6 your job, §8.2 your done-when),
docs/evidence-catalog.md, docs/engineering.md §7.5-§7.6.

Hard rules:
- Do not create, edit or delete any file in the repo. Do not commit. Write only inside
  {SWARM_DIR}\S{NN}\.
- Do not change code. Do not fix what you find; report it.
- Every run uses --threads 1. Node is not on PATH:
  PowerShell: $env:Path = "C:\Program Files\nodejs;" + $env:Path
- The simulator decides every verdict. Never hand-compute damage, speed or HP.
- Cite simulator source as file:line under node_modules/pokemon-showdown/ (data/mods/champions/
  overrides data/*.ts).

Your effects: {SWARM_DIR}\S{NN}\effects.txt (npm run catalog -- --list --shard {k}/10).

Loop until §8.2 holds:
1. npm run catalog -- --shard {k}/10 --inputs {SWARM_DIR}\S{NN}\inputs.cjs --out {SWARM_DIR}\S{NN} --threads 1
   (add --no-coverage while iterating on templates; the last run must include coverage).
2. Work through {SWARM_DIR}\S{NN}\todo.md, effect by effect:
   - HAND-SET: read the effect's source, write a template in inputs.cjs (§4.2 shape) that makes it
     fire; re-run with --only <id>. If no template can make it fire in this format, write
     `unfireable` with file:line.
   - scan read with no row: a template that exercises the read, or `noChannelReason` with file:line.
   - M?: assign M1-M9 via `mechanism`, or propose 'M10: <one-line definition>'.
   - dice-unstable: fix the template's dice by rule instead of ordinal.
   - MISSED / MISREAD / FALSE: confirm by quoting the log line and the box setsFromLog filled; add
     a `note` naming the pattern it misses. Do not fix setsFromLog.
   - item/ability with a stat hook the battery did not catch: add a witness via `witnesses`.
3. Skim every card in open.md and closed.md for rows that make no sense (a status move with Atk
   USED, a row on a turn the effect was not active). A template confound is fixed in the template;
   anything else gets a `note`.

Finish with a message, also saved as {SWARM_DIR}\S{NN}\report.md, in exactly this shape:
  ## S{NN}
  Effects: <n> · CHANNEL <n> · NO CHANNEL <n> · UNFIREABLE <n> · HAND-SET <n (must be 0)>
  Open rows: USED <n> · UNUSED <n> · UNSOUND <n> · REBUILD-FAILED <n>
  Closed: READ <n> · MISSED <n> · MISREAD <n> · FALSE <n> · SILENT-SINK <n> · HAZARD-UNSOUND <n>
  UNSOUND rows: <effect role stat, one per line, or none>
  REBUILD-FAILED rows: <…>
  MISREAD / FALSE: <…>
  HAZARD-UNSOUND: <…>
  Proposed mechanisms: <M10: definition — effects, or none>
  Unresolved: <effect — why, or none>
```

### 7.6 Wave 2: merge runbook

1. **Read the ten `report.md` files.** Any shard with HAND-SET above 0 or anything unresolved goes
   back to its agent (continue it with SendMessage) before merging.
2. **Reconcile proposed mechanisms.** Merge duplicates, give each a final number and a one-line
   definition, and rewrite the affected `mechanism` entries.
3. **Merge the inputs.** A scratch script in `SWARM_DIR` loads the ten `inputs.cjs` files, asserts
   that no id appears twice, sorts by id, and writes `scripts/fixtures/catalog.js` in the shape its
   header documents.
4. **Ask the user for file 4, then file 5** (§3.1), each on its own.
5. **Do a full run from a clean tree:** `npm run catalog -- --threads 13`. It writes both reports.
   The final reports are always regenerated from the committed inputs. They are never stitched
   together from shard output.
6. **Run `npm run catalog -- --check`.** It must pass.
7. **Spot-check the reports.** Read 10 random cards per shard in the committed reports, plus every
   UNSOUND, MISREAD, FALSE and HAZARD-UNSOUND card. Anything wrong goes back to step 3 through the
   fixture.
8. **Run the S3 suite:** `npm run reconstruct -- --all --rung s3 --infer p2` must give 21 MATCH and
   83 of 83.
9. **Edit the docs** (§3.2):
   - catalog Status becomes "Phases 0–3 and 5 done; Phase 4 not started";
   - catalog §2's Status column comes from the report;
   - catalog §4 becomes the real file list;
   - catalog §5 gets the by-mechanism table from the open report's §1.2, with UNSOUND and UNUSED
     named (catalog Phase 3);
   - the engineering §8 and §9 pointers;
   - the README rows.
10. **Clean up.** Delete `SWARM_DIR` and every other scratch file.
11. **Report to the user:** the two summaries, the top of each work list, and the proposed
    mechanisms.

---

## 8. Acceptance

### 8.1 Wave 0 gate (the Phase 0 table is worth having)

1. `npm run catalog -- --pool` matches catalog §2, or the difference is explained (§4.1).
2. The Phase 0 set runs end to end with `--only`.
3. **Gyro Ball** has a Spe row: M3, UNUSED, with no Gyro Ball entry in the fixture. This is catalog
   Phase 0's own done-when.
4. **The engineering §7.5 synthetic set comes out USED** on the stat each one pinned there:
   - Strength Sap: the target's Atk;
   - Pain Split: HP;
   - Leech Seed: HP;
   - Shell Bell: the holder's HP;
   - Dragon Claw under Wonder Room: SpD, with Def untouched;
   - Focus Sash: M6;
   - a confusion self-hit: the Pokemon's own Atk and Def.
5. **Earthquake** is a standard hit.
6. **The filler move** comes out NO CHANNEL.
7. **Closed sheets:**
   - Rocky Helmet is READ for the holder, with no FALSE on the attacker;
   - Volt Absorb is READ for the holder, not for the attacker named in `[of]`;
   - a Mega Stone is READ;
   - Choice Scarf is SILENT, with an `order` SILENT-SINK and HAZARD-UNSOUND on `W-order`.
8. **Determinism.** Two runs of the Phase 0 set into two `--out` folders are byte-identical.
9. **The S3 suite** still gives 21 MATCH and 83 of 83 with the event tag in place.
10. **A dry run of one shard,** `--shard 1/10 --no-coverage --out …`, finishes and writes
    `todo.md`.
11. **Stop and report to the user** if REBUILD-FAILED is more than 10% of the Phase 0 rows. That
    would be a reconstruction gap, and the swarm cannot work around it.

### 8.2 A shard is done when

- Every effect in the shard is CHANNEL, NO CHANNEL with a fired line, or UNFIREABLE with a
  `file:line` reason. None is HAND-SET.
- No `M?` or `dice-unstable` rows remain.
- Every scan read without a row has a template that exercises it, or a `noChannelReason`.
- Every MISSED, MISREAD and FALSE is confirmed by a quoted line.
- Every item and ability has run the battery, and every SILENT-SINK has a hazard verdict.
- A final run with coverage finishes with no errors, and `report.md` is written.

### 8.3 Everything is done when

- `scripts/fixtures/catalog.js` holds every shard's entries.
- A full `npm run catalog` from a clean tree writes both reports, and `--check` passes.
- Every pool effect has exactly one entry in each report.
- Catalog §2, §4 and §5, engineering §8 and §9, and the README are updated.
- The S3 suite still gives 21 MATCH and 83 of 83.
- `SWARM_DIR` and every scratch file are deleted.

---

## 9. Risks

| Risk | What contains it |
|---|---|
| A line changes because of the template, not the effect | The control's difference of differences (§4.3), plus the shard's plausibility review |
| The effect never fires, and "no channel" is a false negative | The handler-call fire test, cross-checked against the static scan |
| Rebuild failures swamp Phase 3 | REBUILD-FAILED is its own list, not a verdict, and gate §8.1.11 applies |
| Dice drift between perturbations | Dice fixed by rule; `dice-unstable` rows are not diffed |
| CPU oversubscription with ten shards | `--threads 1` per shard: ten processes on 14 threads |
| Shards read the rules differently | One prompt (§7.5); mechanisms reconciled centrally; the spot-check in §7.6 step 7 |
| Two shards write the same entry | Shards are disjoint by id; the merge asserts it |
| The pool disagrees with catalog §2 | Gate §8.1.1: explain it, or stop |
| Interactions between two effects | Not probed (catalog §6); the hooks sit in shared simulator code |
| A simulator upgrade | Changes cards, and `--check` fails. That is intended: re-run and commit the new reports with the upgrade. |

---

## 10. After this plan (Phase 4, not part of it)

1. The open report's §2.1 (UNSOUND), then §2.2 (UNUSED) by score. Each fix goes in at the
   mechanism level (catalog Phase 4).
2. The closed report's §2.1 and §2.2, as fixes to `setsFromLog`.
3. The closed report's §2.3 and §2.4, as the candidate dimensions for closed-sheet inference
   (engineering §9).

Every fix re-runs `npm run catalog -- --check`, and the updated reports are committed with it.
