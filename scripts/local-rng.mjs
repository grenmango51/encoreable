/**
 * Damage-roll control on a recorded battle.
 *
 * Every damaging hit in Showdown ends with one 16-way roll:
 *
 *   sim/battle.ts:2388   randomizer(baseDamage) {
 *                          return tr(tr(baseDamage * (100 - this.random(16))) / 100);
 *                        }
 *
 * This script replays a recorded battle and decides which of those 16 rolls comes
 * out for two chosen hits of one move - the first rolls higher, the next rolls
 * lower by the same amount, so the position reconverges and the outcome is
 * untouched. The damage numbers are never written; the simulator computes them
 * from the roll, as always.
 *
 * The roll is chosen by swapping `battle.prng.rng` for a scripted source
 * (TESTPHASE.md 2, Tier 1). That source always draws from the real RNG, so the
 * stream stays aligned and nothing downstream shifts; it only substitutes its own
 * 32-bit value for the single draw behind the targeted roll. `prng.random(16)` is
 * `Math.floor(next() * 16 / 2**32)` (sim/prng.ts:91), so roll `r` is requested by
 * returning the midpoint of the band that floors to `r`.
 *
 * Usage:
 *   node scripts/local-rng.mjs                            newest battle, moonblast, aim for 3
 *   node scripts/local-rng.mjs --from <log.json>
 *   node scripts/local-rng.mjs --move icespinner --delta 1
 *   node scripts/local-rng.mjs --no-open
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { buildReplayHtml } from './lib/replay-html.mjs';
import { battleLines, allDivergences } from './lib/protocol.mjs';

const require = createRequire(import.meta.url);
const { BattleStream, Dex } = require('pokemon-showdown');

const ROOT = process.cwd();
const RUNTIME_LOGS = path.join(ROOT, 'runtime', 'logs');
const REPLAY_DIR = path.join(ROOT, 'replays');
const ROLLS = 16;

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

const MOVE = String(opt('--move', 'moonblast')).replace(/[^a-z0-9]/gi, '').toLowerCase();
const WANTED = Math.abs(Number(opt('--delta', '3')));

// ------------------------------------------------------------------ log files

function newestLogFile() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.log.json')) out.push(full);
    }
  };
  walk(RUNTIME_LOGS);
  if (!out.length) return null;
  return out.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

// -------------------------------------------------------------- re-simulation

/**
 * Replays `inputLog`. `rolls` maps a 1-based occurrence of MOVE to the damage
 * roll (0 = highest damage, 15 = lowest) that hit should get.
 */
async function replay(inputLog, rolls = {}) {
  const lines = inputLog.split('\n').filter(l => l.startsWith('>'));
  const startAt = lines.findIndex(l => l.startsWith('>start '));

  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) void chunk; })();

  // The battle only exists once `>start` has been written.
  await stream.write(lines.slice(0, startAt + 1).join('\n'));
  const battle = stream.battle;
  if (!battle) throw new Error('no battle after >start');

  // --- the scripted RNG -----------------------------------------------------
  let pending = null;   // a roll the next draw should produce
  const realRng = battle.prng.rng;
  let substitutions = 0;

  battle.prng.rng = {
    getSeed: () => realRng.getSeed(),
    next: () => {
      const real = realRng.next();          // always draw, so the stream stays aligned
      if (pending === null) return real;
      const roll = pending;
      pending = null;
      substitutions++;
      return Math.floor((roll + 0.5) * 2 ** 32 / ROLLS);
    },
  };

  // --- arm the substitution for one specific damage roll --------------------
  let armed = null;
  const originalRandomizer = battle.randomizer;
  battle.randomizer = function (baseDamage) {
    if (armed !== null) {
      pending = armed;
      armed = null;
    }
    return originalRandomizer.call(this, baseDamage);
  };

  const hits = [];
  let seen = 0;
  const originalGetDamage = battle.actions.getDamage;
  battle.actions.getDamage = function (source, target, move, suppressMessages) {
    const id = typeof move === 'string' ? move : move?.id;
    if (id !== MOVE) return originalGetDamage.call(this, source, target, move, suppressMessages);

    const n = ++seen;
    const forced = rolls[n];
    if (forced !== undefined) armed = forced;
    const hpBefore = target.hp;

    const damage = originalGetDamage.call(this, source, target, move, suppressMessages);

    // Never leave a substitution armed - an immune or missed hit would otherwise
    // hand it to an unrelated draw.
    armed = null;
    pending = null;

    if (typeof damage === 'number' && damage > 0) {
      hits.push({
        n,
        turn: battle.turn,
        slot: `${target.side.id}${'abc'[target.position]}`,
        name: target.name,
        hpBefore,
        maxhp: target.maxhp,
        damage,
        roll: forced ?? null,
        lethal: damage >= hpBefore,
      });
    }
    return damage;
  };

  await stream.write(lines.slice(startAt + 1).join('\n'));
  const result = {
    log: battle.getDebugLog(),
    hits,
    substitutions,
    ended: battle.ended,
    turns: battle.turn,
  };
  await stream.writeEnd();
  await drain;
  return result;
}

/** Damage this hit deals under each of the 16 rolls. */
async function rollTable(inputLog, hitNumber, fixed = {}) {
  const table = [];
  for (let roll = 0; roll < ROLLS; roll++) {
    const run = await replay(inputLog, { ...fixed, [hitNumber]: roll });
    const hit = run.hits.find(h => h.n === hitNumber);
    table.push(hit ? hit.damage : null);
  }
  return table;
}

// --------------------------------------------------------------------- report

function outcome(log) {
  const win = /\|win\|(.*)/.exec(log);
  return {
    winner: win ? win[1] : (/\|tie/.test(log) ? '(tie)' : null),
    faints: log.split('\n').filter(l => l.startsWith('|faint|')),
  };
}

function describeTable(table, natural) {
  return table.map((d, roll) => (
    `${roll === natural ? '*' : ' '}${String(roll).padStart(2)}:${String(d).padStart(3)}`
  )).join('  ');
}

// ----------------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });

  const logFile = opt('--from') || newestLogFile();
  if (!logFile) throw new Error('no battle log found - run `npm run replay` first');
  console.log(`Battle log: ${path.relative(ROOT, logFile)}`);

  const logData = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  const inputLog = Array.isArray(logData.inputLog) ? logData.inputLog.join('\n') : String(logData.inputLog || '');
  if (!inputLog.trim()) throw new Error('battle log contains no inputLog');

  const moveName = Dex.moves.get(MOVE).name || MOVE;

  console.log(`\nBaseline replay - every ${moveName} hit:`);
  const base = await replay(inputLog);
  if (base.substitutions) throw new Error('baseline replay substituted a roll - it should not have');
  if (base.hits.length < 2) throw new Error(`fewer than two ${moveName} hits in this battle`);
  for (const h of base.hits) {
    console.log(
      `  #${h.n}  turn ${h.turn}  ${h.slot} ${h.name.padEnd(12)} ` +
      `${h.hpBefore}/${h.maxhp} -> ${Math.max(0, h.hpBefore - h.damage)}  ` +
      `damage ${h.damage}${h.lethal ? '   (lethal - not eligible)' : ''}`
    );
  }

  // Two consecutive non-lethal hits on the same Pokemon, so the second can undo
  // the first and the position reconverges.
  let pair = null;
  for (let i = 0; i < base.hits.length - 1; i++) {
    const a = base.hits[i], b = base.hits[i + 1];
    if (a.slot === b.slot && !a.lethal && !b.lethal) { pair = [a, b]; break; }
  }
  if (!pair) {
    throw new Error(`no two consecutive non-lethal ${moveName} hits on the same target`);
  }
  const [hitUp, hitDown] = pair;

  console.log(`\nSweeping all ${ROLLS} rolls for ${moveName} #${hitUp.n} and #${hitDown.n}...`);
  const tableUp = await rollTable(inputLog, hitUp.n);
  const tableDown = await rollTable(inputLog, hitDown.n);

  const naturalUp = tableUp.indexOf(hitUp.damage);
  const naturalDown = tableDown.indexOf(hitDown.damage);
  console.log(`  #${hitUp.n}  roll:damage   ${describeTable(tableUp, naturalUp)}`);
  console.log(`  #${hitDown.n}  roll:damage   ${describeTable(tableDown, naturalDown)}`);
  console.log(`  (* = the roll this battle actually got)`);

  // A delta is usable only if one roll raises the first hit by exactly d and
  // another lowers the second by exactly d. Prefer the requested size, then the
  // closest achievable.
  const candidates = [];
  for (let d = 1; d <= 60; d++) {
    const up = tableUp.indexOf(hitUp.damage + d);
    const down = tableDown.indexOf(hitDown.damage - d);
    if (up < 0 || down < 0) continue;
    if (hitUp.damage + d >= hitUp.hpBefore) continue;   // must stay non-lethal
    candidates.push({ d, up, down });
  }
  if (!candidates.length) {
    throw new Error(
      `no delta is reachable by roll choice for ${moveName} #${hitUp.n}/#${hitDown.n} - ` +
      `the two hits' roll tables do not offer a matching step`
    );
  }
  candidates.sort((x, y) => Math.abs(x.d - WANTED) - Math.abs(y.d - WANTED) || x.d - y.d);
  const chosen = candidates[0];

  console.log(`\nReachable deltas: ${candidates.map(c => c.d).join(', ')}`);
  if (chosen.d !== WANTED) {
    console.log(`Requested ${WANTED} is not reachable by roll choice; using ${chosen.d}.`);
  }
  console.log(
    `\nForcing ${moveName} #${hitUp.n} to roll ${chosen.up} (was ${naturalUp}) ` +
    `and #${hitDown.n} to roll ${chosen.down} (was ${naturalDown}).`
  );

  const edited = await replay(inputLog, { [hitUp.n]: chosen.up, [hitDown.n]: chosen.down });
  const eUp = edited.hits.find(h => h.n === hitUp.n);
  const eDown = edited.hits.find(h => h.n === hitDown.n);

  const changed = allDivergences(battleLines(base.log), battleLines(edited.log));
  const a = outcome(base.log), b = outcome(edited.log);

  console.log('\n================ WHAT CHANGED ================\n');
  if (!changed.length) console.log('  nothing');
  for (const row of changed) {
    console.log(`  battle line ${row.index}`);
    console.log(`    before  ${row.before}`);
    console.log(`    after   ${row.after}`);
  }

  console.log('\n================ CHECKS ================\n');
  const rows = [
    ['exactly two rolls were substituted', edited.substitutions === 2, `${edited.substitutions}`],
    [`${moveName} #${hitUp.n} rolled ${chosen.d} higher`,
      eUp.damage - hitUp.damage === chosen.d,
      `roll ${naturalUp} -> ${chosen.up}, damage ${hitUp.damage} -> ${eUp.damage}`],
    [`${moveName} #${hitDown.n} rolled ${chosen.d} lower`,
      eDown.damage - hitDown.damage === -chosen.d,
      `roll ${naturalDown} -> ${chosen.down}, damage ${hitDown.damage} -> ${eDown.damage}`],
    ['both hits landed on the same Pokemon', eUp.slot === eDown.slot, `${eUp.slot} ${eUp.name}`],
    ['neither hit became lethal', !eUp.lethal && !eDown.lethal, ''],
    ['HP reconverges after the second hit',
      eDown.hpBefore - eDown.damage === hitDown.hpBefore - hitDown.damage,
      `${eDown.hpBefore - eDown.damage}/${eDown.maxhp} either way`],
    ['winner unchanged', a.winner === b.winner, `${b.winner}`],
    ['every faint unchanged, in the same order',
      JSON.stringify(a.faints) === JSON.stringify(b.faints), `${b.faints.length} faints`],
    ['turn count unchanged', base.turns === edited.turns, `${edited.turns} turns`],
    ['only the HP between the two hits differs',
      changed.length === 1, `${changed.length} line(s) differ`],
  ];
  for (const [label, ok, note] of rows) {
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  -  ${note}` : ''}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(REPLAY_DIR, `rolled-${MOVE}-${chosen.d}-${stamp}.html`);
  fs.writeFileSync(outFile, buildReplayHtml({
    title: `Re-rolled replay: ${moveName} #${hitUp.n} +${chosen.d}, #${hitDown.n} -${chosen.d}`,
    formatid: logData.format ? String(logData.format).replace(/[^a-z0-9]/gi, '').toLowerCase() : 'rolled',
    log: edited.log,
    ...(opt('--embed') ? { embedBase: opt('--embed') } : {}),
  }), 'utf8');
  console.log(`\nRe-rolled replay written: ${path.relative(ROOT, outFile)}`);

  if (!flag('--no-open')) {
    spawn('cmd.exe', ['/c', 'start', '', outFile], { detached: true, stdio: 'ignore' }).unref();
    console.log('Opening in your default browser.');
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
