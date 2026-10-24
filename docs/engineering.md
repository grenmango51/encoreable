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

A second unreplayable line comes from a move a hidden disable turns into Struggle. Imprison
disables the moves it shares without the request saying so, so in doubles a Pokemon is offered a
move, picks it, and struggles — and the input log records `move struggle`, which that request
never offered. Where the replay shows Struggle the rebuild chooses the Pokemon's first move, and
records in the input log the choice it wrote (`playThrough`, `scripts/lib/reconstruct.mjs`).

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
| `actions.applyRecoilDamage` computes and applies recoil in one call, Struggle's, Mind Blown's and Chloroblast's cost from the user's max HP, rounded, included | each candidate's recoil or cost is a dry call of it | `sim/battle-actions.ts:1379` |
| Wish's slot condition heals `source.maxhp / 2`, its maker's | scaled only when the Pokemon healed made it | `data/moves.ts` (`wish`) |
| the queue is sorted by `queue.sort`, then run head-first by `battle.runAction`, and re-sorted before each move | "acted first" is read off the last sort before the action | `sim/battle-queue.ts:418`, `sim/battle.ts:2918` |
| `queue.resolveAction` assigns action kinds an order from a literal `orders` table, with `move` and `event` allowed through without an entry | `npm run check` reads that table and checks every kind against `ACTION_KINDS` in the order reader (§12.5, S4) | `sim/battle-queue.ts:174`, `:200` |
| `fieldEvent` (switch-in, end of turn) and `eachEvent` (weather, `Update`) sort by `battle.speedSort`, then dispatch each handler through `singleEvent` / `runEvent` | an event's order and each handler's lines are read off those calls | `sim/battle.ts:267`, `:293`, `:310` |
| a handler sorts by the Pokemon's cached `speed`, written only by `updateSpeed` and by `setSpecies` (the bare Speed stat, until the next update); a switch-in handler subtracts under one point for position | candidate speeds are taken at those writes; the fraction never reorders whole speeds | `sim/pokemon.ts:283`, `:1005`, `sim/battle.ts:767` |
| a held item's pinch check is its own `onUpdate`, run from `eachEvent('Update')` | the check is asked dry, per HP, of the item alone | `data/items.ts` (`sitrusberry`) |
| confusion damage is `actions.getConfusionDamage`, the user's own Attack and Defence and one `randomizer` draw | a self-hit is asked per candidate like any hit | `sim/battle-actions.ts:1533` |
| a move's own effect runs as `singleEvent('Hit', move, …)`; Strength Sap reads `getStat('atk', false, true)` before lowering it, Pain Split sets both HPs with `sethp` | each is re-run dry per candidate, before the real one | `data/moves.ts` (`strengthsap`, `painsplit`) |
| Wonder Room swaps the defences inside `calculateStat`, after the stat is named | the Stat Points a hit depends on are the other defence's | `sim/pokemon.ts:290` |
| Illusion copies the last Pokemon behind it in the party that has not fainted, and `\|replace\|` names the real one when a hit breaks it, which every damaging move hit does (`onDamagingHit`) | who was really sent in is read through it, the one it copied goes last in team preview, and a Pokemon shown that was hit and stood with no `\|replace\|` was the one shown | `data/abilities.ts` (`illusion`) |
| `faint()` does nothing to a Pokemon already queued to faint, and it is what sets HP to 0 | a dry run clears the flag for a candidate that is still standing | `sim/pokemon.ts` (`faint`) |
| `getActionSpeed` and `statModify` are replaced per instance by the Champions mod | speeds and stats are asked of the instance, never the prototype | `data/mods/champions/scripts.ts` |
| `storedStats` is written only by `setSpecies` (third argument true for a Transform), `transformInto` and the handlers of the moves that move stats, each an `on<Event>` whose source assigns `storedStats`; `maxhp` is set once, at the first `setSpecies` | a stat-writing handler is found by its source and run dry per candidate before the real one; any other write leaves the stat unmapped until the next `setSpecies`; max HP is sized from the species the Pokemon entered as | `sim/pokemon.ts` (`setSpecies`, `transformInto`), `data/moves.ts` (`powersplit`, `guardsplit`, `powertrick`, `speedswap`) |
| `transformInto` copies each non-HP stored stat from the Pokemon copied, and Imposter copies the foe in the opposite slot | a copied stat stands on what the original's stood on | `sim/pokemon.ts` (`transformInto`), `data/abilities.ts` (`imposter`) |
| a `Battle` built with both packed teams has every Pokemon's `maxhp` and set before a turn is played | the sheet a hidden Illusion user is seen through by | `sim/battle.ts`, `sim/pokemon.ts` |
| the "-ate" abilities boost only while `move.typeChangerBoosted === this.effect` | a dry run's copy of the move shares the frozen dex entries by reference | `data/abilities.ts` (`pixilate`, `aerilate`, `refrigerate`, `dragonize`) |
| `attrLastMove` extends the last move line in place, at `battle.lastMoveLine` | a dry run hands back that line as well as the log's length | `sim/battle.ts` (`attrLastMove`) |
| a chance inside the damage calculation draws through `prng.random` — Fickle Beam's `randomChance` | a dry run gives it the face the real calculation's draw of the same range took | `data/moves.ts` (`ficklebeam`) |
| Toxic's tick is `clampIntRange(baseMaxhp / 16, 1) * stage` | scaled per candidate max HP with the stage the scaffold shows | `data/conditions.ts` (`tox`) |
| a move's HP cost goes through `directDamage`, which floors it and runs no `Damage` event; a Substitute holds `Math.floor(maxhp / 4)` | the cost is scaled like a fraction, and the first hit on a fresh Substitute is read by whether it broke | `sim/battle.ts:2207`, `data/moves.ts` (`substitute`) |
| Counter's and Mirror Coat's volatile keep `2 * damage` in their `onDamagingHit`; Metal Burst and Comeuppance read `getLastDamagedBy(true).damage`, the `attackedBy` record `gotAttacked` writes | a candidate amount is handed back by rewriting the record and re-running the volatile's handler | `data/moves.ts` (`counter`, `mirrorcoat`, `metalburst`, `comeuppance`), `sim/pokemon.ts` (`gotAttacked`, `getLastDamagedBy`) |
| Focus Band's `onDamage` throws `randomChance(1, 10)` in every `Damage` event, lethal or not, before it looks at the damage | a dry re-run of a `Damage` event replays that Pokemon's real dice, and a survival line is read with the chance granted | `data/items.ts` (`focusband`) |
| Liquid Ooze's `onSourceTryHeal` turns a drain, Leech Seed or Strength Sap heal into `this.damage` of the same amount and returns 0 | that damage is read as the heal it replaced | `data/abilities.ts` (`liquidooze`) |
| a Pokemon whose every move is disabled, Imprison's hidden disable included, is chosen Struggle in `chooseMove`, and the input log records `move struggle` | the rebuild writes the first move and records that instead (§6.1) | `sim/side.ts:707`, `data/moves.ts` (`imprison`) |

`pokemon-showdown` is pinned to one upstream commit in `package.json`, not to an npm release:
play.pokemonshowdown.com runs upstream master, and npm releases lag it by months (0.11.11, the
last one, predates Reg M-C). A GitHub checkout ships no `dist/`, so `package.json`'s
`postinstall` builds it (`node build`, about a minute). The package still reports its version as
0.11.11; the commit is what identifies it.

An upgrade is a new commit in `package.json`, `npm install`, and a fresh `runtime/`:
`provision-local-server.mjs` copies over `runtime/` without deleting, so files upstream removed
would linger. Set the old `runtime/` aside, provision, and copy its `logs/` back, since that holds
recordings not yet archived to `recordings/local/`. Then the test is a diff of those call sites plus a
re-run of `npm run check`, `npm run replay`, `npm run reconstruct -- --all --rung s2`,
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
cannot change a line already written. A turn is scored `[lines, fields, shared]`: how far it got
before disagreeing, then how much of the disagreeing line is nevertheless right from its start,
then how many of its fields are right in place anywhere in it. The second component is not
cosmetic — a spread move needs its **target** draw and its **accuracy** draw changed together,
and neither alone moves the first component. The third ranks lines whose kind is still wrong: a
Pokemon the replay shows flinching, after a speed tie Gen 9's re-sort before each move made it
lose, needs the tie and the flinch changed together, and the run that has it moving where the
replay has it flinch has its name right. A commit that only improves `fields` or `shared` is a
guess, so it is held back until nothing improves `lines`; one that only improves `shared` is on
trial besides, and is taken back with every draw committed after it unless a later draw in the
turn improves `lines` — so a turn no such pair fixes ends where it would have without it, and the
search goes on to its other ways out.

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
  target's accuracy die with its `|-miss|`; a die that agrees has nothing to fix. A move that hits
  a number of times drawn from a range throws that number before its first hit, and the observed
  `|-hitcount|` says which faces of that die print it; Loaded Dice throws a second die after a low
  count, so its holder's count is searched in full. A dry copy of a hit through its target's
  Protect keeps that hit data, so the damage it brackets is the quarter the hit deals. A turn whose
  prefix already disagrees gets no steering and is searched in full.
- **Dice shown to print the wrong line go first, and together.** A spread move that missed one
  target and hit the other needs both accuracy dice moved — neither alone brings the line any
  closer — so every such die is set right in one probe before any is tried alone. That is what
  reproduces Bo3 game B's turn-3 Heat Wave.
- **A die thrown after the line the turn disagrees on is skipped**, except within a move line,
  which `attrLastMove` amends until the next action starts.
- **Choices the replay never shows are walked furthest first.** A Pokemon that fainted before
  acting, flinched or was fully paralysed shows no move, so which one it chose is a search
  variable. Every such variant is played once with the turn's dice as drawn, and the dice are
  searched under each in the order they got furthest: a flinched Mawile that chose Sucker Punch
  sorts its `|cant|` before a priority-0 move, where the replay has it, and is searched before the
  variants that do not.
- **Last, two chances together.** When a scan commits nothing, pairs of dice wider than a damage
  roll — accuracies, crits, a secondary's `random(100)` — are tried at their ends, the second
  thrown anywhere after the first in the turn: Muddy Water lowering one target's accuracy and not
  the other's prints the wrong target's line under either die alone, and the second target's die
  is thrown after that line.
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

**Ally Switch** moves two Pokemon between slots mid-turn, and the lines after it name the new
slots; a turn's choices are read back to the slot each Pokemon chose from (`planSegment`).

**Revival Blessing** asks its user's player which fainted Pokemon to bring back, as a switch
request for the user's slot, and the heal line `[from] move: Revival Blessing` names the one
chosen; that is the answer the rebuild gives. One revived into an empty active slot is switched in
by the simulator itself, so its switch line answers no request.

**A battle that ended without a Pokemon deciding it** — a forfeit, the timer — ends in the
rebuild with `>forcelose` for the loser once everything before its `|win|` has printed — in a
Bo3 game too, where the room prints `|player|` again after the `|win|`. The room's announcement is
room text, and `battleLines` drops it. A Pokemon Encored before it moves uses the Encored move, so
its move line is not its choice: the turn's plan leaves that choice unread.

**Illusion** prints one Pokemon as another — that one's name and details — until a hit breaks it
and `|replace|` names the real one. Who was really sent in, and who really acted, is read from
the log with every Illusion seen through (`unmaskIllusion`, `scripts/lib/protocol.mjs`); the turns
are still compared as shown, because the simulator prints the same disguise once the real
Pokemon is sent in from the same party order. Illusion copies the last Pokemon behind it in the
party that has not fainted, so the one it was shown as goes last in team preview, unless it led.
The evidence reads whose HP a line shows from the slot, not the name: a line printed under the
disguise belongs to the Pokemon a later `|replace|` names in that slot, and `|replace|` itself
carries no HP. With team sheets, a disguise no hit broke is seen through too, from that switch-in
to the next: when the Pokemon shown uses a move its sheet lacks and the Illusion user's has, or
shows — on the side whose HP the log prints exactly — the Illusion user's max HP and not its own,
read off a battle built from the packed teams. Moves another effect called, Struggle, and a stay
with Transform, Mimic or Sketch prove nothing.

Without such a proof, every switch-in of a teammate on a side whose sheet has one Illusion user
can be either (`illusionStays`). The rebuild reads them as the teammate; when it then fails,
each such switch-in before the failing turn is tried as the Illusion user, one more at a time,
and a reading is kept only if it rebuilds further than the plain one, because the log showed the
Illusion user's damage, speed or HP. A disguise nothing tells apart, one that only
Protects at a percentage, stays the teammate. A trial drops the exact turns and dice it was
handed, which were proved under the other reading, and the reading kept is handed back as
`forced`. A Speed that gives the disguise away is a contradiction only once the Stat Points are
narrowed under the right reading, so `inferSpreads` also infers the battle again under each
reading when it did not rebuild, and keeps the first that does (§7.5); its speed rules read who a
line names by the slot, never by a name a disguise could be wearing.

A rebuild that succeeds does not settle a switch-in: a disguised Illusion user that only uses a
move its disguise has too, and moves at a Speed the disguise can reach, rebuilds under the plain
reading, which then gives the disguise what the Illusion user did. So a switch-in is the Pokemon
shown only when something says so (`unsettledStays`): it took a hit from another Pokemon's move
and stood, with no `|replace|` after it, since a hit always breaks Illusion; it used a move only its own
sheet has; it showed its own exact max HP; or the Illusion user was seen elsewhere meanwhile, or
had fainted. And none is the Illusion user once as many other Pokemon have been shown on its side
as the side brought (`|teamsize|`): it copies only a Pokemon brought with it. Each Pokemon shown in a switch-in nothing settles is inferred again with all such
switch-ins of it read as the Illusion user, which gives it none of what they showed, and every
Pokemon of that side but the Illusion user keeps whatever either reading leaves it; the plain
reading gives the Illusion user none of it. A reading that cannot rebuild where the plain one does
settles the switch-in as the Pokemon shown — the damage, the order or the move told them apart.
What was not used is listed with the checks ("not used").

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

A failing line that is no HP figure — a lock, a sleep or a confusion ending a turn early or late,
a status Effect Spore gave — was decided by a die thrown when it began, which showed nothing
then. Every earlier turn is tried, latest first, for a die that brings the failing turn closer,
and only such a die is redrawn; the later turns keep the dice they settled meanwhile, so the
failing turn gets as far as the line in question — the dice the failing turn's search held on
trial and took back included: a speed tie flipped on turn 2 puts a confused Pokemon first, where
its confusion then ends on a duration turn 1 drew, and only with the flip in place does a longer
duration bring the turn closer. Four such backtracks per rebuild at most (`DIE_BACKTRACKS`),
apart from the HP ones.

A die of more than sixteen faces is tried at its two ends, which settle a chance. Before a turn
settles for a draw that only gets more of its line right, a wide die that is no chance is tried at
its eighths too: a die cut into bands — Effect Spore's sleep, paralysis or poison out of a
hundred — needs a face inside each. Only then, because those faces move where the sampler lands.

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
before and after, every stat's range after, and which of those ranges it moved. An event that
read HP, Defence and Special Defence together also carries `grids`: which HP still goes with
which Defence and which Special Defence, as bits. An event or check that names Pokemon carries
`who`: where each name starts in its text and that Pokemon's id, so a reader can say whose it
is — "Raichu-Mega-Y acted before Raichu-Mega-Y" in a mirror match. Each inferred Pokemon in
`inference.pokemon` carries its whole surviving set as `knowledge` (`packKnowledge` in
`knowledge.mjs`, a few kilobytes), so a recording opened later — the extension's Stat Point
sliders — knows every spread still possible, not just the ranges. A single-source run prints
the events too.

**The simulator decides everything.** One replay of a reconstructed input log is hooked at the
places a spread matters, `scripts/lib/inference/`:

| Hook | What is asked, per surviving spread |
|---|---|
| `actions.getDamage` | the damage all 16 rolls would do, from a dry re-run in the real position (§4's `damageLadder` guards: a fresh copy of the move for each run, no dice consumed, no messages, state restored) |
| `pokemon.damage` / `heal` / `sethp` | where each candidate's exact HP moves to — then only what `getHealth` would print as the next line survives |
| `queue.sort` → `battle.runAction` | each candidate's `getActionSpeed`, so "acted before X in the same bracket" becomes a speed bound |
| `fieldEvent` / `eachEvent` → `speedSort` | the same for switch-in abilities, end-of-turn effects and weather's pass over the field, at each candidate's speed as `updateSpeed` cached it |
| `runEvent('Update')` | whether the held item's own `onUpdate` fires at each HP, so a pinch Berry that fired or stayed uneaten keeps only the HP on its side of the edge |
| `actions.getConfusionDamage` | a confusion self-hit's sixteen rolls for every surviving Attack and Defence of the Pokemon itself |
| `singleEvent('Hit', move)` | before the real effect: Strength Sap's amount for every surviving Attack of its target, and Pain Split's outcome for every HP the hidden Pokemon could be on |
| every handler, event and action (`resolvePriority`, `singleEvent`, `runAction`) | kept as a frame, innermost last, that a dry run can run again from where it was entered, throwing the dice the code threw so far as it threw them, and those it is about to throw as a copy of the generator gives them, each with the pin the rebuild set at its ordinal: the code that moved a hidden Pokemon's HP is asked again for every max HP and HP it could have — hazards, Aftermath, the absorbing abilities, Poison Heal, Revival Blessing |
| `runEvent('Damage')` | the lines the real `Damage` event printed, so a candidate whose own event would have announced a Focus Sash, Sturdy or Endure the replay does not show is ruled out |
| `singleEvent('ModifyMove')` | Shell Side Arm's category for every surviving Attack and Special Attack of its user, or Defence and Special Defence of its target, against the category the move line names |
| `speedSort` inside a handler, and a switch-in's | the handler, or the switch-in, run again dry with each two neighbouring Pokemon swapped: where the swapped run prints something else, the replay's line says which came first |

No dry run touches the generator: the interceptor is in dry mode for every one of them, not only
the damage ladder. A die a dry run throws takes the face the real run's die of the same range
took where the real run's dice are handed over — the calculation's own for a hit, and for every
re-run of a `Damage` event, the dice that Pokemon's real `Damage` event threw, which is Focus
Band's chance — and the bottom of its range otherwise.

The opponent's HP is a percentage, so a candidate is not one HP but the **set** of exact values
it could be on, carried hit to hit. HP, Defence and Special Defence are one joint key, because
they are what decides that set; Attack, Special Attack and Speed are flat. That is 35,937 keys and
three 33-value domains per Pokemon, and a whole pass is one replay of about 30 ms plus the dry
calls. A flat stat is **tied** to the key where a hit reads it against the same Pokemon's key — its
own Attack in its recoil, its drain or a confusion self-hit, a Foul Play on it, your Transform
copy hitting it, Gyro Ball on it, Water Spout or a pinch ability reading its own HP: the tie keeps,
per key, the values of that stat that reached the display beside it (two 32-bit words per key).
Two flat stats one hit reads together — a Gyro Ball user's Attack and its own Speed — get a pair
tie, the pairs of values that fit. A key with no tied value left goes, a value no key allows goes,
and the count, the ranges, the 66-point budget, the next guess and the check of a real spread all
go through the ties. `getDamage` runs once per surviving (attacking stat, defending stat) pair; its last step,
`modifyDamage`, receives one number and nothing stat-dependent after it, so its sixteen rolls are
memoised on that number.

**Every shortcut is checked against the simulator.** A dry run stands in for the real calculation
only where the two can be compared and agree:

- **A hit.** At the stats the scaffold is running with, the dry calculation has to deal what the
  real one dealt, on the roll the real one took. The copy of the move shares the simulator's own
  data by reference — frozen dex entries, live Pokemon — because handlers compare them by identity:
  Pixilate, Refrigerate, Aerilate and Dragonize boost only a move whose `typeChangerBoosted` *is*
  their own ability object. Any other die the calculation throws — Fickle Beam's chance to double
  its power — takes the face the real calculation's die took. Where the copy still disagrees, the
  real move is used, handed back as it was after each run; where that disagrees too, the hit is
  not used. The copy keeps one thing of the hit data the real move carried for its target: that
  it came through the target's Protect — Unseen Fist, Piercing Drill — which the hit step decided
  before any damage and which quarters it.
- **A moved stat.** Power Split, Guard Split, Power Trick, Speed Swap and Transform write a stat
  outside `setSpecies`, and the evidence pass watches those writes (below, *Stats moved between
  Pokemon*). A write it could not map to one candidate value leaves the stat unmapped until the
  Pokemon's next `setSpecies` — a switch — and a hit that reads it is not used, nor its turn
  order when the stat is Speed.
- **A carried amount.** A damage callback that reads no stat and no HP hands on an amount kept
  from an earlier hit: Counter, Mirror Coat, Metal Burst and Comeuppance return what the user was
  dealt, and another spread would have been dealt another amount. It is read through that earlier
  hit (below, *Damage handed back*); where neither Pokemon is shown exactly, it is not used.
- **Speed and max HP.** A table of speeds is used only if, at the Pokemon's own Stat Points, it
  gives the speed the battle is using. Max HP comes from the species the Pokemon entered as, since
  a Transform changes every stat but HP; a Pokemon whose max HP its Stat Points do not give has
  its HP lines read without them.

Every dry run goes through one snapshot of the battle and is handed back in full: each Pokemon on
the field — HP, status and its state, volatiles and their states, item and ability with their
states, boosts, stored stats, forme, types, flags such as `ateBerry` — both sides' and slots'
conditions, weather, terrain, pseudo-weather, the faint and action queues, and the log. So a
Chesto Berry asked whether it would fire does not wake its holder for real. Benched Pokemon are not
in the snapshot; no dry run touches one.

Every line set aside is recorded — `inference.checks` in the written `.log.json`, printed as
"not used" — and costs precision, never a spread that fits. The S3 suite sets none aside.

**What links Pokemon, and is used:**

- **Recoil and drain** off a Pokemon shown as a percentage. The victim's damage is hidden, but
  the attacker's line is exact, and the simulator turns each candidate's damage dealt into the HP
  it would print — `actions.applyRecoilDamage` for recoil, a dry `spreadDamage` of exactly that
  amount for drain. The attacker's line then also says which amounts the victim really took,
  and while that hit is still the last thing that moved the victim's HP, the victim is narrowed
  to them on the spot; the whole-path walk checks the same over every turn. Wave Crash recoil on
  turn 4 of the Bo3 game is what pins Blastoise's Defence. Recoil is read off the simulator's
  total over every hit and target of one use of the move, so Parental Bond's two hits and a
  multi-hit move narrow the Pokemon they hit: a hit on a Pokemon shown exactly dealt what its line
  says, one shown as a percentage one of the amounts its display allows (or its HP before less its
  HP after, when it took the other hits and nothing else moved it). A recoil a Substitute took, or
  whose hits the scaffold did not all read, is set aside.
- **Attacker HP.** Water Spout, Eruption and pinch abilities read the attacker's own HP. The
  dependence is detected by asking (does the row move when HP does?), and then the victim's line
  also filters which HP the attacker could have been on.
- **Whose stat attacks.** The move says: Foul Play attacks with the target's Attack, Body Press
  with the user's Defence, Psyshock hits Defence with a special move. A hit keeps the attacking
  values that reached the display — a flat domain, or for Body Press a dimension of the user's
  joint key. Foul Play ties the target's Attack to its own Defence — a tie, above — and a new
  guess fixes HP, Defence and Special Defence first and picks the flat stats from what survives
  beside them.
  Under Wonder Room a defence is read from the other one's stored stat (`calculateStat`), so a
  hit there narrows the other defence — a physical hit, Special Defence. Any other hidden stat a
  calculation reads — the target's Speed, for Gyro Ball and Electro Ball — takes the attacking
  stat's place when no hidden attacking stat holds it, and otherwise comes beside it as one more
  candidate value, carried like the attacker's HP: a hidden user of those two brings its Speed
  beside its Attack, and the victim's line narrows both. A hit that reads more than that is not
  used.
- **Speed order from every sort.** Queued actions (moves, Mega Evolution, switches), switch-in
  abilities, end-of-turn effects and weather's pass: two items of one sort at the same order and
  priority ran fastest first, so a Pokemon whose line came first had at least the other's speed.
  The speed compared is the simulator's at that moment — `getActionSpeed` for the queue, the
  cached `speed` for event handlers, re-taken when `setSpecies` resets it on Mega Evolution — so
  Tailwind, Trick Room's reversal, paralysis and Choice Scarf are all the simulator's. Mega
  Evolution is queued at order 104 and sorted on the speed before the forme change; switches at
  order 103, on the speed of the Pokemon going out, and the replay's switch line is matched by the
  slot it went into. A tie can go either way, so every bound is `>=`. Gen 9 re-sorts before each
  move, so the last sort before an action is the one that decided it. Where an effect sets an
  action's place the simulator writes it into the action's order — Quash 201, After You, Instruct,
  Round, the Pledges and Shell Trap 3 — so two actions are compared only where one sort had them at
  the same order and priority, by that sort's own copy of both; only `changeAction`, which nothing
  in the data calls, still sets its turn aside.
  An Illusion user's lines print its disguise's name. Each action records the name its Pokemon was
  shown by as it began, and a line naming the disguise is the Illusion user's once a later
  `|replace|` in that slot settles who switched in; an unsettled switch-in is nobody's.
  Every other sort a handler makes by speed — Magician's of the Pokemon its move hit, a nested
  event's of its handlers — and the sort of switch-in effects, whose handlers carry their Pokemon's
  speed less a fraction that only breaks a tie, are read by asking what the other order would have
  printed: the handler, or the switch-in from the queue it started from, runs again dry once in its
  own order and once with each two neighbours of different Pokemon swapped. The run in its own order
  has to print what the real one did; then the first line where a swapped run differs says the
  pair's order, from the verified lines or, at the cutoff, from the replay's line. So whose Sand
  Stream sets the weather when both sides lead a Tyranitar, or whose Intimidate goes first, bounds
  both Speeds even though the second one prints nothing.
  Where the rebuild diverges on order, the replay's order is used only when it is proved. A move
  line always prints, and so do a `|cant|` and what only `onBeforeMove` prints before a move —
  the confusion check, waking up, thawing out — each opening its Pokemon's action; a
  `detailschange` and `-mega` pair opens its Mega Evolution, a `-formechange` followed by the same
  Pokemon's own move line opens that move — Stance Change's, which `onModifyMove` prints first —
  and a switch no effect caused opens the switch out of that slot, a chosen one or the
  replacement for a Pokemon that fainted, which the simulator queues as `instaswitch` and sorts by
  the fainted Pokemon's speed. An order is read only at a priority the replay proves: it shows the
  Pokemon using, of its own choice, the exact move the rebuild queued — no `[from]` but a locked
  move, no Encore started on it earlier that turn — or, for the Pokemon that went second, no move
  it has, Struggle included, sorts below the first one's priority, asked of the simulator per move
  at that sort. A Pokemon that never showed its move — flinched, fully paralysed, asleep — or whose
  move an Encore replaced is read when the action shown just before it was sorted at the same
  order and priority as the Pokemon the rebuild moved instead, and every move it has, Struggle
  included, would be sorted at the same priority in both sorts — asked of the simulator per move,
  so a hit or a flinch between them that no priority handler of its reads does not lose the order. A handler's line counts only if the replay shows the rebuilt
  Pokemon's line later in the same phase — a Leftovers heal at full HP prints nothing. Every order
  is applied once, then again until no bound moves, so two hidden Pokemon ordered against each
  other narrow each other.
- **Pinch Berries.** After each HP change the simulator's own check is asked, per max HP, up to
  which HP the item fires; a bisection finds the edge. Champions already shades the percentage at
  a half, so a Sitrus seldom adds anything; a quarter Berry does.
- **HP given back from the other side.** What Leech Seed takes from a Pokemon shown as a
  percentage is what its seeder gets back, so the seeder's exact line says how much the seeded
  one really lost — an eighth of its max HP, which is its HP stat to within eight points. Shell
  Bell is the same link for what its holder's move dealt, exact outright when every Pokemon the
  holder hurt is shown exactly. Otherwise it is read hit by hit: the others' damage is exact, and
  for one hit on a Pokemon shown as a percentage the amounts it could have dealt come on top; for
  more — a spread move on both hidden Pokemon, a move that hits twice — the holder's line keeps
  the totals that print it, and each hit keeps the amounts some amounts of the others complete to
  one of them. A spread move counts its hits per target. All are carried like drain: the amounts
  each candidate could have lost, checked against the other Pokemon's line in the whole-path walk. Liquid Ooze turns a drain,
  Leech Seed's heal or Strength Sap's into damage of the same amount to the Pokemon that would
  have healed; that damage is read as the heal it replaced, through the simulator's own Liquid
  Ooze, so a known seeder's exact line gives a hidden holder's HP to within eight points.
- **Damage handed back.** Counter and Mirror Coat return twice the last hit their user took from
  a foe, Metal Burst and Comeuppance half as much again. When the user's HP is shown exactly, what
  it took is the replay's own, so the amount is the same for every spread: a fixed amount on the
  Pokemon it hits. When the user is shown as a percentage and the Pokemon it hits back exactly,
  that one's line says what the user took from it: each amount its own hit could have dealt is
  handed to the move the way the simulator keeps it — the `attackedBy` record rewritten, and
  Counter's and Mirror Coat's volatile told the hit again through its own `DamagingHit` handler —
  and the user is narrowed to the amounts that print the line, as with drain. Innards Out is read
  the same way: it hands the attacker the HP its holder had left, which the attacker's exact line
  says, so a hidden holder's HP is read off it, and a known holder's hands a hidden attacker a
  fixed amount. A Counter or Mirror Coat from a Pokemon shown exactly keeps what it dealt each
  candidate as a hit does, so the Innards Out it sets off is read through it too.
- **Strength Sap** heals by the target's Attack as it stood before the move lowered it. Against
  a hidden target the simulator's own `getStat` is asked for every surviving Attack before the
  move runs, and the user's exact line keeps the ones that heal what it shows. An uncapped heal
  names the Attack stat outright.
- **Pain Split** sets both Pokemon to their average HP. Its `onHit` is re-run for every HP the
  hidden one could be on, and the exact one has to land where the log shows it — the scaffold's
  line where it reproduces the log, the replay's where the scaffold first goes wrong on exactly
  that line. That holds even when the hidden one's own display lies past the cutoff, and it
  names the hidden HP almost exactly. The exact one's own HP change is its line, and is not asked
  again. Between two Pokemon both shown as percentages — a hidden
  one splitting with its partner — `onHit` is re-run for every pair of HPs the two could be on,
  and each keeps the HPs some pair leaves it on that both displays allow. Strength Sap needs no
  such pair: the heal is read off the user's display whatever it shows, one amount per Attack
  the target could have.
- **Stats moved between Pokemon.** A stat is what the simulator stored, and each stored stat
  stands on at most one candidate value: the Pokemon's own Stat Points, a constant for a known
  Pokemon, or whatever the effect that moved it made of them. A handler that writes stored stats
  — Power Split's and Guard Split's `onHit`, Speed Swap's, Power Trick's volatile starting or
  ending — is run dry before the real one, once per value of each candidate value its Pokemon's
  stats stand on, the way Pain Split is, and each stat it writes is read off as a function of the
  one that moved it. So after Power Split the hidden Pokemon's Attack is the average with yours,
  and your own Attack now stands on its Stat Points too; after Power Trick its Attack stands on
  its Defence Stat Points. Transform and Imposter copy in `transformInto`, so each copied stat
  stands on what the original stood on: nothing, once a hidden Pokemon copies one of yours, and
  its Stat Points when yours copies it. A hit's rows then patch every stat it reads with that
  function. The attacker's own key dimension can stand beside its flat attacking stat — its
  Attack and, through your split or copied Defence, its Defence — and is carried like the
  attacker's HP, as a source state the victim's line narrows. A stat that stands on two
  candidate values at once, of two hidden Pokemon, is unmapped and set aside. Each function is
  checked at the scaffold's own Stat Points against the stat the simulator really wrote.
- **Substitute.** Its cost goes through `directDamage`, which floors what it is handed, and is
  scaled like any fraction (below). A Substitute holds the number its `onStart` stored, a quarter
  of the max HP of the Pokemon that made it, rounded down, and breaks when a hit deals at least
  that, so the line after the first hit on a fresh one — `-end` or `-activate` — keeps only the
  candidates that break it or hold, while the owner's HP stays where it was. A number a handler
  stores is asked per candidate like a stored stat and tagged with the Pokemon whose Stat Points
  it stands on; the tag travels with the effect state, so a Substitute Shed Tail hands its
  replacement breaks or holds by the shedder's HP, and both are narrowed. A later hit is not read:
  what the Substitute holds then depends on what it already took.
- **Confusion self-hits** read the Pokemon's own Attack and Defence and throw one damage roll:
  `getConfusionDamage` is re-run per candidate like any hit, and the roll goes on the path. A stat
  Transform or Imposter copied from a known Pokemon is a constant there; one that stands on
  anything else sets the hit aside.
- **A survived lethal hit.** A Focus Sash, Focus Band, Sturdy or Endure announces itself before
  the hit's HP line, and it proves more than the display does: the hit was lethal, and the Pokemon
  is left on exactly 1 HP. So only candidates the hit would have knocked out are kept — which of
  them the effect saves is the simulator's own `Damage` event, asked with its chances granted:
  the line proves Focus Band's came up, whatever die a scaffold that never needed it threw. It is read even when the scaffold's hit fell
  short: the replay's Focus Sash line is then where the scaffold goes wrong, and the HP line right
  after it is read in its place — as evidence, never as a proved line for the next round. The
  converse is read too: each candidate's `Damage` event is run with its chances not granted, and
  one whose event would have printed a Focus Sash, Sturdy or Endure the replay does not show is
  ruled out, where the event run at the scaffold's own Stat Points prints what the real one did.
  And where it is the scaffold that announced the Focus Sash at the cutoff, and the replay shows
  the Pokemon's HP line there instead, the scaffold's HP line right after is read against the
  replay's: a candidate whose hit would have been lethal is left on the 1 HP the replay does not
  show — a known Vivillon left on 4/166 by a hidden Dragalge's critical Dragon Pulse names its
  Special Attack.
- **Whole paths.** Each display is first checked on its own; then every Pokemon's HP history is
  walked backwards from what survived the last display, and a spread — or an attacking stat — is
  kept only if some path through *every* turn reaches it. Without this, two unknowns hitting each
  other each look possible on turn 2 through states turn 4 rules out. The flat stat most of a
  Pokemon's changes read of itself — its Attack in confusion self-hits, its recoil, its drain — is
  followed along each path: every HP state keeps the values of that stat that reach the end from
  it, so two self-hits read one Attack between them. A tie per key alone let turn 2's state come
  from one Attack and turn 3's hit from another, and kept guesses no rebuild could reproduce.
- **The 66-point budget**, pushed through every stat after every pass. `--all-spent` assumes
  every point is spent, as real sets do — an assumption, not evidence, so it is off unless asked
  for — and the budget becomes an equality: a value survives only if some choice for everything
  else brings the total to exactly 66. On game A that takes Blastoise from 3,822 spreads to 1,420
  and Pelipper from 1.86M to 180,297, and the S3 suite keeps all 83 real spreads under it.

**What is not used, and costs precision only.** An HP change of unknown shape lets the candidate
move anywhere its next printed line allows.
An effect written as a fraction of max HP — Leech Seed's drain and a move's HP cost through
`directDamage` included — is scaled only when its amount proves the fraction: a non-integer
amount was passed unrounded. A whole one was rounded, and the code that rounded it — a hazard's,
Aftermath's, an absorbing ability's, Poison Heal's, a Berry's, Recover's `heal`, Heal Pulse's
ceiling, Moonlight's `modify`, Shed Tail's and Belly Drum's cost — is run again from its frame for
every max HP and HP a candidate could have, where at the scaffold's own Stat Points it lands where
the real run did, reads no stat that stands on a spread, and moves with no other hidden Pokemon's
HP. Where the code cannot be run again, a whole amount that is a listed fraction keeps both
roundings. A revive sets HP through `sethp`, which truncates: Revival Blessing's half is the
revive run again per candidate, and its line says whether the max HP is odd. Rest is set aside:
it puts its user to sleep before it heals. Toxic's nth tick is n sixteenths with the sixteenth rounded down first, and is scaled
that way. A move's cost to its user that the simulator rounds from the user's max HP — Struggle's
quarter, Mind Blown's, Chloroblast's and Steel Beam's half — is `applyRecoilDamage` run for each
candidate. Wish heals the number its maker's slot condition stored, half the maker's max HP,
asked per candidate like any stored number: exact for each candidate when the healed Pokemon made
it, a fixed amount when its maker is known, and from a hidden partner — switched into the maker's
slot by Ally Switch, or sent in after it left — one amount per HP Stat Point the maker could have,
so the healed Pokemon's display narrows the maker's HP too. An amount the effect's
own code writes as a number — Oran Berry's 10 HP — is the same for every spread. None of these can
remove a spread that fits.

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
  starts at 150 probes and grows only for a guess the evidence has no quarrel with. Once a turn
  has needed a bigger budget — a round got further than the last on it, or the fallback found
  the guess passes under it — every later guess starts from that budget: the dice a round hands
  on are addressed by ordinal, and a guess that draws a different number of them before that
  turn would otherwise lose the turn again and spend a round climbing back;
- the rounds are counted only when they get no further than the furthest one yet, up to four
  times as many in all, so a long battle the evidence pins a line a round is not cut off. A
  `deadline` stops the rounds, the fallback and the dice search where it falls and keeps the
  furthest rebuild so far; only the extension passes one (`extension.md`), so the commands' and
  the catalog's answers never depend on the machine's speed. An Illusion reading it cut short
  proves nothing, and every Pokemon of that side keeps every spread.

The reconstruction also blames the *other* hidden Pokemon a failing line depends on, on
alternate backtracks: the attacker for Water Spout, the victim for recoil (§7.3).

**When the evidence cannot move the guess.** A line no evidence hook reads leaves the next guess
where it was, and more dice cannot fix a wrong spread. So when a round leaves the guesses
unchanged, the evidence learned nothing, or the same line stops a rebuild again, `inferSpreads`
runs a fallback before it raises the dice budget. If the unchanged guess passes the failing turn
under a bigger search, the turn is left to the dice. Otherwise the fallback rebuilds that turn
with one stat of one inferred Pokemon the turn names changed at a time, to values the surviving
knowledge allows — the ends first, Speed first for an order, halving where one end stops before
the line and the other leaves it unchanged, then the middles — then searches every surviving value
of the stats that moved the line, then pairs of them, and takes the first spread that gets past
the line as the next guess. It only chooses a witness: every spread it tries is built from the
surviving knowledge, with the 66-point budget and the HP × Def × SpD keys that survive together,
and it removes nothing. It is bounded at 8 rebuilds per line and 32 per inference, shared with the
Illusion re-readings, with ceilings of 120 s per line and 240 s per inference behind them.

Each firing is a check, printed as `not used, turn N: <line> … - <reason>`, so the engine lists
the hooks it is missing. A line the fallback got past is listed only when the guess it moved from
cannot get past it either under the full search, nor the guess the evidence chose along the
exact HP path it proved for it: where one can, a hook read the line, and the fallback only found
dice a smaller search missed. The fallback also runs when a round's evidence removed nothing,
and then it starts from the old guess while the evidence has already chosen a new one. The reason says which: the fallback found a spread that reproduces the
line; no value it tried of a Stat Point of a Pokemon the turn names changes the line — the cause
is not a Stat Point, as with a closed sheet's assumed item; no surviving value of the stats that
move it reproduces it within the search; or a spread the evidence removed reproduces every turn
the evidence read where no surviving one reproduces this line — a possible spread was removed, the
alarm `--outside` raises. A rejected choice and turn 0 have no Stat Point to search and write no
check.

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
| 29 recordings (the 21 Reg M-B ones and the 8 probes), S3 | p2's spreads | 29 MATCH | 16 min in all on 4 threads beside a fuzz and a certify run, up to 4 min each | survives, 115 of 115 |
| the 21 Reg M-B recordings, every point assumed spent | p2's spreads | 21 MATCH | 2 min 8 s | survives, 83 of 83 |
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

**A best-of set is one team.** The server starts every game of a set from the options each
player challenged with, team included (`BestOfGame.getOptions`, `server/room-battle-bestof.ts`),
so a Pokemon's Stat Points are the same in every game, and what is still possible for it is what
every game leaves: the intersection. Each game's set keeps the real spread, so theirs does.

*Which set a game is.* The server writes into every game a `|uhtml|bestof|` heading — *Game 1
of a best-of-3*, linked to the set's own room, `game-bestof3-<format>-<number>` — and, into a
game once the next one has started, `|uhtml|next|` linked to that game's room
(`bestOfFromLog`, `replay-source.mjs`). The number is the server's battle counter, counted once
for every battle and set, so format and number name the set; the last heading is read and its
`-<password>pw` dropped, because a privacy change renames the room and writes the heading again
(`server/rooms.ts`). A replay from another server takes that server's prefix from its replay id.
A player cannot print such a line: `/adduhtml` needs `*`, `#` or `~` and arrives as a chat line.
A rebuilt log has neither the heading nor the `|showteam|` lines, so a reconstruction of a game
of a set is written with `bestOf`: the set, the game, the best-of, its own replay id, the next
game's, and both sheets as printed. A saved replay page names its replay in a hidden `replayid`
field, and a replay link's `.json` in its `id`, with `-<password>pw` for a private one.

*When two games are combined* (`combineGames`, `infer.mjs`) — only when the second game is
certainly the same set and the same team, since combining two teams is the one way to lose the
real spread: the same set, format and player on each side; both sheets alike set for set, in
order, in every field but gender, which a Champions game rolls afresh (Raichu is M in game 1 of
the live pair below and F in game 2); and two different replays that both claim one game of the
set leave the set uncombined. Both games must also have rebuilt line for line, the one narrowed
included. A game that never reproduced its whole log can stand on a reading the rest of the log
would have overturned — an Illusion user taken for what it showed — or on a mechanic the
inference does not model, and either can already have removed the real spread; a complete
rebuild is what every soundness result above was measured on. A game shown alone keeps its own
set as before, but does not narrow another. A game assumed to spend all 66 points narrows only one
that assumed the same. The surviving sets are unpacked, intersected and `tighten`ed per
Pokemon, which has the same id in every game because the sheets are in the same order, and every
game's events and checks are kept, each marked with its `game`. Nothing combined is ever written
back: each recording keeps its own game's, and a game opened later combines afresh.

Where the other games come from: the extension combines a game, when it is opened, with every
other game of its set in its recordings store (`docs/extension.md` §3); `npm run reconstruct
--with <file>` combines it with another game's `.log.json` and prints both. Neither fetches the
other games. Only the next game is named, only once it had started when the replay was saved —
so game 2 cannot find game 1 — and each rebuild in the browser takes 15–30 s; opening the games
of a set one after another combines them anyway.

| Set | Pokemon | Game 1 alone | Game 2 alone | Together |
|---|---|---|---|---|
| Bo3 games A and B (`recordings/showdown/full-sheets/`), p2 inferred | Blastoise | 3,822 | 535,418 | 181 — HP 24–32, Atk 0–4, Def 0–5, SpA 30–32, SpD 0–8, Spe 0–4 |
| | Farigiraf | 20,341,022 | 1,981,424 | 1,155,982 |
| | Pelipper | 1,858,677 | 115,515,084 | 1,858,677 |
| live pair (Reg M-C, Yo_Asta vs. cundangcap), p1 inferred | Floette-Eternal | 24,185,327 | 635,924 | 477,304 — HP 0, Def 0–10, SpA 25–32, Spe 3–32 |
| | Raichu | 3,894,227 | 4,507,341 | 1,101,672 — HP 1–32 (15 values), Atk 0–27, Def 10–32, SpA 0–13, SpD 0–27, Spe 7–28 |
| | Arcanine-Hisui | 2,756,715 | 652,721 | 35,018 — HP 0, Atk 29–32, Def 0 |
| | Volcarona | 59,028,041 | 136,663,185 | 59,028,041 — SpA 0–10 |
| | Rillaboom | 136,663,185 | 32,680,117 | 32,680,117 |

Every real spread of games A and B survives the intersection; the live pair has no known
answer. The spread a game's battle runs on is one its own game allows, and need not be one the
set allows: on the live pair, game 2's Raichu runs on 18/0/20/7/0/18, which game 1 rules out.

### 7.6 Closed team sheets — one side read off the log

A Bo1 ladder game publishes no `|showteam|`, so the opponent's item, ability, nature and
unrevealed moves are unknown as well as its Stat Points. `--infer p1|p2` no longer refuses such a
replay: the unknown side's sets are read off the log (`setsFromLog`, `scripts/lib/replay-source.mjs`).

| From the log | How |
|---|---|
| species, level, gender | the preview (`\|poke\|`) and each Pokemon's details; a forme the preview hides (`Urshifu-*`) from the Pokemon sent in |
| moves | every move each one chose; one with a `[from]` tag was called by something else, except a locked move |
| item | the first it brought: a Mega Stone, an item used up or knocked off, one announced or frisked, an effect credited to it. An item that moves — Trick, Switcheroo, Thief, Covet, Magician, Pickpocket, Symbiosis, Fling, Bug Bite, Pluck — is credited to the Pokemon that brought it to the battle. Rocky Helmet and the retaliation Berries hurt the attacker and name their holder in `[of]` |
| ability | the first it showed, and only as its species could have it: `[of]` owns Rough Skin and Hospitality but is the attacker for Volt Absorb, so the species decides. An ability that moves — Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Trace, Mummy, Wandering Spirit, Receiver — is followed the same way; `\|cant\|…\|ability: X` and `-block` name the blocker's, Flash Fire's `-start` and Prankster's `-hint` name theirs. An ability shown only after Mega Evolution belongs to the Mega forme |

What the log never showed is assumed, and the command names every assumption before it runs: an
ability the species has only one of is known by elimination, otherwise the first it lists that the
log does not rule out — an ability the simulator announces on switch-in (one with an `onStart` or
`onSwitchIn` handler) that the replay never shows is out, and the report names it; an unseen item
is none; an unseen nature is neutral. A Pokemon that never used a move is given a damaging
stand-in, never one that can be disabled at choice time, so that it can still Mega Evolve. The known side has no sheet either, so it is
checked against the log instead — every Pokemon it previewed and every move each used has to be
in the supplied team — and since a player's own team can sit on either side of someone else's
replay, a fixture's two teams go to the sides whose previews they match. A replay the server
published shows both sides as percentages; that is the spectator channel, 0.

An assumption the log rules out empties that Pokemon, and the report says so instead of printing
a spread. On the Bo1 replay (`recordings/showdown/mine-closed/…-mercifulbird-…`), MercifulBird's
Gardevoir moves before the user's Charizard-Mega-Y on turn 1, which no spread allows with a
neutral nature and no item: Gardevoir ends with nothing, and the event that removed it is the
speed order. It used Moonblast every turn, and a Choice Scarf would explain both. Ruling items and
natures in or out is the next step (§9, `closed-sheet-plan.md` Phase 2).

`--sheets closed` reads any source this way: the inferred side's sheet is withheld and its sets are
read off the log, with every box — item, ability, nature, each move — reported as read or assumed
and checked against the truth where one is known (a recording's real sets, a published sheet, a
fixture). Over the 21 recordings no box read off the log contradicts the truth; every wrong box is
an assumed one, none rebuilds line for line, and in 12 the assumptions remove the real spread:
regmb-23, -25, -34, -46, -69, -100, -111, -122, -144 and -145 through p2's Glalie and Whimsicott,
whose items (Glalitite, Focus Sash) and natures (Jolly, Bold) are assumed away, and regmb-199 and
-200 through Blastoise and Pelipper (Rain Dish, Focus Sash, Quiet, Calm). That list is the closed
baseline. The fallback above says the same of the user's closed games: at each one's first wrong
line, no Stat Point it tries changes the line.

---

## 8. Scripts

| Command | What it does |
|---|---|
| `npm run check` | Provision, then check the loopback binding, the format and the simulator's action kinds against the order reader (§12.5, S4). |
| `npm run replay` | Provision, play the fixture, re-simulate, diff, render, report. The determinism + full-information proof. |
| `npm run live` | Truncate at a turn, import it as a live room, open two windows on it. §5.9. |
| `npm run reconstruct` | Rebuild an input log from a replay plus both teams, then check it turn by turn. §7. |
| `npm run extension` | Build the Chrome extension into `extension/dist/`; `--check` holds each step to the Node reference in a throwaway Chrome. `docs/extension.md`. |
| `npm run catalog` | Put every effect Reg M-C allows through small battles, find what each lets a replay show about a hidden Pokemon, and ask the inference whether it uses it; write the two work lists `docs/evidence-open-sheets.md` and `docs/evidence-closed-sheets.md`. `docs/evidence-catalog.md` §4. |

`npm run replay` serves its page from the client host and puts a **Play from here** button in the
replay control row, which does the same thing as `npm run live` for the turn on screen. §5.10.

Shared flags: `--from <log.json>`, `--no-open`, `--verbose`, `--embed <url>`.
`npm run live` takes `--at <turn>`, `--dry-run` and `--verify <log.json>`.
`npm run reconstruct` takes `--all`, `--saved`, `--rung s1|s2|s3`, `--teams <key>`, `--infer p1|p2|both`, `--counts <file>`,
`--sheets closed`, `--all-spent`, `--certify`, `--outside`, `--with <file>` (repeatable; another game of the same
best-of set, §7.5), `--sample <n>`, `--max-probes <n>`, `--threads <n>` and `--dry-run`. `--sheets closed` reads the inferred side as if it published no sheet (§7.6). `--saved`
rebuilds every saved game of yours in `recordings/showdown/mine-open/` and `mine-closed/` whose one side is a team in
`scripts/fixtures/teams.js`, with the other side inferred, and prints one line per game: the scoreboard. A saved
replay — a `.html` page, or a replay link's `.json` — is always S4, and `--threads` only changes how long the search takes, never what it finds
(§7.3).
Each source also prints its work: rounds, rebuilds, fallback rebuilds, probes and both kinds of
backtrack, with warnings when an exact proof fails again on its own dice and choices (§12.5,
S2 and S5). `--counts <file>` prints signed differences per source and in total against the
previous counts in that file, then replaces them. These are observations, not pass/fail gates.
They are not part of the saved inference. Probe counts include every simulation the search
consumes, including look-back and variant-ranking work, but not unused speculative worker jobs.
`npm run replay` takes `--force "<outcome> <subject> [move]"` (repeatable), with `--at <turn>`,
`--always` and `--seed <seed>`: it replays the recording twice from that turn under one shared
reseed, once plain and once controlled, and reports what was substituted and which battle lines
moved. That is the headless proof for §4; `/rng` is the same engine driven from a live room.
`npm run catalog` takes `--pool`, `--list`, `--only <ids>`, `--kind <kind>`, `--sheets open|closed`,
`--inputs <file>`, `--out <dir>`, `--no-coverage`, `--check`, `--threads <n>` and `--verbose`, and
`--dump <effect> <role/template> <stat> <0|32>` for the battle behind one row, and
`--fresh` to play every effect again rather than reuse its cached record (below), and
`--regress` for the regression list (§12.5, S3), and `--records <file>` (repeatable) to render saved runs again; only records covering the whole pool
write the reports in `docs/`, and `--check` fails when a fresh full run disagrees with them.
Every run keeps each effect's record in `.cache/catalog/` under a fingerprint of all that makes
it: `local-catalog.mjs` up to its reports, `scripts/lib/`, `scripts/server/`, the fixtures but the
catalog's entries, the simulator's pinned commit, Node, the run's options, and the effect's own
entry less its `cells`, which only a report reads. A later run, `--check` included, plays only the
effects whose fingerprint changed: a change to the inference or the rebuild plays the whole pool
again, about two and a half hours on 13 threads, while a change to how the reports read, or to
one effect's battles and reasons, takes seconds or minutes. `--fresh` plays everything.
`--fuzz <n> --seed <s>` (with `--turns <n>`, `--out <dir>`) plays n random legal Reg M-C battles
in-process: teams from the published sheets in `recordings/showdown/mine-open/` and `full-sheets/` and
from `scripts/fixtures/teams.js`, random Stat Points (each at most 32, at most 66 in all, every point
spent in about half the battles), choices from the simulator's `RandomPlayerAI`. It infers p2 from
p1's view with p1 known and checks that every real spread survives, that the rebuild is a MATCH and
that nothing throws; a battle that is no MATCH is rebuilt again with p2's real Stat Points, which
says whether the inference or the rebuild is at fault. Failures are ranked by the kind of the first
wrong line, each with the one command that reruns it, in `fuzz.md` and `fuzz.json`; a seed always
plays the same battle.
`--regress` runs ten fuzz seeds and five catalog worlds, one per historical failure mechanism.
A fuzz entry checks MATCH, retention of the real spreads and exceptions. A listed catalog
world also fails on any set-aside line: four of the five historical failures kept the real
spread and eventually rebuilt, but gave up evidence. The command prints each entry's mechanism,
fix commit, seconds and verdict, with a rerun command on failure, and exits 1 if any entry fails.
Use it after each inference change; the full fuzz and catalog checks follow a batch (S7).
`replay.bat`, `live.bat`, `battle.bat` and `catalog.bat` are the double-click entry points.

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
| `scripts/local-catalog.mjs` | the evidence catalog: the pool, the battles, the difference against a control, the rebuild of each world, the closed-sheet reading, and the two reports (`evidence-catalog.md` §4) |
| `scripts/fixtures/catalog.js` | the catalog's fixed cast, its witness moves, and its hand-set battles |
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
recordings' real spreads, 115 of 115 over the 29 recordings today, plus the synthetic battles in §7.5
and the fuzzer's random battles, 100 of 100.

`evidence-catalog.md` finds the rest ahead of time: `npm run catalog` puts every legal effect
through small battles, finds which stats each lets reach the log, and checks that against what the
evidence pass uses. Its report `evidence-open-sheets.md` §2 is the work list: no legal effect
removes a real spread there, and every battle in it rebuilds. What is left (`evidence-catalog.md`
§5) is what a battle cannot tell: a speed tie, an order between two hidden Pokemon, an Illusion
switch-in nothing settles. What the catalog cannot see yet, and the battles that close it, are
`open-sheet-plan.md`.

1. **The evidence still unused** (§7.5): every line the evidence pass sets aside — in the
   catalog only a switch-in Illusion could have made, which stays unread by design, and none in
   the recordings.
2. **Certified ranges** (`--certify`, `--outside`). The inference keeps impossible spreads on
   purpose: an HP change it cannot model lets a candidate move anywhere its next display allows,
   Attack, Special Attack and Speed are separate lists that each only have to fit every hit on its
   own except where a tie holds them to the key or to each other, two unknown Pokemon that
   constrain each other are narrowed one at a time, and a speed tie counts both ways. So every
   range is an upper bound. `--certify` proves its ends: for each end, a spread there — every other
   Pokemon where the inference left it — is rebuilt, and a rebuild that reproduces the replay line
   for line is a witness anyone can check by replaying it. The range prints `?` beside an end no
   rebuild proved; the search has a budget, so that does not prove the end impossible.
   `--outside` also rebuilds one Stat Point beyond each end, which should never reproduce the log:
   one that does is a possible spread removed, found without knowing anyone's spreads, so it works
   on public replays. On recording 100 every end of Whimsicott's 75 spreads is proved, two of
   Glalie's are not (its HP and Defence maxima), and nothing outside any range rebuilds; certifying
   and probing outside took about five minutes beside a catalog run.
   - **Cost is per range end, not per spread.** At most twelve ends per Pokemon, and fewer
     rebuilds than that: the spreads the inference settled on are a witness already, and a spread
     that sits at several ends is rebuilt once. A Pokemon the log never touched is not certified:
     every spread fits. The expensive case is a witness that fails, which spends its whole search
     budget (600 probes) before giving up.
   - **Every Pokemon at once first.** One rebuild pins every unknown Pokemon at the same end of
     one stat; when it reproduces the log, it proves all those ends, so a battle needs about as
     many rebuilds as one Pokemon does. A joint witness that fails says nothing about which
     Pokemon's value was impossible; its ends are then tried one Pokemon at a time.
   - **What stays unproven:** points inside a range, which can have gaps, and the spread count,
     which would take a witness per spread. And "possible" is possible under the pinned simulator;
     a live server with different mechanics would make both proofs about the wrong battle.

### Closed team sheets — what is still open (§7.6)

The sets are read off the log and the rest is assumed. `evidence-closed-sheets.md` §2 is the work
list: what `setsFromLog` reads wrong or misses, and which items, abilities and natures change the
log unnamed, with the witness battles in which today's assumption then removes the real spread.
`closed-sheet-plan.md` is the plan that replaces the assumption with elimination: each unknown box
a list of candidates, removed only when the simulator says no spread under it fits.

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

---

## 12. Implementation audit — 2026-10-23

Audited commit: [`db263410b5f80974a67e3e426608fdd50f796755`](https://github.com/grenmango51/encoreable/tree/db263410b5f80974a67e3e426608fdd50f796755).

This section preserves the complete 83-suggestion audit for a later implementation session. The audit covered Encoreable-owned reconstruction, inference, RNG controls, extension, persistence, local runtime and developer tools. Showdown remains the source of truth for battle mechanics.

These findings describe the audited commit; they are not claims that fixes have been implemented. Reproduce each relevant issue against the current checkout before changing it. Preserve the distinction between a deterministic contradiction, an incomplete search and a verified witness.

### 12.1 Priority, confidence and validation

- **P1:** answer correctness or data integrity.
- **P2:** reliability or throughput.
- **P3:** larger investigation or portability.
- **Effort S / M / L:** relative implementation size, not a time estimate.
- **Reproduced:** a focused local probe demonstrated the named behavior. Some control-flow probes used controlled or mocked inputs/results, as stated in the finding.
- **Static defect:** a concrete faulty code path identified by inspection.
- **Likely bottleneck:** a candidate for profiling; no benchmark improvement is claimed.
- **Design improvement / planned design caution:** proposed hardening or a specific amendment to the existing plan, rather than a newly discovered implemented feature.

Checks and limits:

- git pull --ff-only: already up to date on main.
- npm run check: PASS; 8.53 seconds including runtime provisioning (one local run).
- In-memory replay of all 29 recordings/local/*.log.json: 28 mechanics matches and input-log round trips; the sole exception is the documented scripted Reg M-B recording 23 with targetless Memento. Player bookkeeping was excluded consistently with verify-branch.
- Exact verify-branch helper probe: 0 errors reported before drain versus 14 when collected after drain on that known-bad log.
- Static-route and malformed-thread expressions were exercised in memory; no traversal request was sent to a live server.
- A zero-Stat-Point version of the existing fixture passed the actual Reg M-C team validator, while local-replay’s exact-66 budget predicate returned false.
- An isolated VM probe of the actual RNG panel returned the first room’s cached damage ladder in a different room without issuing a new request; hook installation returned true then false on repeat.
- Current recording listing: 30 combined entries, 224 statSync calls, approximately 9 ms in one local run.
- No source, tracked documentation, or recordings were changed. README.md and docs/plan.md edits predated this audit.
- Full browser extension checks, inference rungs, a fresh catalog and sustained benchmarks were not run for this read-only audit.
- Three bounded reviewers used isolated module probes and the pinned simulator for targeted findings. Controlled/mocked-result probes demonstrate the named control-flow behavior, not a full browser or inference-corpus pass.

The statement that no files changed refers to the read-only audit itself. This section was subsequently added to preserve its report. No implementation fixes are included.

### 12.2 Recommended starting order

1. **[A32 — Make verification a contract shared by the CLI, extension and saved artifacts](#a32)** A result must carry independent replayability, verified reach and assumptions; completion alone cannot establish trust.
2. **[A28 — Fix the current RNG tooltip cache and acknowledgement isolation](#a28)** This is a reproduced cross-room stale-value problem in the code used by both local and extension controls.
3. **[A50 — Protect sound inference when searches are incomplete](#a50)** A failed or budget-exhausted search is undecided; it cannot justify eliminating a possible identity reading.
4. **[A67 — Repair the HP backtracker’s channel, side and line classification](#a67)** These are small, concrete mistakes in the search machinery and can cause wasted work or missed reconstructions.
5. **[A44 — Introduce explicit format and stat-model admission checks](#a44)** A reproduced unsupported import resolved Gen 8 data as Gen 9; reject unsupported profiles before they reach the solver.
6. **[A71 — Validate supplied teams without silently rewriting their identities](#a71)** Use authoritative species identities and observed fields, while retaining ambiguity among matching teambuilder teams.
7. **[A13 — Make recording identity and persistence durable](#a13)** Protect distinct immutable logs, pending branch state and truthful save status across reloads, resets and devices.
8. **[A14 — Profile repeated work, then optimize the largest measured stages](#a14)** Target duplicated world inference, whole-knowledge copies, repeated scaffold passes and eager worker startup before adding more threads.

Implement the first pass as small correctness changes, then shared format and evidence contracts, then performance refactors measured against the same replay corpus. Each batch must preserve replay determinism and every valid inference candidate.

Existing strengths to preserve:

- The simulator remains the source of truth for all battle mechanics.
- Turn-boundary snapshots and RNG pins already avoid replaying every probe from turn one.
- Knowledge already uses compact masks, budget propagation, ties and explicit certification.
- Node and the extension reuse the same reconstruction and RNG code.
- Uncertain candidates and budget-exhausted searches must remain distinguishable from disproved possibilities.
- recordings/local remains immutable.

The open-sheet plan is marked complete. The closed-sheet plan already schedules candidate item, ability and nature inference; that missing feature is not counted as a new discovery here. A56 is explicitly an amendment to the planned equivalence proof, and A83 covers a concrete contradictory fallback that the planned candidate transition should handle.

### 12.3 Complete findings

Source links below are pinned to the audited commit. Each item includes its proposed change and acceptance check. The stable A01–A83 identifiers are shared with the original interactive report.

#### Format scalability

<a id="a27"></a>

##### A27 — Separate fixture assertions from general replay validity

**P1 · Reproduced + static · Effort M**

**Why it matters:** The replay checker assumes every spread spends exactly 66 points, derives HP with the Champions level-50 formula and treats denominator 100 as proof of percentage HP. A zero-Stat-Point version of the existing fixture passed Showdown’s Reg M-C validator but failed the replay checker’s budget predicate. The HP assumptions also prevent general-format reuse. Reconstruction also embeds the HP formula in early team checks.

**Proposed change:** Keep the existing fixture-specific proof, but gate it by an explicit capability profile. For arbitrary logs obtain stats and legal limits from the actual simulator/validator and record the HP observation mode explicitly. Reuse the simulator-backed approach already present in sheetsOf().

**Validation:** Test underspent teams, other levels/stat models, exact max HP of 100 and percentage channels; determinism should remain an independent check.

**Sources:** [scripts/local-replay.mjs:248](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L248), [scripts/local-replay.mjs:332](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L332), [scripts/local-replay.mjs:344](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L344), [scripts/local-reconstruct.mjs:358](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L358), [scripts/lib/reconstruct.mjs:242](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L242).

<a id="a44"></a>

##### A44 — Reject extension formats whose simulator mod data is absent

**P1 · Reproduced · Effort S**

**Why it matters:** The bundle includes only two mods, but the fs shim advertises every installed mod. Under the shipped loader policy, a reviewer probe resolved gen8ou as generation 9, while Node resolved generation 8.

**Proposed change:** Check the requested format’s full mod ancestry against embedded data before opening or reconstructing; explicitly reject unavailable capability profiles.

**Validation:** Unsupported Gen 8 input must fail clearly; supported Reg M-B/M-C simulator parity must remain intact.

**Sources:** [scripts/local-extension.mjs:50](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-extension.mjs#L50), [extension/src/node/fs.js:27](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/node/fs.js#L27).

<a id="a58"></a>

##### A58 — Give inference an explicit supported stat-model descriptor

**P1 · Design improvement · Effort M**

**Why it matters:** knowledge fixes 33-value domains and a 66-point budget, while inferSpreads accepts arbitrary format IDs. Another format can enter a representation whose coordinates do not mean its stats.

**Proposed change:** Pass an explicit format-model descriptor and reject unsupported models before inference. Keep actual stat calculations in Showdown and include the model identity in packed knowledge.

**Validation:** Unsupported stat models must fail at admission; supported Champions knowledge, ranges and counts must remain identical.

**Sources:** [scripts/lib/inference/knowledge.mjs:16](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/knowledge.mjs#L16), [scripts/lib/inference/infer.mjs:179](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L179).

<a id="a22"></a>

##### A22 — Carry the recording’s actual format into replay output

**P2 · Static defect · Effort S**

**Why it matters:** local-replay always uses the Reg M-C FORMAT for output filenames, titles and replay metadata, even when --from loads a Reg M-B or future-format recording.

**Proposed change:** Read format identity from the input-log start/validated metadata and use it consistently; keep fixture format as a default only when creating that fixture.

**Validation:** Render two formats and require the page metadata, title and actual simulator format to agree.

**Sources:** [scripts/local-replay.mjs:58](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L58), [scripts/local-replay.mjs:421](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L421).

#### Inference & closed sheets

<a id="a50"></a>

##### A50 — Do not reject an Illusion reading because its search ran out

**P1 · Static soundness defect · Effort M**

**Why it matters:** Alternative Illusion readings are retained only if they rebuild completely when the baseline completed. A probe-budget failure before the wall-clock deadline can therefore discard a possible identity reading and retain cuts against the real spread.

**Proposed change:** Discard a reading only after a deterministic contradiction; union conservative knowledge for incomplete alternatives, using blank knowledge where needed. Treat budget exhaustion as undecided.

**Validation:** Force an alternative reading to exhaust its probe budget while the baseline completes; every possible spread under that reading must survive.

**Sources:** [scripts/lib/inference/infer.mjs:879](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L879).

<a id="a51"></a>

##### A51 — Keep outside-range probes within the all-spent assumption

**P1 · Reproduced · Effort S**

**Why it matters:** Certification lowers other stats when a probe exceeds 66, but does not restore points when a lowered coordinate produces 65. A controlled call of the actual certifier requested 65-point witnesses for spent knowledge, allowing a false possible-spread-removed alarm.

**Proposed change:** Construct outside probes by relaxing the tested coordinate while preserving the rest of the knowledge contract, including spent=true.

**Validation:** Every all-spent probe must total exactly 66; a successful out-of-contract witness must never be reported as an inference counterexample.

**Sources:** [scripts/lib/inference/infer.mjs:1107](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L1107).

<a id="a52"></a>

##### A52 — Invalidate certificates when combining games or changing ranges

**P1 · Reproduced · Effort M**

**Why it matters:** combineGames intersects ranges but preserves the original certified object. A probe moved an HP minimum from 0 to 1 while keeping the old true flag; a witness for one game also does not prove consistency with every contributing game.

**Proposed change:** Clear certificates on combination, or revalidate their complete witnesses against all games and the new endpoint values. Bind proof status to its full context.

**Validation:** Combine certified games with changed endpoints and require no stale flag; replay any retained joint witness against every contributing game.

**Sources:** [scripts/lib/inference/infer.mjs:1014](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L1014), [scripts/lib/inference/infer.mjs:1025](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L1025).

<a id="a59"></a>

##### A59 — Validate each Stat Point coordinate before encoding it

**P1 · Reproduced · Effort S**

**Why it matters:** Membership checks the total and flattened key without each coordinate’s integer bounds. keyOf(0,33,0) aliases keyOf(1,0,0); a probe accepted def=33 against knowledge containing only hp=1, def=0.

**Proposed change:** Validate finite integer coordinates in the supported range at membership, pinning and external input boundaries; retain intentional defaults for omitted coordinates.

**Validation:** Reject negative, fractional, nonfinite and over-limit values, including the reproduced alias, while accepting every valid boundary.

**Sources:** [scripts/lib/inference/knowledge.mjs:767](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/knowledge.mjs#L767), [scripts/lib/inference/knowledge.mjs:36](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/knowledge.mjs#L36).

<a id="a83"></a>

##### A83 — Report exhausted ability candidates instead of reviving a ruled-out one

**P1 · Reproduced · overlaps plan · Effort S**

**Why it matters:** After every ability is excluded, setsFromLog falls back to abilities[0]. A probe ruled out both Blaze and Solar Power yet returned Blaze. Candidate lists are already planned; this is a concrete contradiction the transition must handle.

**Proposed change:** Return explicit candidate exhaustion with its evidence and do not restart inference under a disproved fallback.

**Validation:** Excluding every legal ability must yield a contradiction with reasons, never one of the excluded assumptions.

**Sources:** [scripts/lib/replay-source.mjs:622](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L622), [docs/closed-sheet-plan.md:339](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/docs/closed-sheet-plan.md#L339).

<a id="a53"></a>

##### A53 — Return the furthest verified rebuild when later rounds regress

**P2 · Reproduced · Effort S**

**Why it matters:** The loop overwrites built, while deepest retains only coordinates. Controlled reconstruction results reaching turn 5 then turn 2 returned the later turn-2 result.

**Proposed change:** Retain a coherent best-result bundle containing rebuild, chosen spreads, verified reach and associated proof state; return it on exhaustion or deadline.

**Validation:** Feed a turn-5 result followed by a turn-2 result, then stop by rounds and deadline; both paths must return the furthest valid bundle.

**Sources:** [scripts/lib/inference/infer.mjs:662](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L662).

<a id="a54"></a>

##### A54 — Extend cancellation and deadlines through evidence processing

**P2 · Static defect · Effort M**

**Why it matters:** Evidence settling, nested guess selection and the final pass can start substantial work without checking or receiving the deadline. The final settling pass can run after expiry.

**Proposed change:** Pass one cancellation/budget context into evidence work, check between bounded candidate batches, and stop with sound partial knowledge plus an explicit incomplete reason.

**Validation:** Expire an injected clock during evidence; require bounded completion and preserve all survivors not deterministically eliminated.

**Sources:** [scripts/lib/inference/infer.mjs:685](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L685), [scripts/lib/inference/infer.mjs:727](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L727), [scripts/lib/inference/infer.mjs:805](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L805).

<a id="a55"></a>

##### A55 — Account for every fallback rebuild under one dispatcher

**P2 · Static defect · Effort M**

**Why it matters:** Mandatory fallback rebuilds can start without another affordability check; a diagnostic rebuild bypasses the counter. Local time allowances are checked between calls but are not passed into each call.

**Proposed change:** Route every rebuild, including diagnostic ones, through a checked dispatcher using the smaller of global and local deadlines and one probe/rebuild budget.

**Validation:** With one rebuild remaining, no path may execute two; a single rebuild must also observe its local time limit.

**Sources:** [scripts/lib/inference/infer.mjs:442](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L442), [scripts/lib/inference/infer.mjs:605](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L605).

<a id="a56"></a>

##### A56 — Strengthen the planned proof of candidate equivalence

**P2 · Planned design caution · Effort M**

**Why it matters:** The closed-sheet plan’s own-handler silence criterion can miss effects read externally, such as conditions/moves querying an item, and thresholds dormant only at the scaffold spread. This is a specific amendment to planned class inference, not a claim that candidate inference already exists.

**Proposed change:** Track external item/ability reads and candidate dependencies; when equivalence is unproven, retain a separate active class. Do not infer inertness from one scaffold’s unchanged behavior.

**Validation:** A screen-duration item and a berry that triggers under another spread must not be merged into an inert class.

**Sources:** [docs/closed-sheet-plan.md:112](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/docs/closed-sheet-plan.md#L112).

<a id="a57"></a>

##### A57 — Assert cache ownership before reusing evidence across set classes

**P2 · Design improvement · Effort M**

**Why it matters:** Raw replay cache uses a constant key, and damage/speed entries use ordinals without candidate-set identity. Current callers generally isolate each scaffold’s cache; future reuse across planned item/ability/nature classes would make that implicit contract unsafe.

**Proposed change:** Give each cache an asserted scaffold/model identity, and separate class-independent entries from candidate-dependent answers.

**Validation:** Evaluate two set classes in both orders, with caching enabled and disabled; packed surviving knowledge must agree exactly.

**Sources:** [scripts/lib/inference/evidence.mjs:196](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/evidence.mjs#L196).

<a id="a60"></a>

##### A60 — Bound damage-row and transition enumeration conservatively

**P2 · Likely bottleneck · Effort L**

**Why it matters:** Damage evidence enumerates target HP states × source states × attacking values × defending values, then expands transition tables. These paths lack caps comparable to other expensive evidence evaluators.

**Proposed change:** Deduplicate identical simulator inputs, build rows lazily and impose explicit resource limits; set evidence aside conservatively when a limit is reached.

**Validation:** Measure rows and table bytes on bounded server cases; capped evaluation must retain every survivor of the uncapped reference.

**Sources:** [scripts/lib/inference/evidence.mjs:927](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/evidence.mjs#L927), [scripts/lib/inference/evidence.mjs:1041](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/evidence.mjs#L1041).

<a id="a62"></a>

##### A62 — Cache derived counts and supported values by knowledge revision

**P2 · Likely bottleneck · Effort M**

**Why it matters:** Recorded evidence computes supported values and independently counts spreads before and after many events. Counts rebuild local memo tables even when the knowledge is unchanged.

**Proposed change:** Cache derived summaries by revision, or calculate supported values, ranges and counts together over the same traversal.

**Validation:** Keep explanation counts, ranges and grids exactly equal while reducing full-key scans and summary time.

**Sources:** [scripts/lib/inference/evidence.mjs:518](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/evidence.mjs#L518), [scripts/lib/inference/knowledge.mjs:414](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/knowledge.mjs#L414).

<a id="a63"></a>

##### A63 — Probe priority and Speed only for relevant comparisons

**P2 · Likely bottleneck · Effort M**

**Why it matters:** Queue sorts evaluate every available move plus Struggle, and speed tables can include constant known owners. Full probing is primarily needed for ambiguous or unseen-action reasoning.

**Proposed change:** Pre-index visible replay actions, reserve complete priority probing for ambiguous cases, and skip comparisons that cannot constrain an unknown owner.

**Validation:** Preserve speed cuts for unseen moves, Encore, priority moves and Speed Swap while counting fewer simulator queries.

**Sources:** [scripts/lib/inference/speed.mjs:147](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/speed.mjs#L147).

<a id="a65"></a>

##### A65 — Probe stored-stat writes using demonstrated dependencies

**P2 · Likely bottleneck · Effort M**

**Why it matters:** Stored-stat handling collects all five movable stats per involved hidden Pokémon and tries all 33 values of every dependency. Speed Swap can therefore cause unrelated Attack/defence probes.

**Proposed change:** Extend the existing Proxy instrumentation to trace stat reads; narrow probing only when dependency coverage is established, otherwise keep conservative enumeration.

**Validation:** Speed Swap, Power Split and Guard Split must retain identical mappings with fewer dry runs; ambiguous effects must retain the conservative fallback.

**Sources:** [scripts/lib/inference/evidence.mjs:2893](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/evidence.mjs#L2893).

<a id="a66"></a>

##### A66 — Retain replayable certification witnesses instead of booleans

**P2 · Design improvement · Effort M**

**Why it matters:** Successful range-end rebuilds are reduced to flags without retaining endpoint values, full team assignments and successful input logs. Later transformations can change the context while the flag remains.

**Proposed change:** Store deduplicated witness records with simulator/model identity and assumptions, and let each endpoint reference the witness that proves it.

**Validation:** Reload and replay each retained witness without rerunning inference or dice search; reject mismatched context or endpoint values.

**Sources:** [scripts/lib/inference/infer.mjs:1063](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L1063).

<a id="a61"></a>

##### A61 — Share unchanged knowledge with copy-on-write

**P3 · Likely bottleneck · Effort L**

**Why it matters:** cloneKnowledge copies every mask and tie, including known singletons, and nested guess selection calls it repeatedly. One key tie is about 281 KiB before multiplying candidate classes.

**Proposed change:** Use immutable sharing and copy-on-write for known records and unchanged masks; make ownership explicit so speculative branches cannot mutate siblings.

**Validation:** Compare packed results exactly, test sibling isolation, and measure allocations and peak memory on representative searches.

**Sources:** [scripts/lib/inference/knowledge.mjs:152](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/knowledge.mjs#L152), [scripts/lib/inference/infer.mjs:722](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L722).

<a id="a64"></a>

##### A64 — Separate scaffold capture from repeated constraint propagation

**P3 · Likely bottleneck · Effort L**

**Why it matters:** A settling call can replay a scaffold eight times, and nested guess selection starts many such calls. Cached damage rows do not remove replay and hook overhead.

**Proposed change:** Explore an immutable evidence trace per scaffold with dependency-driven constraint reevaluation. Replay again only when capture actually depends on the changed domain.

**Validation:** Match final knowledge, exact HP paths and handed-on RNG rolls against the current full-replay implementation before claiming a speedup.

**Sources:** [scripts/lib/inference/infer.mjs:232](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/inference/infer.mjs#L232).

#### Reconstruction & replay parsing

<a id="a67"></a>

##### A67 — Read exact HP from the omniscient channel before backtracking

**P1 · Reproduced · Effort S**

**Why it matters:** exactHp scans raw split-channel output. A secret 96/192 followed by public 50/100 returns 50; 0 fnt is ignored, leaving an earlier reading. This corrupts the filter for RNG draws that actually changed hidden HP.

**Proposed change:** Resolve channel -1 before reading exact HP and handle fainted HP explicitly.

**Validation:** Two exact HP values behind the same displayed percentage must remain distinguishable; a lethal hit must yield zero.

**Sources:** [scripts/lib/reconstruct.mjs:1866](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1866).

<a id="a68"></a>

##### A68 — Keep side identity throughout HP backtracking

**P1 · Reproduced · Effort M**

**Why it matters:** blameTurn and exactHp identify Pokémon by name alone. A mirror-match probe blamed p1 Blastoise’s later damage for a failure involving p2 Blastoise.

**Proposed change:** Carry side plus stable Pokémon identity through stuck-state attribution, blame selection and exact-HP comparisons.

**Validation:** Mirrored species/nicknames with different histories must backtrack to their own side’s last relevant HP-changing turn.

**Sources:** [scripts/lib/reconstruct.mjs:1828](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1828), [scripts/lib/reconstruct.mjs:2168](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L2168).

<a id="a69"></a>

##### A69 — Fix the hidden-HP culprit’s protocol-line guard

**P1 · Reproduced · Effort S**

**Why it matters:** The regex /^|-(damage|heal)|/ matches every string because of its unescaped separators and empty alternatives. Non-HP failures can enter attacker-HP backtracking.

**Proposed change:** Use an anchored protocol-aware damage/heal guard with escaped pipe separators, and test it as a classification boundary.

**Validation:** cant, status and move lines must produce no hidden HP culprit; actual damage and recoil/drain attribution must remain valid.

**Sources:** [scripts/lib/reconstruct.mjs:1851](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1851).

<a id="a70"></a>

##### A70 — Include both legal targets for adjacentAllyOrSelf moves

**P1 · Reproduced · Effort S**

**Why it matters:** The target branch always returns self and drops even an observed ally target. A real-simulator Qwilfish using Acupressure on its ally failed reconstruction because the rebuild always chose Qwilfish.

**Proposed change:** Enumerate self and eligible allies from the simulator request, ordering the observed target first.

**Validation:** Reconstruct both ally-targeted and self-targeted Acupressure under the original seed with exact protocol agreement.

**Sources:** [scripts/lib/reconstruct.mjs:346](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L346).

<a id="a71"></a>

##### A71 — Restrict supplied-sheet alignment to legitimate identity changes

**P1 · Reproduced · Effort M**

**Why it matters:** alignSpeciesToSheet rewrites any species mismatch by slot before checking the sheet. In a probe, supplied Charizard became Blastoise and then passed the species check, potentially attaching one species’ spread to another.

**Proposed change:** Normalize only simulator-recognized equivalent battle formes; reject unrelated species, or map an explicitly reordered team without rewriting identity.

**Validation:** Preserve legitimate Mega/base normalization but reject Charizard/Blastoise and wrong-fixture alignment.

**Sources:** [scripts/lib/replay-source.mjs:272](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L272), [scripts/local-reconstruct.mjs:336](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L336).

<a id="a72"></a>

##### A72 — Replace prefix matching with explicit simulator species identity

**P1 · Reproduced · Effort M**

**Why it matters:** sameSpecies equates Mew/Mewtwo, Porygon/Porygon2 and an empty string/Charizard, and can conflate distinct regional formes. This affects fixture assignment, identity recovery and truth checks; examples establish a matcher defect, not current-format legality.

**Proposed change:** Use Dex identities with an explicit permitted battle-form relation, and reject empty identities.

**Validation:** Reject unrelated prefixes and distinct regional formes while retaining every supported legitimate battle-form transition.

**Sources:** [scripts/lib/replay-source.mjs:175](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L175).

<a id="a73"></a>

##### A73 — Keep copied moves separate from original-set evidence

**P1 · Reproduced · Effort M**

**Why it matters:** A Transform log followed by Flamethrower adds both to Ditto’s original move set; later copied moves need no from tag. The unsettled Illusion path also lacks the temporary-move safeguard used by another unmasking path.

**Proposed change:** Track move acquisition provenance and its lifetime through Transform, Mimic and similar effects; use only original moves for sheet validation and identity evidence.

**Validation:** Copied moves must neither invent an original set nor falsely settle an Illusion identity; genuine revealed original moves must still constrain it.

**Sources:** [scripts/lib/replay-source.mjs:481](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L481), [scripts/lib/protocol.mjs:172](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/protocol.mjs#L172).

<a id="a74"></a>

##### A74 — Check a transferred ability against its original owner

**P1 · Reproduced · Effort M**

**Why it matters:** After an ally Skill Swap, ability provenance can identify the donor, but couldHave first checks the recipient’s species. A Poison Heal announcement on Audino was ignored, leaving donor Gliscor assumed to have Hyper Cutter. This is a residual defect in transfer support described as implemented.

**Proposed change:** Resolve the ability token’s origin before applying species compatibility; preserve original versus current-holder provenance.

**Validation:** An ally swap followed by an announcement only on the recipient must credit the donor’s original ability correctly.

**Sources:** [scripts/lib/replay-source.mjs:594](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L594).

<a id="a75"></a>

##### A75 — Resolve Illusion before validating supplied max HP

**P1 · Reproduced · Effort M**

**Why it matters:** The early HP reader attributes a disguised Zoroark’s exact HP to Blastoise; the later replace adds Zoroark but leaves the false Blastoise reading. A correct known team can be rejected before reconstruction starts.

**Proposed change:** Attribute HP through resolved Illusion identity and leave unresolved stays unchecked rather than assigning their HP to the disguise.

**Validation:** A broken disguise must constrain Zoroark’s HP only; an unresolved disguise must not create a false known-team mismatch.

**Sources:** [scripts/lib/replay-source.mjs:226](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L226), [scripts/local-reconstruct.mjs:350](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L350).

<a id="a76"></a>

##### A76 — Cross-check revealed original items and abilities on supplied teams

**P1 · Reproduced · Effort S**

**Why it matters:** crossCheckLog checks species and moves but not revealed item/ability fields. A supplied Blaze/Sitrus Berry Charizard passed a log explicitly revealing Solar Power/Leftovers.

**Proposed change:** Compare original fields only when the parser marks them as observed; exclude assumed and temporarily transferred effects.

**Validation:** Reject the reproduced mismatch immediately, while leaving unrevealed fields unconstrained and handling transferred effects correctly.

**Sources:** [scripts/lib/replay-source.mjs:669](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/replay-source.mjs#L669).

<a id="a78"></a>

##### A78 — Do not save a complete artifact after its independent replay failed

**P1 · Static defect · Effort S**

**Why it matters:** The CLI changes its exit status after an independent replay mismatch but continues writing complete:r.complete. A downstream consumer can load an artifact whose completion flag survived a failed proof.

**Proposed change:** Persist replayability/self-consistency separately from search completeness, and keep failed-proof output explicitly diagnostic instead of trusted.

**Validation:** Inject a built input/log mismatch and require the saved result to retain its failed verification state.

**Sources:** [scripts/local-reconstruct.mjs:462](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L462), [scripts/local-reconstruct.mjs:575](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L575).

<a id="a77"></a>

##### A77 — Parse the start payload as JSON rather than matching its typography

**P2 · Reproduced · Effort S**

**Why it matters:** truncateAtTurn requires the literal substring formatid followed immediately by its value. Valid JSON containing whitespace after the colon is rejected.

**Proposed change:** Parse the start payload once and validate a nonempty string formatid; distinguish malformed JSON from a missing required field.

**Validation:** Compact, spaced and pretty-formatted equivalent JSON must behave identically; malformed and missing-format cases must give distinct errors.

**Sources:** [scripts/lib/truncate.mjs:141](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/truncate.mjs#L141).

<a id="a79"></a>

##### A79 — Enforce reconstruction budgets at every simulation request

**P2 · Static defect · Effort M**

**Why it matters:** Outer-loop deadline checks do not bound long candidate scans, variant ranking, redraw look-ahead or Illusion retries. Some look-ahead probes also escape local probe accounting.

**Proposed change:** Centralize simulation requests behind a cancellation/deadline/probe-budget gate and return the best verified result when the gate closes.

**Validation:** With a fake clock and counter, no new probe may begin after cancellation or exhaustion; diagnostic and look-ahead probes must count too.

**Sources:** [scripts/lib/reconstruct.mjs:1666](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1666), [scripts/lib/reconstruct.mjs:1889](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1889), [scripts/lib/reconstruct.mjs:2111](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L2111).

<a id="a80"></a>

##### A80 — Start probe workers lazily and bound speculative look-ahead

**P2 · Likely bottleneck · Effort M**

**Why it matters:** The pool starts before initial playback establishes that search is needed. Scans can enqueue their remaining budget; cancellation drops queued jobs but leaves dispatched obsolete work running.

**Proposed change:** Create the pool on the first actual search and keep a small speculative queue proportional to worker count; stop obsolete generations promptly.

**Validation:** A matching initial playback should start zero workers. On the server compare time, memory and discarded probes while requiring identical answers across thread counts.

**Sources:** [scripts/lib/reconstruct.mjs:2030](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L2030), [scripts/lib/reconstruct.mjs:1709](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1709), [scripts/lib/reconstruct.mjs:1509](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1509).

<a id="a81"></a>

##### A81 — Precompute invariant observed-turn comparisons

**P2 · Likely bottleneck · Effort M**

**Why it matters:** Search comparisons repeatedly filter and split the same observed segment, including hit steering and reachability scans.

**Proposed change:** Cache normalized observed lines, exact-prefix boundaries and action boundaries per reconstruction context; normalize only the changing simulated slice.

**Validation:** Require byte-identical results and unchanged sampling decisions, then measure comparison CPU time on search-heavy replays.

**Sources:** [scripts/lib/reconstruct.mjs:698](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L698), [scripts/lib/reconstruct.mjs:781](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L781).

<a id="a82"></a>

##### A82 — Align HP-accuracy metrics by event identity

**P2 · Reproduced · Effort M**

**Why it matters:** The accuracy metric pairs readings only by ordinal. A probe paired expected damage to Pokémon A with rebuilt healing of Pokémon B, both 100/200, and reported 100% exact with zero unmatched.

**Proposed change:** Match turn, side/Pokémon identity, event kind and occurrence; report missing and extra events separately, especially for partial reconstructions.

**Validation:** Unrelated matching numbers must not count as exact; inserted, removed and repeated HP events must be diagnosed correctly.

**Sources:** [scripts/local-reconstruct.mjs:165](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L165).

#### Extension & storage

<a id="a32"></a>

##### A32 — Honor the reconstruction’s self-consistency verdict

**P1 · Reproduced · Effort S**

**Why it matters:** The replay entry ignores built.selfConsistent and built.ok. A reviewer probe returned selfConsistent:false yet opened a branch and announced that it matched the replay line for line.

**Proposed change:** Require independent replay consistency before assigning verified status or opening a trusted branch; keep valid partial results explicitly partial.

**Validation:** Inject an inconsistent complete result and require no verified recording, branch or success claim.

**Sources:** [extension/src/room.js:460](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L460), [extension/src/engine.js:453](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L453).

<a id="a33"></a>

##### A33 — Enforce verified-turn limits at every recording entry point

**P1 · Reproduced · Effort S**

**Why it matters:** openReplay checks the verified reach, but stored-recording entry bypasses that check and the recordings page permits the full replay turn count. A probe opened turn 7 from a recording verified only through turn 2.

**Proposed change:** Centralize the reach check for replay, import, stored-recording and restore entry points; retain verifiedThroughTurn in the contract.

**Validation:** Reject every attempt above a partial recording’s verified boundary while allowing its earlier positions.

**Sources:** [extension/src/room.js:483](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L483), [extension/src/recordings.js:60](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/recordings.js#L60).

<a id="a34"></a>

##### A34 — Treat teambuilder matches as candidates until unambiguous

**P1 · Reproduced · Effort M**

**Why it matters:** ownTeam takes the first species-matching team and treats its spreads as known. A probe selected an obsolete spread over another team with the same species; mirror matches favor p1.

**Proposed change:** Use simulator-normalized identities, check observed fields, and retain ambiguity when several teams or sides fit. Do not silently fix a team just because its species list matches.

**Validation:** Test duplicate-species teams with different spreads, reordered teams and mirrored sides; correct supplied data must remain selectable.

**Sources:** [extension/src/room.js:370](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L370).

<a id="a35"></a>

##### A35 — Propagate simulator stream errors through the extension adapter

**P1 · Reproduced · Effort M**

**Why it matters:** The stream adapter intercepts push, while simulator exceptions can arrive through pushError. The actual adapter accepted malformed player JSON after valid initialization and could register an apparently successful session.

**Proposed change:** Reject failed opens and writes, propagate the stream’s error channel, and dispose failed sessions before publishing an ID.

**Validation:** Malformed player/start/choice input must reject once and leave no registered session.

**Sources:** [extension/src/engine.js:46](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L46), [extension/src/engine.js:205](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L205).

<a id="a39"></a>

##### A39 — Make branch autosave failure visible and skip unchanged writes

**P1 · Reproduced + likely cost · Effort M**

**Why it matters:** persist swallows storage errors and repeatedly serializes full inference, including after read-only RNG requests. Quota failure was reproduced; repeated serialization is an unprofiled cost.

**Proposed change:** Display durable-save status, separate immutable inference from changing branch state, and save only when the persisted revision changes.

**Validation:** Inject quota failure; measure writes and main-thread serialization during tooltip-only use; reload a successfully saved branch.

**Sources:** [extension/src/room.js:45](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L45), [extension/src/room.js:151](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L151), [extension/src/room.js:260](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L260).

<a id="a40"></a>

##### A40 — Never announce that a reconstruction was saved after saving failed

**P1 · Reproduced · Effort S**

**Why it matters:** openReplay catches save failure only in the console, then can tell the user that the recording is saved. A reviewer reproduced that exact false assurance.

**Proposed change:** Track save success independently from reconstruction success and retain the available result for retry or export.

**Validation:** Reject the recording write and require every banner, error and recovery action to reflect the unsaved state.

**Sources:** [extension/src/room.js:462](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L462).

<a id="a45"></a>

##### A45 — Preserve and display closed-sheet assumptions after saving

**P1 · Static defect · Effort M**

**Why it matters:** The engine discards setsFromLog diagnostics; readOffLog flags are not persisted or surfaced by openReplay. Displayed ranges can therefore look unconditional despite assumed hidden sets. Candidate-set inference is already in the closed-sheet plan; this is about current result provenance.

**Proposed change:** Carry observed, assumed and inferred field provenance into recordings and panels; label ranges with the assumptions under which they hold.

**Validation:** Reconstruct a closed replay, save and reload it, and require the same explicit assumptions and conditional range labels.

**Sources:** [extension/src/engine.js:424](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L424), [extension/src/engine.js:453](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L453), [extension/src/room.js:460](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L460), [docs/closed-sheet-plan.md:22](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/docs/closed-sheet-plan.md#L22).

<a id="a36"></a>

##### A36 — Reject outstanding RPCs when the simulator worker dies

**P2 · Reproduced · Effort M**

**Why it matters:** room.js only rejects the startup promise on worker error. After startup that promise is settled, so pending calls can remain unresolved and the failed worker stays cached.

**Proposed change:** Use one worker failure handler that rejects the pending registry, invalidates the worker and bounds startup/request waits; recover through a fresh worker when safe.

**Validation:** Crash the worker after readiness with several requests outstanding; all must settle and a later request must not target the dead worker.

**Sources:** [extension/src/room.js:85](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L85), [extension/src/room.js:107](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L107).

<a id="a37"></a>

##### A37 — Share an in-flight restoration for each branch

**P2 · Reproduced · Effort S**

**Why it matters:** restore inserts into branches only after awaiting open. Concurrent joins reproduced two worker sessions for one branch number, with only the latter retained.

**Proposed change:** Cache the restoration promise immediately per branch and coordinate errors/disposal with it.

**Validation:** Simultaneous joins must return the same session and panel, with one open operation and no orphan session.

**Sources:** [extension/src/room.js:202](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L202).

<a id="a38"></a>

##### A38 — Persist choices submitted before the other side commits

**P2 · Reproduced · Effort M**

**Why it matters:** The simulator input log does not yet contain p1’s pending choice while p2 is still choosing. Persisting only the input log loses that decision on reload; a real-simulator probe changed p1 from waiting back to choosing.

**Proposed change:** Store pending choices separately with request identity; restore simulator and client waiting state consistently, including cancellation.

**Validation:** Reload between the two sides’ submissions, cancel and resubmit, and require one eventual turn commit.

**Sources:** [extension/src/engine.js:129](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L129), [extension/src/room.js:151](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L151).

<a id="a41"></a>

##### A41 — Query recording metadata without loading the entire archive

**P2 · Likely bottleneck · Effort M**

**Why it matters:** The IndexedDB list and set-selection paths retrieve every recording’s full text before filtering. Their memory and latency grow with unrelated archive payloads.

**Proposed change:** Separate metadata from payloads; index set membership and use the existing saved-time index for ordering. Load full text only for selected recordings.

**Validation:** Increase unrelated archive size while measuring list and one-set retrieval; results must remain identical.

**Sources:** [extension/src/store.js:71](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/store.js#L71), [extension/src/store.js:81](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/store.js#L81).

<a id="a42"></a>

##### A42 — Give browser reconstruction a cancellation and resource budget

**P2 · Design improvement · Effort M**

**Why it matters:** Replay reconstruction uses the browser’s full hardwareConcurrency, and the worker dispatch permits overlapping async jobs. Dismissing or superseding a banner does not stop computation.

**Proposed change:** Track jobs and their nested workers, cancel superseded work, and cap browser concurrency separately from Node defaults so existing branches remain responsive.

**Validation:** Cancel a rebuild while another branch is playable; worker count and memory must return to baseline.

**Sources:** [extension/src/room.js:457](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L457), [extension/src/worker.js:19](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/worker.js#L19).

<a id="a43"></a>

##### A43 — Acknowledge launch handoffs before deleting them

**P2 · Design improvement · Effort M**

**Why it matters:** The service worker removes a parked request before the page accepts it; the bridge stops discovery after roughly three seconds. Delayed parking or interrupted delivery can leave an empty tab.

**Proposed change:** Use an acknowledged request ID with expiry, retryable delivery and deduplication.

**Validation:** Delay request parking beyond three seconds and interrupt delivery before acknowledgement; the request must remain recoverable and execute once.

**Sources:** [extension/src/background.js:36](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/background.js#L36), [extension/src/bridge.js:26](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/bridge.js#L26).

#### RNG controls

<a id="a28"></a>

##### A28 — Key damage-ladder caches by room and battle revision

**P1 · Reproduced · Effort M**

**Why it matters:** The RNG panel caches ladder values by source, target, move and crit only; it never clears the values. A focused probe fetched a ladder in one room, then returned that same cached ladder in a different room without a second request. Damage-changing state within one room is also absent from the key.

**Proposed change:** Include branch/session ID and a simulator state revision in ladder requests, responses and cache keys; discard stale replies and clear entries on room disposal.

**Validation:** Open two branches with identical Pokémon names but different spreads/weather, then change boosts mid-battle. Each tooltip must show a freshly valid ladder.

**Sources:** [scripts/client/rng-panel.js:340](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L340), [scripts/client/rng-panel.js:358](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L358), [scripts/client/rng-panel.js:831](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L831), [scripts/server/rng-command.js:952](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/server/rng-command.js#L952).

<a id="a24"></a>

##### A24 — Prove tooltip damage queries do not mutate live state

**P2 · Design improvement · Effort M**

**Why it matters:** damageLadder calls the real simulator 16 times and restores selected fields, including logs and Stellar state. As supported formats/effects grow, a new side effect could escape that list.

**Proposed change:** Use a throwaway serialized simulator state where practical, or add strict before/after state-and-RNG checks for the existing guarded path; keep all mechanics in Showdown.

**Validation:** Query every supported ladder situation and require unchanged state, input log, next RNG draw and subsequent battle outcome.

**Sources:** [scripts/server/rng-command.js:798](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/server/rng-command.js#L798).

<a id="a29"></a>

##### A29 — Track each client-hook installation independently

**P2 · Static defect · Effort S**

**Why it matters:** boot only retries based on tooltip readiness and window.app. It can stop before BattleRoom/listening hooks exist. Conversely wrapTooltips returns false when already wrapped, so a retry after an early successful wrap can keep polling forever; the return sequence true, false was reproduced. The extension also waits indefinitely for missing old-client and tooltip capabilities, despite the documented fail-loudly mitigation.

**Proposed change:** Make each hook’s installer return ready when already installed; retry until all required capabilities are ready, and surface a bounded compatibility error if they never appear.

**Validation:** Initialize app, BattleRoom and BattleTooltips in different orders; require one wrapper/listener each and zero background polling after success.

**Sources:** [scripts/client/rng-panel.js:722](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L722), [scripts/client/rng-panel.js:796](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L796), [scripts/client/rng-panel.js:818](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L818), [scripts/client/rng-panel.js:839](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L839), [extension/src/room.js:475](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/room.js#L475), [extension/src/spread-panel.js:515](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/spread-panel.js#L515).

<a id="a30"></a>

##### A30 — Scope pending RNG commands and acknowledgements per room

**P2 · Reproduced · Effort M**

**Why it matters:** pending row keys omit room ID, and every response:rng clears all rooms’ pending commands. In an isolated probe, a command pending in room A became unblocked immediately after a state response from unrelated room B. That can allow a duplicate rule before A’s command is acknowledged.

**Proposed change:** Track room, row, command ID and expected state revision; acknowledge just that operation, and resynchronize after timeout rather than blindly allowing duplicates.

**Validation:** Delay one room’s reply, deliver another room’s state, and click repeatedly; require exactly one intended armed rule.

**Sources:** [scripts/client/rng-panel.js:447](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L447), [scripts/client/rng-panel.js:450](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L450), [scripts/client/rng-panel.js:821](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/rng-panel.js#L821).

#### Runtime & validation

<a id="a01"></a>

##### A01 — Make simulator cleanup and error collection unconditional

**P1 · Reproduced · Effort S**

**Why it matters:** verify-branch’s private re-simulation captures chunks before awaiting the drain. An in-memory run of its exact function on the known Memento recording returned 0 errors; replayControlled, which reads after draining, returned 14. A reviewer also reproduced truncateAtTurn throwing a malformed-header error followed by an unhandled drain rejection; several helpers clean up only on success.

**Proposed change:** Share a lifecycle-safe simulator helper with immediate drain-rejection handling, try/finally cleanup and error collection after draining. Preserve one useful failure cause.

**Validation:** Malformed headers, simulator exceptions and invalid choices must reject once, close every stream and report the full error set with no unhandled rejection.

**Sources:** [scripts/lib/verify-branch.mjs:42](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/verify-branch.mjs#L42), [scripts/lib/rng-control.mjs:151](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/rng-control.mjs#L151), [scripts/lib/truncate.mjs:151](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/truncate.mjs#L151), [scripts/lib/reconstruct.mjs:1135](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/reconstruct.mjs#L1135).

<a id="a02"></a>

##### A02 — Make every failed proof fail the command

**P1 · Static defect · Effort S**

**Why it matters:** local-replay prints FAIL for input-log/protocol/stat/HP checks but main reaches the end normally; only thrown exceptions set a failing exit code. Automated checks can therefore accept a failed determinism proof.

**Proposed change:** Aggregate the required checks into a result and set exitCode=1 when any fail; retain the rendered report for diagnosis.

**Validation:** A known-bad input must exit nonzero; a good recording and a forced-RNG round trip must exit zero.

**Sources:** [scripts/local-replay.mjs:331](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L331), [scripts/local-replay.mjs:441](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L441).

<a id="a03"></a>

##### A03 — Provision only when the dependency or config changes

**P2 · Measured opportunity · Effort M**

**Why it matters:** Every import of provision-local-server recursively recopies the entire installed Showdown tree; copy failures during refresh are swallowed. npm run check took 8.53 seconds in this checkout, including provisioning; this is a single observation, not a speedup estimate.

**Proposed change:** Fingerprint the installed commit/build and owned config files, refresh only changed content, and fail visibly on incomplete copies. Keep runtime/logs intact.

**Validation:** Compare cold and unchanged warm startup, verify changed config is copied, and inject a copy failure.

**Sources:** [scripts/provision-local-server.mjs:8](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/provision-local-server.mjs#L8), [scripts/provision-local-server.mjs:81](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/provision-local-server.mjs#L81).

<a id="a04"></a>

##### A04 — Use one server lifecycle manager with an identity check

**P2 · Design improvement · Effort M**

**Why it matters:** battle/live/replay each implement their own port checks and launcher. Any HTTP listener counts as ready; a partial startup or two simultaneous launches can spawn competing servers and overwrite pids.json.

**Proposed change:** Share an ensure/stop helper; verify an Encoreable health response with version/root identity, serialize boot, and recover partial startup explicitly.

**Validation:** Start two commands together; occupy one port with an unrelated server; kill one of the two services.

**Sources:** [scripts/local-live.mjs:57](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-live.mjs#L57), [scripts/local-replay.mjs:73](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-replay.mjs#L73), [scripts/local-battle.mjs:24](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-battle.mjs#L24), [scripts/local-serve.mjs:173](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L173).

<a id="a05"></a>

##### A05 — Bound startup waits and react to child exit

**P2 · Static defect · Effort S**

**Why it matters:** local-serve waits forever for a port with no overall deadline and its HTTP request has no timeout. Server spawn/listen failures are not handled as one startup failure.

**Proposed change:** Add request and overall deadlines, consume/destroy probe responses, and handle child error/exit and listener error; terminate owned peers on failure.

**Validation:** Test a hung HTTP listener, a busy port and an immediately exiting child; all should end promptly with one useful error.

**Sources:** [scripts/local-serve.mjs:37](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L37), [scripts/local-serve.mjs:171](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L171), [scripts/local-serve.mjs:187](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L187).

<a id="a06"></a>

##### A06 — Verify process ownership before stopping saved PIDs

**P2 · Design improvement · Effort S**

**Why it matters:** stop reads old numeric PIDs and kills them without checking command, creation identity or checkout. A stale file can name a reused PID.

**Proposed change:** Record a startup token and process identity, confirm ownership before signaling, and atomically clear the manifest on clean shutdown.

**Validation:** Use a stale manifest pointing to an unrelated harmless process and require refusal.

**Sources:** [scripts/local-stop.mjs:6](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-stop.mjs#L6), [scripts/local-serve.mjs:173](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L173).

<a id="a07"></a>

##### A07 — Reject malformed replay URLs inside the request boundary

**P2 · Static defect · Effort S**

**Why it matters:** The /replays route calls decodeURIComponent outside a try/catch. A '%' in that path throws URIError; the request handler has no enclosing guard.

**Proposed change:** Parse and validate the URL in a guarded boundary, return 400 for bad encoding and handle read/stream errors without crashing the host.

**Validation:** Request /replays/% and verify 400 followed by a successful ordinary request.

**Sources:** [scripts/local-serve.mjs:111](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L111), [scripts/local-serve.mjs:124](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L124).

<a id="a08"></a>

##### A08 — Confine every static-file request to the client root

**P2 · Reproduced expression · Effort S**

**Why it matters:** The general static route joins a raw URL path to CLIENT_DIR without checking the result. The current expression maps /../../../package.json to Encoreable’s package.json outside that directory.

**Proposed change:** Normalize/decode once, resolve against an allowlisted root, check path containment, and reject directory traversal before file access.

**Validation:** Test raw and encoded dot segments, Windows separators, malformed encoding and normal asset requests.

**Sources:** [scripts/local-serve.mjs:141](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L141).

<a id="a09"></a>

##### A09 — Make branch launch cancellable and idempotent

**P2 · Design improvement · Effort M**

**Why it matters:** The replay button has an in-page busy flag, but fetch has no deadline and /branch can continue creating rooms/windows after disconnect or duplicate requests.

**Proposed change:** Give each launch an ID and bounded operation state; reuse duplicate results, support abort before irreversible UI work, and return stage-specific failure information.

**Validation:** Retry the same ID, close the caller mid-launch and simulate a lost response; create at most one branch.

**Sources:** [scripts/client/replay-branch.js:86](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/replay-branch.js#L86), [scripts/local-serve.mjs:64](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-serve.mjs#L64), [scripts/lib/branch-launch.mjs:178](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/branch-launch.mjs#L178).

<a id="a10"></a>

##### A10 — Reserve branch player names atomically

**P2 · Design improvement · Effort M**

**Why it matters:** freeNames probes availability, disconnects, then imports/opens the branch. Another branch can claim those names in the gap; the 8-second probe timeout is interpreted as available.

**Proposed change:** Serialize reservations or use branch-unique identities, register listeners before login events, and treat probe timeout as unknown/error.

**Validation:** Launch two branches concurrently with identical original names and inject delayed name confirmation.

**Sources:** [scripts/lib/branch-launch.mjs:58](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/branch-launch.mjs#L58), [scripts/lib/branch-launch.mjs:91](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/branch-launch.mjs#L91).

<a id="a11"></a>

##### A11 — Give WebSocket operations a complete failure lifecycle

**P2 · Static defect · Effort M**

**Why it matters:** WsPlayer name/challenge/battle waits have no deadline; WsAdmin does not reject pending message waits immediately on close. Parsing or observer errors can escape message handling.

**Proposed change:** Use a shared bounded wait registry with close/error cancellation, safe protocol parsing and unsubscribe cleanup; cap retained popup/error history.

**Validation:** Disconnect at each handshake step, send malformed JSON, and ensure all pending work rejects once.

**Sources:** [scripts/lib/ws-player.mjs:56](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/ws-player.mjs#L56), [scripts/lib/ws-player.mjs:186](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/ws-player.mjs#L186), [scripts/lib/ws-admin.mjs:43](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/ws-admin.mjs#L43), [scripts/lib/ws-admin.mjs:122](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/ws-admin.mjs#L122).

<a id="a21"></a>

##### A21 — Check the actual configuration and server behavior

**P2 · Static weakness · Effort M**

**Why it matters:** npm run check first overwrites config, then checks whether the text contains '127.0.0.1'. That does not prove bindaddress equals loopback or that a running server uses the expected config.

**Proposed change:** Separate provisioning from verification, load the effective config and assert exact values; optionally check the listening address and health identity of the owned server.

**Validation:** Use a misleading comment and a non-loopback effective value; check must fail. Keep a fast offline verification mode.

**Sources:** [scripts/local-check.mjs:5](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-check.mjs#L5), [scripts/local-check.mjs:13](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-check.mjs#L13).

<a id="a25"></a>

##### A25 — Turn existing proofs into an explicit regression matrix

**P2 · Design improvement · Effort M**

**Why it matters:** The repository has many command-based proofs and fixture notes; expected exceptions and requirements are partly prose. A future-format or closed-sheet change can pass the quick config check while regressing reconstruction.

**Proposed change:** Extend existing check commands to run a small deterministic matrix, including known-bad cases with expected outcomes, Node/extension parity and each supported capability profile.

**Validation:** Require machine-readable results, real exit codes and stable seed/recording identifiers; run heavy catalog/fuzz matrices on the server.

**Sources:** [package.json:9](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/package.json#L9), [recordings/local/scripted/README.md:15](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/recordings/local/scripted/README.md#L15), [docs/engineering.md:1532](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/docs/engineering.md#L1532).

<a id="a31"></a>

##### A31 — Surface local-client automation failures instead of suppressing them

**P2 · Design improvement · Effort M**

**Why it matters:** autobattle globally hides modal dialogs and swallows name/challenge/security messages. Its retry loops stop silently, so a failed launch can look like an idle or ready client. The hooks are installed even before the script checks whether automation was requested.

**Proposed change:** Scope the automation hooks to an explicit launch session, use handshake events and stage deadlines, and show a compact actionable failure with captured server text.

**Validation:** Force a name conflict, invalid team, disconnected socket and challenge rejection; show the actual cause and stop retrying cleanly.

**Sources:** [scripts/client/autobattle.js:12](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/autobattle.js#L12), [scripts/client/autobattle.js:71](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/autobattle.js#L71), [scripts/client/autobattle.js:104](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/autobattle.js#L104), [scripts/client/autobattle.js:162](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/client/autobattle.js#L162).

<a id="a23"></a>

##### A23 — Put browser and OS behavior behind one adapter

**P3 · Design improvement · Effort M**

**Why it matters:** Browser discovery and window placement are Windows-specific, fallback launches through cmd.exe, and each branch leaves isolated profiles in the temp directory.

**Proposed change:** Share a platform adapter with an explicit browser override, launch diagnostics and bounded cleanup/reuse of Encoreable-owned temporary profiles after exit.

**Validation:** Verify Windows and Linux launch arguments plus browser-not-installed behavior; ensure unrelated profiles are untouched.

**Sources:** [scripts/lib/browser.mjs:15](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/browser.mjs#L15), [scripts/lib/browser.mjs:101](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/browser.mjs#L101), [scripts/lib/browser.mjs:115](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/browser.mjs#L115).

#### Recordings

<a id="a13"></a>

##### A13 — Preserve recordings when names collide across imports or devices

**P1 · Reproduced + design · Effort M**

**Why it matters:** An archived basename wins regardless of content, and archiveLogFile returns an existing basename without comparing it. Two server resets/devices can reuse a battle ID; copyFileSync also lacks exclusive creation. In the extension, recording identity comes only from filename and imports replace the prior row; this is documented behavior, but a same-name/different-content probe left only one recording.

**Proposed change:** Deduplicate identical content, preserve distinct immutable versions, compare hashes on collisions, and use exclusive atomic creation. Make any deliberate replacement explicit.

**Validation:** Archive two different logs with the same basename concurrently; preserve both source histories and emit a clear conflict.

**Sources:** [scripts/lib/recordings.mjs:42](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/recordings.mjs#L42), [scripts/lib/recordings.mjs:103](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/recordings.mjs#L103), [extension/src/store.js:64](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/store.js#L64).

<a id="a12"></a>

##### A12 — Read file metadata once before sorting

**P2 · Measured opportunity · Effort S**

**Why it matters:** listLogFiles calls statSync twice per sort comparison. On the current 30-file combined listing this performed 224 stat calls; the cost grows with comparison count.

**Proposed change:** Decorate each entry with one stat result before sorting; for a large library maintain a rebuildable metadata index with turn count and provenance.

**Validation:** Require identical ordering/tie policy while limiting stat calls to roughly one per file; test a file disappearing during the scan.

**Sources:** [scripts/lib/recordings.mjs:34](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/recordings.mjs#L34), [scripts/lib/recordings.mjs:42](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/lib/recordings.mjs#L42).

#### Extension build & checks

<a id="a46"></a>

##### A46 — Fail when a declared build entry or required check is missing

**P1 · Static defect · Effort S**

**Why it matters:** The extension builder filters missing entries, and the check runner skips missing required check files without counting failure. An incomplete checkout can report a successful package or all checks passed.

**Proposed change:** Require every declared entry and required check; reserve skip for explicitly optional coverage and report it separately.

**Validation:** Remove/mock one declared entry or check and require nonzero exit with the missing requirement named.

**Sources:** [scripts/local-extension.mjs:220](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-extension.mjs#L220), [scripts/local-extension.mjs:254](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-extension.mjs#L254).

<a id="a47"></a>

##### A47 — Make replay-entry coverage independent of live Reg M-B searches

**P2 · Static defect · Effort S**

**Why it matters:** The entry check searches only recent Reg M-B Bo3 replays and treats no results as success. Retiring formats can silently remove required coverage.

**Proposed change:** Use a stable captured replay for the required entry proof and a current-format live search as a separately labeled smoke check.

**Validation:** An empty remote search must report unavailable smoke coverage while the deterministic entry test still runs.

**Sources:** [extension/check/entry.mjs:253](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/check/entry.mjs#L253).

<a id="a48"></a>

##### A48 — Align the declared Chrome minimum and build target

**P2 · Design improvement · Effort S**

**Why it matters:** The manifest promises Chrome 111, while esbuild targets Chrome 120. This does not enforce the advertised compatibility contract; no particular Chrome 111 failure was reproduced.

**Proposed change:** Define the supported minimum once and align manifest, transpilation and compatibility testing with it.

**Validation:** Run packaging and entry checks on the declared minimum, or raise that minimum to the version actually supported.

**Sources:** [extension/manifest.json:6](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/manifest.json#L6), [scripts/local-extension.mjs:178](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-extension.mjs#L178).

<a id="a49"></a>

##### A49 — Preserve the previous working extension when a rebuild fails

**P2 · Static defect · Effort M**

**Why it matters:** The build deletes dist before validating inputs, compiling and copying required assets. An ordinary failure destroys the previously loadable package.

**Proposed change:** Build and validate a complete replacement before publishing it, keeping the prior output intact on failure.

**Validation:** Force compile and static-copy failures; the previous extension package must remain complete and loadable.

**Sources:** [scripts/local-extension.mjs:213](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-extension.mjs#L213).

#### Catalog & developer tools

<a id="a20"></a>

##### A20 — Validate CLI options before allocating or writing

**P1 · Reproduced expression · Effort S**

**Why it matters:** Several commands use ad hoc flag readers. In catalog, --threads oops becomes NaN, Array.from creates zero workers, and runAll can return without processing queued effects.

**Proposed change:** Share a strict option parser with positive integer limits, enum validation, missing-value errors and unknown-option rejection; validate before work/output.

**Validation:** Exercise invalid threads, misspelled sheet modes, missing option values and extra flags; require nonzero exit with no report writes.

**Sources:** [scripts/local-catalog.mjs:2874](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2874), [scripts/local-catalog.mjs:2920](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2920), [scripts/local-catalog.mjs:2800](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2800).

<a id="a14"></a>

##### A14 — Split the catalog cache by pipeline stage

**P2 · Likely bottleneck · Effort L**

**Why it matters:** codeFingerprint hashes all scripts/lib, including browser/recording/WebSocket helpers. An unrelated helper edit invalidates every effect’s expensive record. Raw simulation, inference and reporting currently share one broad invalidation boundary.

**Proposed change:** Cache simulator runs, parsed observations and inference judgments separately, each with complete transitive fingerprints. Keep report-only changes cheap and never reuse inference under a changed solver.

**Validation:** Change browser.mjs and require no simulation reruns; change inference and rerun judgments; change a fixture and rerun the affected recipes.

**Sources:** [scripts/local-catalog.mjs:2762](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2762), [scripts/local-catalog.mjs:2782](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2782).

<a id="a15"></a>

##### A15 — Cache repeated inference of the same catalog world

**P2 · Likely bottleneck · Effort M**

**Why it matters:** Adjacent sweep pairs share endpoints, but cover calls inferWorld again for each endpoint. cachedRun only memoizes battles, not the inference result of the same observed world.

**Proposed change:** Memoize inference summaries using canonical teams, observed channel/log, solver options and version; share repeated endpoint work within a job.

**Validation:** Count inferSpreads calls for a sweep and require one per distinct world with unchanged catalog judgments.

**Sources:** [scripts/local-catalog.mjs:1236](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L1236), [scripts/local-catalog.mjs:1279](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L1279), [scripts/local-catalog.mjs:1303](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L1303).

<a id="a16"></a>

##### A16 — Use bounded LRU caches rather than clear-all cliffs

**P2 · Design improvement · Effort M**

**Why it matters:** runCache holds promises plus complete logs and clears the whole cache above 6000 entries. Each worker has a separate copy, so memory grows with worker count and useful controls are discarded together.

**Proposed change:** Use a byte-aware LRU and compact cached results; group jobs that share controls and cap aggregate memory across workers.

**Validation:** Track peak RSS, hit rate and elapsed time on a representative catalog subset at several worker counts.

**Sources:** [scripts/local-catalog.mjs:477](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L477), [scripts/local-catalog.mjs:2804](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2804).

<a id="a17"></a>

##### A17 — Handle worker exit, timeout and peer cancellation

**P2 · Static defect · Effort M**

**Why it matters:** Catalog/fuzz pools listen for message and error but not unexpected exit or per-job timeouts. On rejection, other workers are not reliably terminated, so failed jobs can hang or keep running.

**Proposed change:** Add one pool abstraction with task IDs, exit handling, deadlines, try/finally termination and bounded retry/checkpoint rules.

**Validation:** Terminate a worker before its reply and throw from a job; parent must settle and all peers must stop.

**Sources:** [scripts/local-catalog.mjs:2686](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2686), [scripts/local-catalog.mjs:2804](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2804).

<a id="a18"></a>

##### A18 — Attach provenance to saved catalog runs before merging

**P2 · Design improvement · Effort M**

**Why it matters:** --records merges by effect key and silently lets later files replace earlier ones. records.json does not carry the code/format fingerprints used by the cache, so complete key coverage can mix incompatible runs.

**Proposed change:** Save schema, simulator, format, fixture and solver fingerprints with run records; reject incompatible inputs and conflicting duplicates.

**Validation:** Try merging two runs with different solver fingerprints and require an explicit incompatibility result.

**Sources:** [scripts/local-catalog.mjs:2930](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2930), [scripts/local-catalog.mjs:2976](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2976).

<a id="a19"></a>

##### A19 — Write generated caches and reports atomically

**P2 · Design improvement · Effort S**

**Why it matters:** Cache and report files are written directly to their final names. An interrupted process or competing catalog invocation can leave partial JSON or a mismatched pair of reports.

**Proposed change:** Write a temporary sibling, flush/close, rename atomically and serialize writers by output/fingerprint; publish related reports under one run identity.

**Validation:** Interrupt a write and run competing output jobs; readers should see a complete previous or complete new version.

**Sources:** [scripts/local-catalog.mjs:2820](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2820), [scripts/local-catalog.mjs:2974](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2974).

#### Performance measurement

<a id="a26"></a>

##### A26 — Measure stage costs before increasing parallelism

**P2 · Design improvement · Effort M**

**Why it matters:** There are progress logs and budgets, but no common profile of parse, scaffold, evidence, simulator rebuild, cloning, serialization, worker startup, cache hits and peak memory across entry points.

**Proposed change:** Add an optional profile mode to existing commands and worker requests. Keep a fixed representative corpus for warm/cold comparisons, grouped by format, sheet visibility and battle length.

**Validation:** Compare before/after p50 and slow-case time, probe counts, transferred bytes and peak memory while requiring identical retained candidates and replay evidence.

**Sources:** [scripts/local-catalog.mjs:2782](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-catalog.mjs#L2782), [scripts/local-reconstruct.mjs:1](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/scripts/local-reconstruct.mjs#L1), [extension/src/engine.js:1](https://github.com/grenmango51/encoreable/blob/db263410b5f80974a67e3e426608fdd50f796755/extension/src/engine.js#L1).

### 12.4 Verification of the findings — 2026-10-23

Every finding was checked against the code it cites. That code is unchanged at `db26341`: only this document has changed since, so every link above points at the code as it stands. One reviewer read each subsection's code, and A50, A51, A67 and A69 were read again directly. The audit's own probes were not re-run, except A01's `truncateAtTurn` case, which was reproduced in memory; a finding marked "Reproduced" is taken as stated where the code agrees with it.

**No finding is ruled out by the code, so none is removed.** 60 are confirmed, 1 holds in part (A31), and 22 are design proposals or bottleneck candidates whose account of the current code is accurate.

Two of them bear on the answer itself, not only on reliability:

- **A50 can remove a real spread.** An Illusion reading whose search ran out before the deadline is dropped as if the log had disproved it, the switch-in is settled as the Pokemon shown, and that Pokemon is then narrowed by what the Illusion user did. §7.3's rule that a reading cut short proves nothing covers only the deadline.
- **A51 and A52 weaken certification.** Under `--all-spent`, a probe below a range tests a spread of fewer than 66 points, outside the assumption it certifies; and a combined best-of set carries each game's old certificates beside its new, narrower ranges.

A59's aliasing needs a coordinate outside 0–32, which no real spread has, so the checks that real spreads survive were not affected by it.

The safeguards of §12.5 are about how failures are found; none of them fixes a finding. The column says where one touches a finding. Most findings — the extension, the RNG panel, the local server and the checks on supplied teams — are outside what they look at.

| Finding | Verdict | What the code shows | Safeguard |
|---|---|---|---|
| [A27](#a27) | Confirmed | `spTotal(set) === 66` (`local-replay.mjs:332`); a max HP of `100` is read as a percentage (`:344`); the HP formula again at `local-reconstruct.mjs:358` | — |
| [A44](#a44) | Confirmed | the build lists every installed mod (`local-extension.mjs:142`), the shim returns them all (`fs.js:27`), nothing rejects a format whose data is not bundled | S4 is the same kind of check, for action kinds |
| [A58](#a58) | Design, premise accurate | `SPAN` and `BUDGET` fixed (`knowledge.mjs:16`); `inferSpreads` only calls `Dex.forFormat` | — |
| [A22](#a22) | Confirmed | `FORMAT` is a constant used for the file name, title and `formatid` (`local-replay.mjs:58`, `:421–424`) | — |
| [A50](#a50) | Confirmed | a reading is kept only if `all.complete \|\| !res.complete` (`infer.mjs:879`); only the deadline exempts it (`:889`) | cause 1's principle; not covered |
| [A51](#a51) | Confirmed | the outside probe lowers other stats when over budget and never adds points back (`infer.mjs:1107–1115`) | — |
| [A52](#a52) | Confirmed | `combineGames` spreads the old record, `certified` included, beside the intersected ranges (`infer.mjs:1014–1025`, `:926`) | — |
| [A59](#a59) | Confirmed | `containsSpread` checks the flattened key only; `keyOf(0,33,0) === keyOf(1,0,0)` (`knowledge.mjs:36`, `:767–775`) | — |
| [A83](#a83) | Confirmed | `\|\| abilities[0]` revives a ruled-out ability (`replay-source.mjs:622`) | — |
| [A53](#a53) | Confirmed | the last round's `built` is returned; `deepest` keeps coordinates only (`infer.mjs:662`, `:674`, `:805`) | cause 3; S2 would show it, not restore it |
| [A54](#a54) | Confirmed | `settle`, `choose` and the final `settle` take no deadline (`infer.mjs:685`, `:727`, `:805`) | — |
| [A55](#a55) | Confirmed | fallback rebuilds run without `affordable()`; the diagnostic `reconstruct` at `infer.mjs:605` bypasses the counter | S2 would show the overrun, not bound it |
| [A56](#a56) | Design, premise accurate | `closed-sheet-plan.md` §3.2 defines inertness by the candidate's own handlers only | — |
| [A57](#a57) | Design, premise accurate | `'raw'` key and ordinal-only entries (`evidence.mjs:196`); a fresh cache per round is the current isolation | — |
| [A60](#a60) | Design, premise accurate | damage rows enumerated with no cap (`evidence.mjs:927–933`), unlike the other evaluators | — |
| [A62](#a62) | Design, premise accurate | `spreadCount` recomputed for every recorded event | — |
| [A63](#a63) | Design, premise accurate | every move slot's priority asked at every sort (`speed.mjs:121`, `:157`) | — |
| [A65](#a65) | Design, premise accurate | all five movable stats, 33 values each (`evidence.mjs:2882–2905`) | — |
| [A66](#a66) | Design, premise accurate | a certificate is a boolean (`infer.mjs:1063`, `:1102`) | — |
| [A61](#a61) | Design, premise accurate | whole knowledge cloned, known Pokemon included (`knowledge.mjs:152–163`) | — |
| [A64](#a64) | Design, premise accurate | `settle` runs up to 8 evidence passes, each replaying the scaffold (`infer.mjs:232`) | — |
| [A67](#a67) | Confirmed | `exactHp` reads `battle.log`, where both halves of a split HP line match and the public percentage, read last, wins; `0 fnt` never matches (`reconstruct.mjs:1866–1876`) | — |
| [A68](#a68) | Confirmed | `identName` drops the side (`reconstruct.mjs:66`, `:1835`, `:1871`) | — |
| [A69](#a69) | Confirmed | `/^\|-(damage\|heal)\|/` matches every string, so the guard never returns null (`reconstruct.mjs:1851`) | — |
| [A70](#a70) | Confirmed | `adjacentAllyOrSelf` returns only the user's own slot (`reconstruct.mjs:346`) | S1 would show it on a fuzz battle that uses such a move |
| [A71](#a71) | Confirmed, narrower | species rewritten by slot (`replay-source.mjs:272–274`); item, ability, nature and moves are still compared (`:201–214`), so a wrong species passes only when they agree too | — |
| [A72](#a72) | Confirmed | `startsWith` both ways (`replay-source.mjs:175–177`) | — |
| [A73](#a73) | Confirmed | a move without `[from]` joins the original set (`replay-source.mjs:481`); the unsettled-Illusion check has no Transform guard (`protocol.mjs:172`), which `unmaskBySheet` has (`:230`) | — |
| [A74](#a74) | Confirmed | `couldHave` ignores the ability's origin (`replay-source.mjs:594–600`) | — |
| [A75](#a75) | Confirmed | `maxHpFromLog` on raw lines, no unmasking (`local-reconstruct.mjs:350`) | — |
| [A76](#a76) | Confirmed | `crossCheckLog` compares species and moves only, although its comment names item and ability (`replay-source.mjs:672–683`) | — |
| [A78](#a78) | Confirmed | `selfConsistent` is not written to the recording (`local-reconstruct.mjs:575`) | — |
| [A77](#a77) | Confirmed | a literal `includes('"formatid":"')` (`truncate.mjs:141`) | — |
| [A79](#a79) | Confirmed | variant ranking and look-back probes check no clock and are not counted (`reconstruct.mjs:2108–2111`, `:1921`) | S2 would show them once counted |
| [A80](#a80) | Design, premise accurate | the pool starts before the first `playThrough`; only queued jobs are withdrawn | — |
| [A81](#a81) | Design, premise accurate | the observed segment split again on every comparison (`reconstruct.mjs:698–705`) | — |
| [A82](#a82) | Confirmed | readings paired by index (`local-reconstruct.mjs:166–180`); §7.4's "exact on 182 of 183 readings" is this metric (`:465`) | — |
| [A32](#a32) | Confirmed | `openReplay` reads `complete` and `verifiedThroughTurn` only; `ok` and `selfConsistent` are never read (`room.js:460`, `engine.js:453`) | — |
| [A33](#a33) | Confirmed | the stored-recording path opens any turn (`room.js:483`, `recordings.js:60`) | — |
| [A34](#a34) | Confirmed | the first loose species match wins (`room.js:370–385`) | — |
| [A35](#a35) | Confirmed | only `push` is hooked; stream errors go to `pushError` (`engine.js:46`, `battle-stream.ts:41`) | — |
| [A39](#a39) | Confirmed | storage errors swallowed (`room.js:45`); the whole inference re-serialised on every persist (`:151`, `:260`) | — |
| [A40](#a40) | Confirmed | a failed save goes to the console only (`room.js:462`), and the over-reach message still says "It is saved as" (`:465–466`). The extension check of 2026-10-22 passed on that message: its live replay had rebuilt only through turn 0 of 5 | — |
| [A45](#a45) | Confirmed | `readOffLog` returned but not stored (`engine.js:424`) | — |
| [A36](#a36) | Confirmed | a dead worker stays cached and pending calls are never rejected (`room.js:86`, `:99`) | — |
| [A37](#a37) | Confirmed | check, await, then set (`room.js` `ensure`) | — |
| [A38](#a38) | Confirmed | the input log takes a choice only at commit (`battle.ts:3011`) | — |
| [A41](#a41) | Confirmed | `getAll` for `list` and `ofSet`; the `savedAt` index unused (`store.js:22`, `:71`, `:81`) | — |
| [A42](#a42) | Design, premise accurate | `hardwareConcurrency` threads, no job tracking or cancel (`room.js:457`, `worker.js:19`) | — |
| [A43](#a43) | Design, premise accurate | removed on first read before delivery (`background.js:36`); 12 × 250 ms (`bridge.js:26`) | — |
| [A28](#a28) | Confirmed | the key has no room or revision and is never cleared (`rng-panel.js:340`, `:362`, `:833`) | — |
| [A24](#a24) | Design, premise accurate | `damageLadder` restores five fields; nothing checks the rest (`rng-command.js:830–837`) | — |
| [A29](#a29) | Confirmed | `boot` retries on the tooltip hook only, and a wrapped prototype returns false (`rng-panel.js:722`, `:839`); unbounded polls (`room.js:475`, `spread-panel.js:515`) | — |
| [A30](#a30) | Confirmed | `rowKey` has no room; any reply clears `pending` (`rng-panel.js:447`, `:821`) | — |
| [A01](#a01) | Confirmed | errors read before the drain (`verify-branch.mjs:42–60`); `truncateAtTurn`'s unhandled rejection reproduced in memory | — |
| [A02](#a02) | Confirmed | `FAIL` lines are printed only (`local-replay.mjs:334`) | cause 4's pattern; not covered |
| [A03](#a03) | Confirmed | the whole tree copied on every import, errors swallowed (`provision-local-server.mjs:8–15`) | — |
| [A04](#a04) | Design, premise accurate | three copies of the port wait and spawn; `pids.json` written unconditionally | — |
| [A05](#a05) | Confirmed | `waitForPort` has no deadline; no `error` or `exit` handlers (`local-serve.mjs:37`, `:171`, `:187`) | — |
| [A06](#a06) | Design, premise accurate | PIDs killed without an ownership check; `pids.json` never removed | — |
| [A07](#a07) | Confirmed | `decodeURIComponent` unguarded in the handler (`local-serve.mjs:111`) | — |
| [A08](#a08) | Confirmed | the raw path joined with no containment (`local-serve.mjs:124`, `:141`); bound to 127.0.0.1, and only a raw client sends such a path | — |
| [A09](#a09) | Design, premise accurate | no abort or launch id; a duplicate POST launches twice | — |
| [A10](#a10) | Confirmed | probe, disconnect, launch later; a timeout reads as available (`branch-launch.mjs:58`, `:91`). Its proposal to register listeners before login events is already met: `probe.on` runs in the continuation of `connect()`, which resolves on `open`, before any message is handled (`branch-launch.mjs:58–65`, `ws-admin.mjs:43–51`) | — |
| [A11](#a11) | Confirmed | waits with no deadline or rejection on close (`ws-player.mjs:56`, `:186`; `ws-admin.mjs:43`, `:122`) | — |
| [A21](#a21) | Confirmed | a text search for `'127.0.0.1'` (`local-check.mjs:13`) | — |
| [A25](#a25) | Design, premise accurate | `npm run check` checks the loopback text and the format only | S3 is the inference part of this matrix |
| [A31](#a31) | Partly | the loops stop silently and the messages are swallowed (`autobattle.js:200–203`); of the hooks, only the modal CSS and the jQuery hooks come before the request check (`:12–26`, `:52`, before `:70`) — the popup interceptors are installed only for automation (`:89`) | — |
| [A23](#a23) | Confirmed | Windows paths, PowerShell and `cmd.exe`; temporary profiles never removed (`browser.mjs:15–22`, `:101–103`, `:115`) | — |
| [A13](#a13) | Confirmed | an archived file of the same base name is returned unread (`recordings.mjs:103–104`); the store replaces by name (`store.js:64`) | — |
| [A12](#a12) | Confirmed | `statSync` twice per comparison (`recordings.mjs:42`) | — |
| [A46](#a46) | Confirmed | missing entries filtered out; a missing check prints `SKIP` and does not fail (`local-extension.mjs:220`, `:254–256`) | cause 4's pattern; not covered |
| [A47](#a47) | Confirmed | no search result is a `SKIP` that returns true (`check/entry.mjs:253–258`) | — |
| [A48](#a48) | Confirmed | Chrome 111 declared, `chrome120` targeted (`manifest.json:6`, `local-extension.mjs:178`) | — |
| [A49](#a49) | Confirmed | `dist` removed before anything is built (`local-extension.mjs:213`) | — |
| [A20](#a20) | Confirmed | `--threads oops` gives NaN, zero workers, and `runAll` returns with the queue unprocessed | — |
| [A14](#a14) | Design, premise accurate | the fingerprint covers `scripts/lib`, `scripts/server` and `scripts/fixtures` as one hash | makes S7 affordable |
| [A15](#a15) | Confirmed | interior endpoints inferred twice (`local-catalog.mjs:1236`, `:1303–1308`) | — |
| [A16](#a16) | Design, premise accurate | one `runCache` per worker, cleared whole above 6000 | — |
| [A17](#a17) | Confirmed | no `exit` listener, no deadline, peers not stopped | — |
| [A18](#a18) | Confirmed | a later record overwrites an earlier one; `records.json` carries no fingerprint | — |
| [A19](#a19) | Confirmed | cache files and reports written straight to their final names | — |
| [A26](#a26) | Design, premise accurate | timing is ad hoc `Date.now()`; no common stage profile | complements S2: S2 counts work per battle, A26 times stages |

### 12.5 Failure causes and safeguards — from the open-sheet work of 2026-10-13 to 2026-10-22

No real spread was ever removed during that work: every check that a real spread survives passed. Every failure was in finding a rebuild — the guess, the dice search and the loop between them — and each came from one of five causes.

1. **One signal, three causes.** The loop's only signal is the line a rebuild stopped on. That can mean a wrong guess (evidence missing), a right guess whose dice the search did not find within its budget, or an inconsistent hand-off between rounds. The fallback assumed the first and changed a stat, and a different spread throws different dice, so it sometimes got through by luck and labelled the line one no hook reads: 166 Quick Attack lines that the search had not finished, a Pin Missile line that passed under the full budget, a Mega Greninja HP path dropped before the fallback, an Earthquake check that paired the old guess with the new guess's HP path. A looser cause sat beside them: Attack tied per key rather than per HP path let a confusion self-hit use one Attack on turn 2 and another on turn 3, which kept every real spread but chose guesses no rebuild could reproduce (about 55 rows).
2. **A search that changes one die at a time.** It fails where two dice have to change together and neither alone improves the score: seed 83's two Muddy Water secondaries, seed 19's full paralysis after a speed tie, Iron Ball's turn-2 tie with the turn-1 confusion duration. Its pruning rules carried assumptions that were not always true: a die thrown after the first wrong line cannot matter; the chance dice are a fixed list, which left out plain `random(100)` secondaries; unseen choices tried in a fixed order, which ran out of budget before Mawile's Sucker Punch (seed 2). Zing Zap's flinch-tie world was also investigated during that work; backtesting found its fix was the order reader, not the search.
3. **Path dependence and shared caps.** Search commits stick, and every battle shares the round cap and budget levels, so a change to the guess, the score or a budget changes the whole path. Seed 14 broke when a new score component committed a partial match; seed 44 stopped five turns earlier when extra checks in the loop used up its rounds, and again when the budget fell to its minimum on every new guess; the Iron Ball world had passed only because its guess avoided a speed tie. Most of these were latent faults that a change exposed.
4. **Hand-written lists that skip what they do not name.** The order reader took a switch to be `'switch'`; a faint replacement is `'instaswitch'`, so replacement order was never read until seed 88 failed outright. Stance Change's forme change prints before its move line and was not among the lines that open an action. The extension compared request ids exactly while the live client sends `14.0b04…`.
5. **Evidence that stops at the first wrong line.** That line is often the most informative one: a guessed Special Attack made Dragon Pulse lethal, the rebuild printed a Focus Sash, and the replay's HP line that pins the attacker was past the cutoff (seed 56).

The safeguards below follow from these. S1–S3 are harness work in `scripts/local-catalog.mjs` and change nothing the inference does; S4 and S5 are checks; S6 is deferred; S7 is a working rule. Where an audit finding of §12.3 overlaps, it is named.

<a id="s1"></a>

##### S1 — Sort a failed fuzz rebuild against the battle the fuzzer played

**Harness · Effort M · Overlaps A70**

**Why it matters:** A failed rebuild's report says where it stopped. Whether the cause is the evidence, the search or the hand-off has been found by hand, with temporary prints, case by case; seed 83 took four rounds of them. The fuzz already rebuilds a failure with p2's real Stat Points (`fuzzOne`, `scripts/local-catalog.mjs`), which separates the evidence from the other two.

**Proposed change:** When the real spreads fail too, add the two comparisons only the fuzz can make, since it played the battle: the real hidden choices (`played.choices`) against the variants the search tried, and the first die of the failing turn whose real face differs from the search's, with its kind. Compare dice under the real spreads only; under a guess, speed ties appear and vanish and the ordinals no longer line up. Do not report which of the search's rules skipped a die: that ties the harness to the search's internals.

**Validation:** Seed 83 under `reconstruct.mjs` as it stood before the pair search names its two secondary dice; seed 2 before the variant ordering names Mawile's Sucker Punch.

<a id="s2"></a>

##### S2 — Report what each battle used, not only whether it passed

**Harness · Effort S · Overlaps A26, A53, A55, A79**

**Why it matters:** A pass or fail per battle hides a change that uses up the margin. The round cap (`maxRounds = 16`, `infer.mjs`) is shared by every battle, and a change that spent rounds elsewhere showed only when seed 44 ran out of them.

**Proposed change:** Record rounds, probes, fallback rebuilds and backtracks per battle in the fuzz and `--all` output, and print the differences against the previous run as numbers. No gate: a gain in precision can legitimately add rounds.

**Validation:** Outside the extension's deadline the counts are deterministic; two runs of the same code give identical counts.

**Built** (`95bb17c`): `inferSpreads().work` counts rounds, calls to `reconstruct`, fallback
calls (its diagnostic checks included), simulation probes, HP backtracks and die backtracks.
Nested Illusion readings add their work rather than hiding it. `reconstruct().cost` sums
every reading it tried, not only the answer it kept. The CLI prints the counts and
`--counts <file>` compares them (§8); recordings carry neither this work record nor warnings.
The source's CLI total also includes discarded ability readings, not only its final inference.
Two runs, and one versus four threads, gave identical counts. Time ceilings can still stop
the fallback differently on different machines, even without an explicit deadline; repeatability
is not promised when one of those ceilings is reached.

<a id="s3"></a>

##### S3 — A regression list of every world that failed, and fuzz seeds the code was not tuned on

**Harness · Effort S · Overlaps A25**

**Why it matters:** Fuzz seeds 1–100 are the seeds the search was tuned on: 91 of them matched before the open-sheet work and 100 after it, by fixing exactly the nine that failed. The rate on battles the code has not seen is not known. Two regressions of that work — seed 14 and the Iron Ball world — were found only by the hour-long fuzz and the full catalog run.

**Proposed change:** A list run after every change to `evidence.mjs`, `infer.mjs`, `reconstruct.mjs` or `speed.mjs`, one battle per distinct mechanism: fuzz seeds 2, 14, 19, 24, 44, 56, 68, 73, 83 and 88, and the catalog worlds of Iron Ball's confusion witness at Speed 0, Zing Zap's flinch tie, Gengarite's confusion witness, the hidden Mega Greninja's Quick Attacks and the Earthquake spread hit. Separately and less often, fuzz seeds 101–300; their pass rate is the measure, and their failures decide S6.

**Validation:** The list runs in minutes; each entry fails on the code before the fix it stands for.

**Built** (`3cf6c36`): `npm run catalog -- --regress` runs all fifteen entries. On workstation
`random` they passed in 133 seconds on eight threads and 188 seconds on three. Each battle
was compared with today's before backtesting; each fails before its fix and passes at its
fix, with one exception: seed 14's breaking score change and trial-hold fix were committed
together. It fails on a scratch copy of that commit with the trial hold removed, not on any
committed predecessor. The list retains it and states that limitation. Four catalog worlds
fail historically only on set-aside evidence, so a listed world checks that too.

The five coordinates are Iron Ball `holder-hidden/W-confusion spe 0`, Zing Zap
`user-hidden/after spe 32`, Gengarite `holder-hidden/W-confusion atk 0`, Greninjite
`holder-hidden/W-trade def 32`, and Earthquake `user-hidden/quiet atk 32`. The Greninjite
world was fixed by `00aff08`; Zing Zap by `fa26745`'s order reader. The list lives after
the report marker in `local-catalog.mjs`, so editing it alone leaves the catalog cache valid.

**Unseen seeds** (baseline `a5c777b`, 2026-10-24): seeds 101–300 gave 194 of 200 MATCH,
every real spread kept in all 200, and no exceptions. Seeds 101, 135, 208, 225 and 281
rebuilt with real spreads but not the inference's guess. Seed 220 also failed with real
spreads, on a Lightning Rod line. These outcomes locate failures for diagnosis; they do not
by themselves prove a missing evidence hook, a bad hand-off, or a pair-search failure.

<a id="s4"></a>

##### S4 — Check the simulator's action kinds against the order reader

**Check · Effort S · Overlaps A44**

**Why it matters:** `speed.mjs` reads an order only for action kinds it names. A kind it does not name is skipped without a word, which is how faint replacements (`'instaswitch'`) went unread in every battle until one failed on it.

**Proposed change:** One check in `npm run check`: every key of the action order table in `runtime/sim/battle-queue.ts` is either handled by `speed.mjs` or listed there as deliberately ignored, and an unlisted key fails. Not a counter on every filter: most filters are right to ignore `residual`, `pass` or `beforeTurn`, and counting them is noise.

`revivalblessing` and `priorityChargeMove` are named by neither `SWITCHES` nor the move check today. Neither is shown to lose a read: Revival Blessing has no speed race, and the order of two charges — Focus Punch, Beak Blast, Shell Trap — needs two such users in one turn.

**Validation:** Adding a kind to the simulator's table fails the check until `speed.mjs` classifies it.

**Built** (`78e314e`, `40aa5b7`): `speed.mjs` exports `ACTION_KINDS`, with `read` derived
from the sets the reader uses and `ignored` giving one reason per remaining kind. The check
reads `resolveAction`'s `orders` and its orderless exceptions from the pinned simulator source:
18 kinds, six read and twelve deliberately ignored. It fails on an unclassified or stale
kind, a kind on both lists, an empty reason, or an unreadable table. `pass` is discarded
before the table, so it needs no entry. Removing `instaswitch` from the actual reader's set
fails the check by name, reproducing the historical coverage gap without playing a battle.
Fourteen negative cases failed as intended; seed 2 and 88 output was unchanged. The check
added about 65 ms in alternating runs on `lallafa` (median 218 ms before, 283 ms after,
provisioning excluded).

<a id="s5"></a>

##### S5 — Count a proven turn that fails again

**Check · Effort S · Related to A32 and A78, which concern the finished rebuild rather than the rounds**

**Why it matters:** The loop hands the next round its proven turns as exact, with the dice that rebuild them. When the next round fails inside them under the same dice sequence, the evidence's own guess does not fit its own proof: either the evidence is looser than the battle (the per-key Attack tie) or the hypothesis was assembled from two rounds (the Earthquake row). The loop absorbs it — it drops the pins from that turn on and searches again — and it surfaces later as set-aside rows and extra rounds.

**Proposed change:** Count each such failure, with its turn and Pokémon, as a warning in the fuzz and catalog output. A spread that throws a different dice sequence is the case the loop already handles and is not counted. Bundling the guess, HP path, pins and budget into one value would make the second kind impossible to write, but it rewrites the most path-sensitive code in the project for one class of fault; it belongs with other work in `infer.mjs`, not on its own.

**Validation:** Restore the old Earthquake fallback check in a scratch copy: it must raise a
warning when the evidence's chosen guess is checked against the previous guess's HP path.
The originally proposed Gengarite round-2 test does not exercise this check: restoring the
per-key Attack tie produces no exact turns to hand on, so there is no proof here to break.

**Built** (`815210f`): a hand-off carries the proof's draw signatures and faces and its
choices beside the pins, for diagnosis only. Before dropping pins, the next rebuild checks
whether it failed inside the proved part of an exact turn while all draws and choices that
could affect that line still match the proof. A different draw sequence or choice does not
raise this warning. `inferSpreads().warnings` names the round, turn, expected and actual line,
and the Pokemon those lines name. The loop's behavior is unchanged; warnings are not saved.
The restored Earthquake check raised one warning. Current code raised none across the 29
recordings, 24 saved games and ten regression fuzz seeds. The restored Gengarite tie instead
shows up in S2: rebuilds rise from four to nine and probes from 661 to 3,067. S5 detects an
inconsistent exact hand-off, not every kind of inconsistency in the evidence.

**Review correction** (`89367b8`): a rejected choice uses a sentinel index of -1, not a
position in the log. Its actual matched-line count now decides whether it lies inside a
partial proof. Rejection after the proved prefix must not warn. Eleven focused boundary,
draw and choice cases passed on `lallafa`; a twelfth checked accumulation of discarded
ability readings in the CLI's counts and warnings.

<a id="s6"></a>

##### S6 — Read more dice off the replay (deferred)

**Design · Effort L**

**Why it matters:** The failures of cause 2 are all dice that must change together. Damage rolls, crits and accuracy are already read off the observed turn (§7.3); speed ties, plain `random(100)` secondaries, flinches and durations are searched.

**Proposed change:** Deferred. A die whose outcome prints soon after it is thrown is already steered. One whose outcome prints later can be read only by a look-ahead through the dice thrown between — which is the search again — or by a rule per mechanic that ties a later line back to a die, a hand-written list of the kind S4 guards against. Reconsider only if S3's unseen seeds show that failures needing two dice at once are a real share of what fails.

<a id="s7"></a>

##### S7 — One change per check

**Working rule · Overlaps A14**

**Why it matters:** Several loop changes committed together needed separate runs, each with one part switched off, to find which one broke seed 44. The record cache (§8) does not make an inference change cheap: its fingerprint covers all of `scripts/lib`, so any edit to the inference reruns every effect, about 2.5 hours.

**Proposed change:** Check each change to the inference on its own, against S3's list; the full catalog run follows a batch. A14's cache split by pipeline stage is what would make a full check per change affordable. Agents work in parallel only on work in separate files — probe recordings, catalog fixtures, the extension; changes to `evidence.mjs`, `infer.mjs` and `reconstruct.mjs` go one at a time.
