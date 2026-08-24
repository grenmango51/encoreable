/**
 * Branch a recorded battle on a single random decision, and report honestly what
 * that does to the replay.
 *
 * Unlike the paired damage-roll edit in local-rng.mjs, these branches do not
 * cancel. A forced miss or crit changes the position permanently, which raises
 * the question this script exists to answer: the recorded input log only holds
 * choices that were legal in the ORIGINAL battle. Once the position diverges,
 * those choices may stop being legal, or the battle may simply outlive them.
 *
 * So each branch reports one of three verdicts:
 *
 *   CLEAN      the recorded choices stayed legal and the battle still finished
 *   TRUNCATED  the battle outlived the recorded choices and is left unfinished
 *   REJECTED   a recorded choice became illegal in the new position
 *
 * Usage:
 *   node scripts/local-branch.mjs                    run the built-in branches
 *   node scripts/local-branch.mjs --from <log.json>
 *   node scripts/local-branch.mjs --no-open
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { buildReplayHtml } from './lib/replay-html.mjs';
import { battleLines, firstDivergence } from './lib/protocol.mjs';
import { attachRngControl } from './lib/rng-control.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');

const ROOT = process.cwd();
const RUNTIME_LOGS = path.join(ROOT, 'runtime', 'logs');
const REPLAY_DIR = path.join(ROOT, 'replays');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

// The four kinds of draw, one branch each, on the recorded fixture battle.
const BRANCHES = [
  {
    label: 'meteor-mash-misses',
    title: 'Meteor Mash misses',
    plan: [{ kind: 'accuracy', move: 'meteormash', nth: 1, want: 'miss' }],
  },
  {
    label: 'no-attack-boost',
    title: 'Meteor Mash does not raise Attack',
    plan: [{ kind: 'secondary', move: 'meteormash', nth: 1, want: 'skip' }],
  },
  {
    label: 'no-burn',
    title: 'Matcha Gotcha never burns',
    plan: [
      { kind: 'secondary', move: 'matchagotcha', nth: 1, want: 'skip' },
      { kind: 'secondary', move: 'matchagotcha', nth: 2, want: 'skip' },
    ],
  },
  {
    label: 'crit-moonblast',
    title: 'The first Moonblast crits',
    plan: [{ kind: 'crit', move: 'moonblast', nth: 1, want: true }],
  },
];

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

async function replay(inputLog, plan = []) {
  const lines = inputLog.split('\n').filter(l => l.startsWith('>'));
  const startAt = lines.findIndex(l => l.startsWith('>start '));

  const stream = new BattleStream({ keepAlive: true });
  const chunks = [];
  const drain = (async () => { for await (const chunk of stream) chunks.push(chunk); })();

  await stream.write(lines.slice(0, startAt + 1).join('\n'));
  const battle = stream.battle;
  if (!battle) throw new Error('no battle after >start');

  const control = attachRngControl(battle, plan);

  await stream.write(lines.slice(startAt + 1).join('\n'));
  const result = {
    log: battle.getDebugLog(),
    ended: battle.ended,
    turns: battle.turn,
    winner: battle.winner ?? null,
    applied: control.applied,
    unmatched: control.unmatched(),
    // A choice the new position rejects shows up on the side channel, never in
    // the battle log itself.
    errors: chunks.join('\n').split('\n').filter(l => l.startsWith('|error|')),
    awaitingChoice: battle.sides.some(s => s.requestState),
  };
  await stream.writeEnd();
  await drain;
  return result;
}

function verdict(base, run) {
  if (run.errors.length) return 'REJECTED';
  if (!run.ended) return 'TRUNCATED';
  return 'CLEAN';
}

function summarise(log) {
  const lines = log.split('\n');
  return {
    faints: lines.filter(l => l.startsWith('|faint|')).map(l => l.split('|')[2]),
    crits: lines.filter(l => l.startsWith('|-crit|')).length,
    misses: lines.filter(l => l.startsWith('|-miss|')).length,
    statuses: lines.filter(l => l.startsWith('|-status|')).map(l => l.split('|').slice(2, 4).join(' ')),
    boosts: lines.filter(l => l.startsWith('|-boost|')).map(l => l.split('|').slice(2).join(' ')),
  };
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

  const base = await replay(inputLog);
  const baseLines = battleLines(base.log);
  const baseSummary = summarise(base.log);
  console.log(
    `\nBaseline: ${base.turns} turns, winner ${base.winner}, ` +
    `${baseSummary.faints.length} faints, ${baseSummary.crits} crit(s), ${baseSummary.misses} miss(es)`
  );
  if (base.applied.length) throw new Error('baseline substituted a draw - it should not have');
  if (base.errors.length) throw new Error('baseline had rejected choices - the fixture is not clean');

  const written = [];

  for (const branch of BRANCHES) {
    console.log(`\n================ ${branch.title} ================\n`);
    const run = await replay(inputLog, branch.plan);

    if (run.unmatched.length) {
      console.log(`  SKIPPED - the plan never matched a draw:`);
      for (const s of run.unmatched) {
        console.log(`    ${s.kind} ${s.move ?? '(any move)'} #${s.nth} -> ${s.want}`);
      }
      console.log(`  That draw does not happen in this battle - nothing to force.`);
      continue;
    }

    for (const a of run.applied) {
      console.log(`  forced: turn ${a.turn}  ${a.move} ${a.kind} #${a.nth} -> ${a.description}`);
    }

    const runLines = battleLines(run.log);
    const div = firstDivergence(baseLines, runLines);
    const summary = summarise(run.log);
    const v = verdict(base, run);

    console.log('');
    console.log(`  verdict           ${v}`);
    console.log(`  diverges at       battle line ${div ? div.index : '(never)'}`);
    if (div) {
      console.log(`    before          ${div.expected ?? '(end of log)'}`);
      console.log(`    after           ${div.actual ?? '(end of log)'}`);
    }
    console.log(`  lines after that  ${baseLines.length - (div?.index ?? baseLines.length)} -> ${runLines.length - (div?.index ?? runLines.length)}`);
    console.log(`  turns             ${base.turns} -> ${run.turns}`);
    console.log(`  battle finished   ${base.ended} -> ${run.ended}`);
    console.log(`  winner            ${base.winner} -> ${run.winner ?? '(none)'}`);
    console.log(`  faints            ${baseSummary.faints.length} -> ${summary.faints.length}   [${summary.faints.join(', ')}]`);
    console.log(`  crits             ${baseSummary.crits} -> ${summary.crits}`);
    console.log(`  misses            ${baseSummary.misses} -> ${summary.misses}`);
    console.log(`  statuses          [${baseSummary.statuses.join(', ')}] -> [${summary.statuses.join(', ')}]`);
    console.log(`  boosts            [${baseSummary.boosts.join(', ')}] -> [${summary.boosts.join(', ')}]`);

    if (v === 'TRUNCATED') {
      console.log(`\n  The battle outlived the recorded choices. ${run.awaitingChoice ? 'It is waiting for input that the input log does not contain.' : ''}`);
      console.log(`  The replay renders everything up to that point and then stops - it is a`);
      console.log(`  correct partial battle, not a corrupt one. Playing further needs new choices.`);
    }
    if (v === 'REJECTED') {
      console.log(`\n  A recorded choice is illegal in the new position:`);
      for (const e of new Set(run.errors)) console.log(`    ${e}`);
      console.log(`  The battle stops at that point. Playing further needs new choices.`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outFile = path.join(REPLAY_DIR, `branch-${branch.label}-${stamp}.html`);
    fs.writeFileSync(outFile, buildReplayHtml({
      title: `Branch: ${branch.title}`,
      formatid: 'branch',
      log: run.log,
      ...(opt('--embed') ? { embedBase: opt('--embed') } : {}),
    }), 'utf8');
    written.push({ branch, file: outFile, verdict: v });
    console.log(`\n  replay: ${path.relative(ROOT, outFile)}`);
  }

  console.log('\n================ SUMMARY ================\n');
  for (const w of written) {
    console.log(`  ${w.verdict.padEnd(10)} ${w.branch.title}`);
  }

  if (!flag('--no-open') && written.length) {
    spawn('cmd.exe', ['/c', 'start', '', written[0].file], { detached: true, stdio: 'ignore' }).unref();
    console.log(`\nOpening ${path.basename(written[0].file)} in your default browser.`);
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
