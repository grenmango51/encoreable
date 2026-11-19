# Full-corpus sweep `2c4e65e` — hand-off for the next investigator

**Source:** `~/projects/encoreable-runs/sweep-rc3/all.jsonl`; raw records copied to `data/sweep-rc3-nonpass-records.json` in this branch.
**Sweep scope:** 89,346 games, 98 day folders, 268,038 cases; 268,001 finished when this was written.
**Commit:** `2c4e65e5cd81` (current `main`), Showdown pin `0e2f7f93af…`.

## 1. Accounting

| Result | Records | Notes |
|---|---:|---|
| PASS | 267,979 | |
| GAVE UP | 14 | all `stop: searches`; sound; untried work remains |
| CRASH | 8 | all `Error: Unknown system error -127` — transient host faults, not inference bugs |
| REMOVED / broken proof / outside spread | 0 / 0 / 0 | |

## 2. Give-up clusters

| Bucket | Mechanism | Records | Games | Report |
|---|---|---:|---:|---|
| G01 | flinch / |cant| action order | 2 | 2 | [G01](G01-flinch-cant-action-order.md) |
| G02 | recoil damage amount | 4 | 3 | [G02](G02-recoil-damage-amount.md) |
| G03 | drain heal amount | 2 | 2 | [G03](G03-drain-heal-amount.md) |
| G04 | |-unboost| accuracy event instead of the move | 2 | 2 | [G04](G04-unboost-event-instead-of-move.md) |
| G05 | locked-move target | 1 | 1 | [G05](G05-locked-move-target.md) |
| G06 | plain damage amount | 2 | 2 | [G06](G06-plain-damage-amount.md) |
| G07 | |-status| event instead of the move | 1 | 1 | [G07](G07-status-event-instead-of-move.md) |

## 3. What was done here, and what was not

- **Done:** extracted every non-PASS record with limits, kept-spread flags, usage ranks and first diverging line; clustered by the line the rebuild stopped on; located code and previous buckets; launched `--budget 10` reruns on all 14 give-ups and plain reruns on all 8 CRASHes.
- **Not done, on purpose:** no inference, reconstruction or simulator change; no root-cause claim beyond the divergence lines. The next agent should read the cluster reports and rerun results, then decide on a mechanism hook.
- **Cross-link:** `G05` overlaps the pin-investigation thread's fix branches `fix/locked-move-target-log` (`2a5d821`) and `fix/locked-move-target-log-pin41ba` (`0d5732e`). Check those before writing anything new.
- **History:** last time's 520 give-ups became 392 diagnostic reports → 36 buckets (`F01`–`F36`) → the fixes now on `main`. These 14 are the remaining tail of a larger 89k-game sweep.

## 4. Reproduce

```bash
DIRS=$(cat ~/projects/encoreable-runs/sweep-rc3/all.dirs)
bash ~/projects/encoreable-cluster/run-branch.sh 2c4e65e npm run score -- \
  --only mimic:gen9championsvgc2026regmcbo3-2696773301 --views both@spectator \
  --mimic-dir "$DIRS" --budget 10 --threads $(nproc)
```

Rerun outputs land in `~/projects/encoreable-runs/investigate-rc3/`.