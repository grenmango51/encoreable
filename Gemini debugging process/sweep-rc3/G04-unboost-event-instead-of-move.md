# G04: |-unboost| accuracy event instead of the move

## 1. Scope

| Field | Value |
|---|---|
| Bucket | `G04` |
| Source | `sweep-rc3/all.jsonl`, commit `2c4e65e5cd81` (89,346-game corpus sweep) |
| Cases | 2 GAVE UP record(s), 2 game(s) |
| Views | both@spectator |
| Soundness | all real spreads kept, 0 broken proofs, 0 outside spreads |

## 2. Evidence

| case | view | limits hit | seconds | divergence | expected | actual |
|---|---|---|---:|---|---|---|
| `mimic:gen9championsvgc2026regmcbo3-2701447205` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `probes`, `searches` | 1110 | T4 `move where the rebuild has -unboost` | `|move|p1b: Gardevoir|Expanding Force|p2b: Milotic|[spread] p2a,p2b` | `|-unboost|p1a: Tyranitar|accuracy|1` |
| `mimic:gen9championsvgc2026regmc-2701824327` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `probes`, `searches`, `variants` | 2422 | T5 `move where the rebuild has -unboost` | `|move|p2b: Golisopod|Leech Life|p1a: Rillaboom` | `|-unboost|p1a: Rillaboom|accuracy|1` |

All rows ended with `stop: searches`: every budget tier was tried on a guess the evidence stopped moving. **GAVE UP means untried work remains** — not proof that no spread fits, and not a soundness failure.

## 3. Reading

The rebuild chose a different line at the same turn. The next agent should decide whether this is a missing mechanism hook, a reconstruction choice never walked, or a search that simply needs wider budgets — the `--budget 10` reruns separate the last case from the first two.

## 4. Pointers (read only; no fix attempted)

- Previous buckets to compare: F13, F14.
- Code: scripts/lib/reconstruct.mjs:1923, :1928, :1931 (`-boost`/`-unboost` classification); evidence.mjs:5151 (`writesStats`), :5334..

## 5. Diagnostic runs launched

- Each case above is being rerun with `--budget 10`, one case per Aalto host, explicit `--threads $(nproc)` where newly launched (the first 10 use the default, which already reserves 9 of 10 cores).
- Output: `~/projects/encoreable-runs/investigate-rc3/<case>-<view>-budget10.json` on kosh; stderr `<...>.log`.
- **PASS** = budget-bound; **still GAVE UP** = investigate the mechanism above.
