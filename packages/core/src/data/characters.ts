import charactersJson from '../../data/characters.json';
export type StatKey = 'vel' | 'ace' | 'man' | 'pes' | 'vue';
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
  acc: 'mohawk' | 'none' | 'headphones' | 'tuft' | 'antenna' | 'glasses' | 'spikes';
  accCol: string;
  mouth: string;
  beard?: boolean;
  voice: number;
  st: Stats;
  personality: 'agresivo' | 'defensivo' | 'oportunista' | 'equilibrado';
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

export const STAT_NAMES: Record<StatKey, string> = { vel: 'Velocidad', ace: 'Aceleración', man: 'Manejo', pes: 'Peso', vue: 'Vuelo' };
export const STAT_SHORT: Record<StatKey, string> = { vel: 'Veloc.', ace: 'Acel.', man: 'Manejo', pes: 'Peso', vue: 'Vuelo' };

// Characters are data: core/data/characters.json
const DEFS = charactersJson as CharacterDef[];

export function autoDesc(s: Stats): string {
  const e = (Object.entries(s) as [StatKey, number][]).filter(([k]) => k !== 'pes');
  e.sort((a, b) => b[1] - a[1]);
  return 'Fuerte en ' + STAT_NAMES[e[0]![0]].toLowerCase() + ', flojo en ' + STAT_NAMES[e[e.length - 1]![0]].toLowerCase() + '.';
}

export const CHARS: Character[] = DEFS.map((c) => {
  const s = c.st;
  const weightClass = s.pes < 5 ? 'ligero' : s.pes >= 8 ? 'pesado' : 'medio';
  return {
    ...c,
    spd: 0.85 + s.vel * 0.03,
    acl: 0.75 + s.ace * 0.05,
    hnd: 0.8 + s.man * 0.04,
    w: s.pes,
    fly: s.vue,
    desc: autoDesc(s),
    weightClass,
    suit: c.suit ?? shadeHex(c.helmet, 0.72),
    glove: c.glove ?? '#fff7e0',
    boot: c.boot ?? '#3a2a3a',
    eye: c.eye ?? '#20306e',
    visualScale: weightClass === 'ligero' ? 0.92 : weightClass === 'pesado' ? 1.08 : 1,
  };
});

/** Sombreador hex puro (core no depende del client). Duplica pixel.shade. */
function shadeHex(h: string, f: number): string {
  const n = h.replace('#', '');
  const c = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(n.slice(i, i + 2), 16) * f)));
  return '#' + [c(0), c(2), c(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** ¿Este piloto usa cara Mii? Hoy siempre false; el rig lo tolera para el próximo refactor. */
export const isMii = (c: Character): boolean => !!c.mii?.skin;
