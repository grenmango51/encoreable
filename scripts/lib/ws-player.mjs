/**
 * Minimal scripted Showdown client over the SockJS raw-websocket endpoint.
 *
 * Answers `|request|` with a canned choice list. It has no policy and no
 * evaluation - it exists to make a real battle happen on the local server
 * without a human clicking, so the resulting log can be inspected.
 */

const WS_URL = 'ws://127.0.0.1:8000/showdown/websocket';

export class WsPlayer {
  constructor({ name, team, format, policy, verbose = false }) {
    this.name = name;
    this.team = team;
    this.format = format;
    this.policy = policy;
    this.verbose = verbose;

    this.ws = null;
    this.named = false;
    this.battleRoom = null;
    this.lastRqid = 0;
    this.finished = false;
    this.winner = null;

    // Which battle slots currently hold a conscious Pokemon. Needed because a
    // `|request|` describes your own side only, and a targeted move must name a
    // living target.
    this.slotAlive = { p1a: false, p1b: false, p2a: false, p2b: false };
    this.mySide = null;
    this._errors = [];

    this._onNamed = null;
    this._onChallengeFrom = null;
    this._onBattle = null;
    this._done = null;
  }

  log(...args) {
    if (this.verbose) console.log(`[${this.name}]`, ...args);
  }

  send(roomid, message) {
    this.ws.send(`${roomid || ''}|${message}`);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.onerror = () => reject(new Error(`${this.name}: websocket error`));
      this.ws.onclose = () => {
        if (!this.finished) this._done?.reject?.(new Error(`${this.name}: socket closed early`));
      };
      this.ws.onmessage = (e) => {
        for (const block of String(e.data).split('\n\n')) this._handleBlock(block);
      };
      this.ws.onopen = () => resolve();
    });
  }

  _handleBlock(block) {
    const lines = block.split('\n');
    let roomid = '';
    if (lines[0]?.startsWith('>')) roomid = lines.shift().slice(1);
    for (const line of lines) this._handleLine(roomid, line);
  }

  _handleLine(roomid, line) {
    if (!line.startsWith('|')) return;
    const parts = line.split('|');
    const cmd = parts[1];

    switch (cmd) {
    case 'challstr':
      // noguestsecurity is on, so an empty assertion is accepted
      this.send('', `/trn ${this.name},0,`);
      break;

    case 'updateuser':
      if (parts[2]?.replace(/^[^A-Za-z0-9]/, '') === this.name && parts[3] === '1') {
        if (!this.named) {
          this.named = true;
          this.log('named');
          this._onNamed?.();
        }
      }
      break;

    case 'updatechallenges': {
      const data = JSON.parse(parts.slice(2).join('|'));
      const from = Object.keys(data.challengesFrom || {})[0];
      if (from) this._onChallengeFrom?.(from);
      break;
    }

    case 'pm': {
      // Challenges arrive as a PM carrying `/challenge <formatid>`. An empty
      // format means the challenge was withdrawn.
      const body = parts[4] || '';
      if (!body.startsWith('/challenge') || !parts[5]) break;
      const sender = (parts[2] || '').replace(/^[^A-Za-z0-9]+/, '');
      if (sender && sender !== this.name) this._onChallengeFrom?.(sender);
      break;
    }

    case 'init':
      if (parts[2] === 'battle' && roomid.startsWith('battle-')) {
        this.battleRoom = roomid;
        this.log('joined', roomid);
        this._onBattle?.(roomid);
      }
      break;

    case 'switch':
    case 'drag':
    case 'replace': {
      const slot = parts[2]?.split(':')[0];
      if (slot in this.slotAlive) this.slotAlive[slot] = true;
      break;
    }

    case 'faint': {
      const slot = parts[2]?.split(':')[0];
      if (slot in this.slotAlive) this.slotAlive[slot] = false;
      break;
    }

    case 'request': {
      const raw = parts.slice(2).join('|');
      if (!raw) return;
      const request = JSON.parse(raw);
      if (request.rqid) this.lastRqid = request.rqid;
      if (request.side?.id) this.mySide = request.side.id;
      this._respond(roomid, request);
      break;
    }

    case 'error':
      // Never fall back to `/choose default`: an auto-chosen targeted move is
      // recorded in the input log without its target and cannot be replayed
      // (sim/side.ts:660).
      this.log('error:', parts.slice(2).join('|'));
      this._errors.push(parts.slice(2).join('|'));
      break;

    case 'win':
      this.winner = parts[2];
      this.finished = true;
      this.log('win:', this.winner);
      this._done?.resolve?.(this.winner);
      break;

    case 'tie':
      this.finished = true;
      this._done?.resolve?.(null);
      break;

    case 'popup':
      this.log('popup:', parts.slice(2).join('|'));
      break;
    }
  }

  _respond(roomid, request) {
    if (request.wait) return;
    const foeSide = this.mySide === 'p1' ? 'p2' : 'p1';
    const choice = this.policy(request, {
      mySide: this.mySide,
      foeSide,
      foeAlive: ['a', 'b'].map(x => this.slotAlive[`${foeSide}${x}`]),
      allyAlive: ['a', 'b'].map(x => this.slotAlive[`${this.mySide}${x}`]),
    });
    if (!choice) return;
    this.log('->', choice);
    this.send(roomid, `/choose ${choice}|${request.rqid || this.lastRqid}`);
  }

  waitNamed() {
    if (this.named) return Promise.resolve();
    return new Promise((resolve) => { this._onNamed = resolve; });
  }

  waitChallengeFrom() {
    return new Promise((resolve) => { this._onChallengeFrom = resolve; });
  }

  waitBattle() {
    if (this.battleRoom) return Promise.resolve(this.battleRoom);
    return new Promise((resolve) => { this._onBattle = resolve; });
  }

  waitFinished(timeoutMs = 120000) {
    if (this.finished) return Promise.resolve(this.winner);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: battle did not finish in time`)), timeoutMs);
      this._done = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
    });
  }

  useTeam() {
    this.send('', `/utm ${this.team}`);
  }

  challenge(opponent) {
    this.send('', `/challenge ${opponent}, ${this.format}`);
  }

  accept(opponent) {
    this.send('', `/accept ${opponent}`);
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

// Move targets the chooser must name explicitly (sim/battle-actions.ts:3).
const CHOOSABLE_TARGETS = new Set(['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe']);

/**
 * Picks the first move whose id appears in `preferred`, else the first move that
 * is not disabled, and always names a target when the move needs one.
 *
 * Team preview takes the first `maxChosenTeamSize` slots and a forced switch
 * takes the first healthy Pokemon on the bench.
 */
export function makePolicy(preferred = []) {
  const wanted = preferred.map(m => m.replace(/[^a-z0-9]/gi, '').toLowerCase());

  const targetFor = (move, activeIndex, ctx) => {
    if (!CHOOSABLE_TARGETS.has(move.target)) return '';
    if (move.target === 'adjacentAllyOrSelf') return ` -${activeIndex + 1}`;
    if (move.target === 'adjacentAlly') {
      const ally = activeIndex === 0 ? 1 : 0;
      return ctx.allyAlive[ally] ? ` -${ally + 1}` : '';
    }
    // Foe-targeting: the leftmost conscious opposing slot.
    const foe = ctx.foeAlive.findIndex(Boolean);
    return ` +${(foe < 0 ? 0 : foe) + 1}`;
  };

  return (request, ctx) => {
    if (request.teamPreview) {
      const size = request.maxChosenTeamSize || request.side.pokemon.length;
      return `team ${Array.from({ length: size }, (_, i) => i + 1).join(', ')}`;
    }

    if (request.forceSwitch) {
      const used = new Set();
      return request.forceSwitch.map((needed) => {
        if (!needed) return 'pass';
        const idx = request.side.pokemon.findIndex((p, i) => (
          i >= request.forceSwitch.length && !p.condition.endsWith(' fnt') && !used.has(i)
        ));
        if (idx < 0) return 'pass';
        used.add(idx);
        return `switch ${idx + 1}`;
      }).join(', ');
    }

    if (!request.active) return null;

    return request.active.map((slot, i) => {
      const own = request.side.pokemon[i];
      if (!slot?.moves || own?.condition.endsWith(' fnt')) return 'pass';
      const usable = slot.moves.map((m, n) => ({ ...m, n: n + 1 })).filter(m => !m.disabled);
      if (!usable.length) return 'move 1';
      const pick = usable.find(m => wanted.includes(String(m.id).toLowerCase())) || usable[0];
      return `move ${pick.n}${targetFor(pick, i, ctx)}`;
    }).join(', ');
  };
}
