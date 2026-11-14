# F08: `recoverChargeTargets()` Ignoring Same-Turn `|-anim|` Targets & `rewalk()` Inheriting Speculative Variant-0 Fallback Dice

## 1. Failure Overview & Status

- **ID**: `F08`
- **Category**: `2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:175-193` (`planSegment`: handles `kind === 'move'`, ignores same-turn `kind === '-anim'` target lines)
  - `scripts/lib/reconstruct.mjs:208-225` (`recoverChargeTargets`: only scans future turns `plans.slice(k + 1)`)
  - `scripts/lib/reconstruct.mjs:1921-1966` (`resolveTurn`: commits `fallback` / `inPlace` dice when stalled at `score[0]`)
  - `scripts/lib/reconstruct.mjs:2402-2408` (`reconstructOnce`: `consider()` saves `{ subs, subTurn }` of the furthest attempt as `partial`)
  - `scripts/lib/reconstruct.mjs:2454-2486` (`rewalk`: `hold()` copies **all** of `partial.subs` into every alternative choice variant `v`)
- **Total Merged Reports**: **1** (`gaveup-2706023099.md`)
- **View Breakdown**:
  - **All 3 views (`p1@p2`, `p2@p1`, `both@spectator`) failed in sweep**: 1 of 1 battle (`2706023099`).
- **Source Shard Cluster**: `S06-C02`.

---

## 2. Root-Cause Mechanism

This failure is a **two-stage compound defect** in `scripts/lib/reconstruct.mjs` that makes a turn un-reconstructible even when given **100% ground-truth Stat Points**:

### Stage 1: Single-Turn Charge Moves Emit Targets Only on Same-Turn `|-anim|` (`planSegment` / `recoverChargeTargets`, `reconstruct.mjs:175-225`)
When Showdown executes a two-turn charge move in a single turn (such as `Electro Shot` in Rain or any `Power Herb` two-turn move like `Meteor Beam`, `Solar Beam`, `Skull Bash`, `Geomancy`, `Sky Attack`), `useMoveInner` suppresses the target from the `|move|` line and logs the target only on the subsequent `|-anim|` line **in the same turn**:

```text
|move|p2b: Archaludon|Electro Shot||[still]
|-prepare|p2b: Archaludon|Electro Shot
|-boost|p2b: Archaludon|spa|1
|-anim|p2b: Archaludon|Electro Shot|p1b: Basculegion
```

In `scripts/lib/reconstruct.mjs`:
1. `planSegment()` (`reconstruct.mjs:175-193`) processes `kind === 'move'`, sees empty `parts[4]`, and records `action = { moveid: 'electroshot', target: null, needsTarget: true }`. It has **no handler** for `kind === '-anim'`.
2. `recoverChargeTargets(plans)` (`reconstruct.mjs:208-225`) only scans future turns (`for (const later of plans.slice(k + 1))`), assuming every `||[still]` move resolves on a later turn (`[from] lockedmove`).
3. Consequently, `action.target` stays `null`, `choiceFor()` passes `preferred = null` to `targetOptions(side, slot, 'normal', null)` -> `[' +1', ' +2', ' -1']`, and `variant = 0` defaults to `+1` (`p1a`) instead of the actual target `+2` (`p1b`).

### Stage 2: Variant 0 Commits Speculative/Divergence-Tainted Dice, Which `rewalk()` Inherits to Poison Alternative Variants (`reconstruct.mjs:2454-2486`)
Because Stage 1 put the wrong choice at `variant = 0`, `reconstructOnce` first searches `entering` (`variant = 0`) via `resolveTurn(t, ...)` (`reconstruct.mjs:2414`), saves it as `partial`, and later runs `rewalk()` (`reconstruct.mjs:2454-2486`) to test alternative choice variants `v = 0 .. width - 1` under `partial`'s settled dice (`hold()`):

```js
const held = { subs: { ...partial.subs }, subTurn: { ...partial.subTurn } };
const hold = () => {
  for (const k of Object.keys(subs)) delete subs[k];
  for (const k of Object.keys(subTurn)) delete subTurn[k];
  Object.assign(subs, held.subs);
  Object.assign(subTurn, held.subTurn);
};
for (let v = 0; v < width && !solved; v++) {
  if (v === partial.variant) continue;
  variants[t] = v;
  hold();
  const probe = await runTo(common, subs, t);
  if (probe.badTurn === null || probe.badTurn > t) { solved = true; break; }
  const score = scoreOf(probe, t);
  if (outranks(score, better ? better.score : partial.at.slice(1))) better = { v, score };
}
```

The fatal flaw in `rewalk()` is that `hold()` copies **every** die in `partial.subs`—including:
- Speculative `fallback` / `inPlace` dice committed while `partial.variant` was stalled (or dice thrown at/after `partial`'s stall/divergence index, or whose ordinal/effect shifts when a different variant is played), even when those dice do not advance `score[0]` past `partial.variant`'s failure point.
- When `rewalk()` tests the true choice variant (`v = 3`, `+2`), `held.subs` forces that poisoned die (e.g., `29=0`, triggering a 30% `Muddy Water` accuracy drop at index `10` that did not occur in reality).
- `v = 3` then diverges **earlier** (`index = 10 < partial.at[1] = 15`), fails `outranks(score, partial.at.slice(1))`, and is discarded by `rewalk()`. Meanwhile, `Variant 0`'s search in `resolveTurn` has already consumed `spent[t]` toward `maxProbes`, starving the clean `forget(t)` `ranked` loop (`reconstruct.mjs:2489-2501`).

Thus, **every candidate spread (including ground truth)** fails on Turn 4 across all three views (`p1@p2`, `p2@p1`, `both@spectator`).

---

## 3. Single Cohesive Fix Specification

Both parts of the defect must be fixed together in `scripts/lib/reconstruct.mjs` at the mechanism level while preserving **100% soundness**:

1. **Extract Same-Turn `|-anim|` Targets in `planSegment()` (`reconstruct.mjs:175-193`)**:
   - Add a `kind === '-anim'` handler in `planSegment()`:
     ```js
     if (kind === '-anim') {
       const side = identSide(parts[2]);
       const slot = startOf[side]?.[identSlot(parts[2])] ?? identSlot(parts[2]);
       const action = plan.actions[side]?.[slot];
       const target = parts[4] && parts[4].includes(': ') ? parts[4] : null;
       if (action && !action.target && action.needsTarget && action.moveid === toID(parts[3]) && target) {
         action.target = target;
         action.recovered = true;
       }
       continue;
     }
     ```
   - **Soundness check**: Setting `action.target` from same-turn `|-anim|` only supplies `preferred` to `targetOptions(side, i, moveTarget, preferred)` in `choiceFor()`. Every other legal target (`+1`, `+2`, `-1`/`-2`) remains in `options` as variants, so if a same-turn redirection (`Follow Me`, `Rage Powder`, `Lightning Rod`, `Storm Drain`) caused `|-anim|` to land elsewhere than the chosen target, the turn still walks all legal target variants! And because `action.landsOn` is not set to a later turn, `recoverChargeTargets()` skips it (`if (!action || action.target || !action.needsTarget) continue;`), while two-turn moves that genuinely charge across turns (`||[still]` with no same-turn `|-anim|`) continue to be handled identically by `recoverChargeTargets()`.

2. **Prevent `rewalk()` from Inheriting Poisoned / Speculative Fallback Dice (`reconstruct.mjs:1834-1966`, `2403-2408`, `2454-2486`)**:
   - **Track speculative commits in `resolveTurn()`**: Record whether each turn-`t` commit in `subs` was a strictly advancing commit (increased `score[0]`) vs. a speculative `fallback` commit (`best[0] === score[0]`, i.e., `inPlace` / `fields`-only commit at a stall) and record `partial.failLogAt = failAt(...)` (or `draw.at` when committed).
   - **Keep `rewalk()` clean**:
     - When `rewalk()` constructs `held.subs` from `partial`, **exclude** turn-`t` dice that were committed speculatively (`fallback` at `best[0] === score[0]`) or thrown at/after `partial`'s stall position (`draw.at >= partial.failLogAt`), carrying over only the clean prefix dice that advanced `partial` strictly before its stall/divergence.
     - Furthermore, if a variant `v` probed in `rewalk()` still fails at an earlier index than `partial.at[1]` (`probe.badTurn === t && score[0] < partial.at[1]`) while holding turn-`t` dice from `partial` (which happens whenever `v` changes an earlier move/target before `partial.at[1]`, shifting ordinals of turn-`t` dice), drop turn-`t` dice committed at/after `probe`'s divergence position (or fall back cleanly to `forget(t)` on `v`) rather than falsely discarding `v` as worse than `partial`.
   - **Soundness check**: This never removes any choice or die; it prevents a failed variant's speculative dice from masking an unsearched valid variant in `rewalk()`.

---

## 4. Representative Battle Proofs

### Proof 1 — `mimic:gen9championsvgc2026regmcbo3-2706023099` (`gaveup-2706023099.md`)
- **Views & Metrics**:
  - `p1@p2`: `GAVE UP` in `288.3s` (`stop = "searches"`, 6 rounds, 163 rebuilds, 12,410 probes, limits `["backtracks", "fallbackRebuilds", "searches"]`).
  - `p2@p1`: `GAVE UP` in `~300.0s` (`stop = "searches"`, 6 rounds, 170 rebuilds, 13,105 probes).
  - `both@spectator`: `GAVE UP` in `8,465.6s` (2.35 hours, `stop = "stalled"`, 148 rounds, 612 rebuilds, 398,740 probes, limits `["backtracks", "fallbackRebuilds", "guessTries", "probes", "searches", "stalled"]`).
- **Turn 4 Failure Trace (Even With Ground-Truth Planted Spreads)**:
  - Rain (`Drizzle` from P1 `Pelipper` on Turn 3) is active on Turn 4.
  - Move 1 (`p2a: Sneasler` -> `p1b: Basculegion`): `Dire Claw` deals 60 dmg (`135/195`, `69/100`; die `21=5`).
  - Move 2 (`p1b: Basculegion`): `Muddy Water` misses `p2a: Sneasler` (die `25=99`), crits `p2b: Archaludon` (die `27=0`, damage die `28=5` -> `100/188`, `53/100`), triggering `Stamina` (`|-ability|p2b: Archaludon|Stamina|boost`, `|-boost|...|def|1`), with **no** 30% accuracy drop (real die rolled `90 >= 30`).
  - Move 3 (`p2b: Archaludon`): Single-turn `Electro Shot` in Rain targets `+2` (`p1b: Basculegion`, dealing 195 dmg -> `0 fnt`), emitting:
    ```text
    |move|p2b: Archaludon|Electro Shot||[still]
    |-prepare|p2b: Archaludon|Electro Shot
    |-boost|p2b: Archaludon|spa|1
    |-anim|p2b: Archaludon|Electro Shot|p1b: Basculegion
    ```
  - **Stage 1 (`planSegment` / `recoverChargeTargets`)**: `planSegment()` leaves `action.target = null`; `recoverChargeTargets()` scans only `plans.slice(5)` and misses `|-anim|`. `targetOptions()` defaults Variant `0` to `+1` (`p1a: Archaludon`).
  - **Stage 2 (`rewalk` poisoning)**: Under Variant `0` (`+1`), `resolveTurn(4)` settles `21=5`, `25=99`, `27=0`, `28=5`, stalls at **index `15`** (`Electro Shot` hitting `p1a` instead of `p1b`), and commits speculative fallback die **`29=0`** (the 30% `Muddy Water` accuracy-drop roll). When `rewalk()` evaluates Variant `3` (`move 1 +2, move 1 +2`, ground truth), `hold()` inherits `29=0`, forcing `|-unboost|p2b: Archaludon|accuracy|1` at **index `10`**:
    ```text
    expected: '|-ability|p2b: Archaludon|Stamina|boost'
    actual:   '|-unboost|p2b: Archaludon|accuracy|1'
    ```
  - Because `10 < 15`, `rewalk()` rejects Variant `3`, stalling Turn 4 permanently across all views and spreads.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2706023099.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` | Turn 4 single-turn Rain `Electro Shot` prints target only on same-turn `|-anim\|`, which `planSegment()`/`recoverChargeTargets()` skips; Variant `0` (`+1`) stalls at index `15`, commits `Muddy Water` accuracy-drop die `29=0`, and `rewalk()` poisons Variant `3` (`+2`) so it fails early at index `10` even with ground-truth spreads. |
