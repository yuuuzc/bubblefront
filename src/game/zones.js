// Zone = one grid cell carrying an element effect. A zone is *hot* (lethal) for
// `hot` ticks and may then degrade into a lingering residue (`after`, e.g. frost
// that slows, gas that waits to be ignited). That two-stage model is what lets a
// single blast cell be both an immediate threat and long-term area denial.
import { CFG } from './config.js';

export const Z = {
  FLAME: 1,
  GAS: 2,
  FROST: 3,
  SMOKE: 4,
  EMBER: 5,
};

export const ELEMENT_OF_KIND = {
  [Z.FLAME]: 'normal', [Z.GAS]: 'gas', [Z.FROST]: 'frost', [Z.SMOKE]: 'normal', [Z.EMBER]: 'fire',
};

export const isLethal = (z) => z.hot > 0 && z.kind !== Z.SMOKE && z.kind !== Z.FROST;
export const isSlowing = (z) => z.kind === Z.FROST;

export function zoneAt(state, x, y) {
  for (const z of state.zones) if (z.x === x && z.y === y) return z;
  return null;
}

export function lethalAt(state, x, y) {
  const z = zoneAt(state, x, y);
  return z && isLethal(z) ? z : null;
}

export function slowingAt(state, x, y) {
  const z = zoneAt(state, x, y);
  return z && isSlowing(z) ? z : null;
}

// s = { kind, ttl, hot, element, holder, after? }
export function addZone(state, x, y, s) {
  const ex = zoneAt(state, x, y);
  if (ex) {
    if (s.hot > 0) {
      if (ex.kind === Z.SMOKE) return null;              // steam suppression
      if (isLethal(ex)) {
        if (s.hot > ex.hot) { ex.kind = s.kind; ex.element = s.element; ex.holder = s.holder; }
        ex.hot = Math.max(ex.hot, s.hot);
        ex.ttl = Math.max(ex.ttl, s.hot + (ex.after ? ex.afterTtl : 0));
        return ex;
      }
      if (ex.hot === 0 && ex.kind !== Z.SMOKE) {
        // residue already there: fire first, then return to the residue
        const nz = mkZone(state, x, y, s);
        nz.after = ex.kind; nz.afterTtl = ex.ttl;
        state.zones.splice(state.zones.indexOf(ex), 1, nz);
        return nz;
      }
      ex.kind = s.kind; ex.hot = s.hot; ex.ttl = s.ttl;
      ex.element = s.element; ex.holder = s.holder; ex.after = 0;
      return ex;
    }
    // residue write
    if (isLethal(ex)) { ex.after = s.kind; ex.afterTtl = Math.max(ex.afterTtl || 0, s.ttl); return ex; }
    if (ex.kind === s.kind) { ex.ttl = Math.max(ex.ttl, s.ttl); return ex; }
    if (ex.ttl <= s.ttl) { ex.kind = s.kind; ex.ttl = s.ttl; ex.hot = 0; ex.element = s.element; }
    return ex;
  }
  const z = mkZone(state, x, y, s);
  state.zones.push(z);
  return z;
}

function mkZone(state, x, y, s) {
  return {
    x, y, kind: s.kind, ttl: s.ttl, hot: s.hot, after: s.after || 0,
    afterTtl: s.after ? Math.max(0, s.ttl - s.hot) : 0,
    element: s.element, holder: s.holder, born: state.tick,
  };
}

export function tickZones(state) {
  for (let i = state.zones.length - 1; i >= 0; i--) {
    const z = state.zones[i];
    if (z.hot > 0) z.hot--;
    if (--z.ttl <= 0) {
      state.zones.splice(i, 1);
      continue;
    }
    if (z.hot === 0 && z.after) {
      z.kind = z.after;
      z.after = 0;
      z.ttl = z.afterTtl || CFG.fieldTicks;
      z.afterTtl = 0;
      z.element = ELEMENT_OF_KIND[z.kind];
    }
  }
}
