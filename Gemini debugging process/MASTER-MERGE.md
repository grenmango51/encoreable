# Encoreable Inference & Reconstruction — Master Merge Index & Executive Synthesis

**Corpus:** 392 diagnostic failure reports (`382 gaveup-*.md`, `4 crash-*.md`, `1 nomatch-*.md`, `5 removed-*.md`)  
**Baseline Reference:** `origin/main` (`61378f1`)  
**Deduplication Result:** **36** canonical root-cause buckets (`F01`–`F36`), accounting for **392 / 392** reports (0 omitted, 0 duplicated).

---

## 1. Corpus Accounting

| Metric | Unique Failures (`FXX`) | Report Count | Share of Corpus | Notes |
|---|---:|---:|---:|---|
| **Total Diagnostic Corpus** | **36** (`F01`–`F36`) | **392** | **100.0%** | `382 gaveup` + `4 crash` + `1 nomatch` + `5 removed` |
| **Already Fixed on `origin/main` (`61378f1`)** | **3** (`F01`, `F02`, `F05`) | **9** | **2.3%** | `F01` (`ac15996`, 5), `F02` (`edf07ed`, 3), `F05` (`2e0cf13`, 1) |
| **Live Unfixed Failures** | **33** (`F03`–`F04`, `F06`–`F36`) | **383** | **97.7%** | Each `FXX` is 1 unique mechanism requiring 1 cohesive fix |

### Live Unfixed Failures by Architectural Tier

| Tier | Layer & Scope | Buckets | Unique Failures | Live Reports | % of Live (383) |
|---|---|---|---:|---:|---:|
| **Tier 0** | Immediate Crash & Soundness Blockers (`evidence.mjs`, `speed.mjs`) | `F03`–`F04` | 2 | 2 | 0.5% |
| **Tier 1** | Deterministic `reconstruct.mjs` Bugs Breaking All 3 Views | `F06`–`F15` | 10 | 91 | 23.8% |
| **Tier 2** | Missing `speed.mjs` & `evidence.mjs` Mechanism Hooks | `F16`–`F27` | 12 | 56 | 14.6% |
| **Tier 3** | `knowledge.mjs` & `infer.mjs` Search Coordinator Bugs | `F28`–`F34` | 7 | 101 | 26.4% |
| **Tier 4** | Coupled Multi-Variable Channel-0 Solver & Single-View Exact-HP Search | `F35`–`F36` | 2 | 133 | 34.7% |
| **Total Live** | — | **`F03`–`F04`, `F06`–`F36`** | **33** | **383** | **100.0%** |

---

## 2. Summary Table of All 36 Unique Failures (`F01`–`F36`)

> **Accounting check:** `5 + 3 + 1 + 1 + 1 + 7 + 8 + 1 + 8 + 11 + 3 + 2 + 31 + 10 + 10 + 3 + 8 + 10 + 12 + 5 + 9 + 3 + 2 + 1 + 1 + 1 + 1 + 15 + 3 + 4 + 1 + 13 + 7 + 58 + 109 + 24 = 392`.

| ID | Category | Status | Subsystem | Reports | Unique Root-Cause Failure | Single Cohesive Fix |
|---|---|---|---:|---:|---|---|
| [F01](merged/F01-transform-imposter-post-mega-forme.md) | 1. Crashes & Soundness Removals | **FIXED (`ac15996`)** | `evidence.mjs` | 5 | `Transform`/`Imposter` `depOf()` reads target's post-Mega `pokemon.species` instead of the pre-Mega forme copied at transform time. | Snapshot copied species/forme in `transformInto()` and pass override into `rec.stat()` inside `depOf()`. |
| [F02](merged/F02-fuzz-hidden-disable-struggle-inputlog.md) | 1. Crashes & Soundness Removals | **FIXED (`edf07ed`)** | `fuzz.mjs` | 3 | `fuzz.mjs` lacked `battle.inputLog.push` raw-choice interceptor, logging unreplayable `move struggle` on hidden-disable turns. | Install raw-choice `battle.inputLog.push` interceptor in `fuzz.mjs` matching `reconstruct.mjs`. |
| [F03](merged/F03-analysehit-null-sstates-transformed-source.md) | 1. Crashes & Soundness Removals | **LIVE** | `evidence.mjs` | 1 | `analyseHit()` dereferences `s[2]` on `null` fallback in `sStates` (`[null]`) when a `Transform`/`Imposter` source's `X.chain` is empty. | Guard against `s === null` (empty `sStates` / `X.chain`) before indexing `s[2]` for `r.by === 'x'`, returning unsupported cleanly. |
| [F04](merged/F04-switchin-readhandlersort-trick-room-speed.md) | 1. Crashes & Soundness Removals | **LIVE** | `speed.mjs` | 1 | `readHandlerSort(..., switchIn=true)` consumes Trick-Room-negated `getActionSpeed()` instead of raw `pokemon.speed`, emitting inverted speed rules that wipe valid spreads. | Build `SwitchIn` handler speed tables from raw `pokemon.speed` (uninverted by Trick Room) in `speed.mjs`. |
| [F05](merged/F05-illusion-multidisguise-end-slot-order.md) | 2. Deterministic Reconstruction & Illusion | **FIXED (`2e0cf13`)** | `reconstruct.mjs` | 1 | `choiceFor(teamPreview)` placed multi-disguise Illusion forms in forward order into `last`, spawning Turn 0 with the later disguise. | Permute `last` with earliest non-lead disguise last (`last.slice().reverse()`) and walk alternative orders as variants. |
| [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | 2. Deterministic Reconstruction & Illusion | **LIVE** | `reconstruct.mjs` / `protocol.mjs` / `infer.mjs` | 7 | `choiceFor(teamPreview)` locks leads out of `last` and freezes non-lead slots across mid-battle party rotation; `watchParty()` ignores `activeMove === null` switch-ins; `unmaskIllusion()`/`disguisableStays()` skips `turn > failing` & wastes 4-tier searches on impossible masks. | Record switch-phase `side.pokemon` reads in `watchParty()` regardless of `activeMove`; enumerate back-slot permutations including retreating leads; detect same-species Illusion impossibilities in `unmaskIllusion`/`disguisableStays`; filter impossible masks before `spareDisguises()`. |
| [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | 2. Deterministic Reconstruction & Illusion | **LIVE** | `reconstruct.mjs` | 8 | `planSegment()` skips `encored` `|move|` lines before checking `from === 'lockedmove'` or `||[still]` charge turns, breaking `recoverChargeTargets()`/`carriedInto()` and defaulting targets to `+1`. | Inspect `tagsOf(line).from` before the `encored` skip in `planSegment()`, retain `[from] lockedmove` and Encored `||[still]` `needsTarget` metadata, and recover `target`/`landsOn` in `recoverChargeTargets()`. |
| [F08](merged/F08-recoverchargetargets-same-turn-anim-and-rewalk-poison.md) | 2. Deterministic Reconstruction & Illusion | **LIVE** | `reconstruct.mjs` | 1 | `recoverChargeTargets()` only scans `plans.slice(k + 1)`, missing same-turn `|-anim|` targets (e.g., Electro Shot in Rain); Variant 0 then commits fallback dice into `partial.subs` that poison `rewalk()` on Variant 3. | Extract targets from same-turn `|-anim|` lines in `planSegment()`/`recoverChargeTargets()`, and clear speculative fallback dice committed at or after Variant 0's divergence in `rewalk()`. |
| [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | 2. Deterministic Reconstruction & Illusion | **LIVE** | `reconstruct.mjs` | 8 | `planSegment()` keeps `revived` armed across the full turn, swallowing genuine bench-revived upkeep `|switch|` lines (`choiceFor` sends `pass`), while `scoreOf()` returns `[-1, 0, 0]` for `diff.index < 0`, masking `state.unsatisfied`. | Only consume an immediate `instaswitch` for an empty active slot (clearing `revived` before later events) and enqueue upkeep switches in `plan.forced`; rank `state.unsatisfied` at `gotHard.length` in `scoreOf()`. |
| [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | 2. Deterministic Reconstruction & Illusion | **LIVE** | `reconstruct.mjs` / `protocol.mjs` | 11 | `CHOOSABLE_TARGETS` omits `allAdjacentFoes`, so spread moves use unsteered `getRandomTarget()`/`randomFoe()` to pick a cosmetic primary slot strictly compared by `battleLines()`. | Intercept `getRandomTarget()`/`side.randomFoe()` (`battle.sample`) inside `steerDice()` and steer it to the observed `[spread]` primary target slot (preserving PRNG draw parity). |
| [F11](merged/F11-single-target-move-variant-exhaustion-and-sp-fallback.md) | 2. Deterministic Reconstruction & Illusion | **LIVE** | `reconstruct.mjs` / `infer.mjs` | 3 | `reconstruct` fails to walk alternative single-target move slots when a turn has 0 preceding dice or un-hinted `||[still]`, and `fallback()` wastes 128–240 SP rebuilds on target-only diffs. | Explore/prioritize alternative target-slot variants when a `|move|` line differs solely in target slot, and skip SP `fallback()` sweeps on same-actor/same-move target-only diffs. |
| [F12](merged/F12-steerdice-fixes-simultaneous-spread-ordinal-shift.md) | 3. RNG Steering & Variant Budgets | **LIVE** | `reconstruct.mjs` | 2 | `steerDice`/`resolveTurn` commits multiple `fixes` simultaneously on spread moves; forcing an earlier target miss drops its 2 `getDamage` draws and shifts the second committed ordinal onto `secondaries()`. | Apply `fixes` sequentially (or stop collecting downstream `wrong` draws after the first accuracy/count-altering fix on a spread move) so ordinals recompute cleanly. |
| [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | 3. RNG Steering & Variant Budgets | **LIVE** | `reconstruct.mjs` / `infer.mjs` | 31 | `steerDice` ignores `secondaries` (`random(100)`/`sample(3)`), contact procs, `FractionalPriority`, `confusion`, multi-hit crit, and mid-turn `forceSwitch` crits; `infer.mjs:624` misclassifies status/unboost/crit/activate diffs as `order = true`. | Steer secondary `random(100)`/`sample(3)`, contact-ability procs, `FractionalPriority`, and mid-turn crits in `steerDice`/`resolveTurn`, and restrict `infer.mjs:624` `order = true` strictly to `ACTION_START` lines. |
| [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | 3. RNG Steering & Variant Budgets | **LIVE** | `reconstruct.mjs` | 10 | `pairs` skips `span === 2` speed-tie draws and gates on `scoreOf[0] > score[0]`; `brought` inspects only the first shifted draw and skips `b.chance`; greedy `outranks` reverts prerequisite flinch removals. | Include `span === 2` speed ties in `pairs`, replace `scoreOf[0] > score[0]` with `outranks(...)`, inspect all newly exposed draws (including `b.chance`) in `brought`, and allow two-step steering past `|cant|` blockers. |
| [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | 3. RNG Steering & Variant Budgets | **LIVE** | `reconstruct.mjs` / `infer.mjs` | 10 | `choiceFor` orders invisible (flinch/par/fainted) moves without priority awareness; `reconstructOnce` shares one `spent[t]` across variants (`MAX_VARIANTS=256`); `infer.mjs:624` treats priority jumps as Speed `order = true`. | Rank/prune invisible-choice variants by priority consistency with observed action order, give each variant a guaranteed probe budget, and skip Speed `fallback` on unbeatable priority-bracket jumps. |
| [F16](merged/F16-turn0-switchin-cachedspeed-silent-handler-and-fallback-guard.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `speed.mjs` / `infer.mjs` / `evidence.mjs` | 3 | Turn-0 `SwitchIn` speed failures fail silently: `cachedSpeed` is unset on initial leads, `handlerSorts` drops silent-prefix swaps, `seen` is empty without HP chains, and `fallback` blocks `t === 0` (`!(t >= 1)`). | Initialize `rec.cachedSpeed` for Turn-0 leads in `attachSpeed()`, emit `handlerSorts` rules across silent prefixes before `|turn|1`, include `SwitchIn` actors in `seen`, and allow `fallback()` at `t >= 0`. |
| [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `speed.mjs` | 8 | `sorted()` requires `|move|` and returns false on `|cant|...|flinch`/`par`, while `between()` requires `a.priority === x.priority` against an earlier `+3 Fake Out`, emitting zero speed bounds. | Infer speed bounds on `|cant|...|flinch`/`par` from legal moveset priority brackets without requiring `a.priority === x.priority` against an earlier flincher. |
| [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `speed.mjs` / `knowledge.mjs` / `infer.mjs` | 10 | 1D `[min, max]` endpoint pruning ignores overlapping speed ranges and mutual `Spe_A === Spe_B` ties; `choose()` samples `spe` independently and `fallback` runs `maxBacktracks: 0` unable to flip tie coins. | Model pairwise `Spe_A >= Spe_B` and `Spe_A === Spe_B` constraints in `knowledge`/`choose()`, co-sample tied `spe` SPs, and allow `fallback`/`resolveTurn` to probe exact ties + tie-breaker flips. |
| [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` / `infer.mjs` | 12 | `provenLines()` returns `null` at `cutoffAt` when `got` pops `Focus Sash` vs natural `1/100` survival (`observe(..., survived=false)` prunes nothing), while `replayWith` `same` skips rebuilds and 1D fallback locks out. | Propagate negative survival-announcement (`noSurvival` / `raw < h`) on `Focus Sash`/`Sturdy`/`Endure` cutoff diffs, bypass `replayWith` `same` on survival diffs, and probe joint `(hp, def/spd)`/`(off, hp)` pairs. |
| [F20](merged/F20-carried-damagecallback-channel0-uncoupling.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` / `reconstruct.mjs` | 5 | `carriedChange` drops `Metal Burst`/`Mirror Coat`/`Counter`/`Comeuppance` to unconstrained `band('down')` whenever `!U.exact && !T.exact` (Channel 0) and hands on unverified prior rolls with no intra-turn backtracking. | Propagate candidate `lastDealt` relations in `carriedChange` even when `!U.exact && !T.exact`, defer pinning prior-hit rolls across unread callbacks, and allow intra-turn roll revision in `resolveTurn()`. |
| [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` / `infer.mjs` | 9 | `totalChange` nulls `V` when `perA` is true; `drainChange` omits `dealtOk` in `backward()`; `wholePaths()` never re-runs `after()` (`paths` takes `options[0]`); `lent`/`cast` omits fainted prior/recoil/drain victims. | Populate `dealtOk` in `drainChange` and push `wholePaths()` recoil/drain bounds backward even under `perA` (with `paths(raw)` backtracking), and include recoil/drain/fainted contributors in `lent`/`cast`. |
| [F22](merged/F22-beat-up-back-party-band-down-and-paths-overcertify.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` / `infer.mjs` | 3 | `analyseHit` degrades `Beat Up` (`hit.back`) to `band('down')`; `paths()` still certifies unreachable exact HP across `band('down')`; `fallback` `cutAt(t)` hides later reserve members from `revealOrder`. | Evaluate `Beat Up` over eligible sheet members' `baseStats.atk`, stop certifying `exact` HP across `band('down')` without reachability checks, and pass full-log `revealOrder` into `fallback` `cutAt(t)`. |
| [F23](merged/F23-substitute-recoil-null-and-band-overcertify.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` | 2 | `applyRecoilDamage` sets `recoilCall = null` when hitting/breaking Substitute (`band('down')`), and `paths(raw)` leaves `cutAt = Infinity` when `h2 === own`, falsely certifying `exact` and causing `brokenProof`. | Hook Substitute-capped recoil against `sub[STORED].hp`, and never certify a turn `exact` in `paths()` past an unhooked `band()` transition even when `h2 === own`. |
| [F24](merged/F24-fail-substitute-weak-quarter-hp-hook.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` | 1 | `evidence.mjs` lacks a hook for `|-fail|<target>|move: Substitute|[weak]`, failing to enforce `hp <= Math.floor(maxhp / 4)`. | Parse `|-fail|...|move: Substitute|[weak]` in `evidence.mjs` and enforce `hp <= Math.floor(maxhp / 4)` in `chain`/`exact` paths. |
| [F25](merged/F25-relaychange-innards-out-spread-exact-guard.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` | 1 | `relayChange` (`evidence.mjs:1922`) requires all prior `moveHits.all` entries to have `victim.exact`, aborting `Innards Out` narrowing on single-hit spread moves (`Heat Wave`) in Channel 0. | Only require prior `moveHits.all` victims to be exact on multi-hit accumulating moves, not on single-hit spread moves where `frame.relay` equals only the KOed target's dealt HP. |
| [F26](merged/F26-settlewrites-guard-split-multi-dep-drop.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` / `infer.mjs` | 1 | `settleWrites` drops multi-candidate `storedStats` writes (`Guard Split`) to `unmapped`/`band('down')`, while `halve` (`infer.mjs:813`) skips `['early', 'other']` endpoints. | Propagate coupled two-Pokemon `storedStats` averages (`Guard Split`) in `settleWrites`/`analyseHit`, and bisect `['early', 'other']` symmetrically in `halve()`. |
| [F27](merged/F27-analysehit-2-other-var-cap-gyro-ball.md) | 4. Evidence & Speed-Sort Hooks | **LIVE** | `evidence.mjs` / `infer.mjs` | 1 | `analyseHit` (`others.length <= 2`) drops 4-stat `Gyro Ball` to `band('down')` while locking `exact`; `lent` omits read-side Speed deps; `judge()` (`line 704`) marks intra-turn regressions `d.moved = true`. | Support 4-variable move evaluation (or avoid `exact`/`held` lock across unsupported `band('down')`), track read-side deps in `lent`, and require `!further(baseReach, r)` in `judge()`. |
| [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | 5. Coordinator & Search Bugs | **LIVE** | `infer.mjs` / `reconstruct.mjs` | 15 | `fallback()` strips `exact`/`variants`/`rolls`/`resample` (`maxBacktracks: 0`), triggers `forget()`/`< t` failure, aborts with 0 probes at `reach(base)[0] < t`, and blacklists `mark` in `spend.fruitless` (`markOf` also mismatches `%` vs `hp/maxhp`). | Preserve `exact`, `built.variants`, `proof.rolls`, and active `resample`/budget for `< t` in `fallback()`, gate `line 614` on `reach(dice)[0] < t`, canonicalize `markOf()`, and never blacklist 0-probe/low-budget marks. |
| [F29](merged/F29-infer-search-level-floor-reset-and-dice-progress.md) | 5. Coordinator & Search Bugs | **LIVE** | `infer.mjs` | 3 | `infer.mjs:613` demands `dice.report.complete` instead of within-turn progress; `resample: 1` keeps stale `exact` and blocks `floor` promotion; `!unchanged` resets `level = floor` (`maxProbes: 150`). | Accept `further(reach(dice), baseReach)` at `line 613`, clear stale partial `exact` on `resample: 1`, and preserve/promote `floor`/`level` once `budgets[0]` fails on a turn. |
| [F30](merged/F30-fallback-escort-same-turn-and-disputed-done-shadow.md) | 5. Coordinator & Search Bugs | **LIVE** | `infer.mjs` | 4 | `escort()` (`line 728`) rejects same-turn earlier-index stops (`!(stop.turn < t)`), while `disputed` omits `[lo, lo]` and writes `done` without updating `d.sides`/`d.moved`, causing `tryValue()` to skip `halving` and pair probes. | Accept `stop.turn < t || (stop.turn === t && stop.index < diff.index)` in `escort()`, include `[da.alive[0], db.alive[0]]` in `disputed`, and propagate `d.sides`/`d.moved` from `done` hits. |
| [F31](merged/F31-fallback-disputed-cast-missing-flincher.md) | 5. Coordinator & Search Bugs | **LIVE** | `infer.mjs` | 1 | On hidden flinch turns, `disputed` includes only `[diff.expected, diff.actual]`, omitting the `+3 Fake Out` flincher so `replayWith` returns `same = true` and skips flincher `spe` probes. | Include all active Pokemon (especially prior flinch-move attackers targeting `diff.expected`) in `disputed` and `near` on hidden `|cant|` turns. |
| [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | 5. Coordinator & Search Bugs | **LIVE** | `knowledge.mjs` / `infer.mjs` | 13 | Under 66-SP cap, `closestSpread()` breaks ties from `k=0` (`hp`) draining bulk; `aimFor()` shifts untouched stats to midpoint when `values.length < SPAN`; `fallback()` skips `['early', 'early']` interior Speed corridors. | Shed unverified offensive SPs before `hp`/`def`/`spd` in `closestSpread()`, preserve valid `prev[s]` in `aimFor()`, and bisect interior Speed corridors without draining bulk. |
| [F33](merged/F33-held-permanent-full-spread-lockin.md) | 5. Coordinator & Search Bugs | **LIVE** | `infer.mjs` | 7 | `held.set()` permanently freezes all 6 stats of a transient `fallback()` witness spread across rounds, locking arbitrary bulk/Speed values that make later exact HP or recoil unreachable. | Freeze only causal stat coordinate(s) in `held`, evict `held` entries on downstream stalls/contradictions, and bypass `replayWith` `same` on failing percentage/recoil `hp` probes. |
| [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | 5. Coordinator & Search Bugs | **LIVE** | `infer.mjs` / `evidence.mjs` | 58 | In Channel 0, `choose(0)` hits `guessTries = 32*S*W` (or `paths()` returns `null`) and runs `exact = null; pins = null;`, throwing away 5–11 turns of verified proofs and collapsing back to Turns 0–3. | Retain deepest verified `exact`/`pins` prefix and witness spreads when `choose()` hits `guessTries` or `paths()` returns `null`, scale `guessTries` with depth, skip decoupled Pokemon in `seq`, and repair locally around turn `t`. |
| [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | 6. Coupled Multi-Var & Single-View Solver | **LIVE** | `infer.mjs` / `evidence.mjs` | 109 | Channel-0 `%`/recoil/drain/Sitrus/KO-reaiming cliffs couple 3–8 Pokemon to 1-HP precision; 1D coordinate sweeps break earlier `%`/order/KO checks on every single-stat move (`moved = []`), looping until `searches`/`stalled`. | Add coupled multi-variable neighborhood search over the failing interaction's active clique (co-varying offense, bulk, and healer/recoil stats along constant-ratio/KO manifolds) + relational interval propagation in `evidence.mjs`. |
| [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | 6. Coupled Multi-Var & Single-View Solver | **LIVE** | `infer.mjs` / `reconstruct.mjs` / `usage.mjs` | 24 | Single-player views (`p1@p2`/`p2@p1`) freeze the observer's team and expose exact `hp/maxhp`, leaving no 2-sided `%` slack; off-meta/20%-random spreads hit `choose(0)` turn-`t` blindness, rank-0 starvation, and `redrawTurn` `stuck` (22/24 traced on `both@spectator` passed). | Re-trace on the failing single view (`p1@p2`/`p2@p1`), co-adjust coupled bulk/offense/speed with roll redraws (`maxBacktracks > 0`), stop starving 8-rebuild tiers on unused stats, and seed opposite-speed-tier candidates early on TR/exact-HP gates. |

---

## 3. Prioritized Engineering Roadmap (Grouped by Architectural Layer & ROI)

Fixing lower-layer deterministic and hook bugs first eliminates false search failures and shrinks the coupled solver backlog before touching multi-variable search heuristics.

### Tier 0 — Immediate Crash & Soundness Blockers (`F03`–`F04`: 2 Live Reports)
- **Why first:** Hard crash (`TypeError`) and a soundness violation (unsoundly emptying all spreads, violating Hard Rule #2). Both are surgical, zero-risk fixes in `evidence.mjs` and `speed.mjs`.
- **`F03` (`evidence.mjs`, 1 report):** Guard `s === null` in `analyseHit()` before `s[2]` lookup on `r.by === 'x'` when a Transform/Imposter source's `X.chain` is empty.
- **`F04` (`speed.mjs`, 1 report):** Use raw `pokemon.speed` (uninverted by Trick Room) when building `SwitchIn` handler speed tables in `readHandlerSort(..., true)`.

### Tier 1 — Deterministic `reconstruct.mjs` Bugs Breaking All 3 Views (`F06`–`F15`: 91 Live Reports)
- **Why second:** Deterministic choice-planning, Illusion, and RNG-steering bugs fail identically across `p1@p2`, `p2@p1`, and `both@spectator` regardless of spreads; no amount of inference search can recover from a broken turn rebuilder.
- **High-ROI core (`F13` [31], `F10` [11], `F14` [10], `F15` [10], `F07` [8], `F09` [8], `F06` [7]):**
  - **RNG Steering (`F12`, `F13`, `F14` — 43 reports):** Fix simultaneous spread `fixes` ordinal shifts (`F12`); steer `secondaries` (`random(100)`/`sample(3)`), contact procs, `FractionalPriority`, `confusion`, and mid-turn `forceSwitch` crits while restricting `infer.mjs:624` `order = true` to `ACTION_START` lines (`F13`); include `span === 2` speed ties and `b.chance` draws in `pairs`/`brought` and replace `scoreOf[0] > score[0]` with `outranks(...)` (`F14`).
  - **Target & Priority Variant Planning (`F07`, `F08`, `F10`, `F11`, `F15` — 33 reports):** Steer `getRandomTarget()`/`randomFoe()` to `[spread]` primary targets (`F10`); retain `[from] lockedmove` and Encored `||[still]` metadata (`F07`); read same-turn `|-anim|` targets and isolate speculative `partial.subs` in `rewalk()` (`F08`); explore single-target slot variants and skip SP fallback on target-only diffs (`F11`); rank invisible-choice variants by priority consistency and allocate per-variant `spent[t]` probe budgets (`F15`).
  - **Illusion & Revival Blessing (`F06`, `F09` — 15 reports):** Fix `watchParty()` `activeMove` guard, back-slot permutations for retreating leads, same-species impossibilities, and `spareDisguises()` pre-filtering (`F06`); scope `revived` to empty-slot `instaswitch` only and rank `state.unsatisfied` above earlier-line errors in `scoreOf()` (`F09`).

### Tier 2 — Missing `speed.mjs` & `evidence.mjs` Mechanism Hooks (`F16`–`F27`: 56 Live Reports)
- **Why third:** Missing evidence hooks leave `knowledge.mjs` unconstrained or falsely certify `exact` across unhooked `band('down')` steps, feeding impossible or contradictory spreads to `infer.mjs`.
- **Speed Hooks (`F16`, `F17`, `F18` — 21 reports):** Initialize Turn-0 lead `cachedSpeed` and handle silent `SwitchIn` prefixes (`F16`); infer speed bounds from `|cant|...|flinch`/`par` across earlier `+3` flinchers (`F17`); enforce pairwise `Spe_A >= Spe_B` and `Spe_A === Spe_B` co-sampling + tie-flip probes (`F18`).
- **Evidence Hooks (`F19`–`F27` — 35 reports):** Propagate negative survival constraints on `Focus Sash`/`Sturdy`/`Endure` cutoff diffs (`F19`); keep Channel-0 `carriedChange` relations and allow intra-turn roll revision (`F20`); push recoil/drain `dealtOk` backward to KO/prior victims and include fainted contributors in `lent`/`cast` (`F21`); support `Beat Up` (`hit.back`) over eligible sheet members (`F22`), Substitute-capped recoil (`F23`), `|-fail|...|Substitute|[weak]` (`F24`), single-hit spread `Innards Out` (`F25`), coupled `Guard Split` writes (`F26`), and 4-variable `Gyro Ball` (`F27`), while never certifying `exact` across unhooked `band('down')` (`F22`, `F23`, `F27`).

### Tier 3 — `knowledge.mjs` & `infer.mjs` Search Coordinator Bugs (`F28`–`F34`: 101 Live Reports)
- **Why fourth:** Once reconstruction and hooks are sound, eliminating self-inflicted search resets unlocks the majority of multi-turn Channel-0 climbs (`F34` alone accounts for 58 reports).
- **Prefix & Budget Preservation (`F28`, `F29`, `F34` — 76 reports):** Stop wiping `exact`/`pins` when `choose()` hits `guessTries` or `paths()` returns `null` (`F34`); preserve `< t` `exact`/`variants`/`rolls`/`resample` in `fallback()` and stop blacklisting 0-probe marks in `spend.fruitless` (`F28`); accept partial within-turn dice progress and preserve/promote `floor`/`level` on `budgets[0]` failures (`F29`).
- **Fallback Target & Spread Discipline (`F30`, `F31`, `F32`, `F33` — 25 reports):** Allow `escort()` on same-turn earlier stops and keep `halving` alive across `done` hits (`F30`); include hidden flinchers in `disputed`/`near` (`F31`); stop `closestSpread()`/`aimFor()` from draining `hp`/`def`/`spd` or mid-jumping working stats under the 66-SP cap (`F32`); lock only causal coordinates in `held` and evict stale locks on downstream stalls (`F33`).

### Tier 4 — Coupled Multi-Variable Channel-0 Solver & Single-View Exact-HP Search (`F35`–`F36`: 133 Live Reports)
- **Why fifth:** These are the true multi-variable optimization bottlenecks that remain once deterministic rebuilds, mechanism hooks, and coordinator state bugs are resolved.
- **`F35` (`infer.mjs` / `evidence.mjs`, 109 reports):** Replace strictly 1D fallback (`moved = []` deadlocks) with coupled neighborhood moves over the failing interaction's active attacker/defender/healer clique along constant-HP-ratio and KO-threshold manifolds, backed by relational cross-Pokemon interval propagation in `evidence.mjs`.
- **`F36` (`infer.mjs` / `reconstruct.mjs` / `usage.mjs`, 24 reports):** Ensure diagnostic sweeps target the actual failing single view (`p1@p2` / `p2@p1`); allow single-view `fallback()` to co-adjust coupled `(offense, bulk, speed)` with roll redraws (`maxBacktracks > 0`), focus budgets on failing-turn contributors, and seed non-usage speed tiers early when Trick Room or exact-HP gates fail.

---

## 4. Complete 392-Report Lookup Directory

Sorted alphabetically by report filename (`382 gaveup` + `4 crash` + `1 nomatch` + `5 removed` = **392** entries).

| # | Report File | Canonical Bucket | Status on `origin/main` |
|---:|---|---|---|
| 1 | `crash-2692932942.md` | [F02](merged/F02-fuzz-hidden-disable-struggle-inputlog.md) | FIXED (commit edf07ed) |
| 2 | `crash-2702667602.md` | [F02](merged/F02-fuzz-hidden-disable-struggle-inputlog.md) | FIXED (commit edf07ed) |
| 3 | `crash-2704147942.md` | [F03](merged/F03-analysehit-null-sstates-transformed-source.md) | LIVE |
| 4 | `crash-2705444834.md` | [F02](merged/F02-fuzz-hidden-disable-struggle-inputlog.md) | FIXED (commit edf07ed) |
| 5 | `gaveup-2690654831.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 6 | `gaveup-2690709001.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 7 | `gaveup-2690755624.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 8 | `gaveup-2690857794.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 9 | `gaveup-2691116729.md` | [F29](merged/F29-infer-search-level-floor-reset-and-dice-progress.md) | LIVE |
| 10 | `gaveup-2691185770.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 11 | `gaveup-2691287817.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 12 | `gaveup-2691297517.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 13 | `gaveup-2691379542.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 14 | `gaveup-2691400059.md` | [F27](merged/F27-analysehit-2-other-var-cap-gyro-ball.md) | LIVE |
| 15 | `gaveup-2691407539.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 16 | `gaveup-2691412750.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 17 | `gaveup-2691422025.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 18 | `gaveup-2691476984.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 19 | `gaveup-2691753503.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 20 | `gaveup-2691765083.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 21 | `gaveup-2691851791.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 22 | `gaveup-2691907758.md` | [F29](merged/F29-infer-search-level-floor-reset-and-dice-progress.md) | LIVE |
| 23 | `gaveup-2691996838.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 24 | `gaveup-2692074098.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 25 | `gaveup-2692108848.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 26 | `gaveup-2692252669.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 27 | `gaveup-2692275744.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 28 | `gaveup-2692323263.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 29 | `gaveup-2692349682.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 30 | `gaveup-2692421826.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 31 | `gaveup-2692434097.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 32 | `gaveup-2692536889.md` | [F22](merged/F22-beat-up-back-party-band-down-and-paths-overcertify.md) | LIVE |
| 33 | `gaveup-2692677083.md` | [F30](merged/F30-fallback-escort-same-turn-and-disputed-done-shadow.md) | LIVE |
| 34 | `gaveup-2692815448.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 35 | `gaveup-2693304047.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 36 | `gaveup-2693458644.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 37 | `gaveup-2693523500.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 38 | `gaveup-2693525101.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 39 | `gaveup-2693661887.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 40 | `gaveup-2693728480.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 41 | `gaveup-2693782296.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 42 | `gaveup-2694110509.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 43 | `gaveup-2694124000.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 44 | `gaveup-2694124237.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 45 | `gaveup-2694129838.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 46 | `gaveup-2694202774.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 47 | `gaveup-2694386113.md` | [F16](merged/F16-turn0-switchin-cachedspeed-silent-handler-and-fallback-guard.md) | LIVE |
| 48 | `gaveup-2694404796.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 49 | `gaveup-2694419276.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 50 | `gaveup-2694436020.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 51 | `gaveup-2694482972.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 52 | `gaveup-2694505800.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 53 | `gaveup-2694530183.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 54 | `gaveup-2694578638.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 55 | `gaveup-2694616044.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 56 | `gaveup-2694644290.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 57 | `gaveup-2694652337.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 58 | `gaveup-2694677695.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 59 | `gaveup-2694712442.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 60 | `gaveup-2694716398.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 61 | `gaveup-2694723265.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 62 | `gaveup-2694755827.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 63 | `gaveup-2694901513.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 64 | `gaveup-2694940936.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 65 | `gaveup-2694941298.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 66 | `gaveup-2694974808.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 67 | `gaveup-2695004787.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 68 | `gaveup-2695018557.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 69 | `gaveup-2695098447.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 70 | `gaveup-2695143625.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 71 | `gaveup-2695220160.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 72 | `gaveup-2695251685.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 73 | `gaveup-2695252743.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 74 | `gaveup-2695290472.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 75 | `gaveup-2695317483.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 76 | `gaveup-2695323073.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 77 | `gaveup-2695357412.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 78 | `gaveup-2695362313.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 79 | `gaveup-2695372119.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 80 | `gaveup-2695375692.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 81 | `gaveup-2695408111.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 82 | `gaveup-2695411986.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 83 | `gaveup-2695460078.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 84 | `gaveup-2695573428.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 85 | `gaveup-2695691527.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 86 | `gaveup-2695710426.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 87 | `gaveup-2695745857.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 88 | `gaveup-2695766419.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 89 | `gaveup-2695870963.md` | [F30](merged/F30-fallback-escort-same-turn-and-disputed-done-shadow.md) | LIVE |
| 90 | `gaveup-2695911751.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 91 | `gaveup-2695929835.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 92 | `gaveup-2696009013.md` | [F11](merged/F11-single-target-move-variant-exhaustion-and-sp-fallback.md) | LIVE |
| 93 | `gaveup-2696022780.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 94 | `gaveup-2696050764.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 95 | `gaveup-2696135858.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 96 | `gaveup-2696353204.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 97 | `gaveup-2696354296.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 98 | `gaveup-2696394916.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 99 | `gaveup-2696442635.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 100 | `gaveup-2696463919.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 101 | `gaveup-2696560400.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 102 | `gaveup-2696601985.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 103 | `gaveup-2696612364.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 104 | `gaveup-2696695453.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 105 | `gaveup-2696702286.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 106 | `gaveup-2696739540.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 107 | `gaveup-2696786268.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 108 | `gaveup-2696815410.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 109 | `gaveup-2696831732.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 110 | `gaveup-2696854354.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 111 | `gaveup-2696868891.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 112 | `gaveup-2696882739.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 113 | `gaveup-2696883094.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 114 | `gaveup-2696884696.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 115 | `gaveup-2696901663.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 116 | `gaveup-2696959634.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 117 | `gaveup-2696984901.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 118 | `gaveup-2696986104.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 119 | `gaveup-2697048408.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 120 | `gaveup-2697164225.md` | [F25](merged/F25-relaychange-innards-out-spread-exact-guard.md) | LIVE |
| 121 | `gaveup-2697175035.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 122 | `gaveup-2697228873.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 123 | `gaveup-2697307892.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 124 | `gaveup-2697369705.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 125 | `gaveup-2697482721.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 126 | `gaveup-2697563183.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 127 | `gaveup-2697567566.md` | [F01](merged/F01-transform-imposter-post-mega-forme.md) | FIXED (commit ac15996) |
| 128 | `gaveup-2697585403.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 129 | `gaveup-2697629629.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 130 | `gaveup-2697644605.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 131 | `gaveup-2697711296.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 132 | `gaveup-2697714859.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 133 | `gaveup-2697730244.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 134 | `gaveup-2697778855.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 135 | `gaveup-2697814978.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 136 | `gaveup-2697828175.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 137 | `gaveup-2697864489.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 138 | `gaveup-2697926528.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 139 | `gaveup-2697977569.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 140 | `gaveup-2698060361.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 141 | `gaveup-2698080416.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 142 | `gaveup-2698111417.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 143 | `gaveup-2698115913.md` | [F23](merged/F23-substitute-recoil-null-and-band-overcertify.md) | LIVE |
| 144 | `gaveup-2698326253.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 145 | `gaveup-2698337557.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 146 | `gaveup-2698342253.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 147 | `gaveup-2698373959.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 148 | `gaveup-2698433335.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 149 | `gaveup-2698481982.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 150 | `gaveup-2698488261.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 151 | `gaveup-2698495242.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 152 | `gaveup-2698583225.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 153 | `gaveup-2698611527.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 154 | `gaveup-2698770067.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 155 | `gaveup-2698886937.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 156 | `gaveup-2698956858.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 157 | `gaveup-2698975633.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 158 | `gaveup-2699204634.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 159 | `gaveup-2699286086.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 160 | `gaveup-2699295299.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 161 | `gaveup-2699337373.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 162 | `gaveup-2699338706.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 163 | `gaveup-2699344151.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 164 | `gaveup-2699367747.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 165 | `gaveup-2699388729.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 166 | `gaveup-2699428192.md` | [F24](merged/F24-fail-substitute-weak-quarter-hp-hook.md) | LIVE |
| 167 | `gaveup-2699428221.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 168 | `gaveup-2699479041.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 169 | `gaveup-2699484431.md` | [F12](merged/F12-steerdice-fixes-simultaneous-spread-ordinal-shift.md) | LIVE |
| 170 | `gaveup-2699495093.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 171 | `gaveup-2699616441.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 172 | `gaveup-2699678891.md` | [F16](merged/F16-turn0-switchin-cachedspeed-silent-handler-and-fallback-guard.md) | LIVE |
| 173 | `gaveup-2699717100.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 174 | `gaveup-2699725143.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 175 | `gaveup-2699731837.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 176 | `gaveup-2699870830.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 177 | `gaveup-2699880847.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 178 | `gaveup-2699891620.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 179 | `gaveup-2699896675.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 180 | `gaveup-2699897094.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 181 | `gaveup-2699898128.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 182 | `gaveup-2699918512.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 183 | `gaveup-2699927531.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 184 | `gaveup-2699944057.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 185 | `gaveup-2699965360.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 186 | `gaveup-2699990693.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 187 | `gaveup-2700087436.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 188 | `gaveup-2700106972.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 189 | `gaveup-2700167937.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 190 | `gaveup-2700204796.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 191 | `gaveup-2700281215.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 192 | `gaveup-2700286889.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 193 | `gaveup-2700314248.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 194 | `gaveup-2700413456.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 195 | `gaveup-2700449781.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 196 | `gaveup-2700519640.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 197 | `gaveup-2700537117.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 198 | `gaveup-2700537949.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 199 | `gaveup-2700574526.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 200 | `gaveup-2700578764.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 201 | `gaveup-2700688633.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 202 | `gaveup-2700691226.md` | [F20](merged/F20-carried-damagecallback-channel0-uncoupling.md) | LIVE |
| 203 | `gaveup-2700734914.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 204 | `gaveup-2700739563.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 205 | `gaveup-2700745857.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 206 | `gaveup-2700758384.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 207 | `gaveup-2700761731.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 208 | `gaveup-2700796479.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 209 | `gaveup-2700798384.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 210 | `gaveup-2700840500.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 211 | `gaveup-2700875531.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 212 | `gaveup-2700883943.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 213 | `gaveup-2700892015.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 214 | `gaveup-2700905876.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 215 | `gaveup-2700906683.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 216 | `gaveup-2700917620.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 217 | `gaveup-2700919014.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 218 | `gaveup-2700926958.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 219 | `gaveup-2700950722.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 220 | `gaveup-2700992808.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 221 | `gaveup-2701031841.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 222 | `gaveup-2701055033.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 223 | `gaveup-2701113256.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 224 | `gaveup-2701145928.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 225 | `gaveup-2701148131.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 226 | `gaveup-2701153993.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 227 | `gaveup-2701324235.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 228 | `gaveup-2701371897.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 229 | `gaveup-2701417024.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 230 | `gaveup-2701496832.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 231 | `gaveup-2701573211.md` | [F20](merged/F20-carried-damagecallback-channel0-uncoupling.md) | LIVE |
| 232 | `gaveup-2701575169.md` | [F20](merged/F20-carried-damagecallback-channel0-uncoupling.md) | LIVE |
| 233 | `gaveup-2701599375.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 234 | `gaveup-2701610974.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 235 | `gaveup-2701703888.md` | [F30](merged/F30-fallback-escort-same-turn-and-disputed-done-shadow.md) | LIVE |
| 236 | `gaveup-2701726652.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 237 | `gaveup-2701743398.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 238 | `gaveup-2701808353.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 239 | `gaveup-2701875695.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 240 | `gaveup-2702099686.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 241 | `gaveup-2702100920.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 242 | `gaveup-2702155390.md` | [F31](merged/F31-fallback-disputed-cast-missing-flincher.md) | LIVE |
| 243 | `gaveup-2702312476.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 244 | `gaveup-2702375487.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 245 | `gaveup-2702446666.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 246 | `gaveup-2702457714.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 247 | `gaveup-2702517764.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 248 | `gaveup-2702862294.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 249 | `gaveup-2703040859.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 250 | `gaveup-2703085152.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 251 | `gaveup-2703554195.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 252 | `gaveup-2703664880.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 253 | `gaveup-2703692052.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 254 | `gaveup-2703692999.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 255 | `gaveup-2703801806.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 256 | `gaveup-2703847056.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 257 | `gaveup-2703865156.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 258 | `gaveup-2704008268.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 259 | `gaveup-2704041997.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 260 | `gaveup-2704060315.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 261 | `gaveup-2704070734.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 262 | `gaveup-2704126276.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 263 | `gaveup-2704134250.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 264 | `gaveup-2704366296.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 265 | `gaveup-2704474984.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 266 | `gaveup-2704558138.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 267 | `gaveup-2704629244.md` | [F11](merged/F11-single-target-move-variant-exhaustion-and-sp-fallback.md) | LIVE |
| 268 | `gaveup-2704682119.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 269 | `gaveup-2704758034.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 270 | `gaveup-2704859971.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 271 | `gaveup-2704908014.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 272 | `gaveup-2704977522.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 273 | `gaveup-2705028500.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 274 | `gaveup-2705043587.md` | [F20](merged/F20-carried-damagecallback-channel0-uncoupling.md) | LIVE |
| 275 | `gaveup-2705100409.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 276 | `gaveup-2705120655.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 277 | `gaveup-2705233123.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 278 | `gaveup-2705260964.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 279 | `gaveup-2705399697.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 280 | `gaveup-2705423624.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 281 | `gaveup-2705589340.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 282 | `gaveup-2705590171.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 283 | `gaveup-2705651347.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 284 | `gaveup-2705717774.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 285 | `gaveup-2705780903.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 286 | `gaveup-2705857468.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 287 | `gaveup-2705861691.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 288 | `gaveup-2705862443.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 289 | `gaveup-2705915534.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 290 | `gaveup-2705940082.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 291 | `gaveup-2706023099.md` | [F08](merged/F08-recoverchargetargets-same-turn-anim-and-rewalk-poison.md) | LIVE |
| 292 | `gaveup-2706048563.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 293 | `gaveup-2706101187.md` | [F33](merged/F33-held-permanent-full-spread-lockin.md) | LIVE |
| 294 | `gaveup-2706164806.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 295 | `gaveup-2706178392.md` | [F22](merged/F22-beat-up-back-party-band-down-and-paths-overcertify.md) | LIVE |
| 296 | `gaveup-2706197002.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 297 | `gaveup-2706358822.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 298 | `gaveup-2706404082.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 299 | `gaveup-2706491205.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 300 | `gaveup-2706558287.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 301 | `gaveup-2706634714.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 302 | `gaveup-2706937283.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 303 | `gaveup-2707002065.md` | [F30](merged/F30-fallback-escort-same-turn-and-disputed-done-shadow.md) | LIVE |
| 304 | `gaveup-2707006405.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 305 | `gaveup-2707034393.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 306 | `gaveup-2707049524.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 307 | `gaveup-2707052154.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 308 | `gaveup-2707119132.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 309 | `gaveup-2707136515.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 310 | `gaveup-2707163383.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 311 | `gaveup-2707165302.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 312 | `gaveup-2707214168.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 313 | `gaveup-2707224488.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 314 | `gaveup-2707261859.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 315 | `gaveup-2707382556.md` | [F19](merged/F19-provenlines-sync-focus-sash-survival-cutoff-blindness.md) | LIVE |
| 316 | `gaveup-2707540379.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 317 | `gaveup-2707618454.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 318 | `gaveup-2707699206.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 319 | `gaveup-2707789211.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 320 | `gaveup-2707833650.md` | [F09](merged/F09-plansegment-revival-blessing-bench-switch-scoreof.md) | LIVE |
| 321 | `gaveup-2707842921.md` | [F17](merged/F17-speed-cant-flinch-par-sorted-and-between-priority-gap.md) | LIVE |
| 322 | `gaveup-2707844739.md` | [F06](merged/F06-illusion-party-rotation-retreating-lead-watchparty.md) | LIVE |
| 323 | `gaveup-2707853669.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 324 | `gaveup-2707869029.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 325 | `gaveup-2707984263.md` | [F26](merged/F26-settlewrites-guard-split-multi-dep-drop.md) | LIVE |
| 326 | `gaveup-2707991516.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 327 | `gaveup-2708031224.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 328 | `gaveup-2708278379.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 329 | `gaveup-2708282365.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 330 | `gaveup-2708291245.md` | [F20](merged/F20-carried-damagecallback-channel0-uncoupling.md) | LIVE |
| 331 | `gaveup-2708317796.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 332 | `gaveup-2708350729.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 333 | `gaveup-2708389587.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 334 | `gaveup-2708401489.md` | [F29](merged/F29-infer-search-level-floor-reset-and-dice-progress.md) | LIVE |
| 335 | `gaveup-2708402625.md` | [F23](merged/F23-substitute-recoil-null-and-band-overcertify.md) | LIVE |
| 336 | `gaveup-2708412752.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 337 | `gaveup-2708420838.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 338 | `gaveup-2708469002.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 339 | `gaveup-2708532185.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 340 | `gaveup-2708784758.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 341 | `gaveup-2708916635.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 342 | `gaveup-2709179827.md` | [F12](merged/F12-steerdice-fixes-simultaneous-spread-ordinal-shift.md) | LIVE |
| 343 | `gaveup-2709218063.md` | [F10](merged/F10-alladjacentfoes-getrandomtarget-spread-primary-target.md) | LIVE |
| 344 | `gaveup-2709221540.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 345 | `gaveup-2709239553.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 346 | `gaveup-2709266531.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 347 | `gaveup-2709275728.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 348 | `gaveup-2709309066.md` | [F21](merged/F21-recoil-drain-backward-dealtok-and-fainted-cast.md) | LIVE |
| 349 | `gaveup-2709331203.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 350 | `gaveup-2709342294.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 351 | `gaveup-2709475873.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 352 | `gaveup-2709514039.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 353 | `gaveup-2709587302.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 354 | `gaveup-2709613144.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 355 | `gaveup-2709683313.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 356 | `gaveup-2709742901.md` | [F16](merged/F16-turn0-switchin-cachedspeed-silent-handler-and-fallback-guard.md) | LIVE |
| 357 | `gaveup-2709778237.md` | [F14](merged/F14-resolveturn-pairs-brought-chance-and-span2-exclusion.md) | LIVE |
| 358 | `gaveup-2709819866.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 359 | `gaveup-2710266634.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 360 | `gaveup-2710272253.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 361 | `gaveup-2710347095.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 362 | `gaveup-2710440936.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 363 | `gaveup-2710507620.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 364 | `gaveup-2710584556.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 365 | `gaveup-2710599607.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 366 | `gaveup-2710610871.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 367 | `gaveup-2710661037.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 368 | `gaveup-2710746778.md` | [F07](merged/F07-plansegment-encore-lockedmove-charge-targets.md) | LIVE |
| 369 | `gaveup-2710753606.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 370 | `gaveup-2710828875.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 371 | `gaveup-2710839881.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 372 | `gaveup-2710894662.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 373 | `gaveup-2710930682.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 374 | `gaveup-2711002479.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 375 | `gaveup-2711009533.md` | [F11](merged/F11-single-target-move-variant-exhaustion-and-sp-fallback.md) | LIVE |
| 376 | `gaveup-2711070862.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 377 | `gaveup-2711078003.md` | [F22](merged/F22-beat-up-back-party-band-down-and-paths-overcertify.md) | LIVE |
| 378 | `gaveup-2711117287.md` | [F35](merged/F35-channel0-coupled-multivar-1d-fallback-gridlock.md) | LIVE |
| 379 | `gaveup-2711170128.md` | [F13](merged/F13-steerdice-unsteered-secondary-crit-and-fractional-priority.md) | LIVE |
| 380 | `gaveup-2711420095.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 381 | `gaveup-2711450978.md` | [F34](merged/F34-choose-guesstries-paths-null-prefix-pin-collapse.md) | LIVE |
| 382 | `gaveup-2711522873.md` | [F15](merged/F15-invisible-choice-priority-ranking-and-shared-spent-starvation.md) | LIVE |
| 383 | `gaveup-2711531781.md` | [F36](merged/F36-single-view-exact-hp-rigidity-against-nonusage-spreads.md) | LIVE |
| 384 | `gaveup-2711644952.md` | [F18](merged/F18-cross-pokemon-speed-tie-equality-and-1d-interval-blindness.md) | LIVE |
| 385 | `gaveup-2711649070.md` | [F32](merged/F32-closestspread-aimfor-66sp-bulk-cannibalization.md) | LIVE |
| 386 | `gaveup-989795.md` | [F28](merged/F28-fallback-strip-pins-reach-base-abort-and-fruitless.md) | LIVE |
| 387 | `nomatch-2694981022.md` | [F05](merged/F05-illusion-multidisguise-end-slot-order.md) | FIXED (commit 2e0cf13) |
| 388 | `removed-2696763978.md` | [F04](merged/F04-switchin-readhandlersort-trick-room-speed.md) | LIVE |
| 389 | `removed-2697567566.md` | [F01](merged/F01-transform-imposter-post-mega-forme.md) | FIXED (commit ac15996) |
| 390 | `removed-2697689088.md` | [F01](merged/F01-transform-imposter-post-mega-forme.md) | FIXED (commit ac15996) |
| 391 | `removed-2698084073.md` | [F01](merged/F01-transform-imposter-post-mega-forme.md) | FIXED (commit ac15996) |
| 392 | `removed-2708671848.md` | [F01](merged/F01-transform-imposter-post-mega-forme.md) | FIXED (commit ac15996) |
