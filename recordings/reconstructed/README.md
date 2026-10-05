# Reconstructed battles

Input logs `npm run reconstruct` rebuilt from a replay page in `../showdown/` (rung S4) or from a
battle in `../local/` (rungs S1–S3), plus team sheets. **Not played here:** the choices are
transcribed, the dice are chosen rather than rolled, and the opponent's HP is sampled from inside
the percentage the replay shows (`docs/engineering.md` §7). Each file carries `"reconstructed": true`
and `reconstructedFrom`, and every command that loads one says so. Where a side's Stat Points were
inferred, they are one spread the replay allows, not the real ones. A game of a best-of set also
carries `bestOf`, the set it belongs to, so another game of the set can be combined with it
(`--with`, `docs/engineering.md` §7.5).

A reconstruction reproduces its source line for line. It is a faithful reading of that battle, not
a record of one this server ran, so it is never ground truth for testing reconstruction itself:
`npm run reconstruct -- --all` leaves this folder out.

**Goes here:** only what `npm run reconstruct -- --from <source>` writes, as
`reconstructed-<source name>.log.json`. The prefix keeps a reconstruction of `local/…-34` from
colliding with `…-34` itself. `--dry-run` and `--all` write nothing, and `--out <file>` writes
somewhere else. Running the command again on the same source rebuilds the file.

## Contents

| File | Source | Rung | Result | Sheets |
|---|---|---|---|---|
| `reconstructed-Gen9ChampionsVGC2026RegMBBo3-2026-08-24-cundangcap-hoaianhgianlan.log.json` | `../showdown/full-sheets/`, game A of the Bo3 | S4 | every one of 10 turns matches, sample seed 1 | both from `--teams alt`, none inferred |

`../local/branched/…-199` and `-200` are branches of it.
