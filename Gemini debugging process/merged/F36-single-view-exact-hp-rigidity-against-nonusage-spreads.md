# F36: Single-view (`p1@p2` / `p2@p1`) Channel-1/2 exact-HP rigidity against fixed opponent & off-meta/random spreads

## 1. Failure Overview & Status

- **Bucket ID**: `F36`
- **Category**: `6. Coupled Multi-Variable Search & Single-View Exact-HP Architecture`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` / `scripts/lib/reconstruct.mjs` / `scripts/lib/inference/usage.mjs` / `scripts/lib/inference/knowledge.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs`:
    - `inferSpreads` — `exactHp` Channel 1/2 extraction (`lines 313-322`), `firstGuesses` single-sided `known[s]` freeze & `usualSpreads` lookup (`lines 331-338`), `budgets` (`lines 406-411`, `budgets[0].maxBacktracks = 0`).
    - `fallback` (`lines 478-914`) — `FALLBACK_REBUILDS = 8` / `affordable()` (`lines 51, 505-510`), `unknown`/`cast` filtering out `known[s]` (`lines 523-527, 576-580`), `base` `budgets[0]` / `maxBacktracks: 0` premature `none()` (`lines 603-618`), `dims` fixed `STAT_IDS` ordering (`lines 626-634`), `build` calling `closestSpread` (`lines 642-659`), `halving` on rank-0/unused stats (`lines 798-817`), 2D pair loop restricted to `moved` dims (`lines 825-845`).
    - `choose` & main round loop (`lines 997-1124`) — `evidencePass(..., { exact: true })` proving only `0..verifiedThroughTurn` (`lines 1014-1020`), `level = floor` reset when `unchanged === false` (`lines 1102-1106`), `restarts()` (`lines 1261-1285`).
  - `scripts/lib/reconstruct.mjs`:
    - `hpRank(token, exact)` (`lines 612-620`) and `steerDice` `bracket(...)` (`lines 918-1013`, `secret = channel === -1 || target.side.id === 'p' + channel || line < exactUpTo` at `line 925`), enforcing exact integer `hp/maxhp` on the observer's side in Channel 1/2.
    - `reconstructOnce` backtracking loop (`lines 2591-2605`), breaking with `stop = 'stuck'` on `!moved` before incrementing `backtracks`.
  - `scripts/lib/inference/knowledge.mjs`:
    - `freshKnowledge` (`lines 138-150`, freezing `known` spreads to exact `e`), `closestSpread` (`lines 648-683`, minimizing L1 distance under `BUDGET = 66` without protecting earlier-constrained stats from SP cannibalization).
  - `scripts/lib/inference/usage.mjs`:
    - `usualSpreads` (`lines 16-25`, returning `[]` for off-meta natures or only meta-biased spreads).
- **Total Merged Reports**: **24** (`kind: "gaveup"`, all `mimic` battles).
- **View Breakdown (Sweep vs. Trace)**:
  - **`p1@p2` only failed in sweep (13 reports)**: `2692252669`, `2692349682`, `2695290472`, `2697369705`, `2697711296`, `2698373959`, `2699344151`, `2702862294`, `2703692999`, `2704474984`, `2709221540`, `2709331203`, `2709683313`.
  - **`p2@p1` only failed in sweep (9 reports)**: `2694124237`, `2694716398`, `2695317483`, `2700314248`, `2700688633`, `2700798384`, `2704366296`, `2708420838`, `2711531781`.
  - **`p2@p1` failed + `both@spectator` failed in sweep only under contention/default budget, passing on isolated/wide trace (2 reports)**: `2696868891` (`p2@p1` GAVE UP; `both@spectator` failed default sweep, PASSED in Start 3 `wide` at rebuild 32), `2700875531` (`p2@p1` GAVE UP; `both@spectator` stalled under sweep contention at 1,770.8s, PASSED in isolated 15T trace in 184.2s).
  - **Two-Sided Slack vs. Single-View Rigidity & Trace Dispatch Gap**: In `both@spectator` (Channel 0), both sides are unknown (`known = [false, false]`) and all HP observations are integer percentages (`0..100`), giving the solver bilateral Stat Point slack to absorb off-meta speeds, multi-turn recoil, and damage brackets. In `p1@p2` (Channel 2) and `p2@p1` (Channel 1), the observer's spreads are frozen to ground truth (`known[s] = true`) and all HP events on the observer's side expose exact `hp/maxhp` integers (`reconstruct.mjs:616, 925`). **23 of the 24 reports** had their dedicated cluster trace dispatched with `--views both@spectator` (which PASSED, 22 on default/wide and `2696868891` on Start 3 `wide`), leaving the failing single-view stall lines untraced outside `all.jsonl` (only `2695317483` has a complete `p2@p1` `GAVE UP` record in `all.jsonl`).

---

## 2. Root-Cause Mechanism

In `mimic` battles (`scripts/lib/mimic.mjs:39, 127-136`), 80% of Pokémon receive a Smogon usage spread (`USUAL = 0.8`) and 20% receive `randomSpread(rng, 66)` (or 100% random when the nature has 0 entries in `usage-spreads.json`). When a battle is evaluated in a single-player view (`p1@p2` or `p2@p1`), the observer's side has zero degrees of freedom and exact integer HP constraints, triggering a five-stage deadlock across `infer.mjs`, `knowledge.mjs`, and `reconstruct.mjs`:

1. **Freezing One Side + Channel 1/2 Exact Integer HP Removes Two-Sided Slack**:
   - `freshKnowledge` (`knowledge.mjs:141-145`) pins every spread on the observer's side (`known[s] === true`) to its planted ground truth, and `fallback`'s `unknown`/`cast` list (`infer.mjs:523-527, 576-580`) excludes the observer's Pokémon entirely.
   - Simultaneously, `hpRank` (`reconstruct.mjs:612-620`) and `steerDice`'s `bracket` (`reconstruct.mjs:925`) evaluate every hit/heal/recoil onto the observer's side with `secret = true` (exact `hp/maxhp` integer comparison), while the inferred side's own HP remains coarse `%` (`0..100`).
   - Any speed, damage, or recoil error on the inferred side can no longer be compensated by nudging the opponent's HP/Def/SpD/Spe (as `both@spectator` routinely does), and every attack into the observer must match exact integer damage rather than a 1%-wide bracket.

2. **Usage Priors & `defaultSpread` Trap Off-Meta/Random Speed & Bulk Tiers**:
   - `firstGuesses` (`infer.mjs:331-338`) starts either from `defaultSpread` (32 HP + 32 boosted stat + remaining SP) or `usualSpreads` (`usage.mjs:16-25`).
   - When the inferred side holds a 20%-random or tail-usage spread—for example, `Relaxed` Farigiraf with `spe: 11` (Spe 81 vs. 100% usage `0 Spe` = 72 under Trick Room in `2692252669`), `Adamant` Rillaboom with `spe: 8` under Tailwind against locked Scarf Rotom-Heat (`2709221540`), or `Careful` Torkoal with 0 usage entries (`2692349682`)—both `default` and `usage` starts place the Pokémon on the wrong side of a speed tie/threshold or exact-HP damage gate on turn `t`.

3. **`choose(0, ...)` Is Blind to Turn `t` & `level` Resets to `floor` on Flapping**:
   - After a rebuild fails on turn `t`, `settle()` reads evidence only from `built.inputLog` (verified turns `0..t-1`). Because turn `t` did not reproduce, any speed order (`orders`) or exact-HP damage tie introduced on turn `t` is absent from `knowledge`.
   - `choose(0, ...)` (`infer.mjs:1014-1054`) tests candidate spreads via `evidencePass(..., { exact: true })` only over `0..verifiedThroughTurn`, so it repeatedly returns spreads that satisfy turns `0..t-1` while breaking turn `t` (e.g. `2695317483`, where Turn 6 Primarina > Incineroar residual order is invisible on Turns 0–5).
   - Whenever `choose` picks a different failing spread (`unchanged === false`), `infer.mjs:1104-1106` resets `level = floor` (`0`), allowing the loop to flap between failing turns/lines (`mixOf`, `infer.mjs:1114-1122`) for 50+ rounds before reaching `budgets[3]` and `stop = 'searches'`.

4. **1D `fallback()` Deadlocks via 66-SP Cannibalization, `maxBacktracks: 0`, and Unused-Stat Starvation**:
   - **66-SP Cannibalization (`closestSpread`, `knowledge.mjs:648-683`)**: Raising a single stat (e.g., `Rillaboom spe: 32` in `2709221540`, `Floette atk: 32` in `2695290472`, or `Charizard spa: 0` in `2703692999`) forces `closestSpread` to pull SP away from `hp`/`atk`/`def`/`spd` to stay under `BUDGET = 66`. Under rigid observer exact HP, stripping `hp`/`atk`/`spd` breaks an earlier verified exact-HP hit (`reach(b)[0] < t`), so `sideOf(got) === 'early'`.
   - **Starvation of `FALLBACK_REBUILDS = 8` (`infer.mjs:798-817`)**: On non-`order` lines, `fallback` builds `dims` in fixed `STAT_IDS` order (`hp, atk, def, spa, spd, spe`) and bisects (`halving`) every stat whose `[min, max]` straddles `'early'` and `'same'`. Setting an unused stat (like `atk: 32` on a special attacker) squeezes `hp` under the 66-SP cap, creating a fake `'early'`/`'same'` straddle that burns all 8 (or 32 in `wide`) rebuilds before `fallback` ever tests `spe` or the true contributor.
   - **No Backtracking (`maxBacktracks: 0`) & `probe()` Premature `none()` (`infer.mjs:603-618, 679`)**: Both `base` and `probe()` run with `budgets[0]` (`maxBacktracks: 0`) against `handed = handOn(built, null)`. If `base` stops before turn `t` (`reach(base)[0] < t`, even after retrying `maxProbes: 600` with `maxBacktracks: 0`), `fallback` exits immediately with `none()` (`line 617`), poisoning `spend.fruitless` for that `mark`. And when `probe()` stops early (`reach(b)[0] < t`), its single retry (`line 687`) clears all `handed` pins (`given: null`), losing earlier exact-HP alignments while still failing to co-adjust coupled `(atk, hp)` or `(spe, bulk)` pairs (lines `833-845` only try pairs among `moved` dims, excluding any dim that stopped `'early'`).

5. **Single-View `reconstruct` Exhausts `probes` & Hits `stop = 'stuck'`**:
   - With the observer's HP exact and spreads frozen, `resolveTurn` cannot trade roll slack on the observer's side against the inferred side's `%` HP. When `maxProbes` is exhausted on turn `t` and `redrawTurn` (`reconstruct.mjs:2591-2600`) finds no earlier turn's roll capable of moving the rigid exact-HP line (`!moved`), `reconstruct` exits at `line 2600` with `stop = 'stuck'` (often before even incrementing `backtracks`), and all 6 restarts (`default`, `usage`, `wide`, `widest` tiers) cascade to `stop = 'searches'`.

---

## 3. Single Cohesive Fix Specification

All changes below preserve **complete soundness**: the simulator (`pokemon-showdown`) remains the sole source of damage, speed, HP, and turn-order mechanics; no spread is ever eliminated from `knowledge` outside `evidencePass`; and every hook operates generically by mechanism (no move- or species-specific rules).

1. **Unused-Stat Pruning & Earlier-Contributor Protection in `fallback()` (`scripts/lib/inference/infer.mjs`, `scripts/lib/inference/knowledge.mjs`)**:
   - **Skip non-participating flat stats in `dims` / `halving`**: Before running endpoint checks in `fallback()`, filter or deprioritize `atk`/`spa` on Pokémon whose observed actions in `built.rawLog` through turn `t` never used a physical/special attack (or triggered a physical/special `evidence` hook), so `halving` cannot burn `FALLBACK_REBUILDS` bisecting fake 66-SP straddles on unused stats ahead of `spe` or bulk.
   - **Co-adjusting `(targetStat, slackDonor)` under 66-SP saturation**: When `build([{ ...d, value }], knowledge)` yields a spread where `closestSpread` reduced a previously constrained stat (one narrowed below `SPAN` or active in turns `1..t-1`) and `probe()` stops `'early'` (`reach(b)[0] < t`), probe a paired shift that restores the earlier contributor (or shifts `targetStat` to a non-extreme value, e.g., `mid` / midpoint of `[d.now, end]`, while taking SP from the Pokémon's widest/unused stat) rather than treating `reach < t` as a dead end. Likewise, allow the 2-stat pair search (`infer.mjs:833-845`) to pair an `'early'`-stopping `spe` or primary offense dim with the earlier-turn contributor that broke (`whoIn` of `got.b.report.diffs[0]`).

2. **Allow Minimal Roll Backtracking (`maxBacktracks > 0`) in Single-View `fallback()` (`scripts/lib/inference/infer.mjs`)**:
   - In single-view mode (`known.some(Boolean)`), if `base` stops at `reach(base)[0] < t` under `budgets[0]` (`maxBacktracks: 0`), retry `base` with `budgets[1]` (`maxBacktracks: 2 * S`) before returning `none()` at `line 617`. Similarly, when a `probe()` with `handed` pins stops early (`reach(b)[0] < t`) or hits `stop = 'stuck'`, allow `budgets[1]` with `maxBacktracks: 2 * S` while retaining verified pre-`failed` pins where dice ordinals still match, preventing false `spend.fruitless` blacklisting.

3. **Early Opposite-Tier / Non-Usage Candidate Seeding & `floor` Monotonicity (`scripts/lib/inference/infer.mjs`)**:
   - **Opposite-tier candidate aims in `choose()` / restarts**: When `usage` priors share the same speed/bulk bias as `default` (or after Start 1 fails an order/exact-HP gate on turn `t` in single-view mode), seed non-usage opposite-speed-tier spreads (e.g., midpoint and opposite-end `spe` with balanced remaining SP) into `choose()`'s aim sequence (`infer.mjs:1026`) and `restarts()` when `usualSpreads` returned `[]` or clustered on one end (`0 Spe` vs `32 Spe`).
   - **Monotonic `level` across flapping turns**: When `unchanged === false` but `visited.has(signature(next))` or `markOf(diff)` was already seen in `failed` (`infer.mjs:1087, 1104-1106`), do not reset `level` back to `0` (`floor`); advance `floor` / `level` monotonically so `budgets[1..3]` (`maxBacktracks > 0` and `resample: 1`) are actually reached instead of cycling 50+ rounds at `level = 0`.

4. **Diagnostic Trace Dispatch Fix (Tooling / Cluster Runner)**:
   - When dispatching isolated `--trace` runs for sweep give-ups from `slowest_gave_up.json`, pass the exact failing view(s) recorded in `entry.views` (e.g. `--views p1@p2` or `--views p2@p1`) rather than defaulting to `--views both@spectator`.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2692252669` (`p1@p2` GAVE UP in 2,303.1s vs. `both@spectator` PASS in 431.6s)
- **Format / Setup**: `[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)`, 11-turn mimic (`skylervirgil` vs. `Chicken Munchies`). In `p1@p2` (Channel 2), P2 is locked to planted ground truth and Channel 2 exposes exact `hp/maxhp` on P2; P1 is inferred. `p2@p1` passed in `< 60s`; `both@spectator` passed in `431.6s` (15 rounds, `25,704` probes).
- **Planted Non-Usage Spread & Protocol Divergence**:
  - P1 `Farigiraf` (`Relaxed`, `+Def -Spe`) was planted with a 20%-random spread `{ hp: 5, atk: 4, def: 19, spa: 20, spd: 7, spe: 11 }` -> Lv.50 Speed `floor((60 + 11 + 20) * 0.9) = 81`.
  - **100% of `Relaxed` Farigiraf entries in `usage-spreads.json` run `0 Spe` (Spe 72)**; locked P2 `Primarina` (`Modest`, `spe: 0`) has **Spe 80**.
  - On **Turn 3 under Trick Room**, real `Primarina` (Spe 80) moves *before* `Farigiraf` (Spe 81), whereas usage-seeded `Farigiraf` (Spe 72) moves first, failing at:
    ```text
    wanted |move|p2a: Primarina|Hyper Voice|p1b: Incineroar|[spread] p1a,p1b
    got    |move|p1a: Farigiraf|Thunderbolt|p2a: Primarina
    ```
  - Downstream, P1 `Milotic` (`32/0/29/0/5/0`, HP 202, Def 128) uses `Coil` on Turns 4–5 (`+2 Def`), takes `Drill Run` from locked P2 `Mega Golisopod` (Atk 209) and `Moonblast` from locked `Primarina` (SpA 176), and heals `Leftovers` (`+12 HP`, `+6%`) across Turns 6–11 alongside dual `Hypnosis` sleep cycles.
- **Why `both@spectator` Passed While `p1@p2` Gave Up**: In `both@spectator`, Round 6 Turn 4 fallback fixed order via `Milotic spe 32` (`4 rebuilds, 29.9s`) and P2's free bulk/speed absorbed `Milotic`'s `Leftovers` rounding (`11/100` vs `10/100` at Round 14). In `p1@p2`, P2's locked stats and Channel 2 exact HP removed that slack, exhausting `["backtracks", "fallbackRebuilds", "probes", "searches"]` over `2,303.1s`.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2695317483` (`p2@p1` GAVE UP in 22,763.3s / 6.32 hrs in `all.jsonl` vs. `both@spectator` PASS in 264.5s)
- **Format / Setup**: `[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)`, 9-turn mimic. In `all.jsonl`, `p1@p2` passed in `28.7s` (10 rounds, `2,490` probes), `both@spectator` passed in `264.5s` (14 rounds, `21,788` probes), and `p2@p1` **GAVE UP in 22,763.3s** (`stop = "searches"`, `limits = ["backtracks", "fallbackRebuilds", "probes", "searches"]`, 54 rounds, 378 rebuilds, `4,342,528` probes).
- **Planted Stats & Turn 6 Deadlock**:
  - Locked P1 `Lopunny` (`Jolly`, `32 Atk`) has fixed `-1 Atk` (`85`) for `Triple Axel` into inferred P2 `Primarina` (planted random `{ hp: 4, atk: 30, def: 2, spa: 25, spd: 2, spe: 3 }`, HP 159, Def 96, **Spe 83**), while P2 `Incineroar` (`Adamant`, `32/32/0/0/2/0`) has **Spe 80**.
  - On **Turn 6**, `Lopunny`'s `Triple Axel` must hit `Primarina` for `98/100 -> 93/100 -> 85/100` (3, 8, 12 dmg), and at end-of-turn residual healing, `Primarina` (Spe 83) must heal from `Grassy Terrain` (`91/100`) and `Leftovers` (`96/100`) *before* `Incineroar` (Spe 80, `32/100`).
  - Because Rounds 1–4 never verified Turn 6, `settle()` never learned `Primarina > Incineroar` in `orders`. `choose(0)` repeatedly picked guesses where `Incineroar` (Spe 84) outsped `Primarina` (Spe 82), failing at:
    ```text
    wanted |-heal|p2b: Primarina|91/100|[from] Grassy Terrain
    got    |-heal|p2a: Incineroar|32/100|[from] Grassy Terrain
    ```
  - When `fallback` pushed speeds apart (`Primarina spe 32, Incineroar spe 0`), handed dice caused `Triple Axel` hit 3 to deal 11 instead of 12 (`stops at 6.8: wanted 85/100, got 87/100`). Every other stat probe disturbed Turns 1–5 (`reach(b)[0] < 6`), triggering 15–20s `given: null` rebuilds until `FALLBACK_REBUILDS` expired and `infer.mjs` cycled `level = floor = 0` across 54 rounds.
- **Why `both@spectator` Passed**: Bilateral slack on P1 `Lopunny`'s Atk allowed `choose(0)` in Round 10 to satisfy both Turn 6 `Triple Axel` `%` thresholds and `Primarina spe 2 > Incineroar spe 1`, locking `orders` for Rounds 11–14.

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2709221540` (`p1@p2` GAVE UP in 2,615.5s vs. `both@spectator` PASS in 95.6s)
- **Format / Setup**: `[Gen 9 Champions] VGC 2026 Reg M-C` (`gen9championsvgc2026regmc`), 8-turn mimic (`magicalarcher57` vs. `shirtisdirty`). `p2@p1` passed in `24.0s` (`2,105` probes); `both@spectator` passed in `95.6s` (14 rounds, `6,231` probes); `p1@p2` **GAVE UP in 2,615.5s** (`56` rounds, `180` rebuilds, `100,242` probes, `stop = "searches"`, `limits = ["backtracks", "fallbackRebuilds", "probes", "searches"]`).
- **Planted Stats & Turn 4/5 66-SP Cannibalization**:
  - Locked P2 `Rotom-Heat` (`Timid`, `Choice Scarf`, `{ hp: 5, atk: 0, def: 0, spa: 32, spd: 0, spe: 29 }`) has exact HP **130**, Def **127**, and Choice Scarf Speed `148 * 1.5 = 222`. Locked P2 `Armarouge` has exact HP `165`, SpD `110`.
  - Inferred P1 `Rillaboom` (`Adamant`, `{ hp: 30, atk: 25, def: 1, spa: 0, spd: 2, spe: 8 }`, Lv.50 Spe `113`) needs **`spe >= 7`** under Turn 3 `Tailwind` (`2 * (85 + spe + 20) > 222`) to move before `Rotom-Heat` on Turn 4—whereas `usage-spreads.json` top priors (`32/32/0/0/2/0`, `32/32/0/0/0/2`) both have `spe <= 2` (`Tailwind <= 214`), producing:
    ```text
    wanted |move|p1b: Rillaboom|Wood Hammer|p2b: Rotom
    got    |move|p2b: Rotom|Volt Switch|p1b: Rillaboom
    ```
  - **1D Fallback Cannibalization**: Setting `Rillaboom spe 32` under the 66-SP cap in `closestSpread` strips `hp` and `atk` SP, immediately breaking Turn 4 exact Channel 2 damage onto locked `Rotom-Heat` (`|-damage|p2b: Rotom|47/130`, requiring exact `83` damage), `Rillaboom` recoil (`27 HP -> 86/100`), Turn 5 `Rocky Helmet` (`59/100`) + recoil (`53/100`), and Turn 5 ally `Sludge Wave` KO (`0 fnt` on `Rillaboom` + exact `13/165` on `Armarouge`).
- **Why `both@spectator` Passed**: In Channel 0, `Rillaboom spe 32` cleared Turn 4 in 4 rebuilds (`10.0s`) because `Rotom-Heat`'s free HP/Def absorbed `Wood Hammer` to `%` brackets (`36/100`).

---

## 5. Merged Reports Manifest

All **24** reports in `bucket_F36.json` are listed below (`24 / 24` verified):

| # | Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|---|
| 1 | `gaveup-2692252669.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in `431.6s`; `p1@p2` untraced) | P1 random `Relaxed` Farigiraf `spe: 11` (Spe 81 vs. 100% usage 72) inverts Turn 3 Trick Room against locked P2 Primarina (80), plus Milotic +2 Coil / 6x Leftovers / dual sleep vs. Channel 2 exact HP. |
| 2 | `gaveup-2692349682.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in `97.3s`; `p1@p2` GAVE UP `149.7s`, `[probes, searches]`) | Fixed P2 + Channel 2 exact HP against 0-usage-entry `Careful` Torkoal (+ 2 randoms) caused `reconstruct` `stop='stuck'` (0 backtracks) and `fallback` `none()` in `< 8` rebuilds. |
| 3 | `gaveup-2694124237.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` in `69.7s`; `p2@p1` GAVE UP `719.2s`, `[fallbackRebuilds, probes, searches]`) | Fixed P1 (2 random spreads) + Channel 1 exact HP + width-6 Turn 4 invisible choices (Toxtricity fainted before acting) caused `reconstruct` `stop='stuck'` and P2-only `fallbackRebuilds` exhaustion. |
| 4 | `gaveup-2694716398.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` trace; `p2@p1` untraced, GAVE UP `49.5s`, `searches`) | Fixed P1 + Channel 1 exact HP removed bilateral slack around `p2b: Gardevoir`'s Turn 4 Sandstorm / Turn 6 Protect speed sandwich and Turn 5 `FuzzPlayer` switch. |
| 5 | `gaveup-2695290472.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` Start 6 #46 in `485.7s`; `p1@p2` GAVE UP `1,162.0s`) | Starts 1–5 starved bisecting unused `Floette atk` on Turn `4.7` (`Draining Kiss|[miss]`) before Start 6 hit `Floette spe: 20` (tying Sneasler 142); in `p1@p2`, fixed P2 Sneasler (`Spe >= 157 > 154`) + Channel 2 exact HP blocked the tie. |
| 6 | `gaveup-2695317483.md` | `gaveup` | `p2@p1` | `GAVE UP` (`p2@p1` in `all.jsonl`, `22,763.3s` / `6.32h`) | Fixed P1 Lopunny (`-1 Atk Triple Axel`) + Turn 6 `Primarina > Incineroar` residual heal order could not be solved by `choose(0)` (blind to Turn 6) or 1D `fallback` under handed dice, cycling 54 rounds. |
| 7 | `gaveup-2696868891.md` | `gaveup` | `p2@p1`, `both@spectator` (default sweep) | `PASS` (`both@spectator` Start 3 `wide` rebuild 32; `p2@p1` GAVE UP) | Turn 2 4-way speed/Fake Out flinch tie + 3/4 P2 non-usage random spreads + repeated flinches across 14 turns under locked P1 exhausted `searches`/`variants`. |
| 8 | `gaveup-2697369705.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` trace; `p1@p2` untraced, GAVE UP `626.2s`) | Zero P2 slack + Channel 2 exact HP against non-usage random P1 Delphox (`12/7/7/12/2/26`) hit `[backtracks, fallbackRebuilds, probes, searches]`. |
| 9 | `gaveup-2697711296.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in `1,014.4s`; `p1@p2` untraced) | Locked P2 (including random Raichu `spe <= 1`) + Channel 2 exact HP across Turn 4 `Matcha Gotcha` + Sitrus Berry + `Play Rough|[miss]` removed P2 slack. |
| 10 | `gaveup-2698373959.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` trace; `p1@p2` untraced, GAVE UP `428.8s`) | `p1@p2` (`known = [false, true]`, Channel 2 exact HP) hit `searches` across multi-target `Rock Slide`/`Hyper Voice` and flinch turns with P2 frozen. |
| 11 | `gaveup-2699344151.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` usage start R19; `p1@p2` GAVE UP `4,120.7s`) | `%`-masked P1 3-turn `Flare Blitz` recoil coupling on Incineroar + 3-way Speed tie (`Grimmsnarl 72` vs `Incineroar 72` vs `Kingambit 71`) under locked P2. |
| 12 | `gaveup-2700314248.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` in `67.2s`; `p2@p1` untraced, GAVE UP `487.9s`) | `p2@p1` (fixed P1 + Channel 1 exact HP) hit `[backtracks, probes, searches]` without `fallbackRebuilds`/`guessTries`. |
| 13 | `gaveup-2700688633.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` Start 2 `usage`; `p2@p1` GAVE UP) | Fixed P1 exact stats/HPs against off-meta P2 spreads (Sneasler #25/41, random Basculegion, Kingambit #18/45) + Turn 2 flinch speed order + `closestSpread` 66-SP stripping and `reach < t` aborts. |
| 14 | `gaveup-2700798384.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` in `105.0s`; `p2@p1` GAVE UP `971.5s`) | Fixed P1 Basculegion-F (195 HP surviving `1/195`) caused Rillaboom `default`/`usage#1` 32 Atk to trip Focus Sash on Turn 1, locking `held` prematurely and trapping tail-usage P2 spreads (#29 Rillaboom, #24 Dragonite). |
| 15 | `gaveup-2700875531.md` | `gaveup` | `p2@p1`, `both@spectator` (sweep contention) | `PASS` (`both@spectator` isolated 15T in `184.2s`; `p2@p1` GAVE UP `1,934.6s`) | Uninformative 1HKOs vs. exact P1 HP checks under locked P1 exhausted `[backtracks, fallbackRebuilds, probes, searches, variants]` in `p2@p1`. |
| 16 | `gaveup-2702862294.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in `62.6s`; `p1@p2` untraced, GAVE UP `130.4s`) | Locked P2 active spreads + Channel 2 exact `hp/maxhp` on Gliscor, Raichu, and Gholdengo left only P1 `%` HP (Whimsicott `1/100` without Sash, Charizard, Garchomp) under 66-SP rigidity. |
| 17 | `gaveup-2703692999.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` Start 3 #22 in `154.6s`; `p1@p2` GAVE UP `590.9s`) | Rank-0 Whimsicott consumed 8 fallback rebuilds on Turn `2.12` (`Moonblast|[miss]`) before rank-4 Charizard `spa=0` + `level=floor=0` reset cycle; `p1@p2` lost bilateral slack to Channel 2 exact HP. |
| 18 | `gaveup-2704366296.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` in `240.5s`; `p2@p1` untraced, GAVE UP `742.5s`) | Fixed P1 + Channel 1 exact HP against non-usage random P2 Raichu slower than Staraptor exhausted `[backtracks, fallbackRebuilds, probes, searches]`. |
| 19 | `gaveup-2704474984.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` Search 4 in `682.5s`; `p1@p2` GAVE UP `2,471.2s`) | Turn 4 vs. Turn 6 P1 Incineroar `Flare Blitz` recoil coupling (`91/100` vs. `4/100` after `+3` Passho `Hyper Voice`) + Base-60 Speed tie vs. locked P2 Primarina; 1D fallback could not co-adjust `(Incineroar atk/hp, Primarina hp/def, Incineroar spe)`. |
| 20 | `gaveup-2708420838.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` trace on `forced=[27]` Illusion; `p2@p1` untraced, GAVE UP `45.0s`) | `p2@p1` hit `[fallbackRebuilds, searches]` with 0 backtracks/probes on an untraced Turn 1 line while `spareDisguises()` wasted rebuilds on impossible Illusion masks. |
| 21 | `gaveup-2709221540.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in `95.6s`; `p1@p2` GAVE UP `2,615.5s`) | Rillaboom needed `spe >= 7` under Tailwind to outspeed locked Scarf Rotom (`222`), vs. usage `spe <= 2`; 1D fallback setting `spe=32` under 66-SP cap stripped HP/Atk, breaking Rotom's exact `47/130` HP and Turn 4/5 recoil/Rocky Helmet/Sludge Wave KO. |
| 22 | `gaveup-2709331203.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` trace; `p1@p2` untraced, GAVE UP `236.9s`) | Channel 2 exact-HP rigidity on locked P2 (including Turn 4 Incineroar `Flare Blitz` recoil off Sneasler's remaining HP) + 3 non-usage random spreads + invisible choices (Kingambit T1 faint, Sneasler T3 flinch). |
| 23 | `gaveup-2709683313.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in `52.9s`; `p1@p2` untraced, GAVE UP `782.4s`) | Channel 2 exact `hp/maxhp` + 66-SP brittleness on P1 (`Gholdengo`/`Tyranitar`) under `maxBacktracks: 0` fallback + Turn 1 invisible flinch on Golisopod (`270 > MAX_VARIANTS = 256`). |
| 24 | `gaveup-2711531781.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` in `30.2s`; `p2@p1` untraced, GAVE UP `415.9s`) | Fixed P1 + Channel 1 exact `hp/maxhp` (notably Turn 7 Sneasler `1/maxHP` Focus Sash and Turn 4 Golisopod survival) against non-top-3/random P2 spreads exhausted all 6 starts. |
