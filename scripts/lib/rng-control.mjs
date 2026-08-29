/**
 * Node-side access to the RNG controller.
 *
 * The engine itself lives in `scripts/server/rng-command.js`, because that is
 * the copy the server loads. This module is the ESM face of the same file: it
 * teaches this process's `BattleStream` the `>rng` verb, turns a typed
 * `<outcome> <subject> [move] [target]` into the input-log line that arms it,
 * and replays a controlled log headlessly to read the accounting back.
 *
 * Interceptor state lives on `battle.__rng` in whichever process owns the
 * `Battle`. In a live room that is the main server process and `/rng` reads it
 * directly; here the battle is in this process, so `snapshot()` does.
 */

import { createRequire } from 'module';

import { inputLogLines, truncateAtTurn, freshSeed } from './truncate.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');
const engine = require('../server/rng-command.js');

engine.teachStream(BattleStream);

export const { OUTCOME_WORDS, snapshot } = engine;

export { freshSeed };

/**
 * Splits `<outcome> <subject> [move] [target]` and validates the outcome word.
 * The Pokemon are resolved inside the battle, where the teams are.
 */
export function parseSpec(text) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: 'name an outcome, e.g. crit' };
  const outcome = parts[0].toLowerCase();
  if (!engine.outcomeSpec(outcome)) {
    return { error: `"${parts[0]}" is not an outcome. Try: ${OUTCOME_WORDS.join(' ')}` };
  }
  return {
    outcome,
    subject: parts.length > 1 ? parts[1] : 'any',
    move: parts.length > 2 && parts[2] !== '-' ? parts[2].toLowerCase().replace(/[^a-z0-9]/g, '') : '',
    target: parts.length > 3 && parts[3] !== '-' ? parts[3] : '',
  };
}

/** The input-log line that arms one rule. */
export function armLine(spec) {
  return `>rng ${engine.forceLine(spec)}`;
}

/**
 * Splits a recorded input log into the header, the choices made before `turn`,
 * and the choices made from `turn` on.
 *
 * The split point comes from `truncateAtTurn`, which replays the log one line at
 * a time rather than counting - a faint replacement adds an extra `>pN switch`
 * mid-turn, so index arithmetic cuts in the wrong place (ENGINEERING.md 5.8).
 */
async function splitAtTurn(raw, turn) {
  const cut = await truncateAtTurn(raw, turn, { reseed: false });
  const lines = inputLogLines(raw);
  const firstChoice = lines.findIndex(l => /^>p[1-4] /.test(l));
  const headerEnd = firstChoice < 0 ? lines.length : firstChoice;
  const choices = lines.slice(headerEnd);
  return {
    header: lines.slice(0, headerEnd),
    before: choices.slice(0, cut.kept),
    after: choices.slice(cut.kept),
    cut,
  };
}

/**
 * Two input logs that differ only in the armed rules.
 *
 * Both carry the same `>reseed`, so both roll the same fresh stream from the
 * branch point and any divergence between them is the substitution and nothing
 * else. The arms sit *before* the reseed on purpose: `>reseed` replaces the
 * generator object (`sim/battle.ts:361`), so if the accessor on `battle.prng` is
 * not doing its job, the controlled log forces nothing and says so instead of
 * quietly matching the baseline.
 *
 * @param raw    a recorded `inputLog`
 * @param turn   the turn to arm at - the rules are in place before it resolves
 * @param specs  `<outcome> <subject> [move] [target]` strings
 * @returns { baseline, controlled, seed, turn, arms }
 */
export async function buildControlled(raw, turn, specs, { seed = null } = {}) {
  const use = seed || freshSeed();
  const { header, before, after, cut } = await splitAtTurn(raw, turn);

  const arms = [];
  for (const text of specs) {
    const spec = parseSpec(text);
    if (spec.error) throw new Error(`--force "${text}": ${spec.error}`);
    arms.push({ text, spec, line: armLine(spec) });
  }

  const reseed = `>reseed ${use}`;
  const join = lines => `${lines.join('\n')}\n`;

  return {
    baseline: join([...header, ...before, reseed, ...after]),
    controlled: join([...header, ...before, ...arms.map(a => a.line), reseed, ...after]),
    seed: use,
    turn: cut.turn,
    arms,
  };
}

/**
 * Replays an input log in this process and reports what came out.
 * `rng` is null when the log arms nothing.
 */
export async function replayControlled(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const chunks = [];
  const drain = (async () => { for await (const chunk of stream) chunks.push(chunk); })();

  await stream.write(inputLog);
  const battle = stream.battle;
  if (!battle) throw new Error('no battle - the input log is malformed');

  const result = {
    debugLog: battle.getDebugLog(),
    inputLog: battle.inputLog.join('\n'),
    ended: battle.ended,
    turns: battle.turn,
    rng: battle.__rng ? snapshot(battle) : null,
    errors: [],
  };

  await stream.writeEnd();
  await drain;

  // The side channel is an async iterator: nothing has arrived on it until the
  // drain above finishes, so this has to come last.
  result.errors = chunks.join('\n').split('\n').filter(l => l.startsWith('|error|'));
  return result;
}

/**
 * `CLEAN` / `TRUNCATED` / `REJECTED`, the three ways a branch can end
 * (ENGINEERING.md 5.2).
 */
export function verdict(run) {
  if (run.errors.length) return 'REJECTED';
  return run.ended ? 'CLEAN' : 'TRUNCATED';
}
