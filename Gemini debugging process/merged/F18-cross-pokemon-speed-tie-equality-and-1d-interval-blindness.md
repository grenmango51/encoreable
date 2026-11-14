# F18: 1D `speed.mjs`/`knowledge.mjs` Interval Blindness on Overlapping Speeds & Cross-Pokémon `Spe(A) === Spe(B)` Ties

## 1. Failure Overview & Status

- **Bucket ID**: `F18`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/speed.mjs`, `scripts/lib/inference/knowledge.mjs`, `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/speed.mjs:874-915` (`bound()` & `applySpeed()` only prune `fast.flat.spe` against `minSlow` and `slow.flat.spe` against `maxFast`, discarding pairwise relations `tf[va] >= ts[vb]` whenever intervals overlap)
  - `scripts/lib/inference/knowledge.mjs:421-443` (`orderSpeeds(map, orders)` repeats the identical 1D `[min, max]` endpoint pruning across rounds, eliminating zero values on overlapping Speed intervals and failing to enforce `Spe_A === Spe_B` when opposing orders hold)
  - `scripts/lib/inference/infer.mjs:997-1080` (`choose()` pins Pokémon sequentially and, whenever `!exact` at lines 1074-1079, calls `closestSpread(kn, aimed(...))` independently per Pokémon without relational Speed constraints)
  - `scripts/lib/inference/infer.mjs:492, 603-618, 673-845` (`fallback()` searches 1 stat at a time over `{0, 32, 16}` / halving—never probing matched `Spe_A === Spe_B` pairs—and runs `budgets[0]` / `maxBacktracks: 0` with inherited `handed` dice, unable to flip the Speed-tie RNG coin on Turn `t` when `Spe_A === Spe_B` is tested)
- **Total Merged Reports**: **10** (`gaveup`: 10)
  - **View Breakdown**:
    - `both@spectator`: **10** failed in sweep (`2690654831`, `2691476984`, `2694723265`, `2699717100`, `2700883943`, `2704134250`, `2707136515`, `2708389587`, `2710272253`, `2711644952`)
    - `p1@p2`: **1** failed in sweep (`2711644952`)
    - `p2@p1`: **0** failed in sweep

---

## 2. Root-Cause Mechanism

In `both@spectator` (where neither side's spreads are fixed constants) and in mirror matches (`2711644952`), Speed constraints between two inferred Pokémon $A$ and $B$ are inherently **relational** ($\text{Spe}_A \ge \text{Spe}_B$, or $\text{Spe}_A = \text{Spe}_B$ across alternating turns). The inference engine currently projects every relational Speed rule onto 1D per-Pokémon marginals and searches spreads/dice in ways that cannot discover or maintain overlapping orders or exact ties:

1. **1D Interval Endpoint Blindness (`speed.mjs:874-887`, `knowledge.mjs:421-443`)**:
   - `bound({ fast, slow, tf, ts })` (`speed.mjs:874-887`) and `orderSpeeds(map, orders)` (`knowledge.mjs:421-443`) compute only `maxFast = max_{v alive}(tf[v])` and `minSlow = min_{v alive}(ts[v])`, eliminating `tf[v] < minSlow` and `ts[v] > maxFast`.
   - Whenever two inferred Pokémon have overlapping Speed ranges (e.g., `Archaludon [105..137]` vs `Rillaboom [105..137]` in `2707136515`, mirror `Archaludon` in `2711644952`, or two `Unburden` `Sneasler`s `[135..172]` / `[270..344]` in `2710272253`), `minSlow <= tf[v]` and `ts[v] <= maxFast` hold for every `v in 0..32`, so **zero Stat Points are eliminated**—and the pairwise constraint `tf[v_fast] >= ts[v_slow]` is not retained as a joint constraint during spread picking.
   - When `choose()` falls back to lines 1074–1079 (`if (!exact)`) or before the second order is reached, `closestSpread(kn, aimed(...))` selects each Pokémon's `spe` independently (e.g., usage prior `Rillaboom spe 2` vs `Archaludon spe 0` or `1`), repeatedly sampling inverted pairs (`2707136515`, `2711644952`). Even when `choose()` runs sequentially (`lines 1033-1049`), pinning `slow` first or failing `exact` across coupled bulk leaves `Spe_A < Spe_B` uncorrected.

2. **Cross-Pokémon Speed Ties (`Spe_A === Spe_B`) Unrepresentable & Unreachable by 1D `fallback` (`infer.mjs:626-845, 997-1079`)**:
   - In 7 of the 10 cases (`2690654831`, `2691476984`, `2699717100`, `2700883943`, `2704134250`, `2708389587`, `2710272253`), Pokémon $A$ acts before $B$ at Turn $t_1$ (`Spe_A >= Spe_B`) and $B$ acts before $A$ at Turn $t_2$ (`Spe_B >= Spe_A`) under identical relative Speed modifiers—proving an **exact Speed tie** (`Spe_A === Spe_B`).
   - **Why `choose()` misses ties**: Without an explicit `Spe_A === Spe_B` equality relation in `knowledge`, independent sampling over $33 \times 33 = 1,089$ `(spe_A, spe_B)` pairs hits a tie only $3\%$ of the time (`2710272253`), failing Turn $t_1$ or Turn $t_2$ 97% of the time. Even when both `orders` exist, `orderSpeeds` only prunes against endpoints, never intersecting `tf` and `ts` or locking `spe_B` when `spe_A` is chosen.
   - **Why `fallback()` cannot find ties (`infer.mjs:626-845`)**: When Turn $t_1$ passes under a strict inequality (`Spe_A > Spe_B`) and Turn $t_2$ stalls (`wanted B, got A`), `fallback` only perturbs **one stat at a time** over `{0, 32, 16}`. When $A$ and $B$ have different base speeds/modifiers (e.g., `+1 Modest Volcarona` vs `Hasty Mega Salamence` in `2690654831`, where the tie manifold is `S* = {(0,24), (1,25), (2,27), (3,28), (5,30), (6,32)}`), holding `Salamence spe = 32` while probing `Volcarona spe in {0, 32, 16}` never hits `spe = 6`, and pushing `A` to `0` (`early` at $t_1$) vs `32` (`same` at $t_2$) never triggers coordinated 2-Pokémon tie probing. In same-side/mirror ties (`2694723265`), 1D binary search requires 8 halving steps under contention or steals SP from bulk under the 66-SP cap (`2707136515`, `2711644952`), breaking earlier turns and blacklisting Turn $t_2$ in `spend.fruitless` (`infer.mjs:484`).

3. **`fallback` `maxBacktracks: 0` + `handed` Dice Prevents Tie-Flipping Even at Equal Speed (`infer.mjs:492, 603, 679`)**:
   - Even when `fallback` *does* land on `Spe_A === Spe_B` (as in `2699717100` when testing `p1a: Milotic spe 0, p2b: Milotic spe 0`), `fallback`'s `probe()` calls `rebuild(chosen, budget)` with `budget.maxBacktracks === 0` (`budgets[0]` or `{ maxProbes, maxBacktracks: 0 }`) and `given = handed` (`pins` from the prior round's Turn-$t_1$ failure/tie).
   - At `maxBacktracks: 0`, `reconstruct` cannot flip the newly introduced (or previously fixed) Turn-$t_2$ speed-tie coin draw (`resolveTurn(t2)`), so the exact ground-truth tie configuration still stops at $t_2$ (`'same'`) and is discarded! Moreover, when an earlier round ran without a speed tie (`Spe_A !== Spe_B`, 0 shuffle draws) and `fallback` introduces a tie (`Spe_A === Spe_B`, +1 shuffle draw at $t_1$), the draw-ordinal shift desynchronizes all handed-on pins from $t_1$ onward (`2708389587`), yet `infer.mjs:686` only retries with `given: null` if `reach(b)[0] < t`, not when `b` stops at `t` itself.

---

## 3. Single Cohesive Fix Specification

Represent pairwise Speed inequalities and mutual Speed ties directly in `speed.mjs`/`knowledge.mjs` using the simulator's own speed tables `(tf, ts)`, and extend `choose()` and `fallback()` to co-sample and tie-flip across linked pairs:

1. **Pairwise Speed Relations & Mutual Tie Tightening in `knowledge.mjs` (`orderSpeeds` & `choose()`)**:
   - Store active speed orders `(fast, slow, tf, ts)` alongside `knowledge` (already passed to `orderSpeeds(knowledge, orders)` at `infer.mjs:359, 1170`).
   - Whenever **both** `(A, B, ta, tb)` and `(B, A, tb, ta)` appear in `orders` (an exact tie `Spe_A === Spe_B` proved by the simulator's sorts across two turns), compute the common speed intersection $V = \{s : \exists v_A, v_B \text{ alive}, t_A[v_A] = t_B[v_B] = s\}$ and soundly eliminate every `v_A` with $t_A[v_A] \notin V$ and every `v_B` with $t_B[v_B] \notin V$. (This is 100% sound: if $t_A \ge t_B$ and $t_B \ge t_A$ at identical modifier tables—or verified same-order sorts—only equal speeds survive.)
   - **Relational Co-Sampling in `choose()` (`infer.mjs:997-1080`)**:
     - When `choose()` fails `exact` and falls back to `next[s][i] = closestSpread(...)` (`infer.mjs:1074-1079`), propagate each chosen `pick.spe` through `orderSpeeds` onto remaining linked Pokémon before picking their spreads, instead of sampling every Pokémon from unpinned 1D `knowledge`.
     - Inside `choose()` itself (`seq` ordering and candidate `aim` loop), when `id` participates in a mutual tie `(A, B)` in `orders`, constrain `B.spe` to `{ v_B : t_B[v_B] === t_A[pick_A.spe] }` (and when `A >= B` only, try `t_A[v_A] >= t_B[v_B]` pairs jointly) so `choose()` never wastes `guessTries` on impossible unequal-speed combinations.

2. **Coordinated Speed-Tie Pair Probing & Tie-Flipping in `fallback()` (`infer.mjs:620-845`)**:
   - In `fallback()`, when `order === true` on Turn `t` between actors `A` (`diff.expected`) and `B` (`diff.actual`):
     - Check whether `orders` (or an earlier turn `t_1 < t`) already requires the opposite order `B >= A` (or whether `A` and `B` have overlapping speed tables `ta` and `tb` from `speed.mjs`).
     - Probe **matched speed-tie pairs** `[(da, va), (db, vb)]` where `ta[va] === tb[vb]` (starting nearest `(da.now, db.now)` so minimal SPs are disturbed under the 66-SP cap, avoiding `closestSpread` stripping SpA/bulk as in `2707136515` / `2711644952`).
     - When probing a speed-tie candidate `(va, vb)` (or when `ta[va] === tb[vb]` introduces/preserves a speed tie on Turn `t`), allow `rebuild` in `fallback` to use `maxBacktracks >= 1` (e.g., `budgets[1]` on Turn `t`, or `given: null` when the number of speed-tie draws before/at `t` changed) so `resolveTurn(t)` can actually flip the speed-tie coin at Turn `t` instead of rejecting the true tie at `maxBacktracks: 0` (`2699717100`).

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2690654831` (`both@spectator` — Cross-Species Boosted Speed Tie `(0,24)..(6,32)`)
- **Failing View**: `both@spectator` (`p1@p2` and `p2@p1` both passed in `<30s`). Sweep: `3,408.1s`, trace: `680.8s`, `42` rounds, `418,353` probes, `stop = "searches"`.
- **Exact Math**:
  - `p1a: Volcarona` (`Modest`, base Spe `100`, `+1` from Turn 1 `Quiver Dance`): $\lfloor (120 + \text{SP}_{\text{Volc}}) \times 1.5 \rfloor \in \{180, 181, 183, 184, 186, 187, 189, \dots, 228\}$.
  - `p2b: Salamence-Mega` (`Hasty`, base Spe `120`, `+0`): $\lfloor (140 + \text{SP}_{\text{Sala}}) \times 1.1 \rfloor \in \{154, \dots, 180, 181, \dots, 189\}$.
- **Contradicting Turns**:
  - **Turn 3 (`3.6`–`3.7`)**: `|move|p1a: Volcarona|Flamethrower|p2a: Raichu` before `|move|p2b: Salamence|Hyper Voice` $\implies \text{Spe}_{\text{Volc}}(+1) \ge \text{Spe}_{\text{M-Sala}}$.
  - **Turn 4 (`4.3`–`4.4`)**: `|cant|p2b: Salamence|flinch` before `|move|p1a: Volcarona|Quiver Dance` $\implies \text{Spe}_{\text{M-Sala}} \ge \text{Spe}_{\text{Volc}}(+1)$.
  - Only the 6 tied pairs $S^* = \{(0, 24), (1, 25), (2, 27), (3, 28), (5, 30), (6, 32)\}$ satisfy both turns.
- **Exact Failure**: `fallback` held `Salamence spe = 32` (`189`) and tested `Volcarona spe in {0, 32, 16}`: `spe = 0` (`180 < 189`) broke Turn 3 (`stops at 3.6`), while `16, 32` (`>= 204 > 189`) stayed stuck at `4.3` (`nothing gets past the line in 61 rebuilds`).

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2710272253` (`both@spectator` — Alternating Mirror `Unburden` `Sneasler` Tie)
- **Failing View**: `both@spectator` (`p1@p2` passed in `22.7s`, `p2@p1` passed in `59.9s`). Sweep: `11,463.3s`, `256` rounds, `560` rebuilds, `2,623,081` probes, `stop = "stalled"`.
- **Protocol Sequence**:
  - Both `p1b: Sneasler` (`Electric Seed` Turn 1) and `p2a: Sneasler` (`Grassy Seed` Turn 4) are `Adamant`, planted `spe = 32`, `Unburden` Spe = `344`.
  - **Turn 4 Residual**: `|-heal|p2a: Sneasler|46/100|[from] Grassy Terrain` before `|-heal|p1b: Sneasler|14/100|[from] Grassy Terrain` ($\text{Spe}_{p2a} \ge \text{Spe}_{p1b}$).
  - **Turn 5 Residual**: `|-heal|p1b: Sneasler|19/100|[from] Grassy Terrain` before `|-heal|p2a: Sneasler|52/100|[from] Grassy Terrain` ($\text{Spe}_{p1b} \ge \text{Spe}_{p2a}$).
  - **Turn 6 Residual**: `p2a: Sneasler` (`57/100`) before `p1b: Sneasler` (`25/100`).
- **Exact Failure**: `bound()` / `orderSpeeds()` eliminated 0 values across `[0..32]` (`[135..172]`), and independent `spe` sampling failed Turn 4 (`expected p2a 46/100, actual p1b 14/100`) or Turn 5 (`expected p1b 19/100, actual p2a 52/100`) on 97% of pairs, stalling for 256 rounds.

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2699717100` (`both@spectator` — `maxBacktracks: 0` Prevents Tie-Flipping Even at `spe = 0, spe = 0`)
- **Failing View**: `both@spectator` (`p2@p1` `<35s`, `p1@p2` `<30s`). Sweep: `3,662.0s` / trace: `781.8s`, `74` rounds, `326` rebuilds, `395,593` probes, `stop = "stalled"`.
- **Contradicting Turns**: `p1a: Milotic` (`Modest`, base Spe `81`) vs `p2b: Milotic` (`Calm`, base Spe `81`):
  - **Turn 2**: `p2b: Milotic Hypnosis` before `p1a: Milotic Coil` ($\text{Spe}_{p2b} \ge \text{Spe}_{p1a}$).
  - **Turn 5**: `|cant|p1a: Milotic|slp` before `|cant|p2b: Milotic|slp` ($\text{Spe}_{p1a} \ge \text{Spe}_{p2b}$).
- **Exact Failure**: Turn 2 fallback locked `p1a: Milotic spe 0` (`p2b > p1a`). On Turn 5, when fallback tested `[p1a: Milotic spe 0, p2b: Milotic spe 0]` (an exact tie!), `maxBacktracks: 0` with `handed` dice kept the Turn 5 coin flip favoring `p2b`, reproducing `stops at 5.5: wanted |cant|p1a: Milotic|slp, got |cant|p2b: Milotic|slp` and rejecting the true Speed tie.

### Proof 4: `mimic:gen9championsvgc2026regmcbo3-2707136515` (`both@spectator` — 1D Overlap `[105..137]` & 66-SP Bulk Coupling)
- **Failing View**: `both@spectator` (`p1@p2` `17.4s`, `p2@p1` `21.4s`). Sweep: `15,313.4s`, `263` rounds, `803` rebuilds, `4,413,193` probes, `stop = "searches"`.
- **Turn 6 Residual**: `p2a: Archaludon` (Modest, base `85`, planted `spe = 3` -> `108`) healed via `Grassy Terrain` (`64/100`) and `Leftovers` (`71/100`) before `p1b: Rillaboom` (Adamant, base `85`, planted `spe = 0` -> `105`, `86/100`).
- **Exact Failure**: Both Pokémon have `[105..137]` Speed ranges, so `bound()` removed 0 values. Guesses kept `Rillaboom > Archaludon`; `fallback` tried `Archaludon spe 32, Rillaboom spe 0`, stripping `Archaludon spa` under the 66-SP cap and breaking Turn 3 `Snarl` (`wanted |-damage|p1b: Raichu|65/100, got 68/100`), blacklisting Turn 6 in `spend.fruitless`.

---

## 5. Merged Reports Manifest

| Source Report | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2690654831.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 680.8s trace / 3,408.1s sweep, `searches`) | Turn 3 (`Volcarona +1 > Mega Salamence`) vs Turn 4 (`Mega Salamence > Volcarona +1` flinch) forces exact tie `S* = {(0,24)..(6,32)}` unreachable by 1D `fallback` `{0, 32, 16}` (`61` rebuilds). |
| `gaveup-2691476984.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 17,477.5s sweep, `stalled`) | Turn 0/1/2 alternating speed tie between P1 and P2 `Incineroar` (`80 == 80`; raising both to `32` ties `Rillaboom 112` and breaks Turn 2 Grassy Terrain heal order), compounded by Turns 4–5 coupled Sitrus/recoil/terrain rounding across 339 rounds. |
| `gaveup-2694723265.md` | `gaveup` | `both@spectator` | `PASS` (isolated 15T trace in 219.0s; `GAVE UP` in sweep at 1,739.0s) | Exact same-side speed tie (`Archaludon spe 17` == `Charizard 122`) required Turn-9 `fallback` binary search (`limits = ['backtracks', 'fallbackRebuilds', 'probes', 'stalled']`), stalling under cluster sweep contention. |
| `gaveup-2699717100.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 781.8s trace / 3,662.0s sweep, `stalled`) | Turn 2 (`p2b: Milotic >= p1a: Milotic`) vs Turn 5 (`p1a: Milotic >= p2b: Milotic`) speed tie; testing `spe = 0 == 0` at Turn 5 still failed `5.5` (`|cant|p1a: Milotic|slp`) because `maxBacktracks = 0` + `handed` dice locked the Turn 5 coin flip. |
| `gaveup-2700883943.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, `searches`) | Allied `Sneasler` and `Mega Salamence` tied at `189` Spe (`Salamence -> Sneasler` Turn 3, `Sneasler -> Salamence` Turn 4); setting `Salamence spe 16` (`171 > 170`) passed Turn 3 and deadlocked on Turn 4 across 128 1-stat fallback rebuilds. |
| `gaveup-2704134250.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 306.8s trace / 2,306.7s sweep, `searches`) | P1 `Venusaur` (`117`) and P2 `Archaludon` (`117`) speed-tied in opposite directions on Turn 4 (`Venusaur` first) and Turn 10 (`Archaludon` first: `|cant|p2a: Archaludon|slp` vs `Sludge Bomb`); unequal speeds broke Turn 4 (`4.5`) or Turn 3.9 (`38/100` vs `35/100`). |
| `gaveup-2707136515.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 15,313.4s sweep, `searches`) | Turn 6 Grassy Terrain residual order (`Archaludon 108 > Rillaboom 105`, both `[105, 137]`): 1D `bound()` eliminated `0` SPs, `fallback` `Archaludon spe 32` stripped `spa` under 66-SP cap breaking Turn 3 `Snarl` (`65/100` vs `68/100`), and `infer.mjs:484` blacklisted Turn 6 in `spend.fruitless`. |
| `gaveup-2708389587.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 9,029.0s sweep, `stalled`) | Turn 4 vs Turn 8 alternating speed tie (`Incineroar 106 == Archaludon 106`): unequal speeds failed Turn 4/Turn 8 or removed Turn 4's shuffle die (desynchronizing Turn 6 burn/Sitrus PRNG), while 66-SP reallocation broke Turn 3 damage/recoil across 148 rounds. |
| `gaveup-2710272253.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 11,463.3s sweep, `stalled`) | Turns 4–6 alternating `Unburden` `Sneasler` Grassy Terrain heal order (`344 == 344`: `p2a` T4, `p1b` T5, `p2a` T6) proves `Spe(p1b) === Spe(p2a)`, which 1D `bound()`/independent `choose()` failed 97% of the time across 256 rounds. |
| `gaveup-2711644952.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` (`searches`) | Full 6v6 mirror stalling at Turn 10 `p1a: Archaludon Electro Shot` vs `p2b: Archaludon Dragon Pulse` (identical `[105, 137]`): 1D `bound()` failed to enforce `p1a >= p2b`, and forcing `spe 32` stripped bulk breaking Turn 2 Stamina (`83/100` vs `80/100`) and Turn 3 Leftovers (`95/100` vs `94/100`) across 128 rebuilds. |
