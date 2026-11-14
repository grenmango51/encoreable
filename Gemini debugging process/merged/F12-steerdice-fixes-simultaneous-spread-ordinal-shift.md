# F12: `steerDice` + Simultaneous `fixes` Commit Shifts Downstream Spread-Move Ordinals Onto Secondary Rolls

## 1. Failure Overview & Status

- **Bucket ID**: `F12`
- **Category**: `3. RNG Steering & Variant-Budget Bugs in reconstruct.mjs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs` (`steerDice` + `resolveTurn` `fixes` batching)
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:866-899` (`standing()` and `expect()` — remain non-null throughout `getSpreadDamage()` because `battle.spreadDamage()` has not yet emitted `|-crit|` or `|-damage|` lines)
  - `scripts/lib/reconstruct.mjs:1030-1050` (`steerDice()` `actions.hitStepAccuracy` wrapper — flags an unaligned target hit that should be `|-miss|` as `{ reps: [99], wrong: true }`)
  - `scripts/lib/reconstruct.mjs:1052-1083` (`steerDice()` `actions.getDamage` wrapper — flags a downstream target's missing crit as `{ reps: [0], wrong: true }` during the same pre-miss run)
  - `scripts/lib/reconstruct.mjs:1881-1915` (`resolveTurn()` — collects all `wrong` steered draws into `fixes` and commits **every** `fixes` ordinal simultaneously at line `1910` whenever `outranks(scoreOf(probe, t), score)` is `true`)
  - `scripts/lib/reconstruct.mjs:1918, 1974, 2002` (`resolveTurn()` — skips any ordinal already in `subs`, making the shifted commit permanent for the entire turn)
- **Total Merged Reports**: **2** reports
  - All 3 views (`p2@p1`, `p1@p2`, `both@spectator`): **1** (`gaveup-2709179827.md`)
  - `both@spectator` only: **1** (`gaveup-2699484431.md`)

---

## 2. Root-Cause Mechanism

In Pokémon Showdown's `BattleActions.spreadMoveHit()` (`node_modules/pokemon-showdown/dist/sim/battle-actions.js:883-937`), a spread move (`Heat Wave`) executes its PRNG-consuming phases in strict sequential batches across all targets:

1. **`hitStepAccuracy(targets, pokemon, move)`**: rolls accuracy (`randomChance(90, 100)`) for Target 1 and Target 2.
2. **`getSpreadDamage(...)`** (`battle-actions.js:923`): calls `getDamage(source, target, move)` for **each** surviving hit target *before* `battle.spreadDamage(...)` (`battle-actions.js:927`) emits any `|-miss|`, `|-crit|`, or `|-damage|` protocol lines. Each `getDamage` call consumes **2 draws** (crit `randomChance(1, 24)` + damage roll `random(16)`).
3. **`secondaries(...)`** (`battle-actions.js:937`): rolls secondary effects (e.g., `Heat Wave`'s 10% burn `random(100) < 10`) on each surviving hit target.

When `reconstruct` encounters a spread move whose observed log shows **Target 1 missed (`|-miss|`)** and **Target 2 took a critical hit (`|-crit|`)**, while the initial PRNG stream rolled **Target 1 hit** and **Target 2 no-crit**, `steerDice()` + `resolveTurn()` corrupts the PRNG stream as follows:

1. **Both draws flagged `wrong: true` under the pre-miss ordinal layout**:
   - In `actions.hitStepAccuracy` (`reconstruct.mjs:1030-1050`), Target 1 (`ordA`) rolled `< 90` (hit) against observed `|-miss|`, so `steerDice` records `out.set(ordA, { reps: [99], wrong: true })`. Because Target 1 *hit* in this initial run, Target 1 remains in `targets` and `getDamage(Target 1)` runs!
   - `getDamage(Target 1)` consumes 2 draws (`ordA + 2` crit, `ordA + 3` damage roll — assuming `ordA + 1` was Target 2's accuracy check).
   - `getDamage(Target 2)` runs next. Because `battle.spreadDamage()` has not yet printed Target 1's lines, `standing()` (`reconstruct.mjs:866-881`) is **still non-null**, and `expect(Target 2)` (`reconstruct.mjs:887-899`) sees `|-crit|Target 2` in `wantHard` while `ordA + 4` rolled no-crit. `steerDice` therefore **also** records `out.set(ordA + 4, { reps: [0], wrong: true })`!
2. **Simultaneous `fixes` commit (`reconstruct.mjs:1881-1915`)**:
   - Line `1881` collects both into `fixes = [ordA, ordA + 4]`, and lines `1883-1890` build `trial = { ...subs, [ordA]: 99, [ordA + 4]: 0 }`.
   - When `ask.get(trial)` executes, `subs[ordA] = 99` makes Target 1 **miss** in `hitStepAccuracy`. `getDamage(Target 1)` is **skipped**, eliminating **2 draws** and shifting all subsequent `Heat Wave` draws **2 ordinals left**:
     - `ordA + 2`: becomes `crit(Target 2)`
     - `ordA + 3`: becomes `roll(Target 2)`
     - **`ordA + 4`: becomes `secondaries(Target 2)` (`Heat Wave`'s 10% burn roll!)**
3. **Permanent burn-pin self-sabotage (`reconstruct.mjs:1908-1910`)**:
   - Because `subs[ordA] = 99` fixes the `[spread]` and `|-miss|` lines, `outranks(scoreOf(probe, t), score)` is `true` at line `1908`.
   - Line `1910` (`for (const d of fixes) commit(d.i, trial[d.i]);`) **commits BOTH `subs[ordA] = 99` AND `subs[ordA + 4] = 0` into `subs`**!
   - With `subs[ordA + 4] === 0` (`0 < 10`), Target 2 is **deterministically burned (`|-status|<target2>|brn`)**, and `resolveTurn()`'s subsequent scans (`line 1918: if (subs[draw.i] !== undefined ...) continue;`, `pairs` `line 1974`, `brought` `line 2002`) skip `ordA + 4` because it is already pinned.
   - `reconstructOnce()` immediately exits `stuck` in `0.6s–1.0s` regardless of `maxProbes` (`150` to `16,000`) or Stat Points. In `2709179827`, this killed **all 3 views** (`p2@p1`, `p1@p2`, `both@spectator`); in `2699484431`, it killed every `resample: 0` build and created a 5-round limit cycle when `search 4` (`resample: 1`) temporarily bypassed Turn 1 before `infer.mjs:973` reset `level = 0` and `forget(1)` wiped all handed-on pins.

---

## 3. Single Cohesive Fix Specification

Do **not** combine downstream draws into `fixes` across a count-altering `hitStepAccuracy` miss (`scripts/lib/reconstruct.mjs:1030-1083, 1881-1915`):

1. **Tag accuracy `wrong` entries that flip hit $\to$ miss (or exclude post-accuracy `getDamage` draws from `fixes` when a hit $\to$ miss accuracy fix is present)**:
   - Inside `steerDice()` (`scripts/lib/reconstruct.mjs:1045-1046`), mark `hitStepAccuracy` entries that force a miss (`want === false`, i.e., `entry` changes a hit in the current run into a miss so `getDamage` for that target will be skipped) with e.g. `shiftsCount: true` (similarly for `hitStepMoveHitLoop` count changes at line `1126`).
   - Inside `resolveTurn()` (`scripts/lib/reconstruct.mjs:1881-1890`), build `fixes` sequentially up through any count-changing `wrong` draw:
     - Keep all `wrong` `hitStepAccuracy` draws that precede `getSpreadDamage` (preserving the exact multi-target accuracy pairing described in the comment at `reconstruct.mjs:1878-1880`: e.g., when Target 1 needs hit$\to$miss and Target 2 needs miss$\to$hit together so `[spread]` matches).
     - Whenever `fixes` contains at least one `shiftsCount` (`hitStepAccuracy` hit$\to$miss) draw, **exclude all downstream non-accuracy `wrong` draws** (`getDamage` crit/damage rolls, `hitStepMoveHitLoop`, etc. whose ordinals sit after the skipped `getDamage` call).
2. **Resulting Execution Trace**:
   - On Iteration 1 of `resolveTurn()`, `fixes` (if `> 1` accuracy draws) or the single-draw `order` loop (if `1` accuracy draw) commits **only** `subs[ordA] = 99` (Target 1 misses).
   - Iteration 2 runs `runTo(common, subs, t, t)` with `steerDice` active on the **real post-miss ordinal stream**: `getDamage(Target 1)` does not run, `crit(Target 2)` is now steered at its true ordinal `ordA + 2` (`reps: [0]`), and `secondaries(Target 2)` at `ordA + 4` is **never touched** (`>= 10` on the PRNG stream, or cleanly searchable if needed).
   - Soundness is 100% preserved (`AGENTS.md` Rule 2): no possibility is ever eliminated, and downstream `getDamage` draws are simply evaluated at their true post-miss ordinals on the very next `resolveTurn()` iteration.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2709179827` (All 3 Views Permanently Deadlocked at Turn 2 `2.13`)
- **Failure Scope**: `p2@p1`, `p1@p2`, and `both@spectator` all `GAVE UP` (`290.1s` sweep / `101.5s` trace on 15 threads, `stop = "searches"`, `46` rounds, `286` rebuilds [`240` `fallback`], `52,141` probes, `0.0%` exact stats).
- **Turn 2 Sequence (`2.9–2.13`, `Charizard-Mega-Y` `Heat Wave` vs `[p1a: Indeedee, p1b: Floette-Mega]`)**:
  - `2.10`: `|-miss|p2a: Charizard|p1a: Indeedee`
  - `2.11`: `|-crit|p1b: Floette`
  - `2.12`: `|-damage|p1b: Floette|30/100`
  - `2.13` (Stall Line):
    - `wanted`: `|-weather|SunnyDay|[upkeep]`
    - `got`: `|-status|p1b: Floette|brn`
- **Exact Ordinal Shift Proof**:
  - Under the initial draw stream, `N + 0` (`hitStepAccuracy` on `p1a: Indeedee`) drew hit (`< 90`) and was flagged `wrong: true, reps: [99]`; `getDamage(p1a)` consumed `N + 2` and `N + 3`; `N + 4` (`crit` on `p1b: Floette`) drew no-crit and was flagged `wrong: true, reps: [0]`.
  - `fixes` simultaneously committed `subs[N + 0] = 99` and `subs[N + 4] = 0`.
  - Skipping `getDamage(p1a)` shifted all draws 2 ordinals left, landing `subs[N + 4] = 0` onto `secondaries(p1b: Floette)` (`Heat Wave` 10% burn roll) and guaranteeing `|-status|p1b: Floette|brn` in `0.6s–1.0s` across **every** round, **every** view, `maxProbes = 16000`, and `resample: 1`.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2699484431` (Turn 1 `1.17` Burn Pin + 5-Round `resample` Limit Cycle)
- **Failure Scope**: `both@spectator` `GAVE UP` (`1,646.6s` sweep / `485.2s` trace on 9 threads, `stop = "stalled"`, `268` rounds, `533` rebuilds [`265` `fallback`], `228,402` probes, `0.0%` exact stats; `p2@p1` and `p1@p2` passed).
- **Turn 1 Sequence (`1.13–1.17`, `Dragonite-Mega` `Heat Wave` vs `[p2a: Sneasler, p2b: Floette-Mega]`)**:
  - `1.14`: `|-miss|p1b: Dragonite|p2a: Sneasler`
  - `1.15–1.16`: `|-crit|p2b: Floette`, `|-damage|p2b: Floette|69/100`
  - `1.17` (Stall Line):
    - `wanted`: `|upkeep`
    - `got`: `|-status|p2b: Floette|brn`
- **Exact Ordinal Shift & Limit Cycle Proof**:
  - Under `sampler(1 ^ 0x5eed).seed()` (`level = 0..2` and `fallback`), `fixes` committed `subs[N + 1] = 99` (`p2a: Sneasler` miss) and `subs[N + 5] = 0` (intended as `crit p2b: Floette`), shifting `N + 5` onto `secondaries(p2b: Floette)` and burning `Floette-Mega` on 100% of non-resampled rebuilds (`0.5s–0.9s`, `stuck`).
  - Only `search 4` (`resample: 1`) escaped Turn 1 in `0.4s` and reached Turns 4–5 (`Sinistcha 58/100`, `Incineroar 83/100`, `Incineroar 66/100`), but `infer.mjs:973` kept `floor = 0`, so every spread update reset `level = 0` (`sampler(1)`), triggered `forget(1)` (`reconstruct.mjs:2348`), omitted Turn-2 entrant `Sinistcha` from `seen`, and dropped straight back into the `1.17` burn trap across a deterministic 5-round limit cycle for 268 rounds.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2699484431.md` | `gaveup` | `both@spectator` | `GAVE UP` (`485.2s` trace / `1,646.6s` sweep, `stop=stalled`, `268` rounds, `533` rebuilds, `228,402` probes) | Turn 1 `Heat Wave` (`1.13–1.17`) simultaneous `fixes` `[N+1=99, N+5=0]` shifted `N+5` onto `Floette`'s 10% burn roll, guaranteeing `\|-status\|p2b: Floette\|brn` on every non-resampled rebuild; `search 4` advanced to T4–5 then reset to `level = 0`, wiping pins via `forget(1)` in a 5-round limit cycle. |
| `gaveup-2709179827.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`101.5s` trace / `290.1s` sweep, `stop=searches`, `46` rounds, `286` rebuilds, `52,141` probes) | Turn 2 line `2.13` (`wanted \|-weather\|SunnyDay\|[upkeep]`, `got \|-status\|p1b: Floette\|brn`) caused by `fixes` simultaneously committing `N+0=99` (`Indeedee` miss) and `N+4=0` (intended `Floette` crit, shifted 2 slots left onto 10% burn roll) across all 3 views. |
