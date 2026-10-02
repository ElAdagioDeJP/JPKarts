// Item registry. Definitions live in core/src/items/<id>.ts (one file per item).
import { DIFFS } from '../data/tracks';
import { datan2, dhypot, dpow } from '../dmath';
import { wrapA } from '../math';
import { T } from '../tunables';
import { emit, isHuman } from './helpers';
import type { Kart, World } from './types';

export type ItemRole = 'ataque' | 'defensa' | 'movilidad' | 'caos' | 'trampa';

export interface ItemDef {
  id: string;
  name: string;
  /** base weight (relative probability) */
  w: number;
  role: ItemRole;
  /** AI: do not use while first */
  aiNotWhenFirst?: boolean;
  /** AI: use right after getting it */
  aiQuick?: boolean;
  /** AI: hold it until a rival is lined up in front */
  aiAim?: boolean;
  /** Apply the item. Return false when it had no effect (e.g. nobody ahead). */
  use(w: World, k: Kart): void | false;
}

const REG: (ItemDef & { tier: number })[] = [];
const BY_ID = new Map<string, ItemDef & { tier: number }>();

export function defineItem(def: ItemDef) {
  const d = { ...def, tier: REG.length };
  REG.push(d);
  BY_ID.set(def.id, d);
  return d;
}
export const itemDef = (id: string) => {
  const d = BY_ID.get(id);
  if (!d) throw new Error('Objeto desconocido: ' + id);
  return d;
};
export const itemList = (): readonly (ItemDef & { tier: number })[] => REG;

/** Probability of each item: base weight × luck × position. None ever reaches 0. */
export function itemWeights(luck: number, rank: number, n: number): number[] {
  const W = T.items.weights, b = n > 1 ? rank / (n - 1) : 0;
  return REG.map((it, i) => {
    const t = (2 * i) / (REG.length - 1);
    return it.w * dpow(luck / W.luckRef, t) * dpow(W.posBase + W.posRange * b, t);
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
  const it = itemDef(k.item), I = T.items;
  let use = k.hold > k.useAt;
  if (it.aiNotWhenFirst && k.rank === 0) use = false;
  if (it.aiQuick) use = k.hold > I.aiQuickUse;
  if (it.aiAim) {
    use = k.hold > I.aiShotWait;
    for (const o of w.karts) {
      if (o === k) continue;
      const dx = o.x - k.x, dy = o.y - k.y, d = dhypot(dx, dy);
      if (d < I.aiShotRange && d > I.aiShotMin && Math.abs(wrapA(datan2(dy, dx) - k.a)) < I.aiShotCone) { use = true; break; }
    }
  }
  if (use) useItem(w, k);
}

export { isHuman };
