# Showdown replays

Replay pages saved from play.pokemonshowdown.com (the browser's "Save page as", `.html`). These are
the only battles here that our server did not run, so they are the only ones where full
information is **not** available: HP arrives as a percentage, there is no seed, and the input log
needs both players' consent to export (`docs/engineering.md` §1). They are the input to
`npm run reconstruct -- --from <file>` (rung S4) and the test material for the public-ladder path.

Do not delete one expecting to download it again: its owner can take a replay down.

**Goes here:** keep the name the site gives the download,
`<Format>-<date>-<player 1>-<player 2>.html`. A browser adds ` (1)` to a second download with the
same name; that is a different game of the same set, not a duplicate.

## Which folder

Two things decide it: whether you played in it, and how much of each team you know.

| Folder | Players | What is known | Reconstruct with |
|---|---|---|---|
| `full-sheets/` | you and a friend who shared their sheet | both complete sheets, Stat Points included | `--teams <fixture>` holding both sheets; `--infer` to grade inference against the truth |
| `mine-open/` | you and anyone else | your complete sheet; theirs from `\|showteam\|`, without Stat Points | `--teams <fixture>` for your side, `--infer` for theirs |
| `mine-closed/` | you and anyone else | your complete sheet; theirs only from what the battle shows | the same, and their sets are read off the log (`docs/engineering.md` §7.6) |
| `others-open/` | two other players | both teams from `\|showteam\|`, no Stat Points | `--infer both` |
| `others-closed/` | two other players | only what the battle shows | `--infer both`, sets read off the log |

A replay has open team sheets when it carries a `|showteam|` line per side. Bo3 formats publish
them, and Bo1 ladder games do not. Complete sheets live in `scripts/fixtures/teams.js`; `--teams`
names the set, and it goes to whichever side its species match.
