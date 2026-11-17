// Browser shell: menu, input, HUD, replay save/load. All game rules live in the
// sim; this file only turns keyboards into commands and state into pixels.
import { loadPowers } from './game/powers.js';
import { createSim, stepSim } from './game/state.js';
import { CFG } from './game/config.js';
import { packCmd, DIR } from './game/input.js';
import { createLoop } from './core/loop.js';
import { Recorder, Playback, validateReplay } from './core/replay.js';
import { buildAtlas } from './render/atlas.js';
import { Renderer } from './render/renderer.js';
import { Fx } from './render/fx.js';
import { PLAYER_COLORS, ELEMENT_COLORS } from './render/palette.js';
import { Sfx } from './audio/sfx.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const STORE_KEY = 'bubblefront.replay.v1';

const rules = await loadPowers();
const atlas = buildAtlas(rules);
const canvas = $('game');
const renderer = new Renderer(canvas, atlas, rules, 44);
const fx = new Fx(44);
const sfx = new Sfx();

let sim = null;
let specs = null;
let recorder = null;
let playback = null;
let replayMode = false;
let ended = false;
let lastReplay = null;
let currentSeed = 1;
let currentMode = 'solo';
let currentLevel = 'normal';
let hudClock = 0;

// ---------- input ----------
const held = new Set();
const stacks = [new DirStack(), new DirStack()];
const P1 = { KeyW: DIR.UP, KeyS: DIR.DOWN, KeyA: DIR.LEFT, KeyD: DIR.RIGHT };
const P2 = { ArrowUp: DIR.UP, ArrowDown: DIR.DOWN, ArrowLeft: DIR.LEFT, ArrowRight: DIR.RIGHT };
const GAME_KEYS = new Set([...Object.keys(P1), ...Object.keys(P2), 'Space', 'Enter', 'ShiftRight', 'KeyE']);

function DirStack() {
  this.order = [];
  this.press = (d) => { this.order = this.order.filter((x) => x !== d); this.order.push(d); };
  this.release = (d) => { this.order = this.order.filter((x) => x !== d); };
  this.current = () => (this.order.length ? this.order[this.order.length - 1] : null);
}

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  sfx.resume();
  held.add(e.code);
  if (P1[e.code] !== undefined) stacks[0].press(P1[e.code]);
  if (P2[e.code] !== undefined) stacks[1].press(P2[e.code]);
  switch (e.code) {
    case 'KeyP': togglePause(); break;
    case 'KeyR': restart(); break;
    case 'KeyH': togglePreview(); break;
    case 'KeyG': toggleDanger(); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyN': toggleMusic(); break;
    case 'Period': if (loop.getPaused()) loop.stepOnce(); break;
    default: break;
  }
});
addEventListener('keyup', (e) => {
  held.delete(e.code);
  if (P1[e.code] !== undefined) stacks[0].release(P1[e.code]);
  if (P2[e.code] !== undefined) stacks[1].release(P2[e.code]);
});
addEventListener('blur', () => { held.clear(); stacks.forEach((s) => { s.order = []; }); });

function humanCmds() {
  const cmds = new Array(specs.length).fill(0);
  if (replayMode) return playback.cmdsFor(sim.tick).slice();
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].bot) continue;
    const slot = i === 0 ? 0 : 1;
    const place = slot === 0 ? held.has('Space') : held.has('Enter');
    const swap = slot === 0 ? held.has('KeyE') : held.has('ShiftRight');
    const dir = stacks[slot].current();
    cmds[i] = packCmd(dir, dir !== null, place, swap);
  }
  return cmds;
}

// ---------- match lifecycle ----------
function buildSpecs(mode, level) {
  if (mode === 'ffa') {
    return [
      { name: '你', team: 0 },
      { name: 'AI·红', team: 1, bot: level },
      { name: 'AI·黄', team: 2, bot: level },
      { name: 'AI·紫', team: 3, bot: level },
    ];
  }
  if (mode === 'local') {
    return [
      { name: 'P1', team: 0 }, { name: 'P2', team: 0 },
      { name: 'AI·甲', team: 1, bot: level }, { name: 'AI·乙', team: 1, bot: level },
    ];
  }
  return [
    { name: '你', team: 0 }, { name: 'AI·队友', team: 0, bot: level },
    { name: 'AI·甲', team: 1, bot: level }, { name: 'AI·乙', team: 1, bot: level },
  ];
}

function startMatch(seed, mode = currentMode, level = currentLevel) {
  currentSeed = seed >>> 0 || 1;
  currentMode = mode;
  currentLevel = level;
  specs = buildSpecs(mode, level);
  sim = createSim({ seed: currentSeed, rules, mode: mode === 'ffa' ? 'ffa' : 'teams', players: specs });
  recorder = new Recorder(sim, specs);
  playback = null;
  replayMode = false;
  beginPlay();
}

function startReplay(raw) {
  const replay = validateReplay(raw);
  specs = replay.players;
  currentSeed = replay.seed;
  sim = createSim({ seed: replay.seed, rules, mode: replay.mode, players: specs });
  playback = new Playback(replay);
  recorder = null;
  replayMode = true;
  lastReplay = replay;
  beginPlay();
  toast(`回放载入：${replay.ticks} tick · 校验值 ${replay.hash}`);
}

function beginPlay() {
  ended = false;
  fx.parts.length = 0; fx.texts.length = 0; fx.banners.length = 0; fx.shake = 0; fx.freeze = 0;
  $('feed').innerHTML = '';
  renderer.dpr = null;
  renderer.histTick = -1;
  renderer.cur = null; renderer.prev = null;
  renderer.resize(sim);
  $('menu').classList.add('hidden');
  $('endOverlay').classList.add('hidden');
  $('replayBadge').classList.toggle('hidden', !replayMode);
  $('saveReplayBtn').disabled = replayMode;
  $('watchReplayBtn').disabled = replayMode;
  loop.setPaused(false);
  $('pauseBtn').textContent = '暂停';
  updateHud(true);
}

function finishMatch() {
  ended = true;
  let verifyNote = '';
  if (replayMode) {
    const v = playback.verify(sim);
    verifyNote = v.ok
      ? `回放校验通过 · ${v.actual} · ${v.ticks} tick 完全一致`
      : `回放校验失败：期望 ${v.expected}@${v.expectedTicks}，实际 ${v.actual}@${v.ticks}`;
    toast(v.ok ? '回放逐帧校验一致' : '回放不一致！', 5000);
  } else {
    lastReplay = recorder.finish(sim);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(lastReplay)); } catch { /* storage full/blocked */ }
  }
  const humanTeam = specs[0]?.team ?? 0;
  const won = sim.winnerTeam >= 0 && sim.players.some((p) => p.team === sim.winnerTeam && !p.isBot);
  if (!replayMode) (won ? sfx.win() : sfx.lose());

  $('endTitle').textContent = endTitle(sim, won, humanTeam);
  $('endSub').textContent = verifyNote || (sim.endReason === 'timeout' ? '时间到，按剩余生命与得分判定。' : '对方全员出局。');
  $('endStats').innerHTML = statsTable(sim);
  $('endOverlay').classList.remove('hidden');
  $('endWatchBtn').disabled = !lastReplay;
  $('endSaveBtn').disabled = !lastReplay;
}

function endTitle(state, won, humanTeam) {
  if (replayMode) return '回放结束';
  if (state.winnerTeam < 0) return '平局';
  if (state.mode === 'ffa') {
    const champ = state.players.find((p) => p.team === state.winnerTeam);
    return champ && !champ.isBot ? '你赢了！' : `${champ?.name || 'AI'} 获胜`;
  }
  return won ? '胜利！' : (state.winnerTeam === humanTeam ? '胜利' : '惜败');
}

function statsTable(state) {
  const rows = state.players.map((p) => {
    const col = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
    return `<tr><td style="color:${col.body}">${esc(p.name)}</td><td>${p.score}</td><td>${p.placed}</td><td>${p.saved}</td><td>${p.lives}</td></tr>`;
  }).join('');
  return `<table><tr><th>玩家</th><th>得分</th><th>放泡</th><th>救援</th><th>剩命</th></tr>${rows}</table>`;
}

// ---------- loop ----------
const loop = createLoop({
  msPerTick: 1000 / 60,
  onStep() {
    if (!sim || ended || sim.status !== 'playing') return;
    if (fx.freeze > 0) { fx.freeze--; return; }   // hit-stop: render only
    const cmds = humanCmds();
    if (recorder) recorder.push(sim.tick, cmds);
    stepSim(sim, cmds, rules);
    fx.consume(sim.events, sim, rules);
    sfx.consume(sim.events);
    feedEvents(sim.events);
    if (sim.status !== 'playing') finishMatch();
  },
  onRender(alpha) {
    if (!sim) return;
    renderer.draw(sim, alpha, fx);
    fx.update();
    if (++hudClock % 6 === 0) updateHud();
  },
});

// ---------- HUD ----------
function updateHud(force) {
  if (!sim) return;
  const left = Math.max(0, CFG.roundTicks - sim.tick);
  const sec = Math.ceil(left / 60);
  $('timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('low', sec <= 30);
  $('seedLabel').textContent = `seed ${sim.seed} · tick ${sim.tick}`;

  const teams = new Map();
  for (const p of sim.players) {
    const t = teams.get(p.team) || { score: 0, lives: 0, out: 0 };
    t.score += p.score; t.lives += p.lives; if (p.status === 'out') t.out++;
    teams.set(p.team, t);
  }
  $('teamRows').innerHTML = [...teams.entries()].map(([id, t]) => {
    const col = PLAYER_COLORS[id % PLAYER_COLORS.length];
    const label = sim.mode === 'ffa' ? (sim.players.find((p) => p.team === id)?.name || `队${id}`) : (id === specs[0].team ? '我方' : '敌方');
    return `<div class="teamRow"><span style="color:${col.body}">${esc(label)}</span><span>${t.score} 分 · ${t.lives} 命</span></div>`;
  }).join('');

  $('playerCards').innerHTML = sim.players.map((p) => {
    const col = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
    const el = rules.elements.get(p.element);
    const active = sim.bubbles.reduce((n, b) => n + (b.owner === p.id ? 1 : 0), 0);
    const status = { ok: '', trapped: `被困 ${Math.ceil(p.trapTicks / 60)}s`, dead: `复活 ${Math.ceil(p.respawnTicks / 60)}s`, out: '已出局' }[p.status];
    const buffs = [p.shield ? `护盾×${p.shield}` : '', p.quickFuse ? '速爆' : '', p.dashTicks ? '冲刺' : ''].filter(Boolean).join(' ');
    return `<div class="pcard ${p.status === 'out' ? 'dead' : ''}" style="border-color:${col.body}">
      <div class="top"><span style="color:${col.body}">${esc(p.name)}</span><span>${p.score}</span></div>
      <div class="stats">
        <span>泡 <b>${active}/${p.bubbles}</b></span><span>力 <b>${p.blast}</b></span>
        <span>速 <b>${1 + p.speedU}</b></span>
        <span style="color:${ELEMENT_COLORS[p.element]?.core || '#fff'}">${esc(el?.name || p.element)}</span>
        <span>命 <b>${p.lives}</b></span>
      </div>
      ${status || buffs ? `<div class="status">${esc(status)} ${esc(buffs)}</div>` : ''}
    </div>`;
  }).join('');
}

function feedEvents(events) {
  const feed = $('feed');
  for (const e of events) {
    let msg = '', hot = false;
    const who = (id) => sim.players[id]?.name || `P${id + 1}`;
    switch (e.t) {
      case 'combo': msg = `元素反应【${e.name}】`; hot = true; break;
      case 'chain': if (e.depth >= 2) { msg = `${e.depth} 连锁，引爆 ${e.count} 颗泡泡`; hot = true; } break;
      case 'capture': msg = `${who(e.pid)} 被困住了`; break;
      case 'rescue': msg = `${who(e.by)} 救出了 ${who(e.pid)}`; break;
      case 'eliminate': msg = `${who(e.pid)} 被淘汰`; hot = true; break;
      case 'dash': msg = `${who(e.pid)} 极限冲刺`; break;
      case 'reveal': msg = `发现道具 ${rules.byId.get(e.power)?.name || e.power}`; break;
      default: break;
    }
    if (!msg) continue;
    const div = document.createElement('div');
    div.textContent = msg;
    if (hot) div.className = 'hot';
    feed.prepend(div);
    while (feed.children.length > 6) feed.lastChild.remove();
  }
}

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------- toolbar ----------
function togglePause() {
  if (!sim) return;
  const p = !loop.getPaused();
  loop.setPaused(p);
  $('pauseBtn').textContent = p ? '继续' : '暂停';
}
function restart() {
  if (!sim) return;
  sfx.click();
  if (replayMode && lastReplay) startReplay(lastReplay);
  else startMatch(currentSeed);
}
function newMap() {
  sfx.click();
  startMatch((Math.random() * 0xffffffff) >>> 0);
}
function togglePreview() {
  renderer.showPreview = !renderer.showPreview;
  $('previewBtn').classList.toggle('on', renderer.showPreview);
}
function toggleDanger() {
  renderer.showDanger = !renderer.showDanger;
  $('dangerBtn').classList.toggle('on', renderer.showDanger);
}
function toggleMute() {
  sfx.setMuted(!sfx.muted);
  $('muteBtn').classList.toggle('on', sfx.muted);
  $('muteBtn').textContent = sfx.muted ? '已静音' : '静音';
}
function toggleMusic() {
  const on = sfx.toggleMusic();
  $('musicBtn').classList.toggle('on', !!on);
}
function saveReplay() {
  if (!lastReplay) { toast('还没有可保存的回放，先打完一局'); return; }
  const blob = new Blob([JSON.stringify(lastReplay)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bubblefront-${lastReplay.seed}-${lastReplay.ticks}t.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`回放已导出（${(JSON.stringify(lastReplay).length / 1024).toFixed(1)} KB）`);
}
function watchReplay() {
  if (!lastReplay) { toast('还没有回放'); return; }
  startReplay(lastReplay);
}
function toMenu() {
  loop.setPaused(true);
  $('pauseBtn').textContent = '继续';
  $('endOverlay').classList.add('hidden');
  $('menu').classList.remove('hidden');
}

$('pauseBtn').onclick = togglePause;
$('stepBtn').onclick = () => { if (!loop.getPaused()) togglePause(); loop.stepOnce(); updateHud(true); };
$('speedSel').onchange = (e) => loop.setSpeed(Number(e.target.value));
$('restartBtn').onclick = restart;
$('newMapBtn').onclick = newMap;
$('menuBtn').onclick = toMenu;
$('saveReplayBtn').onclick = saveReplay;
$('watchReplayBtn').onclick = watchReplay;
$('previewBtn').onclick = togglePreview;
$('dangerBtn').onclick = toggleDanger;
$('muteBtn').onclick = toggleMute;
$('musicBtn').onclick = toggleMusic;
$('rematchBtn').onclick = restart;
$('endNewBtn').onclick = newMap;
$('endWatchBtn').onclick = watchReplay;
$('endSaveBtn').onclick = saveReplay;
$('endMenuBtn').onclick = toMenu;

// ---------- menu ----------
for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.onclick = () => {
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('sel'));
    btn.classList.add('sel');
    sfx.click();
  };
}
function rollSeed() { $('seed').value = String(1 + Math.floor(Math.random() * 0x7ffffffe)); }
$('rollSeed').onclick = rollSeed;
rollSeed();
$('startBtn').onclick = () => {
  sfx.click();
  const mode = document.querySelector('[data-mode].sel')?.dataset.mode || 'solo';
  startMatch(Number($('seed').value) >>> 0 || 1, mode, $('botLevel').value);
};
$('loadReplayBtn').onclick = () => $('replayFile').click();
$('replayFile').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try { startReplay(await file.text()); } catch (err) { toast(`回放载入失败：${err.message}`, 4000); }
  e.target.value = '';
};
$('lastReplayBtn').onclick = () => {
  try { startReplay(localStorage.getItem(STORE_KEY)); } catch (err) { toast(`回放载入失败：${err.message}`, 4000); }
};
try {
  if (localStorage.getItem(STORE_KEY)) $('lastReplayBtn').classList.remove('hidden');
} catch { /* private mode */ }

$('comboList').innerHTML = rules.data.combos.map((c) => {
  const a = rules.elements.get(c.a)?.name || c.a;
  const b = rules.elements.get(c.b)?.name || c.b;
  return `<div style="margin-bottom:4px"><b style="color:var(--warn)">${esc(c.name)}</b> ${esc(a)}+${esc(b)}<br>${esc(c.blurb)}</div>`;
}).join('');

// A match runs behind the menu so the first paint is a live arena, not a blank.
startMatch(Number($('seed').value) >>> 0 || 1);
toMenu();
loop.start();

// Console helpers for tinkering / asset export.
globalThis.BF = {
  get sim() { return sim; }, rules, renderer, fx, sfx, atlas, loop,
  startMatch, startReplay, updateHud,
  get lastReplay() { return lastReplay; },
};
