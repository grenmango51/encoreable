# F02: `fuzz.mjs` Missing `battle.inputLog.push` Interceptor for Hidden-Disable Struggle Serialization

## 1. Failure Overview & Status
- **Bucket ID**: `F02`
- **Category**: `1. Crashes & Soundness Removals`
- **Status on `origin/main`**: **FIXED** (commit `edf07ed` / `edf07ed94a02d4ab10713056b1580638a8109775`: *"Record the choice a fuzz or mimic battle wrote where a hidden disable turned it into Struggle, so its input log replays"*)
- **Primary Subsystem**: `scripts/lib/fuzz.mjs` (`playFuzz`, which also drives `scripts/lib/mimic.mjs`'s `playMimic`)
- **Verified Live Code Locations**:
  - `scripts/lib/fuzz.mjs:196-207, 243-244` — `playFuzz` tracks `written[side.id] = ai.chosen` prior to `await stream.write(...)` and wraps `battle.inputLog.push` to rewrite lines matching `/\bmove struggle\b/` (when `raw` did not ask for `struggle`) back to `>${m[1]} ${raw}`.
  - `scripts/lib/reconstruct.mjs:1260-1271, 1376-1378` — reference `battle.inputLog.push` raw-choice interceptor in `playThrough` that `fuzz.mjs` was missing prior to `edf07ed`.
  - `scripts/local-score.mjs:100-112, 144-162` — `replayInputLog` and `battleOf` verify `same = battleLines(replayed.channels[1]).join('\n') === battleLines(played.ch1).join('\n')`, flagging any mismatch as `CRASH: the input log does not replay the battle`.
- **Total Merged Reports**: **3** (`crash`: 3 — `crash-2692932942.md`, `crash-2702667602.md`, `crash-2705444834.md`)
  - **View Breakdown in Sweep**: All **3** views (`p2@p1`, `p1@p2`, `both@spectator`) crashed at `0s` in all **3** battles (`9/9` views failed).
  - **Source Shard Clusters**: `S01-C01`, `S02-C01`, `S04-C01`

---

## 2. Root-Cause Mechanism

In Pokémon Showdown's doubles simulator, `Imprison` (`data/moves.ts: imprison.condition.onFoeDisableMove`) disables shared moves on opposing Pokémon using `pokemon.disableMove(moveSlot.id, true)` (`isHidden = true`, setting `moveSlot.disabled = 'hidden'`). When that hidden disable combines with `Choice` item lock, `Encore`, or an `Imprison` user sharing all 4 moves of an opposing Pokémon, the following protocol-vs-inputLog discrepancy occurs:

1. **Request Generation vs. Choice Validation (`sim/pokemon.ts` & `sim/side.ts`)**:
   - In `getMoveRequestData()` / `getMoves()`, when the target is in doubles slot 1 (`isLastActive()` $\implies$ `restrictData = true`), `disabled === 'hidden'` is concealed from the request (`disabled: false`, `maybeDisabled: true`), or when all 4 moves are disabled in `Side.prototype.chooseMove()`, Showdown calls `pokemon.getMoves()` with `restrictData === undefined`, exposing `'hidden'` as disabled (`moves.length === 0`).
   - When the player (`FuzzPlayer` or `MimicPlayer`) submits a legal request choice (e.g., `move 1 2`, `move 2 1`, or `move 4`), `Side.prototype.chooseMove()` finds `!moves.length` and silently converts the slot action to `{ choice: 'move', pokemon, moveid: 'struggle' }`, returning `true`.
2. **Unreplayable `move struggle` Serialization into `battle.inputLog`**:
   - At turn commit (`Battle.commitChoices` $\to$ `Side.getChoice()`), Showdown serializes `moveid: 'struggle'` as `"move struggle"` and pushes `>pN ..., move struggle` into `battle.inputLog`.
   - Prior to commit `edf07ed`, `scripts/lib/fuzz.mjs` (`playFuzz`, which executes both `fuzz:` and `mimic:` battles) did **not** install the `battle.inputLog.push` interceptor that `scripts/lib/reconstruct.mjs` (`lines 1264-1271`) already used. Thus, the raw `move struggle` line remained in `played.inputLog`.
3. **Rejection During `replayInputLog` (`scripts/local-score.mjs:100-112, 144-162`)**:
   - `battleOf()` immediately verifies `played.inputLog` by replaying every `>` line into a fresh `BattleStream`.
   - When `stream.write('>pN ..., move struggle')` executes, `Side.prototype.chooseMove('struggle')` checks `'struggle'` against `request.moves` (which contains only the Pokémon's 4 real moves, never `'struggle'`), rejects the choice with `Can't move: Your <Pokemon> doesn't have a move matching struggle`, and leaves `side.isChoiceDone() === false`.
   - Either the replay stalls at that turn or consumes a later replacement line as the turn's choice, causing `battleLines(replayed.channels[1]) !== battleLines(played.ch1)` (`same === false`) and aborting all 3 views (`p2@p1`, `p1@p2`, `both@spectator`) with `CRASH 0s: the input log does not replay the battle`.

---

## 3. Single Cohesive Fix Specification

Commit `edf07ed` (`edf07ed94a02d4ab10713056b1580638a8109775`) installs the exact `battle.inputLog.push` interceptor from `scripts/lib/reconstruct.mjs` into `playFuzz` (`scripts/lib/fuzz.mjs:196-207, 243`):

```js
// A move a hidden disable turned into Struggle - Imprison's, in doubles - is
// recorded as `move struggle`, which the request it answered never offered,
// so that line would be refused on replay: the choice that was written is
// recorded in its place, as `reconstruct` does.
const written = {};
const recordInput = battle.inputLog.push;
battle.inputLog.push = function (line, ...rest) {
  const m = /^>(p[1-4]) (.*)$/.exec(String(line));
  const raw = m && written[m[1]];
  const fixed = raw && /\bmove struggle\b/.test(m[2]) && !/\bstruggle\b/.test(raw) ? `>${m[1]} ${raw}` : line;
  return recordInput.call(this, fixed, ...rest);
};
```
Right before `await stream.write(`>${side.id} ${ai.chosen}`)` (`line 244`), `playFuzz` records `written[side.id] = ai.chosen;` (`line 243`).

### Remaining Edge-Case Audit
- Because `written[side.id]` is refreshed on every `tries` iteration before `stream.write`, if a choice is refused due to an unavailable trap (`tries > 0`) and re-chosen, `written[side.id]` always holds the exact choice string accepted before `commitChoices()` pushes to `battle.inputLog`.
- Because `playFuzz` and `MimicPlayer` always submit numeric slot choices (`move 1`, `switch 3`, etc.) and never the word `struggle`, `!/\bstruggle\b/.test(raw)` accurately identifies hidden-disable Struggle rewrites without altering legitimate choices.
- Replacing the full side line (`>${m[1]} ${raw}`) preserves any partner slot choice on the same line (e.g., `switch 3` or `move 2 2`) so replaying `played.inputLog` executes both slots identically and re-triggers Showdown's hidden-disable Struggle override deterministically.

**Verdict**: Commit `edf07ed` completely resolves F02 for all `fuzz:` and `mimic:` battles with **no remaining edge cases**.

---

## 4. Representative Battle Proofs

### Proof A: `mimic:gen9championsvgc2026regmc-2692932942` (Imprison + Choice Scarf Lock)
- **Exchange**:
  - Turn 1: `p1a: Indeedee` (`Expanding Force, Hyper Voice, Imprison, Protect`) uses `Imprison`, setting `disabled = 'hidden'` on `Expanding Force` and `Protect` for `p2b: Indeedee` (`Expanding Force, Mystical Fire, Trick, Protect`, holding `Choice Scarf`), which simultaneously locks into `Expanding Force`.
  - Turn 2: Because `p2b: Indeedee` is the last active slot (`restrictData = true`), its request still offers `Expanding Force`. `MimicPlayer` submits `>p2 switch 4, move 1 2`. Showdown converts `move 1 2` into Struggle (`|-activate|p2b: Indeedee|move: Struggle`), pushing `>p2 switch 4, move struggle` into `played.inputLog` (and again on Turn 3: `>p2 move flamethrower +1, move struggle`).
- **Pre-`edf07ed` Replay Failure**:
  - `replayInputLog` rejected `>p2 switch 4, move struggle` with `ERROR on p2: Can't move: Your Indeedee doesn't have a move matching struggle`, halting `replayed.channels[1]` at line 41 (`|turn|2`) vs. 127 lines in `played.ch1`.

### Proof B: `mimic:gen9championsvgc2026regmcbo3-2705444834` (Encore + Imprison)
- **Exchange**:
  - Turn 3: `p2b: Whimsicott` uses `Encore` on `p1b: Milotic` (`Protect`), disabling `Muddy Water`, `Hypnosis`, and `Coil`.
  - Turn 5: `p2a: Indeedee` uses `Imprison` (sharing `Protect`), hidden-disabling `Protect`.
  - Turn 6: With all 4 moves disabled, `MimicPlayer` submits `>p1 move 2 2, move 4`, which Showdown executes as `Struggle` and serializes into `battle.inputLog` as `>p1 move headsmash +2, move struggle`.
- **Pre-`edf07ed` Replay Failure**:
  - `replayInputLog` rejected line 17 (`Can't move: Your Milotic doesn't have a move matching struggle`), halting at line 120 (`|turn|6`) vs. 139 lines in `played.ch1`. Substituting `>p1 move headsmash +2, move protect` reproduces all 139 lines identically (`same === true`).

---

## 5. Merged Reports Manifest

| Report File | Kind | Views Failed in Sweep | Trace Result | Primary Bottleneck |
|---|---|---|---|---|
| `crash-2692932942.md` | `crash` | `p2@p1`, `p1@p2`, `both@spectator` | `CRASH 0s` (`all 3 views`) | Turn 2 & Turn 3 `Choice Scarf` + `Imprison` on `p2b: Indeedee` serialized `>p2 switch 4, move struggle` and `>p2 move flamethrower +1, move struggle` into `played.inputLog` in `fuzz.mjs`, rejected by `replayInputLog` (`Can't move: Your Indeedee doesn't have a move matching struggle`). |
| `crash-2702667602.md` | `crash` | `p2@p1`, `p1@p2`, `both@spectator` | `CRASH 0s` (`all 3 views`) | Turn 2 `>p1 switch 3, move struggle` (after `p2a: Indeedee` `Imprison`ed all 4 moves of `p1b: Indeedee`) rejected by `replayInputLog`, causing `p1` to consume Turn 2's post-faint `>p1 switch 3, switch 4` as its Turn 2 action and desynchronize Turn 2. |
| `crash-2705444834.md` | `crash` | `p2@p1`, `p1@p2`, `both@spectator` | `CRASH 0s` (`all 3 views`) | Turn 3 `Encore` (`Protect`) + Turn 5 `Imprison` (`Protect`) left `p1b: Milotic` with 0 valid moves on Turn 6; `MimicPlayer`'s legal `move 4` serialized as `>p1 move headsmash +2, move struggle` in `fuzz.mjs` and was rejected by `replayInputLog` at Turn 6. |
