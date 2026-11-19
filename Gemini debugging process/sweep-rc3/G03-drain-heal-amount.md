# G03: drain heal amount

## 1. Scope

| Field | Value |
|---|---|
| Bucket | `G03` |
| Source | `sweep-rc3/all.jsonl`, commit `2c4e65e5cd81` (89,346-game corpus sweep) |
| Cases | 2 GAVE UP record(s), 2 game(s) |
| Views | both@spectator |
| Soundness | all real spreads kept, 0 broken proofs, 0 outside spreads |

## 2. Evidence

| case | view | limits hit | seconds | divergence | expected | actual |
|---|---|---|---:|---|---|---|
| `mimic:gen9championsvgc2026regmcbo3-2693949366` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `guessTries`, `probes`, `searches` | 12900 | T9 `-heal from drain: another amount` | `|-heal|p1b: Golisopod|31/100 brn|[from] drain|[of] p2a: Sinistcha` | `|-heal|p1b: Golisopod|32/100 brn|[from] drain|[of] p2a: Sinistcha` | **rerun: `PASS` (3222)**
| `mimic:gen9championsvgc2026regmcbo3-2707540379` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `guessTries`, `probes`, `searches` | 20523 | T12 `-heal from drain: another amount` | `|-heal|p2b: Golisopod|12/100|[from] drain|[of] p1a: Golisopod` | `|-heal|p2b: Golisopod|11/100|[from] drain|[of] p1a: Golisopod` | **rerun: `PASS` (7013)**

All rows ended with `stop: searches`: every budget tier was tried on a guess the evidence stopped moving. **GAVE UP means untried work remains** — not proof that no spread fits, and not a soundness failure.

## 3. Reading

The rebuild chose a different line at the same turn. The next agent should decide whether this is a missing mechanism hook, a reconstruction choice never walked, or a search that simply needs wider budgets — the `--budget 10` reruns separate the last case from the first two.

## 4. Pointers (read only; no fix attempted)

- Previous buckets to compare: F21.
- Code: scripts/lib/inference/evidence.mjs:2852 (`drainChange`), :3138 (dispatch), `dealtChange`/`backward()` `dealtOk`..

## 5. Diagnostic runs launched

- Each case above is being rerun with `--budget 10`, one case per Aalto host, explicit `--threads $(nproc)` where newly launched (the first 10 use the default, which already reserves 9 of 10 cores).
- Output: `~/projects/encoreable-runs/investigate-rc3/<case>-<view>-budget10.json` on kosh; stderr `<...>.log`.
- **PASS** = budget-bound; **still GAVE UP** = investigate the mechanism above.
## 6. Rerun outcome (`--budget 10`)

- **PASS** means the case was budget-bound: no new mechanism hook is needed for it, only wider search (or a faster search path). It stays a give-up at normal budget.
- **GAVE UP** even at 10x means the search still cannot reproduce the log — this is the case to investigate as a possible missing mechanism or un-walked reconstruction choice.
- Full raw outcomes: `data/rerun-results.json` in this branch.
