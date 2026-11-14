# F09: `planSegment()` Swallowing Bench-Revived `Revival Blessing` Upkeep Switch as `instaswitch` & `scoreOf([-1, 0, 0])` Masking

## 1. Failure Overview & Status

- **ID**: `F09`
- **Category**: `2. Deterministic Reconstruction, Choice-Planning, & Illusion Bugs`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/reconstruct.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/reconstruct.mjs:123-144` (`planSegment`: `reviver` / `revived` stays armed across the whole turn segment and skips the next matching `|switch|`)
  - `scripts/lib/reconstruct.mjs:485-510` (`choiceFor`: `request.forceSwitch` pops `state.forced[sideId]`, returning `'pass'` when empty)
  - `scripts/lib/reconstruct.mjs:1380-1388` (`playThrough`: `before === after` detects rejected `'pass'` and sets `state.unsatisfied`)
  - `scripts/lib/reconstruct.mjs:1407-1413` (`playThrough`: sets `diff = { index: -1, ... }` when `early === null && state.unsatisfied`)
  - `scripts/lib/reconstruct.mjs:1667-1679` (`scoreOf`: returns `[-1, 0, 0]` when `diff.index < 0`, ranking clean-prefix refusals below earlier line mismatches)
  - `scripts/lib/reconstruct.mjs:1858, 2036, 2044` (`resolveTurn`: checks `score[0] === -1` to detect `refused`)
- **Total Merged Reports**: **8** (`gaveup-2694436020.md`, `gaveup-2696884696.md`, `gaveup-2699337373.md`, `gaveup-2699870830.md`, `gaveup-2699897094.md`, `gaveup-2699898128.md`, `gaveup-2700537117.md`, `gaveup-2707833650.md`)
- **View Breakdown**:
  - **All 3 views (`p1@p2`, `p2@p1`, `both@spectator`) failed in sweep**: **8 of 8 battles** (100% universal 3-view structural failure).
- **Source Shard Clusters**: `S01-C04`, `S02-C03`, `S05-C01`, `S09-C02`, `S11-C01`, `S15-C05`.

---

## 2. Root-Cause Mechanism

This bucket combines two tightly coupled defects in `scripts/lib/reconstruct.mjs` around `Revival Blessing` switch planning and `scoreOf()` refusal ranking:

### Defect A: `planSegment()` Treats Any Same-Turn Switch of a Revived Pokémon as an Automatic `instaswitch` (`reconstruct.mjs:127-144`)
In Pokémon Showdown (`node_modules/pokemon-showdown/sim/battle.ts:2781-2798`):
```ts
case 'revivalblessing':
  action.pokemon.side.pokemonLeft++;
  if (action.target.position < action.pokemon.side.active.length) {
    this.queue.addChoice({
      choice: 'instaswitch',
      pokemon: action.target,
      target: action.target,
    });
  }
  action.target.fainted = false;
  ...
  action.target.sethp(action.target.maxhp / 2);
  this.add('-heal', action.target, action.target.getHealth, '[from] move: Revival Blessing');
  action.pokemon.side.removeSlotCondition(action.pokemon, 'revivalblessing');
  break;
```
- Showdown **only** queues an automatic `instaswitch` (which requires no `forceSwitch` choice) if the revived Pokémon sits at `target.position < side.active.length` (an empty active slot)—and because `instaswitch` has `order: 3` in `battle-queue.ts`, its `|switch|` executes **immediately** after `|-heal|...|Revival Blessing`, before any subsequent `|move|`, `|cant|`, `|faint|`, or `|upkeep|`.
- When the revived Pokémon was already replaced earlier in the battle and sits on the **bench** (`target.position >= side.active.length`, e.g., `position = 2` or `3` in Doubles), Showdown **does not** queue `instaswitch`. The Pokémon stays on the bench at `49/100` or `50/100y`. If an active teammate (or the reviver itself) faints later that turn, Showdown raises a real `forceSwitch` request at `|upkeep|`, and the player sends a genuine `switch` choice to bring the revived Pokémon in.

However, `planSegment()` (`reconstruct.mjs:127-144`) leaves `revived` armed across the **entire turn segment**:
```js
if (kind === '-heal' && tagsOf(line).from === 'move: Revival Blessing' && reviver) {
  const side = identSide(parts[2]);
  plan.forced[side].push({ slot: reviver.slot, name: identName(parts[2]) });
  revived = { side, name: identName(parts[2]) };
  reviver = null;
  continue;
}
if (kind === 'switch' && revived && identSide(parts[2]) === revived.side && identName(parts[2]) === revived.name) {
  revived = null;
  continue;
}
```
When the bench-revived Pokémon later switches in at `|upkeep|` (after another active Pokémon faints), lines 141-144 match `revived` and `continue`, **swallowing a genuine `forceSwitch` entry** from `plan.forced[side]`. When `playThrough()` reaches `|upkeep|`, `state.forced[side]` is empty, `choiceFor()` returns `'pass'`, Showdown rejects `>pN pass, pass` (`before === after`), and `state.unsatisfied` fires (`turn k: a choice was rejected - nothing advanced`) across **all 3 views** regardless of Stat Points.

### Defect B: `scoreOf()` Ranks Clean-Prefix Refusals (`diff.index < 0`) Below Early Wrong-Target Divergences (`reconstruct.mjs:1407-1413`, `1671`)
In `playThrough()` (`reconstruct.mjs:1407-1412`):
- Under the **true choice variant**, every emitted line up to `|upkeep|` agrees 100% (`found.index === gotHard.length`), so `early` is `null`, `diff` gets `index: -1`, and `scoreOf()` (`reconstruct.mjs:1671`) returns **`[-1, 0, 0]`**.
- Under a **bogus alternative target variant** (e.g., aiming `Parting Shot`, `Spirit Break`, `Shadow Ball`, or `Weather Ball` at an ally or wrong foe earlier in the turn), `gotHard` diverges early at `idx < gotHard.length` (`early !== null`), so `scoreOf()` returns **`[idx, fields, shared]`** with `idx >= 0`.
- Because `idx > -1`, `reconstructOnce` (`consider()`, `remember()`, `ranked`, `resolveTurn()`) **discards the clean prefix refusal** and selects the bogus early-target mismatch!
- This masks the real `index: -1` refusal (`reconstruct.mjs:2560`) behind a phantom move-target or damage divergence (`4.10 [notarget]`, `3.6 Shadow Ball`, `4.6 Weather Ball`, `2.5 Dragon Pulse`, `8.8 Spirit Break`), tricking `reconstructOnce` into burning `dieBacktracks` and `infer.mjs:fallback` into burning `240` Stat-Point rebuilds trying to fix a missing `forceSwitch` entry. (In `2694436020`, `scoreOf` masking `state.unsatisfied` at Turn 8 likewise caused `reconstruct` to pick ally-targeting `Spirit Break|p2b: Garchomp` at `8.8` over `p1a: Whimsicott`.)

---

## 3. Single Cohesive Fix Specification

Fix both parts cleanly in `scripts/lib/reconstruct.mjs` without altering simulator mechanics or dropping any legal choice:

1. **Scope `revived` in `planSegment()` Strictly to an Immediate Mid-Turn `instaswitch` (`reconstruct.mjs:127-178`)**:
   - An automatic `Revival Blessing` `instaswitch` (`sim/battle.ts:2783-2788`, `order: 3`) executes **immediately** after `|-heal|...|Revival Blessing` with **no** intervening action, faint, or upkeep phase, and carries no `[from]` tag.
   - In `planSegment()`:
     - Only consume `revived` when `kind === 'switch' && !tagsOf(line).from` matches `revived.side` and `revived.name` immediately following the revival heal.
     - Clear `revived = null` (and `reviver = null` on any new `move`/`cant`/`upkeep`) as soon as any subsequent `move`, `cant`, `faint`, `upkeep`, `turn`, or non-matching `switch`/`drag`/`replace` line appears in the segment.
     - Consequently, any `|switch|` appearing at `|upkeep|` (after a later KO) falls through to lines 161-167 and is pushed onto `plan.forced[side]` as a genuine `forceSwitch` entry.

2. **Rank `state.unsatisfied` (`diff.index < 0`) by Matched Prefix Length in `scoreOf()` (`reconstruct.mjs:1412`, `1671`, `1810`, `1858`, `2036`, `2044`)**:
   - In `playThrough()` (`reconstruct.mjs:1412`), attach `prefix: gotHard.length` when constructing the `index: -1` diff object:
     ```js
     const diff = state.unsatisfied && !finished
       ? (early || { index: -1, prefix: gotHard.length, expected: state.unsatisfied, actual: '', ...(state.cap ? { cap: state.cap } : {}) }) : found;
     ```
   - In `scoreOf(run, t)` (`reconstruct.mjs:1671`):
     ```js
     if (!diff) return [-1, 0, 0];
     if (diff.index < 0) return [diff.prefix ?? 0, -1, 0];
     ```
     - A clean-prefix refusal at `gotHard.length = 15` scores `[15, -1, 0]`, strictly **outranking** any variant that diverged earlier at `idx < 15` (`[10, 4, 4]`), while still ranking strictly **below** any non-refused variant that matches through line 15 (`[15, fields >= 0, shared]`).
   - Update `resolveTurn()`'s refusal checks (`reconstruct.mjs:1810, 1858, 2036, 2044`) from `score[0] === -1` to `score[1] === -1` (since `fields` is always `>= 0` for `diff.index >= 0` and `0` for `±Infinity`, `score[1] === -1` uniquely identifies `diff.index < 0`), while `run.diffs[0]?.index === -1` (`reconstruct.mjs:2413, 2523, 2560`, and `infer.mjs`) remains unchanged.

---

## 4. Representative Battle Proofs

### Proof 1 — Bench-Revived Upkeep Switch Swallowed + `scoreOf` `[notarget]` Masking: `mimic:gen9championsvgc2026regmcbo3-2696884696`
- **Battle & Views**: All 3 views failed (`p2@p1`, `p1@p2`, `both@spectator`), `1,978.0s` sweep / `879.6s` trace on `brahms` (`96` rounds, `526` rebuilds, `571,187` probes, `stop = "searches"`, `0%` exact stats).
- **Turn 2 Upkeep**: `p2b: Pawmot` replaced fainted `Delphox`, placing fainted `Delphox` on the bench (`position = 3 >= 2`).
- **Turn 4 Sequence**:
  - `4.0-4.1`: `p2b: Pawmot` uses `Revival Blessing`, reviving `Delphox` on the bench (`|-heal|p2: Delphox|49/100|[from] move: Revival Blessing`). No `instaswitch` occurs.
  - `4.2-4.5`: `p1b: Rillaboom` KOs `p2b: Pawmot` with `Wood Hammer` (`0 fnt`).
  - `4.6-4.9`: `p2a: Indeedee` KOs `p1b: Rillaboom` with `Dazzling Gleam`.
  - `4.10`: `p1a: Incineroar` uses `Parting Shot` on `p2a: Indeedee`, pivoting to `p1a: Volcarona`.
  - `4.14+` (`|upkeep|`): Showdown raises `forceSwitch: [false, true]` for `p2`; `p2` switches revived `Delphox` into `p2b` (`|switch|p2b: Delphox|Delphox, L50, M|49/100`).
- **Failure**: `planSegment()` swallowed `|switch|p2b: Delphox|` because `revived` was still armed from `4.1`. Under real choices (`v = 0`, `Parting Shot +1`), Turn 4 matched all `15` lines up to `|upkeep|` and failed with `>p2 pass, pass` (`diff.index = -1`, `scoreOf = [-1, 0, 0]`). Variant `v = 2` (`Parting Shot -2` aiming at fainted ally `Rillaboom`) emitted `|move|p1a: Incineroar|Parting Shot|p1: Rillaboom|[notarget]` at `index = 10` (`scoreOf = [10, 4, 4] > [-1, 0, 0]`), masking the refusal and triggering 240 futile Turn-4 fallback rebuilds.

### Proof 2 — `scoreOf([-1, 0, 0])` Masking & Bench-Revived Upkeep Switch: `mimic:gen9championsvgc2026regmcbo3-2699337373` & `2699898128` & `2694436020`
- **`2699337373`** (all 3 views `GAVE UP`, `1,358.2s` sweep / `223.4s` trace on `vranx`): On Turn 3, `p2a: Pawmot` revived benched `Talonflame` (`3.4-3.5`: `50/100y`), then `p1a: Gholdengo` KOed `p2b: Basculegion` (`3.8`), and at `|upkeep|` `p2` sent `|switch|p2b: Talonflame|`. `planSegment()` dropped the upkeep switch, so `v = 0` (`Shadow Ball +2`) scored `[-1, 0, 0]` and lost to `v = 1` (`Shadow Ball +1` into `p2a: Pawmot` at `3.6`, `score = [6, 3, 4]`).
- **`2699898128`** (all 3 views `GAVE UP`, `1,002.0s` sweep / `427.5s` trace on `thrashbarg`): Turn 2 `p2a: Pawmot` revived benched `Delphox` (`2.3`), `Kingambit` KOed `p2b: Indeedee`, and `planSegment()` dropped `|switch|p2b: Delphox|` at Turn 2 upkeep. In `resolveTurn(2)`, `scoreOf = [-1, 0, 0]` caused the solver to reject the valid `85%` `Dragon Pulse` roll (`44/160` -> `27/100` at `2.5`) because passing `2.5` led directly to the `[-1, 0, 0]` upkeep refusal!
- **`2694436020`** (all 3 views `GAVE UP`, `3,927.9s` sweep / `732.9s` trace on `quordlepleen`): On Turn 8 (`8.8`), `p1b: Pawmot` used `Revival Blessing` (`Whimsicott` into `p1a`) and fainted to `Earth Power`, hitting `state.unsatisfied` (`[-1, 0, 0]`) so `scoreOf` ranked ally-targeting `|move|p2a: Grimmsnarl|Spirit Break|p2b: Garchomp` (`8.8`) above `|move|p2a: Grimmsnarl|Spirit Break|p1a: Whimsicott`.

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2694436020.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` | Turn 8 (`8.8`): `p1b: Pawmot` used `Revival Blessing` auto-switching `Whimsicott` into empty `p1a` and later fainted, leaving `state.unsatisfied` (`scoreOf = [-1, 0, 0]`) so `reconstruct` picked ally-targeting `Spirit Break\|p2b: Garchomp` instead of `p1a: Whimsicott` across all 3 views. |
| `gaveup-2696884696.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` | Turn 4 `Pawmot` revived benched `Delphox` (`pos 3 >= 2`, no `instaswitch`) and fainted to `Wood Hammer`; `planSegment()` swallowed `Delphox`'s Turn 4 upkeep `forceSwitch` (`>p2 pass, pass`) across all 3 views, while `Parting Shot -2 [notarget]` at `4.10` masked `index = -1` via `scoreOf`. |
| `gaveup-2699337373.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP (both@spectator)` | Turn 3 `Pawmot` revived benched `Talonflame` (`3.4-3.5`), then `Gholdengo` KOed `Basculegion` (`3.8`); `planSegment()` dropped Turn 3 upkeep `\|switch\|p2b: Talonflame\|`, and `scoreOf()` let `v = 1` (`Shadow Ball -> p2a: Pawmot` at `3.6`) outrank `v = 0`'s `[-1, 0, 0]` across all 3 views. |
| `gaveup-2699870830.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP (both@spectator)` | Turn 4 `Pawmot` revived benched `Indeedee-F` (`4.4-4.5`), then `Charizard` KOed `Delphox` (`4.6-4.9`); `planSegment()` dropped Turn 4 upkeep `\|switch\|p1b: Indeedee\|` (`4.13`), and `scoreOf()` let `v = 1` (`Weather Ball -> p1a: Pawmot` at `4.6`) outrank `v = 0`'s `[-1, 0, 0]` across all 3 views. |
| `gaveup-2699897094.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP (all 3 views)` | Turn 5: `Pawmot` used `Revival Blessing` to revive benched `Indeedee-F`, then `Pawmot` fainted and `Indeedee-F` switched in at Turn 5 upkeep; `planSegment()` suppressed the upkeep switch from `plan.forced.p2`, causing `reconstruct` to send `pass, pass` in all 3 views. |
| `gaveup-2699898128.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` | Turn `2.3` `Pawmot` revived benched `Delphox`; `planSegment()` discarded Turn 2 upkeep `\|switch\|p2b: Delphox\|...` after `Indeedee` fainted (`turn 2: a choice was rejected` in all 3 views), and `scoreOf([-1, 0, 0])` caused `resolveTurn(2)` to reject valid `85%` `Dragon Pulse` rolls and stall at `2.5`. |
| `gaveup-2700537117.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` | Turn 7 `Pawmot` used `Revival Blessing` on benched `p1:5 Indeedee-F`; `planSegment()` discarded `Indeedee`'s Turn 7 upkeep `\|switch\|p1b: Indeedee\|...`, causing `choiceFor` to send `>p1 pass, pass` at Turn 8 (`turn 8: a choice was rejected - nothing advanced`) across all 3 views. |
| `gaveup-2707833650.md` | `gaveup` | `p1@p2`, `p2@p1`, `both@spectator` | `GAVE UP` | Turn 2 `p1b: Pawmot` revived `Staraptor` while both P1 slots were occupied (no auto-switch), leaving `revived` armed; when `Pawmot` later fainted and `Staraptor` entered at `\|upkeep\|`, `planSegment()` swallowed `\|switch\|p1b: Staraptor\|50/100y`, causing `state.unsatisfied` (`[-1, 0, 0]`) so `reconstruct` picked ally-targeting `Spirit Break\|p2a: Archaludon` over `p1a: Politoed` in all 3 views. |
