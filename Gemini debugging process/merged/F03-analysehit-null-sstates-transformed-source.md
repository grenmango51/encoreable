# F03: `analyseHit` Null Dereference (`s[2]`) When Transform/Imposter Source `X.chain` Is Empty

## 1. Failure Overview & Status
- **Bucket ID**: `F03`
- **Category**: `1. Crashes & Soundness Removals`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` (`analyseHit`)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs:994-1017` — `analyseHit` builds `sStates` inside `if (hit.sourceHp || X)` and unconditionally falls back to `hit.sStates = sStates.length ? sStates : [null];` (`line 1016`).
  - `scripts/lib/inference/evidence.mjs:1018-1041` — `hit.rows` generation loops `for (const [si, s] of hit.sStates.entries())` and evaluates `depOf(byPokemon.get(pokemon), r.key).at(r.by === 'a' ? a : r.by === 'x' ? s[2] : d)` (`line 1030`), crashing with `TypeError: Cannot read properties of null (reading '2')` whenever `r.by === 'x'` and `s === null`.
  - `scripts/lib/inference/evidence.mjs:1148-1160, 1241` (`moveChange`) & `2392, 2417` (`subChange`) — consume `hit.sStates` only when `hit.supported` is `true`.
  - `scripts/lib/inference/evidence.mjs:1981-1984, 2549-2571` (`origGetDamage` & change recording) — when `hit.supported` is `false`, `origGetDamage` skips `subGates` and HP change recording falls back to `band('down', ...)`.
- **Total Merged Reports**: **1** (`crash`: 1 — `crash-2704147942.md`)
  - **View Breakdown in Sweep**:
    - `both@spectator`: **1** (`CRASH`, Round 15, Pass 0)
    - `p2@p1`: `0` failed (`PASS`, `15.2s`)
    - `p1@p2`: `0` failed (`PASS`, `17.7s`)
  - **Source Shard Clusters**: `S03-C01`

---

## 2. Root-Cause Mechanism

When a hit evaluated by `analyseHit()` (`scripts/lib/inference/evidence.mjs:842-1043`) reads either the attacker's HP (`hit.sourceHp`) or a third/extra candidate dependency `X` (`hit.extra`, such as a `Transform`/`Imposter` target's Defense, `Guard Split` Defense, or `Gyro Ball`/`Electro Ball` Speed):

1. **Setup of `hit.extra` and `r.by === 'x'` (`evidence.mjs:922-948`)**:
   - In the `shape` pass, `analyseHit` classifies target defense readers owned by `T` as `'d'`, `offVar` as `'a'`, and `extraVar` as `'x'` (`readers` entries with `r.by === 'x'`).
   - When `Ditto` (`T = p1:0`) has transformed into `p2:2` (`Arcanine-Hisui`) via `Imposter`, `depOf(Ditto, 'def')` has `owner: 'p2:2', stat: 'def'`. Because `owner !== T.id`, `shape` classifies it as `hit.extra = { owner: 'p2:2', stat: 'def' }` with a reader `{ who: 'target', key: 'def', by: 'x' }`.
2. **Empty `sStates` Fallback to `[null]` (`evidence.mjs:994-1017`)**:
   - `analyseHit` resolves `X = hit.extra ? byId.get(hit.extra.owner) : null;` and `xDim = !!X && !FLAT.includes(hit.extra.stat);`.
   - Inside `if (hit.sourceHp || X)`:
     - `values` is collected from `X.chain.keys()` (if `xDim`) or `aliveOf(X.flat[hit.extra.stat])` (if flat).
     - Then `for (const [k, hs] of S.chain)` adds `[M, h, x]` tuples to `sStates`.
   - If **either** `S.chain.size === 0` (the attacker `S` already lost all surviving spreads earlier in the pass — e.g., when `X === S` and an earlier hit in the same turn emptied `S.chain`), **or** `X !== S` and `values.length === 0` (`X.chain.size === 0` or `aliveOf(X.flat[...]).length === 0`), **zero** `[M, h, x]` entries are pushed into `sStates` (`sStates.length === 0`).
   - Line `1016` was written for the `!hit.sourceHp && !X` case (or the `sourceHp`-only case) and unconditionally sets:
     ```js
     hit.sStates = sStates.length ? sStates : [null];
     ```
3. **Unhandled `TypeError` Inside `actions.getDamage` Hook (`evidence.mjs:1020-1039`)**:
   - Immediately afterward, `analyseHit` iterates `for (const [si, s] of hit.sStates.entries())` with `s = null`.
   - Inside the `memo` callback, line `1030` evaluates:
     ```js
     (r.who === 'source' ? sp : tp).stats[r.key] = depOf(byPokemon.get(pokemon), r.key).at(r.by === 'a' ? a : r.by === 'x' ? s[2] : d);
     ```
   - Because `hit.readers` contains `{ ..., by: 'x' }`, `r.by === 'x'` executes `s[2]` on `s === null`, throwing `TypeError: Cannot read properties of null (reading '2')`.
   - Note also a latent soundness flaw in the `hit.sourceHp && !X` subcase: if `hit.sourceHp` is true (`X === null`) and `S.chain.size === 0`, falling back to `hit.sStates = [null]` with `hit.supported = true` causes line `1034` (`if (s && s[0] !== null)`) to skip patching `source.hp`, running `dryRow` against the *scaffold's* single unverified `source.hp` rather than setting the hit aside.
4. **Mid-Move Exception Corrupts `stream.battle.log` (`evidence.mjs:264`)**:
   - Because `analyseHit` throws inside the `actions.getDamage` hook (`line 2549`) during a spread move (`Rock Slide` / `trySpreadMoveHit`), Showdown aborts `spreadMoveHit` mid-loop before hitting the second target or calling `attrLastMove('[spread] ...')`.
   - `evidencePass` catches the perturbation at the end of the pass via `firstDivergence`:
     `Error: inference perturbed the battle at raw line 194: ... -> ...` and aborts the entire inference run with `CRASH`.

---

## 3. Single Cohesive Fix Specification

In `scripts/lib/inference/evidence.mjs` inside `analyseHit` (around lines `1014-1017`), distinguish between **"this hit has no source/extra dependency"** (`!hit.sourceHp && !X`) and **"this hit has a source/extra dependency whose surviving states are empty"** (`(hit.sourceHp || X) && !sStates.length`):

1. **Set `hit.supported = false` and Return Early When `(hit.sourceHp || X) && !sStates.length`**:
   ```js
   if ((hit.sourceHp || X) && !sStates.length) {
     hit.supported = false;
     note(what, 'a Pokemon whose stat or HP it read had no surviving spreads, so the hit was not used');
     return hit;
   }
   const targetStates = hit.targetHp ? [...tStates.values()] : [null];
   hit.sStates = sStates.length ? sStates : [null];
   ```
   *(Note: `hit.supported` was set to `true` earlier via `Object.assign(hit, shape)` at `line 970`, so resetting `hit.supported = false` before returning is mandatory.)*

2. **Why Downstream Callers Handle `hit.supported = false` Soundly**:
   - In `actions.getDamage` (`evidence.mjs:2562`): `if (fresh && hit.supported)` is `false`, so `subGates.delete(target)` cleanly skips reading a Substitute break/non-break on an unsupported hit.
   - In HP-change recording (`evidence.mjs:1981-1983`): `hit?.supported` is `false` (and `hit?.carried` is `false`), so the hit cleanly falls back to `band('down', `${effect.name} hit ${named(rec)}`)`, allowing `T`'s HP to move anywhere downward consistent with its displayed HP without crashing or eliminating any surviving spread of `T`.
   - `moveChange` (`lines 1148-1160`) and `subChange` (`lines 2392, 2417`) are **only** invoked when `hit.supported` is `true`.

3. **Why Alternative Workarounds Are Broken**:
   - **Guarding `s ? s[2] : 0` (or `undefined`)**: Passing `undefined` indexes `table[stat][undefined] = undefined` (`NaN` stats in `dryRow`), while passing `0` evaluates `X`'s stat at `SP = 0` and uses that fabricated stat to narrow `T`, violating `AGENTS.md` Rule 2 (unsound elimination).
   - **Setting `hit.sStates = []` with `hit.supported = true`**: Leaves `hit.rows` empty; `moveChange` loops `nS = 0` times and produces an empty `table`, causing `apply()` to wipe every surviving spread of `T` (`p1:0 Ditto`) to `0`.
   - **Setting `hit.supported = false` when `(hit.sourceHp || X) && !sStates.length`** obeys `AGENTS.md` Rule 2 directly (*"A line a shortcut cannot read is set aside, never trusted... Precision can be given up; soundness cannot"*).

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2704147942` (`both@spectator`, `CRASH` at Round 15 Pass 0)
- **Active State at Turn 5 (Raw Battle Log Lines `176–204`)**:
  - `p1a: Ditto` (`104/155` HP, `Shell Bell`) transformed via `Imposter` on Turn 5 (`raw line 185`: `|-transform|p1a: Ditto|p2b: Arcanine|[from] ability: Imposter`) into `p2b: Arcanine` (`p2:2`, `Arcanine-Hisui`, `128/173` HP, `Chople Berry`, `Intimidate`).
  - `p1b: Sylveon` (`171/182` HP) and `p2a: Froslass` (`177/177` HP) are also active.
- **Exact Crash Trace**:
  1. Earlier in Turn 5, `p1b: Sylveon` hit `p2b: Arcanine` (`p2:2`) with `Quick Attack`, eliminating all surviving spreads in `p2:2.chain` (`p2:2.chain.size === 0`) for Round 15 Pass 0.
  2. Next in Turn 5 (`raw line 194`), `p2b: Arcanine` (`S = p2:2`) used spread `Rock Slide` targeting `p1a: Ditto` and `p1b: Sylveon`.
  3. For target `T = p1:0 Ditto`, `depOf(Ditto, 'def')` pointed to `owner: 'p2:2', stat: 'def'`. `analyseHit` classified this as `hit.extra = { owner: 'p2:2', stat: 'def' }` (`X = p2:2`, `xDim = true`, `X === S`).
  4. Iterating `S.chain` (`p2:2.chain.size === 0`) produced `sStates = []`, so line `1016` set `hit.sStates = [null]`.
  5. At line `1030`, evaluating `r.by === 'x' ? s[2] : d` threw `TypeError: Cannot read properties of null (reading '2')` inside `actions.getDamage` before `p1b: Sylveon` was hit or `move.spreadHit` completed.
  6. `evidencePass` aborted at line `264`:
     `Error: inference perturbed the battle at raw line 194: |move|p2b: Arcanine|Rock Slide|p1a: Ditto|[spread] p1a,p1b -> |move|p2b: Arcanine|Rock Slide|p1a: Ditto`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `crash-2704147942.md` | `crash` | `both@spectator` (`p2@p1` & `p1@p2` `PASS`) | `CRASH` (`both@spectator`, Round 15 Pass 0) | Turn 5 `raw line 194` (`p2b: Arcanine` `Rock Slide` on `Imposter`-transformed `p1a: Ditto` after Turn 5 `Quick Attack` emptied `p2:2.chain`): `analyseHit` fell back to `hit.sStates = [null]` (`evidence.mjs:1016`) and dereferenced `s[2]` on `s === null` for `r.by === 'x'` (`evidence.mjs:1030`), throwing `TypeError` mid-`spreadMoveHit` and truncating `[spread] p1a,p1b`. |
