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
- Heavy runs never go on the laptop. They go to the Aalto workstations, as
  `~/.agents/AALTO_COMPUTE.md` says (outside the repo, beside the global `AGENTS.md`).

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
- A change to inference, reconstruction or the order reader: `npm run score` (the quick slice) and
  `npm run catalog -- --regress` (15 entries, about 3 minutes on 8 threads) pass while you work.
  Before merging, the full tier passes on the Aalto workstations (`score.sh`, in the compute
  guide). A score run fails on any removed possibility, any case whose result got worse, and any
  Pokémon left with more spreads than the baseline (`scripts/fixtures/score-baseline.json`).
  When a full run improves on it, or is worse on purpose (a soundness fix keeps more spreads),
  accept it (`npm run score -- --tier full --accept`, or `--merge` the shares with `--accept`) in
  the same commit, so the diff shows what moved. After a batch of such changes, run the full
  catalog on the workstations too.
- An extension change, or any change in `scripts/lib/inference/` (the extension bundles it):
  `npm run extension -- --check`.
- Anything visible: open it and look. A passing script is not proof the board looks right.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Checks the loopback binding, that the format loads, and that `speed.mjs` reads or deliberately ignores every action kind the simulator queues. About 10 s |
| `npm run replay` | The determinism proof: play the fixture (or `--from <log.json>`), re-simulate, diff, and render a replay page. `--force` with `--at` and `--seed` replays with named dice forced |
| `npm run live -- --at <turn>` | Restore a recording at a turn, playable from both sides in two windows |
| `npm run battle` | Record a new battle in two windows |
| `npm run reconstruct` | Rebuild an input log from a saved replay: `--from <replay> --teams <key> --infer p1\|p2\|both`, with `--sheets closed` to withhold the sheet and `--certify`/`--outside` to prove range ends. `--all --rung s1\|s2\|s3` runs over `recordings/local/`; `--saved` runs over the owner's saved games |
| `npm run catalog` | Every effect Reg M-C allows, put through small battles: what it reveals and whether the inference uses it. The full pool takes about an hour on 8–13 threads; unchanged effects reuse `.cache/catalog/`, where the reports `evidence-open-sheets.md` and `evidence-closed-sheets.md` are written. Also `--regress`, `--fuzz <n> --seed <s>`, `--dump`, `--check` |
| `npm run score` | The grade: every battle in `scripts/fixtures/benchmark.js` (the 29 recordings and fuzz battles 101–300) inferred from three views - p2 from p1's screen, p1 from p2's, both from a spectator's - and checked against the answers it was played with: real spreads kept, the result, spreads left, work. Then compared with the baseline. `--tier quick\|full`, `--only`, `--views`, `--shard`/`--merge`, `--accept`. The full tier is about 75 minutes on all workstations, most of it a few spectator cases |
| `npm run extension` | Build the Chrome extension into `extension/dist/`. `--check` proves it against the Node reference in a throwaway Chrome |
| `npm run serve`, `npm run stop` | The static client host on its own; kill the servers |

Every flag is in the usage comment at the top of `scripts/local-<command>.mjs`. Each rung
withholds more than the last: S1 the choices, S2 also the seed, S3 also the opponent's exact HP. A
saved replay is always S4.

## Where things are

| Path | What |
|---|---|
| `scripts/local-<name>.mjs` | One per command, with a `package.json` script and a root `<name>.bat` |
| `scripts/lib/` | Shared Node machinery. `reconstruct.mjs` rebuilds a battle. `replay-source.mjs` reads any source, and its `setsFromLog` reads a replay with no sheet. `protocol.mjs` is the one log filter and diff. `rng-control.mjs` and `truncate.mjs` are the dice and the cut. `fuzz.mjs` plays a fuzz battle from its number |
| `scripts/lib/inference/` | `infer.mjs`: rounds of guess, rebuild, evidence. `knowledge.mjs`: what is still possible. `evidence.mjs`: the simulator hooked at every hit, HP change and item check. `speed.mjs`: order, read from every speed sort |
| `scripts/server/` | Runs inside the Showdown server: CommonJS, copied into `runtime/config/`. `rng-command.js` is the one RNG interceptor |
| `scripts/client/` | Browser scripts served over HTTP |
| `scripts/fixtures/` | CommonJS. `teams.js` holds the owner's teams as export text; `catalog.js` holds the catalog's cast and hand-set battles; `benchmark.js` the battles `npm run score` grades. `score-baseline.json` is written by `npm run score -- --accept`, never by hand |
| `extension/` | `src/` is bundled for Chrome (a new entry point goes in `ENTRIES` in `scripts/local-extension.mjs`). `src/node/` holds browser stand-ins for Node built-ins. `check/` holds Node checks named in `CHECKS` |
| `recordings/local/{scripted,branched,self-play,probes}/` | Battles our server ran, with full input logs: the ground truth. `npm run replay` files new ones; probes are filed by hand |
| `recordings/showdown/{mine,others}-{open,closed}/`, `full-sheets/` | Replays from play.pokemonshowdown.com, as the downloaded `.html` or the link's `.json`. *open*: the replay has `\|showteam\|`. *mine*: the owner played. *full-sheets*: both complete sheets are known |
| `recordings/reconstructed/` | Input logs written by `npm run reconstruct` |
| `.github/workflows/check.yml` | GitHub Actions on every push: `npm run check`, one score case against the baseline, the extension check |
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
- **Limits:** every rebuild and inference names why it stopped and every search limit it hit (the
  `stopped:` line of `npm run reconstruct`). A run that reproduced the log is proof whatever limits
  it hit on the way; most finished ones hit some, because wrong guesses get small budgets first. A
  run that did not reproduce it proves nothing about what it did not reach.
- **Recordings and the pin:** a few recordings no longer play as they were saved under the pinned
  simulator (regmb-23, regmb-76); `npm run score` grades the battle their input log plays now.
- **Local server:** it rebuilds the simulator when it starts after provisioning. If
  `npm run replay` reports the servers did not come up, start `npm run serve` and wait for ports
  8000 and 8080. A server killed mid-build leaves `runtime/dist` broken, and the next start fails
  loading learnsets: delete `runtime/dist` and run `node build` in `runtime/`.

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

## Archive

The old documents are history at commit `c4c2351`, for example
`git show c4c2351:docs/engineering.md`. That covers `docs/` (`engineering.md`, `plan.md`,
`open-sheet-plan.md`, `closed-sheet-plan.md`, `evidence-catalog.md`, `extension.md`,
`branching.md`, `evidence-by-hand.md`) and the folder READMEs. Among those,
`recordings/local/probes/README.md` says what each probe recording must conclude. Read the archive
only when a line here points there; it is not maintained.

The plans and open problems this file listed until the scorer existed (closed team sheets phases
2-7, inferring both sides, usage priors, search limits, the 2026-10-23 audit) are at
`git show 07236ff:AGENTS.md`. What to work on next comes from `npm run score` and the catalog.
