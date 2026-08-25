# Encoreable — Agent Execution Brief

**Audience:** a coding agent with repo access and a terminal. Assume no prior conversation.
**Verified against:** the checkout in `runtime/` (a real, running local server), Node v24.19.0,
npm `pokemon-showdown@0.11.11`.
**Companion doc:** `PLAN.MD` holds product strategy. This file is execution only.

---

## 0. Mission

Build a tool that takes a finished Pokémon Showdown battle, restores the exact position at
an arbitrary turn, and lets a human play forward from there — piloting **both sides**, with
manual control over RNG outcomes.

Target ruleset is **Pokémon Champions VGC** (`[Gen 9 Champions] VGC 2026 Reg M-B`), doubles.

### Status

| | |
|---|---|
| Determinism (Task 1) | **DONE — PASS.** Input logs round-trip byte-identically. |
| Full information (Task 2) | **DONE — YES on our own server, NO on the public ladder.** |
| Per-roll RNG control (Task 4) | **DONE.** `/rng` inside a live battle room, every draw in the simulator, §4. No panel yet. |
| Restore to turn N (Task 3) | **DONE.** `scripts/lib/truncate.mjs`, §5.9. |
| Playable branch (Task 5) | **DONE.** `npm run live` — the native battle UI, both sides, §5.9. |

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
(`server/chat-commands/core.ts:840`) requires *both* players to consent via
`/allowexportinputlog` (`:804`). We bypass it locally only because we are `~` on our own
server. Nothing about hosting our own server changes what other people's replays expose.

---

## 2. Verified facts — do not re-derive

### 2.1 Format IDs

| Format | ID |
|---|---|
| VGC 2026 Reg M-B (primary target) | `gen9championsvgc2026regmb` |
| VGC 2026 Reg M-A | `gen9championsvgc2026regma` |
| Doubles Custom Game (sandbox) | `gen9championsdoublescustomgame` |

`championsregma`'s `scripts.ts` is `{ inherit: 'champions', gen: 9 }` — mechanics are shared.
Build against `champions`; Reg M-A follows automatically.

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

- `battle.getDebugLog()` (`sim/battle.ts:3151`) is exactly
  `extractChannelMessages(this.log.join('\n'), [-1])` (`:35`).
- `getScrollback(-1)` (`server/rooms.ts:1964`) resolves every `|split|pN` block to its secret
  line, leaving a **flat, ordinary protocol log**.

The consequence that matters: an omniscient log needs **no client modification**. The standard
replay player renders it as-is, because the secret lines are shaped identically to the public
ones. Any future viewer gets exact HP for free.

Omniscient logs are officially sanctioned upstream (Zarel) — this is not a hole being abused.

### 3.1 `Config.logchallenges` — the one-line unlock

`server/room-battle.ts:850` only calls `logBattle()` for **unrated** challenge battles when
`Config.logchallenges` is set. Without it, `logData` — and the input log with it — is discarded
the instant the battle ends, and the server writes no log file at all. It is set in
`scripts/provision-local-server.mjs`.

Anything that depends on reading a finished battle's input log depends on this flag.

---

## 4. RNG control — the working mechanism

**Tier 1 (scripted RNG injection) works and is the only tier needed.** Seed search was never
required. `forceRandomChance` is confirmed useless for our purpose: it is `readonly`, set once
at construction, gated on `debugMode`, and forces *every* `randomChance()` call to one boolean.

The operator names an outcome with `/rng` in the battle room. The command writes a `>eval` to
that room's battle stream (`sim/battle-stream.ts:128`), which is where a live branch's `Battle`
actually is; the interceptor inside the simulator substitutes that one draw and reports what it
did. Both halves live in `scripts/server/rng-command.js`.

### 4.1 One interception point covers every draw

Every random decision in a battle is one `prng.rng.next()` call, and every caller reaches it
through `PRNG.random`: `randomChance(n, d)` is `random(d) < n` (`sim/prng.ts:116`),
`sample(items)` is `random(items.length)`, `shuffle` is repeated `random(a, b)`. Nothing in
`sim/` or `data/` calls `rng.next()` directly. Wrapping three methods on the live `PRNG` —
`random`, `randomChance` and `sample` — therefore covers the whole simulator, mods included,
with nothing pinned to a line number that moves on upgrade.

Wrap `random`, not `next`. At `random` the denominator, the offset and (through the wrappers
above it) the numerator and the sampled array are all in hand, so a forced draw is an integer
returned directly. `next` sees a bare 32-bit number: forcing a value there means converting
through `floor((v + 0.5) * 2**32 / d)`, and it never sees the array a `sample()` was handed.

`randomChance` and `sample` are wrapped only to record what was asked for. That is what lets a
rule say "make this proc" or "make this three hits" with no probability and no hit-count table
written down anywhere — which matters, because Champions changes the odds: paralysis is
**1/8**, sleep duration is **`sample([2, 3, 3])`** (`data/mods/champions/conditions.ts`).
Nothing in the interceptor notices, because nothing in it knows the numbers.

**Every draw identifies itself.** A stack frame names the function that asked, and the
simulator's own context says what it was for — `battle.effect`, `battle.activeMove`,
`battle.activePokemon`, `battle.activeTarget`, saved and restored around every handler dispatch
(`battle.ts:631/647/900/906`). Frames defined by `eval` are the interceptor's own and are
dropped; so are `PRNG.*` and the `Battle.random` / `randomChance` / `sample` pass-throughs. The
first frame left is the site. `dist/` is esbuild output with function names unmangled, so this
survives compilation.

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

**A controlled battle is manipulated by definition.** `>eval` lines are pushed to
`battle.inputLog` before they run (`battle-stream.ts:132`), so the recipe carries the install
and every arm in plain text, each arm and each substitution writes a `#rng` line into the
battle log, and replaying the recording reinstalls the interceptor and re-forces the same
draws. Arm commands return a constant so the `<<<` echo is stable. None of this is suppressed —
the audit trail is the point.

The simulator computes every consequence itself. Nothing in this mechanism writes damage, sets
a status, or decides a hit.

### 4.3 The damage ladder is sparse — and this killed post-hoc editing

The 16 damage rolls do not produce 16 distinct damage numbers. On the fixture, a base-42 hit
had a reachable ladder of **39 / 40 / 42 / 43 / 45 / 46** — deltas of 1, 3 and 4 only.
**A delta of 2 or 5 is unreachable.**

This is why editing the number in the log directly is the wrong mechanism. It can write `44`,
a damage value **no roll can produce** — a log internally inconsistent with its own seed, which
fails any honest re-simulation. Roll selection is the only sound approach, and it is what
shipped: `/rng force roll0`..`roll15`, `mindmg`, `maxdmg`. "Deal exactly N damage" did not.

Consequences for the branch UI:
- "Deal N more damage" is **not always a legal request.** Enumerate the reachable ladder and
  present that set, not a free-text number.
- Enumerating the ladder costs 16 full replays per hit. Cheap on a 5-turn fixture, quadratic on
  a long battle — it would need caching per (attacker, defender, move, turn).
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
concrete, demonstrated reason `PLAN.MD` §5 has the human pilot **both** sides: past a material
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
battle — are in `BRANCHING.md` §2 and §3, along with the one thing that breaks it.

### 5.10 Branching from the replay view

The replay page carries a **Play from here** button that branches the turn on screen through
the same launch path as `npm run live`. How the button is drawn by the player rather than
beside it, how the input log rides in the page, and the endpoint that receives it are in
`BRANCHING.md` §4. `>reseed` — the only way to keep a position and change the rolls — is
`BRANCHING.md` §2.2.

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

Pin the `pokemon-showdown` version. On any upgrade, the test is a diff of those six call sites
plus a re-run of `npm run replay`. Line numbers in this document have already drifted once.

---

## 7. Scripts

| Command | What it does |
|---|---|
| `npm run replay` | Provision, play the fixture, re-simulate, diff, render, report. The determinism + full-information proof. |
| `npm run live` | Truncate at a turn, import it as a live room, open two windows on it. §5.9. |

`npm run replay` serves its page from the client host and puts a **Play from here** button in the
replay control row, which does the same thing as `npm run live` for the turn on screen. §5.10.

Shared flags: `--from <log.json>`, `--no-open`, `--verbose`, `--embed <url>`.
`npm run live` takes `--at <turn>`, `--dry-run` and `--verify <log.json>`.
`npm run replay` takes `--force "<outcome> <subject> [move]"` (repeatable), with `--at <turn>`,
`--always` and `--seed <seed>`: it replays the recording twice from that turn under one shared
reseed, once plain and once controlled, and reports what was substituted and which battle lines
moved. That is the headless proof for §4; `/rng` is the same engine driven from a live room.
`replay.bat`, `live.bat` and `battle.bat` are the double-click entry points.

| File | Role |
|---|---|
| `scripts/lib/protocol.mjs` | the one shared log filter and diff (§6.2) |
| `scripts/lib/ws-player.mjs` | scripted WebSocket player, explicit targets only (§6.1) |
| `scripts/lib/ws-admin.mjs` | scripted connection that issues `/importinputlog` (§5.9) |
| `scripts/lib/truncate.mjs` | cut an input log back to a turn boundary (§5.8), optionally reseeding the continuation (§5.10) |
| `scripts/lib/verify-branch.mjs` | prove a played branch is prefix + new choices (§5.9) |
| `scripts/lib/browser.mjs` | two isolated browser profiles, side by side (§5.9) |
| `scripts/lib/branch-launch.mjs` | the one launch path: import, two windows, both slots (§5.10) |
| `scripts/client/replay-branch.js` | the replay page's "Play from here" button (§5.10) |
| `scripts/lib/replay-html.mjs` | replay shell (§6.3) |
| `scripts/server/rng-command.js` | the `/rng` command and the interceptor it sends (§4) — CommonJS, copied into `runtime/config/` |
| `scripts/lib/rng-control.mjs` | the same engine driven headlessly: build a controlled input log, replay it, read the accounting (§4.2) |
| `scripts/fixtures/teams.js` | the two fixture teams, as export text, packed at runtime |
| `scripts/provision-local-server.mjs` | local config, including `logchallenges` (§3.1) |

The fixture teams use non-uniform spreads that each sum to 66 (e.g. Archaludon
`32 HP / 1 Def / 5 SpA / 25 SpD / 3 Spe`) precisely so that the stat-recovery check is a real
test vector and not a symmetric one that would pass by accident.

---

## 8. Open tasks

### A longer fixture

The current one is five turns and ends almost immediately, so there is barely anywhere to
branch and `npm run live --at 6` has nothing to stand on. Also needed to exercise `REJECTED`
(§5.2) and to learn whether roll-table caching is actually required (§4.3).

Record it with `npm run battle`, or play one out from a live branch — either way it lands in
`runtime/logs` with its input log intact (§3.1).

### A control surface for `/rng`

The engine is done and the commands work, but the only way to reach them is typing. A battle
turn asks for roughly 28 draws, so the surface cannot be a list of dice — it has to be a
catalogue of outcomes per active Pokémon, offered before the turn resolves.

The mechanism needs no client code: the server already pushes interactive HTML into battle
rooms (`|uhtml|`, `chat-commands/core.ts:1052`, client `panels.js:1473`), and a
`<button name="send" value="/rng force crit Glalie">` is an ordinary chat command. `|uhtmlchange|`
replaces the block in place, so the panel can follow the battle.

Open questions are what the catalogue shows per Pokémon, how an armed rule and an
expired-unfired one are surfaced, where the expiry toggle lives, and whether the `<kind>=<value>`
tail gets a surface at all.

**Acceptance:** the operator arms a draw from the battle room without typing a command.

### A single omniscient window

Optional polish. Two windows show every exact value between them (§5.9), so this is comfort,
not capability. The mechanism is channel −1 (§3); the missing piece is that
`server/rooms.ts:1964` hands spectators channel 0, so it needs a server-side patch.

---

## 9. Deferred — do not start without sign-off

- **Public-ladder ingestion.** Blocked on consent, not on tooling (§1). If it is ever
  revisited, the fallback is reconstructing state from the plain protocol log; `@pkmn/client`
  is purpose-built for that. It means Layer A cannot use the sim's own replay and must rebuild
  state instead — different work, still viable.
- **Layer B, direct state authoring.** For positions that never occurred. The vehicle is
  `gen9championsdoublescustomgame` — validation off, no 66-point cap, `debug: true` already
  set. The difficulty is not HP and weather; it is the volatile layer: consecutive-Protect
  counter, Encore turns remaining, Taunt turns, Fake Out eligibility, Choice lock, `lastMove`,
  disabled slots, Tailwind / Trick Room counters, consumed-item flags, and the pending action
  queue.
- **Serialization round-trip.** `Battle.toJSON()` → `Battle.fromJSON()` → `battle.restart(send)`.
  Deserialized games *must* use `restart()`. Not a dependency of Tasks 3 or 5.
- **Constraint inference.** Bounding opponent Stat Points from observed damage and turn order.
  Two properties matter: bounds constrain a *product* (HP × Def), not a single stat, so one
  observation yields a curve; and on someone else's replay HP arrives as percentages (§3).
  Note this is now **unnecessary for our own battles** — channel −1 gives exact values, so
  inference is only ever needed for the deferred ladder path.
- **Any UI.**
- **Champions video ingestion.**

---

## 10. Reference — files worth reading

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
