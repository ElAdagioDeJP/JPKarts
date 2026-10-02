// Game modes as rules: { endCondition, scoring }. Adding a mode = one defineMode() call.
import { POINTS } from '../data/tracks';
import { isHuman } from './helpers';
import type { Kart, KartId, World } from './types';

export interface ModeDef {
  id: string;
  name: string;
  /** true when the race is over (the world then waits `finishDelay` and shows results) */
  endCondition(w: World): boolean;
  /** prepare the world after it is created (starting coins, etc.) */
  setup?(w: World): void;
  /** false = no coins on the track (time trial) */
  trackCoins?: boolean;
  /** false = no item boxes (time trial) */
  itemBoxes?: boolean;
  /** rules that run every race tick, after the karts and entities (elimination) */
  tick?(w: World): void;
  /** laps for `players` karts (elimination: players − 1) */
  laps?(players: number): number;
  /** ranking order (default: race progress) */
  rank?(a: Kart, b: Kart): number;
  /** AI: a point to chase instead of the racing line (rivals, the flag), or null */
  aiTarget?(w: World, k: Kart): [number, number] | null;
  /** played on arenas (ALL_TRACKS entries with `arena`) instead of race tracks */
  arena?: boolean;
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
export const watchedFinished = (w: World) => {
  const humans = w.karts.filter(isHuman), watch = humans.length ? humans : w.karts;
  return watch.every((k) => k.finished);
};

defineMode({ id: 'race', name: 'Carrera', endCondition: watchedFinished });
defineMode({
  id: 'cup', name: 'Copa', endCondition: watchedFinished,
  scoring(_w, order) { return new Map(order.map((id, i) => [id, POINTS[i] ?? 0])); },
});
