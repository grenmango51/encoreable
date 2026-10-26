/**
 * Validate a supported full-information recording without changing its input.
 * Both initial player lines must already carry complete packed teams. Format,
 * observation and source-team facts must agree before replay or branching.
 * No teams are generated or materialized from other recording fields.
 */

import { createRequire } from 'module';

import { profileFromInputLog, profileFromObservation } from './format-profile.mjs';

const require = createRequire(import.meta.url);
const { Dex, Teams } = require('pokemon-showdown');

const SLOT_LIST = ['p1', 'p2', 'p3', 'p4'];

export class RecordingInputError extends Error {
  /**
   * @param {'absent'|'partial'|'inconsistent'|'malformed'|'capability'} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecordingInputError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new RecordingInputError(code, message, details);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function commandLines(raw) {
  const source = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split('\n') : null);
  if (!source) fail('malformed', 'recording inputLog must be a string or an array of lines', { field: 'inputLog' });
  const lines = [];
  for (const entry of source) {
    const line = String(entry).trimEnd();
    if (!line) continue;
    if (!line.startsWith('>')) {
      fail('malformed', `input log line is not a command: ${line.slice(0, 80)}`, { field: 'inputLog' });
    }
    lines.push(line);
  }
  if (!lines.length) fail('malformed', 'recording inputLog is empty', { field: 'inputLog' });
  return lines;
}

function canonicalSeed(seed) {
  if (typeof seed === 'string' && seed) return seed;
  if (Array.isArray(seed) && seed.length && seed.every(part => typeof part === 'number' || typeof part === 'string')) {
    return seed.join(',');
  }
  return null;
}

/** Same start rules as format-profile, plus the seed exact replay has to keep. */
function parseStart(lines) {
  const starts = lines.filter(line => /^>start\s/.test(line));
  if (starts.length !== 1) {
    fail('malformed', 'input log must contain exactly one >start payload', { field: '>start' });
  }
  const line = starts[0];
  let options;
  try {
    options = JSON.parse(line.replace(/^>start\s+/, ''));
  } catch {
    fail('malformed', 'input log has invalid >start JSON', { field: '>start' });
  }
  if (!isPlainObject(options) || typeof options.formatid !== 'string' || !options.formatid) {
    fail('malformed', '>start requires an explicit formatid', { field: '>start' });
  }
  if (['format', 'gameType', 'gen', 'mod', 'ruleTable', 'customRules'].some(key => Object.hasOwn(options, key))) {
    fail('malformed', '>start overrides of the supported format profile are unsupported', { field: '>start' });
  }
  const seed = canonicalSeed(options.seed);
  if (!seed) fail('malformed', '>start has no seed', { field: '>start' });
  return { line, formatid: options.formatid, seed, rated: options.rated ?? null };
}

function admissionFor(lines, capability) {
  try {
    const profile = profileFromInputLog(lines, capability);
    return { profile, admitted: true, capabilityGranted: true, admissionError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Unsupported format ')) {
      fail('capability', message, { capability });
    }
    if (
      message.startsWith('Unsupported capability ') ||
      message.startsWith('Unknown format capability ') ||
      message.includes(' disagrees with supported ')
    ) {
      fail('capability', message, { capability });
    }
    fail('malformed', message, { field: '>start', capability });
  }
}

function parsePlayerLine(line) {
  const header = /^>player (p[1-4]) /.exec(line);
  if (!header || header.index !== 0) {
    fail('malformed', `malformed >player line: ${line.slice(0, 80)}`, { field: '>player' });
  }
  const slot = header[1];
  const json = line.slice(header[0].length);
  if (!json.startsWith('{') || !json.endsWith('}')) {
    fail('malformed', `${slot} >player payload is not one JSON object`, { field: '>player', slot });
  }
  let options;
  try {
    options = JSON.parse(json);
  } catch {
    fail('malformed', `${slot} >player payload is invalid JSON`, { field: '>player', slot });
  }
  if (!isPlainObject(options)) {
    fail('malformed', `${slot} >player payload is not an object`, { field: '>player', slot });
  }
  return { slot, options, json };
}

function packedTeamString(team) {
  if (typeof team !== 'string' || !team) return null;
  const sets = Teams.unpack(team);
  if (!sets || !sets.length) return null;
  return team;
}

function teamSeedOf(options, slot) {
  if (!Object.hasOwn(options, 'seed')) return null;
  if (options.seed === null || options.seed === undefined || options.seed === '') return null;
  const seed = canonicalSeed(options.seed);
  if (!seed) {
    fail('malformed', `${slot} team seed is not a string or an array`, { field: '>player', slot });
  }
  return seed;
}

function playerForm(options, slot) {
  const packed = packedTeamString(options.team);
  const teamSeed = teamSeedOf(options, slot);
  if (options.team != null && options.team !== '' && !packed) {
    fail('malformed', `${slot} team must be a packed team string when it is present`, { field: '>player', slot });
  }
  if (packed && teamSeed) {
    fail('inconsistent', `${slot} initial >player line has both a packed team and a team seed`, {
      field: '>player',
      slot,
      teamSeed,
    });
  }
  if (packed) return { form: 'packed', packed, teamSeed: null };
  fail('absent', `${slot} initial team is absent; a complete packed team is required`, { field: '>player', slot });
}

function packRecorded(sets) {
  return Teams.pack(structuredClone(sets));
}

function setsMatchPacked(sets, packed, slot) {
  const field = `${slot}team`;
  let fromSets;
  try {
    fromSets = packRecorded(sets);
  } catch (err) {
    if (err instanceof RecordingInputError) throw err;
    fail('partial', `${field} could not be packed: ${err instanceof Error ? err.message : String(err)}`, { slot, field });
  }
  if (fromSets === packed) return true;
  const unpacked = Teams.unpack(packed);
  if (!unpacked) return false;
  return Teams.pack(unpacked) === fromSets;
}

function assertRecordedAgrees(data, slot, packed) {
  const field = `${slot}team`;
  if (!Object.hasOwn(data, field) || data[field] == null) return null;
  if (!Array.isArray(data[field])) {
    fail('partial', `${field} is not an array of recorded sets`, { slot, field });
  }
  if (!setsMatchPacked(data[field], packed, slot)) {
    fail('inconsistent', `${slot} packed >player team does not match ${field}`, { slot, field });
  }
  return true;
}

function groupPlayers(lines) {
  const groups = new Map();
  lines.forEach((line, index) => {
    if (!line.startsWith('>player ')) return;
    const parsed = parsePlayerLine(line);
    if (!groups.has(parsed.slot)) groups.set(parsed.slot, []);
    groups.get(parsed.slot).push({ ...parsed, index, line });
  });
  if (!groups.has('p1') || !groups.has('p2')) {
    fail('malformed', 'recording is missing an initial >player line for p1 or p2', { field: '>player' });
  }
  const present = SLOT_LIST.filter(slot => groups.has(slot));
  present.forEach((slot, index) => {
    if (slot !== SLOT_LIST[index]) {
      fail('malformed', `>player slots skip ${SLOT_LIST[index]}`, { field: '>player', slot });
    }
  });
  return present.map(slot => groups.get(slot));
}

function assertMetadata(data, start) {
  if (typeof data.format === 'string' && data.format) {
    const formatId = Dex.toID(data.format);
    if (formatId !== start.formatid && data.format !== start.formatid) {
      fail('inconsistent', `recording format "${data.format}" disagrees with >start formatid "${start.formatid}"`, {
        field: 'format',
        format: data.format,
        formatid: start.formatid,
      });
    }
  }
  if (data.seed != null && data.seed !== '') {
    const seed = canonicalSeed(data.seed);
    if (!seed || seed !== start.seed) {
      fail('inconsistent', `recording seed ${JSON.stringify(data.seed)} disagrees with >start seed "${start.seed}"`, {
        field: 'seed',
        seed: data.seed,
        startSeed: start.seed,
      });
    }
  }
}

/**
 * @param {object} data server `.log.json` object. Not modified.
 * @param {{ capability?: string }} [options]
 * @returns {{
 *   inputLog: string,
 *   lines: string[],
 *   provenance: object,
 *   materialization: object,
 * }}
 */
export function inputLogFromRecording(data, options = {}) {
  if (!isPlainObject(data)) {
    fail('malformed', 'recording must be the server log object', { field: 'recording' });
  }
  const capability = options.capability ?? 'exactReplay';
  if (typeof capability !== 'string' || !capability) {
    fail('malformed', 'capability must be a format-profile capability name', { field: 'capability' });
  }

  const lines = commandLines(data.inputLog);
  const start = parseStart(lines);
  const admission = admissionFor(lines, capability);
  assertMetadata(data, start);
  const observed = Array.isArray(data.log) ? data.log : String(data.log || '').split('\n');
  try { profileFromObservation(start.formatid, observed, capability); }
  catch (err) { fail('inconsistent', err.message, { field: 'log' }); }

  const groups = groupPlayers(lines);
  const initials = groups.map(group => {
    const first = group[0];
    const form = playerForm(first.options, first.slot);
    for (const later of group.slice(1)) {
      const laterTeam = later.options.team;
      if (typeof laterTeam === 'string' && laterTeam) {
        fail('inconsistent', `${first.slot} has a later >player line that also carries a team`, {
          slot: first.slot, field: '>player',
        });
      }
      if (Array.isArray(laterTeam) && laterTeam.length) {
        fail('inconsistent', `${first.slot} has a later >player line that also carries a team`, {
          slot: first.slot, field: '>player',
        });
      }
    }
    return { ...first, ...form };
  });

  const slots = {};
  const players = [];
  for (const player of initials) {
    const checked = assertRecordedAgrees(data, player.slot, player.packed);
    const unpacked = Teams.unpack(player.packed);
    slots[player.slot] = Object.freeze({
      source: 'player-line', setCount: unpacked.length, packed: player.packed,
      droppedSeed: false, agreesWithRecordedTeam: checked,
    });
    players.push(Object.freeze({
      slot: player.slot, name: player.options.name ?? null,
      avatar: player.options.avatar ?? null, form: 'packed',
      packedTeam: player.packed, lineIndex: player.index,
    }));
  }
  const inputLog = lines.join('\n');
  return Object.freeze({
    inputLog,
    lines: Object.freeze(lines),
    provenance: Object.freeze({
      capability,
      admitted: admission.admitted,
      capabilityGranted: admission.capabilityGranted,
      admissionError: admission.admissionError,
      profile: admission.profile,
      formatid: start.formatid,
      gameType: admission.profile ? admission.profile.gameType : null,
      statModel: admission.profile ? admission.profile.statModel : null,
      start: Object.freeze({
        formatid: start.formatid,
        seed: start.seed,
        rated: start.rated,
        line: start.line,
      }),
      players: Object.freeze(players),
    }),
    materialization: Object.freeze({
      mode: 'packed-passthrough',
      generatorInvoked: false,
      slots: Object.freeze(slots),
    }),
  });
}
