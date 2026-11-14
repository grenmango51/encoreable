# F11: Single-Target `|move|` Target-Variant Exhaustion & Futile Stat-Point `fallback()` Sweeps

## 1. Failure Overview & Status

- **Bucket ID**: `F11`
- **Category**: `2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs` & `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:107-196` (`planSegment()` — parses `target` on line `187` and maps `slot` via `startOf[side]`)
  - `scripts/lib/reconstruct.mjs:392-429` (`targetOptions()` — builds target suffix candidate list `[preferred, ...options]`)
  - `scripts/lib/reconstruct.mjs:557-570` (`choiceFor()` — selects `options[state.nextVariantDigit(options.length)]`)
  - `scripts/lib/reconstruct.mjs:1687-1709, 1786-2045` (`canReach()`, `resolveTurn()` — when `|move|` differs on target with `0` preceding dice or un-steered choice ambiguity, `resolveTurn()` exits `stuck` immediately)
  - `scripts/lib/reconstruct.mjs:2428-2515` (`reconstructOnce()` — enumerates `variants[t]` up to `Math.min(allVariants, maxVariants)` and falls back to `partial` / `0`)
  - `scripts/lib/inference/infer.mjs:478-625` (`fallback()` — `order` check at `622-625` evaluates `false` on same-actor/same-move target diffs and spends `8` / `32` / `128` Stat-Point rebuilds at `maxBacktracks: 0`)
- **Total Merged Reports**: **3** reports
  - All 3 views (`p1@p2`, `p2@p1`, `both@spectator`): **2** (`gaveup-2696009013.md`, `gaveup-2711009533.md`)
  - `both@spectator` only: **1** (`gaveup-2704629244.md`)

---

## 2. Root-Cause Mechanism

All three battles in this bucket stall at a deterministic **same-actor, same-move, target-only divergence** on a choosable single-target move (`Kowtow Cleave` or `Instruct`):

```text
wanted: |move|<actor>|<move>|<targetA>
got:    |move|<actor>|<move>|<targetB>
```

Two coupled behaviors in `reconstruct.mjs` and `infer.mjs` turn this discrete choice-target mismatch into a full search collapse:

1. **Failure of `reconstruct.mjs` to recover the observed target slot (`reconstruct.mjs:557-570, 2428-2505`)**:
   - In `reconstruct.mjs:187`, `planSegment()` extracts `target` from `parts[4]` only if `parts[4]` contains `': '`. When `action.target` is missing (such as an un-hinted `||[still]` move) or when `reconstructOnce()`'s variant search (`reconstruct.mjs:2428-2505`) fails to reach/keep the variant aiming at `<targetA>` (e.g., on turns following mid-turn `Revival Blessing` `forceSwitch`, `Phantom Force` semi-invulnerability, or Turn 8 KO replacement where `both@spectator` exhausts probe/backtrack budgets earlier in Turns 1–2 as in `2704629244`, or on Turn 3/9 with zero preceding dice as in `2696009013` and `2711009533`), `resolveTurn()` finds **zero steerable or reachable RNG dice** prior to the `|move|` line (e.g., Turn 9 `9.0–9.1` `Rage Powder` in `2711009533` throws 0 dice before `9.2` `Kowtow Cleave`).
   - With `variants` exhausted or stuck on `<targetB>` and 0 dice to flip, `reconstructOnce()` terminates `stuck` on the `|move|` line and hands that target-mismatched rebuild back to `inferSpreads()`.

2. **Futile Stat-Point `fallback()` sweeps in `infer.mjs` (`infer.mjs:478-625`)**:
   - In `infer.mjs:622-625`:
     ```js
     const kind = l => String(l || '').split('|')[1];
     const who = l => (/^p[1-4][a-d]?: /.test(String(l || '').split('|')[2] || '') ? String(l).split('|')[2] : null);
     const order = (who(diff.actual) && who(diff.expected) && who(diff.actual) !== who(diff.expected))
       || (kind(diff.actual) !== kind(diff.expected) && ACTION_START.has(kind(diff.actual)) && ACTION_START.has(kind(diff.expected)));
     ```
     Because both `diff.expected` and `diff.actual` have `kind === 'move'` and identical `who` (`<actor>`), `order` evaluates to `false`.
   - `evidencePass` reads zero constraints from an unreached `|move|` line (`next === picks`, `unchanged === true`), triggering `fallback()` (`infer.mjs:1089-1091`).
   - `fallback()` (`infer.mjs:478-914`) mutates **only Stat Points** (`hp, atk, def, spa, spd, spe` of `cast`) with `maxBacktracks: 0` (`budgets[0]` / `budgets[1]`):
     - No Stat Point perturbation can change an actor's already-submitted move target slot unless it accidentally alters an earlier turn's KO, speed order, or redirection.
     - Consequently, `fallback()` burns its entire `8` / `32` / `128` rebuild budget (`240` `spent` rebuilds + `12` `base`/`dice` rebuilds = `252` fallback rebuilds per view across the 6 starts) testing every stat endpoint across 5–6 Pokémon, either returning `plays out the same`, stopping at the exact same target diff (`3.5`, `3.11`, or `9.2`), or breaking earlier turns' damage thresholds, before marking the line `fruitless` and letting `++level >= budgets.length` terminate all 6 starts with `stop = "searches"`.

---

## 3. Single Cohesive Fix Specification

Address the choice-target recovery gap in `reconstruct.mjs` and prevent `infer.mjs:fallback()` from wasting Stat-Point sweeps on pure target-slot mismatches:

1. **Direct target-variant recovery & prioritization in `reconstruct.mjs` (`choiceFor` / `reconstructOnce`, lines `557-570, 2428-2505`)**:
   - Whenever `reconstructOnce()` hits a `|move|` divergence where `diff.expected` and `diff.actual` name the **same actor and same move** and differ **only in `parts[4]`** (target ident, e.g. `|move|p1b: Kingambit|Kowtow Cleave|p2a: Dragapult` vs `p2b: Pawmot`), inspect `plans[t]` and the live `request.active` slots for that actor to verify `action.target` matches `parts[4]` of `diff.expected` and `targetLoc` maps it to the live slot where `identName(parts[4])` currently stands.
   - Ensure `reconstructOnce()` directly walks/prioritizes the choice variant(s) that switch that actor's `targetOptions` suffix to the slot of `diff.expected`'s target (regardless of `maxVariants` truncation or earlier `variants[t]` ordering, and tracing any `planSegment` slot/target mismatch after mid-turn `forceSwitch` / `Revival Blessing` / `Phantom Force` transitions so the actor's choice string genuinely targets `diff.expected`'s slot).
   - Keep all other target options in `targetOptions()` intact as variants when a redirection or KO requires them, preserving 100% soundness (`AGENTS.md` Rule 2).

2. **Short-circuit Stat-Point `fallback()` on pure same-actor, same-move target-only diffs (`scripts/lib/inference/infer.mjs:478-625`)**:
   - Inside `fallback()`, after `dice` (`budgets[1]`) confirms the guess alone does not pass turn `t` under a larger choice/dice search (`infer.mjs:610-613`), check if `diff.expected` and `diff.actual` are both `|move|` lines with the **same actor (`parts[2]`) and same move (`parts[3]`)** differing solely on target (`parts[4]`), and no redirection/faint-replacement event in `segment` depends on a Speed/damage Stat Point before that `|move|` line.
   - When true, Stat Points cannot alter the target choice: return `none()` immediately (`searched.set(mark, 2); spend.fruitless.add(mark);`) instead of running `8` / `32` / `128` fruitless Stat-Point rebuilds (`~90%` of wasted runtime in `2696009013`, `2704629244`, and `2711009533`).

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2696009013` (All 3 Views Stall at Turn 3 `3.5` After `Phantom Force` + `Revival Blessing`)
- **Failure Scope**: `p1@p2`, `p2@p1`, and `both@spectator` all `GAVE UP` (`1,435.5s` combined sweep; `505.5s` trace on 9 threads, `stop = "searches"`, `64` rounds, `316` rebuilds [`240` `spent` + `12` `base`/`dice` fallback], `390,956` probes).
- **Turn 3 Sequence (`3.0–3.5`)**:
  - `3.0`: `p1a: Delphox` switches out to `p1a: Maushold` (`100/100`).
  - `3.1–3.2`: `p2a: Dragapult` executes `Phantom Force` on `p1a: Maushold` (`|-immune|p1a: Maushold`).
  - `3.3–3.4`: `p2b: Pawmot` executes `Revival Blessing` (`|-heal|p2: Typhlosion|49/100|[from] move: Revival Blessing`, pinning `Typhlosion` to odd `HP SP`).
  - `3.5` (Stall Line):
    - `wanted`: `|move|p1b: Kingambit|Kowtow Cleave|p2a: Dragapult`
    - `got`: `|move|p1b: Kingambit|Kowtow Cleave|p2b: Pawmot`
- **Trace Proof**:
  - `"variants"` was not in `limits` (`Kowtow Cleave` has 3 target options `[' +1', ' +2', ' -1']`), yet across all 3 views (`p1@p2` with P2's true SPs known, `p2@p1` with P1's true SPs known, and `both@spectator`), `reconstruct` consistently hit `p2b: Pawmot` (`Kingambit atk 0 - plays out the same`).
  - `fallback` burned `240` `spent` Stat-Point rebuilds (`~460s` of `505.5s`) across `Kingambit`, `Dragapult`, `Pawmot`, `Delphox`, `Maushold`, and `Typhlosion` without ever changing `3.5`'s target.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2711009533` (All 3 Views Stall at Turn 9 `9.2` With Zero Preceding Dice)
- **Failure Scope**: `p1@p2` (`3,066.2s`, `62` rounds, `225` rebuilds, `158,124` probes), `p2@p1` (`4,828.1s`, `54` rounds, `309` rebuilds, `391,478` probes), and `both@spectator` (`5,170.4s` sweep / `777.4s` trace, `78` rounds, `318` rebuilds, `413,318` probes) all `GAVE UP` with `stop = "searches"`.
- **Turn 9 Sequence (`9.0–9.2`)**:
  - After Turn 8 `Double Shock` KOed `Delphox` in mimic (bringing in `p1a: Kingambit` at Turn 8 upkeep), Turn 9 opens with:
  - `9.0–9.1`: `p1b: Sinistcha` uses `Rage Powder` (`0` RNG dice thrown).
  - `9.2` (Stall Line):
    - `wanted`: `|move|p1a: Kingambit|Kowtow Cleave|p2b: Pelipper`
    - `got`: `|move|p1a: Kingambit|Kowtow Cleave|p2a: Pawmot`
- **Trace Proof**:
  - `resolveTurn` had `0` dice in `drawsOf(run.trace, 9)` before line `9.2`, exited `stuck`, and `fallback` burned `8` / `32` / `128` Stat-Point rebuilds across `Kingambit`, `Pelipper`, `Pawmot`, `Sinistcha`, and `Slowking-Galar` (`Kingambit spe 32` inverted Trick Room order to `Pelipper Hurricane`, confirming Trick Room was active, while all valid speeds hit `9.2` target mismatch).

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2704629244` (`both@spectator` Stalls at Turn 3 `3.11` `Instruct`)
- **Failure Scope**: `p2@p1` (`23.4s`) and `p1@p2` (`31.8s`) **PASSED**, while `both@spectator` **GAVE UP** (`2,560.4s` sweep / `516.1s` trace, `stop = "searches"`, `49` rounds, `204+` rebuilds, `256,007` probes).
- **Turn 3 Line `3.11` (`Instruct`, `target: "normal"`)**:
  - `wanted`: `|move|p2a: Oranguru|Instruct|p1b: Primarina`
  - `got`: `|move|p2a: Oranguru|Instruct|p1a: Blaziken`
- **Trace Proof**:
  - While `p2@p1` and `p1@p2` resolved the `Instruct +2` variant within probe budget, `both@spectator` exhausted backtracking/probe budgets on Turns 1–2 percentage coupling, left `Oranguru` on `+1` (`p1a: Blaziken`), and burned `240` Stat-Point `fallback` rebuilds across `Blaziken`, `Pawmot`, `Primarina`, and `Oranguru` (`order === false`) with `0.0%` exact stats pinned.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2696009013.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`505.5s` trace / `1,435.5s` sweep, `stop=searches`, `64` rounds, `316` rebuilds, `390,956` probes) | All 3 views stalled at Turn 3 `3.5`: `reconstruct` selected `p2b: Pawmot` instead of `p2a: Dragapult` for `p1b: Kingambit`'s `Kowtow Cleave` right after `Maushold` switch, `Phantom Force`, and `Revival Blessing` (with `variants` limit unhit), while `fallback` burned `240` Stat-Point rebuilds. |
| `gaveup-2704629244.md` | `gaveup` | `both@spectator` | `GAVE UP` (`516.1s` trace / `2,560.4s` sweep, `stop=searches`, `49` rounds, `204+` rebuilds, `256,007` probes) | Turn 3 line `3.11` (`wanted \|move\|p2a: Oranguru\|Instruct\|p1b: Primarina`, `got \|move\|p2a: Oranguru\|Instruct\|p1a: Blaziken`): target variant `+1` vs `+2` could not be resolved under `both@spectator` budgets and could not be changed by Stat-Point-only `fallback`. |
| `gaveup-2711009533.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`777.4s` trace / `5,170.4s` sweep, `stop=searches`, `78` rounds, `318` rebuilds, `413,318` probes) | Turn 9 line `9.2`: after Turn 8 KO divergence brought in `p1a: Kingambit`, `reconstruct` simulated `Kowtow Cleave` targeting `p2a: Pawmot` instead of `p2b: Pelipper`; with `0` dice thrown by prior `Rage Powder`, `resolveTurn` failed to steer the target and all 3 views exhausted `fallback` stats. |
