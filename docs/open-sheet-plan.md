# Open team sheets — the build plan

**For:** one agent, working alone, with no earlier conversation.
**Task:** finish Stat Point inference for replays that publish team sheets, so that
`npm run reconstruct -- --infer p2` on any Reg M-C replay you played in keeps every spread the replay
allows and removes every spread it rules out, and prove it with battles built for the purpose.
**Read first:** `AGENTS.md` (where a file goes), `engineering.md` §7.5 and §9, `evidence-catalog.md`,
`evidence-open-sheets.md` §0–§2.
**Done when:** every item in §6 holds.
**Verified against:** `pokemon-showdown` at `a5df827`, `scripts/lib/inference/` and the catalog
reports as of 2026-10-22, and the by-hand review in `evidence-by-hand.md` (commit `e7f3322`).
**After this:** `closed-sheet-plan.md`, which builds on the harness this plan finishes.
**Status (2026-10-22):** all eight phases are built, and §6 holds but for the extension check's
live-site steps: `npm run catalog -- --check` passes, and `npm run extension -- --check` passes
`sim` and `package`, while `room` and `rng` fail where play.pokemonshowdown.com no longer
commits the extension's clicks and `entry` where the newest replay on the replay server, both
sides inferred, takes longer than its four minutes. What stays open is `engineering.md` §9.

---

## 0. What "fully working" means

Open team sheets publish species, item, ability, moves and nature; the hidden unknown is six Stat
Points per Pokemon. The inference is fully working when four things hold at once:

| Property | Meaning | How it is shown |
|---|---|---|
| **Sound** | no spread that could have produced the log is removed | every test battle keeps its real spread; `--outside` never rebuilds a spread the inference removed |
| **Complete** | every line that depends on a Stat Point is read | every effect in the legal pool is USED in a battle that makes it act, or has a written reason it cannot carry a Stat Point |
| **Proved** | each range end is backed by a rebuild | `--certify` proves the ends on the test recordings |
| **Tested** | the above is checked by battles that stay in the repo | the catalog's hand-set battles, the probe recordings, the real replays (§3) |

**In scope:** one side unknown (`--infer p2`, or `p1`), read from the uploader's view, where the
uploader's own HP is exact. That is every replay you saved from your own Bo3 game.

**Out of scope, unchanged:** `--infer both` (frozen, `engineering.md` §10), which is what a stranger's
public replay needs; a prior over the survivors (`plan.md` §10); any UI beyond what exists.

---

## 1. Where it stands

From the catalog run of 2026-10-22 (`evidence-catalog.md` §5):

- **Sound:** no effect removes a real spread and every battle rebuilds whole; the 29 recordings (the
  21 Reg M-B ones and the 8 probes) keep all 115 real spreads; the fuzzer's 100 random battles all
  rebuild and keep theirs; on the user's 15 open games `--outside` rebuilds nothing outside a range.
- **Used:** of 510 moves, 441 showed a Stat Point, and every channel is USED but three orders no
  battle can tell — a speed tie after Transform or Imposter, an order between two hidden Pokemon.
- **Left:** nothing without a written reason (`evidence-open-sheets.md` §1.3): 3 UNUSED rows, 20
  MASKED rows, 72 effects NOT SHOWN, 8 reads no battle changed a line with, the switch-ins an
  Illusion user could have made set aside, and 14 sweep boundaries.

### The by-hand review

`evidence-by-hand.md` answers, for each of the 879 legal moves, abilities and items,
whether any situation lets it reveal a Stat Point. Use it as a list of hypotheses, not of facts:

- Its per-entry flags are consistent with its own §8 counts, and every entry was filled.
- Its §8 "twenty most useful findings" cannot be trusted: 16 of 20 cite a wrong entry number or an
  effect that is not in Reg M-C at all (Protosynthesis, Quark Drive, Download, Booster Energy,
  Choice Band).
- Most YES answers are the general case every hit and every move order already covers.

Its claims were checked against the catalog and the simulator source, and the doubtful ones were
played as two-world battles and rebuilt. Of the 105 effects where it saw a channel that the catalog
did not, 18 are real; of the catalog's 140 work-list effects, 92 need a battle and 48 cannot carry
a Stat Point. The battles are Appendix A. They also found gaps in the inference itself, not only in
the catalog — the worst is that a heal rounded before it is applied (Recover, Roost and their kind)
reads nothing unless the rebuild's current guess of max HP divides evenly — which are Phase 5.

---

## 2. Rules

1. **The simulator decides.** Nothing of ours computes damage, speed or HP. A new hook asks the
   simulator, per candidate, the way `engineering.md` §7.5 describes.
2. **Never remove a spread that fits.** A line a shortcut cannot read is set aside
   (`inference.checks`), never trusted. Precision can be given up; soundness cannot.
3. **One hook per mechanism, never one per move.** A fix that names a move is the wrong fix.
4. **After every step:** `npm run reconstruct -- --all --rung s3 --infer p2` keeps every real spread
   (83 today, plus every probe recording added since), and `npm run reconstruct -- --saved` matches
   no fewer of your saved games than before (17 of 24 today: every open game and two closed ones).
   `npm run catalog -- --fuzz 100 --seed 1` finds random battles the inference gets wrong before a
   real game does. Before a commit that changes the catalog or
   the inference, the affected kinds are rerun (`npm run catalog -- --kind <kind> --out <dir>`) and
   nothing new is UNSOUND. A change to `scripts/lib/inference/` also runs `npm run extension --
   --check`: the extension bundles the inference with browser stand-ins, so a new hook can break it.
5. **Files.** Every file this plan touches is listed in §5 with its row in `AGENTS.md`. Anything else
   is a new file the table does not place: stop and ask the user for it by name, one file at a time.
   A scratch script that builds a battle lives in the session scratchpad and is deleted.
6. **Commits.** One per step, the message saying what now happens, like the existing history ("Read
   Shell Bell hit by hit, so a move that hits twice is read too"). The documents it changes go in the
   same commit.
7. **Reports.** `docs/evidence-open-sheets.md` and `docs/evidence-closed-sheets.md` are written only
   by a full `npm run catalog` (about an hour on 13 threads). Run it at the end of each phase, not
   after every step; split it with `--kind` and `--out`, and render with `--records`.

---

## 3. The test battles

Three tiers, each with its own home in the table. Together they are the unit tests of the inference.

### 3.1 Effect battles — `scripts/fixtures/catalog.js`

One small battle per effect and situation, as a hand-set entry under `entries`, in the shape the
existing ones have (`race(...)`, `ability:quickfeet`, `move:healpulse`): the two teams, the turns,
the control battle without the effect, and `why`. The catalog plays it in the real format, varies
one Stat Point, rebuilds each world with `inferSpreads`, and gives each stat a verdict.
`npm run catalog -- --only <id>` runs one; `--check` holds the whole set to the committed reports,
which makes them regression tests.

An effect battle passes when:

- each stat its `why` names is **USED**, and no stat is UNSOUND or REBUILD-FAILED;
- or the effect cannot carry a Stat Point, the battle shows it acting (outcome NO CHANNEL), and `why`
  says why in one sentence.

Phase 1 adds what these battles need to express (§4).

### 3.2 Probe recordings — `recordings/local/probes/`

A multi-turn battle played on the local server, with realistic teams and non-uniform spreads, whose
hidden side's real spreads are in its input log. `npm run reconstruct -- --all` already walks every
folder under `recordings/`, so a probe joins the S1–S3 suite and the `--infer p2` regression the
moment it is copied in.

How one is made:

1. Write the two teams as export text, Reg M-C legal, each Pokemon's Stat Points summing to 66 and
   uneven (the fixture rule, `engineering.md` §8). Check them with
   `TeamValidator.get('gen9championsvgc2026regmc').validateTeam(...)` before playing.
2. In a scratch script in the scratchpad, start the servers the way `scripts/local-replay.mjs`
   `ensureServers()` does, and play the battle with two `WsPlayer`s (`scripts/lib/ws-player.mjs`),
   each with a policy that returns the scripted choice for each request. Where one die has to come
   up a certain way, arm it with `/rng` in the room (`scripts/server/rng-command.js`); otherwise let
   the dice fall.
3. Copy the battle's `.log.json` from `runtime/logs/` into `recordings/local/probes/`, keeping its
   name. Run `npm run replay -- --from <file>` to confirm it replays line for line.
4. Add its row to `recordings/local/probes/README.md`: recording, the effects it tests, the spread
   of each hidden Pokemon, and what the inference must conclude.
5. Run `npm run reconstruct -- --from <file> --rung s3 --infer p2 --certify --outside`.

A probe recording passes when the rebuild is a MATCH, every real spread survives, every range
named in its README row is at least as narrow as written there, and no `--outside` rebuild
reproduces the log.

The set to build is §4 Phase 6.

### 3.3 Real replays — `recordings/showdown/mine-open/` and `full-sheets/`

Your own Bo3 Reg M-C games, saved from the battle room, are the test that matters most, and only the
user can supply them. `full-sheets/` holds a game where the opponent shared their Stat Points too;
it is the only real replay with a truth to check against.

The user will supply, as they find time:

- **Five Bo3 sets** (`gen9championsvgc2026regmcbo3`), about twelve games, against five different
  opponents, played with **two or three different teams** of their own;
- **one or two sets against a friend who shares their Stat Points**, filed in `full-sheets/`;
- for each team of theirs, the teambuilder's export text with Stat Points. It goes into
  `scripts/fixtures/teams.js` as a new entry of `TEAM_SETS`, so `--teams <key>` can name it.

A replay arrives as a link, saved as its `.json` (`recordings/showdown/README.md`), or as a page
downloaded from the battle room. A link is the spectator's view, both sides as percentages; the
download shows the user's own HP exactly and gives the inference more. Both rebuild: the first set,
three games against one opponent with the team `mc-sun`, is in `mine-open/` and each game is a
MATCH under `--infer p1`.
Across all of them, not in each: Trick Room, Tailwind, rain or sun, Intimidate, Fake Out, a Mega
Evolution, a Choice Scarf, a Leftovers or Sitrus heal, Protect turns, a game of eight turns or more,
and a game with many switches. Real games that never meet one of these are still welcome; the list
says what to keep an eye out for.

A real replay passes when `--infer p2 --certify --outside` is a MATCH and no `--outside` rebuild
reproduces the log. For a `full-sheets` replay, the opponent's real spreads must also survive.

---

## 4. Phases

Each phase ends with its own "Done when". Do them in order.

### Phase 1 — Make the catalog able to ask

All in `scripts/local-catalog.mjs` and `scripts/fixtures/catalog.js`.

1. **Fix the Mega choice.** At line 947, match the move without its comma (`[^\s,]+`), so `mega`
   attaches to the hidden Pokemon's own choice. Then confirm a Mega Stone card's `W-phys-taken` runs.
2. **Fix the other refused templates.** For each card that prints `refused`, either give the known
   Pokemon the move its template asks for, or change the template so its choices are legal. A refusal
   that cannot be avoided becomes the card's written reason.
3. **Put the Mega-only abilities in the pool.** `buildPool` takes abilities from legal species;
   also take every ability of a Mega forme whose Stone is in the pool, weighted by that species. Its
   templates Mega Evolve the holder on turn 1, the way the Stone's do.
4. **Name the two worlds.** A hand-set template may set `worlds: [a, b]`, the two values of the
   probed stat (default 0 and 32), and `stat`, the stat to vary. The rest stay at 2.
5. **Sweep.** A hand-set template may set `worlds: 'sweep'`: the battle is played at every value
   0–32 of its stat, the worlds are grouped by the known side's view, and one adjacent pair across
   each boundary between groups is rebuilt and judged like a 0/32 pair. The card prints the
   boundaries: `HP 13|14: USED`. This is what reads a share of max HP and a parity.
6. **Probe the ally.** A hand-set template may set `probe: 'p2b'`: the stat varied is the hidden
   ally's instead of p2a's. Its rows carry the role letter `A`.
7. **Write a reason down.** An entry may carry `reason` and no templates: the effect cannot carry a
   Stat Point on an open sheet, and the card prints why. NOT SHOWN with a reason is no longer work.
   Appendix A §A.2 has the 48 reasons.
8. **Keep `--check` honest.** Make the reports carry the new fields, then rerun the full catalog and
   commit the reports.

**Status:** built: every Mega Stone witness runs, the Mega-only abilities have cards that Mega
Evolve on turn 1 against the Mega forme, no card prints `refused` (a choice the battle overrode
prints its cause), and hand-set templates take `stat`, `worlds`, `worlds: 'sweep'`,
`probe: 'p2b'` and `reason`. The full run of 2026-10-22 regenerated both reports, and `--check`
passes on them.

**Done when:** no card prints `refused` without a written reason; the Mega-only abilities have cards;
a hand-set Super Fang battle with `worlds: 'sweep'` on HP shows the `50/100g`/`50/100y` boundary; a
hand-set Helping Hand battle with `probe: 'p2b'` shows the ally's Attack; `npm run catalog -- --check`
passes on the regenerated reports.

### Phase 2 — Make every effect act

Write the hand-set battles of Appendix A §A.1 whose Catalog column says NOT SHOWN or NO CHANNEL,
and give each effect of §A.2 its `reason`. Most battles change nothing in the inference: the effect
runs inside `getDamage`, an HP change or a speed sort, and the battle only proves that. Every one
that is not USED becomes Phase 5 work.

**Status:** built: no effect is NOT SHOWN without a written reason (72 carry one), and every
hand-set battle is USED or carries its reason.

**Done when:** no effect in `evidence-open-sheets.md` §2.5 is NOT SHOWN without a written reason,
and every battle added is USED or has its reason.

### Phase 3 — Unmask

For each MASKED row (`evidence-open-sheets.md` §2.4), a battle in which nothing else carries that
stat: bring the Pokemon down with damage that reads no stat of it but HP (Super Fang, Night Shade,
Seismic Toss), then let the effect act, with no other hit on it. A share of max HP, which most of
these are, needs `worlds: 'sweep'` as well. The rows of Appendix A §A.1 marked MASKED give each one,
with a Stat Point pair where one was found.

**Status:** built: every MASKED row carries a written reason (20), and Metronome's isolating battle
is USED.

**Done when:** every MASKED row has an isolating battle and that battle is USED, or UNUSED and
carried into Phase 5, or has a written reason why no one-stat battle isolates it.

### Phase 4 — Reads no battle changed

For each effect in `evidence-open-sheets.md` §2.6 (a handler that reads a stat that no line changed
with), a battle that reaches the read, swept where the read is a share of max HP: Belly Drum's and
Shed Tail's half, Spikes and Stealth Rock, Spiky Shield and Aftermath on a hidden attacker, Volt
Absorb, Water Absorb and Earth Eater, Poison Heal, Solar Power, Sturdy and Endure at the edge, Red
Card. The rows of Appendix A §A.1 marked READ-UNSEEN.

**Status:** built: every read is USED or carries its reason (8 do), and every sweep boundary that
is not USED carries its reason (`evidence-open-sheets.md` §2.8).

**Done when:** each has a battle, swept where needed, and each read is USED or has its written reason.

### Phase 5 — Close the gaps found

Everything Phases 1–4 left UNUSED, and the hooks below, each as one hook in
`scripts/lib/inference/`, in the order `evidence-open-sheets.md` §2.2 scores them. Each has its
battle in Appendix A §A.1, where its Hook column names it. Known already:

- **Innards Out** (Victreebel-Mega): the damage it deals is the HP its holder had left
  (`Pokemon.damage` caps a hit at the HP left), plus the earlier hits' damage when a multi-hit move
  knocked it out. When the attacker is shown exactly, its line names the hidden holder's HP before
  the hit. Read it the way the Counter family is read (`engineering.md` §7.5, *Damage handed
  back*): the amount is carried, and the holder is narrowed to the HPs that print the attacker's line.
- **Recoil off a move that hit twice — read.** Parental Bond (Mega Kangaskhan) makes every recoil
  move hit twice, and the recoil is a share of both hits together; it is read off the simulator's
  total over every hit (`engineering.md` §7.5). Found by a real replay: in `mine-open/gen9championsvgc2026regmcbo3-2692553871.json`
  turn 2, Mega Kangaskhan's Double-Edge knocks out a full-HP Sneasler in two hits, so the recoil
  (`68/100 [from] Recoil` on a known 194 max HP) is a third of Sneasler's whole max HP and names its
  HP Stat Points.
- **The order between the two hidden Pokemon — read.** Every order is applied, then applied again
  until no bound moves, so two hidden Pokemon ordered against each other narrow each other. The
  catalog's Effect Spore row should leave the UNUSED list on the next full run.
- **R1 — Rounded shares of max HP.** A move's own heal or cost — the `heal: [n, d]` moves Recover,
  Roost, Slack Off, Milk Drink and Life Dew (`Math.round`), Heal Pulse and Shed Tail (`ceil`),
  the Moonlight family (`this.modify`), Belly Drum — is re-run per candidate max HP, the
  way `runChange` re-runs `applyRecoilDamage` (`engineering.md` §7.5). Left: a share that is not a
  move's own still keeps both roundings where the real max HP divides evenly (Aftermath at max HP
  184, Spikes at 160); re-run those the same way.
- **Shed Tail's Substitute.** The Substitute it hands the replacement holds half the *shedder's* max
  HP, rounded down; `subChange` only reads a fresh Substitute of a quarter of its own owner's. At
  HP Stat Points 25 against 27 the replacement's first hit prints `-end` in one world and
  `-activate` in the other, and neither world rules out the other.
- **Magician's speed sort.** Magician sorts the Pokemon its move hit by Speed
  (`onAfterMoveSecondarySelf`) to choose whose item to take, outside the queue, `fieldEvent` and
  `eachEvent` sorts that `speed.mjs` watches. Two hidden targets 1 Speed apart rebuild differently and
  are not told apart. Hook that sort like the others.
- **Endure that did not announce itself.** A hit that leaves the Pokemon on exactly 1 HP with no
  `-activate|…|move: Endure` line rules out the candidates whose `Damage` event would have fired;
  today only the announced case is read.
- **R2 — Revival Blessing.** The revive is `sethp(maxhp / 2)`, and every `sethp` but Pain Split's is read
  as an HP change of unknown shape. Scale it like `directDamage`: an ally of base HP 95 at HP Stat
  Points 0 against 1 prints `50/100y` against `49/100`.
- **R3 — Quash.** `speed.mjs` sets aside a whole turn that names After You, Quash or Instruct. Quash only
  moves its target to the end; the user's order against every other Pokemon is the ordinary sort,
  and whether Quash succeeded says whether its target had already moved. Keep the turn, and set aside
  only the quashed Pokemon's own order.
- **R4 — Illusion's order lines.** An order line that names the disguise (`p2a: Slowking` before the
  `|replace|`) is not given to the Illusion user behind it, which leaves the catalog's Illusion Speed
  row UNUSED. Once the switch-in is settled, give it to the Illusion user. Derived from the code, not
  yet run.
- **R5 — Shell Side Arm's category.** `onModifyMove` chooses Physical or Special by comparing the user's
  Attack and Special Attack against the target's Defence and Special Defence, and the `|-hint|`
  names the choice; the damage rows read the category the real move took, so the comparison is never
  asked per candidate. Re-run `onModifyMove` per candidate and keep those whose category matches the
  hint (at a known Snorlax with Defence 23 and Special Defence 2, a hidden Slowbro-Galar's choice
  flips at Special Attack 28).
- **A share of max HP that the sweep shows UNUSED.** Any other boundary pair that is not told apart
  is the same rounding gap in another place; fix it the same way.

The UNUSED cells of Transform and Imposter compare the copy with its original, whose Speeds are equal:
a tie, which says nothing. They stay UNUSED; the copied Speed is tested instead by the §A.1 battles
with a known pacer between the two worlds' Speeds. An Illusion switch-in nothing settles stays unread
too. Write both in `evidence-catalog.md` §6.

**Status:** built: §2.2 lists only the speed ties after Transform and Imposter and Effect Spore's
order between two hidden Pokemon, each with its reason; §2.4 only rows with a written reason; every
real spread and probe survives; nothing is set aside but the Illusion switch-ins
(`engineering.md` §7.5, §9).

**Done when:** `evidence-open-sheets.md` §2.2 lists only speed ties and the Illusion switch-in; §2.4
holds only rows with a written reason why no one-stat battle isolates the stat (Shell Bell's Special
Defence: at a fixed HP its heal falls in the same bucket at every value, so it needs HP and Special
Defence swept together, which this plan does not build); and every real spread of the recordings and every
probe still survive.

### Phase 6 — Probe recordings

Build these on the local server (§3.2), each with p2 hidden. Pokemon are Reg M-C legal; choose
others with the same mechanism if a team fails validation.

| # | Name in the README | What it tests | Teams, in outline |
|---|---|---|---|
| 1 | chip and heal | M4 shares of max HP and their rounding; HP pinned through display edges | p1 Garchomp (Stealth Rock), Cinderace (Super Fang); p2 Clefable (Moonlight, Leftovers), Toxapex (Recover, Regenerator), switching through rocks and sand from Tyranitar |
| 2 | thresholds | M6: Focus Sash, Sturdy, Endure, Sitrus and Oran Berry at the half (the only HP Berries in the pool), Emergency Exit, Berserk | p2 Golisopod (Emergency Exit), Drampa (Berserk), Aggron (Sturdy), a Focus Sash lead; p1 hits sized to land on each edge |
| 3 | carried amounts | M5: Leech Seed, drain, recoil, Shell Bell, Counter, Mirror Coat, Pain Split, Endeavor, Final Gambit, Innards Out | p2 Victreebel-Mega, Swalot (Liquid Ooze), Mudsdale (Counter), Gengar (Pain Split), Lucario (Final Gambit); p1 attackers with known exact HP |
| 4 | order | M7: Tailwind, Trick Room, Choice Scarf, paralysis, Quash, After You, Prankster, Unburden, rain Swift Swim | p2 Whimsicott (Prankster Tailwind), Basculegion (Swift Swim), Hawlucha (Unburden); p1 Pelipper (Drizzle), Sableye (Quash); same-bracket races both ways |
| 5 | moved stats | M8: Power Split, Guard Split, Speed Swap, Transform, Imposter, Power Trick | p2 Indeedee (Power Split), Indeedee-F (Guard Split), Alakazam (Speed Swap), Ditto (Imposter), Medicham (Power Trick); p1 hits after each move |
| 6 | the partner | the ally role: Helping Hand, Friend Guard, Hospitality, Heal Pulse on the ally, a spread move hitting the ally, Ally Switch, the two hidden Pokemon racing each other | p2 Maushold (Friend Guard), Sinistcha (Hospitality), Indeedee-F |
| 7 | formes | Mega Evolution mid-battle, Stance Change, Zero to Hero, Illusion | p2 Aegislash, Palafin, Zoroark-Hisui, a Mega |
| 8 | a real game | ten turns of ordinary VGC play with common Reg M-C sets, no effect chosen for it | two plausible teams; choices that trade damage |

Each README row names, for each hidden Pokemon, the stat the battle is built to pin and how far:
for example "Clefable HP: exactly its real value, through Moonlight from 49/100".

**Status:** built: the eight are in `recordings/local/probes/` with their README rows, and each
passes §3.2.

**Done when:** all eight are in `recordings/local/probes/` with their README rows, and each passes
§3.2.

### Phase 7 — Real replays

With the replays and teams from the user (§3.3), run `--infer <their side> --certify --outside` on
each. Every failure is a defect: find the line, add an effect battle that shows it (Phase 2 style),
fix it (Phase 5 style), and rerun everything.

The games of one Bo3 set share the opponent's sheet, so what survives for a Pokemon in one game
must also survive in the others. `npm run reconstruct -- --with <file>` reads a set together: each
game is inferred as today, and each Pokemon's surviving spreads are intersected with what the other
games' `.log.json` files leave (`engineering.md` §7.5, *A best-of set is one team*). The first set
shows why: with game 1, game 2 pins the opponent's Staraptor to Speed 32 and Ceruledge to HP 32.
Not built: feeding what the set leaves back into each game's rebuild as its starting knowledge,
until nothing moves.

**The user's games.** All 15 open games (`mine-open/README.md`) rebuild line for line under
`--infer`. Seven of them each test one mechanism no other game reaches:

| Game | What it tests |
|---|---|
| good pov, game 2 | recoil off Mega Kangaskhan's two-hit Double-Edge, which narrows the hidden Sneasler's HP; Roost on the hidden Corviknight |
| Grizzlemunch, game 2 | sandstorm hitting Milotic before Rillaboom: an order between two hidden Pokemon |
| Vicarina22, game 1 | Rotom eating a Chesto Berry asleep after Rest: a dry run has to hand the whole battle back |
| noob13032, game 1 | Gholdengo switching out before your Tyranitar: a switch's order, on the speed of the Pokemon going out |
| krapfenallacream, game 1 | their Garchomp Mega Evolving before your Gengar: Mega Evolution's order, on the speed before the forme change; a `\|cant\|…\|flinch` order |
| krapfenallacream, game 2 | the same Mega Evolutions, and an Encored Incineroar's Fake Out, which is not its choice |
| noob13032, game 2 | a forfeit at the start of a turn in a Bo3, where the room prints `\|player\|` again after the `\|win\|` |

The fallback's gap report on these games is empty: a hook reads every line they show. With the
order, recoil and dry-run hooks taken out it names those lines, so the games also test the report.

**Status:** built: every open game rebuilds under `--certify --outside`, and nothing outside a
range rebuilds.

**Done when:** every replay the user gave passes §3.3.

### Phase 8 — Write it down

Update `engineering.md` §7.5 (each new hook, in the style of its *What links Pokemon* list) and §9
(what is still open), `evidence-catalog.md` §2 (the mechanism table), §5 (the new coverage) and §6
(the limits that are left), and the README's commands table if a flag was added. Regenerate both
reports with a full run.

**Status:** built: the documents describe the code as of 2026-10-22, both reports are that day's
full run, and `npm run catalog -- --check` passes.

**Done when:** the documents describe the code as built, and `npm run catalog -- --check` passes.

---

## 5. Files

Every file this plan writes, and why the table allows it.

| File | Change | `AGENTS.md` row |
|---|---|---|
| `scripts/local-catalog.mjs` | Phase 1: the Mega choice, refused templates, Mega abilities, `worlds`, sweep, `probe` | existing command |
| `scripts/fixtures/catalog.js` | Phases 1–4: hand-set battles | existing fixture |
| `scripts/lib/inference/*.mjs` | Phase 5: new hooks | existing machinery |
| `scripts/fixtures/teams.js` | Phase 7: the user's teams, one key each | existing fixture |
| `scripts/local-reconstruct.mjs` | Phase 7: `--from` repeatable, a Bo3 set read together | existing command |
| `recordings/local/probes/<battleid>.log.json` | Phase 6 | battle our local server recorded, worth keeping |
| `recordings/local/probes/README.md` | Phase 6: one row per recording | existing README |
| `recordings/showdown/mine-open/`, `full-sheets/` | Phase 7: replays the user gives, as downloaded | replay page saved from play.pokemonshowdown.com |
| `docs/evidence-open-sheets.md`, `docs/evidence-closed-sheets.md` | regenerated, never hand-edited | written by `npm run catalog` |
| `docs/engineering.md`, `docs/evidence-catalog.md`, `README.md`, this file | Phase 8 | existing documents |
| `extension/src/…` | only if a change above breaks `npm run extension -- --check` | existing extension code |

No new command, no new document, no new folder. A test runner, if one seems needed, is a flag on
`npm run catalog` or `npm run reconstruct`, not a file.

---

## 6. Done when

1. `npm run reconstruct -- --all --rung s3 --infer p2` is a MATCH on every recording, the eight
   probes included, and keeps every real spread.
2. `npm run reconstruct -- --all --rung s3 --infer p2 --certify --outside` finds no rebuild outside a
   range that reproduces its log.
3. In `evidence-open-sheets.md`: nothing UNSOUND or REBUILD-FAILED; MASKED only with a written
   reason; UNUSED only for speed ties and the unsettled Illusion switch-in; NOT SHOWN only with a
   written reason; no `refused` without one; every boundary a sweep found is USED.
4. Every real replay the user supplied passes §3.3.
5. `npm run catalog -- --check` and `npm run extension -- --check` pass, and the documents in Phase 8
   match the code.

---

## Appendix A — the battles to write

Built from the catalog's work list and the by-hand review, each claim checked against the simulator
source. **GENERIC** means the existing hooks should read it once a battle makes it act; **NEW** means
Phase 5 work. Worlds are Stat Point values of the probed stat; `sweep` means find the boundary.

### A.1 The battles, by mechanism

One row per effect. **Catalog** is the effect's place on today's work list: NOT SHOWN (no template made it act), MASKED, READ-UNSEEN (a handler reads a stat that no line changed with), UNUSED, or NO CHANNEL (the review found a channel the templates missed). **✓** means a scratch run built both worlds and rebuilt each with `inferSpreads`; **[ran]** in the battle means both worlds were played and differ as stated; anything else is derived from the source. Users is the number of legal Pokemon that can use the effect; `slot 0`, `slot 1` or `H` name the ability slot a species holds it in. A hook named R1–R5, or NEW HOOK, is a Phase 5 item. A row
not marked [ran] or ✓ was derived from the source and can name a set the validator refuses: check
each set with `TeamValidator` before building its battle, and where one fails, use another Pokemon
with the same mechanism.

#### M1 — damage taken (12)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `item:electricseed` | 293 | NOT SHOWN | Def, HP | p1a Snorlax (physical hit), p1b Pawmot (Electric Terrain); p2a Blastoise holds the seed → T1 p1b Electric Terrain (seed eaten, Def +1); T2 p1a hits p2a [ran] | Def 0 vs 32 | hidden % (70/100 vs 76/100) | GENERIC (the seed's boost is an ordinary stage) |
| `item:grassyseed` | 293 | NOT SHOWN | Def, HP | p1a Rillaboom (Grassy Surge) lead, p1b Machamp; p2a Blastoise holds Grassy Seed (Def +1 as the terrain starts) → T1 p1b physical hit p2a. The terrain also heals 1/16 per turn (M4, see item rows) | Def 0 vs 32 | hidden % | GENERIC |
| `item:mistyseed` | 293 | NOT SHOWN | SpD, HP | known side sets Misty Terrain with the move (any learner, e.g. Gardevoir); p2a Blastoise holds Misty Seed (SpD +1) → T1 set terrain; T2 p1 special hit p2a | SpD 0 vs 32 | hidden % | GENERIC |
| `item:psychicseed` | 293 | NOT SHOWN | SpD, HP | known side sets Psychic Terrain with the move; p2a Blastoise holds Psychic Seed (SpD +1) → T1 set terrain; T2 p1 special hit p2a | SpD 0 vs 32 | hidden % | GENERIC |
| `ability:friendguard` | 22 | NOT SHOWN | Def, HP (of the ally) | p2a Blastoise, p2b Vivillon (Friend Guard, H): the 0.75x applies to p2a → T1 p1a physical hit on p2a. Mirror: a known Friend Guard holder shields p1b, so a hidden attacker's hit on p1b is 0.75x (M2 on the hidden attacker) | p2a Def 0 vs 32 (or hidden attacker Atk 0 vs 32) | hidden % (or known exact) | GENERIC (onAnyModifyDamage inside getDamage) |
| `ability:solidrock` | 2 | NOT SHOWN | SpD, HP | p2a Rhyperior (Solid Rock, slot 1) hit by Water (4x): p1a Vaporeon Hydro Pump → T1 p1a Hydro Pump p2a | SpD 0 vs 32 | hidden % | GENERIC |
| `ability:unaware` | 2 | NOT SHOWN | Def, HP | p1a Machamp (Bulk Up, physical hit), p2a Clefable (Unaware, H) → T1 p1a Bulk Up; T2 p1a hits p2a (its +1 Atk is ignored) | Def 0 vs 32 | hidden % | GENERIC (onAnyModifyBoost inside getDamage) |
| `move:topsyturvy` | 2 | NOT SHOWN | Def, HP | p1a Snorlax (Curse, Body Slam), p2a Grapploct (Topsy-Turvy) → T1 p1a Curse (+1 Atk +1 Def); T2 p2a Topsy-Turvy p1a (now -1/-1); T3 p1a Body Slam p2a [ran] | Def 0 vs 32 | hidden % (67/100 vs 75/100) | GENERIC |
| `ability:filter` | 1 | NOT SHOWN | SpD, HP | p2a Mr. Mime (Filter, slot 1) hit by a super-effective special move: p1a Gengar Sludge Bomb (Poison vs Psychic/Fairy) → T1 p1a Sludge Bomb p2a | SpD 0 vs 32 | hidden % | GENERIC (onSourceModifyDamage inside getDamage) |
| `ability:grasspelt` | 1 | NOT SHOWN | Def, HP | p1a Rillaboom (Grassy Surge) lead, p1b Machamp (physical hit); p2a Gogoat (Grass Pelt, H) → T1 p1b hits p2a under Grassy Terrain (Def x1.5) | Def 0 vs 32 | hidden % | GENERIC (the terrain is read by onModifyDef in the dry run) |
| `ability:marvelscale` | 1 | NOT SHOWN | Def, HP | p1a Gardevoir (Thunder Wave), p1b Machamp (physical hit); p2a Milotic (Marvel Scale, slot 0) → T1 p1a Thunder Wave p2a; T2 p1b physical hit p2a (statused Def x1.5) | Def 0 vs 32 | hidden % | GENERIC |
| `move:courtchange` | 1 | NOT SHOWN | Def (HP), Spe | p1a Alakazam (Reflect), p1b Machamp (Brick Break); p2a Cinderace (Court Change) → T1 p1a Reflect; T2 p2a Court Change (the screen moves to the hidden side); T3 p1b Brick Break p2a [ran]. Variants: known Tailwind moved to the hidden side (race vs a pacer); known Stealth Rock moved to the hidden side, then a switch-in (see M4 hazard pair) | Def 0 vs 32 (HP likewise) | hidden % (spectator 42/100 vs 56/100) | GENERIC (screens and Tailwind are read live by getDamage / getActionSpeed) |

#### M2 — damage dealt (32)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `item:metronome` | 293 | MASKED | Atk | MASKED isolation: the first, unboosted hit must not carry Atk. p2a Blastoise (Metronome; Waterfall) → T1 p2a Waterfall into the bulky p2b Avalugg (check that its % is equal in the two worlds, else use a bulkier ally), T2 Waterfall p1a (x1.2), T3 again (x1.4). Carry Atk only in the boosted hits | Atk 0 vs 32 (check the T1 % is equal) | known exact | GENERIC (the item's condition runs inside getDamage) |
| `item:whiteherb` | 293 | NOT SHOWN | SpA | p2a Charizard (White Herb; Overheat, Flamethrower) → T1 Overheat p1a (SpA -2, herb restores it); T2 Flamethrower p1a at unreduced SpA [ran] | SpA 0 vs 32 | known exact (both lines) | GENERIC |
| `move:snore` | 251 | NOT SHOWN | SpA | p1a Gardevoir (Hypnosis); p2a Umbreon (Snore) → T1 p1a Hypnosis p2a, p2a Snore p1a (asleep, sleepUsable); T2 p2a Snore again [ran]. Any of the 251 users | SpA 0 vs 32 | known exact (148 vs 143, then 133 vs 123) | GENERIC |
| `move:encore` | 63 | MASKED | Atk | MASKED isolation: the hit before Encore must be blocked. p1a Mudsdale (Protect), p1b a known Encore user (e.g. Clefable); p2a Blastoise (Waterfall) → T1 p2a Waterfall p1a into Protect (no damage line); T2 p1b Encore p2a, p2a is forced into Waterfall p1a [ran: 109/195 vs 81/195]. The encored hit is the only line that reads Atk | Atk 0 vs 32 | known exact | GENERIC |
| `move:belch` | 18 | NOT SHOWN | SpA | p2a Swalot (Liquid Ooze, Lum Berry; Stuff Cheeks, Belch) vs known Snorlax → T1 p2a Stuff Cheeks (eats the berry, so Belch can be used); T2 p2a Belch p1a [ran]. Known Belch on a hidden target also works (M1 on the target) | SpA 0 vs 32 | known exact (203/255 vs 185/255) | GENERIC |
| `move:spitup` | 13 | NOT SHOWN | SpA | p2a Swalot (Stockpile, Spit Up) vs known Snorlax → T1 p2a Stockpile; T2 p2a Spit Up p1a [ran] | SpA 0 vs 32 | known exact (225 vs 216) | GENERIC |
| `ability:blaze` | 11 | READ-UNSEEN | HP (threshold), SpA | two Night Shade on p2a, then a Fire hit on p1a; edge max HP 150\|151: Simisear/Delphox HP SP 0\|1 (SpA is already USED; the HP edge was not set up) | HP SP as listed | known exact | GENERIC |
| `ability:overgrow` | 11 | NOT SHOWN | HP (threshold), SpA | p1a Gardevoir + p1b Gallade (Night Shade each, 50 flat) → T1 both hit p2a Serperior (Overgrow, slot 0): 150-100 = 50 = a third of 150, boost on; at max 151 it is 51, off; T2 p2a Leaf Storm p1a [ran: 69/163 vs 99/163]. Same edge, max HP 150\|151: Simisage 0\|1, Sceptile 5\|6 | HP SP 0 vs 1 (Serperior: max HP 150 vs 151); earlier lines equal (66/100, 33/100) | known exact (1.5x present or absent) | GENERIC (attacker-HP tie, pinch abilities) |
| `ability:torrent` | 11 | NOT SHOWN | HP (threshold), Atk/SpA | two Night Shade on p2a, then a Water hit on p1a; edge max HP 150\|151: Simipour HP SP 0\|1, Greninja 3\|4, Inteleon 5\|6 | HP SP as listed | known exact | GENERIC |
| `ability:sheerforce` | 10 | NOT SHOWN | Atk | p2a Mawile (Sheer Force, H) → T1 Iron Head p1a (x1.3, flinch removed); the catalog witnesses had no secondary | Atk 0 vs 32 | known exact | GENERIC |
| `ability:angerpoint` | 7 | NOT SHOWN | Atk | p1a Snorlax (physical hit), p2a Tauros (Anger Point, slot 1) → T1 p1a hits p2a with the crit die forced (Atk goes to +6); T2 p2a physical hit p1a [ran]. The hp read is only "alive" | Atk 0 vs 32 | known exact (186/255 vs 168/255) | GENERIC |
| `ability:swarm` | 7 | NOT SHOWN | HP (threshold), Atk/SpA | two Night Shade (50 each) on p2a, then a Bug hit on p1a; edge is max HP 150\|151: Scolipede HP SP 15\|16, Beedrill 10\|11, Ariados/Scizor/Kleavor 5\|6 | HP SP as listed | known exact | GENERIC |
| `ability:ironfist` | 6 | NOT SHOWN | Atk | p2a Conkeldurr (Iron Fist, H) → T1 Mach Punch p1a (x1.2) | Atk 0 vs 32 | known exact | GENERIC |
| `ability:defiant` | 5 | NOT SHOWN | Atk | p1a Gyarados (Intimidate) lead; p2a Kingambit (Defiant, slot 0) → T1 Intimidate, Atk +2; p2a Iron Head p1a | Atk 0 vs 32 | known exact | GENERIC |
| `ability:competitive` | 4 | NOT SHOWN | SpA | p1a Gyarados (Intimidate) lead; p2a Milotic (Competitive, slot 1) → T1 Intimidate lowers Milotic's Atk, SpA +2; p2a Hydro Pump p1a | SpA 0 vs 32 | known exact | GENERIC (a +2 stage is read by getDamage) |
| `ability:sniper` | 4 | NOT SHOWN | Atk | p2a Beedrill (Sniper, H) → T1 a forced crit on p1a (the extra x1.5 acts inside getDamage) | Atk 0 vs 32 | known exact | GENERIC |
| `ability:adaptability` | 3 | NOT SHOWN | Atk | p2a Basculegion (Adaptability, slot 1) uses a STAB move: Waterfall on known Snorlax → T1 p2a Waterfall p1a (the catalog witness was Normal, not STAB, so it never acted) | Atk 0 vs 32 | known exact | GENERIC (onModifySTAB inside getDamage) |
| `ability:plus` | 3 | NOT SHOWN | SpA | p2a Ampharos (Plus, H) with p2b Manectric (Minus, H), both hidden → T1 p2a Dazzling Gleam p1a | SpA 0 vs 32 | known exact | GENERIC |
| `ability:reckless` | 3 | NOT SHOWN | Atk | p2a Staraptor (Reckless, H) → T1 Brave Bird p1a (x1.2); its recoil line on p2a is also M5 (known victim exact) | Atk 0 vs 32 | known exact + hidden % recoil | GENERIC |
| `ability:sharpness` | 3 | NOT SHOWN | Atk | p2a Gallade (Sharpness, slot 1) → T1 Psycho Cut p1a (x1.5) | Atk 0 vs 32 | known exact | GENERIC |
| `ability:analytic` | 2 | NOT SHOWN | SpA | p1a Regieleki (Timid, Spe 32 SP), p1b Dragapult (Spe 20 SP): both faster than Starmie's top speed 167; p2a Starmie (Analytic, H) Hydro Pump → T1 p2a Hydro Pump p1a: it moves last, x1.3 [ran] | SpA 0 vs 32 | known exact | GENERIC (queue.willMove is read live inside getDamage; its own order is M7) |
| `ability:contrary` | 2 | NOT SHOWN | SpA | p2a Serperior (Contrary, H) → T1 Leaf Storm p1a (SpA goes +2); T2 Leaf Storm p1a again | SpA 0 vs 32 | known exact (both lines) | GENERIC |
| `ability:minus` | 2 | NOT SHOWN | SpA | p2a Manectric (Minus, H) with p2b Ampharos (Plus, H), both hidden → T1 p2a Thunderbolt p1a (SpA x1.5 with a Plus/Minus ally) | SpA 0 vs 32 | known exact | GENERIC |
| `ability:sandforce` | 2 | NOT SHOWN | Atk | p1a Tyranitar (Sand Stream) lead; p2a Excadrill (Sand Force, slot 1) → T1 Iron Head p1a (Steel x1.3 in sand) | Atk 0 vs 32 | known exact | GENERIC |
| `ability:stakeout` | 2 | NOT SHOWN | SpA | p2a Thievul (Stakeout, H) → T1 Dark Pulse p1a (its activeTurns is 0 on turn 1, x2) [ran: 215 vs 203 on T1] | SpA 0 vs 32 | known exact | GENERIC |
| `ability:strongjaw` | 2 | NOT SHOWN | Atk | p2a Tyrantrum (Strong Jaw, slot 0) → T1 Crunch p1a (x1.5) | Atk 0 vs 32 | known exact | GENERIC |
| `ability:guarddog` | 1 | NOT SHOWN | Atk | p1a Gyarados (Intimidate) lead; p2a Mabosstiff (Guard Dog, slot 1) → Atk +1 instead of -1; T1 p2a Crunch p1a | Atk 0 vs 32 | known exact | GENERIC |
| `ability:heavymetal` | 1 | NOT SHOWN | Atk | p1a Slowbro (78.5 kg); p2a Aggron (Heavy Metal, H) → T1 Heavy Slam p1a: weight ratio 4.6 gives 100 BP, doubled 9.2 gives 120 [ran]. Low Kick / Grass Knot on Aggron never change tier (360 kg is already above 200) | Atk 0 vs 32 | known exact (155/190 vs 146/190) | GENERIC |
| `ability:megalauncher` | 1 | NOT SHOWN | SpA | p2a Clawitzer (Mega Launcher, slot 0) → T1 Dragon Pulse p1a (x1.5). Its Heal Pulse (75% of the target's max HP, this.modify) is the M4 variant: pair SP 1\|5 on a Blastoise-like ally after Super Fang + Night Shade | SpA 0 vs 32 | known exact | GENERIC |
| `ability:opportunist` | 1 | NOT SHOWN | SpA (Spe) | p1a Alakazam (Calm Mind); p2a Espathra (Opportunist, slot 0) → T1 p1a Calm Mind (Espathra copies +1 SpA at the end of the move); T2 p2a Psychic p1a [ran]. With Agility on the known side it copies Spe (M7 race) | SpA 0 vs 32 | known exact (118/150 vs 110/150) | GENERIC |
| `ability:receiver` | 1 | NOT SHOWN | Atk | p1a Snorlax (Fissure); p2a Passimian (Receiver, slot 0), p2b Medicham (Pure Power) → T1 p1a Fissure p2b (it faints, Passimian gains Pure Power); T2 p2a Knock Off p1a at x2 Atk [ran]. The hp read is only "alive" | Atk 0 vs 32 | known exact (128/255 vs 99/255) | GENERIC |
| `move:instruct` | 1 | MASKED | Atk | MASKED isolation, same shape: p2a Oranguru (Instruct), p2b an attacker; known p1a Protect → T1 p2b hits p1a into Protect; T2 p2a Instruct p2b, which repeats the hit and lands (a line that carries p2b's Atk only through the Instruct) | Atk 0 vs 32 (p2b) | known exact | GENERIC (Instruct taints the turn for speed rules, damage rows are untouched) |

#### M4 — a share of max HP (35)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `move:stealthrock` | 51 | READ-UNSEEN ✓ | HP | Known Garchomp (Sand Veil) lays Stealth Rock T1; T2 hidden bench Blastoise (neutral to Rock) switches in | HP SP 4 vs 5 (max HP 158 vs 159) | hidden %: `87/100` vs `88/100` [from] Stealth Rock | GENERIC-HOOK (M4, maxhp*2^typeMod/8). Run: both worlds USED. condition:stealthrock already USED via Stone Axe |
| `move:roost` | 27 | MASKED | HP | MASKED isolation: p1 Super Fang then Night Shade on p2a Charizard (50/100g, 22/100); T2 Roost (round(max/2)) | HP SP 24 vs 30 (max 177 vs 183): 72/100 vs 73/100 | hidden % heal line | NEW HOOK: R1 rounded heal |
| `move:toxicspikes` | 27 | NO CHANNEL ✓ | HP | Known Forretress lays Toxic Spikes T1; T2 hidden bench Blastoise switches in, is poisoned | HP SP 4 vs 5 (max HP 158 vs 159) | hidden %: `87/100 psn` vs `88/100 psn` (next turn 75 vs 76) | GENERIC-HOOK (M4 psn tick). Run: both worlds USED |
| `move:wish` | 26 | MASKED | HP | MASKED isolation: no hit on the hidden user. p1 Super Fang x2 on p2a Clefable (50/100g, 25/100); T3 p2a Wish; the Wish heal lands at the end of T4 (floor(max/2), raw max/2) | HP SP 1 vs 31 (max 171 vs 201): 74/100 vs 75/100 | hidden % heal line | GENERIC |
| `move:recover` | 23 | MASKED | HP | MASKED isolation: p1 Super Fang then Night Shade on p2a Alakazam (50/100g, 18/100); T2 Recover (round(max/2)) | HP SP 25 vs 29 (max 155 vs 159): 68/100 vs 69/100 | hidden % heal line | NEW HOOK: R1 rounded heal |
| `move:spikes` | 22 | READ-UNSEEN ✓ | HP | Known Forretress (SP hp32 def32) lays Spikes T1; T2 hidden bench Blastoise (Torrent) switches in at full HP | HP SP 4 vs 5 (max HP 158 vs 159); others 2 (0 vs 32 prints the same) | hidden %: `87/100` vs `88/100` [from] Spikes | GENERIC-HOOK (M4, damageAmounts*maxhp/24). Run: both worlds USED (122.5M and 14.2M of 136.7M). condition:spikes already USED via Ceaseless Edge |
| `move:synthesis` | 17 | MASKED | HP | MASKED isolation: p1 Super Fang x2 on p2a Meganium; T3 Synthesis (modify(max,0.5)) | HP SP 0 vs 30 (max 155 vs 185): 74/100 vs 75/100 | hidden % heal line | NEW HOOK: R1 rounded heal |
| `move:healpulse` | 16 | READ-UNSEEN ✓ | HP | Known Snorlax Seismic Toss on hidden Slowbro T1, T2 (fixed 50 each); T3 known Clefable (Magic Guard) Heal Pulse on it | HP SP 4 vs 5 (max HP 174 vs 175); others 2. T1/T2 lines identical (71, 42) | hidden %: heal `92/100` vs `93/100` | NEW HOOK: round-aware effectChange. raw = ceil(maxhp*0.5) equals maxhp*f only for even max HP; then floor+ceil are both kept. Run: world 4 (even): heal cuts nothing (24.5M = control); world 5 (odd): cut only through a guess round |
| `move:superfang` | 15 | NO CHANNEL ✓ | HP (parity) | Known Snorlax Super Fang T1 on hidden Blastoise at full HP | HP SP 0 vs 1 (max HP 154 vs 155); 0 vs 32 print the same | hidden %: `50/100y` vs `50/100g` | GENERIC-HOOK (hit path, damageCallback reads target HP). Run: each world rules out the other (136.7M to 71.2M and 65.5M) |
| `move:lifedew` | 14 | MASKED | HP | MASKED isolation: p1 Night Shade on p2a Blastoise (71/100); T2 p2a Life Dew (heals the user and p2b by round(max/4)) | HP SP 19 vs 24 (max 173 vs 178): 95/100 vs 97/100 | hidden % heal line | NEW HOOK: R1 rounded heal |
| `move:swallow` | 12 | NOT SHOWN | HP | p2a Swalot (base HP 100) → T1 p1 Super Fang p2a; T2 p2a Stockpile; T3 p2a Swallow (1 layer = modify(max,0.25)). Two layers: Super Fang twice, SP 0\|30 gives 74 vs 75. Three layers heal to full: no information | 1 layer: HP SP 1 vs 31 (max 176 vs 206): 50/100y then 75 vs 74 | hidden % heal line | NEW HOOK: R1 rounded heal |
| `move:bellydrum` | 10 | READ-UNSEEN | HP | p2a Charizard (base HP 78, max 153+SP) at full uses Belly Drum on T1 (cost max/2 through directDamage) | HP SP 0 vs 31 (max 153 vs 184) or 0 vs 1: 50/100g vs 50/100y | hidden % + colour | GENERIC (raw max/2 is a fraction; Atk is already USED) |
| `move:slackoff` | 9 | NO CHANNEL ✓ | HP | Known Snorlax Seismic Toss on hidden Slowbro T1, T2; T3 hidden Slowbro Slack Off | HP SP 4 vs 5 (max HP 174 vs 175); others 2. T1/T2 lines identical (71, 42) | hidden %: heal `92/100` vs `93/100` | NEW HOOK: round-aware effectChange (heal [1,2] is Math.round(maxhp/2); exact match only for even max HP, then floor+ceil kept). Run: world 4 heal cuts nothing (24.8M = control) |
| `ability:regenerator` | 8 | MASKED | HP | MASKED isolation (HP only; Def is carried by the physical hit, not by this effect): p1 Super Fang on p2a Slowbro (50/100y); T2 p2a switches out (silent heal max/3); T3 it switches back in and the switch line shows its HP | HP SP 0 vs 32 (max 170 vs 202): 82/100 vs 83/100 | hidden % (heal line and the next switch line) | GENERIC |
| `ability:icebody` | 7 | NOT SHOWN | HP | p1b Abomasnow (Snow Warning) lead, p1a Houndoom (Super Fang); p2a Avalugg (Ice Body, slot 1) → T1 SF p2a (50/100y); end of T1 Ice Body heals floor(max/16) | HP SP 0 vs 30 (max 170 vs 200): 55/100 vs 56/100 | hidden % heal line | GENERIC |
| `move:moonlight` | 5 | MASKED | HP | MASKED isolation: p1 Super Fang x2 on p2a Umbreon; T3 Moonlight (modify(max,0.5)). Sun gives modify(max,0.667): Clefable SP 0\|32 after SF x2 gives 91 vs 92 | HP SP 1 vs 31 (max 171 vs 201): 74/100 vs 75/100 | hidden % heal line | NEW HOOK: R1 rounded heal (this.modify, and 0.667 is not a listed fraction) |
| `move:morningsun` | 5 | MASKED | HP | MASKED isolation: p1 Super Fang x2 on p2a Arcanine; T3 Morning Sun (modify(max,0.5)); rain/sand/snow quarter variant: SP 1\|31 gives 74 vs 75 | HP SP 0 vs 30 (max 165 vs 195): 75/100 vs 74/100 | hidden % heal line | NEW HOOK: R1 rounded heal |
| `ability:cheekpouch` | 4 | NOT SHOWN | HP | p1a Gardevoir + p1b Gallade (NS each); p2a Dedenne (Cheek Pouch, slot 0, Oran Berry) → T1 NS x2 (65, 30), Oran heals 10 (37), Cheek Pouch heals max/3 | HP SP 1 vs 2 (max 143 vs 144): 69/100 vs 70/100 | hidden % heal line | GENERIC |
| `ability:cudchew` | 4 | NOT SHOWN | HP | p1 two Night Shade users; p2a Tauros-Paldea-Combat (Cud Chew, H, Sitrus) → T1 NS x2 (71, 42), Sitrus 67; end of T2 Cud Chew eats it again (floor(max/4)) | HP SP 23 vs 25 (max 173 vs 175): 91/100 vs 92/100 | hidden % heal line | GENERIC |
| `move:stuffcheeks` | 4 | NOT SHOWN | HP | p1b Gardevoir (Night Shade); p2a Swalot (Sitrus Berry; Stuff Cheeks) → T1 p1b NS p2a (72/100, Sitrus not yet due); T2 p2a Stuff Cheeks: Def +2, eats Sitrus (floor(max/4)) | HP SP 4 vs 10 (max 179 vs 185): 96/100 vs 97/100 | hidden % heal line | GENERIC |
| `ability:waterabsorb` | 3 | READ-UNSEEN ✓ | HP | Hidden Vaporeon (Water Absorb) after two known Seismic Toss; T3 known Snorlax Waterfall | HP SP 8 vs 9 (max HP 213 vs 214) | hidden %: heal `77/100` vs `78/100` [from] ability: Water Absorb | GENERIC-HOOK (M4). Run: each world rules out the other |
| `move:shedtail` | 3 | READ-UNSEEN ✓ | HP | (a) Hidden Sceptile (Overgrow, Shed Tail) at full HP T1; known side idle. (b) same, then the replacement (Slowking) is hit T2 by known Snorlax Quick Attack | (a) HP SP 0 vs 1 (max HP 145 vs 146). (b) HP SP 25 vs 27 (max HP 170 vs 172, Substitute 85 vs 86 HP) | (a) hidden %: `49/100` vs `50/100y` (Gemini had the tags swapped: odd gives 49, even gives 50y). (b) presence: `-end Substitute` vs `-activate Substitute [damage]` | (a) NEW HOOK: round-aware effectChange; raw = ceil(maxhp/2) matches only for even max HP (run: odd world 145 cut nothing = control 136.7M; even world 146 cut to 65.5M). (b) NEW HOOK: subChange only handles a fresh Substitute of floor(own max HP/4); Shed Tail hands floor(shedder max HP/2) to another Pokemon (run: neither world rules out the other) |
| `ability:hospitality` | 2 | NOT SHOWN | HP (ally) | p1 Night Shade user; p2a Slowking, p2b Avalugg, p2c Sinistcha (Hospitality, slot 0) → T1 NS p2b (72/100); T2 p2a switches to Sinistcha, which heals its adjacent ally p2b by max/4 (raw, unrounded) | ally HP SP 9 vs 15 (max 179 vs 185): 96/100 vs 97/100 | hidden % heal line | GENERIC |
| `ability:raindish` | 2 | NOT SHOWN | HP | p1b Pelipper (Drizzle) lead, p1a Houndoom (Super Fang); p2a Blastoise (Rain Dish, H) → T1 SF p2a (50/100y); end of T1 Rain Dish heals floor(max/16) | HP SP 0 vs 28 (max 154 vs 182): 55/100 vs 56/100 | hidden % heal line | GENERIC |
| `ability:ripen` | 2 | NOT SHOWN | HP | p1 two Night Shade users; p2a Flapple (Ripen, slot 0, Sitrus) → T1 NS x2 (67, 35), Sitrus heals double (2*floor(max/4)) | HP SP 9 vs 11 (max 154 vs 156): 84/100 vs 85/100 | hidden % heal line | GENERIC (amountChange runs the real battle.heal, so Ripen's TryHeal doubling is included) |
| `ability:solarpower` | 2 | READ-UNSEEN | HP | p1 Sunny Day user; p2a Charizard (Solar Power, H) → end of T1: floor(max/8) (SpA is already USED) | HP SP 6 vs 32 (max 159 vs 185): 88/100 vs 87/100 | hidden % damage line | GENERIC |
| `ability:voltabsorb` | 2 | READ-UNSEEN ✓ | HP | Hidden Jolteon (Volt Absorb) after two known Seismic Toss; T3 known Snorlax Thunder Punch | HP SP 1 vs 2 (max HP 141 vs 142) | hidden %: heal `53/100` vs `54/100` [from] ability: Volt Absorb | GENERIC-HOOK (M4, baseMaxhp/4). Run: both worlds USED (9.9M and 9.4M) |
| `move:spikyshield` | 2 | READ-UNSEEN ✓ | HP | Known Chesnaught (SP hp32 def32) Spiky Shield T1; hidden Blastoise Strength on it | HP SP 4 vs 5 (max HP 158 vs 159) | hidden %: `87/100` vs `88/100` [from] Spiky Shield | GENERIC-HOOK (M4, baseMaxhp/8). Run: both worlds USED |
| `move:teatime` | 2 | NOT SHOWN | HP | p1 Night Shade user; p2a Polteageist (Sitrus Berry; Teatime) → T1 NS p2a (65/100); T2 p2a Teatime: every active Pokemon holding a Berry eats it (also the hidden ally or a known one) | HP SP 8 vs 12 (max 143 vs 147): 89/100 vs 90/100 | hidden % heal line | GENERIC |
| `ability:aftermath` | 1 | READ-UNSEEN ✓ | HP | Known Garbodor (Aftermath, SP 0) is KO-ed T2 by hidden Garchomp (Sand Veil) High Horsepower; T1 known Torkoal Seismic Toss on Garchomp first (from full HP the line is always 75/100 above max HP 75) | HP SP 7 vs 8 (max HP 190 vs 191) | hidden %: `48/100` vs `49/100` [from] ability: Aftermath | GENERIC-HOOK (M4, baseMaxhp/4). Run: both worlds USED; loose when max HP divisible by 4 (floor+ceil kept: SP 0 vs 1 world with max HP 184 cut nothing) |
| `ability:eartheater` | 1 | READ-UNSEEN ✓ | HP | Hidden Orthworm (Earth Eater) after two known Seismic Toss; T3 known Snorlax High Horsepower | HP SP 0 vs 1 (max HP 145 vs 146) | hidden %: heal `55/100` vs `56/100` [from] ability: Earth Eater | GENERIC-HOOK (M4, baseMaxhp/4). Run: both worlds USED (10.5M and 19.3M) |
| `ability:poisonheal` | 1 | READ-UNSEEN ✓ | HP | Hidden Gliscor (Poison Heal, Toxic Orb) after two known Seismic Toss; T2 end-of-turn heal | HP SP 2 vs 3 (max HP 152 vs 153) | hidden %: heal `46/100 tox` vs `47/100 tox` [from] ability: Poison Heal | GENERIC-HOOK (M4, baseMaxhp/8). Run: both worlds USED |
| `ability:toxicdebris` | 1 | NO CHANNEL ✓ | HP | Known Glimmora (Toxic Debris) hit by a hidden physical move puts Toxic Spikes on the hidden side; a hidden bench Pokemon later switches in (battle as Toxic Spikes row; not separately run) | HP SP 4 vs 5 on Blastoise (as Toxic Spikes) | hidden %: `87/100 psn` vs `88/100 psn` | GENERIC-HOOK (M4 psn tick) |
| `move:banefulbunker` | 1 | NO CHANNEL ✓ | HP | Known Toxapex (Regenerator, SP hp32 def32) uses Baneful Bunker T1; hidden Blastoise uses Strength on it; hidden Blastoise is poisoned | HP SP 4 vs 5 (max HP 158 vs 159); others 2 | hidden %: `87/100 psn` vs `88/100 psn` (psn tick, then 75 vs 76 next turn) | GENERIC-HOOK (M4, psn tick = baseMaxhp/8). Run: both worlds USED (136.7M to 122.5M and 14.2M). condition:psn/tox have no HP row in the catalog either |
| `move:milkdrink` | 1 | MASKED | HP | MASKED isolation: p1 Super Fang then Night Shade on p2a Gogoat (50/100g, 26/100); T2 Milk Drink (round(max/2)) | HP SP 9 vs 17 (max 207 vs 215): 76/100 vs 77/100 | hidden % heal line | NEW HOOK: R1 rounded heal |

#### M5 — an amount carried to an exact line (1)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `item:shellbell` | 293 | MASKED | SpD (target) | MASKED isolation: p1a Gardevoir (Shell Bell, Moonblast) halved first by p2b Houndoom's Super Fang (stat-independent); T2 p1a Moonblast p2a Blastoise; the heal line floor(damage/8) must differ while the hidden % is equal in the two worlds. I swept hidden SpD 0..32 at HP SP 2 in the harness: no pair, because the 1/8 steps of the heal fall on the same SpD steps as the % | sweep: needs the pair searched over HP SP x SpD | known exact heal line vs hidden % | GENERIC (Shell Bell hook, M5) |

#### M6 — an HP threshold (2)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `move:endure` | 292 | READ-UNSEEN ✓ | HP (+Def) | Hidden Blastoise (Torrent, Smooth Rock, Endure) vs known Snorlax (Strength, Quick Attack): T1 Strength, T2 Strength, T3 Blastoise Endure + Snorlax Quick Attack. Needs a hit that is lethal at one HP and not at the other | HP SP 14 vs 15 (max HP 168 vs 169); others 2. T1/T2 lines identical (60/100, 20/100y) | line presence: `-activate move: Endure` + `1/100` (14) vs plain `1/100` (15); at SP 18 instead: `2/100`. Pins HP to exactly 1 afterwards | GENERIC-HOOK (M6, Damage event, `survivor` line). Run: world 14 rules out 15 (T3 cut). World 15 does not rule out 14 (absent announcement unread when the endured HP equals the displayed one): optional tiny hook, drop candidates whose Damage event fires when no announcement printed |
| `ability:sturdy` | 9 | READ-UNSEEN ✓ | HP (+SpD) | Hidden Forretress (Sturdy, Smooth Rock) at full HP vs known Torkoal (SpA SP 0) Incinerate T1 | HP SP 6 vs 10 (max HP 156 vs 160); others 2 (at SP 7: dies to exactly 1 HP with no ability line) | line presence + hidden %: `-ability Sturdy` + `1/100` vs `2/100` | GENERIC-HOOK (M6 Damage event). Run: both worlds USED (22.2M and 7.5M) |

#### M7 — order (11)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `move:quash` | 7 | MASKED | Spe | user role: p1a Gardevoir (Spe SP 1 = 101), p1b Torkoal; p2a Persian-Alola (Quash; Spe 85..117) → T1 p2a Quash p1b; the order of p2a against p1a is the only Speed-dependent line. Target role: a known Quash user succeeds only if the hidden target has not moved yet | Spe 0 vs 32 | order of p2a vs p1a (user); Quash success or -fail (target) | NEW HOOK: R3 Quash turn (speed.mjs taints the whole turn) |
| `ability:prankster` | 6 | NOT SHOWN | Spe | p1a Weavile (Ice Shard, Spe SP 7 = 152); p2a Whimsicott (Prankster, slot 0; Spe 136..168) → T1 p1a Ice Shard p2a, p2a Tailwind: both +1 [same shape as Gale Wings] | Spe 0 vs 32 | order of the two \|move\| lines | GENERIC |
| `ability:unburden` | 6 | NOT SHOWN | Spe | p1a Regieleki (Spe SP 12 = 232), p1b Gardevoir (Knock Off); p2a Slurpuff (Unburden, H; Spe 92..124, x2 = 184..248) → T1 p1b Knock Off p2a; T2 race [ran] | Spe 0 vs 32 | order (T2) | GENERIC |
| `ability:steadfast` | 5 | NOT SHOWN | Spe | p1a Dragapult (Spe SP 27 = 189), p1b Incineroar (Fake Out); p2a Lucario (Steadfast, slot 0; Spe 110..142, x1.5 = 165..213) → T1 p1b Fake Out p2a (flinch, Spe +1); T2 race [ran] | Spe 0 vs 32 | order (T2) | GENERIC |
| `ability:magician` | 2 | NO CHANNEL ✓ | Spe (of two hidden targets) | Known Delphox (Magician, no item) Heat Wave T1 on hidden Blastoise (Smooth Rock) and hidden Charizard (Heat Rock, SP 0, Spe 120) | Blastoise Spe SP 21 vs 23 (Spe 119 vs 121; 22 is a tie) | names: `-item Delphox Heat Rock [of] Charizard` vs `-item Delphox Smooth Rock [of] Blastoise` | NEW HOOK: speedSort(hitTargets) inside onAfterMoveSecondarySelf is not under queue/fieldEvent/eachEvent, so speed.mjs never sees it. Run: world 23 REBUILD fails at that line, no Spe cut |
| `ability:moody` | 2 | MASKED | Spe | p1a a known pacer; p2a Glalie (Moody, H; Spe 100..132, +2 = x2) → end of T1 Moody boosts one random stat +2 and lowers another -1 (reseed until the line is \|-boost\|p2a\|spe\|2; the line only names the stat, it does not depend on a Stat Point); T2 race. Catalog "H:Spe" differences were the random draw. The O:Atk cell is the same as Stamina (see NO-STAT) | Spe 0 vs 32 | order (T2) | GENERIC (the stage is read by getActionSpeed) |
| `ability:galewings` | 1 | NOT SHOWN | Spe | p1a Weavile (Ice Shard, Spe SP 7 = 152); p2a Talonflame (Gale Wings, H) at full HP → T1 p1a Ice Shard p2a, p2a Brave Bird p1a: both +1, so Speed decides [ran]. Full HP is shown (100/100), so the hp===maxhp gate is no unknown | Spe 0 vs 32 (146 vs 178) | order of the two \|move\| lines | GENERIC (the +1 is in the action's priority; speed sort is the existing one) |
| `ability:imposter` | 1 | UNUSED | Spe (Atk, SpA) | p1a known Ditto (Imposter), p1b Gardevoir (Spe SP 14); p2a hidden Blastoise as the copied Pokemon → lead: Ditto copies p2a's stats; T1 order of Ditto vs the pacer. A hidden Ditto copying a known Pokemon has no hidden Speed left (it becomes the copied one's, a tie), so that cell is NO-STAT | Spe 0 vs 32 (the copied hidden Pokemon) | order of Ditto vs pacer | GENERIC |
| `ability:rattled` | 1 | NOT SHOWN | Spe | p1a Garchomp (Crunch, Spe SP 28 = 150); p2a Persian-Alola (Rattled, H; Spe 85..117, x1.5 after the boost) → T1 p1a Crunch p2a (Dark: Spe +1); T2 race [ran] | Spe 0 vs 32 | order (T2) | GENERIC |
| `ability:surgesurfer` | 1 | NOT SHOWN | Spe | p1a Regieleki (Timid, Spe SP 24 = 268), p1b Pawmot (Electric Terrain); p2a Raichu-Alola (Surge Surfer, slot 0; Spe 118..150, x2 = 236..300) → T1 p1b Electric Terrain; T2 race [ran] | Spe 0 vs 32 | order (T2) | GENERIC |
| `move:transform` | 1 | UNUSED | Spe (Atk, Def) | p1a Ditto (Transform), p1b Gardevoir (Spe SP 14 = 114: between a hidden Blastoise's 98 and 130); p2a Blastoise → T1 p1a Transform p2a; T2 Ditto now has Blastoise's Spe, race against the pacer [ran]. The catalog's UNUSED cells compare the copy with the original (identical Speed = a coin-flip tie), never a third Pokemon | Spe 0 vs 32 (hidden target) | order of Ditto vs pacer | GENERIC (the copied Spe is mapped through transformInto) |

#### M8 — a stat moved between Pokemon (2)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `move:powersplit` | 7 | READ-UNSEEN | SpA | p2a Mr. Mime (Power Split, Psychic), p1a Snorlax → T1 Power Split p1a (both get avg(Atk), avg(SpA)); T2 p2a Psychic p1a at the averaged SpA, and p1a special hit on p2a at the averaged SpA | SpA 0 vs 32 (hidden user) | known exact + hidden % | GENERIC |
| `move:guardsplit` | 6 | READ-UNSEEN | SpD | p2a Alakazam (Guard Split, Psychic), p1a Snorlax → T1 p2a Guard Split p1a (both get avg(Def), avg(SpD)); T2 p2a Psychic p1a: the known's new SpD carries the hidden SpD. Also T2 p1a special hit on p2a [ran with Bastiodon: hidden % 95 vs 96] | SpD 0 vs 32 (hidden user) | known exact (Alakazam Psychic) or hidden % | GENERIC (run dry per candidate, M8) |

#### M9 — a stat compared in a message (1)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `move:shellsidearm` | 1 | READ-UNSEEN | SpA, SpD | p2a Slowbro-Galar (Shell Side Arm; Atk SP 2) vs p1a Snorlax with Def SP 23, SpD SP 2 (Def 108, SpD 132) → T1 Shell Side Arm: physical = 44 > special 36 at SpA SP 0, special 46 at SpA SP 32 (flip at SP 28): the hint names Physical or Special. Hidden target is the same with its Def/SpD | SpA 0 vs 32 (flip at 28) | names: \|-hint\|Physical vs Special Shell Side Arm (and the damage) | NEW HOOK: R5 Shell Side Arm category per candidate (M9 has no hook) |

#### No mechanism yet (2)

| Effect | Users | Catalog | Stat | Battle: setup → turns | Worlds | What differs | Hook |
|---|---|---|---|---|---|---|---|
| `ability:illusion` | 2 | MASKED, UNUSED | Spe (and Spe of the Pokemon it faces) | p1a a known pacer (Arcanine Spe SP 26 = 141); p2a Zoroark (Illusion, slot 0; Spe 125..157) disguised as p2c Slowking → T1.. order lines print "p2a: Slowking" before the \|replace\| (a hit breaks it) | Spe 0 vs 32 | order of lines naming the disguise | NEW HOOK: R4 attribute order lines that name the disguise to the Illusion user (speed.mjs `named` gives nobody on an Illusion side) - probable, not run |
| `move:revivalblessing` | 1 | NOT SHOWN | HP (revived ally) | p1a Snorlax (Fissure), p2a Pawmot (Revival Blessing), p2b Avalugg (base HP 95) → T1 p1a Fissure p2b (faints); T2 p2a Revival Blessing revives it to floor(max/2) [ran] | ally HP SP 0 vs 1 (max 170 vs 171): 50/100y vs 49/100 | hidden % heal line + colour | NEW HOOK: R2 sethp(maxhp/2) (battle.ts:2793) becomes band("any"); needs a fraction scale |

### A.2 No Stat Point: the written reasons

These cannot carry a Stat Point on an open sheet, or cannot act in this format. Each becomes the entry's `reason` (Phase 1, item 7).

| Effect | Users | Verdict | Why (the handler) |
|---|---|---|---|
| `ability:battlearmor` | 2 | NO-STAT | onCriticalHit:false is a crit gate; the hit that follows is an ordinary M1 line. |
| `ability:battlebond` | 1 | CANNOT-ACT | onSourceAfterFaint and onModifyMove need species id `greninjabond` / Greninja-Ash; Greninja-Bond is isNonstandard "Past" and plain Greninja can only hold Battle Bond as an event slot the validator refuses (checked with TeamValidator). |
| `ability:corrosion` | 2 | NO-STAT | a status/type gate in Pokemon#setStatus (poison on Steel/Poison); the tick it enables is the ordinary psn/tox channel. |
| `ability:effectspore` | 1 | NO-STAT | onDamagingHit sleep/paralysis/poison by dice: a chance and a status. Its UNUSED cell is the order of two hidden Pokemon (both Speeds unknown), which no effect creates. |
| `ability:flamebody` | 3 | NO-STAT | onDamagingHit burns by a 30% chance: a chance and a status; the burn tick/Atk halving is the Will-O-Wisp witness. |
| `ability:forecast` | 1 | NO-STAT | onWeatherChange changes Castform's forme and type only (same base stats): a type. |
| `ability:gluttony` | 8 | NO-STAT | only the 25%-threshold Berries read `abilityState.gluttony` (items.ts, Figy/Wiki/Aguav/Iapapa/Mago and the stat Berries); none of them is in the legal item pool. |
| `ability:grassysurge` | 1 | NO-STAT | O:Atk cell: the terrain heals the known Rillaboom by its own max/16; the hidden Pokemon's Atk is carried only by the hit before it. The hidden-side HP and Def cells are already USED. |
| `ability:harvest` | 2 | NO-STAT | onResidual only gives the Berry back (setItem); its re-eat is the Berry's own channel. |
| `ability:infiltrator` | 8 | NO-STAT | onModifyMove sets infiltrates=true: bypasses screens and Substitute, which only removes a multiplier; the hit is an ordinary M1/M2 line. |
| `ability:merciless` | 1 | NO-STAT | onModifyCritRatio makes crits certain against a poisoned target: crit rate. |
| `ability:mimicry` | 1 | NO-STAT | onTerrainChange changes the holder's type only: a type. |
| `ability:mirrorarmor` | 1 | NO-STAT | onTryBoost bounces a stat drop (the `source.hp` read is only "alive"); the reflected drop is an ordinary stage change. |
| `ability:pickup` | 6 | NO-STAT | onResidual only gives an item back (setItem); nothing reads a stat. |
| `ability:poisonpoint` | 5 | NO-STAT | onDamagingHit poisons by a 30% chance: a chance and a status (psn tick is the Toxic witness). |
| `ability:poisontouch` | 3 | NO-STAT | onSourceDamagingHit poisons by a 30% chance: a chance and a status. |
| `ability:purepower` | 1 | NO-STAT | O:Spe cell: the known holder doubles its Atk; the hidden Pokemon's `Splash` line only appears or not with its survival (HP/Def, USED); the move reads no Speed. |
| `ability:scrappy` | 4 | NO-STAT | onModifyMove ignoreImmunity for Normal/Fighting and an Intimidate block: a type immunity gate; the damage it lets through is an ordinary M2 line. |
| `ability:screencleaner` | 1 | NO-STAT | onStart removes Reflect/Light Screen/Aurora Veil and prints \|-activate\|; it reads no stat. Voluntary switch-ins go p1 then p2 whatever the Speed (checked in the harness), so no order carries Spe either. |
| `ability:shedskin` | 3 | NO-STAT | onResidual cures a status by a 33% chance; its hp read is `pokemon.hp` (alive). |
| `ability:shellarmor` | 4 | NO-STAT | onCriticalHit:false is a crit gate; the hit that follows is an ordinary M1 line. |
| `ability:skilllink` | 1 | NO-STAT | onModifyMove sets multihit to its maximum: a hit count (a chance); each hit is an ordinary M2 line. |
| `ability:stamina` | 2 | NO-STAT | O:Atk cell: onDamagingHit boosts the known holder's Def, so a later hit repeats the same Atk the trigger hit already showed. Hidden-holder HP/Def are USED. |
| `ability:static` | 7 | NO-STAT | onDamagingHit paralyses by a 30% chance: a chance and a status (the Speed halving is the Thunder Wave witness). |
| `ability:stench` | 1 | NO-STAT | onModifyMove adds a 10% flinch secondary: a chance. |
| `ability:stickyhold` | 2 | NO-STAT | onTakeItem blocks item removal (it also stops Knock Off's 1.5x), an item gate; the hp read is only "alive". |
| `ability:superluck` | 1 | NO-STAT | onModifyCritRatio +1: crit rate. |
| `ability:symbiosis` | 3 | NO-STAT | onAllyAfterUseItem only passes the holder's item to the ally (takeItem/setItem). |
| `item:aspearberry` | 293 | NO-STAT | onUpdate/onEat cure freeze: a status. |
| `item:choicescarf` | 293 | NO-STAT | H:SpA cell: the Scarf reads only Speed (onModifySpe, USED); SpA is carried by the hit lines that masked it. |
| `item:damprock` | 293 | NO-STAT | lengthens rain (duration, in the weather condition): no handler of its own. |
| `item:ejectbutton` | 293 | NO-STAT | onAfterMoveSecondary reads `target.hp` (alive) and switches; the hidden holder's % is from the hit before it. |
| `item:heatrock` | 293 | NO-STAT | lengthens sun: duration. |
| `item:icyrock` | 293 | NO-STAT | lengthens snow: duration. |
| `item:kingsrock` | 293 | NO-STAT | onModifyMove adds a 10% flinch secondary: a chance. |
| `item:leek` | 2 | NO-STAT | onModifyCritRatio +2 for Farfetch'd/Sirfetch'd: crit rate. |
| `item:leftovers` | 293 | NO-STAT | O:Atk cell: the known holder heals its own max/16; the hidden attacker's Atk is carried only by the hit before it. H:HP is USED. |
| `item:leppaberry` | 293 | NO-STAT | onEat restores 10 PP; its hp read is only `!pokemon.hp`. |
| `item:lightclay` | 293 | NO-STAT | lengthens screens: duration. |
| `item:oranberry` | 293 | NO-STAT | H:Def cell: Oran heals a flat 10 (HP USED); Def is carried only by the hit before it. |
| `item:redcard` | 293 | NO-STAT | onAfterMoveSecondary reads `source.hp && target.hp` (both alive) and forces a switch; the Atk channel is already USED. |
| `item:scopelens` | 293 | NO-STAT | onModifyCritRatio +1: crit rate. |
| `item:smoothrock` | 293 | NO-STAT | lengthens sand: duration. |
| `item:terrainextender` | 293 | NO-STAT | lengthens terrain: duration. |
| `move:healingwish` | 10 | NO-STAT | onTryHit/selfdestruct then heals the replacement to full (100/100 at any max HP) and cures it; nothing it prints depends on a Stat Point. |
| `move:recycle` | 12 | NO-STAT | onHit only sets `lastItem` back (setItem) and prints \|-item\|; nothing it does reads a stat. A re-eaten Sitrus/Oran is that Berry's own M4/M6 channel. |
| `move:rest` | 292 | NO-STAT | heals to full: a hidden user shows 100/100 at every max HP, a known one its own exact line; the sleep is a status. |
| `move:sludgewave` | 29 | NO-STAT | Def cell: the move is special, so its own lines read SpD (USED), HP (USED) and the target's psn tick; Def is carried only by the physical witness hit that masked it. |

