// Fixed-point spatial units. All simulation positions are integers in "subunits";
// a tile is SUB wide. Integer-only math is what makes the sim reproducible
// across engines/platforms (float math is not).
export const SUB = 256;
export const HALF = SUB / 2;          // 128 — tile centre offset
export const R = 88;                  // entity collision radius (subunits)
export const TURN_WINDOW = 100;       // how far from a centre line a corner turn may start
export const ALIGN_RATE = 3;          // per-tick auto-centring speed while running straight

export const tileOf = (u) => Math.floor(u / SUB);
export const centerOf = (t) => t * SUB + HALF;
export const nearestCenter = (u) => Math.round((u - HALF) / SUB) * SUB + HALF;

// Circle-vs-tile-box overlap: does an AABB of radius R at (x,y) touch cell tx,ty?
export function overlapsCell(x, y, r, tx, ty) {
  return x + r > tx * SUB && x - r < (tx + 1) * SUB && y + r > ty * SUB && y - r < (ty + 1) * SUB;
}
