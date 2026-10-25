/**
 * Capability acceptance for an admitted format.
 *
 * The simulator remains the only source of stats, damage, and turn order.
 * This module checks Encoreable's admission contract around that simulator:
 * scripted fixtures, exact replay, turn boundaries, observations, validator
 * cases, RNG control, and the formats that must stay rejected.
 *
 * `npm run replay -- --check-formats` and `extension/check/formats.mjs` both
 * call this. A format joins the positive suite when it is added to
 * FORMAT_PROFILES; fixtures already live in scripts/fixtures/formats.js.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { makePolicy } from './ws-player.mjs';
import { inputLogLines, truncateAtTurn } from './truncate.mjs';
import { battleLines, firstDivergence } from './protocol.mjs';
import { buildControlled, replayControlled, traceOn } from './rng-control.mjs';
import { listLogFilesIn } from './recordings.mjs';
import {
  SIMULATOR_PIN, FORMAT_PROFILES, formatProfile, assertFormatCapability,
  profileFromInputLog, profileFromObservation,
} from './format-profile.mjs';

const require = createRequire(import.meta.url);
const { Battle, BattleStream, Teams, TeamValidator, Dex } = require('pokemon-showdown');
const { extractChannelMessages } = require('pokemon-showdown/dist/sim/battle.js');
const { FORMATS, PIN } = require('../fixtures/formats.js');
const { P1_EXPORT, P2_EXPORT } = require('../fixtures/teams.js');

export {
  SIMULATOR_PIN, FORMAT_PROFILES, formatProfile, assertFormatCapability,
  profileFromInputLog, profileFromObservation,
};

const toId = Dex.toID;
const policy = makePolicy([]);
const RESEED = 'sodium,0123456789abcdeffedcba9876543210';
const FORCE_SEED = 'sodium,fedcba98765432100123456789abcdef';
const BOUNDARIES = [1, 3, 5];
const CHOOSABLE_TARGETS = new Set(['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe']);
const ACCURACY_FIRST = ['willowisp', 'thunderwave', 'spore', 'toxic', 'hurricane', 'hydropump', 'fireblast', 'blizzard', 'focusblast', 'stoneedge', 'playrough', 'moonblast'];

const DIGLETT_100 = `
Diglett @ Focus Sash
Ability: Sand Veil
Level: 50
Tera Type: Ground
EVs: 240 HP / 4 Atk
Serious Nature
IVs: 0 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe
- Agility
- Astonish
- Protect
- Sandstorm
`.trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(actual, expected, what) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${what} mismatch\n left ${left.slice(0, 700)}\n right ${right.slice(0, 700)}`);
  }
}

function evTotal(set) {
  return Object.values(set.evs || {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

function phaseOf(request) {
  if (request?.teamPreview) return 'teampreview';
  if (request?.forceSwitch) return 'switch';
  if (request?.active) return 'move';
  return 'other';
}

function textOf(raw) {
  return Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
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

/** The same shape `truncateAtTurn` reports, so a fresh replay can be compared to it. */
function positionOf(battle) {
  return battle.sides.map(side => ({
    id: side.id,
    name: side.name,
    requestState: side.requestState,
    active: side.active.map(describe),
    bench: side.pokemon.filter(p => !p.isActive).map(describe),
  }));
}

function rich(battle) {
  return {
    turn: battle.turn,
    ended: !!battle.ended,
    gameType: battle.gameType,
    gen: battle.gen,
    weather: battle.field.weather || '',
    terrain: battle.field.terrain || '',
    sides: battle.sides.map(side => ({
      id: side.id,
      requestState: side.requestState,
      conditions: Object.keys(side.sideConditions || {}).sort(),
      pokemon: side.pokemon.map(p => ({
        name: p.name,
        level: p.level,
        hp: p.hp,
        maxhp: p.maxhp,
        status: p.status || '',
        fainted: !!p.fainted,
        tera: p.terastallized || '',
        boosts: { ...p.boosts },
      })),
    })),
  };
}

function requestDigest(request) {
  if (!request) return null;
  return {
    teamPreview: !!request.teamPreview,
    maxChosenTeamSize: request.maxChosenTeamSize ?? null,
    wait: !!request.wait,
    forceSwitch: request.forceSwitch || null,
    active: (request.active || []).map(slot => (slot ? {
      trapped: !!slot.trapped,
      moves: (slot.moves || []).map(move => ({ id: move.id, target: move.target, disabled: !!move.disabled })),
    } : null)),
    pokemon: (request.side?.pokemon || []).map(p => ({
      ident: p.ident,
      details: p.details,
      condition: p.condition,
      active: !!p.active,
    })),
  };
}

function capture(battle) {
  const debugLog = battle.getDebugLog();
  return {
    inputLog: battle.inputLog.join('\n'),
    debugLog,
    rawLog: battle.log.join('\n'),
    lines: battleLines(debugLog),
    rich: rich(battle),
    position: positionOf(battle),
    requests: battle.sides.map(side => requestDigest(side.activeRequest)),
    turn: battle.turn,
    ended: !!battle.ended,
    gen: battle.gen,
    mod: battle.format.mod,
    gameType: battle.gameType,
    formatid: battle.format.id,
    snapshot: JSON.parse(JSON.stringify(battle.toJSON())),
  };
}

async function withStream(run) {
  const stream = new BattleStream({ keepAlive: true, noCatch: true });
  const drain = (async () => { for await (const chunk of stream) void chunk; })();
  try {
    return await run(stream);
  } finally {
    try { await stream.writeEnd(); } catch { /* the battle already stopped */ }
    await drain.catch(() => {});
  }
}

/** Replay an input log on a fresh stream. Byte-level input and normalized battle lines. */
export async function replayInputLog(inputLog) {
  return withStream(async (stream) => {
    const lines = inputLogLines(inputLog);
    assert(lines.length, 'input log is empty');
    for (const line of lines) await stream.write(line);
    assert(stream.battle, 're-simulation produced no battle');
    return capture(stream.battle);
  });
}

function assertReplay(played, label) {
  return replayInputLog(played.inputLog).then((again) => {
    assert(again.inputLog.trim() === played.inputLog.trim(), `${label} input log did not round-trip`);
    const diff = firstDivergence(played.lines, again.lines);
    if (diff) {
      throw new Error(`${label} battle lines diverged at ${diff.index}\n ${diff.expected}\n ${diff.actual}`);
    }
    sameJson(again.rich, played.rich, `${label} state`);
    return again;
  });
}

function snapshotEquals(played, label) {
  const restored = Battle.fromJSON(played.snapshot);
  try {
    sameJson(positionOf(restored), played.position, `${label} Battle.fromJSON position`);
    sameJson(rich(restored), played.rich, `${label} Battle.fromJSON state`);
    sameJson(
      restored.sides.map(side => requestDigest(side.activeRequest)),
      played.requests,
      `${label} Battle.fromJSON requests`,
    );
  } finally {
    restored.destroy();
  }
}

/**
 * Pair each `|split|` the way `extractChannelMessages` does.
 * The secret line is exact HP. The shared line is the opponent's protocol.
 * A denominator of 100 on the secret line is exact when max HP is 100.
 */
function splitFacts(raw) {
  const facts = [];
  const re = /^\|split\|p([1234])\n(.*)\n(.*)|.+/gm;
  for (const match of textOf(raw).matchAll(re)) {
    if (!match[1]) continue;
    const secret = match[2];
    const shared = match[3];
    const hp = /\|(\d+)\/(\d+)/.exec(secret);
    if (!hp) continue;
    facts.push({
      player: Number(match[1]),
      secret,
      shared,
      den: Number(hp[2]),
    });
  }
  return facts;
}

function assertObservations(raw, label) {
  const channels = extractChannelMessages(textOf(raw), [-1, 1, 2]);
  const facts = splitFacts(raw);
  assert(facts.length, `${label} produced no per-player HP lines`);
  for (const fact of facts) {
    const other = fact.player === 1 ? 2 : 1;
    assert(channels[-1].includes(fact.secret), `${label} omniscient channel lost exact HP`);
    assert(channels[fact.player].includes(fact.secret), `${label} player ${fact.player} was not shown exact HP`);
    assert(channels[other].includes(fact.shared), `${label} opponent was not shown the public protocol line`);
    if (fact.secret !== fact.shared) {
      assert(
        channels[fact.player].includes(fact.secret),
        `${label} owner channel replaced exact HP with the public line`,
      );
    }
  }
  return facts;
}

function expectThrow(fn, pattern) {
  try {
    fn();
  } catch (err) {
    assert(pattern.test(String(err.message)), `expected ${pattern}, got ${err.message.split('\n')[0]}`);
    return;
  }
  throw new Error(`expected a throw matching ${pattern}`);
}

function admittedById(formatid) {
  try { return formatProfile(formatid); } catch { return null; }
}

function standardProfiles(formatid) {
  return FORMAT_PROFILES.filter(profile => (
    profile.statModel === 'standard-ev-iv' && (!formatid || profile.formatid === formatid)
  ));
}

function ctxFor(battle, side) {
  const foeId = side.id === 'p1' ? 'p2' : 'p1';
  const alive = (id) => {
    const found = battle.sides.find(s => s.id === id);
    return [0, 1].map(i => !!(found.active[i] && !found.active[i].fainted));
  };
  return {
    mySide: side.id,
    foeSide: foeId,
    foeAlive: alive(foeId),
    allyAlive: alive(side.id),
    activeCount: side.activeRequest?.active?.length || side.activeRequest?.forceSwitch?.length || 1,
  };
}

function assertDoublesTargets(choice, request) {
  if (!request?.active) return;
  const parts = String(choice).split(',').map(part => part.trim());
  request.active.forEach((slot, index) => {
    const part = parts[index] || '';
    const picked = /^move (\d+)/.exec(part);
    if (!picked || !slot?.moves) return;
    const move = slot.moves[Number(picked[1]) - 1];
    if (move && CHOOSABLE_TARGETS.has(move.target)) {
      assert(/[+-]\d+/.test(part), `doubles continuation omitted a target for ${move.id} (${move.target}): ${part}`);
    }
  });
}

function assertPlanRequest(fixture, side, step) {
  const request = side.activeRequest;
  if (step.phase === 'teampreview') {
    const teamSize = request.side.pokemon.length;
    const picked = step[side.id].split(',').map(part => part.trim()).filter(Boolean);
    if (fixture.gameType === 'doubles') {
      assert(request.maxChosenTeamSize === 4, `${fixture.id} preview maxChosenTeamSize is ${request.maxChosenTeamSize}`);
      assert(teamSize === 6, `${fixture.id} preview team has ${teamSize} Pokemon`);
      assert(picked.length === 4, `${fixture.id} preview brought ${picked.length}, expected 4 of 6`);
    } else {
      assert(request.maxChosenTeamSize == null || request.maxChosenTeamSize === teamSize, `${fixture.id} singles preview cap is ${request.maxChosenTeamSize}`);
      assert(picked.length === teamSize, `${fixture.id} singles preview brought ${picked.length} of ${teamSize}`);
    }
  } else if (step.phase === 'move') {
    const expected = fixture.gameType === 'doubles' ? 2 : 1;
    assert(request.active?.length === expected, `${fixture.id} move request has ${request.active?.length} active, expected ${expected}`);
  } else if (step.phase === 'switch' && fixture.gameType === 'doubles') {
    assert(request.forceSwitch?.length === 2, `${fixture.id} switch request is not a doubles pair`);
    assert(String(step[side.id]).includes('pass'), `${fixture.id} doubles replacement did not pass the slot that stays`);
  }
}

async function playLines(start, players, choose) {
  return withStream(async (stream) => {
    await stream.write(`>start ${JSON.stringify({ ...start, strictChoices: true })}`);
    for (const player of players) {
      await stream.write(`>player ${player.slot} ${JSON.stringify({ name: player.name, team: player.team })}`);
    }
    const battle = stream.battle;
    assert(battle, 'the battle did not start');
    const rounds = [];
    let guard = 0;
    while (!battle.ended && guard++ < 16) {
      const owing = battle.sides.filter(side => side.activeRequest && !side.activeRequest.wait && !side.isChoiceDone());
      if (!owing.length) break;
      const choices = choose(battle, owing);
      if (!choices) break;
      const round = {};
      for (const side of owing) {
        const choice = choices[side.id];
        if (!choice) continue;
        if (battle.gameType === 'doubles' && phaseOf(side.activeRequest) === 'move') {
          assertDoublesTargets(choice, side.activeRequest);
        }
        round[side.id] = choice;
      }
      assert(Object.keys(round).length, 'continuation produced no choice');
      rounds.push(round);
      for (const side of ['p1', 'p2']) {
        if (round[side]) await stream.write(`>${side} ${round[side]}`);
      }
    }
    return { ...capture(battle), rounds };
  });
}

async function playFixture(fixture) {
  const sets = [Teams.import(fixture.p1), Teams.import(fixture.p2)];
  const packed = sets.map(team => Teams.pack(team));
  const queues = {
    p1: fixture.plan.filter(step => step.p1),
    p2: fixture.plan.filter(step => step.p2),
  };
  const played = await playLines(
    { formatid: fixture.id, seed: fixture.seed },
    [{ slot: 'p1', name: 'Red', team: packed[0] }, { slot: 'p2', name: 'Blue', team: packed[1] }],
    (battle, owing) => {
      const choices = {};
      let any = false;
      for (const side of owing) {
        const step = queues[side.id][0];
        if (!step) continue;
        const phase = phaseOf(side.activeRequest);
        assert(step.phase === phase, `${fixture.id} ${side.id}: fixture expected ${step.phase}, battle asked for ${phase}`);
        assertPlanRequest(fixture, side, step);
        queues[side.id].shift();
        choices[side.id] = step[side.id];
        any = true;
      }
      return any ? choices : null;
    },
  );
  assert(queues.p1.length === 0 && queues.p2.length === 0, `${fixture.id} did not play every fixture choice`);
  assert(played.turn >= 5 && !played.ended, `${fixture.id} ended at turn ${played.turn}; boundaries 1, 3 and 5 were not all reachable`);
  assert(played.formatid === fixture.id, `${fixture.id} battle format is ${played.formatid}`);
  assert(played.gameType === fixture.gameType, `${fixture.id} game type is ${played.gameType}`);
  await assertReplay(played, fixture.id);
  return { ...played, sets, packed };
}

function mustInclude(lines, pattern, what) {
  assert(lines.some(line => pattern.test(line)), what);
}

async function boundaries(played, fixture) {
  let namedTarget = false;
  const branches = [];
  for (const turn of BOUNDARIES) {
    const cut = await truncateAtTurn(played.inputLog, turn, { reseed: RESEED });
    assert(!cut.ended && cut.awaitingChoice && cut.turn === turn && !cut.errors.length, `${fixture.id} turn ${turn} did not restore a choice point (${cut.turn}, ended ${cut.ended})`);
    const prefix = cut.inputLog.split('\n').filter(line => line && !line.startsWith('>reseed ')).join('\n');
    const fresh = await replayInputLog(prefix);
    const reseeded = await replayInputLog(cut.inputLog);
    sameJson(fresh.position, cut.position, `${fixture.id} turn ${turn} position`);
    sameJson(reseeded.position, fresh.position, `${fixture.id} turn ${turn} reseeded position`);
    sameJson(reseeded.rich, fresh.rich, `${fixture.id} turn ${turn} reseeded state`);
    sameJson(reseeded.requests, fresh.requests, `${fixture.id} turn ${turn} requests`);
    const lineDiff = firstDivergence(fresh.lines, reseeded.lines);
    if (lineDiff) throw new Error(`${fixture.id} turn ${turn} reseed changed the recorded position at line ${lineDiff.index}`);
    snapshotEquals(fresh, `${fixture.id} turn ${turn}`);

    const continued = await continueFrom(cut.inputLog, fixture);
    if (continued.targeted) namedTarget = true;
    const again = await replayInputLog(continued.inputLog);
    assert(again.inputLog.trim() === continued.inputLog.trim(), `${fixture.id} turn ${turn} continuation did not self-replay`);
    const diff = firstDivergence(continued.lines, again.lines);
    if (diff) throw new Error(`${fixture.id} turn ${turn} continuation diverged at ${diff.index}\n ${diff.expected}\n ${diff.actual}`);
    sameJson(again.rich, continued.rich, `${fixture.id} turn ${turn} continuation`);
    assert(continued.inputLog.includes(`>reseed ${RESEED}`), `${fixture.id} turn ${turn} continuation lost the reseed`);
    branches.push({
      turn,
      seed: RESEED,
      inputLog: cut.inputLog.trim(),
      lines: reseeded.lines,
      rounds: continued.rounds,
      continuedInput: continued.inputLog.trim(),
      continuedLines: continued.lines,
    });
  }
  if (fixture.gameType === 'doubles') {
    assert(namedTarget, `${fixture.id} continuations never named an explicit doubles target`);
  }
  return branches;
}

async function continueFrom(inputLog, fixture) {
  let moved = false;
  const played = await withStream(async (stream) => {
    for (const line of inputLogLines(inputLog)) await stream.write(line);
    const battle = stream.battle;
    const rounds = [];
    let guard = 0;
    while (!battle.ended && guard++ < 8) {
      const owing = battle.sides.filter(side => side.activeRequest && !side.activeRequest.wait && !side.isChoiceDone());
      if (!owing.length) break;
      const switching = owing.some(side => phaseOf(side.activeRequest) === 'switch');
      if (moved && !switching) break;
      const round = {};
      for (const side of owing) {
        const choice = policy(side.activeRequest, ctxFor(battle, side));
        assert(choice, `${fixture.id} has no legal continuation for ${side.id}`);
        if (battle.gameType === 'doubles' && phaseOf(side.activeRequest) === 'move') {
          assertDoublesTargets(choice, side.activeRequest);
        }
        round[side.id] = choice;
      }
      rounds.push(round);
      for (const side of ['p1', 'p2']) {
        if (round[side]) await stream.write(`>${side} ${round[side]}`);
      }
      if (!switching) moved = true;
    }
    assert(rounds.length, `${fixture.id} continuation made no choice`);
    return { ...capture(battle), rounds };
  });
  return {
    ...played,
    targeted: played.rounds.some(round => Object.values(round).some(choice => /[+-]\d+/.test(choice))),
  };
}

async function rngSmoke(played, fixture) {
  const traced = await withStream(async (stream) => {
    const lines = inputLogLines(played.inputLog);
    await stream.write(lines[0]);
    const trace = traceOn(stream.battle);
    for (const line of lines.slice(1)) await stream.write(line);
    return trace.map(row => ({ ...row }));
  });
  assert(traced.length, `${fixture.id} trace contains no draws`);
  const used = new Set([...played.inputLog.matchAll(/\bmove ([a-z0-9]+)/g)].map(match => match[1]));
  const mons = played.sets.flat().map(set => ({
    id: toId(set.species || set.name),
    moves: (set.moves || []).map(move => toId(move)),
  }));
  const moves = [...used].sort((a, b) => {
    const ai = ACCURACY_FIRST.indexOf(a);
    const bi = ACCURACY_FIRST.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const specs = [];
  for (const move of moves) {
    for (const mon of mons) {
      if (!mon.moves.includes(move)) continue;
      specs.push(`miss ${mon.id} ${move}`);
      specs.push(`mindmg ${mon.id} ${move}`);
    }
  }
  assert(specs.length, `${fixture.id} input log has no move a controller rule can name`);
  let matched = null;
  for (const spec of specs.slice(0, 8)) {
    const built = await buildControlled(played.inputLog, 1, [spec], { seed: FORCE_SEED });
    const baseline = await replayControlled(built.baseline);
    const forced = await replayControlled(built.controlled);
    const forcedAgain = await replayControlled(built.controlled);
    if (!forced.rng || forced.rng.forced < 1) continue;
    assert(forced.inputLog === forcedAgain.inputLog, `${fixture.id} forced log did not self-replay`);
    const diff = firstDivergence(battleLines(forced.debugLog), battleLines(forcedAgain.debugLog));
    if (diff) throw new Error(`${fixture.id} forced battle lines diverged at ${diff.index}`);
    const strip = (log) => textOf(log).split('\n').filter(line => line && !line.startsWith('>rng ') && !line.startsWith('>reseed ')).join('\n');
    assert(strip(built.baseline) === strip(built.controlled), `${fixture.id} reseed prefix changed under ${spec}`);
    assert(built.baseline.includes(`>reseed ${built.seed}`) && built.controlled.includes(`>reseed ${built.seed}`), `${fixture.id} controlled pair does not share a reseed`);
    const changed = firstDivergence(battleLines(baseline.debugLog), battleLines(forced.debugLog));
    if (!changed) continue;
    matched = spec;
    break;
  }
  assert(matched, `${fixture.id} trace had ${traced.length} draws but no upstream force changed the battle`);
  return matched;
}

function workerCase(fixture, played, branches) {
  return {
    formatid: fixture.id,
    inputLog: played.inputLog.trim(),
    lines: played.lines,
    branches,
  };
}

async function scripted(fixture, profile) {
  const played = await playFixture(fixture);
  if (profile) {
    assertFormatCapability(profile.formatid, 'exactReplay', {
      gen: played.gen, mod: played.mod, gameType: played.gameType,
    });
    assert(profileFromInputLog(played.inputLog, 'exactReplay').formatid === fixture.id, `${fixture.id} input log was not admitted`);
    for (const capability of ['recording', 'exactReplay', 'branching', 'rngControl']) {
      assert(profile.capabilities[capability], `${fixture.id} is missing ${capability}`);
    }
    for (const capability of ['knownTeamReconstruction', 'openSpreadInference', 'closedInference']) {
      assert(!profile.capabilities[capability], `${fixture.id} claims ${capability}; known-team replay does not admit inference`);
    }
  }
  const facts = assertObservations(played.rawLog, fixture.id);
  assert(facts.some(fact => fact.den !== 100), `${fixture.id} never showed an exact HP denominator other than 100`);
  assert(
    facts.some(fact => fact.den !== 100 && /\/100(?:\||$)/.test(fact.shared)),
    `${fixture.id} opponent channel did not use the public HP protocol`,
  );
  if (fixture.id === 'gen9vgc2024regg') {
    mustInclude(played.lines, /\|-terastallize\|/, 'VGC log has no Terastallization');
    mustInclude(played.lines, /\|-status\|[^|]+\|brn/, 'VGC log has no burn');
    mustInclude(played.lines, /\|-sidestart\|.*Stealth Rock/, 'VGC log has no Stealth Rock');
  }
  if (fixture.id === 'gen9ou') {
    mustInclude(played.lines, /\|-terastallize\|/, 'OU log has no Terastallization');
    mustInclude(played.lines, /\|-status\|[^|]+\|brn/, 'OU log has no burn');
    mustInclude(played.lines, /\|-status\|[^|]+\|tox/, 'OU log has no poison');
    mustInclude(played.lines, /\|-sidestart\|.*Stealth Rock/, 'OU log has no Stealth Rock');
    mustInclude(played.lines, /\|-sidestart\|.*Spikes/, 'OU log has no Spikes');
  }
  const protocol = extractChannelMessages(played.rawLog, [-1])[-1];
  if (profile) profileFromObservation(fixture.id, protocol, 'exactReplay');
  const branches = await boundaries(played, fixture);
  const forced = await rngSmoke(played, fixture);
  return { worker: workerCase(fixture, played, branches), forced, protocol, packed: played.packed };
}

function problems(formatid, sets) {
  return new TeamValidator(formatid).validateTeam(structuredClone(sets)) || [];
}

function validatorChecks() {
  const vgc = Teams.import(FORMATS.gen9vgc2024regg.p1);
  assert(!problems('gen9vgc2024regg', vgc).length, `VGC fixture rejected: ${problems('gen9vgc2024regg', vgc)[0]}`);
  assert(vgc.some(set => { const total = evTotal(set); return total > 0 && total < 510; }), 'VGC fixture does not underspend');
  const underspent = structuredClone(vgc);
  underspent[0].evs = { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  assert(!problems('gen9vgc2024regg', underspent).length, `underspent standard team rejected: ${problems('gen9vgc2024regg', underspent)[0]}`);
  const over32 = structuredClone(vgc);
  over32[0].evs = { ...over32[0].evs, hp: 36 };
  assert(evTotal(over32[0]) <= 510, 'EV 36 sample exceeds 510');
  assert(!problems('gen9vgc2024regg', over32).length, `standard EV 36 rejected: ${problems('gen9vgc2024regg', over32)[0]}`);
  const ev255 = structuredClone(vgc);
  ev255[0].evs = { ...ev255[0].evs, hp: 255 };
  assert(!problems('gen9vgc2024regg', ev255).length, `standard EV 255 rejected: ${problems('gen9vgc2024regg', ev255)[0]}`);
  const ev256 = structuredClone(vgc);
  ev256[0].evs = { ...ev256[0].evs, hp: 256 };
  assert(problems('gen9vgc2024regg', ev256).some(problem => /255 EVs/.test(problem)), 'standard EV 256 was not rejected at the pinned 255 ceiling');
  const non31 = structuredClone(vgc);
  non31[0].ivs = { hp: 0, atk: 15, def: 31, spa: 0, spd: 30, spe: 1 };
  assert(!problems('gen9vgc2024regg', non31).length, `standard non-31 IVs rejected: ${problems('gen9vgc2024regg', non31)[0]}`);

  const champions = Teams.import(P1_EXPORT);
  assert(!problems('gen9championsvgc2026regmc', champions).length, `Champions fixture rejected: ${problems('gen9championsvgc2026regmc', champions)[0]}`);
  const zero = structuredClone(champions);
  for (const set of zero) set.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  assert(!problems('gen9championsvgc2026regmc', zero).length, `Champions 0 SP rejected: ${problems('gen9championsvgc2026regmc', zero)[0]}`);
  for (const iv of [0, 32]) {
    const invalid = structuredClone(champions);
    invalid[0].ivs = { hp: iv, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    assert(problems('gen9championsvgc2026regmc', invalid).length, `Champions IV ${iv} was accepted`);
  }
  const sp33 = structuredClone(champions);
  sp33[0].evs = { hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  assert(problems('gen9championsvgc2026regmc', sp33).some(problem => /32 Stat Points/.test(problem)), 'Champions SP 33 was not rejected');
}

function contractChecks() {
  assert(PIN === SIMULATOR_PIN, `fixture pin ${PIN} is not ${SIMULATOR_PIN}`);
  assert(Dex.formats.get('gen9vgc2024regg').exists, 'pinned dex has no gen9vgc2024regg');
  const vgc = formatProfile('gen9vgc2024regg');
  assert(vgc.statModel === 'standard-ev-iv' && vgc.gameType === 'doubles' && vgc.mod === 'gen9', 'VGC profile is not the admitted standard doubles contract');
  for (const capability of ['recording', 'exactReplay', 'branching', 'rngControl']) {
    assertFormatCapability('gen9vgc2024regg', capability);
  }
  profileFromInputLog('>start { "formatid" : "gen9vgc2024regg" }\n', 'exactReplay');
  profileFromObservation('gen9vgc2024regg', ['|gen|9', '|gametype|doubles', '|tier|[Gen 9] VGC 2024 Reg G'], 'exactReplay');
  profileFromObservation('gen9championsvgc2026regmcbo3', [
    '|gen|9', '|gametype|doubles', '|tier|[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)',
  ], 'exactReplay');
  for (const capability of ['knownTeamReconstruction', 'openSpreadInference', 'closedInference']) {
    assertFormatCapability('gen9championsvgc2026regmc', capability);
  }

  const rejected = [
    ['gen8 format', () => formatProfile('gen8ou'), /Unsupported format/],
    ['gen8 vgc', () => formatProfile('gen8vgc2022'), /Unsupported format/],
    ['custom rules', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg","customRules":["HP Percentage Mod"]}\n'), /overrides/],
    ['format override', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg","format":"gen9ou"}\n'), /overrides/],
    ['gameType override', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg","gameType":"singles"}\n'), /overrides/],
    ['gen override', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg","gen":8}\n'), /overrides/],
    ['mod override', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg","mod":"gen8"}\n'), /overrides/],
    ['rule table override', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg","ruleTable":{}}\n'), /overrides/],
    ['vgc reconstruction', () => assertFormatCapability('gen9vgc2024regg', 'knownTeamReconstruction'), /Unsupported capability knownTeamReconstruction/],
    ['vgc open inference', () => assertFormatCapability('gen9vgc2024regg', 'openSpreadInference'), /Unsupported capability openSpreadInference/],
    ['vgc closed inference', () => assertFormatCapability('gen9vgc2024regg', 'closedInference'), /Unsupported capability closedInference/],
    ['observation reconstruction', () => profileFromObservation('gen9vgc2024regg', ['|gen|9'], 'knownTeamReconstruction'), /Unsupported capability/],
    ['gen disagree', () => assertFormatCapability('gen9vgc2024regg', 'exactReplay', { gen: 8 }), /gen 8 disagrees/],
    ['mod disagree', () => assertFormatCapability('gen9vgc2024regg', 'exactReplay', { mod: 'champions' }), /mod champions disagrees/],
    ['gameType disagree', () => assertFormatCapability('gen9vgc2024regg', 'exactReplay', { gameType: 'singles' }), /gameType singles disagrees/],
    ['statModel disagree', () => assertFormatCapability('gen9vgc2024regg', 'exactReplay', { statModel: 'champions-sp' }), /statModel champions-sp disagrees/],
    ['observation gen', () => profileFromObservation('gen9vgc2024regg', ['|gen|8', '|gametype|doubles', '|tier|[Gen 9] VGC 2024 Reg G'], 'exactReplay'), /generation 8 disagrees/],
    ['observation game type', () => profileFromObservation('gen9vgc2024regg', ['|gametype|singles'], 'exactReplay'), /game type singles disagrees/],
    ['observation tier', () => profileFromObservation('gen9vgc2024regg', ['|tier|[Gen 9] OU'], 'exactReplay'), /tier \[Gen 9\] OU disagrees/],
    ['two starts', () => profileFromInputLog('>start {"formatid":"gen9vgc2024regg"}\n>start {"formatid":"gen9vgc2024regg"}\n'), /exactly one/],
  ];
  for (const [name, fn, pattern] of rejected) {
    try { expectThrow(fn, pattern); }
    catch (err) { throw new Error(`${name}: ${err.message}`); }
  }
}

async function randomKnown(fixture, profile) {
  const seeds = [fixture.seed, `${fixture.seed.slice(0, -1)}1`];
  const generated = seeds.map(seed => Teams.generate(fixture.id, { seed }));
  assert(JSON.stringify(generated[0]) === JSON.stringify(Teams.generate(fixture.id, { seed: seeds[0] })), 'Teams.generate was not deterministic for the fixture seed');
  const levels = generated.flat().map(set => set.level);
  const ivs = generated.flat().flatMap(set => Object.values(set.ivs || {}));
  assert(levels.some(level => level && level !== 100), `random levels were flattened: ${levels.join(',')}`);
  assert(ivs.some(iv => iv !== 31), 'random IVs were all 31');
  const packed = generated.map(team => Teams.pack(team));
  let movesDone = 0;
  const played = await playLines(
    { formatid: fixture.id, seed: fixture.seed },
    [{ slot: 'p1', name: 'Red', team: packed[0] }, { slot: 'p2', name: 'Blue', team: packed[1] }],
    (battle, owing) => {
      if (movesDone >= 2 && owing.every(side => phaseOf(side.activeRequest) === 'move')) return null;
      const choices = {};
      for (const side of owing) {
        choices[side.id] = policy(side.activeRequest, ctxFor(battle, side));
        assert(choices[side.id], `random battle has no legal choice for ${side.id}`);
      }
      if (owing.some(side => phaseOf(side.activeRequest) === 'move')) movesDone += 1;
      return choices;
    },
  );
  assert(movesDone >= 1, 'random known-team battle made no move');
  for (const [index, line] of played.inputLog.split('\n').filter(line => line.startsWith('>player ')).entries()) {
    const options = JSON.parse(line.slice(line.indexOf('{')));
    assert(options.team === packed[index], 'player line is not the packed generated team');
    assert(!options.seed, 'packed random player line also carries a team seed');
  }
  const battleSets = [0, 1].map(index => played.rich.sides[index].pokemon.map(p => p.level));
  generated.forEach((team, index) => {
    assert(team.every((set, mon) => set.level === battleSets[index][mon]), `random levels were not kept: ${team.map(set => set.level)} vs ${battleSets[index]}`);
  });
  await assertReplay(played, fixture.id);
  if (profile) {
    for (const capability of ['knownTeamReconstruction', 'openSpreadInference', 'closedInference']) {
      assert(!profile.capabilities[capability], `${fixture.id} claims ${capability}; packed teams are not hidden-set reconstruction`);
    }
    assert(profile.inferenceStatus === 'unsupported', `${fixture.id} inference status is ${profile.inferenceStatus}`);
  }
  return workerCase(fixture, played, []);
}

async function championsRegression() {
  const packed = [Teams.pack(Teams.import(P1_EXPORT)), Teams.pack(Teams.import(P2_EXPORT))];
  let moved = false;
  const played = await playLines(
    { formatid: 'gen9championsvgc2026regmc', seed: 'sodium,cccccccccccccccccccccccccccccccc' },
    [{ slot: 'p1', name: 'Red', team: packed[0] }, { slot: 'p2', name: 'Blue', team: packed[1] }],
    (battle, owing) => {
      if (moved && owing.every(side => phaseOf(side.activeRequest) !== 'switch')) return null;
      const choices = {};
      for (const side of owing) {
        const phase = phaseOf(side.activeRequest);
        if (phase === 'teampreview') {
          assert(side.activeRequest.maxChosenTeamSize === 4, 'Champions preview does not bring 4');
          assert(side.activeRequest.side.pokemon.length === 6, 'Champions team is not six');
          choices[side.id] = 'team 1, 2, 3, 4';
        } else {
          choices[side.id] = policy(side.activeRequest, ctxFor(battle, side));
          assert(choices[side.id], `Champions has no legal choice for ${side.id}`);
          if (phase === 'move') assertDoublesTargets(choices[side.id], side.activeRequest);
        }
      }
      if (owing.some(side => phaseOf(side.activeRequest) === 'move')) moved = true;
      return choices;
    },
  );
  assertFormatCapability('gen9championsvgc2026regmc', 'exactReplay', {
    gen: played.gen, mod: played.mod, gameType: played.gameType,
  });
  await assertReplay(played, 'champions');
  assertObservations(played.rawLog, 'champions');
  return {
    inputLog: played.inputLog.trim(),
    protocol: extractChannelMessages(played.rawLog, [-1])[-1],
    packed,
  };
}

async function hpDenominator100() {
  const vgc = FORMATS.gen9vgc2024regg;
  const team = [Teams.import(DIGLETT_100)[0], ...Teams.import(vgc.p1).slice(0, 5)];
  const rejected = problems('gen9vgc2024regg', team);
  assert(!rejected.length, `max HP 100 team rejected: ${rejected[0]}`);
  const played = await playLines(
    { formatid: 'gen9vgc2024regg', seed: vgc.seed },
    [
      { slot: 'p1', name: 'Red', team: Teams.pack(team) },
      { slot: 'p2', name: 'Blue', team: Teams.pack(Teams.import(vgc.p2)) },
    ],
    (battle, owing) => {
      if (battle.turn > 0) return null;
      const choices = {};
      for (const side of owing) {
        assert(phaseOf(side.activeRequest) === 'teampreview', 'HP 100 battle did not open at team preview');
        choices[side.id] = 'team 1, 2, 3, 4';
      }
      return choices;
    },
  );
  const diglett = played.rich.sides[0].pokemon.find(p => p.name === 'Diglett');
  assert(diglett && diglett.maxhp === 100 && diglett.hp === 100, `Diglett max HP is ${diglett && diglett.maxhp}, not 100`);
  const facts = assertObservations(played.rawLog, 'max HP 100');
  const own = facts.filter(fact => fact.player === 1 && fact.secret.includes('Diglett'));
  assert(own.some(fact => fact.den === 100), 'exact 100/100 HP was not on the owner channel');
  assert(facts.some(fact => fact.den !== 100), 'HP 100 battle had no other exact denominator to compare');
}

async function preservedLogs(root, formatid) {
  const files = listLogFilesIn(path.join(root, 'recordings', 'local'));
  const kept = [];
  for (const file of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const inputLog = textOf(data.inputLog);
    let profile;
    try { profile = profileFromInputLog(inputLog, 'exactReplay'); } catch { continue; }
    if (profile.statModel !== 'standard-ev-iv') continue;
    if (formatid && profile.formatid !== formatid) continue;
    const played = await replayInputLog(inputLog);
    assert(played.inputLog.trim() === inputLog.trim(), `${path.basename(file)} input log did not round-trip`);
    assertFormatCapability(profile.formatid, 'exactReplay', { gen: played.gen, mod: played.mod, gameType: played.gameType });
    if (data.log) {
      const diff = firstDivergence(battleLines(data.log), played.lines);
      if (diff) {
        throw new Error(`${path.basename(file)} server log diverged at ${diff.index}\n server ${diff.expected}\n resim ${diff.actual}`);
      }
    }
    const cut = await truncateAtTurn(played.inputLog, 1, { reseed: RESEED });
    assert(!cut.ended && cut.awaitingChoice && !cut.errors.length, `${path.basename(file)} cannot branch at turn 1`);
    const continued = await continueFrom(cut.inputLog, { id: profile.formatid, gameType: profile.gameType });
    const again = await replayInputLog(continued.inputLog);
    const continuedDiff = firstDivergence(continued.lines, again.lines);
    if (continuedDiff) {
      throw new Error(`${path.basename(file)} branch diverged at ${continuedDiff.index}`);
    }
    kept.push({
      file: path.relative(root, file),
      inputLog: played.inputLog.trim(),
      lines: played.lines,
      branch: {
        turn: 1,
        seed: RESEED,
        inputLog: cut.inputLog.trim(),
        lines: (await replayInputLog(cut.inputLog)).lines,
        rounds: continued.rounds,
        continuedInput: continued.inputLog.trim(),
        continuedLines: continued.lines,
      },
    });
  }
  return kept;
}

async function execute({ root, formatid = null, say }) {
  const failures = [];
  const cases = [];
  let champions = null;
  let preserved = [];
  let rejection = null;
  const section = async (name, fn) => {
    try {
      const value = await fn();
      say(`  [PASS] ${name}`);
      return value;
    } catch (err) {
      failures.push({ name, message: err.message });
      say(`  [FAIL] ${name}`);
      for (const line of String(err.message).split('\n').slice(0, 6)) say(`         ${line}`);
      return null;
    }
  };

  await section('format contract', () => { contractChecks(); validatorChecks(); });

  for (const profile of standardProfiles(formatid)) {
    const fixture = FORMATS[profile.formatid];
    const result = await section(profile.formatid, async () => {
      assert(fixture, `${profile.formatid} is admitted but has no formats.js fixture`);
      if (fixture.plan) return scripted(fixture, profile);
      if (fixture.team === 'random' || fixture.generator) return { worker: await randomKnown(fixture, profile) };
      throw new Error(`${profile.formatid} has neither a scripted plan nor a generator`);
    });
    if (result?.worker) cases.push(result.worker);
    if (result?.protocol && profile.formatid === 'gen9vgc2024regg') {
      rejection = { protocol: result.protocol, packed: result.packed };
    }
  }

  if ((!formatid || formatid === 'gen9ou') && !admittedById('gen9ou')) {
    const result = await section('gen9ou fixture (admission pending)', () => scripted(FORMATS.gen9ou, null));
    if (result?.worker) cases.push({ ...result.worker, pendingAdmission: true });
  }
  if ((!formatid || formatid === 'gen9randombattle') && !admittedById('gen9randombattle')) {
    await section('gen9randombattle packed teams (admission pending)', () => randomKnown(FORMATS.gen9randombattle, null));
  }
  if (!formatid || formatid.startsWith('gen9champions')) {
    champions = await section('champions regression', () => championsRegression());
  }
  if (!formatid || formatid === 'gen9vgc2024regg') {
    await section('exact HP denominator 100', () => hpDenominator100());
  }
  const found = await section('preserved standard logs', () => preservedLogs(root, formatid));
  if (found) {
    preserved = found;
    say(`  preserved standard logs: ${preserved.length}`);
  }

  say(`  ${failures.length ? `${failures.length} failed` : 'all node checks passed'}`);
  return {
    ok: failures.length === 0,
    failures,
    cases: cases.filter(item => !item.pendingAdmission),
    champions,
    preserved,
    rejection,
  };
}

/**
 * @param {object} options
 * @param {string} [options.root]
 * @param {string} [options.formatid] one format id, or every admitted standard format
 * @param {(line: string) => void} [options.say]
 * @returns {Promise<boolean>}
 */
export async function run({ root = process.cwd(), formatid = null, say = console.log } = {}) {
  const started = Date.now();
  say('Format regression');
  const report = await execute({ root, formatid, say });
  say(`  ${(Date.now() - started) / 1000}s`);
  return report.ok;
}

export const runFormatChecks = run;

/** Node references the extension Worker is compared against. Throws if the node suite failed. */
export async function workerCases({ root = process.cwd(), formatid = null, say = () => {} } = {}) {
  const report = await execute({ root, formatid, say });
  if (!report.ok) {
    throw new Error(report.failures.map(failure => `${failure.name}: ${failure.message.split('\n')[0]}`).join('\n'));
  }
  return {
    cases: report.cases,
    champions: report.champions,
    preserved: report.preserved,
    rejection: report.rejection,
  };
}
