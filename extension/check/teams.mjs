/** Team edits in the real client, including failure, replay and reload contracts. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { click, connect, declineConsent, launchChrome } from './harness.mjs';
import { battleLines, firstDivergence } from '../../scripts/lib/protocol.mjs';
import { freshKnowledge, packKnowledge } from '../../scripts/lib/inference/knowledge.mjs';

const require = createRequire(import.meta.url);
const { BattleStream } = require('pokemon-showdown');
require('../../scripts/server/rng-command.js').teachStream(BattleStream);

export async function run({ root, dist, headful }) {
  const recording = JSON.parse(fs.readFileSync(path.join(root, 'recordings/local/branched/gen9championsvgc2026regmb-200.log.json')));
  const chrome = await launchChrome({ extension: dist, headful });
  let failures = 0;
  const check = (ok, what) => { console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`); if (!ok) failures++; };
  try {
    const page = await connect(chrome.port);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    const leaks = [];
    page.on('Network.webSocketFrameSent', p => { if (/encoreable\d+-p[12]/.test(p.response.payloadData)) leaks.push(p.response.payloadData); });
    await page.send('Page.navigate', { url: 'https://play.pokemonshowdown.com/' });
    await page.waitFor('window.app && window.encoreable', 45000);
    await declineConsent(page);
    const source = await page.evaluate(`encoreable.openBranch({inputLog:${JSON.stringify(recording.inputLog.join('\n'))}, turn:4, source:'Team editor check', setup:true})`);
    const layout = await page.evaluate(`(() => {
      const d=document.querySelector('.enc-team-dialog'), a=[...d.querySelectorAll('textarea')];
      return {open:d.open, six:a.every(x=>(x.value.match(/^Ability:/gm)||[]).length===6), sideBySide:a[0].getBoundingClientRect().left<a[1].getBoundingClientRect().left, top:a[0].scrollTop};
    })()`);
    check(layout.open && layout.six && layout.sideBySide && layout.top === 0, 'setup opens two complete teams side by side, starting at the top');
    await click(page, '.enc-team-dialog [data-view=evidence]');
    check(await page.evaluate(`Array.from(document.querySelectorAll('.enc-team-dialog textarea')).every(a=>a.readOnly) && document.querySelector('.enc-team-dialog [data-action=apply]').disabled`), 'replay evidence is read-only and cannot be applied as a set');
    await click(page, '.enc-team-dialog [data-view=sets]');
    const original = await page.evaluate(`encoreable.exportLog(${source.n})`);
    // A valid knowledge object exercises range formatting without doing inference in a UI check.
    const inferred = { inferred: ['p1'], pokemon: [{ id: 'p1:0', knowledge: packKnowledge(freshKnowledge({}, false)) }] };
    const evidence = await page.evaluate(`encoreable.call('teamEditor',1,${JSON.stringify(inferred)})`);
    check(evidence.evidence[0].includes('0-32 HP') && evidence.evidence[0].includes('@ Unknown') && evidence.evidence[0].includes('Unknown Nature'), 'unknown fields and stat ranges are preserved as uncertainty');
    const guard = await page.evaluate(`(async()=>{
      const m=await encoreable.call('teamEditor',1), results=[];
      for(const [from,to] of [['EVs: 24 HP','EVs: 24-32 HP'],['Modest Nature','Unknown Nature'],['EVs: 24 HP','EVs: 33 HP'],['EVs: 24 HP','IVs: 0 Atk\\nEVs: 24 HP']]) {
        const teams=m.teams.slice(); teams[0]=teams[0].replace(from,to);
        try {await encoreable.call('editTeams',1,teams,m.token,{threads:1,maxProbes:1});results.push(false)}catch(e){results.push(true)}
      }
      const same=await encoreable.call('editTeams',1,m.teams,m.token,{threads:1,maxProbes:1});
      if(same.ok) await encoreable.call('close',same.opened.key);
      const whitespace=[];
      for(const value of ['EVs: 24  HP','EVs:24 HP','EVs:\\t24\\tHP']) {
        const teams=m.teams.slice();teams[0]=teams[0].replace('EVs: 24 HP',value);
        const r=await encoreable.call('editTeams',1,teams,m.token,{threads:1,maxProbes:1});
        whitespace.push(r.ok&&!r.changed);
        if(r.ok) await encoreable.call('close',r.opened.key);
      }
      const ballTeams=m.teams.slice();ballTeams[0]=ballTeams[0].replace('Ability: Blaze','Pokeball: Ultra Ball\\nAbility: Blaze');
      const withBall=await encoreable.call('editTeams',1,ballTeams,m.token,{threads:1,maxProbes:1});
      const ballModel=withBall.ok&&await encoreable.call('teamEditor',withBall.opened.key);
      const ballAgain=ballModel&&await encoreable.call('editTeams',withBall.opened.key,ballModel.teams,ballModel.token,{threads:1,maxProbes:1});
      const ball=ballModel&&ballModel.teams[0].includes('Pokeball: Ultra Ball')&&ballAgain.ok&&!ballAgain.changed;
      if(withBall.ok) await encoreable.call('close',withBall.opened.key);
      if(ballAgain?.ok) await encoreable.call('close',ballAgain.opened.key);
      const bad=m.teams.slice(); bad[0]=bad[0].replace('- Dragon Claw','- Dragon Tail');
      const failed=await encoreable.call('editTeams',1,bad,m.token,{threads:1,maxProbes:1});
      return {guard:results.every(Boolean),same:same.ok&&!same.changed,whitespace:whitespace.every(Boolean),ball,failed:!failed.ok&&failed.message.includes('does not rule out'),original:(await encoreable.exportLog(${source.n})).inputLog};
    })()`);
    check(guard.guard, 'range syntax, unknown choices, illegal Stat Points and IVs cannot silently enter the simulator');
    check(guard.same, 'applying unchanged teams retains their inference');
    check(guard.whitespace, 'extra spaces, tabs and a missing space after the stat colon preserve every value');
    check(guard.ball, 'Poké Ball metadata survives exporting, editing and applying the editor’s own exports');
    check(guard.failed && JSON.stringify(guard.original) === JSON.stringify(original.inputLog), 'an incomplete rebuild leaves the original intact and rules out nothing');

    await page.evaluate(`document.querySelector('#enc-team-p1').value=document.querySelector('#enc-team-p1').value.replace('EVs: 24 HP','EVs: 24-32 HP')`);
    await click(page, '.enc-team-dialog [data-action=apply]');
    await page.waitFor(`document.querySelector('.enc-team-error') && !document.querySelector('.enc-team-dialog [data-action=apply]').disabled`, 10000);
    check(await page.evaluate(`document.querySelector('#enc-team-p1').value.includes('24-32 HP') && !document.querySelector('.enc-team-error').textContent.includes('at editedTeam')`), 'validation errors preserve the draft and show a readable explanation');
    await click(page, '.enc-team-dialog [data-action=reset]');

    await page.evaluate(`document.querySelector('#enc-team-p1').value=document.querySelector('#enc-team-p1').value.replace('- Spirit Break','- Play Rough').replace('32 HP / 0 Atk / 19 Def','32 HP / 1 Atk / 18 Def')`);
    await click(page, '.enc-team-dialog [data-action=apply]');
    const edited = await page.waitFor(`(() => {const b=encoreable.branches().find(b=>b.n!==${source.n});return !document.querySelector('.enc-team-dialog')&&b})()`, 30000);
    const played = await page.evaluate(`encoreable.exportLog(${edited.n})`);
    // Read what the native room received, rather than assuming a worker session id.
    const request = await page.waitFor(`(() => {const r=app.rooms[${JSON.stringify(edited.rooms[0])}];return r?.request?.active&&r.request})()`, 10000);
    check(played.turn === 4 && request.active.some(slot => slot.moves?.some(m => m.id === 'playrough')),
      'Apply and resume opens a new turn-4 branch whose native move buttons use the edited move');
    check(played.inputLog.some(l => l.includes('32,1,18,,15,')), 'the branch input log contains the edited Stat Points');
    check(JSON.stringify((await page.evaluate(`encoreable.exportLog(${source.n})`)).inputLog) === JSON.stringify(original.inputLog), 'successful edits also leave the original branch untouched');
    // A branch must replay from its own input log, with no hidden state patch.
    const stream = new BattleStream({ keepAlive: true });
    const drain = (async () => { for await (const chunk of stream) void chunk; })();
    await stream.write(played.inputLog.join('\n'));
    const diff = firstDivergence(battleLines(played.log), battleLines(stream.battle.getDebugLog()));
    await stream.writeEnd(); await drain;
    check(!diff, 'the edited browser battle replays identically in Node');

    await page.evaluate('window.__beforeTeamReload = true');
    await page.send('Page.reload');
    await page.waitFor(`!window.__beforeTeamReload && window.encoreable && encoreable.branches().some(b=>b.n===${edited.n}) && app.rooms[${JSON.stringify(edited.rooms[0])}]?.request`, 45000);
    const restored = await page.evaluate(`encoreable.exportLog(${edited.n})`);
    check(JSON.stringify(restored.inputLog) === JSON.stringify(played.inputLog), 'the edited branch survives a page reload');
    await page.evaluate(`encoreable.editTeams(${edited.n})`);
    check(await page.evaluate(`document.querySelector('#enc-team-p1').value.includes('- Play Rough')`), 'Edit teams reopens with the selected sets after reload');
    await click(page, '.enc-team-dialog [data-view=evidence]');
    check(await page.evaluate(`document.querySelector('#enc-team-p1').value.includes('- Spirit Break') && !document.querySelector('#enc-team-p1').value.includes('- Play Rough')`), 'the original evidence survives editing and reload separately from the selected set');
    check(leaks.length === 0, 'team editing sends no analysis-room messages to Showdown');
    page.close();
  } finally {
    await chrome.close();
  }
  return failures === 0;
}
