# G02: recoil damage amount

## 1. Scope

| Field | Value |
|---|---|
| Bucket | `G02` |
| Source | `sweep-rc3/all.jsonl`, commit `2c4e65e5cd81` (89,346-game corpus sweep) |
| Cases | 4 GAVE UP record(s), 3 game(s) |
| Views | both@spectator, p2@p1 |
| Soundness | all real spreads kept, 0 broken proofs, 0 outside spreads |

## 2. Evidence

| case | view | limits hit | seconds | divergence | expected | actual |
|---|---|---|---:|---|---|---|
| `mimic:gen9championsvgc2026regmcbo3-2704557458` | `p2@p1` | `backtracks`, `fallbackRebuilds`, `probes`, `searches` | 1702 | T4 `-damage from Recoil: another amount` | `|-damage|p1a: Raichu|22/137 psn|[from] Recoil` | `|-damage|p1a: Raichu|20/137 psn|[from] Recoil` | **rerun: `GAVE UP` (1146)**
| `mimic:gen9championsvgc2026regmcbo3-2704557458` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `probes`, `searches` | 1987 | T4 `-damage from Recoil: another amount` | `|-damage|p1a: Raichu|16/100 psn|[from] Recoil` | `|-damage|p1a: Raichu|15/100 psn|[from] Recoil` | **rerun: `PASS` (585)**
| `mimic:gen9championsvgc2026regmcbo3-2705102747` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `guessTries`, `probes`, `searches` | 5176 | T4 `-damage from Recoil: another amount` | `|-damage|p1a: Incineroar|50/100y|[from] Recoil` | `|-damage|p1a: Incineroar|50/100g|[from] Recoil` | **rerun: `PASS` (234)**
| `mimic:gen9championsvgc2026regmc-2701208670` | `both@spectator` | `backtracks`, `fallbackRebuilds`, `guessTries`, `probes`, `searches` | 6726 | T4 `-damage from Recoil: another amount` | `|-damage|p1a: Incineroar|44/100|[from] Recoil` | `|-damage|p1a: Incineroar|43/100|[from] Recoil` | **rerun: `PASS` (2378)**

All rows ended with `stop: searches`: every budget tier was tried on a guess the evidence stopped moving. **GAVE UP means untried work remains** — not proof that no spread fits, and not a soundness failure.

## 3. Reading

The rebuild chose a different line at the same turn. The next agent should decide whether this is a missing mechanism hook, a reconstruction choice never walked, or a search that simply needs wider budgets — the `--budget 10` reruns separate the last case from the first two.

## 4. Pointers (read only; no fix attempted)

- Previous buckets to compare: F21, F23.
- Code: scripts/lib/inference/evidence.mjs:2876, :2884 (`applyRecoilDamage` dry probes), :3081, :3127 (`lendVictim`); `totalChange`/`wholePaths` recoil bounds..

## 5. Diagnostic runs launched

- Each case above is being rerun with `--budget 10`, one case per Aalto host, explicit `--threads $(nproc)` where newly launched (the first 10 use the default, which already reserves 9 of 10 cores).
- Output: `~/projects/encoreable-runs/investigate-rc3/<case>-<view>-budget10.json` on kosh; stderr `<...>.log`.
- **PASS** = budget-bound; **still GAVE UP** = investigate the mechanism above.
## 6. Rerun outcome (`--budget 10`)

- **PASS** means the case was budget-bound: no new mechanism hook is needed for it, only wider search (or a faster search path). It stays a give-up at normal budget.
- **GAVE UP** even at 10x means the search still cannot reproduce the log — this is the case to investigate as a possible missing mechanism or un-walked reconstruction choice.
- Full raw outcomes: `data/rerun-results.json` in this branch.
