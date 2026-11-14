# F22: Beat Up `hit.back` $\to$ `band('down')` Blindness, `paths()` Over-Certifying Unreachable Exact HP, & `fallback` `cutAt(t)` Hiding Reserve Order

## 1. Failure Overview & Status

- **ID**: `F22`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` / `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs`: `analyseHit` (`lines 891–900, 966, 972`) — watches non-active party members' `.set` descriptors (`back.add(p)`) and sets `hit.supported = false`, `hit.back = true`.
  - `scripts/lib/inference/evidence.mjs`: `onChange` (`lines 1981–1983`) — downgrades unsupported hits (`!hit.supported`) to `band('down', ...)`.
  - `scripts/lib/inference/evidence.mjs`: `paths` (`lines 3965–3968, 4030–4037, 4055–4059`) & `exactTurns` (`lines 308–316`) — certifies exact HP numerators/denominators across `band('down')` transitions whenever `h2 === own` or at the cutoff line without verifying simulator reachability.
  - `scripts/lib/inference/infer.mjs`: `fallback` (`lines 487–491, 604–609`) & `markOf` (`line 426`, `spend.fruitless` at `line 484`) — truncates `observed` with `cutAt(t)`, hiding later-entering reserve members from `revealOrder` (`scripts/lib/reconstruct.mjs:279–289, 2301`), causing `base` to pass silently (`line 609`) and double-spend fallback budgets across percentage vs. exact-HP `markOf(diff)` keys.
- **Total Merged Reports**: **3** reports (`gaveup-2692536889.md`, `gaveup-2706178392.md`, `gaveup-2711078003.md`)
- **View Breakdown**:
  - `p2@p1`: **3 / 3 `PASS`**
  - `p1@p2`: **3 / 3 `PASS`**
  - `both@spectator`: **3 / 3 `GAVE UP`** (all 3 stalled exclusively on Channel 0 when both sides' Stat Points and back-party compositions were simultaneously unknown)

---

## 2. Root-Cause Mechanism

In Pokémon Showdown (`node_modules/pokemon-showdown/data/moves.ts:1150–1172`), `Beat Up` populates `move.allies` in `onModifyMove` (`pokemon.side.pokemon.filter(ally => ally === pokemon || !ally.fainted && !ally.status)`) and computes each hit's Base Power in `basePowerCallback`:

```ts
const setSpecies = this.dex.species.get(move.allies!.shift()!.set.species);
const bp = 5 + Math.floor(setSpecies.baseStats.atk / 10);
```

Notice two critical mechanical facts about this simulator path:
1. `basePowerCallback` reads **only `set.species` $\to$ `baseStats.atk`** (an Open Team Sheet constant per species, **independent of Stat Points**); it never reads any hidden Stat Points of the back-party Pokémon.
2. What varies across unknown party orders is **which** eligible unrevealed members of `pokemon.side.pokemon` sit in the back slots.

Currently, `evidence.mjs` handles back-party reads as a binary blackout, which triggers a three-stage cascade:

1. **Stage 1 — `analyseHit` (`evidence.mjs:894–900, 966, 972`) Discards All Back-Party Hits to `band('down')`**:
   During `dryRow`, `analyseHit` defines a getter on `p.set` for every `!p.isActive` Pokémon in `battle.sides`. When `Beat Up` accesses an inactive ally's `.set`, `back.add(p)` fires, forcing `supported: supported && !carried && !back.size` (`line 966`) to `false`. `onChange` (`line 1983`) then emits `band('down', ...)` instead of `moveChange(...)`. As a result, `evidence.mjs` neither eliminates impossible `(Attacker Atk, Defender Def, Defender HP)` spreads nor checks whether **any** back-party species could have produced the observed damage.

2. **Stage 2 — `paths()` (`evidence.mjs:3965–3968, 4030–4037, 4059`) Over-Certifies Unreachable Exact HP Across `band('down')`**:
   In `paths(raw)`:
   - For `e.change.band`, `options` contains every HP value `x` in `later` within `[0, h]` that fits the percentage interval (`line 3968`).
   - `paths()` writes `tokens.set(..., h2/M)` for every non-`ahead` shown line (`line 4059`), including cutoff lines (`exactTurns` lines 308–310), and only sets `cutAt` if `h2 !== own || carriedOff` (`line 4037`).
   - Consequently, `evidencePass({ exact: true })` hands `reconstruct` impossible exact-HP targets that `band('down')` never checked against the simulator's damage ladder — e.g.:
     - `107/174` (odd HP) on Turn 2.9 in `2706178392` when `2×` Super-Effective `Beat Up` only deals **even** damage from even `142/174`;
     - `130/145` on Turn 1.12 in `2711078003` when minimum 3-hit damage is `16 > 145 - 130 = 15`;
     - `77/182` / `81/191` on Turn 3 in `2692536889` when `Milotic` takes at least `9` damage from Hit 2 (`84 - 9 = 75/182`, `88 - 9 = 79/191`).

3. **Stage 3 — `fallback` `cutAt(t)` Hides Reserve Members & Cycles `markOf` (`infer.mjs:426, 487–491, 609`)**:
   - In `2692536889`, when `fallback` slices `observed` at `through = cutAt(t)` (`infer.mjs:487–491`), any brought Pokémon that first enters on turn `t + 1` or later (Turn 4 `Annihilape`, Base Atk `115` $\to$ BP `16`) is omitted from `revealOrder(unmasked.lines)` (`reconstruct.mjs:279–289`). `reconstruct(cutAt(3))` therefore fills the 4th slot with the first benched sheet member (`Indeedee-F`, Base Atk `55` $\to$ BP `10`), causing `fallback`'s `base` rebuild (`infer.mjs:609`) to **falsely pass** Turn 3 silently (`stays(handed, 0)`), wiping `exact = null`, resetting `level = 0`, and never perturbing a single stat.
   - In `2706178392` and `2711078003`, because `markOf(diff)` embeds `diff.expected` (`infer.mjs:426`), `spend.fruitless` keyed on `61/100` missed the exact-HP rewrite `107/174` at the exact same `(turn, index)`, running the full `8/32/128`-rebuild fallback twice per start (`480` fallback rebuilds in `2706178392`).

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1–#3 (*Simulator is the only source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move*):

1. **Evaluate Back-Party `.set` Reads Over the Union of Eligible Unrevealed Sheet Members (`evidence.mjs:894–900, 966, 1025`)**:
   - Instead of rejecting any hit with `back.size > 0` to `band('down')`:
     - Identify which non-active party slots `back` read (`[...back]`). Notice `onModifyMove` already populated any move state in the real run, while during `dryRow` a non-active `p` in `back` only represents **one** of the unrevealed eligible members of `p.side.pokemon` (any member not yet revealed in the log up to `battle.log.length`, or any fainted/status-eligible member matching the side's team preview constraints).
     - Wait: `p.isActive` Pokémon are already known on the field; only unrevealed slots in the back of `p.side.pokemon` have unknown species identity. Inside `guarded(...)`, for each back-slot Pokémon `p ∈ back` that has not yet been revealed by the observed log up to this point, enumerate every candidate unrevealed sheet member `q` in `p.side.pokemon` (up to the team's unrevealed pool). Temporarily swap `p.set` (or `back`'s slot species/set) with `q.set` while running `dryRow`, and **take the union of the resulting damage rolls across all eligible assignments** (expanding `hit.rows` / `sStates` or storing all unioned roll sets per `(a, d)` without removing any spread valid under *any* valid back-party assignment).
     - If `back` has too many unrevealed slots/permutations (exceeding a bounded combination cap) or a non-`set.species` dependency moves across candidates, fall back safely to `band('down')` — preserving soundness 100%.

2. **Never Certify Unchecked `band()` HP Values as Exact (`evidence.mjs:4030–4037, 4055–4060`)**:
   - In `paths(raw)`, an unhooked `band('up' | 'down' | 'any')` transition does **not** prove the exact HP integer even when `h2 === own` (`evidence.mjs:4037`), because `own` was only one guess inside a percentage bucket (`[84, 85]/182`, `[107]/174`, `[130]/145`).
   - Whenever `e.change.band` executes on a shown line (`own !== null`), set `cutAt = Math.min(cutAt, secretAt.get(...) ?? Infinity)` (regardless of whether `h2 === own` or `h2 !== own`) and **omit** `tokens.set(...)` for cutoff lines produced by an unproved `band()` (`line 308` / `4059`), so `exactTurns` never hands `reconstruct` an unproved exact numerator/denominator past or on a `band()` transition.

3. **Preserve Full-Log `revealOrder` in `fallback` & Normalize `spend.fruitless` (`infer.mjs:426, 487–491, 609`)**:
   - Pass full-log `reveal` (`revealOrder` from full `observed`, or pin the revealed `teamPreview` slots from `built.choices`) into `fallback`'s `reconstruct(cutAt(t))` so truncating `observed` at turn `t + 1` never swaps a later-entering brought Pokémon (`Annihilape`) for an unseen benched one (`Indeedee-F`), preventing spurious `stays(handed, 0)` passes at `infer.mjs:609`.
   - Normalize `markOf` for `spend.fruitless` / `searched` by stripping exact-HP numerators/denominators (or keying by canonical percentage / `(turn, index)`), and do not reset `level` below the current `level` when `stays(handed, ...)` leaves `picks` unchanged.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2692536889` (`both@spectator`, Turn 3 `Beat Up` + `cutAt(3)` Hidden `Annihilape`)
- **Teams & Planted Stats**:
  - `p1:1 Whimsicott` (`Timid`, `{ hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }`, Base Atk `67` $\to$ `Beat Up` BP `11`, Atk `78`).
  - `p1:2 Annihilape` (`Jolly`, `{ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }`, Base Atk `115` $\to$ `Beat Up` BP `16`; entered Turn 4+, unseen through Turn 3).
  - `p1:0 Indeedee-F` (`Bold`, Base Atk `55` $\to$ `Beat Up` BP `10`; benched).
  - `p2:4 Milotic` (`Calm`, `{ hp: 32, atk: 0, def: 2, spa: 0, spd: 32, spe: 0 }`, `HP 202`, `Def 101`).
- **Protocol & Failure Trace**:
  - Turn 3: `p1a: Whimsicott` uses `Beat Up` on `p2a: Milotic` (`46/100` $\to$ `42/100` after Hit 2).
  - `evidence.mjs:898, 972` sets `hit.back = true`, `hit.supported = false`, downgrading Turn 3 `Beat Up` to `band('down')`.
  - `Start 1` (`default`) moves `Milotic` to `MaxHP = 182` (`hp = 12`, low `Def`); `Start 2` (`usage`) moves `Milotic` to `MaxHP = 191` (`hp = 21`). `paths()` certifies unreachable `77/182` and `81/191` (`4` / `6 turns exact`).
  - On Turn 3 (`77/182` vs `75/182`, `81/191` vs `79/191`), `reconstruct` overshoots by 2 HP (min Hit 2 damage is `9`).
  - `fallback` slices `observed` with `cutAt(3)` (`infer.mjs:487`), hiding Turn-4 `Annihilape` (`BP 16`) so `reconstruct(cutAt(3))` slots `Indeedee-F` (`BP 10`) in P1's 4th slot. `base` (`exact: null`) immediately passes Turn 3 (`line 609`), silently returning `stays(handed, 0)` without probing a single stat, cycling `80` rounds (`239,324` probes) to `stop = 'searches'`.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2706178392` (`both@spectator`, Turn 2.9 `Beat Up` Even-Damage Parity Trap)
- **Protocol & Failure Trace**:
  - Turn 1: `p1a: Primarina` (`SpA 161` planted, guessed `SpA = 32` `195`) hits `p2b: Indeedee-F` (`HP 177, Def 128, SpD 127`) with `Hyper Voice` (`81/100`), pushing `Indeedee-F` to `29/0/26/0/11/0` (`MaxHP = 174`, even HP `142/174`).
  - Turn 2 (`2.2–2.9`): `p1b: Whimsicott` uses 3-hit Dark-type `Beat Up` on Psychic-type `p2b: Indeedee-F` (`2.0×` Super Effective $\implies$ strictly **even** damage rolls `{8, 10, 12, 14}` / `{16, 18, 20}` crit).
  - Line `2.9` shows `|-damage|p2b: Indeedee|61/100`. On `MaxHP = 174`, `floor(100 * h / 174) = 61` holds **only for odd `h = 107`**, which is mathematically unreachable from even `142` under even-only `Beat Up` rolls (`126 - [16, 18, 20] = 110, 108, 106`).
  - Because Hit 3 (`Lucario`, `BP 16`) hit `hit.back = true`, `evidence.mjs` downgraded Hit 3 to `band('down')` and `paths()` wrote `107/174` into `exact` (`got 110/174`), while `markOf` missed `spend.fruitless` across `61/100` vs `107/174`, burning `480` fallback rebuilds (`113,863` probes) across 6 starts.

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2711078003` (`both@spectator`, Turn 1.12–1.16 4-Hit `Beat Up`)
- **Protocol & Failure Trace**:
  - Turn 1 (`1.2–1.16`): `p2b: Weavile` (`Atk 172`, `-1` Intimidate `114`) uses 4-hit `Beat Up` on ally `p2a: Lucario` (`HP 147, Def 90`): `95/100` (`1.4`) $\to$ `91/100` (`1.8`) $\to$ `89/100` (`1.12`) $\to$ `84/100` (`1.16`, `124/147`).
  - `evidence.mjs` reads Hits 1–2 (`active`) but drops Hits 3–4 (`Primarina` `BP 12`, `Rillaboom` `BP 17`, `back.size > 0`) to `band('down')`.
  - In `usage` starts (Starts 2 & 5), 66-SP shedding drops `Lucario` to `0/32/0/0/2/32` (`MaxHP = 145`), and `paths()` certifies unreachable `130/145` at `1.12` (min 3-hit damage is `16`, leaving `<= 129/145`, `got 128/145`). In `default`/`wide` starts, `evidence` fails to narrow `(Lucario def=10, Weavile atk=0)`, stalling at `1.16` (`124/147` vs `127/147`, `376,821` probes).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2692536889.md` | `gaveup` | `both@spectator` | `GAVE UP` (148.9s trace / 794.5s sweep, `stop=searches`, 80 rounds, 124 rebuilds, 239,324 probes) | `evidence.mjs` downgraded Turn 3 `Beat Up` to `band('down')`, moving `Milotic` to unreachable `182`/`191` HP; then `fallback`'s `cutAt(3)` hid Turn-4 `Annihilape` (`BP 16`) and substituted `Indeedee-F` (`BP 10`), causing `base` to pass silently at `infer.mjs:609` and reset `level=0, exact=null` without probing any stats. |
| `gaveup-2706178392.md` | `gaveup` | `both@spectator` | `GAVE UP` (181.3s trace / 481.0s sweep, `stop=searches`, 46 rounds, 526 rebuilds, 113,863 probes) | Turn 2 line `2.9` (`wanted 61/100` $\to$ `107/174`, `got 63/100` $\to$ `110/174`): `choose()` pinned `Primarina spa = 32` and pushed `Indeedee` onto `29/0/26/0/11/0` (`MaxHP = 174`, even HP `142` after T1), making odd `107/174` unreachable by even-damage `2x` `Beat Up`, while `paths()` still wrote `107/174` via `band('down')` (`hit.back = true`) and `markOf` missed `spend.fruitless`, doubling fallback to 480 rebuilds. |
| `gaveup-2711078003.md` | `gaveup` | `both@spectator` | `GAVE UP` (504.1s trace / 1,282.6s sweep, `stop=searches`, 34 rounds, ~550 rebuilds, 376,821 probes) | `evidence.mjs` marked Turn 1 `Beat Up` Hits 3–4 as `band('down')`, handing unreachable `130/145` in `usage` starts (`Lucario 0/32/0/0/2/32` after 66-SP shedding) and failing to narrow `(Lucario def=10, Weavile atk=0)` in `default`/`wide` starts (`1.16` `84/100`). |
