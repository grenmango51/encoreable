/**
 * The simulator side of the extension. Runs inside a Web Worker, never on the
 * page's main thread.
 *
 * Everything here is the Node code path with the server taken out: the same
 * `BattleStream`, taught `>rng` by the same `rng-command.js`, cut by the same
 * `truncate.mjs`. Both files come through `cjs.js`, so they run as written.
 *
 * A `Session` is what `RoomBattle` is on the server (`server/room-battle.ts`),
 * cut down to the part a fake room needs: it numbers requests, holds each
 * side's wait state, refuses a stale or duplicate choice with the server's own
 * words, and splits every update per side the way `server/sockets.ts` does.
 * The page (`room.js`) turns what comes back into frames for the client.
 */

import { simRequire, SIM_ENTRY, RNG_COMMAND } from './cjs.js';
import fs from './node/fs.js';
import { truncateAtTurn, inputLogLines } from '../../scripts/lib/truncate.mjs';
import { battleLines } from '../../scripts/lib/protocol.mjs';
import { reconstruct, unpackTeams } from '../../scripts/lib/reconstruct.mjs';
import { combineGames, inferSpreads, inferenceRecord } from '../../scripts/lib/inference/infer.mjs';
import {
  STAT_IDS, containsSpread, rangesOfValues, spreadAt, typicalSpread, unpackKnowledge, valuesOf, maskKeys,
} from '../../scripts/lib/inference/knowledge.mjs';
import {
  alignSpeciesToSheet, bestOfFromLog, crossCheckLog, crossCheckSheet, loadSource, maxHpFromLog, setsFromLog, setsFromSheet,
  teamsForSides, withLogIdentity,
} from '../../scripts/lib/replay-source.mjs';

const { BattleStream, Dex, Teams, extractChannelMessages } = simRequire(SIM_ENTRY);
const rng = simRequire(RNG_COMMAND);

rng.teachStream(BattleStream);

const SIDES = ['p1', 'p2'];
const CHANNEL = { p1: 1, p2: 2 };

const blankRequest = () => ({ rqid: 0, request: '', isWait: 'cantUndo', choice: '' });

class Session {
  constructor() {
    this.stream = new BattleStream({ keepAlive: true });
    // BattleStream pushes synchronously while a write is processed, so a push
    // hook sees every chunk a write produced before the write returns.
    this.stream.push = chunk => this.receive(chunk);
    this.rqid = 1;
    this.players = { p1: blankRequest(), p2: blankRequest() };
    /** Every update line, `|split|` blocks included: the server's room log. */
    this.log = [];
    this.frames = null;
    this.end = null;
    this.crash = null;
  }

  get battle() { return this.stream.battle; }

  /** `RoomBattle.receive`, for the chunk types a two-player battle produces. */
  receive(chunk) {
    const lines = chunk.split('\n');
    const type = lines[0];
    if (type === 'update') {
      const body = lines.slice(1);
      this.log.push(...body);
      if (this.frames) {
        const channels = extractChannelMessages(body.join('\n'), [1, 2]);
        this.frames.p1.push(...channels[1]);
        this.frames.p2.push(...channels[2]);
      }
    } else if (type === 'sideupdate') {
      const side = lines[1];
      const line = lines[2] || '';
      const player = this.players[side];
      if (!player) return;
      if (line.startsWith(`|error|[Invalid choice] Can't do anything`)) {
        // the server leaves the wait state alone
      } else if (line.startsWith('|error|[Invalid choice]')) {
        player.isWait = line.includes(`Can't undo`) ? 'cantUndo' : false;
        player.choice = '';
      } else if (line.startsWith('|request|')) {
        this.rqid++;
        const request = JSON.parse(line.slice(9));
        request.rqid = this.rqid;
        const json = JSON.stringify(request);
        this.players[side] = { rqid: this.rqid, request: json, isWait: request.wait ? 'cantUndo' : false, choice: '' };
        this.frames?.[side].push(`|request|${json}`);
        return;
      }
      this.frames?.[side].push(line);
    } else if (type === 'end') {
      this.end = JSON.parse(lines.slice(1).join('\n'));
    } else if (type === 'error') {
      this.crash = lines.slice(1).join('\n');
      for (const side of SIDES) this.frames?.[side].push('|error|The battle crashed. Nothing after this point is the simulator\'s.');
    }
  }

  /** Writes to the stream and returns the new lines each side sees. */
  async write(text) {
    this.frames = { p1: [], p2: [] };
    try {
      await this.stream.write(text);
      return this.frames;
    } finally {
      this.frames = null;
    }
  }

  /** `RoomBattle.choose`. `data` is what the client sends after `/choose `: `choice|rqid`. */
  async choose(side, data) {
    const [choice, rqid] = String(data).split('|', 2);
    const player = this.players[side];
    if (player.isWait !== false && player.isWait !== true) {
      return only(side, `|error|[Invalid choice] There's nothing to choose`);
    }
    const allWait = SIDES.every(s => !!this.players[s].isWait);
    if (allWait || (rqid && rqid !== `${player.rqid}`)) {
      return only(side, '|error|[Invalid choice] Sorry, too late to make a different move; the next turn has already started');
    }
    player.isWait = true;
    player.choice = choice;
    return this.write(`>${side} ${choice}`);
  }

  /** `RoomBattle.undo`. */
  async undo(side, data = '') {
    const [, rqid] = String(data).split('|', 2);
    const player = this.players[side];
    if (player.isWait !== true) return only(side, `|error|[Invalid choice] There's nothing to cancel`);
    const allWait = SIDES.every(s => !!this.players[s].isWait);
    if (allWait || (rqid && rqid !== `${player.rqid}`)) {
      return only(side, '|error|[Invalid choice] Sorry, too late to cancel; the next turn has already started');
    }
    player.isWait = false;
    player.choice = '';
    return this.write(`>${side} undo`);
  }

  /** What a player sees on joining: the room log for their channel. */
  scrollback(side) {
    return extractChannelMessages(this.log.join('\n'), [CHANNEL[side]])[CHANNEL[side]];
  }

  /** The side's pending request, as the server re-sends it on join. */
  request(side) {
    const r = this.players[side].request;
    return r ? `|request|${r}` : null;
  }

  summary() {
    const battle = this.battle;
    return {
      formatid: battle.format.id,
      players: battle.sides.map(s => s.name),
      turn: battle.turn,
      ended: battle.ended,
      winner: battle.winner || null,
      inputLog: battle.inputLog.join('\n'),
    };
  }

  /**
   * The battle as the server writes it on `end` (`logData` in `room-battle.ts`):
   * input log and the channel -1 room log, the shape `verify-branch.mjs` reads.
   */
  exportLog() {
    const battle = this.battle;
    return {
      ...this.summary(),
      inputLog: battle.inputLog.slice(),
      log: extractChannelMessages(this.log.join('\n'), [-1])[-1],
      seed: battle.prngSeed,
      end: this.end,
    };
  }
}

const only = (side, line) => ({ p1: [], p2: [], [side]: [line] });

const sessions = new Map();
let nextKey = 0;

function session(key) {
  const s = sessions.get(key);
  if (!s) throw new Error(`no battle ${key} - it was closed, or the page was reloaded`);
  return s;
}

function opened(key, s) {
  const out = { key, ...s.summary(), sides: {} };
  for (const side of SIDES) out.sides[side] = { scrollback: s.scrollback(side), request: s.request(side) };
  return out;
}

/** Starts a battle from a complete input log - a branch prefix, or a saved branch after a reload. */
export async function open(inputLog) {
  const lines = inputLogLines(inputLog);
  if (!lines.some(l => l.startsWith('>start '))) throw new Error('input log has no >start line');
  const s = new Session();
  for (const line of lines) await s.write(line);
  if (!s.battle) throw new Error('the input log started no battle');
  // A side that had already chosen when the log was saved is waiting again.
  for (const [i, side] of SIDES.entries()) {
    if (s.players[side].isWait === false && s.battle.sides[i]?.isChoiceDone?.()) s.players[side].isWait = true;
  }
  const key = ++nextKey;
  sessions.set(key, s);
  return opened(key, s);
}

/** Cuts a recorded input log at the start of `turn`, reseeds the rest, and opens it. */
export async function branch(inputLog, turn, { seed = true } = {}) {
  const cut = await truncateAtTurn(inputLog, Number(turn), { reseed: seed });
  if (cut.ended) throw new Error(`the battle ended before turn ${turn} (it lasted ${cut.turn} turns)`);
  if (!cut.awaitingChoice) throw new Error(`turn ${turn} does not start with both sides choosing a move`);
  if (cut.errors.length) throw new Error(`the recording does not replay cleanly: ${cut.errors[0]}`);
  const result = await open(cut.inputLog);
  return { ...result, from: { turn: cut.turn, seed: cut.seed, kept: cut.kept } };
}

export async function choose(key, side, data) {
  const s = session(key);
  const frames = await s.choose(side, data);
  return { frames, ...s.summary() };
}

export async function undo(key, side, data) {
  const s = session(key);
  const frames = await s.undo(side, data);
  return { frames, ...s.summary() };
}

/** `/forfeit`: the server ends the battle for the side that asked. */
export async function forfeit(key, side) {
  const s = session(key);
  const frames = await s.write(`>forcelose ${side}`);
  return { frames, ...s.summary() };
}

// ---------------------------------------------------------------------- /rng

const escapeHTML = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/\//g, '&#x2f;');

/**
 * What `rng-command.js`'s handlers need of the server's chat layer: they throw
 * `Chat.ErrorMessage` and escape with `Chat.escapeHTML`, both at call time.
 */
globalThis.Chat = globalThis.Chat || {
  ErrorMessage: class ErrorMessage extends Error {
    constructor(message) { super(message); this.name = 'ErrorMessage'; }
  },
  escapeHTML,
};

/**
 * `/rng <target>` in a branch, run by the very handler the server runs
 * (`commands.rng` in `rng-command.js`) against the branch's battle.
 *
 * `roomids` are the branch's rooms, the asking one first. The handler's room is
 * the asking one; its replies are what the server would send that room, and its
 * `|queryresponse|` pushes go to the page as global messages, as a connection's do.
 */
export async function rngCommand(key, target, roomids) {
  const s = session(key);
  const room = { roomid: roomids[0], battle: { stream: { battle: s.battle } }, users: {} };
  const out = { room: [], global: [] };
  const context = {
    requireRoom: () => room,
    sendReply: text => out.room.push(String(text)),
    sendReplyBox: html => out.room.push(`|html|<div class="infobox">${html}</div>`),
    errorReply: text => out.room.push(`|error|${text}`),
  };
  const connection = { send: line => out.global.push(String(line)), inRooms: new Set([room.roomid]) };
  const user = { id: 'encoreable', name: 'Encoreable', connections: [connection] };
  try {
    rng.commands.rng.call(context, String(target || ''), room, user, connection);
  } catch (err) {
    if (err && err.name === 'ErrorMessage') out.room.push(`|error|${err.message}`);
    else throw err;
  }
  return { ...out, ...s.summary() };
}

/** Both sides' scrollback and pending request, for re-showing an open branch. */
export function view(key) {
  return opened(key, session(key));
}

export function exportLog(key) {
  return session(key).exportLog();
}

export async function close(key) {
  const s = sessions.get(key);
  if (!s) return false;
  sessions.delete(key);
  try { await s.stream.writeEnd(); } catch {}
  return true;
}

/**
 * Re-simulates an input log in a fresh battle - `resimulate` in
 * `scripts/local-replay.mjs`, line for line, so the two can be compared byte
 * for byte.
 */
export async function resim(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) void chunk; })();
  await stream.write(inputLog);
  const battle = stream.battle;
  if (!battle) throw new Error('re-simulation produced no battle');
  const result = {
    debugLog: battle.getDebugLog(),
    inputLog: battle.inputLog.join('\n'),
    ended: battle.ended,
    turns: battle.turn,
    seed: battle.prngSeed,
  };
  await stream.writeEnd();
  await drain;
  return result;
}

// ------------------------------------------------------------ reconstruction

/** The command's `resimulate` (`scripts/local-reconstruct.mjs`): both channel views. */
async function resimulateViews(inputLog) {
  const stream = new BattleStream({ keepAlive: true });
  const drain = (async () => { for await (const chunk of stream) void chunk; })();
  for (const line of inputLogLines(inputLog)) await stream.write(line);
  const battle = stream.battle;
  const channels = extractChannelMessages([...battle.log].join('\n'), [-1, 1, 2]);
  stream.destroy?.();
  await Promise.race([drain, Promise.resolve()]);
  return { omniscient: channels[-1], p1: channels[1], p2: channels[2], turns: battle.turn };
}

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** A replay's log in the one shape `replay-source.mjs` reads a replay from: a saved page. */
export function replayPage(log) {
  return `<!doctype html>\n<script type="text/plain" class="battle-log-data">${escapeHtml(log).replace(/\//g, '\\/')}</script>\n`;
}

/** A team as `{ packed }` (the teambuilder's form) or `{ text }` (an export). */
function packTeam(team) {
  if (!team) return null;
  if (team.packed) return team.packed;
  if (team.text) return Teams.pack(Teams.import(team.text));
  return null;
}

/**
 * Rebuilds a replay into a recording: `runOne` in `scripts/local-reconstruct.mjs`
 * for a replay source, rung S4, without the printing.
 *
 * @param source  `{ name, html }` a saved replay page, or `{ name, log }` a replay's log; `replay`
 *                beside either is its id on replay.pokemonshowdown.com, which a saved page
 *                otherwise names itself
 * @param teams   `[p1, p2]`, each `{ packed }`, `{ text }` or null - a team may sit on either side
 * @param infer   null, 'p1', 'p2' or 'both': whose Stat Points are worked out from the replay
 */
export async function reconstructReplay({ source: input, teams = [null, null], infer = null, sampleSeed = 1, maxProbes = 4000, threads } = {}) {
  const name = String(input.name || 'replay').replace(/[\\/]/g, '_').replace(/(\.html)?$/i, '.html');
  const file = `/sources/${name}`;
  fs.writeFileSync(file, input.html ?? replayPage(input.log));
  try {
    const source = loadSource(file);
    const inferred = infer === 'both' ? ['p1', 'p2'] : infer ? [infer] : [];
    const observed = source.lines;
    const exactSides = new Set([...maxHpFromLog(observed).keys()].map(key => key.slice(0, 2)));
    const channel = !exactSides.size ? 0 : exactSides.size === 1 && exactSides.has('p2') ? 2 : 1;

    let packedTeams = teamsForSides(observed, teams.map(packTeam))
      .map((packed, i) => (packed ? alignSpeciesToSheet(packed, source.sheets?.[i]) : null));
    const supplied = i => !inferred.includes(`p${i + 1}`);
    for (const i of [0, 1]) {
      if (supplied(i) && !packedTeams[i]) {
        throw new Error(`no team for p${i + 1} (${source.players[i]}) - supply its team, or infer its Stat Points`);
      }
    }

    const problems = [];
    for (const [i, sheet] of (source.sheets || []).entries()) {
      if (!supplied(i) || !packedTeams[i]) continue;
      const found = sheet ? crossCheckSheet(sheet, packedTeams[i]) : crossCheckLog(observed, `p${i + 1}`, source.formatid, packedTeams[i]);
      for (const p of found) problems.push(`p${i + 1} ${p}`);
    }
    const statedMax = maxHpFromLog(observed);
    if (statedMax.size) {
      const dex = Dex.forFormat(source.formatid);
      for (const [i, packed] of packedTeams.entries()) {
        if (!supplied(i) || !packed) continue;
        for (const set of Teams.unpack(packed)) {
          const key = `p${i + 1} ${set.name || set.species}`;
          if (!statedMax.has(key)) continue;
          const mine = dex.species.get(set.species || set.name).baseStats.hp + (set.evs?.hp || 0) + 75;
          if (mine !== statedMax.get(key)) problems.push(`p${i + 1} ${set.species || set.name}: log says max HP ${statedMax.get(key)}, the team gives ${mine}`);
        }
      }
    }
    if (problems.length) throw new Error(`the team does not match the replay:\n${problems.join('\n')}`);

    const started = Date.now();
    let built;
    let inference = null;
    const readOffLog = [false, false];
    if (inferred.length) {
      const sets = [0, 1].map((i) => {
        readOffLog[i] = !supplied(i) && !source.sheets?.[i];
        if (supplied(i)) return Teams.unpack(packedTeams[i]);
        if (source.sheets?.[i]) return withLogIdentity(setsFromSheet(source.sheets[i]), observed, `p${i + 1}`, source.formatid);
        return setsFromLog(observed, `p${i + 1}`, source.formatid).sets;
      });
      inference = await inferSpreads({
        formatid: source.formatid, sets, known: [supplied(0), supplied(1)], playerNames: source.players,
        observed, channel, sampleSeed, maxProbes, allSpent: false, threads,
      });
      built = inference.built;
      packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: inference.picks[s][i] }))));
    } else {
      built = await reconstruct({
        formatid: source.formatid, packedTeams, playerNames: source.players, observed, channel,
        seed: null, seedPlan: null, sampleSeed, maxProbes, threads,
      });
    }
    const seconds = (Date.now() - started) / 1000;

    const replayed = await resimulateViews(built.inputLog);
    const selfConsistent = battleLines(replayed.omniscient).join('\n') === battleLines(built.log).join('\n');
    const r = built.report;
    const [p1team, p2team] = unpackTeams(packedTeams);
    return {
      ok: r.complete && selfConsistent,
      selfConsistent,
      seconds,
      report: {
        complete: r.complete, turns: r.turns, verifiedThroughTurn: r.verifiedThroughTurn, winner: r.winner,
        forcedDraws: r.forcedDraws, drawsSeen: r.drawsSeen, variantsUsed: r.variantsUsed, backtracks: r.backtracks,
        notes: r.notes, diffs: r.diffs.slice(0, 3),
      },
      readOffLog,
      recording: {
        reconstructed: true,
        reconstructedFrom: input.name || name,
        rung: 's4',
        verifiedThroughTurn: r.verifiedThroughTurn,
        complete: r.complete,
        sampleSeed,
        winner: r.winner,
        seed: built.seed,
        turns: r.turns,
        p1: source.players[0],
        p2: source.players[1],
        bestOf: bestOfFromLog(observed, input.replay || source.replayId) || undefined,
        p1team,
        p2team,
        inference: inference ? inferenceRecord(inference, inferred) : undefined,
        inputLog: built.inputLog,
        log: built.log,
        format: source.formatid,
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    fs.memory.delete(file);
  }
}

// ---------------------------------------------------------------- Stat Points

/** Per open panel, per Pokemon id: what survives for it, and each stat's values across it. */
const panels = new Map();
let nextPanel = 0;

const valuesList = kn => Object.fromEntries(Object.entries(valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties).values)
  .map(([s, mask]) => [s, [...mask.keys()].filter(v => mask[v])]));

/** Per stat, the values it can move to with every other stat staying where `spread` has it. */
const reachFrom = (kn, values, spread) => Object.fromEntries(STAT_IDS.map(s => [s, values[s].filter(v => containsSpread(kn, { ...spread, [s]: v }))]));

/**
 * What the Stat Point sliders of a branch show, for every Pokemon of both
 * teams in team order: its stats at each Stat Point for each forme it can
 * take, the spread its battle uses, and - for one whose Stat Points were
 * inferred - each stat's possible values, the spread the sliders open on, and
 * how far each slider goes from there with nothing else moving.
 *
 * @param inference  a recording's `inference` block, or null when both teams were known
 */
export function spreadPanel(key, inference) {
  const battle = session(key).battle;
  const handle = ++nextPanel;
  const byId = new Map((inference?.pokemon || []).map(p => [p.id, p]));
  const inferredSides = new Set(inference?.inferred || []);
  const pokemon = [];
  for (const [s, side] of battle.sides.entries()) {
    for (const [i, set] of side.team.entries()) {
      const id = `p${s + 1}:${i}`;
      const species = battle.dex.species.get(set.species || set.name);
      const nature = battle.dex.natures.get(set.nature || 'Serious');
      const mega = battle.dex.items.get(set.item).megaStone?.[species.baseSpecies];
      const stats = {};
      for (const forme of [species, mega && battle.dex.species.get(mega)].filter(f => f?.exists)) {
        stats[forme.name] = Object.fromEntries(STAT_IDS.map(stat => [stat, Array.from({ length: 33 }, (_, sp) => battle.statModify(
          forme.baseStats, { ...set, evs: { ...set.evs, [stat]: sp } }, stat))]));
      }
      const used = Object.fromEntries(STAT_IDS.map(x => [x, Number(set.evs?.[x]) || 0]));
      const entry = { id, side: `p${s + 1}`, name: set.name || species.name, species: species.name, nature: nature.name, stats, used };
      const p = byId.get(id);
      if (p?.knowledge) {
        const kn = unpackKnowledge(p.knowledge);
        const values = valuesList(kn);
        panels.set(`${handle}|${id}`, { kn, values });
        const spread = typicalSpread(kn, species.baseStats, nature) || used;
        Object.assign(entry, {
          inferred: true, spreads: p.spreads, ranges: rangesOfValues(valuesOf(maskKeys(kn.keys), kn.dom, kn.spent, kn.ties).values),
          values, typical: spread, spread, reach: reachFrom(kn, values, spread),
        });
      } else if (inferredSides.has(entry.side)) {
        // A recording made before what survives was kept with it.
        Object.assign(entry, { inferred: true, unrecorded: true, spread: used });
      } else {
        entry.spread = used;
      }
      pokemon.push(entry);
    }
  }
  return { handle, pokemon };
}

/**
 * One slider moved: `stat` to `value`, the others kept where `current` has
 * them if that spread survives, and otherwise moved to the nearest one that
 * does.
 */
export function spreadMove(handle, id, stat, value, current) {
  const panel = panels.get(`${handle}|${id}`);
  if (!panel) throw new Error(`no Stat Point panel for ${id}`);
  const wanted = { ...current, [stat]: Number(value) };
  const spread = containsSpread(panel.kn, wanted) ? wanted : spreadAt(panel.kn, stat, Number(value), current);
  if (!spread) return null;
  return { spread, reach: reachFrom(panel.kn, panel.values, spread) };
}

/** The reach of a spread already chosen, as when the sliders go back to where they opened. */
export function spreadReach(handle, id, spread) {
  const panel = panels.get(`${handle}|${id}`);
  if (!panel) throw new Error(`no Stat Point panel for ${id}`);
  return { spread, reach: reachFrom(panel.kn, panel.values, spread) };
}

export function spreadPanelClose(handle) {
  for (const k of [...panels.keys()]) if (k.startsWith(`${handle}|`)) panels.delete(k);
  return true;
}

export const methods = {
  resim, open, branch, choose, undo, forfeit, view, exportLog, close, reconstructReplay, rngCommand,
  spreadPanel, spreadMove, spreadReach, spreadPanelClose,
};
