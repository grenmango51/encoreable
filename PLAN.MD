# Encoreable — Project Plan

*Replay the position, not the video.*

**Status:** the Showdown core loop is built and proven — a recorded battle restores to any
turn and is played forward from both sides in the real Showdown client, with per-roll RNG
control. The frontier is Champions ingestion (Step 4) and the deferred items.
**Last updated:** 24 August 2026

---

## 1. The premise

Competitive Pokémon is the only major strategy game with no analysis board. Chess players
step back through a game move by move and branch from any position. Pokémon players rewatch
a video, or approximate the position in a friend battle and hope the state is close enough.

Encoreable puts you back in the position and lets you play it again — differently.

**Name:** you get an encore of the game, and Encore + Disable is a VGC combo.

### Why now

Pokémon Champions launched 8 April 2026 (Switch) and 17 June 2026 (mobile). It is the
official VGC software for the 2026 Championship Series and Worlds, from Indianapolis
Regionals onward.

It has **no replay feature and no match breakdown of any kind**. Players are already asking
for one on the official Pokémon forums. There is no battle video, no log export, no
turn history. The most competitive Pokémon has ever been, and the review tooling went
backwards.

---

## 2. North star

**Champions is the destination.** Every design decision assumes we end up there.

Showdown is the *vehicle*, not the target — it is where we develop, validate mechanics, and
find our first users. To keep the two aligned, we build against Showdown's
`[Gen 9 Champions] VGC 2026 Reg M-A / M-B` formats from day one, not against any other
ruleset. Same rules, same legality, same stat model. Only the **input source** changes
between phases:

| Phase | Input source | Difficulty |
|---|---|---|
| 1–3 | Showdown replay / input log | Solved, free |
| 4 | Champions gameplay video | Hard, someone else's product already |

---

## 3. Scope guards

Things we are explicitly **not** building. Revisit only with a very good reason.

- **No engine.** No "here was your best move." No evaluation function, no search, no AI
  opponent. This is out of reach and it is not the product.
- **No perfect reconstruction.** Exact state is unknowable by design — imperfect information
  is the game. We reconstruct a *faithful* position and are honest about what is inferred.
- **No opponent bot.** You pilot both sides yourself. See §5.
- **No original battle engine.** Showdown's simulator is the mechanics. We never write
  damage logic, status logic, or turn order logic ourselves.

---

## 4. What we are actually building

Three primitives, in order of value:

1. **Rewind** — load a real game, step to any turn.
2. **Branch** — from that turn, choose differently, play forward with correct mechanics.
3. **Narrow** — show what is deterministically known about the opponent's build, and what is
   only probable.

---

## 5. The core loop (the headline feature)

**A normal battle scene, where you pilot both sides and control the RNG.**

It looks and feels like a Pokémon battle, because it is one. The difference is that you give
the orders for both teams, and the dice are yours:

- Crit / no crit
- High roll, low roll, specific roll
- Hit / miss
- Paralysis proc, flinch, secondary effects
- Speed ties

You explore one line at a time, by hand, the way you would think through the turn anyway —
except the mechanics are correct and you can back up and try again.

**Not** an enumeration of every possible scenario. No report of a thousand branches. One
line at a time, chosen by you, with the luck under your control.

Piloting both sides is a feature, not a compromise. This is the chess.com *analysis board* —
where you also move both colours yourself — and not the chess.com *engine*. Nobody complains
that the analysis board lets you see White's plan.

It requires **zero AI**. It is the simulator, a UI, and a set of RNG toggles.

---

## 6. Architecture decisions

### The server, minus everything social

Showdown is three separable things, and we run all three locally:

| Component | Purpose | Role here |
|---|---|---|
| **sim** | Battle mechanics | **Yes** — the only source of truth |
| **server** | Rooms, accounts, chat, ladder, matchmaking | **Rooms only**, local and unauthenticated |
| **client** | Rendering, sprites, animations | **Yes** — unmodified |

Accounts, chat, ladder and matchmaking stay switched off. The server earns its place with two
things nothing else provides: `/importinputlog` turns a truncated input log into a *playable*
room, and `Config.logchallenges` makes the server keep a finished battle's input log instead of
discarding it.

The simulator underneath has no concept of players, which dissolves the "can I play both
sides?" question. It is a stream you write both sides' choices into:

```
>start {"formatid":"gen9champions..."}
>player p1 {"name":"me","team":"..."}
>player p2 {"name":"them","team":"..."}
>p1 move 1 1, move 3 2
>p2 move 2 1, switch 3
```

Self-play is the default mode of the API, not a workaround. No second account, no second tab.

### Delivery shape: the native Showdown client

**The UI is Showdown's own client, unmodified.** A local server holds the position as a real
room; two browser windows join it, one per side. We write no battle UI at all — that is a hard
scope guard (`ENGINEERING.md` §0), and a move button written by us is a bug.

This is not the Showdex shape, and the analogy is weaker than it looks. Showdex augments a
battle you are currently playing, injecting into a live client. Encoreable takes a finished
battle, puts the position back on a server, and lets the ordinary client play it forward — the
client needs nothing done to it. What ships is the tooling around the server, not a front end.

### Getting to a position: three layers, all required

These are not competing options. All three ship. They are layers, and the build order is
A → B′ → B.

| Layer | Method | Invariants | Status |
|---|---|---|---|
| **A** | Replay the input log to turn N | Maintained by the sim | **Shipped** |
| **B′** | Drive the sim with forced RNG + scripted choices | Maintained by the sim | **Shipped** — it *is* the feature |
| **B** | Construct / edit state directly | We own correctness | Deferred |

**A is the state constructor.** The input log is not an alternative to editing state — it is
a script that builds and edits the state for you, correctly, for free. Every real position
we can reach this way is a position we never have to hand-author.

**B′ is not an implementation detail.** RNG control is the core loop (§5). It works by scripted
injection at the sim's five draw sites — accuracy, crit, damage roll, secondary, self-boost —
so a named draw is forced without perturbing any other decision in the turn. It also covers
most hypotheticals — "what if it had crit" is a coin we flip, not a state we author.

**B is the eventual necessity, and the hardest.** Needed for positions that never happened,
for manual setup, and for Champions input where there is no log at all. **Use
`[Gen 9 Champions] Doubles Custom Game` as the vehicle** — it already exists, keeps Champions
mechanics, and turns validation and the 66-point cap off (`ENGINEERING.md` §9). Deferred
because a position is not HP and weather — it is the volatile layer: consecutive-Protect
counter, Encore turns remaining, Taunt turns, Fake Out eligibility, Choice lock, `lastMove`,
disabled slots, Tailwind / Trick Room counters, consumed-item flags, the pending action queue.
Authoring those into a consistent state by hand is the hardest part of the project.

A also de-risks B: every real position gives us a correctly-constructed state object to
study, so by the time we author one from scratch we know exactly what shape it should be.

---

## 7. Step 0 — verification spikes

**Status: the research is closed.** Four spikes resolved, one deferred with the path it belongs
to; the PCBL request at the foot of the list is an action item, not a research question, and it
is still open. Findings are in `ENGINEERING.md` §2, and the scripts that establish them are
checked in and re-runnable.

- [x] **Input log availability.** **Yes on a server we host; no on the public ladder.** A
      battle played on our own local server keeps a complete input log with its seed —
      `Config.logchallenges` is the one flag that stops the server discarding it the moment the
      battle ends. Someone else's ladder replay stays shut: `/exportinputlog` requires *both*
      players to consent via `/allowexportinputlog`. Step 2 therefore works from a battle we
      host, and public-ladder ingestion is deferred on consent, not on tooling.
- [x] **Deterministic reproduction.** **Layer A is real.** `battle.inputLog` round-trips
      byte-identically through a fresh `BattleStream`, and 126 protocol lines from an
      independent re-simulation match the server's omniscient log exactly. Recovered Stat Point
      spreads reproduce every max-HP integer. `npm run replay` re-runs the whole chain and
      prints the report.
- [ ] **Fallback path.** **Scoped to the deferred public-ladder path.** Battles we host need no
      fallback — the input log is complete and the omniscient log carries exact HP for both
      sides. If the ladder path is ever revisited, state gets rebuilt from the plain protocol
      log; `@pkmn/client` is purpose-built for it. Different work, still viable.
      See `ENGINEERING.md` §9.
- [x] **Browser sim.** **Not a blocker.** Only `sim/dex.ts` reaches for `fs`/`path`, and only to
      load data off disk.
- [x] **Stat Point rounding.** **No rounding exists.** The SP→stat map is exact and invertible.
- [ ] **PCBL feature request.** File a request for JSON export of battle logs, and join the
      Discord. Costs ten minutes; if granted, Step 4 collapses to "parse their file." Ship
      this request *today*, not in Step 4 — lead times are months.

---

## 7a. Confirmed findings

The verified findings live in `ENGINEERING.md` §2 — read off the Showdown source and re-checked
against a running server. Three of them shape this plan.

**Stat Points are exact and perfectly invertible.** At level 50, one Stat Point is one point of
the final stat: `HP = base + SP + 75`, everything else `base + SP + 20`, then nature. No EV
conversion, no division, no truncation. This is the best possible case for the inference layer
(§10) — observed-stat bounds convert to SP bounds with no error term.

**The sim core is browser-safe.** `battle.ts`, `state.ts`, `pokemon.ts`, `field.ts`, `side.ts`
and `battle-stream.ts` import zero Node builtins. Only `sim/dex.ts` uses `fs`/`path`, purely for
loading data off disk.

**Champions caps every move at 20 base PP.** The mod's `init()` clamps anything higher. That
changes PP-stall maths across the board and lands directly on the Encore / Protect interaction
that started this project.

---

## 8. Step 1 — foundations

**Status: done.** `npm run battle` records a Champions doubles game on the local server;
`npm run replay` re-simulates it, diffs the protocol, and renders a replay page.

**Deliverable:** a locally running Champions-rules battle you can drive from code.

- Local `pokemon-showdown` sim, plus a local server for rooms.
- Running `[Gen 9 Champions] VGC 2026 Reg M-A / M-B`.
- Both sides driven from one process via the stream API.
- Protocol output rendered somewhere — even ugly text is fine at this stage.

**Done when:** you can script a full doubles game end to end and read the result.

---

## 9. Step 2 — rewind and branch *(first shippable release)*

**Status: shipped for battles we host.** `npm run live` cuts a recording at any turn, imports
the position as a live room, and opens the real battle UI on both sides; the replay page's
**Play from here** button does the same for the turn on screen. Three pieces are outstanding:
RNG control drives the sim directly and does not yet reach inside a live room; ingesting
someone else's ladder replay is blocked on consent (§7); and the inference layer is deferred,
because on a battle we host the omniscient log already carries exact values for both sides.

**Deliverable:** paste a replay, land in the position, play it differently.

- Ingest a Showdown replay (URL or file).
- Reconstruct to any turn (Layer A, or the `@pkmn/client` fallback).
- "Branch from here."
- **Play the scene**: normal battle UI, you give orders for both sides.
- **RNG controls**: crit / no crit, high roll / low roll / specific roll, hit / miss, para,
  flinch, secondary effects, speed ties.
- Undo / step back, so you can try a different line without reloading.
- Deterministic inference only, surfaced inline:
  - *survived X at −1 → bulk product ≥ Y*
  - *moved first → Speed ≥ Z*
  - *used a move → that move exists*
  - Unknowns left blank, editable by the user, defaulted to something sane.

### Two facts that constrain the inference UI

- **HP granularity is asymmetric on someone else's replay.** The protocol splits messages into
  secret and public halves and standard formats run HP Percentage Mod. On a battle we host,
  channel −1 resolves the split and both sides read exact; on a ladder replay you get exact HP
  for your own Pokémon and **percentages for theirs**, so opponent bounds come from percentage
  buckets. Design the UI around ranges.
- **Bounds are on products, not stats.** "Survived Earthquake at −1" constrains HP × Defence
  jointly. One observation is a curve, not a number. Multiple observations intersect into a
  region. Show the region.

**Ship it here.** Post about it, put it in front of Showdown players, write up what you
learn. Everything after this is refinement.

---

## 10. Step 3 — probabilistic layer

**Deliverable:** the blanks fill themselves with the likely answer.

- Pull usage statistics for the current Champions regulation: most common spreads, items,
  abilities, moves, teammates.
- Filter that distribution by the deterministic constraints from Step 2 — *"of the spreads
  people actually run on this Pokémon, these are the ones consistent with surviving that
  hit."*
- Surface the never-revealed fourth move as a weighted possibility, not a blank.
- Show odds, not answers: *"lives 11/16 rolls at this spread, which is 68% of ladder usage."*

**Data source: Smogon's published usage statistics, not Pikalytics.** Pikalytics is a
downstream consumer of the same data. The moveset / "chaos" files contain per-Pokémon spread,
item, move and teammate frequencies. `@pkmn/smogon` is a maintained wrapper around Smogon's
analyses and usage stats.

**Ordering note:** pull a thin slice of this into Step 2. "Here is the bound, *and* here is
the most common spread consistent with it" is barely more work than the bound alone, and it
is the difference between a debug view and something a player wants to look at.

### Why this gets easier on Champions

Champions fixes Level 50 and 31 IVs across the board, and replaces EV spreads with **66 Stat
Points, max 32 per stat**. Open Team Sheets are always on, so species, ability, item and
moves are known before the game starts.

That leaves **stat point allocation and nature as the only unknowns.** And because the budget
is fixed at 66, every constraint on one stat is simultaneously a *ceiling on the others*.
The feasible region collapses fast. This inference problem is dramatically better-posed on
Champions than anywhere else — it is a real argument for the north star, not just a
consequence of it.

---

## 11. Step 4 — Champions capture

**Deliverable:** "here is a video of my game" → a position you can branch from.

Not one step. This is the other half of the project, and it is already someone's shipped
product. Champions exports nothing — no log, no history, no breakdown. **Video is the only
input.**

Three routes, in order of preference:

1. **Assisted manual entry.** A scrub-and-click UI over your own VOD. ~3 minutes per game,
   zero computer vision. **This is the default, not a stopgap.** With an audience of one,
   there is no adoption cost to amortise — you will happily spend 3 minutes on a game you
   just lost a set to. It may never need replacing.
2. **PCBL export.** If the feature request from Step 0 lands, parse their JSON. Cheapest by
   an order of magnitude — but see the licence coupling in §14 before depending on it.
3. **Own computer vision.** Last resort, and only if this ever leaves your own machine.
   PCBL is at v0.0.35 with OCR across nine languages and hundreds of MB of model files.
   Months, not a script.

**Also valid: wait.** Champions is live-service and the official forums acknowledged the
replay request. If they ship replays, Step 4 gets much easier — and Encoreable gets *more*
valuable, not less, because a replay still is not a branchable position.

---

## 12. Landscape

Nobody has built rewind → edit → play forward. That gap is the wedge.

| Project | What it does | Overlap |
|---|---|---|
| **Showdex** | Damage calc injected into Showdown, syncs and lets you edit full battle state | Closest existing tool. Edits state to *calculate*, not to *play*. Best architectural reference. |
| **PCBL** | CV capture of Champions battles from OBS or video, logging + analytics + damage desk | Owns the Step 4 capture pipeline. Proprietary, All Rights Reserved. No branching. |
| **ChampTeams** | Browser Champions doubles sim vs rule-based bots, hints, teambuilder | Full simulator, no replay or position editing. |
| **VGC Dojo** | 2500+ "battle puzzles", spaced repetition | Explicitly not a simulator; no playable battles. |
| **Pokémon Showdown replays** | Linear playback | No branching. |

---

## 13. Tooling reference

**Core**
- `smogon/pokemon-showdown` — sim, MIT. `sim/SIMULATOR.md`, `sim/SIM-PROTOCOL.md`,
  `sim/state.ts` (serialize / deserialize), `sim/prng.ts`, `config/formats.ts`
- `pkmn/ps` — modular MIT re-cuts: `@pkmn/sim`, `@pkmn/client` (state from protocol),
  `@pkmn/view` (client UIs), `@pkmn/img` (sprites), `@pkmn/protocol`
- `smogon/pokemon-showdown-client` — `WEB-API.md` for replay/inputlog endpoints

**Calculation & data**
- `@smogon/calc` / `@pkmn/dmg` — damage calculation
- `@pkmn/smogon` — usage statistics wrapper

**Reference implementations**
- `doshidak/showdex` — client injection pattern, state editing UI
- `cameronangliss/vgc-bench` — VGC doubles harness, local server management

**Explicitly not a dependency**
- `pkmn/engine` — has exactly our primitives (`Battle.restore`, `FixedRNG`) but covers
  Gen 1–2 now, Gen 3–4 next, modern generations blocked on decompilations. Will look
  perfect. Do not build toward it.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Input log unavailable or requires opponent consent | Settled: complete on a server we host, consent-gated on the public ladder. The ladder path is deferred, and its fallback is protocol-log state reconstruction. |
| Showdown's Champions mod diverges from the real game | Validate against known damage benchmarks early; the mod is only months old and is the least-tested part of the codebase |
| PCBL adds branching | They have shown no sign of it; their product is analytics. Move fast on the core loop. |
| **PCBL licence coupling** | Their licence forbids commercial use. Reading a JSON file a user exported themselves is probably fine, but if Encoreable ever charges *and* requires PCBL, that gets murky. Keep the manual-entry path working so PCBL is always an accelerator, never a dependency. Ask the dev directly if it ever matters. |
| Champions ships official replays | Reduces Step 4 cost, does not remove the product. A replay is not a position. |
| Legal | Showdown survives on being free, non-commercial, and supplementary rather than substitutive. Treat that as the template. The MIT code is not the issue — Nintendo/TPC assets are. Note PCBL chose proprietary + Buy Me a Coffee rather than a paid product. |

---

## 15. Open questions

- How do the RNG controls surface without cluttering the battle scene? The native client is the
  UI and we do not modify it, so the control has to arrive from outside the browser — an
  operator-side write on the battle stream before the turn resolves is the likely shape.
- How far back can you step, and is it a linear undo or a saved tree of lines you explored? A
  branch extends its own input log, so it is savable and re-branchable; what is unsettled is
  what the user is shown.

### Closed

- **Extension, web app, or desktop** — none of them. The native Showdown client is the UI: a
  local server holds the position as a real room and two browser windows join it, one per side.
  No custom battle UI gets built. See §6.
- **Stat Points** — native, exact, no rounding anywhere in the VGC path. The SP→stat map is
  perfectly invertible, which is the best case for §10. See `ENGINEERING.md` §2.
- **Can the sim run in a browser** — yes. Only `sim/dex.ts` has Node dependencies, and only
  for data loading. See `ENGINEERING.md` §2.
- **Is the input log enough to rebuild a position** — yes, on a server we host. It round-trips
  byte-identically and truncating it at turn N yields a position the server will accept as a
  live room. The public ladder is a separate, consent-gated problem (§7).
- **First users** — it is you. No adoption problem to solve, no onboarding to build, and
  manual entry in Step 4 is fine indefinitely.
- **Money** — defer, but stay reversible. The one live constraint is the PCBL licence
