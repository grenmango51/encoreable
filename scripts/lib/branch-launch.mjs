/**
 * Put a recorded position into a live battle room and open two browser windows
 * on it, one per side.
 *
 *   1. truncate the input log at the chosen turn                (lib/truncate.mjs)
 *   2. connect to the local server as an ordinary guest         (lib/ws-admin.mjs)
 *   3. /importinputlog  ->  a live room at that position
 *   4. read the new roomid out of the |init|battle frame
 *   5. open two Chrome profiles, each /join <roomid> under its own name
 *   6. /restoreplayers  ->  both users take their original slots
 *
 * Both the `npm run live` CLI and the replay page's branch button call this. Two
 * copies of this flow would drift, and only one of them would stay verified.
 *
 * The local servers are assumed to be up. Starting them is the caller's problem.
 */

import { launchPair } from './browser.mjs';
import { truncateAtTurn, positionText } from './truncate.mjs';
import { WsAdmin } from './ws-admin.mjs';

export const CLIENT = 'http://127.0.0.1:8080/testclient.html?~~127.0.0.1:8000';

const toId = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Truncates and checks a position without touching the server.
 * Throws with a message meant for a human on anything unplayable.
 */
export async function prepareBranch(inputLog, turn, { reseed = true } = {}) {
  const cut = await truncateAtTurn(inputLog, turn, { reseed });

  if (cut.errors.length) {
    throw new Error(`re-simulating the log produced choice errors: ${cut.errors.join(' ')}`);
  }
  if (cut.ended) {
    throw new Error(
      `this battle is over by turn ${cut.turn}, so there is nothing to play on from. ` +
      `Pick an earlier turn.`
    );
  }
  if (!cut.awaitingChoice) {
    throw new Error(`the position at turn ${cut.turn} is not waiting for both sides' moves - refusing to import it`);
  }
  return cut;
}

/**
 * Whether a name is currently held by a connected user.
 *
 * An unregistered name can only be reused once its holder has disconnected
 * (`server/users.ts:811`), so a branch launched while an earlier branch's windows
 * are still open cannot have the same players. Asking is simplest by trying:
 * take the name on a throwaway connection and see which answer comes back. If it
 * was free, dropping the connection leaves it free again - the merge on the next
 * login needs the holder offline and on the same IP, and both hold here.
 */
async function nameInUse(name) {
  const probe = new WsAdmin({ name });
  await probe.connect();
  try {
    return await new Promise((resolve) => {
      const done = (verdict) => { clearTimeout(timer); off(); resolve(verdict); };
      const timer = setTimeout(() => done(false), 8000);
      const off = probe.on((roomid, line, parts) => {
        if (parts[1] === 'nametaken') return done(true);
        if (parts[1] === 'updateuser' && parts[3] === '1') return done(false);
      });
    });
  } finally {
    probe.close();
  }
}

/** Rewrites the `name` in every `>player` line of an input log. */
function renamePlayers(inputLog, rename) {
  return inputLog.split('\n').map((line) => {
    const m = /^(>player p[1-4] )(\{.*\})$/.exec(line);
    if (!m) return line;
    const options = JSON.parse(m[2]);
    options.name = rename(options.name);
    return m[1] + JSON.stringify(options);
  }).join('\n');
}

/**
 * Finds names nobody is using. The recorded names are tried first, so an
 * ordinary single branch shows the real players; only a branch opened alongside
 * a live one gets suffixed.
 */
async function freeNames(players, say) {
  const taken = await Promise.all(players.map(nameInUse));
  if (!taken.some(Boolean)) return null;

  for (let n = 2; n <= 9; n++) {
    // Names are capped at 18 characters (`server/users.ts:746`).
    const suffix = `-${n}`;
    const rename = name => name.slice(0, 18 - suffix.length) + suffix;
    const candidates = players.map(rename);
    const clash = await Promise.all(candidates.map(nameInUse));
    if (!clash.some(Boolean)) {
      say(`${players.filter((p, i) => taken[i]).join(' and ')} still in use by an open branch - ` +
        `this one plays as ${candidates.join(' and ')}.`);
      return rename;
    }
  }
  throw new Error(
    `${players.join(' and ')} are in use and no suffixed variant is free either. ` +
    `Close the browser windows from an earlier branch and try again.`
  );
}

async function importInputLog(admin, inputLog) {
  const pending = admin.waitFor((roomid, line, parts) => {
    if (parts[1] === 'init' && parts[2] === 'battle' && roomid.startsWith('battle-')) return { roomid };
    if (parts[1] === 'error' || parts[1] === 'popup') {
      const text = parts.slice(2).join('|');
      if (/importinputlog|denied|permission|Invalid input log/i.test(text)) return { error: text };
    }
    return null;
  }, { timeoutMs: 20000, what: 'the imported battle room' });

  // One frame, newlines intact: `/importinputlog ` is registered as a multi-line
  // command and the multi-line path is only taken when the text contains "\n".
  admin.send('', `/importinputlog ${inputLog}`);

  const hit = await pending;
  if (hit.error) throw new Error(`the server refused the import: ${hit.error}`);
  return hit.roomid;
}

function watchRoom(admin, roomid, names) {
  const wanted = new Map(names.map(n => [toId(n), n]));
  const present = new Set();
  const slots = new Map();
  const problems = [];

  admin.on((room, line, parts) => {
    if (room !== roomid) return;
    const cmd = parts[1];

    if (cmd === 'users') {
      for (const entry of (parts[2] || '').split(',').slice(1)) {
        const id = toId(entry);
        if (wanted.has(id)) present.add(id);
      }
    } else if (cmd === 'j' || cmd === 'J' || cmd === 'join') {
      const id = toId(parts[2] || '');
      if (wanted.has(id)) present.add(id);
    } else if (cmd === 'l' || cmd === 'L' || cmd === 'leave') {
      present.delete(toId(parts[2] || ''));
    } else if (cmd === 'player' && parts[3]) {
      slots.set(parts[2], parts[3]);
    } else if (line.includes('already has a team')) {
      problems.push(line);
    }
  });

  return { present, slots, problems, wanted };
}

async function waitUntil(check, { timeoutMs, what }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * @param inputLog  the full recorded input log to branch from
 * @param turn      the turn to enter at
 * @param cut       an already-prepared result from `prepareBranch`, optional
 * @param say       progress reporter
 * @returns { roomid, turn, seed, players, slots, position, positionText }
 */
export async function launchBranch({ inputLog, turn, cut = null, verbose = false, say = () => {} }) {
  const position = cut || await prepareBranch(inputLog, turn);

  const rename = await freeNames(position.players, say);
  const importedLog = rename ? renamePlayers(position.inputLog, rename) : position.inputLog;
  const players = rename ? position.players.map(rename) : position.players;

  const admin = new WsAdmin({ verbose });
  try {
    await admin.connect();
    await admin.waitNamed();

    const roomid = await importInputLog(admin, importedLog);
    say(`Imported as ${roomid}`);

    const room = watchRoom(admin, roomid, players);
    const [leftName, rightName] = players;
    const url = name => (
      `${CLIENT}&autoname=${encodeURIComponent(name)}&autojoin=${encodeURIComponent(roomid)}`
    );

    say('Opening two browser windows side by side...');
    await launchPair({
      left: url(leftName),
      right: url(rightName),
      tag: roomid.replace(/[^a-z0-9]/gi, ''),
    });

    await waitUntil(() => room.present.size >= 2, {
      timeoutMs: 60000,
      what: `${leftName} and ${rightName} to appear in ${roomid} (seen: ${[...room.present].join(', ') || 'nobody'})`,
    });
    say('Both windows are in the room.');

    // `invitebattle` joins a user straight into a slot - no invite handshake - when
    // they are already in the room and the slot has a team from the imported log
    // (chat-commands/core.ts:1236). `restoreplayers` issues one per slot, using the
    // names the input log carried.
    admin.send(roomid, '/restoreplayers');

    await waitUntil(() => room.slots.size >= 2, {
      timeoutMs: 20000,
      what: `both slots to fill (filled: ${[...room.slots.entries()].map(([s, n]) => `${s}=${n}`).join(', ') || 'none'})`,
    });

    if (room.problems.length) {
      throw new Error(`the battle rejected a player: ${room.problems.join(' ')}`);
    }

    return {
      roomid,
      turn: position.turn,
      seed: position.seed,
      players,
      recordedPlayers: position.players,
      slots: [...room.slots.entries()].sort(),
      position: position.position,
      positionText: positionText(position.position),
    };
  } finally {
    admin.close();
  }
}
