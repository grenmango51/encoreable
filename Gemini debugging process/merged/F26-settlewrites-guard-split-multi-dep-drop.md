# F26: `settleWrites` Dropping Multi-Dependency `Guard Split` Writes to `unmapped`/`band('down')` + `halve` Skipping `['early', 'other']`

## 1. Failure Overview & Status

- **ID**: `F26`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs` / `scripts/lib/inference/infer.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs`: `askWrites` & `settleWrites` (`lines 3105–3175`, specifically `lines 3158–3173`) — only accepts `moving.length <= 1`, setting `rec.deps[s]` to `null` and adding `s` to `rec.unmapped` whenever two unknown Pokémon's Stat Points move a written `storedStats` field.
  - `scripts/lib/inference/evidence.mjs`: `depOf` (`lines 563–571`) & `analyseHit` (`lines 920–948`) — rejects any stat in `rec.unmapped` (`!unmapped.size`), dropping every subsequent hit reading that stat to `band('down')`.
  - `scripts/lib/inference/infer.mjs`: `fallback` `halve` loop (`lines 809–817`, specifically `line 813`) — skips bisection unless `ends.includes('early') && ends.includes('same')`, ignoring `['early', 'other']` endpoints.
- **Total Merged Reports**: **1** report (`gaveup-2707984263.md`)
- **View Breakdown**:
  - `p2@p1`: **1 / 1 `PASS`** (with `Snorlax` & `Runerigus` known, `Guard Split` resolved to `CONSTANT = 128`, narrowing `Pelipper SpA = 5` on Pass 1)
  - `p1@p2`: **1 / 1 `PASS`**
  - `both@spectator`: **1 / 1 `GAVE UP`** (`515.4s` trace / `1,024.1s` sweep, `38` rounds, `518` rebuilds, `249,868` probes)

---

## 2. Root-Cause Mechanism

In Pokémon Showdown (`node_modules/pokemon-showdown/data/moves.ts:7949–7971` for `Guard Split`, and `lines 13759–13781` for `Power Split`), `onHit(target, source)` overwrites both Pokémon's `storedStats` with their integer-floored average:

```ts
const newdef = Math.floor((target.storedStats.def + source.storedStats.def) / 2);
target.storedStats.def = newdef;
source.storedStats.def = newdef;
const newspd = Math.floor((target.storedStats.spd + source.storedStats.spd) / 2);
target.storedStats.spd = newspd;
source.storedStats.spd = newspd;
```

In `both@spectator` (Channel 0), when both `source` (`Runerigus`) and `target` (`Snorlax`) are unknown:
1. **`askWrites` / `settleWrites` (`evidence.mjs:3105–3175`) Only Handles 0- or 1-Variable Writes**:
   `askWrites` varies one `(owner, stat)` at a time while holding all other stats fixed at their scaffold values. `settleWrites` (`lines 3158–3163`) builds a `dep` only if `moving.length === 0` (`CONSTANT`) or `moving.length === 1` (`{ owner, stat, at }`). Because both `p1:1|spd` (`Snorlax`) and `p1:5|spd` (`Runerigus`) move the written `storedStats.spd`, `moving.length === 2` fails the `<= 1` check and executes lines `3170–3172`:
   ```js
   delete rec.deps[s];
   rec.unmapped.add(s);
   note(`${what} on ${named(rec)}'s ${s}`, 'no one candidate value says what it wrote, so what reads it is set aside');
   ```
2. **All Subsequent Hits Reading `Snorlax.def` / `Snorlax.spd` Collapse to `band('down')`**:
   In `analyseHit` (`lines 922–944`), `depOf(Snorlax, 'spd')` returns `null` (`line 564`), adding `Snorlax` to `unmapped` and setting `supported = false`. Every subsequent hit on `Snorlax` (Turn 2 `Hyper Voice`, Turn 3 `Hyper Voice`, Turn 4 `4.6` CRIT `Hurricane`) degrades to `band('down')`. Consequently, `evidence.mjs` extracts **zero** `Pelipper SpA` or `Snorlax HP/SpD` constraints from Turn 4 (`4.6`), `choose()` trivially passes `5 turns exact` every round, and Turn 4 is dumped into `fallback`.
3. **`halve` (`infer.mjs:813`) Skips `Pelipper spa` Due to `['early', 'other']` Endpoints**:
   In `fallback` on Turn 4 (`4.6: wanted 38/100, got 33/100`), probing `Pelipper spa 0` breaks Turn 3 (`3.5: Indeedee 28/100`, `'early'`) while `Pelipper spa 32` reaches `4.6` and moves `Snorlax` from `33/100` to `31/100` (`'other'`). Because `infer.mjs:813` requires `ends.includes('early') && ends.includes('same')`, `halve` skips `Pelipper spa` and spends ~95 of 128 rebuilds bisecting 13 irrelevant `66`-SP-budget artifacts (`'early'`/`'same'`) before `moved` or 2-stat pairs can run.

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1–#3 (*Simulator is the only source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move*):

1. **Support Coupled 2-Dependency `storedStats` Writes in `askWrites` / `settleWrites` & `analyseHit` (`evidence.mjs:563–571, 922–948, 3105–3175`)**:
   - Look at `analyseHit` (`lines 933–948, 995–1035`): `evidence.mjs` already supports a hit reading **three** unknown SP variables: `dims[0]` (a key dimension on `T`), `offVar` (e.g. `Pelipper spa`), and `extraVar` (carried in `hit.sStates` as `[M, h, x]`)! Notice the live comment at `evidence.mjs:934–936` literally anticipates `Guard Split` (`after Guard Split your Defence stands on the hidden attacker's`), but only for the 1-known-side case!
   - When `moving.length === 2` in `settleWrites` (e.g. `Guard Split` or `Power Split` writing a stat that depends on two `(owner, stat)` deps `d1, d2`, where `askWrites` can evaluate the `33 × 33 = 1,089` joint grid `(v1, v2)` inside `guarded` — verified against `actual` at `(ownValue(d1), ownValue(d2))`):
     - Store a coupled dependency `rec.deps[s] = { deps: [d1, d2], at: (v1, v2) => grid[v1 * SPAN + v2] }` (rather than adding `s` to `rec.unmapped`), and keep both `d1.owner.id` and `d2.owner.id` in `rec.lent[s]`.
     - In `analyseHit` (`lines 922–932, 1028–1031`), when `dep = depOf(rec, key)` has `dep.deps`:
       - Register **both** `[d1, d2]` into `vars` (so for `Pelipper` `Hurricane` hitting `Snorlax` after `Guard Split`, `Snorlax|spd` becomes `dims[0]`, `Pelipper|spa` becomes `offVar`, and `Runerigus|spd` becomes `extraVar` — `dims.length = 1 <= 1` and `others.length = 2 <= 2`!).
       - When building `dryRow` patches at `lines 1028–1031`, evaluate `dep.at(val(d1), val(d2))` where each component `val(di)` comes from `a` (if `di` is `offVar`), `s[2]` (if `di` is `extraVar`), or `d` (if `di` is `dims[0]`).
     - This single mechanism-level extension handles `Guard Split`, `Power Split`, and any 2-Pokémon `storedStats` average/copy cleanly through the simulator's own `onHit` without naming any move!

2. **Allow `halve` to Bisect `['early', 'other']` Endpoints (`infer.mjs:813`)**:
   - In `infer.mjs:813`, change `if (!ends.includes('early') || !ends.includes('same')) continue;` to `if (!ends.includes('early') || ends.every(s => s === 'early')) continue;` (requiring one `'early'` end and one end reaching `>= t`, i.e., `'same'` or `'other'`), so an offensive stat like `Pelipper spa` whose upper end shifts the damage percentage on the failing line (`'other'`) is bisected symmetrically with `'same'`.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2707984263` (`both@spectator`, Turn 2 `Guard Split` $\to$ Turn 4.6 `Pelipper` CRIT `Hurricane`)
- **Planted Stats**:
  - `p1:1 Snorlax` (`Brave`, `{ hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 }`, `HP 267`, `Def 85`, `SpD 132`).
  - `p1:5 Runerigus` (`Relaxed`, `{ hp: 32, atk: 2, def: 32, spa: 0, spd: 0, spe: 0 }`, `HP 165`, `Def 216`, `SpD 125`).
  - `p2:2 Pelipper` (`Modest`, `{ hp: 31, atk: 0, def: 0, spa: 5, spd: 20, spe: 10 }`, `SpA 132`, `HP 166`).
- **Protocol & Failure Trace**:
  - Turn 2 (`2.0`): `p1a: Runerigus` uses `Guard Split` on `p1b: Snorlax`: sets both `storedStats.def` to `150` and `storedStats.spd` to `floor((125 + 132) / 2) = 128`.
  - In `evidence.mjs:3171`, `settleWrites` sees `moving = ['p1:1|spd', 'p1:5|spd']` (`moving.length === 2`), marks `Snorlax.def` and `Snorlax.spd` `unmapped`, and logs *"Guard Split on p1: Snorlax's spd: no one candidate value says what it wrote, so what reads it is set aside"*.
  - Turn 4 (`4.5`–`4.6`): `p2b: Pelipper` lands a CRIT `Hurricane` on `p1b: Snorlax` (`201/267`), rolling `99` (`[96..114]`) to leave `102/267` (`|-damage|p1b: Snorlax|38/100`).
  - With `Snorlax.spd` `unmapped`, `4.6` degrades to `band('down')`, giving `Pelipper SpA` zero narrowing. Default starts guess `Pelipper SpA = 24` (`152`, min dmg `112` $\to$ `33/100`) and usage starts guess `Pelipper SpA = 14` (`141`, min dmg `103` $\to$ `36/100`).
  - `fallback` (`infer.mjs:813`) skips `Pelipper spa` in Start 6 (`ends = ['early', 'other']`), burning ~95/128 rebuilds on 13 `66`-SP budget cliffs, and in Start 5 (`usage`), `Pelipper spa 0` and `32` both stop `'early'` at Turn 3 `3.5`, exhausting `32/32` rebuilds before `middle` (`38` rounds, `518` rebuilds, `249,868` probes, `stop = 'searches'`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2707984263.md` | `gaveup` | `both@spectator` | `GAVE UP` (515.4s trace / 1,024.1s sweep, `stop=searches`, 38 rounds, 518 rebuilds, 249,868 probes) | Turn 4 line `4.6` (`wanted |-damage|p1b: Snorlax|38/100`, `got 33/100` or `36/100`): Turn 2 `Guard Split` (`2.0`) caused `settleWrites` (`evidence.mjs:3147–3174`) to mark `Snorlax.def/spd` `unmapped`, erasing Turn 4 `Pelipper SpA` evidence (`choose()` trivial `5 turns exact`), while `halve` (`infer.mjs:813`) skipped `Pelipper spa` due to `['early', 'other']` / `['early', 'early']` endpoints. |
