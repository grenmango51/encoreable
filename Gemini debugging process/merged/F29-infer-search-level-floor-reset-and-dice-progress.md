# F29: `infer.mjs` Search-Level `floor` Reset Loop, Stale `exact` Across `resample`, & `dice.report.complete` Rejection

## 1. Failure Overview & Status
- **Bucket ID**: `F29`
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` (search-budget state machine: `level`, `floor`, `resample`, `exact`, `fallback` `dice` acceptance)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs:613` — `if (dice.report.complete) return stays(handed, 1);` rejects `dice = await rebuild(start, budgets[1])` whenever `dice` fails to complete the *entire* turn `t`, even when `dice` advanced further into turn `t` (`further(reach(dice), baseReach)`), whereas mutated stat probes at `line 709` accept `further(r, baseReach)`.
  - `scripts/lib/inference/infer.mjs:959-975` — When `budgets[level].resample` is truthy (`budgets[3]`, `search 4`), `inferSpreads` clears `seed` and `pins` (`seed: resample ? null : seed, pins: resample ? null : pins`, `lines 962-963`), yet still passes stale `exact` from the preceding `search 3` round (`line 961`); and `line 973` (`if (level > floor && !budgets[level].resample && reached && past(at, reached)) floor = level;`) explicitly refuses to advance `floor` when `budgets[level].resample` is set.
  - `scripts/lib/inference/infer.mjs:1102-1106` — `if (unchanged) { if (++level >= budgets.length) { stop = 'searches'; break; } } else { level = floor; }` unconditionally resets `level` down to `floor` (usually `0`, `budgets[0]`: `maxProbes: 150 * S, maxBacktracks: 0`) whenever `!unchanged`, forcing every round whose guess moved back into `maxProbes: 150` / unresampled `sampleSeed`.
- **Total Merged Reports**: **3** (`gaveup`: 3)
  - **View Breakdown in Sweep**:
    - `both@spectator` only: **2** (`gaveup-2691116729.md`, `gaveup-2691907758.md`)
    - `p2@p1` only: **1** (`gaveup-2708401489.md`)
  - **Source Shard Clusters**: `S04-C08`, `S07-C05`, `S09-C05`.

---

## 2. Root-Cause Mechanism

`inferSpreads()` (`scripts/lib/inference/infer.mjs`) escalates through a four-tier `budgets` ladder (`lines 406-411`):
- `budgets[0]` (`search 1`): `maxProbes = 150 * S`, `maxBacktracks = 0`
- `budgets[1]` (`search 2`): `maxProbes = 600 * S`, `maxBacktracks = 2 * S`
- `budgets[2]` (`search 3`): `maxProbes = maxProbes * S`, `maxBacktracks = 6 * S`
- `budgets[3]` (`search 4`): `maxProbes = maxProbes * S`, `maxBacktracks = 6 * S`, `resample = 1`

This coordinator assumes two invariants that break down on multi-dice or unpinned-RNG turns: (a) that once `evidencePass` updates a guess (`unchanged === false`), `budgets[0]` (`150` probes, `0` backtracks, `sampleSeed`) is enough again; and (b) that `exact` from a lower budget remains valid when `resample` changes the PRNG stream. Four coupled state-machine bugs enforce this trap:

1. **Unconditional `level = floor` Reset on `!unchanged` (`infer.mjs:1102-1106`)**:
   - In `both@spectator` battles with many active combatants, `evidencePass` slightly shifts candidate picks on nearly every round (`unchanged === false`), even on turns that already failed under `budgets[0]` for pure-budget reasons (e.g., Turn 4 in `2691116729` requiring `20%` burn + top-2/16 drain roll, which fails 100% of the time at `maxProbes: 150` under `sampleSeed: 1` even with the true planted spreads, yet passes at `maxProbes: 600`).
   - Because `line 1105` resets `level = floor` (`0`) whenever `!unchanged`, every new guess is forced back through `maxProbes: 150`, fails on the same multi-dice turn, induces another small guess shift (or `fallback` detour), and repeats until `stalled >= maxRounds` (`15,116.2s` in `2691116729`).
2. **`!budgets[level].resample` Blocks `floor` Promotion (`infer.mjs:973`)**:
   - Even when `budgets[3]` (`search 4`, `resample: 1`) is the *only* tier that advances past an unpinned RNG stall (`4.6` in `2691907758`), `line 973` checks `!budgets[level].resample`, refusing to raise `floor`.
   - As soon as `search 4` reaches a later line in that turn (`4.8` or `4.12`) and `evidencePass` moves a stat (`unchanged === false`), `line 1105` resets `level = floor = 0` (`search 1`), dropping the search right back behind the `4.6` RNG gate.
3. **Stale Partial-Turn `exact` Passed Across `resample: 1` (`infer.mjs:961-964`)**:
   - When `budgets[3]` (`resample: 1`) runs at `lines 960-970`, it clears `seed: null` and `pins: null` and increments `sampleSeed + 1` so the simulator draws fresh dice.
   - However, `line 961` still hands `exact` from the preceding failed `search 3` round into `reconstruct`. If `search 3` stalled mid-turn (e.g., at `4.6`), `exact` contains a *partial* exact-HP map through `4.5` that locked an opponent's spectator percentage to an exact integer (`+1` HP higher) never tested against `4.12`. Under `resample: 1`, `reconstruct` is forbidden by `exact` from sampling the lower exact HP at `4.5` needed to hit `4.12` (`22/100` vs. `23/100` Sandstorm in `2691907758`), even with 24 backtracks.
4. **`fallback()` Rejecting Partial Within-Turn Progress by `dice` (`infer.mjs:613`)**:
   - Inside `fallback()`, `dice = await rebuild(start, budgets[1])` (`line 610`) tests whether the unmutated guess advances under `budgets[1]` (`600 * S` probes, `2 * S` backtracks).
   - While mutated stat probes at `line 709` accept any `further(r, baseReach)` advance within turn `t`, `line 613` demands `if (dice.report.complete)`—discarding `dice` when it cleared the RNG bottleneck (`9.4` flinch in `2708401489`) and advanced to a later stat check (`9.6` damage), wasting `fallbackRebuilds` on unrelated stats and missing the `level = 1` promotion (`stays(handed, 1)`).

---

## 3. Single Cohesive Fix Specification

Keep search-budget progress monotonic across guess refinements and decouple `resample` from stale partial-turn exact proofs:

1. **Accept Within-Turn `dice` Progress in `fallback()` (`scripts/lib/inference/infer.mjs:613`)**:
   - After confirming `base` (or `dice`) reached turn `t`, accept `dice` whenever it completes the battle **or** advances strictly further within turn `t` than `base`:
     `if (dice.report.complete || further(reach(dice), baseReach)) return stays(handed, 1);` (and equivalently, if `level` was already `>= 1` or `resample` was needed to reach `[t, diff.index]`, return that level so the main loop does not drop back to `budgets[0]`).
   - **Soundness Guarantee**: `stays(handed, 1)` leaves `knowledge` untouched and simply hands the same `picks` to the next round at `budgets[1]` so `reconstruct` + `evidencePass` can read the newly reached line (`9.6`).
2. **Clear Stale Partial-Turn `exact` on `resample: 1` (`scripts/lib/inference/infer.mjs:959-970`)**:
   - When `resample` is non-zero (`budgets[level].resample`), drop partial-turn `exact` (or clear `exact` altogether alongside `seed: null, pins: null`, or drop `exact.get(t)` for any turn where `known.partial` is true and the previous round failed on turn `t`), so `search 4` is free to sample a different exact-HP representative inside the observed percentage bucket.
   - **Soundness Guarantee**: `exact` is only a search-guidance witness from one `choose()` pass (`evidencePass` re-derives every spread cut from `knowledge` independently); dropping stale partial `exact` on `resample` never removes a valid spread.
3. **Preserve / Promote `floor` When a Turn Fails at `budgets[0]` or Requires `resample` (`scripts/lib/inference/infer.mjs:973, 1102-1106`)**:
   - Advance `floor = Math.max(floor, level)` whenever `level > floor` reaches a new `deepest` point—even when `budgets[level].resample` is set (removing `!budgets[level].resample` from `line 973`, or tracking a `minLevel` per `deepest` turn)—and do not reset `level` all the way to `0` (`budgets[0]`) on `!unchanged` once the current `deepest` turn has already failed under `budgets[0]` (e.g., keep `level = Math.max(floor, ...)` or step down at most one tier only when `deepest` actually advances to a new turn).

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2691116729` (`both@spectator`, `GAVE UP`, 15,116.2s / 4.20 hours, 224 rounds, 873 rebuilds, 1,594,500 probes)
- **Ground Truth Exchange (Turn 4, index `16`)**:
  - `p1b: Sinistcha` (`178 HP`) uses spread `Matcha Gotcha` onto `p2a: Rillaboom` (`207 HP`) and `p2b: Incineroar` (`202 HP`).
  - To match `|-heal|p1b: Sinistcha|78/100|[from] drain|[of] p2b: Incineroar` at Turn 4 index `16` (`>= 139 / 178` HP after `107 -> 124` from Drain 1) *and* trigger the 20% burn on `Rillaboom`, `Matcha Gotcha` must simultaneously land the 20% burn and one of the top 2/16 damage rolls on `Incineroar` (joint probability $0.20 \times 2/16 = 2.5\%$).
- **Failure Trace**:
  - Direct verification with the **exact planted spreads** in Channel 0 (`sampleSeed: 1`) proves `reconstruct` fails **100% of the time** at `4.16` (`wanted 78/100, got 77/100`) with `maxProbes: 150` (`budgets[0]`), and passes cleanly at `maxProbes: 600` (`budgets[1]`).
  - Because `both@spectator` kept shifting candidate picks across the 7 active combatants (`unchanged === false`), `infer.mjs:1105` reset `level = floor = 0` (`maxProbes: 150`) every single round, trapping all 4 restart tiers (`default`, `usage`, `wide`, `widest`) until `stop = 'stalled'` (`224` rounds, `1.59M` probes).

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2691907758` (`both@spectator`, `GAVE UP`, 753.6s trace / 1,535.4s sweep, 106 rounds, 386 rebuilds)
- **Ground Truth Exchange (Turn 4 `4.5`, `4.6`, `4.8`, `4.12`)**:
  - `4.3–4.5`: `p1a: Tyranitar` uses `Rock Slide` (`[spread]`), damaging `p2a: Primarina` (`4.4`) and `p2b: Rillaboom` (`4.5`).
  - `4.6`: `p2a: Primarina` uses `Hyper Voice` (`allAdjacentFoes`), whose random display target (`getRandomTarget`) is **`p1b: Gholdengo`**.
  - `4.12`: End-of-Turn 4 `Sandstorm` chips `p2b: Rillaboom` (`207 HP`, `-12` HP) to **`22/100`**.
- **Failure Trace (`trace_2691907758.log`)**:
  - In Usage Starts 2 and 5, `search 1..3` (`seed 1`) stalled `'stuck'` at `4.6` (`got Hyper Voice|p1a: Tyranitar|[spread] p1a,p1b`), building a partial `exact` proof through **`4.5`** only.
  - All 13 invocations of `search 4` (`resample: 1`) cleared `4.6` and reached `4.8` / `4.12` (`wanted Rillaboom 22/100, got 23/100`), **but** `infer.mjs:961` passed the stale `4.5` `exact` into `search 4` (locking `Rillaboom` `+1` HP too high after `4.5`), and `line 973` refused to raise `floor` (`!budgets[level].resample`).
  - Whenever `4.12` shifted a stat (`unchanged === false`), `line 1105` reset `level = 0` (`search 1`), dropping right back to `4.6` for 69 rounds in Start 5 (`stop = 'stalled'`).

### Proof C: `mimic:gen9championsvgc2026regmcbo3-2708401489` (`p2@p1` `GAVE UP` 1,691.3s sweep vs. `both@spectator` `PASS` 198.7s trace)
- **Ground Truth Exchange (Turn 9 `9.4`–`9.6`)**:
  - `9.4`: `p2b: Sylveon` must *not* flinch to `p1a: Excadrill`'s 30%-flinch move and executes `|move|p2b: Sylveon|Hyper Voice|p1a: Excadrill`, dropping `p1a: Excadrill` to `56/100` at `9.6`.
- **Failure Trace (`trace_2708401489.log`, lines 24–31)**:
  - Round 9 (`budgets[0]`, `150` probes) stalled at `9.4` (`got |cant|p2b: Sylveon|flinch`).
  - Inside `fallback()`, `dice = await rebuild(start, budgets[1])` (`600` probes, `2` backtracks) cleared the `9.4` flinch and reached `9.6` (`wanted Excadrill 56/100, got 65/100`), **proving `further(reach(dice), baseReach)`** (`[9, 6] > [9, 4]`)—which `line 871` later confirmed with `read = true`.
  - Yet `infer.mjs:613` required `dice.report.complete`, rejected `dice` (`the guess alone (...) does not`), and burned 6 stat-mutation rebuilds. `both@spectator` escaped only via an incidental `p1:5 Salamence spe 0` (`154 == 154` tie with `Excadrill`) ordinal shift—which is impossible in `p2@p1` (`known[0] = true`), where `p2@p1` gave up in `1,691.3s`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2691116729.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 index `16` (`Matcha Gotcha` 20% burn + top-2/16 drain roll for `78/100`) fails 100% at `maxProbes: 150` under `sampleSeed: 1` even with true spreads (passes at `maxProbes: 600`), but `unchanged === false` resets `level = floor (0)` every round in `infer.mjs:1102-1105` (224 rounds, 15,116.2s). |
| `gaveup-2691907758.md` | `gaveup` | `both@spectator` | `GAVE UP` | In usage Starts 2 & 5, `search 1..3` stalled at `4.6` (`Hyper Voice` display target) and passed stale `4.5` `exact` into `search 4` (`resample: 1`), blocking `4.12` `Sandstorm` (`22/100` vs `23/100`), while `infer.mjs:973` refused to raise `floor` on `resample` and `line 1105` reset `level = 0` whenever `4.12` moved a stat (69 rounds, 753.6s). |
| `gaveup-2708401489.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` trace; `p2@p1` untraced) | `infer.mjs:613` rejected `budgets[1]` `dice` advance past Turn `9.4` flinch to `9.6`, triggering `order = true` `spe` sweeps and `given: null` double rebuilds; in `p2@p1`, P1 `Salamence` is fixed/excluded from `fallback` while Trick Room `Protect`/flinch/`Parting Shot` cutoffs leave `unchanged = true` against `Camerupt`'s non-usage high-SpD spread (`1,691.3s`, `stop = 'searches'`). |
