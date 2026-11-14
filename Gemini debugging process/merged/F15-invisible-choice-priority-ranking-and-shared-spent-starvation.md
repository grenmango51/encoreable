# F15: Invisible-Choice (`flinch`/`par`/Fainted) Priority-Blind Variant Ordering, `MAX_VARIANTS`/`spent[t]` Starvation, and Priority-Bracket `order = true`

## 1. Failure Overview & Status

- **Bucket ID**: `F15`
- **Category**: `3. RNG Steering & Variant-Budget Bugs in reconstruct.mjs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs` (`choiceFor`, `reconstructOnce`, `canReach`) / `scripts/lib/inference/infer.mjs` (`fallback`, `spend.fruitless`)
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:432-434` (`selfSwitchLast(dex)` — sorts only `selfSwitch` moves last, ignoring `move.priority`)
  - `scripts/lib/reconstruct.mjs:525-544` (`choiceFor` invisible-choice branch `!action` — lines `532-535` sort `slot.moves` solely by `selfSwitchLast`, leaving `+4 Protect`, `+3 Fake Out`, `+2 Follow Me/Rage Powder`, `+1 Sucker Punch` ahead of `0`-priority moves or burying `-7 Trick Room` / `+2 Rage Powder` at higher `v`)
  - `scripts/lib/reconstruct.mjs:602` (`export const MAX_VARIANTS = 256;`)
  - `scripts/lib/reconstruct.mjs:1692-1697` (`canReach` — extends `limit` to the next `ACTION_START` on `|move|`, causing `resolveTurn` to probe all crit/damage dice of an impossible priority-jumped invisible move)
  - `scripts/lib/reconstruct.mjs:2304, 2413-2505` (`reconstructOnce` — shared `spent[t]` counter across `entering` (`v=0`), `rewalk()`, and `ranked`; `width = Math.min(allVariants, maxVariants)` truncation; lines `2415, 2479, 2496` pass `maxProbes - spent[t]` so dead-end Variant `0` starves `rewalk()` and true variants)
  - `scripts/lib/inference/infer.mjs:482-484` (`fallback` — `none()` permanently adds `mark` to `spend.fruitless` after 2 attempts)
  - `scripts/lib/inference/infer.mjs:624-634, 761-786` (`fallback` — line `624-625` sets `order = true` on any actor/action mismatch even when an invisible-choice slot jumped across priority brackets, triggering Speed-first sweeps at line `634` and Speed-separation probes at lines `761-786`)
- **Total Merged Reports**: **10** (`kind: gaveup`, `12` failing view runs across `9` shard clusters: `S02-C09`, `S04-C04`, `S04-C06`, `S05-C04`, `S06-C05`, `S07-C06`, `S07-C09`, `S10-C04`, `S14-C10`)
  - **View Breakdown**:
    - `p1@p2` only: **4** (`2691765083`, `2696831732`, `2705915534`, `2711522873`)
    - `both@spectator` only: **3** (`2697864489`, `2700087436`, `2707261859`)
    - `p2@p1` only: **1** (`2700906683`)
    - `p1@p2` & `both@spectator`: **1** (`2694616044`)
    - `p2@p1` & `p1@p2`: **1** (`2696353204`)
    - Total per view: `p1@p2` = **6**, `both@spectator` = **4**, `p2@p1` = **2**.

---

## 2. Root-Cause Mechanism

When a Pokémon faints before acting, flinches (`|cant|...|flinch`), or is fully paralyzed (`|cant|...|par`), the replay prints no `|move|` line for that slot, so `planSegment()` leaves `plan.actions[sideId][i]` empty (`!action`). In `choiceFor()` (`scripts/lib/reconstruct.mjs:525-544`), `reconstruct` substitutes a legal move from `slot.moves` as a search variable (`variant`). Three compounding bugs in how these invisible-choice variants are ordered, budgeted, and diagnosed cause reconstruction and inference to deadlock:

1. **Priority-Blind Move Ordering in `choiceFor()` (`reconstruct.mjs:532-535`) & Target-Match Distortion in `ranked` (`reconstruct.mjs:2441`)**:
   - `choiceFor` sorts `usable` moves solely with `selfSwitchLast(dex)` (`lines 432-434`), ignoring `dex.moves.get(m.id).priority`.
   - **Priority jumps ahead of observed `0`-priority actors**: If a slot's sheet lists `+4 Protect`, `+3 Fake Out`, or `+1 Sucker Punch` before `0`-priority moves, `choiceFor` emits them at low `v` (often `v = 0`). When the Pokémon actually fainted or was paralyzed after a `0`-priority foe/ally acted, substituting `+4 Protect` or `+1 Sucker Punch` executes immediately *ahead* of the observed `0`-priority line (`diff.expected`), guaranteeing a divergence at `diff.index`.
   - Worse, if the jumped invisible `|move|` shares a target field with `diff.expected` (e.g., `Golisopod Sucker Punch -2` targeting `p2b: Garchomp` vs. `wanted |move|p1b: Floette|Moonblast|p2b: Garchomp` in `2691765083`), `scoreOf` scores it **`[3, 2, 3]`**, strictly outranking every valid `0`-priority variant (`[3, 2, 2]`), and `canReach()` (`lines 1692-1697`) extends `limit` across the `|move|` action so `resolveTurn` wastes `~18` probes per impossible variant probing its crit and 16-roll damage bracket!
   - **Negative/elevated priority buried behind `v = 0..4`**: Conversely, when a flinched slot actually chose `-7 Trick Room` (`2696353204`, buried at `v = 5`) or `+2 Rage Powder` (`2694616044`, where `Volcarona` flinched before faster `Garchomp-Mega-Z`), `v = 0` starts on `0`-priority moves (`Psychic`, `Struggle Bug`) and diverges early.
   - **Truncation at `MAX_VARIANTS = 256` (`lines 602, 2429`)**: When two slots have invisible choices on the same turn (`900` variants in `2691765083`, `324` variants in `2696831732`), priority-blind ordering pushes true variants past index `255` or floods `0..255` with impossible priority-mismatched combinations.

2. **Shared `spent[t]` Probe Budget Starving `rewalk()` and `ranked` (`reconstruct.mjs:2304, 2413-2505`)**:
   - `reconstructOnce()` tracks a single `spent[t]` counter across `entering` (`v = 0`, `line 2415`), `rewalk()` (`line 2479`), and every `v` in `ranked` (`line 2496`), passing `maxProbes - spent[t]` to `resolveTurn`.
   - Under `budgets[0]` (`150 * S` probes) or `budgets[1]` (`600 * S` probes), dead-end Variant `0` (or the priority-jumped `[3, 2, 3]` `Sucker Punch` variants) consumes the **entire** `maxProbes` budget before `rewalk()` or `ranked` reaches the true variant (`v = 5 Trick Room`, `v = 10` priority-0, `v = 31 Rage Powder`, `v = 27 Fake Out`). When `better.v` is finally reached with `maxProbes - spent[t] <= 0`, `resolveTurn` exits immediately at `line 1859` (`probes >= budget`) with **zero probes**.

3. **Speed-Sweep Misdiagnosis (`infer.mjs:624`) & Permanent `spend.fruitless` Blacklisting (`infer.mjs:484`)**:
   - When an invisible-choice slot's priority-mismatched move (`+4 Protect` vs `0 Blizzard`, `+3 Fake Out` vs `0 Flare Blitz`, `+1 Sucker Punch` vs `0 Rock Slide`, or `0 Struggle Bug` vs `0 Dragon Pulse` when only `+2 Rage Powder` can precede `Garchomp-Mega-Z`) prints a different actor at `diff.actual`, `infer.mjs:624-625` unconditionally sets `order = true`.
   - `fallback` then burns `8..128` rebuilds sweeping Speed SPs (`dims.sort` at `line 634`, Speed separation at `lines 761-786`) trying to beat a priority bracket with Speed—even when mathematically impossible (`minSpe(Garchomp-Z) = 171 > maxSpe(Volcarona) = 167`, or `+4 Protect` vs `0 Blizzard` at any Speed).
   - Once `fallback` exhausts its rebuild cap without passing that line (or when an invisible-choice turn like Turn 3 in `2707261859` exhausts `maxProbes` on `budgets[0]`), `infer.mjs:484` permanently adds `mark` to `spend.fruitless`, disabling `fallback` for that turn across all remaining rounds.

---

## 3. Single Cohesive Fix Specification

Respecting `AGENTS.md` (Showdown's simulator & `dex` are the only source of mechanics; never discard a sound possibility):

1. **Priority-Aware Ranking of Invisible-Choice Moves in `choiceFor()` (`reconstruct.mjs:525-544`) & `reconstructOnce()` (`lines 2428-2505`)**:
   - Read each legal move's priority directly from the simulator (`dex.moves.get(m.id).priority` via `state` / `dex`, never a hardcoded move list).
   - In `choiceFor()` (`lines 532-535`), rank `0`-priority non-`selfSwitch` moves ahead of non-zero priority moves (`Math.abs(dex.moves.get(m.id).priority)` ascending, then `selfSwitchLast`) by default—eliminating `+4 Protect` / `+3 Fake Out` / `+1 Sucker Punch` from `v = 0` on normal priority-0 turns while keeping all moves sound and reachable.
   - **Action-Queue / Divergence-Driven Re-ranking in `reconstructOnce()` (`lines 2431-2441`)**:
     - Do **not** rank an invisible-choice `|move|` variant higher in `ranked` merely because its target happens to match `diff.expected`'s target field (`[3, 2, 3]` vs `[3, 2, 2]`): when `score[0]` stops on a `|move|` line whose actor is an invisible-choice slot (`!plan.actions[side][slot]`) that jumped ahead of `diff.expected`, penalize/deprioritize variants of that invisible slot whose `dex.moves.get(m.id).priority > expectedPriority` (and conversely, if `diff.expected` is the invisible slot's `|cant|` line and an observed `0`-priority move jumped *ahead* of it, prioritize moves of that slot with higher priority such as `+2 Rage Powder` or `+3 Fake Out`, or if the invisible slot acted *after* a slower `0`-priority actor, prioritize lower priority such as `-7 Trick Room`).
     - Apply the same priority compatibility ordering before truncating at `MAX_VARIANTS` (`line 2429`) so true variants are not pushed past index `255`.
   - In `resolveTurn` (`lines 1868-1952`), skip spending the `resolveTurn` dice-search budget probing crit/damage dice (`canReach` extension at `lines 1692-1697`) on a `|move|` mismatch emitted by an invisible-choice slot that jumped ahead of `diff.expected` (no damage roll can make `+4 Protect` or `+1 Sucker Punch` sort after a `0`-priority move!).

2. **Per-Variant Probe Budget / Reserve in `reconstructOnce()` (`reconstruct.mjs:2413-2505`)**:
   - Replace the single winner-take-all `maxProbes - spent[t]` pool where Variant `0` (`entering`) can consume `100%` of `maxProbes` with a per-variant cap and reserved budget:
     - When `width > 1`, cap any single `resolveTurn` call on a variant (including `entering`) to a fraction of `maxProbes` (e.g. `Math.max(minSlice, Math.floor(maxProbes / Math.min(width, 4)))` on the initial pass, or reserve probes for `rewalk()`'s `better.v` and top-ranked distinct priority brackets) so Variant `0` cannot starve `v = 5`, `v = 10`, or `v = 31`.
     - If `rewalk()` discovers a `better.v` that strictly advances `score` past `partial` (`outranks`), grant it a fresh search slice (up to a bounded reserve) instead of handing it `0` remaining probes.

3. **Skip Speed `fallback` on Priority-Bracket Mismatches & Guard `spend.fruitless` (`infer.mjs:484, 624-634`)**:
   - At `infer.mjs:624`, when `(built.report.hidden || []).includes(t)` and `diff.actual` (or `diff.expected`) is an invisible-choice slot's substituted move, compare `dex.moves.get(actualMove).priority` vs `dex.moves.get(expectedMove).priority` (using `dex` directly).
   - If the mismatch is across priority brackets (e.g., `+4 Protect` vs `0 Blizzard`, `+3 Fake Out` vs `0 Flare Blitz`, `+1 Sucker Punch` vs `0 Rock Slide`), do **not** classify it as a Speed `order = true` error and do **not** burn `fallback` rebuilds mutating Speed SPs (`lines 634, 761-786`); instead let `reconstruct` resolve the priority-compatible invisible variant.
   - In `infer.mjs:482-484`, do **not** add `mark` to `spend.fruitless` permanently when `reconstruct` hit `probes` or `variants` on an invisible-choice turn under a smaller search budget (`level` / `S=1`), so wider search tiers (`budgets[1..3]`, `wide`, `widest`) are not permanently locked out of `fallback` when they reach that turn.

---

## 4. Representative Battle Proofs

### Proof A (`Sucker Punch` `[3, 2, 3]` Ranking & `budgets[0..1]` Starvation + `MAX_VARIANTS = 256`): `mimic:gen9championsvgc2026regmcbo3-2691765083`
- **Source**: `Gemini debugging process/gaveup-2691765083.md` (`p1@p2` GAVE UP in sweep `1,572.8s`, `stop = "searches"`, `limits = ["fallbackRebuilds", "probes", "searches", "variants"]`).
- **Battle State at Turn 2 (`2.3`)**:
  - `p1b: Floette-Mega` (`max Spe = 169`) uses `Moonblast` to OHKO `p2b: Garchomp` (`Timid`, `86.9%` of Timid usage spreads at `Spe = 169`), and `p1a: Volcarona` uses `Overheat` to OHKO `p2a: Golisopod-Mega`.
  - Both `p2a: Golisopod` (`10` options, including `+1 Sucker Punch`) and `p2b: Garchomp` (`10` options, `Protect` at `slot 0`) fainted before acting: `variantWidth = 3 × 3 × 10 × 10 = 900 > MAX_VARIANTS (256)`.
  - **Observed `2.3`**: `|move|p1b: Floette|Moonblast|p2b: Garchomp`
- **Failure Trace**:
  1. Variants `0..9` put `Garchomp` on `+4 Protect` (`|move|p2b: Garchomp|Protect|p2b: Garchomp`, score `[3, 2, 2]`).
  2. `81` variants (`24` inside `0..255`) put `Golisopod` on `+1 Sucker Punch -2` (targeting its partner `p2b: Garchomp`), emitting:
     `|move|p2a: Golisopod|Sucker Punch|p2b: Garchomp`
     Because field 4 (`p2b: Garchomp`) matches `wanted |move|p1b: Floette|Moonblast|p2b: Garchomp`, `scoreOf` gives **`[3, 2, 3]`**, outranking every `[3, 2, 2]` priority-0 variant (`v = 10`)!
  3. `canReach()` (`reconstruct.mjs:1692-1697`) extends `limit` past the `|move|` line, so `resolveTurn` probes `Sucker Punch`'s crit and 16-roll damage bracket (`~18` probes/variant, `~1,458` probes across `81` variants), starving `spent[2]` across `budgets[0]` (`150`) and `budgets[1]` (`600`) in `p1@p2` (where `Garchomp` is locked at `169` Spe so `Floette` must tie at `169`).

### Proof B (Shared `spent[1]` Starving `-7 Trick Room` at `v = 5`): `mimic:gen9championsvgc2026regmcbo3-2696353204`
- **Source**: `Gemini debugging process/gaveup-2696353204.md` (`p2@p1` & `p1@p2` GAVE UP in sweep `464.7s`, `stop = "searches"`, `limits = ["fallbackRebuilds", "probes", "searches"]`; `both@spectator` Starts 1–3 gave up at Turn 1 before Start 4 passed via `Rillaboom spe 5` / `Tyranitar def 32`).
- **Battle State at Turn 1 (`1.12`)**:
  - `p1a: Tyranitar-Mega` uses `Rock Slide` (`1.5–1.6`), `p2b: Hatterene` (`Spe 44..72`) uses `Dazzling Gleam` (`1.7–1.11`), and `p2a: Indeedee-F` (`Spe 94..123`) flinches at `1.12` (`|cant|p2a: Indeedee|flinch`).
  - `Indeedee` had selected **`-7 Trick Room`** (which is why slower `Hatterene` moved first at `1.7`!).
- **Failure Trace**:
  1. `choiceFor()` generates `width = 6` for `Indeedee`: `v = 0..2` (`Psychic`, prio `0`), `v = 3` (`Follow Me`, prio `+2`), `v = 4` (`Healing Wish`, prio `0`), **`v = 5` (`Trick Room`, prio `-7`)**.
  2. Under `Search 1` (`budgets[0] = 150` probes), `v = 0..4` execute before `Hatterene`, failing at `1.7` (`wanted |move|p2b: Hatterene|Dazzling Gleam, got |move|p2a: Indeedee|Psychic`), and burn shared `spent[1] = 150` before `v = 5` (`Trick Room`) gets any probe budget to settle `Rock Slide`'s flinch at `1.12`.
  3. In `p2@p1` and `p1@p2`, the known side cannot be perturbed to shift Turn 1's RNG stream (`Rillaboom spe 5` / `Tyranitar def 32`), trapping both single-player views through all 6 starts.

### Proof C (`+4 Protect` vs `0 Blizzard` Priority-Bracket `order = true` Speed Sweep): `mimic:gen9championsvgc2026regmcbo3-2700087436`
- **Source**: `Gemini debugging process/gaveup-2700087436.md` (`both@spectator` GAVE UP `3,589.2s` sweep / `632.5s` trace, 90 rounds, 380+ rebuilds, 407,245 probes, `stop = "searches"`).
- **Battle State at Turn 7**:
  - `p1a: Primarina` (`10/187`, `Spe 81`) selected `Hyper Voice` (prio `0`) and was KOed (`10 -> 0 fnt`) by `p2a: Froslass-Mega` (`Spe 183`) using `Blizzard` (prio `0`) before acting.
- **Failure Trace**:
  1. `choiceFor()` assigns `+4 Protect` to fainted-before-acting `Primarina`, emitting `|move|p1a: Primarina|Protect|p1a: Primarina` ahead of `wanted |move|p2a: Froslass|Blizzard|p1a: Primarina|[spread] p1a,p1b`.
  2. `infer.mjs:624` sees `who(diff.actual) !== who(diff.expected)` (`p1a: Primarina` vs `p2a: Froslass`), sets `order = true`, sorts `dims` by `spe` (`line 634`), and spends 90 rounds mutating `Primarina`, `Froslass`, and `Incineroar` Speeds—breaking Turn 3 `Primarina > Incineroar` (`3.3`) and Turn 6 `5/100` survival—even though `+4 Protect` always precedes `0 Blizzard` at any Speed.

---

## 5. Merged Reports Manifest

All **10** reports merged into bucket `F15`:

| File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2691765083.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` traced in `64.9s`; `p1@p2` not traced) | In `p1@p2` (`p2: Garchomp` fixed at `169` Spe, forcing `Floette-Mega` to tie at `169`), Turn 2 (`900 > MAX_VARIANTS = 256` from double faint) scored `81` `Golisopod Sucker Punch -2` variants `[3, 2, 3]` ahead of priority-0 `v = 10` (`[3, 2, 2]`), with `canReach()` burning `~1,458` probes and starving `budgets[0..1]` (`150`–`600`) across `240` fallback rebuilds (`1,572.8s`). |
| `gaveup-2694616044.md` | `gaveup` | `p1@p2`, `both@spectator` | `GAVE UP` (`1,449.4s` trace / `5,654.5s` sweep) | Turn 1.5 (`wanted \|cant\|p2b: Volcarona\|flinch`, `got \|move\|p2a: Garchomp\|Dragon Pulse`): `choiceFor` defaulted `Volcarona`'s invisible flinched choice to Priority `0` `Struggle Bug` instead of Priority `+2` `Rage Powder`, while `infer.mjs:624` (`order = true`) wasted hundreds of rebuilds permuting `Volcarona`/`Garchomp` Speed SPs despite `minSpe(Garchomp-Z)=171 > maxSpe(Volcarona)=167`. |
| `gaveup-2696353204.md` | `gaveup` | `p2@p1`, `p1@p2` | `PASS` (`both@spectator` traced: Starts 1–3 gave up on T1, Start 4 passed in `197.4s`) | Turn 1.12 (`\|cant\|p2a: Indeedee\|flinch`) hides Priority `-7` `Trick Room` at `v = 5`; shared `spent[1]` burns Search 1's `150` probes on `v = 0..4` (`1.7`), and Starts 1–3 stall at `1.12`. `p2@p1`/`p1@p2` lock `p1`/`p2` stats so `both@spectator`'s Start 4 perturbations cannot save them (`464.7s`). |
| `gaveup-2696831732.md` | `gaveup` | `p1@p2` | `GAVE UP` | Turn 2 double invisible choice (`Floette par` + `Volcarona flinch` = `324 > 256` variants) in `p1@p2` runs Variant `0` (`Volcarona Tailwind` vs fixed P2 `Raichu` `Spe 190`), burning Turn 2's entire `spent[2]` / `maxProbes` budget before `rewalk()` reaches Variant `31` (`Rage Powder`), starving Variant `31` of probes. |
| `gaveup-2697864489.md` | `gaveup` | `both@spectator` | `GAVE UP` | At Turn 5 `5.2`, `choiceFor` substituted invisible `+1` `Sucker Punch` for `p1b: Kingambit` ahead of `p2a: Aerodactyl`'s `0`-prio `Rock Slide`, and `infer.mjs:624` (`order = true`) burned `239` rebuilds sweeping `spe` against an unbeatable priority gap. |
| `gaveup-2700087436.md` | `gaveup` | `both@spectator` | `GAVE UP` (`3,589.2s` sweep / `632.5s` trace, `90` rounds, `407,245` probes) | Turn 7 `Primarina` (invisible fainted-before-acting slot) is assigned `+4 Protect` ahead of `Froslass`'s `0`-priority `Blizzard`; `infer.mjs:624` misclassifies the actor mismatch as Speed `order = true` and wastes `90` rounds mutating Speed. |
| `gaveup-2700906683.md` | `gaveup` | `p2@p1` | `PASS` (`both@spectator` traced in `196.9s`; `p2@p1` not traced) | Turn 0 `Intimidate` + Turn 1 `+3 Fake Out` flinch (`1.5` before `+1 Sucker Punch`) forces `Spe(p1a: Incineroar) === Spe(p2a: Incineroar)` in `p2@p1`, while `72` priority-`0` variants outscored `27` `+3 Fake Out` variants under the unpinned speed-tie coin (`>600` probes), starving `budgets[0..1]` (`150`–`600`) and causing false negatives on `d.alive[0] = k`. |
| `gaveup-2705915534.md` | `gaveup` | `p1@p2` | `GAVE UP` | On Turn 1 in `p1@p2`, unobserved fainting P2 `Rillaboom` was assigned `+3 Fake Out` ahead of P1 `Arcanine`'s `0`-priority `Flare Blitz`; `infer.mjs:624` set `order = true` and wasted rebuild budgets sweeping Speed `0..32` rather than KOing `Rillaboom` first. |
| `gaveup-2707261859.md` | `gaveup` | `both@spectator` | `GAVE UP` (`13,647.8s`, `stop=stalled`, `291` rounds, `703` rebuilds, `2,330,512` probes) | Turn 3 `\|cant\|p1b: Golisopod\|par` created `7` invisible-choice variants (`+1 Sucker Punch` inverting Turn 3 order vs `Sneasler`) + `14` sequential PRNG draws exhausting `maxProbes` even with true spreads; after `8` rebuilds failed, `infer.mjs:484` permanently added Turn 3 to `spend.fruitless`, forcing `291` stalled rounds. |
| `gaveup-2711522873.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` traced; `p1@p2` `GAVE UP` `5,034.1s`) | `p1@p2` (sole sweep failure, `5,034.1s`) hit `reconstruct.mjs:2502` `variants` limit from Turn 1 `Sneasler` flinch invisible-choice explosion alongside Channel 2 strict exact-integer HP coupling on `Archaludon` across Turns 3–6. |
