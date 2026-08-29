'use strict';

/**
 * `/rng` - name a random decision before the turn that would make it resolves.
 *
 * This file runs inside the Showdown server process. Provisioning copies it to
 * `runtime/config/rng-command.js`, and `config/config.js` hands its `commands`
 * table to `Chat.loadPlugin(Config, 'config')` (`server/chat.ts:2089`). Nothing
 * outside `config/` is touched.
 *
 * `Config.subprocesses = 0` puts the simulator in the main process
 * (`server/config-loader.ts:91` -> `room-battle.ts:1368` ->
 * `lib/process-manager.ts:633`), so `room.battle.stream.battle` is a live
 * `Battle` object this command can read and mutate synchronously. There is no
 * `>eval`, no payload string and no worker in between.
 *
 * Three things are grafted onto a battle:
 *
 *   1. An accessor on `battle.prng`. `>reseed` *replaces* the generator rather
 *      than reseeding it (`sim/battle.ts:361`), and every branched recording
 *      carries a `>reseed`, so an interceptor installed on the generator object
 *      itself dies silently at the first one.
 *   2. Wrappers on `random`, `randomChance`, `sample` and `shuffle` of whatever
 *      generator is current. `random` is the only primitive - `randomChance` is
 *      `random(d) < n`, `sample` is `random(len)`, `shuffle` is repeated
 *      `random(a, b)` - so the other three exist only to record what was asked
 *      for. That is what lets a rule say "make this proc" or "three hits"
 *      without a probability written down anywhere, which matters because the
 *      champions mod changes real odds.
 *   3. `>rng` as an input-log verb (`teachStream`). An armed rule is a line in
 *      the recipe, so a manipulated battle truncates, imports and re-simulates
 *      like any other.
 *
 * Every draw identifies itself from a stack frame plus the context the
 * simulator already maintains - `battle.effect`, `battle.activeMove`,
 * `battle.activePokemon`, `battle.activeTarget`, saved and restored around
 * every handler dispatch. `dist/` is esbuild output with function names
 * unmangled, so this survives compilation.
 *
 * Also required by `scripts/lib/rng-control.mjs`, which drives the same engine
 * headlessly.
 */

const RNG_FILE = 'rng-command.js';

/** Frames that only pass a draw along. The first survivor asked for it. */
const PASS_THROUGH = new Set([
	'PRNG.random', 'PRNG.randomChance', 'PRNG.sample', 'PRNG.shuffle',
	'Battle.random', 'Battle.randomChance', 'Battle.sample', 'Battle.shuffle',
	'rngRandom', 'rngRandomChance', 'rngSample', 'rngShuffle',
]);

const ALIAS = {
	sleep: 'slp', slp: 'slp', para: 'par', paralysis: 'par', par: 'par',
	freeze: 'frz', frozen: 'frz', frz: 'frz', burn: 'brn', brn: 'brn',
	poison: 'psn', psn: 'psn', confusion: 'confusion', confuse: 'confusion',
	protect: 'stall', stall: 'stall',
};

/**
 * `want` names the outcome, not the die face:
 *
 *   true / false   a coin flip that succeeds or fails
 *   low / high     the smallest or largest *value* - the index of the smallest
 *                  entry of a sampled array, or band 0 / d-1 without one
 *   band0 / bandN  a literal band. `randomizer` is `100 - random(16)`, so band 0
 *                  is maximum damage and band 15 is minimum - inverted against
 *                  the value, which is why max/min damage are bands and not
 *                  high/low.
 *   =n             the draw whose result is n
 *   shuffle        the index, inside the shuffle window, of the flagged Pokemon
 *
 * One condition asks for several unrelated numbers - confusion draws a
 * duration, then a coin flip every turn, then a damage roll if it connects - so
 * an effect is never enough on its own. Every entry pins the handler too.
 */
const OUTCOMES = {
	crit: { site: 'getDamage', want: 'true', who: 'user', targeted: 1 },
	nocrit: { site: 'getDamage', want: 'false', who: 'user', targeted: 1 },
	hit: { site: 'hitStepAccuracy', want: 'true', who: 'user', targeted: 1 },
	miss: { site: 'hitStepAccuracy', want: 'false', who: 'user', targeted: 1 },
	maxdmg: { site: 'randomizer', want: 'band0', who: 'user', targeted: 1 },
	mindmg: { site: 'randomizer', want: 'bandlast', who: 'user', targeted: 1 },
	proc: { proc: 1, want: 'true', who: 'any' },
	noproc: { proc: 1, want: 'false', who: 'any' },
	fullpara: { effect: 'par', site: 'onBeforeMove', want: 'true', who: 'holder' },
	nopara: { effect: 'par', site: 'onBeforeMove', want: 'false', who: 'holder' },
	confused: { effect: 'confusion', site: 'onBeforeMove', want: 'true', who: 'holder' },
	clear: { effect: 'confusion', site: 'onBeforeMove', want: 'false', who: 'holder' },
	protect: { effect: 'stall', site: 'onStallMove', want: 'true', who: 'holder' },
	breakprotect: { effect: 'stall', site: 'onStallMove', want: 'false', who: 'holder' },
	wake: { effect: 'slp|frz', site: 'onStart|onBeforeMove', want: 'low', who: 'holder' },
	stay: { effect: 'slp|frz', site: 'onStart|onBeforeMove', want: 'high', who: 'holder' },
	wins: { site: 'speedSort', want: 'shuffle', who: 'shuffle' },
};

const OUTCOME_WORDS = [
	'crit', 'nocrit', 'hit', 'miss', 'proc', 'noproc', 'maxdmg', 'mindmg',
	'wake', 'stay', 'confused', 'clear', 'protect', 'breakprotect',
	'fullpara', 'nopara', 'wins', 'roll<0-15>', 'hits<2-5>', '<kind>=<value>',
];

function toId(text) {
	return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The outcome word, resolved to a matcher, or null. */
function outcomeSpec(word) {
	if (OUTCOMES[word]) return OUTCOMES[word];
	let m = /^roll(\d+)$/.exec(word);
	if (m) return { site: 'randomizer', want: Number(m[1]), who: 'user', targeted: 1 };
	m = /^hits(\d+)$/.exec(word);
	if (m) return { site: 'hitStepMoveHitLoop', want: `=${m[1]}`, who: 'user' };
	m = /^([a-z]+)=([a-z0-9]+)$/.exec(word);
	if (!m) return null;
	const kind = m[1];
	const val = m[2];
	let want = null;
	if (val === 'full' || val === 'true' || val === 'yes' || val === 'on') want = 'true';
	else if (val === 'none' || val === 'false' || val === 'no' || val === 'off') want = 'false';
	else if (val === 'min') want = 'low';
	else if (val === 'max') want = 'high';
	else if (/^\d+$/.test(val)) want = `=${val}`;
	if (want === null) return null;
	return { effect: ALIAS[kind] || kind, site: kind, loose: 1, want, who: 'any' };
}

// ------------------------------------------------------------------ the state

function newState(battle) {
	return {
		version: 2,
		battle,
		rules: [],
		nextId: 1,
		notes: [],
		draws: 0,
		subs: 0,
		skipped: 0,
		reseeds: 0,
		sinceReseed: 0,
		ready: false,
		prng: null,
		// Per-draw scratch, saved and restored around every nested call.
		d: 0,
		off: 0,
		n: null,
		items: null,
		shuffle: null,
		// Non-null while a dry run is in flight: no draw is consumed and no
		// rule is matched. `roll` is the band handed to `randomizer`.
		dry: null,
	};
}

function tail(list, cap) {
	while (list.length > cap) list.shift();
}

function leaf(name) {
	const dot = name.lastIndexOf('.');
	return dot < 0 ? name : name.slice(dot + 1);
}

/** The call sites above this draw, nearest first, pass-throughs removed. */
function framesOf() {
	const raw = (new Error()).stack || '';
	const lines = raw.split('\n');
	const out = [];
	for (let i = 1; i < lines.length && out.length < 6; i++) {
		if (lines[i].indexOf(RNG_FILE) >= 0) continue;
		const m = /at (?:new |async )?([A-Za-z0-9_$.<>[\]]+)/.exec(lines[i]);
		if (!m) continue;
		if (PASS_THROUGH.has(m[1])) continue;
		out.push(m[1]);
	}
	return out;
}

function contextOf(st, d) {
	const battle = st.battle;
	const frames = framesOf();
	const eff = battle.effect || null;
	const ev = battle.event || null;
	const holder = (ev && ev.target) || (battle.effectState && battle.effectState.target) || null;
	return {
		d,
		off: st.off,
		n: st.n,
		items: st.items,
		shuffle: st.shuffle,
		site: frames.length ? leaf(frames[0]) : '',
		frames,
		effectId: eff ? eff.id : '',
		effectType: eff ? eff.effectType : '',
		moveId: battle.activeMove ? battle.activeMove.id : '',
		user: battle.activePokemon || null,
		target: battle.activeTarget || null,
		holder,
	};
}

/**
 * A proc is a chance an ability or an item took, or a move's own secondary.
 * Secondary and self-boost are both `random(100)` inside the same move and are
 * still told apart, because different functions ask for them.
 */
function isProc(ctx) {
	if (ctx.site === 'secondaries' || ctx.site === 'selfDrops') return true;
	return ctx.n !== null && (ctx.effectType === 'Ability' || ctx.effectType === 'Item');
}

function oneOf(list, value) {
	return list.split('|').indexOf(value) >= 0;
}

/** The Pokemon a shuffled entry belongs to: a Pokemon, or an action carrying one. */
function entryPokemon(entry) {
	if (!entry || typeof entry !== 'object') return null;
	if (entry.side && entry.baseSpecies) return entry;
	if (entry.pokemon) return entry.pokemon;
	return null;
}

/** The index of `pokemon` inside a shuffle window, or -1. */
function shuffleIndex(shuffle, pokemon) {
	if (!shuffle || !pokemon) return -1;
	for (let i = shuffle.start; i < shuffle.end; i++) {
		if (entryPokemon(shuffle.items[i]) === pokemon) return i;
	}
	return -1;
}

function matches(rule, ctx) {
	const s = rule.spec;
	let ok;
	if (s.proc) {
		ok = isProc(ctx);
	} else if (s.loose) {
		ok = oneOf(s.effect, ctx.effectId) || ctx.site.toLowerCase() === s.site;
	} else {
		ok = true;
		if (s.effect) ok = oneOf(s.effect, ctx.effectId);
		if (ok && s.site) ok = oneOf(s.site, ctx.site);
	}
	if (!ok) return false;
	if (rule.move && ctx.moveId !== rule.move) return false;
	if (rule.target && ctx.target !== rule.target) return false;
	if (s.who === 'shuffle') return shuffleIndex(ctx.shuffle, rule.subject) >= 0;
	if (rule.subject) {
		const pool = s.who === 'user' ? [ctx.user] :
			s.who === 'holder' ? [ctx.holder, ctx.target] :
			[ctx.user, ctx.holder, ctx.target];
		if (pool.indexOf(rule.subject) < 0) return false;
	}
	return true;
}

function extreme(items, dir) {
	let best = 0;
	for (let i = 1; i < items.length; i++) {
		if (dir > 0 ? items[i] > items[best] : items[i] < items[best]) best = i;
	}
	return best;
}

/**
 * The band in [0, d) to substitute, or the reason there is not one.
 *
 * A 100%-accuracy move draws `randomChance(100, 100)`, which cannot be made
 * false; Icicle Spear cannot hit nine times. Saying so beats substituting
 * something close.
 */
function resolveBand(rule, ctx) {
	const want = rule.spec.want;
	const d = ctx.d;
	const items = ctx.items;
	let band = null;
	if (want === 'true') {
		if (ctx.n !== null && ctx.n <= 0) return { band: null, why: 'always-false' };
		band = 0;
	} else if (want === 'false') {
		if (ctx.n !== null && ctx.n >= d) return { band: null, why: 'always-true' };
		band = d - 1;
	} else if (want === 'low') {
		band = items ? extreme(items, -1) : 0;
	} else if (want === 'high') {
		band = items ? extreme(items, 1) : d - 1;
	} else if (want === 'band0') {
		band = 0;
	} else if (want === 'bandlast') {
		band = d - 1;
	} else if (want === 'shuffle') {
		const index = shuffleIndex(ctx.shuffle, rule.subject);
		if (index < 0) return { band: null, why: 'not-in-tie' };
		band = index - ctx.off;
	} else if (typeof want === 'number') {
		band = want;
	} else {
		// '=n' names the value the caller wanted back. A sample() draw finds it
		// in the array it was handed; random(from, to) subtracts the offset. An
		// array of strings - Tri Attack's three statuses - holds no such value,
		// so there n falls back to naming the entry.
		const v = Number(want.slice(1));
		if (!items) band = v - ctx.off;
		else band = items.indexOf(v) >= 0 ? items.indexOf(v) : v;
	}
	if (band === null || band < 0 || band >= d) return { band: null, why: 'unreachable' };
	return { band, why: '' };
}

function note(st, rule, ctx, real, forced, why) {
	st.notes.push(
		`${forced === null ? 'skip' : 'force'} #${rule.id} ${rule.word} d=${ctx.d}` +
		` site=${ctx.site || '?'}${ctx.effectId ? ` eff=${ctx.effectId}` : ''}` +
		`${ctx.moveId ? ` mv=${ctx.moveId}` : ''} ${real}${forced === null ? '' : `->${forced}`}` +
		`${why ? ` (${why})` : ''}`
	);
	tail(st.notes, 200);
}

// ------------------------------------------------------------- the interceptor

function hook(st, p) {
	if (!p || p.__rngHooked) return;
	p.__rngHooked = true;

	const origRandom = p.random;
	const origChance = p.randomChance;
	const origSample = p.sample;
	const origShuffle = p.shuffle;

	p.random = function rngRandom(from, to) {
		let d, off;
		if (from === undefined) { d = 0; off = 0; } else if (!to) {
			d = Math.floor(from); off = 0;
		} else { off = Math.floor(from); d = Math.floor(to) - off; }

		// A dry run must not touch the generator (§4.4). Only `randomizer` gets
		// the requested band; anything else takes the bottom of its range.
		if (st.dry) {
			if (!d) return 0;
			const site = leaf(framesOf()[0] || '');
			return off + (site === 'randomizer' ? Math.min(st.dry.roll, d - 1) : 0);
		}

		const prevD = st.d;
		const prevOff = st.off;
		st.d = d;
		st.off = off;
		try {
			const real = origRandom.call(this, from, to);
			st.draws++;
			st.sinceReseed++;
			if (!st.rules.length || d <= 0) return real;
			const ctx = contextOf(st, d);
			let rule = null;
			for (const candidate of st.rules) {
				if (matches(candidate, ctx)) { rule = candidate; break; }
			}
			if (!rule) return real;
			rule.tries++;
			const got = resolveBand(rule, ctx);
			if (got.band === null) {
				st.skipped++;
				rule.skipped++;
				note(st, rule, ctx, real, null, got.why);
				return real;
			}
			const forced = got.band + off;
			rule.fired++;
			st.subs++;
			note(st, rule, ctx, real, forced, '');
			return forced;
		} finally {
			st.d = prevD;
			st.off = prevOff;
		}
	};

	p.randomChance = function rngRandomChance(numerator, denominator) {
		const prev = st.n;
		st.n = numerator;
		try {
			return origChance.call(this, numerator, denominator);
		} finally {
			st.n = prev;
		}
	};

	p.sample = function rngSample(items) {
		const prev = st.items;
		st.items = items;
		try {
			return origSample.call(this, items);
		} finally {
			st.items = prev;
		}
	};

	p.shuffle = function rngShuffle(items, start, end) {
		const prev = st.shuffle;
		st.shuffle = {
			items,
			start: start === undefined ? 0 : start,
			end: end === undefined ? items.length : end,
		};
		try {
			return origShuffle.call(this, items, start, end);
		} finally {
			st.shuffle = prev;
		}
	};
}

/**
 * Installs the interceptor, idempotently.
 *
 * The accessor is the whole point: `resetRNG` assigns `this.prng = new PRNG()`,
 * so control installed on the generator object dies at the first `>reseed` -
 * silently, because the battle carries on and simply never matches again.
 */
function install(battle) {
	if (battle.__rng) return battle.__rng;
	if (Error.stackTraceLimit < 25) Error.stackTraceLimit = 25;

	const st = newState(battle);
	battle.__rng = st;

	const current = battle.prng;
	Object.defineProperty(battle, 'prng', {
		configurable: true,
		enumerable: true,
		get() { return st.prng; },
		set(p) {
			st.prng = p;
			if (st.ready) { st.reseeds++; st.sinceReseed = 0; }
			hook(st, p);
		},
	});
	battle.prng = current;
	st.ready = true;
	return st;
}

// ------------------------------------------------------------------- the rules

/** `p1:glalie`, the form a rule records and replays. */
function refOf(pokemon) {
	return `${pokemon.side.id}:${toId(pokemon.name)}`;
}

/**
 * A species or nickname, optionally side-qualified, resolved against the teams.
 * Matching is by team identity rather than by slot: `p1a` silently becomes
 * someone else after a switch.
 */
function findPokemon(battle, text) {
	if (!text || text === 'any' || text === '-') return { pokemon: null, why: '' };
	let wantSide = -1;
	let name = text;
	const m = /^p([1-4]):(.*)$/.exec(text);
	if (m) { wantSide = Number(m[1]) - 1; name = m[2]; }
	const id = toId(name);
	const hits = [];
	for (let i = 0; i < battle.sides.length; i++) {
		if (wantSide >= 0 && i !== wantSide) continue;
		for (const p of battle.sides[i].pokemon) {
			if (toId(p.name) === id || p.species.id === id || p.baseSpecies.id === id) hits.push(p);
		}
	}
	if (!hits.length) return { pokemon: null, why: `no Pokemon named "${text}"` };
	if (wantSide < 0 && hits.length > 1) {
		return { pokemon: null, why: `"${text}" is on both teams - use p1: or p2:` };
	}
	return { pokemon: hits[0], why: '' };
}

function ruleText(rule) {
	return `${rule.word} ${rule.subjectRef}` +
		`${rule.move ? ` ${rule.move}` : ''}` +
		`${rule.targetRef !== 'any' ? ` vs ${rule.targetRef}` : ''}`;
}

/**
 * Arms one rule and records it.
 *
 * `record` is the input-log line to append, and it is the line that was
 * *applied* rather than a canonical rewriting of it - a replay of a recording
 * has to push back exactly what it read, or the round-trip stops being
 * byte-identical.
 */
function arm(battle, parts, record) {
	const st = install(battle);
	const word = String(parts.outcome || '').toLowerCase();
	const spec = outcomeSpec(word);
	if (!spec) return { error: `"${parts.outcome}" is not an outcome. Try: ${OUTCOME_WORDS.join(' ')}` };

	const subject = findPokemon(battle, parts.subject);
	if (subject.why) return { error: subject.why };
	const target = findPokemon(battle, parts.target);
	if (target.why) return { error: target.why };
	if (target.pokemon && !spec.targeted) {
		return { error: `${word} is not rolled per target - drop the target qualifier` };
	}

	const rule = {
		id: st.nextId++,
		word,
		spec,
		subject: subject.pokemon,
		subjectRef: subject.pokemon ? refOf(subject.pokemon) : 'any',
		move: parts.move ? toId(parts.move) : '',
		target: target.pokemon,
		targetRef: target.pokemon ? refOf(target.pokemon) : 'any',
		turn: battle.turn,
		tries: 0,
		fired: 0,
		skipped: 0,
	};
	st.rules.push(rule);
	battle.inputLog.push(record);
	return { rule };
}

function clear(battle, which, record) {
	const st = battle.__rng;
	if (!st) {
		battle.inputLog.push(record);
		return { gone: 0 };
	}
	const before = st.rules.length;
	st.rules = st.rules.filter(r => which !== 'all' && String(r.id) !== String(which));
	battle.inputLog.push(record);
	return { gone: before - st.rules.length };
}

/** How many arm and clear lines the input log carries - the D7 trap, made visible. */
function recordedLines(battle) {
	if (!battle || !battle.inputLog) return 0;
	return battle.inputLog.filter(l => l.startsWith('>rng ')).length;
}

/** The armed rules and the accounting, as plain data. Live state, never memory. */
function snapshot(battle) {
	const st = battle && battle.__rng;
	const base = {
		turn: battle ? battle.turn : 0,
		draws: 0,
		forced: 0,
		skipped: 0,
		reseeds: 0,
		drawsSinceReseed: 0,
		recorded: recordedLines(battle),
		rules: [],
	};
	if (!st) return base;
	return {
		turn: battle.turn,
		recorded: recordedLines(battle),
		draws: st.draws,
		forced: st.subs,
		skipped: st.skipped,
		reseeds: st.reseeds,
		drawsSinceReseed: st.sinceReseed,
		notes: st.notes.slice(),
		rules: st.rules.map(r => ({
			id: r.id,
			outcome: r.word,
			subject: r.subjectRef,
			move: r.move,
			target: r.targetRef,
			turn: r.turn,
			matched: r.tries,
			forced: r.fired,
			skipped: r.skipped,
			text: ruleText(r),
		})),
	};
}

// ------------------------------------------------------------- the input log

/**
 * `>rng force <outcome> <subject> <move|-> <target|->`
 * `>rng clear <id|all>`
 */
function parseLine(message) {
	const parts = String(message || '').trim().split(/\s+/).filter(Boolean);
	const verb = (parts.shift() || '').toLowerCase();
	if (verb === 'clear') return { verb, which: (parts[0] || 'all').toLowerCase() };
	if (verb !== 'force') return { error: `unknown >rng verb "${verb}"` };
	if (!parts.length) return { error: 'name an outcome' };
	return {
		verb,
		outcome: parts[0],
		subject: parts.length > 1 ? parts[1] : 'any',
		move: parts.length > 2 && parts[2] !== '-' ? parts[2] : '',
		target: parts.length > 3 && parts[3] !== '-' ? parts[3] : 'any',
	};
}

function applyLine(battle, message) {
	const parsed = parseLine(message);
	if (parsed.error) throw new Error(`">rng ${message}": ${parsed.error}`);
	const record = `>rng ${message}`;
	if (parsed.verb === 'clear') return clear(battle, parsed.which, record);
	const result = arm(battle, parsed, record);
	if (result.error) throw new Error(`">rng ${message}": ${result.error}`);
	return result;
}

/** The line a chat-armed rule records. */
function forceLine(parts) {
	return `force ${parts.outcome} ${parts.subject || 'any'} ${parts.move || '-'} ${parts.target || '-'}`;
}

/**
 * Adds `>rng` to the input-log grammar of a `BattleStream` class, idempotently.
 *
 * Without this an armed rule would have to be an `>eval`, which dumps its own
 * source into the battle log and needs console access to import. With it a rule
 * is an ordinary recipe line: `truncateAtTurn`, `/importinputlog` and a plain
 * re-simulation all carry it. Must be in place before any room is created.
 */
function teachStream(BattleStream) {
	const proto = BattleStream && BattleStream.prototype;
	if (!proto || proto.__rngTaught) return BattleStream;
	proto.__rngTaught = true;
	const original = proto._writeLine;
	proto._writeLine = function (type, message) {
		if (type !== 'rng') return original.call(this, type, message);
		if (!this.battle) throw new Error('">rng" before ">start"');
		applyLine(this.battle, message);
	};
	return BattleStream;
}

// -------------------------------------------------------------- the dry runs

/** How many targets this move would hit right now - 2+ means the spread modifier. */
function targetCount(battle, source, move) {
	const kind = move.target;
	if (kind === 'allAdjacentFoes') return source.side.foe.active.filter(p => p && !p.fainted).length;
	if (kind === 'allAdjacent') {
		const foes = source.side.foe.active.filter(p => p && !p.fainted).length;
		const allies = source.side.active.filter(p => p && !p.fainted && p !== source).length;
		return foes + allies;
	}
	return 1;
}

/**
 * The sixteen damage values one hit can produce, band 0 first.
 *
 * STAB, type effectiveness and burn are applied *after* the random factor, each
 * with its own truncation, so the sixteen cannot be derived arithmetically from
 * one. They are sixteen real `getDamage` calls under four guards: a cloned move,
 * an explicit `willCrit` so no crit die is drawn, no-consume mode so the
 * generator is untouched, and `suppressMessages` so `modifyDamage` writes no
 * `-supereffective` line. Stellar state and the log are snapshotted and
 * restored, because `modifyDamage` mutates both.
 */
function damageLadder(battle, source, target, moveName, crit) {
	const st = install(battle);
	const dex = battle.dex;
	const base = dex.moves.get(moveName);
	if (!base.exists) return { error: `no move named "${moveName}"` };

	const spread = targetCount(battle, source, base) > 1;
	const savedStellar = source.stellarBoostedTypes ? source.stellarBoostedTypes.slice() : null;
	const savedLog = battle.log.length;
	const savedMove = battle.activeMove;
	const savedTarget = battle.activeTarget;
	const savedUser = battle.activePokemon;

	const values = [];
	try {
		for (let roll = 0; roll < 16; roll++) {
			const move = dex.getActiveMove(base);
			move.willCrit = !!crit;
			if (spread) move.spreadHit = true;
			st.dry = { roll };
			let damage = null;
			try {
				damage = battle.actions.getDamage(source, target, move, true);
			} catch (err) {
				damage = null;
			} finally {
				st.dry = null;
			}
			values.push(typeof damage === 'number' ? damage : null);
		}
	} finally {
		st.dry = null;
		battle.activeMove = savedMove;
		battle.activeTarget = savedTarget;
		battle.activePokemon = savedUser;
		if (savedStellar) {
			source.stellarBoostedTypes.length = 0;
			for (const type of savedStellar) source.stellarBoostedTypes.push(type);
		}
		if (battle.log.length > savedLog) battle.log.length = savedLog;
	}
	return { move: base.id, crit: !!crit, spread, values };
}

// ------------------------------------------------------------- chat command

const HELP = [
	`/rng force &lt;outcome&gt; [pokemon] [move] [target] - arm a standing rule.`,
	`/rng list - what is armed in this room, read from the battle.`,
	`/rng clear [id|all] - cancel armed rules.`,
	`/rng log - draw counts and what was substituted.`,
	`Outcomes: ${OUTCOME_WORDS.join(' ')}`,
	`<code>wake</code> and <code>stay</code> set the shortest or longest sleep, not an instant wake-up: gen 9 draws a duration once and never rolls again.`,
	`<code>&lt;kind&gt;=&lt;value&gt;</code> reaches the long tail - <code>sleep=3</code>, <code>para=full</code>, <code>stall=min</code>.`,
	`Accuracy, crit and damage roll once per target, so those take a fourth argument naming one.`,
	`A rule matches by team identity, not by slot. Use <code>p1:Glalie</code> when both sides have one.`,
	`Rules stand until cleared. The battle log says nothing; <code>/rng list</code> and the panel are the record.`,
];

/** The live `Battle`, or the reason there is not one. */
function battleOf(room) {
	if (!room.battle) throw new Chat.ErrorMessage(`/rng - This is not a battle room.`);
	const battle = room.battle.stream && room.battle.stream.battle;
	if (!battle) {
		throw new Chat.ErrorMessage(
			`/rng - The simulator is not in this process. Config.subprocesses must be 0.`
		);
	}
	return battle;
}

function pushState(room, connection) {
	const battle = room.battle && room.battle.stream && room.battle.stream.battle;
	const payload = JSON.stringify({ roomid: room.roomid, ...snapshot(battle) });
	const seen = new Set();
	const send = (c) => {
		if (!c || seen.has(c)) return;
		seen.add(c);
		c.send(`|queryresponse|rng|${payload}`);
	};
	send(connection);
	try {
		for (const id in room.users) {
			for (const c of room.users[id].connections) {
				if (c.inRooms && c.inRooms.has(room.roomid)) send(c);
			}
		}
	} catch (err) {}
}

const commands = {
	rng(target, room, user, connection) {
		room = this.requireRoom();

		const parts = String(target || '').trim().split(/\s+/).filter(Boolean);
		const sub = (parts.shift() || '').toLowerCase();

		if (!sub || sub === 'help') return this.sendReplyBox(HELP.join('<br />'));

		const battle = battleOf(room);

		if (sub === 'force') {
			if (!parts.length) throw new Chat.ErrorMessage(`/rng force - name an outcome, e.g. crit.`);
			const spec = {
				outcome: parts[0].toLowerCase(),
				subject: parts.length > 1 ? parts[1] : 'any',
				move: parts.length > 2 && parts[2] !== '-' ? toId(parts[2]) : '',
				target: parts.length > 3 && parts[3] !== '-' ? parts[3] : '',
			};
			const result = arm(battle, spec, `>rng ${forceLine(spec)}`);
			if (result.error) throw new Chat.ErrorMessage(`/rng - ${result.error}`);
			pushState(room, connection);
			return this.sendReply(`Armed #${result.rule.id} ${ruleText(result.rule)}`);
		}

		if (sub === 'clear') {
			const which = (parts[0] || 'all').toLowerCase();
			if (which !== 'all' && !/^\d+$/.test(which)) {
				throw new Chat.ErrorMessage(`/rng clear - give a rule number or "all".`);
			}
			const result = clear(battle, which, `>rng clear ${which}`);
			pushState(room, connection);
			return this.sendReply(`Cleared ${result.gone} rule(s).`);
		}

		if (sub === 'list' || sub === 'state') {
			const state = snapshot(battle);
			pushState(room, connection);
			if (sub === 'state') return;
			if (!state.rules.length) return this.sendReply(`Nothing armed.`);
			return this.sendReplyBox(state.rules.map(r => (
				Chat.escapeHTML(`#${r.id} ${r.text}  armed-on-turn=${r.turn} matched=${r.matched} forced=${r.forced}`)
			)).join('<br />'));
		}

		if (sub === 'log') {
			const state = snapshot(battle);
			const head = `draws=${state.draws} forced=${state.forced} skipped=${state.skipped} ` +
				`reseeds=${state.reseeds} drawsSinceReseed=${state.drawsSinceReseed} ` +
				`recorded=${state.recorded}`;
			const unfired = state.rules.filter(r => !r.forced)
				.map(r => `never substituted: #${r.id} ${r.text} (matched ${r.matched} draw(s))`);
			const lines = [head].concat(unfired, (state.notes || []).slice(-30));
			return this.sendReplyBox(lines.map(Chat.escapeHTML).join('<br />'));
		}

		if (sub === 'ladder') {
			const source = findPokemon(battle, parts[0]);
			const against = findPokemon(battle, parts[1]);
			if (source.why || !source.pokemon) throw new Chat.ErrorMessage(`/rng ladder - ${source.why || 'name an attacker'}`);
			if (against.why || !against.pokemon) throw new Chat.ErrorMessage(`/rng ladder - ${against.why || 'name a target'}`);
			const crit = /^(1|yes|true|crit)$/i.test(parts[3] || '');
			const result = damageLadder(battle, source.pokemon, against.pokemon, parts[2] || '', crit);
			if (result.error) throw new Chat.ErrorMessage(`/rng ladder - ${result.error}`);
			connection.send(`|queryresponse|rngladder|${JSON.stringify({
				roomid: room.roomid,
				source: refOf(source.pokemon),
				target: refOf(against.pokemon),
				...result,
			})}`);
			return;
		}

		throw new Chat.ErrorMessage(`/rng - unknown subcommand "${sub}". Try /rng help.`);
	},
	rnghelp: HELP,
};

exports.OUTCOME_WORDS = OUTCOME_WORDS;
exports.outcomeSpec = outcomeSpec;
exports.install = install;
exports.arm = arm;
exports.clear = clear;
exports.snapshot = snapshot;
exports.applyLine = applyLine;
exports.forceLine = forceLine;
exports.teachStream = teachStream;
exports.damageLadder = damageLadder;
exports.findPokemon = findPokemon;
exports.refOf = refOf;
exports.commands = commands;
