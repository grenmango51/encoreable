# G05: locked-move target

## 1. Scope

| Field | Value |
|---|---|
| Bucket | `G05` |
| Source | `sweep-rc3/all.jsonl`, commit `2c4e65e5cd81` (89,346-game corpus sweep) |
| Cases | 1 GAVE UP record(s), 1 game(s) |
| Views | p2@p1 |
| Soundness | all real spreads kept, 0 broken proofs, 0 outside spreads |

## 2. Evidence

| case | view | limits hit | seconds | divergence | expected | actual |
|---|---|---|---:|---|---|---|
| `mimic:gen9championsvgc2026regmcbo3-2712822452` | `p2@p1` | `backtracks`, `fallbackRebuilds`, `probes`, `searches` | 842 | T4 `move from lockedmove: another target` | `|move|p2a: Archaludon|Electro Shot|p1b: Archaludon|[from] lockedmove` | `|move|p2a: Archaludon|Electro Shot|p1a: Basculegion|[from] lockedmove` |

All rows ended with `stop: searches`: every budget tier was tried on a guess the evidence stopped moving. **GAVE UP means untried work remains** — not proof that no spread fits, and not a soundness failure.

## 3. Reading

The rebuild chose a different line at the same turn. The next agent should decide whether this is a missing mechanism hook, a reconstruction choice never walked, or a search that simply needs wider budgets — the `--budget 10` reruns separate the last case from the first two.

## 4. Pointers (read only; no fix attempted)

- Previous buckets to compare: F07, F08.
- Code: scripts/lib/reconstruct.mjs:269 (`recoverChargeTargets`), :3840. Cross-link: pin-investigation branches `fix/locked-move-target-log` (2a5d821) and `fix/locked-move-target-log-pin41ba` (0d5732e)..

## 5. Diagnostic runs launched

- Each case above is being rerun with `--budget 10`, one case per Aalto host, explicit `--threads $(nproc)` where newly launched (the first 10 use the default, which already reserves 9 of 10 cores).
- Output: `~/projects/encoreable-runs/investigate-rc3/<case>-<view>-budget10.json` on kosh; stderr `<...>.log`.
- **PASS** = budget-bound; **still GAVE UP** = investigate the mechanism above.
