/**
 * The static client host.
 *
 * Serves the vendored Showdown client on its own port so the browser loads the
 * real battle interface while talking to our local server. Three routes are ours
 * rather than upstream's:
 *
 *   /autobattle.js      injected into the test client, drives npm run battle
 *   /replay-branch.js   draws the "Play from here" button on a replay page
 *   /branch             that button's endpoint - hands off to lib/branch-launch.mjs
 *
 * Also serves /replays/ so a rendered replay page is reachable over http rather
 * than file://, which the client requires.
 *
 * Started automatically by the other commands; run it directly only to keep the
 * host up on its own.
 *
 * Usage:
 *   npm run serve
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

import './provision-local-server.mjs';
import { launchBranch } from './lib/branch-launch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const CLIENT_DIR = path.join(process.cwd(), 'vendor', 'pokemon-showdown-client', 'play.pokemonshowdown.com');

const serverProcess = spawn(process.execPath, ['./pokemon-showdown', '8000'], {
  cwd: RUNTIME_DIR,
  stdio: 'inherit'
});

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const AUTOBATTLE_FILE = path.join(process.cwd(), 'scripts', 'client', 'autobattle.js');
const REPLAY_BRANCH_FILE = path.join(process.cwd(), 'scripts', 'client', 'replay-branch.js');
const REPLAY_DIR = path.join(process.cwd(), 'replays');

/**
 * Turns a recorded position into a live battle. The replay page's branch button
 * POSTs `{inputLog, turn}` here; the launch itself is the same code `npm run
 * live` uses (lib/branch-launch.mjs).
 */
function handleBranch(req, res) {
  const reply = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    // An input log runs a few KB. Anything past a megabyte is not one.
    size += chunk.length;
    if (size > 1000000) return req.destroy();
    chunks.push(chunk);
  });

  req.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      const inputLog = String(body.inputLog || '');
      const turn = Number(body.turn);
      if (!inputLog.trim()) throw new Error('the request carried no inputLog');
      if (!Number.isInteger(turn) || turn < 1) {
        throw new Error(`turn must be a positive integer, got "${body.turn}"`);
      }

      console.log(`\n/branch: entering turn ${turn}`);
      const branch = await launchBranch({
        inputLog,
        turn,
        say: msg => console.log(`  ${msg}`),
      });
      console.log(`  ready: ${branch.roomid} at turn ${branch.turn}, continuation seed ${branch.seed}`);

      reply(200, {
        roomid: branch.roomid,
        turn: branch.turn,
        seed: branch.seed,
        players: branch.players,
        slots: branch.slots,
      });
    } catch (err) {
      console.log(`  /branch failed: ${err.message}`);
      reply(400, { error: err.message });
    }
  });
}

const clientServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/autobattle.js') {
    if (fs.existsSync(AUTOBATTLE_FILE)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(fs.readFileSync(AUTOBATTLE_FILE, 'utf-8'));
    }
  }
  if (urlPath === '/replay-branch.js') {
    if (fs.existsSync(REPLAY_BRANCH_FILE)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(fs.readFileSync(REPLAY_BRANCH_FILE, 'utf-8'));
    }
  }
  if (urlPath === '/branch') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'POST only' }));
    }
    return handleBranch(req, res);
  }
  if (urlPath.startsWith('/replays/')) {
    // Basename only. These pages are served so their branch button can reach
    // /branch, not to expose the tree above them.
    const name = path.basename(decodeURIComponent(urlPath.slice('/replays/'.length)));
    const file = path.join(REPLAY_DIR, name);
    if (!name.endsWith('.html') || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(file));
  }
  if (urlPath === '/config/testclient-key.js' || urlPath === '/testclient-key.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end('window.POKEMON_SHOWDOWN_TESTCLIENT_KEY = "local";');
  }

  let isTestClient = (urlPath === '/' || urlPath === '/testclient.html');
  let filePath = isTestClient ? '/testclient-old.html' : urlPath;
  filePath = path.join(CLIENT_DIR, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error: ' + err.code);
      }
    } else {
      if (isTestClient) {
        let html = content.toString('utf-8');
        html = html.replace('</body>', '<script src="/autobattle.js"></script>\n</body>');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html, 'utf-8');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

clientServer.listen(8080, '127.0.0.1');

fs.writeFileSync(path.join(RUNTIME_DIR, 'pids.json'), JSON.stringify({
  launcher: process.pid,
  server: serverProcess.pid
}));

function cleanup() {
  if (serverProcess) {
    try { process.kill(serverProcess.pid); } catch (e) {}
  }
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function waitForPort(port, host = '127.0.0.1') {
  while (true) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://${host}:${port}`, (res) => resolve(res)).on('error', reject);
        req.end();
      });
      break;
    } catch (e) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

async function main() {
  console.log('Waiting for local server (8000) and client host (8080)...');
  await Promise.all([waitForPort(8000), waitForPort(8080)]);
  
  console.log('\n--- PLAYABLE LOCAL SHOWDOWN UI READY ---');
  console.log('Open the following URLs in two DIFFERENT browser sessions (e.g. Normal and Incognito):');
  console.log('Player 1: http://127.0.0.1:8080/testclient.html?~~127.0.0.1:8000');
  console.log('Player 2: http://127.0.0.1:8080/testclient.html?~~127.0.0.1:8000');
  console.log('\nInstructions:');
  console.log('1. Pick a different guest name in each tab.');
  console.log('2. Build or import a team in each tab.');
  console.log('3. Challenge the other player to [Gen 9 Champions] VGC 2026 Reg M-B.');
  console.log('Press Ctrl+C to stop both servers.\n');
}

main();
