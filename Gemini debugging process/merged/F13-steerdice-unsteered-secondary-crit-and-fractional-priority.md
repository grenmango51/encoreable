# F13: `steerDice` Unsteered Secondary, `FractionalPriority`, Multi-Hit & `|-crit|` Rolls + `infer.mjs:624` Speed-Order Misdiagnosis

## 1. Failure Overview & Status

- **Bucket ID**: `F13` (`steerdice-unsteered-secondary-crit-and-fractional-priority`)
- **Category**: `3. RNG Steering & Variant-Budget Bugs in reconstruct.mjs`
- **Status on `origin/main`**: **LIVE** (verified against `HEAD`: none of the `steerDice`, `resolveTurn`, or `infer.mjs:624` defects have been patched since the `a12df39` trace runs)
- **Primary Subsystems**:
  - `scripts/lib/reconstruct.mjs` (`steerDice`, `resolveTurn`, `redrawTurn`)
  - `scripts/lib/inference/infer.mjs` (`fallback` order classification & SP-sweep loop)
  - `scripts/server/rng-command.js` / `scripts/lib/rng-control.mjs` (`hook` / `chance` / `substitute`)
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:804` (`ACTION_START`), `828-1130` (`steerDice`: `standing()` at `866-881`, `expect()` at `887-899`, `chanceEntry()` at `908-914`, `battle.randomChance` at `1019-1026`, `actions.hitStepAccuracy` at `1030-1050`, `actions.getDamage` at `1052-1083`, `actions.hitStepMoveHitLoop` at `1100-1129`)
  - `scripts/lib/reconstruct.mjs:1786-2045` (`resolveTurn`: `holds()`/`failAt()` at `1805-1833`, `fixes`/`trial` at `1881-1915`, single-draw scan at `1917-1952`, `pairs` scan at `1973-1994` checking `scoreOf(probe, t)[0] > score[0]` at `1984`, `brought` scan at `2000-2024` skipping `b.chance` at `2010`)
  - `scripts/lib/reconstruct.mjs:2132-2195` (`redrawTurn`: `strict = true, who = null` backtrack returning `false` on non-HP PRNG stalls)
  - `scripts/server/rng-command.js:404-490` (`rngRandom` marking `chance: st.n !== undefined && st.n !== null` at `447`, leaving `battle.random(100)` recorded as `chance: false`), `359-393` (`substitute`), `499-520` (`install`)
  - `scripts/lib/rng-control.mjs:28-30` (Node ESM bridge exposing `teachStream`, `install`, `traceOn`, `markDraws`, `atLine`)
  - `scripts/lib/inference/infer.mjs:622-625` (`order = (who(diff.actual) && who(diff.expected) && who(diff.actual) !== who(diff.expected)) || (kind(diff.actual) !== kind(diff.expected) && ACTION_START.has(kind(diff.actual)) && ACTION_START.has(kind(diff.expected)))`), `634` (`dims.sort` Speed-first), `686-689` (`again` double-spend), `814` (immediate Speed binary halving)
- **Total Merged Reports**: **31** (`kind = "gaveup"` across 15 shard clusters: `S01-C05`, `S01-C12` [partial], `S02-C11`, `S03-C06`, `S04-C09`, `S05-C03`, `S07-C08`, `S08-C10`, `S10-C03`, `S12-C03`, `S12-C09`, `S13-C04`, `S13-C10`, `S14-C07`, `S14-C11`)
- **Sweep View Breakdown** (across all 31 merged reports):
  - **All 3 views (`p1@p2`, `p2@p1`, `both@spectator`)**: **6** (`gaveup-2692108848.md`, `gaveup-2696463919.md`, `gaveup-2705100409.md`, `gaveup-2708317796.md`, `gaveup-2710266634.md`, `gaveup-2711170128.md`)
  - **`p2@p1` + `both@spectator`**: **1** (`gaveup-2695362313.md`)
  - **`both@spectator` only**: **17** (`gaveup-2692275744.md`, `gaveup-2695357412.md`, `gaveup-2695460078.md`, `gaveup-2696695453.md`, `gaveup-2698060361.md`, `gaveup-2698433335.md`, `gaveup-2699965360.md`, `gaveup-2700796479.md`, `gaveup-2701417024.md`, `gaveup-2702100920.md`, `gaveup-2703692052.md`, `gaveup-2705590171.md`, `gaveup-2706404082.md`, `gaveup-2707006405.md`, `gaveup-2707119132.md`, `gaveup-2709342294.md`, `gaveup-2710894662.md`)
  - **`p2@p1` only**: **3** (`gaveup-2694419276.md`, `gaveup-2696354296.md`, `gaveup-2702312476.md`)
  - **`p1@p2` only**: **4** (`gaveup-2698111417.md`, `gaveup-2699927531.md`, `gaveup-2700892015.md`, `gaveup-2705651347.md`)
  - *(Total view failures: `both@spectator` = 24, `p2@p1` = 10, `p1@p2` = 10)*

---

## 2. Root-Cause Mechanism

All 31 failures stem from a two-part architectural gap between `reconstruct.mjs`'s RNG steering/search loop and `infer.mjs`'s fallback triage:

### Step 1 — Simulator PRNG Call Sites Left Unsteered by `steerDice` (`scripts/lib/reconstruct.mjs:828-1130`)
In `steerDice`, `reconstruct.mjs` only wraps three simulator methods:
1. `actions.hitStepAccuracy` (`1030-1050`) — intercepts `battle.randomChance(accuracy, 100)` against `|-miss|<source>|<target>`.
2. `actions.getDamage` (`1052-1083`) — intercepts 1 `battle.randomChance(1, critMult[critRatio])` (`1020-1026`) against `|-crit|<target>` and 1 `battle.randomizer` (`random(16)`) via `bracket()`.
3. `actions.hitStepMoveHitLoop` (`1100-1129`) — intercepts `battle.sample`/`battle.random` hit count for non-Loaded-Dice `Array.isArray(move.multihit)` moves against `|-hitcount|<target>|<n>`.

Every other battle PRNG decision in Showdown runs completely **unsteered** (receiving no `wrong: true` / `reps` entry in `run.steer`):
- **Move `secondaries` & `selfDrops`** (`node_modules/pokemon-showdown/dist/sim/battle-actions.js:936-937, 1117-1146`):
  - `secondaries()` calls `this.battle.random(100)` (`line 1139`) directly—bypassing `battle.randomChance()`, so `rng-command.js:447` records `chance: false`. This covers secondary statuses (`Heat Wave` `brn`, `Blizzard` `frz`, `Discharge` `par`, `Matcha Gotcha` `brn`, `Dire Claw` 50% status), secondary stat drops (`Muddy Water` 30% `-unboost|accuracy|1`), and delayed flinch/confusion volatiles (`Rock Slide` 30% `flinch`, `King's Rock` 10% `flinch` appended at `items.js:3231-3234`, `Hurricane` 30% `confusion`).
  - Furthermore, `Dire Claw`'s `secondary.onHit` (`data/moves.js:3698-3704`) conditionally calls `this.sample(["psn", "par", "slp"])` (`random(3)`), which does not exist in `run.trace` whenever the preceding `random(100)` rolled `>= 50`.
- **Contact/Hit Ability Procs & Status Blockers**: `DamagingHit` (`battle-actions.js:954`) invokes `Poison Touch` (`randomChance(3, 10)`), `Flame Body` (`randomChance(30, 100)`), `Static`, etc.; `BeforeMove` invokes `par` (`randomChance(1, 4)`), `confusion` (`randomChance(1, 3)`).
- **Pre-Action `FractionalPriority`** (`battle-queue.js:152`): `this.battle.runEvent("FractionalPriority", action.pokemon, null, action.move, 0)` runs during action queueing (`Quick Draw` `onFractionalPriorityPriority: -1` calling `randomChance(3, 10)`, followed conditionally by `Quick Claw` `onFractionalPriorityPriority: -2` calling `randomChance(1, 5)` if `Quick Draw` fails).
- **Multi-Hit & Mid-Turn `forceSwitch` `expect(target)` Misalignment** (`reconstruct.mjs:887-899`):
  - `expect(target)` scans `for (let i = now.from; i < now.end && line < 0; i++)` stopping at the first `|-damage|` line. On multi-hit moves (`Scale Shot`, `Beat Up`), Hit 1's `expect()` sees Hit 2's or Hit 4's `|-crit|` (`2703692052`, `2701417024`), or Hit `k` loses `standing()` once an earlier hit's `|-crit|`/`|-hitcount|` diverges.
  - On `|-crit|` misses (`2710266634` after mid-turn `Revival Blessing` `forceSwitch`, `2707119132`), `getDamage` still leaves unpinned `|-crit|` resolution to `resolveTurn()` when upstream `variants` or `probes` exhaust or `standing()` mismatches.

### Step 2 — Why `resolveTurn` (`reconstruct.mjs:1786-2045`) Deadlocks on These Unsteered Draws
Because `steerDice` leaves these draws unsteered (or `resolveTurn` hits structural scan traps), `resolveTurn` stalls in four concrete ways:
1. **`brought` Explicitly Skips `b.chance` (`reconstruct.mjs:2010`)**:
   - In `2705590171` (`Quick Draw` vs `Quick Claw`), `Quick Draw = false` (`randomChance(3, 10) = 9`) lowers `scoreOf` from `[0, 3, 3]` (`|-activate|p1a: Slowbro|ability: Quick Draw`) to `[0, 1, 1]` (`|move|...`), because newly-exposed `Quick Claw` (`randomChance(1, 5)`) rolls `false` under the raw seed. When `brought` (`lines 2000-2024`) probes `flipped.trace` to pair `Quick Draw = false` with the newly-spawned draw `b`, line `2010` checks `if (!b || b.chance || b.hi - b.lo + 1 > 16 ...) continue;`—explicitly rejecting `Quick Claw` because `b.chance === true`!
   - The exact same `line 2010` `!b.chance` guard breaks `Dire Claw` + `Poison Touch` / `Flame Body` (`2695362313`, `2707006405`, `2694419276`, `2700892015`): turning `Dire Claw` OFF (`random(100) = 99`) deletes `sample(3)`, shifting `Poison Touch` / `Flame Body` (`chance: true`) down by 1 ordinal onto `i + 1`, where line `2010` refuses to probe `b`.
2. **`pairs` Rejects `fields` Progress (`reconstruct.mjs:1984`)**:
   Line `1984` requires `scoreOf(probe, t)[0] > score[0]` rather than `outranks(scoreOf(probe, t), score)`, discarding multi-target `pairs` fixes (`Muddy Water` accuracy drops on two targets, `Rock Slide` + `Quick Claw` / target draws) whenever line index ties while `fields` advances.
3. **Unsteered Secondary / `sample(3)` / `|-crit|` Probe Exhaustion Across `variants[t]` & `redrawTurn`**:
   Without `steerDice` pinning `wrong: true` directly on secondary `random(100)` (`flinch`, `brn`, `frz`, `par`, `unboost`) and `sample(3)` (`psn`/`par`/`slp`), `resolveTurn` walks unguided draws and invisible `variants[t]` (`up to 256` per turn) until hitting `probes` (`150`/`600`/`4000`/`16000`) or `ended = 'stuck'`, after which `redrawTurn(back, ..., null, true, t)` (`strict = true`) finds `moving = []` because no earlier turn's draw fixes a Turn `t` secondary/crit roll (`stop = 'stuck'`).
4. **Spectator Rounding Drift Feeding PRNG Frame Shifts (`both@spectator`)**:
   In 17 spectator-only failures (`2695460078`, `2698060361`, `2698433335`, `2700796479`, `2703692052`, `2706404082`, etc.), Channel 0 percentage quantization (`81/100` vs `82/100`, Leftovers/Grassy Terrain ticks) or invisible target variants (`Heat Wave` `randomFoe()` vs `Hurricane +1` in `2698060361`) shifts the PRNG ordinal stream onto a `< 10`/`< 30` secondary proc or `1/24` crit miss. Even when `search 4` (`resample: 1`) temporarily bypasses Turn `t`, the next round reverts to `level = 0` (`seed`), re-hitting the exact same unsteered PRNG stall.

### Step 3 — `infer.mjs:624-625` Misdiagnoses PRNG Status/Crit/Flinch Diffs as Speed-Order & Stat Defects
When `reconstruct` returns the unsteered PRNG mismatch to `inferSpreads`, `fallback()` (`scripts/lib/inference/infer.mjs:622-635`) evaluates:
```js
const kind = l => String(l || '').split('|')[1];
const who = l => (/^p[1-4][a-d]?: /.test(String(l || '').split('|')[2] || '') ? String(l).split('|')[2] : null);
const order = (who(diff.actual) && who(diff.expected) && who(diff.actual) !== who(diff.expected))
  || (kind(diff.actual) !== kind(diff.expected) && ACTION_START.has(kind(diff.actual)) && ACTION_START.has(kind(diff.expected)));
```
- **Clause 1 (`who(actual) !== who(expected)`)**: Triggers whenever `diff.actual` is a secondary/sub-event line (`|-status|p1b: Salamence|brn`, `|-status|p2b: Golisopod|frz`, `|-status|p2a: Primarina|par`, `|-unboost|p2b: Sneasler|accuracy|1`) emitted on a *target* of the previous move while `diff.expected` is the *next* move's actor (`|move|p2a: Archaludon|Dragon Pulse|...`), setting `order = true` even though `'-status' ∉ ACTION_START`.
- **Clause 2 (`kind(actual) !== kind(expected) && ACTION_START...`)**: Triggers on `|move|p2b: Grimmsnarl|Spirit Break|...` vs `|cant|p2b: Grimmsnarl|flinch` (`2692108848`) and `|move|p2b: Farigiraf|Trick Room|...` vs `|cant|p2b: Farigiraf|flinch` (`2705651347`), setting `order = true` even though `who(actual) === who(expected)`.
- **Consequence**: `fallback` sorts `spe` first (`line 634`) and immediately binary-searches Speed (`line 814`), burning the entire `8`-rebuild cap in Starts 1–2 (`FALLBACK_REBUILDS = 8`, often double-spending via `again` at `line 686`) and wasting up to **240 fallback rebuilds** across all 6 starts (`default`, `usage`, `wide`, `widest:*`) on stat sweeps that cannot alter a PRNG roll. In the few cases (`2696354296`, `2702312476`, `2705651347`, `2694419276`) where `both@spectator` stumbled past the PRNG line via an accidental Speed tie (`speedSort` `shuffle()` consuming 1 extra draw), single-player views (`p1@p2` or `p2@p1`) had the tying Pokémon `known: true` and therefore **still gave up**; in the 6 universal 3-view failures, no legal SP combination could bypass the unsteered PRNG check on any channel.

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules 1–3 (Showdown simulator is the sole source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move/species), the fix consists of one coordinated, mechanism-level RNG steering + `fallback` triage upgrade across `reconstruct.mjs` and `infer.mjs`:

### A. Mechanism-Level Steering in `steerDice` (`scripts/lib/reconstruct.mjs:828-1130`)
Extend `steerDice` using simulator event/action hooks (zero move- or species-specific rules):
1. **Secondary-Effect & Self-Drop Steering (`actions.secondaries` & `actions.selfDrops`)**:
   - Wrap `actions.secondaries` and `actions.selfDrops` when `at.k === turn && !st.dry`:
     - Intercept each `battle.random(100)` roll (`d = 100`) and any nested `battle.sample` call inside `secondary.onHit` (such as `sample(['psn', 'par', 'slp'])`).
     - Read `now = standing()`. If `now` is non-null:
       - **Immediate effects (`sec.status`, `sec.boosts`, `sec.self`)**: Check `now.wantHard.slice(now.from, now.end)` for the matching target/source protocol line (`|-status|<ident>|<status>` without `[from] ability:`, or `|-unboost|` / `|-boost|`). Emit `chanceEntry`-style `{ reps: [want ? 0 : 99], groups: new Map(), wrong }` on the `random(100)` draw. If `sec.onHit` calls `battle.sample(items)` with status IDs and `|-status|<ident>|<status>` appears in `now.wantHard[now.from..now.end]`, steer the `sample()` ordinal directly to `[items.indexOf(wantStatus)]` (`wrong: items[face] !== wantStatus`).
       - **Delayed action-gate volatiles (`sec.volatileStatus` — e.g. `flinch`, `confusion`)**: Scan forward in `now.wantHard` from `now.end` up to the next `|turn|`/`|upkeep|` for the target's action slot: if `|cant|<target>|<sec.volatileStatus>` (or `|-start|<target>|<sec.volatileStatus>` / `|-activate|<target>|<sec.volatileStatus>`) is present, steer `want = true` (`0`); if `<target>` acts normally (`|move|<target>|...`), steer `want = false` (`99`).
2. **Pre-Action `FractionalPriority`, Contact-Ability `DamagingHit`, & `BeforeMove` Steering**:
   - Wrap `battle.runEvent` / `battle.singleEvent` when `at.k === turn && !st.dry` for `eventid === 'FractionalPriority'`, `eventid === 'DamagingHit'`, and `eventid === 'BeforeMove'`:
     - Capture `battle.randomChance(n, d)` draws along with `battle.effect` (`id`, `name`, `effectType`) and the active target/holder.
     - Against `standing()`:
       - `FractionalPriority`: steer against `|-activate|<holder>|(ability|item): <effect.name>` in `now.wantHard[now.from..now.end]` (so `Quick Draw` is steered `false` and `Quick Claw` is steered `true` on `|-activate|p1a: Slowbro|item: Quick Claw`).
       - `DamagingHit` (`Poison Touch`, `Flame Body`, `Static`, `Effect Spore`): steer against `|-status|<target>|<status>|[from] ability: <effect.name>|[of] <source>` in `now.wantHard[now.from..now.end]`.
       - `BeforeMove` (`par`, `confusion`): steer against `|cant|<holder>|par` / `|-activate|<holder>|confusion` in `now.wantHard[now.from..now.end]`.
3. **Multi-Hit `expect(target)` Indexing (`reconstruct.mjs:887-899`)**:
   - In `expect(target)`: when `move.multihit && move.hit > 1`, skip the first `move.hit - 1` `|-damage|` lines matching `ident` in `now.wantHard[now.from..now.end]`, and compute `crit` strictly within the slice belonging to the current hit (`prevDamageIdx + 1 .. curDamageIdx`), preventing Hit `k + 1`'s `|-crit|` from mis-steering Hit `k` on moves like `Scale Shot` (`2703692052`) and `Beat Up` (`2701417024`).

### B. `resolveTurn` Paired-Chance & `brought` Fix (`scripts/lib/reconstruct.mjs:1973-2024`)
1. **Allow `b.chance` in `brought` (`reconstruct.mjs:2010`)**:
   Change line `2010` from:
   ```js
   if (!b || b.chance || b.hi - b.lo + 1 > 16 || before.get(b.i) === `${b.lo}-${b.hi}`) continue;
   ```
   to allow newly-exposed or ordinal-shifted `chance` draws (testing `[b.lo, b.hi]` via `candidates(b)`):
   ```js
   if (!b || (!b.chance && b.hi - b.lo + 1 > 16) || before.get(b.i) === `${b.lo}-${b.hi}`) continue;
   ```
   This enables `resolveTurn` to jointly flip `Quick Draw = false` + `Quick Claw = true` (`2705590171`), `Dire Claw = false` + shifted `Poison Touch`/`Flame Body = false` (`2695362313`, `2707006405`), and `flinch = false` + `par = true` (`|cant|`).
2. **Use `outranks` in `pairs` (`reconstruct.mjs:1984`)**:
   Replace `if (scoreOf(probe, t)[0] > score[0])` with `if (outranks(scoreOf(probe, t), score))` (matching single-draw progress semantics so paired secondary/accuracy fixes that advance `fields`—e.g. clearing `|-unboost|` to reach `|move|`—are committed rather than discarded).

### C. Restrict `infer.mjs:624-625` `order` Classification (`scripts/lib/inference/infer.mjs:622-625`)
Replace lines `624-625` in `infer.mjs`:
```js
const bothActionStarts = ACTION_START.has(kind(diff.actual)) && ACTION_START.has(kind(diff.expected));
const differentActors = who(diff.actual) && who(diff.expected) && who(diff.actual) !== who(diff.expected);
const order = bothActionStarts && differentActors;
```
- **What this fixes**:
  1. Secondary/sub-event lines (`|-status|`, `|-unboost|`, `|-activate|`, `|-crit|`) are **never** in `ACTION_START`, so `order` stays `false` when `diff.actual` is `|-status|p1b: Salamence|brn` and `diff.expected` is `|move|p2a: Archaludon|Dragon Pulse|...` (`2708317796`, `2711170128`, `2702312476`).
  2. Same-actor move prevention (`|move|p2b: Grimmsnarl|...` vs `|cant|p2b: Grimmsnarl|flinch` in `2692108848`, `2705651347`) has `differentActors === false`, so `order` stays `false`.
- **Soundness Guarantee**: No spread is ever eliminated by `steerDice`, `resolveTurn`, or `fallback`; every forced ordinal pin is a legal face of the simulator's own PRNG draw, and `evidencePass` (`evidence.mjs` / `speed.mjs`) remains the sole source of spread elimination.

---

## 4. Representative Battle Proofs

### Proof 1 — Unsteered Secondary Burn (`random(100)`) + `infer.mjs:624` Speed-Order Misclassification (Universal 3-View Failure)
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2708317796` (`S01-C05`, `gaveup-2708317796.md`, `trace_2708317796.log`)
- **Sweep / Trace**: `GAVE UP` across **all 3 views** (`p2@p1`, `p1@p2`, `both@spectator`), `1,648.2s` in sweep (`385.0s` trace on `fenchurch`, `42` rounds, `282` rebuilds, `221,025` probes, `stop = "searches"`, `0` removed, `0` broken proofs).
- **Exact Turn & Protocol Divergence (`Turn 3`, index `3.16`)**:
  - `3.11`: `|move|p2b: Charizard|Heat Wave|p1b: Salamence|[spread] p1a,p1b`
  - `3.12–3.15`: `|-resisted|p1b: Salamence`, `|-crit|p1b: Salamence`, `|-damage|p1a: Sneasler|...`, `|-damage|p1b: Salamence|47/100`
  - **`3.16` divergence**:
    - `wanted`: `|move|p2a: Archaludon|Dragon Pulse|p1a: Sneasler`
    - `got`: `|-status|p1b: Salamence|brn`
- **Mechanism Proof**: `Charizard-Mega-Y`'s `Heat Wave` invokes `battle.random(100)` in `secondaries()` (`battle-actions.js:1139`, `chance: false`), which `steerDice` ignores. When `infer.mjs:624` evaluated `who(diff.actual) !== who(diff.expected)` (`"p1b: Salamence" !== "p2a: Archaludon"`), it set `order = true`, sorted `spe` first (`line 634`), and immediately spent all `8/8` fallback rebuilds in Starts 1–2 binary-searching `Salamence spe` (`0 -> 16 -> 8 -> 12 -> 10 -> 11` in `default`, `0 -> 32 -> 16 -> 24 -> 20` in `usage`), while Starts 3–6 burned `240` rebuilds trapped between Turn 1 `1.5`, Turn 2 `2.6`, and Turn 3 `3.4`/`3.7`/`3.15` 66-SP caps.

### Proof 2 — `Dire Claw` `random(100)` + `sample(["psn","par","slp"])` (`sample(3)`) Status-Kind Stall
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2709342294` (`S05-C03`, `gaveup-2709342294.md`, `trace_2709342294.log`)
- **Sweep / Trace**: `GAVE UP` in `both@spectator` (`3,329.4s` sweep / `2,553.5s` trace, `264` rounds, `435` fallback steps, `1,127,774` probes, `stop = "searches"`, `0` removed).
- **Exact Turn & Protocol Divergence (`Turn 1`, index `1.7`)**:
  - `1.5`: `|move|p1b: Sneasler|Dire Claw|p2b: Charizard`
  - `1.6`: `|-damage|p2b: Charizard|38/100`
  - **`1.7` divergence** (hit in `203 / 264` rounds):
    - `wanted`: `|-status|p2b: Charizard|par`
    - `got`: `|-status|p2b: Charizard|slp`
- **Mechanism Proof**: `Dire Claw` (`data/moves.js:3698-3704`) gates status with `random(100) < 50` and then picks the status via `this.sample(["psn", "par", "slp"])` (`random(3)`). Neither draw is steered by `steerDice` against `|-status|p2b: Charizard|par`. Whenever Round `k` or Turn 2 `fallback` (`1.6` / `2.x` `Farigiraf` `39/100` + `Sitrus Berry` `63/100`) adjusted a Stat Point (`Sneasler hp 18`, `atk 20`, `Charizard atk 10`), the simulation collapsed back to Turn 1 `1.7` (`got slp`), cycling `264` rounds to `searches` exhaustion.

### Proof 3 — Pre-Action `FractionalPriority` (`Quick Draw` vs `Quick Claw`) + `brought` Skipping `b.chance`
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2705590171` (`S12-C03`, `gaveup-2705590171.md`, `trace_2705590171.log`)
- **Sweep / Trace**: `GAVE UP` in `both@spectator` (`6,596.2s` sweep / `1,175.6s` trace, `462` rounds, `883` rebuilds, `812,340` probes, `stop = "stalled"`, `0` removed).
- **Exact Turn & Protocol Divergence (`Turn 1`, index `1.0`)**:
  - `wanted`: `|-activate|p1a: Slowbro|item: Quick Claw`
  - `got`: `|-activate|p1a: Slowbro|ability: Quick Draw`
- **Mechanism Proof**: During `BattleQueue.resolveAction` (`battle-queue.js:152`), `runEvent('FractionalPriority')` checks `Quick Draw` (`onFractionalPriorityPriority: -1`, `randomChance(3, 10)`) before `Quick Claw` (`-2`, `randomChance(1, 5)`). `steerDice` does not hook `FractionalPriority`. Setting `Quick Draw = false` alone changes `got` to `|move|...`, dropping `scoreOf` from `[0, 3, 3]` to `[0, 1, 1]`, so the single-draw scan rejects it. Then `resolveTurn`'s `brought` loop (`reconstruct.mjs:2010`) explicitly skips `Quick Claw` because `b.chance === true` (`if (!b || b.chance || ...) continue;`), preventing `resolveTurn` from ever pairing `(Quick Draw = false, Quick Claw = true)` across all `462` rounds (further amplified by `disguisableStays()` Illusion branching on benched `Zoroark-Hisui`).

### Proof 4 — `|-crit|` Overkill (`0 fnt`) Following Mid-Turn `forceSwitch` (`Revival Blessing`) & Same-Actor `cant|flinch`
- **Battle A (`|-crit|` + `Revival Blessing`)**: `mimic:gen9championsvgc2026regmcbo3-2710266634` (`S14-C07`, `gaveup-2710266634.md`, `trace_2710266634.log`)
  - **Sweep / Trace**: `GAVE UP` across **all 3 views** (`p1@p2`, `p2@p1`, `both@spectator`), `1,229.6s` sweep (`267.2s` trace on `fractran`, `54` rounds, `294` rebuilds, `93,028` probes, `stop = "searches"`).
  - **Exact Divergence (`Turn 5`, index `5.9`)**: Following `5.3` (`Focus Sash` leaving `Pawmot` at `1/100`) and `5.5-5.7` (`Pawmot` `Revival Blessing` `forceSwitch` reviving `Archaludon`), `5.8` `|move|p1b: Basculegion|Last Respects|p2a: Pawmot` diverged at `5.9`:
    - `wanted`: `|-crit|p2a: Pawmot` (followed by `|-damage|p2a: Pawmot|0 fnt`)
    - `got`: `|-damage|p2a: Pawmot|0 fnt`
  - Because `1/100` `Pawmot` prints `0 fnt` whether `Last Respects` crits or not, `resolveTurn(5)` failed to commit the `1/24` crit roll (`stopped` in `2.2s–4.3s`) and `fallback` burned `240` rebuilds perturbing `Pawmot`, `Basculegion`, `Sneasler`, `Archaludon`, and `Pelipper` stats (the same `Revival Blessing` + `|-crit|` pattern occurs at `4.7` in `gaveup-2707119132.md`).
- **Battle B (Same-actor `move` vs `cant|flinch`)**: `mimic:gen9championsvgc2026regmcbo3-2692108848` (`S10-C03`, `gaveup-2692108848.md`, `trace_2692108848.log`)
  - **Sweep / Trace**: `GAVE UP` across **all 3 views** (`396.9s` sweep / `77.8s` trace, `36` rounds, `276` rebuilds, `34,199` probes, `stop = "searches"`).
  - **Exact Divergence (`Turn 2`, index `2.9`)**: `wanted |move|p2b: Grimmsnarl|Spirit Break|p1b: Sylveon`, `got |cant|p2b: Grimmsnarl|flinch` from `Aerodactyl`'s 30% `Rock Slide` flinch check (`2.2`). `resolveTurn(2)` exited `stuck` in `0.7s–1.2s` without clearing the flinch, and `infer.mjs:624-625` set `order = true` on same-actor `move` vs `cant`, wasting Starts 1–2's entire `8`-rebuild cap bisecting `Grimmsnarl spe`.

---

## 5. Merged Reports Manifest

All **31 / 31** diagnostic reports merged into bucket `F13`:

| # | Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|---|
| 1 | `gaveup-2692108848.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 77.8s) | Turn 2 `2.9` (`wanted \|move\|p2b: Grimmsnarl\|Spirit Break\|p1b: Sylveon`, `got \|cant\|p2b: Grimmsnarl\|flinch`): `resolveTurn(2)` exited `stuck` in 0.7s–1.2s without clearing 30% `Rock Slide` flinch; `infer.mjs:624-625` set `order = true` on same-actor `move` vs `cant`, wasting Starts 1–2 on `Grimmsnarl spe`. |
| 2 | `gaveup-2692275744.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 3/4 `Gardevoir` dual `confusion` + `par` deadlock (`wanted \|cant\|p2a: Gardevoir\|par`, `got \|-damage\|p2a: Gardevoir\|1/100 par\|[from] confusion`) and Turn 6 order desync from Turn 1–3 percentage quantization offsetting PRNG stream + `Zoroark-Hisui` Illusion branching. |
| 3 | `gaveup-2694419276.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` trace; `p2@p1` untraced) | In `p2@p1`, Turn 5 `5.9` `Dire Claw` rolled `par` instead of `slp` with P1 locked out of fallback, exhausting `fallbackRebuilds` and `searches` (`both@spectator` trace escaped 5.9 only via incidental `Sylveon`/`Farigiraf` `spe=0` tie). |
| 4 | `gaveup-2695357412.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 5 `Dire Claw` rolled extraneous `\|-status\|p1b: Milotic\|psn` (`wanted \|move\|p1a: Sneasler\|Throat Chop\|...`), tricking `fallback` into an impossible 3-way `spe` sweep (`Adamant P1 Sneasler` vs `Jolly P2 Sneasler` vs `Mega Salamence`). |
| 5 | `gaveup-2695362313.md` | `gaveup` | `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 659.5s / 3,297.1s sweep) | Turn 5/6 `6.4` (`wanted Volcarona Quiver Dance`, `got \|-status\|p1a: Volcarona\|psn`): `Sneasler` `Dire Claw` 3-way status RNG rolled `psn` instead of `par`/none while `Flame Body`/`Wood Hammer` recoil and Turn 0.23/4.12 order lines blocked 1D fallback. |
| 6 | `gaveup-2695460078.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 433.7s / 2,978.8s sweep) | Turn 6 `6.5` (`wanted \|move\|p1b: Gholdengo\|Shadow Ball`, `got \|cant\|p1b: Gholdengo\|flinch` from `Sneasler` 30% `Rock Slide` flinch) stalls `reconstruct` under `probes`/`backtracks`; fallback sweeps invert `Gholdengo` (84) vs `Rillaboom` (85) Speed or break T4–T5 HPs. |
| 7 | `gaveup-2696354296.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` trace; `p2@p1` failed 437.1s) | `both@spectator` Starts 1–2 stalled at Turn 1 `1.12` (`Rock Slide` 30% flinch on `Indeedee`) until Start 3 hit `Tyranitar spe 13 == Milotic 103` tie PRNG shift; `p2@p1` locks P1 so that Speed-tie workaround is impossible. |
| 8 | `gaveup-2696463919.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 803.7s / 4,497.3s sweep) | Turn 4 `4.9` (`wanted \|move\|p2a: Sinistcha\|Matcha Gotcha\|p1b: Arcanine\|[spread] p1b` + `\|-miss\|p2a: Sinistcha\|p1a: Indeedee`, `got [spread] p1a,p1b`) coupled with `4.4` `Revival Blessing` odd/even HP parity (`49/100` vs `50/100y`) exhausted `484` rebuilds across all 3 views. |
| 9 | `gaveup-2696695453.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 859.5s / 2,303.8s sweep) | Turn 2 `Dire Claw` stalled 31 rounds on `wanted \|-status\|p2a: Arcanine\|par`, `got slp`; Phase 6 fallback escaped only by dropping `Rotom spe` to `14` (breaking `Rotom 225 > Garchomp-Mega-Z 223`), which broke Turn 3 damage and 1% `Flare Blitz` recoil. |
| 10 | `gaveup-2698060361.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 13,259.6s sweep) | Turn 4 fainted `Charizard` ground-truth invisible choice (`move heatwave mega`) consumed 4 `randomFoe()` draws vs variant 0 `move hurricane +1 mega` (0 draws), shifting Turn 5 `Dire Claw` onto Draw 49 (`14 < 30`) and triggering unsteered `\|-status\|p2b: Pelipper\|psn` at Turn 5 line 8. |
| 11 | `gaveup-2698111417.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` trace; `p1@p2` failed 3,166.0s) | `both@spectator` Starts 1–3 stalled at Turn 3 `3.7` on phantom `Dire Claw`/`Poison Touch` `psn` on `Sylveon` until `Sylveon spe 4` shifted PRNG frame; `p1@p2` locks P2 with 4 hidden P1 Pokémon under Sitrus/Iron Ball TR/Brave Bird coupling. |
| 12 | `gaveup-2698433335.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 5 `5.7` (`wanted Milotic Recover`, `got \|-status\|p2b: Milotic\|brn` from `Charizard` `Heat Wave`): PRNG drift triggered 10% burn across all starts, and when `Search 4` reached Turn 6 (`Icy Wind 91/100 vs 89/100`), unpinned Turn 6 fallback collapsed back to `5.7`. |
| 13 | `gaveup-2699927531.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator`, 234.7s; `p1@p2` failed 2,342.1s) | Turn 6 `6.2` (`Sneasler` `Poison Touch` 30% `psn` proc on `Incineroar` whenever damage/speed shifts PRNG) + mirror `Mega Delphox` 204 speed tie + Sitrus/1% survival; `p1@p2` exhausted variants and searches with P2 fixed. |
| 14 | `gaveup-2699965360.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 4 `p1b: Eelektross` `Muddy Water` rolled unsteered 30% accuracy drop (`got \|-unboost\|p2b: Sneasler\|accuracy\|1`, `wanted \|upkeep`), while `fallback()` aborted early with `maxBacktracks: 0` at Turn 2 (`2.13` `Giga Drain` `61/100 vs 60/100`) and blacklisted Turn 4 in `spend.fruitless`. |
| 15 | `gaveup-2700796479.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 5 `5.6` (`wanted Hyper Voice`, `got \|-status\|p1b: Charizard\|psn` from `Sneasler` `Poison Touch`/`Dire Claw`): failed 197/266 times in Searches 1–3, and when `Search 4` reached Turn 8 (`Leech Life`/`Close Combat`), unpinned Turn 8 fallback collapsed back to `5.6`. |
| 16 | `gaveup-2700892015.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator`, 59.4s; `p1@p2` failed 477.6s) | Trace Start 1 stalled at Turn 2 `2.8` (`got \|-status\|p2b: Tyranitar\|brn` from `Heat Wave`), Start 2 hit Turn 1 speed-tie PRNG shift (`-1` draw hitting `Tyranitar` burn); `p1@p2` hit `probes`/`stuck` without backtracks under locked P2 exact HP. |
| 17 | `gaveup-2701417024.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 1 `Beat Up` Strike 4 rolled a critical hit in ground truth; when PRNG desynchronized, fallback tested 40+ SP mutations (all returning `plays out the same`) trying to produce a `1/24` crit roll (`Beat Up` Strike 1 governed by benched `Ninetales-Alola` Atk). |
| 18 | `gaveup-2702100920.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | 12-turn stall on Turn 12 double-crit `Muddy Water` razor (`Gholdengo 3/100 vs 5/100`) where fallback perturbations shifted PRNG and triggered unsteered 30% `Muddy Water` accuracy drops (`got \|-unboost\|p2a: Milotic\|accuracy\|1`) and hit `variants`. |
| 19 | `gaveup-2702312476.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator`, 843.4s; `p2@p1` failed 1,068.1s) | Turn 2 `2.10` (`wanted \|move\|p2a: Primarina\|Hyper Voice\|...`, `got \|-status\|p2a: Primarina\|par`): `Discharge` uses `random(100)` (`chance: false`), so `resolveTurn(2)` exited `stuck` in <1s; `both@spectator` escaped only via P1 Speed ties impossible when P1 is fixed in `p2@p1`. |
| 20 | `gaveup-2703692052.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 6 `6.14` (`wanted \|-crit\|p1b: Staraptor` on 2-hit `Scale Shot`, `got \|-hitcount\|p1b: Staraptor\|3`): early percentage drift shifted PRNG into 3-hit non-crit `Scale Shot` against +4 Def `Staraptor-Mega`, exhausting 128 fallback rebuilds. |
| 21 | `gaveup-2705100409.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 1 (normal) and Turn 2 (`Trick Room`) force exact tie `Sinistcha.spe === Sylveon.spe`, yet every Turn 1 Speed-tie configuration stalled `resolveTurn(1)` at `1.11` (`wanted Calm Mind`, `got \|-status\|p2b: Sylveon\|brn` from `Matcha Gotcha`) across all 3 views; `infer.mjs:624` didn't sort `spe` first in Start 2. |
| 22 | `gaveup-2705590171.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 1,175.6s / 6,596.2s sweep) | Turn 1 `1.0` (`wanted \|-activate\|p1a: Slowbro\|item: Quick Claw`, `got \|-activate\|p1a: Slowbro\|ability: Quick Draw`) due to unsteered `FractionalPriority` draws + `brought` (`reconstruct.mjs:2010`) skipping `b.chance` + Illusion branching on benched `Zoroark-Hisui`. |
| 23 | `gaveup-2705651347.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator`, 103.2s Start 5; `p1@p2` failed 390.1s) | Turn 1 `1.11` (`wanted Farigiraf Trick Room`, `got \|cant\|p2b: Farigiraf\|flinch` from `King's Rock`): `resolveTurn` exited `stuck` across all 9 target variants without clearing `King's Rock` `random(100)`; `p1@p2` failed because fixed `Tauros` Speed prevents the `Glimmora == Tauros` tie workaround. |
| 24 | `gaveup-2706404082.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 688.7s / 2,404.3s sweep) | Turn 4 `4.5` (`wanted Staraptor Close Combat`, `got \|cant\|p2b: Staraptor\|flinch` from `Garchomp` `Rock Slide`): shifted RNG ordinals from Turn 3 `Rough Skin` (`75/100 vs 74/100`) and `Leftovers` (`69/100`) triggered 30% flinch, exhausting 128 univariate fallback rebuilds. |
| 25 | `gaveup-2707006405.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 4 `4.4` dual RNG status conflict (`wanted Flame Body brn on Sneasler`, `got Dire Claw par on Volcarona`) failed 204/274 rounds; fallback swept single stats on `Volcarona`/`Sneasler`/`Delphox` across 8/32/128 rebuilds without fixing the PRNG frame. |
| 26 | `gaveup-2707119132.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 530.5s / 2,860.8s sweep) | Turn 4 `4.7` (`wanted \|-crit\|p2a: Scovillain`, `got \|-damage\|p2a: Scovillain\|57/100`, on same turn as `Pawmot` `Revival Blessing`) stalls `reconstruct` under `probes`/`backtracks`; fallback perturbations either stay at `4.7` or break Turn 1–3 HPs / `4.0` speed order. |
| 27 | `gaveup-2708317796.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`both@spectator`, 385.0s / 1,648.2s sweep) | Turn 3 `3.16` `Heat Wave` unsteered 10% burn check emitted `\|-status\|p1b: Salamence\|brn` before `wanted \|move\|p2a: Archaludon\|Dragon Pulse\|p1a: Sneasler`, and `infer.mjs:624` misclassified it as `order = true`, burning fallback on `Salamence` Speed binary search across all 3 views. |
| 28 | `gaveup-2709342294.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 2,553.5s / 3,329.4s sweep) | Turn 1 `1.7` `Sneasler` `Dire Claw` required both `38/100` on `Charizard-Mega-Y` and `1/6` status `par` (`203/264` rounds hit `got \|-status\|p2b: Charizard\|slp`); Turn 2 fallback fixing `Farigiraf` `39/100` + `Sitrus Berry` collapsed back to `1.7` `slp`. |
| 29 | `gaveup-2710266634.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 267.2s / 1,229.6s sweep) | All 3 views failed identically at Turn 5 `5.9` (`wanted \|-crit\|p2a: Pawmot`, `got \|-damage\|p2a: Pawmot\|0 fnt`) on `Last Respects` immediately following `Pawmot`'s mid-turn `Revival Blessing`; `resolveTurn(5)` never committed the `1/24` crit roll and fallback burned 240 rebuilds on stats. |
| 30 | `gaveup-2710894662.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | 284-round cyclic oscillation between Turn 3 `Dire Claw` 3-way status (`wanted par`, `got slp`) and Turn 4 `Last Respects` (`wanted 10/100 par`, `got 1/100 par` / `0 fnt`) as fallback tweaks break Turn 2/3 or shift PRNG back to `slp` (`infer.mjs:1183` secondary `seen: false` effect). |
| 31 | `gaveup-2711170128.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 3,455.6s sweep) | All 3 views stalled at Turn 6 `6.6` where `Blizzard` in Rain deterministically hit the 10% freeze roll on `Golisopod` (`wanted \|move\|p2a: Archaludon\|Electro Shot\|\|[still]`, `got \|-status\|p2b: Golisopod\|frz`); `infer.mjs:624` misclassified it as `order = true` and swept Speeds across 128 rebuilds even though `Froslass-Mega` always outspeeds. |
