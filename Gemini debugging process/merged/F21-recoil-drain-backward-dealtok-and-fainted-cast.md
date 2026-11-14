# F21: `totalChange` / `drainChange` / `wholePaths` Missing Backward `dealtOk` Propagation to KO & Prior Victims + Fainted Cast Omission

## 1. Failure Overview & Status
- **Bucket ID**: `F21`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` (`totalChange`, `drainChange`, `wholePaths`/`backward`, `paths`, `rec.lent`) & `scripts/lib/inference/infer.mjs` (`fallback` `cast`/`lender`, `choose`)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs:1541-1543, 1596-1638` — `totalChange()` sets `perA = !S.kn.known && !!off && lasts.every(l => l.off === off)`, forcing `const V = !perA && ... ? lasts[0].victim : null` (`line 1542`) so `span = null` whenever `S` is unknown; and `after(passed)` (`line 1596`) only runs once when the recoil/Shell Bell line is applied (`line 2167`), **never re-running after `wholePaths()` (`line 4077`)** prunes recoil/user HP downstream
  - `scripts/lib/inference/evidence.mjs:1647-1655, 1453-1474` — `drainChange()` delegates to `dealtChange()`, which writes `dealtOf` and narrows `last.change.dealtOk` during `apply()` (`lines 2168-2171`), **but `dealtChange` has no `after` hook** to re-propagate tightened attacker bounds after `wholePaths()`
  - `scripts/lib/inference/evidence.mjs:3881-3892, 3945-4063` — `wholePaths()` runs `backward()` once per `rec` (`line 3883`) without propagating narrowed `totals` / `dealtOk` back to recoil/drain victims or sources; and `paths(raw)` (`line 4031`) greedily commits `const h2 = options.includes(own) ? own : options[0]` without backtracking when a downstream `drainChange`/`totalChange` (`lines 3980-4011`) hits `!options.length` and returns `null`
  - `scripts/lib/inference/evidence.mjs:525, 3155-3156, 3538-3541, 4096` — `rec.lent` is only populated by `storedStats` writes (`askWrites` / `transformInto`), **never by `totalChange` (recoil/Shell Bell) or `drainChange` (drain/Leech Seed)**
  - `scripts/lib/inference/infer.mjs:576-580` — `fallback()` builds `cast` from `near` + `lender` (`lent.get(id)`) + `started` + `segment`/`stood`; because recoil/drain victims are absent from `rec.lent`, any victim that fainted on an earlier turn (or was KO-capped by the recoil move itself and left off the field) is **excluded from `cast`** on downstream turns
- **Total Merged Reports**: **9** (`gaveup`: 9)
  - **View Breakdown in Sweep**:
    - `both@spectator` only: **8** (`gaveup-2691379542.md`, `gaveup-2695911751.md`, `gaveup-2697048408.md`, `gaveup-2699918512.md`, `gaveup-2701031841.md`, `gaveup-2708412752.md`, `gaveup-2708916635.md`, `gaveup-2709309066.md`)
    - `p1@p2` only: **1** (`gaveup-2691851791.md`)
    - `p2@p1`: **0**
  - **Source Shard Clusters**: `S02-C12`, `S03-C08`, `S06-C06`, `S06-C09`, `S11-C05`, `S13-C08`, `S14-C03`, `S15-C13`.

---

## 2. Root-Cause Mechanism

Recoil moves (`Flare Blitz`, `Wave Crash`, `Wood Hammer`, `Head Smash`), Shell Bell, and drain moves (`Parabolic Charge`, `Drain Punch`, `Matcha Gotcha`, `Giga Drain`, `Draining Kiss`) couple two Pokémon's exact HP states across moves and turns:
- The user's HP change (`totalChange` / `drainChange`) depends on the exact damage `d` the victim actually took—which for a **KO/overkill hit** is capped at the victim's **pre-KO HP** (dependent on the victim's `MaxHP` and prior-turn damage taken), and for a **non-KO hit** is `h_pre - h_post` of the victim.
- Downstream HP changes on the user (e.g., `Rough Skin`, `Rocky Helmet`, `Sitrus Berry`, burn ticks, or a later hit on `1/100`) subsequently narrow which recoil/drain totals `t` (and hence which victim HP / prior damage `d`) are valid.

Four tightly coupled defects in `evidence.mjs` and `infer.mjs` break this round-trip coupling:

1. **`totalChange` (`perA = true`) Suppresses Victim HP Link `V`, and `wholePaths()` Never Propagates Downstream Recoil/Drain Bounds Back to Victims (`evidence.mjs:1541-1638, 3881-3892`)**:
   - In `totalChange` (`line 1542`), whenever the recoil user `S` is unknown (`!S.kn.known`) and the hit read `S`'s attacking stat (`off`), `perA` is `true`, which forces **`V = null`** (`span = null`)! Even when `after()` runs at the recoil line (`line 2167`), it only checks `span` when `!perA`.
   - Worse, `after()` runs **only once**, at the moment the recoil line itself is settled (e.g., Turn 1 `Wave Crash` or Turn 3 `Wave Crash`). When a **later turn** (or a later hit on the same turn, like Turn 2 `Rocky Helmet` in `2701031841`, Turn 4 `Rough Skin` in `2709309066`, or Turn 4 `Sitrus Berry` in `2697048408`) eliminates certain recoil totals inside `wholePaths()` (`backward()` at `line 3883`), **`totalChange.after()` is never re-invoked** against the surviving `totals`!
   - As a result, the KO'd or prior-turn victim retains impossible `hp` SP values (often **all 33 HP values / 136.66M spreads** for an overkill-OHKO'd victim like `Staraptor` in `2701031841` or `Floette-Eternal` in `2708916635`, or `[26..32]` instead of `[30..32]` for `Charizard` in `2709309066`, or `[0..2]` instead of `[0]` for `Gholdengo` in `2697048408`).
   - `choose()` then picks an incompatible `hp` for the victim (`aimFor` picking midpoint `hp = 17/18/29`, or sampling 31/33 bad HP values on an OHKO victim), exhausts `guessTries`, drops `exact`/`pins`, and loops indefinitely.
2. **Greedy `options[0]` Without Backtracking in `paths(raw)` (`evidence.mjs:3945-4063`)**:
   - Even when `drainChange` or `totalChange` narrows `dealtOk` forward, `paths(raw)` walks events chronologically in `seq` order and picks **`const h2 = options.includes(own) ? own : options[0]`** (`line 4031`) for a `!exact` victim (e.g., ally `p1a: Incineroar` hit by spread `Parabolic Charge` before exact foe `p2a: Incineroar` in `2691851791`, or an earlier hit).
   - If `options[0]` produces a drained/recoil amount incompatible with the later `drainChange` or `totalChange` constraint (`options.length === 0` at `line 4011`), `paths(raw)` immediately **returns `null`** instead of backtracking over the remaining surviving values in `options`! Every `null` return rejects a valid spread assignment in `choose()`, exhausting `guessTries` (`512` tries) and wiping `exact = null` and `pins = null`.
3. **Fainted Victims & Prior-Turn Attackers Omitted From `rec.lent` and `fallback` `cast` (`evidence.mjs:525, 4096` & `infer.mjs:576-580`)**:
   - In `infer.mjs:576-580`, `fallback()` builds `cast` on failing turn `t` from Pokémon named in turn `t` plus `lender = lent.get(id)`.
   - Because `evidence.mjs` only populates `rec.lent` for `storedStats` transfers (`Power Split`, `Transform`, etc.) and **never records recoil/drain victim provenance** (`V.id` in `S.lent`, or attacker `S.id` in `V.lent`), any victim that fainted on turn `< t` (e.g., Turn 3 `Charizard` in `2709309066`, Turn 2 `Gholdengo` in `2697048408`, Turn 3 `Sinistcha` in `2708412752`, Turn 1 `Excadrill` in `2695911751`, Turn 1 `Staraptor` in `2701031841`, Turn 1 `Rillaboom` in `2691379542`) is **completely excluded from turn `t`'s `cast`**!
   - Thus `fallback()` burns 8, 32, or 128 rebuilds perturbing only the surviving Pokémon on Turn `t`, powerless to adjust the fainted Pokémon's `hp`/`def`/`atk` that set the KO-capped recoil or prior chip!

---

## 3. Single Cohesive Fix Specification

1. **Fixed-Point Propagation Between `backward()` and `totalChange`/`drainChange` (`scripts/lib/inference/evidence.mjs:1541-1655, 3881-3892`)**:
   - **Allow `V` Coupling Regardless of `perA` in `totalChange` (`line 1542`)**: Remove the `!perA` restriction on `V` (`const V = lasts.length && lasts.every(l => l.victim === lasts[0].victim) ? lasts[0].victim : null;`). `perA` determines how totals are indexed by `S`'s attacking stat `off`, whereas `V` (`span = lostSince(V, ...)`) tracks the victim's own `(h0, h)` loss—both can and should constrain `V` and `S` together (e.g., via `dealtOk` on each `last` hit and `V.chain` filtering).
   - **Re-Run `after()` / Backward `dealtOk` Inside `wholePaths()` (`lines 3881-3892`)**: When `backward()` runs on `S` (or any Pokémon), track which `(a, totalIndex)` tags of each `totalChange` and which `(a, amount)` pairs of each `drainChange` (`dealtChange`) actually survived `S`'s downstream displays (`later` in `backward()`, i.e., `Rocky Helmet`, `Rough Skin`, `Sitrus Berry`, burn ticks). Re-invoke `change.after(survivingTags)` for `totalChange` (and an equivalent `narrowDealt(hurt, victim, survivingDealtOk)` for `drainChange` / `dealtChange`), and iterate `backward()` to a fixed point (`while (moved)` — bounded by at most a handful of passes across the small number of recoil/drain events)!
   - **Soundness Guarantee**: Every `total` or `dealt` eliminated by `S`'s `backward()` is strictly impossible under all remaining downstream HP states of `S`; therefore, propagating that narrowed set of `totals` / `dealtOk` back through `V`'s `last.change` (and `span` on `V`) removes **only** victim `(hp, def/spd, h)` paths that can never reach a valid `S` path.
2. **Bounded Backtracking in `paths(raw)` Over Coupled `dealtBy` / `drainChange` / `totalChange` Steps (`scripts/lib/inference/evidence.mjs:3945-4063`)**:
   - Replace the greedy single-pass `for (const { rec, i, e } of entries)` loop in `paths(raw)` with a recursive/backtracking search over `entries` (preferring `own` first when `options.includes(own)`, then remaining `options`) whenever an entry has `options.length > 1` and a downstream coupled step (`dealtBy`, `totals`, `dealtOk`, `sourceStates`, `pair`) fails with `!options.length` (`line 4011`). Because `paths(raw)` is only invoked on a **fully pinned** spread (`exact: true`, where each Pokémon has 1 `(hp, def, spd)` key and at most a few discrete damage rolls in `options`), backtracking over `options` resolves multi-target `Parabolic Charge` / `Wave Crash` dependencies cleanly instead of falsely returning `null`.
3. **Record Recoil/Drain Provenance in `rec.lent` (`scripts/lib/inference/evidence.mjs` & `scripts/lib/inference/infer.mjs:576-580`)**:
   - Whenever `totalChange`, `drainChange` (`dealtChange`), `effectChange` (`leechseed`/`recoil`/`drain`), or `relayChange` couples `rec` (`S`) to another Pokémon `V` (`hurt` / `last.victim` / `seeded` / `frame.holder`)—or whenever an earlier hit's `dealtBy` (`S`) moved `V`'s HP on an attack whose KO/remaining HP later caps recoil/drain—record `V.id` in `S.lent` (e.g., `S.lent._hp = ...`) and `S.id` in `V.lent`!
   - Also, for KO-capped recoil (`h === 0` after `last.change`), include the Pokémon whose attacks chipped `V` before the KO (via `V.history` `dealtBy` entries) in `V.lent` (or propagate `lent` transitively across `dealtBy` edges).
   - That automatically places fainted Turn 1–3 victims (`Charizard`, `Gholdengo`, `Staraptor`, `Sinistcha`, `Excadrill`, `Rillaboom`) into `lender` inside `infer.mjs:577` (`rank = 2` in `cast`), while keeping `seen.has(u.id)` satisfied so `fallback` can immediately adjust the fainted Pokémon's `hp` or `atk`/`def`!

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2709309066` (`both@spectator`, `GAVE UP`, 530.5s trace / 1,468.2s sweep, 200,882 probes)
- **Ground Truth Exchange (Turns 3 & 4, line `4.6`)**:
  - Turn 3 `3.3`: `p2b: Sneasler` hits `p1a: Charizard-Mega-Y` (`32/0/12/1/0/21`, `HP = 185`) with `Close Combat` for `68` damage, leaving **`117 / 185` (`63/100`)**.
  - Turn 3: `p2a: Basculegion` (`0/22/12/0/0/32`, `HP = 195`) KOs `Charizard` with `Wave Crash`, taking $\text{round}(117 \times 0.33) =$ **`39` recoil** to **`156 / 195` (`80/100`)**.
  - Turn 4 `4.6`: `p2a: Basculegion` hits `p1b: Garchomp` (`Rough Skin` = $\lfloor 195 / 8 \rfloor = 24$), dropping to $156 - 24 = 132 / 195$ (**`67/100`**).
- **Failure Trace (`trace_2709309066.log`)**:
  - Turn 4 `4.6` (`67/100`) eliminates `recoil = 38` (`157 - 24 = 133/195 = 68/100`) inside `wholePaths()` (`evidence.mjs:3883`), narrowing `Basculegion hp` to `[0, 1]`.
  - However, `totalChange.after()` (`line 1596`) ran only on Turn 3 (`80/100`, allowing `38..39` recoil $\to$ `Charizard hp in [26..32]`) and **never re-ran after `wholePaths()`** eliminated `38` recoil.
  - Thus `Charizard.hp` stayed `[26..32]`, `aimFor` picked **`Charizard hp = 29`** (`MaxHP = 182`, where `63/100` = `115..116` HP gives **exclusively `38` recoil**), `choose()` exhausted `guessTries` (`512` in Start 6) with `exact = null`, and Turn 4 `fallback` excluded Turn-3-fainted `Charizard` from `cast` (because `totalChange` never writes `rec.lent`), burning all 240 fallback rebuilds on `[Garchomp, Basculegion, Incineroar, Sneasler]`.

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2701031841` (`both@spectator`, `GAVE UP`) & `2691851791` (`p1@p2`, `GAVE UP` in 1,243.1s)
- **`2701031841` (Overkill-KO Recoil Victim Unconstrained)**:
  - Turn 1: `p1` `Basculegion` (`Wave Crash`) OHKOs `p2` `Staraptor` from full HP, taking recoil `r = 18` (requiring `Staraptor hp >= 27`).
  - Turn 2 `2.7`: `Basculegion` hits `Rocky Helmet` (`64/100`), which rules out `r = 17` and requires `r = 18`.
  - Because `totalChange` set `V = null` (`perA = true`) and `wholePaths()` never re-ran `after()`, **`Staraptor` retained all 33/33 `hp` values**, `aimFor` repeated `hp = 18` / `17` (`r = 17`), and Turn 2 `fallback` omitted fainted `Staraptor` from `cast`—deadlocking 73 fallback probes under `r = 17`.
- **`2691851791` (`paths(raw)` Greedy `options[0]` Failure on Spread `Parabolic Charge`)**:
  - In `p1@p2`, Turn 5 `p1b: Bellibolt` uses spread `Parabolic Charge` hitting `!exact` ally `p1a: Incineroar` first, then `exact` foe `p2a: Incineroar` second (whose exact damage pins `Bellibolt`'s second drain).
  - Because `drainChange` never populates `dealtOk` backward and `paths(raw)` greedily commits `options[0]` for `p1a: Incineroar` (`evidence.mjs:4031`) without backtracking, `Bellibolt`'s post-first-drain HP misses `83/100` (`!options.length` at `line 4011`), returning `null`, exhausting `guessTries`, wiping Turn 1–4 `pins`, and stalling across all 6 starts.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2691379542.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 2 `2.10` (`wanted Blaziken 89/100`, `got 90/100`): `wholePaths()` eliminated `recoil = 33` without re-running `after()` to force `Farigiraf` `1.5` `dealtOk = 102` (`HP = 32`), while `closestSpread` shed `Def` when probing `hp 32` and Turn 2 `cast` omitted Turn 1 `Rillaboom`. |
| `gaveup-2691851791.md` | `gaveup` | `p1@p2` | `PASS` on `both@spectator` (369.7s); sweep `GAVE UP` on `p1@p2` (1,243.1s) | In `p1@p2`, Turn 5 spread `Parabolic Charge` hits `!exact` ally `p1a: Incineroar` then `exact` foe `p2a: Incineroar`; `drainChange` lacks backward `dealtOk` and `paths(raw)` greedily picks `options[0]` without backtracking, returning `null`, exhausting `guessTries`, and wiping Turn 1–4 `pins`. |
| `gaveup-2695911751.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 3 `Flare Blitz` KO-capped recoil on `Incineroar` (`90/100` vs `89/100`) depended on `Kingambit`'s remaining HP after `Excadrill`'s Turn 1 `High Horsepower`, but `Excadrill` fainted on Turn 1 and was excluded from Turn 3's fallback `cast` while 1D perturbations broke Turns 1–2. |
| `gaveup-2697048408.md` | `gaveup` | `both@spectator` | `GAVE UP` (958.0s trace / 1,934.9s sweep, 296,094 probes) | Every phase stalled at Turn 4 `4.10` (`wanted Incineroar Sitrus 69/100`, `got 70/100`) because `Gholdengo hp = 0` (`MaxHP 162` -> odd recoil `53`) was neither backward-propagated by `totalChange` (`perA = true`), nor sampled by `aimFor` quantiles, nor reachable by Turn 4 fallback (which excluded Turn-2-fainted `Gholdengo` from `cast`). |
| `gaveup-2699918512.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 6 pinned `Basculegion hp = 2` (`197 HP`), making `Kingambit hp = 29` (`204 HP`) impossible on Turn 1 `1.7` (`68` recoil needs `>= 205` dmg); `choose()` starved below root `n = 0`, `held`/`closestSpread` pinned `hp = 29`, and `replayWith` skipped `Kingambit hp 30/32` as `same = true` under roll `203`. |
| `gaveup-2701031841.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 1 `Basculegion` `Wave Crash` KOs `Staraptor` with recoil `r = 18` (requiring `Staraptor hp >= 27`), but `totalChange` `V = null` and `backward()` never propagate Turn 2 `2.7` `Rocky Helmet` (`64/100`) back to `Staraptor`; `Staraptor` stays at 33/33 `hp` values and is excluded from Turn 2 `cast`, deadlocking all 73 fallback probes under `r = 17`. |
| `gaveup-2708412752.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 `4.10` (`Staraptor 9/100 brn`: `16/161` vs `17/161`) depends on `Sinistcha`'s Turn 3 `Matcha Gotcha` damage and capped KO recoil, but `Sinistcha` fainted at `3.10` and is omitted from Turn 4's `cast`, leaving `moved.length === 0` across 73/128 fallback rebuilds while fixed-order `choose()` exhausts `guessTries`. |
| `gaveup-2708916635.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 6 `Rillaboom` overkill-OHKOs `Floette-Eternal` with `Wood Hammer`, whose recoil (`67/100`) requires `Floette hp >= 31`, yet `knowledge.mjs` retains all 33 `HP` values (`136.6M` spreads) on `Floette` so 31/33 independent `choose()` samples fail Turn 6. |
| `gaveup-2709309066.md` | `gaveup` | `both@spectator` | `GAVE UP` (530.5s trace / 1,468.2s sweep, 200,882 probes) | Turn 4 `4.6` (`wanted Basculegion 67/100 Rough Skin`, `got 68/100`): `wholePaths()` narrowed `Basculegion hp` to `[0, 1]` (requiring `39` recoil) without propagating back to Turn 3 victim `Charizard.hp` (`[26..32]`), leaving `Charizard` stuck at `hp = 29` (`38` recoil) and off-`cast` because `totalChange` omits `rec.lent`. |
