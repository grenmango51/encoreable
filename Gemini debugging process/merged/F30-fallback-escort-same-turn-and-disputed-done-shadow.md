# F30: `fallback()` `escort()` `!(stop.turn < t)` Rejecting Same-Turn Earlier Stops & `disputed`/`done` Shadowing `d.sides`/`halving`

## 1. Failure Overview & Status
- **Bucket ID**: `F30`
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` (`fallback`: `probe`, `escort`, `tryValue`, `disputed` pair block, `halving`, `moved`)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs:673-676, 742-752` — `probe()` (`line 675`) checks `if (!chosen || done.has(signature(chosen))) return null;` and `tryValue()` (`line 747`) checks `if (!got) return null;`, returning before updating `d.sides.set(value, sideOf(got))` or calling `judge(changes, got, d)` (`d.moved` / `d.passed` / `d.best`).
  - `scripts/lib/inference/infer.mjs:726-741` — `escort(moves, got)` (`line 728`) exits immediately whenever `!(stop.turn < t)`, refusing to pair a second Pokémon's Speed when an unescorted Speed perturbation regresses to an earlier index **within the same turn** (`stop.turn === t && stop.index < diff.index`).
  - `scripts/lib/inference/infer.mjs:761-816` — On `order && disputed.size`, `lines 775-778` only probe opposing extremes `[[top(da), db.alive[0]], [da.alive[0], top(db)]]` (omitting same-direction slow/slow `[da.alive[0], db.alive[0]]` pairs), call `probe()` and `judge(changes, got)` without updating single-stat `d.sides`/`d.moved`, and record the resulting spread signature in `done` so `lines 809-816` skip `tryValue(d, end)` and suppress `halving` (`line 813`) and the 2-stat pair loop (`lines 833-845`).
- **Total Merged Reports**: **4** (`gaveup`: 4)
  - **View Breakdown in Sweep**:
    - `both@spectator` only: **4** (`gaveup-2692677083.md`, `gaveup-2695870963.md`, `gaveup-2701703888.md`, `gaveup-2707002065.md`)
  - **Source Shard Clusters**: `S03-C05`, `S10-C08`, `S14-C09`.

---

## 2. Root-Cause Mechanism

Chained same-turn Speed inequalities occur naturally in VGC doubles whenever two Speed-sorted phases happen within a single turn—most prominently:
- **Pre-Mega evolution order** (`detailschange`/`-mega` at `t.0`–`t.3`, sorted by **pre-Mega** Speed) followed by **move/flinch order** (`t.7`–`t.9`, sorted by **post-Mega** Speed), or
- **Three-way Speed chains** (`Spe_A >= Spe_B >= Spe_C`) where `A` or `C` has an invisible flinched choice (`disputed.size > 0`) and two Pokémon start at `spe = 32` (or `spe = 0`).

In this regime, `fallback()` (`infer.mjs:478-914`) fails to discover the joint Speed move due to three interlocking defects in `escort()`, `disputed`, and `done`:

1. **`escort()` Rejects Same-Turn Earlier Stops (`infer.mjs:728`)**:
   - When moving Speed on `A` (or a `disputed` pair) satisfies the later order line `t.k` (`k > 0`) at the cost of inverting an earlier Speed check within the same turn (e.g., `t.0` Mega Evolution order `Froslass` before `Charizard`, or `Raichu` before `Froslass`), `sideOf(got)` (`line 713`) correctly returns `'early'` (`further([t, k], [t, 0])`).
   - `tryValue()` (`line 750`) and the `disputed` block (`line 783`) call `await escort(..., got)` specifically to co-move the other Pokémon named on that earlier stop (`line 729`).
   - However, `escort()` begins with `if (... || !(stop.turn < t) || ...) return;` (`line 728`). Because `stop.turn === t` (`1 === 1`), `!(1 < 1)` is `true`, so **`escort()` aborts immediately** instead of moving the third Pokémon's Speed (`Charizard spe 0` or `Froslass spe 0`).
2. **`disputed` Pair Block Only Pushes Speeds Apart (`infer.mjs:775`)**:
   - Lines `775-778` only probe `[[top(da), db.alive[0]], [da.alive[0], top(db)]]`.
   - When an invisible-choice Pokémon `da` (`Raichu` in `2701703888`) must go *slower* than an unseen third Pokémon (`Sneasler` at `+3` Fake Out) while still staying *at least as fast* as `db` (`Froslass`) at `1.0` earlier in the turn, pushing `da` down (`0`) and `db` up (`32`) breaks `1.0`, whereas **`[da.alive[0], db.alive[0]]` (`[0, 0]`)** resolves both constraints at once.
3. **`disputed`/`done` Shadows Single-Stat `d.sides`, `halving`, and `d.moved` (`infer.mjs:675, 747, 777-816`)**:
   - Suppose `start` already has `db` at `top(db)` (e.g., `spe = 32`, `Charizard` in `2692677083`, `Froslass` in `2701703888`, `Ninetales` in `2695870963`).
   - Then the `disputed` pair `[{ ...da, value: da.alive[0] }, { ...db, value: top(db) }]` produces the **exact same spread vector signature** as the single-stat probe `[{ ...da, value: da.alive[0] }]`!
   - `probe()` (`line 676`) adds that signature to `done`, while `lines 778-779` call `judge(changes, got)` **without passing `da`** (and without populating `da.sides`).
   - Moments later, the single-stat ends loop (`lines 809-816`) calls `tryValue(da, da.alive[0])` (`line 812`). `probe()` hits `done.has(signature(chosen))` (`line 675`) and returns `null`, `tryValue()` returns `null` (`line 747`), so:
     - `da.sides.get(da.alive[0])` stays `undefined` instead of `'early'`, failing `if (!ends.includes('early') || !ends.includes('same')) continue;` (`line 813`) and **completely skipping `halving`** on `da` (`2695870963`, `2701703888`); and
     - `da.moved` stays `false` (for `Charizard spe 0` in `2692677083`, `Espathra spe` in `2707002065`), starving `moved` (`lines 825, 833-845`) so the 2-stat pair loop either executes 0 iterations (`moved.length <= 1`) or excludes that Speed dimension.

---

## 3. Single Cohesive Fix Specification

1. **Allow `escort()` to Handle Same-Turn Earlier-Index Stops (`scripts/lib/inference/infer.mjs:728`)**:
   - Relax the turn check in `escort()` (`line 728`) from `!(stop.turn < t)` to `!(stop.turn < t || (stop.turn === t && stop.index < diff.index))` (matching `further(baseReach, reach(got.b))` used by `sideOf` at `line 713`).
   - Any earlier speed-order regression—whether on an earlier turn (`stop.turn < t`) or an earlier action/Mega-order index within the same turn (`stop.turn === t && stop.index < diff.index`)—can then immediately co-move the blocking Pokémon's Speed.
2. **Include Same-Direction Low-Speed Pair `[da.alive[0], db.alive[0]]` in `disputed` (`scripts/lib/inference/infer.mjs:775`)**:
   - In `order && disputed.size`, add `[da.alive[0], db.alive[0]]` (and/or `[top(da), top(db)]` when appropriate—specifically `[da.alive[0], db.alive[0]]` handles `da <= unseen_third` while preserving `da >= db` earlier in the turn) alongside `[[top(da), db.alive[0]], [da.alive[0], top(db)]]`.
3. **Cache Probe Outcomes in `done` Instead of Returning `null` to Skip `halving` / `d.moved` (`scripts/lib/inference/infer.mjs:672-676, 742-752, 777-780`)**:
   - Change `done` from a `Set<string>` to a `Map<string, object>` caching `{ chosen, b, same, fresh }` per `signature(chosen)` (or handle single-change equivalence when a `disputed` pair leaves one actor at `c.now`).
   - When `tryValue(d, value)` sees a cached entry in `done`, propagate `judge(changes, cached, d)` and `d.sides.set(value, sideOf(cached))` instead of returning `null`—preserving `0`-rebuild deduplication while ensuring `d.sides`, `halving`, `d.moved`, and `d.best` are always populated accurately.
   - **Soundness Guarantee**: `fallback()` only proposes candidate witness spreads inside `knowledge`; `done` caching preserves exact probe outcomes (zero extra rebuilds) without removing any spread from `knowledge`.

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2692677083` (`both@spectator`, `GAVE UP`, 127.9s trace / 732.6s sweep, 205 rebuilds)
- **Ground Truth Exchange (Turn 1 `1.0` & `1.9`)**:
  - `1.0`: `p2a: Froslass` (`Timid`, pre-Mega `143..145`, `spe <= 2`) Mega Evolves **before** `p1b: Charizard` (`Timid`, `Spe <= 145`, `spe <= 12`).
  - `1.9`: `p2b: Arcanine-Hisui` (`Jolly`, `Spe 154..156`, `spe >= 30`) outspeeds `p2a: Froslass-Mega` (`Spe 154..156`) and prints `|cant|p2b: Arcanine|flinch` *before* `p2a: Froslass` uses `Nasty Plot`.
  - Both `default` and `usage` initialize `Charizard spe = 32` (`167`) and `Froslass spe = 32` (`178` / `189`).
- **Failure Trace (`trace_2692677083.log`)**:
  - `disputed` (`1.9`, `{Arcanine, Froslass}`) tested `[Arcanine spe 32, Froslass spe 0]`—which stopped at **`1.0`** (`wanted Froslass-Mega, got Charizard-Mega-Y`, `stop.turn === 1 === t`)—and `[Arcanine spe 32, Charizard spe 0]`.
  - `escort()` (`infer.mjs:728`) aborted on `!(1 < 1)` without pairing `Charizard spe 0` with `Froslass spe 0`.
  - Because `Arcanine` already had `spe = 32` in `default`, `[Arcanine spe 32, Charizard spe 0]` put `Charizard spe 0` in `done` without setting `Charizard spe`'s `d.moved = true`. In Start 6 (`128` cap), `Froslass spe` swept `1..31` (all failing at `1.0` or `1.9`), while `Charizard spe 0` was skipped by `done.has()`, leaving `moved.length === 1` (`[Froslass spe]`), so the 2-stat pair loop (`lines 833-845`) ran `0` iterations (`63/128` rebuilds, `stop = 'searches'`).

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2701703888` (`both@spectator`, `GAVE UP`, 240.8s trace / 1,296.0s sweep, 270 rebuilds)
- **Ground Truth Exchange (Turn 1 `1.0`, `1.4`, `1.7`)**:
  - `1.0`: `p1b: Raichu` (`Hasty`, planted `spe = 20`, pre-Mega `165`) Mega Evolves **before** `p2b: Froslass` (`Timid`, planted `spe = 12`, pre-Mega `156`).
  - `1.4` & `1.7`: `p2a: Sneasler` (`Jolly`, `Spe 189`) uses `+3 Fake Out` on `p1b: Raichu-Mega-Y` (`Spe 187`, `spe <= 22`), which flinches at `1.7` (`|cant|p1b: Raichu|flinch`) before `p1a: Whimsicott`'s `+1 Tailwind` (since `Raichu` also queued `+3 Fake Out`).
  - Both `default` and `usage` start with `Raichu spe = 32` (`200`), `Froslass spe = 32` (`178`), `Sneasler spe = 32` (`189`).
- **Failure Trace (`trace_2701703888.log`)**:
  - `disputed` tested `[Raichu spe 0, Froslass spe 32]` (line 182), stopping at `1.0` (`wanted Raichu-Mega-Y, got Froslass-Mega`), and never tested `[0, 0]`.
  - `escort()` (`infer.mjs:728`) rejected `1.0` (`!(1 < 1)`), never moving `Froslass spe` to `0`.
  - Because `Froslass` was already at `spe = 32`, `done.has(signature)` then skipped `tryValue(Raichu spe, 0)`, returning `null` so `Raichu spe` skipped `halving` (`line 813`) and Start 6 burned all `128/128` rebuilds on `Raichu hp/atk/spa` (`1.6 > 1.0`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2692677083.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 127.9s trace / 732.6s sweep, `stop = searches`) | Turn 1 line `1.9` (`\|cant\|p2b: Arcanine\|flinch` vs `Froslass Nasty Plot`): needs `Froslass spe <= 2` AND `Charizard spe <= 12` (for `1.0` pre-Mega order), but `escort()` aborted on `!(1 < 1)` and `disputed` put `Charizard spe 0` in `done` without setting `d.moved`, leaving `moved.length === 1`. |
| `gaveup-2695870963.md` | `gaveup` | `both@spectator` | `GAVE UP` (182.4s trace / 1,104.2s sweep, `stop = searches`, 26 rounds, 179,578 probes) | All 6 starts stalled at Turn `1.8` (`\|cant\|p1b: Ninetales\|flinch` before `p1a: Raichu Rising Voltage`) because `speed.mjs` `between()` failed across the `+3 Fake Out -> 0` priority gap, `escort()` rejected same-turn `1.0` Mega-order collisions (`stop.turn === t`), and `disputed` polluted `done` to skip `halving` on `p1a: Raichu spe` in `usage` starts. |
| `gaveup-2701703888.md` | `gaveup` | `both@spectator` | `GAVE UP` | Turn 1 line `1.7` (`wanted \|cant\|p1b: Raichu\|flinch`, `got \|move\|p1a: Whimsicott\|Tailwind`): requires `spe_Froslass <= spe_Raichu <= 22`, but `escort()` rejected `1.0` (`stop.turn === 1`), `disputed` omitted `[0, 0]` and shadowed `Raichu spe 0` via `done.has(signature)` so `Raichu spe` skipped `halving`, and Start 6 exhausted all 128 rebuilds on `Raichu hp/atk/spa` (`1.6 > 1.0`). |
| `gaveup-2707002065.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 431.9s trace / 770.4s sweep, `stop = searches`) | Turn 1 line `1.8` (`\|cant\|p1b: Garchomp\|flinch` vs `Whimsicott`/`Espathra`): needs both `Whimsicott spe <= 17` and `Espathra spe <= 29`, but `escort()` ignores `stop.turn === t` and `Espathra spe` never sets `d.moved = true` (and is skipped in `done` by `disputed`), locking it out of the 2-stat pair loop. |
