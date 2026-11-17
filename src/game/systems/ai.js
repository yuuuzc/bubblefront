// Bots emit the *same* packed command integers a human keyboard produces, so
// they cost nothing to record in a replay: a match file is seed + human keys.
//
// Decision: danger map -> timed reachability BFS (soft blocks are passable at a
// digging cost) -> goal -> first step, plus a placement check that refuses any
// bubble the bot cannot itself escape from. Difficulty is reaction latency and
// miss noise, never extra information — hidden items stay hidden to them.
import { SUB, tileOf } from '../units.js';
import { CFG, T, BOT_LEVELS } from '../config.js';
import { DIR, DVEC, packCmd } from '../input.js';
import { tileAt } from '../map.js';
import { Z, isLethal } from '../zones.js';
import { blastPlan, canPlaceAt, residueElement } from './bubbles.js';
import { speedOf, ownerOverlaps } from './movement.js';
import { nextInt } from '../../core/rng.js';

const INF = 1 << 20;
const SAFE_MARGIN = 12;
const DIG_COST = 70;          // ticks to place + wait out a fuse on a soft block
const KIND_ELEMENT = { [Z.GAS]: 'gas', [Z.FROST]: 'frost', [Z.EMBER]: 'fire' };

// Instrumentation only — never read by the sim, so it cannot affect determinism.
export const AI_STATS = {
  decide: 0, flee: 0, swap: 0, placeCandidates: 0, escapeRejected: 0,
  placeIssued: 0, walk: 0, wander: 0, idle: 0,
};
export function resetAiStats() { for (const k of Object.keys(AI_STATS)) AI_STATS[k] = 0; }

export function dangerMap(state, extraBubble) {
  const { w, h } = state.map;
  const d = new Int32Array(w * h).fill(INF);
  const put = (x, y, v) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (v < d[i]) d[i] = v;
  };
  for (const z of state.zones) if (isLethal(z)) put(z.x, z.y, 0);
  for (const b of state.bubbles) {
    for (const [cx, cy] of blastPlan(state, b).cells) put(cx, cy, b.fuse);
  }
  if (extraBubble) {
    for (const [cx, cy] of blastPlan(state, extraBubble).cells) put(cx, cy, extraBubble.fuse);
  }
  return d;
}

// 0 = blocked, 1 = walkable floor, 2 = soft block (dig through it)
function terrain(state, p, x, y) {
  const t = tileAt(state.map, x, y);
  if (t === T.HARD) return 0;
  if (t === T.SOFT) return 2;
  for (const b of state.bubbles) {
    if (b.x === x && b.y === y) return ownerOverlaps(b, p) ? 1 : 0;
  }
  return 1;
}

export function timedBfs(state, p, danger, costPerTile) {
  const { w, h } = state.map;
  const dist = new Int32Array(w * h).fill(INF);
  const parent = new Int32Array(w * h).fill(-1);
  const throughSoft = new Uint8Array(w * h);
  const here = tileOf(p.y) * w + tileOf(p.x);
  dist[here] = 0;
  const q = [here];
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    const cx = cur % w, cy = (cur / w) | 0;
    for (let i = 0; i < 4; i++) {
      const nx = cx + DVEC[i].x, ny = cy + DVEC[i].y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] !== INF) continue;
      const ground = terrain(state, p, nx, ny);
      if (ground === 0) continue;
      const arrive = dist[cur] + costPerTile + (ground === 2 ? DIG_COST : 0);
      if (danger[ni] < arrive + SAFE_MARGIN) continue;
      dist[ni] = arrive;
      throughSoft[ni] = ground === 2 ? 1 : 0;
      parent[ni] = cur;
      q.push(ni);
    }
  }
  return { dist, parent, here, throughSoft };
}

function dirFromStep(from, to, w) {
  const d = to - from;
  if (d === 1) return DIR.RIGHT;
  if (d === -1) return DIR.LEFT;
  if (d === w) return DIR.DOWN;
  if (d === -w) return DIR.UP;
  return null;
}

const packDir = (d) => packCmd(d, true, false, false);
const B_SWAP_ONLY = 0b0010_0000;
const manhattanTiles = (a, b) => Math.abs(tileOf(a.x) - tileOf(b.x)) + Math.abs(tileOf(a.y) - tileOf(b.y));

export function aiThink(state, p, rules, slot) {
  const lvl = BOT_LEVELS[p.botLevel] || BOT_LEVELS.normal;
  // Movement bits persist between decisions; action bits (place/swap) are
  // one-tick pulses. Latching them would make the sim's edge detector eat
  // every placement after the first.
  let cmd = p.aiCmd & 0x0f;
  if (state.tick % lvl.reactTicks === (slot % lvl.reactTicks)) cmd = decide(state, p, rules, lvl);
  p.aiCmd = cmd & 0x0f;
  return cmd;
}

function decide(state, p, rules, lvl) {
  if (p.status !== 'ok') return 0;
  AI_STATS.decide++;
  const { w } = state.map;
  // Cornering and lane-snapping cost real frames; assume 25% overhead so the
  // escape estimate is pessimistic rather than optimistic.
  const costPerTile = Math.ceil((SUB / Math.max(1, speedOf(state, p))) * 1.25);
  const danger = dangerMap(state, null);
  const px = tileOf(p.x), py = tileOf(p.y);
  const here = py * w + px;
  const bfs = timedBfs(state, p, danger, costPerTile);

  // 1. proactive survival: never linger on a tile that will burn if a strictly
  //    safer step exists. Greedy danger ascent, so a bot that just dropped a
  //    bubble immediately starts walking out of its own blast.
  if (danger[here] !== INF) {
    let dir = null, best = danger[here];
    for (let i = 0; i < 4; i++) {
      const nx = px + DVEC[i].x, ny = py + DVEC[i].y;
      if (terrain(state, p, nx, ny) !== 1) continue;
      const nd = danger[ny * w + nx];
      if (nd > best) { best = nd; dir = i; }
    }
    if (dir !== null) { AI_STATS.flee++; return packDir(dir); }
  }

  // 2. queue the element swaps needed to combo with nearby residue.
  planElement(state, p, rules);
  if (p.aiSwap > 0) { p.aiSwap--; AI_STATS.swap++; return B_SWAP_ONLY; }

  // 3. a bubble that pays off *and* leaves an exit. Digging counts as paying
  //    off when the block is on the way to where we already want to go.
  const goal = chooseGoal(state, p, rules, danger, bfs.dist, costPerTile);
  const path = tracePath(bfs, here, goal, state.map);
  const place = bestPlacement(state, p, costPerTile, path);
  if (place >= 0) { AI_STATS.placeIssued++; return place; }

  // 4. walk toward a goal.
  if (goal >= 0 && goal !== here && bfs.dist[goal] !== INF) {
    let cur = goal;
    while (cur !== here && bfs.parent[cur] !== here && bfs.parent[cur] !== -1) cur = bfs.parent[cur];
    const d = dirFromStep(here, cur, w);
    if (d !== null) {
      AI_STATS.walk++;
      if (nextInt(state.rng, 1000) < lvl.missRate) return packDir(nextInt(state.rng, 4));
      return packDir(d);
    }
  }

  // 5. otherwise drift into the most open safe neighbour.
  let dir = null, score = -1;
  for (let i = 0; i < 4; i++) {
    const nx = px + DVEC[i].x, ny = py + DVEC[i].y;
    const g = terrain(state, p, nx, ny);
    if (g === 0) continue;
    const ni = ny * w + nx;
    let exits = 0;
    for (const dv of DVEC) if (terrain(state, p, nx + dv.x, ny + dv.y) !== 0) exits++;
    const s = (danger[ni] === INF ? 20 : 5) + exits * 3 + (g === 2 ? 1 : 0);
    if (s > score) { score = s; dir = i; }
  }
  if (dir !== null && nextInt(state.rng, 1000) >= lvl.missRate) { AI_STATS.wander++; return packDir(dir); }
  AI_STATS.idle++;
  return 0;
}

function chooseGoal(state, p, rules, danger, dist, costPerTile) {
  const { w } = state.map;
  let target = -1, bestD = INF;

  // rescue a teammate in a bubble first
  for (const q of state.players) {
    if (q.id === p.id || q.status !== 'trapped' || q.team !== p.team) continue;
    const ri = tileOf(q.y) * w + tileOf(q.x);
    if (dist[ri] !== INF && dist[ri] < bestD) { bestD = dist[ri]; target = ri; }
  }
  if (target >= 0) return target;

  // cheapest visible powerup (hidden ones stay hidden — fair play)
  bestD = INF;
  for (const it of state.map.items) {
    if (it.picked || it.hidden) continue;
    const ii = it.y * w + it.x;
    if (dist[ii] === INF) continue;
    const def = rules.byId.get(it.power);
    const value = def && def.rare ? 3 : def && def.field === 'element' ? 2 : 1;
    const c = dist[ii] / value;
    if (c < bestD) { bestD = c; target = ii; }
  }

  // pressure the nearest opponent: stand next to them, then bubble
  let opp = null, oppD = INF;
  for (const q of state.players) {
    if (q.id === p.id || q.team === p.team || q.status !== 'ok') continue;
    const d = manhattanTiles(p, q);
    if (d < oppD) { oppD = d; opp = q; }
  }
  if (opp) {
    const ox = tileOf(opp.x), oy = tileOf(opp.y);
    let pressureBest = INF, pressureTarget = -1;
    for (const dv of DVEC) {
      const nx = ox + dv.x, ny = oy + dv.y;
      if (tileAt(state.map, nx, ny) === T.HARD) continue;
      const ni = ny * w + nx;
      if (dist[ni] === INF) continue;
      if (dist[ni] < pressureBest) { pressureBest = dist[ni]; pressureTarget = ni; }
    }
    if (pressureTarget >= 0 && (target < 0 || oppD <= 6)) return pressureTarget;
  }
  if (target >= 0) return target;

  // roam: an open, unburnt cell with several exits
  let open = -1, openScore = -1;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] === INF || dist[i] === 0 || danger[i] === 0) continue;
    const x = i % w, y = (i / w) | 0;
    let exits = 0;
    for (const dv of DVEC) if (tileAt(state.map, x + dv.x, y + dv.y) !== T.HARD) exits++;
    const s = exits * 14 - dist[i];
    if (s > openScore) { openScore = s; open = i; }
  }
  return open;
}

// Would this bubble leave us a way out? The real question is not "is the next
// cell safe" but "can I reach a permanently safe cell before the fuse ends",
// which is what makes the standard place-and-run play legal for a bot too.
function canEscape(state, p, spec, fuse, costPerTile) {
  // Insert the hypothetical bubble for real while we evaluate. Otherwise the
  // reachability BFS happily walks *through* it, and the bot seals its only
  // exit with its own bubble — which is exactly how bots used to suicide.
  const probeBubble = { id: -1, owner: p.id, totalFuse: fuse, ...spec };
  state.bubbles.push(probeBubble);
  try {
    const myCell = tileOf(p.y) * state.map.w + tileOf(p.x);
    const nd = dangerMap(state, null);
    if (nd[myCell] === INF) return true;        // this bubble can never reach us here
    const probe = timedBfs(state, p, nd, costPerTile);
    const budget = fuse - SAFE_MARGIN;
    for (let i = 0; i < nd.length; i++) {
      if (nd[i] !== INF) continue;              // never burns
      if (probe.dist[i] !== INF && probe.dist[i] <= budget) return true;
    }
    return false;
  } finally {
    state.bubbles.pop();
  }
}

// Cells on the route we are about to walk, so a bubble that opens our own path
// is worth more than a bubble that opens a random wall.
function tracePath(bfs, here, goal, map) {
  if (goal < 0 || goal === here || bfs.dist[goal] === INF) return null;
  const flags = new Uint8Array(map.w * map.h);
  let cur = goal, hops = 0;
  while (cur !== -1 && cur !== here && hops < 8) {
    flags[cur] = 1;
    cur = bfs.parent[cur];
    hops++;
  }
  return flags;
}

function bestPlacement(state, p, costPerTile, path) {
  // Budget first: without this a bot keeps trying to place while its bubble is
  // still live, and "try to place" wins every decision so it never runs away.
  let live = 0;
  for (const b of state.bubbles) if (b.owner === p.id) live++;
  if (live >= p.bubbles) return -1;

  const ox = tileOf(p.x), oy = tileOf(p.y);
  const { w } = state.map;
  const fuse = p.quickFuse ? CFG.quickFuseTicks : CFG.fuseTicks;

  // Classic placement: the only candidate is our own tile, exactly what
  // placeBubble will produce. Scoring any other spot makes the bot lie to
  // itself about what it is about to do.
  if (!canPlaceAt(state, p, ox, oy)) return -1;
  const spec = { x: ox, y: oy, blast: p.blast, element: p.element, fuse };
  const plan = blastPlan(state, spec);
  let score = -6;                               // own tile is always hot; escape is checked below
  for (const [cx, cy] of plan.cells) {
    for (const q of state.players) {
      if (q.id === p.id || q.status !== 'ok') continue;
      if (tileOf(q.x) === cx && tileOf(q.y) === cy) score += q.team === p.team ? -70 : 130;
    }
    const cell = cy * w + cx;
    if (tileAt(state.map, cx, cy) === T.SOFT) score += 15 + (path && path[cell] ? 22 : 0);
  }
  if (score < 8) return -1;
  AI_STATS.placeCandidates++;
  if (!canEscape(state, p, spec, fuse, costPerTile)) {
    AI_STATS.escapeRejected++;
    return -1;
  }
  // Place on the spot without changing our current heading.
  return (p.aiCmd & 0x0f) | 0b0001_0000;
}

// Cycle toward the element that combos with residue around us.
function planElement(state, p, rules) {
  if (p.aiSwap > 0) return;
  const ids = rules.data.elements.map((e) => e.id);
  const px = tileOf(p.x), py = tileOf(p.y);
  for (const z of state.zones) {
    const r = Math.max(Math.abs(z.x - px), Math.abs(z.y - py));
    if (r > 3) continue;
    const other = residueElement(z);
    if (!other) continue;
    for (const id of ids) {
      if (id === p.element || !rules.combos.get(`${id}|${other}`)) continue;
      p.aiSwap = (ids.indexOf(id) - ids.indexOf(p.element) + ids.length) % ids.length;
      return;
    }
  }
}
