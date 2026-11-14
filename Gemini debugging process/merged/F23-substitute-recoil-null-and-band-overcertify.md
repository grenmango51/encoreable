# F23: `recoilCall = null` Ignoring Substitute-Broken Recoil & `paths()` Falsely Certifying `band('down')` Exact When `h2 === own`

## 1. Failure Overview & Status

- **ID**: `F23`
- **Category**: `4. Missing Evidence & Speed-Sort Reader Hooks (evidence.mjs & speed.mjs)`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/evidence.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/evidence.mjs`: `actions.applyRecoilDamage` wrapper (`lines 2616–2627`) — sets `recoilCall = battle.effect?.id === 'substitute' ? null : { pokemon, move, total: damageDealt }`.
  - `scripts/lib/inference/evidence.mjs`: `effectChange` (`lines 1794–1803`) — when `id === 'recoil'` and `recoilCall` is `null`, emits note *"it was worked out from what a Substitute took, which no line shows, so it was not used"* and returns `band('down', what)`.
  - `scripts/lib/inference/evidence.mjs`: `paths(raw)` (`lines 3965–3968, 4030–4037`) — sets `cutAt` on a `band()` change **only** when `h2 !== own || carriedOff`, leaving `cutAt = Infinity` when `h2 === own` happens to fit the spectator percentage.
  - `scripts/lib/inference/evidence.mjs`: `exactTurns` (`lines 280–327`) — marks turns with `entry.at < cutAt` as proved exact, triggering `brokenProof` in `reconstruct.mjs` (`infer.mjs:295–299`) on subsequent rebuilds.
- **Total Merged Reports**: **2** reports (`gaveup-2698115913.md`, `gaveup-2708402625.md`)
- **View Breakdown**:
  - `p2@p1`: **2 / 2 `PASS`**
  - `p1@p2`: **2 / 2 `PASS`**
  - `both@spectator`: **2 / 2 `GAVE UP`**

---

## 2. Root-Cause Mechanism

In Pokémon Showdown (`node_modules/pokemon-showdown/data/moves.ts:18328–18371`), a Substitute stores `this.effectState.hp = Math.floor(target.maxhp / 4)` in `onStart`. When an external non-bypassing move hits the Substitute, `substitute.condition.onTryPrimaryHit` executes:

```ts
let damage = this.actions.getDamage(source, target, move);
...
if (damage > target.volatiles['substitute'].hp) {
  damage = target.volatiles['substitute'].hp as number;
}
target.volatiles['substitute'].hp -= damage;
...
if (target.volatiles['substitute'].hp <= 0) {
  if (move.ohko) this.add('-ohko');
  target.removeVolatile('substitute');
} else {
  this.add('-activate', target, 'move: Substitute', '[damage]');
}
if (damage) {
  this.actions.applyRecoilDamage(damage, move, source);
}
```

When a recoil move hits a Substitute in `evidence.mjs`, two compounded bugs break inference:

1. **Unhooked Substitute-Capped Recoil (`evidence.mjs:2618–2626, 1798–1803`)**:
   Inside `onTryPrimaryHit`, `battle.effect` is `'substitute'`. `actions.applyRecoilDamage` (`line 2621`) unconditionally sets `recoilCall = null` whenever `battle.effect?.id === 'substitute'`, causing `effectChange` (`line 1802`) to fall back to `band('down', what)`:
   - **When the Substitute breaks (`|-end|...|Substitute`)** on a fresh Substitute (`T.sub === sub && hold`), the damage absorbed by the Substitute is **exact and independent of any attack/defense roll**: `damage === sub[STORED].hp === Math.floor(makerMaxHP / 4)`. By discarding `recoilCall`, `evidence.mjs` fails to couple the attacker's recoil HP (`Rillaboom` in `2698115913`, `Incineroar` in `2708402625`) to the Substitute maker's `MaxHP` (`Garchomp`, `Gengar`), eliminating zero spreads and allowing `closestSpread` to strip the attacker's HP SP (`Incineroar hp: 13/11` in `2708402625`).
   - **When the Substitute survives (`|-activate|...|Substitute|[damage]`)**, `damage` was not capped by `sub.hp` at all — it equals the hit's own `getDamage` (`dealt < sub.hp`).

2. **`paths()` Over-Certifying `band('down')` Exact When `h2 === own` (`evidence.mjs:4030–4037`)**:
   In `paths(raw)`:
   ```js
   const own = e.token !== null ? scaffoldHp(rec, i) : null;
   const h2 = options.includes(own) ? own : options[0];
   const carriedOff = e.change.carriedFrom && (e.change.carriedFrom === 'unknown' || drifted.has(e.change.carriedFrom));
   if (e.change.band && own !== null && (h2 !== own || carriedOff) && cutAt === Infinity) cutAt = secretAt.get(`${rec.id}|${i}`) ?? Infinity;
   ```
   Because `e.change.band` allows **every** HP inside the percentage bucket (`91/100` for `MaxHP = 189` allows both `172/189` [17 recoil] and `173/189` [16 recoil]), `options` includes the scaffold's own guess `own = 173`. Thus `h2 === own`, `cutAt` remains `Infinity`, and `exactTurns` **falsely certifies Turn 7 as proved (`173/189`)**. When a later round changes the Substitute maker's `MaxHP` SP (e.g., `Garchomp` `207 HP` $\to$ `51` Sub HP $\to$ `17` recoil), the simulator prints `172/189`, violating the certified proof and triggering **`brokenProof` (`broken: 2`)**.

---

## 3. Single Cohesive Fix Specification

Per `AGENTS.md` Hard Rules #1–#3 (*Simulator is the only source of mechanics; never remove a sound possibility; one hook per mechanism, never one per move*):

1. **Hook Substitute-Capped Recoil via `sub[STORED].hp` (`evidence.mjs:2555–2570, 2616–2627, 1798–1803`)**:
   - In `actions.getDamage` / `onTryPrimaryHit` (`lines 2555–2568`), `evidence.mjs` already tracks `sub = target.volatiles.substitute`, `hold = sub[STORED]?.hp` (`Math.floor(makerMaxHP / 4)`), and whether the Substitute is `fresh` (`sub.hp === hold.start`).
   - Record the active Substitute context (`subHold` / `subTarget`) when `battle.effect?.id === 'substitute'` calls `applyRecoilDamage(damageDealt, move, pokemon)`:
     - **Case A (Fresh Substitute Broken — `!subTarget.volatiles.substitute` or `sub.hp <= 0`)**: The move dealt `>= hold` to break it, so the Substitute absorbed **exactly `hold`** (`Math.floor(makerMaxHP / 4)`). Let `O = hold.owner || byPokemon.get(subTarget)`:
       - If `!hold.owner` (known maker) or `O === T` (self-targeting corner case), run `actions.applyRecoilDamage(hold.at(...), move, T.pokemon)` per candidate `M` via `amountChange` / `runChange`.
       - Otherwise (`O` is an unknown Substitute maker whose `hp` SP determines `hold.at(v)`), map each surviving `v` of `O`'s `hp` SP (`hps`) to the resulting recoil HP via `statAmountChange` / `totalChange` (passing `actions.applyRecoilDamage(hold.at(v), move, T.pokemon)` inside `dryHp`), directly narrowing `(T.hp, O.hp)` in `apply` and `wholePaths`!
     - **Case B (Fresh Substitute Survived — `sub.hp > 0`)**: `damageDealt` equaled the full unclamped hit damage (`subGates` holds the hit's `dealt` amounts `< hold`), which can be narrowed identically to `totalChange` / `dealtChange` across `(hit, hold)`.
     - **Case C (Non-fresh Substitute, already damaged by an earlier hit)**: Remains safely `band('down')` because residual Substitute HP is unknown.

2. **Never Certify an Unhooked `band()` Transition as `exact` (`evidence.mjs:4030–4037`)**:
   - In `paths(raw)`, any transition represented by `e.change.band` (whether from Substitute-recoil when non-fresh, carried damage, or any other unhooked HP move) has **not** verified that the scaffold's integer `own` is unique or reproducible across other surviving spreads.
   - Whenever `e.change.band && own !== null && cutAt === Infinity`, unconditionally set `cutAt = secretAt.get(`${rec.id}|${i}`) ?? Infinity` (removing the `(h2 !== own || carriedOff)` exception, or setting `cutAt` on every `e.change.band` shown line). That guarantees `exactTurns` never emits a false exact HP token (`173/189` or `171/183`) past an unhooked `band()`, eliminating `brokenProof` warnings (`broken: 2`) permanently.

---

## 4. Representative Battle Proofs

### Proof 1: `mimic:gen9championsvgc2026regmcbo3-2698115913` (`both@spectator`, Turn 7 `Wood Hammer` Recoil Off `Garchomp`'s Substitute $\to$ `broken: 2`)
- **Planted Stats**:
  - `p1:4 Rillaboom` (`Adamant`, `32/5/7/0/18/4`, `HP 207, Atk 165`, `Miracle Seed`, `Wood Hammer`).
  - `p2:1 Garchomp` (`Timid`, `24/5/4/9/23/1`, `HP 207`, `Substitute` HP = `floor(207 / 4) = 51`).
- **Protocol & Failure Trace**:
  - Turn 7: `p2b: Garchomp` uses `Substitute` (`|-damage|p2b: Garchomp|20/100y`).
  - `p1b: Rillaboom` uses `Wood Hammer` on `p2b: Garchomp`: breaks the `51`-HP Substitute (`|-end|p2b: Garchomp|Substitute`), taking `floor(51 / 3) = 17` recoil (`207 -> 190/207`, spectator `91/100`: `|-damage|p1b: Rillaboom|91/100|[from] Recoil`).
  - Under a scaffold guess with `Rillaboom` `MaxHP = 189` (`hp = 14`) and `Garchomp` `MaxHP = 192..203` (`Sub HP = 48..50`, recoil = `16`), `Rillaboom` lands on `173/189` (`floor(100 * 173 / 189) = 91/100`).
  - `evidence.mjs:2621` sets `recoilCall = null` $\to$ `band('down')`. In `paths()`, `91/100` of `189` allows `{172, 173}`, so `h2 = own = 173` leaves `cutAt = Infinity` (`line 4037`).
  - `exactTurns` certifies `|-damage|p1b: Rillaboom|173/189|[from] Recoil` as proved exact. When a rebuild shifts `Garchomp` into `hp = 21..32` (`Sub HP = 51..53`, recoil = `17`), the simulator prints `172/189`, triggering **`broken: 2`** (`"turn 7: |-damage|p1b: Rillaboom|173/189|[from] Recoil / |-damage|p1b: Rillaboom|172/189|[from] Recoil"`) and giving up after `116` rounds, `844` rebuilds, `2,038,273` probes (`11,545.0s`).

### Proof 2: `mimic:gen9championsvgc2026regmcbo3-2708402625` (`both@spectator`, Turn 8 `Flare Blitz` Recoil Off `Gengar`'s Substitute)
- **Witness Stats at Stall**:
  - `p1:2 Incineroar` (`Impish`, `95/115/90/80/90/60`): `choose()` narrowed `Atk=9, Spe=11` and stripped `HP` under the 66-SP cap to `13/9/32/0/0/11` (`MaxHP = 183`, default) or `11/9/20/0/14/11` (`MaxHP = 181`, usage).
  - `p2:0 Gengar` (`Modest`): `32/0/0/32/0/2` / `32/0/6/0/8/17` (`MaxHP = 167`, `Substitute = 41` HP).
- **Protocol & Failure Trace**:
  - Turn 8: `p2a: Gengar-Mega` sets a `41`-HP `Substitute`. `p1a: Incineroar` uses `Flare Blitz`, breaking the Substitute and taking `round(41 * 33 / 100) = 14` HP recoil (`|-damage|p1a: Incineroar|93/100|[from] Recoil`).
  - At `MaxHP = 183` (or `181`), `183 - 14 = 169/183 = 92/100` (wanted `93/100`, requiring recoil `<= 12`, i.e. `Gengar Sub <= 37` HP or `Incineroar MaxHP = 202`).
  - `evidence.mjs:2621` set `recoilCall = null` $\to$ `band('down')`, eliminating `0` spreads while `paths()` spuriously rewrote `183 -> 171/183` (`169/181` in usage). Then `fallback` aborted at `infer.mjs:614` (`reach(base)[0] = 5 < 8` on Turn `5.15` 2-roll `Darkest Lariat`), blacklisting Turn 8 before probing `Incineroar hp` or `Gengar hp` (`66` rounds, `71,984` probes, `stop = 'searches'`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Exact Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2698115913.md` | `gaveup` | `both@spectator` | `GAVE UP` (11,545.0s sweep, `stop=searches`, 116 rounds, 844 rebuilds, 2,038,273 probes, `broken=2`) | Turn 7 `Wood Hammer` hitting `Garchomp`'s `Substitute` yields `recoilCall = null` in `evidence.mjs`, returning a `band` where `h2 === own` (`173/189` inside `91/100`) leaves `cutAt = Infinity`, falsely certifying Turn 7 exact and breaking with `broken: 2` when rebuilds produce `172/189`. |
| `gaveup-2708402625.md` | `gaveup` | `both@spectator` | `GAVE UP` (93.1s trace / 1,025.7s sweep, `stop=searches`, 66 rounds, ~102 rebuilds, 71,984 probes) | On Turn 8, `p1a: Incineroar`'s `Flare Blitz` broke `p2a: Gengar`'s `Substitute` and took `33%` recoil (`93/100`); `evidence.mjs` set `recoilCall = null` (eliminating 0 spreads while `paths()` spuriously rewrote `Incineroar` HP `183 -> 171`), and `fallback()` aborted at `infer.mjs:614` (`reach(base)[0] = 5 < 8`) on Turn 5 (`5.15` 2-roll `Darkest Lariat` `68/100` vs `70/100`), blacklisting Turn 8 before probing `Incineroar hp` or `Gengar hp`. |
