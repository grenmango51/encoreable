# F06: Illusion Party-Slot Rotation, Retreating-Lead Self-Species Switch-In, `watchParty` `activeMove` Guard, & `disguisableStays` / `spareDisguises` Waste

## 1. Failure Overview & Status

| Field | Value |
|---|---|
| **Bucket ID** | `F06` (`illusion-party-rotation-retreating-lead-watchparty`) |
| **Category** | 2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs |
| **Status on `origin/main`** | **LIVE** (verified on `origin/main` `61378f1`) |
| **Primary Subsystems** | `scripts/lib/reconstruct.mjs`, `scripts/lib/protocol.mjs`, `scripts/lib/inference/infer.mjs` |
| **Source Shard Clusters** | `S03-C02`, `S06-C03`, `S07-C02`, `S08-C02`, `S10-C02`, `S11-C02` |
| **Total Merged Reports** | **7** (`gaveup-2694974808.md`, `gaveup-2695018557.md`, `gaveup-2698337557.md`, `gaveup-2700281215.md`, `gaveup-2700537949.md`, `gaveup-2705589340.md`, `gaveup-2707844739.md`) |
| **View Breakdown** | **Triple-view give-ups across all 7 cases**: `p2@p1`: **7 GAVE UP**, `p1@p2`: **7 GAVE UP**, `both@spectator`: **7 GAVE UP** |

### Verified Live Code Locations

| File | Function / Block | Line Numbers | Defect |
|---|---|---|---|
| `scripts/lib/reconstruct.mjs` | `watchParty` | `240-255` (`248`) | Checks `if (!this.isActive && battle.activeMove ...)`; `Illusion.onBeforeSwitchIn` reads `side.pokemon[i]` during switch phase when `battle.activeMove === null` (and never accesses `.set`), so `run.party` stays `[]` |
| `scripts/lib/reconstruct.mjs` | `choiceFor` (`request.teamPreview`) | `447-483` (`453-482`) | (a) Filters leads out of `last`, failing to place the Illusion user itself at the end when `disguises` names a retreating lead; (b) locks non-lead `last` species strictly at the end (`ends`) and excludes them from `seen`/`back`, yielding `options.length === 1` so mid-battle switch rotations are unreachable |
| `scripts/lib/reconstruct.mjs` | `reconstructOnce` (`carriers`) | `2528-2530` | Only adds Turn 0 (`teamPreview`) to `carriers` when `(run.party || []).includes(t)`, so `variants[0]` is never re-walked on Illusion mismatches |
| `scripts/lib/reconstruct.mjs` | `reconstruct`, `disguisableStays` | `2694, 2705, 2719-2721` | `disguisableStays` calls `illusionStays` on raw `observed` lines (including already-unmasked and post-faint stays) |
| `scripts/lib/protocol.mjs` | `unmaskIllusion`, `illusionStays`, `unsettledStays` | `81-190` | Cannot recognize a self-species switch-in (`\|switch\|pNa: X` while `X` is active in `pNa`) without a `\|replace\|` inside the current observed slice (`cutAt(t)` in `fallback`), causing illegal `switch-to-active` rejections |
| `scripts/lib/inference/infer.mjs` | `inferSpreads` (`readings` loop) | `1142-1159` (`1145-1148`) | Skips `turn > failing` (which misses/misaligns failing-turn self-switches), re-tests already-unmasked/settled stays, and triggers nested `usage` restarts on `readings: false` sub-runs (`1265-1270`) |
| `scripts/lib/inference/infer.mjs` | `spareDisguises` | `1301-1365` | Runs full 4-tier sub-searches on structurally impossible Illusion masks (e.g., missing signature abilities/moves/Mega Stones or active-to-active self-switches) and can unite `blank` if deadline hits |

---

## 2. Root-Cause Mechanism

All 7 triple-view give-ups stem from four tightly coupled defects in how Encoreable models Pokémon Showdown's **`Illusion` party-slot mechanics** (`node_modules/pokemon-showdown/dist/data/abilities.js:2048-2059` and `sim/battle-actions.js:119-149`):

In Showdown:
- `BattleActions.switchIn(pokemon, pos)` (`sim/battle-actions.js:131-134`) **swaps `oldActive` and `pokemon` in `side.pokemon[]` first**, updating `pokemon.position = pos` and `oldActive.position = oldIndex`, **before** firing `runEvent('BeforeSwitchIn', pokemon)` (`line 144`).
- `Illusion.onBeforeSwitchIn(pokemon)` (`data/abilities.js:2050-2058`) then scans `pokemon.side.pokemon` backward from `pokemon.side.pokemon.length - 1` down to `pokemon.position + 1` and copies the first non-fainted teammate.

Because of this exact simulator behavior, **any switch-in** on a side rotates `side.pokemon[]`, creating two structural cases that Encoreable currently breaks, compounded by two search-loop defects:

### Gap 1: `choiceFor(teamPreview)` Assumes Static Turn-0 Tail Placement and Excludes Lead Disguises (`reconstruct.mjs:453-482`)
1. **Mid-Battle Party-Slot Rotation (`2694974808`, `2698337557`, `2700537949`)**:
   - When `Zoroark-Hisui` enters later in the battle disguised as a non-lead teammate `D`, `choiceFor(teamPreview)` puts `D` in `last` (`ends`), strips `D` from `seen` (`!last.includes(at)` at line `461`), and emits `[...front, ...back, ...ends]`.
   - When all 4 brought Pokémon are known (`[Lead1, Lead2, Zoroark, D]`), `options.length === 1` (`variants[0]` has width 1).
   - If any earlier switch moved `D` into an active slot (swapping `Lead1`/`Lead2` into Slot 3/4), then by the time `Zoroark-Hisui` enters, **`D` is no longer in the last slot** — another Pokémon sits in the last slot, and Showdown deterministically disguises `Zoroark-Hisui` as the wrong species on **every** view (`p2@p1`, `p1@p2`, `both@spectator`), because Team Preview order is never echoed in the protocol log.
2. **Retreating-Lead Self-Species Disguise (`2695018557`, `2700281215`, `2705589340`, `2707844739`)**:
   - When a lead `L` switches directly into `Zoroark-Hisui` (in Slot 4, or when `L` swaps into Slot 4), `Illusion` copies the retreating lead `L` itself and prints `|switch|pNa: L|...` while `L` was just in `pNa`.
   - `choiceFor(teamPreview)` (`lines 454-457`) filters out leads: `.filter(name => !state.reveal[sideId].slice(0, leads).includes(name))`. That drops `L` from `last` **without** placing `Zoroark-Hisui` itself into the last slot (`ends`)! So `options[0]` puts `Zoroark-Hisui` in Slot 3 and an unseen teammate (or another bench member) in Slot 4, causing `Zoroark-Hisui` to copy the wrong Pokémon.

### Gap 2: `watchParty()` Ignores `Illusion` Switch-Phase Party Reads (`reconstruct.mjs:240-255, 2528-2530`)
- Even when `choiceFor(teamPreview)` *does* enumerate multiple orders (`options.length > 1`, e.g. `2695018557` with `widths[0] = 2`, `2700281215` with `widths[0] = 6`), `reconstructOnce` (`line 2529`) only adds Turn `0` (`teamPreview`) to `carriers` when `(run.party || []).includes(t)`.
- `watchParty()` (`lines 240-255`) hooks `pokemon.set` and guards with `if (!this.isActive && battle.activeMove && !out.includes(at.k)) out.push(at.k)` (built for `Beat Up`).
- During a switch-in, `battle.activeMove` is **`null`** and `Illusion.onBeforeSwitchIn` reads `side.pokemon[i]` directly rather than `.set`. Thus `run.party` stays `[]`, `carriers` stays `[]`, and `reconstruct` gives up (`stop = 'stuck'`) without ever walking `variants[0] > 0`!

### Gap 3: Self-Species Switch-In Blindness in `unmaskIllusion()` / `disguisableStays()` (`protocol.mjs:81-190`, `infer.mjs:1144-1146`)
- When a retreating active Pokémon `X` switches out into `Zoroark-Hisui` disguised as `X` (`|switch|pNa: X|...` while `X` is already active in `pNa`), and either (a) no `|replace|` occurs in the battle (`2695018557`), (b) `|replace|` occurs on a later turn that is cut off by `fallback`'s `cutAt(t)` (`2705589340`), or (c) `|switch|pNa: X|[from] Parting Shot` occurs on the failing turn itself (`2707844739`):
  - Without unmasking that switch-in, `planSegment()` plans `plan.switches[side][slot] = X` (or `forced` entry `X`), `choiceFor()` finds active `X` at its current active index, and Showdown **rejects** switching an active Pokémon into itself (`turn K: a choice was rejected - nothing advanced`, `diff.index === -1`), or switches to the only remaining bench Pokémon (`Mawile` in `2707844739`).
  - Meanwhile `reconstruct` (`line 2705`) and `infer.mjs` (`line 1146`) filter `if (turn > failing) continue;`, and when an earlier turn fails (`e.g.` a `plain` rebuild stuck earlier or a switch-in on `failing`), readings for later/failing-turn self-switches are missed or mis-scoped.

### Gap 4: Redundant & Structurally Impossible Sub-Searches in `disguisableStays()` / `spareDisguises()` (`reconstruct.mjs:2719-2721`, `infer.mjs:1145-1159, 1301-1365`)
- `disguisableStays()` calls `illusionStays()` on raw `observed` lines *before* `unmaskIllusion()`, causing `infer.mjs` to waste full multi-start sub-searches (plus nested `usage` restarts at `infer.mjs:1265-1270` in `default` / `widest default`) on:
  - Switch-ins **already unmasked** by `unmaskIllusion()` (e.g., `line 72` in `2694974808`, `line 92` in `2698337557`, `line 63` in `2700281215`, `line 80` in `2700537949`);
  - Switch-ins **already settled** by `unsettledStays()` (post-faint replacements `lines 98-99` in `2700537949`, or leads/switch-ins that immediately triggered non-Zoroark abilities/Mega Evolutions/exclusive moves);
  - Impossible `spareDisguises` masks (e.g., assigning two simultaneous stays on the same slot/active Illusion user `[29, 35]` in `2695018557`, or forcing `Zoroark-Hisui` onto a Pokémon that used a signature Mega Stone, Intimidate, Psychic Surge, or unlearned move).

---

## 3. Single Cohesive Fix Specification

All four coupled gaps collapse under one cohesive Illusion-aware architecture across `reconstruct.mjs`, `protocol.mjs`, and `infer.mjs` (adhering strictly to `AGENTS.md`: simulator-verified, 100% sound, mechanism-level):

### Part A — Detect Switch-Phase `Illusion` Reads in `watchParty()` (`scripts/lib/reconstruct.mjs:240-255, 2528-2530`)
1. Hook `Illusion`'s party-back scan (or record `at.k` in `out` whenever an active Illusion user switches in during `playThrough` — e.g., inside `watchParty`, or via a lightweight hook on `battle.runEvent('BeforeSwitchIn', ...)` / `side.pokemon` reads when `pokemon.baseAbility === 'illusion'`, **without** requiring `battle.activeMove` to be non-null).
2. Because `(run.party || []).includes(t)` will now be `true` on any turn `t` where an Illusion user entered (or could enter), `reconstructOnce` (`line 2529`) will automatically include Turn `0` (`teamPreview`) in `carriers` whenever a switch-in disguise mismatches at turn `t`, letting `reconstruct` walk `variants[0]` across alternative initial bench orders.

### Part B — Enumerate Sound Back-Slot Orders in `choiceFor(teamPreview)` (`scripts/lib/reconstruct.mjs:447-483`)
1. **Allow `last` species in `back` when switches occur (or simulate-check / include full `[...known, ...chosen, ...last]` permutations as fallback variants)**:
   - Keep `2e0cf13`'s `[...front, ...back, ...ends]` order **first** (so zero overhead is added to cases without mid-battle party rotation).
   - Whenever `last.length > 0` (a non-lead disguise was observed) **and** the side made switches before the Illusion user entered, append the remaining permutations of `[...known, ...chosen, ...last]` into `options` so initial orders like `[Lead1, Lead2, D, Zoroark]` (where Turn 1–3 switches rotate `D` into Slot 4) are reachable via `variants[0]`.
2. **Place `Zoroark` itself in `ends` (last) when `disguises` names a retreating lead**:
   - If any name in `state.disguises?.[sideId]` is one of the Turn 0 leads (`state.reveal[sideId].slice(0, leads)`), a retreating lead can only be copied if the Illusion user (`Zoroark`) enters from the final slot (or behind only fainted teammates) when that lead switches out.
   - Identify the Illusion user in `bench` (or append permutations placing `known` members, including the Illusion user, at the end of `order`) and prioritize placing the Illusion user at the tail of `options` when a lead appears in `disguises[sideId]`.

### Part C — Structural Self-Species Switch Unmasking (`scripts/lib/protocol.mjs` & `scripts/lib/reconstruct.mjs`)
1. **Active-Slot Self-Species Switch Detection in `unmaskIllusion` (`protocol.mjs:81-108`)**:
   - Track which species is currently active in each slot (`activeBySlot`) as `unmaskIllusion` walks the log.
   - On any `|switch|pNa: X` or `|drag|pNa: X` where `X` is **already active on `side`**, and `sheets[side]` has an Illusion user `Z` (not currently active or fainted), `X` cannot legally switch into `X` in Showdown (`sim/battle-actions.js:77`, `sim/side.ts`): that switch-in **must** be the Illusion user `Z` disguised as `X`!
   - Unmasking it structurally inside `unmaskIllusion` (or via a `structural` flag even when `observed` is truncated to `cutAt(t)` inside `fallback`) eliminates the `switch 1` rejection (`2695018557`, `2705589340`) and the `Parting Shot` `Persian -> Mawile` forced switch (`2707844739`) on the very first pass, without needing Turn 3's `|replace|` to be inside the truncated slice.
   - Note: Only apply this structural unmask when `sheets[side]` has **exactly one** Illusion user `Z` and `X` is already active on `side` (100% simulator-proved: Showdown strictly forbids switching an active Pokémon in, so no non-Illusion reading is legal).

### Part D — Prune Impossible & Redundant Illusion Readings (`scripts/lib/reconstruct.mjs:2719`, `scripts/lib/inference/infer.mjs:1142-1159, 1301-1365`)
1. Filter `disguisableStays()` through `unsettledStays()` (plus allow `turn === failing` when the switch-in itself is at or immediately before the failing divergence, and never re-test stays already unmasked by `unmaskIllusion` or occurring after `|faint|Zoroark`).
2. Before running a forced reading (`readings` loop or `spareDisguises` mask), prune structurally impossible masks using the open team sheet & observed lines:
   - Never assign `Zoroark` to a stay where the Pokémon is already active in another slot on the same turn, or has already fainted, or used a move/Mega Evolution/Ability (e.g., `Intimidate`, `Psychic Surge`, `Grassy Surge`, `Floettite`/`Glalitite`/`Sceptilite`) that `Zoroark`'s sheet does not possess (unless `Transform`/`Mimic`/`Sketch` occurred).
   - Never run nested `usage` restarts inside `readings: false` sub-inferences (`infer.mjs:1265-1273`) when the parent search ladder already runs a top-level `usage` start.
   - **Soundness guarantee**: Pruning only masks that are **mechanically impossible** in Showdown (verified against the sheet's ability/moves/item or active uniqueness) never removes a possibility the replay allows (Rule #2).

---

## 4. Representative Battle Proofs

### Proof A: Mid-Battle Party-Slot Rotation (`mimic:2694974808`, `2698337557`, `2700537949`)
- **Case `mimic:gen9championsvgc2026regmcbo3-2698337557` (`gaveup-2698337557.md`)**:
  - **Views & Work**: `both@spectator`: `GAVE UP` in `1,981.7s` sweep / `870.6s` trace (`426` rounds, `1,001` rebuilds, `158,724` probes, `stop = 'searches'`); `p1@p2` & `p2@p1`: `GAVE UP`.
  - **Ground-Truth Party Order**: `>p2 team 5, 4, 3, 6` = `[0: Floette, 1: Gholdengo, 2: Indeedee, 3: Zoroark]`.
    - Turn 1 (`p2b` Gholdengo $\leftrightarrow$ Indeedee): `[0: Floette, 1: Indeedee, 2: Gholdengo, 3: Zoroark]`
    - Turn 3 (`p2a` Floette-Mega $\leftrightarrow$ Gholdengo): `[0: Gholdengo, 1: Indeedee, 2: Floette-Mega, 3: Zoroark]`
    - Turn 4 (`p2b` Indeedee $\leftrightarrow$ Zoroark): `[0: Gholdengo, 1: Zoroark, 2: Floette-Mega, 3: Indeedee]` $\implies$ Slot 3 is `Indeedee-F`, emitting **`|switch|p2b: Indeedee|Indeedee-F, L50, F|100/100`**.
  - **Reconstruct Defect**: `choiceFor()` saw `disguises.p2 = ['Indeedee']` and forced `>p2 team 5, 4, 6, 3` (`[Floette, Gholdengo, Zoroark, Indeedee]`) with **`options.length === 1`**. After Turn 1 (`1` $\leftrightarrow$ `3`) and Turn 3 (`0` $\leftrightarrow$ `3`), `Floette-Mega` landed in Slot 3, so Turn 4 `4.0` always printed `got |switch|p2b: Floette|Floette-Mega, L50, F|100/100` instead of `wanted |switch|p2b: Indeedee|Indeedee-F, L50, F|100/100`. Meanwhile all 5 `disguisableStays` hypotheses (`lines 29, 30, 37, 76, 92`) failed on missing Mega (`Floettite`), missing `Psychic Surge`, active-Zoroark switch rejection, or already-unmasked line `92`.
- **Case `mimic:gen9championsvgc2026regmcbo3-2694974808` (`gaveup-2694974808.md`)**:
  - Identical `options.length === 1` lock on `p1`: `choiceFor` forced `[Garchomp, Volcarona, Zoroark, Rillaboom]` instead of `[Garchomp, Volcarona, Rillaboom, Zoroark]`. Turn 1's switch (`Garchomp` $\to$ `Rillaboom`) put `Garchomp` into Slot 4, so Turn 3 `3.1` stalled across all 3 views with `wanted |switch|p1a: Rillaboom`, `got |switch|p1a: Garchomp` (`1,137.5s` sweep, `242` rounds, `657` fallback rebuilds, `207,751` probes).
- **Case `mimic:gen9championsvgc2026regmcbo3-2700537949` (`gaveup-2700537949.md`)**:
  - Identical `options.length === 1` lock on `p1`: `choiceFor` forced `[Whimsicott, Glimmora, Zoroark, Mamoswine]` instead of `[Whimsicott, Glimmora, Mamoswine, Zoroark]`. Turn 2 (`Whimsicott` $\to$ `Mamoswine`) and Turn 3 (`Glimmora-Mega` $\to$ `Whimsicott`) rotated `Glimmora-Mega` into Slot 4, so Turn 4 `4.0` stalled across all 3 views with `wanted |switch|p1a: Mamoswine`, `got |switch|p1a: Glimmora` (`1,416.3s` sweep, `298` rounds, `871` total rebuilds, `28,117` probes).

### Proof B: Retreating-Lead Self-Species Disguise + `watchParty` Blindness (`mimic:2695018557`, `2700281215`, `2705589340`, `2707844739`)
- **Case `mimic:gen9championsvgc2026regmcbo3-2695018557` (`gaveup-2695018557.md`)**:
  - **Views & Work**: All 3 views `GAVE UP` (`1,121.3s` sweep / `322.9s` trace, `238` rounds, `704` rebuilds, `378,384` probes, `stop = 'searches'`).
  - **Turn 1.0 Self-Switch**: P2 led `p2a: Charizard` (Pos 1) and `p2b: Annihilape` (Pos 2) with `Zoroark-Hisui` in Pos 4 (`>p2 team 543126`). At Turn 1 (`line 35`), `Charizard` switched out to `Zoroark-Hisui`, swapping `Charizard` into Pos 4 so `Zoroark-Hisui` entered as `|switch|p2a: Charizard|Charizard, L50, M|100/100` (and absorbed `Fake Out` via Ghost immunity `|-immune|p2a: Charizard`), with no `|replace|` ever triggered.
  - **Triple Lockout**:
    1. Plain reading (`forced = []`) left line 35 unmasked $\to$ `choiceFor` emitted `switch 1` (`Charizard` into itself) $\to$ `turn 1: a choice was rejected - nothing advanced`.
    2. `forced = [35]` unmasked line 35 (`disguises.p2 = ['Charizard']`), but `choiceFor(teamPreview)` filtered lead `'Charizard'` out of `last` (`last = []`) without putting `Zoroark-Hisui` in Pos 4, emitting `[Charizard, Annihilape, Zoroark-Hisui, Grimmsnarl]` (`got |switch|p2a: Grimmsnarl`, or `Milotic` in Turn-1-truncated fallback).
    3. Even though `options.length === 2` (`options[1] = [Charizard, Annihilape, Grimmsnarl, Zoroark-Hisui]` solves Turn 1.0 immediately), `watchParty()` (`battle.activeMove === null`) recorded `run.party = []`, so `reconstruct` never walked `variants[0] = 1`! Meanwhile `forced = [29]` burned `maxProbes` on deterministic `Fake Out` Ghost-immunity (`wanted |-immune|p2a: Charizard, got |-damage|p2a: Charizard|82/100`).
- **Case `mimic:gen9championsvgc2026regmcbo3-2700281215` (`gaveup-2700281215.md`)**:
  - At Turn 2 `2.10` (`line 63`), `p1b: Whimsicott` (`Eject Button`) swapped out into `Zoroark-Hisui` (Pos 4), which entered disguised as retreating lead `Whimsicott` (`|switch|p1b: Whimsicott|Whimsicott, L50, F|100/100`) before `|replace|p1b: Zoroark`. Even with `line 63` unmasked (`disguises.p1 = ['Whimsicott']`), `choiceFor` filtered lead `'Whimsicott'` out of `last` and placed unseen `Basculegion` in Pos 4 (`wanted Whimsicott, got Basculegion`), and `watchParty()` missed the switch-phase party read across `widths[0] = 6` (`variants[0]` odd indices all solve it), stalling all 3 views (`1,727.1s` sweep, `142` rounds, `454` rebuilds, `208,260` probes).
- **Case `mimic:gen9championsvgc2026regmcbo3-2705589340` (`gaveup-2705589340.md`)**:
  - Turn 2 switches lead `p1a: Rotom-Heat` into `Zoroark-Hisui` disguised as `Rotom-Heat` (`|switch|p1a: Rotom|Rotom-Heat, L50|100/100`), unmasked at Turn 3 `|replace|p1a: Zoroark`. `choiceFor` filtered lead `'Rotom'` out of `last` and put `Slowbro-Galar` in Pos 4 (`wanted |switch|p1a: Rotom, got |switch|p1a: Slowbro`, 180 occurrences), while Turn-2-truncated `fallback` rebuilds lost Turn 3's `|replace|`, generating `switch 1` (`turn 2: a choice was rejected - nothing advanced`, 134 occurrences), stalling all 3 views (`3,154.0s` sweep, `549` rounds, `702` fallback rebuilds, `299,066` probes).
- **Case `mimic:gen9championsvgc2026regmcbo3-2707844739` (`gaveup-2707844739.md`)**:
  - Turn 3 `Parting Shot` emits `|switch|p2b: Persian|Persian-Alola, L50, F|100/100|[from] Parting Shot` while `Persian` is active in `p2b` (incoming `Zoroark-Hisui` disguised as retreating `Persian`, before any `|replace|` until Turn 7). Plain reading cannot switch `Persian` into `Persian` (`got |switch|p2b: Mawile|Mawile, L50, M|100/100|[from] Parting Shot`), while `disguisableStays()` only tested `lines 29, 30, 82` (skipping Turn 3 due to `turn > failing`), stalling all 3 views (`4,604.0s` / `3,067.1s` / `1,220.8s` sweep, `538,139` probes in `both@spectator`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2694974808.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`1,137.5s` sweep / `370.7s` trace, `stop = 'searches'`) | Turn 3 `3.1` (`wanted \|switch\|p1a: Rillaboom, got \|switch\|p1a: Garchomp`): `choiceFor(teamPreview)` hardcoded non-lead disguised `Rillaboom` into Slot 4 (`options.length === 1`), so Turn 1's switch rotated `Garchomp` into Slot 4; `watchParty` skipped switch-phase Illusion reads and `disguisableStays` wasted searches on settled lines `28, 34` and unmasked line `72`. |
| `gaveup-2695018557.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`1,121.3s` sweep / `322.9s` trace, `stop = 'searches'`, `238` rounds, `704` rebuilds, `378,384` probes) | Turn 1.0 self-species Illusion switch-in (`Zoroark-Hisui` disguised as retreating lead `Charizard` at `line 35`) fails plain reading with rejected `switch 1`; under `forced = [35]`, `choiceFor(teamPreview)` filters lead `'Charizard'` out of `last` leaving `Grimmsnarl`/`Milotic` in Pos 4, and `watchParty`'s `battle.activeMove` guard leaves `run.party = []` so `variants[0] = 1` is never walked. |
| `gaveup-2698337557.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` (`1,981.7s` sweep / `870.6s` trace, `stop = 'searches'`, `426` rounds, `1,001` rebuilds, `158,724` probes) | Turn 4 `4.0` (`wanted \|switch\|p2b: Indeedee, got \|switch\|p2b: Floette-Mega`): `choiceFor(teamPreview)` forced `>p2 team 5, 4, 6, 3` (`Indeedee` in Slot 3, `options.length === 1`), so Turn 1 (`p2b` Gholdengo $\leftrightarrow$ Indeedee) and Turn 3 (`p2a` Floette $\leftrightarrow$ Gholdengo) rotated `Floette-Mega` into Slot 3 before `Zoroark-Hisui` entered at Turn 4. |
| `gaveup-2700281215.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`1,727.1s` sweep / `400.8s` trace, `stop = 'searches'`, `142` rounds, `454` rebuilds, `208,260` probes) | Turn 2 `2.10` (`line 63`) `Whimsicott` Eject-Buttons into `Zoroark-Hisui` disguised as `Whimsicott`; `choiceFor(teamPreview)` drops lead `Whimsicott` from `last` without placing `Zoroark-Hisui` in Pos 4 (leaving unseen `Basculegion` there), and `watchParty()` ignores switch-phase `Illusion` reads so `variants[0]` (`widths[0] = 6`) is never walked. |
| `gaveup-2700537949.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`1,416.3s` sweep / `204.2s` trace, `stop = 'searches'`, `298` rounds, `871` rebuilds, `28,117` probes) | Turn 4 `4.0` (`wanted \|switch\|p1a: Mamoswine, got \|switch\|p1a: Glimmora`): `choiceFor(teamPreview)` forced `[Whimsicott, Glimmora, Zoroark, Mamoswine]` (`options.length === 1`), so Turn 2 and Turn 3 switches rotated `Glimmora-Mega` into Slot 4; `disguisableStays` also wasted ~43% of rounds on unmasked `line 80` and post-faint `lines 98-99`. |
| `gaveup-2705589340.md` | `gaveup` | `both@spectator`, `p1@p2`, `p2@p1` | `GAVE UP` (`3,154.0s` sweep / `479.6s` trace, `stop = 'searches'`, `549` rounds, `702` fb rebuilds, `299,066` probes) | Turn 2 switches lead `p1a: Rotom-Heat` into `Zoroark-Hisui` disguised as `Rotom-Heat` (unmasked only at Turn 3 `\|replace\|`); `choiceFor` filters lead `'Rotom'` out of `last` placing `Slowbro-Galar` in Pos 4 (`got \|switch\|p1a: Slowbro`), while Turn-2-truncated `fallback` rebuilds lose Turn 3's `\|replace\|` and trigger `turn 2: a choice was rejected - nothing advanced`. |
| `gaveup-2707844739.md` | `gaveup` | `both@spectator`, `p1@p2`, `p2@p1` | `GAVE UP` (`4,604.0s` sweep / `475.1s` trace, `stop = 'searches'`, `184` rounds, `596` rebuilds, `538,139` probes) | Turn 3 `Parting Shot` emits `\|switch\|p2b: Persian` while `Persian` is active (`Zoroark-Hisui` disguised as retreating `Persian`), causing Showdown to switch to `Mawile`; `disguisableStays` only checks `lines 29, 30, 82` and skips the Turn 3 self-switch due to `turn > failing`. |
