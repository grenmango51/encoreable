# Replay branch — enter the battle from the turn on screen

**Read first:** `LIVE-BRANCH.MD` (the mechanism this drives), `TESTPHASE.MD` §5.9–5.10, §6.
**Verified against:** the checkout in `runtime/`, upstream `replay-embed.js`, Node v24.19.0.

---

## 0. What it is

One more button in the replay control row:

```
Play   Reset   Last turn   Next turn   Go to turn...   Switch sides   Play from here
```

Scrub to a turn, click it, and two browser windows open on a live battle at exactly that
position — one per side, both yours. The replay stays open beside them as the reference.

It is `npm run live` for the turn you are looking at, with no command line.

---

## 1. Running it

```
npm run replay                     play a battle, then open its replay with the button
npm run replay -- --from <log.json>
npm run replay -- --no-open        write and serve the page without opening it
```

The page is served from the client host, not opened as a file:
`http://127.0.0.1:8080/replays/<name>.html`. That is what lets the button reach the server.

The button appears from turn 1 to the last turn inclusive. Branching stops at the **start** of the
chosen turn, before either side has committed, so the final turn is a real position — the one
whose choices ended the battle, and usually the one worth replaying. Turn 0 is team preview, which
is a different kind of decision and is left out.

---

## 2. How it works

```
1. the replay page carries the battle's input log in a plain-text script tag
2. clicking POSTs {inputLog, turn} to /branch on the client host
3. the host truncates at that turn and appends a fresh >reseed
4. /importinputlog  ->  a live room at that position
5. two Chrome profiles join and take their slots            (lib/branch-launch.mjs)
```

`scripts/lib/branch-launch.mjs` is the single launch path. `npm run live` and the button both
call it, so there is one implementation to keep verified.

### 2.1 The position is recorded, the rolls are not

The `>start` seed is never touched. Replaying the prefix under the recorded seed is what
reproduces the recorded position; any other seed lands somewhere else entirely.

A fresh `>reseed` goes in after the last kept choice instead (`sim/battle-stream.ts:113`). So the
position is exactly the one on screen and everything played from it rolls new. Branch the same
turn twice and the same pair of choices can give different damage — that is the point of an
analysis board.

`resetRNG` announces itself (`sim/battle.ts:362`), so
`|message|The battle's RNG was reset.` sits at the end of the scrollback, marking where the
recorded battle stops and yours begins.

### 2.2 The button is drawn by the player, not beside it

`update()` rewrites `.replay-controls` wholesale on every play, pause and seek
(`replay-embed.ts:180`). Every button in that row — Play and Pause included — is discarded and
redrawn, so there is no long-lived button to imitate. `scripts/replay-branch.js` wraps
`Replays.update` and appends to the row it just built, giving the new button the same lifecycle
and, being in the same parent, the same styling with no CSS of its own.

Clicks go through the player's own dispatch: `replay-embed.ts:75` reads `data-action` off any
clicked button and calls `Replays[action]()`, so `Replays.branch` plus `data-action="branch"` is
the whole wiring. No listener, and nothing touching `Battle.subscribe` — that replaces the single
subscriber (`battle.ts:1247`) which `Replays.init` already holds.

### 2.3 Two branches at once

`/restoreplayers` needs each joiner to hold exactly the name in the input log, and an
unregistered name cannot be reused while its holder is connected (`server/users.ts:811`). So a
branch opened while an earlier one's windows are still up would collide.

The launcher tries the recorded names first and falls back to suffixed ones, so a lone branch
shows the real players and a concurrent one plays as `Name-2`. Availability is tested by trying:
take the name on a throwaway connection and read the answer.

### 2.4 The input log rides in the page

The page carries the log itself rather than a path to it, so it branches on any machine running
the launcher and the endpoint never reads a file by name. That log holds both packed teams **with
their EVs** — the stats Open Team Sheets deliberately hides. `replays/` is gitignored; these
pages are not files to hand around.

---

## 3. What is verified

| Claim | Evidence |
|---|---|
| Reseeding keeps the position | truncation at turn 4 with and without `>reseed` re-simulates to the same protocol log apart from the reset message; the reported position is identical |
| The reseed is a real reseed | the live RNG state differs afterwards, and two calls roll different seeds |
| The routes work | `/replay-branch.js` 200, `/replays/<missing>` 404, `GET /branch` 405 |
| The page carries what it needs | served page has both script tags, a 1.9KB input log, highest turn 5 |
| The endpoint launches a branch | `POST /branch` turn 4 → room at turn 4, both slots filled, in 6.5s |
| The last turn branches | turn 5 of a 5-turn log and turn 2 of a 2-turn log both open a room; turn 6 of the 5-turn log still refuses |
| Bad requests fail cleanly | past-the-end, turn 0, no input log and non-JSON all return 400 with a readable message |
| Two branches coexist | same turn twice → two rooms, different seeds, second one as `Ghosts9102-2` / `Boom9102-2` |
| The button wiring holds | 19 assertions against a stub DOM: placement, `data-action`, icon, spacer, POST body, status, survives a row rebuild, never doubles, present on the final turn, absent at turn 0 / past the end / with no input log |
| Upstream matches what it was built against | fetched `replay-embed.js`: `var Replays={...}`, `update` rewriting `.replay-controls`, `data('action')` → `_this[action]()` |
| A played branch verifies | prefix INTACT (9 lines), 7 new choices, re-simulation IDENTICAL (106 battle lines, 6 turns) |
| Nothing regressed | `npm run live` unchanged; `local-replay --no-open` still passes all five determinism checks |

**Not verified:** nobody has clicked the button in a real browser. The wiring is covered by the
stub DOM, the endpoint end to end, and upstream's shape by inspection — but the click itself is a
look-at-it check.

---

## 4. Out of scope

- **Official replay downloads.** They carry no input log and no seed, so there is nothing to
  branch from. Reconstructing one is its own problem.
- **No branch tree.** One linear continuation per click.
- **The replay view does not become the battle.** It stays a replay.
- **No build of the vendored client.** The player still comes from upstream (`TESTPHASE.MD` §6.3).
- **No auto-verify.** `verify-branch` needs a battle that *ended*, and analysis branches are
  abandoned; the launcher prints the command instead.
- **Servers down is not handled.** Reading the page over 8080 means they are up.

---

## 5. Line-number index

| What | Where |
|---|---|
| `>reseed` handling, recorded to the input log | `runtime/sim/battle-stream.ts:113-117` |
| `resetRNG` announces itself | `runtime/sim/battle.ts:360-363` |
| a throw drops the rest of a chunk | `runtime/sim/battle-stream.ts:35-47` |
| `importinputlog` screens only `>eval` | `runtime/server/chat-commands/core.ts:899` |
| a connected unregistered name cannot be reused | `runtime/server/users.ts:796-813` |
| the 18-character name cap | `runtime/server/users.ts:746` |
| the control row is rebuilt from `update()` | `replay-embed.ts:167-184` |
| the delegated `data-action` dispatch | `replay-embed.ts:75-78` |
| `Replays` as a top-level `var` | `replay-embed.ts:58` |
| `Battle.subscribe` replaces the subscriber | `play.pokemonshowdown.com/src/battle.ts:1246` |
| the button | `scripts/replay-branch.js` |
| the one launch path | `scripts/lib/branch-launch.mjs` |
| truncation and reseed | `scripts/lib/truncate.mjs` |
| page shell and the embedded log | `scripts/lib/replay-html.mjs` |
| routes: `/replays/`, `/replay-branch.js`, `/branch` | `scripts/local-play.mjs` |
