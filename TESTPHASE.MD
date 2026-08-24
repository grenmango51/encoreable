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
| Per-roll RNG control (Task 4) | **DONE.** Tier 1 shipped for all five draw kinds. |
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

Shipped in `scripts/lib/rng-control.mjs`. **Tier 1 (scripted RNG injection) works and is the
only tier needed.** Seed search was never required. `forceRandomChance` is confirmed useless
for our purpose: it is `readonly`, set once at construction, gated on `debugMode`, and forces
*every* `randomChance()` call to one boolean.

### 4.1 The five draw sites

Every random decision in a battle is one `prng.rng.next()` call:

| Kind | Call | Site |
|---|---|---|
| accuracy | `randomChance(accuracy, 100)` | `sim/battle-actions.ts:738` (`hitStepAccuracy`) |
| crit | `randomChance(1, critMult[ratio])` | `sim/battle-actions.ts:1641` (`getDamage`) |
| damage | `random(16)` | `sim/battle.ts:2388` (`randomizer`), called from `:1755` |
| secondary | `random(100)` | `sim/battle-actions.ts:1336` (`secondaries`) |
| selfboost | `random(100)` | `sim/battle-actions.ts:1317` (`selfDrops`) |

`randomChance(n, d)` is just `random(d) < n` (`sim/prng.ts:116`).

### 4.2 Four design points that are not obvious

**Always draw from the real RNG.** The scripted source calls `realRng.next()` on *every* call
and substitutes its own value only for an armed draw. This keeps the stream aligned, so no
unrelated decision shifts. A source that skipped the real draw would silently perturb the rest
of the turn.

**Capture the denominator on the way in.** `random(from, to)` calls `rng.next()` *before* it
knows anything about the range, so `next()` cannot see the denominator. Wrap `prng.random`
itself to record it, then use it as a filter (`d === 16` for a damage roll, `d === 100` for
accuracy, `1..24` for crit) so an unrelated draw inside the same function cannot be hijacked.

**Zones are a stack, not a flag.** `randomizer` runs *inside* `getDamage`, after the crit
draw, so it must push a **more specific** zone on top of `crit` rather than replace it. Arming
at `getDamage` entry catches the crit draw instead of the damage roll.

**The extreme draws force a known outcome without knowing the denominator.** Raw `0` makes
`random(d)` return `0`; raw `2**32 − 1` makes it return `d − 1`. That is enough for hit/miss,
crit/no-crit and proc/skip. For a *specific* value use
`rawFor(v, d) = floor((v + 0.5) * 2**32 / d)` — the midpoint of the band, which avoids
floating-point error at the boundaries.

The simulator computes every consequence itself. Nothing in this module writes damage, sets a
status, or decides a hit.

### 4.3 The damage ladder is sparse — and this killed post-hoc editing

The 16 damage rolls do not produce 16 distinct damage numbers. On the fixture, a base-42 hit
had a reachable ladder of **39 / 40 / 42 / 43 / 45 / 46** — deltas of 1, 3 and 4 only.
**A delta of 2 or 5 is unreachable.**

This is why editing the number in the log directly is the wrong mechanism. It can write `44`,
a damage value **no roll can produce** — a log internally inconsistent with its own seed, which
fails any honest re-simulation. Roll selection is the only sound approach.

Consequences for the branch UI:
- "Deal N more damage" is **not always a legal request.** Enumerate the reachable ladder and
  present that set, not a free-text number.
- `rollTable()` costs 16 full replays per hit. Cheap on a 5-turn fixture, quadratic on a long
  battle — cache it per (attacker, defender, move, turn).
- Filter for reachability *and* for intent: a roll that turns a non-lethal hit lethal changes
  the battle, which may not be what was asked for.

Demonstrated by `npm run rng`: Moonblast #3 forced from roll 7 to roll 1 (42 → 45) and
Moonblast #4 from roll 4 to roll 10 (43 → 40). **Exactly one battle line differs** across the
entire log — `|-damage|p1a: Incineroar|115/202` becomes `112/202`. Everything else is
identical, including the winner.

---

## 5. Branching past a material divergence — where Layer A ends

`npm run branch` forces one decision and reports what that does to the replay. Four branches
on the fixture, one per draw kind:

```
TRUNCATED  Meteor Mash misses
CLEAN      Meteor Mash does not raise Attack
TRUNCATED  Matcha Gotcha never burns
TRUNCATED  The first Moonblast crits
```

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

`npm run live` puts a truncated position into a live server room and opens two browser windows
on it. `LIVE-BRANCH.MD` is the feature doc; the facts worth carrying forward:

- **`/importinputlog` creates a *playable* room and can start mid-game.** `Rooms.createBattle`
  with `inputLog` writes the whole log to the stream (`server/room-battle.ts:577`), so the
  battle sits wherever the log ends, and a joiner receives the full history from turn 1.
- **The `~` group is unreachable on this server, and is not needed.** A name in
  `config/usergroups.csv` is *trusted*, and a trusted name requires an authentication token
  from a login server (`server/users.ts:640`) — `noguestsecurity` does not exempt it. So
  `provision-local-server.mjs` grants `importinputlog` to the **default group** through
  `Config.grouplist` instead, and the launcher connects as an ordinary guest.
- **`MAX_MESSAGE_LENGTH` never applies to a command.** The 1000-character cap is enforced
  inside `checkChat` (`server/chat.ts:1246`), which `importinputlog` does not call. A 1.7KB
  import goes through untouched; `ignorelimits` is belt-and-braces.
- **One user cannot hold both slots** (`server/room-battle.ts:665`), so the two windows run
  under separate Chrome `--user-data-dir` profiles.
- **Joining does not disturb the battle.** `setPlayer` takes an edit branch for a side that
  already exists (`sim/battle.ts:3223`) and the joiner is sent the current `|request|`. But
  `sim/battle.ts:3245` throws if a team is supplied — **never send `/utm` when joining an
  imported room.**
- **Exact HP needs no server patch.** As a *player* you see your own side exactly and the
  opponent as percentages, so the two windows between them show every value. The channel −1
  patch of §3 is only for a single omniscient window.
- **`|player|` lines land mid-log.** Taking a slot writes one into the room log wherever the
  join happened, and one into the input log. Filter them out of both sides of a protocol
  comparison — their position is a fact about when someone clicked, not about the battle.

### 5.10 Branching from the replay view

The replay page carries a **Play from here** button that branches the turn on screen.
`REPLAY-BRANCH.MD` is the feature doc; the facts worth carrying forward:

- **`>reseed` is the only way to keep the position and change the rolls.** The `>start` seed
  must stay: replaying the prefix under the recorded seed is what reproduces the recorded
  position, and any other seed lands somewhere else. `sim/battle-stream.ts:113` accepts a
  `>reseed <seed>` line after the last kept choice and records it into the battle's own input
  log. `importinputlog` screens only for `>eval` (`chat-commands/core.ts:899`), so it passes.
- **`resetRNG` announces itself.** `sim/battle.ts:362` adds
  `|message|The battle's RNG was reset.`, which lands at the end of the imported scrollback and
  marks where the branch begins. Any protocol comparison across a reseed has to expect it.
- **The replay control row is rebuilt on every state change.** `update()` calls `.html(...)` on
  `.replay-controls` (`replay-embed.ts:180`, `:182`), so every button in it — Play and Pause
  included — is discarded and redrawn. A button added once lasts until the next click; wrap
  `Replays.update` and be drawn by the same call.
- **The player's own click dispatch is reusable.** `replay-embed.ts:75` reads `data-action` off
  any clicked button and calls `Replays[action]()`. Adding a method to `Replays` and an
  attribute to the button needs no listener of your own — but a `data-action` naming no method
  throws.
- **`Replays` is a top-level `var`, so `window.Replays` resolves.** Upstream's built file was
  checked against the vendored source and matches on all three points above.
- **Never call `Battle.subscribe` from a page script.** It replaces the single subscriber
  (`battle.ts:1247`) and `Replays.init` already holds it; a second call disconnects the player
  from its own battle.
- **An unregistered name cannot be reused while its holder is connected**
  (`server/users.ts:811`). `/restoreplayers` needs the joiner to hold exactly the input log's
  name, so a second branch opened while the first one's windows are still up must rename the
  players in the log it imports. Probing is simplest by trying: take the name on a throwaway
  connection and read the answer.
- **`BattleStream._write` swallows the rest of a chunk on a throw** (`sim/battle-stream.ts:41`)
  and reports it as an `error` chunk, not an `|error|` line. A choice silently failing to apply
  looks identical to one that was never sent — check `battle.inputLog.length` against the lines
  you wrote.

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
plus a re-run of `npm run replay` and `npm run branch`. Line numbers in this document have
already drifted once.

---

## 7. Scripts

| Command | What it does |
|---|---|
| `npm run replay` | Provision, play the fixture, re-simulate, diff, render, report. The determinism + full-information proof. |
| `npm run rng` | Paired damage-roll substitution. Proves per-roll control with a net-zero outcome. |
| `npm run branch` | Four single-decision branches with CLEAN / TRUNCATED / REJECTED verdicts. |
| `npm run live` | Truncate at a turn, import it as a live room, open two windows on it. §5.9. |

`npm run replay` serves its page from the client host and puts a **Play from here** button in the
replay control row, which does the same thing as `npm run live` for the turn on screen. §5.10.

Shared flags: `--from <log.json>`, `--no-open`, `--verbose`, `--embed <url>`.
`npm run live` takes `--at <turn>`, `--dry-run` and `--verify <log.json>`.
`replay.bat`, `rng.bat`, `branch.bat`, `live.bat` are the double-click entry points.

| File | Role |
|---|---|
| `scripts/lib/protocol.mjs` | the one shared log filter and diff (§6.2) |
| `scripts/lib/rng-control.mjs` | per-draw RNG control for all five kinds (§4) |
| `scripts/lib/ws-player.mjs` | scripted WebSocket player, explicit targets only (§6.1) |
| `scripts/lib/ws-admin.mjs` | scripted connection that issues `/importinputlog` (§5.9) |
| `scripts/lib/truncate.mjs` | cut an input log back to a turn boundary (§5.8), optionally reseeding the continuation (§5.10) |
| `scripts/lib/verify-branch.mjs` | prove a played branch is prefix + new choices (§5.9) |
| `scripts/lib/browser.mjs` | two isolated browser profiles, side by side (§5.9) |
| `scripts/lib/branch-launch.mjs` | the one launch path: import, two windows, both slots (§5.10) |
| `scripts/replay-branch.js` | the replay page's "Play from here" button (§5.10) |
| `scripts/lib/replay-html.mjs` | replay shell (§6.3) |
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

### RNG control inside a live room

`scripts/lib/rng-control.mjs` patches a `Battle` object in-process. A live branch's battle
lives in the server's simulator worker, so the two do not meet yet. Forcing a crit inside a
room the browser is playing needs a different hook — probably a `>eval`-style write on the
battle stream, which `sim/battle-stream.ts` already accepts.

Keep this separate from getting the room into position; they are independent problems.

**Acceptance:** the operator can name a draw before a turn resolves in a live branch and see
the forced outcome in the browser.

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
| `runtime/sim/battle-actions.ts` | the five draw sites — :738, :1317, :1336, :1641, :1755 |
| `runtime/sim/side.ts` | `autoChoose` target skip :660 (§6.1) |
| `runtime/sim/prng.ts` | `PRNG`, the `RNG` interface, `randomChance` :116, seed formats |
| `runtime/server/room-battle.ts` | `logchallenges` :850, `>pN default` :452 |
| `runtime/server/rooms.ts` | `getScrollback(channel)` :1964 |
| `runtime/server/chat-commands/core.ts` | `exportinputlog` :840, consent :804, `importinputlog` :893 |
| `runtime/data/mods/champions/scripts.ts` | Stat formula, PP cap, Trick Room fix |
