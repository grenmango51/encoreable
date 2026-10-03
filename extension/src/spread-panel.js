/**
 * The Stat Point panel of a branch, in the live client: a slider per stat in
 * every Pokemon's tooltip, and a block just before turn 1 of the battle log
 * with what the replay allows each inferred Pokemon's Stat Points to be.
 * Hovering a range there says which turns narrowed it; clicking keeps that
 * open. Each room says the Pokemon as its own side sees them: "your" for its
 * own team, "the opposing" for the other, so a mirror stays readable.
 *
 * A Pokemon whose team was known has one spread, and its sliders sit fixed on
 * it. An inferred one's slider spans the values some spread the replay leaves
 * still has, and skips a value none has. HP, Defence and Special Defence are
 * read together - the HP a hit leaves depends on all three - and every stat
 * shares one 66-point budget, so the sliders are linked: moving one to a value
 * moves the others to the nearest spread the replay allows with it. The dark
 * part of a track is how far that slider goes with nothing else moving.
 *
 * The sliders open on the spread a player most likely brought (`typicalSpread`
 * in `knowledge.mjs`). They never change the battle, which runs on the spread
 * its rebuild found; that one is printed under them.
 *
 * Where the replay narrowed which HP goes with which Defence or Special
 * Defence, the sources of those ranges end with the pairings left, as grids.
 *
 * A game of a best-of set opens combined with the set's other games the
 * recordings store holds (`combineGames` in `infer.mjs`): every game is one
 * team, so the ranges, the sliders and the counts are what all of them leave,
 * the block and the sliders say which games those are, and a range's sources
 * are every game's events, each under its game.
 *
 * The tooltip is the one `rng-panel.js` keeps up while the pointer is in it;
 * the section's `keeps-open` class asks for that.
 */

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const SPAN = 33;

const toId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = n => Number(n).toLocaleString('en');
const short = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : count(n));
const range = r => (r ? (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`) : 'none');

// ---------------------------------------------------------------- the log

const unpackBits = (text, length) => {
  const raw = atob(text);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
};

const FULL = { min: 0, max: SPAN - 1 };

/** A Pokemon as one room says it: the room's own side's is "your", the other's "the opposing". */
const whose = (id, name, side) => `${id.slice(0, 2) === side ? 'your' : 'the opposing'} ${name}`;

/** What the Stat Points shown are read from: the replay, or the games of its best-of set combined with it. */
function readFrom(inf) {
  const games = inf?.combined?.games || [];
  return games.length > 1 ? `games ${games.slice(0, -1).join(', ')} and ${games[games.length - 1]} of this set` : 'the replay';
}

/** Where an event or check was seen: its turn, and its game when games were combined. */
const seenAt = e => (e.game ? `Game ${e.game}, turn ${e.turn ?? 0}` : `Turn ${e.turn ?? 0}`);

/**
 * A description as one room reads it, each Pokemon it names said as that
 * room's own or the opposing one. One from before names were marked reads as
 * it was written.
 */
function described(e, side) {
  let text = String(e.what);
  for (const w of [...(e.who || [])].sort((x, y) => y.at - x.at)) {
    text = `${text.slice(0, w.at)}${w.id.slice(0, 2) === side ? 'your ' : 'the opposing '}${text.slice(w.at)}`;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Where each inferred Pokemon's ranges came from: per stat, every event that
 * moved its range, and under HP, Defence and Special Defence every event that
 * moved which of them go together. Events run in the order the log shows the
 * turns, each new range kept inside the last: the evidence pass reads speed
 * order after every hit, so its own order is not the battle's. Combined games
 * run one after another, in the set's order.
 */
function sourcesOf(inf) {
  const out = new Map();
  const at = (id) => {
    if (!out.has(id)) {
      out.set(id, {
        ranges: Object.fromEntries(STATS.map(s => [s, FULL])),
        grids: null,
        steps: Object.fromEntries(STATS.map(s => [s, []])),
        all: [],
      });
    }
    return out.get(id);
  };
  const events = (inf.events || []).map((e, order) => ({ ...e, order }))
    .sort((x, y) => (x.game || 0) - (y.game || 0) || x.turn - y.turn || x.order - y.order);
  for (const e of events) {
    for (const c of e.cuts) {
      const now = at(c.id);
      const moved = {};
      for (const s of c.narrowed) {
        const was = now.ranges[s];
        const to = c.stats[s];
        const next = was && to ? { min: Math.max(was.min, to.min), max: Math.min(was.max, to.max) } : null;
        const kept = next && next.min <= next.max ? next : null;
        if (range(kept) === range(was)) continue;
        moved[s] = { from: was, to: kept };
        now.ranges[s] = kept;
      }
      let paired = false;
      if (c.grids) {
        const after = {};
        for (const d of ['def', 'spd']) {
          after[d] = unpackBits(c.grids[d], SPAN * SPAN);
          if (now.grids) after[d] = after[d].map((v, i) => v & now.grids[d][i]);
          paired ||= !now.grids ? after[d].includes(0) : after[d].some((v, i) => v !== now.grids[d][i]);
        }
        now.grids = after;
      }
      const step = { e, moved, paired };
      now.all.push(step);
      for (const s of Object.keys(moved)) now.steps[s].push(step);
      if (paired) for (const s of ['hp', 'def', 'spd']) if (!moved[s]) now.steps[s].push(step);
    }
  }
  return out;
}

/**
 * What the replay allows - or every game of its set combined with it - as the
 * one block a room's log opens with, just before turn 1: a table per inferred
 * team, the room's own side as "your team". Every cell names its Pokemon and
 * stat in its class, so hovering or clicking it can say where that range came
 * from.
 */
function summaryBlock(b, side) {
  const inf = b.inference;
  const sources = sourcesOf(inf);
  const inferred = (b.panel?.pokemon || []).filter(p => p.inferred);
  const cell = 'white-space:nowrap;padding:0 3px;text-align:right';
  let html = `<div class="infobox sp-summary"><strong>Stat Points ${readFrom(inf)} allow${inf.combined ? '' : 's'}</strong>`;
  for (const own of [false, true]) {
    const team = inferred.filter(p => (p.side === side) === own);
    if (!team.length) continue;
    html += `<div style="margin-top:4px"><small>${own ? 'Your team' : 'The opposing team'}</small></div>` +
      `<table style="font-size:8pt"><tr><th></th>${STATS.map(s => `<th style="${cell}">${LABEL[s]}</th>`).join('')}</tr>`;
    for (const p of team) {
      const key = p.id.replace(':', '-');
      html += `<tr><td class="sp-cell sp-at-${key}-all" style="white-space:nowrap;cursor:help">${escapeHtml(p.name)}</td>`;
      if (p.unrecorded) {
        html += `<td colspan="${STATS.length}"><small>this recording did not keep its ranges</small></td></tr>`;
        continue;
      }
      const src = sources.get(p.id);
      for (const s of STATS) {
        const learned = !!src?.steps[s].length || range(p.ranges[s]) !== range(FULL);
        html += `<td class="sp-cell sp-at-${key}-${s}" style="${cell};cursor:help${learned ? ';font-weight:bold' : ';color:#888'}">` +
          `${range(p.ranges[s])}</td>`;
      }
      html += '</tr>';
    }
    html += '</table>';
  }
  for (const c of inf.checks || []) {
    html += `<div><small style="color:#888">Not used, ${seenAt(c).toLowerCase()}: ${escapeHtml(described(c, side))} - ${escapeHtml(c.reason)}</small></div>`;
  }
  html += '<div><small style="color:#888">Hover a range or a name to see where it came from; click to keep it open. ' +
    'Hover a Pok&eacute;mon on the field for its sliders.</small></div></div>';
  return `|raw|${html}`;
}

/** A room's scrollback with the Stat Point block in it, just before turn 1. */
export function annotate(lines, b, side) {
  if (!b.inference || !b.panel) return lines;
  const block = summaryBlock(b, side);
  const first = lines.findIndex(l => /^\|turn\|/.test(l));
  return first < 0 ? [...lines, block] : [...lines.slice(0, first), block, ...lines.slice(first)];
}

// ------------------------------------------------------------ where it came from

const GRID_ON = '#4a5f78';
const GRID_OFF = '#dddddd';

/** The box a range's sources show in: the client's own tooltip, drawn the same. */
function sourceHtml(b, side, id, stat) {
  b.sources ||= sourcesOf(b.inference);
  const entry = b.panel.pokemon.find(p => p.id === id);
  if (!entry) return null;
  const src = b.sources.get(id);
  const name = escapeHtml(whose(id, entry.name, side));
  const from = readFrom(b.inference);
  const title = stat === 'all' ? `${name} <small>${count(entry.spreads)} spreads fit ${from}</small>` : `${name} <small>${LABEL[stat]} ${range(entry.ranges[stat])}</small>`;
  let html = `<h2>${title.charAt(0).toUpperCase() + title.slice(1)}</h2>`;
  const steps = !src ? [] : stat === 'all' ? src.all : src.steps[stat];
  for (const { e, moved, paired } of steps) {
    const said = Object.entries(moved).filter(([s]) => stat === 'all' || s === stat)
      .map(([s, m]) => `${LABEL[s]} ${range(m.from)} → ${range(m.to)}`);
    if (paired && (stat === 'all' || !moved[stat])) said.push('which HP goes with which Def and SpD');
    if (!said.length) said.push('which values go together');
    html += `<p class="tooltip-section"><small>${seenAt(e)}</small> ${escapeHtml(described(e, side))}` +
      `${e.shown !== undefined ? ` <small>(shown ${escapeHtml(e.shown)})</small>` : ''}<br />&rarr; ${said.join(', ')}</p>`;
  }
  const last = src ? src.ranges : null;
  const together = (stat === 'all' ? STATS : [stat])
    .filter(s => range(last ? last[s] : FULL) !== range(entry.ranges[s]))
    .map(s => `${LABEL[s]} ${range(last ? last[s] : FULL)} → ${range(entry.ranges[s])}`);
  if (together.length) {
    html += `<p class="tooltip-section"><small>Every observation${b.inference.combined ? ` of ${from}` : ''} read together</small><br />&rarr; ${together.join(', ')}</p>`;
  }
  if (!steps.length && !together.length) {
    html += `<p class="tooltip-section">Nothing in ${from} narrowed this.</p>`;
  }
  if (entry.grids && ['all', 'hp', 'def', 'spd'].includes(stat) && (entry.grids.def.includes(0) || entry.grids.spd.includes(0))) {
    const pairs = stat === 'def' ? ['def'] : stat === 'spd' ? ['spd'] : ['def', 'spd'];
    html += '<p class="tooltip-section"><small>Which HP still goes with which ' +
      `${pairs.map(d => LABEL[d]).join(' and ')} (HP up, ${pairs.map(d => LABEL[d]).join(' / ')} across, 0 at bottom left)</small><br />` +
      pairs.map(d => `<canvas class="sp-grid" data-sp-pair="${d}" width="${SPAN * 3}" height="${SPAN * 3}" style="margin:2px 6px 2px 0;border:1px solid #888"></canvas>`).join('') +
      '</p>';
  }
  return html;
}

function drawGrids(box, entry) {
  for (const canvas of box.querySelectorAll('canvas.sp-grid')) {
    const mask = entry.grids[canvas.dataset.spPair];
    const g = canvas.getContext('2d');
    for (let hp = 0; hp < SPAN; hp++) {
      for (let x = 0; x < SPAN; x++) {
        g.fillStyle = mask[hp * SPAN + x] ? GRID_ON : GRID_OFF;
        g.fillRect(x * 3, (SPAN - 1 - hp) * 3, 3, 3);
      }
    }
  }
}

// ------------------------------------------------------------ the sliders

/** The panel entry a tooltip's Pokemon is: same side, by name, else by species. */
function entryFor(b, sideid, name, forme) {
  const mine = (b.panel?.pokemon || []).filter(p => p.side === sideid);
  return mine.find(p => toId(p.name) === toId(name)) ||
    mine.find(p => toId(p.species) === toId(forme) || toId(forme).startsWith(toId(p.species))) || null;
}

function stateOf(b, entry) {
  b.sliders ||= {};
  if (!b.sliders[entry.id]) b.sliders[entry.id] = { spread: { ...entry.spread }, reach: entry.reach || null, seq: 0 };
  return b.sliders[entry.id];
}

/** The stops of one slider: every value the stat still takes, or just the spread's when it is fixed. */
const valuesFor = (entry, state, stat) => (sliding(entry) ? entry.values[stat] : [state.spread[stat]]);
const sliding = entry => entry.inferred && !entry.unrecorded && STATS.every(s => entry.values[s].length);

function statTable(entry, forme) {
  return entry.stats[forme] || entry.stats[entry.species] || Object.values(entry.stats)[0];
}

/** The track: dark where the slider goes with nothing else moving, light where it moves the others. */
function track(values, reach) {
  if (values.length < 2) return '#9fb3c8';
  const open = new Set(reach || values);
  const stops = [];
  const n = values.length - 1;
  values.forEach((v, i) => {
    const colour = open.has(v) ? '#9fb3c8' : '#e2e2e2';
    const from = i === 0 ? 0 : ((i - 0.5) / n) * 100;
    const to = i === n ? 100 : ((i + 0.5) / n) * 100;
    stops.push(`${colour} ${from.toFixed(2)}%`, `${colour} ${to.toFixed(2)}%`);
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** `from` is what the spreads are read from: `readFrom` of the branch's inference. */
function sectionHtml(roomid, entry, state, forme, from) {
  const table = statTable(entry, forme);
  let head = '<strong>Stat Points</strong> ';
  if (!entry.inferred) head += '<small>known</small>';
  else if (entry.unrecorded) head += '<small>this recording did not keep its ranges</small>';
  else if (!sliding(entry)) head += `<small>no spread fits ${from}</small>`;
  else head += `<small title="${count(entry.spreads)} spreads">${short(entry.spreads)} spreads fit ${from}</small> <button class="button sp-reset">Reset</button>`;
  let html = `<p class="tooltip-section keeps-open sp-panel" data-sp-room="${escapeHtml(roomid)}" data-sp-id="${entry.id}" data-sp-forme="${escapeHtml(forme)}">` +
    `<span class="sp-head">${head}</span>`;
  for (const stat of STATS) {
    const values = valuesFor(entry, state, stat);
    const sp = state.spread[stat];
    const index = Math.max(0, values.indexOf(sp));
    const fixed = values.length < 2;
    html += `<span class="sp-row" data-sp-stat="${stat}">` +
      `<span class="sp-label">${LABEL[stat]}</span>` +
      `<span class="sp-end">${fixed ? '' : values[0]}</span>` +
      // A fixed slider sits where its one value is between 0 and 32.
      (fixed ? `<input type="range" class="sp-slider" min="0" max="${SPAN - 1}" value="${sp}" disabled`
        : `<input type="range" class="sp-slider" min="0" max="${values.length - 1}" value="${index}"`) +
      ` style="background:${track(values, state.reach?.[stat])}" />` +
      `<span class="sp-end">${fixed ? '' : values[values.length - 1]}</span>` +
      `<span class="sp-value">${sp}</span>` +
      `<span class="sp-stat">${table ? table[stat][sp] : ''}</span>` +
      '</span>';
  }
  if (sliding(entry)) {
    html += `<span class="sp-foot"><small>This battle runs on ${STATS.map(s => entry.used[s]).join(' / ')}` +
      `${entry.usedFits === false ? ', which the set\'s other games rule out' : ''}</small></span>`;
  }
  return `${html}</p>`;
}

function addStyles() {
  if (document.getElementById('sp-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'sp-panel-styles';
  style.textContent = [
    '#tooltipwrapper .tooltip p.sp-panel { margin: 0; padding-top: 3px; }',
    '#tooltipwrapper .tooltip .sp-head, #tooltipwrapper .tooltip .sp-foot { display: block; line-height: 20px; font-size: 9pt; white-space: nowrap; }',
    '#tooltipwrapper .tooltip .sp-head small, #tooltipwrapper .tooltip .sp-foot small { font-size: 8pt; color: #666666; }',
    '#tooltipwrapper .tooltip .sp-reset { font-size: 8pt; padding: 0 5px; height: 16px; line-height: 15px; margin-left: 4px; vertical-align: middle; }',
    '#tooltipwrapper .tooltip .sp-row { display: block; height: 20px; line-height: 20px; white-space: nowrap; font-size: 9pt; }',
    '#tooltipwrapper .tooltip .sp-label { display: inline-block; width: 30px; vertical-align: middle; }',
    '#tooltipwrapper .tooltip .sp-end { display: inline-block; width: 18px; font-size: 8pt; color: #666666; text-align: center; vertical-align: middle; }',
    '#tooltipwrapper .tooltip .sp-slider { width: 132px; height: 14px; margin: 0 2px; vertical-align: middle;',
    '  -webkit-appearance: none; appearance: none; border: 1px solid #888888; border-radius: 3px; }',
    '#tooltipwrapper .tooltip .sp-slider:disabled { opacity: 0.8; }',
    '#tooltipwrapper .tooltip .sp-slider::-webkit-slider-thumb { -webkit-appearance: none;',
    '  width: 9px; height: 12px; background: #555555; border-radius: 2px; }',
    '#tooltipwrapper .tooltip .sp-slider::-moz-range-thumb { width: 9px; height: 12px;',
    '  background: #555555; border: 0; border-radius: 2px; }',
    '#tooltipwrapper .tooltip .sp-value { display: inline-block; width: 22px; text-align: right; font-weight: bold; vertical-align: middle; }',
    '#tooltipwrapper .tooltip .sp-stat { display: inline-block; width: 34px; text-align: right; color: #555555; vertical-align: middle; }',
    // The box a range's sources show in: `#tooltipwrapper .tooltip` in battle.css, and its locked look once clicked.
    '#sp-source { position: fixed; z-index: 60; width: 300px; text-align: left; color: black; border: 1px solid #888888;',
    '  background: #EEEEEE; background: rgba(240,240,240,.95); border-radius: 5px; pointer-events: none; }',
    '#sp-source.sp-pinned { border: 2px solid #444444; background: #DEDEDE; pointer-events: auto; }',
    '#sp-source h2 { padding: 2px 4px; margin: 0; border-bottom: 1px solid #888888; font-size: 10pt; color: black; }',
    '#sp-source h2 small { font-weight: normal; }',
    '#sp-source p { padding: 2px 4px; margin: 0; font-size: 9pt; }',
    '#sp-source p small { font-size: 8pt; color: #555555; }',
    '#sp-source p.tooltip-section { border-top: 1px solid #aaaaaa; }',
    '#sp-source h2 + p.tooltip-section { border-top: 0; }',
    '.sp-summary .sp-cell:hover, .sp-summary .sp-cell.sp-chosen { background: rgba(120,140,170,.25); }',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Wires the panel into the client.
 *
 * @param call      the room's Worker call
 * @param branchOf  the branch a room belongs to, with its loaded panel, or null
 */
export function install({ call, branchOf }) {
  const sectionOf = node => (node && node.closest ? node.closest('#tooltipwrapper .sp-panel') : null);

  function redraw(roomid, id) {
    const b = branchOf(roomid);
    const el = document.querySelector(`#tooltipwrapper .tooltip .sp-panel[data-sp-id="${id}"]`);
    const entry = b?.panel?.pokemon.find(p => p.id === id);
    if (!el || !entry || el.dataset.spRoom !== roomid) return;
    const holder = document.createElement('div');
    holder.innerHTML = sectionHtml(roomid, entry, stateOf(b, entry), el.dataset.spForme, readFrom(b.inference));
    el.replaceWith(holder.firstChild);
  }

  async function settle(section, ask) {
    const roomid = section.dataset.spRoom;
    const id = section.dataset.spId;
    const b = branchOf(roomid);
    const entry = b?.panel?.pokemon.find(p => p.id === id);
    if (!entry) return;
    const state = stateOf(b, entry);
    const seq = ++state.seq;
    const got = await ask(b, entry, state);
    if (seq !== state.seq) return;
    // With nothing back, the thumb goes back to where the state still has it.
    if (got) {
      state.spread = got.spread;
      state.reach = got.reach;
    }
    redraw(roomid, id);
  }

  // `#tooltipwrapper` hides the box on any click inside it; a click on the
  // panel is stopped before it gets there.
  document.addEventListener('click', (e) => {
    const section = sectionOf(e.target);
    if (!section) return;
    e.stopPropagation();
    if (e.target.closest('.sp-reset')) {
      e.preventDefault();
      settle(section, (b, entry) => call('spreadReach', b.panel.handle, entry.id, entry.typical)).catch(err => console.error('[encoreable]', err));
    }
  }, true);

  // The readout follows the thumb; the others move once it is let go.
  document.addEventListener('input', (e) => {
    const section = sectionOf(e.target);
    if (!section || !e.target.classList.contains('sp-slider')) return;
    const b = branchOf(section.dataset.spRoom);
    const entry = b?.panel?.pokemon.find(p => p.id === section.dataset.spId);
    const row = e.target.closest('.sp-row');
    if (!entry || !row) return;
    const stat = row.dataset.spStat;
    const sp = valuesFor(entry, stateOf(b, entry), stat)[Number(e.target.value)];
    row.querySelector('.sp-value').textContent = sp;
    const table = statTable(entry, section.dataset.spForme);
    row.querySelector('.sp-stat').textContent = table ? table[stat][sp] : '';
  }, true);

  document.addEventListener('change', (e) => {
    const section = sectionOf(e.target);
    if (!section || !e.target.classList.contains('sp-slider')) return;
    const stat = e.target.closest('.sp-row').dataset.spStat;
    const index = Number(e.target.value);
    settle(section, (b, entry, state) => {
      const value = valuesFor(entry, state, stat)[index];
      return call('spreadMove', b.panel.handle, entry.id, stat, value, state.spread);
    }).catch(err => console.error('[encoreable]', err));
  }, true);

  // Where a range in the log's Stat Point block came from: shown while a cell
  // is hovered, and kept, in the client's locked look, once it is clicked.
  let pinned = null;
  const cellOf = node => (node && node.closest ? node.closest('.sp-summary .sp-cell') : null);
  const sourceBox = () => {
    let box = document.getElementById('sp-source');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sp-source';
      box.style.display = 'none';
      document.body.appendChild(box);
    }
    return box;
  };
  function hideSource() {
    sourceBox().style.display = 'none';
    sourceBox().classList.remove('sp-pinned');
    if (pinned) pinned.classList.remove('sp-chosen');
    pinned = null;
  }
  function showSource(cell, pin) {
    const m = /\bsp-at-(p[12])-(\d+)-(\w+)\b/.exec(cell.className);
    const room = m && window.app && Object.values(app.rooms).find(r => r && r.el && r.el.contains && r.el.contains(cell));
    const b = room && branchOf(room.id);
    const side = room && /-(p[12])$/.exec(room.id)?.[1];
    if (!b || !b.panel || !side) return;
    const id = `${m[1]}:${m[2]}`;
    const html = sourceHtml(b, side, id, m[3]);
    if (!html) return;
    const box = sourceBox();
    box.innerHTML = html;
    box.classList.toggle('sp-pinned', !!pin);
    box.style.display = 'block';
    drawGrids(box, b.panel.pokemon.find(p => p.id === id));
    const at = cell.getBoundingClientRect();
    const width = box.offsetWidth;
    const left = at.right + 8 + width <= window.innerWidth ? at.right + 8 : Math.max(4, at.left - 8 - width);
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(4, Math.min(at.top, window.innerHeight - box.offsetHeight - 4))}px`;
    if (pin) {
      if (pinned) pinned.classList.remove('sp-chosen');
      pinned = cell;
      cell.classList.add('sp-chosen');
    }
  }
  document.addEventListener('mouseover', (e) => {
    const cell = cellOf(e.target);
    if (cell && !pinned) showSource(cell, false);
  }, true);
  document.addEventListener('mouseout', (e) => {
    const cell = cellOf(e.target);
    if (cell && !pinned && !(e.relatedTarget && cell.contains(e.relatedTarget))) hideSource();
  }, true);
  document.addEventListener('click', (e) => {
    const cell = cellOf(e.target);
    if (cell) {
      if (pinned === cell) hideSource();
      else showSource(cell, true);
      return;
    }
    if (pinned && !(e.target.closest && e.target.closest('#sp-source'))) hideSource();
  }, true);

  function wrap() {
    const proto = window.BattleTooltips && BattleTooltips.prototype;
    if (!proto) return false;
    if (proto.__spWrapped) return true;
    proto.__spWrapped = true;
    const original = proto.showPokemonTooltip;
    proto.showPokemonTooltip = function (pokemon, serverPokemon, isActive, illusionIndex) {
      const html = original.apply(this, arguments);
      try {
        if (illusionIndex && illusionIndex > 1) return html;
        const roomid = this.battle && this.battle.roomid;
        const b = branchOf(roomid);
        if (!b || !b.panel) return html;
        const side = pokemon && pokemon.side ? pokemon.side : this.battle.mySide;
        const name = pokemon ? pokemon.name : serverPokemon && serverPokemon.name;
        const forme = (pokemon && pokemon.speciesForme) || (serverPokemon && serverPokemon.speciesForme) || '';
        const entry = side && entryFor(b, side.sideid, name, forme);
        if (!entry) return html;
        return html + sectionHtml(roomid, entry, stateOf(b, entry), forme, readFrom(b.inference));
      } catch (err) {
        return html;
      }
    };
    return true;
  }

  const boot = () => {
    if (!document.head || !wrap()) { setTimeout(boot, 200); return; }
    addStyles();
  };
  boot();
}

/** Loads a branch's panel from its Worker battle, once both rooms can show it. */
export async function loadPanel(b, call) {
  b.panel = await call('spreadPanel', b.key, b.inference || null);
  b.sliders = {};
  return b.panel;
}
