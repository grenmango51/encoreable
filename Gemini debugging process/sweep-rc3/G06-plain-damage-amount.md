# G06: plain damage amount

## 1. Scope

| Field | Value |
|---|---|
| Bucket | `G06` |
| Source | `sweep-rc3/all.jsonl`, commit `2c4e65e5cd81` (89,346-game corpus sweep) |
| Cases | 2 GAVE UP record(s), 2 game(s) |
| Views | both@spectator |
| Soundness | all real spreads kept, 0 broken proofs, 0 outside spreads |

## 2. Evidence

| case | view | limits hit | seconds | divergence | expected | actual |
|---|---|---|---:|---|---|---|
| `mimic:gen9championsvgc2026regmcbo3-2694048488` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `fallbackTotal`, `guessTries`, `probes`, `searches` | 6590 | T5 `-damage: another amount` | `|-damage|p2a: Indeedee|76/100` | `|-damage|p2a: Indeedee|79/100` | **rerun: `PASS` (305)**
| `mimic:gen9championsvgc2026regmc-2692815448` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `guessTries`, `probes`, `searches` | 9906 | T6 `-damage: another amount` | `|-damage|p1b: Corviknight|39/100` | `|-damage|p1b: Corviknight|35/100` | **rerun: `PASS` (665)**

All rows ended with `stop: searches`: every budget tier was tried on a guess the evidence stopped moving. **GAVE UP means untried work remains** — not proof that no spread fits, and not a soundness failure.

## 3. Reading

The rebuild chose a different line at the same turn. The next agent should decide whether this is a missing mechanism hook, a reconstruction choice never walked, or a search that simply needs wider budgets — the `--budget 10` reruns separate the last case from the first two.

## 4. Pointers (read only; no fix attempted)

- Previous buckets to compare: F19, F20.
- Code: scripts/lib/inference/evidence.mjs:1237 (`analyseHit`), `paths`/`wholePaths`, `hpLine` cutoff handling..

## 5. Diagnostic runs launched

- Each case above is being rerun with `--budget 10`, one case per Aalto host, explicit `--threads $(nproc)` where newly launched (the first 10 use the default, which already reserves 9 of 10 cores).
- Output: `~/projects/encoreable-runs/investigate-rc3/<case>-<view>-budget10.json` on kosh; stderr `<...>.log`.
- **PASS** = budget-bound; **still GAVE UP** = investigate the mechanism above.
## 6. Rerun outcome (`--budget 10`)

- **PASS** means the case was budget-bound: no new mechanism hook is needed for it, only wider search (or a faster search path). It stays a give-up at normal budget.
- **GAVE UP** even at 10x means the search still cannot reproduce the log — this is the case to investigate as a possible missing mechanism or un-walked reconstruction choice.
- Full raw outcomes: `data/rerun-results.json` in this branch.
