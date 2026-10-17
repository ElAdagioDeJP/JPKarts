// Banda sonora por pista: cada pista suena distinta en 10 s (firma de eventos del
// secuenciador puro), determinista, tempo ×1.06 en última vuelta, la banda grabada se comprueba en el último test.
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { DRUM_BY_STYLE, SONGS, motifForTrack, scoreStep, type DrumKitId, type Motif } from '../src/audio/audio';
import { ALL_TRACKS, AUTHORED } from '../../core/src/index';
import { songFile } from '../src/audio/songs';

interface TrackSong { id: string; song: keyof typeof SONGS; mul: number; drums: DrumKitId }
function trackSongs(): TrackSong[] {
  const out: TrackSong[] = [];
  for (const t of ALL_TRACKS as unknown as Record<string, unknown>[]) {
    if (typeof t['song'] === 'string' && typeof t['id'] === 'string') {
      const th = t['th'] as { style?: string } | undefined;
      const theme = t['theme'] as string | undefined;
      const style = th?.style ?? theme ?? 'grass';
      out.push({ id: t['id'] as string, song: t['song'] as keyof typeof SONGS, mul: (t['mul'] as number) ?? 1, drums: DRUM_BY_STYLE[style] ?? 'base' });
    }
  }
  for (const a of AUTHORED) {
    if (!out.some((t) => t.id === a.id) && a.song) {
      const style = (a as unknown as Record<string, unknown>)['theme'] as string ?? 'grass';
      out.push({ id: a.id, song: a.song as keyof typeof SONGS, mul: a.mul ?? 1, drums: DRUM_BY_STYLE[style] ?? 'base' });
    }
  }
  return out;
}

/** Firma de 10 s: eventos kind@midi@tiempo del secuenciador (sin AudioContext). */
function signature(ts: TrackSong, lastLap: boolean, seconds = 10, intensity = 0.7): string[] {
  const motif: Motif = { ...motifForTrack(ts.id), drums: ts.drums };
  const mul = ts.mul * (lastLap ? 1.06 : 1);
  const S = SONGS[ts.song], sd = 60 / (S.bpm * mul) / 4;
  const n = Math.floor(seconds / sd), evs: string[] = [];
  for (let s = 0; s < n; s++)
    for (const e of scoreStep(ts.song, motif, mul, s, intensity))
      evs.push(`${(s * sd + e.dt).toFixed(2)}|${e.kind}|${e.midi}|${e.dur.toFixed(3)}`);
  return evs;
}

function similarity(a: string[], b: string[]): number {
  const ca = new Map<string, number>(), cb = new Map<string, number>();
  for (const e of a) ca.set(e, (ca.get(e) ?? 0) + 1);
  for (const e of b) cb.set(e, (cb.get(e) ?? 0) + 1);
  let inter = 0, union = 0;
  for (const [k, v] of ca) { const w = cb.get(k) ?? 0; inter += Math.min(v, w); union += Math.max(v, w); }
  for (const [k, v] of cb) if (!ca.has(k)) union += v;
  return union ? inter / union : 1;
}

const TRACKS = trackSongs();

test('toda pista con canción tiene firma de 10 s distinta (blind test)', () => {
  expect(TRACKS.length).toBeGreaterThan(20);
  const sigs = TRACKS.map((t) => ({ id: t.id, sig: signature(t, false) }));
  let worst = { a: '', b: '', sim: 0 };
  for (let i = 0; i < sigs.length; i++)
    for (let j = i + 1; j < sigs.length; j++) {
      const s = similarity(sigs[i]!.sig, sigs[j]!.sig);
      expect(s).toBeLessThan(1); // ninguna idéntica
      if (s > worst.sim) worst = { a: sigs[i]!.id, b: sigs[j]!.id, sim: s };
    }
  console.log(`pistas: ${sigs.length}, par más cercano: ${worst.a} ↔ ${worst.b} (${(worst.sim * 100).toFixed(1)}% común)`);
  expect(worst.sim).toBeLessThan(0.9);
}, 60000);

test('firma determinista + identidad estable del motif', () => {
  const t = TRACKS[0]!;
  expect(signature(t, false).join()).toBe(signature(t, false).join());
  const m1 = motifForTrack(t.id), m2 = motifForTrack(t.id);
  expect(m1).toEqual(m2);
  expect(m1.transpose).toBeGreaterThanOrEqual(-5);
  expect(m1.transpose).toBeLessThanOrEqual(6);
  expect(m1.seed).toBeGreaterThan(0);
});

test('última vuelta: mismos eventos, tempo ×1.06', () => {
  const t = TRACKS.find((x) => x.id === 'pradera-jp') ?? TRACKS[0]!;
  const motif: Motif = { ...motifForTrack(t.id), drums: t.drums };
  const seq = (mul: number) => {
    const S = SONGS[t.song], sd = 60 / (S.bpm * mul) / 4, out: string[] = [];
    for (let s = 0; s < 128; s++)
      for (const e of scoreStep(t.song, motif, mul, s, 0.7))
        out.push(`${(s * sd + e.dt).toFixed(3)}|${e.kind}|${e.midi}`);
    return out;
  };
  const base = seq(t.mul), last = seq(t.mul * 1.06);
  const strip = (s: string[]) => s.map((e) => { const p = e.split('|'); return p[1] + '|' + p[2]; }).join();
  expect(strip(last)).toBe(strip(base)); // mismo qué
  const tend = (s: string[]) => Number(s[s.length - 1]!.split('|')[0]);
  const ratio = tend(base) / tend(last); // comprimido ×1.06
  expect(ratio).toBeGreaterThan(1.04);
  expect(ratio).toBeLessThan(1.08);
});

test('banda grabada: cada pista y pantalla tiene su canción (ogg + m4a) y la síntesis queda de respaldo', () => {
  const dir = new URL('../public/music/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as Record<string, { ogg: number; m4a: number; loop: boolean }>;
  const need = new Set<string>(['menu', 'tutorial', 'results', 'victory', 'defeat']);
  for (const t of ALL_TRACKS as unknown as { id: string }[]) need.add(songFile(t.id));
  for (const id of need) {
    expect(index[id], id).toBeDefined();
    expect(existsSync(new URL(id + '.ogg', dir)) && existsSync(new URL(id + '.m4a', dir)), id).toBe(true);
    expect(index[id]!.ogg).toBeLessThan(1.5 * 1024 * 1024);
  }
  expect(index['victory']!.loop || index['defeat']!.loop).toBe(false);
  expect(typeof SONGS.sol.bpm).toBe('number'); // el secuenciador sintético sigue ahí como respaldo
});
