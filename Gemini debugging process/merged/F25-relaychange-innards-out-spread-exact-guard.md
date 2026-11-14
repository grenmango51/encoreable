# F25: `relayChange` Rejecting Single-Hit Spread Moves (`Innards Out`) When Earlier Spread Targets Lack Exact HP

## 1. Failure Overview & Status

- **ID**: `F25`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs`: `relayChange` (`lines 1907–1934`, specifically `line 1922`) — rejects relayed damage (`Innards Out`) whenever `last.hitsOn !== 1 || log.slice(0, -1).some(x => !x.victim.exact)`.
  - `scripts/lib/inference/evidence.mjs`: `onChange` (`lines 1974–1986`) — pushes **every** hit of a move use (both multiple hits on one target and separate targets of a spread move) into `src.moveHits.all`.
- **Total Merged Reports**: **1** report (`gaveup-2697164225.md`)
- **View Breakdown**:
  - `p2@p1`: **1 / 1 `PASS`**
  - `p1@p2`: **1 / 1 `PASS`**
  - `both@spectator`: **1 / 1 `GAVE UP`** (`243s` trace / `1,270.1s` sweep, `32` rounds, `272` rebuilds, `180,923` probes)

---

## 2. Root-Cause Mechanism

In Pokémon Showdown (`node_modules/pokemon-showdown/data/abilities.ts:2140–2147`), `Innards Out` executes inside `onDamagingHit`:

```ts
innardsout: {
  onDamagingHitOrder: 1,
  onDamagingHit(damage, target, source, move) {
    if (!target.hp) {
      if (!move.smartTarget) damage += Number(move.totalDamage);
      this.damage(target.getUndynamaxedHP(damage), source, target);
    }
  },
}
```

And in Showdown's move execution loop (`node_modules/pokemon-showdown/dist/sim/battle-actions.js:827–839, 931–954`):
- `spreadMoveHit` runs `runMoveEffects` $\to$ `DamagingHit` for each target (`line 954`) **before** returning to the outer `hit` loop.
- `move.totalDamage += damage[i]` (`line 838`) is accumulated **only after** `spreadMoveHit` finishes a hit.
- Consequently:
  - On a **multi-hit** move (e.g., hits `2+` of `Population Bomb` / `Triple Axel` / `Beat Up`), `move.totalDamage` holds the cumulative damage of prior hits when `DamagingHit` runs, so `Innards Out`'s damage depends on earlier hits.
  - On a **single-hit spread move** (`Heat Wave` hitting `[Garchomp, Victreebel]`), `move.totalDamage` is **`0`** during `spreadMoveHit`! `Innards Out` on `Victreebel` (`2.10`) receives `damage === Victreebel.dealt` alone, with **zero** dependency on what `Heat Wave` dealt to `Garchomp` (`2.8`).

In `evidence.mjs:1978–1985`, `onChange` pushes all hits of the active move into `src.moveHits.all` (`[Garchomp, Victreebel]`). Then in `relayChange` (`evidence.mjs:1914–1925`):
1. `line 1915` verifies `log.at(-1).victim === V && log.at(-1).dealt === frame.relay` (which passes on `Heat Wave`, because `move.totalDamage === 0`).
2. Yet `line 1922` checks:
   ```js
   if (last.hitsOn !== 1 || log.slice(0, -1).some(x => !x.victim.exact)) {
     return 'it carries what more than one hit dealt, and not every one of them is shown exactly';
   }
   ```
   Because `log[0]` (`Garchomp`) has `!Garchomp.exact` in Channel 0 (`both@spectator`), `relayChange` aborts and returns `null`.
3. `effectChange` (`lines 1839–1887`) then falls into `framesChange`, which sees `read.moves === false` (because `Innards Out` receives `relay` rather than reading `Delphox.maxhp`), and downgrades `2.10` to `band('down', 'Innards Out on Delphox')`.
4. With `Innards Out` unread, `Delphox` (`p2:0`) is never constrained to `hp >= 21` (`MaxHP >= 171`, needed to survive `Victreebel`'s `MaxHP >= 155` at `9/100`), leaving `Delphox` stuck at `hp = 1` (`default`) or `hp = 2` (`usage`).

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1–#3 (*Simulator is the only source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move*):

In `relayChange` (`evidence.mjs:1917–1926`), **only** require prior entries in `log.slice(0, -1)` to be exact when the move actually relays accumulated damage from prior hits (multi-hit moves / `move.totalDamage` accumulation), **not** on a single-hit spread move where `frame.relay` equals only the KOed victim's dealt HP:

1. **Detect Single-Hit Spread Execution vs. Multi-Hit Accumulation (`evidence.mjs:1922`)**:
   - In `relayChange`, `moveHits.all` records `{ victim, dealt, change }` in execution order. When `last.hitsOn === 1`, prior entries `x ∈ log.slice(0, -1)` belong to **other targets** of a spread move ONLY if `!move.multihit` (and `!move.smartTarget` or `hit === 1`, i.e. `move.totalDamage === 0` at `DamagingHit` time).
   - Better yet, check directly using the simulator's own `frame` and `move`:
     - On hit `> 1` of a multi-hit move (`last.hitsOn !== 1`, or `move.multihit && log.some(x => x !== log.at(-1) && /* earlier hit cycle */)` — equivalently, when `move.totalDamage > 0` or `Boolean(move.multihit)` where earlier hits could be non-zero under another spread), keep the exactness guard `log.slice(0, -1).some(x => !x.victim.exact)`.
     - Even more generally and mechanically: inside `traced` / `memo('relay|...')`, `move.totalDamage` is only populated *between* multi-hit iterations (never *within* a single `spreadMoveHit` call). So if `!move.multihit` (a single-hit move, single-target or spread) **and** `last.hitsOn === 1`, `move.totalDamage` is guaranteed `0` for all spreads during `DamagingHit`! Therefore, `log.slice(0, -1)` (earlier targets of the same single spread hit) never enters `frame.relay`, and the guard at `line 1922` should be:
       ```js
       if (last.hitsOn !== 1 || (move.multihit && log.slice(0, -1).some(x => !x.victim.exact))) {
         return 'it carries what more than one hit dealt, and not every one of them is shown exactly';
       }
       ```
     - (Note: `Parental Bond` / `multihit` sets `move.multihit`, so `move.multihit` covers all multi-hit moves in the simulator without naming any move or ability!)
2. **Resulting Narrowing**:
   - `relayChange` returns `dealtChange(T, last, what, 'relay', d => frame.rerun({ relay: d }))` (`line 1933`).
   - `apply()` and `wholePaths()` then jointly couple `Delphox`'s HP (`MaxHP >= 171`, `hp >= 21`) with `Victreebel`'s HP (`MaxHP = 155 + hp_V`) and `Delphox.spa` (from `Heat Wave` OHKOing `Victreebel` at `2.9`), resolving `2.10` (`9/100`) cleanly in `settle()` without hitting the `fallback` `halving`/`closestSpread` traps.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2697164225` (`both@spectator`, Turn 2.8–2.10 `Heat Wave` + `Innards Out`)
- **Open Sheet Constraints**:
  - `p1:1 Victreebel-Mega` (`Mild`, `Innards Out`, Base HP `80`, `MaxHP = 155 + hp_V ∈ [155, 187]`).
  - `p1:3 Garchomp` (`Adamant`, `MaxHP ∈ [183, 215]`).
  - `p2:0 Delphox-Mega` (`Timid`, Base HP `75`, `MaxHP = 150 + hp_D ∈ [150, 182]`).
- **Protocol & Failure Trace**:
  - Turn 2 (`|move|p2a: Delphox|Heat Wave|p1b: Victreebel|[spread] p1a,p1b`):
    - **`2.8`**: `|-damage|p1a: Garchomp|81/100` (`!Garchomp.exact` in Channel 0).
    - **`2.9`**: `|-damage|p1b: Victreebel|0 fnt` (OHKO from `100/100`, dealing `dealt = Victreebel.maxhp >= 155`).
    - **`2.10`**: `|-damage|p2a: Delphox|9/100|[from] ability: Innards Out|[of] p1b: Victreebel`.
  - Arithmetic feasibility of `9/100` requires `0.90 < M_V / M_D <= 0.91`. Since `M_V >= 155`, this strictly forces **`M_D >= 171` (`Delphox hp >= 21`)**.
  - Because `log` in `T.moveHits.all` is `[Garchomp, Victreebel]` and `!Garchomp.exact`, `relayChange` (`evidence.mjs:1922`) aborted even though `Heat Wave` is a 1-hit spread move with `move.totalDamage === 0`, falling back to `band('down')`.
  - Consequently, `choose()` moved `Delphox` to `1/0/2/31/0/32` (`MaxHP = 151`, `default`) or `2/0/0/6/0/32` (`MaxHP = 152`, `usage`), hitting `2.10: wanted 9/100, got 0 fnt`. `fallback` then exhausted `8/32/128` rebuilds (`240` spent fallback rebuilds, `180,923` probes, `stop = 'searches'`), leaving `median spreads = 10^8.13` (`98.7%` unnarrowed).
  - By contrast, in `p2@p1` (where `Garchomp` and `Victreebel` were `exact === true`), `relayChange` passed `line 1922` and `PASS`ed cleanly.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2697164225.md` | `gaveup` | `both@spectator` | `GAVE UP` (243s trace / 1,270.1s sweep, `stop=searches`, 32 rounds, 272 rebuilds, 180,923 probes) | Turn 2 line `2.10`: `Delphox-Mega`'s spread `Heat Wave` hit `Garchomp` (`2.8`) and OHKOed `Victreebel` (`2.9`), triggering `Innards Out` (`9/100` on `Delphox`), but `relayChange` (`evidence.mjs:1922`) aborted because `Garchomp` was non-exact in Channel 0, leaving `Delphox` at `hp=1` (`< 171` `maxhp` needed to survive). |
