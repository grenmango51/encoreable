# F28: `fallback()` Stripping `exact`/`variants`/`rolls`/`resample` $\to$ `reach(base)[0] < t` Zero-Probe Abort & Permanent `spend.fruitless` Blacklist

## 1. Failure Overview & Status
- **Bucket ID**: `F28`
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` (`markOf`, `fallback`, `handOn`, `none`, `spend.fruitless`) & `scripts/lib/reconstruct.mjs` (`reconstructOnce`, `forget`, `variants`)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs:426` — `markOf = d => (d ? `${d.turn}|${d.index}|${d.expected}` : null)` embeds raw HP token strings (`%` vs. `hp/maxhp`), producing distinct keys for the same divergence across partial-`exact` and unproved rounds so `fallback` can run twice on the same line.
  - `scripts/lib/inference/infer.mjs:482-502` — `fallback(seen, start, proven)` defines `none = () => { searched.set(mark, 2); spend.fruitless.add(mark); return null; }` (`line 484`), discards `proven?.pins` (`proof.rolls`) and `built.variants` via `const handed = handOn(built, null)` (`line 492`), and inside `rebuild()` (`lines 495-502`) hardcodes `exact: null`, `pins: given`, and `sampleSeed` (dropping `proven?.exact` and active `budgets[level].resample`).
  - `scripts/lib/inference/infer.mjs:603-618` — `base` runs at `budgets[0]` (`maxBacktracks: 0`), optionally retries at `{ maxProbes: budgets[1].maxProbes, maxBacktracks: 0 }` (`lines 605-608`), then runs `dice = await rebuild(start, budgets[1])` (`line 610`). At `line 614`, `if (reach(base)[0] < t)` ignores `reach(dice)` and the fact that `built` already reached turn `t`, immediately calling `return none()` with `0` stat probes and permanently blacklisting `mark` in `spend.fruitless`.
  - `scripts/lib/inference/infer.mjs:959-970, 1089-1100` — The main loop passes `exact`, `pins` (`handOn(built, proof.rolls, proof.coupled)`), and `sampleSeed + resample` to `reconstruct`, and passes `exact ? { picks: next, exact, pins } : null` as `proven` to `fallback()` (`line 1091`), yet `fallback()` ignores `proven` until the post-win verification check (`line 864`). Meanwhile `spend` is shared across `budgets[level]` rounds and Illusion re-inferences (`lines 1148, 1333`).
  - `scripts/lib/reconstruct.mjs:2303, 2344-2349` — `reconstructOnce` initializes `const variants = new Array(segments.length).fill(0)` (`line 2303`) rather than preserving `built.variants` for turns `< t`, and on the initial `playThrough` divergence (`line 2344`) immediately executes `forget(held ? t + 1 : t)` (`line 2348`) *before* walking invisible-choice `variants[k]` for turn `k < t`, wiping downstream `pins` handed on by `handOn`.
- **Total Merged Reports**: **15** (`gaveup`: 15)
  - **View Breakdown in Sweep**:
    - `both@spectator` only: **10** (`gaveup-2695710426.md`, `gaveup-2696022780.md`, `gaveup-2699338706.md`, `gaveup-2699880847.md`, `gaveup-2701371897.md`, `gaveup-2703664880.md`, `gaveup-2706558287.md`, `gaveup-2707049524.md`, `gaveup-2708282365.md`, `gaveup-989795.md`)
    - `p1@p2` only: **2** (`gaveup-2692434097.md`, `gaveup-2694677695.md`)
    - `p2@p1` only: **1** (`gaveup-2699428221.md`)
    - `p1@p2` & `both@spectator`: **2** (`gaveup-2696959634.md`, `gaveup-2696986104.md`)
  - **Source Shard Clusters**: `S01-C07`, `S02-C10`, `S03-C04`, `S06-C08`, `S11-C04`, `S12-C08`, `S13-C06`, `S13-C07`, `S14-C08`, `S15-C11`, `S12-C10` (partial: `gaveup-2699880847.md`).

---

## 2. Root-Cause Mechanism

The main inference loop (`inferSpreads`, `infer.mjs:953-1124`) reaches a failing turn `t` (`built.report.diffs[0].turn === t`) using three critical pieces of state that stabilize turns `0..t-1`:
1. **`exact` & `proof.rolls`** (`infer.mjs:1072-1073`): verified exact-HP turn transcripts and damage rolls chosen by `evidencePass(..., exact: true)`, which resolve multi-hit spectator percentage quantization (`xx/100`) on turns `< t`.
2. **Non-zero prefix `variants[0..t-1]`**: invisible choices settled by `reconstructOnce` on earlier turns (e.g., a slot that fainted before acting on turn `k < t`, where `variant = 0` would play `+4 Protect` or `+3 Fake Out` and diverge).
3. **`budgets[level]` & `resample` (`sampleSeed + resample`)**: when `search 4` (`budgets[3]`, `resample: 1`) is active, its shifted `sampleSeed` clears upstream pure-RNG gates (accuracy misses, secondary status/flinch rolls, untargeted spread targets) that `sampleSeed` alone could not clear under `budgets[0..2]`.

When the main loop cannot advance past turn `t` (`unchanged || again || read < 2` at `infer.mjs:1089`), it calls `fallback(seen, start, exact ? { picks: next, exact, pins } : null)`:

1. **Prefix Context Stripped on Entry (`infer.mjs:492, 499-500`)**:
   - `fallback` calls `handOn(built, null)` (`line 492`) instead of preserving `proven?.pins` (`proof.rolls`), passes `exact: null` (`line 499`), omits `built`'s prefix `variants` (`reconstruct.mjs:2303` resets `variants` to `0`), and runs with bare `sampleSeed` (ignoring `budgets[level].resample`).
2. **Eager Pin Wipe on Prefix Variant Divergence (`reconstruct.mjs:2344-2349`)**:
   - Because `variants` starts at all `0`s, any earlier turn `k < t` that needed a non-zero invisible-choice variant diverges on `playThrough` (`run.badTurn = k < t`).
   - `reconstruct.mjs:2348` immediately executes `forget(held ? t + 1 : t)` *before* walking `variants[k]`, wiping all handed-on pins for turns `k..t-1`.
3. **Zero-Backtrack `base` Fails Upstream (`infer.mjs:603-608`)**:
   - `fallback` runs `base = await rebuild(start, budgets[0])` (`maxBacktracks: 0`), and if `reach(base)[0] < t`, retries with `maxProbes: budgets[1].maxProbes` while *still* keeping `maxBacktracks: 0` (`line 606`).
   - Without `exact`, `proof.rolls`, `resample`, or `maxBacktracks > 0`, `base` stalls on an already-verified upstream turn `k < t`: either at a coupled 1% spectator HP/recoil cliff (`2.12`, `4.9`, `5.16`, `6.10`) where `resolveTurn` cannot pair two 16-roll damage dice under `exact: null`, or at an upstream RNG gate (`2.7 Moonblast|[miss]`, `2.9 Dire Claw psn`, `5.6 Fissure|[miss]`, `5.10 flinch/par`, `5.12 Heat Wave`) that only `search 4` (`resample: 1`) cleared.
4. **False Abort on `reach(base)[0] < t` & Permanent Blacklist (`infer.mjs:614-618, 484`)**:
   - Even after `dice = await rebuild(start, budgets[1])` (`maxBacktracks: 2 * S`) runs at `line 610`, `line 614` checks **`if (reach(base)[0] < t)`**—completely ignoring `reach(dice)` and ignoring that `built` with `start === picks` *already* reached turn `t`.
   - `fallback` logs `the guess stops before the turn, at <k>.<idx>` and executes `return none()` (`line 617`) with **`0` stat probes** (`dims` / `probe()` at `lines 626-845` are never entered).
   - `none()` (`line 484`) calls `spend.fruitless.add(mark)`. Because `mark` is shared across subsequent `budgets[level]` escalations (`infer.mjs:1102-1103`) and across Illusion reading re-invocations (`lines 1148, 1333`), `fallback` is permanently locked out of turn `t` for the rest of the search, forcing `level` to exhaust `budgets[0..3]` (`stop = 'searches'`) or `stalled` / `mixOf` regression loops.
   - Compounding this, `markOf(diff)` (`line 426`) includes raw `diff.expected` text (`xx/100` vs. `hp/maxhp`), so partial-`exact` vs. non-`exact` rounds can produce different marks for the same `(turn, index)` divergence and run the abort path twice.

---

## 3. Single Cohesive Fix Specification

Keep every prefix invariant that already proved turns `0..t-1` intact inside `fallback()`, defer pin erasure across invisible-choice recovery, and prevent zero-probe pre-`t` aborts from blacklisting turn `t`:

1. **Preserve Prefix Proofs, Rolls, Variants, and Active `resample` in `fallback()` (`scripts/lib/inference/infer.mjs:492-502, 959-970`)**:
   - Have `reconstructOnce` (`scripts/lib/reconstruct.mjs`) return the settled prefix `variants` vector (it already tracks `variants` internally at `line 2303` and `best.variants` at `line 2368`) and accept an optional `variants` seed array for turns `< t` (keeping `variants` mutable during search).
   - Inside `fallback()`, preserve `proven?.exact` (filtered to turns `< t`) and `proven?.pins` (`proof.rolls` for turns `< t`, falling back to `handOn(built, null)` when `proven` is null) for the `base` and stat-probe rebuilds when `start === picks` (or keep `exact` up to `t - 1` when `start` differs only on `t`-relevant stats, falling back to `exact: null` if a stat perturbation invalidates an earlier turn), and inherit the active `resample` (`sampleSeed + resample` / `budgets[Math.max(1, level)]`) whenever `built` itself required `resample: 1` (e.g., `budgets[level].resample` is set) to reach turn `t`.
2. **Defer `forget(k)` Until Invisible-Choice Variants on Turn `k` Are Checked (`scripts/lib/reconstruct.mjs:2344-2349`)**:
   - When handed `pins` and an initial `playThrough` diverges at `k = run.badTurn < t` on a turn that has invisible choices (`run.widths?.[k] > 1` or `built.variants?.[k]`), restore/walk `variants[k]` (and preserve `subs` for turns `> k` until `variants[k]` finishes or proves insufficient) instead of wiping all `subTurn >= k` pins at `line 2348` before trying the prefix choice variants.
3. **Gate the Pre-Turn Abort on `reach(dice)[0] < t`, Not `reach(base)[0] < t` (`scripts/lib/inference/infer.mjs:603-618`)**:
   - `base` runs with `maxBacktracks: 0`. Never abort `fallback` at `line 614` on `reach(base)[0] < t` when `dice` (`maxBacktracks > 0`) reaches turn `t` (`reach(dice)[0] >= t`)—and if `dice` reaches `t` while `base` did not, promote `budget = budgets[1]` (or the active `resample` budget) for the stat probes so every probe can backtrack past the upstream ambiguity too.
4. **Canonicalize `markOf(diff)` and Never Permanently Blacklist Zero-Probe Aborts (`scripts/lib/inference/infer.mjs:426, 482-484, 614-618`)**:
   - Canonicalize HP tokens in `markOf(diff)` (`line 426`)—or key by `${d.turn}|${d.index}|${canonicalLine(d.expected)}` normalizing `hp/maxhp` vs. `%`—so the same divergence is not keyed twice.
   - Do **not** call `spend.fruitless.add(mark)` when `fallback` aborts before running any stat perturbations (`spent === 0` stat probes at `line 617`) or when budgets later widen (`level` increases to `resample: 1`, `wide`, or `widest`), so higher-budget rounds can still invoke `fallback` on turn `t`.
   - **Soundness Guarantee**: `fallback()` only searches for a *witness* spread within `knowledge` (never removing spreads from `knowledge`). Preserving prefix pins/variants/`exact`/`resample` and gating aborts on `reach(dice)` only avoids premature witness-search surrender while leaving every simulator check intact.

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2696022780` (`both@spectator`, `GAVE UP`, 88.9s trace / 646.8s sweep, `0` stat probes)
- **Ground Truth Exchange (Turns 2 & 3)**:
  - Turn 2: `p1b: Rillaboom` (`17/0/0/8/27/14`, `192 HP, 128 SpD`) switches in (`Grassy Surge`), then takes Rain-boosted `Weather Ball` from `p2a: Pelipper` (`2.6`, `49..58` dmg) and `+1 SpA` `Electro Shot` from `p2b: Archaludon` (`2.12`, `45..54` dmg). Combined `99` dmg leaves `93 / 192` HP (**`48/100`**), triggering `Sitrus Berry` (`141/192` = `73/100`) and `Grassy Terrain` (`153/192` = `79/100`).
  - Turn 3 (`3.7`): `p2b: Archaludon` (under `Tailwind`, `2×` Speed) outspeeds `p1a: Garchomp-Mega-Z` (`Spe 223`) and emits **`|cant|p2b: Archaludon|flinch`** (from `Rillaboom`'s `Fake Out`) *before* `p1a: Garchomp`'s `Dragon Pulse` on `p2a: Pelipper`.
- **Failure Trace (`trace_2696022780.log`)**:
  - In Default Round 7 and Usage Round 2, `reconstruct` received `exact` + `proof.rolls`, cleared Turn 2 (`48/100`, `73/100`, `79/100`), and stopped at `3.7` (`wanted |cant|p2b: Archaludon|flinch, got |move|p1a: Garchomp|Dragon Pulse|p2a: Pelipper`).
  - `fallback` then called `rebuild(start, budget)` with `exact: null` and `handOn(built, null)` (`infer.mjs:492, 499`). Under `exact: null`, `resolveTurn(2)` could not pair two 16-roll damage dice (`Weather Ball` at `2.6` + `Electro Shot` at `2.12`), leaving `Rillaboom` at `87/192 = 45/100`:
    ```text
    fallback on turn 3: the guess stops before the turn, at 2.12: wanted |-damage|p1b: Rillaboom|48/100, got |-damage|p1b: Rillaboom|45/100
    ```
  - Line `614` (`reach(base)[0] < 3`) aborted immediately with `0` stat probes and added `3|7||cant|p2b: Archaludon|flinch` to `spend.fruitless`, blocking `fallback` across `search 2..4` in all 6 starts (`18` fallback rebuilds total, `0` stat probes, `stop = 'searches'`).

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2706558287` (`both@spectator`, `GAVE UP`, 225.8s trace / 967.8s sweep, `0` Turn-8 stat probes)
- **Ground Truth Exchange (Turn 5 `5.16` & Turn 8 `8.0`)**:
  - Turn 5: `p1a: Incineroar` (`hp = 17` SP, `MaxHP = 187`) takes `59/100` (`111/187`), heals `+11` via Grassy Terrain to `122/187` (`65/100`), and takes `-23` poison at **`5.16`** to `99/187` (**`52/100 psn`**). (`112/187` also rounds to `59/100` and `123/187` to `65/100`, but yields `100/187 = 53/100` at `5.16`.)
  - Turn 8 (`8.0`): `p2b: Grimmsnarl` (`randomSpread`, `Sassy`) acts first (`|move|p2b: Grimmsnarl|Spirit Break|p1a: Incineroar`), while `p2a: Venusaur` fainted invisibly (`reconstruct` defaults `variants[8] = 0` to `+4 Protect`).
- **Failure Trace (`trace_2706558287.log`)**:
  - Rounds 12–16 (`exact` + `pins` active) cleared `5.16` cleanly and reached `8.0` (`wanted Grimmsnarl Spirit Break, got Venusaur Protect`).
  - Turn 8 `fallback` stripped `exact: null` and `built.variants`; `base` diverged on an earlier invisible-choice turn `k <= 5`, called `forget(k)` (`reconstruct.mjs:2348`), dropped Turn 5's pins, picked `112/187` (`59/100`), and hit `53/100` at `5.16`:
    ```text
    fallback on turn 8: the guess stops before the turn, at 5.16: wanted |-damage|p1a: Incineroar|52/100 psn|[from] psn, got |-damage|p1a: Incineroar|53/100 psn|[from] psn
    ```
  - Line `614` aborted on `reach(base) = [5, 16] < 8` without entering line `761` (`order && disputed.size`), blacklisting `8.0` in `spend.fruitless` across all 6 starts (`stop = 'searches'`).

### Proof C: `mimic:gen9championsvgc2026regmcbo3-2699338706` (`both@spectator`, `GAVE UP`, 635.5s trace / 3,302.2s sweep, 275 rounds)
- **Ground Truth Exchange (Turn 2 `2.7` & Turn 3)**:
  - Turn 1: `p2a: Floette-Mega` takes `-1` accuracy from `Basculegion-F`'s `Muddy Water`.
  - Turn 2 (`2.7`): `Floette-Mega` misses `Moonblast` (`75%` effective accuracy) on `p1a: Farigiraf` (`|move|p2a: Floette|Moonblast|p1a: Farigiraf|[miss]`), advancing to Turn 3 (`|-damage|p2a: Floette|26/100`).
- **Failure Trace (`trace_2699338706.log`)**:
  - `search 1..3` (`resample: 0`) stalled at `2.7` (`got Moonblast` hit). `search 4` (`budgets[3]`, `resample: 1`) cleared `2.7` and reached Turn 3 (`wanted Floette 26/100, got 21/100`), triggering `fallback on turn 3`.
  - Because `fallback` dropped `resample: 1` and ran under `budgets[0]/budgets[1]` (`sampleSeed`, `resample: 0`), every probe in `fallback` crashed back at `2.7` (`wanted Moonblast|[miss]`), aborting via `line 614` and cycling via `mixOf` back to Turn 2 across all 4 restart tiers (`275` rounds, `287,515` probes).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2692434097.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` only; `p1@p2` untraced) | Sweep failed only `p1@p2` in 187.1s (`stop = 'searches'`, `limits = ['backtracks', 'probes', 'searches']` without `fallbackRebuilds` or `guessTries`) due to early fallback abort / `spend.fruitless` blacklisting against frozen P2 exact integers, whereas the trace ran `--views both@spectator` and passed in 157.7s (12 rounds, 6,649 probes). |
| `gaveup-2694677695.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` Start 5; Starts 1–4 `GAVE UP`) | Turn 4 line `4.0` (wanted `Sylveon recharge` before `Kingambit` under Trick Room, got `Volcarona Protect`): `forget(1)` on Turn 1 `Incineroar` `Fake Out` wiped Turn 2–3 pins so `fallback` aborted at `3.3` in Starts 1/3/4, while Start 2 exhausted `8/8` rebuilds before `Kingambit spe 32` (and `p1@p2` gave up in sweep with fixed P2). |
| `gaveup-2695710426.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn `5.10` requires `Garchomp` `Rock Slide`'s 30% flinch check to fail and `Sneasler`'s 25% full paralysis check to succeed, which only `search 4` (`resample: 1`) solves to reach Turn 8 `Rillaboom` `Wood Hammer` recoil (`61/100` vs `62/100`); Turn 9 `fallback` drops to unresampled low budget/unpinned dice, crashes at `5.10` on every probe, and collapses via `mixOf` back to Turn 4. |
| `gaveup-2696022780.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 88.9s trace / 646.8s sweep, `stop = searches`, `0` stat probes) | Turn 3 line `3.7` (`\|cant\|p2b: Archaludon\|flinch` vs `Garchomp Dragon Pulse`): `fallback` passed `exact: null` and `handOn(built, null)` and aborted at `infer.mjs:614` when `base` stopped at Turn `2.12` (double Special hits `Weather Ball` + `Electro Shot` on `Rillaboom`), poisoning `spend.fruitless` with `0` stat probes across all 6 starts. |
| `gaveup-2696959634.md` | `gaveup` | `p1@p2`, `both@spectator` | `PASS` (`both@spectator` in widest at 5,083.8s; `p1@p2` untraced) | Turn 7 Trick Room intra-team speed tie (`p1 Farigiraf` vs `p1 Incineroar`, both Spe 72) triggers `fallback` on Turn 7, which strips handed-on dice pins and halts early at Turn `4.9` / Turn `6.10` razor-thin recoil rounding (`the guess stops before the turn`), aborting Turn 7 repair and cascading back to Turn 3 `Fake Out` flinch sweeps (and causing `p1@p2` to give up in sweep). |
| `gaveup-2696986104.md` | `gaveup` | `both@spectator`, `p1@p2` | `GAVE UP` | Turn 9 (wanted `\|-activate\|p1b: Incineroar\|move: Struggle`, got `\|cant\|p1a: Rillaboom\|flinch`): `fallback` evaluated the unpinned guess alone (`exact: null`), stopped at Turn `2.8` (`Rocky Helmet` `74/100` vs `75/100`), and aborted without testing Turn 9 Speed inversions (`p1@p2` also failed on unanchored P1 `Incineroar > Rillaboom` speed inversion). |
| `gaveup-2699338706.md` | `gaveup` | `both@spectator` | `GAVE UP` | `search 4` (`resample: 1`) clears Turn 2 (`2.7` `Moonblast\|[miss]`) and stalls at Turn 3 (`Floette 26/100` vs `21/100`), but `fallback on turn 3` downgrades to `budgets[1]` (`resample: 0`), so all probes crash at `2.7` before reaching Turn 3 across 275 rounds. |
| `gaveup-2699428221.md` | `gaveup` | `p2@p1` | `PASS` (trace only ran `both@spectator`) | Trace of `both@spectator` Start 1 exposed `handOn(built, null)` dropping `variants` so Turn 7 `fallback` failed earlier at `5.4` and blacklisted Turn 7 (`7.0` invisible `Sucker Punch` jump) in `spend.fruitless`; in `p2@p1` sweep (849.2s, no `fallbackRebuilds`/`guessTries`), fixed P1 spreads removed two-sided slack under the same `searches` exhaustion. |
| `gaveup-2699880847.md` | `gaveup` | `both@spectator` | `GAVE UP` | Stalled entering Turn 6: `fallback on turn 6` aborted at `5.11` `Politoed` `Leftovers` (`wanted 99/100`, `got 100/100`) before reaching Turn 6's Trick Room speed knife-edge (`Politoed 92` vs `Sinistcha 90`) and `Matcha Gotcha` drain quantization. |
| `gaveup-2701371897.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 222.3s trace / 1,154.0s sweep, `stop = searches`, `0` stat probes) | Turn 7 (`\|cant\|p1a: Delphox\|par` vs `Milotic Ice Beam`): `fallback` dropped `exact` and `built.variants`, triggering `forget(4)`/`forget(6)` at `4.9`/`6.5`, then `infer.mjs:614` checked `reach(base)[0] < 7` and poisoned `spend.fruitless` with `0` stat probes across all 6 starts. |
| `gaveup-2703664880.md` | `gaveup` | `both@spectator` | `GAVE UP` | `search 4` (`resample: 1`) clears Turn 5 (`5.6` `Fissure\|[miss]`) and stalls at Turn 8/9 (`Slowbro 35/100` vs `32/100`), but `fallback on turn 9` drops to `budgets[1]` (`resample: 0`) and stat perturbations shift Turn 1–4 PRNG draw counts, crashing every probe back at `5.6` and collapsing via `mixOf` to Turn 0. |
| `gaveup-2706558287.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 8 line `8.0` stalled on invisible `Venusaur Protect` / `Grimmsnarl` vs `Incineroar` speed order, and Turn 8 `fallback` aborted immediately at Turn 5 (`5.16`: `52/100` vs `53/100 psn`) without probing a single stat because `fallback` stripped `exact`/`variants` and checked `reach(base)` instead of `reach(dice)`. |
| `gaveup-2707049524.md` | `gaveup` | `both@spectator` | `GAVE UP` | `search 4` aligns PRNG to roll Poison on Turn 2 `Dire Claw` (`2.9`) and reaches Turn 3 `Arcanine 38/100 psn` (vs `43/100`), but Turn 3 `fallback` runs without inherited Turn 2 pins/`resample`, reverts to Sleep at `2.9` in 4.2s, and aborts without testing any spread against Turn 3. |
| `gaveup-2708282365.md` | `gaveup` | `both@spectator` | `GAVE UP` (8,895.1s, `stop = stalled`, 128 rounds, 542 rebuilds, 1,326,712 probes) | Turn 3 stalled at `3.5` (`Volcarona Giga Drain` before `Garchomp flinch`) because `Garchomp` entered end of Turn 2 leaving its Speed unconstrained; `fallback` on Turn 3 called `handOn(built, null)` + `maxBacktracks: 0`, failed Turn `2.7` `Light of Ruin` recoil (`69/100` vs `68/100`), and aborted via `reach(base)[0] < t` without testing `Garchomp spe`. |
| `gaveup-989795.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn `5.12` `Charizard` `Heat Wave` (untargeted spread move calling `getRandomTarget()` + 2 accuracy checks) only passes under `search 4` (`budgets[3]`, `resample: 1`) to reach Turn 6 (`Pelipper 81/100`); Turn 6 `fallback` runs without `resample`, halts at `5.12` (`the guess stops before the turn`), and aborts immediately without probing Turn 6 stats across 277 rounds. |
