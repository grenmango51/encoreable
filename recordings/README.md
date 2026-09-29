# Recordings

Every battle this project keeps, sorted by how it was made. The folder a file sits in says what
is known about that battle and which commands can read it, so a wrong folder is a wrong
assumption waiting to happen. Every folder has its own README with what belongs there and what
is in it.

## Where a new file goes

Answer these in order and stop at the first yes.

1. **Is it a video?** → `video/`, then `tournament/` for a broadcast or `champions/` for a capture
   from Pokémon Champions itself.
2. **Is it a replay page saved from play.pokemonshowdown.com (`.html`)?** → `showdown/`:

   | | Open team sheets (`\|showteam\|` in the replay) | Closed team sheets |
   |---|---|---|
   | **You played in it** | `showdown/mine-open/` | `showdown/mine-closed/` |
   | **Two other players** | `showdown/others-open/` | `showdown/others-closed/` |

   If you hold **both** players' complete sheets, Stat Points included — a game against a friend
   who shared theirs — it goes in `showdown/full-sheets/` instead, whatever the replay shows.
3. **Did `npm run reconstruct` build it?** → `reconstructed/`. The command writes it there.
4. **Otherwise it is a `.log.json` our own server wrote** → `local/`, by who chose the moves:

   | Who chose the moves | Folder | Made by |
   |---|---|---|
   | It was restored from another recording at some turn and played on | `local/branched/` | `npm run live` |
   | Code, the fixed script | `local/scripted/` | `npm run replay` |
   | Code, built to test one effect | `local/probes/` | a test or probe script |
   | You, on both sides | `local/self-play/` | `npm run battle` |

   Branched wins over the rest: a scripted battle restored at turn 4 and played on is branched.

## What each kind gives you

| Folder | Form | Seed and exact HP | Team sheets | Read by |
|---|---|---|---|---|
| `local/` | `.log.json` with the input log | yes | both, exact | `live`, `replay --from`, `reconstruct --rung s1`–`s3`, `reconstruct --all` |
| `reconstructed/` | `.log.json` with a rebuilt input log | dice chosen, opponent HP sampled | as supplied or inferred | `live`, `replay --from` |
| `showdown/` | `.html` replay page | no seed, HP as a percentage | depends on the folder | `reconstruct --from` (rung S4) |
| `video/` | video file | no | no | nothing yet |

## How the commands find them

The server writes every finished battle to `runtime/logs/`, but `runtime/` is generated —
`provision-local-server.mjs` rebuilds it from `node_modules/pokemon-showdown`, and deleting it to
reset the server is routine. So a battle worth keeping is copied in here, which is tracked.

- Commands looking for "the newest battle" search every `.log.json` in here, at any depth, and in
  `runtime/logs/`. On a name collision the copy in here wins.
- `npm run replay` copies each battle it reads out of `runtime/logs/` into the right `local/`
  folder (`scripts/lib/recordings.mjs` `localFolderFor`). A file already in here stays where it is.
- `npm run reconstruct -- --all` runs over every battle in `local/` and leaves `reconstructed/` out.

The file name is the identity: keep the name the server or the site gave a file.
