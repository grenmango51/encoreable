# F10: Unsteered `getRandomTarget()` / `side.randomFoe()` Spread Primary Target Selection on `allAdjacentFoes` Moves

## 1. Failure Overview & Status

- **Bucket ID**: `F10`
- **Category**: `2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs` (interaction with `scripts/lib/protocol.mjs` and `scripts/lib/inference/infer.mjs`)
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:47` (`CHOOSABLE_TARGETS` — mirrors Showdown `sim/battle-actions.ts` by excluding `allAdjacentFoes`)
  - `scripts/lib/reconstruct.mjs:557-570` (`choiceFor()` — omits target suffix when `!CHOOSABLE_TARGETS.has(moveTarget)`)
  - `scripts/lib/reconstruct.mjs:828-1130` (`steerDice()` — hooks `hitStepAccuracy` at `1030-1050`, `getDamage` at `1052-1083`, and `battle.sample` only for `Array.isArray(move.multihit)` at `1089-1129`; never intercepts `battle.getRandomTarget()` / `side.randomFoe()`)
  - `scripts/lib/reconstruct.mjs:1881-1915, 1973-1994` (`resolveTurn()` — `fixes` only includes `steer.get(d.i)?.wrong`, and `pairs` filters `(d.chance || d.hi - d.lo + 1 > 16)`, excluding `random(2)` target draws)
  - `scripts/lib/protocol.mjs:49-61` (`battleLines()` — preserves exact primary-target ident on `|move|...|<target>|[spread]...` lines)
  - `scripts/lib/inference/infer.mjs:478-625` (`fallback()` — classifies `|move|actor|spreadMove|foeA` vs `foeB` as `order = false` and runs Stat-Point-only sweeps)
- **Total Merged Reports**: **11** reports
  - `both@spectator` only: **9** (`gaveup-2694578638.md`, `gaveup-2694755827.md`, `gaveup-2696050764.md`, `gaveup-2696394916.md`, `gaveup-2700413456.md`, `gaveup-2700578764.md`, `gaveup-2701496832.md`, `gaveup-2702446666.md`, `gaveup-2709218063.md`)
  - `p1@p2` + `both@spectator`: **1** (`gaveup-2692074098.md`)
  - `p2@p1` + `both@spectator`: **1** (`gaveup-2699616441.md`)

---

## 2. Root-Cause Mechanism

Under Pokémon Showdown's mechanics (`node_modules/pokemon-showdown/dist/sim/battle-actions.js:25`, `sim/side.js:430-441`), `allAdjacentFoes` spread moves (`Heat Wave`, `Hyper Voice`, `Muddy Water`, `Blizzard`, `Make It Rain`, etc.) **cannot** be given an explicit target in a player choice (`side.chooseMove` rejects any non-zero `targetLoc` when `!targetTypeChoices(targetType)` with `"Can't move: You can't choose a target for ..."`). Accordingly, `CHOOSABLE_TARGETS` in `scripts/lib/reconstruct.mjs:47` omits `allAdjacentFoes`, and `choiceFor()` (`reconstruct.mjs:559-568`) sends `move <slot>` with `targetLoc = 0`.

When Showdown executes an untargeted spread move while both opposing slots are occupied, it performs **two** PRNG `battle.sample(actives)` draws (`random(2)`):

1. **Queue-time resolution** (`sim/battle-queue.js:167-170`): `resolveAction()` sees `!action.targetLoc`, calls `battle.getRandomTarget(action.pokemon, action.move)` -> `pokemon.side.randomFoe()` (`sim/side.js:188-192`) -> `battle.sample(actives)`, and stores a provisional `action.targetLoc`.
2. **Execution-time resolution** (`sim/battle-actions.js:209` -> `sim/battle.js:2013-2046`): `runMove()` calls `battle.getTarget(pokemon, move, targetLoc, originalTarget)`. Because `validTargetLoc()` (`sim/battle.js:1994-2009`) has no `case` for `'allAdjacentFoes'`, it returns `false`, so `getTarget()` falls back to `this.getRandomTarget(pokemon, move)` -> `side.randomFoe()` -> `battle.sample(actives)` **a second time**, returning a fresh `target` (`foeA` or `foeB`).
3. **Cosmetic protocol emission** (`sim/battle-actions.js:386, 393`): `useMoveInner()` prints `|move|<actor>|<movename>|<target>|[spread] ...`, where `<target>` is whichever foe `getRandomTarget()` sampled at step 2. Mechanically, `pokemon.getMoveTargets(move, target)` still targets all adjacent foes identically regardless of whether `<target>` is `p2a` or `p2b`.

In `reconstruct.mjs` and `infer.mjs`, this causes systematic stalls through four compounding defects:

1. **Unsteered `getRandomTarget()` / `randomFoe()` inside `steerDice()` (`reconstruct.mjs:828-1130`)**: `steerDice()` intercepts `hitStepAccuracy`, `getDamage`, and `hitStepMoveHitLoop`'s `battle.sample`, **but never intercepts `battle.getRandomTarget` / `side.randomFoe`**. When candidate spreads alter earlier Speed ties, accuracy/damage rolls, or KO timings, the PRNG ordinal reaching `runMove()` shifts and `getRandomTarget()` picks the opposite foe (`wanted |move|...|foeA|[spread]...`, `got |move|...|foeB|[spread]...`).
2. **2-die barrier & `pairs` exclusion (`reconstruct.mjs:1881-1915, 1973-1994`)**: When the wrong primary target coincides with an accuracy miss on the spread move (e.g. `Make It Rain` 95% Champions accuracy in `2696394916`, where `got |move|...|p1a: Incineroar|[spread] p1a` vs `wanted |move|...|p1b: Sneasler|[spread] p1a,p1b`), flipping `getRandomTarget()` alone leaves `score[0]` stuck on the same line (moving only `fields`), so `resolveTurn()` defers it to `fallback`, while `pairs` (`reconstruct.mjs:1974`) filters `d => (d.chance || d.hi - d.lo + 1 > 16)` and **skips** the `random(2)` target draw (`span = 2`, `chance = false`).
3. **Probe exhaustion & `resample: 1` floor-freeze cycling (`infer.mjs:498-501, 973, 1105`)**: When `getRandomTarget()` occurs late in a turn after multi-target Rock Slide / Sucker Punch draws (e.g. `2700413456`, `2700578764`), `search 1..3` exhaust `maxProbes` / `maxBacktracks` before settling it. When `search 4` (`resample: 1`) escapes the target lock via `sampler(2)`, `infer.mjs:973` refuses to raise `floor` on `resample: 1`, so any subsequent spread update resets `level = floor` (`resample: 0`) and crashes right back onto the unsteered `getRandomTarget()` line in an infinite limit cycle (or `fallback()` aborts before the turn at `reach(base)[0] < t`, as in `2692074098` and `2700413456`).
4. **Futile Stat-Point `fallback()` & brittle Speed-tie workarounds (`infer.mjs:478-914`)**: `fallback()` classifies `|move|actor|spreadMove|foeA|[spread]` vs `foeB|[spread]` as `order = false` (`infer.mjs:624`) and burns `8` / `32` / `128` Stat-Point rebuilds trying to fix a `random(2)` target draw with Stat Points—either breaking earlier damage lines (`2694578638`, `2701496832`) or stumbling into transient Speed ties (`Primarina spe 21` / `26` in `2709218063`, `Kingambit spe 24` in `2699616441`) that pin brittle Speeds into `held` and collapse on the next round.

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules 1 and 2, **do not** add `allAdjacentFoes` to `CHOOSABLE_TARGETS` (Showdown's simulator rejects explicit target suffixes on `allAdjacentFoes` moves) and **do not** introduce move-specific rules. Instead, add **one mechanism-level hook inside `steerDice()` (`scripts/lib/reconstruct.mjs:828-1130`)** that steers `battle.getRandomTarget()` directly from the observed `wantHard` line while preserving exact PRNG draw consumption:

1. **Hook `battle.getRandomTarget` inside `steerDice()` (`scripts/lib/reconstruct.mjs`)**:
   - Wrap `battle.getRandomTarget(pokemon, move)` when `at.k === turn && !st.dry`.
   - Check `const now = standing();` (`reconstruct.mjs:866-881`). At execution time (`runMove()` -> `getTarget()` -> `getRandomTarget()`), `battle.log` has not yet emitted `|move|${pokemon}|${move.name}|...`, so `now` is non-null and `now.wantHard[now.from]` is the upcoming `|move|` line (in contrast to `BattleQueue.resolveAction()` at turn start, where `now.from` is at the top of the turn—or explicitly verify `wantParts[1] === 'move' && wantParts[2] === String(pokemon) && toID(wantParts[3]) === move.id`).
   - While calling `origGetRandomTarget.call(this, pokemon, move)`:
     - Capture the `battle.sample(items)` call (`drawOrd = st.draws` and `items` array, similar to the existing `counting` hook at `reconstruct.mjs:1090-1094`) **only** when `items` is an array of active targets (`items.length > 1`).
     - Parse `wantTarget = wantParts[4]` from `now.wantHard[now.from]`.
     - Find `wantIdx = items.findIndex(p => String(p) === wantTarget)`.
     - If `wantIdx >= 0`, read `currentIdx = faceOf(drawOrd)` and record:
       ```js
       out.set(drawOrd, { reps: [wantIdx], groups: new Map(), wrong: currentIdx !== wantIdx });
       ```
     - If `wantIdx < 0` (e.g. a target left the field or `[notarget]` occurred), emit no steer entry so the full draw remains searchable and soundness is strictly preserved.
2. **Simultaneous steering via `fixes` (`reconstruct.mjs:1881-1915`)**:
   - Because `steerDice` now marks an unaligned `getRandomTarget()` draw as `wrong: true` with `reps: [wantIdx]`, `resolveTurn()` places it in `fixes` (alongside any `wrong: true` `hitStepAccuracy` draw on the same spread move, solving `2696394916`'s 2-die barrier in **1 `trial` probe**) and at the head of `order` (solving single-draw primary target mismatches in **1 probe**).
   - Because `getRandomTarget()` runs *before* `hitStepAccuracy` and always consumes 1 `random(actives.length)` draw regardless of which face is picked, steering `getRandomTarget()` never shifts downstream PRNG ordinals (and respects the F12 rule on count-changing accuracy misses).
3. **Optional `pairs` safety net (`reconstruct.mjs:1974`)**:
   - Even outside `steerDice()`, `pairs` filters `d => (d.chance || d.hi - d.lo + 1 > 16)`, which artificially excluded small-radix `sample()` draws (`span <= 16`). With `steerDice()` handling `getRandomTarget()`, `fixes` resolves spread target + accuracy pairs deterministically without inflating `pairs`.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2709218063` (Pure `getRandomTarget()` Cosmetic Slot Lock & Brittle Speed-Tie Workaround)
- **Failure Scope**: `both@spectator` `GAVE UP` (`stop = "searches"`, 85,424 probes across 6 starts).
- **Turn 3 Line `3.9` (`Hyper Voice`, `target: "allAdjacentFoes"`)**:
  - Prior Turn 3 exchanges: `p1b: Arcanine-Hisui` used `Flare Blitz` on `p2b: Sinistcha` (`7/100`), `p2a: Tyranitar` used `Rock Slide` (`71/100` on `Primarina`, `20/100y` on `Arcanine`). Both `p2a: Tyranitar` and `p2b: Sinistcha` remained alive.
  - Observed (`wanted`): `|move|p1a: Primarina|Hyper Voice|p2a: Tyranitar|[spread] p2a,p2b`
  - Rebuilt (`got`): `|move|p1a: Primarina|Hyper Voice|p2b: Sinistcha|[spread] p2a,p2b`
- **Trace Proof**:
  - `resolveTurn` exited `stuck` in `1.3–1.4s` up to `maxProbes = 16000` without steering `getRandomTarget()` (`battle.sample([Tyranitar, Sinistcha])`).
  - In Start 6 Round 4, `fallback()` hit `Primarina spe 21` (`Spe = 101`, tying `Tyranitar 32/0/2/0/0/11` `Spe = 101`), injecting 1 `speedSort` draw that accidentally shifted `getRandomTarget()` onto `p2a: Tyranitar` and solved Turn 3 in `0.4s`!
  - As soon as Turn 4–5 evidence moved `Tyranitar` to `spe 17` (`Spe = 107`), the Speed tie broke and Round 10 regressed to `3.9`, then Round 10 found `Primarina spe 26` (`Spe = 106` tying `Gholdengo`), which broke again in Round 12 and permanently locked out `fallback()` (`searched.get(mark) >= 2`).

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2696394916` (2-Die Barrier: Unsteered `randomFoe()` + 95% Spread Accuracy)
- **Failure Scope**: `both@spectator` `GAVE UP` (`9,539.7s` sweep, `stop = "stalled"`, 146 rounds, 574 rebuilds, 1,326,712 probes).
- **Turn 4 Line `4.11` (`Make It Rain`, 95% accuracy in Champions)**:
  - Observed (`wanted`): `|move|p2a: Gholdengo|Make It Rain|p1b: Sneasler|[spread] p1a,p1b`
  - Rebuilt (`got`): `|move|p2a: Gholdengo|Make It Rain|p1a: Incineroar|[spread] p1a`
- **Trace Proof**:
  - Draw 59 (`getRandomTarget()` -> `randomFoe()` -> `battle.sample([Incineroar, Sneasler])`) rolled `0` (`Incineroar`), while Draw 61 (`hitStepAccuracy` on `Sneasler`, `randomChance(95, 100)`) rolled `97` (`|-miss|p2a: Gholdengo|p1b: Sneasler`).
  - Flipping Draw 59 alone still failed line `4.11` (`[spread] p1a` vs `[spread] p1a,p1b`), deferring Draw 59 to `fallback`; Draw 59 (`span = 2`, `chance = false`) was excluded from `pairs` (`reconstruct.mjs:1974`), and `steerDice()` did not flag Draw 59 as `wrong: true`, preventing `fixes` from pairing Draw 59 (`1`) with Draw 61 (`0`).

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2699616441` (Cross-View `p2@p1` & `both@spectator` Failure on `Blizzard`)
- **Failure Scope**: `p2@p1` (`2,952.5s`, `682` rebuilds, `341,200` probes) and `both@spectator` (`2,952.5s` sweep / `590.7s` trace, `103` rounds, `701` rebuilds, `217,170` probes) both `GAVE UP` with `stop = "searches"`.
- **Turn 2 (`Blizzard`, `target: "allAdjacentFoes"`)**:
  - Observed (`wanted`): `|move|p2a: Froslass|Blizzard|p1a: Indeedee|[spread] p1a,p1b`
  - Rebuilt (`got`): `|move|p2a: Froslass|Blizzard|p1b: Sneasler|[spread] p1a,p1b`
  - Because `p1` (`Indeedee`, `Sneasler`) was unknown in both `p2@p1` and `both@spectator`, Turn 2 `Blizzard` stalled repeatedly on the unsteered `getRandomTarget()` draw, cutting off Turns 5–12 and leaving `p2:3 Sneasler` at 100% unconstrained (`136,663,185` spreads).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2692074098.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` | `resolveTurn` exited `stuck` (~1.5s, even at `maxProbes=16000`) without flipping `battle.sample(...)` on Turn 1 `1.13` (`Dire Claw` `sample(['psn','par','slp'])` stuck on `slp` under `resample: 0`) and Turn 2 `Heat Wave` (`getRandomTarget` `sample(actives)` stuck on `Indeedee` instead of `Sneasler`). |
| `gaveup-2694578638.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 1 line `1.11` (`wanted \|move\|p1a: Delphox\|Heat Wave\|p2b: Farigiraf\|[spread] p2a,p2b`, `got p2a: Aerodactyl`): `resolveTurn` failed to flip `getRandomTarget`'s `sample(actives)`, coupling Turn 1 PRNG alignment to Turn 2 `Delphox` (`18/100` vs `15/100`). |
| `gaveup-2694755827.md` | `gaveup` | `both@spectator` | `GAVE UP` | In 215/307 rounds on Turn 3, `reconstruct` emitted `p2a: Blaziken` instead of `p2b: Sylveon` as the primary target of spread `Muddy Water` (`\|move\|p1b: Milotic\|Muddy Water\|p2b: Sylveon\|[spread] p2a,p2b`), and `fallback` burned 361 Stat-Point rebuilds. |
| `gaveup-2696050764.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 2 `Primarina` `Hyper Voice` (`allAdjacentFoes`) stalled all 270 rounds at line `2.8` due to nominal target mismatch (`p1b: Farigiraf\|[spread] p1a` vs `p1a: Golisopod\|[spread] p1a`) where `Farigiraf` used `Protect`. |
| `gaveup-2696394916.md` | `gaveup` | `both@spectator` | `GAVE UP` (`9,539.7s` sweep, `stop=stalled`, `146` rounds, `574` rebuilds, `1,326,712` probes) | Turn 4 line `4.11` `Make It Rain` hit a 2-die barrier (unsteered Draw 59 `randomFoe` `sample()` target selection + Draw 61 95% Champions accuracy miss on `Sneasler`), trapping Search Level 1 in resets. |
| `gaveup-2699616441.md` | `gaveup` | `p2@p1`, `both@spectator` | `GAVE UP` (`590.7s` trace, `stop=searches`, `103` rounds, `701` rebuilds, `217,170` probes) | Turn 2 `Froslass` `Blizzard` (`allAdjacentFoes`) skipped explicit target and called `getRandomTarget()`, picking `p1b: Sneasler` instead of `p1a: Indeedee` and cascading across Turns 2–8. |
| `gaveup-2700413456.md` | `gaveup` | `both@spectator` | `GAVE UP` (`876.9s` trace / `1,701.3s` sweep, `stop=stalled`, `276` rounds, `374,866` probes) | 182 of 276 rounds stalled at Turn 4 `Heat Wave` (`p1b: Sneasler` vs `p1a: Kingambit`) because `steerDice()` does not steer `side.randomFoe()`; `search 4` (`resample: 1`) escaped Turn 4, then `infer.mjs:973` froze `floor`, causing a 4-round limit cycle. |
| `gaveup-2700578764.md` | `gaveup` | `both@spectator` | `GAVE UP` | On Turn 4 (`4.8`), untargeted `Heat Wave` called `Side.randomFoe()` (die #40), rolling `0` (`p2a: Kommo-o`) instead of `1` (`p2b: Absol`) because `steerDice` does not intercept `randomFoe()`/`getTarget()`, stalling `fallback` across 8 rebuilds. |
| `gaveup-2701496832.md` | `gaveup` | `both@spectator` | `GAVE UP` | On Turn 3 (`3.11`), `p1b: Basculegion`'s `Muddy Water` inverted its spread primary target (`wanted \|move\|p1b: Basculegion\|Muddy Water\|p2b: Froslass\|[spread] p2a`, `got p2a: Sneasler\|[spread]`), accounting for >85% of all round diffs across 5 restarts. |
| `gaveup-2702446666.md` | `gaveup` | `both@spectator` | `GAVE UP` | On Turn 4 (`4.9`), `p2a: Charizard`'s `Heat Wave` inverted its primary target (`wanted \|move\|p2a: Charizard\|Heat Wave\|p1b: Primarina\|[spread] p1a`, `got p1a: Pawmot\|[spread] p1a`) after Turn 3's double KO replacement, defeating all 128 1D `fallback` perturbations. |
| `gaveup-2709218063.md` | `gaveup` | `both@spectator` | `GAVE UP` (`stop=searches`, `85,424` probes) | Turn 3 line `3.9` (`wanted Hyper Voice\|p2a: Tyranitar\|[spread] p2a,p2b`, `got p2b: Sinistcha`): `resolveTurn` failed to flip `getRandomTarget()`'s cosmetic `random(2)` display target, and Start 6's accidental `Primarina` Speed-tie workaround in `held` broke on later rounds. |
