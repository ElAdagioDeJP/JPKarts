import { CHARS } from '../data/characters';
import { hAt } from '../track/track';
import type { GameEvent, Kart, KartId, World } from './types';
import { dcos, dsin } from '../dmath';

export const isHuman = (k: Kart) => k.ctrl !== 'ai';
export const charOf = (k: Kart) => CHARS[k.ch]!;
export const kartById = (w: World, id: KartId): Kart | undefined => (id >= 0 ? w.karts[id] : undefined);
export const emit = (w: World, e: GameEvent) => { w.events.push(e); };

export function behind(k: Kart, d: number) {
  return { x: k.x - dcos(k.a) * d, y: k.y - dsin(k.a) * d };
}

export function lateral(w: World, k: Kart): number {
  const tr = w.track, a = tr.ang[k.idx]!;
  return (k.x - tr.x[k.idx]!) * -dsin(a) + (k.y - tr.y[k.idx]!) * dcos(a);
}

export const groundAt = (w: World, x: number, y: number) => hAt(w.track, x, y);

export const OUCH = ['¡Ay!', '¡Uf!', '¡Auch!', '¡Ay, ay!'];

/** Returns true when the kart actually got hit. Legacy `hit`. */
export function hit(w: World, k: Kart, t: number, level = 1): boolean {
  if (k.jug > 0 || k.spin > 0 || k.respawn > 0) return false;
  if (k.bubble && level <= 1) {
    k.bubble = 0;
    emit(w, { type: 'shieldPop', kart: k.id, offroad: false });
    return false;
  }
  k.spin = t; k.drift = 0; k.dc = 0; k.boost = 0; k.hookT = 0; k.hop = 0.25; k.ouch = 0.8;
  k.ouchT = w.rng.int(OUCH.length);
  emit(w, { type: 'hit', kart: k.id });
  return true;
}
