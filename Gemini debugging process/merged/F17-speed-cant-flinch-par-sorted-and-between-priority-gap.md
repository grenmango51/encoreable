# F17: `speed.mjs` Missing Speed Rules on `|cant|...|flinch`/`par` (`sorted()` `ownMove` & `between()` `a.priority === x.priority` Gap)

## 1. Failure Overview & Status

- **Bucket ID**: `F17`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/speed.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/speed.mjs:147-152` (`movePriorities(a)` already queries `battle.getActionSpeed(asked)` on the simulator for every legal move in `moveSlots` plus `struggle`)
  - `scripts/lib/inference/speed.mjs:552-563, 591-615` (`sorted(ex)` requires `ownMove(...)`—an explicit `|move|` line—so `|cant|...|flinch` and `|cant|...|par` return `false` and line 593 skips emitting any speed order for the verified turn)
  - `scripts/lib/inference/speed.mjs:709-718, 724-805` (`chosen()` returns `null` when no `|move|` line printed, setting `unseen = true`; `between(item)` at line 744 requires `a.order === x.order && a.priority === x.priority` against the preceding action `a`, failing whenever `+3 Fake Out` precedes a `0`-priority flinched action and `0`-priority `Q`; and `real` at line 756 requires `realLater` whenever `unseen` is `true`)
- **Total Merged Reports**: **8** (`gaveup`: 8)
  - **View Breakdown**:
    - `both@spectator`: **6** failed in sweep (`2691753503`, `2696601985`, `2698080416`, `2705120655`, `2705861691`) — 5 in sweep + `p2@p1` / `p1@p2` below
    - `p2@p1`: **3** failed in sweep (`2698080416`, `2705120655`, `2707842921`)
    - `p1@p2`: **3** failed in sweep (`2700449781`, `2703801806`, `2705120655`)

---

## 2. Root-Cause Mechanism

When a Pokémon flinches (`|cant|P|flinch`) or is fully paralyzed (`|cant|P|par`), Showdown suppresses `P`'s `|move|` protocol line, hiding which move `P` queued. Because `speed.mjs` relies on seeing `P`'s `|move|` line—and otherwise falls back to an overly strict equality check against the immediately preceding action—it fails to infer `Spe(P) >= Spe(Q)` in **both** the verified-turn path and the cutoff-divergence path:

1. **Verified-Turn Blindness (`sorted(ex)` at `speed.mjs:552-563, 593`)**:
   - In `speedRules()`, `shown.get(ex.action).on` requires `sorted(ex)` to return `true`.
   - For `ex.action?.choice === 'move'`, `sorted(ex)` scans `ex.start .. Math.min(ex.end, upTo)` for `ownMove(view[i].line, rec, id)`—an actual `|move|` line matching `ex.action.move.id`.
   - When `P` prints `|cant|P|flinch` or `|cant|P|par`, `ownMove(...)` is `false`, so `sorted(ex)` returns `false` and `for (const [i, ex] of executed.entries())` (`speed.mjs:593`) executes `if (... || !shown.get(ex.action)?.on) continue;`—discarding the speed bound `P >= Q` even when `P` had no move that could have beaten `Q` via priority (or when an already-executed `+3 Fake Out` already ruled out `+4 Protect`).
   - Because no speed rule is recorded, subsequent rounds' `orderSpeeds()` / `choose()` / `aimFor()` are free to drift `P` below `Q` (or `Q` above `P`) under 66-SP budget pressure, causing a regression back onto the `|cant|` turn (`2696601985`, `2700449781`, `2705861691`).

2. **Cutoff-Divergence Blindness (`chosen()` & `between()` at `speed.mjs:709-759`)**:
   - When a rebuild diverges because `Q` (`got` at `cutoffAt`) acted before `P`'s `|cant|P|flinch` or `|cant|P|par` (`was` at `cutoffAt`):
     - `chosen()` (`speed.mjs:709-718`) scans `observedLine` and `observedAfter` for `|move|` by `was.ident` and returns `null`, setting `unseen = true` (`line 746`).
     - `opened(item, between)` (`lines 724-732`) therefore delegates to `between(item)` (`lines 741-745`):
       ```js
       const before = x ? executed[executed.indexOf(ex) - 1] : null;
       const a = before?.sort && before.sort.turn === S.turn && shown.get(before.action)?.on && !movedAfter(before.action, before.sort)
         ? before.sort.list.find(item => item.action === before.action) : null;
       const between = item => !!a && a.order === x.order && a.priority === x.priority && item.priorities !== null
         && before.sort.list.find(it => it.action === item.action)?.priorities === item.priorities;
       ```
     - **Priority-Bracket Mismatch (`a.priority === x.priority`)**: Whenever `+3 Fake Out` (`a.priority === 3`) immediately precedes `|cant|P|flinch` and `Q`'s `0`-priority move (`x.priority === 0`), **`a.priority === x.priority` (`3 === 0`) is `false`**! `between(item)` returns `false`, `y` and `PO` are `null`, and **zero speed rules are emitted**.
     - **Downstream `real` Check (`speed.mjs:756-757`)**: Even when `a.priority === x.priority`, line 756 sets `real = x && (x.action?.choice !== 'move' || realLater(Q, x.action.move?.id) || (!unseen && y && x.lowest !== null && x.lowest >= y.priority))`. Because `!unseen` is `false`, `Q`'s priority is never checked via `x.lowest` if `Q` failed to print its own `|move|` line later in `observedAfter`.

3. **Why This Cascades into `searches` / `fallbackRebuilds` Exhaustion**:
   - Without a speed rule from `speed.mjs`, `knowledge` stays wide (`unchanged = true`), forcing `infer.mjs` into `fallback()` on an `order = true, disputed.size > 0` turn.
   - Inside `fallback()`, `disputed` pair probes (`infer.mjs:761-786`) either break earlier HP lines under 66-SP `closestSpread` HP sacrifice (`2698080416`) or collide in `done` with single-stat `ends` (`2705120655`), skipping `halving` on `spe`, or `base` (`maxBacktracks: 0`) stops early on an earlier turn (`2696601985`, `2705861691`, `2707842921`) and blacklists the flinch line in `spend.fruitless`.

---

## 3. Single Cohesive Fix Specification

Replace the `a.priority === x.priority` equality check and the `ownMove`-only `sorted()` gate in `scripts/lib/inference/speed.mjs` with **simulator-derived priority-bracket bounding** using `movePriorities` (`battle.getActionSpeed`, already hooked at `speed.mjs:147-152`):

1. **Compute Feasible Priority Bounds for Unseen `|cant|...|flinch`/`par` Actions (`speed.mjs:147-152, 733-760`)**:
   - Note a fundamental invariant of Showdown's `queue.sort` (`order === 200`, `move` actions, when `!tainted.has(turn)` and `!movedAfter`):
     - If an action `a` at the same `order` (`a.order === x.order`) has already executed *before* `P` in the real battle (e.g., `+3 Fake Out` in `before`, or an earlier `shown` action in `executed`), then **`P`'s chosen move cannot have priority strictly higher than `a.priority`** (`p_P <= a.priority`). Otherwise `P` would have executed *before* `a` (for instance, `+4 Protect` always executes before `+3 Fake Out`, so any Pokémon flinched by `+3 Fake Out` provably did not choose `+4 Protect`).
     - If `P` acted *before* `Q` (`priority = x.priority`, same `order = x.order`), then `P` could only beat `Q` without `Spe(P) >= Spe(Q)` if `P` chose a move with priority **strictly higher than `x.priority`** (`x.priority < p_P <= upperPriority`).
   - Using `movePriorities(item.action)` (which asks the simulator's `battle.getActionSpeed` for every legal move in `P.moveSlots` plus `struggle`, e.g., `[0, 4, 0, 0, 0]`), check the subset of `P`'s move priorities that are `<= upperPriority`:
     - Let `upperPriority` be `a.priority` if a verified preceding `same-order` action `a` exists (from `before` at cutoff, or the most recent `shown.get(prev.action)?.on` action of the same `S.turn` and `order` in `executed`), or `Infinity` if none exists.
     - Wait: could `P` have chosen a move with `p_P < x.priority` (e.g., `-6 Roar`)? If `P` acted before `Q` (`x.priority`), `p_P < x.priority` is impossible! And if `P` has **no** legal move with `x.priority < p <= upperPriority` (and at least one move with `p === x.priority`, or `min(p <= upperPriority) === x.priority`), then **`P`'s chosen move is proved to have sorted at priority `x.priority`**!
     - Conversely, if `P` *does* have a legal move in `(x.priority, upperPriority]` (e.g., `+1 Aqua Jet` or `+2 Extreme Speed` after `+3 Fake Out`), emit **nothing**—preserving 100% soundness.
     - Note on `|cant|P|flinch` / `|cant|P|par` before `|move|` in `sorted(ex)` vs `between(item)`: if `ex` at line 591 printed `|cant|P|flinch` or `|cant|P|par` (matching `OPENS_MOVE`) and `before` in `executed` is at `same order`, apply the exact same check against any later `y` in `S.list` with `y.order === x.order` when `P` has no move in `(y.priority, upperPriority]` (and `y` is proved at `>= y.priority`).

2. **Verify `item.priorities` Stability and `Q`'s Priority Without `!unseen` (`speed.mjs:744-757, 771`)**:
   - Keep the existing `before.sort.list.find(it => it.action === item.action)?.priorities === item.priorities` stability check (when `before` is present) so dynamic priority changes (e.g., Prankster/Gale Wings HP thresholds) are never misread.
   - When `P`'s priority is proved to equal `p_P` (here `x.priority`), update `real` at `speed.mjs:756-757` (and line 771) so `x.lowest >= p_P` is accepted even when `unseen` is `true`, ensuring `P >= Q` is still emitted if `Q` never prints its move later in the turn.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmc-2698080416` (`p2@p1`, `both@spectator` — `GAVE UP` on `+3 Fake Out` -> `|cant|p1a: Toxtricity|flinch`)
- **Failing Views**: `p2@p1` and `both@spectator` (`p1@p2` passed). Trace (`both@spectator`, 9 threads): `176.5s` (`993.9s` sweep), `30` rounds, `240` fallback rebuilds, `159,738` probes, `stop = "searches"`.
- **Protocol & Stats**:
  - `p1a: Toxtricity-Low-Key` (`Calm`, base Spe `75` -> `95..127`; moves: `Acid Spray` `0`, `Electroweb` `0`, `Snarl` `0`, `Protect` `+4`).
  - `p2a: Sneasler` (`Jolly`, `Fake Out` `+3`).
  - `p2b: Basculegion` (`Jolly`, base Spe `78` -> `107..143`; planted `spe <= 18` so `Toxtricity >= Basculegion`).
- **Turn 1 Protocol Sequence**:
  - `1.0-1.1`: `|move|p1b: Glimmora|Spiky Shield|p1b: Glimmora` (`+4`)
  - `1.2-1.4`: `|move|p2a: Sneasler|Fake Out|p1a: Toxtricity` (`+3`) -> `|-damage|p1a: Toxtricity|83/100`
  - `1.5` (Stall): **`|cant|p1a: Toxtricity|flinch`** (rebuild printed `|move|p2b: Basculegion|Wave Crash|p1b: Glimmora` at `0` priority)
  - `1.6`: `|move|p2b: Basculegion|Wave Crash|p1b: Glimmora`
- **Exact Failure**: `Toxtricity`'s only non-`0` move is `+4 Protect`, which would have beaten `+3 Fake Out`. At `1.5`, `between()` (`speed.mjs:744`) checked `a.priority === x.priority` (`3 === 0` -> `false`), emitting 0 speed rules. `fallback`'s sole joint `[Toxtricity spe 32, Basculegion spe 0]` probe cut `Toxtricity hp` `32 -> 2` in `closestSpread` (breaking `1.3` `83/100` -> `79/100`), while `[0, 32]` poisoned `done`, exhausting `8/32/128` fallback rebuilds.

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2705120655` (`p2@p1`, `p1@p2`, `both@spectator` — `GAVE UP` on `+3 Fake Out` -> `|cant|p2b: Staraptor|flinch`)
- **Failing Views**: All 3 views (`1,090.7s` sweep). Trace (`both@spectator`, 9 threads): `136.7s`, `24` rounds, `172` fallback rebuilds, `189,446` probes, `stop = "searches"`.
- **Turn 1 Protocol Sequence**:
  - `1.0-1.1`: `p2b: Staraptor` Mega Evolves (`143..178` Spe; moves: `Close Combat` `0`, `Dual Wingbeat` `0`, `Tailwind` `0`, `Protect` `+4`).
  - `1.2-1.3`: `p1a: Incineroar` uses `Fake Out` (`+3`) on `Staraptor-Mega` (`85/100`).
  - `1.4` (Stall): **`|cant|p2b: Staraptor|flinch`** (rebuild printed `|move|p2a: Arbok|Switcheroo|p1b: Farigiraf`, `Choice Scarf` `165..217` Spe, `0` priority).
- **Exact Failure**: `between()` failed `3 === 0` (`speed.mjs:744`), emitting 0 speed rules for `Staraptor-Mega >= Arbok`. In `fallback`, `[Staraptor spe 32, Arbok spe 0]` collided in `done` with single-stat `Arbok spe 0` (since `Staraptor` started at `spe = 32`), skipping `halving` on `Arbok spe` (`ends = [null, 'same']`) and exhausting fallback without probing `Arbok spe` in `[1..15]`.

### Proof 3: `mimic:gen9championsvgc2026regmcbo3-2705861691` & `2696601985` (`both@spectator` — `sorted()` & `between()` Regression on `|cant|...|flinch`)
- In `2705861691` (`560.2s` trace, `1,569.0s` sweep): Turn 3 Trick Room recorded `p1:2 Primarina <= p2:4 Primarina`. Turn 6 `6.2-6.3` had `p2b: Rillaboom` `+3 Fake Out` into `p1b: Primarina` (`Protect +4`, `Calm Mind/Moonblast/Hyper Voice 0`), followed by `6.4` `|cant|p1b: Primarina|flinch` before `p2a: Primarina` `Moonblast` (`0`). Even in Start 2 R8 and Start 5 R10 when Turn 6 **passed**, `sorted()` (`speed.mjs:552-563`) returned `false` on `|cant|p1b: Primarina|flinch`, never emitting `p1:2 >= p2:4`, so `aimFor()` moved `p2:4 spe` (`0 -> 13 -> 19`) and re-broke Turn 6 (`6.4`), where `between()` failed `3 === 0`.
- In `2696601985` (`118.6s` trace, `1,318.1s` sweep): Start 2/5 passed Turn 4 (`+3 Fake Out` -> `|cant|p2b: Charizard|flinch` before `p1a: Raichu-Mega-Y Focus Blast`) in R4–R6, yet `sorted()` emitted no `Charizard (+1) >= Raichu-Mega-Y` bound, so Turn 6 shifted `Charizard spe` `32 -> 2`, regressing back to Turn 4 where `between()` failed `3 === 0` and `infer.mjs:614` aborted `fallback` on `maxBacktracks: 0` `base`.

### Proof 4: `mimic:gen9championsvgc2026regmcbo3-2691753503` (`both@spectator` — `|cant|p2a: Garchomp|par` at Turn 8)
- **Failing View**: `both@spectator` (`p2@p1` passed in `33.3s`, `p1@p2` passed in `34.0s`). Sweep `3,479.8s` / trace `313.8s`, `72` rounds, `96` rebuilds, `294,463` probes, `stop = "searches"`.
- **Turn 8 Stall**: `p1b: Raichu-Mega-Y` uses `Zap Cannon` (`0`), KOing `p2b: Gholdengo`. Next, ground truth prints `|cant|p2a: Garchomp|par` (`Garchomp-Mega-Z`, paralyzed Spe `91`) before `|move|p1a: Incineroar|Parting Shot|p2a: Garchomp` (Incineroar Spe `80`). Candidate guesses put `Incineroar` (`94`) above paralyzed `Garchomp` (`89`), printing `Parting Shot` first (`wanted |cant|p2a: Garchomp|par, got |move|p1a: Incineroar|Parting Shot|p2a: Garchomp`), while `sorted()` / `speedRules` failed to lock the paralysis order and `choose()` dropped exact pins (`guessTries` / Turn 2 `2.6` & Turn 7 `7.4` coupling).

---

## 5. Merged Reports Manifest

| Source Report | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2691753503.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 313.8s trace / 3,479.8s sweep, `searches`) | Turn-8 `|cant|p2a: Garchomp|par` vs `p1a: Incineroar Parting Shot` order inversion (`94 > 89`); `sorted()`/`speed.mjs` blind on `|cant|...|par` and `choose()` dropped exact pins (`2.6`/`7.4`). |
| `gaveup-2696601985.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 118.6s trace / 1,318.1s sweep, `searches`) | Turn-4 `|cant|p2b: Charizard|flinch` vs `p1a: Raichu Focus Blast` after `+3 Fake Out`: `sorted()`/`between()` missed `Charizard (+1) >= Raichu-Mega-Y`, and `infer.mjs:614` aborted `fallback` on `maxBacktracks: 0` `base` (`spend.fruitless`). |
| `gaveup-2698080416.md` | `gaveup` | `p2@p1`, `both@spectator` | `GAVE UP` (`both@spectator`, 176.5s trace / 993.9s sweep, `searches`) | Turn-1 `1.5` (`|cant|p1a: Toxtricity|flinch` vs `Basculegion Wave Crash`) follows `+3 Fake Out`; `between()` failed `3 === 0` (`0` speed rules), and `fallback` joint `[32, 0]` broke `1.3` via `closestSpread` HP sacrifice. |
| `gaveup-2700449781.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` Start 2; `p1@p2` untraced) | Turn-4 `|cant|p2a: Archaludon|flinch` before `p1a: Archaludon Electro Shot`: `speed.mjs` emitted no constraint from `|cant|...|flinch`; `p1a` drifted `spe 2 -> 7` against fixed `p2a` minimum Spe in `p1@p2`. |
| `gaveup-2703801806.md` | `gaveup` | `p1@p2` | `PASS` (`both@spectator` Start 5; `p1@p2` untraced) | Turn-7 `7.8` `Sinistcha` flinch after `Tyranitar Rock Slide` in Trick Room; `speed.mjs` missed flinch constraint while `aimFor` drifted `Tyranitar spe` away from `0` and disputed cast wasted rebuilds on `Gardevoir`. |
| `gaveup-2705120655.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` (`both@spectator`, 136.7s trace / 1,090.7s sweep, `searches`) | Turn-1 `1.4` (`|cant|p2b: Staraptor|flinch` vs `Arbok Switcheroo`) follows `+3 Fake Out`; `between()` failed `3 === 0` (`0` speed rules) and `disputed` `[32, 0]` poisoned `done` on `Arbok spe 0`, skipping `halving`. |
| `gaveup-2705861691.md` | `gaveup` | `both@spectator` | `GAVE UP` (`both@spectator`, 560.2s trace / 1,569.0s sweep, `searches`) | Turn-3 Trick Room locked `p1:2 Primarina <= p2:4 Primarina`, while Turn-6 `6.4` (`|cant|p1b: Primarina|flinch` after `+3 Fake Out` before `p2a: Primarina Moonblast`) went unread by `sorted()`/`between()`, letting `aimFor()` break working ties (`0 -> 13 -> 19`). |
| `gaveup-2707842921.md` | `gaveup` | `p2@p1` | `GAVE UP` (`p2@p1`, `searches`) | Turn-5 `|cant|p1b: Sneasler|flinch` vs `Floette Moonblast` (`141 > 140`) after `+3 Fake Out`; `between()` failed `3 === 0` (`0` speed rules) and Turn-5 `fallback` aborted early on Turn `4.18` Grassy Terrain rounding (`reach(base)[0] < t`). |
