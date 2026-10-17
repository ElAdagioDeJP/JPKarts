import charactersJson from '../../data/characters.json';
import { T } from '../tunables';
/** Stats visibles (suman 25 por piloto). Las ocultas (mini-turbo, vuelo) se derivan. */
export type StatKey = 'vel' | 'ace' | 'pes' | 'man' | 'tra';
export type Stats = Record<StatKey, number>;

/**
 * Reservado para la futura variante estilo Mii (no usar todavía).
 * Cuando se haga el refactor Mii, el driver se generará desde estos slots
 * en vez de desde `helmet/skin/acc`: el rig MK7 ya está separado en
 * kart / cuerpo / cabeza para que el cambio sea solo la cabeza + proporciones.
 */
export interface MiiDef {
  skin?: string;
  hair?: string;
  hairStyle?: 'cap' | 'short' | 'long' | 'tuft' | 'none';
  hairCol?: string;
  eyeCol?: string;
  glasses?: boolean;
  beard?: boolean;
  favCol?: string;
}

/** Extensiones visuales estilo Mario Kart 7. Todo opcional: se deriva si falta. */
export interface Mk7Visual {
  suit?: string;
  glove?: string;
  boot?: string;
  /** iris de los ojos; por defecto marrón oscuro */
  eye?: string;
}

export interface CharacterDef {
  name: string;
  short: string;
  helmet: string;
  kart: string;
  skin: string;
  acc: 'mohawk' | 'none' | 'headphones' | 'tuft' | 'antenna' | 'glasses' | 'spikes' | 'cap';
  accCol: string;
  mouth: string;
  beard?: boolean;
  /** perilla (Henry); se dibuja con `beardCol` */
  goatee?: boolean;
  /** color de la barba/perilla; por defecto el castaño oscuro de siempre */
  beardCol?: string;
  voice: number;
  st: Stats;
  personality: 'agresivo' | 'defensivo' | 'oportunista' | 'equilibrado' | 'limpio' | 'caotico';
  suit?: string;
  glove?: string;
  boot?: string;
  eye?: string;
  /** Slot Mii futuro. Hoy siempre ausente; el código debe tolerarlo. */
  mii?: MiiDef;
}

export interface Character extends CharacterDef {
  spd: number;
  acl: number;
  hnd: number;
  w: number;
  /** multiplicador de agarre (tracción) */
  gripK: number;
  /** multiplicador de la penalización fuera de pista (menos = pierdes menos) */
  offK: number;
  /** stat oculta de mini-turbo 0-10 (inverso a la velocidad) */
  mt: number;
  /** multiplicadores de carga y duración del mini-turbo */
  mtCharge: number;
  mtTime: number;
  /** stat oculta de vuelo 0-10 (energía de planeo) */
  fly: number;
  desc: string;
  weightClass: 'ligero' | 'medio' | 'pesado';
  /** Resueltos estilo MK7 (nunca vacíos): el JSON puede omitirlos. */
  suit: string;
  glove: string;
  boot: string;
  eye: string;
  /** Escala visual chibi por clase (ligero 0.92 / medio 1 / pesado 1.08). Solo visual. */
  visualScale: number;
}

export const STAT_NAMES: Record<StatKey, string> = { vel: 'Velocidad', ace: 'Aceleración', pes: 'Peso', man: 'Manejo', tra: 'Tracción' };
export const STAT_SHORT: Record<StatKey, string> = { vel: 'Veloc.', ace: 'Acel.', pes: 'Peso', man: 'Manejo', tra: 'Tracc.' };
export const STAT_KEYS: StatKey[] = ['vel', 'ace', 'pes', 'man', 'tra'];

// Characters are data: core/data/characters.json
const DEFS = charactersJson as CharacterDef[];

export function autoDesc(s: Stats): string {
  const e = (Object.entries(s) as [StatKey, number][]).filter(([k]) => k !== 'pes');
  e.sort((a, b) => b[1] - a[1]);
  return 'Fuerte en ' + STAT_NAMES[e[0]![0]].toLowerCase() + ', flojo en ' + STAT_NAMES[e[e.length - 1]![0]].toLowerCase() + '.';
}

const clamp10 = (v: number) => Math.max(0, Math.min(10, v));

/** Fórmula de docs/V3_PLAN.md §2.1: de las 5 stats visibles salen los multiplicadores de física. Coeficientes en tunables/stats.json. */
export function deriveStats(s: Stats) {
  const K = T.stats;
  return {
    spd: (1 + (s.vel - 5) * K.vel) * K.speedGlobal,
    acl: 1 + (s.ace - 5) * K.ace,
    hnd: 1 + (s.man - 5) * K.man,
    w: s.pes,
    gripK: 1 + (s.tra - 5) * K.tra,
    offK: 1 - (s.tra - 5) * K.tra,
    mt: clamp10(K.mtBase - K.mtPerVel * s.vel),
    mtCharge: 1 + (clamp10(K.mtBase - K.mtPerVel * s.vel) - 5) * K.mtCharge,
    mtTime: 1 + (clamp10(K.mtBase - K.mtPerVel * s.vel) - 5) * K.mtTime,
    fly: clamp10(K.flyBase + (5 - s.pes) * K.flyPerWeight),
    weightClass: (s.pes < K.lightBelow ? 'ligero' : s.pes >= K.heavyFrom ? 'pesado' : 'medio') as 'ligero' | 'medio' | 'pesado',
  };
}

export const CHARS: Character[] = DEFS.map((c) => {
  const s = c.st;
  const { weightClass, ...d } = deriveStats(s);
  return {
    ...c,
    ...d,
    desc: autoDesc(s),
    weightClass,
    suit: c.suit ?? shadeHex(c.helmet, 0.72),
    glove: c.glove ?? '#fff7e0',
    boot: c.boot ?? '#3a2a3a',
    eye: c.eye ?? '#20306e',
    visualScale: weightClass === 'ligero' ? 0.92 : weightClass === 'pesado' ? 1.08 : 1,
  };
});

/** Recalcula las stats derivadas en sitio (tras cambiar tunables/stats.json en caliente o en herramientas de calibración). */
export function refreshChars(): void {
  for (const c of CHARS) Object.assign(c, deriveStats(c.st));
}

/** Sombreador hex puro (core no depende del client). Duplica pixel.shade. */
function shadeHex(h: string, f: number): string {
  const n = h.replace('#', '');
  const c = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(n.slice(i, i + 2), 16) * f)));
  return '#' + [c(0), c(2), c(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** ¿Este piloto usa cara Mii? Hoy siempre false; el rig lo tolera para el próximo refactor. */
export const isMii = (c: Character): boolean => !!c.mii?.skin;
