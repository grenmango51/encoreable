# F35: Channel-0 Coupled Multi-Variable Quantization & Threshold Manifolds Defeating 1D Coordinate-Descent Fallback

## 1. Failure Overview & Status

- **Bucket ID**: `F35`
- **Slug**: `channel0-coupled-multivar-1d-fallback-gridlock`
- **Category**: `6. Coupled Multi-Variable Search & Single-View Exact-HP Architecture`
- **Status on `origin/main`**: `LIVE`
- **Primary Subsystem**: `scripts/lib/inference/infer.mjs` & `scripts/lib/inference/evidence.mjs`
- **Verified Live Code Locations**:
  - `scripts/lib/inference/infer.mjs`:
    - `markOf(d)` (`infer.mjs:426`): keys fallback tracking strictly by `${d.turn}|${d.index}|${d.expected}`, ignoring `d.actual` and active knowledge state.
    - `fallback(seen, start, proven)` (`infer.mjs:478-914`):
      - `searched` / `spend.fruitless.add(mark)` (`infer.mjs:481-485`): permanently blacklists `mark` across shared `spend` after a single failed fallback budget (`FALLBACK_REBUILDS = 8`, or `32` in `wide`).
      - `judge(changes, got, d)` (`infer.mjs:700-710`): sets `d.moved = true` **only** when `r[0] >= t && outcome(got.b) !== baseOutcome`, disqualifying any variable whose 1D move breaks an earlier turn (`r[0] < t`) or leaves the failing line unchanged (`'same'`).
      - Endpoint sweep & `halving()` (`infer.mjs:798-817`): only runs bisection when the two stat ends straddle `'early'` and `'same'`, skipping non-monotonic cliffs (`'early'` at both ends or `'other'`).
      - 1D sweep & gated 2-stat pair loop (`infer.mjs:818-845`): pairs **only** variables in `moved` (`moved.length <= 1` executes zero pair probes) and tests only `{best.value, min, max, mid}`.
    - `mixOf(a, b, order)` (`infer.mjs:925-952`, invoked at `infer.mjs:1114-1122`): splices Pokémon or individual stats from two conflicting guesses without pre-checking verified turns, producing multi-round limit cycles.
    - `choose(n, cond)` & `seq` reordering (`infer.mjs:1004-1080`): consumes `tries = 32 * S * W` running full `settle()` passes per single-Pokémon pin; when `exact` is not found (`!exact`), falls back to independent per-Pokémon `closestSpread()` (`infer.mjs:1074-1080`) and drops `exact = null, pins = null`.
    - `again = failed.has(markOf(diff))` (`infer.mjs:1087-1101`): re-invokes `fallback` on repeated marks until `searched >= 2` or `spend.fruitless` permanently suppresses fallback.
  - `scripts/lib/inference/evidence.mjs`:
    - `interval(rec, M, token)` (`evidence.mjs:625-649`, via `hpRank` at `scripts/lib/reconstruct.mjs:612-620`): maps Channel-0 percentage tokens (including `20/100y` vs `20/100r` and `50/100g` vs `50/100y`) to `[lo, hi]` HP intervals per Pokémon independently.
    - `dealtChange` / `drainChange` (`evidence.mjs:1453-1474`, `1647-1655`) and `narrowDealt` (`evidence.mjs:2276-2305`): cross-Pokémon damage-to-recoil/drain narrowing (`narrowDealt`) bails immediately whenever `V.history.at(-1)?.change !== vChange || V.pending.length > 0` (`evidence.mjs:2278`), severing relational coupling once any residual tick or second hit lands.
    - `totalChange` (`evidence.mjs:1525-1639`): couples recoil/Shell Bell totals within one move's `applyMove`, without carrying cross-Pokémon relational links across turns.
    - `effectChange` (`evidence.mjs:1731-1890`) and `itemFires` / `fireEdge` (`evidence.mjs:2842-2895`): evaluates `1/16` Grassy Terrain / Leftovers / burn ticks and `<= 50%` pinch-Berry triggers per Pokémon `(M, h)` independently.
    - `apply()` (`evidence.mjs:2051-2268`), `backward()` (`evidence.mjs:3719-3878`), and `paths()` (`evidence.mjs:3904-4063`): execute independent per-Pokémon backward walks (`rec.chain`) across turns with no cross-Pokémon relational fixpoint (unlike `jointPainSplit` at `evidence.mjs:2927-3009`, which demonstrates the existing 2-body table pattern).
- **Total Merged Reports**: **109** (spanning 20 source shard clusters: `S01-C11`, `S01-C12` [partial], `S01-C13`, `S02-C13`, `S02-C15`, `S03-C10`, `S03-C11`, `S04-C12`, `S05-C09`, `S06-C11`, `S07-C14`, `S08-C13`, `S09-C10`, `S10-C12`, `S11-C09`, `S12-C10`, `S13-C11`, `S13-C12`, `S14-C13`, `S15-C16`).
- **View Breakdown**:
  - **`both@spectator` (Channel 0) failed**: **109 / 109 (100.0%)**
  - **Exclusively `both@spectator` failed (`p1@p2` & `p2@p1` passed)**: **105 / 109 (96.3%)**
  - **All 3 views failed (`both@spectator`, `p1@p2`, `p2@p1`)**: **3 / 109 (2.8%)** — `gaveup-2691407539.md`, `gaveup-2699891620.md`, `gaveup-2709275728.md`
  - **`both@spectator` + `p2@p1` failed (`p1@p2` passed)**: **1 / 109 (0.9%)** — `gaveup-2694110509.md`

### Why `p1@p2` and `p2@p1` Pass While `both@spectator` Deadlocks

In single-player views (`channel = 1` or `2`), one side has `known = true` (every Stat Point and exact max HP $M$ is fixed) and its own active Pokémon print **exact integer HP** `h/M` on every damage, recoil, drain, and residual line. Consequently, every observed HP delta $\Delta h = h_{\text{before}} - h_{\text{after}}$ decouples into a **single-unknown** constraint:
- Outgoing hits against a known defender fix exact $\Delta h$ against known $(M, \text{Def/SpD})$, directly bounding the attacker's offensive stat (`Atk`/`SpA`).
- Incoming hits on a known-bulk defender fix exact $\Delta h$ against the observer's known $(M, \text{Def/SpD})$ (or known recoil $\lfloor \Delta h / 3 \rfloor$), isolating the opponent's stat directly.

In **`both@spectator` (`channel = 0`)**, both teams are unknown (`known = [false, false]`) and both sides print only floor-quantized percentages $\max(1, \lfloor 100 h / M \rfloor)$ plus exact threshold tags (`20/100y` vs `20/100r`, `50/100g` vs `50/100y`). Every attack, recoil, drain, and residual tick couples $3\text{--}8$ unknown Pokémon simultaneously into a tight multi-turn Diophantine/threshold manifold that univariate search cannot traverse.

---

## 2. Root-Cause Mechanism

### 2.1 The Coupled Channel-0 Quantization & Threshold Manifold

Under Channel 0, Showdown (`pokemon-showdown/sim/pokemon.ts:2070`, mirrored via `hpRank` in `scripts/lib/reconstruct.mjs:612-620` and `interval()` in `evidence.mjs:625-649`) compresses each Pokémon's true integer HP $h_i(t) \in [0, M_i]$ into:
$$q(h, M) = \begin{cases} 0 & h = 0 \\ \max\!\big(1, \lfloor 100 h / M \rfloor\big) & h > 0 \end{cases}$$
together with parity color flags at $q = 20$ (`y` iff $5h > M$, else `r`) and $q = 50$ (`g` iff $2h > M$, else `y`). Because $M_i = \text{base}_i + \text{SP}_{i,\text{hp}} + 75$ is itself hidden ($33$ possible values per Pokémon), each percentage bucket spans $\approx M_i / 100 \in [1.3, 2.3]$ HP, and $h_i(t)$ evolves across turns as a chain of coupled integer-rounded operators:

1. **Damage coupling**: $D_{A \to B} = \text{getDamage}(A_{\text{off}}, B_{\text{def}}, r, h_A, M_A)$ depends on both sides' spreads, the damage roll $r \in \{0,\dots,15\}$, and for HP-scaled moves (`Eruption`, `Water Spout`) on $\lfloor 150 \cdot h_A / M_A \rfloor$.
2. **Target-HP-capped recoil**: Recoil takes $R = \max(1, \lfloor \sum_j \min(D_j, h_{j,\text{pre}}) / 3 \rfloor)$. When a move KOs target $B$, recoil depends strictly on $B$'s **remaining HP before the KO** ($h_{B,\text{pre}}$) — which integrates *every prior turn's* hits, heals, and residual ticks on $B$ (even by attackers that fainted turns earlier!). Varying the recoil user's own `Atk`/`SpA` has **zero effect** on $R$.
3. **Drain parity cliffs**: Moves like `Leech Life`, `Drain Punch`, `Giga Drain`, and `Matcha Gotcha` heal $\lceil \min(D, h_{B,\text{pre}}) / 2 \rceil$ (up to $M_A - h_{A,\text{pre}}$). A $1\text{-HP}$ change in damage flips odd/even drain parity or misses a percentage boundary on $A$ (`got 85/100` vs `wanted 88/100`).
4. **Cumulative `1/16` residual drift**: Grassy Terrain, Leftovers, Burn, and Sandstorm each add/subtract $\lfloor M_i / 16 \rfloor$ per turn. Across $4\text{--}10$ turns, a $1\text{-HP}$ error in $M_i$ or earlier damage shifts $h_i(t)$ across a percentage boundary (`60/207 = 28.9855%` $\to$ `28/100` vs `61/207 = 29.46%` $\to$ `29/100`).
5. **Non-linear item/ability/color thresholds**:
   - **Sitrus Berry / Emergency Exit**: fires iff $h_i \le \lfloor M_i / 2 \rfloor$. Missing $1\text{ HP}$ above or below $\lfloor M_i / 2 \rfloor$ either suppresses a $+25\%$ heal or triggers it prematurely, crashing the log.
   - **Color parity borders**: `50/100g` vs `50/100y` ($2h > M$ vs $2h \le M$) and `20/100y` vs `20/100r` ($5h > M$ vs $5h \le M$) reject guesses with the exact right percentage integer when $M$ or $h$ differs by $1\text{ HP}$.
   - **Upstream KO-threshold target re-aiming**: When an earlier spread/attack guess accidentally KOs an opponent $B$ (or fails to KO $B$), Showdown / `MimicPlayer.aim` re-aims subsequent moves (`|move|...|p1b` vs `|move|...|p1a`) or loses a subsequent action (`0 fnt`), creating a step discontinuity.

### 2.2 Why `fallback()` (`infer.mjs:478-914`) Gridlocks on Coupled Manifolds

Suppose the current guess sits near a narrow diagonal feasibility ridge in $(\text{SP}_{A,\text{off}}, \text{SP}_{B,\text{hp}}, \text{SP}_{B,\text{def}}, \dots)$ where Turn $1\text{--}(t-1)$ hold and Turn $t$ fails at `diff`. Moving along the feasible manifold requires shifting **two or more stats simultaneously** (e.g., raising $A$'s `SpA` while raising $B$'s `SpD` to keep Turn $1$ invariant while changing Turn $5$, or shifting prior attacker $C$'s `Atk` and $B$'s `HP` together to adjust $B$'s pre-KO HP by $1$ without breaking Turn $2$).

`fallback()` fails structurally for five interacting reasons in `infer.mjs`:

1. **Strictly 1D coordinate sweeps (`infer.mjs:809-832`)**:
   - `fallback()` first tests `d.alive[0]`, `d.alive[n-1]` (`809-816`), and `d.alive[(n-1)>>1]` (`818-821`) for one `(pokemon, stat)` dimension `d` at a time.
   - Every single-stat move that shifts damage/bulk enough to fix Turn $t$ immediately violates an earlier checkpoint on Turn $1\text{--}(t-1)$ (`sideOf(got) === 'early'`), aborting before Turn $t$. Conversely, small single-stat moves that stay inside Turn $1\text{--}(t-1)$ fail to cross Turn $t$'s percentage/threshold cliff (`sideOf(got) === 'same'`).
2. **`halving()` misses non-monotonic cliffs (`infer.mjs:799-817`)**:
   - `if (!ends.includes('early') || !ends.includes('same')) continue;` (`infer.mjs:813`).
   - Whenever a stat breaks an earlier turn on *both* ends (`['early', 'early']` — e.g., low `def` KOs on Turn 1, high `def` breaks Turn 2 order/66-SP budget or triggers `'other'`) or produces `['other', 'same']` / `['early', 'other']`, `halving()` is skipped outright.
3. **Broken `d.moved` gating kills the 2-stat pair loop (`infer.mjs:704, 825, 833-845`)**:
   - In `judge()` (`infer.mjs:704`):
     ```js
     if (r[0] >= t && outcome(got.b) !== baseOutcome) d.moved = true;
     ```
   - Notice that **any** 1D probe that breaks an earlier turn (`r[0] < t`, `'early'`) or fails to alter the failing line alone (`'same'`) leaves `d.moved = false`!
   - Thus `moved = dims.filter(d => d.moved)` (`825`) routinely has length $0$ or $1$, causing the 2-stat pair loop (`833-845`) to execute **zero** iterations. Even when `moved.length >= 2`, it cannot pair a variable in `moved` with a compensating variable whose 1D probe stopped `'early'` (such as the defender's `hp`/`def`/`spd` or an earlier-turn attacker).
4. **66-SP budget coupling inside `build()` (`infer.mjs:642-659`)**:
   - Testing `c.stat = c.value` calls `closestSpread(restrictKnowledge(kn, c.stat, c.value), aim)`. If the Pokémon's guess is near 66 SP, raising `spe` or `hp` silently steals SP from `def`/`spd`/`atk`/`spa` on the same Pokémon, causing `'early'` damage regressions on earlier turns even when the tested stat itself was harmless.
5. **`markOf(diff)` & `spend.fruitless` double-burn and blackout (`infer.mjs:426, 481-485, 1087-1089`)**:
   - `markOf = d => (d ? `${d.turn}|${d.index}|${d.expected}` : null)` omits `d.actual` and current spread/knowledge context.
   - Because `fallback()` only searches 1D steps (and exhausts `FALLBACK_REBUILDS = 8`), `none()` (`484`) executes `searched.set(mark, 2); spend.fruitless.add(mark);`, **permanently disabling `fallback`** on `mark` across shared `spend` even after `knowledge` narrows or another restart changes guesses (documented directly in `gaveup-2707214168.md`). Conversely, when a minor upstream drift shifts `diff.index` by $1$, a nearly identical diff gets a fresh `mark` and burns another full `fallbackRebuilds` budget.

### 2.3 Why `evidence.mjs`, `choose()`, and `mixOf()` Cannot Break the Gridlock

- **Decoupled HP chains in `evidence.mjs`**: `narrowDealt()` (`evidence.mjs:2276-2305`) requires `entry.change === vChange && !V.pending.length` (`2278`), so any end-of-turn Grassy Terrain/Leftovers/burn tick or multi-hit immediately blocks back-propagation from recoil/drain/Sitrus to the victim's prior damage. Moreover, `backward()` (`3719-3878`) walks each `rec.history` independently, never enforcing cross-Pokémon consistency across turns.
- **Sequential greedy `choose()` (`infer.mjs:1014-1080`)**: Pins Pokémon one at a time along `aimFor()` quantiles (`0.5`, `prev`, `0.25`, `0.75`), burning `tries = 32 * S * W` on repeated `settle()` calls. When `tries` hits `0` (`guessTries`), `choose()` returns `null`, setting `exact = null` and `pins = null` (`1072-1074`) and picking independent per-Pokémon `closestSpread()` guesses (`1074-1080`) that violate joint Channel-0 inequalities.
- **Incompatible splicing in `mixOf()` (`infer.mjs:925-952, 1114-1122`)**: When `picks` revisits a `visited` signature, `mixOf()` splices whole Pokémon or single stats from the last two guesses without checking whether the splice preserves verified turns, causing deterministic 2-state and 5-state limit cycles (`60\text{--}331` rounds in `gaveup-2694941298.md`, `gaveup-2700519640.md`, `gaveup-2710599607.md`).

---

## 3. Single Cohesive Fix Specification

Strictly following `AGENTS.md`:
- **Showdown's simulator remains the sole source of mechanics** (all checks use `reconstruct`, `replayWith`, `dryHp`, `dryRow`, `getHealth`).
- **100% soundness**: every relational propagation step filters strictly via simulator-generated transition tables; coupled search in `fallback()`/`choose()`/`mixOf()` only selects **witnesses** inside surviving `knowledge` (`containsSpread`).
- **Mechanism-level, never move/species-specific**: all rules operate generically on simulator `hit`, `effectChange`, `Update` item gates, and protocol diffs.

### 3.1 Diff-Directed Coupled Neighborhood Solver & Normalized `markOf` (`scripts/lib/inference/infer.mjs`)

1. **Normalize `markOf(diff)` and decouple `spend.fruitless` from small-budget 1D failures (`infer.mjs:426, 481-485`)**:
   - Define `markOf(d)` with failure classification so distinct failure modes at the same line do not collide, while identical residual cliffs do not burn duplicate budgets:
     ```js
     const markOf = d => (d ? `${d.turn}|${d.index}|${d.expected}|${kind(d.actual) || 'none'}` : null);
     ```
   - Track `searched` / `fruitless` per `(mark, knowledgeEpoch)` (incrementing `knowledgeEpoch` whenever `settle()` narrows any Pokémon's `spreadsLeft`) and **do not inherit `spend.fruitless` from a smaller `W` tier into `wide`/`widest`** (`spend` should store `fruitless` keyed by `${W}|${mark}`). A 1D-only failure under `FALLBACK_REBUILDS = 8` must not silence fallback at `W = 4` or after evidence narrows the active clique.
   - Skip dead/uninvolved Pokémon in `cast`: filter `tiers[4]` (`stood.values()`, `infer.mjs:578`) to Pokémon that actually appeared or had a causal `lent`/action edge in turns $\le t$ (`seen.has(u.id)`), avoiding probes on benched/fainted non-contributors (`gaveup-2709819866.md`).

2. **Generalize `halving()` and remove the `d.moved` gate on coupled search (`infer.mjs:704, 799-845`)**:
   - Allow `halving()` whenever `ends[0] && ends[1] && ends[0] !== ends[1]` (handling `'early' <-> 'other'` and `'other' <-> 'same'` transitions, not only `'early' <-> 'same'`).
   - Extract the **active causal clique** around `diff` (all inferred Pokémon in `rank <= 3`, plus any `dealtBy` / `lent` / spread-target partners active in turns $\le t$).
   - **Stage 2 Coupled Co-Variation Search** (runs whenever Stage 1 1D probing returns `!found && !ahead`, **never gated on `d.moved`**):
     - **A. Same-Pokémon 66-SP Budget-Compensated Pairs**: For each Pokémon $u$ in the causal clique near the 66-SP cap, when perturbing a primary stat `s1` (`hp`, `def`, `spd`, `atk`, `spa`, `spe`) to an endpoint/midpoint `v1`, explicitly pair it with a compensating reduction `v2` on an unconstrained or secondary stat `s2` on $u$ so `closestSpread()` does not silently steal SP from a turn-critical stat.
     - **B. Cross-Pokémon Attacker–Defender / Recoil–Victim Constant-Ratio Pairs**:
       - Using `hpRank(expected, exact)` vs `hpRank(actual, exact)` (or KO/retarget detection when `actual` is `0 fnt` or a target flip), determine the **sign** of the needed HP/damage shift on the failing Pokémon $T$:
         - If $T$ took too much damage (`rank(actual) < rank(expected)` or unexpected `0 fnt`), pair `(T.hp/def/spd ↑, A.atk/spa ↓)` (and for target-capped recoil on $A$, pair `(T.hp/def/spd, priorAttacker.atk/spa)`).
         - If $T$ took too little damage (`rank(actual) > rank(expected)`), pair `(T.hp/def/spd ↓, A.atk/spa ↑)`.
         - For `order` or residual-tick order cliffs, pair `(A.spe, B.spe)` across active speed-coupled peers in opposite directions.
       - Probe coupled 2-tuples (and 3-tuples when a recoil/drain chain links `priorAttacker -> victim -> user`) using `spots(d)` plus `best.value` and `1/4, 3/4` quantiles of `d.alive`.
     - **C. Coordinate-Beam Expansion Around Improving Probes**:
       - Maintain a small beam (`K = 4`) of probes that either advanced `reach(b)` beyond `baseReach` OR reached turn $t$ (`r[0] === t`) with strictly smaller `|hpRank(actual) - hpRank(expected)|` than `base`.
       - Rather than snapping back to `start` on every step, run 1-stat and 2-stat coupled extensions from the top-$K$ improving witnesses.
     - **D. Fast `replayWith` Pre-Filter Before `reconstruct()`**:
       - Extend `probe()` (`infer.mjs:673-694`): before paying a full `reconstruct()` call on a multi-stat candidate `chosen`, run `replayWith(built.inputLog, packOf(chosen), t, channel)` (a single deterministic forward pass). If `replayWith` already matches `plain` (when `!disputed`), skip as `'same'` (`0` rebuilds spent); if `replayWith` diverges at a turn $< \text{baseReach}[0]$ on a deterministic HP/order line unrelated to `hidden` turns, rank it behind candidates whose `replayWith` reaches turn $t$ (preserving soundness since `fallback` only picks witnesses).

3. **Verified-Prefix Guard on `mixOf()` (`infer.mjs:925-952, 1114-1122`)**:
   - In `mixOf(a, b, order)`, rank candidate splices `m` by running `replayWith(built.inputLog, packOf(m), Math.max(1, deepest[0] - 1), channel)` against the deepest verified turn's log prefix, rejecting any splice that immediately regresses prior turns when a non-regressing splice exists. This breaks the multi-round `mixOf` limit cycles.

### 3.2 Relational Cross-Pokémon HP-Chain Fixpoint (`scripts/lib/inference/evidence.mjs`)

1. **Retain Cross-Pokémon Relational Edges Past Residual Ticks (`evidence.mjs:1453-1639, 2276-2305`)**:
   - Currently `narrowDealt()` (`2278`) only fires when `V.history.at(-1)?.change === vChange && !V.pending.length`.
   - Store each cross-Pokémon link directly on the change entries (`change.rel = { victim: V, vHistIdx, rest, hits }` for `dealtChange`/`drainChange`/`totalChange`/`relayChange`), recording the exact `(vKey, h_pre, h_post, aVal, dealt)` tuples that survived `apply()`.
2. **Coupled Multi-Pokémon Fixpoint in `backward()` (`evidence.mjs:3719-3892`)**:
   - After the initial per-Pokémon `backward()` pass computes `rec.aliveAt[i]` (each Pokémon's surviving `(k, h)` states at every history step `i`), run a bounded relational fixpoint loop (`<= 4` passes across `recs`):
     - For every relational edge (`dealtChange`, `drainChange`, `totalChange`, `relayChange`, `sourceStates`, `jointPainSplit`) linking Pokémon $S$ at step $i_S$ and Pokémon $V$ at step $i_V$:
       - Intersect $V$'s surviving `(h_pre - h_post)` values at step $i_V$ (already propagated backward past any Grassy Terrain / Leftovers / burn ticks on $V$!) with the `dealt` values allowed by $S$'s surviving states at step $i_S$, and vice versa.
       - If either $S$ or $V$ loses any `(k, h)` or attacking-stat `v` mask bit, re-run `backward()` only for the affected Pokémon.
   - This propagates Turn-$4$/Turn-$5$ recoil, drain, and Sitrus constraints backward through intermediate `1/16` terrain/Leftovers/burn ticks directly into `V.chain` and `S.flat` / `S.ties`, shrinking the search space before `choose()` runs and ensuring `paths()` (`3904-4063`) receives mutually consistent HP chains.
3. **Clique-Aware `choose()` Seeding (`infer.mjs:1014-1071`)**:
   - When `choose()` hits `blocks(keyed, n)` (`1039`, `1048`), instead of only moving the single blocked Pokémon to the front of `seq` (`1069`), promote `[blocker, ...lentOf(blocker)]` together and pull candidate spreads from the relational witness found by `fallback()`/`evidencePass` rather than uncoupled per-Pokémon `aimFor()` quantiles.

---

## 4. Representative Battle Proofs

### Proof 1 — Recoil-Coupling & Dynamic Base-Power Faint Cliff (`gaveup-2691185770.md`)
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2691185770` (Game 2, 4 turns).
- **View Contrast**:
  - `p1@p2` (Ch 2): **PASS** (<30s, 4 rounds, 4 rebuilds, 1,024 probes).
  - `p2@p1` (Ch 1): **PASS** (<30s, 4 rounds, 4 rebuilds, 986 probes).
  - `both@spectator` (Ch 0): **GAVE UP** (7,276.3s sweep / 2,121.8s trace, `stop = "searches"`, 80 rounds, 513 rebuilds, 2,224,956 probes, limits `["backtracks", "fallbackRebuilds", "guessTries", "probes", "searches", "variants"]`).
- **Coupled Turn 4 Manifold**:
  - P1 `Rillaboom` (`186` HP, `162` Atk) hits Mega `Camerupt` (`177` HP, `122` Def) with `Wood Hammer` for `164` damage, leaving Camerupt on `13/177` (`7/100`), dealing Rillaboom $\lfloor 164 / 3 \rfloor = 54$ recoil (`105/186` = `60/100`).
  - Surviving at `13/177` sets Camerupt's `Eruption` BP to $\lfloor 150 \times 13 / 177 \rfloor = 11$, hitting `Raichu-Mega-Y` (`51/164` = `31/100`) and `Rillaboom` (`74/186` = `43/100`), before Grassy Terrain heals Rillaboom $+11$ to `85/186` (`48/100`).
  - Lowering Camerupt bulk causes `0 fnt` (no `Eruption`); raising Camerupt bulk drops Rillaboom recoil (`got 61/100` vs `60/100`) and jumps `Eruption` BP by $+45\%$ (e.g., `20 HP` $\to$ BP `16`), breaking both `Raichu 31/100` and `Rillaboom 43/100` / `48/100`. No 1D move in `fallback()` can cross this cliff without breaking Turn 3 or Turn 4.

### Proof 2 — Drain Parity & Sitrus Berry `<= 50%` Threshold (`gaveup-2696854354.md`)
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2696854354` (5 turns).
- **View Contrast**:
  - `p2@p1` (Ch 1): **PASS** (7.9s, 2 rounds, 2 rebuilds, 332 probes).
  - `p1@p2` (Ch 2): **PASS** (11.7s, 7 rounds, 7 rebuilds, 1,983 probes).
  - `both@spectator` (Ch 0): **GAVE UP** (7,056.5s, `stop = "stalled"`, 82 rounds, 434 rebuilds, 789,041 probes).
- **Coupled Turn 4–5 Manifold**:
  - Turn 4 Rain `Heat Wave` from Mega `Dragonite` deals `76` damage to `Golisopod-Mega` (`152` HP), pinning `76/152` (`50/100y` vs `51/100`), followed by $+9$ Grassy Terrain (`85/152`).
  - Turn 5 `Golisopod` (`222` Atk, `-1` Intimidate, Helping Hand) hits `Incineroar` (`202` HP, `156` Def, `Sitrus Berry`) with `Leech Life`: damage **must** lie in $[96, 100]$ HP — $\ge 101$ triggers `Sitrus Berry` (`<= 50%`, crashing the log instead of `50/100g` at `103/202`), while $\le 95$ heals $\le 48$ HP (`85 + 48 = 133/152` = `87/100` or `85/100` vs `wanted 88/100` at `135/152`).
  - Immediately after, Dragonite `Heat Wave` hits post-drain Golisopod (`135 - 80 = 55/152` = `36/100`). Every 1D fallback step on `Golisopod` (`atk 0`, `def 32`, `spa 32`, `spd 0`) either stalls at `5.11` (`35/100` vs `36/100`) or breaks Turn 4 `50/100y` (`4.10: got 42/100`).

### Proof 3 — `20/100y` vs `20/100r` Color-Flag Cliff & Multi-Turn Recoil (`gaveup-2709239553.md`)
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2709239553` (12 turns).
- **View Contrast**:
  - `p1@p2` (Ch 2): **PASS** (~22.4s, 6 rounds, 6 rebuilds, 1,420 probes).
  - `p2@p1` (Ch 1): **PASS** (~38.7s, 10 rounds, 11 rebuilds, 2,890 probes).
  - `both@spectator` (Ch 0): **GAVE UP** (2,105.2s sweep / 995.2s trace, `stop = "stalled"`, 216 rounds, 713 fallback rebuilds, 204,945 probes).
- **Coupled Turn 1–4 Manifold**:
  - On Turn 4, `Basculegion`'s `Aqua Jet` reduces `Froslass-Mega` (`177` max HP) from `44` HP to `36/177` (`20.3389%`). Because $36 \times 5 = 180 > 177$, Showdown prints `|-damage|p1a: Froslass|20/100y`.
  - Candidate spreads with identical `20%` floor percentage where $5h \le M$ (e.g., `35/175` or `36/180`) emit `20/100r`, halting Turn 4 **62 times** across 216 rounds (`wanted 20/100y, got 20/100r`).
  - Every 1D perturbation in `fallback()` on `Froslass` or `Basculegion` immediately violates Turn 1 `Blizzard` (`78/100`, `81/100`), Turn 1 `Wave Crash` (`60/100`) or recoil (`69/100`), or Turn 2 recoil (`62/100` vs `61/100`), exhausting all 713 fallback rebuilds across all 6 restart tiers.

### Proof 4 — Upstream KO-Threshold Target Re-Aiming & `mixOf()` Limit Cycle (`gaveup-2700519640.md`)
- **Battle**: `mimic:gen9championsvgc2026regmcbo3-2700519640` (9 turns).
- **View Contrast**:
  - `p2@p1` (Ch 1): **PASS** (~35s, 4 rounds, 4 rebuilds, ~1,200 probes).
  - `p1@p2` (Ch 2): **PASS** (~35s, 4 rounds, 4 rebuilds, ~1,100 probes).
  - `both@spectator` (Ch 0): **GAVE UP** (2,844.8s sweep / 438.1s trace, `stop = "stalled"`, 200+ rounds, 500+ rebuilds, 220,169 probes).
- **Coupled Turn 1–6 Manifold**:
  - Turn 1 `Sylveon` `Moonblast` leaves `Archaludon` (`197` HP) at `89/197` (`45/100`), followed by Leftovers (`51/100`).
  - On Turn 2, `Charizard-Mega-Y` fires `Heat Wave` with primary target `p1b: Archaludon` (KOing it) and hitting `p1a: Sneasler` (`17/100`). Any guess where `Sylveon` SpA is too high (needed later for Turn 5 `Pelipper 19/100` vs `25/100`) causes Archaludon to drop to `23/100` or faint earlier, re-aiming Turn 2 `Heat Wave` to `p1a: Sneasler` (`|move|p2a: Charizard|Heat Wave|p1a: Sneasler`).
  - In Search 4, deep backtracking clears Turn 2 and reaches Turn 6 (`Pelipper 25/100` vs `19/100`), but `mixOf()` splices `Sylveon from the new, Incineroar from the last`, immediately breaking Turn 2 `Heat Wave` target and locking the engine into an identical 5-round cycle across Rounds 16, 21, 26, ..., 71.

---

## 5. Merged Reports Manifest

All **109 / 109** reports from `bucket_F35.json`:

| # | Report File | Kind | Views Failed in Sweep | Trace Result | Shard Cluster | Primary Bottleneck |
|---|---|---|---|---|---|---|
| 1 | `gaveup-2691185770.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C12` | Turn 4 Eruption/Wood Hammer recoil deadlock (`Camerupt 13/177` `7/100` vs `0 fnt`, `Rillaboom 60/100` vs `61/100`, Eruption BP `11`, 6-term GT `48/100`; 80 rounds / 513 rebuilds, `stop = 'searches'`). |
| 2 | `gaveup-2691407539.md` | `gaveup` | `p1@p2`, `both@spectator`, `p2@p1` | `GAVE UP (all 3 views)` | `S15-C16` | Turn 6 Rain Overheat + Revival Blessing `50/100y` vs `49/100` coupled to Turn 5 3-HP `Rillaboom` survival (Water Spout -> Wood Hammer recoil -> LO -> GT -> Burn). |
| 3 | `gaveup-2691422025.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | Turn 6 `6.8` (`Pawmot 78/100` U-turn) coupled across 6 active Pokémon to Turn 3 `81/100`, Turn 4 `20/100y` + Eject Button, Turn 5 `19/100`, and PRNG crit shift across 240 rebuilds. |
| 4 | `gaveup-2692323263.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 5 `5.9` (`Incineroar 72/100` Sitrus Berry vs `73/100`, `97/202` vs `98/202` both `48/100` pre-heal) coupled across 4 turns of Flare Blitz recoil and Make It Rain (128-rebuild fallback). |
| 5 | `gaveup-2693661887.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 3 Hippowdon GT (`80/100` vs `79/100`), Turn 4 Sitrus (`51/100` vs `50/100g`), Turn 5 Shadow Ball + recoil + High Horsepower + Sitrus (`105/202 = 51.98%`) across 128-rebuild fallback. |
| 6 | `gaveup-2693728480.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C12` | Turn 8 Leftovers/GT residual speed order (`Archaludon 112` vs `Rillaboom 108`) + Turn 3 Sitrus/recoil (`48/100` vs `47/100`) + Turn 11 Dragon Pulse (`17/100`; 94 rounds / 575 rebuilds). |
| 7 | `gaveup-2694110509.md` | `gaveup` | `both@spectator`, `p2@p1` | `GAVE UP` | `S12-C10` | Turn 11 lethal KO threshold (`+4 Milotic` Ice Beam OHKO on `Rillaboom` vs Grassy Glide) + dual Leftovers/GT/Sandstorm `1/16` jitter + mirror Milotic ties; `p2@p1` also hit `searches`. |
| 8 | `gaveup-2694124000.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 4 `4.7` (`Basculegion 62/100 brn` vs `63/100 brn`): 6-variable coupling across Turn 1 Dragon Pulse + Wave Crash recoil, Turn 2 Flare Blitz + GT (`8/100` Gholdengo), and Turn 4 recoil + burn. |
| 9 | `gaveup-2694202774.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 3 Corviknight Leftovers (`82/100` vs `83/100`, `R=47` at `HP SP=32`) + Turn 5 Mega Garchomp-Z (`203`) vs Tailwind Corviknight (`174`) + Brave Bird recoil (`76/100` vs `75/100`), 210 rounds. |
| 10 | `gaveup-2694404796.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S03-C11` | Turn 4 line 8 (`Corviknight 55/100` Recoil vs `56/100`): 4-turn chain of 3 Leftovers ticks + 3 Brave Bird recoils (`Vivillon`, `Golisopod`, `Politoed 46/100`), `stop = searches`. |
| 11 | `gaveup-2694482972.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 6 Basculegion Wave Crash recoil (`57/100` vs `58/100`) integrating 3 capped-KO recoils (Farigiraf, Charizard, Incineroar) where Atk has 0 effect on recoil + Turn 0 `72==72` Intimidate oscillation. |
| 12 | `gaveup-2694644290.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Turn 2 Rillaboom Wood Hammer into Clefable links 5 percentage gates across 4 variables (`Clefable 9/100`, Sitrus `34/100`, recoil `71/100`, GT `76/100` & `40/100`, Moonblast KO). |
| 13 | `gaveup-2694901513.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S03-C11` | Turn 4 line 118 (`Incineroar 51/100` GT vs `52/100`, `105/202 = 51.98%` 1-HP cliff) coupled to Turn 2 Earth Power/Sitrus/Snarl, Turn 3 Flare Blitz recoil, and Turn 4 KO recoils (`stalled`). |
| 14 | `gaveup-2694941298.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turn 3 sequential hits on `Ninetales` (`Sylveon` Hyper Voice `35/166` vs `26/166` at `3.9` + `Incineroar` Flare Blitz recoil `88/100` vs `90/100` at `3.14`), 62-round ping-pong. |
| 15 | `gaveup-2695098447.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 4 `4.9` Volcarona Giga Drain on Mega Gengar (`36/100` vs `37-39/100` after `4.3` `34/100`), coupled to Turn 1 Mega order, Turn 3 Kingambit/Glimmora, and Turn 4 Substitute break. |
| 16 | `gaveup-2695143625.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C12` | Turn 3 `3.14` (`Rillaboom 28/100` GT vs `29/100`, `60/207 = 28.9855%`) coupled across 3 turns of Wood Hammer recoil + Farigiraf Hyper Voice + Turn 1 Spe order (`88` rounds / `480` rebuilds). |
| 17 | `gaveup-2695220160.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Turn 6/7 Grassy Glide + Arcanine Sitrus + GT (`74/100` vs `75/100` at `7.10`) coupled back to Turn 1 Flare Blitz overkill recoil (`73/100` vs `69/100`) and Turn 6 Close Combat (`64/100` vs `62/100`). |
| 18 | `gaveup-2695251685.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 9 Scarf Garchomp vs Mega Raichu-Y speed inversion + `+3` Quiver Dance Giga Drain/Rock Slide (`Incineroar 40/100` vs `37/100`) + Turn 12 1-HP Rillaboom survival across 8 active Pokémon. |
| 19 | `gaveup-2695252743.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 5–8 capped Wave Crash recoil (`70/100` vs `73/100` off Incineroar `78` HP), Turn 7 Emergency Exit (`<= 50%` on Golisopod), and Turn 8 Basculegion `9/195` LO faint boundary. |
| 20 | `gaveup-2695323073.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C12` | Turn 3 `3.12` Dazzling Gleam vs Sneasler Focus Sash (non-crit only on 4/16 rolls `>= 157` dmg); 1D fallback couldn't co-adjust Floette SpA and Sneasler HP/SpD without breaking `3.8`/`3.10`. |
| 21 | `gaveup-2695375692.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Floette-Mega lethal Light of Ruin recoil (T1 Sneasler, T3 Froslass) + GT (`50/100g -> 56/100 -> 1/100 -> 6/100 -> 11/100`): 3-body Diophantine system, only 2/35,937 HP triples, 266-round oscillation. |
| 22 | `gaveup-2695408111.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 3 `3.11` 4-hit Beat Up on Annihilape (`187/217` vs `184/217`, 3-HP gap) forming a 9-equation system across 5 Pokémon (T1 Aura Sphere/Flamethrower, T2 `2/100` Lucario, T3 order). |
| 23 | `gaveup-2695411986.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Turn 3 Grimmsnarl 1-HP discrepancy (`87/100`; `168/192` vs `167/192`) under Trick Room + Turn 2/3 Pelipper (`56/100 -> 52/100`) + Charizard (`74/100`), 64 rounds (`searches`). |
| 24 | `gaveup-2695766419.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 6 (`P2 Rillaboom 47/100` GT vs `48/100`): coupled Wood Hammer damage, recoil, Life Orb, and GT across 5 Pokémon tied to Turn 2/4 speed order and Turn 5 Heat Wave (`48/100`). |
| 25 | `gaveup-2695929835.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | 7-turn P1 Incineroar HP chain (9 Leftovers/Flare Blitz recoil/Rocky Helmet events; HP SP=6 pinned) causing Turn 6–7 diffs (`44/100` vs `45/100`, `12/100` vs `11/100`, `28/100` vs `30/100`). |
| 26 | `gaveup-2696135858.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | 7-way damage/recoil/Berry cascade across Turns 1–4 leaving `Rillaboom` Turn 4 GT at `80/100` vs `79/100` (capped lethal Wood Hammer off Sylveon's remaining HP); fallback only probed `Rillaboom`. |
| 27 | `gaveup-2696612364.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turns 2–5 4-turn Leech Life drain feedback loop on Mega Golisopod + multi-unit GT/Leftovers `+-1%` rounding (`89/88`, `62/61`, `69/68`) + Turn 4 Hyper Voice (`60/100` vs `63/100`), 1,461,745 probes. |
| 28 | `gaveup-2696739540.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 5 line 13 Sneasler GT heal (`57/100` vs `58/100`; `91/157 = 57.96%`) coupled with Turn 3–4 Double-Edge recoils (`86/100`, `73/100`), Turn 4 Salamence speed, and Turn 5 Hyper Voice (`41/100`, `28/100`). |
| 29 | `gaveup-2696786268.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | Turn 8 `8.4` (`Golisopod 29/100` Rain Heat Wave) coupled with Turn 6 (`86/100` + `41/100` + Leech Life drain `70/100`) and Trick Room speed brackets (`Camerupt < Ampharos < Golisopod < Farigiraf`). |
| 30 | `gaveup-2696854354.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turn 4 Heat Wave `50/100y` (`76/152` Golisopod) + Turn 5 Leech Life strictly in `[96, 100]` dmg (no Sitrus on Incineroar `50/100g` yet drain `88/100`) before Heat Wave `36/100` (82 rounds). |
| 31 | `gaveup-2696882739.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Turn 5 Expanding Force `25.12%` green/yellow threshold (`25/100` vs `20/100y` on Mudsdale) coupled to Turn 1 Beat Up Stamina + Flare Blitz + Sitrus (`60/100`) + recoil (`80/100`) + Turn 3 LO (114 rounds). |
| 32 | `gaveup-2696883094.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 4 `4.13` (`Salamence brn 41/100` vs `42/100`) coupled to Turn 3 Double-Edge/Rocky Helmet recoil, Turn 4 Grassy Glide (`Incineroar 8/100`), and Gholdengo/Incineroar speed order (`76` rounds / `485` rebuilds). |
| 33 | `gaveup-2696984901.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 6 Incineroar 4-stage recoil chain (Electro Shot `23/100` -> Sitrus `48/100` -> Flare Blitz vs `+1` Stamina Archaludon -> recoil `34/100` vs `36/100`), 202 fallback tweaks broke earlier turns. |
| 34 | `gaveup-2697482721.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turn 5 `Bastiodon` Metal Burst (`floor(1.5 * dmg)`) coupling Dragonite SpA/HP with Bastiodon HP/SpD (`18/100 -> 2/100`, Dragonite `35/100` vs `34/100` at `5.16`) + Turn 3/4 Rough Skin (`56/100` vs `55/100`). |
| 35 | `gaveup-2697563183.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Two-state limit cycle between Turn 6 Rillaboom recoil (`94/100` vs `93/100`) and Turn 2/3 Golisopod Leech Life + Rocky Helmet (`80/100` vs `78/100`) + Turn 4 Close Combat (`14/100` vs `35/100`). |
| 36 | `gaveup-2697585403.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Unpinned percentages across 8 active combatants (Turn 1 `92/100`, Turn 8 Rough Skin + EQ KO razor, Turn 9 `11/150 = 7/100`), Delphox `204==204` ties, Turn 6 miss/crit, Turn 7 Sucker Punch trap. |
| 37 | `gaveup-2697629629.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 7 Rillaboom GT cliff (`69/203 = 33.99% -> 33/100` vs `70/203 = 34.48% -> 34/100`) coupled with Turn 1/3/4/6/7 Talonflame Flare Blitz recoil and Turn 6 Wood Hammer recoil. |
| 38 | `gaveup-2697714859.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 5 `5.14` (`Basculegion 81/100` GT vs `82/100`): every 1D fallback tweak across 128 rebuilds broke Turn 1 (`7/100`), Turn 3 (`23/100`), Turn 4 (`69/100`, `79/100`), or Turn 5 (`52/100`). |
| 39 | `gaveup-2697730244.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 9 `9.16` (`Politoed 38/100 slp` Muddy Water vs `36/100 slp`), cascading into Turn 10 `|cant|p2b: Politoed|slp` vs Archaludon Protect order across Drizzle/Drought and Stamina/Competitive. |
| 40 | `gaveup-2697814978.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S15-C16` | Turn 1 `1.11`: 6-way coupling between pre-Mega speed, Fake Out speed, Poison Touch, and Delphox `79/100 -> 66/100 psn` (usage `hp=0` gives `67/100`); 1D fallback broke `1.0/1.4/1.5/1.8` across 240 rebuilds. |
| 41 | `gaveup-2697977569.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Coupled Turn 2 Moonblast (`Basculegion 3/100 = 6/197`), Turn 3 Hyper Voice (`89/100`, `72/100`), and Turn 4 Wood Hammer recoil (`50/100g` on Rillaboom) trapping 1D fallback between T3 and T5 (79 rounds). |
| 42 | `gaveup-2698326253.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 8 (`7.16`) Rillaboom GT heal (`38/100` from `176` maxHP vs usage `39/100`), 5-way coupled with Floette Draining Kiss, Wood Hammer recoil, and Turns 0/1/3/5/7 speed and damage lines. |
| 43 | `gaveup-2698342253.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Turns 5–9 5 narrow speed margins (3–10 pts, T7 Garchomp `154` vs Glimmora `151` GT order, T8 Scarf Garchomp `207` vs Mega-Z `203`) coupled to Rough Skin (`42/43`), GT (`92/93`), Blaziken recoil (`56/57`). |
| 44 | `gaveup-2698495242.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Zero faints across 12 turns with 6 active combatants, 10 turns of Grassy Terrain, Turn 3 Wood Hammer recoil (`87/100`), and Turn 4 U-turn (`52/100`) creating cumulative 1-HP drift across turns 1–12. |
| 45 | `gaveup-2698770067.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Turn 1 Wave Crash + Sitrus `50/100g/y` border + 4 Beat Up hits + Turns 2–6 GT/Leftovers (`floor(M/16)`) + Turn 7 `146/177` vs `145/177` trapping 1D fallback in T1–T6 cycles (76 rounds). |
| 46 | `gaveup-2698886937.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turn 5 `Rillaboom` lethal Wood Hammer recoil (`88/100` vs `89/100`) depended on Farigiraf's HP from T1–T2 `Salamence` Hyper Voice (fainted T4 so fallback never adjusted it) + T6 Rough Skin/recoil + T7 `8` HP psn (183 rounds, 6.1M probes). |
| 47 | `gaveup-2698975633.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Turn 4 Mega Salamence Hyper Voice (`Delphox 48/100` vs `54/100`, `Incineroar` Sitrus `51/100` vs `50/100g`) + Basculegion Wave Crash recoil (`58/100` vs `59/100`); 1D fallback breaks T3 recoil (`76/100`) or T4 Sitrus (102 rounds). |
| 48 | `gaveup-2699388729.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S15-C16` | Oscillation between Turn 7 Sinistcha Matcha Gotcha drain (`75/100` vs `76/100`) and Turn 9 Staraptor Brave Bird recoil (`7/100 brn` vs `6/100 brn`) across 4 random-spread battlers and 6 HP modifiers. |
| 49 | `gaveup-2699725143.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 9 `9.11` Basculegion GT heal (`21/100` vs `22/100`; 1-HP boundary) coupled with Turn 6 Shadow Sneak, Turn 8/9 Wave Crash recoils (`32/33`, `15/18`), and Ceruledge `12/100` across 128 fallback rebuilds. |
| 50 | `gaveup-2699731837.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C12` | Turn 3 `3.12` (`Golisopod 28/100` vs `22/23/30/100`): 4x/STAB Heat Wave ladder `{84, 88, 96}` + `Farigiraf hp=23` capping Leech Life drain at `+57` (vs `+58`); requires joint `(Farigiraf hp, Golisopod hp)` or `(Camerupt spa, Golisopod spd)`. |
| 51 | `gaveup-2699891620.md` | `gaveup` | `both@spectator`, `p1@p2`, `p2@p1` | `GAVE UP` | `S13-C12` | Turn 5 `5.8-5.9` (`Hyper Voice` spread -> `Delphox 0 fnt` vs crit/target flip): all 3 views exhausted 128 fallback rebuilds because every SpA/SpD/Spe perturbation broke T1 speed order or T2 damage. |
| 52 | `gaveup-2700106972.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 7 `7.6` (`Scrafty` Drain Punch on Torkoal `72/100` draining to `52/100` vs `51/100`) coupled to Turn 6 & 7 capped Flare Blitz recoils on Scrafty-Mega and Oranguru (66 rounds / 371 rebuilds / 783,715 probes). |
| 53 | `gaveup-2700204796.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C12` | Turn 3 `3.12` (`Milotic 49/100 brn` vs `50/100y brn`, `87/175 = 49.71%` vs `88/175 = 50.29%`) coupled with Turn 2 Flare Blitz recoil (`89/100`) and Turn 3 Brave Bird/Leftovers/recoil (`74`, `80`, `86`; 70 rounds / 366 rebuilds). |
| 54 | `gaveup-2700286889.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 4 Rillaboom Wood Hammer recoil (`12/100` vs `13/100`) and Life Orb (`2/100` vs `3/100`) from atypical `203` Max HP (`hp=28`) vs `207` usage (`hp=32`); 1D fallback broke Turn 2 (`21`, `93`) or Turn 3 (`18`). |
| 55 | `gaveup-2700519640.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C11` | Turn 1 Sylveon Moonblast vs Archaludon (`45/100`) creates Turn 2 Charizard Heat Wave target cliff (`p1b: Archaludon` vs re-aimed `p1a: Sneasler`), coupled to Turn 5/6 Pelipper (`19/100` vs `25/100`) and Search 4 `mixOf` 5-round cycle. |
| 56 | `gaveup-2700574526.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Turn 2 Make It Rain (`41`) + LO (`-16`) + Mirror Coat (`-82`) + GT (`+10`) requires Gholdengo to hit exactly `83/164` (`50/100g` border), coupled with Turn 6 Hyper Voice on Milotic (`69/100` vs `75/100`); 128 fallback rebuilds. |
| 57 | `gaveup-2700734914.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 4 upkeep GT/Leftovers residual order requires Milotic (`Spe 120`, planted `19`) > Archaludon (`Spe 105`, planted `0`); raising Milotic `spe` in 1D fallback steals bulk SP under 66-SP cap and breaks Turn 2.9 Leech Life (`68 -> 66`) or `4.9`. |
| 58 | `gaveup-2700840500.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S15-C16` | Turn 5 Luxray Double-Edge onto Incineroar: 1-HP recoil shift flipped both Luxray recoil (`75/100` vs `76/100`) and LO tick (`65/100` vs `66/100`); 1D fallback broke Turn 4 (`84`, `79`) or Turn 5 speed across 668 rebuilds. |
| 59 | `gaveup-2700905876.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Turns 2–4 4-way Diophantine quantization around P1 Rillaboom (Fake Out + LO + GT + Wood Hammer recoil + Water Spout + Electro Shot) exhausted 125 1D fallback rebuilds on Turn 3 and `guessTries` across 112 rounds. |
| 60 | `gaveup-2700919014.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Turn 5 Whimsicott Moonblast on Staraptor-Mega (`19/100` vs `26/100`, `20/100y`, `18/100`) coupled to Turn 4 Brave Bird (`36/100`), Sitrus (`61/100`), and recoil (`78/100`); 1D fallback breaks T1–T4 (97 rounds). |
| 61 | `gaveup-2700926958.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 5 couples 4 Pokémon across 11 interdependent events (LO, Rock Slide, Leftovers, mutual Infestation, Toxapex `49==49` speed tie, Turn 7 `50/100g` border); perturbing Toxapex `spe` steals bulk SP and breaks `4.6`/`5.6` (280 rounds, 2.3M probes). |
| 62 | `gaveup-2701055033.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 6 Flare Blitz recoil (`67/100` vs `68/100`) + 1-pt Pelipper (`85`) vs Incineroar (`84`) speed tie coupled with Turn 5 spread Make It Rain (`72`, `68`, Sitrus `66/100`); 128 fallback rebuilds broke `3.12`/`5.7`/`5.8`. |
| 63 | `gaveup-2701145928.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S14-C13` | Turn 8 `8.2` (Archaludon Electro Shot retargeted to Indeedee because Turn 7 Flash Cannon KOed Tyranitar instead of `21/206`); 1D fallback broke Turn 6 Crunch (`60/62`), Leftovers (`47/48`), or Turn 2 Encore (40 rounds, 349k probes). |
| 64 | `gaveup-2701610974.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 6/7 Incineroar Flare Blitz recoil on Focus Sash Venusaur (`1/100`) + GT heal (`65/100` vs `66/100`; `59.8%+6.1%` vs `60.1%+6.1%`), coupled with T4 Sludge Bomb, T5 Fake Out, T7 Flare Blitz across 128 rebuilds. |
| 65 | `gaveup-2701726652.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Volcarona repeated `3/180` survivals (`1/100 -> 7/100` vs `6/100` GT at T6 & T8) + Turn 5 Basculegion lethal Wood Hammer recoil -> Rillaboom LO (`76/100` vs `77/100`) locking `mixOf()` into a 255-round loop. |
| 66 | `gaveup-2701743398.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Turn 4 Floette Light of Ruin recoil (`69/100` vs `66/100`) + GT heal (`4.11` `74/100` vs `75/100`) coupled with Indeedee Focus Sash discontinuity; 1D fallback broke `1.2/1.3/2.9/3.5/4.1/4.9` (71 rounds, 2.04M probes). |
| 67 | `gaveup-2702099686.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S15-C16` | 1D fallback ping-ponged between Turn 2 Matcha Gotcha double drain (`54/100`, `68/100` across Sinistcha/Meganium/Indeedee) and Turn 4 Trick Room speed inversion + Dazzling Gleam (`71/100` vs `73-76/100`). |
| 68 | `gaveup-2702375487.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S04-C12` | Turn 4 Golisopod Leech Life into Rocky Helmet Incineroar couples Incineroar (`46/100`), Golisopod drain (`98/100`), and Rocky Helmet recoil (`82/100` vs `81/100`) into a 1-HP feasibility window (134 rounds, 128 rebuilds). |
| 69 | `gaveup-2702457714.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 12 Klefki HP (`72/100` vs `70/71/100`) over-constrained by 8 upstream checkpoints (T4 Hyper Voice, T5 Gleam, T7 Terrain order, T8 U-turn, T9 Sandstorm, T10/11 Sitrus/recoil, T11 dmg); 128-rebuild 1D fallback breaks earlier turns. |
| 70 | `gaveup-2702517764.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Inverse coupling between Turn 4 Rillaboom Wood Hammer on Farigiraf (+ Sitrus/GT) and Turn 5 lethal Wood Hammer recoil (`floor(Farigiraf_HP/3)`, `58/53` vs `55/52`), trapping 1D fallback in T4 <-> T5 oscillation (228 rounds). |
| 71 | `gaveup-2703040859.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 6 `6.16` Raichu-Mega-X GT heal (`21/100` from `28/137 = 20.44%` vs `22/100` from `29/137 = 21.17%`), accumulating 7 HP steps across Fake Out, U-turn, GT, Sitrus, and two Volt Tackle recoils. |
| 72 | `gaveup-2703554195.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Two-state limit cycle at Turn 2 between Annihilape Grassy Glide (`2.7: 59/100` vs `62/100`) and Rillaboom GT heal (`2.15: 32/100` vs `33/100`), coupled to Turn 1 Politoed overkill recoil and Manectric Close Combat (226 rounds). |
| 73 | `gaveup-2703847056.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C11` | Turn 3 `3.17` Indeedee Colbur Brutal Swing (`77/100`; `126/163` vs `122/163`) fails 1D fallback because raising Indeedee `def >= 29` (with low Scizor `atk=2`) lets Gardevoir survive Turn 2, flipping `3.12` target from `p1b` to `p1a`. |
| 74 | `gaveup-2704070734.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 3 Wave Crash survival (`Tyranitar-Mega 2/100`, `Basculegion 68/100` recoil) + speed order (`135 > 133`) + Rock Slide (`50/100g`, `38/100`) causes Gholdengo target divergence at `3.11`; 1D fallback fails across all 6 starts. |
| 75 | `gaveup-2704126276.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Turn 5 Incineroar lethal Flare Blitz on Gholdengo 1-HP recoil mismatch (`49/100` vs `48/100`) coupled to Turn 1 Heat Wave (`23/100`), Life Orb ticks, and Turn 5 Clanging Scales; 1D fallback breaks Turns 1–4 (72 rounds). |
| 76 | `gaveup-2704682119.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 4–5 Giga Drain + GT + Sitrus 4-way coupling (`Volcarona 60/100` drain vs `67/100` GT at `4.16`; `98/100` vs `99/100` at T5) exhausted depth-8 `choose()` `guessTries`, wiping `pins = null` and regressing to T1. |
| 77 | `gaveup-2704859971.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S15-C16` | Turn 4 `4.15`: random-spread Rillaboom (`2/4/30/9/8/13`) ended at `53/177 = 29.94% -> 30/100` after Wood Hammer recoil and GT, while priors gave `31/100`; 1D fallback broke T0 Intimidate, T1–T3, or T4 recoil. |
| 78 | `gaveup-2704908014.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 10 2-state oscillation between Matcha Gotcha on Rillaboom (`43/100` vs `46/100`) and Sinistcha drain (`51/100` vs `52/100`) across 10 turns of Leftovers, GT, and Wood Hammer recoil (`mixOf` 76-round loop). |
| 79 | `gaveup-2704977522.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | `choose()` exhausted `guessTries` across 8 active Pokémon and 1-stat `fallback` failed on Turn 5 `5.10` (Rillaboom Wood Hammer on Annihilape `11/100` + recoil `69/100` + GT `74/100` vs `75/100`), coupled with T3/4 Flare Blitz recoil & Rock Slide. |
| 80 | `gaveup-2705260964.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 6 `6.7` Staraptor Brave Bird recoil stalls at `11/100` vs `10/100` (even with `hp` pinned exact) from 4 cumulative recoil/Last Respects exchanges across T3–T5; 1D fallback breaks `1.8/4.2/4.4/5.3` (116 rounds / 573 rebuilds). |
| 81 | `gaveup-2705399697.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Phases 1–4 stalled on T5/6 Flare Blitz recoil (`46/100` vs `45/100`); Phases 5–6 reached T9/10 Bellibolt sequential Parabolic Charge drain (`34/100` from Mega Garchomp-Z, `65/100` from Sinistcha) where matching one broke the other by `1%`. |
| 82 | `gaveup-2705857468.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Coupled 8-Pokémon system across T1 Follow Me + Flare Blitz recoil (`82/100`), T2 TR Gleam (`Incineroar 51/100 > 50%` non-Sitrus) + Flare Blitz + Sitrus (`63/100`) + Camerupt (`64/72`) + T3 Heat Wave (`47/45`). |
| 83 | `gaveup-2706048563.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S07-C14` | Turn 6 Rain Flare Blitz `1%` mismatch on Golisopod-Mega (`61/100 par` vs `62/100 par`) coupled to Turn 4 Leech Life drain (`96/100 par` vs `95/100 par`); 1D fallback on Turn 6 immediately breaks Turn 4 (67/148 rounds). |
| 84 | `gaveup-2706634714.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C11` | Turn 4 `4.8` Delphox Heat Wave primary target mismatch (`p2b: Sneasler` vs `p2a: Indeedee`) coupled in 1D fallback to Turn 1 Raichu Poison Touch `3/100` survival (firing T4 Zap Cannon at `3.7`) and T1 switch-order flips. |
| 85 | `gaveup-2707165302.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Turn 2 Matcha Gotcha dual-target drain (`36/100`, `68/100`) couples with Turn 4 Hyper Voice (`31/100`), Matcha Gotcha drain (`55/100`), and Sylveon burn (`16/100` vs `15/100`): T4 fixes break T2 and T2 fixes break T4. |
| 86 | `gaveup-2707214168.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | Dual-mirror Archaludon (Leftovers + Stamina `+5/+6` Def) oscillation between T4/5 Sneasler (`2` vs `11`) and T8/9 Incineroar (`62` vs `65`) under 66-SP cap; `spend.fruitless.add(mark)` permanently disabled fallback after 8 failed rebuilds. |
| 87 | `gaveup-2707540379.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turns 6–12 mirror between both Golisopod-Megas (mutual Leech Life + `ceil(dmg/2)` drain) and both Archaludons (Leftovers + Stamina) coupled 11 stats across 7 turns (`68` vs `69`, `50/100y` vs `47/100`; 1,223 rebuilds). |
| 88 | `gaveup-2707618454.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | Turn 2 `2.23` (`Sinistcha 63/100` vs `62/100` 1-HP boundary after Mystical Fire + dual Matcha Gotcha drain + Sandstorm), where every 1-stat move broke `2.4`, `2.6` (TR `Tyranitar < Sinistcha`), `2.7`, or `2.11`. |
| 89 | `gaveup-2707699206.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S03-C10` | Turn 4 `4.9` (`Incineroar` Parting Shot target `p1b: Sinistcha` vs `p1a: Delphox`): 1D fallback could not shift discrete target/PRNG without violating T0 Intimidate, T1 pre-Mega order, T1 OHKO, T3 Revival parity, or `4.8` Matcha Gotcha drain. |
| 90 | `gaveup-2707853669.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 6 mirror Golisopod-Mega Leech Life (`0.25x` double-resisted, `12-18` dmg where `+-1` HP flips drain `%`) stalls at `27-29/100` vs `25/100`; 1D fallback breaks `4.9` drain (`58 -> 57`), `1.10`, or `3.7` mirror speed tie (108 rounds / 569 rebuilds). |
| 91 | `gaveup-2707869029.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 3 Incineroar Bug Buzz + Flare Blitz recoil + Sitrus (`<= 50%`, `70/100` vs `69/100` or unpopped) and Turn 4 GT heal (`54/100` vs `55/100`), oscillating with Turn 2 recoil (`35/100` vs `37/100`) across 128 fallback rebuilds. |
| 92 | `gaveup-2707991516.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S11-C09` | Turn 4 `4.10` Golisopod Leech Life drain saturation cap (`100/100` vs `96-99/100`) couples with `4.6` Pelipper Sitrus (`53/100` vs `52/100`) and Turn 2 CC/Hyper Beam/drain; 1D fallback breaks T2 or `4.4/4.6` + variant backtrack oscillation. |
| 93 | `gaveup-2708031224.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S12-C10` | 48-round limit-cycle oscillation on Turn 5 between `p1a: Basculegion` Wave Crash recoil (`63/100` vs `64/100`) and GT heal (`69/100` vs `70/100`) alongside `+5` Stamina Archaludon and 7 Leftovers/GT ticks. |
| 94 | `gaveup-2708469002.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S08-C13` | Turn 5 Rillaboom GT heal stalls at `73/100` vs `72/100` (`151/207 = 72.95%`, 7-event accumulator from T1–T5), compounded by Archaludon (`115`) vs Rillaboom (`113`) 2-pt speed margin and T4 Heat Wave `4/100` razor (124 rounds / 540 rebuilds). |
| 95 | `gaveup-2708532185.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 9 P2 Rillaboom Wood Hammer damage/recoil (`Incineroar 78` vs `80` and `Rillaboom 60/100` where `123/205 = 60.000%` exact boundary vs `58-59/100`), coupled across 5 turns of Leftovers and GT drift. |
| 96 | `gaveup-2708784758.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S10-C12` | Turn 4 `4.11` (`Araquanid 74/100` Leftovers vs `73/100`, `127/172 = 73.84%` at `hp=29` vs `128/175 = 73.14%` at `hp=32` across T2–T4 chip + Leech Life + Leftovers); locked at `hp=32` across 367 rebuilds / 128 rounds. |
| 97 | `gaveup-2709239553.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S15-C16` | Turn 4 `4.4`: Froslass landed on `36/177` (`20/100y`, `36*5 > 177`), whereas guesses with `hp*5 <= M` emitted `20/100r`; 713 1D fallback rebuilds broke T1 Blizzard/Wave Crash/recoil or T2 recoil. |
| 98 | `gaveup-2709266531.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | 8 Flare Blitz recoils + 5 GT ticks coupled T8 Blaziken KO recoil to T1 Floette HP (`27`), T7 recoil to T4/6 Rillaboom HP (`70`), and T9 Incineroar Sitrus knife-edge (`100/201 <= 100`), exhausting `guessTries` while 1D fallback perturbed T8/9 attackers. |
| 99 | `gaveup-2709275728.md` | `gaveup` | `p2@p1`, `p1@p2`, `both@spectator` | `GAVE UP` | `S02-C13` | All 3 views stalled on T5/6 (`Matcha Gotcha` drain + `Steelix-Mega Bulldoze` zero-sum `Tyranitar 0 fnt` vs `Pawmot 4/100`), while benched `Zoroark-Hisui` triggered `disguisableStays()` across 8 full sub-searches. |
| 100 | `gaveup-2709475873.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S06-C11` | Turn 8 Mega Golisopod Leech Life drain off-by-1% (`60/100 brn` vs `61/100 brn`) couples T7 Overheat, Leech Life drain, and Spicy Spray burn; alternates across 291 rounds with T2/3 Scovillain (`45` vs `42-44`) while T8 fallback stops at `6.8`/`3.11`. |
| 101 | `gaveup-2709613144.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 6 Rillaboom GT heal (`97/100 = 97.2%` vs `98/100 = 97.6%`) oscillating every round with Turn 2 Fake Out (`83` vs `80`) and Turn 3 Wood Hammer recoil (`86` vs `85`) + cross-turn `Spe_P1 == Spe_P2` Incineroar tie across 128 rebuilds. |
| 102 | `gaveup-2709819866.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 5 `5.9` (`P1 Basculegion 30/100` recoil vs `31/100`) coupled to Turn 1 Wave Crash damage/recoil (`83/100`) and P2 Golisopod bulk; 107-rebuild fallback broke Turn 1 or wasted probes on dead/benched Pelipper & Incineroar. |
| 103 | `gaveup-2710440936.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S02-C15` | Turn 4 `4.8` (`Rillaboom 73/100` vs `72/100` GT heal at `151/207` vs `150/207` 1-HP boundary) coupled with Turn 3 Rough Skin + Wood Hammer recoil (`61/100` vs `60/100`) and T1/T4 speed corridor (`Whimsicott > Sneasler > Arcanine > Charizard`). |
| 104 | `gaveup-2710507620.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S03-C11` | Turn 4 5-way coupled Wood Hammer recoil (`43/100` vs `44/100`), GT `50%` color boundary (`49/100` vs `50/100y`), Farigiraf Sitrus (`51/100`), and Tailwind+Par Salamence/Farigiraf order; `mixOf` looped across 97 rounds. |
| 105 | `gaveup-2710599607.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S05-C09` | Turn 6 `Basculegion` Wave Crash recoil (`62/100` vs `63/100`, chained from T5 Wave Crash + Sandstorm + GT) coupled with T1 Perish Song tight speed ordering (`189 > 172 > 170 > 105`), 331-round two-state limit cycle. |
| 106 | `gaveup-2710753606.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S09-C10` | Turn 3 Sinistcha Sandstorm upkeep (`62/100` from `95/153 = 62.09%` vs `61/100` from `94/153 = 61.44%`), governed by 7 interlocking events (Sandstorm x3, Psychic, 3 Matcha Gotcha drains capped on Hatterene KO) across 128 rebuilds. |
| 107 | `gaveup-2710930682.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S13-C11` | Turn 4 62-round infinite ping-pong between Noivern Iron Head damage (`77/168` vs `83/168`) and Volcarona GT heal (`73/100` vs `74/100`) coupled via Normal Gem Boomburst and 66-SP cap until `stalled = 64`. |
| 108 | `gaveup-2711070862.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S01-C13` | Turn 3 Garchomp Stomping Tantrum vs Incineroar Atk/Def degeneracy (`28/100`, Sitrus `52/100`) collided on Turn 4 (4-way Soak + GT + Rock Slide + EQ + Flare Blitz `2/202` `1/100` + GT `6/100` vs `7/100`); 1D fallback tweaked `hp=32` without fixing Atk. |
| 109 | `gaveup-2711117287.md` | `gaveup` | `both@spectator` | `GAVE UP` | `S03-C11` | Turns 4–6 coupled Rough Skin (`62/100` vs `61/100` on Staraptor), GT heal (`6/100` vs `7/100` on Basculegion), and Wood Hammer/Flare Blitz recoil: `choose()` hit `guessTries` and 128 1D fallback rebuilds broke T1/3/4/5 percentages. |
