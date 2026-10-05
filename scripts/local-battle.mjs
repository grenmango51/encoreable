/**
 * Record a fresh battle.
 *
 * Brings up the local server and the client host, then opens two browser windows
 * under separate profiles - one user cannot hold both slots of a battle
 * (server/room-battle.ts:666). `scripts/client/autobattle.js` rides along in each
 * page: it names the guest, loads a fixture team, and issues or accepts the
 * challenge, so a battle is running without anything being clicked.
 *
 * The finished battle lands in runtime/logs with its inputLog intact, which
 * requires Config.logchallenges - see provision-local-server.mjs.
 * `npm run replay -- --from <that file>` archives it to recordings/local/self-play/.
 *
 * Usage:
 *   npm run battle
 */

import { spawn } from 'child_process';
import http from 'http';
import { launchPair } from './lib/browser.mjs';

const ROOT_DIR = process.cwd();

async function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}`, (res) => resolve(true)).on('error', () => resolve(false));
    req.setTimeout(400, () => {
      req.abort();
      resolve(false);
    });
  });
}

async function waitForPort(port, host = '127.0.0.1', timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port, host)) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  console.log('=====================================================');
  console.log('       ENCOREABLE 1-CLICK INSTANT AUTO-BATTLE        ');
  console.log('=====================================================\n');

  let serverRunning = (await isPortOpen(8000)) && (await isPortOpen(8080));

  if (!serverRunning) {
    console.log('Starting local Showdown server and client host...');
    spawn(process.execPath, ['scripts/local-serve.mjs'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      detached: true
    });

    const ready = (await waitForPort(8000)) && (await waitForPort(8080));
    if (!ready) {
      console.error('Failed to start servers within timeout.');
      process.exit(1);
    }
    console.log('Servers are up and running.\n');
  } else {
    console.log('Local servers active on ports 8000 & 8080.\n');
  }

  // Generate a distinct pair name per launch to avoid ghost collision
  const uid = Math.floor(100 + Math.random() * 900);
  const p1Name = `Player1_${uid}`;
  const p2Name = `Player2_${uid}`;

  const p1Url = `http://127.0.0.1:8080/testclient.html?~~127.0.0.1:8000&autoname=${p1Name}&autoteam=p1&autochallenge=${p2Name}`;
  const p2Url = `http://127.0.0.1:8080/testclient.html?~~127.0.0.1:8000&autoname=${p2Name}&autoteam=p2&autoaccept=${p1Name}`;

  console.log('Opening two browser windows side-by-side (Left & Right)...');
  const via = await launchPair({ left: p1Url, right: p2Url, tag: String(uid) });
  const browserName = { chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Mozilla Firefox' }[via];
  console.log(`Launched via ${browserName || 'the default system browser'}.`);

  console.log('\n--- BATTLE READY ---');
  console.log(`Left Window:  ${p1Name} (Champions Reg M-C Sand / TrickRoom)`);
  console.log(`Right Window: ${p2Name} (Champions Reg M-C Rain / Sun)`);
  console.log('\nBoth windows will connect, load teams, and join the battle automatically.');
  console.log('Enjoy your battle! To stop the servers later, run: npm run stop\n');
}

main().catch(err => {
  console.error('Error starting auto-battle:', err);
  process.exit(1);
});
