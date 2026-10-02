import { CHARS } from '../data/characters';
import { dcos, dsin } from '../dmath';
import { T } from '../tunables';
import { hAt } from '../track/track';
import { addFx, effectDef, immune, removeFx } from './effects';
import type { GameEvent, Kart, KartId, World } from './types';

export const isHuman = (k: Kart) => k.ctrl !== 'ai';
export const charOf = (k: Kart) => CHARS[k.ch]!;
export const kartById = (w: World, id: KartId): Kart | undefined => (id >= 0 ? w.karts[id] : undefined);
export const emit = (w: World, e: GameEvent) => { w.events.push(e); };

/** The kart right ahead in the ranking (undefined when first). */
export const ahead = (w: World, k: Kart) => (k.rank > 0 ? kartById(w, w.ranked[k.rank - 1]!) : undefined);

export function behind(k: Kart, d: number) {
  return { x: k.x - dcos(k.a) * d, y: k.y - dsin(k.a) * d };
}

export function lateral(w: World, k: Kart): number {
  const tr = w.track, a = tr.ang[k.idx]!;
  return (k.x - tr.x[k.idx]!) * -dsin(a) + (k.y - tr.y[k.idx]!) * dcos(a);
}

export const groundAt = (w: World, x: number, y: number) => hAt(w.track, x, y);

export const OUCH = ['¡Ay!', '¡Uf!', '¡Auch!', '¡Ay, ay!'];

/** Show the "¡Ay!" label over a kart (`text` = index into OUCH). */
export function ouch(k: Kart, time: number, text: number) {
  addFx(k, 'ouch', time, -1, text);
}

/** Can this kart be hit right now? (immunity effects, spinning, respawning, post-hit invulnerability) */
export const canBeHit = (k: Kart) => !(immune(k, 'hit') || k.spin > 0 || k.respawn > 0 || k.invuln > 0);

/**
 * Hit a kart. `level`: 0 light (short spin, keeps half its speed), 1 normal, ≥2 strong (shields don't stop it).
 * Returns true when the kart actually got hit. Lightweights recover faster.
 */
export function hit(w: World, k: Kart, t: number, level = 1): boolean {
  if (!canBeHit(k)) return false;
  for (const f of [...k.fx]) {
    const d = effectDef(f.type);
    if (d?.absorbHit && d.absorbHit(w, k, f, Math.max(1, level))) return false;
  }
  const H = T.race.hit, DH = T.driving.hit, light = level === 0;
  const cls = CHARS[k.ch]!.weightClass === 'ligero' ? DH.lightClassMul : 1;
  k.spin = (light ? DH.lightSpin : t) * cls;
  k.spinK = light ? 1 : T.driving.spinDecay;
  if (light) k.speed *= DH.lightKeep;
  k.drift = 0; k.dc = 0; k.dLvl = 0; k.boost = 0; k.hop = H.hop; k.trick = false; k.slip = 0;
  for (const f of [...k.fx]) if (effectDef(f.type)?.cancelOnHit) removeFx(k, f.type);
  ouch(k, H.ouch, w.rng.int(OUCH.length));
  emit(w, { type: 'hit', kart: k.id });
  return true;
}
