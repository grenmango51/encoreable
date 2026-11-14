# F20: `analyseHit`/`carriedChange` Uncoupling `damageCallback` Reflection Moves (`Metal Burst` / `Mirror Coat` / `Counter`) in Channel 0 & Intra-Turn Roll Traps

## 1. Failure Overview & Status
- **Bucket ID**: `F20`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` (`analyseHit`, `carriedChange`, `asDealt`) & `scripts/lib/reconstruct.mjs` (`resolveTurn`, `blameTurns`)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs:959-966` — `analyseHit()` flags `const carried = !!clone.damageCallback && !reads.length && !targetHp && !sourceHp;` and sets `supported: supported && !carried && !back.size` (`false`)
  - `scripts/lib/inference/evidence.mjs:1683-1703` — `carriedChange(T, hit, ctx)` only handles `U.exact && typeof ctx.raw === 'number'` (`line 1688`) or `T.exact && last?.byA.size && last.victim === U && last.hitsOn === 1 && last.turn === battle.turn` (`line 1692`); when **`!U.exact && !T.exact`** (Channel 0 / `both@spectator`), it logs `'its damage was carried over from an earlier hit, so it was not used'` and drops to `band('down', what)` (`line 1702`)
  - `scripts/lib/inference/evidence.mjs:1981-1985` — `onChange()` routes `hit?.carried` into `carriedChange(rec, hit, ...)`
  - `scripts/lib/inference/infer.mjs:164-180` — `handOn(built, rolls)` hands unverified prior-hit rolls (`subs`) into subsequent rounds even when a downstream `carried` hit failed or was skipped as a band
  - `scripts/lib/reconstruct.mjs:1897, 1944, 2063-2076, 2581-2600` — `resolveTurn()` commits `subs[d_prior]` when the prior hit lands on a percentage HP (`74/100`), never revisits `d_prior` inside turn `t` when the downstream `carried` hit fails (`subs[draw.i] !== undefined`), and `blameTurns()` only returns turns `k <= t - 1` (`stop = 'stuck'` with `backtracks = 0`)
- **Total Merged Reports**: **5** (`gaveup`: 5)
  - **View Breakdown in Sweep**:
    - `both@spectator` only: **4** (`gaveup-2700691226.md`, `gaveup-2701573211.md`, `gaveup-2701575169.md`, `gaveup-2708291245.md`)
    - `p2@p1` only: **1** (`gaveup-2705043587.md`)
    - `p1@p2`: **0**
  - **Source Shard Clusters**: `S04-C03`, `S06-C07`, `S07-C07`, `S15-C04`.

---

## 2. Root-Cause Mechanism

Moves implemented via Showdown's `damageCallback` (`Counter`, `Mirror Coat`, `Metal Burst`, `Comeuppance`) read **no attacking/defending stats** and **no current/max HP** during `getDamage`. Instead, `damageCallback` returns a fixed multiple (`2 * d` or `Math.trunc(1.5 * d)`) of the integer damage `d` that the user took from the last qualifying hit earlier in the same turn (`lastDamagedBy.damage` or `volatiles.counter`/`mirrorcoat`).

In `evidence.mjs`, `analyseHit()` (`lines 959-966`) detects `carried = true` and marks `hit.supported = false`, routing the HP change to `carriedChange(T, hit, ctx)` (`lines 1683-1703`). `carriedChange` currently works **only when at least one side's exact integer HP is visible** (`U.exact` or `T.exact`):
- If `U.exact` is `true`, `ctx.raw` is the exact damage dealt in the replay (`amountChange`).
- If `T.exact` is `true`, `carriedChange` calls `dealtChange(T, last, ...)` (`line 1693`) using `asDealt(U.pokemon, d, ...)` (`lines 1712-1722`) for every candidate prior-hit damage `d` in `U.lastDealt`.

However, this leaves two critical blind spots that cause all 5 failures:

1. **Channel 0 (`both@spectator`) Total Uncoupling (`!U.exact && !T.exact`, `evidence.mjs:1688-1703`)**:
   - In spectator view, **both** the reflection user (`U`) and the target (`T`) are displayed as percentages (`!U.exact && !T.exact`).
   - `carriedChange` hits line `1698` and falls back to `band('down', what)`, **discarding the `1.5x` / `2.0x` coupling** between `U`'s incoming hit (`T`'s prior attack) and `T`'s outgoing HP after `Metal Burst` / `Mirror Coat`.
   - Because the evidence pass treats both hits as independent, it accepts incompatible spread pairs (e.g., `Meganium hp = 16` + `Bastiodon hp = 7` in `2701573211` / `2701575169`, or `Floette spa = 32` + `Milotic spd` in `2708291245`, or `Camerupt` + `Milotic` in `2700691226`), hands back a fake `exact` proof, and leaves `fallback` trapped because **no 1-stat change** can satisfy both the prior hit's percentage and the reflected `1.5x`/`2.0x` percentage simultaneously!
2. **Same-Turn Roll Commitment Trap & Missing Intra-Turn `subs` Backtracking (`evidence.mjs:1692` & `reconstruct.mjs:1897, 2581`)**:
   - Even when `T.exact` *is* `true` (as in `p2@p1` for `2705043587`, where P1 `Lycanroc` has exact integer HP while P2 `Bastiodon` has percentage HP), or during `reconstruct` / `fallback` on a `carried` turn:
     - `dealtChange` in `carriedChange` (`line 1693`) omits `dealtOk` back-propagation to the prior hit `last.change` (unlike `totalChange.after` at `line 1631`), or `handOn` (`infer.mjs:164`) pins the prior hit's roll solely from the percentage display before the `carried` hit runs.
     - Worse, in `reconstruct.mjs`, `resolveTurn(t)` first reaches the prior hit (e.g., `1.11` `Rock Slide` hitting `Bastiodon` to `74/100`), sees multiple rolls (`15, 16, 17`) print `74/100`, and greedily commits `subs[d_prior] = winners[sample.pick(...)]` (`line 1944`). When line `1.18` (`Metal Burst`) later demands the unique `d_real` that matches `Lycanroc`'s exact HP drop, `resolveTurn(t)` skips `d_prior` because `subs[d_prior] !== undefined` (`line 1897`), exhausts `maxProbes` on irrelevant secondary dice, and calls `blameTurns(segments, t, line)` (`line 2582`)—which only searches turns `t - 1` down to `1` and **never unlocks earlier rolls inside turn `t`**, aborting immediately with `stop = 'stuck'` and `backtracks = 0`.

---

## 3. Single Cohesive Fix Specification

1. **Extend `carriedChange` to Two-Sided Percentage Views (`!U.exact && !T.exact`) and Propagate `dealtOk` Back to `last.change` (`scripts/lib/inference/evidence.mjs:1683-1703`)**:
   - Whenever `last?.byA.size && last.victim === U && last.hitsOn === 1 && last.turn === battle.turn` holds—**regardless of whether `T.exact` is `true` or `false`**—run `dealtChange(T, last, what, 'ctr', d => asDealt(U.pokemon, d, ...))`.
   - Specifically, in `dealtChange(S, last, what, tag, run)` (`lines 1453-1474`), `S` is the recipient of the reflection hit (`T` in `carriedChange(T, hit, ctx)`), while `last.byA` is keyed by `last.off` (the attacking stat of `last.change.dealtBy`, which is `T`—the Pokémon that originally attacked `U`):
     - When `last.off` belongs to `T` (`!T.kn.known && last.off && last.change.off === last.off`), `dealtChange(T, last, ...)` ties `T`'s own attacking stat (`T.flat[last.off]`) to `T`'s post-reflection HP `h2` (`tiedStat` + `backward()`), and returns `dealtOf` + `victim: last.change` + `hurt: last.victim` (`U`).
     - In `apply()` (`lines 2168-2171`), `if (dealtOk)` automatically sets `change.victim.dealtOk = dealtOk` and calls **`narrowDealt(U, last.change, dealtOk, change)`**, pruning `U`'s HP values (`U.chain`) that could not have taken a `d` consistent with `T`'s post-reflection display.
     - When `T` hit `U` with a stat not belonging to `T` (e.g., `Foul Play` / `Body Press` or `T.kn.known` where `last.off === null`), `dealtChange` handles `known = S.kn.known || !last.off` (`line 1455`) via `last.byA` without filtering `S.flat`; `via` must only be set when `last.change.off === last.off`, while `dealtOf`, `victim: last.change`, and `hurt: U` are always populated so `dealtOk` narrows `U`.
     - Ensure `backward()` on `U` filters by `last.change.dealtOk` (`line 3846`), and that `paths(raw)` filters by `e.change.dealtOk` (`line 4000`) and matches `carriedChange` via `dealtBy` (`line 3998`) with bounded backtracking if `options[0]` on `U` fails `T` downstream.
2. **Intra-Turn Roll Revision in `reconstruct.mjs` (`resolveTurn` / `blameTurns`, `scripts/lib/reconstruct.mjs:1897, 2581`)**:
   - In `resolveTurn(t)`, when `score[0]` cannot advance and all unsettled draws are exhausted (`!committed` after `chances` pairs), or in `blameTurns` when `hpFigure` fails on turn `t` (especially on a `carried` reflection line or a recoil/drain line whose source hit occurred earlier in the **same turn `t`**), allow `reconstruct` to unlock and redraw earlier `subs` committed within turn `t` itself (`turns[d.i] === t`) whose target/victim feeds the failing line (e.g., `1.11` `Rock Slide` on `Bastiodon` when `1.18` `Metal Burst` fails on `Lycanroc`).
   - Also in `handOn()` (`scripts/lib/inference/infer.mjs:164-180`), do not pin an earlier hit's roll on turn `t` if a downstream `carried` hit on turn `t` was read only as a band or lies at/past `cutoffAt`.

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2701573211` (`both@spectator`, `GAVE UP`, 142.7s trace / 245.4s sweep, 77,605 probes)
- **Ground Truth Exchange (Turn 2, lines `2.5` & `2.7`)**:
  - `p1b: Meganium-Mega` (`Modest`, planted `32/0/3/28/3/0`, `HP = 187`, `SpA = 210`, burned at `176/187` [`94/100 brn`]) hits `p2a: Bastiodon` (`Sassy`, random `4/17/18/7/9/11`, `HP = 139`, `SpD = 183`) with `Mega Sol` Fire `Weather Ball`: deals **`73` damage**, leaving `66 / 139` (**`47/100`** at `2.5`).
  - `p2a: Bastiodon` answers with **`Metal Burst`** (`2.7`), returning $\lfloor 73 \times 1.5 \rfloor =$ **`109` damage** onto `Meganium`, leaving `176 - 109 = 67 / 187` (**`35/100 brn`**).
- **Failure Trace (`trace_2701573211.log`)**:
  - Because `!U.exact && !T.exact` in `both@spectator`, `carriedChange` (`evidence.mjs:1698`) drops `2.7` to `band('down')`, never linking `Metal Burst` (`1.5 * d`) to `Weather Ball` (`d`) or `Bastiodon.hp`.
  - Round 2 lands on `Meganium 16/0/0/17/0/2` (`HP = 171`, `161` pre-hit) and `Bastiodon 7/0/2/0/7/0` (`HP = 142`). To hit `47/100` (`67..68 / 142`), `Weather Ball` must deal `d = 75`, forcing `Metal Burst = 112` $\to$ `49 / 171` (**`28/100 brn`** vs `wanted 35/100 brn`).
  - Every 1D perturbation in `fallback` fails `2.7`: raising `Meganium hp 32` (`HP = 187`, `176` pre-hit) gives `176 - 112 = 64 / 187` (**`34/100 brn`**); dropping `Bastiodon hp 0` (`HP = 135`, `d = 71`, `Metal Burst = 106`) gives `161 - 106 = 55 / 171` (**`32/100 brn`**). Across all 6 starts, `fallback` burns 480 rebuilds (including duplicate `35/100` vs `60/171` runs via `markOf(diff)`) and exhausts `128/128` rebuilds at `Bastiodon spd 27` before reaching the 2-stat pair loop.

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2705043587` (`p2@p1` `GAVE UP` in 258.2s; `both@spectator` `PASS` in 34.7s)
- **Ground Truth Exchange (Turn 1, lines `1.11`, `1.15`, `1.18`)**:
  - In `p2@p1` (`channel = 1`), P1 (`Froslass`, `Lycanroc-Dusk`) is **known** with exact integer HP, while P2 (`Bastiodon`, `Kommo-o`) is **inferred** from `%` HP.
  - `1.11`: `Lycanroc-Dusk` uses `Rock Slide` on `Bastiodon` (`85/100 -> 74/100`), dealing `d_RS` in `[14..18]`. For a given `Bastiodon (hp, def)`, `74/100` admits multiple rolls (e.g., `15, 16, 17`).
  - `1.15`: `Kommo-o` hits `Lycanroc` (`exact`) to `h_15 / M_Lyc`.
  - `1.18`: `Bastiodon` uses **`Metal Burst`** on `Lycanroc`, dealing $\lfloor 1.5 \times d_{RS} \rfloor$ (`14->21, 15->22, 16->24, 17->25, 18->27`) to exact `h_18 / M_Lyc`. Because $\lfloor 1.5 \times d \rfloor$ is injective, `h_15 - h_18` uniquely determines `d_real`.
- **Failure Trace (`slowest_gave_up.json` limits: `["fallbackRebuilds", "probes", "searches"]`, `0` `backtracks`)**:
  - `evidence.mjs` marks `Metal Burst` (`carried = true`) unsupported at `line 963` (`1.18` is the cutoff or uncoupled) and hands on an ambiguous `1.11` `Rock Slide` roll `r_RS` into `pins.subs` solely to match `Bastiodon 74/100`.
  - Even in `fallback` with Turn 1 `subs` cleared, `resolveTurn(1)` reaches `1.11` first, samples one of the multiple rolls matching `74/100` (`winners[sample.pick(...)]` at `reconstruct.mjs:1944`), and commits `subs[d_RS]`. When `1.18` (`Metal Burst`) fails because `d_RS !== d_real`, `resolveTurn(1)` never revisits `subs[d_RS]` (`line 1897`), burns `maxProbes` on `Blizzard`/`Rock Slide`/`Clanging Scales` secondary dice (`"probes"`), and `blameTurns(segments, 1, line)` returns `[0]` (Turn 0 only), stopping immediately as `stuck` with `backtracks = 0` until all 6 starts exhaust `searches`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2700691226.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 8 `Milotic` `Mirror Coat` (`18/100` vs `23/100`) reflects `2x` `Earth Power` damage taken from `Camerupt-Mega` (`74/100`); uncoupled by `damageCallback`, 1D fallback cannot co-adjust `Camerupt` SpA/Def/HP and `Milotic` SpD/HP without breaking Turn 5 `Eruption` (`71/100`) or Turn 6 `Mystical Fire` (`85/100`). |
| `gaveup-2701573211.md` | `gaveup` | `both@spectator` | `GAVE UP` (142.7s trace / 245.4s sweep) | Turn 2 `2.7` (`Bastiodon` `Metal Burst` `1.5x` `Weather Ball` leaving `Meganium` at `35/100 brn` vs `28/100`) is dropped by `carriedChange` in Channel 0 (`!U.exact && !T.exact`), and 1D fallback spends all 128 rebuilds before reaching the 2-stat pair loop where `(Meganium hp 32, Bastiodon hp 0)` passes. |
| `gaveup-2701575169.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 5 `Bastiodon` `Metal Burst` (`5.6`: `28/100 brn` vs `21/100 brn`) is uncoupled from `Meganium` `Weather Ball` (`5.2`: `5/100`) by `carried = true` in `evidence.mjs:959-966`; 1D fallback cannot co-adjust `(Meganium hp, Bastiodon hp)` and burns 480 rebuilds. |
| `gaveup-2705043587.md` | `gaveup` | `p2@p1` | `PASS` on `both@spectator` (34.7s); sweep `GAVE UP` on `p2@p1` (258.2s) | In `p2@p1` (Channel 1), exact `Lycanroc` HP after `1.18` `Metal Burst` uniquely pins `1.11` `Rock Slide` damage onto `%`-HP `Bastiodon`, but `evidence.mjs` skips `Metal Burst` (`carried = true`) and `resolveTurn(1)` locks `subs[d_RS]` at `1.11` before reaching `1.18` with no intra-turn backtrack in `blameTurns`. |
| `gaveup-2708291245.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 `Mirror Coat` reflected `2x` `Floette-Mega`'s `Dazzling Gleam` (`112` dmg onto non-usage `19 SpA` `Floette`: `32/100` wanted vs `22/100` got under `32 SpA` priors), while `Giga Drain` fractional healing and premature exact `maxHP` hand-offs (`13/161` vs `14/161`) trapped 1D fallback between Turns 3 and 5. |
