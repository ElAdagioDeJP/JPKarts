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

/** Returns true when the kart actually got hit. Immunities and shields come from its effects. */
export function hit(w: World, k: Kart, t: number, level = 1): boolean {
  if (immune(k, 'hit') || k.spin > 0 || k.respawn > 0) return false;
  for (const f of [...k.fx]) {
    const d = effectDef(f.type);
    if (d?.absorbHit && d.absorbHit(w, k, f, level)) return false;
  }
  const H = T.race.hit;
  k.spin = t; k.drift = 0; k.dc = 0; k.boost = 0; k.hop = H.hop;
  for (const f of [...k.fx]) if (effectDef(f.type)?.cancelOnHit) removeFx(k, f.type);
  ouch(k, H.ouch, w.rng.int(OUCH.length));
  emit(w, { type: 'hit', kart: k.id });
  return true;
}
