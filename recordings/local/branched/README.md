# Branched battles

Battles restored from another recording at turn N with `npm run live` and played on from there.
The input log is the original's up to turn N, a `>reseed` with the continuation seed, `>player`
lines **with no team** (the players rejoining the live room), then the new choices. Check one against its source with
`npm run live -- --from <source> --at <N> --verify <this file>`.

**Goes here:** `npm run replay -- --from <its file in runtime/logs>` files it here, or copy it in
by hand and add a row below.

**Known problem:** `npm run replay -- --from` fails on every file here with
`Cannot read properties of null (reading 'find')`. `unpackFromInputLog` in
`scripts/local-replay.mjs` reads the teamless rejoin line as that side's team. `npm run live` and
`npm run reconstruct` read these files fine.

## Contents

| Recording | Branched from | At turn | Turns | Notes |
|---|---|---|---|---|
| `…-46` | `../scripted/…-34` | 4 | 4 | The only one with no `>reseed` line, and only p1 rejoins |
| `…-69` | `../scripted/…-34` | 3 | 4 | |
| `…-144`, `-145` | `../scripted/…-34` | 4 | 4 | Players renamed `Ghosts9102X` / `Boom9102X`; `>rng force` lines force a crit and max damage on Whimsicott's Moonblast into Incineroar |
| `…-199` | `../../reconstructed/reconstructed-…-cundangcap-hoaianhgianlan` | 6 | 7 | Ends in a forfeit |
| `…-200` | `../../reconstructed/reconstructed-…-cundangcap-hoaianhgianlan` | 8 | 8 | Ends in a forfeit |
