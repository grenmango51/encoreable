# Scripted battles

Battles `npm run replay` played through the real server: `Ghosts<n>` (p1) against `Boom<n>` (p2),
on the `fixture` teams in `scripts/fixtures/teams.js`, every move picked by the policy in
`scripts/local-replay.mjs` (`--fight` for the longer one that trades damage instead of exploding).
Nobody decided anything in these. They are the determinism proof's by-product and most of the
S1–S3 test set.

**Goes here:** nothing by hand. `npm run replay` copies each battle it plays in here.

## Contents

| Recording | Turns | Notes |
|---|---|---|
| `…-23` | 8 | The simulator refuses its own input log, a Memento with no target (`docs/engineering.md` §6.1), so S3 holds it against a two-turn stub |
| `…-24`, `-26`, `-48`, `-70`, `-71`, `-75`, `-78`, `-79` | 2 | |
| `…-25`, `-34`, `-76` | 5 | `-34` is the source of four battles in `../branched/` |
| `…-100`, `-111`, `-122` | 5, 4, 6 | Played under the retired `>eval` RNG controller, which wrote `\|-message\|#rng` lines into the log; `battleLines` drops them |
