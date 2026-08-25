/**
 * Node-side access to the RNG controller.
 *
 * The engine itself lives in `scripts/server/rng-command.js`, because that is
 * the copy the server loads. This module is the ESM face of the same file: it
 * re-exports the `>eval` line builders and adds the two things that only make
 * sense outside the server - building a controlled input log, and replaying one
 * headlessly to read the accounting back.
 *
 * Interceptor state lives on `battle.__rng` in whichever process owns the
 * `Battle`. In a live room that is a simulator worker and the only way to read
 * it is `/rng log`; here the battle is in this process, so `readState()` reaches
 * it directly.
 */

import { createRequire } from 'module';

import { inputLogLines, truncateAtTurn, freshSeed } from './truncate.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');
const engine = require('../server/rng-command.js');

export const {
  INTERCEPTOR, OUTCOME_WORDS, parseSpec,
  installLine, armLine, clearLine, expireLine, reportLine, listLine,
} = engine;

export { freshSeed };

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
 * else. The interceptor is installed *before* the reseed on purpose: `>reseed`
 * replaces the generator object (`sim/battle.ts:219`), so if the accessor on
 * `battle.prng` is not doing its job, the controlled log forces nothing and says
 * so instead of quietly matching the baseline.
 *
 * @param raw    a recorded `inputLog`
 * @param turn   the turn to arm at - the rules are in place before it resolves
 * @param specs  `<outcome> <subject> [move]` strings
 * @returns { baseline, controlled, seed, turn, arms }
 */
export async function buildControlled(raw, turn, specs, { seed = null, standing = false } = {}) {
  const use = seed || freshSeed();
  const { header, before, after, cut } = await splitAtTurn(raw, turn);

  const arms = [];
  for (const text of specs) {
    const spec = parseSpec(text);
    if (spec.error) throw new Error(`--force "${text}": ${spec.error}`);
    arms.push({ text, spec, line: armLine(spec, standing) });
  }

  const reseed = `>reseed ${use}`;
  const join = lines => `${lines.join('\n')}\n`;

  return {
    baseline: join([...header, ...before, reseed, ...after]),
    controlled: join([
      ...header, ...before,
      installLine(),
      reseed,
      ...arms.map(a => a.line),
      ...after,
    ]),
    seed: use,
    turn: cut.turn,
    arms,
  };
}

/** The interceptor's own accounting, as plain data. */
function readState(battle) {
  const st = battle.__rng;
  if (!st) return null;
  return {
    draws: st.draws,
    forced: st.subs,
    skipped: st.skipped,
    reseeds: st.reseeds,
    drawsSinceReseed: st.sinceReseed,
    expire: st.expire,
    notes: st.notes.slice(),
    armed: st.rules.map(r => ({
      id: r.id, text: r.text, turn: r.turn, tries: r.tries, fired: r.fired,
    })),
  };
}

/**
 * Replays an input log in this process and reports what came out.
 * `rng` is null when the log carries no interceptor.
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
    rng: readState(battle),
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
