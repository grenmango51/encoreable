# Encoreable

*Replay the position, not the video.*

An analysis board for competitive Pokémon. Take a finished battle, pick any turn, and get
the **real Showdown battle interface** sitting at that exact position — then play forward,
choosing moves for **both** sides.

Chess players have had this for decades. Pokémon players rewatch a video.

Target ruleset is **Pokémon Champions VGC** (`[Gen 9 Champions] VGC 2026 Reg M-B`), doubles.

---

## Requirements

- **Node 22 or newer.** On this machine Node lives at `C:\Program Files\nodejs\node.exe`
  and is **not** on the PATH. Before using a terminal:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + $env:Path
  ```
- **A Chromium browser** — Chrome or Edge. Two windows get opened side by side.
- `npm install`, once.

---

## Running it

Every command starts the local server and client host itself if they are not already up.
The `.bat` files are double-click equivalents that need no terminal.

| Command | Double-click | What you get |
|---|---|---|
| `npm run live` | `live.bat` | **The product.** A recorded battle, restored to a turn, playable from both sides in the real UI. |
| `npm run battle` | `battle.bat` | Record a new battle. Two browser windows, teams pre-loaded, challenge auto-issued. |
| `npm run replay` | `replay.bat` | The determinism proof: play, re-simulate, diff, render a replay page. |
| `npm run reconstruct` | `reconstruct.bat` | Turn a saved ladder replay plus both team sheets into a battle the other commands can use. |
| `npm run stop` | — | Kill the servers. |
| `npm run check` | — | Verify the server binds to loopback and the format loads. |
| `npm run serve` | — | The static client host on its own (rarely needed directly). |

**Start here:**

```
npm run battle          record a game
npm run replay          prove it reproduces exactly, and get a replay page
npm run live -- --at 4  play it forward from turn 4
```

The replay page from `npm run replay` carries a **Play from here** button, which does the
same thing as `npm run live` for whichever turn is on screen.

Shared flags: `--from <log.json>`, `--no-open`, `--verbose`, `--embed <url>`.
`npm run live` also takes `--at <turn>`, `--dry-run`, `--verify <log.json>`.
`npm run reconstruct` takes `--all`, `--rung s1|s2|s3`, `--teams <key>`, `--sample <n>`,
`--max-probes <n>`, `--dry-run`.

> Note the bare `--` in `npm run live -- --at 4`. It tells npm the flags are for the
> script, not for npm. `live.bat --at 4` needs no such thing.

---

## Layout

| Path | What it is |
|---|---|
| `scripts/local-*.mjs` | The entry points — one file per command in the table above. |
| `scripts/lib/` | Shared machinery: truncation, RNG control, protocol diffing, the WebSocket clients, the browser launcher. |
| `scripts/client/` | Scripts that run **in the browser**, served over HTTP — not runnable with `node`. |
| `scripts/fixtures/` | The two fixture teams, as export text. |
| `recordings/` | Finished battles with their input logs. Tracked — these cannot be regenerated. |
| `samples/` | Public-ladder replays. The input to `npm run reconstruct`, and its test material. |
| `replays/` | Rendered replay pages. Generated output, gitignored. |
| `runtime/` | The local Showdown server. **Generated** from `node_modules` — safe to delete. |
| `vendor/` | A clone of the upstream Showdown *client*. Only `play.pokemonshowdown.com/` is used, to serve the real battle UI. |

`.js` versus `.mjs` is not decoration: `.mjs` is a Node ES module, `.js` under
`scripts/client/` is browser code, and `.js` under `scripts/fixtures/` is Node CommonJS.

---

## Documentation

| Doc | Question it answers |
|---|---|
| `PLAN.MD` | Why we are building this — premise, scope guards, landscape, risks. |
| `ENGINEERING.md` | How it works, what is proven, and what breaks. The engineering reference. |
| `BRANCHING.md` | How a recorded battle becomes a playable position, from either entry point. |
| `CLAUDE.md` | Where a new file goes. Read it before adding one. |

---

## How it works, in four sentences

Showdown's simulator records an **input log** — the RNG seed, both packed teams, and every
choice either player made. Feed that log back into a fresh simulator and you get the same
battle, byte for byte. Cut the log off at turn N and you get the position at turn N, which
the server will accept as a *live room* via `/importinputlog`. Two browser windows join it,
one per side, and the battle carries on from there.

The simulator is never modified. We do not write damage, accuracy, or turn-order logic —
Showdown's is the only source of truth. See the scope guards in `PLAN.MD` §3.

---

## Upstream references

**Pokémon Showdown server** — https://github.com/smogon/pokemon-showdown
Version pinned in `package.json` (`0.11.11`). MIT.
Pin it deliberately: `ENGINEERING.md` §6.5 is the register of internal call sites this project
depends on that upstream does not promise to keep. On any upgrade, diff those and re-run
`npm run replay` **and** `npm run reconstruct -- --all --rung s2`, which exercises the rest.

**Pokémon Showdown client** — https://github.com/smogon/pokemon-showdown-client
Commit `218cc779512d67961e8aea0ae666d319e8ccf398`, built with `node build`.
AGPLv3 — see `vendor/pokemon-showdown-client/LICENSE`.

Neither is committed here; both are gitignored and re-fetchable.
