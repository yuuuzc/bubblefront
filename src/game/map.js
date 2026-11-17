// Grid arena: procedural generation from a seed, plus tile/item queries.
// The tile array is a flat list (row major) so it stays JSON + hash friendly.
import { CFG, T } from './config.js';
import { chancePermille } from '../core/rng.js';
import { rollPower } from './powers.js';

export function spawnTiles(map, count) {
  const w = map.w, h = map.h;
  const corners = [
    [1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2],
    [Math.floor(w / 2), 1], [1, Math.floor(h / 2)],
  ];
  return corners.slice(0, count);
}

export function genMap(rng, rules, opts = {}) {
  const w = opts.w || CFG.MAP_W || 19;
  const h = opts.h || CFG.MAP_H || 13;
  const tiles = new Array(w * h).fill(T.FLOOR);
  const at = (x, y) => y * w + x;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[at(x, y)] = T.HARD;
      else if (x % 2 === 0 && y % 2 === 0) tiles[at(x, y)] = T.HARD;
      else if (chancePermille(rng, opts.softDensity ?? CFG.softDensity)) tiles[at(x, y)] = T.SOFT;
    }
  }

  const spawns = spawnTiles({ w, h }, opts.players || 4);
  for (const [sx, sy] of spawns) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const x = sx + dx, y = sy + dy;
      if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue;
      if (!(x % 2 === 0 && y % 2 === 0)) tiles[at(x, y)] = T.FLOOR;
    }
  }

  const items = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[at(x, y)] !== T.SOFT) continue;
      if (!chancePermille(rng, CFG.itemChance)) continue;
      const def = rollPower(rng, rules, null);
      items.push({ x, y, power: def.id, hidden: true, picked: false });
    }
  }

  return { w, h, tiles, items, spawns };
}

export function idx(map, x, y) { return y * map.w + x; }
export function inBounds(map, x, y) { return x >= 0 && y >= 0 && x < map.w && y < map.h; }

export function tileAt(map, x, y) {
  if (!inBounds(map, x, y)) return T.HARD;
  return map.tiles[idx(map, x, y)];
}

export function setTile(map, x, y, v) { map.tiles[idx(map, x, y)] = v; }

export function isWall(map, x, y) {
  const t = tileAt(map, x, y);
  return t === T.HARD || t === T.SOFT;
}

export function itemAt(map, x, y) {
  for (const it of map.items) {
    if (!it.picked && it.x === x && it.y === y) return it;
  }
  return null;
}

// Returns the revealed item (if any). Caller emits scoring / pickup events.
export function breakSoft(map, x, y) {
  if (tileAt(map, x, y) !== T.SOFT) return null;
  setTile(map, x, y, T.FLOOR);
  const it = itemAt(map, x, y);
  if (it) it.hidden = false;
  return it;
}
