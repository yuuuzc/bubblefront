// Replays are *inputs*, not video: seed + player specs + human command deltas.
// Bots are re-simulated, so a 4-minute round costs a few KB and the final state
// hash proves the playback matched the original tick for tick.
import { encodeCommands, decodeCommands } from '../game/input.js';
import { hashHex } from './hash.js';

export const REPLAY_VERSION = 1;

export class Recorder {
  constructor(state, specs) {
    this.specs = specs;
    this.seed = state.seed;
    this.mode = state.mode;
    this.human = specs.map((s) => !s.bot);
    this.last = new Array(specs.length).fill(0);
    this.events = [];
    this.ticks = 0;
    this.hash = '';
  }

  push(tick, cmds) {
    for (let p = 0; p < cmds.length; p++) {
      if (!this.human[p]) continue;
      const cmd = cmds[p] | 0;
      if (cmd === this.last[p]) continue;
      this.events.push({ tick, p, cmd });
      this.last[p] = cmd;
    }
  }

  finish(state) {
    this.ticks = state.tick;
    this.hash = hashHex(state);
    return this.toJSON();
  }

  toJSON() {
    return {
      v: REPLAY_VERSION,
      game: 'bubblefront',
      seed: this.seed,
      mode: this.mode,
      players: this.specs,
      cmds: encodeCommands(this.events),
      ticks: this.ticks,
      hash: this.hash,
      savedAt: new Date().toISOString(),
    };
  }
}

export class Playback {
  constructor(replay) {
    if (replay.v !== REPLAY_VERSION) throw new Error(`unsupported replay version ${replay.v}`);
    this.replay = replay;
    this.stream = decodeCommands(replay.cmds);
    this.cursor = 0;
    this.held = new Array(replay.players.length).fill(0);
  }

  cmdsFor(tick) {
    while (this.cursor < this.stream.length && this.stream[this.cursor].tick <= tick) {
      const e = this.stream[this.cursor++];
      this.held[e.p] = e.cmd;
    }
    return this.held;
  }

  verify(state) {
    const actual = hashHex(state);
    return {
      ok: actual === this.replay.hash && state.tick === this.replay.ticks,
      expected: this.replay.hash,
      actual,
      ticks: state.tick,
      expectedTicks: this.replay.ticks,
    };
  }
}

export function validateReplay(raw) {
  const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!r || r.game !== 'bubblefront') throw new Error('not a BubbleFront replay');
  if (r.v !== REPLAY_VERSION) throw new Error(`replay version ${r.v} not supported`);
  if (!Array.isArray(r.players) || !r.players.length) throw new Error('replay has no players');
  if (typeof r.cmds !== 'string') throw new Error('replay has no command stream');
  return r;
}
