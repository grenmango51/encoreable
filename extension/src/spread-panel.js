/**
 * The Stat Point panel of a branch, in the live client: a slider per stat in
 * every Pokemon's tooltip, and a note in the battle log at each turn where the
 * replay narrowed what an inferred Pokemon's Stat Points can be.
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
 * Where an event narrowed which HP goes with which Defence or Special Defence,
 * its note opens onto both pairings as a grid.
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
const range = r => (r ? (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`) : 'none');

// ---------------------------------------------------------------- the log

const unpackBits = (text, length) => {
  const raw = atob(text);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
};

const GRID_COLOURS = { on: '#4a5f78', cut: '#d0453a', off: '#dddddd' };

/** One pairing as rows of blocks, HP 32 at the top: possible, ruled out by this event, or ruled out before it. */
function gridRows(before, after) {
  const rows = [];
  for (let hp = SPAN - 1; hp >= 0; hp--) {
    let row = '';
    let run = '';
    let colour = null;
    for (let x = 0; x < SPAN; x++) {
      const i = hp * SPAN + x;
      const c = after[i] ? 'on' : before[i] ? 'cut' : 'off';
      if (c !== colour && run) { row += `<span style="color:${GRID_COLOURS[colour]}">${run}</span>`; run = ''; }
      colour = c;
      run += '█';
    }
    row += `<span style="color:${GRID_COLOURS[colour]}">${run}</span>`;
    rows.push(row);
  }
  // A protocol line ends at a newline, so the rows break with <br>.
  return rows.join('<br />');
}

function gridHtml(before, after) {
  const block = '<div style="font-family:monospace;font-size:5px;line-height:5px;letter-spacing:0;white-space:nowrap;margin:2px 0">';
  return '<details class="details"><summary><small>Which HP goes with which Def and SpD</small></summary>' +
    '<table><tr>' +
    `<td><small>HP ↑ by Def →</small>${block}${gridRows(before.def, after.def)}</div></td>` +
    `<td><small>HP ↑ by SpD →</small>${block}${gridRows(before.spd, after.spd)}</div></td>` +
    '</tr></table>' +
    `<small><span style="color:${GRID_COLOURS.on}">█</span> still possible ` +
    `<span style="color:${GRID_COLOURS.cut}">█</span> ruled out here ` +
    `<span style="color:${GRID_COLOURS.off}">█</span> ruled out before. 0 is bottom left.</small></details>`;
}

function who(b, id, fallback, side) {
  const entry = b.panel?.pokemon.find(p => p.id === id);
  const name = escapeHtml(entry ? entry.name : fallback);
  return id.slice(0, 2) === side ? name : `the opposing ${name}`;
}

const note = (body, context, more = '') => `|raw|<div class="sp-note"><small style="color:#888">Stat Points</small> ${body}` +
  `${context ? ` <small style="color:#888">(${context})</small>` : ''}${more}</div>`;

/** A spread count short enough for a table cell. */
const short = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : count(n));

/**
 * The notes for one room of a branch: per turn of the replay before the branch
 * point, what that turn narrowed; then what the rest of the replay narrowed,
 * and what every observation together leaves, which is what the sliders show.
 *
 * Each note's ranges run on from the ones before it in the order the log shows
 * them, each new range kept inside the last: the evidence pass reads speed
 * order after every hit, so its own order is not the battle's.
 */
function notes(b, side) {
  const inf = b.inference;
  const inline = new Map();
  const later = [];
  const put = (turn, line) => {
    if (turn < b.start) {
      if (!inline.has(turn)) inline.set(turn, []);
      inline.get(turn).push(line);
    } else {
      later.push(line);
    }
  };
  const full = () => Object.fromEntries(STATS.map(s => [s, { min: 0, max: SPAN - 1 }]));
  const allPairs = () => ({ def: new Uint8Array(SPAN * SPAN).fill(1), spd: new Uint8Array(SPAN * SPAN).fill(1) });
  const cur = new Map();
  const at = id => {
    if (!cur.has(id)) cur.set(id, { ranges: full(), grids: allPairs() });
    return cur.get(id);
  };
  const events = (inf.events || []).map((e, order) => ({ ...e, order })).sort((x, y) => x.turn - y.turn || x.order - y.order);
  for (const e of events) {
    const context = escapeHtml(`${e.what}${e.shown !== undefined ? `, shown ${e.shown}` : ''}`);
    for (const c of e.cuts) {
      const now = at(c.id);
      const moved = [];
      for (const s of c.narrowed) {
        const was = now.ranges[s];
        const to = c.stats[s];
        const next = !was || !to ? null : { min: Math.max(was.min, to.min), max: Math.min(was.max, to.max) };
        const kept = next && next.min <= next.max ? next : null;
        if (range(kept) === range(was)) continue;
        moved.push(`${LABEL[s]} ${range(was)} → ${range(kept)}`);
        now.ranges[s] = kept;
      }
      let grid = '';
      if (c.grids) {
        const after = {};
        let changed = false;
        for (const d of ['def', 'spd']) {
          after[d] = unpackBits(c.grids[d], SPAN * SPAN).map((v, i) => v & now.grids[d][i]);
          changed ||= after[d].some((v, i) => v !== now.grids[d][i]);
        }
        if (changed) {
          grid = gridHtml(now.grids, after);
          now.grids = after;
        }
      }
      let said = moved.join(', ');
      if (!said) {
        said = grid ? 'no one stat\'s range moved, but which HP goes with which Def and SpD did'
          : 'no one stat\'s range moved, but which values go together did';
      }
      put(e.turn, note(`<strong>${who(b, c.id, c.pokemon, side)}</strong>: ${said}`, context, grid));
    }
  }
  for (const c of inf.checks || []) {
    put(c.turn ?? 0, note(`<em>not used:</em> ${escapeHtml(c.what)}`, escapeHtml(c.reason)));
  }

  // What every observation together leaves, against where the notes left each range.
  const summary = [];
  for (const entry of (b.panel?.pokemon || []).filter(p => p.inferred && !p.unrecorded)) {
    const now = at(entry.id);
    const moved = STATS.filter(s => range(now.ranges[s]) !== range(entry.ranges[s]))
      .map(s => `${LABEL[s]} ${range(now.ranges[s])} → ${range(entry.ranges[s])}`);
    if (moved.length) {
      summary.push(note(`<strong>${who(b, entry.id, entry.name, side)}</strong>: ${moved.join(', ')}`,
        'every observation read together'));
    }
  }
  const cell = 'style="white-space:nowrap;padding:0 1px;text-align:right"';
  const tables = [];
  for (const team of ['p1', 'p2']) {
    const rows = (b.panel?.pokemon || []).filter(p => p.side === team && p.inferred && !p.unrecorded).map(p => '<tr>' +
      `<td style="white-space:nowrap">${escapeHtml(p.name)}</td>` + STATS.map(s => `<td ${cell}>${range(p.ranges[s])}</td>`).join('') +
      `<td ${cell}>${short(p.spreads)}</td></tr>`);
    if (!rows.length) continue;
    tables.push(`<small>${team === side ? 'Your team' : 'Their team'}</small><table style="font-size:7.5pt"><tr><th></th>` +
      `${STATS.map(s => `<th ${cell}>${LABEL[s]}</th>`).join('')}<th ${cell}>spreads</th></tr>${rows.join('')}</table>`);
  }
  if (tables.length) {
    summary.push('|raw|<div class="infobox"><details class="details"><summary>Stat Points the replay allows</summary>' +
      `${tables.join('')}<small>Hover a Pok&eacute;mon for its sliders.</small></details></div>`);
  }
  if (later.length) later.unshift('|raw|<div class="sp-note"><small style="color:#888">Stat Points</small> <em>What the rest of the replay showed:</em></div>');
  return { inline, tail: [...later, ...summary] };
}

/**
 * A room's scrollback with the Stat Point notes in it: each turn's at the end
 * of that turn, and the rest just before the turn the branch starts at.
 */
export function annotate(lines, b, side) {
  if (!b.inference) return lines;
  const { inline, tail } = notes(b, side);
  const out = [];
  let placed = false;
  for (const line of lines) {
    const m = /^\|turn\|(\d+)/.exec(line);
    if (m) {
      const t = Number(m[1]);
      out.push(...(inline.get(t - 1) || []));
      inline.delete(t - 1);
      if (t === b.start) { out.push(...tail); placed = true; }
    }
    out.push(line);
  }
  for (const rest of inline.values()) out.push(...rest);
  if (!placed) out.push(...tail);
  return out;
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

function sectionHtml(roomid, entry, state, forme) {
  const table = statTable(entry, forme);
  let head = '<strong>Stat Points</strong> ';
  if (!entry.inferred) head += '<small>known</small>';
  else if (entry.unrecorded) head += '<small>this recording did not keep its ranges</small>';
  else if (!sliding(entry)) head += '<small>no spread fits the replay</small>';
  else head += `<small title="${count(entry.spreads)} spreads">${short(entry.spreads)} spreads fit the replay</small> <button class="button sp-reset">Reset</button>`;
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
    html += `<span class="sp-foot"><small>This battle runs on ${STATS.map(s => entry.used[s]).join(' / ')}</small></span>`;
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
    holder.innerHTML = sectionHtml(roomid, entry, stateOf(b, entry), el.dataset.spForme);
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
        return html + sectionHtml(roomid, entry, stateOf(b, entry), forme);
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
