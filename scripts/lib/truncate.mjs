/**
 * Cut a recorded input log back to the start of a chosen turn.
 *
 * The result is a complete, self-contained input log: the `>start` line with its
 * seed, both `>player` lines with their packed teams, and every choice that was
 * made before the target turn began. Feeding it to `/importinputlog` produces a
 * live battle sitting at exactly that position, waiting for choices.
 *
 * Turn boundaries are found by replaying the log ONE LINE AT A TIME and watching
 * `battle.turn`. Choice lines do not map one-per-side-per-turn - a faint
 * replacement adds an extra `>pN switch ...` in the middle of a turn - so index
 * arithmetic silently cuts in the wrong place. See ENGINEERING.md 5.8.
 *
 * The `>start` seed is never touched: replaying the prefix under the recorded
 * seed is what reproduces the recorded position, and any other seed lands
 * somewhere else. `reseed` instead appends a `>reseed` line after the last kept
 * choice, so the position is the recorded one and everything played from it
 * rolls fresh (`sim/battle-stream.ts:113`).
 */

import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');

// A controlled recording carries `>rng` lines in its input log. Replaying the
// prefix is how the recorded position is reproduced, so the stream must know
// the verb or it throws `Unrecognized command` (`sim/battle-stream.ts:216`) and
// the branch never opens. The engine is required directly rather than through
// `rng-control.mjs`, which imports this file.
const rng = require('../server/rng-command.js');
rng.teachStream(BattleStream);

/** A fresh seed in the shape `sim/prng.ts` writes: `sodium,` + 32 hex. */
export function freshSeed() {
  return `sodium,${crypto.randomBytes(16).toString('hex')}`;
}

/** Normalise a log.json `inputLog` (string or array) to protocol lines. */
export function inputLogLines(raw) {
  const lines = Array.isArray(raw) ? raw : String(raw ?? '').split('\n');
  return lines.map(l => l.trimEnd()).filter(l => l.startsWith('>'));
}

/** The player names carried by the `>player` lines, in slot order. */
export function playerNames(raw) {
  return inputLogLines(raw)
    .filter(l => /^>player p[1-4] /.test(l))
    .map((l) => {
      const json = l.slice(l.indexOf('{'));
      try { return JSON.parse(json).name || null; } catch { return null; }
    });
}

function describe(pokemon) {
  if (!pokemon) return null;
  return {
    name: pokemon.name,
    hp: pokemon.hp,
    maxhp: pokemon.maxhp,
    status: pokemon.status || '',
    fainted: !!pokemon.fainted,
  };
}

function positionOf(battle) {
  return battle.sides.map(side => ({
    id: side.id,
    name: side.name,
    requestState: side.requestState,
    active: side.active.map(describe),
    bench: side.pokemon.filter(p => !p.isActive).map(describe),
  }));
}

/** Human-readable one-line-per-side summary, exact HP included. */
export function positionText(position) {
  return position.map((side) => {
    const mons = side.active
      .filter(Boolean)
      .map(p => `${p.name} ${p.hp}/${p.maxhp}${p.status ? ` ${p.status}` : ''}`)
      .join('   ');
    return `${side.id} ${side.name.padEnd(12)} ${mons}`;
  }).join('\n');
}

/**
 * Drops `>rng at` pins for draws past `spent`, the number the prefix threw.
 *
 * A pin names the nth draw and the value it took, so it is a record of a die
 * already cast. Ordinals keep counting across a `>reseed`, so a pin written for
 * turn 9 of the recording would otherwise land on whatever the *branch* draws
 * ninth-turn-ish and force it - silently, in a position the operator is playing
 * by hand. Everything up to the cut is kept: those draws are the recorded
 * position, and re-running them is the whole point of the prefix.
 *
 * This runs whether or not the continuation is reseeded, so that one truncation
 * of one recording is one set of lines. `verify-branch.mjs` compares the prefix
 * it computes against the log the room actually played, and the two only agree
 * if both trimmed the same way.
 *
 * `>rng force` rules are deliberately left alone. A rule is an instruction about
 * an outcome, not a record of a draw, so surviving the branch is what it is for
 * (ENGINEERING.md 4.2).
 */
export function trimPins(lines, spent) {
  const out = [];
  for (const line of lines) {
    if (!line.startsWith('>rng at ')) { out.push(line); continue; }
    const keep = line.split(/\s+/).slice(2).filter(p => Number(p.split('=')[0]) < spent);
    if (keep.length) out.push(`>rng at ${keep.join(' ')}`);
  }
  return out;
}

/**
 * @param raw     an `inputLog` as stored in a `.log.json`
 * @param target  the turn to stop at - the battle will be waiting for this turn's choices
 * @param reseed  true for a fresh continuation seed, or a seed string to use one
 * @returns { inputLog, drawsKept, seed, turn, requested, ended, awaitingChoice, position, players, kept, total, errors }
 */
export async function truncateAtTurn(raw, target, { reseed = false } = {}) {
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`turn must be a positive integer, got "${target}"`);
  }

  const lines = inputLogLines(raw);
  if (!lines.length) throw new Error('input log is empty');

  const bad = lines.find(l => /^>p[1-4] .*\bdefault\b/.test(l));
  if (bad) {
    throw new Error(
      `input log contains a "default" choice (${bad}) - an auto-chosen targeted move is ` +
      `recorded without its target and cannot be replayed (ENGINEERING.md 6.1)`
    );
  }

  const startAt = lines.findIndex(l => l.startsWith('>start '));
  if (startAt < 0) throw new Error('input log has no >start line');
  if (!lines[startAt].includes('"formatid":"')) {
    throw new Error('>start line has no formatid - /importinputlog will reject it');
  }

  // Everything before the first choice is the header: `>start` plus `>player`.
  const firstChoice = lines.findIndex(l => /^>p[1-4] /.test(l));
  const headerEnd = firstChoice < 0 ? lines.length : firstChoice;
  const header = lines.slice(0, headerEnd);
  const choices = lines.slice(headerEnd);

  const stream = new BattleStream({ keepAlive: true });
  const chunks = [];
  const drain = (async () => { for await (const chunk of stream) chunks.push(chunk); })();

  await stream.write(header.join('\n'));
  const battle = stream.battle;
  if (!battle) throw new Error('no battle after >start - the header is malformed');

  const kept = [];
  for (const line of choices) {
    if (battle.turn >= target) break;
    await stream.write(line);
    kept.push(line);
    if (battle.ended) break;
  }

  const seed = reseed ? (typeof reseed === 'string' ? reseed : freshSeed()) : null;
  const tail = seed ? [`>reseed ${seed}`] : [];
  const drawsKept = rng.snapshot(battle).draws;

  const result = {
    inputLog: trimPins(header.concat(kept), drawsKept).concat(tail).join('\n') + '\n',
    drawsKept,
    seed,
    turn: battle.turn,
    requested: target,
    ended: battle.ended,
    awaitingChoice: battle.sides.every(s => s.requestState === 'move'),
    position: positionOf(battle),
    players: battle.sides.map(s => s.name),
    kept: kept.length,
    total: choices.length,
    errors: chunks.join('\n').split('\n').filter(l => l.startsWith('|error|')),
  };

  await stream.writeEnd();
  await drain;
  return result;
}
