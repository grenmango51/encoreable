# Your games, closed team sheets

Your games against someone else, where the replay carries no `|showteam|`: a Bo1 game in which
Open Team Sheets was declined (the replay still prints the request, `|uhtml|otsrequest|`). Your own
side is known exactly. The other side's item, ability, nature and unrevealed moves are unknown as
well as its Stat Points, so its sets are read off the log (`docs/engineering.md` §7.6).

**Goes here:** a page downloaded from the battle room, under the name the site gave it, or a
replay link's `.json` under the link's id (`../README.md`). Your sheet for that game goes in
`scripts/fixtures/teams.js` if no set there matches it yet, and the row below names it.
Run it with `npm run reconstruct -- --from <file> --teams <set> --infer <their side>`.

## Contents

The Notes give each game's rebuild with the sets read off the log and the rest assumed — no item,
the first ability listed, a neutral nature — and, where it stops, the first line it gets wrong. That
is the baseline `docs/closed-sheet-plan.md` starts from.

| File | Game | Your side | Your sheet | Notes |
|---|---|---|---|---|
| `Gen9ChampionsVGC2026RegMB-2026-08-07-mercifulbird-cundangcap.html` | Reg M-B Bo1, rated ladder, MercifulBird against you, 5 turns | p2, the same six as in `../full-sheets/` | `alt`, from the 24 August Bo3, which may differ from this game's | MercifulBird's Gardevoir outspeeds your Charizard-Mega-Y on turn 1, which no neutral-nature, itemless spread allows (`docs/engineering.md` §7.6) |
| `Gen9RandomBattleBlitz-2026-08-07-briishslayer-cundangcap.html` | Random Battle (Blitz), singles, rated, 23 turns | p2 | — | Off-format, kept as the negative case |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-cundangcap-ivancongb.html` | Reg M-C Bo1, rated, against ivan congb, 2026-10-04, won in 5 turns | p1 | not supplied yet: Kingambit, Salamence, Sneasler, Raichu, Rillaboom, Arcanine-Hisui | Not rebuilt until the sheet is in `teams.js` |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-cundangcap-mintri.html` | Reg M-C Bo1, rated, against mintri, won in 7 turns | p1 | not supplied yet: the same six | Not rebuilt until the sheet is in `teams.js` |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-popcorntofuman-cundangcap.html` | Reg M-C Bo1, rated, against popcorntofuman, won in 6 turns | p2 | `mc-rain` | PARTIAL, through turn 1: turn 2 opens with their Gardevoir's Mega Evolution, not reproduced. Their Zoroark (Illusion) is in the game |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-cundangcap-notafred.html` | Reg M-C Bo1, rated, against not_a_fred, won in 8 turns: they forfeited | p1 | `mc-rain` | PARTIAL, through turn 1: your Farigiraf's HP on turn 2, `152/227` |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-pokejackxy-cundangcap.html` | Reg M-C Bo1, rated, against PokeJackxy, won in 4 turns: they forfeited | p2 | `mc-sun` | MATCH in 5 s |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-cundangcap-elias6548.html` | Reg M-C Bo1, rated, against elias6548, won in 5 turns | p1 | `mc-sun` | PARTIAL, through turn 2: your Incineroar's HP on turn 3, `75/202` |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-gumbi0-cundangcap.html` | Reg M-C Bo1, rated, against Gumbi0, won in 18 turns: they forfeited | p2 | `mc-perish` | PARTIAL, through turn 4 |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-drazzelhq-cundangcap.html` | Reg M-C Bo1, rated, against drazzelhq, won in 13 turns: they forfeited | p2 | `mc-perish` | PARTIAL, through turn 0: your Rillaboom's HP on turn 1, `176/207` |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-pokescilabbot-cundangcap.html` | Reg M-C Bo1, rated, against PokeSciLabBot, won in 7 turns | p2 | `mc-sand` | PARTIAL, through turn 0: their Sneasler is assumed to have Pressure, its first ability, which announces itself on switch-in (`\|-ability\|p1a: Lab2\|Pressure`); the replay has no such line, so it has Unburden or Poison Touch |
| `Gen9ChampionsVGC2026RegMC-2026-10-04-cundangcap-laaaa16.html` | Reg M-C Bo1, rated, against laaaa16, won in 6 turns | p1 | `mc-sand` | PARTIAL, through turn 1: your Salamence's HP on turn 2, `6/171` |
