// Bubbles: placement, fuse countdown, cross detonation, element behaviour,
// chain reactions and data-driven combos.
//
// `blastPlan` is the single source of truth for what a bubble covers. The
// explosion uses it and the AI predicts with it, so a bot can never be smart
// about a blast shape the game would not actually produce.
import { tileOf } from '../units.js';
import { CFG, T } from '../config.js';
import { DVEC } from '../input.js';
import { tileAt, breakSoft } from '../map.js';
import { Z, isLethal, addZone, zoneAt } from '../zones.js';
import { bubbleAt } from './movement.js';

const ELEMENT_RESIDUE = { [Z.GAS]: 'gas', [Z.FROST]: 'frost', [Z.EMBER]: 'fire' };
export function activeBubbles(state, ownerId) {
  let n = 0;
  for (const b of state.bubbles) if (b.owner === ownerId) n++;
  return n;
}

export function canPlaceAt(state, p, tx, ty) {
  return tileAt(state.map, tx, ty) === T.FLOOR && !bubbleAt(state, tx, ty);
}

export function placeBubble(state, p) {
  if (p.status !== 'ok') return false;
  if (activeBubbles(state, p.id) >= p.bubbles) return false;
  const ox = tileOf(p.x), oy = tileOf(p.y);
  // Classic rule: the bubble always drops on your own tile. Once your body has
  // fully left it, it turns solid (see ownerOverlaps), so you can wall yourself
  // in if you carelessly drop one in a corridor.
  if (!canPlaceAt(state, p, ox, oy)) return false;
  const fuse = p.quickFuse ? CFG.quickFuseTicks : CFG.fuseTicks;
  state.bubbles.push({
    id: state.bubbleSeq++, x: ox, y: oy, owner: p.id,
    fuse, totalFuse: fuse, blast: p.blast, element: p.element,
  });
  p.placed++;
  state.events.push({ t: 'place', x: ox, y: oy, element: p.element, pid: p.id });
  return true;
}

export function swapElement(state, p, rules) {
  const ids = rules.data.elements.map((e) => e.id);
  p.element = ids[(ids.indexOf(p.element) + 1) % ids.length];
  state.events.push({ t: 'swap', pid: p.id, element: p.element });
}

// Residue in the bubble's own cell or its 4 neighbours picks the combo *before*
// arms are computed, so `flare` can lengthen this very explosion. A zone counts
// both for what it is now and for what it cools into — a still-burning frost
// sheet conducts just as well as a cold one.
export function residueElement(z) {
  if (z.after && ELEMENT_RESIDUE[z.after]) return ELEMENT_RESIDUE[z.after];
  if (ELEMENT_RESIDUE[z.kind]) return ELEMENT_RESIDUE[z.kind];
  if (z.kind === Z.FLAME && z.element && z.element !== 'normal') return z.element;
  return null;
}

export function detectCombo(state, rules, bx, by, element) {
  if (element === 'normal') return null;
  const cells = [[bx, by], [bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]];
  for (const [cx, cy] of cells) {
    const z = zoneAt(state, cx, cy);
    if (!z) continue;
    const other = residueElement(z);
    if (!other || other === element) continue;
    const combo = rules.combos.get(`${element}|${other}`);
    if (combo) return { combo, cx, cy };
  }
  return null;
}

export function blastPlan(state, spec) {
  const blast = spec.blast;
  const cells = [[spec.x, spec.y]];
  const softs = [];
  const bubbles = [];
  for (const d of DVEC) {
    for (let i = 1; i <= blast; i++) {
      const cx = spec.x + d.x * i, cy = spec.y + d.y * i;
      const t = tileAt(state.map, cx, cy);
      if (t === T.HARD) break;
      if (t === T.SOFT) {
        softs.push([cx, cy]);
        cells.push([cx, cy]);
        if (spec.element !== 'fire') break;  // other elements stall in the rubble
        continue;                            // fire burns through and keeps going
      }
      const hit = bubbleAt(state, cx, cy);
      if (hit) { bubbles.push(hit); cells.push([cx, cy]); break; }
      cells.push([cx, cy]);
    }
  }
  if (spec.element === 'volt') {
    for (const other of state.bubbles) {
      if (other === spec) continue;
      if (Math.max(Math.abs(other.x - spec.x), Math.abs(other.y - spec.y)) <= 2) bubbles.push(other);
    }
  }
  return { cells, softs, bubbles };
}

export function tickBubbles(state, rules) {
  if (!state.bubbles.length) return;
  let queue = [];
  for (let i = state.bubbles.length - 1; i >= 0; i--) {
    if (--state.bubbles[i].fuse <= 0) queue.push(state.bubbles.splice(i, 1)[0]);
  }
  let depth = 0;
  while (queue.length && depth < CFG.chainDepth) {
    const batch = queue;
    queue = [];
    for (const b of batch) queue.push(...detonate(state, rules, b, depth));
    depth++;
  }
  for (const b of queue) detonate(state, rules, b, CFG.chainDepth);
}

// Returns bubbles caught by this blast (queued for the next cascade layer).
export function detonate(state, rules, b, depth) {
  const owner = state.players.find((p) => p.id === b.owner) || null;
  if (owner && depth > 0) owner.score += CFG.scoreChain * depth;
  let blast = b.blast + (depth > 0 ? Math.min(depth, 2) : 0);

  const combo = detectCombo(state, rules, b.x, b.y, b.element);
  let frostTtl = CFG.fieldTicks;
  let conduct = false;
  if (combo) {
    state.events.push({
      t: 'combo', name: combo.combo.name, effect: combo.combo.effect,
      x: combo.cx, y: combo.cy, element: b.element,
    });
    switch (combo.combo.effect) {
      case 'flare': blast += 2; break;
      case 'detonate':
        blast += 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            zone(state, combo.cx + dx, combo.cy + dy, Z.EMBER, 80, 80, 'fire', b.owner);
          }
        }
        break;
      case 'smoke':
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) suppress(state, combo.cx + dx, combo.cy + dy);
        }
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            zone(state, combo.cx + dx, combo.cy + dy, Z.SMOKE, 180, 0, 'normal', b.owner);
          }
        }
        break;
      case 'ignite':
        for (const z of state.zones) {
          if (z.kind === Z.GAS) { z.kind = Z.FLAME; z.hot = Math.max(z.hot, CFG.flameTicks); z.ttl = Math.max(z.ttl, z.hot); }
        }
        break;
      case 'snare': frostTtl = CFG.fieldTicks * 2; break;
      case 'conduct': conduct = true; break;
      default: break;
    }
  }

  const plan = blastPlan(state, { x: b.x, y: b.y, blast, element: b.element });
  for (const [sx, sy] of plan.softs) {
    const revealed = breakSoft(state.map, sx, sy);
    if (owner) owner.score += CFG.scoreSoft;
    state.events.push({ t: 'break', x: sx, y: sy });
    if (revealed) state.events.push({ t: 'reveal', x: sx, y: sy, power: revealed.power });
  }
  for (const [cx, cy] of plan.cells) zoneForElement(state, b, cx, cy, depth, frostTtl);

  const chainedOut = plan.bubbles.map((other) => pop(state, other));
  if (conduct) {
    for (const other of state.bubbles.slice()) {
      if (Math.max(Math.abs(other.x - b.x), Math.abs(other.y - b.y)) <= 6) chainedOut.push(pop(state, other));
    }
  }
  if (chainedOut.length) state.events.push({ t: 'chain', depth: depth + 1, count: chainedOut.length });
  return chainedOut;
}

function pop(state, b) {
  const i = state.bubbles.indexOf(b);
  if (i >= 0) state.bubbles.splice(i, 1);
  return { ...b, fuse: 1 };
}

function zoneForElement(state, b, cx, cy, depth, frostTtl) {
  const F = CFG.flameTicks;
  switch (b.element) {
    case 'fire': return zone(state, cx, cy, Z.FLAME, depth ? 50 : 90, depth ? 50 : 90, 'fire', b.owner);
    // Hot flame first, slowing frost sheet once it cools.
    case 'frost': return zone(state, cx, cy, Z.FLAME, F + frostTtl, F, 'frost', b.owner, Z.FROST);
    case 'gas': return zone(state, cx, cy, Z.GAS, depth ? 90 : CFG.fieldTicks, depth ? 90 : CFG.fieldTicks, 'gas', b.owner);
    case 'volt': return zone(state, cx, cy, Z.FLAME, depth ? 60 : F, depth ? 60 : F, 'volt', b.owner);
    default: return zone(state, cx, cy, Z.FLAME, F, F, 'normal', b.owner);
  }
}

function zone(state, x, y, kind, ttl, hot, element, holder, after = 0) {
  if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) return;
  const z = addZone(state, x, y, { kind, ttl, hot, element, holder, after });
  if (z) state.events.push({ t: 'zone', x, y, kind: z.kind, element });
}

// 灭焰: erase anything lethal here; steam replaces it.
function suppress(state, x, y) {
  const z = zoneAt(state, x, y);
  if (z && isLethal(z)) {
    state.zones.splice(state.zones.indexOf(z), 1);
    state.events.push({ t: 'suppress', x, y });
  }
}
