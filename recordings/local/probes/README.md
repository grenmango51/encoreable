# Probe battles

Battles a test or probe script built on purpose to exercise one effect — a move, ability, item or
field effect from `docs/evidence-catalog.md` — on a spread chosen so the answer is known. The
script itself is scratch and lives in the session scratchpad. Only a battle worth keeping as a test
comes here.

**Goes here:** copy the `.log.json` out of `runtime/logs/`, keep its name, and add a row below.
`npm run replay` never files anything here.

## Contents

Each is a Reg M-C doubles battle, `gen9championsvgc2026regmc-<n>.log.json`, with p2 hidden, built
from the table in
`docs/open-sheet-plan.md` §4 Phase 6. A probe passes when
`npm run reconstruct -- --from <file> --rung s3 --infer p2 --certify --outside` is a MATCH, every
real spread survives, every range is at least as narrow as the last column says, and no
`--outside` rebuild reproduces the log (§3.2). The last column is what the rebuild proves at the
commit that added the row; a hook added later only narrows it. A `?` marks an end no `--certify`
rebuild proved possible. Spreads are Stat Points in the order HP / Atk / Def / SpA / SpD / Spe.
Most turns carry `>rng force nocrit any` and some `hit any` or `noproc any`, so a crit, a miss or
a flinch does not knock the script off course.

| Recording | Effects it tests | Spread of each hidden Pokemon | What the inference must conclude |
|---|---|---|---|
| `…-1` chip and heal | Super Fang from full on Clefable and Toxapex; Stealth Rock on four switch-ins (Volcarona's at a half, the rest at an eighth); Sandstorm from Tyranitar; Leftovers; Moonlight with no weather and in sand; Recover; Regenerator (Toxapex out on turn 4, back in on turn 5). 6 turns, p2 forfeits | Clefable 21/0/14/3/28/0 Bold, Leftovers · Toxapex 27/0/30/0/9/0 Bold · Volcarona 11/0/5/25/0/25 Modest · Corviknight 30/4/13/0/19/0 Impish | Clefable HP: exactly 21, through Super Fang from 50/100, Moonlight from 38/100, Leftovers and sand; Def 7–14? (Rock Slide, two Crunches); SpA 0–18 (Moonblast into Garchomp); Spe 0–1 (Tyranitar moved first). Toxapex HP 25–27 (Super Fang, Recover, sand, the Regenerator switch-in); Atk 0–5 (Liquidation into Tyranitar); Def 14–32; Spe 0–26? (sand order). Volcarona HP 3–31 and Corviknight nothing: Stealth Rock and sand are still read as a band, not re-run per candidate |
| `…-12` thresholds | Focus Sash on Alakazam (Kowtow Cleave from full); Oran Berry on Golisopod at exactly the half (Super Fang from full); Emergency Exit (a second Super Fang leaves Golisopod under the half and Drampa comes in); Berserk twice and Sitrus Berry at the half on Drampa; Endure on two turns running, the second announced under Kowtow Cleave; Sturdy on Aggron (Low Kick from full). 5 turns, p2 forfeits | Alakazam 9/0/0/27/0/30 Timid, Focus Sash · Golisopod 14/28/10/0/14/0 Adamant, Oran Berry · Drampa 13/0/5/27/21/0 Modest, Sitrus Berry · Aggron 22/30/14/0/0/0 Adamant, Lum Berry | Golisopod HP 0–16 (Oran Berry from 50/100 to 56/100); Atk 13–32 (Liquidation into Kingambit); Spe 0–24. Drampa HP 1–29 (Sitrus Berry from 50/100 to 74/100); Spe 0–28. Aggron Atk 28–32 (two Heavy Slams); Spe 0–14. Alakazam SpA 6–32 (Dazzling Gleam); Spe 0–31. Focus Sash, Sturdy, the announced Endure and Emergency Exit come from hits lethal or past the edge at every spread, so they pin nothing yet |
| `…-23` carried amounts | Final Gambit from Lucario; Victreebel Mega Evolves, and Milotic's Mirror Coat returns its Sludge Bomb twice, the second knocking it out so Innards Out hands its HP back; Pain Split from Swalot with Snorlax and then with Staraptor; Counter and Endeavor from Mudsdale; Double-Edge recoil and Shell Bell; Leech Seed and Giga Drain into Liquid Ooze, and Giga Drain draining Mudsdale's last HP. 7 turns, p1 wins | Victreebel 10/4/6/30/16/0 Modest, Victreebelite · Lucario 13/22/1/2/0/28 Jolly, Black Belt · Mudsdale 21/25/11/0/9/0 Adamant, Shuca Berry · Swalot 26/0/18/3/19/0 Bold, Poison Barb | Lucario HP: exactly 13, through Final Gambit. Victreebel HP 9?–10 (Mirror Coat on its own Sludge Bomb); SpA 28–32? (Sludge Bomb into Milotic). Mudsdale HP: exactly 21, through Counter and Endeavor; Def 8–20 (Double-Edge). Swalot HP: exactly 26, through Pain Split; Def 13–32 (Quick Attack); SpA 1–21 (Sludge Bomb into Venusaur); Spe 0–25 (Venusaur moved first). Innards Out's hand-back after Mirror Coat, and the known side of each Pain Split, are set aside and pin nothing |
