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
