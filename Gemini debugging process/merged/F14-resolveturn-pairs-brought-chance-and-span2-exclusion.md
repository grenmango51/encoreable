# F14: `resolveTurn` `pairs`/`brought` `b.chance` & `span=2` Exclusion, `scoreOf[0] > score[0]` Tie Rejection, and Prerequisite Flinch Reversion

## 1. Failure Overview & Status

- **Bucket ID**: `F14`
- **Category**: `3. RNG Steering & Variant-Budget Bugs in reconstruct.mjs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs` (`resolveTurn`, `scoreOf`, `outranks`)
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:757-769` (`candidates` — small-range enumeration vs. `[lo, hi]` ends)
  - `scripts/lib/reconstruct.mjs:1667-1679` (`scoreOf(run, t)` — `[diff.index, fields, shared]` ranking tuple, where `|-status|` or `|cant|` shares leading fields with the target line)
  - `scripts/lib/reconstruct.mjs:1764-1765` (`outranks(a, b)` & `ties(a, b)` — full 3-tuple `[lines, fields, shared]` lexicographic comparison)
  - `scripts/lib/reconstruct.mjs:1845-1851, 1945-1966, 2030-2042` (`resolveTurn` — greedy `fallback` / `onTrial` single-die commit & `takeBack()` reversion when `score[0]` does not strictly advance)
  - `scripts/lib/reconstruct.mjs:1973-1994` (`resolveTurn` `pairs` loop — line `1974` excludes `span === 2` non-`chance` draws via `d.chance || d.hi - d.lo + 1 > 16`; line `1984` checks `scoreOf(probe, t)[0] > score[0]` instead of `outranks(scoreOf(probe, t), score)`)
  - `scripts/lib/reconstruct.mjs:1995-2024` (`resolveTurn` `brought` loop — line `2002` excludes `span === 2`; line `2009` inspects only the first `drawsOf(flipped.trace, t).find(d => d.i > a.i)`; line `2010` explicitly rejects `b.chance` and `b.hi - b.lo + 1 > 16`; line `2015` checks `scoreOf(probe, t)[0] > score[0]`)
- **Total Merged Reports**: **10** (`kind: gaveup`, `16` failing view runs across `7` shard clusters: `S08-C05`, `S09-C03`, `S12-C07`, `S13-C03`, `S14-C04`, `S14-C05`, `S15-C07`)
  - **View Breakdown**:
    - `p1@p2` only: **2** (`2705717774`, `2709778237`)
    - `p2@p1` only: **1** (`2709587302`)
    - `both@spectator` only: **2** (`2696442635`, `2699896675`)
    - `p1@p2` & `p2@p1`: **2** (`2694712442`, `2695573428`)
    - `p2@p1` & `both@spectator`: **1** (`2700167937`)
    - `both@spectator` & `p1@p2`: **1** (`2707224488`)
    - All 3 views (`p1@p2`, `p2@p1`, `both@spectator`): **1** (`2701148131`)
    - Total per view: `p1@p2` = **6**, `p2@p1` = **5**, `both@spectator` = **5**.

---

## 2. Root-Cause Mechanism

`resolveTurn(t, common, subs, subTurn, sample, budget)` (`scripts/lib/reconstruct.mjs:1786-2045`) settles a turn's random draws one ordinal at a time against the observed log (`scoreOf(run, t) = [diff.index, fields, shared]`). When clearing a divergence requires flipping **two or more coupled draws** (or clearing an upstream draw that shifts/exposes a downstream draw), four tightly coupled defects in `resolveTurn` cause valid multi-die fixes to be ignored, skipped, or reverted, leaving `resolveTurn` to exit with `ended = 'stuck'` (or `'probes'`):

1. **`pairs` (`reconstruct.mjs:1984`) and `brought` (`reconstruct.mjs:2015`) Require `scoreOf(probe, t)[0] > score[0]` Instead of `outranks(...)`**:
   - In the single-die scan (`lines 1934-1948`), `resolveTurn` compares `outranks(reach, best)`, so improving `fields` or `shared` at the same line index `score[0]` is recognized as progress.
   - By contrast, the two-die `pairs` block (`line 1984`) and `brought` block (`line 2015`) hardcode:
     ```js
     if (scoreOf(probe, t)[0] > score[0]) {
     ```
   - Whenever two upstream secondary/flinch checks must both be cleared just to *reach* the next move line—and that next move line itself still disagrees on a later field (e.g., `|move|p1a: Gholdengo|Make It Rain|p2a: Annihilape|[spread] p2a,p2b` vs. `wanted ...|[spread] p2b`, advancing `[10, 1, 1] -> [10, 5, 5]`)—`scoreOf(probe, t)[0]` stays equal to `score[0]`. Because `10 > 10` is `false`, `pairs` discards the clean double-clear and never hands the newly reached move to `steerDice` (`hitStepAccuracy`), which would fix the `[spread]` miss on the very next iteration.

2. **`pairs` (`reconstruct.mjs:1974`) and `brought` (`reconstruct.mjs:2002`) Exclude `span === 2` Non-`chance` Draws**:
   - Both blocks filter draws with:
     ```js
     const chances = all.filter(d => (d.chance || d.hi - d.lo + 1 > 16) && subs[d.i] === undefined);
     ```
   - In Showdown, `Battle.speedSort` (`prng.shuffle`) and `getRandomTarget` (`randomFoe()` across 2 foes) call `random(2)` (`lo = 0, hi = 1, span = 2, chance = false`). Because `chance` is `false` and `span = 2 <= 16`, these draws are **completely excluded from `chances`**.
   - When a `50/50` speed tie or a 2-foe `randomFoe()` target choice must flip alongside a `30%` `Rock Slide` flinch (or when flipping the speed tie alone exposes a flinch that drops `fields` from `2` (`|move|`) to `1` (`|cant|`), as in `2709587302`), neither draw alone improves `scoreOf`, and `pairs` never pairs the `span === 2` draw with the flinch/secondary draw.

3. **`brought` (`reconstruct.mjs:2009-2010`) Inspects Only the First `d.i > a.i` and Rejects `b.chance === true`**:
   - Lines `1995-2024` were written for moves like `Dire Claw` whose `randomChance(30, 100)` spawns `sample(3)` (`chance: false, span: 3`). Line `2009-2010` writes:
     ```js
     const b = drawsOf(flipped.trace, t).find(d => d.i > a.i);
     if (!b || b.chance || b.hi - b.lo + 1 > 16 || before.get(b.i) === `${b.lo}-${b.hi}`) continue;
     ```
   - This fails on three common simulator mechanisms:
     - **Short-circuited `onBeforeMove` checks (`flinch` priority 8 > `par` priority 1)**: Turning off `Rock Slide`'s `30%` flinch on `p1a: Metagross` (`2707224488`) exposes `par`'s `randomChance(1, 4)` (`b.chance === true`), *after* `Rock Slide`'s second-target flinch draw on `p1b: Incineroar`. `.find(d => d.i > a.i)` stops on the second-target flinch (already in `before`), and even if it reached `par`, `b.chance` rejects it.
     - **Masked & ordinal-shifted contact/status triggers (`Dire Claw` vs. `Poison Touch` / `Flame Body`)**: `Dire Claw`'s secondary (`K`) + `sample(3)` (`K+1`) runs in Step 5 before `Poison Touch` / `Flame Body` (`K+2`, `randomChance(3, 10)`, `b.chance === true`) in Step 7. Flipping `Dire Claw` off deletes `sample(3)`, shifting `Poison Touch` / `Flame Body` from ordinal `K+2` to `K+1`. `pairs` pins `K+2` (missing the shifted `K+1`), and `brought` skips `b` at `K+1` because `b.chance === true`! Meanwhile, the `|-status|...|psn` line holds `fields = 4`, preventing the single-die loop from turning `Dire Claw` off.
     - **Dual-priority ability/item procs (`Quick Draw` vs. `Quick Claw`)**: `Quick Draw` (`onFractionalPriority`, `b.chance`) rolls first and suppresses `Quick Claw` (`b.chance`). Flipping `Quick Draw` off exposes `Quick Claw`, which `brought` skips because `b.chance === true`.

4. **Greedy `outranks` / `onTrial` Reverts Prerequisite Flinch Removals on Downstream Crit/Damage Collisions**:
   - When clearing a `|cant|...|flinch` die (e.g., `Rock Slide` flinch on `p1b: Basculegion` at die `68` in `2709778237`, or `Staraptor-Mega` in `2701148131`) allows the Pokémon to execute its `|move|`, any unpinned downstream critical hit (`1/24` on `Sneasler` at die `73` causing `0 fnt` instead of `5/157`) or secondary/flinch collision diverges at the *same* or earlier line index (`score[0]`) with no `fields`/`shared` improvement (`outranks(reach, best) === false`).
   - Because `resolveTurn` evaluates only one die at a time in the main loop and does not steer past an eliminated `|cant|` blocker (and `onTrial` at `lines 2038-2042` reverts any in-place commit whose `score[0]` did not strictly increase), the prerequisite flinch die stays unflipped or is reverted.

**Why `both@spectator` occasionally escaped while single-side views (`p1@p2` / `p2@p1`) failed**: In `both@spectator`, `infer.mjs` fallback could perturb speeds on *both* sides until two Pokémon accidentally formed an artificial speed tie (e.g. `Gholdengo spe 18` tying `Gardevoir-Mega` at `122 == 122` in `2694712442`; `Floette-Mega` tying `Sneasler` at `154 == 154` in `2695573428`), injecting an extra `random(2)` `speedSort` draw that shifted the PRNG stream off the collision. In `p1@p2` and `p2@p1`, the known side's speeds are locked constants and exact HP is enforced, making that accidental PRNG-shift escape impossible.

---

## 3. Single Cohesive Fix Specification

Keep mechanics 100% inside Showdown's simulator and never discard any sound possibility (`AGENTS.md` Rules 1 & 2). Fix all four facets cohesively inside `resolveTurn()` (`scripts/lib/reconstruct.mjs`):

1. **Use `outranks(scoreOf(probe, t), score)` in `pairs` (`line 1984`) and `brought` (`line 2015`)**:
   - Replace `if (scoreOf(probe, t)[0] > score[0])` with full 3-tuple comparison `outranks(probeScore, score)` (preferring the first/best pair with `probeScore[0] > score[0]` if any exists, otherwise taking an `outranks` advance at the same `score[0]`—such as `[10, 1, 1] -> [10, 5, 5]`—with `onTrial` guarding against non-advancing cycles when `probeScore[1] === score[1]`). Once `[10, 5, 5]` is committed, the next `resolveTurn` loop immediately runs `steerDice` (`hitStepAccuracy`) on `Make It Rain` and finishes the turn.

2. **Include `span === 2` Decision Draws in `chances` (`lines 1974, 2002`)**:
   - Change the `chances` filter from:
     ```js
     (d.chance || d.hi - d.lo + 1 > 16)
     ```
     to include binary (`span === 2`) and small non-damage-roll decision draws (`d.chance || d.hi - d.lo + 1 > 16 || d.hi - d.lo + 1 === 2`, or more generally `d.chance || d.hi - d.lo + 1 !== ROLLS`).
   - This admits `Battle.speedSort` `random(2)` ties and 2-target `getRandomTarget` (`randomFoe()`) draws into both `pairs` and `brought` without exploding over 16-face `ROLLS` damage bands.

3. **Search All Newly Shifted or Exposed Draws (Including `b.chance`) in `brought` (`lines 2000-2024`)**:
   - After flipping `a` (`flipped = await ask.get({ ...subs, [a.i]: va })`), do not stop at `.find(d => d.i > a.i)` and do not skip `b.chance === true`.
   - Instead, let `flippedReach = canReach(common, flipped, t)`. Collect every draw `b` in `drawsOf(flipped.trace, t)` with `b.i > a.i` and `flippedReach(b)` whose `(b.i, b.lo, b.hi)` signature is new (`before.get(b.i) !== `${b.lo}-${b.hi}``) **or** which lies at/after an ordinal shift caused by `a` deleting/inserting draws (i.e. `b.i >= a.i + 1` up to `flippedReach` when the draw count/ranges diverged after `a.i`, including `b.chance === true` draws such as `Poison Touch`, `Flame Body`, `Quick Claw`, and `par`).
   - Test `candidates(b, flipped.steer)` for each such `b` (capped cleanly by the remaining `budget - probes`).

4. **Two-Step Steering Past Eliminated `|cant|` Blockers in `resolveTurn` (`lines 1917-1966`)**:
   - When the current mismatch `run.diffs[0]` is a `|cant|` line (e.g., `|cant|p1b: Basculegion|flinch`) where `want` is the same Pokémon's `|move|` (or another `|cant|` reason), flipping the draw that caused `|cant|` removes a short-circuit and exposes a downstream action whose own `steerDice` draws (`hitStepAccuracy`, `crit`, `bracket` damage) have not yet been read or pinned.
   - When a candidate flip `v` for a `|cant|`-causing draw eliminates that `|cant|` line (changing `gotHard[diff.index]` from `|cant|<actor>|...` to `<actor>`'s `|move|` or clearing the blocker), run `runTo(common, { ...subs, [draw.i]: v }, t, t)` with `steerDice` active and apply up to one nested `steerDice` / single-die repair step (e.g. applying `steer.wrong` crit/damage/accuracy fixes on the exposed action) before judging `outranks(probeScore, score)`—or retain the `|cant|`-clearing flip as a trial candidate for one nested `resolveTurn` step so an unpinned downstream crit (`die 73`) or second flinch does not cause greedy `outranks` to revert the prerequisite die (`die 68`).

---

## 4. Representative Battle Proofs

### Proof A (`pairs` `scoreOf[0] > score[0]` Rejection + `span=2` Speed-Tie Escape): `mimic:gen9championsvgc2026regmcbo3-2694712442`
- **Source**: `Gemini debugging process/gaveup-2694712442.md` (`p1@p2` & `p2@p1` GAVE UP `475.6s`, `stop = "searches"`, `limits = ["backtracks", "fallbackRebuilds", "probes", "searches"]`; `both@spectator` fluked PASS in Start 6 at fallback rebuild `#108`).
- **Battle State at Turn 2 (`2.10`)**:
  - `p1b: Milotic` (`SpA 167`, `Spe 101`) uses `Muddy Water`, hitting `p2a: Annihilape` (`187 HP`, `110 SpD`) and `p2b: Tyranitar` (`193 HP`, `180 SpD` in Sandstorm, `62/100` at `2.9`).
  - Under the reconstruction RNG stream (`sampler(1 ^ 0x5eed)` and `resample: 1`), `Muddy Water` rolls `< 30` (`30%` accuracy drop) on **both** `p2a: Annihilape` (`draw A`, triggering `Defiant` `+2` Atk) and `p2b: Tyranitar` (`draw B`), while `p1a: Gholdengo` (`189 HP`, `114 Spe`, `-2 Spe = 57`) needs `Make It Rain` to miss `p2a: Annihilape` (`5%` miss in Reg M-C):
    - **Observed `2.10`**: `|move|p1a: Gholdengo|Make It Rain|p2a: Annihilape|[spread] p2b`
    - **Actual `2.10`**: `|-unboost|p2a: Annihilape|accuracy|1` (`score = [10, 1, 1]`)
- **Failure Trace**:
  1. Single-die scan flips `draw A = 99`, exposing `draw B < 30` -> `|-unboost|p2b: Tyranitar|accuracy|1`, still scoring `[10, 1, 1]` -> rejected.
  2. `pairs` (`reconstruct.mjs:1975-1993`) flips **both** `draw A = 99` and `draw B = 99`, clearing `Muddy Water` cleanly and reaching `Make It Rain`:
     `|move|p1a: Gholdengo|Make It Rain|p2a: Annihilape|[spread] p2a,p2b`
     This matches 5 pipe fields (`['', 'move', 'p1a: Gholdengo', 'Make It Rain', 'p2a: Annihilape']`), scoring **`[10, 5, 5]`**.
  3. **`reconstruct.mjs:1984`** evaluates `scoreOf(probe, 2)[0] > score[0]` (`10 > 10` = `false`) and **discards `(draw A = 99, draw B = 99)`**, stalling Starts 1–5 across all 3 views.
  4. In `both@spectator`, Start 6 (`widest + wide`) rebuild `#108` probed `Gholdengo spe 18` (`Spe = 122`), tying `Gardevoir-Mega` (`Spe = 122`) during Turn 1 `eachEvent("Update")` (`speedSort` `random(2)`), shifting Turn 2's PRNG ordinals off the double-`< 30` trap. In `p2@p1`, `Gholdengo` is locked at `114` Spe so that escape is impossible.

### Proof B (`brought` `b.chance` Skip & Ordinal Shift): `mimic:gen9championsvgc2026regmcbo3-2695573428`
- **Source**: `Gemini debugging process/gaveup-2695573428.md` (`p1@p2` & `p2@p1` GAVE UP `664.8s`, `stop = "searches"`; `both@spectator` Starts 1–2 GAVE UP on `2.10`, Start 3 escaped via lucky speed tie).
- **Battle State at Turn 2 (`2.10`)**:
  - `+1 Spe` `p2b: Volcarona` hits `p1a: Floette-Mega` with `Heat Wave` (`63/100` at `2.5`).
  - `p1b: Sneasler` (`Poison Touch`) uses `Dire Claw` on `p2b: Volcarona` (`56/100` at `2.9`).
  - **Observed `2.10`**: `|-status|p2b: Volcarona|psn|[from] ability: Poison Touch|[of] p1b: Sneasler`
  - **Actual `2.10`**: `|-status|p2b: Volcarona|psn` (from `Dire Claw`'s 30% secondary in Step 5, which calls `randomChance(30, 100)` at ordinal `K` and `sample(3)` at `K+1`, masking `Poison Touch`'s `randomChance(3, 10)` at `K+2`).
- **Failure Trace**:
  1. `scoreOf` gives `[10, 4, 4]` for `|-status|p2b: Volcarona|psn` vs. `Poison Touch`. Flipping `Dire Claw` (`K`) off (`99`) deletes `sample(3)` (`K+1`), shifting `Poison Touch` from `K+2` to `K+1`. When unpinned `Poison Touch` fails (`70%`), `got` falls through to `|move|p1a: Floette|...` (`fields = 0 < 4`), so single-die rejects it.
  2. `pairs` tries `(K = 99, K+2 = 0)`, pinning `K+2` (the wrong draw after `sample(3)` is deleted) instead of `K+1`.
  3. `brought` (`reconstruct.mjs:2009-2010`) flips `K = 99` and finds `b` at `K+1` (`Poison Touch`, `randomChance(3, 10)`), **but line 2010 skips it because `b.chance === true`**.

### Proof C (Prerequisite `flinch` Reversion on Downstream Crit Collision): `mimic:gen9championsvgc2026regmcbo3-2709778237`
- **Source**: `Gemini debugging process/gaveup-2709778237.md` (`p1@p2` GAVE UP `421.2s`, 48 rounds, 145 rebuilds, `stop = "searches"`, `limits = ["backtracks", "fallbackRebuilds", "probes", "searches"]`).
- **Battle State at Turn 5 (`5.6`)**:
  - `p2a: Sneasler` (`344` Spe with Unburden) uses `Rock Slide`, missing `p1a: Golisopod` and critting `p1b: Basculegion-F` (`109/195`, `55/100`).
  - **Observed `5.6`**: `|move|p1b: Basculegion|Muddy Water|p2a: Sneasler|[spread] p2a,p2b` (followed by `Sneasler` at exact Channel 2 HP `5/157`, `Froslass` at `38/154`, and `Golisopod` KOing `Froslass` with `Leech Life`).
  - **Actual `5.6`**: `|cant|p1b: Basculegion|flinch` (from die `68 = 0 < 30`).
- **Failure Trace**:
  1. Single-die loop tests `subs[68] = 99` (no flinch). `Basculegion` executes `Muddy Water`, **but unpinned die `73 = 0` rolls a `1/24` critical hit on `p2a: Sneasler`**, emitting `|-crit|p2a: Sneasler` and `|-damage|p2a: Sneasler|0 fnt` (`0 fnt` vs. `5/157`).
  2. Because the crit causes a divergence on `Sneasler`'s line at the same/earlier `score[0]` without an `outranks` improvement, `resolveTurn` refuses to commit `subs[68] = 99` and exits with `|cant|p1b: Basculegion|flinch`, locking `p1@p2` (where P2's stats and Channel 2 HP are rigid) for 48 rounds.

---

## 5. Merged Reports Manifest

All **10** reports merged into bucket `F14`:

| File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2694712442.md` | `gaveup` | `p1@p2`, `p2@p1` | `PASS` in trace (`both@spectator`: `141.3s` Start 6 `#108` fluke speed tie; sweep `p1@p2` & `p2@p1` `GAVE UP` `475.6s`) | Turn 2.10 `Muddy Water` double `<30` accuracy drops before `Make It Rain` missed `Annihilape`; `pairs` cleared both unboosts advancing `score` `[10,1,1]->[10,5,5]`, rejected at `reconstruct.mjs:1984` (`10 > 10` false). |
| `gaveup-2695573428.md` | `gaveup` | `p1@p2`, `p2@p1` | `PASS` (`both@spectator` only; Starts 1–2 `GAVE UP` on `2.10`, Start 3 escaped via lucky speed tie) | Turn 2.10 (`wanted \|-status\|p2b: Volcarona\|psn\|[from] ability: Poison Touch`, `got Dire Claw psn`): flipping `Dire Claw` off deletes `sample(3)`, shifting `Poison Touch` from `K+2` to `K+1` where `brought` (`reconstruct.mjs:2010`) skips `b.chance === true`. |
| `gaveup-2696442635.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 1.0 dual-priority RNG branch on `Slowbro-Galar` (`wanted \|-activate\|p2a: Slowbro\|item: Quick Claw`, `got ability: Quick Draw`): `Quick Draw` rolls first and suppresses `Quick Claw`, so `resolveTurn` cannot flip `Quick Draw` off + `Quick Claw` on (`b.chance` skipped at line `2010`). |
| `gaveup-2699896675.md` | `gaveup` | `both@spectator` | `GAVE UP` (`71.7s` trace / `861.1s` sweep, `stop=searches`, `50` rounds, `84,693` probes) | All 6 starts stalled on Turn 2 `\|upkeep` vs `\|-status\|p2b: Milotic\|psn` because flipping `Dire Claw`'s secondary off shifted `Poison Touch` (`b.chance=true`) into ordinal `i+1` where it still triggered, and `brought` (`reconstruct.mjs:2010`) skipped `b.chance`. |
| `gaveup-2700167937.md` | `gaveup` | `p2@p1`, `both@spectator` | `GAVE UP` | Turn 6.4 (`wanted \|move\|p1a: Volcarona\|Quiver Dance`, `got \|-status\|p1a: Volcarona\|psn`): flipping `Dire Claw` off deletes `sample(3)` at `i+1` and shifts `Flame Body` from `i+2` to `i+1` (90% trigger), which `pairs` misses, `scoreOf` rejects (`[4,1,1] < [4,1,2]`), and `brought` (`2010`) rejects because `b.chance === true`. |
| `gaveup-2701148131.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 2.6: `Garchomp`'s `Rock Slide` flinched `Staraptor-Mega` in every rebuild (`wanted \|move\|p1b: Staraptor\|Close Combat\|p2a: Excadrill`, `got \|cant\|p1b: Staraptor\|flinch`); `resolveTurn` could not clear the coupled multi-die flinch/tie sequence and hit `stop='stuck'` across all 3 views. |
| `gaveup-2705717774.md` | `gaveup` | `p1@p2` | `PASS` in trace (`both@spectator`: `121.8s` Start 3 `#19` speed tie; sweep `p1@p2` `GAVE UP` `1,654.4s`) | Turn 3.8 combined double `Rock Slide` flinch on `Primarina` with an excluded `span=2` `randomFoe()` draw on `Hyper Voice`; `pairs` cleared both flinches advancing `score` `[8,1,2]->[8,4,5]`, rejected at `reconstruct.mjs:1984` (`8 > 8` false). |
| `gaveup-2707224488.md` | `gaveup` | `both@spectator`, `p1@p2` | `GAVE UP` | Turn 1 (`wanted \|cant\|p1a: Metagross\|par`, `got \|cant\|p1a: Metagross\|flinch`): `brought` loop (`reconstruct.mjs:2009-2010`) stops at `Rock Slide`'s 2nd-target flinch draw and skips `b.chance === true`, failing to find `(flinch=false, par=true)` in `both@spectator` and `p1@p2`. |
| `gaveup-2709587302.md` | `gaveup` | `p2@p1` | `PASS` in `both@spectator` (`40s`, `6` rounds, `4,888` probes); `GAVE UP` in `p2@p1` sweep (`979.8s`, `stop=searches`) | Turn 3.8 (`Kingambit` `Low Kick` vs `Milotic` `Icy Wind` at `102==102` speed tie after `Rock Slide`) deadlocks because flipping the speed tie exposes a flinch (`scoreOf` regression `fields` `2->1`) and `pairs` (`reconstruct.mjs:1974`) excludes `span=2` shuffle draws from pairing. |
| `gaveup-2709778237.md` | `gaveup` | `p1@p2` | `GAVE UP` | Turn 5 `p1@p2` deadlock (`wanted \|move\|p1b: Basculegion\|Muddy Water`, `got \|cant\|p1b: Basculegion\|flinch`) where fixing die `68` triggers an uncoordinated crit at die `73` on `Sneasler` (`0 fnt` vs `5/157`), causing greedy `outranks` to revert/reject die `68`. |
