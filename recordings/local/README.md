# Local battles

Battles our own Showdown server ran. Each `.log.json` is the file the server wrote to
`runtime/logs/`: the **input log** — the seed, both packed teams, every choice — and the protocol
log. That is full information, exact stats and exact HP for both sides, so these are the ground
truth that reconstruction and Stat Point inference are measured against
(`npm run reconstruct -- --all`). They cannot be regenerated: the same script run again rolls a new
seed.

Keep the server's file name, `<format>-<n>.log.json`.

## Which folder

| Folder | Who chose the moves | How a file gets there |
|---|---|---|
| `branched/` | Restored from another recording at turn N with `npm run live`, then played on | `npm run replay -- --from <file>` |
| `scripted/` | `npm run replay`'s fixed script, on the fixture teams | automatic, every `npm run replay` |
| `probes/` | A test or probe script built to exercise one effect | by hand, or the script that built it |
| `self-play/` | You, on both sides, in the two `npm run battle` windows | `npm run replay -- --from <file>` |

`npm run replay` picks the folder from the input log: a `>player` line after the first choice
means branched, a p1 named `Ghosts<n>` means scripted, anything else is self-play. It never picks
`probes/`.

Every battle here so far is Reg M-B, played on `pokemon-showdown` 0.11.11. New ones are Reg M-C.
