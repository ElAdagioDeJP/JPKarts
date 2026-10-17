// Authored track format (docs/GDD.md §6.1). Tracks are JSON files in core/data/tracks/.
import type { SongId } from '../data/tracks';
import type { Theme, ThemeStyle } from '../data/themes';
import type { SurfaceKind } from './track';

export type RampKind = 'hop' | 'trick' | 'glide';

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
  /** coin lines (lat = fraction of the half width); default: one line after each item row */
  coins?: { at: number; lat: number; n?: number }[];
  pads: { at: number; lat: number }[];
  /**
   * Marked ramps on the road (V3-5). `kind`: 'hop' = a small jump (a trick gives a mini-turbo), 'trick' = a big jump (a trick gives
   * the long turbo), 'glide' = opens the wing at a guaranteed speed (the run-up to a chasm). Crossing one launches the kart.
   * Old files may carry `big` instead of `kind` (big → 'trick', else 'hop').
   */
  ramps: { at: number; kind?: RampKind; /** legacy */ big?: boolean }[];
  /**
   * Chasms (V3-5): the road is gone between `from` and `to` (fractions of the lap) and the ground drops `depth` units; walls of
   * height `wallH` flank it (and the approach), so there is no way around: the kart must glide across a `glide` ramp.
   */
  chasms?: { from: number; to: number; depth: number; wallH: number }[];
  /** gliding ramps (legacy "vuelo"): the Flight stat matters */
  flights?: number[];
  /** paraglider zones (fractions of the lap): entering fast on the ground opens the wing */
  glideZones?: { from: number; to: number }[];
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
