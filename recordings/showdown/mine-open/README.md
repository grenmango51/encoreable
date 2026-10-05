# Your games, open team sheets

Your games against someone who did not share their full sheet, where the replay carries a
`|showteam|` line per side: species, item, ability and moves, but no Stat Points. Your own side is
known exactly, so the other side's Stat Points are the one thing to infer, and your side stays a
check on everything else.

**Goes here:** a replay link's `.json` — the link with `.json` appended — saved as it comes, under
the link's id (`gen9championsvgc2026regmcbo3-2692546803.json`); or a page downloaded from the
battle room, under the name the site gave it. A link is the spectator's view, both sides as
percentages; the battle room's download shows your own HP exactly, so it gives the inference more
when you have it. Your sheet for that game goes in `scripts/fixtures/teams.js` if no set there
matches it yet, and the row below names it.
Run it with `npm run reconstruct -- --from <file> --teams <set> --infer <their side>`.

## Contents

Every game here rebuilds line for line under `--infer`; `npm run reconstruct -- --saved` reruns them all.
The Notes name what each game tests.

| File | Game | Your side | Your sheet | Notes |
|---|---|---|---|---|
| `gen9championsvgc2026regmcbo3-2692546803.json` | Reg M-C Bo3 against Illumina_ProfTipl, game 1, 2026-10-04 | p2 | `mc-sun` | Won in 5 turns. Spectator view. `--infer p1`: MATCH in 10 s |
| `gen9championsvgc2026regmcbo3-2692547671.json` | the same set, game 2 | p2 | `mc-sun` | Lost in 8 turns. Spectator view. `--infer p1`: MATCH in 30 s |
| `gen9championsvgc2026regmcbo3-2692548771.json` | the same set, game 3 | p2 | `mc-sun` | Won in 10 turns. Spectator view. `--infer p1`: MATCH in 32 s |
| `gen9championsvgc2026regmcbo3-2692552735.json` | Reg M-C Bo3 against good pov, game 1, 2026-10-04 | p2 | `mc-rain` | Won in 6 turns. Spectator view. `--infer p1`: MATCH in 20 s |
| `gen9championsvgc2026regmcbo3-2692553871.json` | the same set, game 2 | p2 | `mc-rain` | Won in 8 turns, the set 2–0. Spectator view. `--infer p1`: MATCH in 30 s. Mega Kangaskhan's two-hit Double-Edge recoil narrows their Sneasler's HP |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-voltch4mp1on-cundangcap.html` | Reg M-C Bo3 against VoltCh4mp1on, game 1 | p2 | `mc-perish` | Won in 7 turns: VoltCh4mp1on forfeited. Your view. `--infer p1`: MATCH in 6 s. The only game of the set downloaded |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-grizzlemunch-cundangcap.html` | Reg M-C Bo3 against Grizzlemunch, game 1 | p2 | `mc-sand` | Lost in 11 turns. Your view. `--infer p1`: MATCH in 38 s |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-grizzlemunch-cundangcap (1).html` | the same set, game 2 | p2 | `mc-sand` | Lost in 6 turns, the set 0–2. Your view. `--infer p1`: MATCH in 8 s. Sandstorm hits their Milotic before their Rillaboom: an order between two hidden Pokemon |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-vicarina22-cundangcap (1).html` | Reg M-C Bo3 against Vicarina22, **game 1** | p2 | `mc-sand` | Lost in 11 turns. Your view. `--infer p1`: MATCH in 17 s. Rotom eats a Chesto Berry asleep after Rest |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-vicarina22-cundangcap.html` | the same set, **game 2** | p2 | `mc-sand` | Won in 4 turns: Vicarina22 forfeited. Your view. `--infer p1`: MATCH in 6 s. No game 3 downloaded |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-cundangcap-noob13032.html` | Reg M-C Bo3 against noob13032, game 1 | p1 | `mc-sand` | Lost in 11 turns. Your view. `--infer p2`: MATCH in 7 s. Their Gholdengo switches out before your Tyranitar at the start of turn 8 |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-cundangcap-noob13032 (1).html` | the same set, game 2 | p1 | `mc-sand` | Won in 9 turns: noob13032 forfeited at the start of turn 9. Your view. `--infer p2`: MATCH in 13 s, the forfeit included |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-cundangcap-noob13032 (2).html` | the same set, game 3 | p1 | `mc-sand` | Lost in 6 turns, the set 1–2. Your view. `--infer p2`: MATCH in 15 s |

| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-cundangcap-krapfenallacream (1).html` | Reg M-C Bo3 against krapfenallacream, **game 1** | p1 | `mc-perish` | Lost in 10 turns. Your view. `--infer p2`: MATCH in 37 s. Their Garchomp Mega Evolves (to Garchomp-Mega-Z) before your Gengar on turn 1 |
| `Gen9ChampionsVGC2026RegMCBo3-2026-10-04-cundangcap-krapfenallacream.html` | the same set, **game 2** | p1 | `mc-perish` | Lost in 14 turns, the set 0–2. Your view. `--infer p2`: MATCH in 14 s. The same two Mega Evolutions; on turn 5 your Politoed's Encore makes their Incineroar use Fake Out again |

A browser numbers downloads in the order they were saved, not the order they were played: the
Game column is the game number the replay itself prints (`|uhtml|bestof|`).
