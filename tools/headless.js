// Headless match runner — no DOM, no timers. Used for balance sweeps in CI and
// as the "does the game still work" check when nobody wants to open a browser.
//   node tools/headless.js [seed] [ticks] [mode:teams|ffa]
import { loadPowers } from '../src/game/powers.js';
import { createSim, stepSim } from '../src/game/state.js';
import { hashState, hashHex } from '../src/core/hash.js';
import { packCmd, DIR, B_PLACE } from '../src/game/input.js';
import { TICK_HZ } from '../src/game/config.js';
import { AI_STATS, resetAiStats } from '../src/game/systems/ai.js';

resetAiStats();

const rules = await loadPowers();
const seed = Number(process.argv[2] ?? 20261103) >>> 0;
const maxTicks = Number(process.argv[3] ?? 60 * 180) >>> 0;
const mode = process.argv[4] ?? 'teams';

const st = createSim({
  seed, rules, mode,
  players: [
    { name: '你(脚本)', team: 0 },
    { name: '阿火', team: 1, bot: 'normal' },
    { name: '小霜', team: 1, bot: 'hard' },
    { name: '大毒', team: 0, bot: 'easy' },
  ],
});

const tally = {};
const combos = new Map();
let last = 0;
for (let t = 0; t < maxTicks && st.status === 'playing'; t++) {
  const dirs = [DIR.RIGHT, DIR.DOWN, DIR.LEFT, DIR.UP];
  const cmd = packCmd(dirs[Math.floor(t / 40) % 4], true, false, false) | (t % 80 === 0 ? B_PLACE : 0);
  stepSim(st, [cmd, 0, 0, 0], rules);
  for (const e of st.events) {
    tally[e.t] = (tally[e.t] || 0) + 1;
    if (e.t === 'combo') combos.set(e.name, (combos.get(e.name) || 0) + 1);
  }
  if (t % 1800 === 0) process.stdout.write(`  t=${t} hash=${hashHex(st)} zones=${st.zones.length} bubbles=${st.bubbles.length}\n`);
  last = t;
}

const secs = (last + 1) / TICK_HZ;
console.log(`\n=== seed ${seed} | ${mode} | ${last + 1} ticks (${secs.toFixed(1)}s) | status=${st.status} ${st.endReason || ''} ===`);
const teamScore = new Map();
for (const p of st.players) teamScore.set(p.team, (teamScore.get(p.team) || 0) + p.score);
console.table(st.players.map((p) => ({
  id: p.id, name: p.name, team: p.team, bot: p.isBot ? p.botLevel : '-',
  status: p.status, lives: p.lives, score: p.score, blast: p.blast, bubbles: p.bubbles,
  speedU: p.speedU, element: p.element, shield: p.shield, placed: p.placed,
})));
console.log('team scores:', [...teamScore.entries()].map(([t, s]) => `T${t}=${s}`).join(' '), '| winner team', st.winnerTeam);
console.log('events:', tally);
console.log('ai decisions:', AI_STATS);
console.log('combos:', [...combos.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || 'none');
console.log('final hash:', hashHex(st), `(of ${hashState(st)})`);
console.log(`map: ${st.map.w}x${st.map.h} softLeft=${st.map.tiles.filter((t) => t === 2).length} itemsPicked=${st.map.items.filter((i) => i.picked).length}/${st.map.items.length}`);
