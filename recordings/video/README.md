# Videos

Battles we have only as video. There is no protocol log at all, so no command reads these yet.
They are material for a future path that reads a battle off the screen.

| Folder | What goes in it |
|---|---|
| `tournament/` | Broadcasts and VODs of tournaments: other players' games, filmed by someone else |
| `champions/` | Captures from Pokémon Champions itself: your own games, or battle videos saved in the game |

**Video files are not tracked by git** (`.gitignore`). They are far too big: GitHub refuses a file
over 100 MB, and every version of a tracked file stays in the history for good. The files stay on
this machine and only these READMEs are tracked. So each folder's README lists every video with
where it came from, and a lost file can be found or recorded again. To back videos up through git,
set up Git LFS first.

**Goes here:** name a video `<date>-<event or opponent>-<what happens>.<ext>`, for example
`2026-09-20-regionals-top8-game2.mp4`, and add its row to the folder's README.
