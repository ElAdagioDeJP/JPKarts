import { DIFFS } from '../data/tracks';
import { wrapA } from '../math';
import { hAt } from '../track/track';
import { behind, emit, hit, isHuman, kartById, lateral } from './helpers';
import type { Kart, World } from './types';

export type ItemRole = 'ataque' | 'defensa' | 'movilidad' | 'caos' | 'trampa';

export interface ItemDef {
  id: string;
  name: string;
  /** base weight (relative probability) */
  w: number;
  role: ItemRole;
  /** do not use when first (AI) */
  aiNotWhenFirst?: boolean;
  /** AI uses it soon after getting it */
  aiQuick?: boolean;
  /** Apply the item. Return false when it had no effect (e.g. nobody ahead). */
  use(w: World, k: Kart): void | false;
}

const REG: ItemDef[] = [];
const BY_ID = new Map<string, ItemDef & { tier: number }>();

export function defineItem(def: ItemDef) {
  const d = { ...def, tier: REG.length };
  REG.push(d);
  BY_ID.set(def.id, d);
  return d;
}
export const itemDef = (id: string) => BY_ID.get(id)!;
export const itemList = (): readonly ItemDef[] => REG;

const ahead = (w: World, k: Kart) => (k.rank > 0 ? kartById(w, w.ranked[k.rank - 1]!) : undefined);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// ---- the 15 legacy items (behavior identical to legacy/jp-kart.html `useItem`) ----
defineItem({ id: 'bocina', name: 'Bocina de Confusión', w: 100, role: 'caos', aiQuick: false,
  use(w, k) { for (const o of w.karts) if (o !== k && dist(o, k) < 160) o.scare = 1.2; } });
defineItem({ id: 'falsa', name: 'Mancha de Aceite Falsa', w: 85, role: 'trampa',
  use(w, k) { const p = behind(k, 14); w.fakes.push({ ...p, z: hAt(w.track, p.x, p.y), owner: k.id, age: 0, cdn: 0 }); } });
defineItem({ id: 'goma', name: 'Parachoques de Goma', w: 70, role: 'defensa', aiQuick: true,
  use(_w, k) { k.goma = 15; } });
defineItem({ id: 'ciego', name: 'Proyectil Ciego', w: 55, role: 'ataque',
  use(w, k) {
    const v = Math.max(k.speed, 0) + 260;
    w.shots.push({ x: k.x + Math.cos(k.a) * 10, y: k.y + Math.sin(k.a) * 10, z: k.z + 3, vx: Math.cos(k.a) * v, vy: Math.sin(k.a) * v, owner: k.id, life: 3 });
  } });
defineItem({ id: 'burbuja', name: 'Escudo de Burbuja', w: 40, role: 'defensa', aiQuick: true,
  use(_w, k) { k.bubble = 1; } });
defineItem({ id: 'nitro', name: 'Inyector Nitro Básico', w: 30, role: 'movilidad',
  use(_w, k) { k.boost = Math.max(k.boost, 1.1); } });
defineItem({ id: 'alquitran', name: 'Charco de Alquitrán', w: 22, role: 'trampa',
  use(w, k) { const p = behind(k, 28); w.tars.push({ ...p, z: hAt(w.track, p.x, p.y), r: 26, life: 12 }); } });
defineItem({ id: 'dron', name: 'Dron Rastreador', w: 15, role: 'ataque', aiNotWhenFirst: true,
  use(w, k) {
    const t = ahead(w, k);
    w.rockets.push({ s: k.idx + 3, lat: lateral(w, k), owner: k.id, target: t ? t.id : -1, life: 6, x: k.x, y: k.y, z: k.z, t: 0 });
  } });
defineItem({ id: 'gancho', name: 'Gancho Electromagnético', w: 10, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) { const t = ahead(w, k); if (!t) return false; k.hookT = 3; k.hookTg = t.id; t.slowT = 3; } });
defineItem({ id: 'inversor', name: 'Inversor de Controles', w: 7, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    for (const o of w.karts) if (o.rank < k.rank && !o.finished && o.jug <= 0) o.inv = 5;
    emit(w, { type: 'flash', color: '#b84aff' });
  } });
defineItem({ id: 'pem', name: 'Rayo PEM', w: 5, role: 'caos',
  use(w, k) {
    for (const o of w.karts) if (o !== k && !o.finished && o.jug <= 0) { o.emp = 3; o.boost = 0; }
    emit(w, { type: 'flash', color: '#3df0ff' });
  } });
defineItem({ id: 'jugger', name: 'Blindaje de Juggernaut', w: 3, role: 'defensa', aiQuick: true,
  use(_w, k) { k.jug = 8; k.bubble = 0; } });
defineItem({ id: 'agujero', name: 'Agujero Negro Portátil', w: 2, role: 'caos', aiQuick: true,
  use(w, k) {
    w.holes.push({ x: k.x, y: k.y, z: k.z, t: 0 });
    const far = (o: { x: number; y: number }) => dist(o, k) > 500;
    w.fakes = w.fakes.filter(far);
    w.tars = w.tars.filter(far);
    w.shots = w.shots.filter((s) => s.owner === k.id || far(s));
    w.rockets = w.rockets.filter((s) => s.owner === k.id || far(s));
    for (const o of w.karts) if (o !== k && !far(o)) { o.bubble = 0; o.goma = 0; o.boost = 0; o.jug = 0; o.item = null; o.roll = 0; }
  } });
defineItem({ id: 'cuantico', name: 'Intercambio Cuántico', w: 1.2, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    const t = ahead(w, k);
    if (!t) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    for (const f of ['x', 'y', 'z', 'idx', 'prog', 'a', 'va', 'vz', 'air', 'glide'] as const) {
      const tmp = k[f];
      (k as any)[f] = t[f];
      (t as any)[f] = tmp;
    }
    emit(w, { type: 'flash', color: '#2ec46b' });
  } });
defineItem({ id: 'teleport', name: 'Teletransporte al 1º', w: 0.8, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) {
    const L = kartById(w, w.ranked[0]!);
    const tr = w.track;
    if (L && L !== k) {
      const i = (L.idx + 3) % tr.N;
      k.x = tr.x[i]!; k.y = tr.y[i]!; k.z = hAt(tr, k.x, k.y); k.idx = i; k.prog = L.prog + 3;
      k.a = k.va = tr.ang[i]!; k.air = false; k.glide = false; k.vz = 0;
      emit(w, { type: 'flash', color: '#ffd23a' });
    } else { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
  } });

/** Probability of each item: base weight × luck × position. None ever reaches 0 (legacy `itemWeights`). */
export function itemWeights(luck: number, rank: number, n: number): number[] {
  const b = n > 1 ? rank / (n - 1) : 0;
  return REG.map((it, i) => {
    const t = (2 * i) / (REG.length - 1);
    return it.w * Math.pow(luck / 5, t) * Math.pow(0.35 + 2.65 * b, t);
  });
}

export function rollItem(w: World, k: Kart, luck: number): string {
  const ws = itemWeights(luck, k.rank, w.karts.length);
  let tot = 0;
  for (const x of ws) tot += x;
  let r = w.rng.next() * tot;
  for (let i = 0; i < ws.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return REG[i]!.id;
  }
  return REG[0]!.id;
}

export function giveItem(w: World, k: Kart, it: string) {
  k.item = it;
  k.hold = 0;
  const Df = DIFFS[w.cfg.diff]!;
  k.useAt = w.rng.range(Df.item[0], Df.item[1]);
  emit(w, { type: 'itemGet', kart: k.id, item: it });
}

export function useItem(w: World, k: Kart) {
  const it = k.item;
  if (!it) return;
  k.item = null;
  k.hold = 0;
  const target = k.rank > 0 ? w.ranked[k.rank - 1] : undefined;
  const ok = itemDef(it).use(w, k) !== false;
  emit(w, { type: 'itemUse', kart: k.id, item: it, target, ok });
}

/** Legacy AI item usage (random timer) — replaced by aiScore in Phase 4. */
export function aiItemUse(w: World, k: Kart, dt: number) {
  if (!k.item || k.roll > 0 || k.finished || k.spin > 0) return;
  k.hold += dt;
  const it = itemDef(k.item);
  let use = k.hold > k.useAt;
  if (it.aiNotWhenFirst && k.rank === 0) use = false;
  if (it.aiQuick) use = k.hold > 0.5;
  if (it.id === 'ciego') {
    use = k.hold > 8;
    for (const o of w.karts) {
      if (o === k) continue;
      const dx = o.x - k.x, dy = o.y - k.y, d = Math.hypot(dx, dy);
      if (d < 260 && d > 20 && Math.abs(wrapA(Math.atan2(dy, dx) - k.a)) < 0.12) { use = true; break; }
    }
  }
  if (use) useItem(w, k);
}

export { isHuman };
