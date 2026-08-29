import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'node_modules', 'pokemon-showdown');
const DEST = path.join(process.cwd(), 'runtime');
const SERVER_SRC = path.join(process.cwd(), 'scripts', 'server');

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

// 3. Copy the in-process server code into config/, the only directory the
// scope guard allows changing. config.js hands its command tables to
// Chat.loadPlugin(Config, 'config') (server/chat.ts:2089).
for (const file of fs.readdirSync(SERVER_SRC)) {
  if (!file.endsWith('.js')) continue;
  fs.copyFileSync(path.join(SERVER_SRC, file), path.join(DEST, 'config', file));
}

// 4. Write local-only config
const configContent = `
exports.bindaddress = '127.0.0.1';
exports.port = 8000;
exports.ssl = null;
// 0 puts every process type - the simulator included - in the main process
// (server/config-loader.ts:91, room-battle.ts:1368, lib/process-manager.ts:633).
// That is what makes room.battle.stream.battle a live Battle object the /rng
// command can reach directly, with no >eval and no worker in between.
exports.subprocesses = 0;
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
//
// "console" covers the one remaining case: /importinputlog refuses any log
// containing a >eval line without it (chat-commands/core.ts:847), which a log
// recorded before /rng moved off >eval still can. hasConsoleAccess() also checks
// the connection IP against Config.consoleips, which defaults to 127.0.0.1
// (server/users.ts:385) - the address this server binds to and no other.
const defaults = require('./config-example.js');
exports.grouplist = defaults.grouplist.map(group => (
  group.symbol === ' '
    ? { ...group, importinputlog: true, ignorelimits: true, console: true }
    : group
));

// /rng - per-draw RNG control. See config/rng-command.js.
//
// teachStream() adds ">rng" to the input-log grammar, so an armed rule survives
// truncation, /importinputlog and re-simulation as an ordinary recipe line. It
// has to be in place before any room is created, because /importinputlog writes
// the whole log into a fresh stream the moment the room exists.
const rng = require('./rng-command.js');
rng.teachStream(require('../dist/sim/battle-stream.js').BattleStream);
exports.commands = rng.commands;
`;

fs.writeFileSync(path.join(DEST, 'config', 'config.js'), configContent);

console.log('Local server runtime provisioned.');
