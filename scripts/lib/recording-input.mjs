/**
 * Derive a replayable input log from a server recording.
 *
 * Random Battle's simulator writes a team seed on the initial `>player` line
 * and does not write the packed team. The server log still keeps the sets that
 * were actually generated, on `p1team` and `p2team` (and `p3team` / `p4team`
 * when those players exist). Replaying the seed calls the team generator
 * again. This module does not. It packs those recorded sets with `Teams.pack`
 * and puts that string on the initial player line, in memory only.
 *
 * A recording whose initial player lines already carry packed teams is copied
 * through. Nothing in either path calls `Teams.generate` or
 * `Teams.getGenerator`. The recording object and its input-log array are not
 * modified.
 *
 * Format admission stays in `format-profile.mjs`. This module asks that
 * contract whether `capability` (default `exactReplay`) is granted. An unknown
 * format, including `gen9randombattle` until it is admitted, still produces a
 * derived log: `provenance.admitted` and `provenance.capabilityGranted` are
 * false, and `provenance.admissionError` is the format-profile message.
 * An admitted format that does not grant the capability throws.
 */

import { createRequire } from 'module';

import { profileFromInputLog } from './format-profile.mjs';

const require = createRequire(import.meta.url);
const { Dex, Teams } = require('pokemon-showdown');

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const SLOT_LIST = ['p1', 'p2', 'p3', 'p4'];
const LEAD_POSITIONS = {
  singles: ['a'],
  doubles: ['a', 'b'],
  triples: ['a', 'b', 'c'],
  multi: ['a'],
  freeforall: ['a'],
};

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
  if (options.format || options.gameType || options.gen || options.mod || options.ruleTable || options.customRules) {
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
      return { profile: null, admitted: false, capabilityGranted: false, admissionError: message };
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
  if (teamSeed) return { form: 'seed-only', packed: null, teamSeed };
  return { form: 'no-team', packed: null, teamSeed: null };
}

function labelOf(slot, index, set) {
  const who = set && (set.species || set.name) ? ` ${set.species || set.name}` : '';
  return `${slot}team set ${index + 1}${who}`;
}

function requireStatTable(set, field, max, label, slot, index) {
  const table = set[field];
  if (!isPlainObject(table)) {
    fail('partial', `${label} has no ${field}`, { slot, field: `${slot}team`, index, stat: field });
  }
  for (const stat of STATS) {
    if (!Object.hasOwn(table, stat)) {
      fail('partial', `${label} ${field}.${stat} is absent`, { slot, field: `${slot}team`, index, stat });
    }
    const value = table[stat];
    if (!Number.isInteger(value) || value < 0 || value > max) {
      fail('partial', `${label} ${field}.${stat} is ${JSON.stringify(value)}`, {
        slot, field: `${slot}team`, index, stat, value,
      });
    }
  }
}

/** A recorded set is complete when the pack format can carry the battle fields it names. */
function assertCompleteSet(set, slot, index) {
  const label = labelOf(slot, index, isPlainObject(set) ? set : null);
  if (!isPlainObject(set)) {
    fail('partial', `${slot}team set ${index + 1} is not a set object`, { slot, field: `${slot}team`, index });
  }
  const speciesName = set.species || set.name;
  if (typeof speciesName !== 'string' || !speciesName) {
    fail('partial', `${label} has no species`, { slot, field: `${slot}team`, index });
  }
  const species = Dex.species.get(speciesName);
  if (!species.exists) {
    fail('partial', `${label} species "${speciesName}" is not in the simulator dex`, {
      slot, field: `${slot}team`, index, species: speciesName,
    });
  }
  if (typeof set.ability !== 'string' || !set.ability || !Dex.abilities.get(set.ability).exists) {
    fail('partial', `${label} ability ${JSON.stringify(set.ability ?? null)} is not a simulator ability`, {
      slot, field: `${slot}team`, index,
    });
  }
  if (set.item != null && set.item !== '' && (typeof set.item !== 'string' || !Dex.items.get(set.item).exists)) {
    fail('partial', `${label} item ${JSON.stringify(set.item)} is not a simulator item`, {
      slot, field: `${slot}team`, index,
    });
  }
  if (set.nature != null && set.nature !== '' && (typeof set.nature !== 'string' || !Dex.natures.get(set.nature).exists)) {
    fail('partial', `${label} nature ${JSON.stringify(set.nature)} is not a simulator nature`, {
      slot, field: `${slot}team`, index,
    });
  }
  if (!Array.isArray(set.moves) || set.moves.length < 1 || set.moves.length > 4) {
    fail('partial', `${label} moves must be 1 to 4 moves`, { slot, field: `${slot}team`, index });
  }
  for (const move of set.moves) {
    if (typeof move !== 'string' || !move || !Dex.moves.get(move).exists) {
      fail('partial', `${label} move ${JSON.stringify(move)} is not a simulator move`, {
        slot, field: `${slot}team`, index, move,
      });
    }
  }
  if (!Number.isInteger(set.level) || set.level < 1 || set.level > 9999) {
    fail('partial', `${label} level ${JSON.stringify(set.level ?? null)} is not a complete level`, {
      slot, field: `${slot}team`, index,
    });
  }
  if (typeof set.teraType !== 'string' || !set.teraType || !Dex.types.get(set.teraType).exists) {
    fail('partial', `${label} tera type ${JSON.stringify(set.teraType ?? null)} is absent or unknown`, {
      slot, field: `${slot}team`, index,
    });
  }
  if (set.gender != null && set.gender !== '' && !['M', 'F', 'N'].includes(set.gender)) {
    fail('partial', `${label} gender ${JSON.stringify(set.gender)} is not M, F, or N`, {
      slot, field: `${slot}team`, index,
    });
  }
  if (set.shiny != null && typeof set.shiny !== 'boolean') {
    fail('partial', `${label} shiny flag is ${JSON.stringify(set.shiny)}`, { slot, field: `${slot}team`, index });
  }
  requireStatTable(set, 'evs', 255, label, slot, index);
  requireStatTable(set, 'ivs', 31, label, slot, index);
  return species;
}

function packRecorded(sets) {
  return Teams.pack(structuredClone(sets));
}

function movesAgree(recorded, unpacked) {
  const left = (recorded.moves || []).map(move => Dex.moves.get(move).id);
  const right = (unpacked.moves || []).map(move => Dex.moves.get(move).id);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function statsAgree(recorded, unpacked, field, blank) {
  for (const stat of STATS) {
    const left = recorded[field][stat];
    const right = unpacked[field] && Object.hasOwn(unpacked[field], stat) ? unpacked[field][stat] : blank;
    if (left !== right) return false;
  }
  return true;
}

/** `Teams.pack` must still name the same Pokémon the recording stored. */
function assertPackFaithful(sets, packed, slot) {
  const unpacked = Teams.unpack(packed);
  if (!unpacked || unpacked.length !== sets.length) {
    fail('partial', `${slot}team does not survive Teams.pack`, { slot, field: `${slot}team` });
  }
  for (let index = 0; index < sets.length; index++) {
    const recorded = sets[index];
    const back = unpacked[index];
    const species = Dex.species.get(recorded.species || recorded.name);
    const backSpecies = Dex.species.get(back.species || back.name);
    const label = labelOf(slot, index, recorded);
    const gender = recorded.gender === 'M' || recorded.gender === 'F' || recorded.gender === 'N' ? recorded.gender : '';
    const backGender = back.gender === 'M' || back.gender === 'F' || back.gender === 'N' ? back.gender : '';
    const same = species.id === backSpecies.id &&
      Dex.toID(recorded.ability) === Dex.toID(back.ability) &&
      Dex.toID(recorded.item || '') === Dex.toID(back.item || '') &&
      Dex.toID(recorded.nature || '') === Dex.toID(back.nature || '') &&
      Dex.toID(recorded.teraType) === Dex.toID(back.teraType || '') &&
      (recorded.level || 100) === (back.level || 100) &&
      !!recorded.shiny === !!back.shiny &&
      (gender === 'N' ? '' : gender) === (backGender === 'N' ? '' : backGender) &&
      (recorded.happiness ?? 255) === (back.happiness ?? 255) &&
      movesAgree(recorded, back) &&
      statsAgree(recorded, back, 'evs', 0) &&
      statsAgree(recorded, back, 'ivs', 31);
    if (!same) {
      fail('partial', `${label} changes when packed and unpacked`, { slot, field: `${slot}team`, index });
    }
  }
}

function recordedSets(data, slot) {
  const field = `${slot}team`;
  if (!Object.hasOwn(data, field) || data[field] == null) {
    fail('absent', `${field} is absent. The initial >player line has no packed team, and its team seed is not used to generate one.`, {
      slot, field,
    });
  }
  if (typeof data[field] === 'string') {
    fail('partial', `${field} is a packed string, not recorded sets`, { slot, field });
  }
  if (!Array.isArray(data[field])) {
    fail('partial', `${field} is not an array of recorded sets`, { slot, field });
  }
  if (!data[field].length) {
    fail('absent', `${field} is empty`, { slot, field });
  }
  if (data[field].length > 24) {
    fail('partial', `${field} has ${data[field].length} sets; a packed team holds at most 24`, { slot, field });
  }
  data[field].forEach((set, index) => assertCompleteSet(set, slot, index));
  const packed = packRecorded(data[field]);
  if (!packed) fail('partial', `${field} packed to an empty team`, { slot, field });
  assertPackFaithful(data[field], packed, slot);
  return { sets: data[field], packed, setCount: data[field].length };
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

function withPackedTeam(options, packed) {
  const next = {};
  let placed = false;
  for (const key of Object.keys(options)) {
    if (key === 'seed' || key === 'team') {
      if (!placed) {
        next.team = packed;
        placed = true;
      }
      continue;
    }
    next[key] = options[key];
  }
  if (!placed) next.team = packed;
  return next;
}

function displayedSpecies(set) {
  const species = Dex.species.get(set.species || set.name);
  if (['Greninja-Bond', 'Rockruff-Dusk'].includes(species.name)) return species.baseSpecies;
  return species.name;
}

function genderOf(set) {
  if (set.gender === 'M' || set.gender === 'F') return set.gender;
  return '';
}

function parseDetails(details) {
  const [species, ...rest] = String(details || '').split(', ');
  const levelText = rest.find(part => /^L\d+$/.test(part));
  return {
    species,
    level: levelText ? Number(levelText.slice(1)) : 100,
    gender: rest.find(part => part === 'M' || part === 'F') || '',
    shiny: rest.includes('shiny'),
  };
}

function logLinesOf(log) {
  if (log == null) return null;
  if (Array.isArray(log)) return log.map(line => String(line));
  if (typeof log === 'string') return log.split('\n');
  fail('malformed', 'recording log must be a string or an array of lines', { field: 'log' });
}

function formatRules(formatid) {
  const format = Dex.formats.get(formatid);
  if (!format.exists) return null;
  try {
    return { format, rules: Dex.formats.getRuleTable(format) };
  } catch {
    return null;
  }
}

/**
 * The lead sent out before turn 1 is the start of the recorded team only when
 * the battle did not go through Team Preview. Illusion's disguise is not a
 * contradiction. A missing switch is not proof either way.
 */
function assertLeadsAgree(log, formatid, teamsBySlot) {
  const lines = logLinesOf(log);
  if (!lines || !lines.some(line => line.startsWith('|'))) {
    return { performed: false, reason: 'no-log' };
  }
  if (lines.some(line => line.startsWith('|teampreview'))) {
    return { performed: false, reason: 'team-preview' };
  }
  const known = formatRules(formatid);
  if (!known) return { performed: false, reason: 'format-unknown' };
  if (known.rules.has('teampreview')) return { performed: false, reason: 'team-preview' };
  const positions = LEAD_POSITIONS[known.format.gameType] || ['a'];
  const seen = new Map();
  for (const line of lines) {
    if (line.startsWith('|turn|')) break;
    const parts = line.split('|');
    if (parts[1] !== 'switch' && parts[1] !== 'drag') continue;
    const ident = /^(p[1-4])([a-f]): /.exec(parts[2] || '');
    if (!ident || seen.has(ident[1] + ident[2])) continue;
    seen.set(ident[1] + ident[2], parts[3] || '');
  }
  let checked = 0;
  for (const [slot, sets] of teamsBySlot) {
    for (let index = 0; index < positions.length; index++) {
      const details = seen.get(slot + positions[index]);
      if (!details) continue;
      const set = sets[index];
      if (!set) {
        fail('inconsistent', `${slot} lead ${positions[index]} switched in but ${slot}team has no set ${index + 1}`, {
          slot, field: 'log', details,
        });
      }
      if (Dex.toID(set.ability) === 'illusion') continue;
      const shown = parseDetails(details);
      const expected = {
        species: displayedSpecies(set),
        level: set.level || 100,
        gender: genderOf(set),
        shiny: !!set.shiny,
      };
      if (
        shown.species !== expected.species ||
        shown.level !== expected.level ||
        shown.gender !== expected.gender ||
        shown.shiny !== expected.shiny
      ) {
        fail('inconsistent', `${slot} lead ${positions[index]} "${details}" does not match recorded ${expected.species}, level ${expected.level}`, {
          slot,
          field: 'log',
          details,
          expected,
        });
      }
      checked += 1;
    }
  }
  return { performed: checked > 0, reason: checked ? 'agreed' : 'no-lead' };
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

  const forms = new Set(initials.map(player => (player.form === 'packed' ? 'packed' : 'recorded')));
  if (forms.size > 1) {
    const summary = initials.map(player => `${player.slot} ${player.form}`).join(', ');
    fail('inconsistent', `initial >player lines disagree (${summary}). A seed-only recording needs every initial line without a packed team, and a packed recording needs every initial line packed.`, {
      field: '>player',
    });
  }

  const useRecorded = forms.has('recorded');
  const slots = {};
  const players = [];
  const teamsBySlot = new Map();
  const derived = lines.slice();

  for (const player of initials) {
    if (!useRecorded) {
      const checked = assertRecordedAgrees(data, player.slot, player.packed);
      const unpacked = Teams.unpack(player.packed);
      teamsBySlot.set(player.slot, unpacked);
      slots[player.slot] = Object.freeze({
        source: 'player-line',
        setCount: unpacked.length,
        packed: player.packed,
        droppedSeed: false,
        agreesWithRecordedTeam: checked,
      });
      players.push({
        slot: player.slot,
        name: player.options.name ?? null,
        avatar: player.options.avatar ?? null,
        form: 'packed',
        teamSeed: null,
        teamSeedUsed: false,
        packedTeam: player.packed,
        lineIndex: player.index,
      });
      continue;
    }

    const recorded = recordedSets(data, player.slot);
    const rewritten = `>player ${player.slot} ${JSON.stringify(withPackedTeam(player.options, recorded.packed))}`;
    derived[player.index] = rewritten;
    teamsBySlot.set(player.slot, recorded.sets);
    slots[player.slot] = Object.freeze({
      source: `${player.slot}team`,
      setCount: recorded.setCount,
      packed: recorded.packed,
      droppedSeed: player.teamSeed != null,
      agreesWithRecordedTeam: true,
    });
    players.push({
      slot: player.slot,
      name: player.options.name ?? null,
      avatar: player.options.avatar ?? null,
      form: player.form,
      teamSeed: player.teamSeed,
      teamSeedUsed: false,
      packedTeam: recorded.packed,
      lineIndex: player.index,
    });
  }

  const leadCheck = assertLeadsAgree(data.log, start.formatid, teamsBySlot);
  const inputLog = derived.join('\n');
  return Object.freeze({
    inputLog,
    lines: Object.freeze(derived),
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
      players: Object.freeze(players.map(player => Object.freeze(player))),
    }),
    materialization: Object.freeze({
      mode: useRecorded ? 'recorded-teams' : 'packed-passthrough',
      generatorInvoked: false,
      slots: Object.freeze(slots),
      leadCheck: Object.freeze(leadCheck),
    }),
  });
}
