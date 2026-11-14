# F05: `choiceFor(teamPreview)` Multi-Disguise Ordering Putting Later Illusion Disguise Last at Turn 0

## 1. Failure Overview & Status

| Field | Value |
|---|---|
| **Bucket ID** | `F05` (`illusion-multidisguise-end-slot-order`) |
| **Category** | 2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs |
| **Status on `origin/main`** | **FIXED** (landed in commit `2e0cf13`, merged into `origin/main` at `61378f1`) |
| **Primary Subsystem** | `scripts/lib/reconstruct.mjs` (`choiceFor` `request.teamPreview`) |
| **Secondary Subsystem** | `scripts/local-score.mjs` (`SEARCH_LIMITS` classification of `stop = 'searches'`) |
| **Source Shard Clusters** | `S12-C01` |
| **Total Merged Reports** | **1** (`nomatch-2694981022.md`) |
| **View Breakdown** | `p2@p1`: **1 NO MATCH**, `both@spectator`: **1 NO MATCH**, `p1@p2`: **1 NO MATCH** |

### Verified Live Code Locations

| File | Function / Symbol | Line Numbers | Status / Role |
|---|---|---|---|
| `scripts/lib/reconstruct.mjs` | `choiceFor` (`request.teamPreview`) | `447-483` (`449-478`) | **Fixed in `2e0cf13`**: added `lastOrders = permutations(last.slice().reverse())` and enumerated `{ back, chosen, ends }` variants |
| `scripts/lib/protocol.mjs` | `unmaskIllusion` | `81-108` (`95-96`) | Collects `disguises[side]` in chronological order of `|replace|` appearance (`['Volcarona', 'Garchomp']`) |
| `scripts/lib/inference/infer.mjs` | `fallback` | `478-482` | Skips `t === 0` (`if (!diff || !(t >= 1) || ...) return null;`), escalating Turn 0 failures directly through `budgets[0..3]` |
| `scripts/local-score.mjs` | `SEARCH_LIMITS` | `93-95` | **Unchanged secondary behavior**: omits `'searches'`, so a pure Turn 0 `stop = 'searches'` reports `'NO MATCH'` rather than `'GAVE UP'` |

---

## 2. Root-Cause Mechanism

1. **Illusion Disguise Selection in Showdown (`data/abilities.js:2048-2059`):**
   - `Illusion.onBeforeSwitchIn` scans `pokemon.side.pokemon` **backward** from the last party slot (`pokemon.side.pokemon.length - 1`) down to `pokemon.position + 1` and disguises the Illusion user as the **last non-fainted teammate** in the party.
   - When an Illusion user enters **twice** under two different non-lead disguises — e.g., at Turn 0 disguised as `D1` (Slot 4) and later at Turn 6 after `D1` has fainted disguised as `D2` (Slot 3) — `D1` started in the **very last** slot (Slot 4) and `D2` started **before** `D1` (Slot 3).

2. **Why `unmaskIllusion` + Pre-`2e0cf13` `choiceFor(teamPreview)` Inverted the Party Tail:**
   - `unmaskIllusion()` (`scripts/lib/protocol.mjs:81-108`) scans the protocol log forward and pushes each newly discovered disguise name onto `disguises[side]` in **chronological order**: `[D1, D2]` (earliest disguise first, latest disguise last).
   - Prior to commit `2e0cf13`, `choiceFor(side, plan, state, notes)` (`scripts/lib/reconstruct.mjs:447-483`) built the Team Preview `last` array directly from `state.disguises[sideId]` in forward order and appended `...last` verbatim at the tail of `order = [...front, ...back, ...last]` with only **one** ordering of `last`:
     - Slot 3 received `D2` (the Turn 6 disguise), and Slot 4 (the final slot) received `D1`? No — forward order `[D1, D2]` put `D1` in Slot 3 and **`D2` (Turn 6's disguise) in Slot 4**!
   - Consequently, at **Turn 0** (`|switch|` of the leads), Showdown read Slot 4 (`D2`) instead of `D1`, immediately emitting `|switch|p2a: D2` instead of `|switch|p2a: D1` (`Turn 0` divergence).

3. **Why Every View Terminated as `NO MATCH`:**
   - Team Preview choices are reconstructed from the protocol log in all three views (`p2@p1`, `p1@p2`, `both@spectator`).
   - Because `fallback` (`infer.mjs:482`) returns `null` whenever `t < 1` (`!(t >= 1)`), and `settle()` learns nothing when `verifiedThroughTurn === 0`, `inferSpreads()` immediately burned `budgets[0..3]` (`680` probes) and exited with `stop = 'searches'`.
   - Because `SEARCH_LIMITS` in `scripts/local-score.mjs:93-94` omits `'searches'`, `limitHit` evaluated to `false` and all three views were graded **`NO MATCH`** instead of `GAVE UP`.

---

## 3. Single Cohesive Fix Specification

### Landed Fix: Commit `2e0cf13` (`scripts/lib/reconstruct.mjs:449-478`)

Commit `2e0cf13` (*"Try each order of the Pokemon Illusion was shown as at the end of the party, the one seen last first"*) resolved this exact multi-disguise tail-ordering defect in `choiceFor(side, plan, state, notes)`:

```js
    // Illusion copies the last Pokemon brought that has not fainted, so one it
    // was shown as goes last - unless it led. Shown as two, the second stood
    // before the first, which had fainted - or a switch moved them: their order
    // is a hidden choice too, the one seen last first.
    ...
    const lastOrders = permutations(last.slice().reverse());
    for (const chosen of combinations(pool, Math.max(0, room - known.length))) {
      for (const back of permutations([...known, ...chosen])) {
        for (const ends of lastOrders) options.push({ back, chosen, ends });
      }
    }
    const { back, chosen, ends } = options.length > 1 ? options[state.nextVariantDigit(options.length, true)] : options[0];
    for (const i of chosen) notes.push(`${sideId} brought a Pokemon that never appeared - assumed ${bench[i]}`);
    const order = [...front, ...back, ...ends].map(at => at + 1);
```

- **Why this fixes F05 cleanly**:
  - `last.slice().reverse()` puts the **earliest** non-lead disguise (`D1`, seen at Turn 0) at the very end of `ends` (Slot 4) in `options[0]`, and the later disguise (`D2`, seen after `D1` fainted) before it (Slot 3).
  - Enumerating `permutations(last.slice().reverse())` ensures every permutation among the `last` species is also reachable as a Turn 0 variant via `nextVariantDigit(options.length, true)` if switches or re-entries require another relative tail order.

### Contrast with F06 (Why F05 Does Not Solve F06)

While `2e0cf13` fixed multi-disguise ordering **within** `last` at the tail `[...front, ...back, ...ends]`, it leaves four coupled Illusion mechanisms broken (tracked in **F06**):
1. **Mid-battle party-slot rotation (`gaveup-2694974808`, `2698337557`, `2700537949`)**: `2e0cf13` still locks non-lead `last` members strictly into `ends` (Slots 3–4 after `back`), and excludes them from `seen`/`back`. When `last.length === 1` and `known.length === 1` (`options.length === 1`), `2e0cf13` generates **only 1 option**, making it impossible to start the disguise target in Slot 3 and rotate it into Slot 4 via Turn 1–3 switches.
2. **Retreating-lead self-species disguise (`gaveup-2695018557`, `2700281215`, `2705589340`, `2707844739`)**: `choiceFor` still filters leads out of `last` (`!state.reveal[sideId].slice(0, leads).includes(name)`) without placing the Illusion user itself at the end so a retreating lead swaps into Slot 4.
3. **`watchParty()` switch-phase blind spot (`reconstruct.mjs:248, 2529`)**: Even when `options.length > 1`, `watchParty()` checks `battle.activeMove`, so `Illusion.onBeforeSwitchIn` party reads (`activeMove === null`) never add Turn 0 to `carriers`, preventing `reconstruct` from walking `variants[0]`.
4. **Secondary `SEARCH_LIMITS` note**: In `scripts/local-score.mjs:93-94`, `'searches'` remains outside `SEARCH_LIMITS` intentionally per its comment (`"The rounds' own endings - searches, stalled, rounds - end every inference that does not rebuild"`), though when Turn 0 fails with zero search limits hit, it classifies as `NO MATCH`.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2694981022` (`nomatch-2694981022.md`)

- **Views & Results**: `p2@p1`: `NO MATCH` (`18.8s`), `both@spectator`: `NO MATCH` (`38.0s`), `p1@p2`: `NO MATCH` (`37.9s`), all stopping at Turn 0 with `stop = 'searches'`, `680` probes, `136,663,185` (`10^8.14`) spreads remaining (`0` removed).
- **Ground-Truth P2 Lineup**: `>p2 team 4, 1, 5, 2` (`[Slot 1: Zoroark-Hisui, Slot 2: Glimmora, Slot 3: Garchomp, Slot 4: Volcarona]`).
- **Observed Disguise Sequence**:
  1. **Turn 0**: `Zoroark-Hisui` leads in `p2a` copying Slot 4 (`Volcarona`):
     `|switch|p2a: Volcarona|Volcarona, L50, F|100/100`
  2. **Turn 1**: Hit by `Heat Wave`; Illusion breaks:
     `|replace|p2a: Zoroark|Zoroark-Hisui, L50, F`
  3. **Turn 6**: `Volcarona` has fainted; `Zoroark-Hisui` switches back in copying Slot 3 (`Garchomp`):
     `|switch|p2a: Garchomp|Garchomp, L50, M|44/100` $\to$ `|replace|p2a: Zoroark|Zoroark-Hisui, L50, F`
- **Pre-`2e0cf13` Divergence at Turn 0**:
  - `unmaskIllusion()` set `disguises.p2 = ['Volcarona', 'Garchomp']` and `reveal.p2 = ['Zoroark', 'Glimmora', 'Garchomp', 'Volcarona']`.
  - Pre-`2e0cf13` `choiceFor` set `last = [indexOf('Volcarona'), indexOf('Garchomp')]` and emitted `>p2 team 4, 1, 2, 5` (`[Zoroark-Hisui, Glimmora, Volcarona, Garchomp]`).
  - With `Garchomp` placed in Slot 4 instead of `Volcarona`, Turn 0 failed immediately:
    - **Expected** (`both@spectator` / `p2@p1`): `|switch|p2a: Volcarona|Volcarona, L50, F|100/100` (and `142/142` in `p1@p2`)
    - **Actual**: `|switch|p2a: Garchomp|Garchomp, L50, M|100/100` (and `142/142` in `p1@p2`)
- **Post-`2e0cf13` Resolution**: `last.slice().reverse()` reverses `['Volcarona', 'Garchomp']` $\to$ `['Garchomp', 'Volcarona']`, emitting `>p2 team 4, 1, 5, 2` on `options[0]` and matching Turn 0 on the very first play.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `nomatch-2694981022.md` | `nomatch` | `p2@p1`, `both@spectator`, `p1@p2` | `NO MATCH` (`680` probes, `stop = 'searches'`) | Turn 0 opening switch-in mismatch (`wanted \|switch\|p2a: Volcarona`, `got \|switch\|p2a: Garchomp`) because pre-`2e0cf13` `choiceFor(teamPreview)` placed `disguises = ['Volcarona', 'Garchomp']` into `last` in forward chronological order so Turn 6's `Garchomp` occupied party Slot 4 at Turn 0; fixed by `2e0cf13`. |
