// Player intent, packed into a single integer so a replay is a list of
// (tick, player, cmd) deltas. The sim only ever sees these — humans and bots
// share one entry point, which is what makes replays and server checks possible.
export const DIR = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 };
export const DVEC = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];

export const B_MOVE = 0b0000_1111; // bits 0-3: direction flags (U D L R)
export const B_PLACE = 0b0001_0000;
export const B_SWAP = 0b0010_0000;

export function packCmd(dir, moving, place, swap) {
  let v = 0;
  if (moving && dir !== null) v |= 1 << dir;
  if (place) v |= B_PLACE;
  if (swap) v |= B_SWAP;
  return v;
}

// Resolved per-player frame for the sim: one axis, plus edge-triggered actions.
export function unpackCmd(v) {
  const up = !!(v & 1), down = !!(v & 2), left = !!(v & 4), right = !!(v & 8);
  let dir = null;
  // Deterministic priority when two axes are held: last axis in U,D,L,R order wins.
  if (right) dir = DIR.RIGHT; else if (left) dir = DIR.LEFT;
  else if (down) dir = DIR.DOWN; else if (up) dir = DIR.UP;
  return { dir, moving: dir !== null, place: !!(v & B_PLACE), swap: !!(v & B_SWAP) };
}

// Delta stream -> [{tick, p, cmd}], and back. gzip-free enough for 4 minutes:
// a full 240s round is ~2-4 KB because a frame is only recorded when it changes.
export function encodeCommands(history) {
  const out = [];
  for (const h of history) out.push(`${h.tick}.${h.p}.${h.cmd}`);
  return out.join(',');
}

export function decodeCommands(text) {
  if (!text) return [];
  return text.split(',').map((tok) => {
    const [tick, p, cmd] = tok.split('.').map(Number);
    return { tick, p, cmd };
  });
}

export class CommandRecorder {
  constructor(playerCount) {
    this.last = new Array(playerCount).fill(0);
    this.events = [];
  }

  record(tick, cmds) {
    for (let p = 0; p < cmds.length; p++) {
      if (cmds[p] !== this.last[p]) {
        // Action buttons are edge pulses: record the press and its release.
        this.events.push({ tick, p, cmd: cmds[p] });
        this.last[p] = cmds[p];
      }
    }
    return this.events;
  }

  static replayFrame(events, cursor, tick, playerCount) {
    const held = new Array(playerCount).fill(0);
    return { held, cursor };
  }
}

// Applies a delta stream onto held command masks for a given tick.
export function stateAt(stream, tick, playerCount) {
  const held = new Array(playerCount).fill(0);
  for (const e of stream) {
    if (e.tick > tick) break;
    held[e.p] = e.cmd;
  }
  return held;
}
