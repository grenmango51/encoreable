# F31: `fallback()` `disputed` & `cast` Omitting Prior `+3 Fake Out` Flincher on Hidden Flinch Turns (`replayWith` False `same`)

## 1. Failure Overview & Status
- **Bucket ID**: `F31`
- **Category**: `5. Guess-Selection & Fallback Coordinator Bugs (knowledge.mjs & infer.mjs)`
- **Status on `origin/main`**: **LIVE**
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` (`fallback`: `cast` `near` ranking, `disputed` set, `replayWith` `same` shortcut)
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs:576-580` — `cast` tiering (`const near = [names([diff.expected, diff.actual, ...leaving]), names(place.action)];`) only places actors named on the failing line (`diff.expected`, `diff.actual`) and its immediate `place.action` in tiers `0..1`, dropping the prior `+3 Fake Out` (or flinch-move) attacker into `tiers[4]` (`names([...segment, ...stood.values()])`) behind unrelated Turn `t` bystanders.
  - `scripts/lib/inference/infer.mjs:669-679` — `disputed = (built.report.hidden || []).includes(t) ? new Set([actorOf(diff.expected), actorOf(diff.actual)].filter(Boolean)) : new Set();` (`line 671`) only exempts `actorOf(diff.expected)` and `actorOf(diff.actual)` from `replayWith` (`same` check at `lines 677-678`). When `diff.expected` is a hidden flinch (`|cant|<victim>|flinch`), the flincher is excluded from `disputed`, so `replayWith` against `built.inputLog`'s `0`-priority placeholder returns `same = true` and skips `rebuild()` on every `spe` probe of the flincher.
- **Total Merged Reports**: **1** (`gaveup`: 1)
  - **View Breakdown in Sweep**:
    - `p2@p1` only: **1** (`gaveup-2702155390.md`)
  - **Source Shard Clusters**: `S02-C06`.

---

## 2. Root-Cause Mechanism

When a Pokémon (`victim`) flinches before acting on Turn `t`, the replay never reveals which move `victim` chose (`plan.actions` has no entry for `victim`, so `built.report.hidden` includes `t`). In `reconstruct.mjs` (`choiceFor`, `lines 525-544`), `victim`'s invisible choice is tried across every legal `(move, target)` variant:

1. **Higher-Priority Flinched Move vs. `0`-Priority Placeholder (`reconstruct.mjs:532-543, 2507`)**:
   - Suppose `victim` (`p1a: Raichu`) queued a `+3` priority move (`Fake Out`) while the flincher (`p2b: Incineroar`) hit `victim` with `+3 Fake Out` earlier on Turn `t` (`3.1-3.2`).
   - Under the current guess where `Raichu` (`Spe 178`) outspeeds `Incineroar` (under `Tailwind`, `spe = 2 -> 164`), trying `Raichu`'s `+3 Fake Out` variant causes `Raichu` to act *first* at `3.1`, diverging immediately (`score = [1, ...]`).
   - Trying `Raichu`'s `0`-priority variant (`Volt Tackle`) lets `Incineroar`'s `+3 Fake Out` resolve at `3.1-3.2` and advances further to `3.3` (`wanted |cant|p1a: Raichu|flinch, got |move|p2a: Garchomp|Dragon Pulse|p1b: Arcanine`, `score = [3, ...]`).
   - Consequently, `reconstructOnce` saves `Volt Tackle` (`0`-priority) as the `best` choice for `Raichu` in **`built.inputLog`**.
2. **`disputed` Excludes the Flincher (`infer.mjs:671, 677-678`)**:
   - In `fallback()`, `disputed` (`line 671`) collects only `[actorOf(diff.expected), actorOf(diff.actual)]`—here `{p1:2 (Raichu), p2:4 (Garchomp)}`—omitting `p2:2 (Incineroar)`.
   - In `both@spectator`, `Raichu` is unknown (`free`), so `fallback` can still rebuild `Raichu spe 0` (`143 < 164`). In **`p2@p1`** (`known[0] === true`), `Raichu` is **fixed at its true `Spe = 178`**, so the *only* way to pass `3.3` is to raise `Incineroar`'s `spe` (`>= 9`, `Tailwind Spe >= 180 > 178`).
   - When `probe()` tests `Incineroar spe 32` (`224` Tailwind), `!changes.some(c => disputed.has(c.id))` is **`true`**, so `probe()` runs `replayWith(built.inputLog, packOf(chosen), t, channel)` (`line 678`).
   - Because `built.inputLog` contains `Raichu`'s `0`-priority placeholder `Volt Tackle`, raising `Incineroar` (`+3 Fake Out`) from `164` to `224` leaves `+3 Fake Out` ahead of `0`-priority `Volt Tackle` just as before! `replayWith` emits the identical protocol (`same = true`), **skipping `rebuild()` completely** (`b = null`) so `reconstruct` never gets a chance to re-walk `Raichu`'s hidden `+3 Fake Out` variant under `Incineroar`'s higher Speed.
3. **`cast` Ranks Bystanders Ahead of the Flincher (`infer.mjs:576-580`)**:
   - Simultaneously, `cast` places `diff.actual` (`p2a: Garchomp`) in `near[0]` (`rank = 0`), while `p2b: Incineroar` only appears earlier in Turn 3 (`tiers[4]`, `rank = 4`). Thus `fallback` spends its non-skipped `FALLBACK_REBUILDS` budget (`8` / `32`) mutating `Garchomp`'s stats (`Garchomp spe` breaking Turn 1 `1.4` and `3.3`, and `hp/def/spa` breaking Turn 1–2 Channel 1 exact HP) before ever prioritizing the flincher.

---

## 3. Single Cohesive Fix Specification

1. **Include All Turn-`t` Active Speed-Race Participants (Specifically Prior Flinch/Status Attackers) in `disputed` on `hidden` Order/Cant Turns (`scripts/lib/inference/infer.mjs:671`)**:
   - When `(built.report.hidden || []).includes(t)` and `order` is true (or `diff.expected` is a `|cant|` line such as `|cant|<victim>|flinch` or `par`), include every inferred Pokémon active on Turn `t` (or any prior Turn-`t` attacker that targeted `actorOf(diff.expected)`, plus all Turn-`t` `stood`/segment actors when `order` is true) in `disputed`—at minimum for `'spe'` changes (`changes.some(c => disputed.has(c.id) || (c.stat === 'spe' && ...))`).
   - That guarantees `replayWith` never falsely short-circuits (`same = true`) against a `0`-priority placeholder in `built.inputLog` when a Speed perturbation makes a hidden higher-priority variant (like `+3 Fake Out`) legal.
2. **Promote the Flincher Into `cast` `near` Priority Tier on `|cant|...|flinch` Divergences (`scripts/lib/inference/infer.mjs:576-580`)**:
   - When `diff.expected` matches `^\|cant\|([^|]+)\|flinch`, scan `segment` before `diff.index` (just as `started` already scans `before` at `lines 554-572`) for the `|move|<flincher>|...|` action(s) that targeted the flinching slot (or occurred in the preceding higher-priority bracket on Turn `t`), and include those lines in `near[1]` (`rank = 1`, immediately after `diff.expected`/`diff.actual` and ahead of unrelated Turn `t` actors in `tiers[4]`).
   - **Soundness Guarantee**: Both `disputed` and `cast` only govern which witness spreads `fallback()` tests and whether `replayWith` can skip `rebuild()`; neither removes any spread from `knowledge`. All mechanics remain solely in Showdown's simulator.

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmcbo3-2702155390` (`p2@p1` `GAVE UP` 571.2s sweep vs. `both@spectator` `PASS` 106.4s trace)
- **Ground Truth Exchange (Turn 3, `3.0`–`3.5`)**:
  - `3.0`: `p1b: Sinistcha` switches out to `p1b: Arcanine-Hisui`.
  - `p1a: Raichu` (`Jolly`, `#1` usage `2/32/0/0/0/32`, **`Spe = 178`**) chooses habitual **`Fake Out` (`+3` priority)**.
  - `3.1–3.2`: `p2b: Incineroar` (under `Tailwind`, planted `spe >= 9`, **Tailwind Speed $\ge 180 > 178$**) outspeeds `Raichu` in the `+3` priority bracket and uses `Fake Out` on `p1a: Raichu` (`73/100`).
  - `3.3`: **`|cant|p1a: Raichu|flinch`** prints inside the `+3` bracket *before* `p2a: Garchomp-Mega-Z`'s `0`-priority `Dragon Pulse` (`3.4–3.5`, `35/100` on `p1b: Arcanine`).
- **Failure Trace (`trace_2702155390.log` & `slowest_gave_up.json`)**:
  - Because `Raichu` (`178`) outsped guessed `Incineroar` (`spe = 0 -> 160` or `spe = 2 -> 164` Tailwind), `reconstruct` rejected `Raichu`'s `+3 Fake Out` variant at `3.1` and recorded `0`-priority `Volt Tackle` (`move 1`) in `built.inputLog` at `3.3` (`wanted |cant|p1a: Raichu|flinch, got |move|p2a: Garchomp|Dragon Pulse|p1b: Arcanine`).
  - In `both@spectator` Starts 1–2 (`FALLBACK_REBUILDS = 8`), `disputed = {p1:2 Raichu, p2:4 Garchomp}` exhausted 8 rebuilds on `disputed` pairs + `escort(Staraptor)` before reaching `dims`; Start 3 (`wide`, `32` rebuilds) reached `Raichu spe 0` (`143 < 164`) on rebuild #11 (`47.3s`) and passed.
  - In **`p2@p1` (`known[0] === true`)**, `Raichu` is fixed at **`Spe = 178`**. Raising `p2b: Incineroar spe` was the sole valid repair—yet `Incineroar` was absent from `disputed` (`infer.mjs:671`), so `replayWith` (`line 678`) saw `+3 Fake Out` still precede `0`-priority `Volt Tackle`, returned `same = true`, and skipped `rebuild()` on every `Incineroar spe` probe while `cast` ranked `Garchomp` (`rank 0`) ahead of `Incineroar` (`rank 4`). All 6 starts in `p2@p1` failed (`571.2s`, `stop = 'searches'`, `limits = ['backtracks', 'fallbackRebuilds', 'probes', 'searches']`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `gaveup-2702155390.md` | `gaveup` | `p2@p1` | `PASS` (trace only ran `both@spectator`, 106.4s in Start 3 `wide` via `Raichu spe 0`) | In `p2@p1` (where `p1:Raichu` is fixed at `178` Spe), raising `p2:Incineroar`'s `spe` above `178` under `Tailwind` was skipped by `replayWith` (`same = true`) because `Incineroar` was absent from `disputed` on `3.3` (`\|cant\|p1a: Raichu\|flinch` vs `Garchomp Dragon Pulse`) and `built.inputLog` held `0`-priority `Volt Tackle`; additionally `cast` ranked `Garchomp` (`rank 0`) ahead of `Incineroar` (`rank 4`), exhausting `8`/`32` `fallbackRebuilds` (`571.2s`, `stop = 'searches'`). |
