import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPowers } from '../src/game/powers.js';
import { createSim, stepSim } from '../src/game/state.js';
import { hashHex } from '../src/core/hash.js';
import { Recorder, Playback, validateReplay } from '../src/core/replay.js';
import { packCmd, DIR, B_PLACE } from '../src/game/input.js';

const rules = await loadPowers();
const specs = [
  { name: 'H', team: 0 },
  { name: 'A', team: 1, bot: 'normal' },
  { name: 'B', team: 1, bot: 'hard' },
  { name: 'C', team: 0, bot: 'easy' },
];

function scripted(t) {
  const dirs = [DIR.RIGHT, DIR.DOWN, DIR.LEFT, DIR.UP];
  return packCmd(dirs[Math.floor(t / 40) % 4], true, false, false) | (t % 75 === 0 ? B_PLACE : 0);
}

test('Recorder + Playback reproduce the live match, and the JSON round-trips', () => {
  const live = createSim({ seed: 20261117, rules, players: specs });
  const rec = new Recorder(live, specs);
  const hashes = [];
  for (let t = 0; t < 1500 && live.status === 'playing'; t++) {
    const cmds = [scripted(t), 0, 0, 0];
    rec.push(live.tick, cmds);
    stepSim(live, cmds, rules);
    hashes.push(hashHex(live));
  }
  const replay = validateReplay(JSON.stringify(rec.finish(live)));
  assert.ok(replay.cmds.length > 0);
  assert.ok(replay.cmds.length < 12000, `delta stream should be small, got ${replay.cmds.length}`);

  const pb = new Playback(replay);
  const st = createSim({ seed: replay.seed, rules, mode: replay.mode, players: replay.players });
  for (let t = 0; t < hashes.length; t++) {
    stepSim(st, pb.cmdsFor(st.tick).slice(), rules);
    assert.equal(hashHex(st), hashes[t], `diverged at tick ${t + 1}`);
  }
  assert.deepEqual(pb.verify(st), {
    ok: true, expected: replay.hash, actual: replay.hash, ticks: replay.ticks, expectedTicks: replay.ticks,
  });
});

test('validateReplay rejects malformed files', () => {
  assert.throws(() => validateReplay('{"game":"other"}'));
  assert.throws(() => validateReplay({ game: 'bubblefront', v: 99 }));
  assert.throws(() => validateReplay({ game: 'bubblefront', v: 1, players: [] }));
});
