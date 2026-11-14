# F16: Turn-0 `SwitchIn` Speed-Order Blindness: Uninitialized `cachedSpeed`, Silent `handlerSorts` Cutoff, Empty `seen`, & `t >= 1` Fallback Guard

## 1. Failure Overview & Status

- **Bucket ID**: `F16`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/speed.mjs`, `scripts/lib/inference/evidence.mjs`, `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs:244-247` (`evidencePass` installs `attachInference`—and therefore `attachSpeed`—right before the first `^>p[1-4] ` choice line, after `>player` has already constructed Pokémon and called `setSpecies`)
  - `scripts/lib/inference/speed.mjs:256-276, 306-307, 415-417` (`attachSpeed` only sets `rec.cachedSpeed` inside `setSpecies`/`updateSpeed` overrides; `battle.speedSort` invokes `readHandlerSort(..., true)` on `SwitchIn` while `rec.cachedSpeed === undefined` on all Turn-0 leads, causing `if (!fx || !fy ...)` to skip every Turn-0 lead pair)
  - `scripts/lib/inference/speed.mjs:648, 660-684, 841-862` (`eventSorts` skips silent spans via `shownIn(m.span)`; `handlerSorts` at line 674 drops swapped runs that end cleanly with fewer lines via `if (j >= mine.length || j >= theirs.length) continue;`; `eventSorts` divergence check at line 850 returns `whose('|turn|1') === null`)
  - `scripts/lib/inference/evidence.mjs:480, 4095` & `scripts/lib/inference/infer.mjs:997-1001` (`seen: !!rec.chain` is `false` for all Turn-0 leads before any HP change, leaving `choose()` with `order = []` and `next === picks`)
  - `scripts/lib/inference/infer.mjs:482` (`if (!diff || !(t >= 1) || ...)` hard-blocks `fallback()` on `t === 0`)
- **Total Merged Reports**: **3** (`gaveup`: 3)
  - **View Breakdown**:
    - `both@spectator`: **2** failed in sweep (`2694386113`, `2699678891`)
    - `p2@p1`: **2** failed in sweep (`2694386113`, `2699678891`)
    - `p1@p2`: **1** failed in sweep (`2709742901`)

---

## 2. Root-Cause Mechanism

Turn-0 `SwitchIn` ability/terrain/weather ordering (`Grassy Surge`, `Psychic Surge`, `Trace`, `Intimidate`, etc.) is governed by Showdown's `runSwitch` speed sort, yet four coupled gaps in `evidence.mjs`, `speed.mjs`, and `infer.mjs` make any Turn-0 `SwitchIn` speed-order violation unreadable to `evidencePass` and unrecoverable to `choose()` and `fallback()`:

1. **Uninitialized `rec.cachedSpeed` on Turn-0 Leads (`evidence.mjs:244-247`, `speed.mjs:256-276, 306-307, 415-417`)**:
   - In `evidencePass()` (`evidence.mjs:244-247`), `attachInference()` (which calls `attachSpeed()`) is only installed right before the first `^>p[1-4] ` choice line (the team-preview pick). By that point, `>player p1` and `>player p2` have already constructed all `Pokemon` instances and executed their initial `setSpecies()`.
   - When Turn 0 runs `commitChoices()` -> `runSwitch()` (`battle-actions.js`), `battle.updateSpeed()` iterates `getAllActive()` (still empty before leads switch in), and `runSwitch()` calls `battle.speedSort(allActive)` followed by `battle.fieldEvent('SwitchIn', switchersIn)` without calling `updateSpeed()` or `setSpecies()` on the entering leads.
   - Because `attachSpeed()` (`speed.mjs:256-276`) populates `rec.cachedSpeed` exclusively inside its `setSpecies` and `updateSpeed` overrides, **`rec.cachedSpeed` is `undefined` for every Turn-0 lead**.
   - Consequently, when `battle.speedSort` (`speed.mjs:306-307`) records `SwitchIn` and invokes `readHandlerSort(list, comparator, true)`:
     - `top.entry.speeds` receives zero entries (`if (it.rec && it.rec.cachedSpeed)` is false);
     - `readHandlerSort` (`speed.mjs:415-417`) evaluates `const fx = X?.cachedSpeed; const fy = Y?.cachedSpeed; if (!fx || !fy ...) continue;` and **silently skips every Turn-0 lead pair**.

2. **Silent-Handler Cutoff Blindness in `handlerSorts` & `eventSorts` (`speed.mjs:648, 674, 850`)**:
   - Even if `rec.cachedSpeed` were populated, Turn-0 `SwitchIn` frequently involves **idempotent field effects** (e.g., `Grassy Surge` firing when `Grassy Terrain` is already active, or `Psychic Surge` firing when `Psychic Terrain` is already active, where `field.setTerrain(...)` returns `false` and prints 0 lines):
     - While Turn 0 passes, the first setter suppresses the second setter's line (`span.start === span.end`), so `shownIn(m.span)` (`speed.mjs:648`) is `false` and `eventSorts` records no `X >= Y` rule.
     - Once a later turn's `66`-SP budget pressure shifts guesses (e.g., `aimFor()` in `knowledge.mjs:806` jumping an untouched/budget-trimmed `spe` SP) so that the wrong setter goes first, the formerly silent second setter now overwrites the field and prints an unexpected `|-fieldstart|...` line right where the real log has `|turn|1`.
     - At that Turn-0 divergence (`cutoffAt`), `eventSorts` (`speed.mjs:850`) calls `whose(prefix.observedLine)` on `|turn|1`, which names no Pokémon and returns `null`. And in `handlerSorts` (`speed.mjs:673-674`), the swapped dry run (`theirs`) omits the spurious `|-fieldstart|` line and terminates one line shorter than `mine`, so `j` reaches `theirs.length` and `if (j >= mine.length || j >= theirs.length) continue;` discards the rule.
   - Furthermore, when Round $r$ had a Turn-0 exact proof (`exact.set(0, ...)` from a passing round) and Round $r+1$'s `choose()` flips the Turn-0 lead Speed order, the next rebuild hits `brokenProof()` (`reconstruct.mjs:1730-1762`): the exact same non-tie draws (e.g., `Trace` `random(2)`) occur, yet the inverted deterministic Speed order breaks `|turn|1` inside the Turn-0 proof.

3. **Empty `seen` Set Leaves `choose()` with `order = []` (`evidence.mjs:480, 4095`, `infer.mjs:997-1001`)**:
   - `evidencePass().result()` (`evidence.mjs:4095`) defines `seen: !!rec.chain`, and `rec.chain` is initialized (`evidence.mjs:613`) only when a Pokémon undergoes an HP change.
   - On a Turn-0 `SwitchIn` stall, zero HP changes occur before `cutoffAt`, so `seen` is empty (`new Set()`). In `infer.mjs:997-1001`, `order` contains only `seen` Pokémon (`[]`), so `choose()` immediately reaches `n === seq.length`, accepts `next === picks` (`unchanged = true`), and exits without adjusting any Turn-0 lead's `spe`.

4. **Hard `t >= 1` Guard Disables `fallback()` on Turn 0 (`infer.mjs:482`)**:
   - When `unchanged === true` triggers `fallback()` (`infer.mjs:1091`), line 482 immediately aborts:
     ```js
     if (!diff || !(t >= 1) || !(diff.index >= 0) || (searched.get(mark) || 0) >= 2 || spend.fruitless.has(mark)) return null;
     ```
   - Because `t === 0` fails `!(t >= 1)`, **zero fallback rebuilds are ever run**. Every search tier (`default`, `usage`, `wide`, `widest`) escalates `level` `0 -> 1 -> 2 -> 3 -> 4` on the frozen Turn-0 guess and terminates with `stop = 'searches'`.

---

## 3. Single Cohesive Fix Specification

All four parts belong to one coherent Turn-0 `SwitchIn` handling mechanism and must be fixed together without any move/ability/species-specific rules:

1. **Initialize `rec.cachedSpeed` from the Simulator Before Turn-0 `SwitchIn` (`scripts/lib/inference/speed.mjs:256-276, 306-307`)**:
   - Immediately inside `attachSpeed` (or on first observation in `battle.speedSort` / `readHandlerSort` when `rec.cachedSpeed` is `undefined`), compute `rec.cachedSpeed = speedsOf(rec, () => rec.pokemon.getActionSpeed())` for every `rec` whose `pokemon` has not yet triggered `updateSpeed` / `setSpecies` under the proxy.
   - Because `speedsOf` queries the simulator's own `rec.pokemon.getActionSpeed()` with `p.storedStats.spe` patched per candidate SP, Turn-0 `SwitchIn` sorts (`readHandlerSort` and `eventSorts`) automatically capture exact candidate speed tables for all leads—including leads affected by Scarf/abilities/items.

2. **Extract `handlerSorts` Rules When a Swapped Prefix Ends Cleanly at `cutoffAt` (`scripts/lib/inference/speed.mjs:673-682`)**:
   - In `handlerSorts` (`speed.mjs:673-682`), when `mine` and `theirs` agree on `0..j-1`, `mine[j].at === prefix.cutoffAt`, and `j === theirs.length` (meaning the swapped handler order ended silently right where the rebuild diverged, while `mine` emitted an extra line that collided with `prefix.observedLine`), verify against the continuation of the `runSwitch` / turn prefix (or confirm that `frame.rerun()` in the swapped order produces no unexpected line before `prefix.observedLine`) and emit `ruleOf(Y, X, read.speeds, read.turn, what(Y, X))`.
   - Never guess or emit a rule unless the simulator's own swapped dry run eliminates the diverging line at `cutoffAt` while matching the verified prefix up to `cutoffAt`.

3. **Include Turn-0 `SwitchIn` Participants in `seen` / `choose()` and Enable `fallback()` at `t >= 0` (`scripts/lib/inference/evidence.mjs:4095`, `scripts/lib/inference/infer.mjs:482, 997-1001`)**:
   - In `evidence.mjs:4095` (or `infer.mjs:997-1001`), include any inferred Pokémon that participated in `speedOrders` / Turn-0 active `SwitchIn` (or was named in Turn 0) as eligible in `choose()`'s `order` when `rec.chain` is still `null`, so `choose()` respects Turn-0 `orderSpeeds` bounds even before an HP change occurs.
   - In `scripts/lib/inference/infer.mjs:482`, change `!(t >= 1)` to `!(t >= 0)` (and ensure `cutAt(0)` in line 488 slices through `|turn|1` cleanly, which `findIndex(l => ... === turn + 1)` already does since `0 + 1 === 1`, and `stood` / `namedIn` at lines 537-547 handle Turn 0 active leads). This allows `fallback()` to probe `spe` ends on Turn-0 `SwitchIn` order divergences (`0` -> `32`) instead of instantly returning `null`.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2694386113` (`both@spectator`, `p2@p1` — `GAVE UP` with 6 Broken Proofs & 0 Fallback Rebuilds)
- **Failing Views**: `p2@p1` and `both@spectator` (`p1@p2` passed). Trace (`both@spectator`, 15 threads): `44.2s`, `60` rounds, **`0` fallback rebuilds**, `3,798` probes, `stop = "searches"`, `limits = ["backtracks", "searches"]`, **`6` broken proofs** (`1` per search start).
- **Stats & Setup**:
  - `p1b: Rillaboom` (`p1:3`, Sassy, `Grassy Surge`, base Spe `85` -> `94..123`)
  - `p2a: Indeedee-F` (`p2:1`, Relaxed, `Psychic Surge`, base Spe `85` -> `94..123`)
  - `p2b: Gardevoir` (`p2:2`, Timid, `Trace`, base Spe `80` -> `145..178`)
- **Failure Trace (`trace_2694386113.log`)**:
  1. On Turn 0 `SwitchIn`, `Gardevoir` (`Spe >= 145`) acts first and `Trace` copies `Grassy Surge` from `Rillaboom`, emitting `|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p2b: Gardevoir`.
  2. Next, `p1b: Rillaboom` (`Grassy Surge`) activates **before** `p2a: Indeedee-F` (`Psychic Surge`). Because `Grassy Terrain` is already active, `Rillaboom`'s `Grassy Surge` is silent (0 lines), and `Indeedee-F` sets `Psychic Terrain` followed by `|turn|1`.
  3. Because `rec.cachedSpeed` was `undefined` on all Turn-0 leads, `speed.mjs:417` emitted no `Rillaboom >= Indeedee-F` bound.
  4. In `Default` R3 (and `Usage` R9), Turn 8 (`wanted |-damage|p1b: Rillaboom|65/100, got 50/100y`) caused `choose()` to pick `Indeedee-F.spe > Rillaboom.spe` for R4 (R10).
  5. In R4 (and R10), Turn 0 threw the identical 1 RNG draw (`Trace` `random(2) = 1`), yet `Indeedee-F` set `Psychic Terrain` before `Rillaboom`, causing `Rillaboom` to overwrite it and break the handed-on Turn-0 proof:
     - `reproduces through turn -1 - wanted |turn|1, got |-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p1b: Rillaboom` (`brokenProof` fired 6 times across all 6 starts).
  6. `speedRules()` missed the silent swapped prefix at `speed.mjs:674` (`j === theirs.length`), `seen` held no Turn-0 rule, and `infer.mjs:482` (`!(t >= 1)`) skipped `fallback()` (`0` fallback rebuilds), terminating all 6 starts with `stop = 'searches'`.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2699678891` (`both@spectator`, `p2@p1` — `GAVE UP` after Turn 2 `aimFor` Jump)
- **Failing Views**: `p2@p1` and `both@spectator` (`p1@p2` passed). Trace (`both@spectator`, 15 threads): `12.3s` (`65.0s` sweep), `40` rounds, **`0` fallback rebuilds**, `1,086` probes, `stop = "searches"`, `limits = ["backtracks", "searches"]`.
- **Stats & Failure Trace**:
  - Leads: `p1a: Rillaboom` (`Adamant`, base Spe `85`, `Grassy Surge`, default `spe=2` -> `107`, usage `spe=0` -> `105`), `p2b: Indeedee-F` (`Bold`, base Spe `85`, `Psychic Surge`, default `spe=2` -> `107`, usage `spe=0` -> `105`), `p2a: Gardevoir` (`Trace` -> `Grassy Surge` from `Rillaboom`).
  - Turn 0 requires `Rillaboom >= Indeedee-F` so `Rillaboom`'s `Grassy Surge` is silent after `Gardevoir`'s `Trace`.
  - In Start 1 R2 (and Start 2 R1), Turn 2 `Make It Rain` (`wanted |-damage|p2b: Indeedee|44/100, got 31/100`) forced `Indeedee-F` to higher bulk (`hp + spd`), so the 66-SP budget pruned `Indeedee-F`'s high `spe` values (`values.spe.length < 33`).
  - `aimFor()` (`knowledge.mjs:806`) jumped `Indeedee-F`'s untouched `spe` from `2`/`0` to midpoint `~14`, inverting Turn 0 (`wanted |turn|1, got |-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p1a: Rillaboom`).
  - With `cachedSpeed === undefined`, `handlerSorts` returning `continue` at `j === theirs.length` (`speed.mjs:674`), `whose('|turn|1') === null` (`speed.mjs:850`), and `infer.mjs:482` blocking `fallback()` on `t === 0`, all 6 starts looped on unchanged guesses and exited via `searches`.

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2709742901` (`p1@p2` — `GAVE UP` in `31.1s`)
- **Failing View**: `p1@p2` (`p2@p1` and `both@spectator` passed in sweep; `both@spectator` trace passed in `48.9s` on Start 2 `usage` after Start 1 `default` died on Turn 0).
- **Failure Trace**:
  - Leads: `p1a: Indeedee` (`p1:1`, Modest, Choice Scarf, `Psychic Surge`, `175` at `spe=2`, `220` at `spe=32`) vs `p2a: Indeedee` (`p2:3`, Modest, Choice Scarf, `Psychic Surge`).
  - Turn 0 requires `p1a: Indeedee` to set `Psychic Terrain` before `p2a: Indeedee` (which emits nothing when going second):
    - `wanted |-fieldstart|move: Psychic Terrain|[from] ability: Psychic Surge|[of] p1a: Indeedee, got |-fieldstart|move: Psychic Terrain|[from] ability: Psychic Surge|[of] p2a: Indeedee`
  - In `p1@p2`, `p2:3 Indeedee` is fixed at its planted spread (`spe > 2`), immediately breaking all 4 `default` starts (`spe = 2`) at Turn 0 with `seen = {}` (`order = []`) and `fallback()` skipped at `infer.mjs:482`. In the `usage` starts (`spe = 32`, `2/0/0/32/0/32`), Turn 2 damage from fixed `p2:1 Aerodactyl` forced `p1:1 Indeedee` to trade `spe` below `32` for `hp/def` under the 66-SP cap, crashing back into the exact same Turn-0 deadlock (`stop = "searches"`, `0` fallback rebuilds).

---

## 5. Merged Reports Manifest

| Source Report | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2694386113.md` | `gaveup` | `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 44.2s, `searches`, 6 broken proofs, 0 fallback) | Turn-0 `SwitchIn` order (`p1b: Rillaboom >= p2a: Indeedee-F`) unread (`cachedSpeed === undefined`, `handlerSorts` silent-tail drop at `speed.mjs:674`), allowing `choose()` to invert Turn 0 and break 6 proofs while `infer.mjs:482` skipped Turn-0 fallback. |
| `gaveup-2699678891.md` | `gaveup` | `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 12.3s, `searches`, 0 fallback) | Turn-2 `Make It Rain` shrank `Indeedee-F` `spe` domain via 66-SP cap, causing `aimFor()` to jump `Indeedee-F` above `Rillaboom` and invert Turn-0 `Grassy Surge` order; `speed.mjs` missed the silent rule and `infer.mjs:482` blocked fallback at `t = 0`. |
| `gaveup-2709742901.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` in 48.9s; `p1@p2` untraced, 31.1s in sweep) | Turn-0 `Psychic Surge` order (`p1:1 Indeedee >= p2:3 Indeedee`) unread on Turn 0; in `p1@p2`, fixed `p2:3` (`spe > 2`) broke all `default` starts at Turn 0, while `usage` starts traded `p1:1.spe` below `p2:3` on Turn 2 and crashed into the Turn-0 deadlock (`seen = {}`, fallback skipped at `t = 0`). |
