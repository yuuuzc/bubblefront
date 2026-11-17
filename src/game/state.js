// Simulation entry point: one pure state object, one step function.
// Nothing here touches the DOM, timers or Math.random, which is what makes the
// same code runnable headless (tests, replay verification) and in the browser.
import { makeRng } from '../core/rng.js';
import { CFG, T } from './config.js';
import { genMap } from './map.js';
import { DIR, unpackCmd, B_PLACE, B_SWAP } from './input.js';
import { centerOf } from './units.js';
import { applyMove } from './systems/movement.js';
import { placeBubble, swapElement, tickBubbles, activeBubbles } from './systems/bubbles.js';
import { tickZones } from './zones.js';
import { resolveHits, resolveTraps, resolveRespawns, resolveItems, checkWin, decayTimers } from './systems/resolve.js';
import { aiThink } from './systems/ai.js';

export function makePlayer(i, spec, map) {
  const [sx, sy] = map.spawns[i];
  return {
    id: i,
    team: spec.team ?? i,
    name: spec.name || `P${i + 1}`,
    color: spec.color || i,
    isBot: !!spec.bot,
    botLevel: spec.bot || null,
    spawnIdx: i,
    x: centerOf(sx), y: centerOf(sy), axis: 'x', dir: DIR.DOWN,
    moving: 0,
    status: 'ok', trapTicks: 0, rescue: 0,
    lives: CFG.lives, respawnTicks: 0, invulnTicks: 90,
    bubbles: 1, blast: CFG.baseBlast, speedU: 0,
    shield: 0, quickFuse: 0, element: 'normal',
    dashTicks: 0, score: 0, placed: 0, saved: 0,
    prevCmd: 0, aiCmd: 0, aiSwap: 0,
  };
}

export function createSim(opts) {
  const rules = opts.rules;
  const seed = (opts.seed >>> 0) || 0x9e3779b9;
  const rng = makeRng(seed);
  const specs = opts.players && opts.players.length ? opts.players : [
    { name: '你', team: 0 }, { name: 'B1', team: 1, bot: 'normal' },
    { name: 'B2', team: 1, bot: 'normal' }, { name: 'B3', team: 0, bot: 'hard' },
  ];
  const map = genMap(rng, rules, {
    players: specs.length,
    w: opts.w || CFG.MAP_W || 19,
    h: opts.h || CFG.MAP_H || 13,
    softDensity: opts.softDensity,
  });
  return {
    seed, rng, tick: 0, status: 'playing', winnerTeam: -1, endReason: '',
    bubbleSeq: 1,
    mode: opts.mode || 'teams',
    map,
    players: specs.map((s, i) => makePlayer(i, s, map)),
    bubbles: [],
    zones: [],
    events: [],
  };
}

export function stepSim(state, humanCmds, rules) {
  if (state.status !== 'playing') { state.events = []; return false; }
  state.events = [];

  const cmds = new Array(state.players.length);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    // Bots are simulated, not recorded: their "input" is derived from state+rng.
    cmds[i] = p.isBot ? aiThink(state, p, rules, i) : (humanCmds[i] | 0);
  }

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    const cmd = cmds[i];
    const intent = unpackCmd(cmd);
    if (intent.dir !== null) p.dir = intent.dir;
    const placeEdge = (cmd & B_PLACE) && !(p.prevCmd & B_PLACE);
    const swapEdge = (cmd & B_SWAP) && !(p.prevCmd & B_SWAP);
    p.prevCmd = cmd;
    if (swapEdge) swapElement(state, p, rules);
    if (placeEdge) placeBubble(state, p);
    applyMove(state, p, intent);
  }

  tickZones(state);
  tickBubbles(state, rules);
  resolveHits(state);
  resolveTraps(state);
  resolveItems(state, rules);
  resolveRespawns(state);
  decayTimers(state);
  checkWin(state);
  state.tick++;
  return true;
}

// Convenience for HUD/tests.
export function aliveCount(state) {
  return state.players.filter((p) => p.status !== 'out').length;
}
export { activeBubbles, T };
