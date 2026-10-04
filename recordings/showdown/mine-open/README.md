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

| File | Game | Your side | Your sheet | Notes |
|---|---|---|---|---|
| `gen9championsvgc2026regmcbo3-2692546803.json` | Reg M-C Bo3 against Illumina_ProfTipl, game 1, 2026-10-04 | p2 | `mc-sun` | Won in 5 turns. Spectator view. `--infer p1`: MATCH in 10 s |
| `gen9championsvgc2026regmcbo3-2692547671.json` | the same set, game 2 | p2 | `mc-sun` | Lost in 8 turns. Spectator view. `--infer p1`: MATCH in 30 s |
| `gen9championsvgc2026regmcbo3-2692548771.json` | the same set, game 3 | p2 | `mc-sun` | Won in 10 turns. Spectator view. `--infer p1`: MATCH in 32 s |
