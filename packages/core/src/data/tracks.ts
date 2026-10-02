import { LIQ_LAVA, LIQ_RIVER, LIQ_WATER, th, type Liquid, type Theme } from './themes';

export type SongId = 'sol' | 'noche' | 'fuego' | 'brisa' | 'turbo' | 'menu';

/** Legacy procedural track definition (generated from a seed). */
export interface TrackDef {
  id: string;
  name: string;
  seed: number;
  th: Theme;
  hills: [number, number, number][];
  ramps: number[];
  pads: number[];
  tAmp: number;
  liquid: Liquid | null;
  flight?: boolean;
  song: SongId;
  mul: number;
}

export const TRACK_DEFS: TrackDef[] = [
  { id: 'pradera', name: 'Pradera JP', seed: 11, th: th('grass'), hills: [[10, 3, 0], [6, 7, 1.2]], ramps: [0.3, 0.62], pads: [0.12, 0.45, 0.8], tAmp: 40, liquid: null, song: 'sol', mul: 1 },
  { id: 'playa', name: 'Playa Coco', seed: 12, th: th('sand'), hills: [[6, 3, 0.3]], ramps: [0.55], pads: [0.2, 0.7], tAmp: 34, liquid: LIQ_WATER, song: 'brisa', mul: 1 },
  { id: 'tenis', name: 'Club de Tenis JP', seed: 19, th: th('clay'), hills: [[8, 2, 0.5], [4, 6, 1]], ramps: [0.4, 0.75], pads: [0.2, 0.6], tAmp: 22, liquid: null, song: 'sol', mul: 1.06 },
  { id: 'bosque', name: 'Bosque Encantado', seed: 47, th: th('grass', { ground: ['#3a8a4a', '#327a40', '#46985a'], sky: ['#1a1040', '#2a1a5a', '#4a2a7a', '#7a3a8a', '#b85a8a', '#e8908a'], fog: '#b86a8a', mt1: '#4a3a7a', mt2: '#3a2a60', hill: '#2a5a3a', sun: '#ffe0f0', stars: true, edge: '#c8a0e0', deco: ['purpletree', 'purpletree', 'mushroom', 'bush'], lm: ['mushroom', 'mushroom', 'purpletree', 'windmill'] }), hills: [[14, 3, 1], [8, 6, 0]], ramps: [0.5], pads: [0.25, 0.75], tAmp: 50, liquid: null, song: 'noche', mul: 0.92 },
  { id: 'molino', name: 'Valle Molino', seed: 49, th: th('grass', { sky: ['#2a3a8a', '#6a4aa0', '#c86a8a', '#ff9a6a', '#ffc080', '#ffe0a0'], fog: '#ffc890', sun: '#fff0c0', mt1: '#9a7ab8', mt2: '#7a5aa0', lm: ['windmill', 'windmill', 'windmill', 'barn', 'cow', 'cow'] }), hills: [[18, 2, 0.4], [8, 5, 1]], ramps: [], pads: [0.3], tAmp: 55, liquid: null, flight: true, song: 'sol', mul: 0.95 },
  { id: 'dunas', name: 'Dunas Doradas', seed: 67, th: th('dunes'), hills: [[16, 3, 0.5], [6, 7, 2]], ramps: [0.3, 0.78], pads: [0.55], tAmp: 45, liquid: null, song: 'fuego', mul: 0.9 },
  { id: 'bahia', name: 'Bahía Atardecer', seed: 84, th: th('sand', { sky: ['#3a2a7a', '#8a4a9a', '#e8607a', '#ff9a6a', '#ffc88a', '#ffe8b0'], fog: '#ffc8a0', sun: '#fff0c0', mt1: '#b85a7a', mt2: '#8a3a6a' }), hills: [[8, 3, 0.3]], ramps: [], pads: [0.4], tAmp: 34, liquid: LIQ_WATER, flight: true, song: 'brisa', mul: 0.94 },
  { id: 'glaciar', name: 'Glaciar Polar', seed: 90, th: th('snow'), hills: [[22, 2, 0.2], [8, 6, 1]], ramps: [0.62], pads: [0.15, 0.85], tAmp: 75, liquid: null, song: 'noche', mul: 0.85 },
  { id: 'neon', name: 'Ciudad Neón', seed: 94, th: th('grid'), hills: [[26, 3, 0], [10, 7, 1.5]], ramps: [0.25, 0.5, 0.8], pads: [0.1, 0.42, 0.65], tAmp: 18, liquid: null, song: 'turbo', mul: 1 },
  { id: 'selva', name: 'Selva Tropical', seed: 110, th: th('grass', { ground: ['#3a9a3a', '#328a34', '#48a848'], sky: ['#2a8a9a', '#3aa0b0', '#5ab8c0', '#8ad0c8', '#b8e8d0', '#e0f8e8'], fog: '#c0e8d8', hill: '#2a7a3a', mt1: '#3a8a6a', mt2: '#2a6a5a', edge: '#c8a060', post: 'stake', deco: ['palm', 'palm', 'fern', 'round'], lm: ['palm', 'palm', 'fern', 'fern', 'skull'] }), hills: [[12, 3, 0.8], [8, 6, 0.2]], ramps: [], pads: [0.2, 0.6], tAmp: 40, liquid: LIQ_RIVER, flight: true, song: 'brisa', mul: 1.12 },
  { id: 'pico', name: 'Pico Nevado', seed: 114, th: th('snow', { sky: ['#3a70d0', '#4a86e0', '#6aa0f0', '#8cbcff', '#b8d8ff', '#e0f0ff'], fog: '#d8ecff', aurora: false, sun: '#ffffff' }), hills: [[26, 2, 0.6], [10, 5, 1.4]], ramps: [], pads: [0.35], tAmp: 90, liquid: null, flight: true, song: 'noche', mul: 1.02 },
  { id: 'estadio', name: 'Estadio Central', seed: 122, th: th('clay', { sky: ['#05030f', '#0a0a2a', '#141a40', '#1e2a5a', '#2a3a70', '#3a4a80'], fog: '#2a3a70', sun: null, stars: true, ground: ['#b85a2a', '#a85026', '#c86632'], hill: '#1a2a3a', mt1: '#2a3a5a', mt2: '#1a2a4a', lm: ['stands', 'stands', 'stands', 'stands', 'bigball', 'net', 'net', 'umpire'] }), hills: [[10, 3, 0.2]], ramps: [0.3, 0.7], pads: [0.15, 0.5, 0.85], tAmp: 20, liquid: null, song: 'turbo', mul: 0.92 },
  { id: 'canon', name: 'Cañón Rojo', seed: 148, th: th('dunes', { ground: ['#c8643a', '#b85a34', '#d87044'], edge: '#8a3a20', road: '#6a4a44', road2: '#604038', sky: ['#8a3a4a', '#b84a4a', '#e0704a', '#f0905a', '#ffb070', '#ffd090'], fog: '#f0a070', mt1: '#b84a30', mt2: '#8a3020', hill: '#9a3a24', deco: ['rock', 'cactus', 'rock'], lm: ['pyramid', 'camel', 'skull'] }), hills: [[20, 3, 0.1], [8, 7, 1]], ramps: [], pads: [0.5], tAmp: 70, liquid: null, flight: true, song: 'fuego', mul: 1 },
  { id: 'laser', name: 'Autopista Láser', seed: 149, th: th('grid', { curbB: '#3dff8a', edge: '#3dff8a', line: '#3df0ff', ground: ['#0a1a1a', '#0d2020', '#102828'], sky: ['#000510', '#021020', '#04203a', '#063050', '#0a4060', '#105070'], fog: '#063050', post: ['neonpost', 'neonpost'] }), hills: [[30, 3, 0.5], [12, 8, 0]], ramps: [0.2, 0.45, 0.7, 0.9], pads: [0.1, 0.3, 0.55, 0.8], tAmp: 15, liquid: null, song: 'turbo', mul: 1.08 },
  { id: 'volcan', name: 'Volcán Rugiente', seed: 159, th: th('rock'), hills: [[20, 2, 1], [12, 5, 0.4]], ramps: [0.45], pads: [0.3, 0.72], tAmp: 60, liquid: LIQ_LAVA, song: 'fuego', mul: 1.08 },
  { id: 'crater', name: 'Cráter Ardiente', seed: 161, th: th('rock', { sky: ['#100408', '#200810', '#401018', '#702020', '#a03a20', '#d86a2a'] }), hills: [[16, 3, 0.3], [10, 6, 1]], ramps: [], pads: [0.5], tAmp: 70, liquid: LIQ_LAVA, flight: true, song: 'fuego', mul: 1.14 },
];

export interface Cup {
  id: string;
  name: string;
  tracks: number[];
  col: string;
}
export const CUPS: Cup[] = [
  // Phase 8: the authored tracks (ALL_TRACKS 16..31, see data/authoredTracks.ts) replace the procedural ones
  { id: 'hoja', name: 'Copa Hoja', tracks: [17, 16, 18, 19], col: '#2ec46b' },
  { id: 'estrella', name: 'Copa Estrella', tracks: [20, 21, 22, 23], col: '#ffe45e' },
  { id: 'rayo', name: 'Copa Rayo', tracks: [24, 25, 26, 27], col: '#3df0ff' },
  { id: 'fuego', name: 'Copa Fuego', tracks: [28, 29, 30, 31], col: '#ff6a2a' },
];
/** The 16 legacy procedural tracks, still playable in free races ("Clásicas"). */
export const CLASSIC_CUPS: Cup[] = [
  { id: 'hoja-c', name: 'Clásica Hoja', tracks: [0, 1, 2, 3], col: '#2ec46b' },
  { id: 'estrella-c', name: 'Clásica Estrella', tracks: [4, 5, 6, 7], col: '#ffe45e' },
  { id: 'rayo-c', name: 'Clásica Rayo', tracks: [8, 9, 10, 11], col: '#3df0ff' },
  { id: 'fuego-c', name: 'Clásica Fuego', tracks: [12, 13, 14, 15], col: '#ff6a2a' },
];
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export interface Difficulty {
  name: string;
  sk: [number, number];
  up: number;
  dn: number;
  item: [number, number];
}
export const DIFFS: Difficulty[] = [
  { name: 'Fácil', sk: [0.8, 0.87], up: 1.03, dn: 0.9, item: [3, 7] },
  { name: 'Normal', sk: [0.9, 0.96], up: 1.07, dn: 0.93, item: [1.5, 4] },
  { name: 'Difícil', sk: [0.99, 1.04], up: 1.12, dn: 0.97, item: [0.6, 2.5] },
];
