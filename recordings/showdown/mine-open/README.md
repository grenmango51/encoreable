# Your games, open team sheets

Your games against someone who did not share their full sheet, where the replay carries a
`|showteam|` line per side: species, item, ability and moves, but no Stat Points. Your own side is
known exactly, so the other side's Stat Points are the one thing to infer, and your side stays a
check on everything else.

**Goes here:** a replay page from such a game, under the name the site gave it. Your sheet for that
game goes in `scripts/fixtures/teams.js` if no set there matches it yet, and the row below names it.
Run it with `npm run reconstruct -- --from <file> --teams <set> --infer <their side>`.

## Contents

None yet.

| File | Format | Your side | Your sheet | Notes |
|---|---|---|---|---|
