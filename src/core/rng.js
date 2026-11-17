// Deterministic RNG: integer-only mulberry32 stream, persisted inside sim state.
export function makeRng(seed) {
  return { s: (seed >>> 0) || 1 };
}

// Returns integer in [0, 2^32). Advances state in place.
export function nextU32(rng) {
  let t = (rng.s = (rng.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), 1 | t) >>> 0;
  t = (t ^ (t + Math.imul(t ^ (t >>> 7), 61 | t))) >>> 0;
  return ((t ^ (t >>> 14)) >>> 0);
}

// Integer in [0, n). n must be a positive integer <= 2^31.
export function nextInt(rng, n) {
  return nextU32(rng) % n;
}

// Fixed-point probability: p given as integer permille (0..1000) -> boolean.
export function chancePermille(rng, permille) {
  return nextInt(rng, 1000) < permille;
}

// Integer in [min, max] inclusive.
export function nextRange(rng, min, max) {
  return min + nextInt(rng, max - min + 1);
}
