import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'node_modules', 'pokemon-showdown');
const DEST = path.join(process.cwd(), 'runtime');

// 1. Create/Refresh runtime by copying node_modules/pokemon-showdown
if (!fs.existsSync(DEST)) {
  fs.cpSync(SRC, DEST, { recursive: true });
} else {
  try {
    fs.cpSync(SRC, DEST, { recursive: true, force: true });
  } catch (e) {}
}

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
exports.noguestsecurity = true;
exports.nothrottle = true;
exports.noipchecks = true;
// Unrated challenge battles only reach logBattle() when this is on
// (server/room-battle.ts:850). Without it, logData - and the inputLog with it -
// is discarded the moment the battle ends.
exports.logchallenges = true;

// The live-branch launcher drives /importinputlog over a websocket as an
// ordinary guest. That command needs the "importinputlog" permission, which only
// the ~ group holds - and ~ is out of reach here: a name listed in
// usergroups.csv counts as trusted, and a trusted name requires an
// authentication token from a login server (server/users.ts:640). Granting the
// permission to the default group keeps the whole thing inside config/ and
// leaves no other rank in play.
const defaults = require('./config-example.js');
exports.grouplist = defaults.grouplist.map(group => (
  group.symbol === ' ' ? { ...group, importinputlog: true, ignorelimits: true } : group
));
`;

fs.writeFileSync(path.join(DEST, 'config', 'config.js'), configContent);

console.log('Local server runtime provisioned.');
