# Encoreable — Project Plan

*Replay the position, not the video.*

**Status:** research complete, pre-build
**Last updated:** 6 August 2026

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

### Skip the server

Showdown is three separable things. We need two:

| Component | Purpose | Need it? |
|---|---|---|
| **sim** | Battle mechanics | **Yes** |
| **server** | Accounts, chat, ladder, matchmaking | No |
| **client** | Rendering, sprites, animations | **Yes** |

The server is pure overhead for us. This also dissolves the "can I play both sides?"
question — the simulator has no concept of players. It is a stream you write both sides'
choices into:

```
>start {"formatid":"gen9champions..."}
>player p1 {"name":"me","team":"..."}
>player p2 {"name":"them","team":"..."}
>p1 move 1 1, move 3 2
>p2 move 2 1, switch 3
```

Self-play is the default mode of the API, not a workaround. No second account, no second tab.

### Delivery shape: UNDECIDED

Extension, web app, or desktop app is an open decision. Do not commit yet.

The extension option exists: Showdex proves you can inject a full application into the live
Showdown client, and the client is MIT. An extension would inherit the UI, sprites,
animations and Chrome Web Store distribution.

**But the analogy is weaker than it looks.** Showdex augments a battle you are currently
playing — it lives inside a running game and reads state off it. Encoreable operates on a
finished replay and turns it into something interactive. That is closer to a new game than
an overlay. Whether an extension is even the right container depends on what a replay page
actually lets us do, and we do not know that yet.

**Decide after Step 0.** The browser-sim and input-log spikes tell us what is possible
inside a replay context; the shape follows from that, not the other way round.

### Getting to a position: three layers, all required

These are not competing options. All three ship. They are layers, and the build order is
A → B′ → B.

| Layer | Method | Invariants | Status |
|---|---|---|---|
| **A** | Replay the input log to turn N | Maintained by the sim | Build first |
| **B′** | Drive the sim with forced RNG + scripted choices | Maintained by the sim | **Mandatory** — it *is* the feature |
| **B** | Construct / edit state directly | We own correctness | Build later |

**A is the state constructor.** The input log is not an alternative to editing state — it is
a script that builds and edits the state for you, correctly, for free. Every real position
we can reach this way is a position we never have to hand-author.

**B′ is not an implementation detail.** RNG control is the core loop (§5). We need
`forceRandomChance` and a settable seed regardless of how we reached the position, so this
gets built no matter what. It also happens to cover most hypotheticals — "what if it had
crit" is a coin we flip, not a state we author.

**B is the eventual necessity, and the hardest.** Needed for positions that never happened,
for manual setup, and for Champions input where there is no log at all. **Use
`[Gen 9 Champions] Doubles Custom Game` as the vehicle** — it already exists, keeps Champions
mechanics, and turns validation and the 66-point cap off (§7a). Deferred because a
position is not HP and weather — it is the volatile layer: consecutive-Protect counter,
Encore turns remaining, Taunt turns, Fake Out eligibility, Choice lock, `lastMove`, disabled
slots, Tailwind / Trick Room counters, consumed-item flags, the pending action queue.
Authoring those into a consistent state by hand is the hardest part of the project.

Building A first also de-risks B: every real position gives us a correctly-constructed state
object to study, so by the time we author one from scratch we know exactly what shape it
should be.

---

## 7. Step 0 — verification spikes

**Status: 2 of 5 resolved** (6 Aug 2026, read against `smogon/pokemon-showdown` @ `6a1836d`,
3 Aug 2026). Findings from the resolved two are in §7a.

- [ ] **Input log availability.** Pull the JSON for one of your own Champions-format replays.
      Does it contain a usable input log with a seed? Smogon's RNG page says seeds are hidden
      for non-random teams and need `/exportinputlog` with opponent permission; the client's
      `WEB-API.md` says inputlogs are in the replay JSON. Those are in tension. **Which one
      holds decides whether Step 2 works from a URL or needs a consent flow.** *Needs your
      replay — nobody else can run this one.*
- [ ] **Deterministic reproduction.** Pipe that input log into `pokemon-showdown
      simulate-battle`. Does the output match the original log? If yes, Layer A is real.
      *Attempted in a sandbox; blocked on throttled package installs, not on anything real.
      ~15 minutes on your own machine.*
- [ ] **Fallback path.** If the seed is stripped: confirm `@pkmn/client` can rebuild battle
      state from the plain protocol log. (It is designed for exactly this.) Different work,
      still viable.
- [x] **Browser sim.** **Resolved — not a blocker.** See §7a.
- [x] **Stat Point rounding.** **Resolved — no rounding exists.** See §7a.
- [ ] **PCBL feature request.** File a request for JSON export of battle logs, and join the
      Discord. Costs ten minutes; if granted, Step 4 collapses to "parse their file." Ship
      this request *today*, not in Step 4 — lead times are months.

---

## 7a. Confirmed findings

Read directly from the Showdown source at commit `6a1836d` (3 Aug 2026 — the latest commit
was *"Champions UU: Update bans"*, so the mod is actively maintained).

### Stat Points are exact — there is no conversion and no rounding

`data/mods/champions/scripts.ts` → `statModify()`. At level 50 (the VGC path):

```
HP          = baseStat + SP + 75
every other = baseStat + SP + 20   → then nature
```

**1 Stat Point = exactly 1 point of the final stat.** No division by 4, no multiply by 8, no
truncation. The `evs` field is only a storage location — the arithmetic is native.

Note that `base + 20` and `base + 75` are precisely the mainline level-50 / 31 IV / 0 EV
values, so the model is "standard level 50 stat, plus SP added directly." Nature is applied
afterwards with 16-bit truncation (`trunc(trunc(stat * 110, 16) / 100)` for a boost, `* 90`
for a drop).

**This is the best possible outcome for the inference layer (§10):** the map from Stat Points
to final stats is exact and perfectly invertible. Observed-stat bounds convert to SP bounds
with no error term at all.

**One exception, not ours.** If a ruleset includes `levelclausemod` (Draft formats at
non-50 levels), stats route through the mainline formula with `max(2 × SP − 1, 0)` where
`EV/4` would sit. Per the source comment: the first stat point is worth 4 EVs and each
subsequent one 8. That asymmetry is real but confined to Draft. VGC Reg M-A and M-B do not
use it.

### Validator rules

`sim/team-validator.ts` — `useStatPoints` triggers on `dex.currentMod.startsWith('champions')`:
- Hard cap 32 per stat
- **All IVs must be exactly 31**, or the team is rejected outright
- Budget is set in `sim/dex-formats.ts:349` — `if (format.mod.startsWith('champions'))
  this.evLimit = 66`, and only when the EV Limit rule resolves to `Auto`

### All moves are capped at 20 PP

The mod's `init()` walks every move and clamps base PP to 20. Max PP still follows
`(pp / 5 + 1) * 4`, so a 20 PP move maxes at 20 rather than 24+.

This changes PP-stall maths across the board, and it lands directly on the Encore / Protect
interaction that started this project. Worth confirming against the real game early — it is
the kind of thing a mod gets subtly wrong.

### `[Gen 9 Champions] Doubles Custom Game` already exists

```
mod: 'champions',  gameType: 'doubles',  debug: true
ruleset: Team Preview, Cancel Mod, Max Team Size = 24,
         Max Move Count = 24, Max Level = 9999, Default Level = 50
```

No EV Limit rule, so **no 66-point cap**. No Flat Rules, so no validation. `debug: true`
additionally suppresses the validator's "did you forget to invest?" style warnings.

**This is the vehicle for Layer B.** A sanctioned sandbox format that keeps Champions
mechanics while switching validation off — exactly what arbitrary position setup needs, and
we do not have to write it.

### Mod layout

- `champions` — Reg M-B, holds all the mechanics
- `championsregma` — Reg M-A, whose `scripts.ts` is just `{ inherit: 'champions', gen: 9 }`

Mechanics are shared; the two differ only in `formats-data.ts` (legality) and `items.ts`.
**Build against `champions` and Reg M-A comes along for free.** 16 Champions formats exist in
total, including Bo3 variants, BSS, OU/UU, Draft and Randoms.

### The sim core is browser-safe

Node builtin imports across the simulator:

| File | Node builtins |
|---|---|
| `sim/battle.ts` | 0 |
| `sim/state.ts` | 0 |
| `sim/pokemon.ts` | 0 |
| `sim/field.ts` | 0 |
| `sim/side.ts` | 0 |
| `sim/battle-stream.ts` | 0 |
| `sim/dex.ts` | `fs`, `path` |

`sim/dex.ts` is the *only* offender, and only for loading data off disk
(`path.resolve(__dirname,'../data')`, `fs.readdirSync(MODS_DIR)`, `require(...aliases)`).
Everything else Node-only lives in `lib/` — crashlogger, process-manager, repl — which is
server infrastructure we already decided to skip (§6).

**So the extension architecture is not blocked by the simulator.** Replacing runtime
filesystem data loading with static imports is exactly what `@pkmn/sim` does, which is why
that package exists. The delivery-shape decision stays open, but it is now open on UI and
distribution grounds rather than on whether the sim can run at all.

---

## 8. Step 1 — foundations

**Deliverable:** a locally running Champions-rules battle you can drive from code.

- Local `pokemon-showdown` sim (or `@pkmn/sim`), no server.
- Running `[Gen 9 Champions] VGC 2026 Reg M-A / M-B`.
- Both sides driven from one process via the stream API.
- Protocol output rendered somewhere — even ugly text is fine at this stage.

**Done when:** you can script a full doubles game end to end and read the result.

---

## 9. Step 2 — rewind and branch *(first shippable release)*

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

- **HP granularity is asymmetric.** The protocol splits messages into secret and public
  halves and standard formats run HP Percentage Mod. You get exact HP for your own Pokémon
  and **percentages for theirs**. Opponent bounds come from percentage buckets, not exact
  numbers. Design the UI around ranges from the start.
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
| Input log unavailable or requires opponent consent | Step 0 spike; fall back to protocol-log state reconstruction |
| Showdown's Champions mod diverges from the real game | Validate against known damage benchmarks early; the mod is only months old and is the least-tested part of the codebase |
| PCBL adds branching | They have shown no sign of it; their product is analytics. Move fast on the core loop. |
| **PCBL licence coupling** | Their licence forbids commercial use. Reading a JSON file a user exported themselves is probably fine, but if Encoreable ever charges *and* requires PCBL, that gets murky. Keep the manual-entry path working so PCBL is always an accelerator, never a dependency. Ask the dev directly if it ever matters. |
| Champions ships official replays | Reduces Step 4 cost, does not remove the product. A replay is not a position. |
| Legal | Showdown survives on being free, non-commercial, and supplementary rather than substitutive. Treat that as the template. The MIT code is not the issue — Nintendo/TPC assets are. Note PCBL chose proprietary + Buy Me a Coffee rather than a paid product. |

---

## 15. Open questions

- Extension, web app, or desktop? *(blocked on Step 0 browser-sim spike)*
- How do the RNG controls surface without cluttering the battle scene? Pre-turn toggles, a
  side panel, or a prompt at the moment the roll happens? Worth sketching on paper first.
- How far back can you step, and is it a linear undo or a saved tree of lines you explored?

### Closed

- **Stat Points** — native, exact, no rounding anywhere in the VGC path. The SP→stat map is
  perfectly invertible, which is the best case for §10. See §7a.
- **Can the sim run in a browser** — yes. Only `sim/dex.ts` has Node dependencies, and only
  for data loading. Not a constraint on delivery shape. See §7a.
- **First users** — it is you. No adoption problem to solve, no onboarding to build, and
  manual entry in Step 4 is fine indefinitely.
- **Money** — defer, but stay reversible. The one live constraint is the PCBL licence
  coupling in §14: do not let a non-commercial dependency become load-bearing.