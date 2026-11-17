// Shared art direction: one palette for sim-driven sprites, zones and UI.
export const ELEMENT_COLORS = {
  normal: { core: '#7fe3ff', rim: '#1b7fa8', glow: 'rgba(127,227,255,.55)', ink: '#083244' },
  fire:   { core: '#ffb066', rim: '#c2451a', glow: 'rgba(255,140,60,.55)',  ink: '#4a1704' },
  frost:  { core: '#cfe9ff', rim: '#4f7fd0', glow: 'rgba(160,205,255,.55)', ink: '#12305e' },
  volt:   { core: '#ffe98a', rim: '#c99a12', glow: 'rgba(255,226,110,.55)', ink: '#4a3604' },
  gas:    { core: '#b6f28a', rim: '#3f8f2a', glow: 'rgba(150,230,120,.5)',  ink: '#173d0c' },
};

export const PLAYER_COLORS = [
  { name: '蓝', body: '#4fc3f7', dark: '#1666a3', trim: '#e6f7ff' },
  { name: '红', body: '#ff8a80', dark: '#b0322a', trim: '#ffefec' },
  { name: '黄', body: '#ffd54f', dark: '#a8760a', trim: '#fff8e0' },
  { name: '紫', body: '#b39ddb', dark: '#5a3f8f', trim: '#f3ecff' },
];

export const ZONE_STYLE = {
  1: { a: '#fff3c4', b: '#ff9a3c', c: 'rgba(255,120,40,0)' },   // flame
  2: { a: '#d8ffb0', b: '#4fae3a', c: 'rgba(80,180,70,0)' },    // gas
  3: { a: '#eaf7ff', b: '#7fb6ec', c: 'rgba(140,200,255,0)' },  // frost
  4: { a: '#e8ecf2', b: '#8b96a8', c: 'rgba(150,160,180,0)' },  // smoke
  5: { a: '#ffd9a0', b: '#e0641f', c: 'rgba(230,110,40,0)' },   // ember
};

export const UI = {
  bg: '#0d1220',
  panel: 'rgba(18,26,44,.82)',
  panelLine: 'rgba(120,160,220,.18)',
  text: '#e8eefc',
  dim: '#8fa3c8',
  accent: '#7fe3ff',
  warn: '#ffb454',
  bad: '#ff7a7a',
  good: '#8ff0a4',
};
