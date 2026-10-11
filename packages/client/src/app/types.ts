// App-wide shared types and constants (extracted from game.ts).
// This module must stay dependency-light: types + constants only, no Game import.
// New screens/modes import from here instead of reaching into Game.
import type { CUPS } from '@jpkart/core';
import { H0, RW } from '../render/world3d';
import { W, H } from '../ui/draw';
import { CameraRig } from '../feel/camera';

export type State =
  | 'title' | 'menu' | 'options' | 'controls' | 'lan' | 'online' | 'lobby'
  | 'select' | 'cup' | 'track' | 'loading' | 'race' | 'results'
  | 'podium' | 'standings' | 'final' | 'replay';

export type Mode = 'free' | 'cup' | 'timetrial' | 'elimination' | 'battle' | 'capture';

export const MODE_ID: Record<Mode, string> = {
  free: 'race', cup: 'cup', timetrial: 'timetrial',
  elimination: 'elimination', battle: 'battle', capture: 'capture',
};

export const isArena = (m: Mode) => m === 'battle' || m === 'capture';

/** Everything that exists once per local player (split screen). */
export interface PlayerView {
  localId: number;
  cam: { x: number; y: number; a: number; z: number; hz: number; f: number; roll: number };
  rig: CameraRig;
  banner: { t: string; life: number; big?: boolean } | null;
  incoming: { item: string; t: number } | null;
  posPop: number; lastRank: number; coinPop: number;
  itemPressed: boolean; driftLatch: boolean; driftHeldPrev: boolean;
  /** null = player 1 alone (every binding) */
  input: import('../input/players').PlayerInput | null;
}

export const newView = (): PlayerView => ({
  localId: -1,
  cam: { x: 0, y: 0, a: 0, z: 30, hz: H0, f: 320, roll: 0 },
  rig: new CameraRig(),
  banner: null, incoming: null,
  posPop: 0, lastRank: -1, coinPop: 0,
  itemPressed: false, driftLatch: false, driftHeldPrev: false,
  input: null,
});

/** Viewport of player i of n, in UI pixels (W × H): 2 = top/bottom, 3–4 = quadrants. */
export const uiRect = (i: number, n: number): [number, number, number, number] =>
  n <= 1 ? [0, 0, W, H]
  : n === 2 ? [0, i * (H / 2), W, H / 2]
  : [(i % 2) * (W / 2), (i >> 1) * (H / 2), W / 2, H / 2];

export const TEAM_COL = ['#ff5a6a', '#5aa8ff'];
export const TEAM_NAME = ['Rojo', 'Azul'];

export const MENUS: State[] = [
  'title', 'menu', 'options', 'controls', 'lan', 'online', 'lobby', 'select', 'cup', 'track',
];

export const CAM_H = 15, CAM_BACK = 34, ZMAX = 1000;
export const UIK = W / RW; // internal world px → UI px
export const DRIFT_COL = ['#fff7e0', '#3df0ff', '#ff8a1f', '#b84aff'];

export interface Pose { x: number; y: number; z: number; a: number }
export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; c: string; s: number; line?: boolean;
}
export interface CupState {
  def: (typeof CUPS)[number];
  race: number;
  pts: Record<number, number>;
  gain: Record<number, number>;
  committed: boolean;
}

/** Track select: what each authored track's gimmick is called. */
export const HAZARD_TAG: Record<string, string> = {
  ola: 'Olas', tren: 'Tren', vaca: 'Vacas', auto: 'Tráfico', pinguino: 'Pingüinos',
  aspa: 'Molinos', geiser: 'Géiseres', laser: 'Láseres', meteoro: 'Meteoritos',
  roca: 'Rocas', pelota: 'Pelotas gigantes', bolanieve: 'Bolas de nieve',
  seta: 'Setas saltarinas', compuerta: 'Compuertas',
};
export const WEATHER_TAG: Record<string, string> = {
  lluvia: 'Lluvia', niebla: 'Niebla', arena: 'Tormenta de arena', noche: 'Noche',
};
/** Banner when a track hazard warns near the local kart. */
export const HAZARD_WARN: Record<string, string> = {
  ola: '¡Ola!', tren: '¡Tren!', vaca: '¡Vacas!', auto: '¡Tráfico!',
  pinguino: '¡Pingüinos!', geiser: '¡Géiser!', laser: '¡Láser!',
  meteoro: '¡Meteorito!', roca: '¡Roca!', pelota: '¡Pelota!', bolanieve: '¡Bola de nieve!',
};
