/** Two Showdown-style team exports, shared by setup and Edit teams in a branch. */
const CSS = `
.enc-team-dialog { width:min(1160px,calc(100vw - 48px)); max-height:calc(100vh - 48px); padding:0; border:1px solid #888; border-radius:6px; background:#f5f5f5; color:#222; box-shadow:0 6px 30px #0005; font:13px Verdana,sans-serif; }
.enc-team-dialog::backdrop { background:#0005; }
.enc-team-dialog header { padding:14px 18px 10px; border-bottom:1px solid #bbb; background:linear-gradient(#fff,#e8e8e8); }
.enc-team-dialog h2 { margin:0 0 6px; font-size:17px; }
.enc-team-dialog p { margin:6px 0; line-height:1.5; }
.enc-team-dialog .enc-team-source { color:#555; overflow-wrap:anywhere; }
.enc-team-dialog nav { display:flex; gap:6px; margin-top:12px; }
.enc-team-dialog nav button[aria-pressed=true] { background:#dce9f6; border-color:#54769b; color:#173b60; }
.enc-team-dialog .enc-team-help { padding:8px 18px 0; min-height:36px; }
.enc-team-dialog .enc-team-panes { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; padding:8px 18px 14px; }
.enc-team-dialog label { display:block; font-weight:bold; margin-bottom:7px; }
.enc-team-dialog textarea { display:block; box-sizing:border-box; width:100%; height:min(470px,52vh); min-height:160px; resize:vertical; padding:8px; border:1px solid #8e9eab; border-radius:3px; background:#fff; color:#111; font:13px/1.4 monospace; white-space:pre; tab-size:2; }
.enc-team-dialog textarea:focus { outline:2px solid #6c9bd2; outline-offset:0; }
.enc-team-dialog textarea[readonly] { background:#fafafa; color:#444; }
.enc-team-dialog footer { display:flex; align-items:center; gap:8px; padding:10px 18px; border-top:1px solid #bbb; background:#eee; }
.enc-team-dialog .enc-team-status { flex:1; white-space:pre-wrap; max-height:100px; overflow:auto; line-height:1.5; }
.enc-team-dialog .enc-team-error { color:#9b2323; }
.enc-team-toolbar { position:sticky; top:0; z-index:2; padding:6px 8px; text-align:left; border-bottom:1px solid #ccc; background:#f5f5f5; }
.dark .enc-team-dialog { color:#ddd; background:#252525; }
.dark .enc-team-dialog header,.dark .enc-team-dialog footer,.dark .enc-team-toolbar { background:#333; border-color:#555; }
.dark .enc-team-dialog textarea { color:#eee; background:#171717; border-color:#666; }
.dark .enc-team-dialog textarea[readonly] { background:#222; }
.dark .enc-team-dialog .enc-team-source { color:#bbb; }
@media(max-width:650px) { .enc-team-dialog { width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .enc-team-dialog .enc-team-panes { grid-template-columns:1fr; } .enc-team-dialog textarea { height:220px; } .enc-team-dialog footer { flex-wrap:wrap; } .enc-team-dialog .enc-team-status { flex-basis:100%; } }
`;

/** DOM text and textarea.value keep team exports out of HTML interpolation. */
export function installTeamEditor({ call, apply }) {
  let active = null;
  const drafts = new Map();
  const style = document.createElement('style');
  style.textContent = CSS;
  (document.head || document.documentElement).append(style);

  async function open(b) {
    if (active) { active.focus(); return; }
    const model = await call('teamEditor', b.key, b.inference, b.evidence);
    if (active) { active.focus(); return; }
    const priorFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    active = dialog;
    dialog.className = 'enc-team-dialog';
    dialog.setAttribute('aria-labelledby', 'enc-team-title');
    dialog.innerHTML = `<header><h2 id="enc-team-title">Edit teams · Turn ${model.turn}</h2>
      <p class="enc-team-source"></p><nav aria-label="Team view">
      <button type="button" class="button" data-view="sets" aria-pressed="true">Sets to test</button>
      <button type="button" class="button" data-view="evidence" aria-pressed="false">Replay evidence</button>
      </nav></header><p class="enc-team-help"></p><div class="enc-team-panes">
      <section><label for="enc-team-p1"></label><textarea id="enc-team-p1" spellcheck="false" wrap="off"></textarea></section>
      <section><label for="enc-team-p2"></label><textarea id="enc-team-p2" spellcheck="false" wrap="off"></textarea></section>
      </div><footer><span class="enc-team-status" role="status" aria-live="polite"></span>
      <button type="button" class="button" data-action="reset">Reset edits</button>
      <button type="button" class="button" data-action="cancel">Back to battle</button>
      <button type="button" class="button" data-action="apply"><strong>Apply and resume</strong></button></footer>`;
    dialog.querySelector('.enc-team-source').textContent = b.source || 'Encoreable analysis';
    const areas = [...dialog.querySelectorAll('textarea')];
    const labels = [...dialog.querySelectorAll('label')];
    labels.forEach((label, i) => { label.textContent = `${i ? 'Right' : 'Left'} team · ${model.players[i]}`; });
    const saved = drafts.get(b.n);
    let edited = saved?.token === model.token ? saved.teams.slice() : model.teams.slice();
    let view = 'sets';
    let busy = false;
    let applied = false;
    const status = dialog.querySelector('.enc-team-status');
    const applyButton = dialog.querySelector('[data-action=apply]');
    const remember = () => {
      if (view === 'sets') edited = areas.map(area => area.value);
      drafts.set(b.n, { token: model.token, teams: edited.slice() });
    };
    const render = () => {
      areas.forEach((area, i) => { area.value = (view === 'sets' ? edited : model.evidence)[i]; area.readOnly = view !== 'sets'; });
      dialog.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
      dialog.querySelector('.enc-team-help').textContent = view === 'sets'
        ? 'Edit stats, moves, item, ability or nature in Showdown export format. EVs are Champions Stat Points; IVs stay 31. Apply opens a new branch with the same visible history.'
        : 'Original replay evidence. Ranges assume its original items, abilities and natures; not every combination fits. Unknown stays unknown when you test a set.';
      applyButton.disabled = view !== 'sets' || busy;
      dialog.querySelector('[data-action=reset]').disabled = view !== 'sets' || busy;
    };
    dialog.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || busy) return;
      if (button.dataset.view) { remember(); view = button.dataset.view; render(); return; }
      if (button.dataset.action === 'reset') { edited = model.teams.slice(); render(); remember(); return; }
      if (button.dataset.action === 'cancel') { dialog.close(); return; }
      if (button.dataset.action !== 'apply') return;
      remember();
      busy = true;
      dialog.setAttribute('aria-busy', 'true');
      dialog.querySelectorAll('button, textarea').forEach(el => { el.disabled = true; });
      status.classList.remove('enc-team-error');
      status.textContent = 'Checking teams and rebuilding the preceding turns…';
      try {
        const result = await apply(b, edited, model.token);
        if (!result.ok) throw new Error(result.message);
        drafts.delete(b.n);
        applied = true;
        busy = false;
        dialog.close();
      } catch (err) {
        status.textContent = (err.message || String(err)).replace(/\n\s+at[\s\S]*$/, '').replace(/^Error:\s*/, '');
        status.classList.add('enc-team-error');
        busy = false;
        dialog.removeAttribute('aria-busy');
        dialog.querySelectorAll('button, textarea').forEach(el => { el.disabled = false; });
        render();
      }
    });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      if (!applied) remember();
      dialog.remove(); active = null;
      if (priorFocus?.isConnected) priorFocus.focus();
    }, { once: true });
    document.body.append(dialog);
    render();
    dialog.showModal();
    areas[0].focus();
    areas[0].setSelectionRange(0, 0);
    areas.forEach(area => { area.scrollTop = 0; });
  }

  /** Toolbar is outside the controls Showdown replaces after every choice. */
  function attach(b, room) {
    if (!room?.el || room.el.querySelector('.enc-team-toolbar')) return;
    const bar = document.createElement('div');
    bar.className = 'enc-team-toolbar';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button'; button.textContent = 'Edit teams';
    button.addEventListener('click', () => open(b).catch(err => {
      button.title = err.message; console.error('[encoreable] team editor:', err);
    }));
    bar.append(button);
    const log = room.el.querySelector('.battle-log');
    (log || room.el).prepend(bar);
  }
  return { open, attach };
}
