// Canvas2D renderer. Reads sim state, never writes it. All animation timing is
// derived from state.tick + interpolation alpha so a paused frame is stable and
// a replay at 0.25x speed looks exactly like the original slowed down.
import { SUB } from '../game/units.js';
import { T, CFG } from '../game/config.js';
import { blastPlan } from '../game/systems/bubbles.js';
import { bubbleAt } from '../game/systems/movement.js';
import { tileAt } from '../game/map.js';
import { Z, isLethal } from '../game/zones.js';
import { frameOf } from './atlas.js';
import { ELEMENT_COLORS, PLAYER_COLORS, ZONE_STYLE, UI } from './palette.js';

export class Renderer {
  constructor(canvas, atlas, rules, tilePx = 44) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.atlas = atlas;
    this.rules = rules;
    this.tile = tilePx;
    this.histTick = -1;
    this.prev = null;
    this.cur = null;
    this.showPreview = true;
    this.showDanger = false;
    this.followId = 0;
  }

  resize(state) {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = state.map.w * this.tile * dpr;
    this.canvas.height = state.map.h * this.tile * dpr;
    this.canvas.style.width = `${state.map.w * this.tile}px`;
    this.canvas.style.height = `${state.map.h * this.tile}px`;
    this.dpr = dpr;
  }

  sprite(name, dx, dy, dw, dh) {
    const f = frameOf(this.atlas, name);
    this.c.drawImage(this.atlas.canvas, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  }

  track(state) {
    if (this.histTick === state.tick) return;
    this.prev = this.cur;
    this.cur = state.players.map((p) => ({ x: p.x, y: p.y, tick: state.tick }));
    this.histTick = state.tick;
  }

  posOf(state, p, alpha) {
    const cur = this.cur?.[p.id];
    const prev = this.prev?.[p.id];
    if (!cur || !prev || prev.tick !== cur.tick - 1) return { x: p.x / SUB, y: p.y / SUB };
    return {
      x: (prev.x + (cur.x - prev.x) * alpha) / SUB,
      y: (prev.y + (cur.y - prev.y) * alpha) / SUB,
    };
  }

  draw(state, alpha, fx, opts = {}) {
    if (!this.dpr) this.resize(state);
    this.track(state);
    const c = this.c, T2 = this.tile;
    const t = state.tick + alpha;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sh = fx ? fx.shakeOffset() : { x: 0, y: 0 };
    c.save();
    c.translate(sh.x, sh.y);

    this.drawFloor(state);
    if (opts.showDanger ?? this.showDanger) this.drawDanger(state);
    if (opts.showPreview ?? this.showPreview) {
      for (const p of state.players) if (!p.isBot) this.drawPreview(state, p, t);
    }
    this.drawItems(state, t);
    this.drawZones(state, t, false);
    this.drawBlocks(state);
    this.drawBubbles(state, t);
    this.drawPlayers(state, alpha, t);
    this.drawZones(state, t, true);
    if (fx) fx.draw(c);
    c.restore();

    this.drawTimerEdge(state, t);
    if (fx) fx.drawBanners(c, state.map.w * T2, state.map.h * T2);
  }

  drawFloor(state) {
    const T2 = this.tile;
    for (let y = 0; y < state.map.h; y++) {
      for (let x = 0; x < state.map.w; x++) {
        this.sprite(`floor${(x + y) & 1}`, x * T2, y * T2, T2, T2);
      }
    }
    for (const [sx, sy] of state.map.spawns) {
      this.c.globalAlpha = 0.5;
      this.sprite('spawn', sx * T2, sy * T2, T2, T2);
      this.c.globalAlpha = 1;
    }
  }

  drawBlocks(state) {
    const T2 = this.tile;
    for (let y = 0; y < state.map.h; y++) {
      for (let x = 0; x < state.map.w; x++) {
        const v = tileAt(state.map, x, y);
        if (v === T.FLOOR) continue;
        const name = v === T.HARD ? 'hard' : ((x * 7 + y * 13) % 3 ? 'softA' : 'softB');
        this.sprite(name, x * T2, y * T2, T2, T2);
      }
    }
  }

  drawItems(state, t) {
    const T2 = this.tile;
    for (const it of state.map.items) {
      if (it.hidden || it.picked) continue;
      const bob = Math.sin(t * 0.09 + it.x) * 2;
      const s = T2 * 0.82;
      this.c.save();
      this.c.shadowColor = 'rgba(255,225,140,.55)';
      this.c.shadowBlur = 12;
      this.sprite(`item_${it.power}`, it.x * T2 + (T2 - s) / 2, it.y * T2 + (T2 - s) / 2 + bob, s, s);
      this.c.restore();
    }
  }

  drawZones(state, t, hotPass) {
    const c = this.c, T2 = this.tile;
    for (const z of state.zones) {
      const hot = z.hot > 0;
      if (hot !== hotPass) continue;
      const style = ZONE_STYLE[z.kind] || ZONE_STYLE[Z.FLAME];
      const px = z.x * T2, py = z.y * T2;
      c.save();
      if (hot && z.kind !== Z.FROST) {
        const flick = 0.86 + 0.14 * Math.sin(t * 0.7 + z.x * 3.1 + z.y * 1.7);
        const fade = Math.min(1, z.hot / 10);
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.85 * fade;
        const g = c.createRadialGradient(px + T2 / 2, py + T2 / 2, 2, px + T2 / 2, py + T2 / 2, T2 * 0.72 * flick);
        g.addColorStop(0, style.a);
        g.addColorStop(0.45, style.b);
        g.addColorStop(1, style.c);
        c.fillStyle = g;
        c.fillRect(px - T2 * 0.3, py - T2 * 0.3, T2 * 1.6, T2 * 1.6);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 0.55 * fade;
        c.fillStyle = style.b;
        c.fillRect(px + 2, py + 2, T2 - 4, T2 - 4);
      } else if (z.kind === Z.GAS) {
        const pulse = 0.32 + 0.07 * Math.sin(t * 0.06 + z.x + z.y);
        c.globalAlpha = Math.min(0.55, pulse + (isLethal(z) ? 0.15 : 0));
        c.fillStyle = style.b;
        roundRect(c, px + 3, py + 3, T2 - 6, T2 - 6, 9); c.fill();
        c.globalAlpha = 0.5;
        c.fillStyle = style.a;
        for (let i = 0; i < 3; i++) {
          const a = t * 0.02 + i * 2.1 + z.x;
          c.beginPath();
          c.arc(px + T2 / 2 + Math.cos(a) * T2 * 0.2, py + T2 / 2 + Math.sin(a * 1.3) * T2 * 0.2, T2 * 0.13, 0, 7);
          c.fill();
        }
      } else if (z.kind === Z.FROST) {
        c.globalAlpha = 0.55;
        c.fillStyle = style.b;
        roundRect(c, px + 2, py + 2, T2 - 4, T2 - 4, 6); c.fill();
        c.globalAlpha = 0.75;
        c.strokeStyle = style.a; c.lineWidth = 1.6;
        c.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = (Math.PI / 3) * i;
          c.moveTo(px + T2 / 2 - Math.cos(a) * T2 * 0.32, py + T2 / 2 - Math.sin(a) * T2 * 0.32);
          c.lineTo(px + T2 / 2 + Math.cos(a) * T2 * 0.32, py + T2 / 2 + Math.sin(a) * T2 * 0.32);
        }
        c.stroke();
      } else if (z.kind === Z.SMOKE) {
        c.globalAlpha = 0.42;
        c.fillStyle = style.b;
        for (let i = 0; i < 4; i++) {
          const a = t * 0.015 + i * 1.6;
          c.beginPath();
          c.arc(px + T2 / 2 + Math.cos(a) * T2 * 0.18, py + T2 / 2 + Math.sin(a) * T2 * 0.18, T2 * 0.3, 0, 7);
          c.fill();
        }
      }
      c.restore();
    }
  }

  drawBubbles(state, t) {
    const c = this.c, T2 = this.tile;
    for (const b of state.bubbles) {
      const frac = b.fuse / b.totalFuse;
      const urgency = 1 - frac;
      const pulse = 1 + Math.sin(t * (0.12 + urgency * 0.5)) * (0.05 + urgency * 0.06);
      const s = T2 * 0.94 * pulse;
      const px = b.x * T2 + T2 / 2, py = b.y * T2 + T2 / 2;
      const col = ELEMENT_COLORS[b.element] || ELEMENT_COLORS.normal;
      c.save();
      c.shadowColor = col.glow;
      c.shadowBlur = 10 + urgency * 16;
      this.sprite(`bubble_${b.element}`, px - s / 2, py - s / 2, s, s);
      c.restore();
      // fuse arc: a full ring empties as the fuse burns down
      c.save();
      c.strokeStyle = frac < 0.25 ? '#ff7a7a' : col.core;
      c.globalAlpha = 0.85;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(px, py, T2 * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      c.stroke();
      c.restore();
    }
  }

  drawPlayers(state, alpha, t) {
    const c = this.c, T2 = this.tile;
    const order = state.players.slice().sort((a, b) => a.y - b.y);
    for (const p of order) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') { this.drawRespawn(state, p); continue; }
      const { x, y } = this.posOf(state, p, alpha);
      const px = x * T2, py = y * T2;
      const moving = p.moving && p.status === 'ok';
      const frame = moving ? (Math.floor(t / 8) & 1) : 0;
      const size = T2 * 1.32;
      let name = p.status === 'trapped' ? `char_${p.color}_trapped` : `char_${p.color}_${p.dir}_${frame}`;
      c.save();
      if (p.invulnTicks > 0 && p.status === 'ok') c.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(t * 0.25));
      if (p.dashTicks > 0) {
        c.shadowColor = 'rgba(127,227,255,.9)';
        c.shadowBlur = 16;
      }
      this.sprite(name, px - size / 2, py - size * 0.72, size, size);
      c.restore();

      this.drawNameplate(state, p, px, py, size);

      if (p.status === 'trapped') {
        const frac = p.trapTicks / CFG.trapTicks;
        c.save();
        c.strokeStyle = frac < 0.3 ? UI.bad : '#bfe9ff';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(px, py - T2 * 0.1, T2 * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        c.stroke();
        if (p.rescue > 0) {
          c.strokeStyle = UI.good;
          c.beginPath();
          c.arc(px, py - T2 * 0.1, T2 * 0.58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.rescue / CFG.rescueTicks));
          c.stroke();
        }
        c.restore();
      }
      if (p.shield > 0 && p.status === 'ok') {
        c.save();
        c.strokeStyle = 'rgba(190,170,255,.75)';
        c.lineWidth = 2;
        c.beginPath(); c.arc(px, py - T2 * 0.12, T2 * 0.44, 0, 7); c.stroke();
        c.restore();
      }
    }
  }

  drawNameplate(state, p, px, py, size) {
    const c = this.c, T2 = this.tile;
    const col = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
    const el = ELEMENT_COLORS[p.element] || ELEMENT_COLORS.normal;
    const y = py - size * 0.78;
    c.save();
    c.font = 'bold 11px "PingFang SC", system-ui, sans-serif';
    c.textAlign = 'center';
    const label = p.name;
    const w = c.measureText(label).width + 26;
    c.fillStyle = 'rgba(8,12,24,.62)';
    roundRect(c, px - w / 2, y - 11, w, 16, 8); c.fill();
    c.fillStyle = col.body;
    c.beginPath(); c.arc(px - w / 2 + 8, y - 3, 3.4, 0, 7); c.fill();
    c.fillStyle = el.core;
    c.beginPath(); c.arc(px + w / 2 - 8, y - 3, 3.4, 0, 7); c.fill();
    c.fillStyle = p.isBot ? UI.dim : UI.text;
    c.fillText(label, px, y + 1);
    // lives as tiny pips
    for (let i = 0; i < p.lives; i++) {
      c.fillStyle = col.body;
      c.fillRect(px - (p.lives * 5) / 2 + i * 5, y + 5, 3, 3);
    }
    c.restore();
  }

  drawRespawn(state, p) {
    const c = this.c, T2 = this.tile;
    const [sx, sy] = state.map.spawns[p.spawnIdx];
    const px = (sx + 0.5) * T2, py = (sy + 0.5) * T2;
    c.save();
    c.globalAlpha = 0.75;
    c.fillStyle = UI.text;
    c.font = 'bold 13px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(`${Math.ceil(p.respawnTicks / 60)}`, px, py - 6);
    c.globalAlpha = 0.35;
    this.sprite(`char_${p.color}_dead`, px - T2 * 0.6, py - T2 * 0.6, T2 * 1.2, T2 * 1.2);
    c.restore();
  }

  // Where your next bubble would land and what it would cover. Uses the same
  // blastPlan as the explosion itself, so the preview can never lie.
  drawPreview(state, p, t) {
    if (p.status !== 'ok') return;
    const c = this.c, T2 = this.tile;
    const ox = Math.floor(p.x / SUB), oy = Math.floor(p.y / SUB);
    if (tileAt(state.map, ox, oy) !== T.FLOOR || bubbleAt(state, ox, oy)) return;
    const target = [ox, oy];
    const full = state.bubbles.reduce((n, b) => n + (b.owner === p.id ? 1 : 0), 0) >= p.bubbles;
    const col = ELEMENT_COLORS[p.element] || ELEMENT_COLORS.normal;
    const plan = blastPlan(state, { x: target[0], y: target[1], blast: p.blast, element: p.element });
    c.save();
    c.globalAlpha = full ? 0.1 : 0.2 + 0.04 * Math.sin(t * 0.12);
    c.fillStyle = full ? UI.bad : col.core;
    for (const [cx, cy] of plan.cells) c.fillRect(cx * T2 + 3, cy * T2 + 3, T2 - 6, T2 - 6);
    c.globalAlpha = full ? 0.5 : 0.85;
    c.strokeStyle = full ? UI.bad : col.core;
    c.lineWidth = 2;
    c.setLineDash([5, 4]);
    roundRect(c, target[0] * T2 + 3, target[1] * T2 + 3, T2 - 6, T2 - 6, 8);
    c.stroke();
    c.restore();
  }

  drawDanger(state) {
    const c = this.c, T2 = this.tile;
    const heat = new Map();
    const add = (x, y, v) => heat.set(`${x},${y}`, Math.max(heat.get(`${x},${y}`) || 0, v));
    for (const b of state.bubbles) {
      const plan = blastPlan(state, b);
      const urgency = 1 - b.fuse / b.totalFuse;
      for (const [x, y] of plan.cells) add(x, y, 0.15 + urgency * 0.4);
    }
    for (const z of state.zones) if (isLethal(z)) add(z.x, z.y, 0.55);
    c.save();
    for (const [key, v] of heat) {
      const [x, y] = key.split(',').map(Number);
      c.fillStyle = `rgba(255,70,70,${v})`;
      c.fillRect(x * T2, y * T2, T2, T2);
    }
    c.restore();
  }

  drawTimerEdge(state, t) {
    const left = CFG.roundTicks - state.tick;
    if (left > 30 * 60 || state.status !== 'playing') return;
    const c = this.c;
    const w = state.map.w * this.tile, h = state.map.h * this.tile;
    c.save();
    c.globalAlpha = 0.25 + 0.2 * Math.sin(t * 0.15);
    c.strokeStyle = UI.bad;
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.restore();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
