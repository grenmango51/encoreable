import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'node_modules', 'pokemon-showdown');
const DEST = path.join(process.cwd(), 'runtime');

// 1. Create/Refresh runtime by copying node_modules/pokemon-showdown
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}
fs.cpSync(SRC, DEST, { recursive: true });

// 2. Ensure log dirs exist
fs.mkdirSync(path.join(DEST, 'logs', 'repl'), { recursive: true });
fs.mkdirSync(path.join(DEST, 'databases'), { recursive: true });
fs.mkdirSync(path.join(DEST, 'config', 'chat-plugins'), { recursive: true });

// 3. Write local-only config
const configContent = `
exports.bindaddress = '127.0.0.1';
exports.port = 8000;
exports.ssl = null;
exports.subprocesses = 1;
exports.simulatorworkers = 1;
// Disable DBs, ladders, remote logins, etc
exports.nodatabase = true;
exports.autolock = false;
exports.disablecrashguard = false;
`;

fs.writeFileSync(path.join(DEST, 'config', 'config.js'), configContent);
console.log('Local server runtime provisioned.');
