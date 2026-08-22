# Encoreable — Agent Execution Brief

**Audience:** a coding agent with repo access and a terminal. Assume no prior conversation.
**Verified against:** `smogon/pokemon-showdown` @ `6a1836d` (3 Aug 2026), Node v22.
**Companion doc:** `encoreable-plan.md` holds product strategy. This file is execution only.

---

## 0. Mission

Build a tool that takes a finished Pokémon Showdown battle, restores the exact position at
an arbitrary turn, and lets a human play forward from there — piloting **both sides**, with
manual control over RNG outcomes.

Target ruleset is **Pokémon Champions VGC** (`[Gen 9 Champions] VGC 2026 Reg M-B`), doubles.

### Hard scope guards

Do not build any of these. If a task seems to require one, stop and ask.

- **No AI, no engine, no evaluation function, no move recommendation, no search.**
- **No opponent bot.** The human plays both sides.
- **No original battle mechanics.** Never write damage, accuracy, turn-order, or status
  logic. Showdown's simulator is the sole source of truth. If mechanics look wrong, the fix
  is upstream or in a config, never a reimplementation.
- **No fork of Showdown.** Consume it as a dependency. Read its source freely; do not vendor
  a modified copy.
- **No UI work** until Task 5 is signed off.

### Working style

- Small commits, one per task.
- Every task below has an acceptance criterion. Do not proceed past a failing one — report
  instead.
- Tasks marked **STOP** end the session with a written finding.

---

## 1. Verified facts — do not re-derive

These were read directly from the source. Trust them; spend your time elsewhere.

### 1.1 Format IDs

| Format | ID |
|---|---|
| VGC 2026 Reg M-B (primary target) | `gen9championsvgc2026regmb` |
| VGC 2026 Reg M-A | `gen9championsvgc2026regma` |
| Doubles Custom Game (sandbox) | `gen9championsdoublescustomgame` |

`championsregma`'s `scripts.ts` is `{ inherit: 'champions', gen: 9 }` — mechanics are shared.
Build against `champions`; Reg M-A follows automatically.

### 1.2 Champions stat model — exact, no rounding

`data/mods/champions/scripts.ts` → `statModify()`, level-50 path:

```
HP     = baseStat + StatPoints + 75
others = baseStat + StatPoints + 20      → then nature
```

Nature applies afterwards with 16-bit truncation: `trunc(trunc(stat * 110, 16) / 100)` for a
boost, `* 90` for a drop.

**1 Stat Point = exactly 1 final stat point.** No division, no EV conversion. Stat Points are
*stored* in `set.evs` but the arithmetic is native. The map is exactly invertible.

Exception, out of scope: rulesets with `levelclausemod` (Draft only) use
`max(2 × SP − 1, 0)` in the mainline formula — first point worth 4 EVs, rest worth 8. VGC
does not use this.

### 1.3 Validation

`sim/team-validator.ts`, triggered by `dex.currentMod.startsWith('champions')`:
- 32 Stat Points max per stat
- **All IVs must be exactly 31** or the team is rejected
- Budget 66, set at `sim/dex-formats.ts:349`, only when the EV Limit rule resolves to `Auto`

### 1.4 Champions caps all moves at 20 base PP

The mod's `init()` clamps every move with `pp > 20` down to 20. Max PP still follows
`(pp / 5 + 1) * 4`. This changes PP-stall maths — do not assume mainline PP values anywhere.

### 1.5 The sim core is browser-safe

Zero Node builtin imports in `battle.ts`, `state.ts`, `pokemon.ts`, `field.ts`, `side.ts`,
`battle-stream.ts`. Only `sim/dex.ts` uses `fs`/`path`, purely to load data off disk.
Everything else Node-only lives in `lib/` (server infrastructure, unused here).

### 1.6 Public API surface

Exported from `sim/index.ts`: `Battle`, `BattleStream`, `getPlayerStreams`, `Pokemon`,
`PRNG`, `Side`, `Dex`, `toID`, `Teams`, `TeamValidator`.

**`State` is NOT exported.** Use `Battle.toJSON()` and `static Battle.fromJSON()`, which wrap
`State.serializeBattle` / `State.deserializeBattle`. Deep-import `sim/state` only if you need
something those two do not expose.

---

## 2. RNG control — read this carefully

**Correction to any earlier guidance: `forceRandomChance` is not the mechanism you want.**

`sim/battle.ts:213`:
```ts
this.forceRandomChance = (this.debugMode && typeof options.forceRandomChance === 'boolean')
  ? options.forceRandomChance : null;
```
It is `readonly`, set once at construction, gated on `debugMode`
(`format.debug || !!options.debug`), and **globally forces every `randomChance()` call** to
one boolean. The source comments it as a test helper. It cannot express "this crit lands, the
rest stays random."

Use this ladder instead:

**Tier 1 — inject a scripted RNG (full per-roll control, preferred).**
`PRNG` exposes a public mutable field `rng!: RNG`, where `RNG` is
`{ getSeed(): PRNGSeed; next(): number }` — a 32-bit source. Duck-type it and assign:

```ts
battle.prng.rng = {
  getSeed: () => 'scripted' as any,
  next: () => scriptedValues.shift() ?? fallback.next(),
};
```
The `RNG` interface is internal (not exported), so you will need a structural type.
This is how you force one crit without disturbing anything else.

**Tier 2 — seed search (zero sim modification, easiest first pass).**
`battle.resetRNG(seed)` at `sim/battle.ts:360` replaces the PRNG. Re-run the turn across
candidate seeds until the outcome you want appears. Crude, needs no internals, good enough to
ship Task 5.

**Tier 3 — `forceRandomChance`.** Only for coarse "everything hits / nothing hits" sweeps.
Requires a `debug: true` format — `gen9championsdoublescustomgame` has this.

### Seeds are strings, not arrays

`PRNG`'s constructor takes a string. Seeds beginning `sodium,` use `SodiumRNG`; otherwise the
Gen 5 RNG. Legacy array seeds from old input logs are joined with commas for compatibility —
handle both when parsing input logs, emit strings.

---

## 3. Tasks

### Task 0 — Environment

```bash
mkdir encoreable && cd encoreable && git init
git clone --depth 1 https://github.com/smogon/pokemon-showdown.git vendor/pokemon-showdown
npm init -y
npm install pokemon-showdown
mkdir -p spikes data src
```

`vendor/pokemon-showdown` is a **read-only reference checkout** for source reading. Never
modify it. Runtime dependency is the npm package.

**Acceptance:** `node -e "const {Dex}=require('pokemon-showdown'); console.log(Dex.formats.get('gen9championsvgc2026regmb').name)"` prints the format name.

If the npm package lags the repo and lacks the Champions mods, build from the checkout
instead (`node build`) and depend on that. Report which path you took.

---

### Task 1 — Deterministic reproduction **[STOP on failure]**

The single load-bearing assumption of the project.

Write `spikes/01-reproduce.js`:
1. Run a scripted Champions doubles battle to completion via `BattleStream`, capturing both
   the protocol output and `battle.inputLog`.
2. Feed that captured input log into a **fresh** `BattleStream`.
3. Diff the two protocol outputs.

**Acceptance:** byte-identical output across the two runs.

If they diverge, find out where — a seed-format mismatch (§2) is the most likely cause, then
team ordering, then anything reading wall-clock time. **Report the divergence and stop.**
Everything downstream assumes this works.

---

### Task 2 — Input log availability **[STOP either way]**

Requires a real replay JSON from the project owner, placed in `data/`. If absent, request it
and stop.

Determine whether a saved Showdown replay exposes a **usable input log including its seed**.
Check both the `.json` endpoint payload and the `.log` variant. There is a documented tension:
Smogon's RNG page says seeds are hidden for non-random teams and need `/exportinputlog` with
the opponent's consent; the client's `WEB-API.md` says input logs are present in replay JSON.

**Acceptance:** a written answer to "can we get a seeded input log from a replay URL without
opponent consent?" — yes, no, or conditional, with the evidence.

This decides the whole ingestion path, so **stop and report** regardless of outcome:
- **Yes** → Task 3 proceeds as written.
- **No** → Task 3 switches to reconstructing state from the plain protocol log. `@pkmn/client`
  is purpose-built for this. Different work, still viable, but it means Layer A cannot use
  the sim's own replay and must rebuild state instead.

---

### Task 3 — Restore to turn N

Build `src/restore.js`, exporting `restoreToTurn(inputLog, turnNumber)` → a live `Battle`
positioned at the start of that turn, ready to accept choices.

Implementation: truncate the input log's choice lines at the target turn and replay the
prefix. Do **not** hand-construct state — the simulator maintains its own invariants, which
is the entire reason this approach is preferred.

**Acceptance:** for a battle of N turns, restoring to each turn 1..N produces a battle whose
public state matches the original log at that point. Assert on HP, status, field conditions,
side conditions, and active Pokémon.

---

### Task 4 — RNG control

Build `src/rng.js` exposing at minimum:
- `withScriptedRolls(battle, rolls)` — Tier 1 injection per §2
- `rerollUntil(battle, predicate, maxAttempts)` — Tier 2 seed search

Target outcomes to support: critical hit, damage roll (specific of the 16), hit/miss,
secondary-effect proc, paralysis full-stop, flinch, speed tie.

**Acceptance:** a test that forces a specific attack to crit on demand while leaving every
other roll in the turn untouched, demonstrated by comparing against an unforced run.

Start with Tier 2 if Tier 1 proves fiddly — shipping beats elegance here.

---

### Task 5 — Playable branch (CLI)

Wire Tasks 3 and 4 into a terminal loop: load a replay, pick a turn, then repeatedly accept
choices for **both** sides, applying any requested RNG overrides, and print the resulting
protocol.

**Acceptance:** the project owner can load one of their own games, branch at a chosen turn,
play three turns differently, and force at least one crit.

**This is the first thing worth showing anyone. Stop here and demo it.**

---

## 4. Deferred — do not start without sign-off

- **Layer B, direct state authoring.** For positions that never occurred. When it happens, the
  vehicle is `gen9championsdoublescustomgame` — validation off, no 66-point cap, `debug: true`
  already set. The difficulty is not HP and weather; it is the volatile layer:
  consecutive-Protect counter, Encore turns remaining, Taunt turns, Fake Out eligibility,
  Choice lock, `lastMove`, disabled slots, Tailwind / Trick Room counters, consumed-item
  flags, and the pending action queue. Authoring those consistently by hand is the hardest
  problem in the project.
- **Serialization round-trip.** `Battle.toJSON()` → `Battle.fromJSON()` → `battle.restart(send)`.
  Note the source comment: deserialized games *must* use `restart()`. Worth an early probe to
  learn the object's shape, but not a dependency of Tasks 1–5.
- **Constraint inference.** Bounding opponent Stat Points from observed damage and turn order.
  Two properties matter when it starts: bounds constrain a *product* (HP × Def), not a single
  stat, so one observation yields a curve; and opponent HP arrives as percentages, not exact
  values, because standard formats run HP Percentage Mod and the protocol splits messages
  into secret and public halves.
- **Any UI.**
- **Champions video ingestion.**

---

## 5. Reference — files worth reading

| Path | Why |
|---|---|
| `sim/SIMULATOR.md` | Stream API and input-log format |
| `sim/SIM-PROTOCOL.md` | Protocol messages, including `\|split\|` secret/public |
| `sim/battle-stream.ts` | `BattleStream`, `getPlayerStreams` |
| `sim/battle.ts` | `randomChance` :350, `resetRNG` :360, `toJSON` :318, `fromJSON` :322, `restart` :1968 |
| `sim/prng.ts` | `PRNG`, the `RNG` interface, seed formats |
| `sim/state.ts` | `serializeBattle` :61, `deserializeBattle` :84 |
| `sim/team-validator.ts` | Stat Point validation |
| `data/mods/champions/scripts.ts` | Stat formula, PP cap, Trick Room fix |
| `config/formats.ts` | Champions format definitions |
