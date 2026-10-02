// Phase 8 production tool: turns the 16 legacy procedural layouts into authored tracks (3072 world),
// then applies each track's gimmick from docs/GDD.md §6.4. Run once, then hand-tune the JSON with F3.
// Usage: bun packages/core/tools/convert-legacy.ts [legacyIndex...]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACK_DEFS, dhypot, prepTrack, wrapA } from '../src';
import type { AuthoredTrackDef, SectionType } from '../src/track/authoredTypes';

const CUP_OF = ['hoja', 'hoja', 'hoja', 'hoja', 'estrella', 'estrella', 'estrella', 'estrella', 'rayo', 'rayo', 'rayo', 'rayo', 'fuego', 'fuego', 'fuego', 'fuego'];
const WIDTH: Record<string, number> = { hoja: 50, estrella: 45, rayo: 41, fuego: 37 };
const LAP: Record<string, [number, number]> = { hoja: [50, 60], estrella: [50, 60], rayo: [50, 62], fuego: [50, 65] };
const SCALE = 1.38, OUT = join(import.meta.dir, '../data/tracks');

type H = AuthoredTrackDef['hazards'][number];
interface Gimmick {
  id: string;
  hazards?: (sec: Sec[], N: number) => H[];
  weather?: AuthoredTrackDef['weather'];
  dayNight?: boolean;
  narrow?: (sec: Sec[]) => AuthoredTrackDef['narrow'];
  surfaces?: (sec: Sec[]) => AuthoredTrackDef['surfaces'];
  water?: Partial<NonNullable<AuthoredTrackDef['water']>> & { kind: 'agua' | 'lava' | 'rio' };
  extraRamps?: number[];
  gateMain?: boolean;
}
interface Sec { from: number; to: number; type: SectionType; mid: number; curve: number }

const straights = (s: Sec[]) => s.filter((x) => x.type === 'recta' && x.to - x.from > 0.04);
const hairpins = (s: Sec[]) => s.filter((x) => x.type === 'horquilla');
const pickMid = (list: Sec[], k: number, fallback: number) => list[k % Math.max(1, list.length)]?.mid ?? fallback;

const GIMMICKS: Record<number, Gimmick> = {
  0: { id: 'pradera-jp', hazards: (s) => [{ kind: 'vaca', at: pickMid(straights(s), 1, 0.45), period: 11, warn: 1.5, lat: [90, -90] }] },
  2: { id: 'tenis-jp', hazards: (s) => [{ kind: 'pelota', at: pickMid(straights(s), 0, 0.3), period: 6, warn: 1.2, lat: [0, 0] }, { kind: 'pelota', at: pickMid(straights(s), 2, 0.7), period: 7, warn: 1.2, offset: 3, lat: [-18, -18] }] },
  3: { id: 'bosque-encantado', weather: { kind: 'niebla', fromLap: 1 }, hazards: (s) => [{ kind: 'seta', at: pickMid(straights(s), 0, 0.25), period: 0, warn: 0, lat: [24, 24] }, { kind: 'seta', at: pickMid(straights(s), 1, 0.6), period: 0, warn: 0, lat: [-26, -26] }] },
  4: { id: 'valle-molino', hazards: (s) => [{ kind: 'aspa', at: pickMid(straights(s), 0, 0.3), period: 3.2, warn: 0, lat: [0, 0], radius: 52 }, { kind: 'aspa', at: pickMid(straights(s), 2, 0.75), period: 4.1, warn: 0, lat: [0, 0], radius: 52, offset: 1.2 }] },
  5: { id: 'dunas-doradas', weather: { kind: 'arena', fromLap: 2 }, surfaces: (s) => s.filter((x) => x.type === 'curva-rapida').slice(0, 3).map((x) => ({ from: x.from, to: x.to, kind: 'arena' as const, lat: [20, 60] as [number, number] })) },
  6: { id: 'bahia-atardecer', dayNight: true, hazards: (s) => [{ kind: 'ola', at: pickMid(straights(s), 0, 0.4), period: 8, warn: 1.2, lat: [90, -70] }] },
  7: { id: 'glaciar-polar', hazards: (s) => [{ kind: 'pinguino', at: pickMid(straights(s), 0, 0.35), period: 10, warn: 1.5, lat: [-80, 80] }], surfaces: (s) => hairpins(s).slice(0, 2).map((x) => ({ from: x.from, to: x.to, kind: 'hielo' as const, lat: [-60, 60] as [number, number] })) },
  8: { id: 'ciudad-neon', hazards: (s) => [{ kind: 'auto', at: pickMid(straights(s), 0, 0.3), period: 6, warn: 1.2, lat: [-80, 80] }, { kind: 'auto', at: pickMid(straights(s), 1, 0.65), period: 7, warn: 1.2, lat: [80, -80], offset: 2 }], surfaces: (s) => straights(s).slice(1, 3).map((x) => ({ from: x.mid - 0.01, to: x.mid + 0.01, kind: 'charco' as const, lat: [-30, 0] as [number, number] })) },
  9: { id: 'selva-tropical', weather: { kind: 'lluvia', fromLap: 2 }, water: { kind: 'rio' }, surfaces: (s) => s.filter((x) => x.type === 'chicane').slice(0, 2).map((x) => ({ from: x.from, to: x.to, kind: 'barro' as const, lat: [-60, -8] as [number, number] })), hazards: (s) => [{ kind: 'roca', at: pickMid(straights(s), 1, 0.55), period: 9, warn: 1.5, lat: [10, 10] }] },
  10: { id: 'pico-nevado', hazards: (s) => [{ kind: 'bolanieve', at: pickMid(straights(s), 0, 0.4), period: 8, warn: 1.5, lat: [-12, -12] }], narrow: (s) => { const x = straights(s)[1] ?? s[2]!; return { from: x.from, to: x.to, laps: { '2': 0.8, '3': 0.62 } }; } },
  11: { id: 'estadio-central', gateMain: true, hazards: (s) => [{ kind: 'pelota', at: pickMid(straights(s), 0, 0.2), period: 5, warn: 1.2, lat: [12, 12] }] },
  12: { id: 'canon-rojo', hazards: (s) => [{ kind: 'tren', at: pickMid(straights(s), 0, 0.3), period: 12, warn: 1.8, lat: [-110, 110] }, { kind: 'roca', at: pickMid(straights(s), 2, 0.7), period: 8, warn: 1.5, lat: [-8, -8] }] },
  13: { id: 'autopista-laser', hazards: (s) => straights(s).slice(0, 3).map((x, i) => ({ kind: 'laser', at: x.mid, period: 4 + i, warn: 1.2, lat: [i % 2 ? -14 : 14, i % 2 ? -14 : 14] as [number, number], radius: 20, offset: i })) },
  14: { id: 'volcan-rugiente', water: { kind: 'lava', laps: { '2': 2.5, '3': 4.5 } }, hazards: (s) => [{ kind: 'geiser', at: pickMid(straights(s), 0, 0.3), period: 5, warn: 1.3, lat: [16, 16] }, { kind: 'geiser', at: pickMid(straights(s), 1, 0.7), period: 6, warn: 1.3, lat: [-16, -16], offset: 2 }] },
  15: { id: 'crater-ardiente', water: { kind: 'lava' }, hazards: (s) => [{ kind: 'meteoro', at: pickMid(straights(s), 0, 0.35), period: 4, warn: 1.5, lat: [-30, 30], radius: 22 }, { kind: 'meteoro', at: pickMid(straights(s), 1, 0.7), period: 5, warn: 1.5, lat: [-30, 30], radius: 22, offset: 2 }] },
};

function sections(ang: Float32Array, N: number): Sec[] {
  const curv = (i: number) => Math.abs(wrapA(ang[(i + 10) % N]! - ang[i]!));
  const typeAt = (i: number): SectionType => { const c = curv(i); return c > 0.9 ? 'horquilla' : c > 0.45 ? 'chicane' : c > 0.18 ? 'curva-rapida' : 'recta'; };
  const out: Sec[] = [];
  let start = 0, cur = typeAt(0);
  for (let i = 4; i <= N; i += 4) {
    const t = i < N ? typeAt(i) : 'fin' as SectionType;
    if (t !== cur) {
      if (i - start >= 16 || !out.length) out.push({ from: start / N, to: i / N, type: cur, mid: (start + i) / 2 / N, curve: curv(Math.floor((start + i) / 2) % N) });
      else out[out.length - 1]!.to = i / N;
      start = i; cur = t;
    }
  }
  return out;
}

/** Legacy `findBranches`: a straight cut between two far-apart track points that does not cross the road. */
function findShortcut(xs: number[], ys: number[], w: number): { i: number; j: number } | null {
  const N = xs.length;
  let best: { i: number; j: number; save: number } | null = null;
  for (let i = 25; i < N - 40; i += 3)
    for (let g = 40; g <= 170; g += 3) {
      const j = i + g;
      if (j > N - 22) break;
      const d = dhypot(xs[j]! - xs[i]!, ys[j]! - ys[i]!), save = g * 6 - d;
      if (d < 130 || d > 520 || save < 150 || save > 700) continue;
      if (best && best.save >= save) continue;
      let ok = true;
      const n = Math.ceil(d / 6);
      for (let s = 1; s < n && ok; s++) {
        const t = s / n, x = xs[i]! + (xs[j]! - xs[i]!) * t, y = ys[i]! + (ys[j]! - ys[i]!) * t;
        if (x < 120 || y < 120 || x > 3072 - 120 || y > 3072 - 120) ok = false;
        for (let k = 0; k < N && ok; k += 2) { if (Math.min(Math.abs(k - i), Math.abs(k - j)) < 18) continue; if (dhypot(xs[k]! - x, ys[k]! - y) < w * 2 + 20) ok = false; }
      }
      if (ok) best = { i, j, save };
    }
  return best;
}

function convert(li: number) {
  const g = GIMMICKS[li];
  if (!g) return;
  const def = TRACK_DEFS[li]!, tr = prepTrack(def), N = tr.N, cup = CUP_OF[li]!, w = WIDTH[cup]!;
  const sx = (v: number) => 1536 + (v - 1024) * SCALE;
  const xs = Array.from(tr.x, sx), ys = Array.from(tr.y, sx);
  const step = Math.max(8, Math.round(N / 26));
  const spline: AuthoredTrackDef['spline'] = [];
  for (let i = 0; i < N; i += step) spline.push({ x: Math.round(xs[i]!), y: Math.round(ys[i]!), h: Math.round(tr.hc[i]! * 1.2 + 4), w });
  const sec = sections(tr.ang, N);
  const sc = findShortcut(xs, ys, w);
  const branches: AuthoredTrackDef['branches'] = [];
  if (sc) {
    const mx = (xs[sc.i]! + xs[sc.j]!) / 2, my = (ys[sc.i]! + ys[sc.j]!) / 2;
    branches.push({ from: (sc.i + 6) / N, to: (sc.j - 6) / N, via: [{ x: Math.round(mx), y: Math.round(my), h: Math.round((tr.hc[sc.i]! + tr.hc[sc.j]!) * 0.6 + 6) }], w: 22, risk: def.liquid ? 'agua' : undefined });
  }
  // walls: the outside of hairpins on the easy cups (forgiving), almost none on Fuego
  const walls: AuthoredTrackDef['walls'] = cup === 'fuego' ? [] : hairpins(sec).slice(0, cup === 'hoja' ? 4 : 2).map((x) => ({ from: x.from, to: x.to, side: 'ambos' as const }));
  walls.push({ from: 0.97, to: 0.05, side: 'ambos' });
  const hazards = g.hazards ? g.hazards(sec, N) : [];
  if (g.gateMain && sc) hazards.push({ kind: 'compuerta', at: (sc.i + (sc.j - sc.i) * 0.5) / N, period: 0, warn: 0, laps: [2], lat: [-w - 12, w + 12] });
  const { style: _style, ...overrides } = def.th;
  const a: AuthoredTrackDef = {
    id: g.id, name: def.name, cup, theme: def.th.style, themeOverrides: overrides, song: def.song, mul: def.mul, size: 3072,
    spline,
    sections: sec.map(({ from, to, type }) => ({ from: +from.toFixed(3), to: +to.toFixed(3), type, intent: INTENT[type] })),
    walls,
    surfaces: g.surfaces ? g.surfaces(sec) : [],
    branches,
    itemRows: [0.08, 0.35, 0.6, 0.85],
    pads: def.pads.map((f, i) => ({ at: f, lat: i % 2 ? 16 : -16 })),
    ramps: [...def.ramps.map((f) => ({ at: f })), ...(g.extraRamps ?? []).map((f) => ({ at: f, big: true }))],
    flights: def.flight ? pickFlightsAt(tr.flights, N) : [],
    hazards,
    weather: g.weather,
    dayNight: g.dayNight,
    narrow: g.narrow ? g.narrow(sec) : undefined,
    water: def.liquid || g.water ? { kind: g.water?.kind ?? (def.liquid?.kind === 'lava' ? 'lava' : def.liquid?.kind === 'river' ? 'rio' : 'agua'), base: 0.5, laps: g.water?.laps ?? {}, rate: 0.6, fallDepth: 1.5, puddleDepth: 99, shore: [], seaDepth: 0 } : undefined,
    terrain: { seed: def.seed, amp: def.tAmp, base: def.liquid || g.water ? -def.tAmp * 0.42 : 0 },
    metrics: { minHalfWidth: w - 2, lapSeconds: LAP[cup]! },
  };
  writeFileSync(join(OUT, g.id + '.json'), JSON.stringify(a, null, 2) + '\n');
  console.log(`${def.name}: ${spline.length} puntos, ${sec.length} secciones, atajo ${sc ? 'sí' : 'no'}, ${hazards.length} peligros`);
}

const INTENT: Record<string, string> = {
  recta: 'Recta: rebufo, cajas y adelantamientos',
  chicane: 'Chicane: enlazar curvas con precisión',
  horquilla: 'Horquilla: drift largo para el mini-turbo',
  'curva-rapida': 'Curva rápida: mantener la línea sin frenar',
  salto: 'Salto: truco para el turbo',
  riesgo: 'Riesgo: línea corta junto al peligro',
  atajo: 'Atajo con coste',
  descanso: 'Descanso',
  climax: 'Clímax',
};

const pickFlightsAt = (f: number[], N: number) => f.map((i) => +(i / N).toFixed(3));

const which = process.argv.slice(2).map(Number);
for (const li of which.length ? which : Object.keys(GIMMICKS).map(Number)) convert(li);
