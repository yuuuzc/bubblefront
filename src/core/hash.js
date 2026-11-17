// FNV-1a 32bit over the whole sim state. This is the contract the replay layer
// verifies: seed + command stream must reproduce an identical hash every tick.
const PRIME = 0x01000193;

export function hashState(state, prev = 0x811c9dc5) {
  let h = prev >>> 0;
  const mix = (x) => {
    h ^= x & 0xff; h = Math.imul(h, PRIME) >>> 0;
    h ^= (x >>> 8) & 0xff; h = Math.imul(h, PRIME) >>> 0;
    h ^= (x >>> 16) & 0xff; h = Math.imul(h, PRIME) >>> 0;
    h ^= (x >>> 24) & 0xff; h = Math.imul(h, PRIME) >>> 0;
  };
  // Numbers are coerced to int32; strings feed every char (element ids collide
  // on their first letter: fire vs frost).
  const feed = (v) => {
    if (typeof v === 'string') { for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i)); return; }
    mix(typeof v === 'number' ? (v | 0) : v ? 1 : 0);
  };

  feed(state.tick);
  feed(state.rng.s);
  feed(state.bubbleSeq);
  feed(state.status);
  feed(state.winnerTeam);
  const t = state.map.tiles;
  for (let i = 0; i < t.length; i++) feed(t[i]);
  for (const p of state.players) {
    feed(p.x); feed(p.y); feed(p.dir); feed(p.moving); feed(p.axis);
    feed(p.status); feed(p.trapTicks); feed(p.rescue); feed(p.lives);
    feed(p.respawnTicks); feed(p.invulnTicks); feed(p.bubbles); feed(p.blast);
    feed(p.speedU); feed(p.element); feed(p.shield); feed(p.quickFuse);
    feed(p.dashTicks); feed(p.score); feed(p.placed); feed(p.prevCmd);
  }
  for (const b of state.bubbles) {
    feed(b.id); feed(b.x); feed(b.y); feed(b.fuse); feed(b.blast); feed(b.element); feed(b.owner);
  }
  for (const z of state.zones) {
    feed(z.x); feed(z.y); feed(z.kind); feed(z.ttl); feed(z.hot);
    feed(z.after); feed(z.element); feed(z.holder);
  }
  for (const it of state.map.items) {
    feed(it.x); feed(it.y); feed(it.power); feed(it.hidden); feed(it.picked);
  }
  return h >>> 0;
}

export function hashHex(state) {
  return hashState(state).toString(16).padStart(8, '0');
}
