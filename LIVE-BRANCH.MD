# Live Branch — play on from any turn, both sides, in the real battle UI

**Read first:** `TESTPHASE.MD` — §3 (channels), §5.6–5.10 (branching), §6 (traps).
**See also:** `REPLAY-BRANCH.MD` — the same thing from a button in the replay view.
**Verified against:** the checkout in `runtime/`, Node v24.19.0, npm `pokemon-showdown@0.11.11`.

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

---

## 1. Running it

```
npm run live                     newest recorded battle, turn 4
npm run live -- --at 3
npm run live -- --from runtime/logs/.../gen9championsvgc2026regmb-34.log.json --at 4
npm run live -- --at 4 --dry-run                  truncate and print the position only
npm run live -- --at 4 --verbose                  echo every protocol frame
npm run live -- --at 4 --verify <new log.json>    check a branch that was played out
```

`live.bat` is the double-click entry point. The servers start themselves if they are not up.

What appears: two Chrome windows side by side, each already in the battle room at the chosen
turn, each holding one slot with its own move buttons. The scrollback above the battle carries
the real earlier turns. Pick moves in both windows; the turn resolves when both are in.

There is no clock — the turn timer does not auto-start (`server/room-battle.ts:206`) and
`timeoutAutoChoose` is off (`:202`), so nothing is chosen for you. Do not switch it on.

Exact HP is split across the windows: each side sees its own numbers exactly and the opponent
as a bar, so the pair between them shows every value.

---

## 2. How it works

```
1. truncate the recorded input log at turn N               scripts/lib/truncate.mjs
2. connect to the local server as an ordinary guest        scripts/lib/ws-admin.mjs
3. /importinputlog <truncated log>   ->  a live room at turn N
4. read the new roomid out of the |init|battle frame
5. open two Chrome profiles, each /join <roomid> under its own name
6. /restoreplayers                   ->  both users take their original slots
```

### 2.1 Truncating at a turn

The log is replayed **one line at a time**, stopping when `battle.turn` reaches the target.
Choice lines do not map one-per-side-per-turn — a faint replacement adds an extra
`>pN switch …` mid-turn — so index arithmetic cuts in the wrong place. `TESTPHASE.MD` §5.8.

An input log containing a `default` choice is rejected up front: those are unreplayable
(`TESTPHASE.MD` §6.1).

### 2.2 Permission, without a rank

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

### 2.3 Getting the players into their slots

`/importinputlog` parses the player names out of the input log and sets `hasTeam = true`
(`server/room-battle.ts:593-603`). That unlocks the direct path: `invitebattle`
(`chat-commands/core.ts:1236`) skips the invite handshake and calls `joinGame` outright when the
target is **already in the room** and the slot has a team. `restoreplayers` (`:1320`) issues one
per slot using those names.

So both browsers join the room first — under the names the input log carried — and then a single
`/restoreplayers` fills both slots with no popups and no clicking.

One user cannot hold both slots (`server/room-battle.ts:665`), which is why there are two
Chrome `--user-data-dir` profiles rather than two tabs.

### 2.4 The one thing that breaks it

`sim/battle.ts:3245`:

```ts
if (options.team) throw new Error(`Player ${slot} already has a team!`);
```

Players must join **without** a team. `joinGame(user, slot)` with no `playerOpts` writes
`>player pN {"name":…,"avatar":…}` and `setPlayer` takes its edit branch (`:3223`), which only
touches name and avatar. Any path that supplies a team throws and kills the battle — so
`autobattle.js` never sends `/utm` in join mode.

---

## 3. What is verified

| Claim | Evidence |
|---|---|
| Truncation lands on the right position | `--at 4` on fixture `-34` gives `p1 Incineroar 115/202, Sinistcha 101/177` / `p2 Metagross 157/157, Whimsicott 56/167 brn`, `ended=false`, both sides `requestState='move'` |
| The import produces a playable room mid-game | room created at turn 4 with the full history from turn 1 in its log |
| Both slots fill | `\|player\|p1\|Ghosts9102\|` and `\|player\|p2\|Boom9102\|` after one `/restoreplayers`, no popups, no errors |
| Each side is handed its own legal choices, exact HP | p1 request: `Incineroar@115/202 Sinistcha@101/177`; p2 request: `Metagross@157/157 Whimsicott@56/167 brn` |
| Both sides can play a turn simultaneously | two choices written, turn resolved with real protocol output, no choice errors |
| Two windows open and take their slots | `npm run live` reaches `LIVE BRANCH READY` with p1 left and p2 right |
| The branch is real, not just pretty | `--verify` on the played-out log: prefix INTACT (12 lines), 2 new choices, re-simulation IDENTICAL (98 battle lines) |

`--verify` is the honest check. It recomputes the truncated prefix, asserts the played room's
input log is that prefix plus new choices only, then re-simulates that log offline and compares
the protocol line for line against what the room recorded.

`|player|` lines are excluded from both sides of that comparison: taking a slot writes one
wherever the join happened, so its position says when someone clicked, not what the battle did.

---

## 4. Out of scope

- **No branch tree.** One linear continuation from one chosen turn. No rewind, no re-branch, no
  variation list. To try a different turn 6, run the command again — or click the button in the
  replay view (`REPLAY-BRANCH.MD`), which is the same launch path.
- **No RNG control here.** It exists (`scripts/lib/rng-control.mjs`) and it matters, but it
  patches an in-process `Battle` while a live branch runs in the server's simulator worker.
  Forcing a crit inside a live room is a separate problem — `TESTPHASE.MD` §8.
- **No CLI move-picker.** The deliverable is the native browser battle UI.
- **No custom battle UI.** If you find yourself writing a move button, stop.
- **No channel −1 server patch.** Two windows already show every exact value (§1).
- **No AI, no engine, no evaluation, no opponent bot.**
- **No fork of Showdown.** `runtime/` is the server we run; read it freely, change only
  `config/`, and only through `provision-local-server.mjs`.

---

## 5. Line-number index

| What | Where |
|---|---|
| `importinputlog` creates the room | `runtime/server/chat-commands/core.ts:893-915` |
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
| trusted names need a login token | `runtime/server/users.ts:638-645` |
| permission resolution off the group object | `runtime/server/user-groups.ts:118-155` |
| default group in `grouplist` | `runtime/config/config-example.js`, entry with `symbol: ' '` |
| `MAX_MESSAGE_LENGTH`, only inside `checkChat` | `runtime/server/chat.ts:151`, `:1246` |
| launcher | `scripts/local-live.mjs` |
| truncation | `scripts/lib/truncate.mjs` |
| scripted connection | `scripts/lib/ws-admin.mjs` |
| branch verification | `scripts/lib/verify-branch.mjs` |
| two-profile browser launch | `scripts/lib/browser.mjs` |
| client-side `autojoin` | `scripts/autobattle.js` |
| static client server + `autobattle.js` injection | `scripts/local-play.mjs:31-45` |
