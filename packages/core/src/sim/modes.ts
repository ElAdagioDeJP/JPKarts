// Game modes as rules: { endCondition, scoring }. Adding a mode = one defineMode() call.
import { POINTS } from '../data/tracks';
import { isHuman } from './helpers';
import type { KartId, World } from './types';

export interface ModeDef {
  id: string;
  name: string;
  /** true when the race is over (the world then waits `finishDelay` and shows results) */
  endCondition(w: World): boolean;
  /** points per kart for the final order (cup modes) */
  scoring?(w: World, order: KartId[]): Map<KartId, number>;
}

const REG = new Map<string, ModeDef>();
export function defineMode(d: ModeDef) { REG.set(d.id, d); return d; }
export function modeOf(w: World): ModeDef {
  const m = REG.get(w.cfg.mode ?? 'race');
  if (!m) throw new Error('Modo desconocido: ' + w.cfg.mode);
  return m;
}
export const modeList = () => [...REG.values()];

/** Everyone we watch (the humans, or all karts if there are none) crossed the line. */
const watchedFinished = (w: World) => {
  const humans = w.karts.filter(isHuman), watch = humans.length ? humans : w.karts;
  return watch.every((k) => k.finished);
};

defineMode({ id: 'race', name: 'Carrera', endCondition: watchedFinished });
defineMode({
  id: 'cup', name: 'Copa', endCondition: watchedFinished,
  scoring(_w, order) { return new Map(order.map((id, i) => [id, POINTS[i] ?? 0])); },
});
