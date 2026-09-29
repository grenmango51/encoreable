# Encoreable — Agent Execution Brief

**Audience:** a coding agent with repo access and a terminal. Assume no prior conversation.
**Verified against:** the checkout in `runtime/` (a real, running local server), Node v24.19.0,
`pokemon-showdown` from upstream GitHub at commit `a5df827` (2026-09-22), pinned in `package.json`.
**Companion doc:** `plan.md` holds product strategy. This file is execution only.

---

## 0. Mission

Build a tool that takes a finished Pokémon Showdown battle, restores the exact position at
an arbitrary turn, and lets a human play forward from there — piloting **both sides**, with
manual control over RNG outcomes.

Target ruleset is **Pokémon Champions VGC** (`[Gen 9 Champions] VGC 2026 Reg M-C`), doubles.

### Status

| | |
|---|---|
| Determinism (Task 1) | **DONE — PASS.** Input logs round-trip byte-identically. |
| Full information (Task 2) | **DONE — YES on our own server. On the public ladder, reconstructed (§7).** |
| Per-roll RNG control (Task 4) | **DONE.** Every draw in the simulator, armed by `/rng` or from the move and Pokemon tooltips in a live room, and by ordinal from a headless rebuild — byte-identical on replay either way. Speed ties, target qualifiers and multi-hit counts are built but not yet exercised. §4. |
| Restore to turn N (Task 3) | **DONE.** `scripts/lib/truncate.mjs`, §5.9. |
| Playable branch (Task 5) | **DONE.** `npm run live` — the native battle UI, both sides, §5.9. |
| Reconstruction (Task 6) | **DONE.** `npm run reconstruct` — a replay plus both sheets becomes an input log, §7. |
| Stat Point inference (Task 7) | **DONE.** `npm run reconstruct -- --infer p2` (your team known) or `--infer both` — every spread the replay could have come from, and the events that removed the rest, §7.5. |
| Closed team sheets (Task 8) | **STARTED.** A replay with no sheet has the opponent's sets read off the log, every assumption named, and an assumption the log rules out reported as such, §7.6. Unrevealed items and natures as candidates are next, §9. |

Nothing in §§1–6 needs re-deriving. It was established by experiment on a real battle, and
the scripts that establish it are checked in and re-runnable.

### Hard scope guards

Do not build any of these. If a task seems to require one, stop and ask.

- **No AI, no engine, no evaluation function, no move recommendation, no search.**
- **No opponent bot.** The human plays both sides.
- **No original battle mechanics.** Never write damage, accuracy, turn-order, or status
  logic. Showdown's simulator is the sole source of truth. If mechanics look wrong, the fix
  is upstream or in a config, never a reimplementation.
- **No fork of Showdown.** Consume it as a dependency. Read its source freely. Change only
  `config/`, and only through `provision-local-server.mjs`.
- **No custom battle UI.** The native client is the UI (§5.9). If you find yourself writing a
  move button, stop.

### Working style

- Small commits, one per task.
- Every open task has an acceptance criterion. Do not proceed past a failing one — report.
- Tasks marked **STOP** end the session with a written finding.

---

## 1. The answer, and what backs it

**A 100% recreatable battle log is achievable on a server we host.** Verified end to end on a
five-turn damage-heavy Champions doubles battle:

- `battle.inputLog` round-trips byte-identically through a fresh `BattleStream`.
- 126 protocol lines from an independent re-simulation match the server's omniscient log
  exactly, after room noise is filtered (§6.2).
- Every recovered Stat Point spread sums to 66; the arithmetic is exactly invertible (§2.2).
- No HP figure anywhere in the log is a percentage — both sides are exact.
- Recovered Stat Points reproduce every max-HP integer independently: Gengar 167,
  Sinistcha 177, Incineroar 202, Politoed 197, Glalie 157, Whimsicott 167, Gholdengo 164,
  Metagross 157.

`npm run replay` re-runs the whole chain — provision, play, re-simulate, diff, render — and
prints the report.

**The public ladder remains a NO** and is a separate problem. `/exportinputlog`
(`server/chat-commands/core.ts:822`) requires *both* players to consent via
`/allowexportinputlog` (`:804`). We bypass it locally only because we are `~` on our own
server. Nothing about hosting our own server changes what other people's replays expose.

---

## 2. Verified facts — do not re-derive

### 2.1 Format IDs

| Format | ID |
|---|---|
| VGC 2026 Reg M-C (primary target) | `gen9championsvgc2026regmc` |
| VGC 2026 Reg M-B (every battle in `recordings/` so far) | `gen9championsvgc2026regmb` |
| Doubles Custom Game (sandbox) | `gen9championsdoublescustomgame` |

Reg M-C is the `champions` mod itself. Reg M-B is `championsregmb`, whose `scripts.ts` is
`{ inherit: 'champions', gen: 9 }`: it overrides only data (items, learnsets, formats-data, and
the PP of Strength Sap and Wish), so the mechanics are shared. Build against `champions`; Reg M-B
follows automatically. Upstream removed the Reg M-A formats when it added M-C (`812501ede`,
2026-09-09).

### 2.2 Champions stat model — exact, no rounding

`data/mods/champions/scripts.ts` → `statModify()`, level-50 path:

```
HP     = baseStat + StatPoints + 75
others = baseStat + StatPoints + 20      → then nature
```

Nature applies afterwards with 16-bit truncation: `trunc(trunc(stat * 110, 16) / 100)` for a
boost, `* 90` for a drop.

**1 Stat Point = exactly 1 final stat point.** No division, no EV conversion. Stat Points are
*stored* in `set.evs` but the arithmetic is native. The map is exactly invertible — which is
why the max-HP check in §1 is a real proof and not a coincidence: an off-by-one anywhere in a
spread shows up as an off-by-one in the HP integer.

Exception, out of scope: rulesets with `levelclausemod` (Draft only) use
`max(2 × SP − 1, 0)` in the mainline formula. VGC does not use this.

### 2.3 Validation

`sim/team-validator.ts`, triggered by `dex.currentMod.startsWith('champions')`:
- 32 Stat Points max per stat
- **All IVs must be exactly 31** or the team is rejected
- Budget 66, set at `sim/dex-formats.ts:349`, only when the EV Limit rule resolves to `Auto`

### 2.4 Champions caps all moves at 20 base PP

The mod's `init()` clamps every move with `pp > 20` down to 20. Max PP still follows
`(pp / 5 + 1) * 4`. This changes PP-stall maths — do not assume mainline PP values anywhere.

### 2.5 The sim core is browser-safe

Zero Node builtin imports in `battle.ts`, `state.ts`, `pokemon.ts`, `field.ts`, `side.ts`,
`battle-stream.ts`. Only `sim/dex.ts` uses `fs`/`path`, purely to load data off disk.

### 2.6 Public API surface

Exported from `sim/index.ts`: `Battle`, `BattleStream`, `getPlayerStreams`, `Pokemon`,
`PRNG`, `Side`, `Dex`, `toID`, `Teams`, `TeamValidator`.

**`State` is NOT exported.** Use `Battle.toJSON()` / `static Battle.fromJSON()`.

### 2.7 Seeds are strings, not arrays

`PRNG`'s constructor takes a string. Seeds beginning `sodium,` use `SodiumRNG`; otherwise the
Gen 5 RNG. Legacy array seeds from old input logs are joined with commas — handle both when
parsing input logs, emit strings.

**Do not regenerate teams from a seed.** Upstream issue #10162: the team generator is not
stable across versions, so a seed does not pin a team. Read the packed teams out of the
`>player pN` lines of the input log instead, which is what `local-replay.mjs` does.

---

## 3. Channel −1 is the entire answer to "full information"

This is the single most useful thing learned. Showdown already computes an omniscient log; it
simply does not hand it to spectators.

| Call | What you get |
|---|---|
| `getLog(0)` | spectator view — **HP as percentages** |
| `getLog(N)` | one player's view |
| `getLog(-1)` | **omniscient — exact HP for both sides** |

- `battle.getDebugLog()` (`sim/battle.ts:3154`) is exactly
  `extractChannelMessages(this.log.join('\n'), [-1])` (`:35`).
- `getScrollback(-1)` (`server/rooms.ts:1966`) resolves every `|split|pN` block to its secret
  line, leaving a **flat, ordinary protocol log**.

The consequence that matters: an omniscient log needs **no client modification**. The standard
replay player renders it as-is, because the secret lines are shaped identically to the public
ones. Any future viewer gets exact HP for free.

Omniscient logs are officially sanctioned upstream (Zarel) — this is not a hole being abused.

### 3.1 `Config.logchallenges` — the one-line unlock

`server/room-battle.ts:851` only calls `logBattle()` for **unrated** challenge battles when
`Config.logchallenges` is set. Without it, `logData` — and the input log with it — is discarded
the instant the battle ends, and the server writes no log file at all. It is set in
`scripts/provision-local-server.mjs`.

Anything that depends on reading a finished battle's input log depends on this flag.

---

## 4. RNG control — the working mechanism

**Tier 1 (scripted RNG injection) works and is the only tier needed.** Seed search was never
required. `forceRandomChance` is confirmed useless for our purpose: it is `readonly`, set once
at construction, gated on `debugMode`, and forces *every* `randomChance()` call to one boolean.

The engine lives in `scripts/server/rng-command.js`, the tooltips in
`scripts/client/rng-panel.js`, and `scripts/lib/rng-control.mjs` is the same engine's ESM face
for Node. There is **one** interceptor, and a draw is addressed one of two ways:

| | Says | Written as | Used by |
|---|---|---|---|
| **rule** | *what* should happen, and lets the interceptor find the draw that fits | `>rng force crit p1:glalie icespinner -` | a live room, where an operator names an outcome from a tooltip or by typing `/rng` |
| **pin** | *which* draw, by ordinal since installation, and the value it takes | `>rng at 3=5 17=0` | reconstruction (§7), rebuilding a battle whose dice have no names yet |

A rule is an **intention**; a pin is an **observation**. That distinction is not decorative —
it decides what happens to each at a branch point (§4.2, last item).

The operator arms a rule without typing: hovering a move offers its accuracy, crit, damage-roll,
secondary and multi-hit draws, and hovering a Pokémon offers its chance ability, chance item,
status durations and speed tie. The surface is the vanilla tooltip, extended in the client,
because the control has to appear where the operator is already looking — on the move they are
about to click — and a server-pushed `|uhtml|` box cannot follow a pointer. The cost is that
boxes carrying controls have to take the mouse and stay up while the pointer crosses the gap
upstream leaves between button and box.

**The battle runs in the server's own process.** `Config.subprocesses = 0` makes
`server/config-loader.ts:94` write `0` for every process type, so `room-battle.ts:1369` spawns
no simulator worker and `lib/process-manager.ts:632` falls through to `_createStream()`. The
`Battle` is then reachable as `room.battle.stream.battle`, and the command mutates it directly.

This is why there is no `>eval`. Going through the stream would work, but
`sim/battle-stream.ts:136` writes every eval'd string into the battle log as `>>> …` — the
interceptor alone would dump ~200 lines of its own source into the room on first arm, and
importing such a recording needs console access. Direct access has neither problem.

What `>eval` did give away for free was the recipe: it pushes each line into `battle.inputLog`
before running it. Direct mutation records nothing, so **`>rng` is taught to the input-log
grammar instead** (`teachStream`), and every arm, pin and clear is appended by hand. A
controlled draw is then an ordinary recipe line — `>rng force crit any - -`, `>rng at 3=5` —
that `truncateAtTurn`, `/importinputlog` and a plain re-simulation all carry. `RoomBattleStream`
overrides `_write` but not `_writeLine`, so patching the prototype reaches the server too.

**This is the argument reconstruction lost.** A headless rebuild has none of the objections to
`>eval`: nobody is watching the room, and one short line written before turn 1 is not 200 lines
of source. It shipped with `>eval` on those grounds and they were true. What they missed is that
the *output* is not headless — a reconstructed recording is fed straight to `npm run live` and
**Play from here**, where its `>eval` echo does land in a room a person is watching, and where
`/importinputlog` demands console access to accept it. Granting console to the default group was
the price, and it is no longer paid: with `>rng at`, nothing this project writes contains a
`>eval`, and `provision-local-server.mjs` grants `importinputlog` and nothing else.

### 4.1 One interception point covers every draw

Every random decision in a battle is one `prng.rng.next()` call, and every caller reaches it
through `PRNG.random`: `randomChance(n, d)` is `random(d) < n` (`sim/prng.ts:116`),
`sample(items)` is `random(items.length)`, `shuffle` is repeated `random(a, b)`. Nothing in
`sim/` or `data/` calls `rng.next()` directly. **`random` is the only funnel**, so wrapping that
one method on the live `PRNG` covers the whole simulator, mods included, with nothing pinned to
a line number that moves on upgrade. `randomChance`, `sample` and `shuffle` are wrapped too, but
only to record what was asked for — a pin needs none of them and pays for none of them.

Wrap `random`, not `next`. At `random` the denominator, the offset and (through the wrappers
above it) the numerator and the sampled array are all in hand, so a forced draw is an integer
returned directly. `next` sees a bare 32-bit number: forcing a value there means converting
through `floor((v + 0.5) * 2**32 / d)`, and it never sees the array a `sample()` was handed.

Recording what `randomChance` and `sample` were asked for is what lets a rule say "make this
proc" or "make this three hits" with no probability and no hit-count table written down
anywhere — which matters, because Champions changes the odds: paralysis is **1/8**, sleep
duration is **`sample([2, 3, 3])`** (`data/mods/champions/conditions.ts`). Nothing in the
interceptor notices, because nothing in it knows the numbers.

**Every rule-matched draw identifies itself.** A stack frame names the function that asked, and
the simulator's own context says what it was for — `battle.effect`, `battle.activeMove`,
`battle.activePokemon`, `battle.activeTarget`, saved and restored around every handler dispatch
(`battle.ts:631/647/900/906`). The interceptor's own frames are dropped, and so are `PRNG.*` and
the `Battle.random` / `randomChance` / `sample` pass-throughs. The first frame left is the site.
`dist/` is esbuild output with function names unmangled, so this survives compilation.

None of that runs for a pin. Capturing and parsing a stack trace is the expensive part of this
mechanism, and an ordinal is already an answer, so pins are checked first and a battle driven
entirely by pins — every reconstruction — never builds a context at all.

| Draw | Site | What it asks for |
|---|---|---|
| accuracy | `hitStepAccuracy` | `randomChance(accuracy, 100)` |
| crit | `getDamage` | `randomChance(1, critMult[ratio])` |
| damage roll | `randomizer` | `random(16)` |
| secondary | `secondaries` | `random(100)` |
| self-boost | `selfDrops` | `random(100)` |
| multi-hit count | `hitStepMoveHitLoop` | `sample`, 20 entries or 8 with Loaded Dice |
| ability / item proc | the handler, `battle.effect` set | whatever it asked for |
| status and volatile ticks | the handler, `battle.effect` set | whatever it asked for |
| random target | `randomFoe`, `getRandomTarget` | live targets |
| speed tie | `speedSort` | `shuffle` |

Secondary and self-boost are both `random(100)` inside the same move and are still told apart,
because different functions ask for them.

### 4.2 Design points that are not obvious

**Always draw from the real RNG.** The wrapper calls the real `random()` on *every* call and
substitutes its own value only for an armed draw. This keeps the stream aligned, so no
unrelated decision shifts. Skipping the real draw would silently perturb the rest of the turn.

**An effect is never enough on its own.** Confusion draws a duration, then a coin flip every
turn, then a damage roll if it connects — three unrelated numbers, all carrying
`battle.effect.id === 'confusion'`. Matching on the effect alone hijacks all three, and the two
it was not aimed at fail quietly in the operator's favour. Every outcome pins the handler as
well: `confusion` + `onBeforeMove`, `stall` + `onStallMove`, `par` + `onBeforeMove`.

**Force a value, not a bit pattern.** At the `random` level the extremes are just `0` and
`d − 1`, a specific band is its own index, and a `random(from, to)` draw needs `from` added back
on the way out. `sample()` is the same mechanism one level up: "three hits" is
`items.indexOf(3)`, and "shortest sleep" is the index of the smallest entry.

**Forcing is not always possible, and it has to say so.** A 100%-accuracy move draws
`randomChance(100, 100)`, which cannot be made false; Icicle Spear cannot hit nine times; the
first Protect in a chain never draws at all. The interceptor reports `always-true`,
`always-false` and `unreachable` per draw rather than substituting something close.

**`>reseed` replaces the generator, it does not reseed it.** `sim/battle.ts:219` assigns
`this.prng = new PRNG(seed)`, so anything installed on the old `prng` object goes with it.
Install through an accessor on `battle.prng` that re-runs on every assignment. Without that,
control dies at the first `>reseed` **silently** — the battle keeps running, no further draw is
ever matched, and nothing reports it. This is not a corner case: every recording produced by
branching carries a `>reseed`. The interceptor counts reseeds and counts draws since the last
one, and `npm run replay -- --force` installs *before* the reseed on purpose, so a broken
accessor shows up as a failed check rather than as a battle that quietly does nothing.

**A controlled battle is manipulated by definition, and the recipe is the only place it shows.**
The input log carries every arm as a plain `>rng` line, so replaying the recording re-arms the
same rules and re-forces the same draws. The battle log itself says nothing: arming produces no
message and a substitution produces no message, because the tooltips already show what is armed
and marking it twice is noise. `/rng log` reports the accounting on demand.

**Round-trip is no longer free.** With `>eval` gone, nothing writes the recipe automatically —
`arm()`, `pin()` and `clear()` push to `battle.inputLog` themselves. Miss that and a controlled
recording still *renders* correctly, because a `.log.json` stores the played `log` alongside the
`inputLog`; what breaks is everything that re-simulates the recipe. `npm run replay` reports the
recording as divergent, and "Play from here" lands on a position with different HP from the page
the button was clicked on, silently. `/rng log` prints `recorded=N` so the count is visible.

**A rule survives a branch; a pin must not.** Ordinals keep counting across a `>reseed` — the
interceptor is installed on `battle.prng`, not on the generator — so a pin written for turn 9 of
a recording will happily fire on whatever the *branch* draws ninth-turn-ish, in a position an
operator is playing by hand, with nothing on screen to say so. Measured on the ten-turn Bo3
reconstruction cut at turn 6: **10 of its 22 pins landed on re-rolled dice.** `truncateAtTurn`
therefore drops every pin past the draw the prefix stopped at (`trimPins`), which is a thing it
can only do because it already replays the prefix a line at a time (§5.8) and so knows the
count. Rules are left alone deliberately: a rule describes an outcome the operator wants next,
which is exactly what should carry into a branch.

The trimming is unconditional, not just on reseed, so that one truncation of one recording is
one set of lines — `verify-branch.mjs` recomputes the prefix and compares it against the log the
room actually played, and the two agree only if both trimmed the same way.

The simulator computes every consequence itself. Nothing in this mechanism writes damage, sets
a status, or decides a hit.

### 4.3 The damage ladder is sparse — and this killed post-hoc editing

The 16 damage rolls do not produce 16 distinct damage numbers. On the fixture, a base-42 hit
had a reachable ladder of **39 / 40 / 42 / 43 / 45 / 46** — deltas of 1, 3 and 4 only.
**A delta of 2 or 5 is unreachable.**

Bigger hits are sparser, not denser, because the gaps scale with the number. Measured live,
Incineroar's Flare Blitz into Metagross:

```
plain   146 144 144 140 140 138 138 134 134 132 132 128 128 126 126 122     9 distinct
crit    218 216 212 210 210 206 204 200 200 198 194 192 192 188 186 186    12 distinct
```

Sixteen of the numbers between 122 and 146 cannot be rolled at all. This is why a damage
control is a slider over the sixteen *rolls* labelled with their damage, never a number field:
every position is reachable by construction, and the gaps show up as jumps.

The crit row above is the same sixteen calls with `willCrit: true`. The crit multiplier is
applied *before* the random factor (`battle-actions.ts:1750` then `:1755`), so arming a crit
relabels the whole ladder — and crit is the only rule that does, since multi-hit does not change
per-hit damage and accuracy does not change damage at all.

This is why editing the number in the log directly is the wrong mechanism. It can write `44`,
a damage value **no roll can produce** — a log internally inconsistent with its own seed, which
fails any honest re-simulation. Roll selection is the only sound approach, and it is what
shipped: `/rng force roll0`..`roll15`, `mindmg`, `maxdmg`. "Deal exactly N damage" did not.

Consequences for the branch UI:
- "Deal N more damage" is **not always a legal request.** Enumerate the reachable ladder and
  present that set, not a free-text number.
- Enumerating the ladder costs **16 dry-run `getDamage` calls**, not 16 replays. `damageLadder`
  runs them in-process against the live battle with four guards: a cloned move, `willCrit` set
  explicitly, `suppressMessages` on so `modifyDamage` writes no `-supereffective` line
  (`battle-actions.ts:1799`), and the interceptor in dry mode so the generator is never touched.
  `stellarBoostedTypes` is snapshotted and restored, because `:1779` mutates it mid-calc.
  Measured live: 48 dry runs left `draws=0`.
- Filter for reachability *and* for intent: a roll that turns a non-lethal hit lethal changes
  the battle, which may not be what was asked for.

Measured on the fixture: Moonblast #3 forced from roll 7 to roll 1 (42 → 45) and Moonblast #4
from roll 4 to roll 10 (43 → 40). **Exactly one battle line differs** across the entire log — `|-damage|p1a: Incineroar|115/202` becomes `112/202`. Everything else is
identical, including the winner.

---

## 5. Branching past a material divergence — where Layer A ends

Forcing one decision and re-simulating tells you what that decision was worth. Four branches
on the fixture, one per draw kind:

```
TRUNCATED  Meteor Mash misses
CLEAN      Meteor Mash does not raise Attack
TRUNCATED  Matcha Gotcha never burns
TRUNCATED  The first Moonblast crits
```

Three of four outlived the recorded choices. That ratio is the point of this section.

### 5.1 The rendering never breaks. The input log does.

The replay is **regenerated from scratch** on every run — a fresh simulation from `>start`,
then `getDebugLog()` of the *new* battle. Nothing is spliced or patched, so the output is
always a complete, self-consistent log of a game that could have happened. Confirmed in
headless Chrome: a truncated branch still builds its battle DOM and full control bar.

What runs out is the **input log**, which holds only the choices that were legal in the
*original* battle. Past a material divergence:

```
baseline tail                          crit-branch tail
|-damage|p2a: Metagross|0 fnt|brn      |-damage|p2a: Metagross|13/157 brn
|faint|p2a: Metagross                  |-end|p2a: Metagross|Throat Chop|[silent]
|win|Ghosts9102                        |upkeep          <- stops, awaiting turn 6
```

Metagross survives on 13 HP, so there is a turn 6, and no choices were ever recorded for it.
The log ends on `|upkeep` with no `|win|`. This is a **correct partial battle, not a corrupt
one** — the replay plays up to the divergence and stops.

### 5.2 Three verdicts

| Verdict | Meaning | Detection |
|---|---|---|
| `CLEAN` | recorded choices stayed legal, battle still finished | `battle.ended` |
| `TRUNCATED` | battle outlived the recorded choices | `!battle.ended` |
| `REJECTED` | a recorded choice became *illegal* in the new position | `error` line on the side channel |

`REJECTED` has never fired — the fixture is too short. It needs a battle where a recorded
switch targets a Pokémon that is now already active, or a recorded move belongs to a Pokémon
that is now fainted. **Build a longer fixture before trusting that path.** Note that choice
errors appear *only* on the side channel and never in the battle log, so they must be captured
from the stream chunks.

### 5.3 CLEAN vs TRUNCATED is not about the size of the edit

Removing Meteor Mash's Attack boost is a genuine mechanical change, and it altered exactly one
line — same winner, same six faints, same order. A tangible edit that happened not to matter.
The predictor is not magnitude; it is **whether the edit changes who is still standing when
the recorded choices run out.**

### 5.4 Stream alignment does not mean downstream identity

Substituting a draw provably does not shift the stream (§4.2). But once the *position*
diverges, the simulator makes a **different number of draws for different purposes**. The crit
branch gained `|-crit|p1a: Gengar` and *lost* the baseline's crit on Gholdengo, which then
picked up a burn it never had.

That is not a leak in the mechanism. Alignment guarantees the substitution itself perturbs
nothing; it cannot guarantee that a different game rolls the same dice for the same events.
Past the divergence you are in a different battle, faithful to itself rather than to the
original.

### 5.5 Why this is the handoff point, not a bug

Truncation is not a defect to fix. It is the precise line where replaying recorded choices
stops being possible and the branch UI has to take over and ask for the next move. This is the
concrete, demonstrated reason `plan.md` §5 has the human pilot **both** sides: past a material
divergence there is no recorded choice to fall back on, by construction.

### 5.6 Piloting both sides is not new work — it already works

Spiked and confirmed. Stop the replay at turn 4, then write our own choices for both sides:

```
>p1 move partingshot +1, move lifedew        <- neither is in the recorded input log
>p2 move psychicfangs +1, move tailwind
   -> turn 5, no choice errors, real protocol output
```

Four facts this establishes, all of which shorten Task 5:

- **`>pN <choice>` is symmetric.** Replaying an input log *is already* piloting both sides —
  every `>p1` / `>p2` line is a choice we author. There is no one-sided-player problem to
  solve here. The one-sidedness in `ws-player.mjs` is only about driving the real server to
  *generate* a fixture; branching never touches the server.
- **The branched battle extends its own input log.** After our two writes, `battle.inputLog`
  had grown by exactly those two lines. So a branch is savable, replayable and re-branchable
  with no new machinery — recursion for free.
- **Legality is dynamic.** The spike asked for Fake Out and could not have it — Incineroar was
  not freshly sent out — so it fell back. Any UI must render options from the live request, not
  from the set's movelist.
- **`|-heal|` and friends appear twice**, once exact and once as a percentage, because the log
  carries both halves of the split. `getDebugLog()` resolves to the exact one (§3).

### 5.7 Read legal choices from `activeRequest`, never from scraped chunks

This one cost real time in the spike and would have cost hours in Task 5.

`battle.sides[i].activeRequest` is **synchronous, authoritative and always current.**

Scraping `|request|` lines out of the stream's `sideupdate` chunks is not. There is a drain
race: the `for await` iterator has not necessarily yielded by the time control returns from
`await stream.write(...)`, so a chunk-scraped view lags. In the spike it produced only 3
requests per side instead of the expected count, and the newest one it had was two turns stale
— it offered Gengar's moves while Incineroar was the active Pokémon. Building a choice from
that wrote a silently-ignored no-op: **turn did not advance, and no error was emitted.**

Silent no-ops are the failure mode to design against. Assert that `battle.turn` advanced, or
that `requestState` cleared, after every choice you write.

### 5.8 Turn boundaries are not derivable by counting

Do not slice the input log by index arithmetic. Choice lines do not map one-per-side-per-turn:
line 13 of the fixture is `>p2 switch 4, pass`, a **mid-turn faint replacement**, not a turn
choice. Replay one line at a time and watch `battle.turn` — that is the only reliable way to
land on a turn boundary.

### 5.9 The branch is played in the real battle UI, not a terminal

`npm run live` puts a truncated position into a live server room and opens two browser
windows on it, one per side. The mechanism and the upstream call sites it leans on —
`/importinputlog` starting a room mid-game, granting that permission without a rank, the two
isolated browser profiles one user cannot do without, joining a slot without disturbing the
battle — are in `branching.md` §2 and §3, along with the one thing that breaks it.

### 5.10 Branching from the replay view

The replay page carries a **Play from here** button that branches the turn on screen through
the same launch path as `npm run live`. How the button is drawn by the player rather than
beside it, how the input log rides in the page, and the endpoint that receives it are in
`branching.md` §4. `>reseed` — the only way to keep a position and change the rolls — is
`branching.md` §2.2.

---

## 6. Traps that cost real time

### 6.1 `>pN default` produces an unreplayable input log — an upstream defect

`sim/side.ts:660`: `/choose default` sets `autoChoose`, which sets `targetLoc = 0` and
**skips the target requirement entirely**. `getChoice()` then records `move memento` with no
target. Replaying that line takes the explicit path, which demands a target, and the choice is
rejected. The input log is unreplayable.

Two ways a `default` choice reaches the sim:

- Any client that sends `/choose default` directly. Verified: this is what produced an
  unreplayable log here.
- `server/room-battle.ts:452` writes `>pN default` on turn-timer expiry, but only while
  `timeoutAutoChoose` is on. It defaults to `false` (`:202`) and is enabled only by an explicit
  `timeoutautochoose` ruleset (`sim/dex-formats.ts:328`). No shipped format includes it, and
  `data/mods/champions/rulesets.ts:26` has it commented out — so this path is dormant for VGC.

The defect appears to be unreported upstream. The rule: never send `default`.

Three consequences:
- Our scripted players must **never** send `/choose default`. Always send an explicit target.
  `scripts/lib/ws-player.mjs` tracks living slots from `|switch|`/`|drag|`/`|replace|`/`|faint|`
  so it can always name one, and logs a choice error rather than falling back.
- Choosable targets are `normal`, `any`, `adjacentAlly`, `adjacentAllyOrSelf`, `adjacentFoe`.
  Everything else takes no target and appending one is an error.
- For future ingestion: some real replays are unreplayable through no fault of ours. Detect it
  and say so rather than failing obscurely.

### 6.2 Protocol-diff hygiene

Room logs carry chat, joins, html, and `t:` wall-clock ticks. Two replays of the same battle
run a second apart differ on nine lines for no mechanical reason. Route **both** sides of every
comparison through the one shared `battleLines()` in `scripts/lib/protocol.mjs`; do not
hand-roll a second filter. Also: the server appends a rating field to `|player|` that the sim
does not emit — truncate to five fields.

The same filter drops what a room adds that the simulator never prints: the `|-message|… forfeited.`
before a forfeit's `|win|`, and the `#rng` messages of the retired `>eval` controller. And the
ladder runs upstream's latest simulator, not this project's pinned one, so a public replay can
word an event differently: an ability that stops a stat drop names the stat by id there
(`unboost|atk`) and by name here (`unboost|Attack`). Both sides are brought to the newer wording.
`|rated|`, which a ladder game prints before turn 1 and which decides nothing, is compared
softly with the other pre-turn lines (§7).

### 6.3 The vendored client is not usable in a browser

`scripts/lib/replay-html.mjs` emits the same shell as a downloaded Showdown replay, with two
deliberate deviations, both documented in the file. **A fully offline replay is not possible
from the checkout as it stands:**

- `config/config.js` is a placeholder whose contents are literally the text
  `../../config/config.js`
- `data/pokedex-mini*.js` do not exist in the checkout
- `js/battledata.js` references `BattleTextParser` 41 times without defining it — it lives in
  `js/battle-text-parser.js`, and upstream deploys a concatenated bundle
- `battledata.js:70` is `window.exports = window`, so every data file must load *after* it

So the player loads from upstream `https://play.pokemonshowdown.com`. `--embed <url>` is the
escape hatch if a local build ever exists. Building that bundle is the only route to offline.

Also: the container must **not** carry `class="wrapper"`. `Replays.init` in `replay-embed.js`
only builds `.battle` / `.battle-log` / `.replay-controls` when no `.wrapper` element exists —
with it, the page renders nothing at all and gives no error.

### 6.4 Environment

- Node v24.19.0 lives at `C:\Program Files\nodejs\node.exe` and is **not** on the PATH in
  either Bash or PowerShell. Prefix: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.
- Challenges arrive as a `pm` line carrying `/challenge <formatid>`, **not** as
  `updatechallenges`.
- Local config needs `noguestsecurity` for guest `/trn` with an empty assertion, and
  `logchallenges` (§3.1).
- Team preview honours `request.maxChosenTeamSize`, but VGC still requires **six** Pokémon on
  the team even when only four are brought. A four-mon team is rejected at validation.
- `BattleStream` requires `>`-prefixed lines. `version` / `version-origin` are no-ops.
- Headless Chrome `--dump-dom` returns 0 bytes when captured with `>` or a pipe. Use
  `Start-Process -Wait -NoNewWindow -RedirectStandardOutput`.
- Write generated files with the Write/Edit tools, not bash heredocs or Python
  string-replacement — the content is full of backticks and `${}`, and quoting failures are
  silent or cryptic.

### 6.5 Undocumented surface — the upgrade risk register

`prng.rng`, `battle.randomizer`, and `actions.getDamage` / `hitStepAccuracy` / `secondaries` /
`selfDrops` are **internal**. `sim/SIMULATOR.md` documents only the `seed` start option and
promises no reproducibility at all. The `RNG` interface is not exported, so it must be
duck-typed structurally.

Reconstruction (§7) leans on more that are just as undocumented:

| Surface | Why it matters | Site |
|---|---|---|
| `PRNG.random` is the only caller of `rng.next()` | makes one wrapper total coverage | `sim/prng.ts:92` |
| `getHealth`'s Champions branch uses `floor`, not `ceil` | sets the width of every HP band | `sim/pokemon.ts:2060` |
| a set with no gender rolls one from the battle PRNG | forces the install point, §7.2 | `sim/pokemon.ts:340` |
| `BattleStream._writeLine` dispatches on the verb, and `RoomBattleStream` does not override it | is what lets `>rng` become a recipe line in both venues, §4 | `sim/battle-stream.ts`, `server/room-battle.ts` |
| a locked Pokemon still gets a request, with one move and **no target field** | naming a target for it is refused outright | `sim/pokemon.ts:965`, `:1084` |
| `extractChannelMessages` is not re-exported by `sim/index.ts` | reached via `dist/sim/battle.js` | `sim/battle.ts` |
| the damage roll is `battle.randomizer` (on the battle, not the actions), its one draw | steering brackets it and inference records its ordinal, §7.3 | `sim/battle.ts:1975` |
| the crit is the one `battle.randomChance` inside `getDamage` before the roll; accuracy is one per target inside `hitStepAccuracy`, with that target in `activeTarget`, and a miss prints `-miss\|user\|target` | each is read off the observed turn, §7.3 | `sim/battle-actions.ts:1397`, `:586` |
| `attrLastMove` appends `[spread]`, `[miss]` and `[still]` to the move line after the hits | a move line in flight is a prefix of the observed one | `sim/battle.ts:2575` |
| `Battle.toJSON()` / `Battle.fromJSON()` round-trip a battle between turns, and a restored battle takes its `send` from `restart` | a probe starts from a snapshot of its turn; the interceptor's state is kept beside it, not in it, because the serializer refuses the generator | `sim/state.ts`, `sim/battle.ts:1615` |
| a forfeit is `\|-message\|<name> forfeited.` in the room and `>forcelose` in the recipe, which prints the `\|win\|` | a battle that ended with no Pokemon deciding it ends in the rebuild the same way | `server/room-battle.ts` (`forfeitPlayer`) |

Stat Point inference (§7.5) hooks the simulator at more internal points than anything else here:

| Surface | Why it matters | Site |
|---|---|---|
| `actions.getDamage` computes everything stat-dependent, then hands one number to `actions.modifyDamage` | the dry run re-enters the first, and memoises the second on that number | `sim/battle-actions.ts:1585`, `:1724` |
| `battle.spreadDamage` runs the `Damage` event before `pokemon.damage`, and heals drain inside itself from the damage taken | Focus Sash is re-asked per candidate from state captured at entry; drain is a dry call of it | `sim/battle.ts:2091`, `:2174` |
| `battle.heal` receives the untruncated amount | a non-integer amount proves an HP fraction, which is what lets it scale | `sim/battle.ts:2261` |
| `pokemon.damage`, `heal` and `sethp` are the only writers of `hp` | every HP change is seen, silent ones included | `sim/pokemon.ts:1595-1666` |
| `actions.applyRecoilDamage` computes and applies recoil in one call | each candidate's recoil is a dry call of it | `sim/battle-actions.ts:1379` |
| the queue is sorted by `queue.sort`, then run head-first by `battle.runAction`, and re-sorted before each move | "acted first" is read off the last sort before the action | `sim/battle-queue.ts:418`, `sim/battle.ts:2918` |
| `fieldEvent` (switch-in, end of turn) and `eachEvent` (weather, `Update`) sort by `battle.speedSort`, then dispatch each handler through `singleEvent` / `runEvent` | an event's order and each handler's lines are read off those calls | `sim/battle.ts:267`, `:293`, `:310` |
| a handler sorts by the Pokemon's cached `speed`, written only by `updateSpeed` and by `setSpecies` (the bare Speed stat, until the next update); a switch-in handler subtracts under one point for position | candidate speeds are taken at those writes; the fraction never reorders whole speeds | `sim/pokemon.ts:283`, `:1005`, `sim/battle.ts:767` |
| a held item's pinch check is its own `onUpdate`, run from `eachEvent('Update')` | the check is asked dry, per HP, of the item alone | `data/items.ts` (`sitrusberry`) |
| confusion damage is `actions.getConfusionDamage`, the user's own Attack and Defence and one `randomizer` draw | a self-hit is asked per candidate like any hit | `sim/battle-actions.ts:1533` |
| a move's own effect runs as `singleEvent('Hit', move, …)`; Strength Sap reads `getStat('atk', false, true)` before lowering it, Pain Split sets both HPs with `sethp` | each is re-run dry per candidate, before the real one | `data/moves.ts` (`strengthsap`, `painsplit`) |
| Wonder Room swaps the defences inside `calculateStat`, after the stat is named | the Stat Points a hit depends on are the other defence's | `sim/pokemon.ts:290` |
| Illusion copies the last Pokemon behind it in the party that has not fainted, and `\|replace\|` names the real one when a hit breaks it | who was really sent in is read through it, and the one it copied goes last in team preview | `data/abilities.ts` (`illusion`) |
| `faint()` does nothing to a Pokemon already queued to faint, and it is what sets HP to 0 | a dry run clears the flag for a candidate that is still standing | `sim/pokemon.ts` (`faint`) |
| `getActionSpeed` and `statModify` are replaced per instance by the Champions mod | speeds and stats are asked of the instance, never the prototype | `data/mods/champions/scripts.ts` |

`pokemon-showdown` is pinned to one upstream commit in `package.json`, not to an npm release:
play.pokemonshowdown.com runs upstream master, and npm releases lag it by months (0.11.11, the
last one, predates Reg M-C). A GitHub checkout ships no `dist/`, so `package.json`'s
`postinstall` builds it (`node build`, about a minute). The package still reports its version as
0.11.11; the commit is what identifies it.

An upgrade is a new commit in `package.json`, `npm install`, and a fresh `runtime/`:
`provision-local-server.mjs` copies over `runtime/` without deleting, so files upstream removed
would linger. Set the old `runtime/` aside, provision, and copy its `logs/` back, since that holds
recordings not yet archived to `recordings/local/`. Then the test is a diff of those call sites plus a
re-run of `npm run replay`, `npm run reconstruct -- --all --rung s2`,
`npm run reconstruct -- --all --rung s3` **and**
`npm run reconstruct -- --all --rung s3 --infer p2`, which exercise every one of them. Line
numbers in this document were last checked against commit `a5df827`.

---

## 7. Reconstruction — a battle from a replay and two team sheets

`npm run reconstruct` takes a source with **no input log** and writes one. Everything
downstream — `npm run replay`, `npm run live`, **Play from here** — then works on a public
ladder game with no changes at all, which is the whole point of the exercise.

| | |
|---|---|
| **Known** | both teams in full, Stat Points included, so every stat and every max HP |
| **Unknown** | the seed; every choice (a replay records *executions*, never decisions); the opponent's exact HP behind each percentage |

Champions shows opponent HP as `floor(100·hp/maxhp)` (`sim/pokemon.ts:2060` — `floor`, not the
usual `ceil`), so a reading pins the real value to a band about two integers wide. On a 186 HP
Blastoise a 1% band can hold exactly **one** integer, which is why the approximation is far
tighter than "a percent of error" suggests.

### 7.1 Settle the dice one at a time, never search for a seed

`>reseed` asks one seed to reproduce a whole turn at once, so its cost is the **product** of
every random event in that turn. Measured: recording 25's first turn needs four exact damage
rolls and two 20% procs jointly; **200,000 seeds over 497 seconds did not find it.** The same
turn settles in about five seconds when each draw is chosen separately, because that cost is
their **sum**. §4 said this in its first line — *seed search was never required* — and it is
worth restating: a failure here is never fixed by a bigger seed budget.

### 7.2 The dice are §4's, addressed by ordinal

Reconstruction owns no interceptor. It installs the one in §4 and addresses it by **pin** —
draw *n* takes value *v* — because a battle being rebuilt from someone else's replay has no
outcomes to name yet, only positions in a stream. Everything §4 establishes applies unchanged:
the real draw is always taken and only its result replaced, so settling one die never shifts the
ones after it; installation goes through an accessor on `battle.prng`, so control survives a
`>reseed`; and the answer travels as one `>rng at 3=5 17=0 …` line that `battle-stream` records
in `battle.inputLog`. That last property is the whole reason `npm run replay`, `npm run live`
and **Play from here** take a ladder game with no changes at all — the reconstructed log carries
its own recipe and re-simulates itself with no help from this project.

Two things belong to this path and not to §4:

- **The trace is a direct call, not a recipe line.** The search has to see *every* draw a turn
  threw before it can decide which to move, and none of that belongs in a log. `traceOn()`
  switches it on in-process; only the pins go through the stream, because only they are the
  answer. A reconstruction that needed to force nothing writes no `>rng` line at all.
- **Install between `>start` and `>player`.** `>start` builds the battle; `>player` builds the
  teams, and a set that states no gender rolls for one right there (`sim/pokemon.ts:340`).
  Pinning genders from the log instead *removes* a draw the real battle made and shifts every
  draw after it — that mistake cost three otherwise perfect reconstructions. It is also why the
  `>rng at` line sits between those two lines in every reconstructed log: ordinals count from
  installation, so moving that line renumbers every draw it names.

### 7.3 The search, and why it is also the sampler

Per failing turn, draws are settled in the order the simulator consumed them, since a die
cannot change a line already written. A turn is scored `[lines, fields]`: how far it got before
disagreeing, then how much of the disagreeing line is nevertheless right. The second component
is not cosmetic — a spread move needs its **target** draw and its **accuracy** draw changed
together, and neither alone moves the first component. A commit that only improves `fields` is
a guess, so it is held back until nothing improves `lines`.

A probe replays only the turn it searches. The first run up to a turn takes a
`Battle.toJSON()` snapshot where that turn begins — with the interceptor's draw count beside it,
because pins are addressed by ordinal — and every later run to that turn under the same earlier
choices and pins restores it instead of replaying the turns before. On the Bo3 game a restore
costs under a millisecond and replaying to turn 9 about 19, and the restored battle continues
byte-identically. A restored run carries the snapshot's recipe, not its own, so it produces no
input log; only runs from turn 0 do. The search is still built to make few probes:

- **Steering reads the dice off the observed turn** (`steerDice`). At the moment a hit is
  calculated the rebuilt turn has printed exactly what the observed one printed, so the observed
  turn says what this hit is about to print. The damage roll is bracketed by re-running
  `getDamage` dry per roll and asking the target's `getHealth` what it would print: HP after a
  hit only grows with the roll, so the rolls that fit are one run of the sixteen and a bisection
  finds its ends. Rolls that leave the same exact HP play out identically, so one of them is
  probed for all. The crit die agrees with the observed `|-crit|` or it does not, and each
  target's accuracy die with its `|-miss|`; a die that agrees has nothing to fix. A turn whose
  prefix already disagrees gets no steering and is searched in full.
- **Dice shown to print the wrong line go first, and together.** A spread move that missed one
  target and hit the other needs both accuracy dice moved — neither alone brings the line any
  closer — so every such die is set right in one probe before any is tried alone. That is what
  reproduces Bo3 game B's turn-3 Heat Wave.
- **A die thrown after the line the turn disagrees on is skipped**, except within a move line,
  which `attrLastMove` amends until the next action starts.
- **A probe is not repeated when nothing it depended on moved.** What changes between scans is
  the dice committed since; a die thrown after the line a probe failed on cannot reach that line,
  so the probe fails there again.
- **A refused choice after a line that already disagrees is that line's failure**, not a matter
  of legality: a Pokemon knocked out that the replay shows standing is then asked to be
  replaced, and nothing was. A last turn that printed everything it shows is reproduced, whatever
  the simulator is still waiting for — a replay can stop on a forfeit or the timer.

**Probes run ahead on worker threads.** A probe is a pure function of the snapshot it starts
from and the pins it is given, so the probes a scan is about to ask for, in the order it will ask
for them, go to a pool of workers first. The search itself is unchanged — one probe at a time,
same order, same budget — and a probe still waiting for a worker when it is asked for is taken
back and run on the search's own thread. What a reconstruction finds therefore never depends on
the thread count, only how long it takes: the S3 inference suite gives the same answer on one
thread as with thirteen workers. The pool is `os.availableParallelism()` less the search's own thread, and
there is none below two workers; `--threads <n>` overrides. `reconstruct.mjs` is the workers'
entry too, and a worker loads the simulator's data before it takes a probe.

**A battle that ended without a Pokemon deciding it** — a forfeit, the timer — ends in the
rebuild with `>forcelose` for the loser once everything before its `|win|` has printed. The
room's announcement is room text, and `battleLines` drops it.

**Illusion** prints one Pokemon as another — that one's name and details — until a hit breaks it
and `|replace|` names the real one. Who was really sent in, and who really acted, is read from
the log with every Illusion seen through (`unmaskIllusion`, `scripts/lib/protocol.mjs`); the turns
are still compared as shown, because the simulator prints the same disguise once the real
Pokemon is sent in from the same party order. Illusion copies the last Pokemon behind it in the
party that has not fainted, so the one it was shown as goes last in team preview, unless it led.
The evidence reads whose HP a line shows from the slot, not the name. An Illusion the log never
breaks is not seen through.

When several values reproduce the observation equally well, the one kept is drawn **uniformly
among them**. That is the whole of the HP sampler. A draw that matched on its own needs no such
treatment: the generator already picked it uniformly and it survived the comparison, which is
exactly a uniform draw from the consistent set.

Backtracking blames the turn that last **moved** the stuck Pokemon's HP — not the turn before
the failure. A Pokemon can sit at `35/100` through a Protect, a switch and two turns off the
field, so redrawing the previous turn changes nothing that matters. Within that turn only dice
that actually move its HP are candidates. Every other backtrack blames the *other* Pokemon the
failing line depends on, when its HP is hidden: a damage line depends on the attacker's HP too
(Water Spout, Eruption, pinch abilities), and a recoil or drain line on the victim's, since its
amount is the damage dealt.

### 7.4 Results

| Rung | Withheld | Result |
|---|---|---|
| S1 | the choices | **21/21** line-for-line |
| S2 | + the seed | **21/21**, 9 s for all of them |
| S3 | + the opponent's exact HP | **21/21**, 9 s; recording 23's own input log is refused by the simulator (§6.1), so its truth is a two-turn stub, reproduced to its last line |
| S4 | everything — a saved ladder replay | Bo3 game A **MATCH**, ten turns, 1.4 s; game B **MATCH**, six turns, 1.4 s |

The 21 are the battles in `recordings/local/`: fifteen scripted and six branched, two of which
branch the Bo3 game and end in a forfeit.

Recordings 100, 111 and 122 were played under the retired `>eval` controller, which wrote
`|-message|#rng …` lines into the battle itself; `battleLines` drops them. A replay saved by the
p2 player is read from p2's side: whichever side the log states HP outright for is the view.

Opponent HP across S3: exact on 182 of 183 readings, worst error **one point** — recording 23
aside, whose readings are held against a truth that stops after two turns. The S4 replay then
renders, every max HP checks out, and `npm run live --at 4` opens both sides in the real
client — which also confirms `P2_ALT`'s Stat Points as a side effect, since a wrong spread
could not have reproduced ten turns of percentages.

**Public replays.** Eighteen recent Bo3 games from the public replay server were the robustness
test for everything here. The server publishes a spectator's view — both sides as percentages —
and neither side's spreads, so they run with `--infer both`. The first pass reproduced 4 and
turned up what the recordings never had: sheets without nicknames or shininess (§7.5), the
ladder simulator's newer wording and `|rated|` (§6.2), Illusion (§7.3), a Focus Sash that the
scaffold's hit fell short of, a proved turn that kept standing a Pokemon the path had knocked
out, and an end-of-turn order the speed rules could not read (§7.5). With those fixed, **10 of
18** reproduce line for line. The other eight stop where two unknown sides leave the starting
guess too far off — a hit that has to knock out does not, an exact speed tie is decided both
ways, a disguise is sent in from a party order the log never shows — which is the frozen
`--infer both` (§10), not a one-sided case. They are scratch test material, not kept in `recordings/showdown/`.

A source that fails is never silently patched: the full log is still written, and the report
names the turn, the observed line and the rebuilt one.

### 7.5 Stat Points — inferred by elimination

`--infer p2` withholds the opponent's Stat Points, `--infer both` everyone's. A Bo3 replay's
`|showteam|` lines publish everything else but nicknames and shininess, which every line naming
the Pokemon prints and which are taken from there — so a Pokemon's unknown is six numbers, 0–32
each, at most 66 together — 136,663,185 spreads. Inference starts from all of them and removes each one
the simulator says could not have produced the log. The result is the whole surviving set, not
a guess: stat ranges, a spread count, and every event that removed something
(`inference.events` in the written `.log.json`) — with, for each Pokemon it cut, the count
before and after, every stat's range after, and which of those ranges it moved. A single-source
run prints the events too.

**The simulator decides everything.** One replay of a reconstructed input log is hooked at the
places a spread matters, `scripts/lib/inference/`:

| Hook | What is asked, per surviving spread |
|---|---|
| `actions.getDamage` | the damage all 16 rolls would do, from a dry re-run in the real position (§4's `damageLadder` guards: cloned move, no dice consumed, no messages, state restored) |
| `pokemon.damage` / `heal` / `sethp` | where each candidate's exact HP moves to — then only what `getHealth` would print as the next line survives |
| `queue.sort` → `battle.runAction` | each candidate's `getActionSpeed`, so "acted before X in the same bracket" becomes a speed bound |
| `fieldEvent` / `eachEvent` → `speedSort` | the same for switch-in abilities, end-of-turn effects and weather's pass over the field, at each candidate's speed as `updateSpeed` cached it |
| `runEvent('Update')` | whether the held item's own `onUpdate` fires at each HP, so a pinch Berry that fired or stayed uneaten keeps only the HP on its side of the edge |
| `actions.getConfusionDamage` | a confusion self-hit's sixteen rolls for every surviving Attack and Defence of the Pokemon itself |
| `singleEvent('Hit', move)` | before the real effect: Strength Sap's amount for every surviving Attack of its target, and Pain Split's outcome for every HP the hidden Pokemon could be on |

The opponent's HP is a percentage, so a candidate is not one HP but the **set** of exact values
it could be on, carried hit to hit. HP, Defence and Special Defence are one joint key, because
they are what decides that set; Attack, Special Attack and Speed are flat. That is 35,937 keys and
three 33-value domains per Pokemon, and a whole pass is one replay of about 30 ms plus the dry
calls. `getDamage` runs once per surviving (attacking stat, defending stat) pair; its last step,
`modifyDamage`, receives one number and nothing stat-dependent after it, so its sixteen rolls are
memoised on that number.

**What links Pokemon, and is used:**

- **Recoil and drain** off a Pokemon shown as a percentage. The victim's damage is hidden, but
  the attacker's line is exact, and the simulator turns each candidate's damage dealt into the HP
  it would print — `actions.applyRecoilDamage` for recoil, a dry `spreadDamage` of exactly that
  amount for drain. The attacker's line then also says which amounts the victim really took.
  Wave Crash recoil on turn 4 of the Bo3 game is what pins Blastoise's Defence.
- **Attacker HP.** Water Spout, Eruption and pinch abilities read the attacker's own HP. The
  dependence is detected by asking (does the row move when HP does?), and then the victim's line
  also filters which HP the attacker could have been on.
- **Whose stat attacks.** The move says: Foul Play attacks with the target's Attack, Body Press
  with the user's Defence, Psyshock hits Defence with a special move. A hit keeps the attacking
  values that reached the display — a flat domain, or for Body Press a dimension of the user's
  joint key. Foul Play ties the target's Attack to its own Defence, so a new guess fixes HP,
  Defence and Special Defence first and picks the flat stats from what survives beside them.
  Under Wonder Room a defence is read from the other one's stored stat (`calculateStat`), so a
  hit there narrows the other defence — a physical hit, Special Defence.
- **Speed order from every sort.** Queued actions (moves, Mega Evolution, switches), switch-in
  abilities, end-of-turn effects and weather's pass: two items of one sort at the same order and
  priority ran fastest first, so a Pokemon whose line came first had at least the other's speed.
  The speed compared is the simulator's at that moment — `getActionSpeed` for the queue, the
  cached `speed` for event handlers, re-taken when `setSpecies` resets it on Mega Evolution — so
  Tailwind, Trick Room's reversal, paralysis and Choice Scarf are all the simulator's. A tie can go
  either way, so every bound is `>=`. Gen 9 re-sorts before each move, so the last sort before an
  action is the one that decided it. After You, Quash and Instruct taint their turn's queue.
  Where the rebuild diverges on order, the replay's order is used only when it is proved: a move
  line always prints, and a handler's line counts only if the replay shows the rebuilt
  Pokemon's line later in the same phase — a Leftovers heal at full HP prints nothing.
- **Pinch Berries.** After each HP change the simulator's own check is asked, per max HP, up to
  which HP the item fires; a bisection finds the edge. Champions already shades the percentage at
  a half, so a Sitrus seldom adds anything; a quarter Berry does.
- **HP given back from the other side.** What Leech Seed takes from a Pokemon shown as a
  percentage is what its seeder gets back, so the seeder's exact line says how much the seeded
  one really lost — an eighth of its max HP, which is its HP stat to within eight points. Shell
  Bell is the same link for a single hit, and exact outright when every Pokemon the holder hurt
  is shown exactly. Both are carried like drain: the amounts each candidate could have lost,
  checked against the other Pokemon's line in the whole-path walk.
- **Strength Sap** heals by the target's Attack as it stood before the move lowered it. Against
  a hidden target the simulator's own `getStat` is asked for every surviving Attack before the
  move runs, and the user's exact line keeps the ones that heal what it shows. An uncapped heal
  names the Attack stat outright.
- **Pain Split** sets both Pokemon to their average HP. Its `onHit` is re-run for every HP the
  hidden one could be on, and the exact one has to land where the log shows it — the scaffold's
  line where it reproduces the log, the replay's where the scaffold first goes wrong on exactly
  that line. That holds even when the hidden one's own display lies past the cutoff, and it
  names the hidden HP almost exactly.
- **Confusion self-hits** read the Pokemon's own Attack and Defence and throw one damage roll:
  `getConfusionDamage` is re-run per candidate like any hit, and the roll goes on the path.
- **A survived lethal hit.** A Focus Sash, Sturdy or Endure announces itself before the hit's HP
  line, and it proves more than the display does: the hit was lethal, and the Pokemon is left on
  exactly 1 HP. So only candidates the hit would have knocked out are kept — which of them the
  effect saves is the simulator's own `Damage` event. It is read even when the scaffold's hit fell
  short: the replay's Focus Sash line is then where the scaffold goes wrong, and the HP line right
  after it is read in its place — as evidence, never as a proved line for the next round.
- **Whole paths.** Each display is first checked on its own; then every Pokemon's HP history is
  walked backwards from what survived the last display, and a spread — or an attacking stat — is
  kept only if some path through *every* turn reaches it. Without this, two unknowns hitting each
  other each look possible on turn 2 through states turn 4 rules out.
- **The 66-point budget**, pushed through every stat after every pass. `--all-spent` assumes
  every point is spent, as real sets do — an assumption, not evidence, so it is off unless asked
  for — and the budget becomes an equality: a value survives only if some choice for everything
  else brings the total to exactly 66. On game A that takes Blastoise from 3,822 spreads to 1,420
  and Pelipper from 1.86M to 180,297, and the S3 suite keeps all 83 real spreads under it.

**What is not used, and costs precision only.** An HP change of unknown shape lets the candidate
move anywhere its next printed line allows. Recoil and Shell Bell summed over several hits or
targets are not used, and neither are Strength Sap and Pain Split between two Pokemon both shown
as percentages, which only `--infer both` meets.
An effect written as a fraction of max HP — Leech Seed's drain included — is scaled only when its
amount proves the fraction: a non-integer amount was passed unrounded; a whole one could have
been rounded either way, so both roundings are kept. None of these can remove a spread that
fits.

**The scaffold.** Every hit has to happen in the position it really happened in, so the replay
needs *some* spread that reproduces the log. The position does not depend on which consistent
spread built it — only exact HP does, and that is what each candidate tracks for itself. So
`inferSpreads` alternates: reconstruct with a guess, collect the evidence up to where it
diverged, move the guess inside what survived, repeat. Three choices keep that fast:

- a new guess aims at the **middle** of each narrowed stat range, not the nearest survivor, which
  would sit on the edge the next turn is most likely to cut;
- guesses are made one Pokemon at a time, each **pinned** before the next, so two guesses that are
  each possible alone are not impossible together;
- with every guess pinned, the evidence names one exact HP path through the verified turns, and
  the next reconstruction is handed those turns **exact** (compared on the omniscient channel) —
  so the dice search cannot sample a 91 where only 92 leads anywhere — together with **the dice
  that rebuild them**. Within the verified turns the same dice are thrown in the same order
  whatever the spread; accuracy, crits and procs keep the faces the last search settled, and each
  damage roll becomes the one the path chose for the new spread, at the ordinal the scaffold
  recorded for it. So a round searches only the turn after them. A spread that throws a different
  sequence is caught, and the pins from that turn on are dropped and searched. The search budget
  starts at 150 probes and grows only for a guess the evidence has no quarrel with.

The reconstruction also blames the *other* hidden Pokemon a failing line depends on, on
alternate backtracks: the attacker for Water Spout, the victim for recoil (§7.3).

**Results.** The fixture teams supply the truth to check against; a real spread eliminated is a
defect. It happened once, in a synthetic battle: a Pokemon Leech Seed knocked out was already
queued to faint, so a dry run at each candidate HP skipped `faint()` and left it below zero,
where no display matched. A dry run now starts from a standing Pokemon — which also widened one
recording's Metagross from HP 1–4 to 1–6, the width the burn that knocked it out really allows.

| Source | Withheld | Result | Time | Real spread |
|---|---|---|---|---|
| Bo3 game A, 10 turns | p2's spreads | MATCH, 2 rounds | 5–6 s | survives, all 4 seen |
| Bo3 game A | both sides' | MATCH, 8 rounds | 105 s | survives, all 8 seen |
| Bo3 game B, 6 turns | p2's spreads | MATCH, 4 rounds | 6 s | survives, all 4 seen |
| Bo3 game B | both sides' | MATCH, 6 rounds | 52 s | survives, all 7 seen |
| 21 recordings, S3 | p2's spreads | 21 MATCH | 2 min 3 s in all (2 min 36 s on one thread), up to 17 s each | survives, 83 of 83 |
| the same, every point assumed spent | p2's spreads | 21 MATCH | 2 min 8 s | survives, 83 of 83 |
| the same, read from p2's side | p1's spreads | MATCH on the two tried (25, 46) | 15–20 s | survives |
| five synthetic battles (Leech Seed, confusion, Strength Sap, Pain Split, Shell Bell, Wonder Room, Focus Sash) | p2's spreads | 5 MATCH | 1–7 s each | survives |

Times are this laptop's on one day; the code before snapshots and the pool took 65 s on game B
with both sides withheld the same day. The synthetic battles are scratch work, not recordings:
what each piece of evidence gave there —

| Evidence | What it pinned | Real |
|---|---|---|
| Strength Sap healing 78 | Whimsicott's Attack to 0 | 0 |
| Pain Split with Sinistcha, then Leech Seed | Kingambit's HP to 20–21, then 20 | 20 |
| Leech Seed alone, the seeder healing 24 | whole paths: Kingambit's HP to 20–24 | 20 |
| Pain Split used by the hidden Sinistcha, the exact line at the cutoff | Sinistcha's HP to 21 | 21 |
| Shell Bell on the hidden holder | Blastoise's HP to 4–24 | 24 |
| Dragon Claw under Wonder Room | Blastoise's Special Defence to 12–32, Defence untouched | 20 |
| a confusion self-hit | a small cut beside the other hits | — |
| a Focus Sash that held Garchomp's Iron Head, which the first guess survived without it | Whimsicott's HP to 0–29 and Defence to 0–23, and the battle reproduced in the second round | 2 HP, 0 Def |

What game A leaves of p2, with p1 known: Blastoise 3,822 spreads (HP 24–32, Atk 0–9, Def 0–8,
SpA 30–32, SpD 0–12, Spe 0–9; 1,420 if all 66 are spent); Pelipper 1,858,677 (SpA 0–2);
Farigiraf 20,341,022 (Def ≥ 6, one hit taken); Gholdengo untouched — it neither took nor dealt a
hit, so the log says nothing about it and the count says so. The events, in order, with the
ranges each one moved:

| Turn | Event | Survivors | Ranges moved |
|---|---|---|---|
| 1 | Garchomp's Earthquake leaves Farigiraf at 58% | Farigiraf 136.7M → 20.3M | HP 1–32, Def 6–32 |
| 2 | Garchomp's Dragon Claw leaves Blastoise-Mega at 51% | Blastoise 136.7M → 83.6M | none |
| 3 | Blastoise-Mega's Water Spout takes Basculegion to exactly 155/195 | Blastoise 83.6M → 4.9M | SpA 25–32 |
| 3 | Pelipper's Hurricane takes Grimmsnarl to exactly 103/202 | Pelipper 136.7M → 46.9M | SpA 0–4 |
| 4 | Basculegion's Wave Crash leaves Blastoise-Mega at 35% | Blastoise 4.9M → 4.7M | none |
| 4 | Pelipper's Hurricane takes Basculegion to exactly 46/195 | Pelipper 46.9M → 29.8M | SpA 0–2 |
| 5 | Charizard-Mega-Y's Heat Wave leaves Pelipper at 89% | Pelipper 29.8M → 3.3M | HP 2–32, SpD 8–32 |
| 7 | Basculegion's Last Respects leaves Pelipper at 21% | Pelipper 3.3M → 2.2M | none |
| 9 | Blastoise-Mega's Water Spout takes Grimmsnarl to exactly 57/202 | Blastoise 4.7M → 1.1M | SpA 30–32 |
| 10 | Charizard-Mega-Y's Weather Ball leaves Blastoise-Mega at 12% | Blastoise 1.1M → 35,920 | Atk, Def and Spe 0–14, through the budget |
| — | whole paths: turn 4's Wave Crash recoil, and Water Spout's own-HP dependence, against every other turn | Blastoise 35,920 → 3,822 | HP 24–32, Atk 0–9, Def 0–8, SpD 0–12, Spe 0–9 |
| 4 | Basculegion acted before Pelipper | Pelipper 2.2M → 2.1M | Spe 0–15 |

A count can fall with no range moving — Dragon Claw on turn 2 removes combinations of HP and
Defence without moving either range — and a range can move through the budget alone: Weather Ball
pins Blastoise's bulk high enough that nothing else can afford more than 14 points.

With both sides withheld, p1's exact HP pins each of its HP stats on sight — Charizard
136.7M → 1.5M the moment it switches in — and the regions are wider, because each hit now has
two unknowns: Grimmsnarl 71,946 (SpD 11–16), Basculegion 428,728 (Atk 17–32, Spe ≥ 10),
Blastoise 96,238 (SpA 25–32).

### 7.6 Closed team sheets — one side read off the log

A Bo1 ladder game publishes no `|showteam|`, so the opponent's item, ability, nature and
unrevealed moves are unknown as well as its Stat Points. `--infer p1|p2` no longer refuses such a
replay: the unknown side's sets are read off the log (`setsFromLog`, `scripts/lib/replay-source.mjs`).

| From the log | How |
|---|---|
| species, level, gender | the preview (`\|poke\|`) and each Pokemon's details; a forme the preview hides (`Urshifu-*`) from the Pokemon sent in |
| moves | every move each one chose; one with a `[from]` tag was called by something else, except a locked move |
| item | the first it showed: a Mega Stone, an item used up or knocked off, one announced or frisked, an effect credited to it. Rocky Helmet and the retaliation Berries hurt the attacker and name their holder in `[of]`; an item received by Trick is not the one it brought |
| ability | the first it showed, and only as its species could have it: `[of]` owns Rough Skin and Hospitality but is the attacker for Volt Absorb, so the species decides. An ability shown only after Mega Evolution belongs to the Mega forme; a Traced one is Trace |

What the log never showed is assumed, and the command names every assumption before it runs: an
ability the species has only one of is known by elimination, otherwise the first it lists; an
unseen item is none; an unseen nature is neutral. The known side has no sheet either, so it is
checked against the log instead — every Pokemon it previewed and every move each used has to be
in the supplied team — and since a player's own team can sit on either side of someone else's
replay, a fixture's two teams go to the sides whose previews they match. A replay the server
published shows both sides as percentages; that is the spectator channel, 0.

An assumption the log rules out empties that Pokemon, and the report says so instead of printing
a spread. On the Bo1 replay (`recordings/showdown/mine-closed/…-mercifulbird-…`), MercifulBird's
Gardevoir moves before the user's Charizard-Mega-Y on turn 1, which no spread allows with a
neutral nature and no item: Gardevoir ends with nothing, and the event that removed it is the
speed order. It used Moonblast every turn, and a Choice Scarf would explain both. Ruling items and
natures in or out is the next step (§9).

---

## 8. Scripts

| Command | What it does |
|---|---|
| `npm run replay` | Provision, play the fixture, re-simulate, diff, render, report. The determinism + full-information proof. |
| `npm run live` | Truncate at a turn, import it as a live room, open two windows on it. §5.9. |
| `npm run reconstruct` | Rebuild an input log from a replay plus both teams, then check it turn by turn. §7. |
| `npm run extension` | Build the Chrome extension into `extension/dist/`; `--check` holds each step to the Node reference in a throwaway Chrome. `docs/extension.md`. |

`npm run replay` serves its page from the client host and puts a **Play from here** button in the
replay control row, which does the same thing as `npm run live` for the turn on screen. §5.10.

Shared flags: `--from <log.json>`, `--no-open`, `--verbose`, `--embed <url>`.
`npm run live` takes `--at <turn>`, `--dry-run` and `--verify <log.json>`.
`npm run reconstruct` takes `--all`, `--rung s1|s2|s3`, `--teams <key>`, `--infer p1|p2|both`,
`--all-spent`, `--sample <n>`, `--max-probes <n>`, `--threads <n>` and `--dry-run`; a `.html`
source is always S4, and `--threads` only changes how long the search takes, never what it finds
(§7.3).
`npm run replay` takes `--force "<outcome> <subject> [move]"` (repeatable), with `--at <turn>`,
`--always` and `--seed <seed>`: it replays the recording twice from that turn under one shared
reseed, once plain and once controlled, and reports what was substituted and which battle lines
moved. That is the headless proof for §4; `/rng` is the same engine driven from a live room.
`replay.bat`, `live.bat` and `battle.bat` are the double-click entry points.

| File | Role |
|---|---|
| `scripts/lib/protocol.mjs` | the one shared log filter and diff (§6.2), and the log with Illusion seen through (§7.3) |
| `scripts/lib/ws-player.mjs` | scripted WebSocket player, explicit targets only (§6.1) |
| `scripts/lib/ws-admin.mjs` | scripted connection that issues `/importinputlog` (§5.9) |
| `scripts/lib/truncate.mjs` | cut an input log back to a turn boundary (§5.8), optionally reseeding the continuation (§5.10) |
| `scripts/lib/verify-branch.mjs` | prove a played branch is prefix + new choices (§5.9) |
| `scripts/lib/browser.mjs` | two isolated browser profiles, side by side (§5.9) |
| `scripts/lib/replay-source.mjs` | any source — recording or saved replay — as lines, teams and sheets, and with no sheet the sets its log reveals (§7, §7.6) |
| `scripts/lib/reconstruct.mjs` | transcribe the choices, read the dice off the replay, check every turn; also the entry of the worker threads that run its probes (§7) |
| `scripts/lib/inference/infer.mjs` | infer Stat Points by elimination: the rounds of guess, rebuild, evidence (§7.5) |
| `scripts/lib/inference/knowledge.mjs` | what is still possible per Pokemon, the 66-point budget, and picking the next guess (§7.5) |
| `scripts/lib/inference/evidence.mjs` | one evidence pass: the simulator hooked at every hit, HP change and held-item check (§7.5) |
| `scripts/lib/inference/speed.mjs` | speed order from every sort the simulator makes by speed (§7.5) |
| `scripts/lib/branch-launch.mjs` | the one launch path: import, two windows, both slots (§5.10) |
| `scripts/client/replay-branch.js` | the replay page's "Play from here" button (§5.10) |
| `scripts/lib/replay-html.mjs` | replay shell (§6.3) |
| `scripts/server/rng-command.js` | the one interceptor, the `/rng` command, and the `>rng` verb that carries both (§4) — CommonJS, copied into `runtime/config/` |
| `scripts/lib/rng-control.mjs` | that engine driven headlessly: build a controlled input log, replay it, read the accounting (§4.2). Importing it teaches `>rng` to every `BattleStream` in the process |
| `scripts/client/rng-panel.js` | the move and Pokemon tooltips that arm a draw without typing (§4) |
| `scripts/fixtures/teams.js` | the two fixture teams, as export text, packed at runtime |
| `scripts/provision-local-server.mjs` | local config, including `logchallenges` (§3.1) |

The fixture teams use non-uniform spreads that each sum to 66 (e.g. Archaludon
`32 HP / 1 Def / 5 SpA / 25 SpD / 3 Spe`) precisely so that the stat-recovery check is a real
test vector and not a symmetric one that would pass by accident.

---

## 9. Open tasks

### Stat Point inference — what is still open (§7.5)

**Scope: one side unknown only** (`--infer p2`: your team known, theirs inferred). `--infer
both` stays as built and gets no further work (§10). Every task keeps the one rule that
matters: a spread the replay could have come from is never eliminated — checked against the
fixtures' real spreads, 83 of 83 today, plus the synthetic battles in §7.5.

`evidence-catalog.md` is the plan for finding the rest ahead of time: list every legal effect,
probe which stats each one lets reach the log, and check that list against what the evidence
pass uses.

1. **The evidence still unused** (§7.5): Shell Bell summed over several targets or hits,
   recoil summed over several hits, and Strength Sap or Pain Split between two Pokemon that are
   both shown as percentages — which only `--infer both` meets.
2. **Certified ranges** (`--certify`). The inference keeps impossible spreads on purpose: an HP
   change it cannot model lets a candidate move anywhere its next display allows, Attack, Special
   Attack and Speed are separate lists that each only have to fit every hit on its own, two
   unknown Pokemon that constrain each other are narrowed one at a time, and a speed tie counts
   both ways. So every range is an upper bound. A **witness** proves a spread possible: pin it,
   rebuild the battle, and the input log that reproduces the replay line for line is a proof
   anyone can check by replaying it. A stat's range is exact once its minimum and its maximum
   each have a witness, because every value outside it was removed. `--certify` would build those
   and mark each end *proven* or *not proven* — the search has a budget, so a missing witness
   does not prove a value impossible.
   - **Cost is per range end, not per spread.** At most twelve ends per Pokemon, and fewer
     witnesses than that: one spread can sit at several ends (all zeros is every minimum at once;
     three spreads reach every maximum), and one witness pins every unknown Pokemon at the same
     time, so a battle needs about as many witnesses as one Pokemon does. A joint witness that
     fails says nothing about which Pokemon's value was impossible; its ends are then tried one
     Pokemon at a time. A Pokemon the log never touched is the cheap case, not the expensive one:
     any spread fits, so its witnesses succeed on the first try. The expensive case is a witness
     that fails, which spends its whole search budget before giving up; that budget caps it.
   - **The same witnesses test soundness without ground truth.** A witness for a value just
     outside a range means a possible spread was removed — the Leech Seed defect of §7.5 would
     have shown up this way — and it works on public replays, where no one's spreads are known.
     Those probes are expected to fail, so each costs a full budget: a test-suite tool, not a
     step in every run.
   - **What stays unproven:** points inside a range, which can have gaps, and the spread count,
     which would take a witness per spread. Sampling survivors could estimate how many are false,
     as a statistic, never a proof. And "possible" is possible under the pinned simulator; a live
     server with different mechanics would make both proofs about the wrong battle.

### Closed team sheets — what is still open (§7.6)

The sets are read off the log and the rest is assumed. Next, in the same shape as §7.5 — each
unknown becomes a candidate dimension, and the simulator is still the only thing that computes:

1. **Items the log never names** — Choice Band, Specs and Scarf, Expert Belt, type boosters,
   Assault Vest — as a small candidate set per Pokemon. Each hit is dry-run per (item, spread): a
   hit above every no-item spread's maximum proves a boosting item, an attacker that chose two
   different moves without switching holds no Choice item, an Assault Vest holder never chose a
   status move, and speed order bounds Scarf.
2. **Natures**, which multiply the stat model by 21 distinct effects, so the joint key grows with
   them.
3. **Abilities** with more than one option, most of which announce themselves when they act.

---

## 10. Deferred — do not start without sign-off

- **Public-ladder *input log* ingestion.** Still blocked on consent (§1) — but only the input
  log is. The replay is not, and §7 rebuilds an input log from one, so this is no longer a
  blocker on anything. `@pkmn/client` was the presumed fallback for tracking state from a plain
  protocol log; it is **not needed**. The simulator tracks its own state and `side.activeRequest`
  says what is legal (§5.7), so the only question ever asked is which offered option was taken.
- **Layer B, direct state authoring.** For positions that never occurred. The vehicle is
  `gen9championsdoublescustomgame` — validation off, no 66-point cap, `debug: true` already
  set. The difficulty is not HP and weather; it is the volatile layer: consecutive-Protect
  counter, Encore turns remaining, Taunt turns, Fake Out eligibility, Choice lock, `lastMove`,
  disabled slots, Tailwind / Trick Room counters, consumed-item flags, and the pending action
  queue.
- **A prior over what survives.** §7.5 says which spreads the replay allows and ships one of
  them; it does not say which is *likely*. Usage statistics (plan.md §10) would rank the
  survivors and fill the stats no event touched with what people actually run.
- **A prior over unrevealed items.** Pokemon that usually carry one get a prior of their own
  (Sylveon and Fairy Feather, Kingambit and Black Glasses) — a ranking over what survives, never
  an elimination (§9, closed team sheets).
- **Both sides unknown** (`--infer both`). Built and working on both Bo3 games (§7.5), but
  50–110 s and wide ranges. Frozen as it is; no further work until the one-sided version is done.
- **Any UI.**
- **Champions video ingestion.**

---

## 11. Reference — files worth reading

| Path | Why |
|---|---|
| `runtime/sim/SIMULATOR.md` | Stream API and input-log format. Note how little it promises. |
| `runtime/sim/SIM-PROTOCOL.md` | Protocol messages, including the secret/public split |
| `runtime/sim/battle-stream.ts` | `BattleStream`, `getPlayerStreams` |
| `runtime/sim/battle.ts` | `extractChannelMessages` :35, `resetRNG` :360, `randomizer` :2388, `getDebugLog` :3151 |
| `runtime/sim/battle-actions.ts` | `hitStepAccuracy`, `selfDrops`, `secondaries`, `getDamage`, `hitStepMoveHitLoop` (§4.1) |
| `runtime/sim/side.ts` | `autoChoose` target skip :660 (§6.1) |
| `runtime/sim/prng.ts` | `PRNG`, the `RNG` interface, `randomChance` :116, seed formats |
| `runtime/server/room-battle.ts` | `logchallenges` :850, `>pN default` :452 |
| `runtime/server/rooms.ts` | `getScrollback(channel)` :1964 |
| `runtime/server/chat-commands/core.ts` | `exportinputlog` :840, consent :804, `importinputlog` :893 |
| `runtime/data/mods/champions/scripts.ts` | Stat formula, PP cap, Trick Room fix |
