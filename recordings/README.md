# Recordings

Finished battles, as the server wrote them. Each `.log.json` carries the **input log** —
the seed, both packed teams, and every choice — which is everything needed to reproduce
the battle exactly and to branch it at any turn.

These are the `--from` input to `npm run live`.

A file named `reconstructed-*.log.json` was **not** played here. `npm run reconstruct` built
it from a public-ladder replay and both team sheets, so its choices are transcribed and its
dice are chosen rather than rolled (`ENGINEERING.md` §7). It carries `"reconstructed": true`,
and every command that loads one says so. It reproduces the replay it came from line for line;
it is not a record of the game the server played.

## Why they live here

The server writes battles to `runtime/logs/`, but `runtime/` is generated —
`provision-local-server.mjs` rebuilds it from `node_modules/pokemon-showdown`, and
deleting it to reset the server is a normal thing to do. Recordings cannot be
regenerated, so `npm run replay` copies each one here, outside the generated tree
and tracked in git.

Both directories are searched when a command looks for "the newest battle". On a name
collision the copy in here wins.

## Adding one

`npm run battle` records a new battle and it lands in `runtime/logs/`. `npm run replay`
archives it here. To archive by hand, copy the `.log.json` in — the file name is the
identity. `npm run reconstruct` writes here too, under the `reconstructed-` prefix.
