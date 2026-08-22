import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

import './provision-local-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNTIME_DIR = path.join(process.cwd(), 'runtime');
const CLIENT_DIR = path.join(process.cwd(), 'vendor', 'pokemon-showdown-client', 'play.pokemonshowdown.com');

const serverProcess = spawn('node', ['./pokemon-showdown', '8000'], {
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

const clientServer = http.createServer((req, res) => {
  let filePath = req.url.split('?')[0];
  if (filePath === '/' || filePath === '/testclient.html') filePath = '/testclient-old.html';
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
