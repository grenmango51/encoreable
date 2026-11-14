# F33: `infer.mjs` `held.set()` Permanently Locking Unverified 6-Stat Fallback Witness Spreads Across Rounds

## 1. Failure Overview & Status

- **Bucket ID**: `F33`
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs:421-422` (`const held = new Map()`, `const aimed = (id, kn, prev) => held.get(id) || aimFor(kn, prev);`)
  - `scripts/lib/inference/infer.mjs:875-876` (`fallback` return: `const spreads = new Map(win.by.map(c => [c.id, win.got.chosen[c.s][c.i]]));` freezes the entire 6-stat witness spread `win.got.chosen[c.s][c.i]` even though `win.by` only perturbed 1–2 stats `c.stat`)
  - `scripts/lib/inference/infer.mjs:1025-1026` (`choose`: `const fixed = held.has(id) ? [held.get(id)] : [];` forces the poisoned 6-stat `held` spread as the primary candidate every round)
  - `scripts/lib/inference/infer.mjs:1078` (`!exact` fallback: `aimed(id, kn, picks[s][i])` snaps `next[s][i]` back to `held.get(id)`)
  - `scripts/lib/inference/infer.mjs:1093` (`for (const [id, spread] of found.held) held.set(id, spread);` — monotonically accumulates entries with **no `held.delete` or `held.clear` anywhere in `infer.mjs`**)
  - `scripts/lib/inference/infer.mjs:677-679` (`probe`: `replayWith` `same` shortcut skips rebuilding `hp` boundary shifts when frozen `built.inputLog` dice produce identical rounded Channel 0 percentages)
- **Total Merged Reports**: **7** (`gaveup` cases from `S01-C08`, `S04-C07`, `S08-C07`, `S08-C08`, `S13-C09`, `S15-C12`)
- **View Failure Breakdown in Sweep**:
  - `both@spectator`: **5 / 7** failed (`2694129838`, `2697175035`, `2701113256`, `2701808353`, `2706101187`)
  - `p2@p1`: **1 / 7** failed (`2694940936`)
  - `p1@p2`: **1 / 7** failed (`2699204634`)

---

## 2. Root-Cause Mechanism

When `fallback()` (`infer.mjs:478`) finds a local witness `win` that gets past an early or mid-turn diff on turn `t`, it records the witness into `held` (`infer.mjs:875, 1093`) to keep later rounds from regressing past `t`. Three compounding defects turn this into a permanent search-poisoning lock-in:

1. **Full 6-stat freeze for a 1–2 stat causal fix (`infer.mjs:875-876, 1093`)**:
   - `win.by` is an array of 1 or 2 stat perturbations `c = { s, i, id, stat, value }` (e.g., `Indeedee def 32` to survive Turn 1 `Wave Crash`, `Floette atk 32` whose 66-SP cap incidentally dropped `def`, `Rillaboom hp 31` to hit `32/100` Sandstorm, `Swampert spe 32` to resolve a Turn 2 Speed tie, or `Sinistcha hp 9` / `Delphox hp 20` on an early turn).
   - However, line `875` extracts `win.got.chosen[c.s][c.i]` — the **entire 6-stat spread** produced by `build()` / `closestSpread()` around `start[c.s][c.i]` — and line `1093` writes it permanently into `held`.
   - The 4–5 unverified bystander coordinates in that snapshot (such as `Indeedee hp = 29`, `Floette hp = 1 / atk = 32`, `Swampert spe = 32` starving bulk, or an arbitrary `hp` that happened to satisfy Turn 1–2 percentage rounding) were never proved by turn `t`, yet `held` freezes all 6 stats as a single rigid object.

2. **Permanent monotonic retention across `choose()` and `!exact` rounds (`infer.mjs:422, 1025-1026, 1078`)**:
   - `infer.mjs` contains **zero** `held.delete()` or `held.clear()` calls. Once `held.set(id, spread)` executes, `choose()` (`line 1025`) prepends `[held.get(id)]` ahead of `aimFor(...)`, so `closestSpread(kn, held.get(id))` returns the poisoned 6-stat spread verbatim (`L1 cost = 0`) whenever it remains inside `kn`.
   - Worse, when downstream turns fail `evidencePass(..., exact: true)` (e.g., because the frozen `hp` violates MaxHP recoil/drain parity, Sitrus thresholds, or Channel 1/2 exact observer HP), `choose()` exhausts `guessTries`, sets `exact = null`, and line `1078` calls `aimed(id, kn, picks[s][i])`, which returns `held.get(id)` again — pinning the search right back onto the impossible spread.
   - Across `default`, `wide`, and `widest` starts, `held` traps all rounds on an unreachable downstream line until `searches` or `stalled` terminates the entire inference.

3. **Compounded by `replayWith` `same` skipping `hp` probes under frozen dice (`infer.mjs:677-679`)**:
   - When `held` freezes a partner or opponent at an arbitrary `hp` (e.g., `Indeedee hp = 29` capping `Wave Crash` recoil at `54`, or `Floette hp = 1` with unpinned Turn 7 `Aqua Jet` roll `68`), `probe()` runs `replayWith(built.inputLog, packOf(chosen), t, channel)` against `plain`.
   - Because `built.inputLog` freezes the exact `>rng` damage roll from the stalled scaffold, changing another Pokémon's `hp` SP (`Swampert hp 15` vs `16`, or `Floette hp 2` vs `1`) frequently rounds to the **identical** Channel 0 integer percentage (`147/190 = 77/100` and `148/191 = 77/100`; `80/151 = 52/100` and `79/150 = 52/100`).
   - `same === true` skips `rebuild()` completely (`b = null`, `d.moved = false`), blinding `fallback()` to the true `hp` SP that would have solved the turn under a different dice roll.

---

## 3. Single Cohesive Fix Specification

This fix obeys `AGENTS.md` Hard Rules 1–3: no custom damage/HP/parity formulas, no removal of sound spreads from `knowledge`, and one mechanism-level fix in `infer.mjs`:

1. **Store only causal stat coordinates in `held`, never full 6-stat witness snapshots (`infer.mjs:421-422, 875-876, 1025-1026, 1093`)**:
   - Change `held` from `Map<id, FullSpread>` to `Map<id, Map<stat, value>>` (storing **only** `{ [c.stat]: c.value }` for the coordinates `c` in `win.by` that actually moved past the failing line).
   - In `aimed(id, kn, prev)` (`line 422`) and `choose()` (`lines 1025-1026`), compute `base = aimFor(kn, prev)` (or `prev`) and overlay **only** the held coordinates `{ ...base, ...Object.fromEntries(held.get(id)) }` so the remaining 4–5 unverified stats remain free to move with `aimFor` / `closestSpread` / `choose()`.

2. **Evict / release `held` coordinates on downstream stall or contradiction (`infer.mjs:1025, 1055-1080, 1090-1124`)**:
   - In `choose()` (`line 1026`), always include an un-held candidate (`aimFor(kn, picks[s][i])` without the `held` overlay) after the `held`-overlaid candidate, so `choose()` is never barred from overriding a stale `held` coordinate when joint exact verification fails.
   - Track the turn/line `{ turn, index, mark }` where each `held` entry was added. Whenever `choose()` exhausts `guessTries` (`!exact`), or whenever `stalled` advances / a round regresses to an earlier turn or fails `fallback` on a downstream turn `t2 > t1`, release (delete) `held` entries for Pokémon involved in the stall/contradiction (or clear `held` entries whose coordinate `c.stat` is not required by `t2` / before retrying `fallback`).

3. **Bypass `replayWith` `same` skips when `hp` changes on an HP-sensitive failing turn (`infer.mjs:677-679`)**:
   - Do not treat `replayWith(built.inputLog, ..., t, channel) === plain` as proof that a probe cannot affect turn `t` when `changes` modifies a Pokémon's `hp` SP and `diff.expected` / `diff.actual` on turn `t` is an HP damage, heal, recoil, or drain line (or more cleanly, run `replayWith` only through turn `t - 1` when `changes` alters `hp`, since turn `t`'s unpinned `>rng` dice in `built.inputLog` are not fixed for the new `MaxHP`).

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2694129838` (`both@spectator`, S15-C12)
- **True Planted Stats**:
  - `p1:1 Swampert` (Adamant, Random): `{ hp: 15, atk: 10, def: 8, spa: 7, spd: 14, spe: 12 }` $\to$ **HP 190, Mega Atk 198**
  - `p2:1 Indeedee-F` (Bold, Usage #2): `{ hp: 32, atk: 0, def: 32, spa: 2, spd: 0, spe: 0 }` $\to$ **HP 177, Def 128**
- **Failure Trace (`Turn 1` `1.9`–`1.16` `Wave Crash` + `Grassy Terrain`)**:
  1. On Turn 1 (`1.9`–`1.16`), `Swampert-Mega` hits `Indeedee-F` with `Wave Crash`: ground-truth `166` damage leaves `Indeedee` at `11/177` (`6/100`), triggers `Sitrus Berry` (`+44` to `55/177` = `31/100`), deals `Math.round(166 * 0.33) = 55` recoil to `Swampert` (`190 - 55 = 135/190` = `71/100`), and `Grassy Terrain` (`+11`) heals `Swampert` to `146/190` = **`76/100`** (`1.16: wanted |-heal|p1a: Swampert|76/100|[from] Grassy Terrain`).
  2. In Round 5/6, `choose()` failed on `1.16` with `Swampert hp = 16` (`MaxHP = 191`) and `Indeedee hp = 29` (`MaxHP = 174`), dropping `pins = null`. The next round regressed to `1.9` (`Indeedee def = 22` OHKOed), where `fallback` tested **`Indeedee def 32`**, generating **`29/0/32/0/0/5`**.
  3. `infer.mjs:1093` permanently wrote `held.set('p2:1', 29/0/32/0/0/5)`, locking `Indeedee` at **`hp = 29` (`MaxHP = 174`)**.
  4. At `MaxHP = 174`, surviving `1.9` at `6/100` (`hp in [11, 12]`) restricts `Wave Crash` damage to `<= 163`, capping recoil at `54`. Yet for `Swampert` at `hp = 16` (`MaxHP = 191`) or `hp = 15` (`MaxHP = 190`), `recoil = 54` yields `148/191 = 77/100` or `147/190 = 77/100`, **never `76/100`**!
  5. When `fallback` probed true `Swampert hp 15`, `replayWith` replayed Round 7's frozen `recoil = 54` roll, saw `77/100 === 77/100`, and skipped `rebuild()` (`Swampert hp 15 - plays out the same`), exhausting all 6 starts (`58` rounds, `342` rebuilds, `57,281` probes, `stop = searches`).

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2706101187` (`both@spectator`, S08-C07)
- **True Planted Stats**:
  - `p2:3 Floette-Eternal` (Modest, Usage #1): `{ hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }` $\to$ **Mega HP 151, Def 107, SpA 227**
  - `p1:3 Basculegion` (Adamant, Usage #13): `{ hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }` $\to$ **Atk 180**
- **Failure Trace (`Turn 2` off-stat probe $\to$ `held` `HP SP = 1` $\to$ `Turn 7` `7.4` Adaptability parity deadlock)**:
  1. Round 11 regressed to Turn 2 (`2.4`: `wanted |-damage|p2a: Floette|45/100`). In `fallback`, testing **`Floette atk 32`** saturated the 66-SP cap (`atk 32 + spa 31 + spe 2 = 65`), forcing `closestSpread` to strip `Floette`'s `def` (`5 -> 0`) and `hp` (`4 -> 1`), producing **`Floette 1/32/0/31/0/2`**.
  2. Because `def = 0` incidentally passed Turn 2, `infer.mjs:1093` wrote **`held.set('p2:3', 1/32/0/31/0/2)`**, permanently locking `Floette` at **`hp = 1` (`MaxHP = 150`)** and `atk = 32` across all subsequent rounds.
  3. At `MaxHP = 150`: Turn 2 (`45/100`) forces `68` HP (even); Turn 3 `Draining Kiss` (`105` dmg, `+79` odd drain) leaves `68 + 79 = 147/150` (**odd**); and Turn 7 `7.4` (`Basculegion` `Adaptability` `2.0x` `Aqua Jet` deals strictly **even** `2k` damage) requires **`86/150` (even)** for `57/100` — an impossible `ODD - EVEN = ODD` parity contradiction (`got 56/100` or `58/100`).
  4. When Start 6 probed true `Floette hp 2` (`MaxHP = 151`), `replayWith` used Round 13's unpinned Turn 7 roll (`68` dmg), saw `79/150` (`52/100`) `===` `80/151` (`52/100`), and skipped `rebuild()` (`Floette hp 2 - plays out the same`), exhausting all 6 starts (`82` rounds, `382` rebuilds, `476,142` probes, `stop = searches`).

---

## 5. Merged Reports Manifest

| # | File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|---|
| 1 | `gaveup-2694129838.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`) | Turn 1 line `1.16`: `Swampert` `Wave Crash` recoil + `Grassy Terrain` (`76/100` vs `77/100`) required `recoil >= 55` (`Indeedee hp >= 31`), but `held` locked `Indeedee` at `hp = 29` after `1.9` fallback and `replayWith` skipped `Swampert hp = 15` as `'plays out the same'` under frozen `recoil = 54` across all 6 starts. |
| 2 | `gaveup-2694940936.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` trace; `p2@p1` untraced) | Turn 2 flinch-order fallback (`Sneasler spe 32, Froslass spe 0`) freezes all 6 stats of `Froslass` and `Sneasler` into `held`, colliding with fixed P1's exact Channel 1 HP on Turn 3 `Blizzard` + `Eject Button` and exhausting `fallbackRebuilds` via `given: null` double rebuilds. |
| 3 | `gaveup-2697175035.md` | `gaveup` | `both@spectator` | `GAVE UP` | After `choose()` exhausted `guessTries` at Turn 5 (Round 7), Round 8 regressed to Turn 2 `Sandstorm` (`32/100` vs `31/100`) and `fallback` permanently pinned false spread `Rillaboom hp = 31` (true `hp = 15`) into `held`, locking Turns 3–4 into a permanent stall across all restarts (`13,246.9s`). |
| 4 | `gaveup-2699204634.md` | `gaveup` | `p1@p2` | `PASS` in untraced `both@spectator` Start 3 wide (`659.8s`); `GAVE UP` in `p1@p2` sweep (`698.0s`, `stop=searches`) | Turn `2.0` `Farigiraf`/`Swampert` `72 == 72` speed tie causes `fallback` to double-spend `again` on `Farigiraf spe` (breaking Turn 1 `Update` tie-shuffle ordinals) and exhaust 8-rebuild starts, while Start 3's `Swampert spe = 32` `held` lock starves 32 SP of bulk/offense against locked P2 in `p1@p2`. |
| 5 | `gaveup-2701113256.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 6 line `6.5` (`wanted Sinistcha 87/100` drain, `got 88-89/100`): Turn 5 fallback locked impossible `Sinistcha hp = 9` into `held` against low-HP `Milotic`, `judge()` (`r[0] < 6`) excluded `Milotic spd/hp` from 2-stat recovery, and `choose()` `guessTries` wiped pins causing Turn `2.11` ping-pong. |
| 6 | `gaveup-2701808353.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 3 line `3.13` (`wanted Rillaboom 46/100`, `got 47/100`): Round 5 fallback locked impossible `Delphox hp = 20` into `held`, and Round 6 fallback with `maxBacktracks: 0` sampled the wrong roll on `Delphox hp 25` while `judge()` excluded early-failing dims. |
| 7 | `gaveup-2706101187.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 1,093.5s trace / 1,732.4s sweep, `stop=searches`, 82 rounds, 382 rebuilds, 476,142 probes) | Turn `7.4` (`Floette 57/100` vs `56/100` or `58/100`) hits an `Adaptability` even-damage parity contradiction because Turn 2 off-stat fallback `Floette atk 32` polluted `held` with `HP SP = 1`, `replayWith` skipped `Floette hp 2` on unpinned T7 dice, and fainted `Whimsicott` was absent from Turn 7 `cast`. |
