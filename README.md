# Encoreable

*Replay the position, not the video.*

An analysis board for competitive Pokémon. Take a finished Showdown battle and pick any turn. You
get the **real Showdown battle interface** at that exact position, and play it forward choosing
moves for **both** sides, with the dice under your control. Where the replay hides the opponent's
build, Encoreable works out what the replay allows, and the simulator proves it.

Chess players have had this for decades. Pokémon players rewatch a video.

Built for Pokémon Champions VGC: `[Gen 9 Champions] VGC 2026 Reg M-C`, doubles.

## The Chrome extension

The same board on play.pokemonshowdown.com, with no local server.

```
npm install
npm run extension
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick
`extension/dist`. Node is needed only to build; the built folder runs on Chrome 111 or newer.

- **From a replay.** On replay.pokemonshowdown.com, pause at a turn and press **Play from here**.
  If your team is in this browser's teambuilder, your side uses it, Stat Points and all.
  Otherwise both sides' Stat Points are worked out from the replay.
- **A best-of-3.** Games of the same set combine automatically once they are all in your
  recordings: the Stat Points shown are what every game allows.
- **Playing.** A branch opens as two rooms, one per side. Hover a move or a Pokémon for the dice
  controls (crit, roll, hit or miss, secondary effects, speed ties). Hover a Pokémon for a Stat
  Point slider per stat, spanning only what the replay still allows. The battle log opens with
  every inferred range, and the turns that narrowed it.
- **Recordings.** The toolbar button opens the recordings page. Import any `.log.json`, pick a
  turn, press **Open**. **Export** gives back the exact file.

## Running it locally

Requires Node 22.18 or newer and Chrome or Edge. Run `npm install` once: it builds the pinned
Showdown, which takes about a minute. The battle UI is served from a clone of the Showdown client
in `vendor/pokemon-showdown-client`, built with `node build` (see Upstream).

| Command | What you get |
|---|---|
| `npm run battle` | A new battle in two browser windows, teams loaded, recorded when it ends |
| `npm run replay` | Proof that it reproduces exactly, and a replay page with a **Play from here** button |
| `npm run live -- --at 4` | That battle restored at turn 4, playable from both sides in the real UI |
| `npm run reconstruct -- --from <replay>` | A saved Showdown replay turned into a battle the commands above can use |
| `npm run stop` | Stops the local servers |

Each command has a `.bat` twin for double-clicking. Note the bare `--` in `npm run live -- --at 4`:
it tells npm the flags are for the script.

## How it works

Showdown's simulator records an **input log**: the RNG seed, both teams, and every choice. Feed it
to a fresh simulator and you get the same battle, byte for byte. Cut it off at turn N and you get
the position at turn N, which the server accepts as a live room. A replay from the site has no
input log, so Encoreable rebuilds one, choosing the dice and the hidden builds that reproduce the
replay line for line.

The simulator is never modified, and we write no damage, accuracy or turn-order logic of our own.
Showdown's is the only source of truth.

## Upstream

- **Pokémon Showdown server**, https://github.com/smogon/pokemon-showdown, MIT. Pinned in
  `package.json` to upstream commit `a5df827`.
- **Pokémon Showdown client**, https://github.com/smogon/pokemon-showdown-client, AGPLv3. Clone
  it into `vendor/pokemon-showdown-client` at commit `218cc779512d67961e8aea0ae666d319e8ccf398`
  and run `node build` there.

Neither is committed here.

Working on the code, or an agent? Read `AGENTS.md`.
