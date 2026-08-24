/**
 * Check that a branch played in the browser is a real continuation of the
 * recorded battle, not a coincidence that merely looked right on screen.
 *
 * Two things have to hold:
 *
 *   1. The played room's input log begins with exactly the truncated prefix,
 *      followed only by new choices. Nothing earlier was rewritten.
 *   2. Re-simulating that input log offline reproduces the room's protocol log
 *      line for line, so the position on screen was the position in the sim.
 *
 * `>player` lines are compared separately: joining a slot writes a fresh
 * `>player pN {...}` into the stream (`server/room-battle.ts:1146`), so they turn
 * up interleaved with choices. They replay cleanly - `setPlayer` takes an edit
 * branch for a side that already exists (`sim/battle.ts:3223`) - and are not
 * corruption.
 *
 * `>reseed` is treated the same way. A branch launched from the replay button
 * carries one so the continuation rolls fresh, and it is reported rather than
 * read as a rewritten prefix.
 */

import fs from 'fs';
import { createRequire } from 'module';

import { battleLines, firstDivergence } from './protocol.mjs';
import { inputLogLines, truncateAtTurn } from './truncate.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');

const isPlayerLine = l => /^>player p[1-4] /.test(l);
const isReseedLine = l => /^>reseed /.test(l);
/** Lines that are bookkeeping rather than a choice, so not part of the prefix. */
const isBookkeeping = l => isPlayerLine(l) || isReseedLine(l);

async function resimulate(inputLog) {
  const lines = inputLogLines(inputLog);
  const startAt = lines.findIndex(l => l.startsWith('>start '));

  const stream = new BattleStream({ keepAlive: true });
  const chunks = [];
  const drain = (async () => { for await (const chunk of stream) chunks.push(chunk); })();

  await stream.write(lines.slice(0, startAt + 1).join('\n'));
  const battle = stream.battle;
  await stream.write(lines.slice(startAt + 1).join('\n'));

  const out = {
    log: battle.getDebugLog(),
    turns: battle.turn,
    ended: battle.ended,
    winner: battle.winner ?? null,
    errors: chunks.join('\n').split('\n').filter(l => l.startsWith('|error|')),
  };
  await stream.writeEnd();
  await drain;
  return out;
}

/**
 * @param original   the inputLog of the battle that was branched from
 * @param turn       the turn it was truncated at
 * @param playedFile path to the `.log.json` the branch wrote when it ended
 */
export async function verifyBranch({ original, turn, playedFile }) {
  const played = JSON.parse(fs.readFileSync(playedFile, 'utf8'));
  const playedInput = Array.isArray(played.inputLog) ? played.inputLog.join('\n') : String(played.inputLog || '');
  if (!playedInput.trim()) throw new Error(`${playedFile} contains no inputLog`);

  const cut = await truncateAtTurn(original, turn);

  const prefix = inputLogLines(cut.inputLog).filter(l => !isBookkeeping(l));
  const actual = inputLogLines(playedInput);
  const actualChoices = actual.filter(l => !isBookkeeping(l));

  const lines = [];
  const say = s => lines.push(s);

  // 1. prefix intact
  const mismatch = firstDivergence(prefix, actualChoices.slice(0, prefix.length));
  const prefixOk = !mismatch && actualChoices.length >= prefix.length;
  say(`prefix            ${prefixOk ? 'INTACT' : 'BROKEN'}  (${prefix.length} lines up to turn ${cut.turn})`);
  if (mismatch) {
    say(`  line ${mismatch.index}`);
    say(`    expected      ${mismatch.expected ?? '(end of log)'}`);
    say(`    found         ${mismatch.actual ?? '(end of log)'}`);
  }

  // 2. what was added
  const added = actualChoices.slice(prefix.length);
  say(`new choices       ${added.length}`);
  for (const line of added) say(`  ${line}`);

  const rejoins = actual.filter(isPlayerLine).length - cut.inputLog.split('\n').filter(isPlayerLine).length;
  if (rejoins > 0) say(`player rejoins    ${rejoins} extra >player line(s) from slot joins - expected, not corruption`);

  for (const line of actual.filter(isReseedLine)) {
    say(`continuation seed ${line.slice('>reseed '.length)}  (the prefix keeps the recorded seed)`);
  }

  // 3. offline re-simulation matches the room
  const run = await resimulate(playedInput);
  // `|player|` lines are dropped on both sides: taking a slot emits one into the
  // room log wherever the join happened, so their position is a fact about when
  // the operator clicked, not about the battle.
  const mechanics = log => battleLines(log).filter(l => !l.startsWith('|player|'));
  const recorded = mechanics(played.log || '');
  const replayed = mechanics(run.log);
  const div = recorded.length ? firstDivergence(recorded, replayed) : null;
  const replayOk = recorded.length > 0 && !div && !run.errors.length;

  say(`re-simulation     ${recorded.length ? (replayOk ? 'IDENTICAL' : 'DIVERGED') : 'NO ROOM LOG TO COMPARE'}` +
      `  (${replayed.length} battle lines, ${run.turns} turns)`);
  if (div) {
    say(`  line ${div.index}`);
    say(`    room          ${div.expected ?? '(end of log)'}`);
    say(`    re-simulated  ${div.actual ?? '(end of log)'}`);
  }
  if (run.errors.length) for (const e of new Set(run.errors)) say(`  choice error    ${e}`);

  const ok = prefixOk && replayOk && added.length > 0;
  say('');
  say(ok
    ? `VERIFIED: the branch is the recorded battle through turn ${cut.turn} plus ${added.length} new choice(s), and it re-simulates exactly.`
    : `NOT VERIFIED: see above.`);

  return { ok, prefixOk, replayOk, added, text: lines.join('\n') };
}
