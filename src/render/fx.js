// Presentation-only effects: particles, floating combat text, banners, shake.
// Nothing here is ever read by the simulation, so it can be as random and as
// pretty as it likes without touching determinism.
import { SUB } from '../game/units.js';
import { ELEMENT_COLORS, ZONE_STYLE, UI } from './palette.js';

export class Fx {
  constructor(tilePx) {
    this.tile = tilePx;
    this.parts = [];
    this.texts = [];
    this.banners = [];
    this.shake = 0;
    this.freeze = 0;
    this.flashes = [];
  }

  px(t) { return (t + 0.5) * this.tile; }

  burst(x, y, color, n = 10, power = 2.4, life = 34) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = power * (0.35 + Math.random());
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6,
        life: life * (0.6 + Math.random() * 0.7), max: life,
        color, size: 2 + Math.random() * 3, grav: 0.06,
      });
    }
  }

  ring(x, y, color, r0 = 6, r1 = 34, life = 22) {
    this.parts.push({ ring: true, x, y, r0, r1, life, max: life, color });
  }

  text(x, y, str, color = UI.text, size = 15, life = 60) {
    this.texts.push({ x, y, str, color, size, life, max: life });
  }

  banner(str, sub = '', color = UI.accent, life = 100) {
    this.banners.push({ str, sub, color, life, max: life });
  }

  cellBurst(tx, ty, color, n, power, life) {
    this.burst(this.px(tx), this.px(ty), color, n, power, life);
  }

  consume(events, state, rules) {
    for (const e of events) {
      switch (e.t) {
        case 'place': {
          const col = ELEMENT_COLORS[e.element] || ELEMENT_COLORS.normal;
          this.ring(this.px(e.x), this.px(e.y), col.glow, 4, 22, 16);
          break;
        }
        case 'zone': {
          const style = ZONE_STYLE[e.kind] || ZONE_STYLE[1];
          if (Math.random() < 0.75) this.cellBurst(e.x, e.y, style.b, 3, 2.6, 22);
          break;
        }
        case 'break':
          this.cellBurst(e.x, e.y, '#c58a4a', 12, 3.2, 34);
          this.cellBurst(e.x, e.y, '#6d421e', 6, 2.2, 30);
          this.shake = Math.max(this.shake, 2.5);
          break;
        case 'reveal': {
          const def = rules.byId.get(e.power);
          this.ring(this.px(e.x), this.px(e.y), 'rgba(255,240,170,.9)', 4, 26, 26);
          if (def) this.text(this.px(e.x), this.px(e.y) - 12, def.name, '#ffe98a', 13, 50);
          break;
        }
        case 'capture': {
          const p = state.players[e.pid];
          if (!p) break;
          this.burst(p.x / SUB * this.tile, p.y / SUB * this.tile, '#bfe9ff', 16, 2.4, 40);
          this.text(p.x / SUB * this.tile, p.y / SUB * this.tile - 26, '被困!', '#bfe9ff', 16, 70);
          this.shake = Math.max(this.shake, 3);
          break;
        }
        case 'rescue': {
          const p = state.players[e.pid];
          if (!p) break;
          this.burst(p.x / SUB * this.tile, p.y / SUB * this.tile, '#8ff0a4', 18, 2.6, 40);
          this.text(p.x / SUB * this.tile, p.y / SUB * this.tile - 26, '救援成功', '#8ff0a4', 15, 70);
          break;
        }
        case 'pop':
        case 'eliminate': {
          const p = state.players[e.pid];
          if (!p) break;
          const px = p.x / SUB * this.tile, py = p.y / SUB * this.tile;
          this.burst(px, py, '#ffffff', 26, 3.6, 46);
          this.burst(px, py, '#ff9a3c', 16, 2.8, 40);
          this.shake = Math.max(this.shake, e.t === 'eliminate' ? 9 : 5);
          this.text(px, py - 30, e.t === 'eliminate' ? '淘汰!' : '爆泡!', '#ff9a9a', 18, 80);
          if (e.t === 'eliminate') this.freeze = Math.max(this.freeze, 5);
          break;
        }
        case 'item': {
          const p = state.players[e.pid];
          if (!p) break;
          this.text(p.x / SUB * this.tile, p.y / SUB * this.tile - 24, `+${e.name}`, '#ffe98a', 15, 60);
          this.ring(p.x / SUB * this.tile, p.y / SUB * this.tile, 'rgba(255,230,140,.85)', 6, 30, 24);
          break;
        }
        case 'combo':
          this.banner(e.name, comboSub(e.effect), '#ffd76a', 90);
          this.cellBurst(e.x, e.y, '#ffd76a', 30, 4.2, 44);
          this.shake = Math.max(this.shake, 8);
          this.freeze = Math.max(this.freeze, 4);
          break;
        case 'chain':
          if (e.depth >= 2) this.banner(`${e.depth} 连锁`, `${e.count} 颗泡泡被引爆`, '#7fe3ff', 55);
          this.shake = Math.max(this.shake, 3 + e.depth);
          break;
        case 'dash': {
          const p = state.players[e.pid];
          if (!p) break;
          this.text(p.x / SUB * this.tile, p.y / SUB * this.tile - 30, '极限冲刺!', '#7fe3ff', 13, 40);
          break;
        }
        case 'shield': {
          const p = state.players[e.pid];
          if (!p) break;
          this.ring(p.x / SUB * this.tile, p.y / SUB * this.tile, 'rgba(180,160,255,.95)', 8, 40, 26);
          this.text(p.x / SUB * this.tile, p.y / SUB * this.tile - 28, '护盾抵挡', '#c9b8ff', 14, 55);
          break;
        }
        case 'suppress':
          this.cellBurst(e.x, e.y, '#dfe7f2', 8, 1.6, 40);
          break;
        case 'win':
          this.banner(e.reason === 'timeout' ? '时间到' : '胜利', '', '#8ff0a4', 200);
          break;
        default: break;
      }
    }
  }

  update() {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (--p.life <= 0) { this.parts.splice(i, 1); continue; }
      if (p.ring) continue;
      p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.vx *= 0.985;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      if (--t.life <= 0) this.texts.splice(i, 1);
      else t.y -= 0.35;
    }
    for (let i = this.banners.length - 1; i >= 0; i--) {
      if (--this.banners[i].life <= 0) this.banners.splice(i, 1);
    }
    this.shake *= 0.86;
    if (this.shake < 0.05) this.shake = 0;
    if (this.freeze > 0) this.freeze--;
  }

  draw(c) {
    for (const p of this.parts) {
      const a = Math.max(0, p.life / p.max);
      if (p.ring) {
        const r = p.r0 + (p.r1 - p.r0) * (1 - a);
        c.globalAlpha = a * 0.85;
        c.strokeStyle = p.color;
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.stroke();
        continue;
      }
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
    c.textAlign = 'center';
    for (const t of this.texts) {
      const a = Math.min(1, t.life / (t.max * 0.5));
      c.globalAlpha = a;
      c.font = `bold ${t.size}px "PingFang SC", system-ui, sans-serif`;
      c.lineWidth = 3; c.strokeStyle = 'rgba(6,10,22,.8)';
      c.strokeText(t.str, t.x, t.y);
      c.fillStyle = t.color;
      c.fillText(t.str, t.x, t.y);
    }
    c.globalAlpha = 1;
  }

  drawBanners(c, w, h) {
    let y = h * 0.24;
    for (const b of this.banners) {
      const t = 1 - b.life / b.max;
      const a = Math.min(1, b.life / 24);
      const scale = 1 + Math.max(0, 0.25 - t) * 1.2;
      c.save();
      c.globalAlpha = a;
      c.translate(w / 2, y);
      c.scale(scale, scale);
      c.textAlign = 'center';
      c.font = 'bold 40px "PingFang SC", system-ui, sans-serif';
      c.lineWidth = 7; c.strokeStyle = 'rgba(8,12,24,.85)';
      c.strokeText(b.str, 0, 0);
      c.fillStyle = b.color;
      c.fillText(b.str, 0, 0);
      if (b.sub) {
        c.font = '15px "PingFang SC", system-ui, sans-serif';
        c.lineWidth = 4; c.strokeText(b.sub, 0, 26);
        c.fillStyle = '#e8eefc'; c.fillText(b.sub, 0, 26);
      }
      c.restore();
      y += 62;
    }
  }

  shakeOffset() {
    if (!this.shake) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * this.shake * 2, y: (Math.random() - 0.5) * this.shake * 2 };
  }
}

function comboSub(effect) {
  return {
    detonate: '焰泡点燃气域 · 范围火球',
    ignite: '雷泡引燃全部毒气',
    conduct: '超导 · 周围元素泡同时引爆',
    smoke: '蒸汽灭焰 · 火焰被压制',
    flare: '曳光 · 爆破臂长 +2',
    snare: '凝滞 · 减速场延长',
  }[effect] || '';
}
