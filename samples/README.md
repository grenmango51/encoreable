# Sample replays

Replay pages downloaded from `play.pokemonshowdown.com`. Nothing in the repo reads them;
they are kept as test material.

**Why they matter:** these are the only battles here where full information is *not*
available. Every battle under `recordings/` was played on our own server, so its input
log — exact stats, exact HP, the seed — is ours to read. A public replay is someone
else's battle: the HP arrives as percentages and the input log needs both players'
consent to export (`ENGINEERING.md` §1).

So this folder is the fixture set for the deferred public-ladder path: reconstructing a
position from the plain protocol log alone, with no seed and no exact stats. Do not
delete them expecting to re-download — a replay can be taken down by its owner.

| File | Format |
|---|---|
| `Gen9ChampionsVGC2026RegMB-2026-08-07-mercifulbird-cundangcap.html` | Champions VGC Reg M-B, doubles — the target ruleset |
| `Gen9ChampionsVGC2026RegMBBo3-2026-08-24-cundangcap-hoaianhgianlan.html` | Reg M-B Bo3, game ending turn 6 |
| `Gen9ChampionsVGC2026RegMBBo3-2026-08-24-cundangcap-hoaianhgianlan (1).html` | Reg M-B Bo3, a different game of the same set, ending turn 10 |
| `Gen9RandomBattleBlitz-2026-08-07-briishslayer-cundangcap.html` | Random Battle — off-format, useful as a negative case |

The `(1)` suffix is a browser download artifact, not a duplicate: the two Bo3 files are
different games from the same set.
