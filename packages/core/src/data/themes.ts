export type ThemeStyle = 'grass' | 'sand' | 'dunes' | 'snow' | 'grid' | 'rock' | 'clay';
export type Strip = 'mount' | 'sea' | 'mesa' | 'ice' | 'city' | 'volcano';

/** Visual + physical theme of a track. Pure data: core reads grip/offMax/ice, client reads colors. */
export interface Theme {
  style: ThemeStyle;
  ground: [string, string, string];
  edge: string;
  curbA: string;
  curbB: string;
  road: string;
  road2: string;
  line: string;
  out: [string, string];
  sky: string[];
  fog: string;
  strip: Strip;
  mt1: string;
  mt2?: string;
  hill: string;
  snow?: string;
  sun: string | null;
  aurora?: boolean;
  stars?: boolean;
  deco: string[];
  lm: string[];
  post: string | string[];
  grip: number;
  offMax: number;
  ice?: boolean;
}

export const TH: Record<ThemeStyle, Theme> = {
  grass: { style: 'grass', ground: ['#5cbc4c', '#4fae44', '#68c858'], edge: '#e8d28a', curbA: '#ffffff', curbB: '#e8455a', road: '#6d6a7a', road2: '#63607a', line: '#f4f1ff', out: ['#4a9e3f', '#43923a'],
    sky: ['#3a70e0', '#4a86f0', '#6aa2ff', '#8cbcff', '#afd4ff', '#d4ecff'], fog: '#cce6ff', strip: 'mount', mt1: '#8b9ae0', mt2: '#6a7ec8', hill: '#3f8f4a', snow: '#ffffff', sun: '#fff7b0',
    deco: ['tree', 'tree', 'round', 'bush', 'bush'], lm: ['windmill', 'windmill', 'barn', 'cow', 'cow', 'cow'], post: 'fence', grip: 10, offMax: 62 },
  sand: { style: 'sand', ground: ['#f2d58a', '#ecce80', '#f8e0a0'], edge: '#fff2c8', curbA: '#ffffff', curbB: '#2ec4b6', road: '#8a7f86', road2: '#807580', line: '#ffffff', out: ['#2e9ee0', '#2a8fd0'],
    sky: ['#1e7ae0', '#2e8ef0', '#4aa8ff', '#7cc4ff', '#a8dcff', '#d4f0ff'], fog: '#d4f0ff', strip: 'sea', mt1: '#3f8fd0', mt2: '#2a70b0', hill: '#4fae5a', sun: '#ffffff',
    deco: ['palm', 'palm', 'rock', 'umbrella'], lm: ['lighthouse', 'umbrella', 'umbrella', 'surf', 'surf', 'bigball'], post: 'buoy', grip: 10, offMax: 70 },
  dunes: { style: 'dunes', ground: ['#e8c07a', '#dcb06a', '#f0cc88'], edge: '#c2703d', curbA: '#ffffff', curbB: '#ff8a1f', road: '#7a5f55', road2: '#6f554c', line: '#ffe9b8', out: ['#dcb068', '#d3a560'],
    sky: ['#d8506b', '#e8606b', '#ff7f66', '#ff9c6b', '#ffbd7f', '#ffd9a0'], fog: '#ffd9a0', strip: 'mesa', mt1: '#e08a66', mt2: '#c86a50', hill: '#c26a45', sun: '#fff0c0',
    deco: ['cactus', 'cactus', 'rock', 'palm'], lm: ['pyramid', 'pyramid', 'camel', 'camel', 'camel'], post: 'stake', grip: 10, offMax: 60 },
  snow: { style: 'snow', ground: ['#eef4ff', '#e2ebfb', '#f8fbff'], edge: '#9fc4e8', curbA: '#ffffff', curbB: '#3f7fe8', road: '#a8d8f0', road2: '#c8ecff', line: '#ffffff', out: ['#e2ebfb', '#d6e2f6'],
    sky: ['#141f55', '#1d2b6b', '#34479a', '#5b72c4', '#8aa3e0', '#c0d4f5'], fog: '#c0d4f5', strip: 'ice', mt1: '#b8c8ee', mt2: '#98acd8', hill: '#8fa6d8', snow: '#ffffff', sun: '#e8f4ff', aurora: true,
    deco: ['snowtree', 'snowtree', 'snowman', 'crystal'], lm: ['igloo', 'igloo', 'crystal', 'crystal', 'penguin', 'penguin', 'penguin'], post: 'iceblock', grip: 2.8, offMax: 66, ice: true },
  grid: { style: 'grid', ground: ['#1a1433', '#1d1638', '#221a40'], edge: '#3df0ff', curbA: '#1a1026', curbB: '#ff3df0', road: '#2a2440', road2: '#322b4c', line: '#ffe45e', out: ['#150f2a', '#1a1433'],
    sky: ['#05030f', '#0a0620', '#1a0f3a', '#2e1a5a', '#4a2a7a', '#7a3a9a'], fog: '#3a1f5a', strip: 'city', mt1: '#2a1f4a', hill: '#1a1433', sun: null,
    deco: ['building0', 'building1', 'building0', 'lamp', 'lamp2'], lm: ['billboard', 'billboard', 'billboard', 'building1'], post: ['neonpost', 'neonpost2'], grip: 11, offMax: 70 },
  rock: { style: 'rock', ground: ['#3a2a2e', '#33252a', '#44323a'], edge: '#6a3a2a', curbA: '#ffe45e', curbB: '#1a1026', road: '#4a4450', road2: '#423c48', line: '#ff8a1f', out: ['#ff5a1f', '#e8401a'],
    sky: ['#1a0810', '#2a0f1a', '#4a1420', '#7a2424', '#b0442a', '#e0703a'], fog: '#b0442a', strip: 'volcano', mt1: '#3a1f24', hill: '#2a1a1e', sun: null,
    deco: ['darkrock', 'deadtree', 'darkrock', 'obsidian'], lm: ['skull', 'skull', 'geyser', 'geyser', 'geyser', 'obsidian'], post: 'bollard', grip: 10, offMax: 58 },
  clay: { style: 'clay', ground: ['#d8703a', '#cc6632', '#e07c44'], edge: '#fff7e0', curbA: '#ffffff', curbB: '#2ec46b', road: '#3a6fb5', road2: '#3466aa', line: '#ffffff', out: ['#2e8a4a', '#287a42'],
    sky: ['#3a80e8', '#4a92f4', '#62a8ff', '#86c0ff', '#aad6ff', '#d0ecff'], fog: '#d0ecff', strip: 'mount', mt1: '#7a92d8', mt2: '#5a76c0', hill: '#3a8a4a', sun: '#fff7b0',
    deco: ['round', 'round', 'bush', 'umpire'], lm: ['stands', 'stands', 'stands', 'bigball', 'bigball', 'net', 'net', 'umpire'], post: 'windscreen', grip: 10, offMax: 62 },
};

export const th = (b: ThemeStyle, o: Partial<Theme> = {}): Theme => Object.assign({}, TH[b], o);

export interface Liquid {
  kind: 'water' | 'lava' | 'river';
  col: string;
  col2: string;
  col3: string;
  shore: string;
  msg: string;
}
export const LIQ_WATER: Liquid = { kind: 'water', col: '#2e9ee0', col2: '#2a8fd0', col3: '#58b8f0', shore: '#e8f8ff', msg: '¡Al agua!' };
export const LIQ_LAVA: Liquid = { kind: 'lava', col: '#ff5a1f', col2: '#e8401a', col3: '#ff8a2a', shore: '#ffd23a', msg: '¡A la lava!' };
export const LIQ_RIVER: Liquid = { kind: 'river', col: '#2a8a7a', col2: '#257a6c', col3: '#3aa892', shore: '#bfe8c0', msg: '¡Al río!' };
