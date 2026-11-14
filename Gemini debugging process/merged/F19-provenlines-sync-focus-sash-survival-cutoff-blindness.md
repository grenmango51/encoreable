# F19: `provenLines`/`sync` Cutoff Blindness on `Focus Sash` vs. Natural `1/100` Survival (+ `replayWith` / 1D Fallback Lockout)

## 1. Failure Overview & Status
- **Bucket ID**: `F19`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` (`provenLines`, `sync`, `moveChange`, `damageEvent`, `allowed`, `apply`) & `scripts/lib/inference/infer.mjs` (`probe` / `replayWith` `same` check, 1D `moved` filter / pair search)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs:1105-1118` — `provenLines(seen)` returns `null` whenever any `view[i].at >= prefix.cutoffAt` inside `[seen.from, seen.to)` (e.g., `|-enditem|...|Focus Sash` at `prefix.cutoffAt`), or when `next.kind !== '-damage'`
  - `scripts/lib/inference/evidence.mjs:1130-1193` — `moveChange(T, hit, dealt, ctx)` relies on `shown = provenLines(ctx.lines)` for `sameLines(ev.lines, shown)` (`line 1182`); when `shown === null`, survival announcements are never checked
  - `scripts/lib/inference/evidence.mjs:2436-2510` — `SURVIVAL`, `survivedLine()`, and `sync()` (`lines 2466-2472`, `2502-2509`): when `atCut` is a `SURVIVAL` line (`|-enditem|...|Focus Sash`, `Sturdy`, `Endure`, `Focus Band`) and `prefix.observedLine` is a direct `|-damage|` line (`1/100`), `sync()` sets `awaited = survivor(entry.line)`, steps past `cutoffAt`, and calls `observe(mine, want.token, entry.at)` with default `survived = false` (`line 2469`)
  - `scripts/lib/inference/evidence.mjs:2008-2012` — `allowed(rec, M, token, survived = false)` returns `[first, lo]` (e.g., `[1, 3]` for `1/100`), which accepts `left = 1` from a `Focus Sash` trigger
  - `scripts/lib/inference/infer.mjs:669-679` — `probe()` runs `replayWith(built.inputLog, packOf(chosen), t, channel)` with the scaffold's unpinned single roll; when a candidate still pops `Focus Sash` on that one roll, `same === true` skips `rebuild()`, leaving `got.b === null` and `d.moved = false`
  - `scripts/lib/inference/infer.mjs:824-845` — `moved = dims.filter(d => d.moved)` skips the 2-stat pair loop (`lines 833-845`) whenever every 1-stat perturbation still pops `Focus Sash` (`moved.length === 0`) or is blocked by `closestSpread()` (`scripts/lib/inference/knowledge.mjs`) draining `hp` to `0` under the 66-SP cap
- **Total Merged Reports**: **12** (`gaveup`: 12)
  - **View Breakdown in Sweep**:
    - `both@spectator` only: **6** (`gaveup-2695745857.md`, `gaveup-2697644605.md`, `gaveup-2699495093.md`, `gaveup-2700761731.md`, `gaveup-2705423624.md`, `gaveup-2706358822.md`)
    - `p1@p2` only: **2** (`gaveup-2696815410.md`, `gaveup-2704008268.md`)
    - `p1@p2` & `both@spectator`: **4** (`gaveup-2697926528.md`, `gaveup-2700739563.md`, `gaveup-2700992808.md`, `gaveup-2707382556.md`)
    - Aggregate across views: `both@spectator` failed in **10** reports, `p1@p2` failed in **6** reports, `p2@p1` failed in **0** reports
  - **Source Shard Clusters**: `S03-C07`, `S05-C06`, `S09-C07`, `S10-C07`, `S12-C06`, `S15-C03`, `S12-C10` (partial).

---

## 2. Root-Cause Mechanism

In Showdown's `Battle.damage` / `runEvent('Damage')`, when a hit deals lethal damage (`damage >= target.hp`) to a Pokémon holding `Focus Sash`, having `Sturdy`, or under `Endure`, the `Damage` event fires **before** the `|-damage|` protocol line and emits a survival announcement (`|-enditem|...|Focus Sash`, `|-ability|...|Sturdy`, `|-activate|...|move: Endure`), clamping `damage = target.hp - 1` so the subsequent `|-damage|` line prints `1/100` (Channel 0) or `1/maxhp` (Channel 1/2). Conversely, when a Pokémon survives **naturally** with `1..floor(0.0199 * maxhp)` HP (e.g., `1..3` HP in `1/100`), **no** survival announcement is emitted—the protocol prints `|-damage|<ident>|1/100` directly.

When the observed replay survives naturally at `1/100` without triggering `Focus Sash` (or `Sturdy`/`Endure`), while the current scaffold's guess takes lethal damage and pops `Focus Sash`:

1. **Protocol Cutoff Alignment (`verifiedPrefix`, `evidence.mjs:158-181`)**:
   - The observed replay prints `|-damage|<ident>|1/100` at Turn `t` index `i`.
   - The scaffold prints `|-enditem|<ident>|Focus Sash` at index `i` (followed by `|-damage|<ident>|1/100` at `i + 1`).
   - Thus `prefix.cutoffAt` lands on the scaffold's `|-enditem|` line, while `prefix.observedLine` is `|-damage|<ident>|1/100`.
2. **`provenLines(seen)` Disables Line Verification at Cutoff (`evidence.mjs:1105-1118`)**:
   - Inside `Damage`, `seen.from <= prefix.cutoffAt < seen.to`, so the loop at line `1109` (`if (view[i].at >= prefix.cutoffAt) return null`) immediately returns **`null`**.
   - Even if `seen.to <= prefix.cutoffAt`, `next = view[i]` is `|-enditem|...`, whose `hpLine(next.line)` is `null`, failing line `1112` (`if (!mine || mine.kind !== '-damage' ...) return null`).
   - Consequently, `shown` in `moveChange()` (`line 1135`) is **`null`**, completely bypassing the `sameLines(ev.lines, shown)` guard at line `1182`. Every candidate spread whose `Damage` event pops `Focus Sash` and sets `left = 1` is retained!
3. **`sync()` Misroutes `awaited` With `survived = false` (`evidence.mjs:2466-2472, 2502-2509`)**:
   - At `atCut`, `sync()` recognizes `survivor('|-enditem|...|Focus Sash')` matches `want` (`|-damage|...|1/100`), sets `awaited = '<side>:<name>'` (`line 2505`), and continues to the next `view` entry (`|-damage|<ident>|1/100` at `entry.at > prefix.cutoffAt`).
   - On that entry (`line 2469`), `sync()` calls `observe(mine, want.token, entry.at)` **without passing `survived`** (defaulting to `false`, and without any negative `noSurvival` flag).
   - `allowed(rec, M, '1/100', false)` returns `[1, Math.floor(0.0199 * M)]` (e.g., `[1, 3]`). Because `Focus Sash` clamps lethal damage to `left = 1` (`1 in [1, 3]`), **zero spreads are eliminated** (`unchanged = true`). Even worse, `evidencePass` constructs a fake `exact` proof using the `Focus Sash`-clamped `1` HP and hands Turn `t` back into `reconstruct` round after round until `stop = 'searches'`.
4. **Compounding `infer.mjs` Fallback Lockout (`replayWith` `same`-Skip & 1D `moved = []` Starvation)**:
   - Because `evidencePass` fails to prune any spread, `inferSpreads` falls back to `fallback()` (`infer.mjs:478`).
   - **False `same` Skip in `replayWith` (`infer.mjs:669-679`)**: `probe()` first replays the scaffold's `inputLog` with `chosen` via `replayWith()`. That single run uses the scaffold's unpinned Turn `t` damage roll (e.g., a mid/high roll `r >= 5`). Whenever a single-stat bulk/offense probe (`Kingambit spd 32` in `2699495093`) still triggers `Focus Sash` on that one roll—even though lower rolls (`r = 3, 4`) survive naturally at `1/100`—`replayWith()` produces the exact same `|-enditem|...|Focus Sash` output, setting `same = true`, skipping `rebuild()`, and leaving `d.moved = false`.
   - **1D Coordinate Lockout & 66-SP `closestSpread` HP Cannibalization (`infer.mjs:824-845`)**: When survival requires moving two stats simultaneously—either raising `(hp, def/spd)` together under the 66-SP cap (`Sneasler` in `2700992808` and `2707382556`, `Basculegion` in `2697644605` and `2700739563`) or co-adjusting `(attacker_offense, defender_bulk)` (`Volcarona spa` + `Ninetales hp/spd` in `2705423624`)—every single-stat probe still triggers `Focus Sash` (`outcome(got.b) === baseOutcome`). Because `closestSpread()` scans `hp` ascending and drains `hp` to `0` to accommodate `def 32`/`spd 32` while keeping `spe`/`atk` at `32`, every 1D probe fails identically, leaving `moved = []` and skipping the 2-stat pair search (`lines 833-845`) entirely.

---

## 3. Single Cohesive Fix Specification

All 12 failures stem from the same mechanism: the inference engine fails to treat **absence of a `SURVIVAL` announcement at `prefix.cutoffAt`** as strict negative evidence (`!survived` / `ev.lines.length === 0`) and `fallback` fails to explore survival-threshold rolls and 2-stat bulk/offense pairs when 1D probes all pop `Focus Sash`.

1. **Propagate Negative Survival-Announcement Constraint at `SURVIVAL` Cutoffs (`scripts/lib/inference/evidence.mjs`)**:
   - In `sync()` (`lines 2466-2510`) and `observe()` (`lines 2352-2368`): when `atCut` is a `SURVIVAL` announcement (`survivor(entry.line) === `${want.side}:${want.name}``) and `prefix.observedLine` is a plain HP line (`hpLine(prefix.observedLine)` with `kind === '-damage'`), record that the real `Damage` event **did not emit** a survival announcement (e.g., pass `noSurvival: true` / `shown = []` into `observe` -> `apply` -> `moveChange`, or mark `ctx.lines` / `apply` with `noSurvival`).
   - In `moveChange()` (`lines 1135-1193`) and `apply()` (`lines 2051-2145`): when `noSurvival` is active (or `provenLines` sees `atCut` is a `SURVIVAL` line followed immediately by `want` on the same Pokémon), reject any candidate outcome whose `damageEvent(hit, ctx, T, M, h, x)` emits a `SURVIVAL` line (`ev.lines.some(survivor)`), or equivalently requires `ev.lines` to match empty survival announcements (`shown = []`, meaning `raw < h` / no `Focus Sash`/`Sturdy`/`Endure`/`Focus Band` activation).
   - **Soundness Guarantee**: Because Showdown's simulator *always* emits `|-enditem|...|Focus Sash` / `|-ability|...|Sturdy` / `|-activate|...|Endure` / `Focus Band` inside `runEvent('Damage')` before the `|-damage|` line whenever those effects save the target, the absence of that announcement in the observed replay before the `|-damage|` line *soundly* proves (via the simulator's own `damageEvent` dry run) that no surviving spread+roll combination could have triggered that survival effect on that hit. No natural `1/100` survival spread is ever removed.
2. **Bypass `replayWith` `same` Shortcut on `SURVIVAL` Cutoffs (`scripts/lib/inference/infer.mjs:669-679`)**:
   - In `fallback()`'s `probe()`, disable the `replayWith` `same` shortcut (just as `disputed` already does for hidden-choice turns) when `diff.actual` or `diff.expected` is a `SURVIVAL` line (or an HP line adjacent to a `SURVIVAL` line on turn `t`), so `rebuild()` can test all 16 damage rolls (`r = 0..15`) instead of falsely discarding `spd 32` / `hp 32` / `spa 0` on the scaffold's single unpinned roll.
3. **Seed 2-Stat `(bulk, bulk)` / `(offense, bulk)` Pairs When `moved` Is Empty on a `SURVIVAL` Cutoff (`scripts/lib/inference/infer.mjs:825-845`)**:
   - When `fallback()` stops on a `SURVIVAL` cutoff (`diff.actual` matches `SURVIVAL` or `diff.expected` is `1/100`) and `moved.length === 0` after the 1D ends/middles pass, seed the 2-stat pair loop (`lines 833-845`) with the direct attacker/defender offensive and defensive stats from `near[0]`/`near[1]` (`hp`, `def`, `spd`, `atk`, `spa` endpoints `[0, 32]`)—allowing `(hp 32, spd 32)` or `(spa 0, hp 32)` to be probed within `closestSpread` even when 1D moves are clipped by the 66-SP cap.

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2699495093` (`both@spectator`, `GAVE UP`, 222.6s trace / 1,351.1s sweep, 162,558 probes)
- **Ground Truth Exchange (Turn 1, lines `1.16`–`1.19`)**:
  - `p1b: Charizard-Mega-Y` (`Modest`, planted `20/0/24/1/0/21`, `SpA = 198`) uses spread `Heat Wave` under `SunnyDay` against `p2b: Kingambit` (`Adamant`, planted `32/5/16/0/13/0`, `HP = 207`, `SpD = 118`, holding `Focus Sash`).
  - Damage ladder is `[204, 206, 210, ..., 242]`. Ground truth rolls **`204`**, leaving **`3 / 207` HP** ($\lfloor 300 / 207 \rfloor = 1.44\% \to$ **`1/100`**) **without triggering `Focus Sash`**.
- **Failure Trace (`trace_2699495093.log`)**:
  - Round 5 (`default`) / Round 4 (`usage`) reaches Turn 1 line `1.19`:
    - `wanted`: `|-damage|p2b: Kingambit|1/100`
    - `got`: `|-enditem|p2b: Kingambit|Focus Sash` (followed by `|-damage|p2b: Kingambit|1/100`)
  - Under the guess (`Charizard spa = 23` [`SpA = 222`], `Kingambit 32/0/0/0/0/1` [`HP = 207, SpD = 105`]), `provenLines()` returns `null` at `|-enditem|` and `sync()` calls `observe(..., survived = false)`. Because `Focus Sash` `left = 1` satisfies `[1, 3]`, `evidencePass` removes **0 spreads** and returns `2 turns exact` with `unchanged = true`, freezing Rounds 6–8 into `stop = 'searches'`.
  - In `fallback()`, probing `Kingambit spd 32` (`207 HP, 137 SpD`) shifts `Heat Wave` to `[198, 200, 200, 204, 206, 208, ..., 234]`, where rolls `r = 3, 4` (`204, 206`) survive naturally at `1/100` and solve `1.19`. Yet `replayWith` runs with Round 5's unpinned roll `r >= 5` (`>= 208 >= 207`), pops `Focus Sash`, prints `Kingambit spd 32 - plays out the same`, and **skips `rebuild()` completely** across all 6 starts (240 fallback rebuilds).

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2707382556` (`p1@p2` and `both@spectator`, `GAVE UP`, 33.9s trace / 325.4s sweep, 0 spreads eliminated)
- **Ground Truth Exchange (Turn 1, lines `1.7`–`1.8`)**:
  - `p2b: Floette-Mega` (`Modest`, `Fairy Aura`, `SpA 192..227`) hits `p1a: Sneasler` (`Jolly`, random 66-SP bulk spread, holding `Focus Sash`) with `Light of Ruin` (`140 BP`).
  - With joint `hp` + `spd` bulk (e.g., `32 HP / 32 SpD` = `187 HP / 132 SpD`, or `25 HP / 16 SpD` = `180 HP / 116 SpD`), `Sneasler` survives `184..186` or `178` damage naturally at **`1/100`** (`1..3` HP left) **without popping `Focus Sash`**.
- **Failure Trace (`trace_2707382556.log`)**:
  - At line `1.8`, `wanted |-damage|p1a: Sneasler|1/100`, `got |-enditem|p1a: Sneasler|Focus Sash`.
  - `provenLines()` returns `null` and `sync()` passes `survived = false` on `awaited`, keeping `136,663,185` spreads (**100%**, `0` eliminated on every Pokémon across all 24 rounds!).
  - In `fallback()` (both `both@spectator` and `p1@p2` where `Floette` is known), `Sneasler` starts with `spe = 32`: probing `Sneasler hp 32` keeps `spd = 0` (`100 SpD`, lethal `>= 202` even at `0 SpA`), while probing `Sneasler spd 32` triggers `closestSpread()` to drain `hp` to `0` (`155 HP`, lethal `>= 180` / `>= 157`). Every 1D probe triggers `Focus Sash` identically, leaving `moved = []` and skipping the 2-stat `(hp, spd)` pair loop with 106 unused rebuilds remaining in Start 6.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2695745857.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 1 `1.4` (`wanted \|-damage\|p2a: Basculegion\|1/100`, `got \|-enditem\|p2a: Basculegion\|Focus Sash`): `evidence.mjs` pruned 0 spreads, `replayWith` falsely skipped `Rillaboom atk` / `Basculegion def` probes, and `closestSpread` forced `Basculegion hp=0` (compounded by `spend.fruitless` blacklisting `1.4` across `search 2..4`). |
| `gaveup-2696815410.md` | `gaveup` | `p1@p2` | `PASS` on `both@spectator` (58.2s); sweep `GAVE UP` on `p1@p2` (249.4s, `stop = searches`) | Turn 2 `2.8` (`wanted Excadrill 1/100` without Focus Sash, `got \|-enditem\|Excadrill\|Focus Sash`): with Basculegion-F fixed at SpA 165 in `p1@p2`, Excadrill's `spd 32` probe forced `closestSpread` to strip `hp` to `0` under 66-SP cap (`atk 32` kept), leaving `d.moved = false` and starving 2D `(hp, spd)`/`(atk, spd)` probes. |
| `gaveup-2697644605.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 1 `1.4` (`wanted \|-damage\|p2b: Basculegion\|1/100`, `got \|-enditem\|p2b: Basculegion\|Focus Sash`): `provenLines` returned `null` at `\|-enditem\|` leaving 136.66M spreads intact, `closestSpread` stripped `Basculegion hp` to `0` (`195 HP`), and `replayWith` `same` skipped `rebuild()`/`steerDice` so `moved = []`. |
| `gaveup-2697926528.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` (`both@spectator`, 702.3s trace / 3,537.8s sweep; `p1@p2` 3,537.8s sweep, `stop = searches`) | Turn 7 `7.8` (`wanted Pelipper 1/100` without Focus Sash, `got \|-enditem\|Pelipper\|Focus Sash`): surviving 150 BP Adaptability Last Respects without Focus Sash requires `32 HP + 32 Def` SP (leaving `0 SpA`), which breaks Turn 6 `6.10` Farigiraf `62/100` and traps 1D fallback between `6.10`, `7.3`, and `7.8`. |
| `gaveup-2699495093.md` | `gaveup` | `both@spectator` | `GAVE UP` (222.6s trace / 1,351.1s sweep) | Turn 1 `1.19` (`Charizard-Mega-Y` Sun `Heat Wave` left `p2b: Kingambit` at `1/100` [`3/207`] without triggering `Focus Sash`): `provenLines()` returned `null` and `sync()` called `observe(..., survived = false)` removing 0 spreads, while `replayWith` skipped `Kingambit spd 32` (`same = true` on roll `r >= 5`) across all 240 fallback rebuilds. |
| `gaveup-2700739563.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` | Turn 4 `Sucker Punch` vs. `Focus Sash` `Basculegion` (`1/100` natural survival without `\|-enditem\|Focus Sash`): low-bulk guesses pop `Focus Sash` at `cutoffAt` so `provenLines` returns `null` (retaining 136.66M Basculegion spreads), and 1D fallback cannot jointly raise `(hp, def)` in both `p1@p2` and `both@spectator`. |
| `gaveup-2700761731.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 6 `Grassy Glide` -> `Basculegion` `Focus Sash` threshold (`wanted 1/100`, `got Focus Sash`, triggered by only 3/16 rolls on planted spreads) where 1D mutations either play out identically or break Turns 1–4. |
| `gaveup-2700992808.md` | `gaveup` | `p1@p2`, `both@spectator` | `PASS` (129.0s `both@spectator` trace via lucky Phase 2 15-Atk roll; sweep `GAVE UP` on both views) | Turn 7 `7.9` (`wanted \|-damage\|p1a: Sneasler\|1/100`, `got \|-enditem\|p1a: Sneasler\|Focus Sash`): Sneasler carried random `16 HP / 30 Def` (`171 HP, 110 Def`), so in `p1@p2` and `both@spectator` Phase 1, 1D fallback (`hp 32 / def 0` or `hp 0 / def 32`) still popped Focus Sash and never searched `(Sneasler hp, Sneasler def)` jointly. |
| `gaveup-2704008268.md` | `gaveup` | `p1@p2` | `PASS` on `both@spectator` (118.2s); sweep `GAVE UP` on `p1@p2` (1,488.3s, `stop = searches`) | Turn 5 (`wanted Sneasler 1/100` without Focus Sash, `got \|-enditem\|Sneasler\|Focus Sash`): in `p1@p2` with P2 fixed and Channel 2 exact integer HP, Gholdengo's Shadow Ball must hit exact `MaxHP(Sneasler) - 1` while `hp/def/spd/spe` satisfy Life Orb `87/100`, `19/100`, and speed bounds under 66-SP cap. |
| `gaveup-2705423624.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 `4.4` (`wanted \|-damage\|p1a: Ninetales\|1/100`, `got \|-enditem\|p1a: Ninetales\|Focus Sash`): `evidencePass` cut off at `\|-enditem\|`, while in Default/Wide `Volcarona spa` probes broke Turn 3 and in Usage `aimFor` shifted `Volcarona SpA = 5` to `18` before `Ninetales hp/spd` and `Volcarona spa 4` all popped Sash (`same`, `moved = false`), leaving `moved = []`. |
| `gaveup-2706358822.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 4 `Mega Dragonite` spread `Heat Wave` (`4.5` Kingambit `48/100` and `4.7` Indeedee `wanted 1/100`, `got Focus Sash`): 1D Indeedee tweaks played out the same while Dragonite/Kingambit tweaks broke `4.5`, `1.12`, `2.6`, or `2.12`, exhausting 240 fallback rebuilds (`stalled`). |
| `gaveup-2707382556.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` (`both@spectator`, 33.9s trace / 325.4s sweep) | Turn 1 `1.8` (`Sneasler` survived `Floette-Mega`'s `Light of Ruin` naturally at `1/100` without `Focus Sash`): rebuilds popped `Focus Sash` at `1.8`, `provenLines`/`sync` accepted `left = 1` as valid `1/100` eliminating 0 spreads, `closestSpread` drained `hp` to `0` on `spd 32`, and `moved = []` skipped 2-stat `(hp, spd)` pairs. |
