// Procedural sprite atlas. Every sprite in the demo is painted into a single
// offscreen canvas at boot, so the repo ships zero binary assets and still has
// a real atlas pipeline (name -> source rect) that a PNG exporter can replace.
//
// Upgrade path: call `atlasToPng()` in the console, hand the PNG + frames JSON
// to an artist, and swap buildAtlas() for a loader. Nothing else changes.
import { ELEMENT_COLORS, PLAYER_COLORS } from './palette.js';

export const CELL = 64;

export function buildAtlas(rules) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const frames = new Map();
  let cx = 0, cy = 0;

  function slot(name, draw) {
    if (cx + CELL > canvas.width) { cx = 0; cy += CELL; }
    if (cy + CELL > canvas.height) throw new Error('atlas full');
    ctx.save();
    ctx.translate(cx, cy);
    draw(ctx, CELL);
    ctx.restore();
    frames.set(name, { x: cx, y: cy, w: CELL, h: CELL });
    cx += CELL;
  }

  slot('floor0', (c, s) => floorTile(c, s, '#2a3350', '#242c46'));
  slot('floor1', (c, s) => floorTile(c, s, '#2e3854', '#273049'));
  slot('hard', (c, s) => hardBlock(c, s));
  slot('softA', (c, s) => softBlock(c, s, '#a8703c', '#7c4c24'));
  slot('softB', (c, s) => softBlock(c, s, '#96612f', '#6d421e'));

  for (const el of rules.data.elements) {
    slot(`bubble_${el.id}`, (c, s) => bubble(c, s, el.id));
  }

  for (let col = 0; col < PLAYER_COLORS.length; col++) {
    for (let dir = 0; dir < 4; dir++) {
      for (let f = 0; f < 2; f++) {
        slot(`char_${col}_${dir}_${f}`, (c, s) => character(c, s, col, dir, f, 'ok'));
      }
    }
    slot(`char_${col}_trapped`, (c, s) => character(c, s, col, 1, 0, 'trapped'));
    slot(`char_${col}_dead`, (c, s) => character(c, s, col, 1, 0, 'dead'));
  }

  for (const p of rules.data.powers) slot(`item_${p.id}`, (c, s) => itemIcon(c, s, p));
  slot('spawn', (c, s) => spawnMark(c, s));

  return { canvas, frames, cell: CELL };
}

export function frameOf(atlas, name) {
  return atlas.frames.get(name) || atlas.frames.get('floor0');
}

export function atlasToPng(atlas) {
  return atlas.canvas.toDataURL('image/png');
}

export function atlasFramesJson(atlas) {
  return JSON.stringify(Object.fromEntries(atlas.frames), null, 2);
}

// ---------- primitives ----------
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function gloss(c, x, y, w, h) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,.42)');
  g.addColorStop(0.45, 'rgba(255,255,255,.08)');
  g.addColorStop(1, 'rgba(0,0,0,.22)');
  c.fillStyle = g;
  rr(c, x, y, w, h, Math.min(w, h) * 0.28);
  c.fill();
}

function floorTile(c, s, base, alt) {
  c.fillStyle = base;
  c.fillRect(0, 0, s, s);
  c.fillStyle = alt;
  c.fillRect(0, 0, s, s / 2);
  c.strokeStyle = 'rgba(255,255,255,.05)';
  c.lineWidth = 2;
  c.strokeRect(1, 1, s - 2, s - 2);
  c.fillStyle = 'rgba(255,255,255,.045)';
  for (let i = 0; i < 5; i++) {
    const px = (i * 37 + 11) % s, py = (i * 53 + 23) % s;
    c.fillRect(px, py, 3, 3);
  }
}

function hardBlock(c, s) {
  c.fillStyle = '#59647f';
  rr(c, 2, 2, s - 4, s - 4, 10); c.fill();
  c.fillStyle = '#3d4763';
  rr(c, 6, s * 0.52, s - 12, s * 0.42, 8); c.fill();
  c.fillStyle = '#7f8cab';
  rr(c, 6, 6, s - 12, s * 0.4, 8); c.fill();
  c.fillStyle = '#2c3450';
  for (const [x, y] of [[12, 12], [s - 18, 12], [12, s - 18], [s - 18, s - 18]]) {
    c.beginPath(); c.arc(x + 3, y + 3, 3.2, 0, 7); c.fill();
  }
  c.strokeStyle = 'rgba(10,14,28,.55)'; c.lineWidth = 3;
  rr(c, 2, 2, s - 4, s - 4, 10); c.stroke();
}

function softBlock(c, s, light, dark) {
  c.fillStyle = dark;
  rr(c, 3, 3, s - 6, s - 6, 8); c.fill();
  c.fillStyle = light;
  rr(c, 6, 6, s - 12, s - 16, 6); c.fill();
  c.strokeStyle = dark; c.lineWidth = 4;
  c.beginPath();
  c.moveTo(8, s * 0.38); c.lineTo(s - 8, s * 0.38);
  c.moveTo(8, s * 0.62); c.lineTo(s - 8, s * 0.62);
  c.moveTo(s * 0.5, 8); c.lineTo(s * 0.5, s - 12);
  c.stroke();
  gloss(c, 6, 6, s - 12, s - 16);
}

function bubble(c, s, element) {
  const col = ELEMENT_COLORS[element] || ELEMENT_COLORS.normal;
  const cx = s / 2, cy = s / 2 + 2, r = s * 0.36;
  const g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.28, col.core);
  g.addColorStop(1, col.rim);
  c.fillStyle = g;
  c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(8,16,32,.45)';
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,.75)';
  c.beginPath(); c.ellipse(cx - r * 0.36, cy - r * 0.44, r * 0.24, r * 0.15, -0.6, 0, 7); c.fill();
  c.strokeStyle = col.ink; c.fillStyle = col.ink; c.lineWidth = 3.4;
  c.lineCap = 'round'; c.lineJoin = 'round';
  glyph(c, element, cx, cy + 1, r * 0.95);
}

function glyph(c, element, cx, cy, r) {
  c.beginPath();
  switch (element) {
    case 'fire':
      c.moveTo(cx, cy - r * 0.62);
      c.bezierCurveTo(cx + r * 0.6, cy - r * 0.1, cx + r * 0.42, cy + r * 0.2, cx + r * 0.16, cy + r * 0.5);
      c.bezierCurveTo(cx + r * 0.05, cy + r * 0.28, cx - r * 0.05, cy + r * 0.28, cx - r * 0.16, cy + r * 0.5);
      c.bezierCurveTo(cx - r * 0.5, cy + r * 0.1, cx - r * 0.34, cy - r * 0.2, cx, cy - r * 0.62);
      c.fill();
      break;
    case 'frost':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
      }
      c.stroke();
      break;
    case 'volt':
      c.moveTo(cx + r * 0.2, cy - r * 0.65);
      c.lineTo(cx - r * 0.38, cy + r * 0.08);
      c.lineTo(cx + r * 0.02, cy + r * 0.08);
      c.lineTo(cx - r * 0.16, cy + r * 0.66);
      c.lineTo(cx + r * 0.42, cy - r * 0.1);
      c.lineTo(cx + r * 0.02, cy - r * 0.1);
      c.closePath();
      c.fill();
      break;
    case 'gas':
      for (const [dx, dy, rr2] of [[-0.26, 0.1, 0.24], [0.2, 0.16, 0.2], [0.0, -0.28, 0.18]]) {
        c.moveTo(cx + dx * r + rr2 * r, cy + dy * r);
        c.arc(cx + dx * r, cy + dy * r, rr2 * r, 0, 7);
      }
      c.fill();
      break;
    default:
      c.arc(cx, cy + r * 0.06, r * 0.3, 0, 7);
      c.stroke();
  }
}

function character(c, s, colorIdx, dir, frame, status) {
  const col = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
  const cx = s / 2;
  const bob = frame === 1 ? 1.5 : 0;
  const top = s * 0.2 + bob;

  if (status === 'dead') { c.globalAlpha = 0.45; }

  // shadow
  c.fillStyle = 'rgba(0,0,0,.28)';
  c.beginPath(); c.ellipse(cx, s * 0.86, s * 0.26, s * 0.07, 0, 0, 7); c.fill();

  // feet
  c.fillStyle = col.dark;
  const step = frame === 1 ? 3 : -1;
  rr(c, cx - s * 0.2 + step, s * 0.72, s * 0.15, s * 0.13, 4); c.fill();
  rr(c, cx + s * 0.05 - step, s * 0.72, s * 0.15, s * 0.13, 4); c.fill();

  // body
  const g = c.createLinearGradient(0, top, 0, s * 0.76);
  g.addColorStop(0, col.trim);
  g.addColorStop(0.35, col.body);
  g.addColorStop(1, col.dark);
  c.fillStyle = g;
  rr(c, cx - s * 0.28, top + s * 0.12, s * 0.56, s * 0.48, s * 0.2); c.fill();
  c.lineWidth = 3; c.strokeStyle = 'rgba(6,12,26,.5)';
  rr(c, cx - s * 0.28, top + s * 0.12, s * 0.56, s * 0.48, s * 0.2); c.stroke();

  // visor
  c.fillStyle = 'rgba(10,20,40,.82)';
  rr(c, cx - s * 0.22, top + s * 0.2, s * 0.44, s * 0.17, s * 0.07); c.fill();
  c.fillStyle = 'rgba(140,230,255,.35)';
  rr(c, cx - s * 0.2, top + s * 0.21, s * 0.4, s * 0.05, s * 0.03); c.fill();

  // eyes look where you are going
  const look = [[0, -2], [0, 2], [-4, 0], [4, 0]][dir] || [0, 0];
  c.fillStyle = '#eaf9ff';
  const eyeY = top + s * 0.28 + look[1] * 0.4;
  const spread = dir === 2 || dir === 3 ? s * 0.1 : s * 0.12;
  for (const sgn of [-1, 1]) {
    c.beginPath();
    c.arc(cx + sgn * spread + look[0] * 0.5, eyeY, s * 0.035, 0, 7);
    c.fill();
  }

  // antenna + team light
  c.strokeStyle = col.dark; c.lineWidth = 3;
  c.beginPath(); c.moveTo(cx, top + s * 0.14); c.lineTo(cx, top - 1); c.stroke();
  c.fillStyle = col.body;
  c.beginPath(); c.arc(cx, top - 3, s * 0.05, 0, 7); c.fill();

  if (status === 'trapped') {
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(190,240,255,.9)'; c.lineWidth = 3;
    c.fillStyle = 'rgba(150,220,255,.22)';
    c.beginPath(); c.arc(cx, s * 0.5, s * 0.44, 0, 7); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.6)';
    c.beginPath(); c.ellipse(cx - s * 0.16, s * 0.28, s * 0.08, s * 0.05, -0.6, 0, 7); c.fill();
  }
  c.globalAlpha = 1;
}

function itemIcon(c, s, power) {
  const hue = power.hue ?? 200;
  c.fillStyle = `hsl(${hue} 65% 26%)`;
  rr(c, 6, 10, s - 12, s - 20, 12); c.fill();
  c.fillStyle = `hsl(${hue} 85% 62%)`;
  rr(c, 9, 12, s - 18, s - 28, 10); c.fill();
  gloss(c, 9, 12, s - 18, s - 28);
  c.fillStyle = '#0e1830';
  c.font = `bold ${Math.round(s * 0.34)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(power.name.replace(/元素|\+1/g, (m) => (m === '+1' ? '' : '')), s / 2, s / 2 + 2);
}

function spawnMark(c, s) {
  c.strokeStyle = 'rgba(140,220,255,.35)';
  c.lineWidth = 3;
  c.beginPath(); c.arc(s / 2, s / 2, s * 0.34, 0, 7); c.stroke();
  c.beginPath(); c.arc(s / 2, s / 2, s * 0.12, 0, 7); c.stroke();
}
