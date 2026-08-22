import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

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

function findBrowser() {
  const candidates = [
    { type: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { type: 'chrome', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    { type: 'chrome', path: path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe') },
    { type: 'edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    { type: 'edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
    { type: 'firefox', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' }
  ];

  for (const item of candidates) {
    if (fs.existsSync(item.path)) {
      return item;
    }
  }
  return null;
}

async function main() {
  console.log('=====================================================');
  console.log('       ENCOREABLE 1-CLICK INSTANT AUTO-BATTLE        ');
  console.log('=====================================================\n');

  let serverRunning = (await isPortOpen(8000)) && (await isPortOpen(8080));

  if (!serverRunning) {
    console.log('Starting local Showdown server and client host...');
    spawn('node', ['scripts/local-play.mjs'], {
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

  const browser = findBrowser();
  const profileDirP1 = path.join(os.tmpdir(), `encoreable_p1_${uid}`);
  const profileDirP2 = path.join(os.tmpdir(), `encoreable_p2_${uid}`);

  fs.mkdirSync(profileDirP1, { recursive: true });
  fs.mkdirSync(profileDirP2, { recursive: true });

  console.log('Opening two browser windows side-by-side (Left & Right)...');

  if (browser && (browser.type === 'chrome' || browser.type === 'edge')) {
    const browserName = browser.type === 'chrome' ? 'Google Chrome' : 'Microsoft Edge';
    console.log(`Launching via ${browserName}...`);

    // Player 2 (Right Window)
    spawn(browser.path, [
      `--user-data-dir=${profileDirP2}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=960,10',
      '--window-size=940,1020',
      p2Url
    ], { detached: true, stdio: 'ignore' });

    await new Promise(r => setTimeout(r, 600));

    // Player 1 (Left Window)
    spawn(browser.path, [
      `--user-data-dir=${profileDirP1}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=10,10',
      '--window-size=940,1020',
      p1Url
    ], { detached: true, stdio: 'ignore' });

  } else if (browser && browser.type === 'firefox') {
    console.log(`Launching via Mozilla Firefox...`);
    spawn(browser.path, ['-new-instance', '-profile', profileDirP2, p2Url], { detached: true, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    spawn(browser.path, ['-new-instance', '-profile', profileDirP1, p1Url], { detached: true, stdio: 'ignore' });
  } else {
    console.log('Launching via default system browser...');
    spawn('cmd.exe', ['/c', 'start', 'msedge', p2Url], { detached: true, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    spawn('cmd.exe', ['/c', 'start', 'chrome', p1Url], { detached: true, stdio: 'ignore' });
  }

  console.log('\n--- BATTLE READY ---');
  console.log(`Left Window:  ${p1Name} (Champions Reg M-B Sand / TrickRoom)`);
  console.log(`Right Window: ${p2Name} (Champions Reg M-B Rain / Sun)`);
  console.log('\nBoth windows will connect, load teams, and join the battle automatically.');
  console.log('Enjoy your battle! To stop the servers later, run: npm run local:stop\n');
}

main().catch(err => {
  console.error('Error starting auto-battle:', err);
  process.exit(1);
});
