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
 * arithmetic silently cuts in the wrong place. See TESTPHASE.MD 5.8.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');

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
 * @param raw    an `inputLog` as stored in a `.log.json`
 * @param target the turn to stop at - the battle will be waiting for this turn's choices
 * @returns { inputLog, turn, requested, ended, awaitingChoice, position, players, kept, total, errors }
 */
export async function truncateAtTurn(raw, target) {
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`turn must be a positive integer, got "${target}"`);
  }

  const lines = inputLogLines(raw);
  if (!lines.length) throw new Error('input log is empty');

  const bad = lines.find(l => /^>p[1-4] .*\bdefault\b/.test(l));
  if (bad) {
    throw new Error(
      `input log contains a "default" choice (${bad}) - an auto-chosen targeted move is ` +
      `recorded without its target and cannot be replayed (TESTPHASE.MD 6.1)`
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

  const result = {
    inputLog: header.concat(kept).join('\n') + '\n',
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
