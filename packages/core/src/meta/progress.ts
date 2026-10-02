// Progression (docs/GDD.md §9): cup results per class, records per track and class, unlocks.
// Data only (ids and numbers). The client decides when to save and how to show it.
import { ALL_TRACKS } from '../data/authoredTracks';
import { CUPS } from '../data/tracks';
import type { SaveSchema } from './save';

/** Engine classes in unlock order. 'espejo' = 150cc on mirrored tracks. */
export const CLASSES = ['100', '150', 'espejo'] as const;
export type EngineClass = (typeof CLASSES)[number];
export const CLASS_NAMES: Record<EngineClass, string> = { '100': '100cc', '150': '150cc', espejo: 'Espejo' };
/** RaceConfig fields for a class. */
export const classCfg = (c: EngineClass) => ({ cc: c === '100' ? 100 : 150, mirror: c === 'espejo' });

export interface TrackRecord { lap: number | null; race: number | null; ch: number }
export interface Progress {
  version: number;
  /** best cup place (1 = gold) by `${cupId}:${class}` */
  cups: Record<string, number>;
  /** records by `${trackId}:${class}` */
  records: Record<string, TrackRecord>;
  /** races finished (any mode) */
  races: number;
}

export const PROGRESS_VERSION = 2;

/**
 * v1 (first format): `trophies` by cup id at 100cc ('oro' | 'plata' | 'bronce') and `bestLaps` by ALL_TRACKS index.
 * v2: places by cup and class, records keyed by track id (indices change when tracks are added).
 */
const MIGRATIONS: Record<number, (s: any) => any> = {
  0: () => ({ version: 1, trophies: {}, bestLaps: {} }),
  1: (s) => {
    const place: Record<string, number> = { oro: 1, plata: 2, bronce: 3 };
    const cups: Record<string, number> = {};
    for (const [id, t] of Object.entries(s.trophies ?? {})) if (place[t as string]) cups[`${id}:100`] = place[t as string]!;
    const records: Record<string, TrackRecord> = {};
    for (const [i, lap] of Object.entries(s.bestLaps ?? {})) {
      const id = ALL_TRACKS[Number(i)]?.id;
      if (id && typeof lap === 'number') records[`${id}:100`] = { lap, race: null, ch: 0 };
    }
    return { version: 2, cups, records, races: 0 };
  },
};

export const PROGRESS: SaveSchema<Progress> = {
  key: 'jpkart.progress',
  version: PROGRESS_VERSION,
  migrations: MIGRATIONS,
  fresh: () => ({ version: PROGRESS_VERSION, cups: {}, records: {}, races: 0 }),
  valid: (s) => !!s && typeof s.cups === 'object' && typeof s.records === 'object' && typeof s.races === 'number',
};

const podium = (p: Progress, cup: string, c: EngineClass) => (p.cups[`${cup}:${c}`] ?? 99) <= 3;
const gold = (p: Progress, cup: string, c: EngineClass) => p.cups[`${cup}:${c}`] === 1;

/** Copa Hoja is always open; each next cup opens with a podium in the previous one (any class). */
export function cupUnlocked(p: Progress, cupIndex: number, all = false): boolean {
  if (all || cupIndex <= 0) return true;
  const prev = CUPS[cupIndex - 1];
  return !!prev && CLASSES.some((c) => podium(p, prev.id, c));
}
/** 150cc: gold in the 4 cups at 100cc. Espejo: gold in the 4 cups at 150cc. */
export function classUnlocked(p: Progress, c: EngineClass, all = false): boolean {
  if (all || c === '100') return true;
  const need: EngineClass = c === '150' ? '100' : '150';
  return CUPS.every((cup) => gold(p, cup.id, need));
}

/** Store a cup result (keeps the best place). Returns what it unlocked, as texts for the client. */
export function recordCup(p: Progress, cupIndex: number, c: EngineClass, place: number): string[] {
  const before = { cups: CUPS.map((_, i) => cupUnlocked(p, i)), cls: CLASSES.map((x) => classUnlocked(p, x)) };
  const key = `${CUPS[cupIndex]!.id}:${c}`;
  p.cups[key] = Math.min(p.cups[key] ?? 99, place);
  const out: string[] = [];
  CUPS.forEach((cup, i) => { if (!before.cups[i] && cupUnlocked(p, i)) out.push(cup.name + ' desbloqueada'); });
  CLASSES.forEach((x, i) => { if (!before.cls[i] && classUnlocked(p, x)) out.push(CLASS_NAMES[x] + ' desbloqueado'); });
  return out;
}

/** Store a finished race. Returns which records it broke. */
export function recordRace(p: Progress, trackId: string, c: EngineClass, ch: number, lap: number | null, race: number | null): { lap: boolean; race: boolean } {
  p.races++;
  const key = `${trackId}:${c}`, r = (p.records[key] ??= { lap: null, race: null, ch });
  const res = { lap: false, race: false };
  if (lap != null && (r.lap == null || lap < r.lap)) { r.lap = lap; res.lap = true; }
  if (race != null && (r.race == null || race < r.race)) { r.race = race; r.ch = ch; res.race = true; }
  return res;
}

/** Ghost replay storage key for a track and class. */
export const ghostKey = (trackId: string, c: EngineClass) => `jpkart.ghost.${trackId}.${c}`;
