'use strict';

/**
 * `/rng` - name a random decision before the turn that would make it resolves.
 *
 * This file runs inside the Showdown server process. Provisioning copies it to
 * `runtime/config/rng-command.js`, and `config/config.js` hands its `commands`
 * table to `Chat.loadPlugin(Config, 'config')` (`server/chat.ts:2089`), which
 * installs it as a real chat command. Nothing outside `config/` is touched.
 *
 * The command itself holds no simulator state. A battle's `Battle` object lives
 * in a simulator worker, so every arm is a `>eval` written to the room's battle
 * stream (`sim/battle-stream.ts:128`), exactly the route `/evalbattle` takes.
 * `>eval` lines are pushed to `battle.inputLog` before they run
 * (`battle-stream.ts:132`), so a controlled battle replays byte-identically:
 * the recipe reinstalls the interceptor and re-arms the same rules.
 *
 * INTERCEPTOR below is the whole engine, sent once per room. It wraps
 * `PRNG.random`, `PRNG.randomChance` and `PRNG.sample` on the live generator and
 * substitutes a value only for a draw an armed rule matches. Every call still
 * consumes one real `rng.next()`, so an unmatched decision is bit-identical to
 * the uncontrolled battle.
 *
 * Also exported for Node-side use by `scripts/lib/rng-control.mjs`, which builds
 * the same `>eval` lines to verify the engine headlessly.
 */

/**
 * The payload. Sent as one `>eval` line with `\f` standing in for newlines,
 * because `BattleStream` splits its input on `\n` and the eval handler undoes
 * the `\f` substitution itself.
 *
 * No backticks and no `${` anywhere inside: the payload is carried in a
 * template literal.
 */
const INTERCEPTOR = `
(function () {
  if (battle.__rng) return '#manipulated';

  if (Error.stackTraceLimit < 25) Error.stackTraceLimit = 25;

  // Frames that only pass a draw along. The first surviving frame is the site
  // that actually asked for the number.
  var SKIP = {
    'PRNG.random': 1, 'PRNG.randomChance': 1, 'PRNG.sample': 1, 'PRNG.shuffle': 1,
    'Battle.random': 1, 'Battle.randomChance': 1, 'Battle.sample': 1
  };

  var ALIAS = {
    sleep: 'slp', slp: 'slp', para: 'par', paralysis: 'par', par: 'par',
    freeze: 'frz', frozen: 'frz', frz: 'frz', burn: 'brn', brn: 'brn',
    poison: 'psn', psn: 'psn', confusion: 'confusion', confuse: 'confusion',
    protect: 'stall', stall: 'stall'
  };

  // want: 'true' / 'false' for a coin flip, 'min' / 'max' for an extreme,
  // a number for a literal band index, '=n' for "the draw whose result is n".
  //
  // One condition asks for several unrelated numbers - confusion draws a
  // duration, then a coin flip every turn, then a damage roll if it connects -
  // so an effect is never enough on its own. Every entry pins the handler too.
  var OUTCOMES = {
    crit:         { site: 'getDamage',       want: 'true',  who: 'user' },
    nocrit:       { site: 'getDamage',       want: 'false', who: 'user' },
    hit:          { site: 'hitStepAccuracy', want: 'true',  who: 'user' },
    miss:         { site: 'hitStepAccuracy', want: 'false', who: 'user' },
    maxdmg:       { site: 'randomizer',      want: 'max',   who: 'user' },
    mindmg:       { site: 'randomizer',      want: 'min',   who: 'user' },
    proc:         { proc: 1,                 want: 'true',  who: 'any' },
    noproc:       { proc: 1,                 want: 'false', who: 'any' },
    fullpara:     { effect: 'par',        site: 'onBeforeMove', want: 'true',  who: 'holder' },
    nopara:       { effect: 'par',        site: 'onBeforeMove', want: 'false', who: 'holder' },
    confused:     { effect: 'confusion',  site: 'onBeforeMove', want: 'true',  who: 'holder' },
    clear:        { effect: 'confusion',  site: 'onBeforeMove', want: 'false', who: 'holder' },
    protect:      { effect: 'stall',      site: 'onStallMove',  want: 'true',  who: 'holder' },
    breakprotect: { effect: 'stall',      site: 'onStallMove',  want: 'false', who: 'holder' },
    wake:         { effect: 'slp|frz', site: 'onStart|onBeforeMove', want: 'min', who: 'holder' },
    stay:         { effect: 'slp|frz', site: 'onStart|onBeforeMove', want: 'max', who: 'holder' }
  };

  var st = {
    version: 1,
    rules: [],
    nextId: 1,
    notes: [],
    pending: [],
    expire: true,
    draws: 0,
    subs: 0,
    skipped: 0,
    reseeds: 0,
    sinceReseed: 0,
    d: 0,
    off: 0,
    n: null,
    items: null
  };

  st.tail = function (arr, cap) {
    while (arr.length > cap) arr.shift();
  };

  st.frames = function () {
    var raw = (new Error()).stack || '';
    var lines = raw.split('\\n');
    var out = [];
    for (var i = 1; i < lines.length && out.length < 6; i++) {
      // Every frame this interceptor contributes was defined by eval, and
      // nothing in the simulator was. That is the whole filter.
      if (lines[i].indexOf('(eval at ') >= 0) continue;
      var m = /at (?:new )?([A-Za-z0-9_$.<>]+)/.exec(lines[i]);
      if (!m) continue;
      if (SKIP[m[1]]) continue;
      out.push(m[1]);
    }
    return out;
  };

  st.leaf = function (name) {
    var dot = name.lastIndexOf('.');
    return dot < 0 ? name : name.slice(dot + 1);
  };

  st.context = function (d) {
    var frames = st.frames();
    var eff = battle.effect || null;
    var ev = battle.event || null;
    var holder = (ev && ev.target) || (battle.effectState && battle.effectState.target) || null;
    return {
      d: d,
      off: st.off,
      n: st.n,
      items: st.items,
      site: frames.length ? st.leaf(frames[0]) : '',
      frames: frames,
      effectId: eff ? eff.id : '',
      effectType: eff ? eff.effectType : '',
      moveId: battle.activeMove ? battle.activeMove.id : '',
      user: battle.activePokemon || null,
      target: battle.activeTarget || null,
      holder: holder
    };
  };

  st.isProc = function (ctx) {
    if (ctx.site === 'secondaries' || ctx.site === 'selfDrops') return true;
    return ctx.n !== null && (ctx.effectType === 'Ability' || ctx.effectType === 'Item');
  };

  st.oneOf = function (list, value) {
    var parts = list.split('|');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === value) return true;
    }
    return false;
  };

  st.spec = function (word) {
    if (OUTCOMES[word]) return OUTCOMES[word];
    var m = /^roll(\\d+)$/.exec(word);
    if (m) return { site: 'randomizer', want: Number(m[1]), who: 'user' };
    m = /^hits(\\d+)$/.exec(word);
    if (m) return { site: 'hitStepMoveHitLoop', want: '=' + m[1], who: 'user' };
    m = /^([a-z]+)=([a-z0-9]+)$/.exec(word);
    if (!m) return null;
    var kind = m[1];
    var val = m[2];
    var want = null;
    if (val === 'full' || val === 'true' || val === 'yes' || val === 'on') want = 'true';
    else if (val === 'none' || val === 'false' || val === 'no' || val === 'off') want = 'false';
    else if (val === 'min' || val === 'max') want = val;
    else if (/^\\d+$/.test(val)) want = '=' + val;
    if (want === null) return null;
    return { effect: ALIAS[kind] || kind, site: kind, loose: 1, want: want, who: 'any' };
  };

  st.matches = function (rule, ctx) {
    var s = rule.spec;
    var ok;
    if (s.proc) {
      ok = st.isProc(ctx);
    } else if (s.loose) {
      ok = st.oneOf(s.effect, ctx.effectId) || ctx.site.toLowerCase() === s.site;
    } else {
      ok = true;
      if (s.effect) ok = st.oneOf(s.effect, ctx.effectId);
      if (ok && s.site) ok = st.oneOf(s.site, ctx.site);
    }
    if (!ok) return false;
    if (rule.move && ctx.moveId !== rule.move) return false;
    if (rule.subject) {
      var pool = s.who === 'user' ? [ctx.user]
        : s.who === 'holder' ? [ctx.holder, ctx.target]
        : [ctx.user, ctx.holder, ctx.target];
      if (pool.indexOf(rule.subject) < 0) return false;
    }
    return true;
  };

  st.extreme = function (items, dir) {
    var best = 0;
    for (var i = 1; i < items.length; i++) {
      if (dir > 0 ? items[i] > items[best] : items[i] < items[best]) best = i;
    }
    return best;
  };

  // Returns the band index in [0, d) to substitute, or a reason it cannot be.
  st.resolve = function (rule, ctx) {
    var want = rule.spec.want;
    var d = ctx.d;
    var items = ctx.items;
    var band = null;
    if (want === 'true') {
      if (ctx.n !== null && ctx.n <= 0) return { band: null, why: 'always-false' };
      band = 0;
    } else if (want === 'false') {
      if (ctx.n !== null && ctx.n >= d) return { band: null, why: 'always-true' };
      band = d - 1;
    } else if (want === 'min') {
      band = items ? st.extreme(items, -1) : 0;
    } else if (want === 'max') {
      band = items ? st.extreme(items, 1) : d - 1;
    } else if (typeof want === 'number') {
      band = want;
    } else {
      // '=n' names the value the caller wanted back. A sample() draw finds it
      // in the array it was handed; random(from, to) subtracts the offset.
      var v = Number(want.slice(1));
      band = items ? items.indexOf(v) : v - ctx.off;
    }
    if (band === null || band < 0 || band >= d) return { band: null, why: 'unreachable' };
    return { band: band, why: '' };
  };

  st.note = function (rule, ctx, real, forced, why) {
    var text = '#rng ' + (forced === null ? 'skip' : 'force') + ' #' + rule.id + ' ' +
      rule.word + ' d=' + ctx.d + ' site=' + (ctx.site || '?') +
      (ctx.effectId ? ' eff=' + ctx.effectId : '') +
      (ctx.moveId ? ' mv=' + ctx.moveId : '') +
      ' ' + real + (forced === null ? '' : '->' + forced) +
      (why ? ' (' + why + ')' : '');
    st.notes.push(text);
    st.tail(st.notes, 200);
    st.pending.push(text);
  };

  st.flush = function () {
    for (var i = 0; i < st.pending.length; i++) battle.add('-message', st.pending[i]);
    st.pending = [];
  };

  st.sweep = function () {
    var kept = [];
    for (var i = 0; i < st.rules.length; i++) {
      var r = st.rules[i];
      if (r.spent) continue;
      if (r.standing) { kept.push(r); continue; }
      if (!st.expire) { kept.push(r); continue; }
      // A rule that never matched anything is the one failure the battle log
      // cannot show on its own, so it goes to both the room and the report.
      var text = '#rng expired unfired #' + r.id + ' ' + r.text +
        ' (matched ' + r.tries + ' draw(s) on turn ' + r.turn + ')';
      st.pending.push(text);
      st.notes.push(text);
      st.tail(st.notes, 200);
    }
    st.rules = kept;
    st.flush();
  };

  st.hook = function (p) {
    if (!p || p.__rngHooked) return;
    p.__rngHooked = true;

    var origRandom = p.random;
    var origChance = p.randomChance;
    var origSample = p.sample;

    p.random = function rngWrapRandom(from, to) {
      var d, off;
      if (from === undefined) { d = 0; off = 0; }
      else if (!to) { d = Math.floor(from); off = 0; }
      else { off = Math.floor(from); d = Math.floor(to) - off; }
      var prevD = st.d;
      var prevOff = st.off;
      st.d = d;
      st.off = off;
      try {
        var real = origRandom.call(this, from, to);
        st.draws++;
        st.sinceReseed++;
        if (!st.rules.length || d <= 0) return real;
        var ctx = st.context(d);
        var rule = null;
        for (var i = 0; i < st.rules.length; i++) {
          if (!st.rules[i].spent && st.matches(st.rules[i], ctx)) { rule = st.rules[i]; break; }
        }
        if (!rule) return real;
        rule.tries++;
        var got = st.resolve(rule, ctx);
        if (got.band === null) {
          st.skipped++;
          st.note(rule, ctx, real, null, got.why);
          return real;
        }
        var forced = got.band + off;
        rule.fired++;
        if (!rule.standing) rule.spent = true;
        st.subs++;
        st.note(rule, ctx, real, forced, '');
        return forced;
      } finally {
        st.d = prevD;
        st.off = prevOff;
      }
    };

    p.randomChance = function rngWrapChance(numerator, denominator) {
      var prev = st.n;
      st.n = numerator;
      try {
        return origChance.call(this, numerator, denominator);
      } finally {
        st.n = prev;
      }
    };

    p.sample = function rngWrapSample(items) {
      var prev = st.items;
      st.items = items;
      try {
        return origSample.call(this, items);
      } finally {
        st.items = prev;
      }
    };
  };

  // >reseed replaces the generator object rather than reseeding it
  // (sim/battle.ts:219), and every branched recording carries one. Installing
  // through an accessor is what keeps control alive across it.
  var current = battle.prng;
  Object.defineProperty(battle, 'prng', {
    configurable: true,
    enumerable: true,
    get: function () { return this.__rngPrng; },
    set: function (p) {
      this.__rngPrng = p;
      if (st.installed) { st.reseeds++; st.sinceReseed = 0; }
      st.hook(p);
    }
  });
  battle.prng = current;
  st.installed = true;

  var origEndTurn = battle.endTurn;
  battle.endTurn = function rngEndTurn() {
    var out = origEndTurn.apply(this, arguments);
    st.sweep();
    return out;
  };

  st.find = function (text) {
    if (!text || text === 'any') return { pokemon: null, why: '' };
    var wantSide = -1;
    var name = text;
    var m = /^p([1-4]):(.*)$/.exec(text);
    if (m) { wantSide = Number(m[1]) - 1; name = m[2]; }
    var id = battle.toID(name);
    var hits = [];
    for (var i = 0; i < battle.sides.length; i++) {
      if (wantSide >= 0 && i !== wantSide) continue;
      var pool = battle.sides[i].pokemon;
      for (var j = 0; j < pool.length; j++) {
        var p = pool[j];
        if (battle.toID(p.name) === id || p.species.id === id || p.baseSpecies.id === id) hits.push(p);
      }
    }
    if (!hits.length) return { pokemon: null, why: 'no Pokemon named ' + text };
    if (hits.length > 1) return { pokemon: null, why: text + ' is on both teams - use p1: or p2:' };
    return { pokemon: hits[0], why: '' };
  };

  st.arm = function (word, subject, move, standing) {
    var spec = st.spec(word);
    if (!spec) {
      battle.add('-message', '#rng rejected: ' + word + ' is not an outcome');
      return '#manipulated';
    }
    var found = st.find(subject);
    if (found.why) {
      battle.add('-message', '#rng rejected: ' + found.why);
      return '#manipulated';
    }
    var rule = {
      id: st.nextId++,
      word: word,
      spec: spec,
      subject: found.pokemon,
      move: move || '',
      standing: !!standing,
      turn: battle.turn,
      tries: 0,
      fired: 0,
      spent: false,
      text: word + ' ' + (subject || 'any') + (move ? ' ' + move : '') + (standing ? ' [always]' : '')
    };
    st.rules.push(rule);
    battle.add('-message', '#rng armed #' + rule.id + ' ' + rule.text);
    return '#manipulated';
  };

  st.clear = function (which) {
    var kept = [];
    var gone = 0;
    for (var i = 0; i < st.rules.length; i++) {
      var r = st.rules[i];
      if (which === 'all' || String(r.id) === String(which)) { gone++; continue; }
      kept.push(r);
    }
    st.rules = kept;
    battle.add('-message', '#rng cleared ' + gone + ' rule(s)');
    return '#manipulated';
  };

  st.setExpire = function (on) {
    st.expire = !!on;
    battle.add('-message', '#rng one-shot expiry ' + (st.expire ? 'on' : 'off'));
    return '#manipulated';
  };

  st.list = function () {
    if (!st.rules.length) return 'nothing armed';
    var out = [];
    for (var i = 0; i < st.rules.length; i++) {
      var r = st.rules[i];
      out.push('#' + r.id + ' ' + r.text + ' armed-on-turn=' + r.turn +
        ' matched=' + r.tries + ' forced=' + r.fired);
    }
    return out.join('\\n');
  };

  st.report = function () {
    var out = [];
    out.push('draws=' + st.draws + ' forced=' + st.subs + ' skipped=' + st.skipped +
      ' reseeds=' + st.reseeds + ' drawsSinceReseed=' + st.sinceReseed +
      ' expiry=' + (st.expire ? 'on' : 'off'));
    out.push(st.list());
    for (var j = 0; j < st.notes.length; j++) out.push(st.notes[j]);
    return out.join('\\n');
  };

  battle.__rng = st;
  return '#manipulated';
})()
`.trim();

/** `BattleStream` splits its input on newlines; the eval handler undoes `\f`. */
function encode(code) {
	return `>eval ${code.replace(/\n/g, '\f')}`;
}

const OUTCOME_WORDS = [
	'crit', 'nocrit', 'hit', 'miss', 'proc', 'noproc', 'maxdmg', 'mindmg',
	'wake', 'stay', 'confused', 'clear', 'protect', 'breakprotect',
	'fullpara', 'nopara', 'roll<0-15>', 'hits<2-5>', '<kind>=<value>',
];

/**
 * Splits `<outcome> <subject> [move]` and validates the outcome word only.
 * The subject is resolved inside the battle, where the teams are.
 */
function parseSpec(text) {
	const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return { error: 'name an outcome, e.g. crit' };
	const word = parts[0].toLowerCase();
	const known = /^(crit|nocrit|hit|miss|proc|noproc|maxdmg|mindmg|fullpara|nopara|confused|clear|protect|breakprotect|wake|stay)$/.test(word) ||
		/^roll\d+$/.test(word) || /^hits\d+$/.test(word) || /^[a-z]+=[a-z0-9]+$/.test(word);
	if (!known) return { error: `"${parts[0]}" is not an outcome. Try: ${OUTCOME_WORDS.join(' ')}` };
	return {
		outcome: word,
		subject: parts.length > 1 ? parts[1] : 'any',
		move: parts.length > 2 ? parts.slice(2).join('').toLowerCase().replace(/[^a-z0-9]/g, '') : '',
	};
}

function installLine() {
	return encode(INTERCEPTOR);
}

function armLine(spec, standing) {
	const call = `battle.__rng.arm(${JSON.stringify(spec.outcome)},${JSON.stringify(spec.subject)},` +
		`${JSON.stringify(spec.move)},${standing ? 'true' : 'false'})`;
	return encode(call);
}

function clearLine(which) {
	return encode(`battle.__rng.clear(${JSON.stringify(String(which))})`);
}

function expireLine(on) {
	return encode(`battle.__rng.setExpire(${on ? 'true' : 'false'})`);
}

function reportLine() {
	return encode('battle.__rng.report()');
}

function listLine() {
	return encode('battle.__rng.list()');
}

// ------------------------------------------------------------- chat command

/** Sends the interceptor the first time this room asks for anything. */
function ensureInstalled(battle) {
	if (battle.rngInstalled) return;
	void battle.stream.write(installLine());
	battle.rngInstalled = true;
}

const HELP = [
	`/rng force &lt;outcome&gt; [pokemon] [move] - arm a one-shot rule.`,
	`/rng always &lt;outcome&gt; [pokemon] [move] - arm a standing rule.`,
	`/rng list - what is armed in this room.`,
	`/rng clear [id|all] - cancel armed rules.`,
	`/rng expire on|off - whether one-shots expire at the end of the turn.`,
	`/rng log - what fired and what did not, from the simulator.`,
	`Outcomes: ${OUTCOME_WORDS.join(' ')}`,
	`<code>wake</code> and <code>stay</code> set the shortest or longest sleep, not an instant wake-up: gen 9 draws a duration once and never rolls again.`,
	`<code>&lt;kind&gt;=&lt;value&gt;</code> reaches the long tail - <code>sleep=3</code>, <code>para=full</code>, <code>stall=min</code>.`,
	`A rule matches by team identity, not by slot. Use <code>p1:Glalie</code> when both sides have one.`,
	`Everything <code>/rng</code> does is written into the battle log and the input log. A controlled battle is manipulated by definition and says so.`,
];

const commands = {
	rng(target, room, user) {
		room = this.requireRoom();
		const battle = room.battle;
		if (!battle) throw new Chat.ErrorMessage(`/rng - This is not a battle room.`);
		if (!this.runBroadcast()) return;

		const parts = String(target || '').trim().split(/\s+/).filter(Boolean);
		const sub = (parts.shift() || '').toLowerCase();
		const rest = parts.join(' ');

		if (!sub || sub === 'help') return this.sendReplyBox(HELP.join('<br />'));

		if (sub === 'force' || sub === 'always') {
			const spec = parseSpec(rest);
			if (spec.error) throw new Chat.ErrorMessage(`/rng - ${spec.error}`);
			ensureInstalled(battle);
			void battle.stream.write(armLine(spec, sub === 'always'));
			const text = `${spec.outcome} ${spec.subject}${spec.move ? ` ${spec.move}` : ''}` +
				`${sub === 'always' ? ' [always]' : ''}`;
			return this.sendReply(`Sent: ${text}. The battle log says whether it took.`);
		}

		if (sub === 'list') {
			if (!battle.rngInstalled) return this.sendReply(`Nothing armed in this room yet.`);
			void battle.stream.write(listLine());
			return this.sendReply(`Armed rules written to the battle log.`);
		}

		if (sub === 'clear') {
			if (!battle.rngInstalled) return this.sendReply(`Nothing armed in this room yet.`);
			const which = (rest || 'all').toLowerCase();
			if (which !== 'all' && !/^\d+$/.test(which)) {
				throw new Chat.ErrorMessage(`/rng clear - give a rule number or "all".`);
			}
			void battle.stream.write(clearLine(which));
			return this.sendReply(`Cleared ${which}.`);
		}

		if (sub === 'expire') {
			const on = /^(on|true|yes)$/i.test(rest);
			const off = /^(off|false|no)$/i.test(rest);
			if (!on && !off) throw new Chat.ErrorMessage(`/rng expire - say "on" or "off".`);
			ensureInstalled(battle);
			void battle.stream.write(expireLine(on));
			return this.sendReply(`One-shot expiry ${on ? 'on' : 'off'}.`);
		}

		if (sub === 'log') {
			if (!battle.rngInstalled) return this.sendReply(`Nothing armed in this room yet.`);
			void battle.stream.write(reportLine());
			return this.sendReply(`Report written to the battle log.`);
		}

		throw new Chat.ErrorMessage(`/rng - unknown subcommand "${sub}". Try /rng help.`);
	},
	rnghelp: HELP,
};

exports.INTERCEPTOR = INTERCEPTOR;
exports.OUTCOME_WORDS = OUTCOME_WORDS;
exports.parseSpec = parseSpec;
exports.installLine = installLine;
exports.armLine = armLine;
exports.clearLine = clearLine;
exports.expireLine = expireLine;
exports.reportLine = reportLine;
exports.listLine = listLine;
exports.commands = commands;
