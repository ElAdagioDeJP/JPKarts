import charactersJson from '../../data/characters.json';
export type StatKey = 'vel' | 'ace' | 'sue' | 'man' | 'pes' | 'vue';
export type Stats = Record<StatKey, number>;

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
}

export interface Character extends CharacterDef {
  spd: number;
  acl: number;
  hnd: number;
  luck: number;
  w: number;
  fly: number;
  desc: string;
  weightClass: 'ligero' | 'medio' | 'pesado';
}

export const STAT_NAMES: Record<StatKey, string> = { vel: 'Velocidad', ace: 'Aceleración', sue: 'Suerte', man: 'Manejo', pes: 'Peso', vue: 'Vuelo' };
export const STAT_SHORT: Record<StatKey, string> = { vel: 'Veloc.', ace: 'Acel.', sue: 'Suerte', man: 'Manejo', pes: 'Peso', vue: 'Vuelo' };

// Characters are data: core/data/characters.json
const DEFS = charactersJson as CharacterDef[];

export function autoDesc(s: Stats): string {
  const e = (Object.entries(s) as [StatKey, number][]).filter(([k]) => k !== 'pes');
  e.sort((a, b) => b[1] - a[1]);
  return 'Fuerte en ' + STAT_NAMES[e[0]![0]].toLowerCase() + ', flojo en ' + STAT_NAMES[e[e.length - 1]![0]].toLowerCase() + '.';
}

export const CHARS: Character[] = DEFS.map((c) => {
  const s = c.st;
  return {
    ...c,
    spd: 0.85 + s.vel * 0.03,
    acl: 0.75 + s.ace * 0.05,
    hnd: 0.8 + s.man * 0.04,
    luck: s.sue,
    w: s.pes,
    fly: s.vue,
    desc: autoDesc(s),
    weightClass: s.pes < 5 ? 'ligero' : s.pes >= 8 ? 'pesado' : 'medio',
  };
});
