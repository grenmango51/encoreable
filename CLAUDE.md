# Where new files go

Every path in this project already means something. Match the file to a row below and put it
there. `README.md` describes what each directory *is*; this file decides where a *new* file
belongs.

## The rule

**DO NOT ADD FILES TO ANY FOLDER IN A WAY THAT DOES NOT FOLLOW THE TABLE BELOW WITHOUT ASKING
THE USER DIRECTLY, ONE FILE AT A TIME. PLAN APPROVAL DOES NOT COUNT AS PERMISSION.** Approval
of a plan, a design, a task list, or a described approach is never approval to create a file
the table does not already place. Ask for that file, by name, on its own, and wait.

## The table

| A new… | goes in |
|---|---|
| Command a person runs | `scripts/local-<name>.mjs` — plus one `package.json` script and one `<name>.bat` at the root |
| Piece of Node machinery two or more commands share | `scripts/lib/<name>.mjs` |
| Script that runs in the browser, served over HTTP | `scripts/client/<name>.js` — never runnable with `node` |
| Code that runs inside the Showdown server process | `scripts/server/<name>.js` — CommonJS, copied into `runtime/config/` by provisioning, never `.mjs` |
| Team or format fixture loaded by Node | `scripts/fixtures/<name>.js` — CommonJS, not ESM |
| Recorded battle worth keeping | `recordings/<battleid>.log.json` — tracked, cannot be regenerated |
| Public-ladder replay kept as test material | `samples/<name>.html` |
| Rendered replay page | `replays/` — written by the commands, gitignored, never hand-authored |
| Local Showdown server file | `runtime/` — generated from `node_modules`, never edited by hand |
| Upstream client file | `vendor/` — a clone of someone else's repo, never edited |
| Explanation of a directory whose contents are not self-evident | `<that-directory>/README.md` |
| Document answering a question none of `PLAN.MD`, `ENGINEERING.md`, `BRANCHING.md` owns | the repo root, as `<NAME>.md` — first check whether it belongs *inside* one of those three |
| Scratch file, experiment, probe, or one-off diagnostic | nowhere in this repo — use the session scratchpad and delete it |

## Extensions carry meaning

`.mjs` is a Node ES module. `.js` under `scripts/client/` is browser code. `.js` under
`scripts/fixtures/` and `scripts/server/` is CommonJS. Picking the wrong one breaks the file at
load time, not at review time.

## Before adding anything

Ask whether the thing belongs in a file that already exists. A new command that is a variant of
an existing one is a flag, not a file. A new document that restates a section of an existing
one is an edit, not a file. This project has already had to merge four documents back into one.
