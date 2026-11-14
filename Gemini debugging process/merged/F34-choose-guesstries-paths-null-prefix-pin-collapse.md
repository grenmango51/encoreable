# F34: `choose()` `guessTries` (`32*S*W`) & `paths()` `null` Wiping Verified `exact = null; pins = null;`, Collapsing Late Turns to Turn 0–3

## 1. Failure Overview & Status

- **Bucket ID**: `F34` (`choose-guesstries-paths-null-prefix-pin-collapse`)
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` & `scripts/lib/inference/evidence.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs:313-339` (`exactHp` / `firstGuesses`: empty `exactHp` in Channel 0 leaves both sides unknown and active cast `order.length = 6–8`)
  - `scripts/lib/inference/infer.mjs:997-1071` (`choose()`, `tries = 32 * S * W`, `seq`, `blocks()`, fail-first `while (!proof && tries > 0)` loop exhausting `guessTries` at $2N$ tries per 8-Pokémon branch)
  - `scripts/lib/inference/infer.mjs:1072-1080` (`exact = proof?.exact || null; pins = proof ? handOn(built, proof.rolls, proof.coupled) : null;` wiping verified turns & dice and overwriting `next` with uncoupled `closestSpread(kn, aimed(...))`)
  - `scripts/lib/inference/infer.mjs:1114-1122` (`mixOf` fallback also resetting `exact = null; pins = null;` on revisited spread signatures)
  - `scripts/lib/inference/evidence.mjs:256-261` (`evidencePass({ exact: true })` calling `ctx.paths(pre)` & `exactTurns(...)` across `0 .. prefix.cutoffAt`)
  - `scripts/lib/inference/evidence.mjs:3904-4063` (`paths(raw)`: chronological greedy `h2 = options.includes(own) ? own : options[0]` at lines `4030-4031`, returning `null` at line `4011` on `dealt`/`totals`/`sourceStates` coupling cliffs at lines `3979-4005`)
  - `scripts/lib/reconstruct.mjs:1730-1762` (`brokenProof`: binds `exact` and `pins.proof` strictly to the witness spreads that produced them)
- **Total Merged Reports**: **58** (`kind: "gaveup"` for all 58/58)
- **View Breakdown Across Sweep**:
  - `both@spectator` failed: **58 / 58** (`100%`)
  - `p1@p2` failed: **1 / 58** (`gaveup-2693525101.md`)
  - `p2@p1` failed: **1 / 58** (`gaveup-2693525101.md`)
  - `both@spectator`-only failures: **57 / 58**; all-3-views failures: **1 / 58** (`gaveup-2693525101.md`)
- **Source Shard Clusters Merged**: `S07-C11`, `S07-C12`, `S08-C11`, `S09-C09`, `S10-C11`, `S11-C07`, `S14-C12`, `S15-C15`, plus pin-collapse subsets of `S01-C13`, `S02-C15`, `S03-C11`, `S04-C12`, `S05-C09`, `S06-C11`, `S08-C13`, `S12-C10`.

---

## 2. Root-Cause Mechanism

F34 is a **two-stage coordinator + path-builder failure** between `choose()` (`infer.mjs:1004-1080`) and `paths(raw)` (`evidence.mjs:3904-4063`) that destroys verified multi-turn progress whenever Channel 0 (`both@spectator`)—or a tightly coupled single-view game (`2693525101`)—reaches a late-turn coupled recoil/drain/residual/speed-gate divergence at turn $t$.

### 2.1 Why Channel 0 Coupled Battles Starve `choose()` (`tries = 32 * S * W`)

1. **Both Sides Unknown (`order.length = 6–8`)**:
   In Channel 0 (`channel = 0`), `exactHp` (`infer.mjs:313-322`) captures nothing because every `|switch|` / `|drag|` / `|replace|` prints `100/100` (`Number(m[2]) === 100`). Both `known[0]` and `known[1]` are `false`, so by Turns 4–11 `order` (`infer.mjs:997-1001`) contains **$N = 6$ to $8$ active Pokémon** simultaneously (versus $N \le 4$ in single-view inference, where Channel 1/2 exact HP also decouples damage equations linearly).
2. **$2N$ Tries per Single Branch vs. Fixed `tries = 32 * S * W` (`infer.mjs:1004-1054`)**:
   In `choose(n, cond)`:
   - At each depth $n \in [0, N-2]$, the loop tests `first = closestSpread(kn, aim)` by pinning `(hp, def, spd)` in `keyed` (`tries--`, `await settle(...)`, line `1037-1038`), then pinning all 6 stats in `narrowed` (`tries--`, `await settle(...)`, lines `1046-1047`)—consuming **2 tries per intermediate Pokémon**.
   - At depth $N - 1$, it runs `keyed` (`1` try, skipping `narrowed` since `n < seq.length - 1` is `false`).
   - At the leaf (`n === seq.length`, lines `1015-1020`), it runs `evidencePass({ ..., exact: true })` (`1` try).
   - Thus **one single full-depth leaf evaluation costs $2(N - 1) + 1 + 1 = 2N$ tries** (14 tries for $N=7$, **16 tries for $N=8$**).
   - With `tries = 32 * S * W` (`32` on `default` and `usage` starts when `S=1, W=1`), **`choose()` can evaluate at most 2 complete branches for $N=8$** (or 1 branch plus a handful of `blocks()` retries / `seq[7]` aim variants) before hitting `tries <= 0` (`limits.add('guessTries')` at line `1027`).
3. **Simultaneous 0.5-Quantile Perturbation Before Any Working Witness**:
   At line `1026`, `choose()` tries aims in order:
   ```js
   [...fixed, aimFor(kn, picks[s][i]), picks[s][i], aimFor(kn, picks[s][i], 0.25), aimFor(kn, picks[s][i], 0.75)]
   ```
   Because `aimFor(kn, picks[s][i])` (0.5 quantile of each narrowed marginal range) precedes `picks[s][i]`, `choose()` immediately shifts **all $N = 7$–$8$ Pokémon simultaneously** away from `picks` (the very witness that had just reproduced Turns `0 .. t-1`) into an unverified 8-way combination in fixed team-slot order (`seq = order.slice()`). When that first branch fails `paths()` or `blocks()`, `tries` is nearly half-spent; the `while (!proof && tries > 0)` fail-first loop (`infer.mjs:1064-1071`) shares the same `tries` counter and immediately runs out.

### 2.2 Why `paths(raw)` Returns `null` (`evidence.mjs:3904-4063`)

Even when `choose()` reaches a leaf (`n === seq.length`) and calls `evidencePass({ ..., exact: true })`, `paths(raw)` fails to return a proof for two coupled reasons:

1. **Cross-Pokémon Coupling Evaluated Greedily Without Backtracking**:
   `backward()` (`evidence.mjs:3719-3878`) prunes each Pokémon's `rec.alive[i]` independently (carrying cross-Pokémon dependencies only through marginal `dealtOk` and `allowSet` sets). When `paths(raw)` walks all Pokémon's `entries` sorted by `seq` (`evidence.mjs:3907`), it verifies exact cross-Pokémon integer equalities in real time:
   - Exact recoil/drain damage matching (`evidence.mjs:3979-3980, 3998`):
     ```js
     const amounts = e.change.dealtOf?.get(g);
     const dealt = amounts && e.change.victim ? dealtBy.get(e.change.victim) : null;
     ...
     if (dealt && (amounts[j] !== dealt.amount || tag % SPAN !== dealt.v)) continue;
     ```
   - Multi-hit / Shell Bell totals (`lines 3985-3991, 3999`): `totals` & `totalV`.
   - Exact attacker HP/extra-stat state (`lines 3970-3971, 4001-4005`): `sourceStates` matching `cur.get(e.change.dealtBy)`.
   - Whenever multiple integer HPs fall inside the same spectator percentage $\lfloor 100 \cdot h / M \rfloor$ (where 1% is $\approx 1.5$–$2.2$ HP for $M \in [150, 220]$), `options` contains multiple valid HPs (`|options| > 1`), or `cur` starts at `hs[0]` (`line 3952`). Yet `paths()` picks **one** `h2` greedily without backtracking (`line 4031`):
     ```js
     const h2 = options.includes(own) ? own : options[0];
     ```
     If an earlier step picked an `own` (from a slightly drifted scaffold) or `options[0]` whose `h - h2` (`dealtBy`) or `cur` HP later violates a capped recoil ($\lfloor \text{victim\_hp}/3 \rfloor$), drain ($\lfloor \text{damage}/2 \rfloor$), or `50/100y` Sitrus Berry border on a coupled partner, `options.length` drops to `0` at line `4011` and `paths()` returns `null`—even when `options[1..]` at the earlier step had a valid joint path.
2. **All-or-Nothing Scope (`0 .. prefix.cutoffAt`)**:
   `evidencePass` runs through `prefix.cutoffAt` (`evidence.mjs:158-181`, inside the failing Turn $t$). If the candidate spreads `cond` cannot bridge Turn $t$ (because `built` diverged at Turn $t$ and the spreads need a Turn-$t$ repair), `paths()` fails inside Turn $t$ and returns `null` for the **entire** `0 .. t` prefix, throwing away the already-verified Turns `0 .. t-1`.

### 2.3 The Catastrophic Prefix & Pin Wipe (`infer.mjs:1072-1080`)

When `choose()` returns `proof = null` (from either `guessTries` or `paths() === null`), `infer.mjs:1072-1079` executes:
```js
exact = proof?.exact || null;
pins = proof ? handOn(built, proof.rolls, proof.coupled) : null;
if (!exact) {
  for (const [s, i] of order) {
    const id = `p${s + 1}:${i}`;
    const kn = knowledge.get(id);
    next[s][i] = closestSpread(kn, aimed(id, kn, picks[s][i])) || next[s][i];
  }
}
```
This triggers a four-step collapse cycle:
1. **Total Erasure of `exact` and `pins`**: Overwriting `exact = null; pins = null;` discards every exact intermediate HP turn (`0 .. t-1`) and every settled RNG ordinal (`pins.subs`, accuracy/crit/flinch/proc rolls) earned over all prior rounds.
2. **Simultaneous Uncoupled `closestSpread` Jumps**: Every active Pokémon independently moves to `closestSpread(kn, aimFor(kn, picks[s][i]))` (`0.5` quantile of marginal bounds) without checking mutual damage/recoil/speed consistency. Unconstrained Pokémon or wide-range attackers/defenders routinely jump to extreme values (e.g., `spa: 0` or inverted base-85/110 Speeds).
3. **Turn $t \to$ Turn 0–3 Regression**: On the next round, `reconstruct()` (`infer.mjs:960-970`) starts from Turn 0 with `exact = null, pins = null` and uncoupled spreads. Previously settled Turn 0–3 dice (flinches, misses, crits) and early-turn percentage/speed thresholds fail immediately at Turn 0, 1, 2, or 3.
4. **`stalled` + 1D `fallback` Burn Loop**: Because Turn $0$–$3 <$ `deepest` (Turn $t - 1$), `stalled++` increments (`infer.mjs:976`). Early-turn `fallback` (`infer.mjs:478-914`) burns `fallbackRebuilds` (`8 * S * W`) and `fallbackTotal` (`32 * S * W`) trying single-stat tweaks on the wrong turn, climbs back toward Turn $t$ over several rounds, hits the exact same `choose()`/`paths()` failure at Turn $t$, wipes `exact = null; pins = null;` again, and loops across all 4 restarts (`default`, `usage`, `wide`, `widest`) until `stop = 'stalled'` or `stop = 'searches'`.

---

## 3. Single Cohesive Fix Specification

This fix preserves soundness (no spread is ever pruned except by the simulator in `evidencePass`), keeps the simulator as the sole source of mechanics, and uses zero move- or species-specific rules.

### A. Never Wipe Verified Prefix `exact` / `pins` on `choose()` or `paths()` Failure (`infer.mjs`)

1. **Maintain a Deepest Consistent Checkpoint `(bestPrefix)`**:
   Track the deepest verified prefix `{ throughTurn, exact, pins, picks }` in `inferSpreads`. Because `reconstruct.mjs:1730-1762` (`brokenProof`) binds `exact` and `pins.proof` to the specific witness spreads that produced them, **any retained `(exact, pins)` MUST remain paired with its witness spreads (or a prefix-consistent repair)**—never pair old `(exact, pins)` with arbitrary `aimFor(0.5)` jumps across all Pokémon.
2. **Prefix Fallback When `0 .. cutoffAt` Fails (`infer.mjs:1072-1080` & `evidence.mjs:256-261`)**:
   - In `evidencePass(..., exact: true)`, if `paths(pre)` cannot extend an exact HP path through Turn $t$'s `prefix.cutoffAt`, attempt `paths(pre, { maxTurn: prefix.turn - 1 })` (certifying the already-reproduced Turns `0 .. t - 1`).
   - In `infer.mjs:1072-1080`, when `choose()` returns `proof === null` (either via `guessTries` or `paths()`):
     - **Do NOT execute `exact = null; pins = null;` and overwrite all `order` Pokémon with `closestSpread(kn, aimed(...))`.**
     - First, check which Pokémon in `picks` still satisfy `containsSpread(knowledge.get(id), picks[s][i])`. Only Pokémon eliminated by Round $r$'s `settle` need a new spread (`closestSpread(kn, picks[s][i])`, projecting minimally rather than jumping to `0.5`); all surviving Pokémon keep `picks[s][i]`.
     - If `picks` itself already reproduced Turns `0 .. t-1` (i.e. `built.report.verifiedThroughTurn >= t - 1`), certify `(exact, pins)` for `0 .. t-1` on that surviving/minimally-projected witness (or retain the prior round's `(exact, pins)` paired with its surviving `picks` if `verifiedThroughTurn` did not regress).
   - Apply the same prefix-preservation rule at `mixOf` (`infer.mjs:1118-1120`): recompute `(exact, pins)` up to the deepest turn where the mixed spreads still agree with `built`, rather than blindly nulling both.

### B. Coupling-Partitioned, Backtracking `paths(raw)` (`evidence.mjs:3904-4063`)

Replace the single-pass greedy `options[0]` commit in `paths(raw)` with a sound, bounded exact path solver:
1. **Deduplicate `options` per step** (keeping `own` first when valid, preserving `rollOf`/`tagOf` per unique `h2`), and skip redundant exploration of duplicate HP outcomes.
2. **Partition by Cross-Pokémon Dependency Components**:
   Build connected components over `recs` using edges from `e.change.dealtBy`, `e.change.victim`, `e.change.hits`, `e.change.sourceStates`, `e.change.extra`, and `e.change.pair`. Uncoupled Pokémon resolve in a single $O(|\text{entries}|)$ pass; only coupled components enter backtracking.
3. **Bounded DFS with Nogood Memoization**:
   Within each coupled component, search `entries` chronologically with backtracking across choices where `|options| > 1`, memoizing failed `(entryIndex, componentStateHash)` states so exponential blowup cannot occur. Only if the DFS proves no path exists through `maxTurn` does `paths()` fall back to `maxTurn = prefix.turn - 1` (instead of returning `null` for the whole battle).

### C. Coupling-Ordered, Budget-Scaled `choose()` (`infer.mjs:997-1071`)

1. **Scale `tries` with Active Coupled Depth**:
   Change line `1004` from fixed `let tries = 32 * S * W;` to scale with `seq.length` (`let tries = Math.max(32, 16 * seq.length) * S * W;` when `seq.length > 0`, bounded by `S * W`), ensuring an 8-Pokémon battle receives enough budget to explore multiple joint branches and fail-first reorderings without starving after 2 leaves.
2. **Try the Working Witness Before Simultaneous Perturbation & Order `seq` by Coupling**:
   - Compute a coupling-aware ordering for `seq` from the evidence graph (`lent`, `orders`, Turn-$t$ `cast` membership, and fewest `spreadsLeft(kn)`), placing tightly coupled / narrowest Pokémon first so incompatible pairs fail at depth 1–2 instead of depth 7.
   - Skip `narrowed` `settle` calls (or omit decoupled Pokémon whose spreads were neither narrowed by `settle` nor linked via `lent`/`orders` to Turn $t$) until a coupled core is pinned—avoiding $2N$ `settle` calls per leaf on unconstrained Pokémon (e.g. a Turn-1 OHKO or 4x-Protect Pokémon).
   - Include `picks[s][i]` (if surviving in `knowledge`) *ahead of* `aimFor(0.5)` for non-Turn-$t$ Pokémon when `choose()` is merely advancing past Turn $t$, so `choose()` first establishes a valid `(exact, pins)` witness on Turns `0 .. t-1` before attempting 0.5-quantile exploration.

### D. Localized Coupled Turn-$t$ Repair (`infer.mjs`)

When Turn $t$ itself cannot be passed by single-stat `fallback` (`infer.mjs:478-914`)—which currently restarts from Turn 0–3 once pins collapse—run localized joint repair anchored at the preserved `0 .. t-1` prefix `(exact, pins)`:
- Restrict perturbation candidates to the Turn-$t$ coupled cluster (`cast` at Turn $t$ plus any `dealtBy` / `lent` / `orders` upstream Pokémon whose HP or stat feeds Turn $t$'s `diff`).
- Search paired/cluster moves inside `knowledge` while holding all non-cluster Pokémon at their verified `0 .. t-1` `picks` and handing `(exact, pins)` through `t - 1` into `reconstruct` (so `reconstruct` verifies Turn $t$ directly in $1$ turn instead of re-searching Turns `0 .. t-1`).

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2699286086` (Turn 11 Double-Drain Cliff -> Turn 2 Collapse)
- **Views**: `p2@p1` PASS (`15.3s`, 9 rounds); `p1@p2` PASS (`17.2s`, 9 rounds); `both@spectator` **GAVE UP** (`21,619.8s` / 6.01h, `stop = "stalled"`, 294 rounds, 1,017 rebuilds, 4,083,046 probes; limits: `["backtracks", "fallbackRebuilds", "fallbackTotal", "guessTries", "probes", "stalled"]`).
- **Coupled Chain & Protocol Tokens**:
  - Round 8 rebuilt cleanly through Turn 10 (`12` exact turns, `23` dice).
  - Round 9 diverged on Turn 11 line `11.8`:
    `wanted |-heal|p1b: Sinistcha|58/100|[from] drain|[of] p2b: Basculegion`
    `got    |-heal|p1b: Sinistcha|59/100|[from] drain|[of] p2b: Basculegion`
  - Ground-truth HP arithmetic: Sinistcha (`HP 178`, `99/178` entering Turn 11 after T3/T9 Rock Slide + T9 Wave Crash) uses `Matcha Gotcha` into `7`-HP Garchomp (`floor(7/2) = +3 -> 102/178 = 57/100`) and `6`-HP Basculegion (`floor(6/2) = +3 -> 105/178 = 58.988% -> 58/100`). A 1-HP extra drain (`+4 -> 106/178 = 59.55%`) or `MaxHP = 176` flips `58/100` to `59/100`.
- **Collapse Trace**:
  - `order.length = 8` active Pokémon (`Sinistcha, Delphox, Incineroar, Kingambit, Metagross, Whimsicott, Garchomp, Basculegion`). `choose()` exhausted `tries = 64` without a joint Turn-11 path, returned `proof = null`, and wiped `exact = null; pins = null;`.
  - Uncoupled `closestSpread` drifted Delphox to `spa: 0` (`179` vs `195` SpA), collapsing Round 10 from Turn 10 back to Turn 2 line `2.10` (`wanted |-damage|p2a: Garchomp|22/100, got 32/100`), burning Turn 2 `fallbackRebuilds` and oscillating T2 $\leftrightarrow$ T10 for 294 rounds.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2693782296` (Turn 8 Capped Lethal Recoil -> Turn 2 Collapse)
- **Views**: `p1@p2` PASS (`37.9s`, 6 rounds); `p2@p1` PASS (`60.9s`, 9 rounds); `both@spectator` **GAVE UP** (`12,074.2s` / 3.35h, `stop = "stalled"`, 170 rounds, 508 rebuilds, 1,345,409 probes; limits include `guessTries`, `fallbackRebuilds`, `fallbackTotal`, `stalled`).
- **Coupled Chain & Protocol Tokens**:
  - Round 8 reproduced through Turn 7 (`Incineroar` Flare Blitz `164` dmg + `54` recoil -> `65/100`; `Rillaboom` burned -> `11/100`; Turn 8 `Rillaboom` Wood Hammer `10` dmg -> `60/100` / `9/100`), diverging on Turn 8 capped lethal Flare Blitz recoil:
    `wanted |-damage|p1b: Incineroar|57/100|[from] Recoil` (`123 - floor(20/3) = 116/202 = 57/100`), `got 56/100`.
- **Collapse Trace**:
  - `choose()` over 7 active Pokémon (`Garchomp, Incineroar, Aegislash, Raichu, Gholdengo, Rillaboom, Sneasler`) ran `evidencePass({ exact: true })`; `paths(raw)` hit `options.length === 0` at the `dealt` exact-amount check (`evidence.mjs:3998`: `amounts[j] !== dealt.amount || tag % SPAN !== dealt.v`) and returned `null`.
  - After 85 passes, `choose()` exhausted `guessTries`, setting `exact = null; pins = null;`. Round 9 immediately regressed to Turn 2:
    `round 9: reproduces through turn 2 - wanted |-damage|p2a: Raichu|44/100, got |-damage|p2a: Raichu|50/100`
    trapping the solver in a Turn 2 $\leftrightarrow$ Turn 8 loop for 170 rounds.

### Proof 3: `mimic:gen9championsvgc2026regmc-2693525101` (All 3 Views Failed; `paths()` Option Annihilation & Speed-Gate Oscillation)
- **Views**: `p1@p2` **GAVE UP** (`3,410.8s`, `searches`, 54 rounds); `p2@p1` **GAVE UP** (`2,707.8s`, `searches`, 78 rounds); `both@spectator` **GAVE UP** (`4,728.8s` sweep / `1,880.3s` trace, `stop = "stalled"`, 122 rounds, 485 rebuilds, 1,635,425 probes).
- **Coupled Chain & Protocol Tokens**:
  - 6 consecutive Wood Hammer recoils on `p1b: Rillaboom` (Turns 2–7, `HP 207`) + 5 Grassy Terrain ticks + `p2b: Farigiraf` Sitrus Berry (`99 -> 154/220`) + `p2a: Staraptor` capped `12`-HP Final Gambit + Turn 2 TR Scarf Staraptor (`Spe 183 > 174`) vs. Mega Manectric + Turn 6 post-TR base-85 mirror speed gate (`Rillaboom 113 > Archaludon 105`, where inversion redirects Wood Hammer into ally: `wanted |move|p1b: Rillaboom|Wood Hammer|p2a: Pawmot, got |move|p1b: Rillaboom|Wood Hammer|p1a: Archaludon` 45x in trace).
- **Collapse Trace**:
  - `paths(raw)` (`evidence.mjs:3975-4011`) hit `options.length === 0` across the multi-turn Wood Hammer `dealt` chain and returned `null`; `choose()` hit `guessTries` (`pins = null`), collapsing back to Turn 1/2 (`wanted |-damage|p1b: Rillaboom|73/100|[from] Recoil, got 72/100`; `wanted |-heal|p2b: Farigiraf|7/100|[from] Grassy Terrain, got 6/100`) and cycling through all 6 search starts/phases for 122 rounds.

### Proof 4: `mimic:gen9championsvgc2026regmcbo3-2693458644` (`0 turns exact, 0 dice handed on` -> 753s Turn-4 Fallback Hole)
- **Views**: `p1@p2` PASS (`40.4s`); `p2@p1` PASS (`42.1s`); `both@spectator` **GAVE UP** (`7,056.2s` / 1.96h, `stop = "searches"`, 103 rounds, 430 rebuilds, 850,536 probes).
- **Coupled Chain & Protocol Tokens**:
  - Turn 8 `p2b: Rillaboom` Wood Hammer onto Focus Sash `p1b: Arcanine-Hisui` (`172 -> 1/172`, `damage = MaxHP_Arc - 1 = 171`, `recoil = floor(171/3) = 57` -> `Rillaboom 150/207 = 71/100`) couples `Arcanine-Hisui` Max HP and `Rillaboom` Max HP under Channel 0 percentages (`wanted |-damage|p2b: Rillaboom|72/100|[from] Recoil, got 64/100` / `69/100`).
- **Collapse Trace**:
  - `paths(raw)` returned `null` (`round 8: evidence and new guesses, 30.1s (0 turns exact, 0 dice handed on)`; `round 13: 6.5s (0 turns exact, 0 dice handed on)`).
  - Without handed-on dice/exact turns, Round 14 collapsed to Turn 3 (`reproduces through turn 3 - wanted |-heal|p2a: Baxcalibur|64/100|[from] Grassy Terrain, got 65/100`), forcing Turn 4 1D `fallback` to burn up to `753.3s` across 128 rebuilds per line until `searches` exhausted.

---

## 5. Merged Reports Manifest

All **58 / 58** source reports merged into bucket **F34**:

| # | File | Kind | Views Failed in Sweep | Trace / Sweep Result | Cluster | Primary Bottleneck |
|---|---|---|---|---|---|---|
| 1 | `gaveup-2690709001.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 4 Incineroar capped-KO Flare Blitz recoil (`65/100` vs `66/100`, governed by Grimmsnarl T2+T3 cumulative `HP=72`) coupled with Turn 5 4-way speed/Rock Slide/Sandstorm; `choose()` exhausts 32 `guessTries` (depth-8 = 17 tries/branch), drops pins, and 1D fallback thrashes across Turns 1–5. |
| 2 | `gaveup-2690755624.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C12` | `choose()` depth-8 search (17 tries/branch vs 32-try budget) exhausted `guessTries`, clearing `exact`/`pins` and falling back to uncoupled `closestSpread` guesses that oscillated between Turn 3 (`Floette 84/100`) and Turn 5 (`Rillaboom` Grassy Glide + `Incineroar` Flare Blitz recoil `75/100` -> GT `80/100`) for 186 rounds (`stalled`). |
| 3 | `gaveup-2690857794.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 1364.6s trace / 4058.1s sweep, stop=searches, 68 rounds, 244 rebuilds, 1291259 probes)` | `S08-C13` | `choose()` exhausts 32 tries after 1 branch across 8 Pokémon (`pins=null`), and Turn 5.6 (`Camerupt` Earth Power vs `Slowking` Chilly Reception speed order) couples with Turn 5.3 (`Camerupt 57/100` bulk) under the 66-SP cap so every single-stat fallback breaks 5.3, 1.3, 2.2/2.5, or 3.2. |
| 4 | `gaveup-2691297517.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 8 Flare Blitz recoil rounding (`wanted Incineroar 43/100\|[from] Recoil`, `got 42/100`) coupled across 7 combatants' Turns 0–8; every 1D fallback stat tweak regressed Turn 0.22, 1.3, 4.7, 6.8, 7.8, 7.12, or 8.1. |
| 5 | `gaveup-2691412750.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 4 (`Volcarona 50/100y` parity, `Rillaboom` Wood Hammer recoil `78/100` vs `Farigiraf` HP) & Turn 6 (`Pelipper 3/100` surviving Wood Hammer with 1..14 HP then dying to 14-HP Life Orb recoil) multi-body coupling exhausted `guessTries` in Round 8 and stalled 1D fallback across 106 rounds. |
| 6 | `gaveup-2692421826.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S15-C15` | Turn 7 Flamethrower onto 4x-weak `Golisopod-Mega` (`4/100` vs `6-16/100`) after 5 Leech Life drains exhausted 128 fallback rebuilds and `guessTries`, wiping `pins=null`/`exact=null` and regressing rounds back to Turn 0/2/4 across 141 rounds. |
| 7 | `gaveup-2692815448.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Turn 8 `Corviknight` Brave Bird leaves `Milotic` at `9/100` (`got 0 fnt`) across a 5-turn Brave Bird recoil web; 1D fallback breaks Turn 1/2/3/5 and `choose()` hits `guessTries`, dropping `exact`/`pins` and oscillating across Turns 3/5/7 until `stalled` (288 rounds). |
| 8 | `gaveup-2693458644.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 8 `Rillaboom` Wood Hammer recoil onto Focus Sash `Arcanine` (`72/100` vs `64/100`, coupling Arcanine MaxHP and Rillaboom MaxHP) causes `paths()` in `evidencePass` to return `null` (`0 turns exact, 0 dice handed on`), collapsing rounds to Turn 3/4 (`Baxcalibur` GT `64/100` vs `65/100`) where 1D fallback spends 753s/128 rebuilds. |
| 9 | `gaveup-2693523500.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C12` | `evidence.mjs` `paths()` returned `null` (`options.length === 0`) across cascading Flare Blitz recoils, Rocky Helmet, Leftovers, and Sandstorm, and `choose()` exhausted `guessTries`, stripping pins and oscillating between Turn 2/3 `Archaludon` Leftovers (`62/100` vs `63/100`) and Turn 7 `Arcanine` recoil (`19/100` vs `20/100`) for 167 rounds (`stalled`). |
| 10 | `gaveup-2693525101.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP (all 3 views: both@spectator 1880.3s trace / 4728.8s sweep stop=stalled, 122 rounds, 485 rebuilds, 1.64M probes; p1@p2 3410.8s; p2@p1 2707.8s)` | `S08-C11` | `evidence.mjs` `paths(raw)` hits `options.length === 0` across six Wood Hammer recoils + Grassy Terrain + Final Gambit, wiping pins (`pins=null`) and oscillating across Turn 1/2 recoil-GT rounding, Turn 2 Scarf Staraptor TR inversion, and Turn 6 Rillaboom/Archaludon speed gate with Wood Hammer ally redirection. |
| 11 | `gaveup-2693782296.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S11-C07` | Turn 7–8 `Incineroar` Flare Blitz + `Rillaboom` Wood Hammer + burn + Turn 8 capped lethal recoil (`56/100` vs `57/100`) causes `paths()` in `evidencePass({ exact: true })` to return `null`; `choose()` exhausts `guessTries`, drops `exact`/`pins`, and collapses from Turn 8 back to Turn 2 (`Raichu 44/100` vs `50/100`). |
| 12 | `gaveup-2694530183.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 14856.5s sweep, stop=stalled, 141 rounds, 592 rebuilds, 1972750 probes)` | `S08-C13` | At Turn 5, `choose(0)` exhausts `guessTries` across 6 coupled active Pokémon (Turn 2 dual recoils, Turn 3 capped Draining Kiss, Turn 4 exact `83/166 = 50/100y` Floette boundary), returning `pins=null`; independent `closestSpread` collapses Round 15 back to Turn 2.2/2.9 where univariate fallback loops until `stalled`. |
| 13 | `gaveup-2694652337.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 4 4-way coupling (`4.8` Excadrill `4/100`, `4.10` Incineroar `32/100`, `4.12` recoil `27/100`, `4.14` Sandstorm, `4.17` GT) where `choose` (`guessTries = 32`) explores at most 2 leaf combinations for 7 Pokémon, returning `exact = null` and thrashing fallback. |
| 14 | `gaveup-2695004787.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C12` | Round 7 reached Turn 10 burn (`Golisopod 8/100 brn` vs `7/100 brn`), then `choose()` exhausted `guessTries` across 8 active Pokémon and dropped pins, causing Round 8 to collapse back to Turn 1 (`Garchomp 80/100` vs `84/100`) and thrash T1 $\leftrightarrow$ T10 for 286 rounds (`stalled`). |
| 15 | `gaveup-2695372119.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Round 11 stalled at Turn 7 residual 1-HP color border on `Kommo-o` (`50/100y` vs `50/100g`, `76/152` vs `77/152`); `choose()` hit `guessTries` and dropped `exact`/`pins`, inverting Turn 2 speed (`Raichu > +1 Kommo-o`) and trapping 1D fallback on Turn 6's 3-way Drain Punch + Giga Drain + Sitrus coupling (302 rounds, 5.14h). |
| 16 | `gaveup-2695691527.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C11` | Turn 5/9/10 `Parabolic Charge` multi-target drain + Turn 9 `Mr. Rime` (86 Spe) vs `Incineroar` (80 Spe) speed tie + Turn 5 Sitrus Berry (`67/100` vs `66/100`): `choose()` exhausted `guessTries`, triggering `fallbackRebuilds`/`fallbackTotal` and oscillating across 250 rounds until `stop = 'stalled'`. |
| 17 | `gaveup-2696560400.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S11-C07` | Channel 0 empties `exactHp` so 8 active Pokémon enter `choose()` and exhaust `guessTries` (`32*S*W`), yielding `proof.exact = null`; without handed-on dice, Turns 10–12 lethal Flare Blitz recoil, mutual Flare Blitz, and Rocky Helmet (`45/100` vs `44/100`) stall across 168 rounds. |
| 18 | `gaveup-2696702286.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S15-C15` | At Turn 8/9 after 9 turns of Matcha Gotcha drain + Grassy Terrain + Poison (and T7 KO-capped 2-HP Glimmora drain), `choose()` exhausted `tries=64` over $N=7$ active Pokémon, set `exact=null`/`pins=null`, and Round 19 collapsed back to Turn 2 (320 rounds, 5.31M probes, `stop=stalled`). |
| 19 | `gaveup-2697228873.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | `choose()` exhausted `guessTries` across 8 unknown active Pokémon (dropping `exact`/`pins`), and 1-stat `fallback` stalled across Turn 1–2 KO/survival windows, Turn 4–7 `Sinistcha (106) > Archaludon (105)` 1-point speed edge, and Turns 5–7 `Matcha Gotcha` dual-drain + `Sitrus Berry` + `Leftovers` + `Dragon Pulse` survival knot. |
| 20 | `gaveup-2697307892.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 13,228.6s sweep, stop = stalled)` | `S03-C11` | Turns 3–6 Wood Hammer target-HP-capped recoil & Grassy Terrain cascade (P2 Rillaboom `34->14->3->9->16->8->14->0 fnt`): `paths(raw)` `dealt.amount` alignment failed in `choose()` (`guessTries`), resetting `exact/pins = null` and cycling 294 rounds until `stalled`. |
| 21 | `gaveup-2697778855.md` | `gaveup` | `both@spectator` | `GAVE UP (8,814.1s, stop=stalled, 215+ rounds, 1.6M+ probes)` | `S14-C12` | `choose()` hit `guessTries` across 7 unknown Pokémon and dropped `exact=null; pins=null`, cycling around Turn 1 pre/post-Mega speed inversion, Turn 2 `3/100` vs `4/100` poison threshold, Turn 6 4-way speed sort, and Turn 6 Flare Blitz `7/187` survival + `42/100` recoil / `66/100` Sitrus. |
| 22 | `gaveup-2697828175.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 4.14 `Rillaboom` Grassy Terrain heal `6/100` vs `7/100` coupled across 5 active Pokémon (Turn 1 Breaking Swipe, Turn 3 `Indeedee 11/100` survival & Wood Hammer recoil `56/100` & Rocky Helmet `17/100`, Turn 4 Make It Rain `54/100`) exhausted `guessTries` and all 128 1D fallback rebuilds. |
| 23 | `gaveup-2698481982.md` | `gaveup` | `both@spectator` | `GAVE UP (3,756.6s trace / 7,784.4s sweep, stop=searches, 150 rounds, 1,103,916 probes)` | `S14-C12` | `choose()` hit `guessTries` across 6 unknown Pokémon and dropped `exact=null; pins=null`, oscillating at Turn 4 between `Incineroar` Flare Blitz recoil (`42/100 = 85/202`, 1-HP margin) and Sitrus Berry heal (`66/100` vs `67/100`) plus `Floette-Mega 1/171` Dire Claw survival. |
| 24 | `gaveup-2698583225.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | `choose()` exhausted `guessTries` (dropping `exact`/`pins`) and 1-stat `fallback` ping-ponged across 971 rebuilds between Turn 3 (`Gholdengo` Wood Hammer recoil `80/100` vs `81/100` + Grassy Terrain `91/100`) and Turn 4 (`Staraptor` Wood Hammer recoil `76/100` vs `78/100`). |
| 25 | `gaveup-2698611527.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 6,858.2s sweep, stop = stalled)` | `S03-C11` | Turn 11 Wood Hammer recoil (`73/100` vs `74/100` on `Rillaboom` leaving `Sableye` at `2/157 = 2/100`) across 10 turns of Grassy Terrain ticks: `choose()` hit `guessTries`, dropped `exact/pins = null`, regressed to Turns 1/3/4, and exhausted `fallbackTotal` across 135 rounds. |
| 26 | `gaveup-2698956858.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Two-cycle oscillation on Turn 2 between `Sneasler` Grassy Terrain heal (`64/100` vs `65/100`) and `Sinistcha` Matcha Gotcha drain (`64/100` vs `65/100`) separated by 1 HP of Matcha Gotcha damage (`32` vs `33`); both lines fail 8-rebuild fallback and enter `spend.fruitless`, while `choose()` hits `guessTries` and oscillates via `closestSpread`. |
| 27 | `gaveup-2699286086.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C09` | Round 9 reached Turn 11 line `11.8` (Matcha Gotcha double-drain `58/100` vs `59/100`), exhausted `guessTries=64` across 8 active Pokémon, set `exact=null`/`pins=null`, and drifted to `Delphox spa:0` in Round 10—regressing from Turn 10 back to Turn 2 `2.10` and looping for 294 rounds (6.01h). |
| 28 | `gaveup-2699295299.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C11` | Turn 6 line `6.9` (`wanted P1 Rillaboom 39/100 Life Orb`, `got 38/100`, `81/207 = 39.13%` vs `80/207`): `choose()` hit `guessTries`, set `proof = null` erasing all pins, and re-sampled `P2 Rillaboom >= P1 Rillaboom` Speed, collapsing all the way back to Turn 0 `Grassy Surge` order across 243 rounds (`stop = 'stalled'`). |
| 29 | `gaveup-2699367747.md` | `gaveup` | `both@spectator` | `GAVE UP (28,502.1s, stop=stalled, 215 rounds, 1,000 rebuilds, 5,612,578 probes)` | `S14-C12` | At Turn 5 (14 coupled percentage lines including Sitrus, Rock Slide, LO, Flare Blitz recoil off Gholdengo's multi-turn residual HP, and 3x Grassy Terrain), `choose()` hit `guessTries`, set `exact=null; pins=null`, and collapsed all the way back to Turn 1 speed inversion (`Mega Garchomp 154 < Scarf Gholdengo 180`). |
| 30 | `gaveup-2699479041.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 13,925.4s sweep, stop = stalled)` | `S03-C11` | Turns 4–5 multi-turn drain (Leech Life on `Floette 83/100`, Matcha Gotcha on `Golisopod 32/100` vs `33/100`) + Rocky Helmet + Tailwind speed gate (`Floette > 2*Golisopod`): `variants` and `guessTries` exhausted, 1D fallback failed, oscillating across 287 rounds until `stalled`. |
| 31 | `gaveup-2699990693.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 4/5 `Rillaboom` Wood Hammer capped-KO recoil + Grassy Terrain (`47/100` vs `48/100`) couples Rillaboom, Pelipper, Mega Raichu, and Gholdengo; `choose()` exhausts 64 `guessTries`, wipes `exact = null` and `pins = null` (`infer.mjs:1072-1079`), collapsing rounds to Turn 0/1 and exhausting 128-rebuild 1D fallback. |
| 32 | `gaveup-2700745857.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C11` | Turn 8/9 `Golisopod Leech Life` drain (coupled to Turn 2 `Tyranitar` HP -> Turn 9 GT `89/100` vs `88/100`), Turn 6 `Politoed 20/100y` Sandstorm, and Turn 4 `Rillaboom GT 83/100` vs `84/100`: `choose()`/`fallback` fixes at Turn 4 broke Turn 2/8/10, oscillating between Turn 3 and Turn 8 across 157 rounds (`stalled` + `searches`). |
| 33 | `gaveup-2700917620.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 6 `Rillaboom` Grassy Terrain heal (`60/207 = 28.9855%`: `28/100` vs `29/100`) sits 1 HP below rounding cliff after 5 turns of Muddy Water, Hurricane, Stamina-coupled Wood Hammer recoil, and Grassy Terrain; adjusting Basculegion-F SpA/Sneasler SpD for Turn 6 collapses Round 10 back to Turn 1 (`Sneasler 35/100` vs `40/100`). |
| 34 | `gaveup-2701153993.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 5 4-way chain (`Venusaur` Giga Drain healing to `50/100g > maxHP/2`, `Meowscarada` 3-hit Triple Axel `36/100 -> 9/100 -> 0 fnt`, `Incineroar` Flare Blitz recoil `45/100` + Sitrus `69/100`) exhausted `guessTries` and dropped `exact`/`pins`, causing Turn 1 collapse (`Kingambit 1/100` vs `0 fnt`) and `stalled` termination. |
| 35 | `gaveup-2701324235.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | Usage priors set `Golisopod spe = 0` (`54` Spe) instead of planted `spe = 28` (`79 > 72` Incineroar/Farigiraf), causing 210 Turn 5/6 speed-order diffs where 1-stat `fallback` broke Turn 1 (`1.12`), Turn 3 (`3.8`), or Turn 5 (`5.1`), while wider restarts stalled on Turn 11 (`Politoed` floored % under Rain + GT) and `choose()` hit `guessTries`. |
| 36 | `gaveup-2701599375.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 8329.5s sweep, stop=stalled, 170+ rounds, 700+ rebuilds, 1.2M+ probes)` | `S08-C13` | Turns 6–9 couple Turn 6 Flare Blitz survival (`Rillaboom 15/207 = 7/100` across burn/GT, 6/16 rolls OHKO), Turn 6/8 Atk/Def ratio degeneracy (breaking Turn 8 `Farigiraf 31/100 -> 22/100`), Turn 7 capped recoil + Sassy/Calm Farigiraf TR speed order, and Turn 9 86-HP KO razor; `choose()` hits `guessTries` and regresses. |
| 37 | `gaveup-2701875695.md` | `gaveup` | `both@spectator` | `GAVE UP (1,104.2s trace / 2,804.3s sweep, stop=searches/stalled, 243 rounds, 577,720 probes)` | `S14-C12` | `choose()` hit `guessTries` and dropped `exact=null; pins=null` under spread moves (Dazzling Gleam, Matcha Gotcha) + dual drain (Matcha Gotcha + Leech Life) + Rocky Helmet 1/6 recoil, deadlocking Turn 4 on `Golisopod`'s `50/100y` vs `50/100g` threshold and `Farigiraf` Sitrus (`64/100` vs `63/100`). |
| 38 | `gaveup-2703085152.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C11` | Round 19 `choose()` exhausted `guessTries` at Turn 11, dropping pins and collapsing back to Turn 1 (`Venusaur 85/100` -> Turn 7 `Rillaboom hp 0` dead-end trap -> Turn 9 `Rillaboom GT 11/100` vs Turn 10 `Incineroar 6/100` recoil cycle across 248 rounds, `stop = 'stalled'`). |
| 39 | `gaveup-2703865156.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | Turn `4.13` (`Incineroar 69/100` vs `70/100`) caused `choose()` across 8 active Pokémon to exhaust `guessTries` and wipe all 10 pinned dice (collapsing back to Turn 0/1); `Volcarona`'s disconnected 3-island HP domain `{2, 18, 21}` then trapped `fallback` on `hp=2, def=32`, making Turn `3.10` (`Incineroar 57/100` vs `58/100`) unreachable by 1/2-stat `fallback`. |
| 40 | `gaveup-2704041997.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | `Kommo-o` 8-turn GT + Leftovers + dual Clangorous Soul (`53/100` vs `52/100`) + Turn 8 Bitter Blade drain + Turn 9 Sitrus exhausted `choose()` `guessTries` (64 tries over 8 active mons), dropping `exact`/`pins` and collapsing uncoupled `closestSpread` guesses back to Turn 0/1 across 240+ rounds. |
| 41 | `gaveup-2704558138.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S11-C07` | Turn 10 `Golisopod` Leech Life drain capped by `Tyranitar`'s remaining HP (`69/100` vs `68/100`) fails 8-Pokémon `choose()` (exhausting `guessTries=64`), setting `exact = null; pins = null` and collapsing from Turn 10 all the way back to Turn 0/1 (`Gastrodon 86/100` vs `79/100`). |
| 42 | `gaveup-2704758034.md` | `gaveup` | `both@spectator` | `GAVE UP (10,642.4s, stop=searches, 99 rounds, 479 rebuilds, 2,929,538 probes)` | `S14-C12` | At Turn 6 (revived `Rillaboom 49/100` Wood Hammer recoil 6 vs 7 + Grassy Terrain + Leftovers `57/100` vs `58/100` against +1 Def Stamina Archaludon), `choose()` exhausted `guessTries` (depth 8, `tries=64`), set `exact=null; pins=null`, and collapsed back to Turn 0 (`Golisopod 92/100` vs `93/100`), burning 290.7s on Turn 2 fallback. |
| 43 | `gaveup-2705028500.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator, 9,825.7s sweep, stop = stalled)` | `S03-C11` | 11-turn `Archaludon` Leftovers chain (`38/100` vs `39/100`) + Turn 3/4/9 Flare Blitz recoil + Turn 6 4-way Earthquake + Turn 9 Sitrus Berry threshold: `choose()` exhausted `guessTries`, discarded `exact`/`pins` to `closestSpread()`, regressed to Turn 0/2/4, and looped 211 rounds. |
| 44 | `gaveup-2705780903.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S15-C15` | Turn 11 `Rillaboom` Grassy Terrain heal (`71/203 = 34.975%` -> `34/100` vs `35/100`, sensitive to 1 HP of KO-capped Wood Hammer recoil on `Raichu`); `choose()` exhausted `guessTries=32` across 8 active Pokémon, stripping exact pins while 1D fallback broke Turns 1/2/9/11. |
| 45 | `gaveup-2706197002.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S11-C07` | Rounds 1–9 reach Turn 5 (`6 turns exact, 14 dice handed on`), then Round 10's 8-Pokémon `choose()` exhausts `guessTries` and clears `exact`/`pins`, collapsing back to Turn `3.15` (`Rillaboom` Sandstorm `85/100` vs `86/100` from Turn 3 Wood Hammer overkill recoil aliasing `92/100`); `Tyranitar` at 66/66 SP prevents 1D fallback. |
| 46 | `gaveup-2706491205.md` | `gaveup` | `both@spectator` | `GAVE UP (930.3s trace / 4,990.3s sweep, stop=searches, 89 rounds, 747,642 probes)` | `S14-C12` | `choose()` hit `guessTries` across 8 unknown Pokémon and dropped `exact=null; pins=null`, stalling on Turn 6 `Sneasler` crit Rock Slide hitting `Incineroar` at exact `101/202` (`50.00%`, `50/100y` Sitrus Berry trigger boundary; `52/100` misses Sitrus) alongside Turn 4 `Volcarona 1/181` survival and Turn 1 recoil. |
| 47 | `gaveup-2706937283.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | `choose()` exhausted `guessTries` across 7 active Pokémon (falling back to uncoupled `closestSpread` and collapsing to Turn 1/2), and 1-stat `fallback` burned 128 rebuilds failing Turn 5 (`Raichu` Volt Tackle recoil + `Archaludon` Electro Shot + `Rillaboom` Wood Hammer `30/100` vs `31/100` recoil + `Raichu` Grassy Terrain `56/100` vs `57/100` boundary). |
| 48 | `gaveup-2707034393.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turns 6–9 `Incineroar` Flare Blitz recoil + Discharge Sitrus Berry threshold + Sandstorm + Turn 9 capped lethal recoil (`15/100` on `Tyranitar`'s remaining `32` HP), combined with Turns 2–5 `Rillaboom` Wood Hammer/Rocky Helmet `4`-HP survival and Turn 5 upkeep `Incineroar > Tyranitar` ability order, stalled `choose()` and 1D `fallback` across 306 rounds. |
| 49 | `gaveup-2707052154.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C12` | `choose()` exhausted `guessTries` (32 tries across 7 active Pokémon), clearing `exact` and `pins` so `closestSpread` collapsed Round 15 back to Turn 0 (`Golisopod 48/100` vs `46/100`) and thrashed across Turns 3, 6, 7, 8, 9 (Leech Life `1/100` Primarina, Golisopod `18/100`, Rillaboom Rocky Helmet + recoil) for 320 rounds (`stalled`). |
| 50 | `gaveup-2708350729.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | `choose()` exhausted `guessTries` across 8 unknown Pokémon (wiping `exact`/`pins` and collapsing to Turn 0 `Sneasler 45/100` vs `41/100`), and 1-stat `fallback` failed on Turn 5 (`Rillaboom 59/100` vs `60/100` at `124/207` 1-HP boundary coupled with Turn 4 Rough Skin + Wood Hammer recoil on `Garchomp` and Turn 5 recoil on `Incineroar` from Turn 2). |
| 51 | `gaveup-2710584556.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | `Sinistcha`'s 9-step Turn 2–6 cumulative HP chain (3x Sandstorm, Garchomp drain, Iron Head, Sitrus, 3x Matcha Gotcha drains) hits a 1-HP rounding cliff on Turn 6 (`147/149=98/100` vs `146/149=97/100`); 1D fallback exhausted 128 rebuilds and fresh guesses collapsed back to Turn 1 across 132 rounds. |
| 52 | `gaveup-2710610871.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 8/9 `Basculegion` Wave Crash recoil 1% cliff (`34/100` vs `35/100`) after Rocky Helmet and Grassy Terrain ticks, plus Turn 5 `Incineroar` capped-KO Flare Blitz recoil (`52/100` vs `53-54/100`); Turn 9 1D fallback (128 rebuilds, 444s) breaks Turn 7/5/4/1/0, and `choose()` pin loss collapses rounds back to Turn 0/4. |
| 53 | `gaveup-2710661037.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C11` | 5-round cyclical attractor on Turn 3 between 6 handed dice (`Corviknight` Rock Slide flinch) and 7 handed dice (`Corviknight` Brave Bird overkilling `Gengar 0 fnt` instead of `10/100`), dropping back to 6 dice while 1D fallback cannot jointly raise Gengar `hp + def` (270 rounds, `stalled`). |
| 54 | `gaveup-2710828875.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C11` | Turn 4 line `4.10` (`wanted Staraptor 71/100 Sandstorm`, `got 72/100` because `78/100` Brave Bird recoil masked 38 vs 39 recoil HP) compounded by Turn 1 Sandstorm rounding on `Milotic` (`50/100y` vs `49/100`) and `Indeedee-F` (`38/100` vs `39/100`), triggering `guessTries` and stalling across 172 rounds (`stop = 'stalled'`). |
| 55 | `gaveup-2710839881.md` | `gaveup` | `both@spectator` | `GAVE UP (both@spectator)` | `S11-C07` | Turn 9 `Floette-Eternal` 11-event cumulative HP cliff (`72/100` vs `71/100` after Turn 9 capped Draining Kiss + Grassy Terrain) fails 1D fallback and `choose()` joint proof, dropping pins and collapsing from Turn 9 back to Turn 2 (`44/100` vs `52/100`) across 172 rounds. |
| 56 | `gaveup-2711002479.md` | `gaveup` | `both@spectator` | `GAVE UP (18,544.7s, stop=stalled, 286 rounds, 1,144 rebuilds, 6,602,593 probes)` | `S14-C12` | `choose()` hit `guessTries` and dropped `exact=null; pins=null` under 5 turns of `Mega Golisopod` Leech Life `ceil(damage/2)` drain coupling (`65/100` vs `66/100`), Turn 3 `Archaludon` (85) vs `Gholdengo` (84) speed inversion, and Turn 3 `Gholdengo` Life Orb recoil rounding (`39/100` vs `40/100`). |
| 57 | `gaveup-2711420095.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turns 2–4 `Incineroar` Flare Blitz recoil + Sitrus Berry (`57/100` vs `56/100`) + Make It Rain + capped lethal Flare Blitz recoil (`44/100` vs `45/100`) + Grassy Terrain (`51/100` vs `52/100`) caused `evidence.mjs` `paths()` to hit `options.length === 0`, exhausting `guessTries` (`exact = null`) and stalling uncoupled guesses across 95 rounds. |
| 58 | `gaveup-2711450978.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 7 `Sinistcha` Sitrus Berry heal off-by-1% (`64/100` vs `63/100`: `115/178` vs `113/178`) couples Turn 5 Earth Power/Snarl (`60/100` vs `53-55/100`), Hospitality, and Matcha Gotcha drains; 1D fallback breaks Turn `5.13` or `6.12` and rounds oscillate between Turn 4/5 and Turn 7 across 304 rounds until `stalled`. |
