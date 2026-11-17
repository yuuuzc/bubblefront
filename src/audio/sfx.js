// Synthesized audio: zero files, everything is oscillators + shaped noise.
// The context is created on the first user gesture (autoplay policy) and every
// sound is a short scheduled envelope, so there is nothing to stream or decode.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.musicOn = false;
    this.musicTimer = null;
    this.step = 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  tone(freq, { at = 0, dur = 0.16, type = 'square', gain = 0.2, slide = 0, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ at = 0, dur = 0.3, gain = 0.3, from = 1800, to = 120, q = 0.8 } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  arp(notes, step = 0.055, opts = {}) {
    notes.forEach((f, i) => this.tone(f, { ...opts, at: (opts.at || 0) + i * step }));
  }

  click() { this.resume(); this.tone(660, { dur: 0.06, type: 'triangle', gain: 0.12 }); }
  place() { this.tone(300, { dur: 0.12, type: 'sine', gain: 0.22, slide: 180 }); }
  swap() { this.arp([520, 780], 0.04, { dur: 0.07, type: 'triangle', gain: 0.12 }); }
  boom(power = 1) {
    this.noise({ dur: 0.32 + power * 0.06, gain: 0.32, from: 2200, to: 90 });
    this.tone(90, { dur: 0.28, type: 'sine', gain: 0.3, slide: -50 });
  }
  break_() { this.noise({ dur: 0.16, gain: 0.2, from: 1200, to: 300 }); }
  item() { this.arp([660, 880, 1320], 0.05, { dur: 0.12, type: 'triangle', gain: 0.16 }); }
  capture() { this.arp([520, 390, 260], 0.09, { dur: 0.2, type: 'square', gain: 0.14 }); }
  rescue() { this.arp([523, 659, 784, 1046], 0.06, { dur: 0.16, type: 'triangle', gain: 0.18 }); }
  pop() { this.noise({ dur: 0.22, gain: 0.3, from: 3000, to: 500 }); this.arp([440, 220], 0.1, { dur: 0.25, type: 'sawtooth', gain: 0.12 }); }
  dash() { this.noise({ dur: 0.18, gain: 0.14, from: 600, to: 3200 }); }
  combo() {
    this.arp([392, 523, 659, 784, 1046], 0.05, { dur: 0.3, type: 'square', gain: 0.16 });
    this.noise({ dur: 0.5, gain: 0.25, from: 3000, to: 200 });
  }
  chain(depth) { this.arp([440 * Math.pow(1.12, depth), 660 * Math.pow(1.12, depth)], 0.05, { dur: 0.14, type: 'square', gain: 0.14 }); }
  win() { this.arp([523, 659, 784, 1046, 1318], 0.11, { dur: 0.35, type: 'triangle', gain: 0.2 }); }
  lose() { this.arp([392, 330, 262, 196], 0.14, { dur: 0.4, type: 'triangle', gain: 0.18 }); }

  consume(events) {
    if (!this.ctx || this.muted) return;
    let booms = 0;
    for (const e of events) {
      switch (e.t) {
        case 'place': this.place(); break;
        case 'swap': this.swap(); break;
        case 'zone': if (booms++ < 2) this.boom(); break;
        case 'break': this.break_(); break;
        case 'item': case 'reveal': this.item(); break;
        case 'capture': this.capture(); break;
        case 'rescue': this.rescue(); break;
        case 'pop': case 'eliminate': this.pop(); break;
        case 'dash': this.dash(); break;
        case 'combo': this.combo(); break;
        case 'chain': if (e.depth >= 2) this.chain(e.depth); break;
        default: break;
      }
    }
  }

  // Tiny procedural chip-loop: a bass line and a sparse lead, scheduled ahead.
  toggleMusic(on) {
    this.musicOn = on ?? !this.musicOn;
    if (!this.musicOn) {
      if (this.musicTimer) clearInterval(this.musicTimer);
      this.musicTimer = null;
      return this.musicOn;
    }
    this.resume();
    if (!this.ctx) return false;
    const bass = [110, 110, 146.8, 110, 164.8, 146.8, 98, 123.5];
    const lead = [440, 0, 523, 0, 659, 587, 0, 523, 440, 0, 392, 0, 523, 0, 659, 0];
    this.musicTimer = setInterval(() => {
      if (this.muted || !this.musicOn) return;
      const s = this.step++;
      this.tone(bass[s % bass.length], { dur: 0.2, type: 'triangle', gain: 0.075 });
      const n = lead[s % lead.length];
      if (n) this.tone(n, { dur: 0.14, type: 'square', gain: 0.035 });
    }, 210);
    return this.musicOn;
  }
}
