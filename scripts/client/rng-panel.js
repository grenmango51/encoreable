/**
 * The RNG control surface, injected into the real Showdown client.
 *
 * Nothing here is a new UI. Hover a move or a Pokemon and the vanilla tooltip
 * appears unchanged, with the controls appended below whatever the vanilla
 * renderer returned. A box that carries controls takes the mouse and stays up
 * while the pointer is on its way to it or inside it, so hovering is the only
 * gesture needed. Three prototype methods are wrapped and nothing in `vendor/`
 * is edited:
 *
 *   BattleTooltips.showMoveTooltip     move-owned draws
 *   BattleTooltips.showPokemonTooltip  Pokemon-owned draws
 *   BattleTooltips.showTooltip         the armed-count badge's own tooltip
 *   BattleRoom.updateControls          the * marks and the badge
 *
 * Every control is unarmed by default and every armed rule is drawn from state
 * the server reports (`|queryresponse|rng|`), never from what this script
 * remembers sending. A control that lies about what is live is worse than no
 * control.
 *
 * The width budget is hard: `#tooltipwrapper .tooltip` is a fixed 300px, so the
 * label column is a fixed 56px with ellipsis clipping rather than a hope that
 * ability names are short.
 */

(function () {
	'use strict';

	if (window.__rngPanelLoaded) return;
	window.__rngPanelLoaded = true;

	// Effects that roll a die at all. There is no dex field for "this one asks
	// the RNG", so deciding whether a row exists needs a list. It decides
	// visibility only - never a probability, which the champions mod changes.
	var CHANCE_ABILITIES = [
		'static', 'flamebody', 'poisonpoint', 'effectspore', 'cursedbody', 'cutecharm',
		'poisontouch', 'toxicchain', 'healer', 'shedskin', 'quickdraw', 'stench',
	];
	var CHANCE_ITEMS = ['focusband', 'quickclaw', 'kingsrock', 'razorfang'];

	var THREE_WAY = {
		triattack: ['Brn', 'Par', 'Frz'],
		direclaw: ['Psn', 'Par', 'Slp'],
	};

	/** roomid -> the server's last state push. */
	var state = {};
	/** cache key -> the sixteen damage values. */
	var ladders = {};
	var asked = {};
	/** What the pinned tooltip is currently showing, so it can redraw in place. */
	var showing = null;

	function toId(text) {
		return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
	}

	function escapeHtml(text) {
		return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function refOf(pokemon) {
		if (!pokemon || !pokemon.side) return '';
		return pokemon.side.sideid + ':' + toId(pokemon.name);
	}

	function rulesFor(roomid) {
		var snapshot = state[roomid];
		return snapshot && snapshot.rules ? snapshot.rules : [];
	}

	function send(roomid, command) {
		if (window.app && app.send) app.send(command, roomid);
	}

	function requestState(roomid) {
		if (roomid) send(roomid, '/rng state');
	}

	// ------------------------------------------------------------ the rows
	//
	// A row is one draw the operator can name. `values` are the outcomes in
	// display order; a row with two of them renders as a pair of buttons, more
	// than two as a slider. `key` is what identifies the row's rule inside the
	// live state: outcome word, subject, move and target together.

	function row(label, sub, subject, move, target, values, options) {
		options = options || {};
		return {
			label: label,
			sub: sub || '',
			subject: subject,
			move: move || '',
			target: target || '',
			values: values,
			ladder: options.ladder || null,
			note: options.note || '',
		};
	}

	/**
	 * Where each slot sits on screen, as one letter.
	 *
	 * Front sprites are positioned `x = slot * -100 + 18` and back sprites negate
	 * it (`battle-animations.js:2238`), so the foe's slots are mirrored: foe slot
	 * 0 is on the **right**, foe slot 1 on the left, while your own slot 0 is on
	 * the left. Getting this backwards would point every spread row at the wrong
	 * Pokemon.
	 */
	function slotLetter(battle, pokemon, target) {
		var mine = pokemon && pokemon.side ? pokemon.side.active : [];
		for (var i = 0; i < mine.length; i++) if (mine[i] === target) return 'A';
		var foes = battle.farSide ? battle.farSide.active : [];
		for (var j = 0; j < foes.length; j++) if (foes[j] === target) return j === 0 ? 'R' : 'L';
		return '';
	}

	/**
	 * `normal` and `any` reach one adjacent Pokemon, and in doubles your partner
	 * is adjacent - hitting it on purpose is a real line, so it gets its own row.
	 * Only `adjacentFoe` and `allAdjacentFoes` are foes-only.
	 */
	function targetsOf(battle, move, pokemon) {
		var out = [];
		var kind = move.target;
		var foes = battle.farSide ? battle.farSide.active : [];
		var mine = pokemon && pokemon.side ? pokemon.side.active : [];
		var i;
		var addFoes = function () {
			for (i = 0; i < foes.length; i++) if (foes[i] && !foes[i].fainted) out.push(foes[i]);
		};
		var addAllies = function () {
			for (i = 0; i < mine.length; i++) {
				if (mine[i] && !mine[i].fainted && mine[i] !== pokemon) out.push(mine[i]);
			}
		};
		if (kind === 'adjacentFoe' || kind === 'allAdjacentFoes') {
			addFoes();
		} else if (kind === 'normal' || kind === 'any' || kind === 'allAdjacent') {
			addFoes();
			addAllies();
		} else if (kind === 'adjacentAlly' || kind === 'adjacentAllyOrSelf') {
			addAllies();
		}
		return out;
	}

	/**
	 * Static gates hide a control; dynamic ones do not.
	 *
	 * Whether Ice Spinner has a secondary is in the dex and decides whether the
	 * row exists at all. Whether Sand Veil will drag a 100-accuracy move below
	 * 100 is not knowable here, which is why `Acc` rows stay even at 100 - an
	 * unmatched rule costs nothing, and pretending to predict every dynamic
	 * condition would delete real controls.
	 */
	function moveRows(battle, move, pokemon) {
		var me = refOf(pokemon);
		var rows = [];
		var i;

		if (THREE_WAY[move.id]) {
			var labels = THREE_WAY[move.id];
			var picks = [];
			for (i = 0; i < labels.length; i++) picks.push({ word: move.id + '=' + i, text: labels[i] });
			rows.push(row('Sec', '', me, move.id, '', picks));
		}
		if (move.id === 'shellsidearm') {
			rows.push(row('Cat', '', me, move.id, '', [
				{ word: 'shellsidearm=no', text: 'Spec' },
				{ word: 'shellsidearm=yes', text: 'Phys' },
			]));
		}
		if (move.self && (move.self.boosts || move.self.chance)) {
			rows.push(row('Self', '', me, move.id, '', [
				{ word: 'selfdrops=no', text: 'No' },
				{ word: 'selfdrops=yes', text: 'Yes' },
			]));
		}
		if (move.secondaries && move.secondaries.length) {
			rows.push(row('Proc', '', me, move.id, '', [
				{ word: 'secondaries=no', text: 'No' },
				{ word: 'secondaries=yes', text: 'Yes' },
			]));
		}
		if (move.multihit && move.multihit.length) {
			var hits = [];
			for (i = move.multihit[0]; i <= move.multihit[move.multihit.length - 1]; i++) {
				hits.push({ word: 'hits' + i, text: String(i) });
			}
			rows.push(row('Hits', '', me, move.id, '', hits));
		}

		var targets = targetsOf(battle, move, pokemon);
		var single = targets.length < 2;

		for (i = 0; i < targets.length; i++) {
			rows.push(row('Acc', single ? '' : slotLetter(battle, pokemon, targets[i]), me, move.id, refOf(targets[i]), [
				{ word: 'miss', text: 'Miss' },
				{ word: 'hit', text: 'Hit' },
			]));
		}
		if (move.category !== 'Status') {
			for (i = 0; i < targets.length; i++) {
				rows.push(row('Crit', single ? '' : slotLetter(battle, pokemon, targets[i]), me, move.id, refOf(targets[i]), [
					{ word: 'nocrit', text: 'No' },
					{ word: 'crit', text: 'Yes' },
				]));
			}
			for (i = 0; i < targets.length; i++) {
				// Band 0 is maximum damage, so the stops are reversed and the
				// slider reads left-to-right as low damage to high.
				var bands = [];
				for (var band = 15; band >= 0; band--) bands.push({ word: 'roll' + band, text: '' });
				rows.push(row('Roll', single ? '' : slotLetter(battle, pokemon, targets[i]), me, move.id, refOf(targets[i]), bands, {
					ladder: { source: me, target: refOf(targets[i]), move: move.id },
				}));
			}
		}
		return rows;
	}

	function pokemonRows(battle, pokemon, serverPokemon) {
		var me = refOf(pokemon);
		if (!me) return [];
		var rows = [];
		var dex = battle.dex;
		var abilityId = toId((serverPokemon && serverPokemon.ability) || (pokemon && pokemon.ability) || '');
		var itemId = toId((serverPokemon && serverPokemon.item) || (pokemon && pokemon.item) || '');

		if (abilityId && CHANCE_ABILITIES.indexOf(abilityId) >= 0) {
			rows.push(row(dex.abilities.get(abilityId).name, '', me, '', '', [
				{ word: abilityId + '=no', text: 'No' },
				{ word: abilityId + '=yes', text: 'Yes' },
			]));
		}
		if (itemId && CHANCE_ITEMS.indexOf(itemId) >= 0) {
			rows.push(row(dex.items.get(itemId).name, '', me, '', '', [
				{ word: itemId + '=no', text: 'No' },
				{ word: itemId + '=yes', text: 'Yes' },
			]));
		}
		// A status draw only happens while the status is on the Pokemon, so a row
		// for a condition it does not have is a control that can never fire.
		// Space in a 300px box is the scarce thing; these come back the moment
		// the condition does.
		var status = toId(pokemon && pokemon.status);
		var volatiles = (pokemon && pokemon.volatiles) || {};

		if (volatiles.stall) {
			rows.push(row('Prot', '', me, '', '', [
				{ word: 'breakprotect', text: 'Break' },
				{ word: 'protect', text: 'Hold' },
			]));
		}
		if (status === 'slp' || status === 'frz') {
			rows.push(row('Wake', '', me, '', '', [
				{ word: 'wake', text: 'Soon' },
				{ word: 'stay', text: 'Late' },
			]));
		}
		if (volatiles.confusion) {
			rows.push(row('Conf', '', me, '', '', [
				{ word: 'clear', text: 'Clear' },
				{ word: 'confused', text: 'Hit' },
			]));
		}
		if (status === 'par') {
			rows.push(row('Para', '', me, '', '', [
				{ word: 'nopara', text: 'Move' },
				{ word: 'fullpara', text: 'Full' },
			]));
		}
		rows.push(row('Speed', '', me, '', '', [
			{ word: 'wins', text: 'Wins' },
		], { note: 'speed tie' }));
		return rows;
	}

	// --------------------------------------------------------------- state

	/** The armed rule this row's controls stand for, or null. */
	function armedRule(roomid, item) {
		var rules = rulesFor(roomid);
		var words = {};
		for (var i = 0; i < item.values.length; i++) words[item.values[i].word] = i;
		for (var j = 0; j < rules.length; j++) {
			var rule = rules[j];
			if (!(rule.outcome in words)) continue;
			if (rule.subject !== item.subject) continue;
			if ((rule.move || '') !== (item.move || '')) continue;
			if ((rule.target === 'any' ? '' : rule.target) !== (item.target || '')) continue;
			return { rule: rule, index: words[rule.outcome] };
		}
		return null;
	}

	function ladderKey(spec, crit) {
		return spec.source + '>' + spec.target + '>' + spec.move + (crit ? '>crit' : '');
	}

	/**
	 * Crit is the only rule that feeds the dry run: the multiplier is applied
	 * before the random factor and inside the same call, so arming it relabels
	 * this target's slider with crit damage.
	 */
	function critArmed(roomid, item) {
		var rules = rulesFor(roomid);
		for (var i = 0; i < rules.length; i++) {
			if (rules[i].outcome === 'crit' && rules[i].subject === item.subject &&
				rules[i].move === item.move && rules[i].target === item.target) return true;
		}
		return false;
	}

	function ladderFor(roomid, item) {
		if (!item.ladder) return null;
		var crit = critArmed(roomid, item);
		var key = ladderKey(item.ladder, crit);
		if (ladders[key]) return ladders[key];
		if (!asked[key]) {
			asked[key] = true;
			send(roomid, '/rng ladder ' + item.ladder.source + ' ' + item.ladder.target + ' ' +
				item.ladder.move + (crit ? ' crit' : ''));
		}
		return null;
	}

	// ------------------------------------------------------------- rendering

	function renderRow(roomid, item, index) {
		var armed = armedRule(roomid, item);
		var slider = item.values.length > 2;
		var picked = armed ? armed.index : (slider ? item.values.length - 1 : 0);
		var ladder = ladderFor(roomid, item);

		var value = '';
		if (item.ladder) {
			value = ladder && ladder[15 - picked] !== null && ladder[15 - picked] !== undefined ?
				String(ladder[15 - picked]) : '&hellip;';
		} else if (slider) {
			value = escapeHtml(item.values[picked].text);
		}

		var control;
		if (slider) {
			control = '<input type="range" class="rng-slider" min="0" max="' + (item.values.length - 1) +
				'" value="' + picked + '"' + (armed ? '' : ' disabled') + ' />';
		} else {
			control = '';
			for (var i = 0; i < item.values.length; i++) {
				control += '<button class="button rng-pick' + (armed && armed.index === i ? ' rng-on' : '') +
					'" data-rng-index="' + i + '"' + (armed ? '' : ' disabled') + '>' +
					escapeHtml(item.values[i].text) + '</button>';
			}
		}

		return '<span class="rng-row" data-rng-index="' + index + '">' +
			'<input type="checkbox" class="rng-arm"' + (armed ? ' checked' : '') + ' />' +
			'<span class="rng-label" title="' + escapeHtml(item.label + (item.sub ? ' ' + item.sub : '')) + '">' +
			escapeHtml(item.label) + (item.sub ? ' <small>' + escapeHtml(item.sub) + '</small>' : '') + '</span>' +
			'<span class="rng-control">' + control + '</span>' +
			'<span class="rng-value">' + value + '</span>' +
			'</span>';
	}

	function renderSection(roomid, rows) {
		if (!rows.length) return '';
		var html = '<p class="tooltip-section rng">';
		for (var i = 0; i < rows.length; i++) html += renderRow(roomid, rows[i], i);
		html += '</p>';
		return html;
	}

	/** Redraws the pinned tooltip's own section without disturbing the lock. */
	function redraw() {
		if (!showing) return;
		var section = document.querySelector('#tooltipwrapper .tooltip .rng');
		if (!section) return;
		var html = renderSection(showing.roomid, showing.rows);
		if (!html) return;
		var holder = document.createElement('div');
		holder.innerHTML = html;
		section.innerHTML = holder.firstChild.innerHTML;
	}

	// -------------------------------------------------------------- commands

	function commandFor(item, word) {
		return '/rng force ' + word + ' ' + item.subject + ' ' +
			(item.move || '-') + ' ' + (item.target || '-');
	}

	function currentRows() {
		return showing ? showing.rows : [];
	}

	function onArmChange(rowElem, checked) {
		if (!showing) return;
		var item = currentRows()[Number(rowElem.dataset.rngIndex)];
		if (!item) return;
		var armed = armedRule(showing.roomid, item);
		if (!checked) {
			if (armed) send(showing.roomid, '/rng clear ' + armed.rule.id);
			return;
		}
		var slider = item.values.length > 2;
		var pick = slider ? item.values.length - 1 : 0;
		send(showing.roomid, commandFor(item, item.values[pick].word));
	}

	function onPick(rowElem, index) {
		if (!showing) return;
		var item = currentRows()[Number(rowElem.dataset.rngIndex)];
		if (!item || !item.values[index]) return;
		var armed = armedRule(showing.roomid, item);
		if (armed && armed.index === index) return;
		if (armed) send(showing.roomid, '/rng clear ' + armed.rule.id);
		send(showing.roomid, commandFor(item, item.values[index].word));
	}

	// ----------------------------------------------------------- the marks

	/** Does anything armed touch this Pokemon, or this move of it? */
	function marked(roomid, subjectRef, moveId) {
		var rules = rulesFor(roomid);
		for (var i = 0; i < rules.length; i++) {
			if (rules[i].subject !== subjectRef) continue;
			if (moveId && rules[i].move && rules[i].move !== moveId) continue;
			return true;
		}
		return false;
	}

	function decorate(room) {
		var battle = room.battle;
		var roomid = room.id;
		if (!battle || !room.$controls) return;
		var snapshot = state[roomid];

		room.$controls.find('.rng-mark').remove();
		room.$controls.find('button[data-tooltip]').each(function () {
			var args = (this.dataset.tooltip || '').split('|');
			var pokemon = null;
			var moveId = '';
			if (args[0] === 'move' || args[0] === 'zmove' || args[0] === 'maxmove') {
				moveId = toId(args[1]);
				pokemon = battle.nearSide.active[
					parseInt(args[2], 10) + battle.pokemonControlled * Math.floor(battle.mySide.n / 2)];
			} else if (args[0] === 'switchpokemon') {
				pokemon = battle.myPokemon ? battle.myPokemon[parseInt(args[1], 10)] : null;
				if (pokemon && !pokemon.side) pokemon = { name: pokemon.name, side: battle.mySide };
			} else if (args[0] === 'activepokemon') {
				var side = battle.sides[+battle.viewpointSwitched ^ parseInt(args[1], 10)];
				pokemon = side && side.active[parseInt(args[2], 10)];
			}
			if (!pokemon) return;
			if (!marked(roomid, refOf(pokemon), moveId)) return;
			$(this).append('<span class="rng-mark">*</span>');
		});

		room.$controls.find('.rng-badge').remove();
		var count = snapshot && snapshot.rules ? snapshot.rules.length : 0;
		if (count) {
			room.$controls.append(
				'<span class="button rng-badge has-tooltip" data-tooltip="rng">* ' + count + '</span>'
			);
		}
	}

	function decorateAll() {
		if (!window.app || !app.rooms) return;
		for (var id in app.rooms) {
			var room = app.rooms[id];
			if (room && room.type === 'battle') decorate(room);
		}
	}

	// ---------------------------------------------------------------- styles

	function addStyles() {
		if (document.getElementById('rng-panel-styles')) return;
		var style = document.createElement('style');
		style.id = 'rng-panel-styles';
		style.textContent = [
			'#tooltipwrapper .tooltip p.rng { margin: 0; padding-top: 3px; }',
			'#tooltipwrapper .tooltip .rng-row { display: block; height: 20px; line-height: 20px;',
			'  white-space: nowrap; font-size: 9pt; }',
			'#tooltipwrapper .tooltip .rng-arm { width: 13px; height: 13px; margin: 0 4px 0 0;',
			'  vertical-align: middle; }',
			'#tooltipwrapper .tooltip .rng-label { display: inline-block; width: 56px; margin-right: 4px;',
			'  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }',
			'#tooltipwrapper .tooltip .rng-label small { font-size: 8pt; color: #666666; }',
			'#tooltipwrapper .tooltip .rng-control { display: inline-block; width: 160px; margin-right: 4px;',
			'  overflow: hidden; white-space: nowrap; vertical-align: middle; }',
			'#tooltipwrapper .tooltip .rng-value { display: inline-block; width: 40px; text-align: right;',
			'  vertical-align: middle; }',
			'#tooltipwrapper .tooltip .rng-pick { font-size: 8pt; padding: 0 5px; height: 16px;',
			'  line-height: 15px; min-width: 34px; }',
			'#tooltipwrapper .tooltip .rng-pick.rng-on { background: #BBCCDD; font-weight: bold; }',
			'#tooltipwrapper .tooltip .rng-slider { width: 158px; height: 14px; vertical-align: middle;',
			'  -webkit-appearance: none; appearance: none; background: #DEDEDE; border: 1px solid #888888;',
			'  border-radius: 3px; }',
			'#tooltipwrapper .tooltip .rng-slider:disabled { opacity: 0.45; }',
			'#tooltipwrapper .tooltip .rng-slider::-webkit-slider-thumb { -webkit-appearance: none;',
			'  width: 9px; height: 12px; background: #888888; border-radius: 2px; }',
			'#tooltipwrapper .tooltip .rng-slider::-moz-range-thumb { width: 9px; height: 12px;',
			'  background: #888888; border: 0; border-radius: 2px; }',
			'.battle-controls .rng-mark { color: #AA3333; font-weight: bold; margin-left: 2px; }',
			'.battle-controls .rng-badge { margin-left: 4px; cursor: default; }',
			// `#tooltipwrapper` is `pointer-events: none` (`battle.css:765`), so a box
			// with controls in it has to opt back in or the mouse passes through to
			// whatever is underneath. Only boxes carrying controls do, which leaves
			// every other tooltip behaving exactly as vanilla.
			'#tooltipwrapper.rng-open { pointer-events: auto; }',
			// The corridor between the box and the button it belongs to. Upstream
			// anchors the box above the whole move menu, so once the menu wraps to a
			// second row the straight-up path crosses other buttons.
			'#rng-bridge { position: fixed; background: transparent; z-index: 49; }',
		].join('\n');
		document.head.appendChild(style);
	}

	// ----------------------------------------------------------- staying open
	//
	// Upstream tears the box down the instant the pointer leaves the button
	// (`mouseout` -> `unshowTooltip`, `battle-tooltips.ts:224`), which puts
	// anything inside it out of reach. Every one of those paths - mouseout,
	// mouseup, blur, touchend, the wrapper's own click handler - ends at the
	// static `BattleTooltips.hideTooltip`, looked up by name at each call site,
	// so wrapping that one function catches them all. A hide is refused while the
	// pointer counts as live: on the button, in the box, or in the corridor
	// between the two. Leaving starts a grace period, and the hide lands when it
	// expires.

	var GRACE = 260;
	var hideTimer = 0;
	var pointerLive = false;
	var dragging = false;

	function inBox(node) {
		if (!node || !node.closest) return false;
		return !!node.closest('#tooltipwrapper') || node.id === 'rng-bridge';
	}

	function isLive(node) {
		if (!node) return false;
		return inBox(node) || !!(node.closest && node.closest('.has-tooltip'));
	}

	function isOpen() {
		var wrapper = document.getElementById('tooltipwrapper');
		return !!(wrapper && wrapper.classList.contains('rng-open'));
	}

	function cancelHide() {
		if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
		pointerLive = true;
	}

	function scheduleHide() {
		if (hideTimer || dragging) return;
		hideTimer = setTimeout(function () {
			hideTimer = 0;
			pointerLive = false;
			if (window.BattleTooltips) BattleTooltips.hideTooltip();
		}, GRACE);
	}

	function bridgeElem() {
		var el = document.getElementById('rng-bridge');
		if (!el) {
			el = document.createElement('div');
			el.id = 'rng-bridge';
			document.body.appendChild(el);
		}
		return el;
	}

	function hideBridge() {
		var el = document.getElementById('rng-bridge');
		if (el) el.style.display = 'none';
	}

	/**
	 * Spans the gap between the bottom of the box and the top of its button, over
	 * the button's own width. Without it the pointer drops out of the live region
	 * halfway up and either the grace runs out or a button in between claims the
	 * box for itself. A single-row move menu leaves no gap and gets no corridor.
	 */
	function placeBridge(anchor) {
		var tip = window.BattleTooltips && BattleTooltips.elem;
		if (!tip || !anchor || !anchor.getBoundingClientRect) return hideBridge();
		var box = tip.getBoundingClientRect();
		var btn = anchor.getBoundingClientRect();
		var top = box.bottom - 1;
		var height = btn.top - top + 2;
		if (height < 3 || btn.width < 1) return hideBridge();
		var el = bridgeElem();
		el.style.display = 'block';
		el.style.left = btn.left + 'px';
		el.style.top = top + 'px';
		el.style.width = btn.width + 'px';
		el.style.height = height + 'px';
	}

	/** Marks the wrapper interactive when the box that just rendered has rows. */
	function afterShow(anchor) {
		var wrapper = document.getElementById('tooltipwrapper');
		var open = !!(wrapper && wrapper.querySelector('.tooltip .rng'));
		if (wrapper) {
			if (open) wrapper.classList.add('rng-open');
			else wrapper.classList.remove('rng-open');
		}
		if (open) placeBridge(anchor);
		else hideBridge();
	}

	function closeNow() {
		if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
		pointerLive = false;
		if (window.BattleTooltips) BattleTooltips.hideTooltip();
	}

	function onMouseOver(e) {
		if (isLive(e.target)) cancelHide();
	}

	function onMouseOut(e) {
		if (!isLive(e.target) || isLive(e.relatedTarget)) return;
		scheduleHide();
	}

	function onMouseDown(e) {
		if (inBox(e.target)) dragging = true;
	}

	/**
	 * A slider drag holds the pointer captive, so it can wander off the box and
	 * come back without a single mouseover. The hide is only reconsidered once
	 * the button is released, against where the pointer actually ended up.
	 */
	function onMouseUp(e) {
		if (!dragging) return;
		dragging = false;
		if (!isLive(document.elementFromPoint(e.clientX, e.clientY))) scheduleHide();
	}

	// --------------------------------------------------------------- wiring

	function wrapTooltips() {
		var proto = window.BattleTooltips && BattleTooltips.prototype;
		if (!proto || proto.__rngWrapped) return false;
		proto.__rngWrapped = true;

		var origHide = BattleTooltips.hideTooltip;
		BattleTooltips.hideTooltip = function () {
			if (isOpen() && pointerLive) return;
			if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
			pointerLive = false;
			dragging = false;
			hideBridge();
			var wrapper = document.getElementById('tooltipwrapper');
			if (wrapper) wrapper.classList.remove('rng-open');
			return origHide.apply(this, arguments);
		};

		var origMove = proto.showMoveTooltip;
		proto.showMoveTooltip = function (move, type, pokemon, serverPokemon, gmaxMove) {
			var html = origMove.apply(this, arguments);
			try {
				if (type !== 'move' || !pokemon || pokemon.side !== this.battle.mySide) return html;
				var rows = moveRows(this.battle, move, pokemon);
				showing = { roomid: this.battle.roomid, rows: rows };
				return html + renderSection(this.battle.roomid, rows);
			} catch (err) {
				return html;
			}
		};

		var origPokemon = proto.showPokemonTooltip;
		proto.showPokemonTooltip = function (pokemon, serverPokemon, isActive, illusionIndex) {
			var html = origPokemon.apply(this, arguments);
			try {
				var subject = pokemon;
				if (!subject && serverPokemon) {
					subject = { name: serverPokemon.name, side: this.battle.mySide };
				}
				if (!subject || !subject.side || subject.side !== this.battle.mySide) return html;
				if (illusionIndex && illusionIndex > 1) return html;
				var rows = pokemonRows(this.battle, subject, serverPokemon);
				showing = { roomid: this.battle.roomid, rows: rows };
				return html + renderSection(this.battle.roomid, rows);
			} catch (err) {
				return html;
			}
		};

		var origShow = proto.showTooltip;
		proto.showTooltip = function (elem) {
			if ((elem.dataset.tooltip || '').split('|')[0] !== 'rng') {
				var out = origShow.apply(this, arguments);
				if (out !== false) afterShow(elem);
				return out;
			}
			var rules = rulesFor(this.battle.roomid);
			var buf = '<h2>Armed</h2>';
			if (!rules.length) {
				buf += '<p>Nothing is armed.</p>';
			} else {
				for (var i = 0; i < rules.length; i++) {
					buf += '<p>' + escapeHtml(rules[i].text) +
						' <small>matched ' + rules[i].matched + ', forced ' + rules[i].forced + '</small></p>';
				}
			}
			this.placeTooltip(buf, elem, true, 'rng');
			afterShow(elem);
			return true;
		};
		return true;
	}

	function wrapControls() {
		var proto = window.BattleRoom && BattleRoom.prototype;
		if (!proto || proto.__rngWrapped) return false;
		proto.__rngWrapped = true;

		var origUpdate = proto.updateControls;
		proto.updateControls = function () {
			var out = origUpdate.apply(this, arguments);
			try {
				// The button the open box belongs to has just been thrown away and
				// rebuilt, so no mouseout will ever arrive for it. Left alone the box
				// would hang there refusing to close.
				var anchor = window.BattleTooltips && BattleTooltips.parentElem;
				if (anchor && !document.contains(anchor)) closeNow();
				decorate(this);
				requestState(this.id);
			} catch (err) { /* the controls matter more than the marks */ }
			return out;
		};
		return true;
	}

	function listenForState() {
		if (!window.app || !app.on || app.__rngListening) return false;
		app.__rngListening = true;
		app.on('response:rng', function (data) {
			if (!data || !data.roomid) return;
			state[data.roomid] = data;
			// A rule may have moved, so any cached ladder for a crit that is no
			// longer armed has to be asked for again.
			asked = {};
			redraw();
			decorateAll();
		});
		app.on('response:rngladder', function (data) {
			if (!data || !data.values) return;
			ladders[ladderKey(data, data.crit)] = data.values;
			redraw();
		});
		return true;
	}

	function boot() {
		addStyles();
		var ready = wrapTooltips();
		wrapControls();
		listenForState();
		if (!ready || !window.app) setTimeout(boot, 200);
	}

	function rowOf(node) {
		return node && node.closest ? node.closest('#tooltipwrapper .rng-row') : null;
	}

	/**
	 * `#tooltipwrapper` carries a click handler of its own that hides the tooltip
	 * on any click inside it (`battle-tooltips.js:450`). A control that dismisses
	 * the box the moment it is used is no control, so every click on a row is
	 * caught in the capture phase and stopped before it can reach the wrapper.
	 * Stopping propagation leaves the default action alone, so a checkbox still
	 * toggles itself.
	 */
	function onCapturedClick(e) {
		var rowElem = rowOf(e.target);
		if (!rowElem) return;
		e.stopPropagation();
		var pick = e.target.closest('.rng-pick');
		if (pick) {
			e.preventDefault();
			if (!pick.disabled) onPick(rowElem, Number(pick.dataset.rngIndex));
			return;
		}
		if (e.target.classList.contains('rng-arm')) onArmChange(rowElem, e.target.checked);
	}

	function onSliderChange(e) {
		var rowElem = rowOf(e.target);
		if (!rowElem || !e.target.classList.contains('rng-slider')) return;
		onPick(rowElem, Number(e.target.value));
	}

	/**
	 * The readout follows the thumb while dragging; the command waits for the
	 * release, so a drag across sixteen bands is one arm, not sixteen.
	 */
	function onSliderInput(e) {
		var rowElem = rowOf(e.target);
		if (!rowElem || !e.target.classList.contains('rng-slider') || !showing) return;
		var item = currentRows()[Number(rowElem.dataset.rngIndex)];
		var readout = rowElem.querySelector('.rng-value');
		if (!item || !readout) return;
		if (item.ladder) {
			var ladder = ladders[ladderKey(item.ladder, critArmed(showing.roomid, item))];
			var band = 15 - Number(e.target.value);
			readout.textContent = ladder && ladder[band] != null ? String(ladder[band]) : '…';
		} else {
			readout.textContent = item.values[Number(e.target.value)].text;
		}
	}

	$(function () {
		document.addEventListener('click', onCapturedClick, true);
		document.addEventListener('change', onSliderChange, true);
		document.addEventListener('input', onSliderInput, true);
		document.addEventListener('mouseover', onMouseOver, true);
		document.addEventListener('mouseout', onMouseOut, true);
		document.addEventListener('mousedown', onMouseDown, true);
		document.addEventListener('mouseup', onMouseUp, true);
		boot();
	});
})();
