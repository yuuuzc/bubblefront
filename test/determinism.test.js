import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPowers } from '../src/game/powers.js';
import { createSim, stepSim } from '../src/game/state.js';
import { hashState } from '../src/core/hash.js';
import { packCmd, DIR, B_PLACE } from '../src/game/input.js';
import { CFG } from '../src/game/config.js';

const rules = await loadPowers();

// A scripted human: walks a pattern and bubbles on a timer, so the run actually
// exercises movement, placement, chains, capture and pickups.
function humanCmd(t) {
  const dirs = [DIR.RIGHT, DIR.DOWN, DIR.LEFT, DIR.UP];
  const d = dirs[Math.floor(t / 45) % 4];
  const place = t % 90 === 0 ? B_PLACE : 0;
  const swap = t % 700 === 0 ? 0b0010_0000 : 0;
  return packCmd(d, true, false, false) | place | swap;
}

function play(seed, ticks, opts = {}) {
  const st = createSim({
    seed,
    rules,
    mode: opts.mode || 'teams',
    players: opts.players || [
      { name: 'H', team: 0 },
      { name: 'A', team: 1, bot: 'normal' },
      { name: 'B', team: 1, bot: 'hard' },
      { name: 'C', team: 0, bot: 'easy' },
    ],
  });
  const hashes = [];
  const stats = { breaks: 0, reveals: 0, captures: 0, rescues: 0, combos: new Set(), chains: 0, items: 0 };
  for (let t = 0; t < ticks && st.status === 'playing'; t++) {
    const cmds = [opts.silent ? 0 : humanCmd(t), 0, 0, 0];
    stepSim(st, cmds, rules);
    if (opts.record) opts.record.push({ tick: st.tick - 1, p: 0, cmd: cmds[0] });
    for (const e of st.events) {
      if (e.t === 'break') stats.breaks++;
      if (e.t === 'reveal') stats.reveals++;
      if (e.t === 'capture') stats.captures++;
      if (e.t === 'rescue') stats.rescues++;
      if (e.t === 'combo') stats.combos.add(e.name);
      if (e.t === 'chain') stats.chains++;
      if (e.t === 'item') stats.items++;
    }
    hashes.push(hashState(st));
  }
  return { st, hashes, stats };
}

test('same seed + same inputs reproduce an identical state hash every tick', () => {
  const a = play(12345, 1500);
  const b = play(12345, 1500);
  assert.equal(a.hashes.length, b.hashes.length);
  for (let i = 0; i < a.hashes.length; i++) {
    assert.equal(a.hashes[i], b.hashes[i], `diverged at tick ${i + 1}`);
  }
});

test('a different seed diverges (rng is really driving the sim)', () => {
  assert.notEqual(play(1, 400).hashes.at(-1), play(2, 400).hashes.at(-1));
});

test('recorded command stream replays bit-for-bit', () => {
  const record = [];
  const live = play(777, 1200, { record });
  const st = createSim({ seed: 777, rules, players: live.st.players.map((p) => ({
    name: p.name, team: p.team, bot: p.isBot ? p.botLevel : undefined,
  })) });
  let cursor = 0;
  const held = [0, 0, 0, 0];
  for (let t = 0; t < 1200 && st.status === 'playing'; t++) {
    while (cursor < record.length && record[cursor].tick <= t) { held[record[cursor].p] = record[cursor].cmd; cursor++; }
    stepSim(st, held.slice(), rules);
    assert.equal(hashState(st), live.hashes[t], `replay mismatch at tick ${t + 1}`);
  }
});

test('the arena actually plays: walls break, items drop, people get caught', () => {
  const { st, stats } = play(2026, 3000);
  assert.ok(stats.breaks > 20, `soft blocks destroyed: ${stats.breaks}`);
  assert.ok(stats.reveals > 0, `items revealed: ${stats.reveals}`);
  assert.ok(stats.captures > 0, `captures: ${stats.captures}`);
  assert.ok(st.tick > 500);
  assert.ok(st.players.every((p) => p.score >= 0));
});

test('bots survive themselves: no bot is captured by its own bubble more than half the time', () => {
  const st = createSim({ seed: 4242, rules, players: [{ name: 'A', team: 0, bot: 'hard' }, { name: 'B', team: 1, bot: 'hard' }] });
  let botCaptures = 0, ticks = 0;
  while (st.status === 'playing' && ticks < 4000) {
    stepSim(st, [], rules);
    ticks++;
    for (const e of st.events) if (e.t === 'capture') botCaptures++;
  }
  assert.ok(ticks > 300, `bots went idle after ${ticks} ticks`);
  assert.ok(botCaptures / (ticks / 60) < 6, `capture rate ${botCaptures}`);
});

// Drop a bubble straight into the world at a chosen tile with a 1-tick fuse.
function forceBubble(st, x, y, element, blast = 2, owner = 0) {
  st.bubbles.push({ id: st.bubbleSeq++, x, y, owner, fuse: 1, totalFuse: 1, blast, element });
}

function openCell(st) {
  // any interior floor tile with a floor neighbour to the east
  for (let y = 1; y < st.map.h - 1; y++) {
    for (let x = 1; x < st.map.w - 2; x++) {
      if (st.map.tiles[y * st.map.w + x] === 0 && st.map.tiles[y * st.map.w + x + 1] === 0) return [x, y];
    }
  }
  throw new Error('no open cell');
}

test('element combos trigger from residue adjacency', () => {
  const st = createSim({ seed: 99, rules, players: [{ name: 'A', team: 0 }, { name: 'B', team: 1 }] });
  const [x, y] = openCell(st);
  forceBubble(st, x, y, 'gas');
  stepSim(st, [0, 0], rules);
  assert.ok(st.zones.some((z) => z.kind === 2), 'gas field should linger');

  forceBubble(st, x + 1, y, 'fire');
  const names = new Set();
  stepSim(st, [0, 0], rules);
  for (const e of st.events) if (e.t === 'combo') names.add(e.name);
  assert.ok(names.has('爆燃'), `combos seen: ${[...names].join(',')}`);
});

test('超导: frost residue + volt bubble detonates neighbours remotely', () => {
  const st = createSim({ seed: 100, rules, players: [{ name: 'A', team: 0 }, { name: 'B', team: 1 }] });
  const [x, y] = openCell(st);
  forceBubble(st, x, y, 'frost');
  stepSim(st, [0, 0], rules);
  assert.ok(st.zones.some((z) => z.kind === 3 || z.after === 3), 'frost should leave residue');

  // a volt bubble next to the frost sheet, plus a bystander bubble 4 tiles away
  forceBubble(st, x + 1, y, 'volt');
  const bx = Math.min(x + 4, st.map.w - 2);
  st.bubbles.push({ id: st.bubbleSeq++, x: bx, y, owner: 1, fuse: 500, totalFuse: 500, blast: 2, element: 'normal' });
  const combos = [];
  stepSim(st, [0, 0], rules);
  for (const e of st.events) if (e.t === 'combo') combos.push(e.name);
  assert.ok(combos.includes('超导'), `combos seen: ${combos.join(',')}`);
  assert.ok(!st.bubbles.some((b) => b.x === bx && b.fuse === 500), 'remote bubble should have been conducted into the chain');
});

test('frost blast cools into a slowing sheet, not a permanent flame', () => {
  const st = createSim({ seed: 101, rules, players: [{ name: 'A', team: 0 }, { name: 'B', team: 1 }] });
  const [x, y] = openCell(st);
  forceBubble(st, x, y, 'frost');
  stepSim(st, [0, 0], rules);
  assert.ok(st.zones.some((z) => z.hot > 0), 'fresh frost blast is lethal');
  for (let i = 0; i < CFG.flameTicks + 2; i++) stepSim(st, [0, 0], rules);
  const sheet = st.zones.find((z) => z.x === x && z.y === y);
  assert.ok(sheet, 'residue should still exist');
  assert.equal(sheet.kind, 3, 'residue should be frost');
  assert.equal(sheet.hot, 0, 'residue must no longer be lethal');
});
