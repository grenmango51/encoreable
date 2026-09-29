/**
 * Where an observed battle comes from.
 *
 * Two shapes arrive here and both reduce to the same thing: a format id, both
 * players' names, both packed teams, and the protocol lines someone watched.
 *
 *   - a `.log.json` written by our own server. Carries the input log, so the
 *     real seed and both packed teams are readable, and its `log` is the
 *     omniscient view (exact HP on both sides).
 *   - a `.html` replay saved from play.pokemonshowdown.com. Carries no input
 *     log and no seed. HP is exact for whichever player uploaded it and a
 *     Champions percentage for the other. Teams come from the `|showteam|`
 *     lines, which carry species, item, ability, four moves, nature, gender and
 *     level - but an EMPTY EVs field, so stat points must be supplied.
 *
 * Nothing here interprets a battle. It only normalises the source.
 */

import fs from 'fs';

import { createRequire } from 'module';

import { unmaskIllusion } from './protocol.mjs';

const require = createRequire(import.meta.url);
const { Dex, Teams, toID } = require('pokemon-showdown');

/** Pull the protocol log out of a saved replay page. */
function logFromReplayHtml(html) {
  const match = /<script[^>]*battle-log-data[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('no battle-log-data script in the replay page');
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    // the page escapes forward slashes so `</script>` cannot appear inside it,
    // and a page saved on Windows leaves a `\r` on every line - which silently
    // fails every string comparison downstream
    .map(line => line.replace(/\\\//g, '/').replace(/\r$/, ''));
}

/** `|tier|[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)` -> `gen9championsvgc2026regmb` */
function formatFromTier(lines) {
  const tier = lines.find(l => l.startsWith('|tier|'));
  if (!tier) throw new Error('replay has no |tier| line, so the format is unknown');
  const name = tier.slice('|tier|'.length).replace(/\s*\(Bo\d+\)\s*$/, '');
  return toID(name);
}

/** The `|player|pN|name|...` names, in slot order. */
function playersFromLog(lines) {
  const names = [];
  for (const line of lines) {
    const parts = line.split('|');
    if (parts[1] !== 'player') continue;
    const slot = parts[2];
    if (!/^p[12]$/.test(slot)) continue;
    // first wins: a later line is a rename or an avatar update
    if (!names[Number(slot[1]) - 1]) names[Number(slot[1]) - 1] = parts[3];
  }
  return names;
}

/**
 * One `|showteam|pN|<packed>` line into its packed sets.
 *
 * The packed format is `name|species|item|ability|moves|nature|evs|gender|ivs|
 * shiny|level|misc`, sets joined by `]`. Open Team Sheets blanks the `evs`
 * field, which is exactly the information a sheet is supposed to withhold.
 */
export function parseShowteam(line) {
  const packed = line.split('|').slice(3).join('|');
  return packed.split(']').filter(Boolean).map((set) => {
    const f = set.split('|');
    return {
      name: f[0] || '',
      species: f[1] || f[0] || '',
      item: f[2] || '',
      ability: f[3] || '',
      moves: (f[4] || '').split(',').filter(Boolean),
      nature: f[5] || '',
      evs: f[6] || '',
      gender: f[7] || '',
      level: f[10] || '',
    };
  });
}

/** The team sheets in a log, by side, or null where a side revealed none. */
export function sheetsFromLog(lines) {
  const sheets = [null, null];
  for (const line of lines) {
    if (!line.startsWith('|showteam|')) continue;
    const slot = line.split('|')[2];
    if (/^p[12]$/.test(slot)) sheets[Number(slot[1]) - 1] = parseShowteam(line);
  }
  return sheets;
}

const sameSpecies = (a, b) => toID(a) === toID(b) ||
  // a sheet names the base forme; a mega evolves into its own species
  toID(a).startsWith(toID(b)) || toID(b).startsWith(toID(a));

/**
 * Check a supplied team against the sheet the replay published.
 *
 * The sheet cannot confirm stat points - that is the whole point of this step -
 * but it pins everything else, so a team from the wrong game is caught here
 * rather than blamed on the reconstruction ten turns later.
 */
export function crossCheckSheet(sheet, packedTeam) {
  if (!sheet) return [];
  const mine = Teams.unpack(packedTeam);
  const problems = [];
  if (mine.length !== sheet.length) {
    problems.push(`sheet lists ${sheet.length} Pokemon, supplied team has ${mine.length}`);
    return problems;
  }
  for (const [i, want] of sheet.entries()) {
    const got = mine[i];
    const at = `slot ${i + 1} (${want.species || want.name})`;
    if (!sameSpecies(got.species || got.name, want.species || want.name)) {
      problems.push(`${at}: sheet says ${want.species || want.name}, supplied team has ${got.species || got.name}`);
      continue; // every other field is meaningless once the species disagrees
    }
    if (want.item && toID(got.item) !== toID(want.item)) {
      problems.push(`${at}: item ${got.item || '(none)'} != sheet ${want.item}`);
    }
    if (want.ability && toID(got.ability) !== toID(want.ability)) {
      problems.push(`${at}: ability ${got.ability || '(none)'} != sheet ${want.ability}`);
    }
    if (want.nature && toID(got.nature) !== toID(want.nature)) {
      problems.push(`${at}: nature ${got.nature || '(none)'} != sheet ${want.nature}`);
    }
    const wantMoves = want.moves.map(toID).sort();
    const gotMoves = (got.moves || []).map(toID).sort();
    if (wantMoves.length && wantMoves.join(',') !== gotMoves.join(',')) {
      problems.push(`${at}: moves ${gotMoves.join('/')} != sheet ${wantMoves.join('/')}`);
    }
  }
  return problems;
}

/**
 * Every max-HP integer the observed log states outright, by ident.
 *
 * `|switch|p1a: Charizard|Charizard, L50, M|177/177` is a free, exact check on
 * the side whose HP is not percentages: max HP is `base + StatPoints + 75`, so a
 * team with the wrong spread is caught before anything else runs.
 */
export function maxHpFromLog(lines) {
  const found = new Map();
  for (const line of lines) {
    const parts = line.split('|');
    if (!['switch', 'drag', 'replace'].includes(parts[1])) continue;
    const hp = (parts[4] || '').trim().split(' ')[0];
    const max = Number(hp.split('/')[1]);
    if (!max || max === 100) continue; // a percentage side says nothing
    const name = (parts[2] || '').split(': ')[1];
    const side = (parts[2] || '').slice(0, 2);
    if (name) found.set(`${side} ${name}`, Number(max));
  }
  return found;
}

/**
 * `>player pN {...}` payloads out of an input log, in slot order.
 *
 * A recording produced by branching carries more than one line per slot: the
 * first sets the team, and a later one updates only the avatar when a browser
 * window takes the slot. Only the line that carries the team is the team.
 */
function playerOptionsFromInputLog(lines) {
  const bySlot = [];
  for (const line of lines) {
    const m = /^>player (p[12]) /.exec(line);
    if (!m) continue;
    const at = Number(m[1][1]) - 1;
    const options = JSON.parse(line.slice(line.indexOf('{')));
    if (!bySlot[at] || (!bySlot[at].team && options.team)) bySlot[at] = options;
  }
  return bySlot;
}

/**
 * Make the supplied sets name the species the sheet names.
 *
 * A team export may declare a mega forme directly - `Blastoise-Mega @
 * Blastoisinite` - and the server's validator quietly rewrites that to the base
 * forme, because a mega is reached in battle through the item and a `mega`
 * choice. `Teams.import` does no such thing, so an unvalidated team enters the
 * battle already mega-evolved: `|poke|` disagrees, and worse, `canMegaEvo` is
 * false and the mega evolution in the log can never be reproduced.
 *
 * The sheet states what the game actually used, so it wins.
 */
export function alignSpeciesToSheet(packedTeam, sheet) {
  if (!sheet) return packedTeam;
  const sets = Teams.unpack(packedTeam);
  if (!sets || sets.length !== sheet.length) return packedTeam;
  for (const [i, set] of sets.entries()) {
    const want = sheet[i].species || sheet[i].name;
    if (!want || toID(want) === toID(set.species || set.name)) continue;
    set.species = want;
    set.name = want;
  }
  return Teams.pack(sets);
}

/**
 * A published team sheet as set objects with no Stat Points - everything Open
 * Team Sheets reveal, and the starting point for inferring the rest.
 */
export function setsFromSheet(sheet) {
  return sheet.map(row => ({
    name: row.name || row.species,
    species: row.species || row.name,
    item: row.item,
    ability: row.ability,
    moves: row.moves,
    nature: row.nature,
    gender: row.gender,
    level: Number(row.level) || 50,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  }));
}

const identOf = (field) => {
  const m = /^(p[1-4])[a-d]?: (.+)$/.exec(String(field || ''));
  return m ? { side: m[1], name: m[2] } : null;
};

/** `Charizard, L50, M, shiny` -> `{ species, level, gender, shiny }`. */
function parseDetails(details) {
  const [species, ...rest] = String(details || '').split(', ');
  const level = Number((rest.find(r => /^L\d+$/.test(r)) || 'L100').slice(1));
  const gender = rest.find(r => r === 'M' || r === 'F') || '';
  return { species, level, gender, shiny: rest.includes('shiny') };
}

/**
 * What a log reveals about one side's sets, for a replay that publishes no team
 * sheet: the Pokemon previewed, the level and gender their details carry, every
 * move each one chose, and the item and ability it showed. The first item and
 * ability shown are the ones it brought; one passed on by Trick or copied by
 * Trace is not.
 *
 * Whose ability a `[from] ability:` tag names is settled by the species: `[of]`
 * is the owner for Rough Skin and Hospitality, but the attacker for Volt
 * Absorb, and only the owner's species can have the ability. An ability that
 * appears only after Mega Evolution belongs to the Mega forme, not the set.
 *
 * Everything the log never showed is filled with a stated assumption, listed
 * per Pokemon in `assumed`: an ability the species has only one of is known by
 * elimination, an unseen item is none, and an unseen nature is neutral.
 */
export function setsFromLog(lines, side, formatid) {
  const dex = Dex.forFormat(formatid);
  const mons = [];
  for (const line of lines) {
    const p = line.split('|');
    if (p[1] === 'poke' && p[2] === side) {
      const d = parseDetails(p[3]);
      mons.push({ ...d, name: null, moves: [], item: null, ability: null });
    }
  }
  const baseOf = species => toID(dex.species.get(species).baseSpecies || species);
  const byName = new Map();
  const find = (who) => {
    if (!who || who.side !== side) return null;
    return byName.get(who.name) || null;
  };
  const canHave = (mon, ability) => Object.values(dex.species.get(mon.species).abilities || {})
    .some(a => toID(a) === toID(ability));
  const tagsOf = line => Object.fromEntries(line.split('|').slice(2)
    .map(f => /^\[([a-z]+)\]\s*(.*)$/.exec(f.trim())).filter(Boolean).map(m => [m[1], m[2]]));

  // Names as the log shows them - a Pokemon Illusion was disguised as is still
  // printed under its own name - and everything else as it really happened.
  for (const line of lines) {
    const p = line.split('|');
    if (!['switch', 'drag', 'replace'].includes(p[1])) continue;
    const who = identOf(p[2]);
    if (!who || who.side !== side || byName.has(who.name)) continue;
    // A preview hides some formes (`Urshifu-*`); the Pokemon sent in shows it.
    const d = parseDetails(p[3]);
    const mon = mons.find(m => !m.name && baseOf(m.species.replace(/-\*$/, '')) === baseOf(d.species));
    if (!mon) continue;
    mon.name = who.name;
    if (mon.species.endsWith('-*')) mon.species = d.species;
    byName.set(who.name, mon);
  }

  for (const line of unmaskIllusion(lines).lines) {
    const p = line.split('|');
    const kind = p[1];
    const tags = tagsOf(line);
    const subject = find(identOf(p[2]));
    const of = find(identOf(tags.of));

    if (kind === 'move' && subject && (!tags.from || tags.from === 'lockedmove')) {
      const move = dex.moves.get(p[3]);
      if (move.exists && move.id !== 'struggle' && !subject.moves.includes(move.name)) subject.moves.push(move.name);
    }
    if (kind === 'cant' && subject && p[4]) {
      const move = dex.moves.get(p[4]);
      if (move.exists && !subject.moves.includes(move.name)) subject.moves.push(move.name);
    }

    // Items: the Mega Stone, an item used up or knocked off, one announced or
    // frisked, and every effect credited to one. Rocky Helmet and the
    // retaliation Berries hurt the attacker, and name their holder in `[of]`.
    const giveItem = (mon, item) => { if (mon && item && mon.item === null) mon.item = dex.items.get(item).name || item; };
    if (kind === '-mega') giveItem(subject, p[4]);
    if (kind === '-enditem') giveItem(subject, p[3]);
    if (kind === '-item' && !/^move:/.test(tags.from || '') && !/Pickpocket|Magician|Pickup/.test(tags.from || '')) giveItem(subject, p[3]);
    if (kind === '-activate' && /^item: /.test(p[3] || '')) giveItem(subject, p[3].slice(6));
    if (/^item: /.test(tags.from || '')) giveItem(kind === '-damage' && of ? of : subject, tags.from.slice(6));

    // Abilities, only ever as the species could have them.
    const giveAbility = (mon, ability) => {
      if (mon && ability && mon.ability === null && canHave(mon, ability)) mon.ability = dex.abilities.get(ability).name || ability;
    };
    if (kind === '-ability' && !/^move:/.test(tags.from || '')) {
      if (tags.from === 'ability: Trace') giveAbility(subject, 'Trace');
      else if (!tags.from) giveAbility(subject, p[3]);
    }
    if (kind === '-activate' && /^ability: /.test(p[3] || '')) giveAbility(subject, p[3].slice(9));
    if (/^ability: /.test(tags.from || '')) {
      const ability = tags.from.slice(9);
      for (const mon of [subject, of]) if (mon && canHave(mon, ability)) { giveAbility(mon, ability); break; }
    }
  }

  const sets = [];
  const assumed = [];
  for (const mon of mons) {
    const species = dex.species.get(mon.species.replace(/-\*$/, ''));
    const abilities = Object.values(species.abilities || {});
    const notes = [];
    let ability = mon.ability;
    if (!ability && abilities.length === 1) ability = abilities[0];
    if (!ability) { ability = abilities[0] || ''; notes.push(`ability ${ability || 'none'} (one of ${abilities.join(', ')})`); }
    if (mon.item === null) notes.push('no item');
    notes.push('a neutral nature');
    if (mon.moves.length < 4) notes.push(`${mon.moves.length} move${mon.moves.length === 1 ? '' : 's'} seen`);
    const name = mon.name || species.name;
    sets.push({
      name,
      species: species.name,
      item: mon.item || '',
      ability,
      moves: mon.moves,
      nature: 'Serious',
      gender: mon.gender,
      shiny: mon.shiny,
      level: mon.level || 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    });
    assumed.push({ name, notes });
  }
  return { sets, assumed };
}

/**
 * A sheet's sets as the log shows them: Open Team Sheets publish neither a
 * nickname nor shininess, and both are printed in every line that names the
 * Pokemon, so they are taken from the log, matched by species.
 */
export function withLogIdentity(sets, lines, side, formatid) {
  const seen = setsFromLog(lines, side, formatid).sets;
  return sets.map((set) => {
    const mon = seen.find(m => sameSpecies(m.species, set.species || set.name));
    return mon ? { ...set, name: mon.name, shiny: mon.shiny, gender: mon.gender || set.gender } : set;
  });
}

/**
 * Check a supplied team against what a log shows of it, for a replay with no
 * team sheet: the Pokemon it previewed, every move each one used, and the item
 * and ability each one showed.
 */
export function crossCheckLog(lines, side, formatid, packedTeam) {
  const { sets } = setsFromLog(lines, side, formatid);
  const mine = Teams.unpack(packedTeam);
  const problems = [];
  for (const seen of sets) {
    const got = mine.find(s => sameSpecies(s.species || s.name, seen.species));
    if (!got) { problems.push(`${seen.species} appears in the log but not in the supplied team`); continue; }
    const moves = (got.moves || []).map(toID);
    for (const move of seen.moves) if (!moves.includes(toID(move))) problems.push(`${seen.species} used ${move}, which the supplied set lacks`);
  }
  return problems;
}

/**
 * Which supplied team belongs to which side, read off the species each side
 * previewed: a player's own team can sit on either side of someone else's
 * replay.
 */
export function teamsForSides(lines, teams) {
  const previewed = ['p1', 'p2'].map(side => lines
    .filter(l => l.startsWith(`|poke|${side}|`))
    .map(l => toID(parseDetails(l.split('|')[3]).species)));
  const overlap = (packed, i) => (packed ? Teams.unpack(packed) : [])
    .filter(s => previewed[i].some(sp => sameSpecies(sp, s.species || s.name))).length;
  const straight = overlap(teams[0], 0) + overlap(teams[1], 1);
  const swapped = overlap(teams[1], 0) + overlap(teams[0], 1);
  return swapped > straight ? [teams[1], teams[0]] : teams;
}

/**
 * Choices in an input log that the simulator will refuse to replay.
 *
 * `getChoice()` (`sim/side.ts:331`) records a target only when `targetLoc` is
 * non-zero, and an auto-chosen target leaves it zero - so a move needing a
 * target can be written down without one. Replaying that line takes the
 * explicit path, which rejects it (`sim/side.ts:663`). The log is unreplayable
 * through no fault of ours; `docs/engineering.md` 6.1 documents the same defect
 * arriving via `/choose default`.
 *
 * Worth naming out loud: a source with any of these cannot be reproduced
 * exactly, because the choice that was really made cannot be expressed.
 */
export function unreplayableChoices(inputLog, dex) {
  const choosable = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);
  const found = new Set();
  for (const line of inputLog || []) {
    const m = /^>p[1-4] (.+)$/.exec(String(line));
    if (!m || m[1].startsWith('team ')) continue;
    for (const part of m[1].split(',')) {
      const choice = part.trim();
      if (!choice.startsWith('move ')) continue;
      const rest = choice.slice(5)
        .replace(/ (mega|megax|megay|zmove|ultra|dynamax|gigantamax|max|terastallize)$/, '');
      if (/ [-+]?[1-3]$/.test(rest)) continue;
      const move = dex.moves.get(rest.trim());
      if (move.exists && choosable.has(move.target)) found.add(move.name);
    }
  }
  return [...found];
}

/**
 * Normalise any source into `{ kind, formatid, players, packedTeams, lines,
 * inputLog, seed }`.
 *
 * `lines` is the observed protocol log, exactly as watched - no filtering, so
 * the caller can decide what noise means.
 */
export function loadSource(file) {
  const raw = fs.readFileSync(file, 'utf8');

  if (file.endsWith('.log.json')) {
    const data = JSON.parse(raw);
    const inputLog = Array.isArray(data.inputLog) ? data.inputLog : String(data.inputLog || '').split('\n');
    const players = playerOptionsFromInputLog(inputLog);
    const start = inputLog.find(l => l.startsWith('>start '));
    const options = start ? JSON.parse(start.slice(start.indexOf('{'))) : {};
    return {
      kind: 'recording',
      file,
      formatid: options.formatid || toID(data.format || ''),
      players: players.map(p => p.name),
      packedTeams: players.map(p => p.team),
      sheets: sheetsFromLog(data.log || []),
      lines: data.log || [],
      inputLog,
      seed: options.seed || data.seed || null,
    };
  }

  if (file.endsWith('.html')) {
    const lines = logFromReplayHtml(raw);
    return {
      kind: 'replay',
      file,
      formatid: formatFromTier(lines),
      players: playersFromLog(lines),
      packedTeams: [null, null], // a replay never carries stat points
      sheets: sheetsFromLog(lines),
      lines,
      inputLog: null,
      seed: null,
    };
  }

  throw new Error(`unsupported source "${file}" - expected a .log.json or a saved .html replay`);
}
