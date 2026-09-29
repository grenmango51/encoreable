# Your games, closed team sheets

Your games against someone else, where the replay carries no `|showteam|`, which is every Bo1
ladder game. Your own side is known exactly. The other side's item, ability, nature and unrevealed
moves are unknown as well as its Stat Points, so its sets are read off the log
(`docs/engineering.md` §7.6).

**Goes here:** a replay page from such a game, under the name the site gave it. Your sheet for that
game goes in `scripts/fixtures/teams.js` if no set there matches it yet, and the row below names it.
Run it with `npm run reconstruct -- --from <file> --teams <set> --infer <their side>`.

## Contents

| File | Game | Your side | Notes |
|---|---|---|---|
| `Gen9ChampionsVGC2026RegMB-2026-08-07-mercifulbird-cundangcap.html` | Reg M-B Bo1, rated ladder, MercifulBird against you, 5 turns | p2, the same six as in `../full-sheets/`; `alt` holds their sheet from the 24 August Bo3, which may differ from this game's | MercifulBird's Gardevoir outspeeds your Charizard-Mega-Y on turn 1, which no neutral-nature, itemless spread allows (`docs/engineering.md` §7.6) |
| `Gen9RandomBattleBlitz-2026-08-07-briishslayer-cundangcap.html` | Random Battle (Blitz), singles, rated, 23 turns | p2 | Off-format, kept as the negative case |
