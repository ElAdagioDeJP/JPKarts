import type { Rng } from '../math';
import type { Track } from '../track/track';

export type Ctrl = 'local' | 'remote' | 'ai';
export type KartId = number;

/** One tick of player input. `t` throttle -1..1, `s` steer -1..1, `d` drift held, `item` item button pressed this tick. */
export interface Input {
  t: number;
  s: number;
  d: boolean;
  item: boolean;
}
export const NO_INPUT: Readonly<Input> = Object.freeze({ t: 0, s: 0, d: false, item: false });

/** Inputs are quantized to 8 bits per axis (network/replay format). Same value on every peer. */
export function quantizeInput(i: Input | undefined): Input {
  if (!i) return { ...NO_INPUT };
  const q = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 127) / 127;
  return { t: q(i.t), s: q(i.s), d: !!i.d, item: !!i.item };
}

/** An active status effect on a kart. `data` is effect-specific (e.g. hook target id). */
export interface Fx {
  type: string;
  t: number;
  src: KartId;
  data: number;
}

export interface Kart {
  id: KartId;
  ch: number; // index into CHARS
  ctrl: Ctrl;
  x: number; y: number; z: number; vz: number;
  air: boolean; glide: boolean;
  a: number; va: number; speed: number;
  idx: number; prog: number;
  drift: number; dc: number; boost: number; spin: number; hop: number;
  item: string | null; roll: number;
  finished: boolean; time: number | null;
  lane: number; laneT: number; skill: number;
  hold: number; useAt: number;
  sv: number; backT: number; lastLap: number; rb: number; held: number;
  lapStart: number; best: number | null;
  respawn: number; off: number; rank: number; padT: number;
  fx: Fx[];
  lapFly: number;
}

/** Any world entity (projectile, trap, hazard). Flat numeric fields so it serializes trivially. */
export interface Ent {
  id: number;
  kind: string;
  x: number; y: number; z: number;
  owner: KartId; target: KartId;
  life: number; age: number; t: number;
  vx: number; vy: number;
  s: number; lat: number; r: number; cdn: number;
}
export interface BoxState { active: boolean; t: number }

export type Phase = 'countdown' | 'race' | 'results';

export type GameEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'rocketStart'; kart: KartId }
  | { type: 'flight'; kart: KartId }
  | { type: 'fall'; kart: KartId }
  | { type: 'shieldPop'; kart: KartId; offroad: boolean }
  | { type: 'driftStart'; kart: KartId }
  | { type: 'miniTurbo'; kart: KartId; level: 1 | 2 | 3 }
  | { type: 'jump'; kart: KartId }
  | { type: 'land'; kart: KartId; hard: boolean }
  | { type: 'pad'; kart: KartId }
  | { type: 'itemRoll'; kart: KartId }
  | { type: 'itemGet'; kart: KartId; item: string }
  | { type: 'itemUse'; kart: KartId; item: string; target?: KartId; ok: boolean }
  | { type: 'alreadyFirst'; kart: KartId }
  | { type: 'hit'; kart: KartId }
  | { type: 'bump'; a: KartId; b: KartId }
  | { type: 'smudge'; kart: KartId }
  | { type: 'lap'; kart: KartId; lap: number; final: boolean }
  | { type: 'finish'; kart: KartId; time: number }
  | { type: 'flash'; color: string }
  | { type: 'raceEnd' };

export interface RaceConfig {
  trackIndex: number;
  diff: number;
  seed: number;
  laps: number;
  /** game mode id (defineMode); default 'race' */
  mode?: string;
  /** grid order: character index + controller for each slot */
  grid: { ch: number; ctrl: Ctrl }[];
}

export interface World {
  cfg: RaceConfig;
  track: Track;
  rng: Rng;
  tick: number;
  karts: Kart[];
  ents: Ent[];
  nextEnt: number;
  boxes: BoxState[];
  pairCD: number[];
  raceT: number;
  phase: Phase;
  cd: number;
  cdLast: number;
  finishDelay: number;
  ranked: KartId[];
  finalOrder: KartId[];
  events: GameEvent[];
}
