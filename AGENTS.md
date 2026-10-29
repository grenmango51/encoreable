# Encoreable — agent guide

This is the only instruction file; `README.md` is for people. Nothing else in the repo is
documentation. A rule that code can check becomes a check, and a work list comes from a command's
output, not prose. Keep this file short: when you change what it describes, change it in the same
commit.

## What this is

An analysis board for competitive Pokémon. A recorded or replayed Showdown battle is restored at
any turn in the real Showdown UI and played forward for both sides, with the dice under control.
The part under active work is the **inference**: what a replay proves about hidden sets (Stat
Points, items, abilities, natures, moves). The simulator does the proving, never rules of ours.

The target is `[Gen 9 Champions] VGC 2026 Reg M-C`, doubles: `gen9championsvgc2026regmc`, Bo3
`gen9championsvgc2026regmcbo3`. Champions comes first. Other formats wait until it is done, then
get discussed with the owner (Champions singles and OU are the likely next ones; Gen 9 VGC is not
planned).

## Every session

- `git pull` first. Work on `main` or a short branch merged into it, and push what you finish:
  the owner works from several devices.
- Node 22.18+ (`C:\Program Files\nodejs` on the Windows laptop), then `npm install` once.
- Heavy runs never go on the laptop. Use **Compute**.

## Compute

Use the Aalto workstations, 10 cores and 30 GB each. This line runs any command on a pushed
branch or commit, in a worktree of its own, with Node 24, under `nice`:

    ssh kosh 'ssh <host>.org.aalto.fi bash ~/projects/encoreable-cluster/run-branch.sh <branch-or-sha> <command>'

The hosts are agda, effrafax, fenchurch, gargravarr, hactar, kapelsen, lallafa, loonquawl,
lunkwill, nullify, phouchg, poodoo, prefect, quordlepleen, random, thrashbarg, tragula,
vantrashell, varntvar, versenwald, vranx, vroomfondel, wonko, wowbagger, zarniwoop, zarquon and
zem.

- The hosts are shared with students. Use hosts whose load is under 1 (`cat /proc/loadavg`), at
  most 8 workers per host and 10 hosts at a time.
- Access is by SSH key, through the owner's home server (`ssh aalto-server`), which keeps a
  gateway to `kosh` open. Never ask for the Aalto password; nothing needs it.
- If `ssh kosh` fails on the laptop after a network change, run `aalto-link status` to re-sync
  the route. If the gateway is closed: `ssh aalto-server '~/.local/bin/aalto-link on 0'`.
- Long agent sessions run on the home server, in `~/projects/github/grenmango51/encoreable`.

## Hard rules

1. **Showdown's simulator is the only source of mechanics.** Never write damage, accuracy, speed,
   turn-order or status logic, and never modify the simulator. Change only its `config/`, through
   `scripts/provision-local-server.mjs`.
2. **Never remove a possibility the replay allows.** A spread or set that could have produced the
   log stays. A line a shortcut cannot read is set aside, never trusted, and a search that ran out
   of budget proves nothing. Precision can be given up; soundness cannot.
3. **One hook per mechanism, never one per move.** A fix that names a move is the wrong fix.
4. **`recordings/local/` cannot be regenerated.** Never delete or rewrite a file there, or a saved
   replay (its owner can take it down).
5. **Showdown is pinned** in `package.json` to upstream commit `a5df827`. Before
   upgrading, diff the internal call sites listed in the archive's `engineering.md` §6.5. After
   upgrading, run **Done means**, plus `npm run reconstruct -- --all` at `--rung s2`, `--rung s3`
   and `--rung s3 --infer p2`.
6. **Not built, on purpose:** move advice, an evaluation function, an opponent bot, a battle UI of
   our own (the native client is the UI). Ask before anything close to these.

## Done means

- `npm run check` passes, and `npm run replay` still reproduces exactly.
- A change to inference, reconstruction or the order reader: `npm run catalog -- --regress` passes
  (15 entries, about 3 minutes on 8 threads). `npm run reconstruct -- --all --rung s3 --infer p2`
  must keep every real spread. After a batch of such changes, run the full fuzz and catalog on
  Compute.
- An extension change, or any change in `scripts/lib/inference/` (the extension bundles it):
  `npm run extension -- --check`.
- Anything visible: open it and look. A passing script is not proof the board looks right.
- No number in **Baseline** gets worse. When one improves, update it in the same commit.

## Baseline (2026-10-25, commit `7e7406e`; until a command writes it)

| Check | Result |
|---|---|
| `npm run catalog -- --regress` | 15/15 |
| `npm run reconstruct -- --all --rung s3 --infer p2` | 29/29 MATCH, 115/115 real spreads kept |
| `--all --rung s2` / `--rung s3` | 28/29 / 27/29. Both fail on regmc-296, where Ditto's transformed Body Slam fails the supplied-team check; s3 also fails on regmc-1, Clefable's turn-2 HP |
| `npm run reconstruct -- --saved` | 17/24 |
| `npm run catalog -- --fuzz 200 --seed 101` | 195/200 MATCH, every real spread kept, no exceptions. Seeds 101, 208, 220, 225 and 281 fail; only 220 also fails with the real spreads |
| full `npm run catalog` (917 effects) | no legal effect removes a real spread on open sheets |

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Checks the loopback binding, that the format loads, and that `speed.mjs` reads or deliberately ignores every action kind the simulator queues. About 10 s |
| `npm run replay` | The determinism proof: play the fixture (or `--from <log.json>`), re-simulate, diff, and render a replay page. `--force` with `--at` and `--seed` replays with named dice forced |
| `npm run live -- --at <turn>` | Restore a recording at a turn, playable from both sides in two windows |
| `npm run battle` | Record a new battle in two windows |
| `npm run reconstruct` | Rebuild an input log from a saved replay: `--from <replay> --teams <key> --infer p1\|p2\|both`, with `--sheets closed` to withhold the sheet and `--certify`/`--outside` to prove range ends. `--all --rung s1\|s2\|s3` runs over `recordings/local/`; `--saved` runs over the owner's saved games |
| `npm run catalog` | Every effect Reg M-C allows, put through small battles: what it reveals and whether the inference uses it. The full pool takes about an hour on 8–13 threads; unchanged effects reuse `.cache/catalog/`, where the reports `evidence-open-sheets.md` and `evidence-closed-sheets.md` are written. Also `--regress`, `--fuzz <n> --seed <s>`, `--dump`, `--check` |
| `npm run extension` | Build the Chrome extension into `extension/dist/`. `--check` proves it against the Node reference in a throwaway Chrome |
| `npm run serve`, `npm run stop` | The static client host on its own; kill the servers |

Every flag is in the usage comment at the top of `scripts/local-<command>.mjs`. Each rung
withholds more than the last: S1 the choices, S2 also the seed, S3 also the opponent's exact HP. A
saved replay is always S4.

## Where things are

| Path | What |
|---|---|
| `scripts/local-<name>.mjs` | One per command, with a `package.json` script and a root `<name>.bat` |
| `scripts/lib/` | Shared Node machinery. `reconstruct.mjs` rebuilds a battle. `replay-source.mjs` reads any source, and its `setsFromLog` reads a replay with no sheet. `protocol.mjs` is the one log filter and diff. `rng-control.mjs` and `truncate.mjs` are the dice and the cut |
| `scripts/lib/inference/` | `infer.mjs`: rounds of guess, rebuild, evidence. `knowledge.mjs`: what is still possible. `evidence.mjs`: the simulator hooked at every hit, HP change and item check. `speed.mjs`: order, read from every speed sort |
| `scripts/server/` | Runs inside the Showdown server: CommonJS, copied into `runtime/config/`. `rng-command.js` is the one RNG interceptor |
| `scripts/client/` | Browser scripts served over HTTP |
| `scripts/fixtures/` | CommonJS. `teams.js` holds the owner's teams as export text; `catalog.js` holds the catalog's cast and hand-set battles |
| `extension/` | `src/` is bundled for Chrome (a new entry point goes in `ENTRIES` in `scripts/local-extension.mjs`). `src/node/` holds browser stand-ins for Node built-ins. `check/` holds Node checks named in `CHECKS` |
| `recordings/local/{scripted,branched,self-play,probes}/` | Battles our server ran, with full input logs: the ground truth. `npm run replay` files new ones; probes are filed by hand |
| `recordings/showdown/{mine,others}-{open,closed}/`, `full-sheets/` | Replays from play.pokemonshowdown.com, as the downloaded `.html` or the link's `.json`. *open*: the replay has `\|showteam\|`. *mine*: the owner played. *full-sheets*: both complete sheets are known |
| `recordings/reconstructed/` | Input logs written by `npm run reconstruct` |
| `recordings/video/`, `replays/`, `runtime/`, `vendor/`, `extension/dist/`, `.cache/<command>/` | Gitignored: generated or too big. Never hand-edited |

A new file goes in the row it fits. If it fits none, ask the owner first, naming the file. `.mjs`
is a Node module. `.js` under `scripts/client/` and `extension/src/` is browser code; `.js` under
`scripts/fixtures/` and `scripts/server/` is CommonJS. Scratch scripts live in the session
scratchpad and get deleted. Only a battle worth keeping goes to `recordings/local/probes/`.

## Facts that cost time to learn

- **Champions stats at level 50:** HP = base + SP + 75; every other stat = base + SP + 20, then
  the nature with 16-bit truncation. One Stat Point is one stat point, exactly invertible. At most
  32 per stat, 66 in all, every IV 31. Every move's base PP is capped at 20. A VGC team still needs
  six Pokémon.
- **Choices and turns:** read legal choices from `side.activeRequest`, never from scraped
  protocol. Turn boundaries cannot be found by counting lines, so replay one line at a time.
- **Never send `/choose default`:** it records a move without its target, and the input log
  cannot be replayed. A hidden disable can force Struggle, recorded as `move struggle`, which no
  request offered.
- **Comparing protocol:** go through `battleLines()` in `protocol.mjs`, which normalises room
  noise, ratings and the newer wording of the ladder. Public replays come from upstream's latest
  simulator, not our pin.
- **Seeds and state:** seeds are strings (`sodium,…` is SodiumRNG). Never regenerate a team from a
  seed; read the packed teams from the input log's `>player` lines. `State` is not exported, so use
  `Battle.toJSON()` and `Battle.fromJSON()`.
- **Views:** a public replay is the spectator's view (channel 0), with both sides' HP as
  percentages. A page downloaded from the battle room shows the uploader's own HP exactly.

## Dead ends — do not retry

- **Searching for a seed.** Dice are settled one at a time, by ordinal, as they are thrown.
- **Editing damage after the fact.** The damage ladder is sparse; force the dice instead (`>rng`).
- **Rules of ours** ("Choice Scarf is ×1.5 Speed") **and hand-written lists of kinds.** A list
  skips what it does not name; that is how `'instaswitch'` went unread. Classify exhaustively, and
  make a check fail on anything unclassified (`ACTION_KINDS` in `speed.mjs` is the model).
- **Reading a failed rebuild line as a wrong guess.** It can also be a search out of budget, or a
  bad hand-off between rounds. The fuzz retries with the real spreads to tell them apart.
- **Wall-clock limits in anything that decides a verdict.** They make results machine-dependent;
  count work instead.
- **`@pkmn/client` and `pkmn/engine`.** The first is not needed: the simulator tracks its own
  state. The second has no modern generations.

## Now: closed team sheets (phases 0–1 built)

A Bo1 replay has no `|showteam|`, so the opponent's item, ability, nature and unrevealed moves are
unknown as well as its Stat Points.

**Today:** `setsFromLog` reads every name the log shows and assumes the rest: no item, the first
ability the log does not rule out, a neutral nature. The inference then treats those assumptions
as known. The catalog finds 56 ability, 67 item and 28 nature witnesses where a wrong assumption
removes the real spread.

**The work** replaces assumption with elimination. Each unknown box becomes a list of candidates,
and a candidate goes only when the simulator says no spread under it fits.

- **Phase 2:** candidate lists per Pokémon: every item the validator allows plus none, the ability
  slots, and 21 nature classes. Then an equivalence replay that finds which candidates act in this
  battle, and the evidence that needs no spread: would-have-named, illegal choices, impossible
  dice, Item Clause.
- **Phase 3:** natures per class, through `knowledge.mjs`, `evidence.mjs` and `infer.mjs`.
- **Phase 4:** silent items and abilities in the dry runs. First Choice Scarf and Iron Ball through
  order, then the damage boosters, then the abilities.
- **Phase 5:** HP-threshold triggers and stateful candidates: Berries, Focus Sash, Sturdy, Choice
  lock, Unburden, consumed items.
- **Phase 6:** six closed probe recordings.
- **Phase 7:** every `mine-closed` replay.
- **Done when:**
  - `npm run reconstruct -- --all --rung s3 --infer p2 --sheets closed` is a MATCH on every
    recording and keeps every true item, ability, nature and spread;
  - the same run without `--sheets closed` is unchanged;
  - the closed catalog report has nothing UNSOUND or REBUILD-FAILED;
  - MercifulBird's Gardevoir (its replay is in `mine-closed/`) keeps Choice Scarf and the +Spe
    natures.
- **Design detail and evidence lists:** the archive's `closed-sheet-plan.md` §3 and Appendix B.

## Next: grading by machine (approved, not built)

- `npm run score` grades the engine over a corpus of public replays. Soundness is a hard zero;
  every other number is a ratchet that may only improve.
- Open-sheet replays are graded as closed ones, against their own sheets.
- `npm run corpus` crawls replay.pokemonshowdown.com into the Aalto home, as one compressed file
  per format per day. Git keeps only the replays that exposed a bug, and the benchmark's list of
  replay IDs.
- A GitHub Actions check runs on every push.

## Open problems

- **Both sides unknown** (`--infer both`): frozen at 50–110 s with wide ranges. This is also what
  the extension does on someone else's replay.
- **No prior yet:** surviving spreads are not ranked by what people run. Smogon publishes usage
  stats for Champions.
- **Search limits:** dice that must change together beyond the pair search are not found, and
  reading more dice off the replay is deferred. Fuzz seed 220 fails even with the real spreads;
  its first differing die is an accuracy draw, and the cause is not established.
- **The 83-finding implementation audit of 2026-10-23** is in the archive's `engineering.md` §12.
  Its starting order: A32 (one verification contract), A28 (RNG tooltip cache across rooms), A50
  (an incomplete search must not eliminate), A67 (HP backtracker classification), A44 (format
  admission), A71 (supplied-team identities), A13 (recording persistence), A14 (profile before
  optimising).
- **Unmerged:** branch `campaign/format-expansion` (Gen 9 OU and Random Battles with known teams),
  parked until formats come up.

## Archive

The old documents are history at commit `c4c2351`, for example
`git show c4c2351:docs/engineering.md`. That covers `docs/` (`engineering.md`, `plan.md`,
`open-sheet-plan.md`, `closed-sheet-plan.md`, `evidence-catalog.md`, `extension.md`,
`branching.md`, `evidence-by-hand.md`) and the folder READMEs. Among those,
`recordings/local/probes/README.md` says what each probe recording must conclude. Read the archive
only when a line here points there; it is not maintained.
