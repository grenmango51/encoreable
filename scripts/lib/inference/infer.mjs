/**
 * Which Stat Point spreads could have produced this replay.
 *
 * Open Team Sheets publish everything but the spread, so a Pokemon's unknown is
 * six numbers, 0-32 each, at most 66 in total. Inference starts from every legal
 * spread and removes the ones the battle rules out. A spread is removed only when
 * the simulator itself says it could not have produced what the log shows - no
 * damage, speed or HP arithmetic of ours decides anything.
 *
 *   knowledge.mjs  what is still possible per Pokemon, and how a guess is picked
 *   evidence.mjs   one replay of a scaffold, the simulator hooked at every hit,
 *                  HP change and held-item check
 *   speed.mjs      speed order from every sort the simulator makes by speed
 *   infer.mjs      the rounds
 *
 * The replay needs a scaffold - some spread that reproduces the log, so that
 * every hit happens in the position it really happened in. The position does not
 * depend on which consistent spread built it, only the exact HP does, and that is
 * exactly what each candidate tracks for itself. So `inferSpreads` alternates:
 * reconstruct with a guess, collect the evidence up to where it diverged, move
 * the guess inside what survived, and go again until the whole log reproduces.
 * Each round hands the next the exact HP it proved and the dice that rebuild it.
 */

import { createRequire } from 'module';

import { disguisableStays, identName, identSide, reconstruct, sampler, unsettledDisguises } from '../reconstruct.mjs';
import {
  BUDGET, FLAT, SPAN, STAT_IDS, aimFor, cloneKnowledge, closestSpread, containsSpread, defaultSpread, freshKnowledge, fullEvs,
  intersectKnowledge, keyOf, maskKeys, packKnowledge, pinKnowledge, sameSpread, spreadAt, spreadsLeft, summarise, tighten, uniteKnowledge,
} from './knowledge.mjs';
import { evidencePass } from './evidence.mjs';

const require = createRequire(import.meta.url);
const { Dex, Teams, toID } = require('pokemon-showdown');

/**
 * The dice that rebuild a scaffold's verified turns under the next guess.
 *
 * Within those turns the same dice are thrown in the same order whatever the
 * spread - accuracy, crits and procs keep the faces the scaffold settled - and
 * only the damage rolls must change, to the ones the evidence path chose for the
 * new spreads. The path also runs into the failing turn as far as it was
 * proved, so its rolls there are handed on too; the scaffold's other dice on
 * that turn are not, since the search that failed there chose them. A spread
 * that throws a different sequence is caught by `reconstruct`, which drops the
 * pins from that turn on.
 */
function handOn(built, rolls) {
  const failed = built.report.diffs[0]?.turn ?? Infinity;
  const { subs, turns } = built.pins;
  const out = { subs: {}, turns: {} };
  const put = (i, v, upTo) => {
    if (!(turns[i] <= upTo)) return;
    out.subs[i] = v;
    out.turns[i] = turns[i];
  };
  for (const [i, v] of Object.entries(subs)) put(i, v, failed - 1);
  for (const [i, r] of rolls || []) put(i, r, failed);
  return out;
}

/**
 * Infer the Stat Points of every side marked unknown from a replay.
 *
 * @param sets     both teams as set objects - everything the sheets publish. A
 *                 known side's sets carry their real Stat Points.
 * @param known    `[p1Known, p2Known]`
 * @param allSpent assume every unknown set spends all 66 points, as real sets do.
 *                 An assumption, not evidence: off unless asked for.
 * @returns the surviving spreads per Pokemon, the events that removed the rest,
 *          and the reconstruction built from the spread it settled on.
 */
export async function inferSpreads({
  formatid,
  sets,
  known,
  playerNames,
  observed,
  channel = 1,
  sampleSeed = 1,
  maxProbes = 4000,
  maxRounds = 16,
  allSpent = false,
  threads,
  onProgress = () => {},
  forced = null,
  readings = true,
}) {
  const options = arguments[0];
  const dex = Dex.forFormat(formatid);
  const lines = observed.filter(l => typeof l === 'string');

  // Where a side's HP is printed exactly, its max HP is printed too, and that
  // is the HP stat outright. Only the first guess uses it; the evidence pass
  // derives it again from the simulator.
  const exactHp = new Map();
  for (const line of lines) {
    const parts = line.split('|');
    if (!['switch', 'drag', 'replace'].includes(parts[1])) continue;
    const side = identSide(parts[2]);
    const m = /^(\d+)\/(\d+)$/.exec(String(parts[4] || '').split(' ')[0]);
    if (m && Number(m[2]) !== 100 && (channel === -1 || side === `p${channel}`)) {
      exactHp.set(`${side}:${identName(parts[2])}`, Number(m[2]));
    }
  }

  const blank = new Map();
  for (const [s, team] of sets.entries()) {
    for (const [i, set] of team.entries()) blank.set(`p${s + 1}:${i}`, freshKnowledge(set, known[s], allSpent));
  }
  let picks = sets.map((team, s) => team.map((set) => {
    if (known[s]) return fullEvs(set.evs);
    const max = exactHp.get(`p${s + 1}:${set.name || set.species}`);
    const base = dex.species.get(set.species || set.name).baseStats.hp;
    return defaultSpread(dex, set, max ? max - base - 75 : undefined);
  }));

  const settle = async (inputLog, knowledge, cache, record = false) => {
    const counts = () => new Map([...knowledge].map(([id, kn]) => [id, spreadsLeft(kn)]));
    const initial = record ? counts() : null;
    let first = null;
    let afterFirst = null;
    let passes = 0;
    while (passes < 8) {
      const pass = await evidencePass({ inputLog, observed: lines, channel, knowledge, cache, record: record && !first });
      passes++;
      let moved = false;
      for (const r of pass.recs) moved = intersectKnowledge(knowledge.get(r.id), r.keys, r.flat, r.ties) || moved;
      for (const kn of knowledge.values()) moved = tighten(kn) || moved;
      if (!first) {
        first = pass;
        if (record) afterFirst = counts();
      }
      if (!moved) break;
    }
    return {
      events: first.events,
      checks: first.checks,
      cutoff: first.cutoff,
      seen: new Set(first.recs.filter(r => r.seen).map(r => r.id)),
      initial,
      afterFirst,
      passes,
    };
  };

  const knowledge = cloneKnowledge(blank);
  let built = null;
  let rounds = 0;
  let level = 0;
  let exact = null;
  let pins = null;
  const started = Date.now();
  // One seed for every round, so the dice a round hands on land on the same
  // generator: an ordinal nobody pinned draws the same value every time.
  const seed = sampler(sampleSeed ^ 0x5eed).seed();

  // A wrong guess makes a turn that no die can repair, and a full search spends
  // its whole budget proving that. So a guess is first tried on a small budget,
  // and a bigger one is only spent on a guess the evidence has no quarrel with.
  // The last resort samples differently: the search's own uniform choices can
  // corner it where a different draw of them would not.
  const budgets = [
    { maxProbes: Math.min(maxProbes, 150), maxBacktracks: 0 },
    { maxProbes: Math.min(maxProbes, 600), maxBacktracks: 2 },
    { maxProbes, maxBacktracks: 6 },
    { maxProbes, maxBacktracks: 6, resample: 1 },
  ];

  while (rounds < maxRounds) {
    rounds++;
    const packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const searchStart = Date.now();
    const resample = budgets[level].resample || 0;
    built = await reconstruct({
      formatid, packedTeams, playerNames, observed, channel, exact, forced: built?.forced ?? forced,
      seed: resample ? null : seed,
      pins: resample ? null : pins,
      sampleSeed: sampleSeed + resample,
      maxProbes: budgets[level].maxProbes,
      maxBacktracks: budgets[level].maxBacktracks,
      threads,
    });
    const diff = built.report.diffs[0];
    onProgress(`round ${rounds}${level ? ` (search ${level + 1})` : ''}, ${((Date.now() - searchStart) / 1000).toFixed(1)}s: ${built.report.complete ? 'the whole log reproduces'
      : `reproduces through turn ${built.report.verifiedThroughTurn} - wanted ${diff?.expected}, got ${diff?.actual}`}`);
    if (built.report.complete) break;

    const cache = new Map();
    const evidenceStart = Date.now();
    const { seen } = await settle(built.inputLog, knowledge, cache);

    // New guesses, chosen together. Each Pokemon is pinned before the next is
    // chosen, because two unknowns can each be possible alone and impossible
    // together; a pin that leaves a later Pokemon with nothing is taken back and
    // the next candidate tried. A full set is accepted only when, with all of it
    // pinned, the evidence can name one exact HP path through every verified
    // turn - and the next search is handed those turns exact, so it cannot
    // sample its way into a dead end there, along with the dice that rebuild
    // them, so it does not search them at all. A Pokemon the log never showed
    // keeps its guess: nothing about it can be wrong yet.
    const order = [];
    for (const [s, team] of sets.entries()) {
      if (known[s]) continue;
      for (const i of team.keys()) if (seen.has(`p${s + 1}:${i}`)) order.push([s, i]);
    }
    const next = picks.map(team => team.map(e => ({ ...e })));
    const emptied = kn => !kn.keys.includes(1) || FLAT.some(x => !kn.dom[x].includes(1));
    let tries = 32;
    const choose = async (n, cond) => {
      if (n === order.length) {
        tries--;
        const proof = await evidencePass({ inputLog: built.inputLog, observed: lines, channel, knowledge: cond, cache, exact: true });
        return proof.exact ? proof : null;
      }
      const [s, i] = order[n];
      const id = `p${s + 1}:${i}`;
      const kn = cond.get(id);
      const tried = [];
      for (const aim of [aimFor(kn, picks[s][i]), picks[s][i], aimFor(kn, picks[s][i], 0.25), aimFor(kn, picks[s][i], 0.75)]) {
        if (tries <= 0) return null;
        const first = closestSpread(kn, aim);
        if (!first) continue;
        // HP, Defence and Special Defence first, and the flat stats from what
        // survives beside them: one hit can tie the two together - Foul Play
        // reads the target's Attack against its own Defence.
        const keyed = cloneKnowledge(cond);
        const pinned = keyed.get(id);
        pinned.keys.fill(0);
        pinned.keys[keyOf(first.hp, first.def, first.spd)] = 1;
        tries--;
        await settle(built.inputLog, keyed, cache);
        const pick = closestSpread(pinned, aim);
        if (!pick || tried.some(t => sameSpread(t, pick))) continue;
        tried.push(pick);
        const narrowed = cloneKnowledge(cond);
        pinKnowledge(narrowed.get(id), pick);
        if (n < order.length - 1) {
          tries--;
          await settle(built.inputLog, narrowed, cache);
          if (order.slice(n + 1).some(([s2, i2]) => emptied(narrowed.get(`p${s2 + 1}:${i2}`)))) continue;
        }
        const found = await choose(n + 1, narrowed);
        if (found) { next[s][i] = pick; return found; }
      }
      return null;
    };
    const proof = await choose(0, cloneKnowledge(knowledge));
    exact = proof?.exact || null;
    pins = proof ? handOn(built, proof.rolls) : null;
    if (!exact) {
      for (const [s, i] of order) {
        const kn = knowledge.get(`p${s + 1}:${i}`);
        next[s][i] = closestSpread(kn, aimFor(kn, picks[s][i])) || next[s][i];
      }
    }
    onProgress(`  evidence and new guesses, ${((Date.now() - evidenceStart) / 1000).toFixed(1)}s${exact ? `, ${exact.size} turns exact` : ''}${pins ? `, ${Object.keys(pins.subs).length} dice handed on` : ''}`);
    const unchanged = next.every((team, s) => team.every((e, i) => sameSpread(e, picks[s][i])));
    if (unchanged) {
      // The evidence accepts this guess, so what failed was the dice search.
      if (++level >= budgets.length) break;
    } else {
      level = 0;
    }
    picks = next;
  }

  // A side with an Illusion user can have sent it in disguised as a teammate,
  // and the line that gives it away can be one only its own Stat Points
  // explain - a Speed no Stat Point of the teammate reaches. The rebuild alone
  // cannot prefer that reading before its Stat Points are narrowed under it,
  // so a battle that did not rebuild is inferred again under each reading of a
  // switch-in as the Illusion user, and the first that rebuilds is kept.
  if (!built.report.complete && readings) {
    const packed = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const failing = built.report.diffs[0]?.turn ?? Infinity;
    for (const { at, turn } of disguisableStays(formatid, packed, channel, observed)) {
      if (turn > failing || (built.forced || []).includes(at)) continue;
      onProgress(`reading the switch-in at line ${at} as the Illusion user`);
      const other = await inferSpreads({ ...options, forced: [at], readings: false });
      if (other.complete) return spareDisguises(other);
    }
  }

  const final = cloneKnowledge(blank);
  const result = await settle(built.inputLog, final, new Map(), true);
  for (const [id, kn] of final) {
    const had = knowledge.get(id);
    intersectKnowledge(kn, maskKeys(had.keys), had.dom, had.ties);
    tighten(kn);
  }

  const pokemon = [];
  for (const [s, team] of sets.entries()) {
    for (const [i, set] of team.entries()) {
      const id = `p${s + 1}:${i}`;
      const kn = final.get(id);
      pokemon.push({
        id,
        side: `p${s + 1}`,
        species: set.species || set.name,
        known: known[s],
        seen: result.seen.has(id),
        from: result.initial.get(id),
        afterEvents: result.afterFirst.get(id),
        ...summarise(kn),
        used: picks[s][i],
        contains: evs => containsSpread(kn, evs),
      });
    }
  }

  return spareDisguises({
    complete: built.report.complete,
    rounds,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    built,
    picks,
    pokemon,
    events: result.events,
    // Where a shortcut of the evidence pass disagreed with the simulator and
    // was not used: evidence given up, never a spread removed.
    checks: result.checks,
    cutoff: result.cutoff,
    passes: result.passes,
    knowledge: final,
  });

  /**
   * A switch-in nothing settles could have been the Illusion user in disguise
   * (`unsettledStays`), and then what it showed belongs to neither for
   * certain. The reading `res` was built under gives it to the Pokemon shown,
   * and none of it to the Illusion user. So each Pokemon shown in one is
   * inferred again with all of its unsettled switch-ins read as the Illusion
   * user, which gives it none of them, and every Pokemon of that side but the
   * Illusion user keeps whatever either reading leaves it. A reading that does
   * not rebuild when `res` does proves one of those switch-ins was the
   * Pokemon shown: with only one, nothing is added; with more, each is read
   * alone instead.
   */
  async function spareDisguises(res) {
    if (!readings) return res;
    const packed = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
    const base = res.built.forced || [];
    const groups = new Map();
    for (const stay of unsettledDisguises(formatid, packed, channel, observed)) {
      if (base.includes(stay.at)) continue;
      const key = `${stay.side}|${stay.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(stay);
    }
    for (const [key, stays] of groups) {
      const [side, name] = key.split('|');
      const s = Number(side[1]) - 1;
      onProgress(`reading ${name}'s unsettled switch-ins as the Illusion user`);
      const read = ats => inferSpreads({ ...options, forced: [...base, ...ats], readings: false });
      const all = await read(stays.map(x => x.at));
      let taken = all.complete || !res.complete ? [all] : [];
      if (!taken.length && stays.length > 1) {
        for (const stay of stays) {
          const one = await read([stay.at]);
          if (one.complete) taken.push(one);
        }
      }
      if (!taken.length) continue;
      for (const [i, set] of sets[s].entries()) {
        const id = `${side}:${i}`;
        if (known[s] || toID(set.ability) === 'illusion') continue;
        for (const other of taken) uniteKnowledge(res.knowledge.get(id), other.knowledge.get(id));
        tighten(res.knowledge.get(id));
        Object.assign(res.pokemon.find(p => p.id === id), summarise(res.knowledge.get(id)));
      }
      const from = [...new Set(stays.map(x => (x.turn ? `turn ${x.turn}` : 'the start')))].join(', ');
      const shown = sets[s].findIndex(set => (set.name || set.species) === name);
      res.checks.push({
        turn: stays[0].turn,
        what: `${name}, shown from ${from}`,
        ...(shown >= 0 ? { who: [{ id: `${side}:${shown}`, at: 0 }] } : {}),
        reason: 'it could have been the Illusion user, so what it showed was not used on its side',
      });
    }
    return res;
  }
}

/**
 * The inference as a recording carries it: each inferred Pokemon's ranges and
 * what survives for it, every event that narrowed one and every check, so a
 * recording opened later shows what the replay showed.
 */
export function inferenceRecord(inf, inferred, certified = null) {
  return {
    inferred,
    complete: inf.complete,
    rounds: inf.rounds,
    pokemon: inf.pokemon.filter(p => !p.known)
      .map(({ contains, known, ...rest }) => ({ ...rest, knowledge: packKnowledge(inf.knowledge.get(rest.id)) })),
    events: inf.events,
    checks: inf.checks,
    ...(certified ? { certified } : {}),
  };
}

/**
 * Which ends of each inferred range a rebuild proves: a spread at that end,
 * every other Pokemon where the inference left it, that reproduces the whole
 * log line for line. That rebuild is a witness anyone can replay. The search
 * has a budget, so an end it does not prove is not shown impossible. The
 * spreads the inference settled on are a witness already when they rebuilt.
 *
 * With `outside`, each range is also tried one Stat Point beyond each end, a
 * value the inference removed: a rebuild that reproduces the log there is a
 * spread removed wrongly - a defect found without knowing the real spreads.
 *
 * @returns per Pokemon id, per stat, `{ min, max }` as true (proved) or false,
 *          and `outside`, the values beyond an end that rebuilt the log.
 */
export async function certifyRanges(inf, {
  formatid, sets, playerNames, observed, channel = 1, sampleSeed = 1, maxProbes = 600, threads, outside = false, onProgress = () => {},
}) {
  const seed = sampler(sampleSeed ^ 0x5eed).seed();
  const tried = new Map();
  const signature = picks => JSON.stringify(picks.map(team => team.map(e => STAT_IDS.map(s => e[s]))));
  if (inf.complete) tried.set(signature(inf.picks), true);
  const witness = async (picks) => {
    const sig = signature(picks);
    if (!tried.has(sig)) {
      const packedTeams = sets.map((team, s) => Teams.pack(team.map((set, i) => ({ ...set, evs: picks[s][i] }))));
      const built = await reconstruct({
        formatid, packedTeams, playerNames, observed, channel, forced: inf.built.forced, seed, sampleSeed, maxProbes, maxBacktracks: 2, threads,
      });
      tried.set(sig, built.report.complete);
    }
    return tried.get(sig);
  };
  const out = {};
  const certifiable = inf.pokemon.filter(p => !p.known && p.seen && p.spreads);
  const placeOf = p => [Number(p.side[1]) - 1, Number(p.id.split(':')[1])];
  // First every Pokemon at the same end of one stat at once: one rebuild that
  // reproduces the log proves all those ends.
  const joint = new Map();
  for (const stat of STAT_IDS) {
    for (const end of ['min', 'max']) {
      const picks = inf.picks.map(team => team.map(e => ({ ...e })));
      let all = true;
      for (const p of certifiable) {
        const [s, i] = placeOf(p);
        const pick = p.stats[stat] && spreadAt(inf.knowledge.get(p.id), stat, p.stats[stat][end], inf.picks[s][i]);
        if (!pick) { all = false; break; }
        picks[s][i] = pick;
      }
      if (!all || !certifiable.length) continue;
      onProgress(`certifying every ${stat} ${end} at once`);
      if (await witness(picks)) joint.set(`${stat}|${end}`, true);
    }
  }
  for (const p of certifiable) {
    const [s, i] = placeOf(p);
    const kn = inf.knowledge.get(p.id);
    out[p.id] = {};
    for (const stat of STAT_IDS) {
      const range = p.stats[stat];
      if (!range) continue;
      out[p.id][stat] = {};
      for (const [end, value] of [['min', range.min], ['max', range.max]]) {
        if (joint.get(`${stat}|${end}`)) { out[p.id][stat][end] = true; continue; }
        const pick = spreadAt(kn, stat, value, inf.picks[s][i]);
        if (!pick) { out[p.id][stat][end] = false; continue; }
        const picks = inf.picks.map(team => team.map(e => ({ ...e })));
        picks[s][i] = pick;
        onProgress(`certifying ${p.species}'s ${stat} ${end} (${value})`);
        out[p.id][stat][end] = await witness(picks);
      }
      if (!outside) continue;
      out[p.id][stat].outside = [];
      for (const value of [range.min - 1, range.max + 1]) {
        if (value < 0 || value >= SPAN) continue;
        // The inference's own spread with this stat moved out, the others
        // lowered, largest first, where that breaks the budget.
        const pick = { ...inf.picks[s][i], [stat]: value };
        let over = STAT_IDS.reduce((t, x) => t + pick[x], 0) - BUDGET;
        for (const x of [...STAT_IDS].filter(y => y !== stat).sort((a, b) => pick[b] - pick[a])) {
          if (over <= 0) break;
          const cut = Math.min(over, pick[x]);
          pick[x] -= cut;
          over -= cut;
        }
        const picks = inf.picks.map(team => team.map(e => ({ ...e })));
        picks[s][i] = pick;
        onProgress(`trying ${p.species}'s ${stat} at ${value}, outside its range`);
        if (await witness(picks)) out[p.id][stat].outside.push(value);
      }
    }
  }
  return out;
}
