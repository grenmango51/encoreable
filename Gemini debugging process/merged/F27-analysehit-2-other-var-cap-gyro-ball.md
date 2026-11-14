# F27: `analyseHit` `others.length <= 2` Cap Dropping 4-Stat Dynamic-BP Hits (`Gyro Ball`) + Missing Read-Side `lent` + `judge()` Intra-Turn `d.moved` Bug

## 1. Failure Overview & Status

- **ID**: `F27`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` / `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs`: `analyseHit` (`lines 939–948, 966, 994–1035`) — enforces `others.length <= 2` (`line 944`), dropping any hit reading 4 unknown SP-dependent stats (`target Def` + 3 `others`: `user Atk`, `user Spe`, `target Spe`) to `hit.supported = false` $\to$ `band('down')`.
  - `scripts/lib/inference/evidence.mjs`: `rec.lent` (`lines 525, 3155, 3538`) — tracks only `storedStats` writes (`Guard Split`, `Transform`), omitting read-side cross-Pokémon dependencies (`Gyro Ball` target Speed) from `lent`.
  - `scripts/lib/inference/infer.mjs`: `fallback` `judge()` (`line 704`) — checks `if (r[0] >= t && outcome(got.b) !== baseOutcome) d.moved = true;`, flagging same-turn *earlier-line* regressions (`r[0] === t && r[1] < baseReach[1]`) as `d.moved = true`.
- **Total Merged Reports**: **1** report (`gaveup-2691400059.md`)
- **View Breakdown**:
  - `p2@p1`: **1 / 1 `PASS`** (`Indeedee` known $\implies$ `others.length = 2 <= 2`, `Gyro Ball` supported)
  - `p1@p2`: **1 / 1 `PASS`** (`Avalugg` known $\implies$ `others.length = 1 <= 2`, `Gyro Ball` supported)
  - `both@spectator`: **1 / 1 `GAVE UP`** (`699.7s` trace / `1,128.7s` sweep, `41` rounds, `276` spent fallback rebuilds / `318+` total, `323,174` probes)

---

## 2. Root-Cause Mechanism

In Pokémon Showdown (`node_modules/pokemon-showdown/data/moves.ts:8047–8068`), `Gyro Ball` computes Base Power dynamically in `basePowerCallback`:

```ts
let power = Math.floor(25 * target.getStat('spe') / pokemon.getStat('spe')) + 1;
if (!isFinite(power)) power = 1;
if (power > 150) power = 150;
```

(And `Electro Ball` similarly reads both `pokemon.getStat('spe')` and `target.getStat('spe')`.)

When both user and target are unknown (`both@spectator`), `analyseHit` (`evidence.mjs:922–948`) observes four SP-dependent stat reads via `calculateStat` / `getStat`:
- `dims` = `[target|def]` (length `1`)
- `others` = `[source|atk, source|spe, target|spe]` (length **`3`**)

Because `evidence.mjs:944` enforces `others.length <= 2`, `analyseHit` sets `hit.supported = false`, degrading `Gyro Ball` to `band('down')` (`evidence.mjs:1983`). This creates a three-link failure chain:

1. **Unchecked `Gyro Ball` Allows `aimFor()` Drift + Over-Certified `exact` Turn 3**:
   Without `Gyro Ball` evidence, `aimFor()` jumps `Indeedee-F` to `15/0/23/13/0/15` (`Spe 108`, inflating `Gyro Ball` BP from `49` to `55` against `Avalugg Spe 50`), while `paths()` certifies `77/160` (`48/100`) as `exact` across the `band('down')` line. Starts 1–5 stall permanently at Turn `3.4` (`wanted 77/160`, `got 70/160`).
2. **Start 6 Locks Unproven `Avalugg spe = 16` into `held`, Deadlocking Turn 6 (`6.4`)**:
   Start 6 clears `3.4` at fallback rebuild #36 by moving `Avalugg` to `18/32/0/0/0/16` (`Spe = 64` $\to$ `43` BP `Gyro Ball`) and locking it into `held` (`infer.mjs:1093`). On Turn 6 (`6.4`, Trick Room expired), `-1` `Corviknight` (`Spe 52–54`, budget-locked to `spe ∈ [0, 3]`) must act ahead of `Avalugg`. Lowering `Avalugg spe` to `0` (`Spe 48`) breaks Turn `3.4` (`got 41/100`) unless `Indeedee-F` is simultaneously restored (`Spe 94`, `MaxHP 177`). However, `Indeedee-F` switched out on Turn 4 and is absent from `lent` (`evidence.mjs:525`, `infer.mjs:577`), so `Indeedee-F` is excluded from Turn 6's `cast`.
3. **`judge()` (`infer.mjs:704`) Treats Earlier-Line Same-Turn Regressions as `d.moved = true`**:
   Meanwhile, probing `Pangoro`'s stats on Turn 6 squeezes `Pangoro hp` down under the 66-SP cap, breaking line **`6.2`** (`Vivillon Hurricane`: `4/100 slp` / `0 fnt` vs `8/100 slp`), which is *before* `6.4` (`baseReach = [6, 4]`). Because `infer.mjs:704` checks `r[0] >= t && outcome(got.b) !== baseOutcome` instead of requiring `!further(baseReach, r)`, `judge()` sets `d.moved = true` on `Pangoro hp/def/spa/spd/spe` and `Vivillon spa`, burning ~90 of 128 rebuilds (~400s) on irrelevant `Pangoro` sweeps while `Avalugg spe 1..15` is skipped (`['early', 'early']`).

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1–#3 (*Simulator is the only source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move*):

1. **Support 2-`extra`-Variable Hits (`others.length <= 3`) in `analyseHit` (`evidence.mjs:940–948, 994–1035`) & Never Certify `band()` Exact in `paths()`**:
   - Generalize `hit.extra` from a single scalar `{ owner, stat }` to `hit.extras` (an array of up to 2 extra `(owner, stat)` vars when `others.length === 3`, i.e., `offVar` + `[extra1, extra2]`, bounded by a combination cap like `CATEGORY_CAP` or `|sStates| <= 4096` so `Gyro Ball` / `Electro Ball` with `!targetHp && !sourceHp` have at most `33 × 33 = 1,089` `(Spe_S, Spe_T)` pairs in `hit.sStates`, and even fewer after Turn 1–2 cuts!).
   - To keep `dryRow` fast when `others.length === 3`: `dryRow` already memoizes `modifyDamage` on `base`; additionally, if `target` and `source` Speeds only affect `basePower` (or via `memo('row|...')`), evaluating the `1,089` `(x1, x2)` states per `(a, d)` — or caching `base` when `reads` of `x1, x2` occur inside `basePowerCallback` — makes `Gyro Ball` exact in `both@spectator` without naming `Gyro Ball`! If a battle ever exceeds the `sStates` cap (e.g., if `sourceHp` is also true), safely fall back to `band('down')` while **not** certifying `exact` across `band()` in `paths()` (`evidence.mjs:4037`).
2. **Track Read-Side Hit Partners in `lent` (`evidence.mjs:525, 4096` / `infer.mjs:577`)**:
   - Whenever `analyseHit` reads an `extra` / cross-Pokémon dependency (e.g., `Indeedee-F Spe`/`Def` read by `Avalugg`'s `Gyro Ball`, or when a hit couples `S` and `T` via `via`/`extra`), record that partner ID in `rec.lent` (or a dedicated `coupled` map read alongside `lent` in `infer.mjs:577`) so `fallback` includes off-cast read-side partners (`Indeedee-F`) in `cast` when `Avalugg` (especially a `held` Pokémon) stalls on a later turn.
3. **Fix Intra-Turn Regression Classification in `judge()` (`infer.mjs:704`)**:
   - Change line `704` from:
     ```js
     if (r[0] >= t && outcome(got.b) !== baseOutcome) d.moved = true;
     ```
     to require that the probe did not regress to an earlier index within turn `t`:
     ```js
     if (!further(baseReach, r) && outcome(got.b) !== baseOutcome) d.moved = true;
     ```
     (where `!further(baseReach, r)` means `r[0] > t || (r[0] === t && r[1] >= baseReach[1])`), matching `sideOf` (`line 713`) so `'early'` same-turn regressions (`6.2` before `6.4`) never trigger `d.moved = true`.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2691400059` (`both@spectator`, Turn `3.4` `Gyro Ball` & Turn `6.4` Speed Inversion)
- **Open Sheet & Witness Stats**:
  - `p1:2 Indeedee-F` (`Relaxed`, `#1` Usage `32/0/32/0/2/0`: `HP 177, Def 139, Spe 94`); drifted via `aimFor()` to `15/0/23/13/0/15` (`HP 160, Def 118, Spe 108`).
  - `p1:3 Corviknight` (`Relaxed`, `HP = 205` [`32` SP, exact!], `Def = 171..172` [`31..32` SP], `spe ∈ [0, 3]` $\to$ `-1` Spe `52..54` after Turn 4 `Curse`).
  - `p2:5 Avalugg` (`Adamant`, `95/117/184/44/46/28`, `atk >= 10` eliminated `#1` Usage).
- **Protocol & Failure Trace**:
  - **Turn 3 (`3.4`)**: `p2a: Avalugg` uses `Gyro Ball` on `p1b: Indeedee-F` (`48/100`).
    - Reads 4 unknown SP-dependent stats (`Indeedee Def`, `Avalugg Atk`, `Avalugg Spe`, `Indeedee Spe`), failing `evidence.mjs:944`'s `others.length <= 2` cap (`others.length === 3`) and degrading to `band('down')`.
    - `paths()` certifies `77/160` (`48/100`) under `Indeedee Spe 108` (`55` BP `Gyro Ball`), stalling Starts 1–5 at `3.4` (`got 70/160`).
    - Start 6 (`128` rebuilds) reaches `Avalugg spe 16` (`Spe 64`, `43` BP `Gyro Ball`) at rebuild #36 (`28.7s`), passing `3.4` and locking `Avalugg 18/32/0/0/0/16` into `held`.
  - **Turn 6 (`6.4`)**: Trick Room expired; `6.4` requires `Spe(Corviknight, -1) >= Spe(Avalugg)` (`wanted |cant|p1a: Corviknight|slp, got |move|p2a: Avalugg|Body Press|p1a: Corviknight`).
    - `Corviknight` (`spe <= 3`, `-1` Spe `<= 54`) cannot outspeed `held` `Avalugg spe 16` (`Spe 64`).
    - Probing `Avalugg spe 0` reverts to `3.4: wanted 48/100, got 41/100` because `Indeedee-F` (switched out Turn 4) is absent from `lent` and `cast`.
    - Meanwhile `Pangoro` probes squeeze `Pangoro hp` and break `6.2` (`Vivillon Hurricane`), triggering `d.moved = true` at `infer.mjs:704` and burning ~90/128 rebuilds (~400s) before `stop = 'searches'`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2691400059.md` | `gaveup` | `both@spectator` | `GAVE UP` (699.7s trace / 1,128.7s sweep, `stop=searches`, 41 rounds, 318+ rebuilds, 323,174 probes) | Starts 1–5 stalled at Turn `3.4` because `Gyro Ball` (`4` unknown stats in `both@spectator`) exceeded `evidence.mjs:944`'s `others.length <= 2` cap and certified an impossible `exact` Turn 3; Start 6 cleared `3.4` by locking `Avalugg spe=16` into `held`, deadlocking Turn `6.4` (`Corviknight -1 Spe` vs `Avalugg`) because off-cast `Indeedee-F` is absent from `lent` and `infer.mjs:704` burned ~90/128 rebuilds on Turn `6.2` `Pangoro` regressions. |
