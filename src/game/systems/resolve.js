// Consequences: hits, capture/rescue, respawns, pickups, the pop-dash reward and
// the win check. Presentation-only data (particles, sounds) is emitted as events
// and never fed back into the simulation.
import { tileOf, centerOf } from '../units.js';
import { CFG } from '../config.js';
import { lethalAt } from '../zones.js';
import { itemAt } from '../map.js';
import { applyPower } from '../powers.js';

function hitTile(state, p) {
  return lethalAt(state, tileOf(p.x), tileOf(p.y));
}

export function capture(p, state, byZone) {
  p.status = 'trapped';
  p.trapTicks = CFG.trapTicks;
  p.rescue = 0;
  p.moving = 0;
  p.x = centerOf(tileOf(p.x));
  p.y = centerOf(tileOf(p.y));
  p.capturedBy = byZone ? byZone.holder : 0;
  state.events.push({ t: 'capture', pid: p.id });
}

function release(p, state, rescuer) {
  p.status = 'ok';
  p.trapTicks = 0;
  p.rescue = 0;
  p.invulnTicks = 90;
  if (rescuer) {
    rescuer.score += CFG.scoreRescue;
    rescuer.dashTicks = CFG.dashTicks;
  }
  state.events.push({ t: 'rescue', pid: p.id, by: rescuer ? rescuer.id : 0 });
}

function loseLife(p, state) {
  p.lives--;
  p.status = p.lives > 0 ? 'dead' : 'out';
  p.respawnTicks = CFG.respawnTicks;
  state.events.push({ t: p.lives > 0 ? 'pop' : 'eliminate', pid: p.id, lives: p.lives });
  if (p.status === 'out') {
    for (const q of state.players) {
      if (q.team !== p.team && q.status !== 'out') q.score += CFG.scoreKill;
    }
  }
}

export function resolveHits(state) {
  const hitIds = new Set();

  for (const p of state.players) {
    if (p.status !== 'ok') continue;
    if (p.invulnTicks > 0) continue;
    const z = hitTile(state, p);
    if (!z) continue;
    hitIds.add(p.id);
    if (p.shield > 0) {
      p.shield--;
      p.invulnTicks = 70;
      state.events.push({ t: 'shield', pid: p.id, left: p.shield });
      continue;
    }
    capture(p, state, z);
    const cap = state.players.find((q) => q.id === z.holder);
    if (cap && cap.id !== p.id && cap.team !== p.team) cap.score += CFG.scoreHit;
  }

  // 极限冲刺: a blast that spawned within one tile of you, but missed you,
  // converts nerve into speed. Rewards aggressive positioning.
  const fresh = [];
  for (const e of state.events) if (e.t === 'zone') fresh.push(e);
  if (fresh.length) {
    for (const p of state.players) {
      if (p.status !== 'ok' || hitIds.has(p.id)) continue;
      const px = tileOf(p.x), py = tileOf(p.y);
      for (const f of fresh) {
        if (Math.max(Math.abs(f.x - px), Math.abs(f.y - py)) <= 1) {
          if (p.dashTicks <= 0) state.events.push({ t: 'dash', pid: p.id });
          p.dashTicks = CFG.dashTicks;
          break;
        }
      }
    }
  }
}

export function resolveTraps(state) {
  for (const p of state.players) {
    if (p.status !== 'trapped') continue;
    p.trapTicks--;
    const tx = tileOf(p.x), ty = tileOf(p.y);
    for (const q of state.players) {
      if (q.id === p.id || q.status !== 'ok') continue;
      if (tileOf(q.x) !== tx || tileOf(q.y) !== ty) continue;
      const cost = q.team === p.team ? 1 : 2;   // freeing an enemy is slower, and paid for
      p.rescue += cost;
      if (p.rescue >= CFG.rescueTicks) {
        if (q.team !== p.team) q.score += CFG.scoreRescue;
        release(p, state, q);
        break;
      }
    }
    if (p.status === 'trapped' && p.trapTicks <= 0) loseLife(p, state);
  }
}

export function resolveRespawns(state) {
  for (const p of state.players) {
    // Only *popped* players respawn. Trapped players must be freed by a touch
    // or ride out the trap timer — teleporting them out would delete the
    // entire capture mechanic.
    if (p.status !== 'dead') continue;
    p.respawnTicks--;
    if (p.respawnTicks > 0) continue;
    const [sx, sy] = state.map.spawns[p.spawnIdx];
    p.x = centerOf(sx);
    p.y = centerOf(sy);
    p.axis = 'x';
    p.status = 'ok';
    p.invulnTicks = CFG.invulnTicks;
    p.dashTicks = 0;
    p.rescue = 0;
    state.events.push({ t: 'respawn', pid: p.id });
  }
}

export function resolveItems(state, ruleset) {
  for (const p of state.players) {
    if (p.status !== 'ok') continue;
    const it = itemAt(state.map, tileOf(p.x), tileOf(p.y));
    if (!it || it.hidden || it.picked) continue;
    const def = ruleset.byId.get(it.power);
    if (!def) continue;
    applyPower(p, def);
    it.picked = true;
    p.score += CFG.scoreItem;
    state.events.push({ t: 'item', pid: p.id, power: def.id, name: def.name });
  }
}

export function checkWin(state) {
  if (state.status !== 'playing') return;
  const aliveTeams = new Set();
  for (const p of state.players) if (p.status !== 'out') aliveTeams.add(p.team);
  const over = aliveTeams.size <= 1 || state.tick >= CFG.roundTicks;
  if (!over) return;

  let best = -1, winner = -1;
  const teamScore = new Map();
  for (const p of state.players) teamScore.set(p.team, (teamScore.get(p.team) || 0) + p.score);
  for (const [t, s] of teamScore) { if (s > best || (s === best && t < winner)) { best = s; winner = t; } }
  state.status = 'over';
  state.winnerTeam = aliveTeams.size <= 1 ? [...aliveTeams][0] ?? winner : winner;
  state.endReason = state.tick >= CFG.roundTicks && aliveTeams.size > 1 ? 'timeout' : 'elimination';
  state.events.push({ t: 'win', team: state.winnerTeam, reason: state.endReason });
}

export function decayTimers(state) {
  for (const p of state.players) {
    if (p.invulnTicks > 0) p.invulnTicks--;
    if (p.dashTicks > 0) p.dashTicks--;
  }
}
