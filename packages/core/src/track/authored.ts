// Authored tracks: JSON (spline + sections + walls + surfaces + shortcuts + water) → Track.
// Procedural noise is used ONLY for terrain detail and decoration, always seeded by the track.
import { datan2, dcos, dexp, dhypot, dsin } from '../dmath';
import { th as themeOf } from '../data/themes';
import type { TrackDef } from '../data/tracks';
import { LIQ_WATER } from '../data/themes';
import { clamp, lerp, mulberry, vnoise } from '../math';
import type { AuthoredTrackDef } from './authoredTypes';
import { type Branch, type Pad, type SurfaceBand, type Track, hAt, placeBoxes } from './track';

type P = { x: number; y: number; h: number; w: number };

/** Centripetal Catmull-Rom point between p1 and p2 (u in [0,1]). Only + − × ÷ √: deterministic. */
function cr(p0: P, p1: P, p2: P, p3: P, u: number): P {
  const knot = (a: P, b: P) => Math.sqrt(Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y))) || 1e-6;
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const L = (a: P, b: P, ta: number, tb: number) => {
    const k = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = { x: A1.x + (A2.x - A1.x) * ((t - t0) / (t2 - t0)), y: A1.y + (A2.y - A1.y) * ((t - t0) / (t2 - t0)) };
  const B2 = { x: A2.x + (A3.x - A2.x) * ((t - t1) / (t3 - t1)), y: A2.y + (A3.y - A2.y) * ((t - t1) / (t3 - t1)) };
  const C = { x: B1.x + (B2.x - B1.x) * ((t - t1) / (t2 - t1)), y: B1.y + (B2.y - B1.y) * ((t - t1) / (t2 - t1)) };
  // height and width follow a smoothstep between the two control points
  const s = u * u * (3 - 2 * u);
  return { x: C.x, y: C.y, h: lerp(p1.h, p2.h, s), w: lerp(p1.w, p2.w, s) };
}

/** Dense polyline through control points (closed or open), then resampled every `sp` units. */
export function splineSamples(pts: P[], closed: boolean, sp = 6, steps = 48): P[] {
  const n = pts.length, dense: P[] = [];
  const get = (i: number) => (closed ? pts[((i % n) + n) % n]! : pts[clamp(i, 0, n - 1)]!);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++)
    for (let s = 0; s < steps; s++) dense.push(cr(get(i - 1), get(i), get(i + 1), get(i + 2), s / steps));
  if (!closed) dense.push(pts[n - 1]!);
  // resample at constant spacing
  const out: P[] = [dense[0]!];
  let px = dense[0]!, need = sp;
  const total = closed ? dense.length : dense.length - 1;
  for (let i = 1; i <= total; i++) {
    const q = dense[i % dense.length]!, L = dhypot(q.x - px.x, q.y - px.y);
    let pos = 0;
    while (L - pos >= need) {
      pos += need;
      const k = pos / L;
      out.push({ x: px.x + (q.x - px.x) * k, y: px.y + (q.y - px.y) * k, h: lerp(px.h, q.h, k), w: lerp(px.w, q.w, k) });
      need = sp;
    }
    need -= L - pos;
    px = q;
  }
  if (closed && dhypot(out[out.length - 1]!.x - out[0]!.x, out[out.length - 1]!.y - out[0]!.y) < sp * 0.6) out.pop();
  return out;
}

const idxOf = (f: number, N: number) => ((Math.floor(f * N) % N) + N) % N;

/** Centerline part of an authored track (cheap). The heightfield is baked by `bakeAuthored`. */
export function prepAuthored(a: AuthoredTrackDef): Track {
  const S = splineSamples(a.spline, true);
  const N = S.length;
  const x = new Float32Array(N), y = new Float32Array(N), hc = new Float32Array(N), wd = new Float32Array(N), ang = new Float32Array(N);
  S.forEach((p, i) => { x[i] = p.x; y[i] = p.y; hc[i] = p.h; wd[i] = p.w; });
  for (let i = 0; i < N; i++) { const n1 = (i + 1) % N, p1 = (i - 1 + N) % N; ang[i] = datan2(y[n1]! - y[p1]!, x[n1]! - x[p1]!); }
  for (const r of a.ramps) {
    const c = idxOf(r.at, N), rh = r.big ? 12 : 8;
    for (let d = -10; d <= 4; d++) { const j = (c + d + N) % N; hc[j]! += rh * dexp(-(d / 4) * (d / 4)) * (d <= 0 ? 1 : Math.max(0, 1 - d / 3)); }
  }
  const wallL = new Uint8Array(N), wallR = new Uint8Array(N);
  for (const wl of a.walls) {
    const i0 = idxOf(wl.from, N), i1 = idxOf(wl.to, N);
    for (let i = i0; i !== i1; i = (i + 1) % N) { if (wl.side !== 'der') wallL[i] = 1; if (wl.side !== 'izq') wallR[i] = 1; }
  }
  const surfaces: SurfaceBand[] = a.surfaces.map((s) => ({ i0: idxOf(s.from, N), i1: idxOf(s.to, N), lat0: s.lat[0], lat1: s.lat[1], kind: s.kind }));
  const pads: Pad[] = a.pads.map((p) => { const i = idxOf(p.at, N), an = ang[i]!; return { i, lat: p.lat, x: x[i]! - dsin(an) * p.lat, y: y[i]! + dcos(an) * p.lat }; });
  const branches: Branch[] = a.branches.map((b) => {
    const i0 = idxOf(b.from, N), i1 = idxOf(b.to, N);
    const pts: P[] = [{ x: x[i0]!, y: y[i0]!, h: hc[i0]!, w: b.w }, ...b.via.map((v) => ({ ...v, w: b.w })), { x: x[i1]!, y: y[i1]!, h: hc[i1]!, w: b.w }];
    const bs = splineSamples(pts, false);
    return { i0, i1, x: bs.map((p) => p.x), y: bs.map((p) => p.y), h: bs.map((p) => p.h), n: bs.length, w: b.w };
  });
  const th = themeOf(a.theme, a.themeOverrides ?? {});
  const def: TrackDef = {
    id: a.id, name: a.name, seed: a.terrain.seed, th, hills: [], ramps: a.ramps.map((r) => r.at), pads: [], tAmp: a.terrain.amp,
    liquid: a.water ? LIQ_WATER : null, song: a.song, mul: a.mul,
  };
  const empty = new Float32Array(0), res = a.size / 4;
  const tr: Track = {
    def, th, authored: a, size: a.size, res, N, wd, wallL, wallR, surfaces,
    water: a.water ? { base: a.water.base, laps: Object.fromEntries(Object.entries(a.water.laps).map(([k, v]) => [Number(k), v])), rate: a.water.rate, fallDepth: a.water.fallDepth, puddleDepth: a.water.puddleDepth } : null,
    x, y, ang, hc, flights: [], pads, boxRows: a.itemRows.map((f) => idxOf(f, N)), branches, built: false,
    hm: empty, dg: empty, wg: empty, liq: new Uint8Array(0), ng: empty, boxes: [],
  };
  tr.bake = bakeAuthored;
  return tr;
}

/** Signed distance to the shore polyline: > 0 on land, < 0 in the sea (side of `seaRef`). */
function shoreDistance(shore: [number, number][], px: number, py: number): number {
  let best = 1e12, bestSide = 0;
  for (let i = 0; i < shore.length - 1; i++) {
    const [ax, ay] = shore[i]!, [bx, by] = shore[i + 1]!;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    const qx = ax + dx * t, qy = ay + dy * t, d = Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
    if (d < best) { best = d; bestSide = dx * (py - ay) - dy * (px - ax); }
  }
  // convention: the sea is on the LEFT of the shore polyline direction (cross > 0 in y-down coordinates)
  return bestSide > 0 ? -best : best;
}

/** Heightfield, distance/width fields, water mask and item boxes. */
export function bakeAuthored(tr: Track) {
  const a = tr.authored!, N = tr.N, size = tr.size, res = tr.res, B = Math.ceil(size / 64);
  const bk: number[][] = Array.from({ length: B * B }, () => []);
  for (let i = 0; i < N; i++) bk[clamp((tr.y[i]! / 64) | 0, 0, B - 1) * B + clamp((tr.x[i]! / 64) | 0, 0, B - 1)]!.push(i);
  const bp: [number, number, number, number][] = [];
  for (const b of tr.branches) for (let i = 0; i < b.n; i++) bp.push([b.x[i]!, b.y[i]!, b.h[i]!, b.w!]);
  const hm = new Float32Array(res * res), dg = new Float32Array(res * res), wg = new Float32Array(res * res), liq = new Uint8Array(res * res), ng = new Float32Array(res * res);
  const R = mulberry(a.terrain.seed * 31 + 7), nz = vnoise(R), W = a.water;
  for (let gy = 0; gy < res; gy++)
    for (let gx = 0; gx < res; gx++) {
      const wx = gx * 4 + 2, wy = gy * 4 + 2, bx = (wx / 64) | 0, by = (wy / 64) | 0;
      let best = -1, bd = 1e12;
      for (let oy = -4; oy <= 4; oy++)
        for (let ox = -4; ox <= 4; ox++) {
          const cx = bx + ox, cy = by + oy;
          if (cx < 0 || cy < 0 || cx >= B || cy >= B) continue;
          for (const i of bk[cy * B + cx]!) {
            const dx = tr.x[i]! - wx, dy = tr.y[i]! - wy, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
          }
        }
      let d = best < 0 ? 999 : Math.sqrt(bd), hr = best < 0 ? 0 : tr.hc[best]!, w = best < 0 ? 42 : tr.wd[best]!;
      for (const q of bp) {
        const dd = dhypot(q[0] - wx, q[1] - wy);
        if (dd - q[3] < d - w) { d = dd; hr = q[2]; w = q[3]; }
      }
      // natural terrain: base + noise, dropping into the sea past the shore
      let tn = a.terrain.base + a.terrain.amp * (0.55 * nz(wx, wy, 150) + 0.3 * nz(wx + 500, wy, 60) + 0.15 * nz(wx, wy + 500, 24));
      if (W) {
        const sd = shoreDistance(W.shore, wx, wy);
        tn = sd < 0 ? Math.max(-W.seaDepth, sd * 0.08) : Math.min(tn, W.base + 1 + sd * 0.05) + Math.max(0, tn - W.base - 1 - sd * 0.05) * clamp(sd / 300, 0, 1);
      }
      const e = Math.max(0, 1 - Math.min(wx, wy, size - wx, size - wy) / 90);
      if (!W) tn += e * e * 120;
      let s = clamp((d - (w + 12)) / 100, 0, 1);
      s = s * s * (3 - 2 * s);
      const h = best < 0 ? tn : lerp(hr, tn, s);
      const i = gy * res + gx;
      hm[i] = h;
      dg[i] = d;
      wg[i] = w;
      if (W && h < W.base) liq[i] = 1;
      ng[i] = 0.6 * nz(wx + 900, wy + 300, 40) + 0.4 * nz(wx + 100, wy + 700, 13);
    }
  tr.hm = hm; tr.dg = dg; tr.wg = wg; tr.liq = liq; tr.ng = ng;
  placeBoxes(tr);
  void hAt;
}
