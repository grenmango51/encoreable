# Branching — play a recorded battle forward from any turn, both sides, in the real battle UI

**Read first:** `ENGINEERING.md` — §3 (channels), §5.6–5.10 (branching), §6 (traps).
**Verified against:** the checkout in `runtime/`, the upstream `replay-embed.js` the vendored
client is built from, Node v24.19.0, npm `pokemon-showdown@0.11.11`.

---

## 0. What it is

An analysis board for Pokémon, the way chess.com lets you play on from any position.

Take a recorded battle. Pick a turn. Get the **real Showdown battle interface**, in the browser,
sitting at that exact position — and play forward, choosing moves for **both** teams.

- **Simultaneous, not alternating.** Both sides commit blind and the turn resolves once both
  are in. Native Showdown behaviour; no work was needed for it.
- **The goal is planning, not winning.** There is no hidden information to protect. The
  operator is allowed to know everything. There is no fog of war.

This is not the replay player. The replay player has no concept of making a choice. This is a
live battle room driven into a known position.

There are two ways in — a command, and a button in the replay view — and one implementation
behind both.

---

## 1. Running it

### From the terminal

```
npm run live                     newest recorded battle, turn 4
npm run live -- --at 3
npm run live -- --from recordings/gen9championsvgc2026regmb-34.log.json --at 4
npm run live -- --at 4 --dry-run                  truncate and print the position only
npm run live -- --at 4 --verbose                  echo every protocol frame
npm run live -- --at 4 --verify <new log.json>    check a branch that was played out
```

`live.bat` is the double-click entry point. The servers start themselves if they are not up.

Recordings are found in both `recordings/` and `runtime/logs/` (`scripts/lib/recordings.mjs`),
newest first, and on a name collision the archived copy in `recordings/` wins. `runtime/` is
generated and rebuilding it is routine, so a battle worth keeping is archived to `recordings/`,
which is tracked.

### From the replay view

One more button in the replay control row:

```
Play   Reset   Last turn   Next turn   Go to turn...   Switch sides   Play from here
```

Scrub to a turn and click it. It is `npm run live` for the turn you are looking at, with no
command line. The replay stays open beside the battle as the reference.

```
npm run replay                     play a battle, then open its replay with the button
npm run replay -- --from <log.json>
npm run replay -- --no-open        write and serve the page without opening it
```

The page is served from the client host, not opened as a file:
`http://127.0.0.1:8080/replays/<name>.html`. That is what lets the button reach the server.

### What appears

Two Chrome windows side by side, each already in the battle room at the chosen turn, each
holding one slot with its own move buttons. The scrollback above the battle carries the real
earlier turns. Pick moves in both windows; the turn resolves when both are in.

There is no clock — the turn timer does not auto-start (`server/room-battle.ts:206`) and
`timeoutAutoChoose` is off (`:202`), so nothing is chosen for you. Do not switch it on.

Exact HP is split across the windows: each side sees its own numbers exactly and the opponent
as a bar, so the pair between them shows every value.

---

## 2. How it works

```
1. truncate the recorded input log at turn N               scripts/lib/truncate.mjs
2. append a fresh >reseed after the last kept choice        scripts/lib/truncate.mjs
3. connect to the local server as an ordinary guest        scripts/lib/ws-admin.mjs
4. /importinputlog <truncated log>   ->  a live room at turn N
5. read the new roomid out of the |init|battle frame
6. open two Chrome profiles, each /join <roomid> under its own name
7. /restoreplayers                   ->  both users take their original slots
```

`scripts/lib/branch-launch.mjs` is the single launch path. `npm run live` and the button both
call it, so there is one implementation to keep verified.

### 2.1 Truncating at a turn

The log is replayed **one line at a time**, stopping when `battle.turn` reaches the target.
Choice lines do not map one-per-side-per-turn — a faint replacement adds an extra
`>pN switch …` mid-turn — so index arithmetic cuts in the wrong place. `ENGINEERING.md` §5.8.

An input log containing a `default` choice is rejected up front: those are unreplayable
(`ENGINEERING.md` §6.1).

Truncation stops at the **start** of the target turn, before either side has committed, so the
last recorded turn is a real position — the one whose choices ended the battle, and usually the
one worth replaying. Only a target *past* the last turn is dead, and `truncateAtTurn` reports
that as `ended`. Turn 0 is team preview, a different kind of decision, and is not a branch
point.

### 2.2 The position is recorded, the rolls are not

The `>start` seed is never touched. Replaying the prefix under the recorded seed is what
reproduces the recorded position; any other seed lands somewhere else entirely.

A fresh `>reseed` goes in after the last kept choice instead (`sim/battle-stream.ts:113`). So the
position is exactly the recorded one and everything played from it rolls new. Branch the same
turn twice and the same pair of choices can give different damage — that is the point of an
analysis board.

`resetRNG` announces itself (`sim/battle.ts:362`), so
`|message|The battle's RNG was reset.` sits at the end of the scrollback, marking where the
recorded battle stops and yours begins. Any protocol comparison across a reseed has to expect
it.

### 2.3 Permission, without a rank

`/importinputlog` needs the `importinputlog` permission, which only the `~` group holds. `~` is
unreachable on this server: a name listed in `config/usergroups.csv` counts as *trusted*, and a
trusted name requires an authentication token from a login server
(`server/users.ts:640`) — `noguestsecurity` does not exempt it.

So `provision-local-server.mjs` grants that permission to the **default group** through
`Config.grouplist`, and the launcher connects as a plain guest with no rank. The change lives
entirely in `config/`.

`MAX_MESSAGE_LENGTH` is not in play: the 1000-character cap is enforced inside `checkChat`
(`server/chat.ts:1246`), which `importinputlog` never calls. The 1.7KB import goes through as
one frame — `/importinputlog ` is registered as a multi-line command
(`chat-commands/core.ts:1849`), and that path is only taken when the text contains a newline.
The import itself screens only for `>eval` (`chat-commands/core.ts:899`), so a `>reseed` line
passes.

### 2.4 Getting the players into their slots

`/importinputlog` parses the player names out of the input log and sets `hasTeam = true`
(`server/room-battle.ts:593-603`). That unlocks the direct path: `invitebattle`
(`chat-commands/core.ts:1236`) skips the invite handshake and calls `joinGame` outright when the
target is **already in the room** and the slot has a team. `restoreplayers` (`:1320`) issues one
per slot using those names.

So both browsers join the room first — under the names the input log carried — and then a single
`/restoreplayers` fills both slots with no popups and no clicking.

One user cannot hold both slots (`server/room-battle.ts:665`), which is why there are two
Chrome `--user-data-dir` profiles rather than two tabs.

### 2.5 The one thing that breaks it

`sim/battle.ts:3245`:

```ts
if (options.team) throw new Error(`Player ${slot} already has a team!`);
```

Players must join **without** a team. `joinGame(user, slot)` with no `playerOpts` writes
`>player pN {"name":…,"avatar":…}` and `setPlayer` takes its edit branch (`:3223`), which only
touches name and avatar. Any path that supplies a team throws and kills the battle — so
`autobattle.js` never sends `/utm` in join mode.

The failure is quiet: `BattleStream._write` swallows the rest of a chunk on a throw
(`sim/battle-stream.ts:41`) and reports it as an `error` chunk, not an `|error|` line. A choice
that silently failed to apply looks identical to one that was never sent — check
`battle.inputLog.length` against the lines you wrote.

### 2.6 Two branches at once

`/restoreplayers` needs each joiner to hold exactly the name in the input log, and an
unregistered name cannot be reused while its holder is connected (`server/users.ts:811`). So a
branch opened while an earlier one's windows are still up would collide.

The launcher tries the recorded names first and falls back to suffixed ones, so a lone branch
shows the real players and a concurrent one plays as `Name-2`. Names are capped at 18 characters
(`server/users.ts:746`), so the suffix eats into the name rather than extending past it.
Availability is tested by trying: take the name on a throwaway connection and read the answer.

---

## 3. Entering from the terminal

`scripts/local-live.mjs` picks the newest recording unless `--from` names one, truncates, prints
the position, and hands off to `launchBranch`. It checks ports 8000 and 8080 first and starts
`scripts/local-serve.mjs` detached if either is down.

`--dry-run` stops after the truncation and prints the position and the truncated log's size,
which is the cheap way to confirm a turn is worth entering. `--verbose` echoes every protocol
frame on the admin connection.

When it reports `LIVE BRANCH READY` it prints the room id, the turn, the continuation seed, and
which name holds which slot in which window, then the exact `--verify` command for the battle
once it ends.

### 3.1 Verifying a branch that was played out

`--verify` is the honest check. It recomputes the truncated prefix, asserts the played room's
input log is that prefix plus new choices only, then re-simulates that log offline and compares
the protocol line for line against what the room recorded.

`|player|` lines are excluded from both sides of that comparison: taking a slot writes one
wherever the join happened, so its position says when someone clicked, not what the battle did.

---

## 4. Entering from the replay view

The button appears from turn 1 to the last turn inclusive, and only when the page carries an
input log.

### 4.1 The button is drawn by the player, not beside it

`update()` rewrites `.replay-controls` wholesale on every play, pause and seek
(`replay-embed.ts:180`). Every button in that row — Play and Pause included — is discarded and
redrawn, so there is no long-lived button to imitate. `scripts/client/replay-branch.js` wraps
`Replays.update` and appends to the row it just built, giving the new button the same lifecycle
and, being in the same parent, the same styling with no CSS of its own.

Clicks go through the player's own dispatch: `replay-embed.ts:75` reads `data-action` off any
clicked button and calls `Replays[action]()`, so `Replays.branch` plus `data-action="branch"` is
the whole wiring. A `data-action` naming no method throws. `Replays` is a top-level `var`, so
`window.Replays` resolves.

No listener, and nothing touching `Battle.subscribe` — that replaces the single subscriber
(`battle.ts:1247`) which `Replays.init` already holds; a second call would disconnect the player
from its own battle.

### 4.2 The input log rides in the page

The page carries the log itself in a plain-text script tag rather than a path to it, so it
branches on any machine running the launcher and the endpoint never reads a file by name. That
log holds both packed teams **with their EVs** — the stats Open Team Sheets deliberately hides.
`replays/` is gitignored; these pages are not files to hand around.

### 4.3 The endpoint

Clicking POSTs `{inputLog, turn}` to `/branch` on the client host, which calls `launchBranch`
and answers with the room id, turn, continuation seed, players and filled slots. Anything
unplayable — no input log, a turn past the end, turn 0, a body that is not JSON — comes back as
400 with a readable message that the button shows in a status line under the control row. `GET
/branch` is 405; a missing page under `/replays/` is 404.

---

## 5. What is verified

| Claim | Evidence |
|---|---|
| Truncation lands on the right position | `--at 4` on fixture `-34` gives `p1 Incineroar 115/202, Sinistcha 101/177` / `p2 Metagross 157/157, Whimsicott 56/167 brn`, `ended=false`, both sides `requestState='move'` |
| The import produces a playable room mid-game | room created at turn 4 with the full history from turn 1 in its log |
| Both slots fill | `\|player\|p1\|Ghosts9102\|` and `\|player\|p2\|Boom9102\|` after one `/restoreplayers`, no popups, no errors |
| Each side is handed its own legal choices, exact HP | p1 request: `Incineroar@115/202 Sinistcha@101/177`; p2 request: `Metagross@157/157 Whimsicott@56/167 brn` |
| Both sides can play a turn simultaneously | two choices written, turn resolved with real protocol output, no choice errors |
| Two windows open and take their slots | `npm run live` reaches `LIVE BRANCH READY` with p1 left and p2 right |
| Reseeding keeps the position | truncation at turn 4 with and without `>reseed` re-simulates to the same protocol log apart from the reset message; the reported position is identical |
| The reseed is a real reseed | the live RNG state differs afterwards, and two calls roll different seeds |
| The routes work | `/replay-branch.js` 200, `/replays/<missing>` 404, `GET /branch` 405 |
| The page carries what it needs | served page has both script tags, a 1.9KB input log, highest turn 5 |
| The endpoint launches a branch | `POST /branch` turn 4 → room at turn 4, both slots filled, in 6.5s |
| The last turn branches | turn 5 of a 5-turn log and turn 2 of a 2-turn log both open a room; turn 6 of the 5-turn log still refuses |
| Bad requests fail cleanly | past-the-end, turn 0, no input log and non-JSON all return 400 with a readable message |
| Two branches coexist | same turn twice → two rooms, different seeds, second one as `Ghosts9102-2` / `Boom9102-2` |
| The button wiring holds | 19 assertions against a stub DOM: placement, `data-action`, icon, spacer, POST body, status, survives a row rebuild, never doubles, present on the final turn, absent at turn 0 / past the end / with no input log |
| The upstream player has the shape the button relies on | fetched `replay-embed.js`: `var Replays={...}`, `update` rewriting `.replay-controls`, `data('action')` → `_this[action]()` |
| The replay page is deterministic | `npm run replay -- --no-open` passes all five determinism checks |
| A played-out branch verifies | prefix INTACT (12 lines), 2 new choices, re-simulation IDENTICAL (98 battle lines); and prefix INTACT (9 lines), 7 new choices, re-simulation IDENTICAL (106 battle lines, 6 turns) |

**Not verified:** nobody has clicked the button in a real browser. The wiring is covered by the
stub DOM, the endpoint end to end, and upstream's shape by inspection — but the click itself is a
look-at-it check.

---

## 6. Out of scope

- **No branch tree.** One linear continuation from one chosen turn, one per click. No rewind, no
  re-branch, no variation list. To try a different turn 6, run the command again or click the
  button again.
- **No RNG control here.** It matters, and the mechanism is specified in `ENGINEERING.md` §4,
  but that mechanism patches an in-process `Battle` while a live branch runs in the server's
  simulator worker. Forcing a crit inside a live room is a separate problem — §8 there.
- **No CLI move-picker.** The deliverable is the native browser battle UI.
- **No custom battle UI.** If you find yourself writing a move button, stop.
- **The replay view does not become the battle.** It stays a replay.
- **No channel −1 server patch.** Two windows already show every exact value (§1).
- **No AI, no engine, no evaluation, no opponent bot.**
- **Official replay downloads.** They carry no input log and no seed, so there is nothing to
  branch from. Reconstructing one is its own problem.
- **No auto-verify.** `verify-branch` needs a battle that *ended*, and analysis branches are
  abandoned; the launcher prints the command instead.
- **The button does not start the servers.** Reading the page over 8080 means they are up.
- **No build of the vendored client.** The player still comes from upstream
  (`ENGINEERING.md` §6.3).
- **No fork of Showdown.** `runtime/` is the server we run; read it freely, change only
  `config/`, and only through `provision-local-server.mjs`.

---

## 7. Line-number index

Verified against `pokemon-showdown@0.11.11`, the version pinned in `package.json`; re-check
every row on any upgrade.

| What | Where |
|---|---|
| `importinputlog` creates the room | `runtime/server/chat-commands/core.ts:893-915` |
| `importinputlog` screens only `>eval` | `runtime/server/chat-commands/core.ts:899` |
| registered as a multi-line command | `runtime/server/chat-commands/core.ts:1849` |
| input log written to the stream | `runtime/server/room-battle.ts:577` |
| player names + `hasTeam` parsed from log | `runtime/server/room-battle.ts:593-603` |
| one user cannot hold two slots | `runtime/server/room-battle.ts:665` |
| `onConnect` on join sends the request | `runtime/server/room-battle.ts:704`, `:933-950` |
| join writes `>player` with no team | `runtime/server/room-battle.ts:1146-1164` |
| timer defaults (`timeoutAutoChoose: false`) | `runtime/server/room-battle.ts:195-206` |
| `setPlayer` edit branch / team throw | `runtime/sim/battle.ts:3223-3245` |
| `invitebattle` direct-join path | `runtime/server/chat-commands/core.ts:1236` |
| `restoreplayers` | `runtime/server/chat-commands/core.ts:1320` |
| `>reseed` handling, recorded to the input log | `runtime/sim/battle-stream.ts:113-117` |
| `resetRNG` announces itself | `runtime/sim/battle.ts:360-363` |
| a throw drops the rest of a chunk | `runtime/sim/battle-stream.ts:35-47` |
| trusted names need a login token | `runtime/server/users.ts:638-645` |
| a connected unregistered name cannot be reused | `runtime/server/users.ts:796-813` |
| the 18-character name cap | `runtime/server/users.ts:746` |
| permission resolution off the group object | `runtime/server/user-groups.ts:118-155` |
| default group in `grouplist` | `runtime/config/config-example.js`, entry with `symbol: ' '` |
| `MAX_MESSAGE_LENGTH`, only inside `checkChat` | `runtime/server/chat.ts:151`, `:1246` |
| the control row is rebuilt from `update()` | `replay-embed.ts:167-184` |
| the delegated `data-action` dispatch | `replay-embed.ts:75-78` |
| `Replays` as a top-level `var` | `replay-embed.ts:58` |
| `Battle.subscribe` replaces the subscriber | `play.pokemonshowdown.com/src/battle.ts:1246` |
| the one launch path | `scripts/lib/branch-launch.mjs` |
| CLI entry point | `scripts/local-live.mjs` |
| truncation and reseed | `scripts/lib/truncate.mjs` |
| scripted connection | `scripts/lib/ws-admin.mjs` |
| branch verification | `scripts/lib/verify-branch.mjs` |
| two-profile browser launch | `scripts/lib/browser.mjs` |
| finding and archiving recordings | `scripts/lib/recordings.mjs` |
| page shell and the embedded log | `scripts/lib/replay-html.mjs` |
| the button | `scripts/client/replay-branch.js` |
| client-side `autojoin` | `scripts/client/autobattle.js` |
| routes: `/replays/`, `/replay-branch.js`, `/branch` | `scripts/local-serve.mjs:107-140` |
| `/branch` request handling | `scripts/local-serve.mjs:60-104` |
| `autobattle.js` injected into the test client | `scripts/local-serve.mjs:164` |
