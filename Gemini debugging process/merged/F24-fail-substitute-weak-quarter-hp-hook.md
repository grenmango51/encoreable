# F24: `evidence.mjs` Missing `|-fail|...|[weak]` Threshold Constraint Hook (`Substitute` Quarter-HP / `Shed Tail` Half-HP)

## 1. Failure Overview & Status

- **ID**: `F24`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs`: `sync()` (`lines 2462–2512`) — parses `hpLine`, `survivor`, and `subOutcome` lines in `view` (and at `prefix.cutoffAt`), with **no handler** for `|-fail|<ident>|move: <Move>|[weak]` threshold-failure lines.
  - `scripts/lib/inference/evidence.mjs`: `fireEdge` / `runEvent('Update', ...)` (`lines 2842–2895`) — existing pattern in `evidence.mjs` that queries the simulator dry via bisection over `(M, h)` to determine the exact HP threshold where an effect fires or fails.
- **Total Merged Reports**: **1** report (`gaveup-2699428192.md`)
- **View Breakdown**:
  - `p1@p2`: **1 / 1 `PASS`** (`5.3s`, `3` rounds, `382` probes)
  - `p2@p1`: **1 / 1 `PASS`** (`26.7s`, `8` rounds, `3,684` probes)
  - `both@spectator`: **1 / 1 `GAVE UP`** (`398.7s` trace / `3,070.2s` sweep, `58` rounds, `298` rebuilds, `322,391` probes)

---

## 2. Root-Cause Mechanism

In Pokémon Showdown (`node_modules/pokemon-showdown/data/moves.ts`), moves with an HP-threshold precondition reject execution in `onTryHit(source)` by emitting a `[weak]` failure token:
- `Substitute` (`moves.ts:18319–18322`):
  ```ts
  if (source.hp <= source.maxhp / 4 || source.maxhp === 1) {
    this.add('-fail', source, 'move: Substitute', '[weak]');
    return this.NOT_FAIL;
  }
  ```
- `Shed Tail` (`moves.ts:16180–16183`):
  ```ts
  if (source.hp <= source.maxhp / 2 || source.maxhp === 1) {
    this.add('-fail', source, 'move: Shed Tail', '[weak]');
    return this.NOT_FAIL;
  }
  ```

When a Pokémon shown as a percentage (`both@spectator`, Channel 0) displays `25/100` (`Math.floor(100 * hp / maxhp) = 25`), any `(M, h)` satisfying `0.25 <= h / M < 0.26` lies in the percentage interval — e.g., `49/193`, `50/197`, `51/201`, etc., which all have `h > M / 4`. If the Pokémon then fails `Substitute` with `|-fail|<ident>|move: Substitute|[weak]`, the conjunction forces `h / M >= 0.25` **and** `h <= M / 4`, uniquely forcing `h === M / 4` (`M % 4 === 0`).

Because `evidence.mjs:2462–2512` (`sync()`) does not inspect `|-fail|...|[weak]` lines:
1. Even after `|-fail|p2a: Garchomp|move: Substitute|[weak]` appears in the observed replay (either inside the verified prefix or at `prefix.cutoffAt` where the scaffold instead succeeded with `|-start|p2a: Garchomp|Substitute`), `evidence.mjs` applies **zero** HP constraint on `Garchomp`.
2. Candidate spreads with `hp > Math.floor(maxhp / 4)` (and `maxhp % 4 !== 0`) survive untouched in `Garchomp`'s `chain`.
3. `choose()` / `aimFor()` repeatedly sample guesses where `Kingambit`'s prior `Kowtow Cleave` leaves `Garchomp` at `25/100` with `hp > maxhp / 4`, causing the simulator on Turn 6 to succeed in creating a `Substitute` instead of failing `[weak]`.
4. Single-stat `fallback` (`8/32/128` rebuilds) fails because satisfying both Turn 4 `25/100` and Turn 6 `hp <= maxhp / 4` requires aligning **three coupled variables simultaneously** (`Kingambit Atk`, `Garchomp Def`, `Garchomp HP` divisible by `4`).

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1–#3 (*Simulator is the only source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move*):

**Do NOT hardcode `Substitute` $\to$ `hp <= M / 4` or `Shed Tail` $\to$ `hp <= M / 2`.** Instead, query the simulator's own `TryHit` handler dry, mirroring `fireEdge` / `itemFires` (`evidence.mjs:2842–2895`):

1. **Hook `TryHit` on Move Execution + `|-fail|...|[weak]` in `sync()` (`evidence.mjs`)**:
   - In `battle.singleEvent` (or `actions.hitStepTryImmunity` / `singleEvent('TryHit', ...)`), when `!state.dry && !state.ended` and `eventid === 'TryHit'` for a move with `typeof effect.onTryHit === 'function'` targeting a tracked unknown Pokémon `rec` (`!rec.exact`, `target === source` or `byPokemon.has(target)`):
     - Record the active `TryHit` context (`{ rec, move: effect, logAt: battle.log.length, failedWeak: null }`) during the real call, checking whether the real `singleEvent('TryHit', ...)` emitted `|-fail|...|...|[weak]`.
   - At `sync()` (both for verified lines `< prefix.cutoffAt` and at `entry.at === prefix.cutoffAt` when the scaffold diverges between `|-fail|<ident>|move: <Move>|[weak]` and succeeding with `|-start|`/`|-damage|`):
     - Let `weakFail(line)` match `/^\|-fail\|(p[1-4][a-d]: [^|]+)\|move: ([^|]+)\|\[weak\]$/`.
     - Resolve `rec = recOf(...)` and the move (`battle.dex.moves.get(moveName)` or the `TryHit` frame's `move`), flush `rec.pending` (`apply(rec, change, null)`), and ask the simulator dry whether `TryHit` produces `[weak]` at `(M, h)`:
       ```js
       const failsWeak = (rec, move, M, h) => guarded(() => {
         const undo = patchAll([{ pokemon: rec.pokemon, maxhp: M, hp: h }]);
         const from = battle.log.length;
         try {
           battle.singleEvent('TryHit', move, null, rec.pokemon, rec.pokemon, move);
           return battle.log.slice(from).some(l => /\|-fail\|.*\|\[weak\]$/.test(l));
         } finally {
           undo();
         }
       });
       ```
     - Because the threshold condition is monotone in `h` (true for `1..edge`, false for `edge+1..M` — verified via `memo('weak|...')` just like `fireEdge` at `lines 2853–2860`), `edge(M)` can be found in $O(\log M)$ simulator calls per distinct `M` (at most 33 `M` values $\times$ 8 probes)! (Also check `failsWeak(rec, move, rec.pokemon.maxhp, rec.pokemon.hp) === realFailedWeak` as a simulator self-consistency guard before applying, per `AGENTS.md` soundness rules!)
     - Apply a `{ same: true, gate: true, turn: battle.turn, what: ..., allow: (M, h) => wantWeak ? h <= edge.get(M) : h > edge.get(M) }` gate onto `rec`!
2. **Propagation via `wholePaths()` & `paths()` (`evidence.mjs`)**:
   - Because the gate is stored as a `same: true` entry in `rec.history` with `allow(M, h)`, `backward()` (`line 3830`) and `paths()` (`line 3964`) automatically enforce `h <= edge(M)` back through all earlier damage hits (`Kingambit Kowtow Cleave` in Turn 4 of `2699428192`), jointly pruning incompatible `(Garchomp HP, Garchomp Def, Kingambit Atk)` combinations in `settle()` and ensuring `Garchomp` `maxhp % 4 === 0` (`48/192`) is satisfied before `reconstruct` ever reaches Turn 6!

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2699428192` (`both@spectator`, Turn 6.1 `|-fail|p2a: Garchomp|move: Substitute|[weak]`)
- **Planted Stats**:
  - `p1:3 Kingambit` (`Adamant`, `{ hp: 24, atk: 32, def: 0, spa: 0, spd: 0, spe: 10 }`, `Atk = 205`, `+1` Defiant = `307`).
  - `p2:1 Garchomp` (`Timid`, `{ hp: 9, atk: 0, def: 0, spa: 32, spd: 0, spe: 25 }`, `HP = 108 + 9 + 75 = 192`, Mega-Z `Def = 85 + 0 + 20 = 105`).
- **Protocol & Failure Trace**:
  - Turn 4: `p2a: Garchomp` enters and Mega Evolves into `Garchomp-Mega-Z` (`192/192`). `+1` `p1b: Kingambit` hits `Garchomp` with `Kowtow Cleave` (`85` BP) for exact `144` damage (`192 - 144 = 48/192`), displaying `|-damage|p2a: Garchomp|25/100`.
  - Turn 5: `p2a: Garchomp` uses `Protect`.
  - Turn 6 (`6.1`): `p2a: Garchomp` attempts `Substitute`. Since `48 <= 192 / 4 = 48`, Showdown outputs:
    - **Observed (`6.1`)**: `|-fail|p2a: Garchomp|move: Substitute|[weak]`
    - **Rebuilt (`6.1`)**: `|-start|p2a: Garchomp|Substitute` followed by `|-damage|p2a: Garchomp|75/100` (from `p2a: Garchomp` having `hp > maxhp / 4`).
  - Without a `[weak]` hook in `evidence.mjs`, `evidencePass` leaves `Kingambit` (`127,309,632` spreads) and `Garchomp` (`113,683,704` spreads) unconstrained by Turn 6.1, and 1D `fallback` exhausts `8/32/128` rebuilds (`322,391` probes across `58` rounds, `stop = 'searches'`).
  - With the `[weak]` `TryHit` gate active at `6.1`, `evidence.mjs` pins `Garchomp` at `h === M / 4` (`M % 4 === 0`) and propagates that exact constraint backward through Turn 4 `Kowtow Cleave`, immediately pruning `(Kingambit Atk, Garchomp Def, Garchomp HP)` guesses that leave `hp > M / 4`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2699428192.md` | `gaveup` | `both@spectator` | `GAVE UP` (398.7s dedicated / 3,070.2s sweep, `stop=searches`, 58 rounds, 298 rebuilds, 322,391 probes) | Turn 6.1 `|-fail|p2a: Garchomp|move: Substitute|[weak]` after Turn 4 `25/100` requires `Garchomp maxHP % 4 === 0` and exact `75%` damage from `Kingambit`; without a `|-fail|` hook in `evidence.mjs`, guesses executed `Substitute` and 1D `fallback` exhausted `8/32/128` rebuilds. |
