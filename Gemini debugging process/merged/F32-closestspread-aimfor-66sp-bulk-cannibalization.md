# F32: `closestSpread` `k=0` (`hp`) 66-SP Tie-Break Cannibalization, `aimFor` Midpoint Shift, & Missing Interior Speed-Corridor Bisection

## 1. Failure Overview & Status

- **Bucket ID**: `F32`
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/knowledge.mjs` / `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/knowledge.mjs:636-645` (`defaultSpread`: seeds unverified `atk`/`spa = 32` up front)
  - `scripts/lib/inference/knowledge.mjs:648-683` (`closestSpread`, specifically lines `672-680`: `for (let k = 0; k < KEYS; k++)` with strict `<` `cost < win.cost`, breaking equal-L1 ties by stripping `hp`, then `def`, then `spd` first) — and identical ascending `k` + strict `<` loops in `closestTied` (`lines 713-734`) and `closestPaired` (`lines 745-781`)
  - `scripts/lib/inference/knowledge.mjs:795-809` (`aimFor`, specifically line `806`: jumps untouched/working stats to quantile midpoint whenever `values.length < SPAN`, even when `prev[s]` is still valid)
  - `scripts/lib/inference/infer.mjs:635-638` (`spots`: probes only `[min, max, mid]`), `700-713` (`judge` & `sideOf`: `d.moved` excludes probes where `r[0] < t`), `726-741` (`escort`: pushes paired `spe` only to extreme `ends`), and `798-845` (`halve` / `halving` / `moved` sweep: line `813` skips `halving` unless `ends` is `['early', 'same']`, missing interior speed corridors)
- **Total Merged Reports**: **13** (`gaveup` cases from `S04-C10`, `S05-C08`, `S07-C13`, `S08-C06`, `S09-C06`, `S10-C09`, `S11-C06`)
- **View Failure Breakdown in Sweep**:
  - `both@spectator`: **13 / 13** failed (`12` spectator-only failures; `1` dual failure)
  - `p1@p2`: **1 / 13** failed (`gaveup-2705940082.md`, alongside `both@spectator`)
  - `p2@p1`: **0 / 13** failed

---

## 2. Root-Cause Mechanism

All 13 failures share a tightly coupled 3-part guess-selection and fallback-probing pathology under the Champions **66-Stat-Point (`BUDGET = 66`)** cap:

1. **`closestSpread` `k=0` (`hp`-first) L1 tie-break cannibalization (`knowledge.mjs:672-680`)**:
   - `defaultSpread()` (`knowledge.mjs:636-645`) and Smogon usage priors (`usualSpreads`) routinely initialize Pokémon at or near `66/66` SP with `32` SP in `atk` or `spa`, even when no physical/special damage roll has constrained that offensive stat.
   - Whenever `choose()`, `aimed()`, or `fallback`'s `build()` (`infer.mjs:642-659`) raises `spe` (or `def`/`spd`) by $\Delta$ SP on a `66/66`-saturated spread, `aim` sums to $66 + \Delta$, so `closestSpread(kn, aim)` must shed $\Delta$ SP elsewhere.
   - Shedding $\Delta$ from `hp` vs. shedding $\Delta$ from unverified `atk`/`spa` produces the **exact same L1 distance** ($\text{cost} = 2\Delta$ when `c.stat` is pinned, or $\Delta$ in `aimFor`).
   - Because `keyOf(hp, def, spd) = (hp * 33 + def) * 33 + spd` (`knowledge.mjs:36`), iterating `for (let k = 0; k < KEYS; k++)` visits **smallest `hp` first**, then smallest `def`, then smallest `spd`. With strict inequality `if (!win || cost < win.cost)` (`line 679`, and identically in `closestTied:728` and `closestPaired:780`), **every equal-L1 tie is broken by draining `hp` (then `def`/`spd`) instead of shedding unverified `atk`/`spa`**.
   - Raising `spe` by even a few points immediately slashes bulk (`hp` or `def`/`spd`), breaking earlier-turn damage/recoil/healing percentages (`1.10`, `2.5`, `3.5`, `4.5`, `4.8`, `5.x`) and causing `spe` probes to fail early (`'early'`).

2. **`aimFor` midpoint jump on 66-SP-narrowed domains (`knowledge.mjs:806`)**:
   - Line `806` computes:
     ```js
     aim[s] = values.length && values.length < SPAN ? values[Math.floor((values.length - 1) * q + 0.5)] : prev[s];
     ```
   - Whenever `tighten()` (from the 66-SP budget or a 1-value bound such as `spe <= 31` or `hp <= 31`) reduces `values.length` below `SPAN` (`33`), `aimFor` unconditionally discards a **still-valid** `prev[s]` and jumps `aim[s]` to the range midpoint (or `0.25`/`0.75` quantile).
   - Combined with `closestSpread`, shifting an already-working Speed or bulk stat to midpoint repeatedly breaks verified turn orders/ties or forces `closestSpread` to strip `hp` to pay for the jump, causing `choose()` to fail exact verification (`unchanged = true`) and ping-pong across rounds.

3. **Extreme-ends-only probing & skipped interior corridor bisection in `fallback()` (`infer.mjs:704, 726-741, 798-845`)**:
   - Many Reg M-C battles constrain a Pokémon's Speed to a **strict interior corridor** $L \le \text{Spe} \le U$ (e.g., `Archaludon` `1 <= spe <= 12` in `2691287817`; `Rillaboom` `17 <= spe <= 20` in `2700950722`; `Primarina` `spe >= 26` with `spa < 32` in `2707163383`; `Sylveon` above `Basculegion` under non-Trick-Room Turn 6 while staying valid on Turn 4 Trick Room in `2711649070`).
   - `fallback()` first tests only the extreme alive ends `d.alive[0]` and `d.alive[n - 1]` (`line 812`). When the high end (`spe = 32`) fails early (either by flipping an earlier turn's speed order or by `closestSpread` draining `hp`/`bulk` under 66-SP saturation) and the low end (`spe = 0`) also fails early (e.g., breaking an earlier Trick Room or turn order), `ends` is `['early', 'early']`. Line `813` (`if (!ends.includes('early') || !ends.includes('same')) continue;`) **skips `halving` completely**.
   - Even when `ends` is `['early', 'same']`, `d.alive[n - 1]` triggers `escort()` (`lines 726-741, 750`), which only tries the other Pokémon's extreme `ends` (`0` or `32`), again draining its `atk`/`hp` under `closestSpread` and burning the 8-rebuild `FALLBACK_REBUILDS` cap before `halving` can bisect.
   - Meanwhile, `judge()` (`line 704`) only sets `d.moved = true` when `r[0] >= t && outcome(got.b) !== baseOutcome`. Any probe that failed earlier (`r[0] < t`) due to 66-SP bulk cannibalization or an earlier speed inversion gets `d.moved = false` and is excluded from both the single-stat sweep (`lines 825-832`) and the 2-stat pair search (`lines 833-845`), locking the search out of co-adjusting `(spe +, unused atk/spa -)`.

---

## 3. Single Cohesive Fix Specification

This fix preserves strict soundness (`AGENTS.md` Hard Rules 1–3): it never modifies simulator rules, never introduces move/species-specific heuristics, and never removes any spread from `knowledge`. It only changes **how witness spreads are selected and probed inside what already survives**:

1. **Unverified-First / Bulk-Preserving Tie-Breaking in `closestSpread` (`knowledge.mjs:648-784`)**:
   - When multiple surviving spreads tie for minimum L1 distance to `prev` (`cost === win.cost` in `closestSpread`, `closestTied`, and `closestPaired`, and identically in `best[sum]` / `upTo[r]`):
     - Break ties **against stripping bulk (`hp`, `def`, `spd`)** and **in favor of shedding unnarrowed/wide flat stats** (or equivalently: compute per-stat domain width `width[s] = aliveOf(...).length`, preferring to reduce stats with wider surviving domains / less evidence constraint, and among equal widths preferring to shed offensive flat stats `atk`/`spa` before `spe`, and `spe` before `hp`/`def`/`spd`).
     - Specifically, replacing the flat ascending `k` loop's strict `<` with a deterministic secondary tie-break tuple — e.g. `(unconstrainedFlatDrop, -hp, -def, -spd)` or checking `cost < win.cost || (cost === win.cost && betterTie(cand, win))` where `betterTie` prefers higher `(hp + def + spd)` (and higher `hp` first) when total L1 cost is equal — guarantees that adding $\Delta$ to `spe` on a `66/66`-SP spread sheds $\Delta$ from unused `atk`/`spa` rather than cannibalizing `hp` or `def`/`spd`.

2. **Keep Valid `prev[s]` in `aimFor` (`knowledge.mjs:806`)**:
   - In `aimFor(kn, prev, q = 0.5)`:
     - Only jump `aim[s]` to the quantile `values[Math.floor((values.length - 1) * q + 0.5)]` when `prev[s]` is **no longer surviving** (`!values.includes(prev[s])`) or when an explicit non-center quantile probe (`q !== 0.5`) is requested by `choose()`.
     - When `values.includes(prev[s])`, keep `aim[s] = prev[s]` so 66-SP domain narrowing (`values.length < SPAN`) does not knock working Speeds or bulk stats off valid values.

3. **Interior Corridor Bisection & Budget-Slack Pairing in `fallback()` (`infer.mjs:700-845`)**:
   - **Anchor bisection on `d.now` (`'same'`)**: In `fallback()` (`lines 809-817`), `d.now` is already a known `'same'` witness inside `d.alive`. When `ends` is `['early', 'early']` (or whenever `d.alive[0]` or `d.alive[n - 1]` returns `'early'` while `d.now` lies strictly in the interior `0 < idxNow < n - 1`), run `halving` on `[0, idxNow]` (with `['early', 'same']`) and `[idxNow, n - 1]` (with `['same', 'early']`) rather than skipping `halving` at line `813`.
   - **Also handle non-monotonic `'early'` midpoints from budget/order interactions**: If `halving` sees a midpoint `side === 'early'` on an `order` or HP-coupled dimension, allow checking `side` against the failing turn/cause or pairing `spe` shifts with shedding unconstrained flat SP (`atk`/`spa`) inside `build()` (which Fix #1 above achieves automatically via `closestSpread` tie-breaking!).
   - **Include `'early'` order-sensitive `spe` dimensions in `moved` / pair search (`lines 704, 825-845`)**: When `d.stat === 'spe'` (or when a probe failed `'early'` on a different line/turn than `baseReach`), record that the stat moved the execution trajectory so it is not locked out of 2-stat co-adjustment when coupled with another Pokémon's `spe` or its own budget-slack stat.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2691287817` (`both@spectator`, S11-C06)
- **True Planted Stats**:
  - `p2:3 Archaludon` (Modest): `{ hp: 32, atk: 0, def: 0, spa: 5, spd: 25, spe: 4 }` $\to$ **HP 197, Spe 109**
  - `p2:1 Rillaboom` (Adamant): `{ hp: 25, atk: 10, def: 9, spa: 2, spd: 20, spe: 0 }` $\to$ **HP 200, Spe 105**
  - `p1:0 Gholdengo`: **Spe 118**; `p1:4 Rillaboom`: **Spe 127**, **Atk 177** (`{ hp: 5, atk: 16, def: 15, spa: 6, spd: 2, spe: 22 }`)
- **Failure Trace (`Turn 4` residual order vs. `Turn 2`/`4` move orders)**:
  1. In Turn 4 residuals, `Grassy Terrain` (`onResidualOrder: 5, onResidualSubOrder: 2`) and `Leftovers` (`onResidualOrder: 5, onResidualSubOrder: 4`) share `order = 5, priority = 0`. Showdown's `comparePriority` compares `speed` before `subOrder`:
     - `|-heal|p2b: Archaludon|50/100g|[from] Grassy Terrain`
     - `|-heal|p2b: Archaludon|56/100|[from] item: Leftovers`
     - `|-heal|p2a: Rillaboom|96/100|[from] Grassy Terrain`
     With both guessed at `spe = 0` (`Spe 105 == 105`), `subOrder 2 < 4` forces `Rillaboom Grassy Terrain` ahead of `Archaludon Leftovers`:
     `wanted |-heal|p2b: Archaludon|56/100|[from] item: Leftovers, got |-heal|p2a: Rillaboom|96/100|[from] Grassy Terrain`.
  2. `Archaludon` has an **interior Speed corridor** **`1 <= spe <= 12`** (`106 <= Spe <= 117`): strictly faster than `p2:1 Rillaboom` (`>= 105`) on Turn 4 residuals, strictly slower than `p1:0 Gholdengo` (`118`) on Turn 4 Shadow Ball, and strictly slower than `p1:4 Rillaboom` (`127`) on Turn 2 Wood Hammer.
  3. `fallback()` probed only the upper extreme `Archaludon spe 31` (`Spe 136`), breaking Turn 2 line `2.3`:
     `stops at 2.3: wanted |move|p1b: Rillaboom|Wood Hammer|p2b: Archaludon, got |move|p2b: Archaludon|Electro Shot||[still]`.
  4. `escort()` then pushed `p1:4 Rillaboom` to its extreme `spe = 32`, which under `closestSpread` stripped SP from `Rillaboom`'s `atk`, breaking Turn 2 line `2.5`:
     `stops at 2.5: wanted |-damage|p2b: Archaludon|82/100, got |-damage|p2b: Archaludon|80/100`.
  5. Exhausting all `8` fallback rebuilds before bisecting into `1 <= spe <= 12`, `both@spectator` spun through 62 rounds, 314 rebuilds, and 3,751,815 probes over 17,856.5s before stopping on `searches`.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2707163383` (`both@spectator`, S10-C09)
- **True Planted Stats**:
  - `p1:2 Primarina` (Modest): `{ hp: 11, atk: 8, def: 4, spa: 4, spd: 7, spe: 32 }` $\to$ **HP 166, SpA 165, Spe 112**
  - `p1:4 Rillaboom` (Adamant): `{ hp: 7, atk: 22, def: 7, spa: 1, spd: 24, spe: 5 }` $\to$ **HP 182, Spe 110**
- **Failure Trace (`Turn 4` line `4.15` residual sort + `66-SP` `hp` stripping)**:
  1. Every start converged to `Primarina` at `9/0/0/32/0/25` (`Spe 105`, `66/66` SP) and `Rillaboom` at `14/32/0/0/18/0` (`Spe 105`), hitting Turn 4 line `4.15`:
     `wanted |-heal|p1a: Primarina|99/100|[from] item: Leftovers, got |-heal|p1b: Rillaboom|...| [from] Grassy Terrain` (same `105 == 105` `subOrder 2 < 4` tie-breaker).
  2. With `Rillaboom` already at `spe = 0`, only `Primarina spe >= 26` (`Spe >= 106`) could break the tie.
  3. However, `Primarina` held `spa = 32` (`66/66` SP). When `choose()` raised `spe` to `28` (or `fallback` probed `Primarina spe = 32, 28, 26`), `closestSpread` (`k = 0` ascending) preserved `spa = 32` and **drained `Primarina hp` (`9 -> 2, 6, 8`)**, breaking Turn 1 `1.10` (`Ice Beam` `86/100` vs `87/100`) and Turn 3 `3.5` (`Muddy Water` `79/100` vs `81/100`).
  4. Because `Primarina spe` probes stopped at `r[0] < 4`, `judge()` left `Primarina.spe` with `moved = false`, while `Primarina spa 0` kept `spe = 25` and hit `4.15` (`moved = false`), locking `(Primarina spe +, Primarina spa -)` out of pair search across all 6 starts (58 rounds, 264 rebuilds, 223,476 probes, `stop = searches`).

---

## 5. Merged Reports Manifest

| # | File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|---|
| 1 | `gaveup-2691287817.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 4 residual sort requires Archaludon Spe > P2 Rillaboom (105) for Leftovers (`subOrder 4`) to precede Grassy Terrain (`subOrder 2`), while Turn 2/4 move orders require Spe < 118 (corridor `1 <= spe <= 12`); `fallback` only probes `spe 0` and `spe 31` (breaking `2.3`), and `escort` pushes Rillaboom `spe 32` draining Atk under 66-SP cap (breaking `2.5`). |
| 2 | `gaveup-2691996838.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 346.9s trace / 1252.8s sweep, `stop=searches`, 30 rounds, 270 rebuilds, 181,882 probes) | At Turn `1.12` (wanted Floette flinch, got Volcarona Struggle Bug), the disputed speed-push `[Floette spe 32, Volcarona spe 0]` fails because `closestSpread` preserves Floette's unused `spa=9` and cuts 23 bulk SP, breaking Turn `1.11` (`88/100 -> 86/100`), while `Volcarona spe=0` gets `d.moved=false`. |
| 3 | `gaveup-2693304047.md` | `gaveup` | `both@spectator` | `GAVE UP` | A 4-way speed chain (`112 >= Spe(par +1 Kommo-o) > Spe(Rillaboom) > Spe(P1 Incineroar) > Spe(P2 Incineroar) >= 72`) across Turn 1 residuals (`Kommo-o` before `Rillaboom`) and Turn 7 action/residuals (`P1 Incineroar > P2 Incineroar` and `Rillaboom > P1 Incineroar`) caused 1D `fallback` to ping-pong between Turn 1 and Turn 7 across 300 rounds (`stop = 'stalled'`). |
| 4 | `gaveup-2694505800.md` | `gaveup` | `both@spectator` | `GAVE UP` | Under Trick Room on Turn 5 upkeep, Incineroar (Spe 80) vs Farigiraf (Spe 82) triggers `order = true` Grassy Terrain healing inversion; Farigiraf `spe 32` fixes the order but lands on `64/100` vs `65/100`, and 1D `fallback` breaks Turn 1 Salamence (`64/100`) or Turn 5 Dual Wingbeat/Giga Drain (121 rounds, `stalled`). |
| 5 | `gaveup-2699944057.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 2 Fake Out fallback set Milotic `def=32` while `spd=32` stayed anchored, forcing `closestSpread` to strip Milotic `hp` from `32` to `0` (170 HP), which broke Turn 5 Wood Hammer recoil (`71/100` vs `62/100`); restoring `hp=32` stripped `def` back to `0` in an inescapable 1D cycle. |
| 6 | `gaveup-2700758384.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 6 simultaneous flinch order requires `Spe(Indeedee) > Spe(Incineroar)`; `fallback` probes extreme `spe 32` on Indeedee or Incineroar, cannibalizing HP/Def under the 66-SP cap and breaking Turn `6.3` Fake Out (`79/100` vs `74/100`) or Turn `1.8` High Horsepower (`42/100` vs `37/100`), while lowering Incineroar `spe` reverses Turn `2.0` simultaneous switch order. |
| 7 | `gaveup-2700950722.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 2 three-way speed constraint (`Floette-Mega > Rillaboom > Dragonite-Mega`, Rillaboom `spe` in `[17, 20]`) failed because `closestSpread` stole `hp` instead of unused `atk` under 66-SP cap (breaking `2.5` and inverting halving), while `disputed` shadowed `Rillaboom spe 32` in `done` without updating `d.sides`. |
| 8 | `gaveup-2704060315.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 0 (`Pelipper > Incineroar`), Turn 1 (`Kommo-o > Pelipper`), and Turn 3 (`+1 Kommo-o > 2 * Pelipper` so `Kommo-o` emits `|cant|p1a: Kommo-o|flinch` at `3.5` before `Pelipper`'s `Hurricane` KOs and erases the flinch) require `Kommo-o spe = 32` and `Pelipper spe <= 17`, while raising `Kommo-o` bulk to survive `Hurricane` at `6/100` steals SP from `spe`/`spa` under the 66-SP cap. |
| 9 | `gaveup-2705940082.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` | Turn 5 (under Trick Room) requires `Sylveon < Archaludon`, while Turn 7 (after Trick Room expires) requires `Charizard < Archaludon` so `Archaludon` executes `[from] lockedmove` `Electro Shot` before `Charizard` OHKOs it with `Heat Wave`; raising `Archaludon spe` under the 66-SP cap breaks Turn 5 `Hyper Voice` (`69/100` vs `73/100`) and Turn 6 `Leftovers` (`84/100` vs `85/100`). |
| 10 | `gaveup-2707163383.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 line `4.15` (`wanted Primarina Leftovers`, `got Rillaboom Grassy Terrain`): `105 == 105` speed tie forced `GT (subOrder 2)` before `Leftovers (4)`. With `Primarina spa = 32` held by `closestSpread`, `Primarina spe > 25` drained `hp` and failed early (`1.10`/`3.5`, `moved = false`) while `Primarina spa 0` stayed at `4.15` (`moved = false`), preventing `(Primarina spe +, Primarina spa -)` pair search; Usage Starts also aborted `fallback` with 0 probes at `infer.mjs:614`. |
| 11 | `gaveup-2707789211.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 3 deterministic overkill recoil + 1/16th ticks (Staraptor `57/100 brn` vs `58/100`; Rillaboom `62/100` vs `63/100`) wasted 1.57M dice probes across search levels 1–4, while `fallback` SP probes cannibalized Staraptor `spe` and crashed 7/32 rebuilds at Turn `0.22` (Snow Warning before Intimidate). |
| 12 | `gaveup-2709514039.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 upkeep requires Archaludon (Spe 109) to heal before Rillaboom (Spe 108) while usage spreads favor faster Rillaboom; raising Archaludon `spe` steals SpD/HP under the 66-SP cap and breaks Turn 4 Hyper Voice (`39/100` vs `32/100`), while lowering Rillaboom `spe` breaks Grassy Glide (84 rounds, `searches`). |
| 13 | `gaveup-2711649070.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 6 line `6.4` (`wanted |cant|p1a: Sylveon|recharge`, `got |move|p2b: Basculegion|Muddy Water`): coupled bulk/SpA compensation left `Sylveon` (`95-97 Spe`) slower than `0`-SP `Basculegion` (`98 Spe`). On `[Sylveon spe 32, Basculegion spe 0]`, `closestSpread` drained `Sylveon hp` (`17->2` / `9->0`) instead of `spa`, failing Turn 4 `4.8` (`'early'`), while `Sylveon spe 0` failed `4.2` Trick Room (`'early'`), giving `ends = ['early', 'early']` which skipped `halve` and left `moved = []`. |
