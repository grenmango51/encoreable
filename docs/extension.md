# Encoreable as a Chrome extension

*The same analysis board, with no Node on the machine.*

**Status:** built, and every step passes its test, on 29 Sep 2026. Step 0's P1–P8 are answered
and P3–P5 pass (§4); Steps 1–5 live in `extension/` and pass (§5), all of them re-run by
`npm run extension -- --check`. P9 is not run; it needs its own sign-off. Chrome Web Store
publication is not part of this plan. `plan.md` §15 lists "extension, web app, or desktop" as
closed; this document is the case for reopening it.
**Read first:** `branching.md` §2 (the launch path this replaces), `engineering.md` §2.5, §6.3,
§6.5.

---

## 0. The question

What has to be true for Encoreable to install as a Chrome extension instead of a Node checkout,
and in what order to prove it — cheapest and most likely to fail first.

The scope guards in `plan.md` §3 hold unchanged: Showdown's simulator is the mechanics, the
native Showdown client is the UI, and no move button is ours.

---

## 1. The shape

An extension cannot run a Node server, and play.pokemonshowdown.com will not grant
`importinputlog` or load `rng-command.js`. So the server goes, and a **fake room** takes its
place: the simulator runs inside the extension and talks to the live client through the one
point every server message passes.

| Client | Inbound | Outbound |
|---|---|---|
| old (Backbone) — the live site's default (P1), and what `npm run live` uses today, via `testclient-old.html` | `app.receive` — `js/oldclient/client.js:1022` | `app.send` — `js/oldclient/client.js:921` |
| new (Preact) — opt-in on the live site at `/beta` and `/preactalpha` | `PS.receive` — `src/client-main.ts:2263` | `PS.send` — `src/client-main.ts:2379` |

The old client builds a room from any `>roomid` frame that opens with `|init|`
(`js/oldclient/client.js:1031-1041`), which is what makes a room with no server behind it
plausible.

`branching.md` §2 becomes:

```
1. truncate the input log at turn N                  scripts/lib/truncate.mjs, unchanged
2. append a fresh >reseed after the last kept choice  scripts/lib/truncate.mjs, unchanged
3. run the truncated log in the bundled simulator     BattleStream, taught >rng by rng-command.js
4. split the output per side                          extractChannelMessages — the server's job, now ours
5. receive('>roomid\n|init|battle\n…')                the client builds the room
6. wrap send: /choose for roomid -> the stream        everything else naming roomid is swallowed (P5)
```

No accounts, no two browser profiles, no `/restoreplayers`: the extension writes both sides'
`|request|` itself.

A branch is **one tab, two rooms** — `battle-<format>-encoreable<n>-p1` and `…-p2` — each fed
its own channel, so each side sees exact HP for its own Pokémon only, as two players would
(`branching.md` §1); the client's tab bar switches between them. Both rooms share one battle in
one Worker, started by the page from the packaged `sim-worker.js` as a blob. The Manifest V3
service worker is stopped when idle, so it holds only the recordings store and the hand-off to
a new tab, never a battle.

The shim answers the way the server does: request ids count up from 2, each side's wait state
refuses a stale or duplicate choice with the server's own `|error|[Invalid choice]` words
(`server/room-battle.ts`), and a `|request|` is always a message of its own — the client reads
one only at the start of a message. The branch's input log is kept in sessionStorage after
every change, so a reload, which makes the router `/join` the room in the URL, rebuilds it by
re-simulation.

The Node checkout stays. `npm run replay` and the `reconstruct` rungs remain the reference
implementation and the test harness the extension is held against.

---

## 2. What depends on play.pokemonshowdown.com

| Depends on | For | If it changes |
|---|---|---|
| **The page** — client JS, CSS, sprites, sounds | the battle UI the fake room renders in | the extension breaks until its hooks are re-targeted |
| **Not the server** | — | no rank, no plugin, no account, no format support needed; the server never learns the room exists |
| replay.pokemonshowdown.com | the "Play from here" entry point and the replay log | the entry point breaks; recordings already stored still work |

The client is **not** pinned any more. `vendor/` is fixed at commit `218cc779` (2 Aug 2026); the
live site ships whenever upstream does. The live site serves the old client by default (P1).

Bundling the client into the extension removes the page dependency, but the offline build does
not exist (`engineering.md` §6.3), the extension would become AGPLv3, and sprites would still
come from upstream. Injecting into the live page is the plan.

---

## 3. What ports, what goes

| Piece | In the extension |
|---|---|
| simulator | The pinned build's compiled files, 55 of them, embedded as text and run by a CommonJS loader (`extension/src/cjs.js`) the way Node runs them: each in Node's module wrapper, under its own `//# sourceURL`. Nothing is rewritten. A bundler renames self-referencing classes (`Battle` becomes `_Battle`), and `rng-command.js` finds the code that asked for a draw by class and method name in the stack, so bundling the simulator would break RNG control. `sim/dex.ts`'s data reads are answered from the embedded files: the base data and the `champions` and `championsregmb` mods. Every other mod is listed, so every format loads, but has no data. |
| Node built-ins | `fs`, `path`, `util`, `os`, `crypto`, `module` and `worker_threads` are stand-ins in `extension/src/node/`, so the `scripts/lib` code below is bundled as written. |
| `truncate`, `protocol`, `verify-branch` | Unchanged. |
| `reconstruct`, `inference/*`, `replay-source` | Unchanged. `worker_threads` is nested Web Workers started from the same blob, with `workerData` passed in the Worker's name. A replay reaches `loadSource` as an in-memory file. |
| `rng-command.js` | Unchanged. `teachStream` on the embedded stream, and `/rng` is answered by its own `commands.rng` with a stand-in chat context. Its `\|queryresponse\|rng\|` push goes to both of a branch's rooms. |
| `rng-panel.js` | Shipped as it is but for one hook: `window.__rngPanelRooms` limits it to fake rooms, so a real battle's tooltips stay vanilla. Its transport is `app.send`, which the shim answers. It keeps a tooltip up while the pointer is in it whenever the box carries its rows or a `keeps-open` section. |
| Stat Point panel | New in the extension: `extension/src/spread-panel.js`, bundled into `room.js`. A branch's rooms get a slider per stat in every Pokémon's tooltip, in a `keeps-open` section, and, just before turn 1 of their scrollback, one `\|raw\|` block of what the replay allows; hovering or clicking a range there opens where it came from, worded from that room's side. The Worker holds each inferred Pokémon's surviving set (`spreadPanel` in `engine.js`) and answers each slider move with the nearest spread still possible (`spreadMove`). A game of a best-of set opens with its surviving sets intersected with those of every other game of its set in the store (`combineSet` in `engine.js`, `combineGames` in `infer.mjs`, `engineering.md` §7.5): the block and the sliders say which games, and a range's sources list each game's turns. The combination lives with the branch, never in a recording. Nothing it does reaches the battle. |
| `replay-branch.js` | Replaced on the live replay site by `extension/src/replay-page.js`: that viewer is the new Preact one, with the turn on screen in `window.battle`. |
| `recordings.mjs` | IndexedDB on the extension's own origin (`extension/src/store.js`), behind a recordings page that imports, exports byte for byte, deletes, and opens at a turn. A recording of a game of a best-of set carries the set (`bestOf`), and the store finds every recording of one set for the page that opens a game (`set` in `background.js`, through `bridge.js`). |
| `browser.mjs`, `local-serve`, `provision-local-server`, `ws-admin`, `ws-player`, the `.bat` files | Gone. |
| `npm run battle` | Gone. Recording depends on `Config.logchallenges` on our own server. Real games come in through reconstruction, or through `/exportinputlog` if P9 passes. |

---

## 4. Step 0 — probe the live site

**The go/no-go.** Each probe names what it decides. Probe scripts are scratch and live outside
the repo (`CLAUDE.md`). Run by hand in DevTools, or from headless Chrome over the DevTools
protocol. P1–P8 send nothing to the server beyond the page's ordinary guest connection.

- [x] **P1 — which client is live.** `typeof app`, `typeof PS` on the default page.
      *Decides:* which choke point, and which prototypes `rng-panel.js` targets.
      **Result:** the old client. `/` loads `js/oldclient/client.js`; `app` has `receive` and
      `send`, and `PS` is undefined. The new client is served only at `/beta` and `/preactalpha`,
      and visiting it does not change what `/` serves. Build for the old client first.
- [x] **P2 — Content Security Policy.** Read the page's `Content-Security-Policy` header.
      *Decides:* where the simulator runs — in the page, in a blob Worker, or in an offscreen
      document behind messaging.
      **Result:** there is no policy. The document response has no `Content-Security-Policy`
      header and the page no CSP `<meta>`; a blob Worker starts, and `eval` and `new Function` run
      in the page. The simulator can run in the page or in a blob Worker.
- [x] **P3 — a fake room renders.** Produce a truncated recording's output locally with a scratch
      script over `truncate.mjs`, then feed it to `receive` as one `|init|battle` frame.
      *Pass:* the scene draws at turn N with the recorded HP, field and scrollback.
      **Result:** pass. `recordings/local/branched/gen9championsvgc2026regmb-200.log.json`, cut at
      turn 4 with a reseed, re-simulated in Node and split to p1's channel, went to `app.receive`
      in the shape `server/rooms.ts:2002` sends: `>roomid`, `|init|battle`, `|title|…`, then the
      scrollback. The room opens focused at turn 4 with own HP exact (Basculegion 155/195,
      Grimmsnarl 103/202), foe HP as the channel gives it (Blastoise 51%, Pelipper 100%), rain,
      Light Screen and the foe's Tailwind, and 84 log entries ending *Turn 4* / *The battle's RNG
      was reset.* `receive` builds the room through `joinRoom` with `nojoin`, so nothing is sent.
      On a fresh profile the site's consent dialog covers the page and takes every click until it
      is answered.
- [x] **P4 — controls work.** Feed a `|request|` for p1.
      *Pass:* the move buttons appear, and a click reaches the wrapped `send` as
      `/choose …|<rqid>` with nothing on the wire.
      **Result:** pass. The p1 `|request|` (rqid 13) draws the move buttons with Champions PP
      (Wave Crash 12/12, Aqua Jet 20/20) and the switch row. Mouse clicks on Wave Crash, then
      target Pelipper, then Light Screen reach `app.send` as `/choose move 1 2,move 2|13`
      addressed to the room, and no frame reaches the wire.
- [x] **P5 — nothing leaks.** Watch the WebSocket frames in the Network tab while clicking the
      timer, forfeit, hovering tooltips, closing the room and reloading.
      *Pass:* every frame addressed to the fake room is caught. The list of what the client
      tries to send is the shim's swallow list.
      **Result:** pass. With `app.send` wrapped from document start, no frame naming the room
      reached the socket, and a backstop on `WebSocket.prototype.send` had nothing left to catch.
      The rule is *names the room*, not *addressed to the room* — three of the entries are global
      commands with the room id in the text:
      - addressed to the room: `/choose …|<rqid>` and `/undo` (move buttons, *Cancel*), which go
        to the stream; `/timer on` (timer popup); `/forfeit` (forfeit popup); every chat line and
        typed command (`/me`, `/leave`, `/savereplay` tried)
      - global: `/noreply /leave <roomid>` (closing the tab); `/join <roomid>` (the URL router at
        boot, after a reload); `/cmd fullformat <roomid>` (*Rematch* after the battle ends — read
        from `client-battle.js`, not exercised)

      Hovering all 27 tooltips, the trainer names and the log, and opening the timer and
      battle-options popups send nothing. Reload raises the client's `beforeunload` prompt, as a
      real battle does. After it the router rebuilds an empty room at the URL and sends `/join`, so
      the shim has to be in place at `document_start`, and the extension has to rebuild the room
      from stored state or close it.
- [x] **P6 — hook names.** `BattleTooltips.prototype.showMoveTooltip`, `.showPokemonTooltip`,
      `.showTooltip`, `BattleRoom.prototype.updateControls` — or their new-client equivalents.
      *Decides:* how much of `rng-panel.js` moves as-is.
      **Result:** all four exist on the live page under these names, and so do the static
      `BattleTooltips.hideTooltip`, `BattleTooltips.elem` and `.parentElem`, `app.on` and
      `app.rooms` — everything `rng-panel.js` touches. Only its transport changes. The new client
      at `/beta` has the same three `BattleTooltips.prototype` methods, and `BattleRoom` beside
      `BattlePanel`.
- [x] **P7 — Champions display.** On a Champions Pokemon, tooltips show the 20 base PP cap
      (`engineering.md` §2.4) and Stat Point stats.
      *Decides:* whether the live client needs anything from us to show Champions correctly.
      **Result:** it needs nothing. The client keys on a `|tier|` containing `Champions`. Foe move
      PP follows the cap and matches the simulator — Hurricane (11/12), Tailwind (15/16), Dragon
      Pulse (11/12), where mainline would show 16, 24 and 16. Foe Speed ranges use the Stat Point
      formula — Pelipper 76–85–117–128, which is 0.9 × (65 + 20) up to 1.1 × (65 + 32 + 20) — and
      bracket every foe's real Speed. Own stats come from the request and equal the simulator's.
- [x] **P8 — replay endpoints.** What `replay.pokemonshowdown.com/<id>.json` and `.log` carry,
      and whether any replay carries an `inputlog`.
      *Decides:* whether some replays skip reconstruction.
      **Result:** no Champions replay skips reconstruction. `.json` carries `id, format, players,
      log, uploadtime, views, formatid, rating, private, password`; `.log` is the same log as
      text; both send `Access-Control-Allow-Origin: *`. An `inputlog` is served, in `.json` and at
      `/<id>.inputlog`, only for formats ending `randombattle`, `randomdoublesbattle`,
      `challengecup`, `challengecup1v1`, `battlefactory`, `bssfactory` or `hackmonscup`
      (`replay.pokemonshowdown.com/replays.lib.php:101`). Every other format gets
      `403 [access denied: not a random battle]`; 17 live Champions replays, Bo1 and Bo3, all do.
      The log is the spectator channel (`server/rooms.ts:2059-2062`): percentages, no `|split|`.
      Bo3 logs carry both `|showteam|` lines. Random-format input logs open with
      `>version a5df8274…`, the live server's commit and the one `package.json` pins. Two of the
      four saved Showdown replays in `recordings/showdown/` — the 24 Aug Bo3 pair — now return 404
      live, so a saved copy can be the only copy.
- [ ] **P9 — `/exportinputlog` on a public game.** *Plays a real battle on the public server,
      so it needs its own sign-off.* A battle between two of your own accounts, then
      `/exportinputlog`. The example config grants the permission to `+`, and battle players
      (`☆`) inherit `+` (`runtime/config/config-example.js`); the live server's own config is not
      in the checkout. Every other player must click consent
      (`runtime/server/chat-commands/core.ts:786`, `:822`).
      *Pass:* the input log arrives as `|html|` and re-simulates byte-identically under the
      bundled simulator.
      *Decides:* whether your own public games arrive with a full input log instead of through
      reconstruction, and whether the public server's simulator matches the bundled one.

P3, P4 and P5 together are the whole bet, and all three pass.

---

## 5. Steps after the probe

Each check runs the built extension in a throwaway Chrome against the live
play.pokemonshowdown.com, as a guest, and holds it to the Node reference:
`npm run extension -- --check <name>`.

| Step | Built as | Passes when | Result |
|---|---|---|---|
| **1. Simulator in the browser** | `pokemon-showdown` at the commit `package.json` pins, embedded whole (§3); `sim-worker.js`, 7.6 MB | every recording in `recordings/` re-simulates byte-identically in a page, as `npm run replay` does in Node | **Pass** (`sim`). All 22 re-simulate in the page's Worker exactly as in Node, the six `>rng` recordings included: the same input log, and the same debug log but for `\|t:\|` clock lines. |
| **2. The fake room** | `room.js`, a MAIN-world content script at `document_start`; the engine's `Session`, which answers as `RoomBattle` does; the per-side channel split; one tab, two rooms (§1) | a recording played forward from turn 4, both sides, yields an input log `verify-branch` accepts | **Pass** (`room`). Recording 200 is played from turn 4 to its end in both rooms by mouse clicks on the client's own buttons, forced switches and one Cancel included, and a reload mid-branch rebuilds both rooms at the same turn. `verify-branch`: VERIFIED. No WebSocket frame names a fake room. |
| **3. Entry points** | **Play from here** on replay.pokemonshowdown.com (`replay-page.js`); `reconstructReplay` in the Worker, with probe threads; the recordings page over IndexedDB | the S4 rung results in `engineering.md` §7.4 reproduce in the browser | **Pass** (`entry`). Bo3 game A is a MATCH over ten turns (about 1 s) and game B over six (1–3 s), with input logs byte-identical to `npm run reconstruct`'s. A recording imported through the page exports byte for byte and opens at turn 3 in a new play tab. Play from here on a live Champions replay rebuilds it with `--infer both` in about 15 s — as fast as Node — and branches at the turn on screen. Games A and B rebuilt again with p2's Stat Points inferred combine in the Worker exactly as in Node — Blastoise 535,418 spreads in game B alone, 181 with game A — keeping all six real spreads; a game with one item changed on its sheet, another set, or a game that did not rebuild is refused; and game B opened from the store opens combined with game A. |
| **4. RNG control** | `rng-command.js` in the Worker; `rng-panel.js` over `app.send` (§3) | every panel row arms and fires as it does under `npm run live` | **Pass** (`rng`). All 14 rows on p1's active Pokémon and their moves arm through the panel's own tooltips. After the turn, the rules that forced a draw, and every rule's matched and forced counts, are what Node gives for the same input log. `verify-branch`: VERIFIED. |
| **5. Packaging** | `extension/manifest.json`; the build copies the embedded code's MIT licences | loads unpacked on a clean Chrome profile with no Node installed | **Pass** (`package`). Manifest V3, 11 files, 7.7 MB; the only permission is `storage`. Every referenced file is present; there are no assets, no remote code and no client code. A copy outside the checkout, loaded into a new profile, opens a branch and plays a turn with no local server. Node is installed on this machine, but nothing at run time reaches it. |

Two things the checks rest on:
- Branded Chrome 137+ ignores `--load-extension`, so a check installs the build with DevTools
  `Extensions.loadUnpacked` over `--remote-debugging-pipe`.
- A tooltip carrying RNG controls stays up while the pointer is inside it, and it can cover the
  target row. A check steps the pointer off before its next click, as a person would.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| The live client changes under the extension | P1 and P6 re-run as a smoke check. Hooks fail loudly, never silently — a control that lies about what is live is worse than no control. |
| Upstream finishes moving to the new client | The shim is two functions per client; the prototype hooks are the real cost. Build for the old client first (P1); the new one already carries the same `BattleTooltips` methods (P6). |
| Bundled simulator drifts from the public server's | Matters for P9 input logs and for replay wording (`engineering.md` §6.2). Pin the bundle; `verify-branch` catches a diverging log. The live server's commit is readable from the `>version` line of any random-format replay's `/<id>.inputlog` (P8), so drift is checked by comparing that line with the pin. |
| Showdown staff object | Showdex is the precedent for an extension that augments the client. Stay free, non-commercial and supplementary (`plan.md` §14). |
| Reconstruction ceiling | `--infer both` reproduces 10 of 18 public replays (`engineering.md` §7.4); the extension inherits that unchanged. |

---

## 7. Where the code goes

In `extension/`, each part with its own row in the `CLAUDE.md` file table:
- `src/`: browser code, bundled by `npm run extension` (`scripts/local-extension.mjs`, `extension.bat`)
- `src/node/`: the Node stand-ins
- `check/`: the checks in §5
- `dist/`: the built extension, gitignored

`extension/README.md` covers building, loading and using it.
