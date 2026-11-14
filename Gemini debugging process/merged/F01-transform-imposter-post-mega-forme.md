# F01: Transform/Imposter `depOf` Reading Target's Post-Mega `pokemon.species` Instead of Copied Forme

## 1. Failure Overview & Status
- **Bucket ID**: `F01`
- **Category**: `1. Crashes & Soundness Removals`
- **Status on `origin/main`**: **FIXED** (commit `ac15996` / `ac15996a344d96fc9e33fb3658328064d74dc888`: *"Compute a copied stat for the forme its original had when copied, not the one it Mega Evolved into since"*)
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs:488-500` — `rec.stat(stat, sp, forme = pokemon.species)` now accepts an explicit `forme` parameter (defaulting to `pokemon.species`) and caches per-forme `Int32Array` stat tables in `byForme`.
  - `scripts/lib/inference/evidence.mjs:563-571` — `depOf(rec, stat)` now snapshots `const forme = rec.pokemon.species;` at invocation time and closes over it in `{ owner: rec, stat, at: v => rec.stat(stat, v, forme) }`.
  - `scripts/lib/inference/evidence.mjs:3516-3554` — `transformInto` override captures `const copied = Object.fromEntries(MOVABLE.map(s => [s, depOf(from, s)]));` (`line 3525`) before executing `transformInto` and binds `r.deps[s] = dep` (`line 3544`).
- **Total Merged Reports**: **5** (`gaveup`: 1, `removed`: 4 — across 4 distinct battles: `2697567566`, `2697689088`, `2698084073`, `2708671848`)
  - **View Breakdown in Sweep**:
    - `p2@p1` (`REMOVED`): **3** (`removed-2697567566.md`, `removed-2698084073.md`, `removed-2708671848.md`)
    - `p1@p2` (`REMOVED`): **1** (`removed-2697689088.md`)
    - `both@spectator`: **5** (`gaveup-2697567566.md` / `removed-2697567566.md` [`GAVE UP`], `removed-2697689088.md` [`GAVE UP` / `NO MATCH`], `removed-2698084073.md` [`REMOVED`], `removed-2708671848.md` [`GAVE UP`])
  - **Source Shard Clusters**: `S01-C02`, `S02-C02`, `S07-C03`, `S14-C01`, `S15-C01`

---

## 2. Root-Cause Mechanism

In Pokémon Showdown's simulator, `Transform` and `Imposter` execute `pokemon.transformInto(target)`, copying `target.storedStats` (`atk`, `def`, `spa`, `spd`, `spe`) as they stand **at the moment of transformation**. If `target` is in its base forme when copied (e.g., Turn 0 `Imposter` before Mega Evolution, or switching in via `Imposter` before `target` clicks Mega Evolution on the same turn) and `target` subsequently Mega Evolves:
- `target.pokemon.species` updates to the Mega forme (`Aerodactyl-Mega`, `Gardevoir-Mega`, `Garchomp-Mega`, `Metagross-Mega`), changing `target`'s own `storedStats` and base stats.
- The `Transform`/`Imposter` user's `storedStats` **remain frozen at the copied pre-Mega base stats** — it does not Mega Evolve alongside `target`.

Prior to commit `ac15996`, `evidence.mjs` modeled copied stats dynamically rather than snapshotting the copied forme:

1. **Dynamic `pokemon.species` Lookup in `rec.stat`**:
   - When `transformInto` ran (`evidence.mjs:3525`), it called `depOf(from, s)` for each movable stat.
   - When `from` was an unknown Pokémon (`!from.kn.known`), `depOf` returned `{ owner: from, stat: s, at: v => from.stat(s, v) }`.
   - `rec.stat(stat, sp)` (`evidence.mjs:487-499`) always read `const species = stat === 'hp' ? hpSpecies : pokemon.species;` at the time `at(v)` was invoked — i.e., **during later `analyseHit()` / `dryRow()` / `speedsOf()` evaluations**, rather than at `transformInto` time.
2. **Corrupted Dry-Run Damage Calculations**:
   - After `from` Mega Evolved, every subsequent hit involving the transformed Pokémon evaluated the copied stat using `from.pokemon.species` (the Mega forme's `baseStats`) instead of the pre-Mega forme actually copied into `storedStats`.
   - When the Mega forme had higher Defense/SpD than the base forme (e.g., `Aerodactyl` 65 Def → `Aerodactyl-Mega` 85 Def; `Gardevoir` 115 SpD → `Gardevoir-Mega` 135 SpD; `Garchomp` 95 Def → `Garchomp-Mega` 115 Def; `Metagross` 130 Def → `Metagross-Mega` 150 Def), `dryRow` overstated the transformer's bulk by `+20` stat points, making observed damage unreachable at the real attacker's Stat Points (`REMOVED`).
   - Conversely, when the Mega forme had higher SpA (e.g., `Garchomp` 80 SpA → `Garchomp-Mega` 120 SpA), `dryRow` overstated the transformer's offensive output by `+40` base SpA, falsely eliminating the real defender's low-SpD spread (`REMOVED` in `2698084073`).
   - Even when percentage masking kept the real spread alive (`both@spectator` in `2697567566`), `paths()` emitted impossible `exact` HP/roll proofs computed under the Mega forme's stats (`22` broken proofs), causing `inferSpreads` to loop at Turn 1 and `GAVE UP`.
3. **Asymmetric Single-View Masking**:
   - Whenever the copied source `from` belonged to the *known* side (`from.kn.known === true`, e.g., `p1@p2` when P1's Ditto copied P2's Pokémon, or `p2@p1` when P2's Ditto copied P1's Pokémon), `depOf(from, s)` returned `CONSTANT` (`evidence.mjs:566`). `analyseHit` then skipped `sp`/`tp` patching and used the simulator's true `storedStats` directly, explaining why the mirror single-player view passed in every case while the opposite view suffered `REMOVED`.

---

## 3. Single Cohesive Fix Specification

Commit `ac15996` (`ac15996a344d96fc9e33fb3658328064d74dc888`) implements the exact mechanism-level fix in `scripts/lib/inference/evidence.mjs`:

1. **Optional `forme` Parameter on `rec.stat` (`scripts/lib/inference/evidence.mjs:488-500`)**:
   ```js
   stat(stat, sp, forme = pokemon.species) {
     const species = stat === 'hp' ? hpSpecies : forme;
     let table = byForme.get(species);
     ...
   ```
   `byForme` already keys cached `Int32Array` stat tables by `species` object identity (each Dex species/forme is a distinct frozen object), so pre-Mega and post-Mega tables coexist cleanly without collision.
2. **Forme Snapshot Inside `depOf` (`scripts/lib/inference/evidence.mjs:563-571`)**:
   ```js
   function depOf(rec, stat) {
     if (rec.unmapped.has(stat)) return null;
     if (rec.deps[stat]) return rec.deps[stat];
     if (rec.kn.known) return CONSTANT;
     // The forme it is now: a copy Transform kept stays what it was when
     // copied after the original Mega Evolves or changes forme.
     const forme = rec.pokemon.species;
     return { owner: rec, stat, at: v => rec.stat(stat, v, forme) };
   }
   ```
   Because `transformInto` calls `depOf(from, s)` (`line 3525`) before executing `transformInto` and stores the returned object in `r.deps[s]` (`line 3544`), `forme` is frozen to `from.pokemon.species` at the exact instant the copy occurs. Subsequent Mega Evolutions or other forme changes on `from` never alter `dep.at(v)`.

### Remaining Edge-Case Audit
All other callers of `rec.stat()` and `depOf()` in `scripts/lib/inference/` were checked against `origin/main`:
- `evidence.mjs:508, 553` (`hp` only): always uses `hpSpecies`, which never changes on Transform or Mega Evolution.
- `evidence.mjs:810-811` (`selfHit`): only runs when `dep.owner === T && dep.stat === stat` (untransformed own stats).
- `evidence.mjs:3020` (`Strength Sap`): guarded by `plain(T, 'atk')` (`line 3024`).
- `evidence.mjs:3105-3169` (`askWrites` / `settleWrites` for `Power Split`, `Guard Split`, `Speed Swap`, `Power Trick`): evaluates `dep.at(v)` immediately into an `Int32Array` at write time.
- `evidence.mjs:3642` (`getBestStat`): guarded by `if (this.transformed || MOVABLE.some(s => !plain(rec, s)))` (`line 3628`).
- `speed.mjs:123` (`speedsOf`): reads `depOf(rec, 'spe')` and invokes `dep.at(s)`, which automatically uses the snapshotted `forme`.
- `setSpecies` (`evidence.mjs:538-550`): clears `rec.deps` when `!state.dry && !args[2]` (switching out resets Transform). In Showdown, already-transformed Pokémon cannot Mega Evolve and `transformInto` fails against an already-transformed target.

**Verdict**: Commit `ac15996` completely resolves F01 across all battle mechanisms (`Transform`, `Imposter`, `Mega Evolution`, `Body Press`, spread/single hits, speed order) with **no remaining edge cases**. (The secondary fallback loops observed in `gaveup-2697567566.md` were downstream symptoms of the 22 broken Turn 1 `exact` proofs produced by this bug.)

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2697567566` (`p2@p1` `REMOVED` & `both@spectator` `GAVE UP`)
- **Ground Truth**:
  - `p1:5 Ditto` (planted `hp = 23`, `146/146` HP) enters on Turn 0 and copies base `p2a: Aerodactyl` (`0/32/0/0/2/32`, base Def `65` → **Def `85`**, Spe `200`) via `Imposter`.
  - Turn 1: `p2a: Aerodactyl` Mega Evolves into `Aerodactyl-Mega` (base Def `85` → **Def `105`**, Spe `222`). `p2b: Garchomp` (`Adamant`, `Choice Scarf`, planted `10/20/9/0/0/27`, **Atk `187`**, Spe `223`) hits `p1b: Ditto` with `Dragon Claw` on roll `r = 12` (88%), dealing **103 damage** (`|-damage|p1b: Ditto|43/146` in `p2@p1`, `29/100` in `both@spectator`).
- **Pre-`ac15996` Failure**:
  - `p1@p2` passed (`10.3s`) because `p2:2 Aerodactyl` was known (`depOf` returned `CONSTANT`).
  - In `p2@p1` (`107.6s`), `rec_aerodactyl.stat('def', v)` read `Aerodactyl-Mega` (**Def `105 + v`**). Against `105` Def, real `Garchomp` (`atk = 20`, Atk `187`) caps at `96` max roll damage, forcing `Garchomp atk = [32, 32]` (`200` Atk, 100% roll = `103`) and `Aerodactyl def = 0`. Eliminating `atk = 20` removed `p2:0 Garchomp`, and the 66-SP cap (`Garchomp spe <= 22`) propagated via Turn 1 `orderSpeeds` (`Garchomp > Aerodactyl`) to cap `Aerodactyl spe <= 22`, removing `p2:2 Aerodactyl`'s real `spe = 32`.
  - In `both@spectator` (`1,692.6s` sweep / `508.0s` trace), `p1:5 Ditto` survived at `hp = [1, 23]` by 1 SP (`hp >= 24` required `>= 104` damage), while `paths()` emitted **22 broken Turn 1 `exact` proofs** (`40/136 -> 18/136`, `43/145 -> 36/145`, `43/146 -> 37/146`), triggering `searched.get(mark) >= 2` and `GAVE UP` even after `widest-wide` reached Turn 5.

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2708671848` (`p2@p1` `REMOVED` — 4 Real Spreads Wiped)
- **Ground Truth**:
  - Turn 0: `p1b: Ditto` (`155/155` HP) copies base `p2a: Metagross` (`9/7/12/1/19/18`, base Def `130` → **Def `178`**).
  - Turn 1: `p2a: Metagross` Mega Evolves into `Metagross-Mega` (base Def `150` → **Def `200`**). Both accumulate `+5` Def via `Cosmic Power`.
  - Turn 7: `|move|p2a: Metagross|Body Press|p1b: Ditto` → `|-damage|p1b: Ditto|91/155` (from `143` HP, **52 damage** against Ditto's real `178 * 3.5 = 623` Def).
- **Pre-`ac15996` Failure**:
  - Both `Body Press` stats collapsed onto `owner: p2:1, stat: 'def'` (`by: 'a'`), evaluating Ditto's Defense with `Metagross-Mega`'s `150` base Def (`200 * 3.5 = 700` vs `700`). That predicted `[39, 47]` damage (`96..104/155`), missing `91/155` for all 32 candidates and wiping `p1:0 Ditto` and `p2:1 Metagross` (`3,125,791 -> 0`) at Turn 7 Event 10.
  - Because `p2:1 Metagross` had `0` keys left, Turn 9 `Ditto`'s `Body Press` (`hit.aVals = []`) wiped `p2:3 Sylveon` (`22,848,153 -> 0`), `backward()` on empty Ditto HP paths wiped `p2:4 Rillaboom` (`1,071 -> 0`), and `settle()` Pass 2 propagated empty `Metagross` `aVals` to Turn 4 `Body Press` to wipe `p2:5 Incineroar` (`69,925,857 -> 0`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2697567566.md` | `gaveup` | `both@spectator`, `p2@p1` (`REMOVED`) | `GAVE UP` (`both@spectator`, 508.0s trace / 1,692.6s sweep, 22 broken proofs) | Pre-`ac15996` `Imposter` + `Aerodactyl-Mega` forme bug evaluated `Ditto`'s copied Def at `105 + v` instead of `85 + v`, emitting 22 impossible Turn 1 `exact` proofs (`40/136`, `43/145`, `43/146`) and hitting `searched.get(mark) >= 2` after `widest-wide` reached Turn 5. |
| `removed-2697567566.md` | `removed` | `p2@p1` (`REMOVED`), `both@spectator` (`GAVE UP`) | `REMOVED` (`p2@p1`, 107.6s; `p1@p2` `PASS` 10.3s) | Turn 1 `p2b: Garchomp` `Dragon Claw` (`103` dmg to `p1b: Ditto`, `43/146`) evaluated `Ditto` against `Aerodactyl-Mega` Def (`105 + v` vs `85 + v`), forcing `Garchomp atk = 32` (removing real `atk = 20`) and cascading via 66-SP budget + speed order to remove `p2:2 Aerodactyl`'s real `spe = 32`. |
| `removed-2697689088.md` | `removed` | `p1@p2` (`REMOVED`), `both@spectator` (`GAVE UP`) | `REMOVED` (`p1@p2`, 247.2s, 2 real spreads removed; `p2@p1` `PASS` 31.3s) | Turn 1 `p2a: Ditto` `Imposter` copied base `Gardevoir` (base SpD `115`) before `Gardevoir` Mega Evolved (base SpD `135`); `depOf` evaluated Ditto's SpD as `155` instead of `135` on Helping Hand `Hyper Voice` (`124` dmg, `31/155`), removing `p1:1 Gardevoir` (`spa = 25`) and cascading via `speed.mjs` `bound()` to wipe `p1:2 Indeedee-F`. |
| `removed-2698084073.md` | `removed` | `p2@p1` (`REMOVED`), `both@spectator` (`REMOVED`) | `REMOVED` (`p2@p1` & `both@spectator`; `p1@p2` `PASS`) | Turn 4 `p1b: Ditto` copied base `Garchomp` (Def `95`, SpA `80`) before `Garchomp` Mega Evolved (Def `115`, SpA `120`); `rec.stat()` used `Garchomp-Mega` stats for `Ditto` on Turn 4 `Poison Jab` (`25` dmg, `106/155`) and Turn 5 `Draco Meteor` (`64/100`), removing `p2:5 Garchomp` (`atk = 0`) and `p2:0 Ariados` (`spd = 2`). |
| `removed-2708671848.md` | `removed` | `p2@p1` (`REMOVED`), `both@spectator` (`GAVE UP`) | `REMOVED` (`p2@p1`, 34.2s, 4 real spreads removed; `p1@p2` `PASS` 18.3s) | Turn 0 `Imposter` `Ditto` copied base `Metagross` (Def `130`) before Turn 1 `Metagross-Mega` (Def `150`); at Turn 7 `Body Press` (`91/155`), `rec.stat` evaluated `Ditto` at `150` base Def (`[39, 47]` dmg vs `52`), wiping `p2:1 Metagross` (`3.13M -> 0`) and cascading to wipe `p2:3 Sylveon`, `p2:4 Rillaboom`, and `p2:5 Incineroar`. |
