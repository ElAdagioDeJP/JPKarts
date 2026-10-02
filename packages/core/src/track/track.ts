import { BW, HM, ROAD, TRACK_LEN, TS } from '../constants';
import type { AuthoredTrackDef } from './authoredTypes';
import { computeRacingLine, type RacingLine } from '../ai/line';
import type { TrackDef } from '../data/tracks';
import type { Theme } from '../data/themes';
import { clamp, lerp, mulberry, vnoise, wrapA } from '../math';
import { datan2, dcos, dexp, dhypot, dsin } from '../dmath';

export interface Pad { i: number; lat: number; x: number; y: number }
export interface Branch { i0: number; i1: number; x: number[]; y: number[]; h: number[]; n: number; w?: number }
export interface BoxSpot { x: number; y: number; z: number; c: number }
export type SurfaceKind = 'barro' | 'charco' | 'hielo' | 'arena';
/** Surface band along the track: samples [i0, i1) (wrapping), lateral range [lat0, lat1]. */
export interface SurfaceBand { i0: number; i1: number; lat0: number; lat1: number; kind: SurfaceKind }
/** Dynamic water (authored tracks): level per lap of the leader. */
export interface WaterSpec { base: number; laps: Record<number, number>; rate: number; fallDepth: number; puddleDepth: number }

/** A track: centerline samples (6 units apart) + baked heightfield. Pure data, no DOM. */
export interface Track {
  def: TrackDef;
  th: Theme;
  /** authored source (null for legacy procedural tracks) */
  authored: AuthoredTrackDef | null;
  /** world size in units and heightmap resolution (4 units per cell) */
  size: number;
  res: number;
  N: number;
  /** road half width per sample */
  wd: Float32Array;
  /** walls per sample: left (lateral < 0) / right (lateral > 0) */
  wallL: Uint8Array;
  wallR: Uint8Array;
  surfaces: SurfaceBand[];
  water: WaterSpec | null;
  x: Float32Array;
  y: Float32Array;
  ang: Float32Array;
  hc: Float32Array; // centerline height
  flights: number[];
  pads: Pad[];
  boxRows: number[];
  branches: Branch[];
  built: boolean;
  /** AI racing line (computed on build) */
  line?: RacingLine;
  /** custom bake (authored tracks); legacy tracks use buildTrack's procedural heightfield */
  bake?: (t: Track) => void;
  // baked (buildTrack)
  hm: Float32Array; // height
  dg: Float32Array; // distance to centerline
  wg: Float32Array; // road half width of the nearest sample
  liq: Uint8Array; // liquid cell
  ng: Float32Array; // ground noise (visual)
  boxes: BoxSpot[];
}

function resample6(pts: [number, number][]): [number[], number[]] {
  const SP = 6;
  const xs = [pts[0]![0]], ys = [pts[0]![1]];
  let px = pts[0]![0], py = pts[0]![1], need = SP;
  for (let i = 1; i <= pts.length; i++) {
    const q = pts[i % pts.length]!, dx = q[0] - px, dy = q[1] - py, L = dhypot(dx, dy);
    let pos = 0;
    while (L - pos >= need) {
      pos += need;
      xs.push(px + (dx / L) * pos);
      ys.push(py + (dy / L) * pos);
      need = SP;
    }
    need -= L - pos;
    px = q[0];
    py = q[1];
  }
  if (dhypot(xs[xs.length - 1]! - xs[0]!, ys[ys.length - 1]! - ys[0]!) < SP * 0.6) {
    xs.pop();
    ys.pop();
  }
  return [xs, ys];
}

function genLayout(seed: number, target: number): [number, number][] {
  const R = mulberry(seed * 9301 + 49297), M = 900, C = TS / 2, MARG = 130;
  for (let att = 0; att < 3000; att++) {
    const hs: [number, number, number][] = [];
    let tot = 0;
    const nh = 3 + ((R() * 3) | 0);
    for (let h = 0; h < nh; h++) {
      const k = 2 + ((R() * 6) | 0), a = 0.04 + R() * 0.2;
      hs.push([k, a, R() * 6.283]);
      tot += a;
    }
    if (tot > 0.7) continue;
    const ax = 0.8 + R() * 0.4, ay = 0.8 + R() * 0.4, rot = R() * 6.283;
    let pts: [number, number][] | null = [];
    const wp: number[][] = [];
    for (let q = 0; q < 2; q++) wp.push([0.1 + R() * 0.22, 1.5 + R() * 3, R() * 6.283, R() * 6.283]);
    for (let i = 0; i < M; i++) {
      const t = (i / M) * 6.283;
      let r = 1;
      for (const [k, a, p] of hs) r += a * dsin(k * t + p);
      if (r < 0.3) { pts = null; break; }
      let x = dcos(t) * r * ax, y = dsin(t) * r * ay;
      for (const w of wp) {
        const nx = x + w[0]! * dsin(y * w[1]! + w[2]!), ny = y + w[0]! * dsin(x * w[1]! + w[3]!);
        x = nx;
        y = ny;
      }
      pts.push([x * dcos(rot) - y * dsin(rot), x * dsin(rot) + y * dcos(rot)]);
    }
    if (!pts) continue;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (const [x, y] of pts) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    let sc = Math.min((TS - 2 * MARG) / (mxx - mnx), (TS - 2 * MARG) / (mxy - mny)), L = 0;
    for (let i = 0; i < M; i++) { const a = pts[i]!, b = pts[(i + 1) % M]!; L += dhypot(b[0] - a[0], b[1] - a[1]); }
    if (L * sc < target) continue;
    sc = Math.min(sc, target / L);
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
    const out = pts.map(([x, y]) => [C + (x - cx) * sc, C + (y - cy) * sc] as [number, number]);
    const [xs, ys] = resample6(out), N = xs.length;
    let ok = true;
    for (let i = 0; i < N && ok; i++) {
      const a0 = datan2(ys[(i + 1) % N]! - ys[i]!, xs[(i + 1) % N]! - xs[i]!);
      const a1 = datan2(ys[(i + 9) % N]! - ys[(i + 8) % N]!, xs[(i + 9) % N]! - xs[(i + 8) % N]!);
      if (Math.abs(wrapA(a1 - a0)) > 1.05) ok = false;
    }
    let tc = 0;
    for (let i = 0; i < N; i++) {
      const a0 = datan2(ys[(i + 1) % N]! - ys[i]!, xs[(i + 1) % N]! - xs[i]!);
      const a1 = datan2(ys[(i + 2) % N]! - ys[(i + 1) % N]!, xs[(i + 2) % N]! - xs[(i + 1) % N]!);
      tc += Math.abs(wrapA(a1 - a0));
    }
    if (tc < 19) ok = false;
    if (!ok) continue;
    const G = 64, cells = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const k = ((xs[i]! / G) | 0) * 100 + ((ys[i]! / G) | 0);
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(i);
    }
    for (let i = 0; i < N && ok; i++) {
      const cx0 = (xs[i]! / G) | 0, cy0 = (ys[i]! / G) | 0;
      for (let ox = -2; ox <= 2 && ok; ox++)
        for (let oy = -2; oy <= 2 && ok; oy++) {
          const l = cells.get((cx0 + ox) * 100 + cy0 + oy);
          if (!l) continue;
          for (const j of l) {
            let g = Math.abs(i - j);
            g = Math.min(g, N - g);
            if (g < 32) continue;
            if (dhypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!) < 120) { ok = false; break; }
          }
        }
    }
    if (ok) return out;
  }
  throw new Error('No se pudo generar el trazado (semilla ' + seed + ')');
}

function pickFlights(ang: Float32Array, N: number): number[] {
  const sc: [number, number][] = [];
  for (let i = 40; i < N - 110; i++) {
    let c = 0;
    for (let j = 0; j < 70; j++) c += Math.abs(wrapA(ang[(i + j + 1) % N]! - ang[(i + j) % N]!));
    sc.push([c, i]);
  }
  sc.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [, i] of sc) {
    if (out.every((o) => Math.abs(o - i) > 110)) {
      out.push(i);
      if (out.length === 4) break;
    }
  }
  return out.sort((a, b) => a - b);
}

/** Cheap part of a track (centerline). Legacy `prepTrack`. */
export function prepTrack(def: TrackDef): Track {
  const dense = genLayout(def.seed, TRACK_LEN);
  let [xs, ys] = resample6(dense);
  const N = xs.length, ang = new Float32Array(N);
  const calc = () => {
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N, b = (i - 1 + N) % N;
      ang[i] = datan2(ys[a]! - ys[b]!, xs[a]! - xs[b]!);
    }
  };
  calc();
  let bestI = 0, bestC = 1e9;
  for (let i = 0; i < N; i++) {
    let c = 0;
    for (let j = -70; j < 12; j++) { const p = (i + j + N) % N; c += Math.abs(wrapA(ang[(p + 1) % N]! - ang[p]!)); }
    if (c < bestC) { bestC = c; bestI = i; }
  }
  xs = xs.slice(bestI).concat(xs.slice(0, bestI));
  ys = ys.slice(bestI).concat(ys.slice(0, bestI));
  calc();
  const hc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let h = 0;
    for (const [a, k, p] of def.hills) h += a * 1.3 * dsin((2 * Math.PI * k * i) / N + p);
    for (const f of def.ramps) {
      const rh = 8;
      let d = i - Math.floor(f * N);
      if (d > N / 2) d -= N;
      if (d < -N / 2) d += N;
      h += rh * dexp(-(d / 4) * (d / 4)) * (d <= 0 ? 1 : Math.max(0, 1 - d / 3));
    }
    hc[i] = h;
  }
  const flights = def.flight ? pickFlights(ang, N) : [];
  for (const f of flights) for (let d = -6; d <= 2; d++) { const j = (f + d + N) % N; hc[j]! += 5 * dexp(-(d / 3) * (d / 3)); }
  for (let i = -40; i < 20; i++) { const j = (i + N) % N; hc[j]! *= clamp(Math.abs(i + 10) / 40, 0.25, 1); }
  if (def.liquid) {
    let mn = 1e9;
    for (const h of hc) mn = Math.min(mn, h);
    for (let i = 0; i < N; i++) hc[i]! += 8 - mn;
  }
  const x = Float32Array.from(xs), y = Float32Array.from(ys);
  const pads: Pad[] = [];
  for (const f of def.pads) { const i = Math.floor(f * N); pads.push({ i, lat: (i % 2 ? 1 : -1) * 16, x: 0, y: 0 }); }
  for (const f of def.ramps) { const i = (Math.floor(f * N) - 14 + N) % N; pads.push({ i, lat: 0, x: 0, y: 0 }); }
  for (const p of pads) { const a = ang[p.i]!; p.x = x[p.i]! - dsin(a) * p.lat; p.y = y[p.i]! + dcos(a) * p.lat; }
  const boxRows = [0.18, 0.43, 0.68, 0.9].map((f) => {
    let i = Math.floor(f * N);
    for (let g = 0; g < 200; g++) {
      if (flights.every((fl) => { const o = (i - fl + N) % N; return o > 95 && o < N - 8; })) break;
      i = (i + 5) % N;
    }
    return i;
  });
  const empty32 = new Float32Array(0);
  return {
    def, th: def.th, authored: null, size: TS, res: HM, N, wd: new Float32Array(N).fill(ROAD), wallL: new Uint8Array(N), wallR: new Uint8Array(N), surfaces: [], water: null,
    x, y, ang, hc, flights, pads, boxRows, branches: [], built: false,
    hm: empty32, dg: empty32, wg: empty32, liq: new Uint8Array(0), ng: empty32, boxes: [],
  };
}

/** Expensive part: heightfield, distance field, liquids, item boxes. Legacy `buildHeight` (+ boxes from `buildScenery`). */
export function buildTrack(tr: Track): Track {
  if (tr.built) return tr;
  if (tr.bake) { tr.bake(tr); tr.line = computeRacingLine(tr); tr.built = true; return tr; }
  const def = tr.def, N = tr.N, B = TS / 64;
  const bk: number[][] = Array.from({ length: B * B }, () => []);
  for (let i = 0; i < N; i++) {
    const bx = clamp((tr.x[i]! / 64) | 0, 0, B - 1), by = clamp((tr.y[i]! / 64) | 0, 0, B - 1);
    bk[by * B + bx]!.push(i);
  }
  const bp: [number, number, number][] = [];
  for (const b of tr.branches) for (let i = 0; i < b.n; i++) bp.push([b.x[i]!, b.y[i]!, b.h[i]!]);
  const hm = new Float32Array(HM * HM), dg = new Float32Array(HM * HM), liq = new Uint8Array(HM * HM), ng = new Float32Array(HM * HM);
  const R = mulberry(N * 31 + 7), nz = vnoise(R), bias = def.liquid ? -def.tAmp * 0.42 : 0;
  for (let gy = 0; gy < HM; gy++)
    for (let gx = 0; gx < HM; gx++) {
      const wx = gx * 4 + 2, wy = gy * 4 + 2, bx = (wx / 64) | 0, by = (wy / 64) | 0;
      let best = -1, bd = 1e12;
      for (let oy = -3; oy <= 3; oy++)
        for (let ox = -3; ox <= 3; ox++) {
          const cx = bx + ox, cy = by + oy;
          if (cx < 0 || cy < 0 || cx >= B || cy >= B) continue;
          for (const i of bk[cy * B + cx]!) {
            const dx = tr.x[i]! - wx, dy = tr.y[i]! - wy, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
          }
        }
      let d = best < 0 ? 999 : Math.sqrt(bd), hr = best < 0 ? 0 : tr.hc[best]!;
      for (const q of bp) {
        const dd = dhypot(q[0] - wx, q[1] - wy) + (ROAD - BW);
        if (dd < d) { d = dd; hr = q[2]; best = best < 0 ? 0 : best; }
      }
      let tn = def.tAmp * (0.55 * nz(wx, wy, 150) + 0.3 * nz(wx + 500, wy, 60) + 0.15 * nz(wx, wy + 500, 24)) + bias;
      const e = Math.max(0, 1 - Math.min(wx, wy, TS - wx, TS - wy) / 90);
      tn += e * e * 120;
      let s = clamp((d - (ROAD + 12)) / 100, 0, 1);
      s = s * s * (3 - 2 * s);
      let h = best < 0 ? tn : lerp(hr, tn, s);
      const i = gy * HM + gx;
      if (def.liquid && h < 0.5 && d > ROAD + 14) { h = 0; liq[i] = 1; }
      hm[i] = h;
      dg[i] = d;
      ng[i] = 0.6 * nz(wx + 900, wy + 300, 40) + 0.4 * nz(wx + 100, wy + 700, 13);
    }
  tr.hm = hm;
  tr.dg = dg;
  tr.wg = new Float32Array(HM * HM).fill(ROAD);
  tr.liq = liq;
  tr.ng = ng;
  placeBoxes(tr);
  tr.line = computeRacingLine(tr);
  tr.built = true;
  return tr;
}

/** Item boxes: 2 per shortcut + rows of 4 across the road. */
export function placeBoxes(tr: Track) {
  tr.boxes = [];
  for (const b of tr.branches) {
    const m = b.n >> 1, a = datan2(b.y[b.n - 1]! - b.y[0]!, b.x[b.n - 1]! - b.x[0]!);
    for (const l of [-9, 9]) {
      const x = b.x[m]! - dsin(a) * l, y = b.y[m]! + dcos(a) * l;
      tr.boxes.push({ x, y, z: hAt(tr, x, y), c: l > 0 ? 1 : 2 });
    }
  }
  for (const i of tr.boxRows) {
    const a = tr.ang[i]!;
    for (const l of [-27, -9, 9, 27]) {
      const x = tr.x[i]! - dsin(a) * l, y = tr.y[i]! + dcos(a) * l;
      tr.boxes.push({ x, y, z: hAt(tr, x, y), c: ((l + 27) / 18) | 0 });
    }
  }
}

export function hAt(tr: Track, x: number, y: number): number {
  const hm = tr.hm, HM = tr.res;
  let gx = x * 0.25 - 0.5, gy = y * 0.25 - 0.5;
  const M = HM - 1.001;
  gx = gx < 0 ? 0 : gx > M ? M : gx;
  gy = gy < 0 ? 0 : gy > M ? M : gy;
  const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, i = iy * HM + ix;
  const a = hm[i]!, b = hm[i + 1]!, c = hm[i + HM]!, d = hm[i + HM + 1]!, t = a + (b - a) * fx;
  return t + (c + (d - c) * fx - t) * fy;
}

export function liqAt(tr: Track, x: number, y: number): boolean {
  if (!tr.def.liquid) return false;
  const HM = tr.res, gx = clamp((x / 4) | 0, 0, HM - 1), gy = clamp((y / 4) | 0, 0, HM - 1);
  return tr.liq[gy * HM + gx] === 1;
}

export function dgAt(tr: Track, x: number, y: number): number {
  const HM = tr.res, gx = clamp((x / 4) | 0, 0, HM - 1), gy = clamp((y / 4) | 0, 0, HM - 1);
  return tr.dg[gy * HM + gx]!;
}

/** Road half width of the nearest centerline sample. */
export function wgAt(tr: Track, x: number, y: number): number {
  const HM = tr.res, gx = clamp((x / 4) | 0, 0, HM - 1), gy = clamp((y / 4) | 0, 0, HM - 1);
  return tr.wg[gy * HM + gx]!;
}

/** Signed lateral offset of (x, y) from sample i (> 0 = right of the driving direction). */
export function lateralAt(tr: Track, i: number, x: number, y: number): number {
  const a = tr.ang[i]!;
  return (x - tr.x[i]!) * -dsin(a) + (y - tr.y[i]!) * dcos(a);
}

/** Surface under (sample i, lateral lat), if any. */
export function surfaceAt(tr: Track, i: number, lat: number): SurfaceKind | null {
  for (const s of tr.surfaces) {
    const inRange = s.i0 <= s.i1 ? i >= s.i0 && i < s.i1 : i >= s.i0 || i < s.i1;
    if (inRange && lat >= s.lat0 && lat <= s.lat1) return s.kind;
  }
  return null;
}

/** Track cache: centerlines are cheap; heightfields are built on demand and the oldest ones are released. */
export class TrackCache {
  private all: Track[];
  private builtQ: Track[] = [];
  constructor(defs: (TrackDef | AuthoredTrackDef)[], prepAuthored?: (d: AuthoredTrackDef) => Track) {
    this.all = defs.map((d) => ('spline' in d ? prepAuthored!(d) : prepTrack(d)));
  }
  get(i: number): Track {
    return this.all[i]!;
  }
  get list(): readonly Track[] {
    return this.all;
  }
  ensureBuilt(i: number, keep: Track[] = []): Track {
    const t = this.all[i]!;
    if (t.built) return t;
    buildTrack(t);
    this.builtQ.push(t);
    while (this.builtQ.length > 3) {
      const o = this.builtQ.find((x) => x !== t && !keep.includes(x));
      if (!o) break;
      this.builtQ.splice(this.builtQ.indexOf(o), 1);
      o.built = false;
      const e = new Float32Array(0);
      o.hm = o.dg = o.ng = o.wg = e;
      o.liq = new Uint8Array(0);
      o.boxes = [];
    }
    return t;
  }
}
