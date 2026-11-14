# F07: `planSegment()` Skipping Encored Two-Turn Charging Moves & `[from] lockedmove` Releases, Breaking `recoverChargeTargets()` / `carriedInto()`

## 1. Failure Overview & Status

- **ID**: `F07`
- **Category**: `2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:120-122` (`planSegment`: `encored` set initialized per segment)
  - `scripts/lib/reconstruct.mjs:170-193` (`planSegment`: `if (encored.has(parts[2])) continue;` checked unconditionally before `from === 'lockedmove'` and `||[still]` charge-target tracking)
  - `scripts/lib/reconstruct.mjs:208-225` (`recoverChargeTargets`: scans `plans.slice(k + 1)` for `later.actions[side][slot]` when `!action.target && action.needsTarget`)
  - `scripts/lib/reconstruct.mjs:228-234` (`carriedInto`: returns earlier turns `k < t` whose `action.landsOn === t`)
  - `scripts/lib/reconstruct.mjs:525-544` (`choiceFor`: `!action` invisible-choice fallback defaulting `variant 0` to `options[0]`, i.e., foe slot `+1`)
  - `scripts/lib/reconstruct.mjs:2523-2549` (`reconstructOnce`: walks `variants[k]` for `k` in `carriedInto(plans, t)` when turn `t` stalls on a carried choice)
- **Total Merged Reports**: **8** (`gaveup-2696901663.md`, `gaveup-2698488261.md`, `gaveup-2705233123.md`, `gaveup-2705862443.md`, `gaveup-2706164806.md`, `gaveup-2708278379.md`, `gaveup-2710347095.md`, `gaveup-2710746778.md`)
- **View Breakdown**:
  - **All 3 views (`p1@p2`, `p2@p1`, `both@spectator`) failed in sweep**: 7 of 8 battles (`2698488261`, `2705233123`, `2705862443`, `2706164806`, `2708278379`, `2710347095`, `2710746778`).
  - **`both@spectator` failed in sweep (`p1@p2` and `p2@p1` passed)**: 1 of 8 battles (`2696901663`).
- **Source Shard Clusters**: `S01-C03`, `S03-C03`, `S07-C01`, `S08-C01`, `S09-C01`, `S10-C01`, `S13-C02`, `S15-C06`.

---

## 2. Root-Cause Mechanism

In Pokémon Showdown, a two-turn charging move with a choosable target (e.g., `Electro Shot` outside Rain, `Solar Beam` outside Sun, `Meteor Beam`, `Skull Bash`) requires a target selection on **turn `k`** when the move begins charging, even though Showdown omits the target from the charge-turn protocol line:

```text
|move|p1a: Archaludon|Electro Shot||[still]
|-prepare|p1a: Archaludon|Electro Shot
```

The chosen (or redirected) target only appears on **turn `k + 1`** when the locked move releases:

```text
|move|p1a: Archaludon|Electro Shot|p2b: Whimsicott|[from] lockedmove
```

To reconstruct turn `k`'s target choice, `scripts/lib/reconstruct.mjs` relies on three coupled steps:
1. `planSegment()` records `plans[k].actions[side][slot]` (with `target: null, needsTarget: true`) on turn `k`, and `plans[k + 1].actions[side][slot]` (with `target: 'p2b: Whimsicott'`) on turn `k + 1` because `from === 'lockedmove'` is explicitly exempted at line 183 (`if (from && from !== 'lockedmove') continue;`).
2. `recoverChargeTargets(plans)` (`reconstruct.mjs:208-225`) pairs turn `k`'s targetless `action` with turn `k + 1`'s `match`, copying `action.target = match.target` and recording `action.landsOn = k + 1`.
3. On turn `k`, `choiceFor()` puts `preferred` (from `action.target`) first in `targetOptions()`. If a redirection (Follow Me, Lightning Rod, Ally faint) moved where the hit landed, `reconstructOnce` (`reconstruct.mjs:2523-2549`) calls `carriedInto(plans, k + 1)` (`reconstruct.mjs:228-234`) to find `k` via `a.landsOn === k + 1` and walk `variants[k]` until turn `k + 1` matches.

**The Defect (`reconstruct.mjs:170-178`)**:
```js
if (kind === '-start' && /Encore$/.test(parts[3] || '')) {
  encored.add(parts[2]);
  continue;
}

if (kind === 'move') {
  if (toID(parts[3]) === 'revivalblessing') reviver = { slot: identSlot(parts[2]) };
  if (encored.has(parts[2])) continue;
  const from = tagsOf(line).from;
  if (from && from !== 'lockedmove') continue;
  ...
```

When a faster Pokémon (typically Prankster `Whimsicott`) lands `Encore` on the two-turn attacker **earlier in the same turn**, `encored.add(parts[2])` runs and `if (encored.has(parts[2])) continue;` discards the `|move|` line unconditionally—before inspecting `from === 'lockedmove'` or `||[still]` charge semantics. This single flaw breaks reconstruction via two symmetric paths:

1. **Path A — Encore lands on release turn `k + 1` before `[from] lockedmove`** (`2696901663`, `2698488261`, `2705862443`, `2706164806`):
   - Turn `k` creates `plans[k].actions[side][slot] = { moveid, target: null, needsTarget: true }`.
   - On turn `k + 1`, `Encore` (`|-start|...|Encore`) adds the attacker to `encored`. Its release line `|move|...|Electro Shot|<target>|[from] lockedmove` is then skipped by line 177 (`encored.has(parts[2])`), leaving `plans[k + 1].actions[side][slot]` **`undefined`**.
   - Note that in Showdown (`sim/pokemon.ts:1084`, `sim/side.ts:675-689`), a Pokémon in `twoturnmove` receives a single-move request for the locked move and executes `[from] lockedmove` using the target stored on turn `k`; `Encore` does not replace the already-queued `[from] lockedmove` release.
   - `recoverChargeTargets(plans)` finds no `match` in `plans.slice(k + 1)`, so turn `k`'s `action.target` remains `null` and `action.landsOn` remains **`undefined`**.
   - On turn `k`, `choiceFor()` calls `targetOptions(..., preferred = null)` -> `[' +1', ' +2', ' -2']`, picking `+1` at `variant = 0`. Because turn `k` only prints `||[still]`, turn `k` matches 100% under the wrong target `+1`.
   - On turn `k + 1`, `[from] lockedmove` fires at `+1` instead of `+2` (or vice versa). Because `action.landsOn` was never set, `carriedInto(plans, k + 1)` returns **`[]`**, so `reconstructOnce` never walks `variants[k]`, `redrawTurn(k)` finds no die that changes a move's target, and `reconstruct()` halts with `stop = 'stuck'`.

2. **Path B — Encore lands on charge turn `k` before `||[still]`** (`2705233123`, `2708278379`, `2710347095`, `2710746778`):
   - On turn `k`, `Encore` (`|-start|...|Encore`) adds the attacker to `encored` before it charges `|move|...|Electro Shot||[still]`.
   - Line 177 skips the charge line, leaving `plans[k].actions[side][slot]` **`undefined`**.
   - `recoverChargeTargets(plans)` skips empty slots (`if (!action || ...)` at line 212), so `action.landsOn = k + 1` is never recorded even though `plans[k + 1]` has `[from] lockedmove`.
   - On turn `k`, `choiceFor()` sees `!action`, sets `state.invisible = true`, and tries `variant = 0` (`move 1 +1`). Turn `k` prints `||[still]` and passes identically regardless of target (and in Showdown, when the player's submitted move equals the Encored move, `Encore`'s `onOverrideAction` preserves the submitted `targetLoc` into `twoturnmove`).
   - On turn `k + 1`, the locked move fires at the wrong target (`+1` vs `+2`), `carriedInto(plans, k + 1)` returns **`[]`**, and `reconstruct()` halts with `stop = 'stuck'`.

3. **Downstream Inference Waste**:
   Because `reconstruct()` stops on a `|move|` target mismatch without breaking Stat-Point bounds, `infer.mjs:fallback` repeatedly burns its full rebuild quota (`8 / 32 / 128` rebuilds per start, `200–240` rebuilds total across all 6 restarts) perturbing Stat Points that cannot alter turn `k`'s hardcoded `variant = 0` target, exhausting `fallbackRebuilds` and `searches`.

---

## 3. Single Cohesive Fix Specification

Keep the simulator as the sole source of mechanics and preserve **100% soundness** (do not narrow legal choices for an Encored Pokémon on turn `k`, because the player might originally have chosen a different move before `Encore` overrode it via `onOverrideAction` + `getRandomTarget`).

In `scripts/lib/reconstruct.mjs`:

1. **Parse `from` before `encored` in `planSegment()` (`reconstruct.mjs:175-193`)**:
   - Read `const from = tagsOf(line).from;` and reject non-`lockedmove` `[from]` actions (`if (from && from !== 'lockedmove') continue;`) **before** checking `encored.has(parts[2])`.
   - **Never skip `[from] lockedmove`**: A `[from] lockedmove` execution answers the simulator's single-move `lockedmove` request and reveals the actual execution target in `parts[4]`, even if the user was Encored earlier in the same turn. Record `plan.actions[side][slot]` normally when `from === 'lockedmove'`.
   - **Retain Encored action metadata without collapsing invisible choices**: When `encored.has(parts[2]) && from !== 'lockedmove'`, still record `plan.actions[side][slot]` with `encored: true` (including `moveid`, `target`, and `needsTarget: CHOOSABLE_TARGETS.has(dex.moves.get(moveid).target)`).
     - Note: `recoverChargeTargets(plans)` (`reconstruct.mjs:208-225`) now automatically sees both the charge-turn `action` (even when `encored: true`) and the release-turn `match` (`[from] lockedmove`, even when Encored on the release turn), populating `action.target`, `action.recovered = true`, and `action.landsOn = plans.indexOf(later)`.

2. **Preserve full choice soundness in `choiceFor()` (`reconstruct.mjs:525-544`)**:
   - Update the invisible-choice branch condition from `if (!action)` to `if (!action || action.encored)`:
     - Because the player may have chosen *any* non-disabled move before `Encore` forced the Encored move, `choiceFor()` still marks `state.invisible = true` and still enumerates **every** usable move and **every** `targetOptions` suffix—removing zero possibilities.
     - When `action?.moveid` and recovered `action?.target` are present (`m.id === action.moveid`), pass `preferred = targetLoc(sideId, i, action.target)` to `targetOptions(side, i, m.target, preferred)` (and optionally sort `m.id === action.moveid` first before `selfSwitchLast`) so `variant = 0` tries the recovered target first while keeping every other move and target in `options` for `carriedInto(plans, k + 1)` if redirection or `onOverrideAction` occurred.

3. **Resulting Behavior**:
   - For Path A (Encore on release turn `k + 1`): `[from] lockedmove` is retained, `recoverChargeTargets()` sets `action.target` and `action.landsOn = k + 1` on turn `k`, so turn `k` hits the right target at `variant = 0` (and `carriedInto` can walk `variants[k]` if redirected).
   - For Path B (Encore on charge turn `k`): `action` is retained with `encored: true` and `needsTarget: true`, `recoverChargeTargets()` sets `action.target` and `action.landsOn = k + 1`, `choiceFor()` puts the recovered move/target at `variant = 0` (or `carriedInto(plans, k + 1)` walks `variants[k]` across all legal moves/targets if Encore overrode another move).

---

## 4. Representative Battle Proofs

### Proof 1 — Path A (Encore on Release Turn `k + 1` Before `[from] lockedmove`): `mimic:gen9championsvgc2026regmcbo3-2696901663`
- **Battle & View**: `both@spectator` (`GAVE UP`, `stop = "searches"`, 46 rounds, 286 rebuilds [240 fallback], 246,785 probes, 3,422.0s sweep / 755.3s cluster trace on `emo`, 0% exact stats, median $10^{8.06} \approx 114.8\text{M}$ spreads remaining).
- **Turn 6 (Charge Turn)**:
  - `p1a: Archaludon` begins charging `Electro Shot` aimed at `p2b: Whimsicott`:
    - `|move|p1a: Archaludon|Electro Shot||[still]`
    - `|-prepare|p1a: Archaludon|Electro Shot`
    - `|-boost|p1a: Archaludon|spa|1`
- **Turn 7 (Release Turn)**:
  - `p2b: Whimsicott` moves first with Prankster `Encore`:
    - `|move|p2b: Whimsicott|Encore|p1a: Archaludon`
    - `|-start|p1a: Archaludon|Encore` -> adds `'p1a: Archaludon'` to `encored`.
  - Later at line `7.9`, `p1a: Archaludon` releases Turn 6's charged move:
    - **Expected**: `|move|p1a: Archaludon|Electro Shot|p2b: Whimsicott|[from] lockedmove`
    - **Observed failure**: Because `'p1a: Archaludon'` is in `encored`, `planSegment()` skips `7.9`, `recoverChargeTargets()` leaves Turn 6's `action.target = null` and `landsOn = undefined`, Turn 6 `variant = 0` defaults to `+1` (`p2a: Basculegion`), and Turn 7 emits `|move|p1a: Archaludon|Electro Shot|p2a: Basculegion|[from] lockedmove`.

### Proof 2 — Path B (Encore on Charge Turn `k` Before `||[still]`): `mimic:gen9championsvgc2026regmcbo3-2705233123`
- **Battle & Views**: All 3 views (`p1@p2`, `p2@p1`, `both@spectator`) gave up (`stop = "searches"`, 1,414.6s sweep / 203.4s trace on `versenwald`, 48 rounds, 288 rebuilds [240 fallback], 140,542 probes, 0% exact stats, median $10^{8.11} \approx 128.8\text{M}$ spreads remaining).
- **Turn 2 (Charge Turn)**:
  - `p1a: Whimsicott` (`Prankster`) uses `Encore` on `p2b: Archaludon`:
    - `|-start|p2b: Archaludon|Encore` -> adds `'p2b: Archaludon'` to `encored`.
  - Later on Turn 2, `p2b: Archaludon` (in `SunnyDay` from `Charizard-Mega-Y`) charges `Electro Shot` aiming `+2` (`p1b: Charizard`):
    - `|move|p2b: Archaludon|Electro Shot||[still]`
  - `planSegment()` skips the line at `reconstruct.mjs:177`, leaving `plans[2].actions.p2[1]` **`undefined`**. `choiceFor()` substitutes `variant = 0` (`move 1 +1`, targeting `p1a: Whimsicott`), which reproduces Turn 2 cleanly because `||[still]` hides the target.
- **Turn 3 (Release Turn, line `3.11`)**:
  - `p2b: Archaludon` fires its locked move (`3.11`):
    - **Expected**: `|move|p2b: Archaludon|Electro Shot|p1b: Charizard|[from] lockedmove`
    - **Produced**: `|move|p2b: Archaludon|Electro Shot|p1a: Whimsicott|[from] lockedmove`
  - Because `plans[2].actions.p2[1]` was `undefined`, `recoverChargeTargets()` never set `landsOn = 3`, `carriedInto(plans, 3)` returned `[]`, and all 6 starts exhausted 240 fallback rebuilds at `3.11`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2696901663.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 7 line `7.9` (`wanted Electro Shot\|p2b: Whimsicott\|[from] lockedmove`, `got ...\|p2a: Basculegion`): Turn 7 Prankster Encore added `Archaludon` to `encored` before `[from] lockedmove`, skipping `7.9` and defaulting Turn 6 charge target to `+1`. |
| `gaveup-2698488261.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP (both@spectator)` | Turn 6 line `6.2`: `Whimsicott` used Prankster Encore on `Archaludon` at `6.0-6.1` before `Archaludon` released Turn 5's charged `Electro Shot` at `6.2`; `planSegment()` discarded `[from] lockedmove`, defaulting Turn 5's target to `Whimsicott` (`+1`) instead of `Annihilape` (`+2`) and breaking `carriedInto(plans, 6)` in all 3 views. |
| `gaveup-2705233123.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` | Turn 2 `Whimsicott` Encore precedes `Archaludon` `Electro Shot\|\|[still]`; `planSegment()` dropped the action so `carriedInto(plans, 3)` was empty and Turn 3 line `3.11` (`[from] lockedmove`) permanently targeted `+1 Whimsicott` instead of `+2 Charizard` across all 3 views and 6 starts (48 rounds, 288 rebuilds, 140,542 probes). |
| `gaveup-2705862443.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP (both@spectator, 82.6s trace / 1,097.6s sweep, stop=searches)` | Turn 3 line `3.10` (`wanted Electro Shot\|p2b: Whimsicott\|[from] lockedmove`, `got p2a: Charizard`): Turn `3.3` Encore caused `planSegment()` to discard `3.10`, leaving Turn 2 `Electro Shot` with `target: null` and `landsOn: undefined` across all 3 views (secondary note in mimic generator: `mimic.mjs` `readIntents` skipped `|-anim|` on Turn 1 `Solar Beam`). |
| `gaveup-2706164806.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` | Turn 5 line `5.8` (`wanted Electro Shot\|p2b: Kommo-o\|[from] lockedmove`, `got Whimsicott`) failed across all 3 views because Turn 5 Prankster Encore added `Archaludon` to `encored` before `[from] lockedmove` was checked, leaving Turn 4 charge `target`/`landsOn` unset. |
| `gaveup-2708278379.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` | Turn 5 line `5.10` (`wanted Electro Shot\|p2b: Charizard\|[from] lockedmove`, `got p2a: Glimmora`): Turn 4 Encore caused `planSegment()` to discard `Archaludon`'s `Electro Shot\|\|[still]`, leaving `carriedInto(plans, 5)` empty across all 3 views. |
| `gaveup-2710347095.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` | Turn 3 `Whimsicott` Encored `Archaludon` before `Electro Shot\|\|[still]`; `planSegment()` skipped the move, leaving `plans[3].actions.p2[1]` undefined so `carriedInto(plans, 4)` returned `[]` and Turn `4.10` stalled on wrong `[from] lockedmove` target (`p1a: Garchomp` vs `p1b: Charizard`) across all 3 views. |
| `gaveup-2710746778.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP (both@spectator, 81.9s trace / 477.6s sweep, stop=searches)` | Turn 5 line `5.8` (`wanted Electro Shot\|p2b: Charizard\|[from] lockedmove`, `got p2a: Whimsicott\|[from] lockedmove`) unreachable because Turn 4 Encore caused `planSegment()` to drop `p1b: Archaludon`'s charging `Electro Shot`, leaving `recoverChargeTargets()` and `carriedInto(plans, 5)` blind to `variants[4]`. |
