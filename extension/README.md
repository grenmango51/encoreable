# extension/

The analysis board as a Chrome extension: a recorded or replayed battle, restored to any turn
and played forward on both sides in the live play.pokemonshowdown.com client, with no Node and
no local server. How it works and what was proved is in `docs/extension.md`.

## Build and load

```
npm run extension                 build extension/dist/
npm run extension -- --check      build, then prove it against the Node reference
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → `extension/dist`.
Node is needed to build; the built folder runs on any Chrome 111 or newer without it.
esbuild comes in as a dependency of the pinned `pokemon-showdown`.

## Using it

- **From a replay.** On any Champions replay on replay.pokemonshowdown.com, pause at a turn
  and press **Play from here**. A new play tab rebuilds the battle from the replay and opens it
  at that turn. If your own team is in this browser's teambuilder, it is used for your side,
  Stat Points and all; otherwise both sides' Stat Points are worked out from the replay. Every
  rebuilt battle is kept as a recording.
- **A best-of-3.** Both players bring the same team, Stat Points and all, to every game of a
  set, so a game opens combined with every other game of its set already in your recordings:
  the sliders and the log's Stat Point block show only what all of those games allow. Open
  the games one after another and each one combines with the ones before; the banner says which
  went in, which did not and why, and when a replay names a later game you have not opened yet.
  A game is combined only when it is certainly the same set and the same team, and only when
  both games rebuilt line for line; one that did not is shown alone. Nothing combined is saved,
  so each recording keeps its own game's.
- **From a recording.** Click the extension's toolbar button for the recordings page. Import
  any `.log.json` (the files in `recordings/` work as they are), pick a turn, press **Open**.
  **Export** gives back the exact file; recordings cannot be regenerated, so export what matters.
- **Playing.** A branch opens as two rooms, one per side, each seeing only its own exact HP.
  Switch between them in the client's tab bar. Hover a move or a Pokémon for the RNG controls.
  A reload keeps the branch.
- **Stat Points.** Hover any Pokémon for a slider per stat. A Pokémon whose team was supplied
  sits fixed on its spread. One whose Stat Points were worked out from the replay spans only
  the values some spread the replay leaves still has, so the slider skips any value none has.
  Moving one slider moves the others to the nearest spread still possible with it; the dark
  part of a track is how far it goes with nothing else moving. The sliders open on the most
  likely spread: the most the nature's raised stat can have, then the most HP, then the most
  for the weaker defence (when the raised stat is Attack, Special Attack or Speed) or the
  stronger attack (when it is a defence). **Reset** goes back there. The sliders never change
  the battle; the spread it runs on is printed under them, with a warning when the other games
  of its set rule that spread out.
  The battle log opens, just before turn 1, with **Stat Points the replay allows**: a table of
  every inferred Pokémon's ranges, bold where the replay narrowed them. Hover a range for the
  turns it came from, or a name for everything learned about that Pokémon and how many spreads
  are left; click to keep the box open. Where the replay narrowed which HP goes with which
  Defence or Special Defence, the box ends with those pairings as grids. Each of the two rooms
  says it from its own side — "your Raichu", "the opposing Raichu" — so a mirror match stays
  readable. A combined game says so in the block's title and over the sliders — **Stat Points
  games 1 and 2 of this set allow** — and lists each game's turns under it: "Game 1, turn 3".
  A recording rebuilt before these were kept with it shows no sliders for that side.

## What is where

| Path | What it is |
|---|---|
| `manifest.json` | The Manifest V3 manifest. |
| `src/room.js` | The fake room: hooks `app.send`, runs branches in the Worker, feeds each side its room. |
| `src/spread-panel.js` | The Stat Point sliders in a branch's tooltips and the notes in its log; bundled into `room.js`. |
| `src/engine.js`, `src/worker.js` | The simulator Worker: branches, `/rng`, reconstruction. |
| `src/cjs.js` | Runs the embedded simulator's CommonJS files as Node would. |
| `src/node/` | Browser stand-ins for the Node built-ins the reused `scripts/lib` code imports. |
| `src/bridge.js` | Carries messages between the page scripts and the service worker. |
| `src/replay-page.js` | The **Play from here** button on replay.pokemonshowdown.com. |
| `src/background.js`, `src/store.js` | The service worker and the recordings store (IndexedDB). |
| `src/recordings.html`, `src/recordings.js` | The recordings page. |
| `check/` | The checks behind `--check`: `sim`, `room`, `entry`, `rng`, `package`. |
| `dist/` | The built extension. Generated, gitignored. |

`scripts/client/rng-panel.js` is shipped as it is; so are the `scripts/lib` modules the engine
imports, and `scripts/server/rng-command.js`, which the Worker runs in place of the server.
