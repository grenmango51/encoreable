# F04: `readHandlerSort` Using Trick-Room-Negated `getActionSpeed()` for `SwitchIn` Ability Sorting

## 1. Failure Overview & Status

| Field | Value |
|---|---|
| **Bucket ID** | `F04` (`switchin-readhandlersort-trick-room-speed`) |
| **Category** | 1. Crashes & Soundness Removals |
| **Status on `origin/main`** | **LIVE** (verified on `origin/main` `61378f1`) |
| **Primary Subsystem** | `scripts/lib/inference/speed.mjs` |
| **Secondary Subsystems** | `scripts/lib/inference/knowledge.mjs` (`orderSpeeds`) |
| **Source Shard Clusters** | `S13-C01` |
| **Total Merged Reports** | **1** (`removed-2696763978.md`) |
| **View Breakdown** | `both@spectator`: **1 REMOVED** (`p2@p1`: PASS, `p1@p2`: PASS) |

### Verified Live Code Locations

| File | Function / Hook | Line Numbers | Role in Defect |
|---|---|---|---|
| `scripts/lib/inference/speed.mjs` | `attachSpeed` (`p.setSpecies` override) | `256-266` | Caches `this.storedStats.spe` into `rec.cachedSpeed` on forme change / init |
| `scripts/lib/inference/speed.mjs` | `attachSpeed` (`p.updateSpeed` override) | `267-276` | Unconditionally caches `p.getActionSpeed()` (negated by Trick Room in Champions) into `rec.cachedSpeed` |
| `scripts/lib/inference/speed.mjs` | `battle.speedSort` override (`SwitchIn`) | `286-312` (`306-307`) | Populates `top.entry.speeds` from `rec.cachedSpeed` and invokes `readHandlerSort(list, comparator, true)` |
| `scripts/lib/inference/speed.mjs` | `readHandlerSort` (`switchIn = true`) | `401-448` (`410-420, 446`) | Checks `sortedBy(fx, ..., pokemonOf(item).speed)` and binds `read.speeds` to `X.cachedSpeed` / `Y.cachedSpeed` |
| `scripts/lib/inference/speed.mjs` | `speedRules` (`handlerSorts` loop) | `660-684` (`678-680`) | Emits `ruleOf(Y, X, read.speeds, ...)` at `prefix.cutoffAt` when the swapped `runSwitch` output matches `prefix.observedLine` |
| `scripts/lib/inference/speed.mjs` | `bound` | `874-887` | Eliminates every Speed SP where `tf[v] < minSlow` or `ts[v] > maxFast` |
| `scripts/lib/inference/knowledge.mjs` | `orderSpeeds` | `421-443` | Re-applies `pass.orders` across rounds; clears `dom.spe` (`fill(0)`) when `maxFast < minSlow` |
| `node_modules/pokemon-showdown/dist/sim/battle.js` | `Battle.prototype.resolvePriority` | `765-774` | Sets `handler.speed = pokemon.speed` (less field-position tie-break for `SwitchIn`) |
| `node_modules/pokemon-showdown/dist/sim/pokemon.js` | `Pokemon.prototype.updateSpeed`, `setSpecies` | `283-285`, `1008` | `setSpecies` sets `this.speed = this.storedStats.spe`; `updateSpeed` sets `this.speed = this.getActionSpeed()` |
| `node_modules/pokemon-showdown/dist/data/mods/champions/scripts.js` | `pokemon.getActionSpeed` | `64-71` | Under Trick Room (`trickRoomCheck`), returns `-speed` |

---

## 2. Root-Cause Mechanism

1. **How Showdown Determines `SwitchIn` Speed vs. Action Speed:**
   - In Champions (`node_modules/pokemon-showdown/dist/data/mods/champions/scripts.js:64-71`), `Pokemon.prototype.getActionSpeed()` computes `let speed = this.getStat('spe', false, false)` and negates it (`speed = -speed`) whenever Trick Room is active (`trickRoomCheck`).
   - In `node_modules/pokemon-showdown/dist/sim/battle.js:765-774` (`resolvePriority`), `SwitchIn` event handlers do **not** call `getActionSpeed()`; they read `handler.speed = pokemon.speed` (minus the `speedOrder` fractional tie-break).
   - On `Pokemon` initialization and forme changes (`setSpecies` at `sim/pokemon.js:1008`), Showdown assigns `this.speed = this.storedStats.spe` (positive raw Speed). Only `battle.updateSpeed()` (`sim/battle.js:241-244`, called during `commitChoices`, `residual`, and before `move`/`runDynamax` for currently active Pokémon in `this.getAllActive()`) calls `pokemon.updateSpeed()` (`sim/pokemon.js:283-285`), which writes `this.speed = this.getActionSpeed()`. `BattleActions.prototype.switchIn()` (`sim/battle-actions.js:76-158`) does **not** call `updateSpeed()` before `runSwitch()` runs `fieldEvent('SwitchIn', switchersIn)` (`sim/battle-actions.js:171-180`).

2. **How `speed.mjs` Caches and Feeds Speeds into `readHandlerSort(..., true)`:**
   - In `scripts/lib/inference/speed.mjs:268-275`, every call to `p.updateSpeed()` unconditionally overwrites `rec.cachedSpeed` with:
     ```js
     rec.cachedSpeed = memo(`upd|${at}|${rec.id}`, () => speedsOf(rec, () => p.getActionSpeed()));
     ```
     Under Trick Room, every entry of `rec.cachedSpeed.table` is negative (`-spe`).
   - When `battle.fieldEvent('SwitchIn', switchersIn)` calls `battle.speedSort(handlers)`, `speed.mjs:306-307` copies `it.rec.cachedSpeed` into `top.entry.speeds` and calls `readHandlerSort(list, comparator, true)`.
   - Inside `readHandlerSort` (`speed.mjs:401-448`), `speedOf(item)` reads `pokemonOf(item).speed`, and line `418` checks `sortedBy(fx, list[i], speedOf(list[i])) && sortedBy(fy, list[i + 1], speedOf(list[i + 1]))`. Once matched, line `446` stores `speeds = new Map(pairs.flatMap(({ X, Y }) => [[X, X.cachedSpeed], [Y, Y.cachedSpeed]]))`, and `frame.rerun()` dry-runs `runSwitch` with adjacent pairs swapped.
   - At `prefix.cutoffAt`, `speedRules()` (`speed.mjs:678-680`) sees that the swapped run's line matches `prefix.observedLine` and emits `ruleOf(Y, X, read.speeds, read.turn, ...)`.

3. **Why This Causes Soundness Collapse (`REMOVED`):**
   - In `mimic:gen9championsvgc2026regmcbo3-2696763978`, Trick Room was set on Turn 1 and remained active at Turn 4 upkeep (`index 22`), where `p1a: Indeedee-F` (`Psychic Surge`) and `p2a: Salamence` (`Intimidate`) entered.
   - The observed replay emitted `|-ability|p2a: Salamence|Intimidate|boost` before `Psychic Surge` (Salamence raw Speed `min 132 >` Indeedee-F raw Speed `max 123`), whereas Round 7's `reconstruct` printed `Psychic Surge` first.
   - Because `readHandlerSort(..., switchIn = true)` bound `read.speeds` to `rec.cachedSpeed` computed from `p.getActionSpeed()`, `speed.mjs` recorded `Order 21` with Trick-Room-negated tables:
     - `fast = p2:3 (Salamence)`: `tf = [-132, -133, ..., -167]`
     - `slow = p1:0 (Indeedee-F)`: `ts = [-94, -95, ..., -123]`
   - In `orderSpeeds()` (`knowledge.mjs:421-443`) and `bound()` (`speed.mjs:874-887`), the constraint requires `tf[v] >= minSlow` (`-132 >= -123`) and `ts[v] <= maxFast` (`-123 <= -132`), which is **false for every Speed SP `0..32`**.
   - `orderSpeeds()` immediately zeroed `dom.spe` (`fill(0)`) for both `p2:3` and `p1:0`, propagated the contradiction across chained speed orders to all 8 seen Pokémon, and `tighten()` cleared `keys.fill(0)`, leaving **0 surviving spreads** for every seen Pokémon (`REMOVED`).

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1 ("Showdown's simulator is the only source of mechanics") and #2 ("Never remove a possibility the replay allows"), the fix in `scripts/lib/inference/speed.mjs` must construct `SwitchIn` handler speed tables directly from the **uninverted raw speed** that `SwitchIn` handlers sort on (or match the exact raw `pokemon.speed` semantics without Trick-Room negation), rather than feeding Trick-Room-negated `getActionSpeed()` tables into `readHandlerSort(..., switchIn = true)`:

1. **Compute Raw Speed Tables Alongside `getActionSpeed()` Tables (`scripts/lib/inference/speed.mjs:256-276`):**
   - Maintain an uninverted raw-speed table `rec.rawSpeed` alongside `rec.cachedSpeed` (updated whenever `setSpecies` or `updateSpeed` runs, computing `speedsOf(rec, () => p.getStat('spe', false, false))` — or `this.storedStats.spe` inside `setSpecies` — i.e., the simulator's own `getStat('spe')` with boosts, items, Tailwind, and paralysis applied by the simulator, **without** `getActionSpeed()`'s Trick Room negation).
   - Crucially, in `readHandlerSort(list, comparator, switchIn = false)` (`speed.mjs:401-448`) and `battle.speedSort` (`speed.mjs:306-307`), when `switchIn === true`:
     - Select `rec.rawSpeed` (not Trick-Room-negated `rec.cachedSpeed`) as the candidate table `fx`/`fy` and `read.speeds` when `SwitchIn` sorts by raw Speed (`sortedBy(fx, list[i], speedOf(list[i]))`).
     - Because `sortedBy` (`speed.mjs:387`) already verifies `speeds.table[ownValue] === pokemonOf(item).speed`, if a Pokémon's `pokemon.speed` in Showdown was instead updated by an earlier `updateSpeed()` under Trick Room (`pokemon.speed < 0`), `sortedBy(rec.rawSpeed, ...)` safely returns `false` and skips the pair rather than ever emitting a false or inverted bound (preserving 100% soundness per Rule #2).
     - Better yet, if `SwitchIn` in Showdown mixes fresh switch-ins (`pokemon.speed = storedStats.spe`) and previously active switch-ins (`pokemon.speed = getActionSpeed()`), `rec.cachedSpeed` should track the exact expression that last wrote `pokemon.speed` (`storedStats.spe` vs `getActionSpeed()`), **and** any `SwitchIn` pair where Trick Room is active and `sortedBy` detects Trick-Room-negated `pokemon.speed` must **never** emit an order asserting raw `Salamence < Indeedee-F` against a replay where `Salamence > Indeedee-F` — specifically:
       - If `rec.rawSpeed` is used for `SwitchIn` (`switchIn = true`) when Showdown sorts `SwitchIn` uninverted, `tf = [132..167]` and `ts = [94..123]` give `maxFast = 167 >= minSlow = 94`, keeping all valid spreads cleanly.
       - Never infer a speed bound for `SwitchIn` from a negated `getActionSpeed()` table (`rec.cachedSpeed` under `trickroom`) when `switchIn = true`; either use `rec.rawSpeed` verified via `sortedBy`, or bail out (`note(...)`, no rule emitted) if `pokemon.speed !== rawSpeed` under Trick Room.

2. **Why This Is One Cohesive, Sound Fix:**
   - Touches only `scripts/lib/inference/speed.mjs` (`updateSpeed`/`setSpecies` caching and `readHandlerSort(..., true)`).
   - Zero move/species/ability hardcoding (Rule #3).
   - Never delegates mechanics away from Showdown (`p.getStat('spe', false, false)` / `p.speed` come straight from Showdown, Rule #1) and `sortedBy` guarantees no spread consistent with Showdown's actual `pokemon.speed` is ever eliminated (Rule #2).

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2696763978` (`removed-2696763978.md`)

- **View & Outcome**: `both@spectator` (Channel 0): **`REMOVED`** in `626.3s` (`p2@p1`: PASS in `24.3s`; `p1@p2`: PASS in `27.6s`).
- **Real Spreads Eliminated**: All 8 seen Pokémon (`p1:0` Indeedee-F `32/0/32/0/2/0` Relaxed, `p1:1` Armarouge, `p1:3` Kingambit, `p1:4` Gardevoir, `p2:0` Rillaboom, `p2:1` Arcanine-Hisui, `p2:3` Salamence `2/0/0/32/0/32` Timid, `p2:4` Milotic) dropped to **`0` spreads left (`kept: false`)**. (The 4 unseen bench Pokémon kept `136,663,185` spreads.)
- **Exact Elimination Trace**:
  1. **Turn 1**: `p1:0 Indeedee-F` sets **Trick Room** (`trickroom`), which remains active through Turn 4.
  2. **Round 7 Scaffold Guess**: `p1:0 Indeedee-F` guessed at `17/0/23/11/0/15` (`spe=15`, Level 50 raw Spe `109`), `p2:3 Salamence` guessed at `32/0/2/0/0/32` (`spe=32`, Level 50 raw Spe `167`).
  3. **Turn 4 Upkeep (`index 22`) Divergence**:
     - Expected (Replay): `|-ability|p2a: Salamence|Intimidate|boost`
     - Actual (Reconstruct): `|-fieldstart|move: Psychic Terrain|[from] ability: Psychic Surge|[of] p1a: Indeedee`
  4. **Pass 1 of `settle(...)` (`speed.mjs:307, 401-448, 678-680`)**:
     - `readHandlerSort(..., switchIn = true)` swaps `[Indeedee-F, Salamence]` $\to$ `[Salamence, Indeedee-F]`, matches `|-ability|p2a: Salamence|Intimidate|boost`, and emits **Event 14**: `"Salamence-Mega came before Indeedee-F in a handler's order"`.
     - Because `rec.cachedSpeed` came from `p.getActionSpeed()` under Trick Room, **Order 21** records:
       `{"fast":"p2:3","slow":"p1:0","tf":[-132..-167],"ts":[-94..-123]}`
  5. **Domain Collapse (`knowledge.mjs:421-443`)**:
     - Timid `Salamence` (base Spe `100`, `+Spe`): minimum Level 50 Speed $= \lfloor(100 + 0 + 20) \times 1.1\rfloor = 132$, maximum $= 167$ $\implies$ `tf` in `[-132..-167]`.
     - Relaxed `Indeedee-F` (base Spe `85`, `-Spe`): minimum Level 50 Speed $= \lfloor(85 + 0 + 20) \times 0.9\rfloor = 94$, maximum $= \lfloor(85 + 32 + 20) \times 0.9\rfloor = 123$ $\implies$ `ts` in `[-94..-123]`.
     - Requiring `tf >= min(ts)` (`-132 >= -123`) is impossible, triggering `dom.spe.fill(0)` on `p2:3` and `p1:0`, cascading via chained speed orders to `after: 0` across all 8 seen Pokémon.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `removed-2696763978.md` | `removed` | `both@spectator` | `REMOVED` (`626.3s` sweep) | Turn 4 upkeep under Trick Room (`index 22`): `speed.mjs` `readHandlerSort(..., switchIn = true)` used Trick-Room-negated `getActionSpeed()` (`tf = [-132..-167]` vs `ts = [-94..-123]`) for `Intimidate` (`Salamence`) before `Psychic Surge` (`Indeedee-F`), asserting impossible raw Speed `Salamence < Indeedee-F` (`min 132 < max 123`) and emptying `dom.spe` / `keys` to `0` for all 8 seen Pokémon. |
