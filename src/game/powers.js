// Data-driven content layer: the JSON file is the single source of truth for
// powerups, elements and combos. Adding content = editing data/powers.json.
import { CFG } from './config.js';
import { nextInt } from '../core/rng.js';

let DATA = null;

export async function loadPowers(url = 'data/powers.json') {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const fs = await import('node:fs');
    const file = new URL('../../data/powers.json', import.meta.url);
    DATA = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`powers.json load failed: ${res.status}`);
    DATA = await res.json();
  }
  return buildRuleset(DATA);
}

// Test/host hook: inject a table without touching the filesystem.
export function setPowers(data) {
  DATA = data;
  return buildRuleset(DATA);
}

export function getPowers() {
  if (!DATA) throw new Error('powers not loaded — call loadPowers() first');
  return DATA;
}

export function buildRuleset(data) {
  const byId = new Map();
  for (const p of data.powers) byId.set(p.id, p);
  const elements = new Map();
  for (const e of data.elements) elements.set(e.id, e);
  const combos = new Map();
  for (const c of data.combos) {
    combos.set(`${c.a}|${c.b}`, c);
    combos.set(`${c.b}|${c.a}`, c);
  }
  let total = 0;
  const cum = [];
  for (const p of data.powers) { total += p.weight; cum.push(total); }
  return { data, byId, elements, combos, weights: { total, cum, list: data.powers } };
}

// Weighted draw from the power table, filtered by what is still useful to `p`.
export function rollPower(rng, rules, player) {
  const { total, cum, list } = rules.weights;
  const pickAt = () => {
    const s = nextInt(rng, total);
    let j = 0;
    while (j < cum.length - 1 && s >= cum[j]) j++;
    return list[j];
  };
  let pick = pickAt();
  // Re-roll a few times if the picked power is already maxed for this player.
  if (player) {
    for (let tries = 0; tries < 4 && !isUseful(pick, player); tries++) pick = pickAt();
  }
  return pick;
}

function currentValue(player, def) {
  return def.set !== undefined && def.field === 'element'
    ? player.element
    : player[def.field];
}

function isUseful(def, player) {
  if (def.set !== undefined) {
    if (def.field === 'element') return player.element !== def.set;
    return player[def.field] !== def.set;
  }
  const cap = def.cap === 7 ? CFG.maxBlast : def.cap;
  return currentValue(player, def) < cap;
}

export function applyPower(player, def) {
  if (def.set !== undefined) {
    player[def.field] = def.set;
    return;
  }
  const cap = def.cap === 7 ? CFG.maxBlast : def.cap;
  player[def.field] = Math.min(cap, player[def.field] + def.delta);
}

export const ELEMENT_IDS = () => getPowers().elements.map((e) => e.id);
