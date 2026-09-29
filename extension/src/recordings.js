/**
 * The recordings page: what the store holds, and the way to open any of it at
 * a turn. Imports keep the file's exact text; exports give it back.
 */

import * as store from './store.js';

const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const status = document.getElementById('status');

function say(text, kind = '') {
  status.textContent = text;
  status.className = kind;
}

function cell(content, className = '') {
  const td = document.createElement('td');
  if (className) td.className = className;
  if (content instanceof Node) td.append(content);
  else td.textContent = content;
  return td;
}

function button(label, onClick, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function render() {
  const list = await store.list();
  rows.replaceChildren();
  empty.hidden = list.length > 0;
  for (const r of list) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    const kind = document.createElement('span');
    kind.className = 'tag';
    kind.textContent = r.reconstructed
      ? (r.complete ? 'rebuilt from a replay' : `rebuilt, verified to turn ${r.verifiedThroughTurn}`)
      : 'recorded';

    const turn = document.createElement('input');
    turn.type = 'number';
    turn.min = '1';
    turn.value = '1';
    if (r.turns) turn.max = String(r.turns);
    turn.setAttribute('aria-label', `Turn to open ${r.name} at`);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      turn,
      button('Open', async () => {
        try {
          const reply = await chrome.runtime.sendMessage({ op: 'open', recordingId: r.id, turn: Number(turn.value) || 1 });
          if (!reply || !reply.ok) throw new Error(reply ? reply.error : 'no answer from the extension');
          say(`Opened ${r.name} at turn ${turn.value} in a new tab.`, 'ok');
        } catch (err) { say(err.message, 'error'); }
      }, 'primary'),
      button('Export', async () => {
        const row = await store.get(r.id);
        download(row.name, row.text);
      }),
      button('Delete', async () => {
        if (!confirm(`Delete ${r.name}? A recording cannot be regenerated - export it first if you want to keep it.`)) return;
        await store.remove(r.id);
        say(`Deleted ${r.name}.`);
        render();
      }, 'danger'),
    );

    tr.append(
      cell(r.name, 'name'),
      cell(r.players.filter(Boolean).join(' vs. ')),
      cell(r.turns == null ? '-' : String(r.turns), 'num'),
      cell(kind),
      cell(new Date(r.savedAt).toLocaleString()),
      cell(actions),
    );
    rows.append(tr);
  }
}

document.getElementById('import').addEventListener('change', async (event) => {
  const files = [...event.target.files];
  let done = 0;
  const failed = [];
  for (const file of files) {
    try {
      await store.put({ name: file.name, text: await file.text(), source: 'imported' });
      done++;
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
  }
  event.target.value = '';
  say(failed.length ? `Imported ${done}; not imported - ${failed.join('; ')}` : `Imported ${done} recording${done === 1 ? '' : 's'}.`, failed.length ? 'error' : 'ok');
  render();
});

render().catch(err => say(err.message, 'error'));
