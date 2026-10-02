// Status effects: every timed state a kart can carry (shields, debuffs...) is data + a registered definition.
// Adding an effect = one defineEffect() call; the kart update only runs the generic pipeline.
import type { Ent, Fx, Input, Kart, World } from './types';

export interface SpeedCtx {
  w: World;
  k: Kart;
  inp: Input;
  base: number;
  max: number;
  dt: number;
}

export interface EffectDef {
  type: string;
  /** what this effect is (used by other effects' immunities) */
  tags: string[];
  /** tags this effect makes the kart immune to (e.g. juggernaut blocks 'control' and 'hit') */
  blocks?: string[];
  /** no timer: lasts until removed (shields) */
  permanent?: boolean;
  /** removed when the kart gets hit */
  cancelOnHit?: boolean;
  /** stage 1: modify the input (in registration order) */
  input?(k: Kart, inp: Input, fx: Fx, human: boolean): void;
  /** boost does nothing while this effect is active */
  noBoost?: boolean;
  /** stage 2: speed limit / acceleration. `order` < 30 runs before tar zones, ≥ 30 after */
  speed?: { order: number; apply(c: SpeedCtx, fx: Fx): void };
  /** incoming hit: return true when the hit is absorbed (the effect may remove itself) */
  absorbHit?(w: World, k: Kart, fx: Fx, level: number): boolean;
  /** collision radius multiplier */
  bumpScale?: number;
  /** on contact with another kart (before the weight push) */
  onBump?(w: World, self: Kart, other: Kart): void;
  /** on contact (after the weight push); `sign` = direction away from the other kart */
  bumpPush?(self: Kart, nx: number, ny: number, sign: number): void;
  /** hit the world border */
  onWorldBounds?(k: Kart): void;
  /** every tick on the ground, with the off-road level (0 road, 1 edge, 2 out) */
  onOffRoad?(w: World, k: Kart, off: number): void;
  /** a projectile is about to hit this kart: return true when the effect deflected it */
  onProjectile?(w: World, k: Kart, e: Ent): boolean;
}

const DEFS: EffectDef[] = [];
const BY_TYPE = new Map<string, EffectDef>();
export function defineEffect(d: EffectDef): EffectDef {
  DEFS.push(d);
  BY_TYPE.set(d.type, d);
  return d;
}
export const effectDefs = (): readonly EffectDef[] => DEFS;
export const effectDef = (t: string) => BY_TYPE.get(t);

export function fxOf(k: Kart, type: string): Fx | undefined {
  for (const f of k.fx) if (f.type === type) return f;
  return undefined;
}
export const hasFx = (k: Kart, type: string) => fxOf(k, type) !== undefined;
export const fxTime = (k: Kart, type: string) => fxOf(k, type)?.t ?? 0;

/** Is the kart immune to `tag` because of one of its active effects? */
export function immune(k: Kart, tag: string): boolean {
  for (const f of k.fx) if (BY_TYPE.get(f.type)?.blocks?.includes(tag)) return true;
  return false;
}

/** Apply (or refresh) an effect. Returns false when the kart is immune. Re-applying sets the new duration. */
export function addFx(k: Kart, type: string, t: number, src = -1, data = 0): boolean {
  const d = BY_TYPE.get(type);
  if (!d) throw new Error('Efecto desconocido: ' + type);
  for (const tag of d.tags) if (immune(k, tag)) return false;
  const f = fxOf(k, type);
  if (f) { f.t = t; f.src = src; f.data = data; }
  else k.fx.push({ type, t, src, data });
  return true;
}

export function removeFx(k: Kart, type: string) {
  const i = k.fx.findIndex((f) => f.type === type);
  if (i >= 0) k.fx.splice(i, 1);
}

/** Count down timed effects; expired ones are removed. */
export function tickFx(k: Kart, dt: number) {
  for (let i = k.fx.length - 1; i >= 0; i--) {
    const f = k.fx[i]!;
    if (BY_TYPE.get(f.type)?.permanent) continue;
    f.t -= dt;
    if (!(f.t > 0)) k.fx.splice(i, 1);
  }
}

/** Run a hook of every active effect, in registration order (deterministic). */
export function eachFx(k: Kart, fn: (d: EffectDef, f: Fx) => void) {
  for (const d of DEFS) {
    const f = fxOf(k, d.type);
    if (f) fn(d, f);
  }
}
