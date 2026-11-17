// Grid-locked movement with lane snapping — the feel that makes QQ唐-style
// control read as "crisp" instead of "slippery". One axis is always exactly
// centred on a lane; a turn snaps the other axis into a lane when it is within
// a window, otherwise it glides to the nearest corner first. Integer math only.
import { SUB, R, TURN_WINDOW, tileOf, centerOf, nearestCenter } from '../units.js';
import { CFG, T } from '../config.js';
import { DIR } from '../input.js';
import { tileAt } from '../map.js';
import { slowingAt } from '../zones.js';

export function bubbleAt(state, tx, ty) {
  for (const b of state.bubbles) if (b.x === tx && b.y === ty) return b;
  return null;
}

export function speedOf(state, p) {
  let s = CFG.baseSpeed + p.speedU * CFG.speedStep;
  if (p.dashTicks > 0) s += CFG.dashBonus;
  if (slowingAt(state, tileOf(p.x), tileOf(p.y))) s = (s / 2) | 0;
  return s | 0;
}

// You can walk off your own bubble only while your body still overlaps it.
// Keying this on the *centre* tile instead of the overlap box is what used to
// freeze players on the tile boundary: the bubble turned solid mid-stride and
// their own blast caught them.
export function ownerOverlaps(b, p) {
  if (b.owner !== p.id) return false;
  return p.x + R > b.x * SUB && p.x - R < (b.x + 1) * SUB
    && p.y + R > b.y * SUB && p.y - R < (b.y + 1) * SUB;
}

export function passable(state, tx, ty, p) {
  if (tileAt(state.map, tx, ty) !== T.FLOOR) return false;
  const b = bubbleAt(state, tx, ty);
  if (!b) return true;
  return ownerOverlaps(b, p);
}

export function freeCircle(state, x, y, p) {
  for (let ty = tileOf(y - R); ty <= tileOf(y + R); ty++) {
    for (let tx = tileOf(x - R); tx <= tileOf(x + R); tx++) {
      if (!passable(state, tx, ty, p)) return false;
    }
  }
  return true;
}

const approach = (cur, target, step) => {
  const d = target - cur;
  if (d === 0) return cur;
  return cur + (Math.abs(d) <= step ? d : Math.sign(d) * step);
};

export function applyMove(state, p, intent) {
  if (p.status !== 'ok' || intent.dir === null) { p.moving = 0; return false; }
  const axis = intent.dir === DIR.LEFT || intent.dir === DIR.RIGHT ? 'x' : 'y';
  const sign = intent.dir === DIR.RIGHT || intent.dir === DIR.DOWN ? 1 : -1;
  const step = speedOf(state, p);

  if (p.axis !== axis) {
    // Turning: the axis we are *leaving* has to be snapped into a lane before the
    // new axis can take over. Forgetting this is what pins a character in a corner.
    const leaving = p.axis;
    const cur = p[leaving];
    const target = nearestCenter(cur);
    if (Math.abs(target - cur) <= TURN_WINDOW) {
      p[leaving] = target;
      if (!freeCircle(state, p.x, p.y, p)) { p[leaving] = cur; p.moving = 0; return false; }
      p.axis = axis;
    } else {
      // Out of turn range: glide to the nearest corner, then the next frame can turn.
      const g = approach(cur, target, step);
      const gx = leaving === 'x' ? g : p.x;
      const gy = leaving === 'x' ? p.y : g;
      if (freeCircle(state, gx, gy, p)) p[leaving] = g;
      p.moving = 1;
      return false;
    }
  }

  const cur = p[p.axis];
  const next = cur + sign * step;
  const cx = p.axis === 'x' ? next : p.x;
  const cy = p.axis === 'x' ? p.y : next;
  if (freeCircle(state, cx, cy, p)) { p[p.axis] = next; p.moving = 1; return true; }

  // Slide flush to the obstacle instead of stopping a whole tile short.
  const frontTile = tileOf(next + sign * R);
  const flush = sign > 0 ? frontTile * SUB - R - 1 : (frontTile + 1) * SUB + R;
  const allowed = sign > 0 ? Math.max(cur, Math.min(flush, next)) : Math.min(cur, Math.max(flush, next));
  if (allowed !== cur) {
    const gx = p.axis === 'x' ? allowed : p.x;
    const gy = p.axis === 'x' ? p.y : allowed;
    if (freeCircle(state, gx, gy, p)) { p[p.axis] = allowed; p.moving = 1; return false; }
  }
  p.moving = 0;
  return false;
}

export function snapToCenter(p) {
  p.x = centerOf(tileOf(p.x));
  p.y = centerOf(tileOf(p.y));
  p.moving = 0;
}
