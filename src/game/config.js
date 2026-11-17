// All gameplay tuning lives here. The sim never hardcodes a magic number, so a
// "balance pass" is a one-file diff. Units: ticks are 1/60s, distances are subunits (256 = 1 tile).
export const TICK_HZ = 60;
export const MS_PER_TICK = 1000 / TICK_HZ;

export const MAP_W = 19;
export const MAP_H = 13;

// tiles: 0 floor, 1 hard (permanent), 2 soft (destructible)
export const T = { FLOOR: 0, HARD: 1, SOFT: 2 };

export const CFG = {
  // --- round
  roundTicks: 240 * TICK_HZ,
  lives: 3,
  respawnTicks: 100,
  invulnTicks: 90,

  // --- movement
  baseSpeed: 12,          // subunits/tick -> 2.81 tiles/s
  speedStep: 2,           // per speed item
  dashBonus: 14,
  dashTicks: 26,          // pop-dash window after an explosion sweeps past you

  // --- bubbles
  fuseTicks: 260,         // 4.3s
  quickFuseTicks: 150,
  baseBlast: 2,           // arms are this many tiles long
  maxBlast: 7,
  maxBubbles: 6,
  flameTicks: 34,         // how long a flame cell stays lethal
  fieldTicks: 200,        // how long residual element fields linger
  chainDepth: 12,

  // --- capture / rescue
  trapTicks: 300,         // 5s inside a bubble before you pop
  rescueTicks: 24,        // contact time needed to free a teammate
  rescueWindow: 40,       // grace: a rescuer arriving late still succeeds if trap > this

  // --- scoring
  scoreSoft: 10,
  scoreHit: 120,
  scoreRescue: 60,
  scoreKill: 320,
  scoreChain: 25,
  scoreItem: 15,

  // --- map generation
  softDensity: 620,       // permille chance a free cell holds a soft block
  itemChance: 250,        // permille chance a soft block hides an item
  hardDensity: 0,         // extra random hard blocks (0 = only pillars)

  // --- ai
  aiReactTicks: 6,
  aiMissRate: 90,         // permille chance a bot "plays worse" (adds human-like noise)
};

// Per-element overrides for the demo's difficulty ladder.
export const BOT_LEVELS = {
  easy: { reactTicks: 14, missRate: 300, lookahead: 1 },
  normal: { reactTicks: 6, missRate: 90, lookahead: 2 },
  hard: { reactTicks: 3, missRate: 20, lookahead: 3 },
};
