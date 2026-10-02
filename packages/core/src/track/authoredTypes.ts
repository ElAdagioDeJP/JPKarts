// Authored track format (docs/GDD.md §6.1). Tracks are JSON files in core/data/tracks/.
import type { SongId } from '../data/tracks';
import type { Theme, ThemeStyle } from '../data/themes';
import type { SurfaceKind } from './track';

/** Section types: the designer's vocabulary (GDD §6.2). */
export type SectionType = 'recta' | 'chicane' | 'horquilla' | 'curva-rapida' | 'salto' | 'riesgo' | 'atajo' | 'descanso' | 'climax';

export interface AuthoredTrackDef {
  id: string;
  name: string;
  cup: string;
  theme: ThemeStyle;
  themeOverrides?: Partial<Theme>;
  song: SongId;
  mul: number;
  /** world size (units): 2048 or 3072 */
  size: number;
  /** closed centerline (Catmull-Rom, centripetal). Point 0 is the start line. h = height, w = road half width */
  spline: { x: number; y: number; h: number; w: number }[];
  /** fractions of the lap (0..1) */
  sections: { from: number; to: number; type: SectionType; intent: string }[];
  walls: { from: number; to: number; side: 'izq' | 'der' | 'ambos' }[];
  surfaces: { from: number; to: number; kind: SurfaceKind; lat: [number, number] }[];
  /** shortcuts: leave the road at `from`, follow `via`, join again at `to` */
  branches: { from: number; to: number; via: { x: number; y: number; h: number }[]; w: number; needs?: string; risk?: string }[];
  itemRows: number[];
  pads: { at: number; lat: number }[];
  /** jump ramps on the road: a height bump; `big` gives a longer trick boost */
  ramps: { at: number; big?: boolean }[];
  /** gliding ramps (legacy "vuelo"): the Flight stat matters */
  flights?: number[];
  /** see sim/hazards.ts: crossers, sweepers, eruptions, rollers, trampolines, gates (laps = closed laps for gates) */
  hazards: { kind: string; at: number; period: number; warn: number; offset?: number; lat?: [number, number]; radius?: number; laps?: number[] }[];
  /** weather from a lap on (rain lowers grip) */
  weather?: { kind: 'lluvia' | 'niebla' | 'arena' | 'noche'; fromLap: number };
  /** the race goes from day to night */
  dayNight?: boolean;
  /** road narrowing per lap (snow): width multiplier for [from, to) */
  narrow?: { from: number; to: number; laps: Record<string, number> };
  /** water (sea with a shore, or lakes/lava where the ground is below the level) */
  water?: { kind?: 'agua' | 'lava' | 'rio'; base: number; laps: Record<string, number>; rate: number; fallDepth: number; puddleDepth: number; shore: [number, number][]; seaDepth: number };
  terrain: { seed: number; amp: number; base: number };
  /** cup metrics the validator enforces */
  metrics: { minHalfWidth: number; lapSeconds: [number, number] };
}
