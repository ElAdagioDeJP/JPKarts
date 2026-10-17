// Item registry. Definitions live in core/src/items/<id>.ts (one file per item).
import { T } from '../tunables';
import { emit, isHuman } from './helpers';
import type { Kart, World } from './types';

export type ItemRole = 'ataque' | 'defensa' | 'movilidad' | 'caos' | 'trampa';

export interface ItemDef {
  id: string;
  name: string;
  /** legacy base weight; the odds that rule are the per-zone weights in items.json (`zones`) */
  w: number;
  role: ItemRole;
  /** AI: do not use while first */
  aiNotWhenFirst?: boolean;
  /** AI: use right after getting it */
  aiQuick?: boolean;
  /** AI: hold it until a rival is lined up in front */
  aiAim?: boolean;
  /** uses per pickup (Turbo Triple: 3) */
  charges?: number;
  /** never comes out of a box (only given by other items, e.g. a caught boomerang) */
  noRoll?: boolean;
  /** called when the kart receives it (orbiting shots...) */
  onGet?(w: World, k: Kart): void;
  /** Apply the item. Return false when it had no effect (e.g. nobody ahead). */
  use(w: World, k: Kart): void | false;
  /** AI desire to use it now, 0..1 (default by role: see ai/ai.ts defaultScore) */
  aiScore?(w: World, k: Kart): number;
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

/** Number of item zones (docs/V3_PLAN.md §2.5): 0 is the front of the field, 5 the back. */
export const ITEM_ZONES = 6;

/**
 * Zone of a kart: the larger of its zone by position (`floor(rank · 6 / n)`: 12 karts → 2 ranks per zone) and its zone by
 * distance to the leader in track units (`items.json → distZones`, ascending thresholds). A kart far behind gets the strong
 * items even if it is 3rd; the leader (distance 0) is always in zone 0.
 */
export function itemZone(rank: number, n: number, dist = 0): number {
  const byRank = n > 1 ? Math.min(ITEM_ZONES - 1, Math.floor((rank * ITEM_ZONES) / n)) : 0, D = T.items.distZones;
  let byDist = 0;
  for (let i = 0; i < D.length; i++) if (dist >= D[i]!) byDist = i;
  return Math.max(byRank, Math.min(ITEM_ZONES - 1, byDist));
}

/**
 * Weight of each item for a kart at `rank` of `n`, `dist` units behind the leader: one weight per zone (items.json `zones`,
 * 6 columns). 0 = never comes out there: the weak items stop at the 7th place, the strong ones only appear at the back.
 */
export function itemWeights(rank: number, n: number, dist = 0): number[] {
  const z = itemZone(rank, n, dist), Z = T.items.zones as Record<string, number[]>;
  return REG.map((it) => (it.noRoll ? 0 : Z[it.id]?.[z] ?? 0));
}

/**
 * Item distribution v2 (GDD §3.1): no high-tier item while the global cooldown runs, no repeats of
 * non-common items, the leader never gets strong items. Weights of excluded items become 0.
 */
export function rollItem(w: World, k: Kart): string {
  const DI = T.items.distribution;
  const lead = w.karts[w.ranked[0]!], dist = lead ? Math.max(0, lead.prog - k.prog) * T.items.sampleLen : 0;
  const ws = itemWeights(k.rank, w.karts.length, dist).map((x, i) => {
    const it = REG[i]!;
    if (w.highTierCD > 0 && it.tier >= DI.highTier) return 0;
    if (k.rank === 0 && it.tier > DI.firstMaxTier) return 0;
    if (k.lastItem === it.id && it.tier >= DI.noRepeatFromTier) return 0;
    return x;
  });
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
  const d = itemDef(it);
  k.item = it;
  k.itemN = d.charges ?? 1;
  k.hold = 0;
  k.lastItem = it;
  if (d.tier >= T.items.distribution.highTier && !d.noRoll) w.highTierCD = T.items.distribution.highTierCooldown;
  d.onGet?.(w, k);
  emit(w, { type: 'itemGet', kart: k.id, item: it });
}

export function useItem(w: World, k: Kart) {
  const it = k.item;
  if (!it) return;
  k.hold = 0;
  const target = k.rank > 0 ? w.ranked[k.rank - 1] : undefined;
  const ok = itemDef(it).use(w, k) !== false;
  // items with charges stay in hand until the last use (a use that did nothing keeps the charge)
  if (ok) k.itemN--;
  if (k.item === it && (k.itemN <= 0 || (!ok && !itemDef(it).charges))) { k.item = null; k.itemN = 0; }
  emit(w, { type: 'itemUse', kart: k.id, item: it, target, ok });
}

export { isHuman };
