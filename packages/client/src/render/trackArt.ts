// Track textures and scenery placement (ported from legacy buildTexture / buildSky / buildScenery).
import { BW, ROAD, type Track, clamp, dgAt, hAt, lerp, liqAt, mulberry, wgAt, wrapA } from '@jpkart/core';
import { BAYER, OUT, hexRGB, shade, toU32 } from '../art/pixel';
import { DH } from '../art/sprites';

export const F = 320; // focal length in world pixels (legacy)

/** Ground color texture (TS×TS RGBA), legacy `buildTexture`. */
export function buildGroundTexture(tr: Track): Uint8Array<ArrayBuffer> {
  const TS = tr.size, HM = tr.res;
  const th = tr.th, c = document.createElement('canvas');
  c.width = c.height = TS;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const R = mulberry(tr.N * 7 + 3);
  g.fillStyle = th.ground[0];
  g.fillRect(0, 0, TS, TS);
  if (th.style === 'grass') {
    g.fillStyle = th.ground[1];
    for (let y = 0; y < TS; y += 32) g.fillRect(0, y, TS, 16);
    const fl = ['#ffe45e', '#ffffff', '#ff8ab0', '#b88aff'];
    for (let i = 0; i < 240; i++) { const cx = R() * TS, cy = R() * TS, col = fl[i % 4]!; for (let k = 0; k < 40; k++) { g.fillStyle = col; g.fillRect((cx + R() * 40) | 0, (cy + R() * 40) | 0, 2, 2); } }
  } else if (th.style === 'dunes') {
    g.fillStyle = th.ground[1];
    for (let y = 0; y < TS; y += 4) { const o = Math.sin(y * 0.03) * 40; for (let x = -64; x < TS; x += 128) g.fillRect(x + o + Math.sin(y * 0.11) * 6, y, 48, 2); }
  } else if (th.style === 'grid') {
    g.fillStyle = '#3a2a80';
    for (let i = 0; i < TS; i += 32) { g.fillRect(i, 0, 1, TS); g.fillRect(0, i, TS, 1); }
    g.fillStyle = '#ff3df0';
    for (let i = 0; i < TS; i += 128) { g.fillRect(i, 0, 1, TS); g.fillRect(0, i, TS, 1); }
  } else if (th.style === 'rock') {
    g.fillStyle = '#ff6a2a';
    for (let i = 0; i < 1200; i++) { let x = R() * TS, y = R() * TS; for (let k = 0; k < 10; k++) { g.fillRect(x | 0, y | 0, 2, 1); x += R() * 4 - 1; y += R() * 4 - 2; } }
  } else if (th.style === 'clay') {
    g.fillStyle = '#ffffff';
    for (let y = 20; y < TS; y += 150)
      for (let x = 20; x < TS; x += 90) {
        g.fillRect(x, y, 60, 2); g.fillRect(x, y + 120, 60, 2); g.fillRect(x, y, 2, 122); g.fillRect(x + 58, y, 2, 122); g.fillRect(x + 8, y, 1, 122); g.fillRect(x + 51, y, 1, 122);
        g.fillRect(x + 8, y + 30, 44, 1); g.fillRect(x + 8, y + 90, 44, 1); g.fillRect(x + 30, y + 30, 1, 60);
        g.fillStyle = '#e8e8f0'; g.fillRect(x - 3, y + 60, 66, 2); g.fillStyle = '#ffffff';
      }
  } else if (th.style === 'snow') {
    g.fillStyle = '#d0e4fa';
    for (let i = 0; i < 480; i++) { const x = R() * TS, y = R() * TS; g.fillRect(x | 0, y | 0, (20 + R() * 40) | 0, 1); }
  }
  const spk = th.style === 'snow' ? ['#ffffff', '#cfe0ff'] : [shade(th.ground[0], 1.12), shade(th.ground[0], 0.86)];
  for (let i = 0; i < 16000; i++) { g.fillStyle = spk[i & 1]!; g.fillRect((R() * TS) | 0, (R() * TS) | 0, 2, 2); }
  const path = new Path2D();
  path.moveTo(tr.x[0]!, tr.y[0]!);
  for (let i = 1; i < tr.N; i++) path.lineTo(tr.x[i]!, tr.y[i]!);
  path.closePath();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const b of tr.branches) {
    const bp = new Path2D(); bp.moveTo(b.x[0]!, b.y[0]!); bp.lineTo(b.x[b.n - 1]!, b.y[b.n - 1]!);
    g.strokeStyle = shade(th.edge, 0.8); g.lineWidth = BW * 2 + 30; g.stroke(bp); g.strokeStyle = th.edge; g.lineWidth = BW * 2 + 24; g.stroke(bp);
    g.strokeStyle = th.curbA; g.lineWidth = BW * 2 + 10; g.stroke(bp); g.setLineDash([8, 8]); g.strokeStyle = '#ffe45e'; g.stroke(bp); g.setLineDash([]);
    g.strokeStyle = shade(th.road, 0.9); g.lineWidth = BW * 2; g.stroke(bp);
  }
  if (!tr.authored) {
    g.strokeStyle = shade(th.edge, 0.8); g.lineWidth = ROAD * 2 + 30; g.stroke(path);
    g.strokeStyle = th.edge; g.lineWidth = ROAD * 2 + 24; g.stroke(path);
    g.strokeStyle = th.curbA; g.lineWidth = ROAD * 2 + 10; g.stroke(path);
    g.setLineDash([8, 8]); g.strokeStyle = th.curbB; g.stroke(path); g.setLineDash([]);
    g.strokeStyle = shade(th.road, 0.8); g.lineWidth = ROAD * 2 + 2; g.stroke(path);
    g.strokeStyle = th.road; g.lineWidth = ROAD * 2; g.stroke(path);
  } else paintAuthoredRoad(g, tr);
  g.fillStyle = th.road2;
  for (let i = 0; i < tr.N; i++)
    for (let k = 0; k < (th.ice ? 3 : 8); k++) {
      const l = (R() * 2 - 1) * (tr.wd[i]! - 3), a = tr.ang[i]!;
      if (th.ice) g.fillRect((tr.x[i]! - Math.sin(a) * l) | 0, (tr.y[i]! + Math.cos(a) * l) | 0, 6, 1);
      else g.fillRect((tr.x[i]! - Math.sin(a) * l) | 0, (tr.y[i]! + Math.cos(a) * l) | 0, 2, 2);
    }
  // skid marks in corners
  g.fillStyle = th.ice ? 'rgba(255,255,255,0.35)' : 'rgba(20,10,30,0.22)';
  for (let i = 0; i < tr.N; i++) {
    const cu = Math.abs(wrapA(tr.ang[(i + 4) % tr.N]! - tr.ang[(i - 4 + tr.N) % tr.N]!));
    if (cu < 0.18) continue;
    const a = tr.ang[i]!;
    const sk = tr.wd[i]! / ROAD;
    for (const l0 of [-20, -14, 12, 18]) { const l = l0 * sk, o = l + Math.sin(i * 0.3) * 3; g.fillRect((tr.x[i]! - Math.sin(a) * o - 1) | 0, (tr.y[i]! + Math.cos(a) * o - 1) | 0, 3, 3); }
  }
  g.setLineDash([10, 14]); g.strokeStyle = th.line; g.lineWidth = 2; g.stroke(path); g.setLineDash([]);
  for (const f of tr.def.ramps) {
    const i = Math.floor(f * tr.N), half = Math.ceil(tr.wd[i]! / 7);
    g.save(); g.translate(tr.x[i]!, tr.y[i]!); g.rotate(tr.ang[i]!);
    for (let s = -half; s < half; s++) { g.fillStyle = s & 1 ? '#ffe45e' : '#1a1026'; g.fillRect(-14, s * 7, 10, 7); }
    g.restore();
  }
  for (const p of tr.pads) {
    g.save(); g.translate(p.x, p.y); g.rotate(tr.ang[p.i]!);
    g.fillStyle = '#1a1026'; g.fillRect(-12, -13, 24, 26); g.fillStyle = '#ff8a1f'; g.fillRect(-11, -12, 22, 24);
    g.fillStyle = '#ffe45e';
    for (let k = 0; k < 3; k++) { const x = -8 + k * 7; for (let y = -9; y <= 9; y++) g.fillRect((x + (9 - Math.abs(y)) * 0.35) | 0, y, 3, 1); }
    g.restore();
  }
  for (const f of tr.flights) {
    g.save(); g.translate(tr.x[f]!, tr.y[f]!); g.rotate(tr.ang[f]!);
    g.fillStyle = OUT; g.fillRect(-17, -ROAD - 2, 34, ROAD * 2 + 4); g.fillStyle = '#2f6bff'; g.fillRect(-16, -ROAD, 32, ROAD * 2);
    g.fillStyle = '#8fe0ff';
    for (let k = 0; k < 3; k++) for (let y = -ROAD + 2; y < ROAD - 2; y++) g.fillRect((-13 + k * 10 + (ROAD - Math.abs(y)) * 0.12) | 0, y, 4, 1);
    g.restore();
  }
  g.save(); g.translate(tr.x[0]!, tr.y[0]!); g.rotate(tr.ang[0]!);
  const sq = Math.ceil(tr.wd[0]! / 7);
  for (let row = 0; row < 3; row++) for (let col = -sq; col < sq; col++) { g.fillStyle = (row + col) & 1 ? '#ffffff' : '#1a1026'; g.fillRect(row * 7 - 10, col * 7, 7, 7); }
  g.restore();
  // JP logo before the start line
  const li = (tr.N - 14) % tr.N;
  g.save(); g.translate(tr.x[li]!, tr.y[li]!); g.rotate(tr.ang[li]! + Math.PI / 2); g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [x, y, w, h] of [[0, 0, 3, 12], [-6, 9, 6, 3], [-6, 6, 3, 4], [6, 0, 3, 12], [6, 0, 8, 3], [6, 5, 8, 3], [12, 0, 3, 8]] as const) g.fillRect(x * 1.4 - 6, y * 1.4 - 8, w * 1.4, h * 1.4);
  g.restore();
  const img = g.getImageData(0, 0, TS, TS);
  const tex = new Uint32Array(img.data.buffer);
  // ground tones with dithering, liquids and relief shading
  const hm = tr.hm, liq = tr.liq, dg = tr.dg, ng = tr.ng, L2 = tr.def.liquid, sg = new Float32Array(HM * HM);
  for (let y = 0; y < HM; y++)
    for (let x = 0; x < HM; x++) {
      const i = y * HM + x, l = hm[x > 0 ? i - 1 : i]!, r = hm[x < HM - 1 ? i + 1 : i]!, u = hm[y > 0 ? i - HM : i]!, d = hm[y < HM - 1 ? i + HM : i]!;
      sg[i] = liq[i] ? 1 : clamp(1 + (l - r + (u - d)) * 0.045, 0.62, 1.4);
    }
  const gt = th.ground.map(toU32), lc1 = L2 ? toU32(L2.col) : 0, lc2 = L2 ? toU32(L2.col2) : 0, lc3 = L2 ? toU32(L2.col3) : 0, lsh = L2 ? toU32(L2.shore) : 0;
  for (let y = 0; y < TS; y++) {
    const gy = Math.min(HM - 1, y >> 2);
    for (let x = 0; x < TS; x++) {
      const gx = Math.min(HM - 1, x >> 2), ci = gy * HM + gx, p = y * TS + x;
      if (L2 && liq[ci]) {
        const nb = (gx > 0 && !liq[ci - 1]) || (gx < HM - 1 && !liq[ci + 1]) || (gy > 0 && !liq[ci - HM]) || (gy < HM - 1 && !liq[ci + HM]);
        const wv = Math.sin(x * 0.09 + Math.sin(y * 0.05) * 2) + Math.sin(y * 0.13);
        if (tr.water) { const dep = clamp((tr.water.base - hm[ci]!) / 10, 0, 1); tex[p] = toU32(shade(th.ground[0], 0.92 - dep * 0.35)); continue; }
        tex[p] = nb && (x + y) & 3 ? lsh : wv > 1.2 ? lc3 : wv < -0.8 ? lc2 : lc1;
        continue;
      }
      if (dg[ci]! - tr.wg[ci]! > 16 && tex[p] === gt[0]) { const v = ng[ci]! * 2.2 + BAYER[(y & 3) * 4 + (x & 3)]! - 1.1; if (v > 0.55) tex[p] = gt[2]!; else if (v < -0.45) tex[p] = gt[1]!; }
      const fx = (x & 3) / 4, fy = (y & 3) / 4, gx2 = Math.min(HM - 1, gx + 1), gy2 = Math.min(HM - 1, gy + 1);
      const s = lerp(lerp(sg[gy * HM + gx]!, sg[gy * HM + gx2]!, fx), lerp(sg[gy2 * HM + gx]!, sg[gy2 * HM + gx2]!, fx), fy);
      const c0 = tex[p]!, r = Math.min(255, (c0 & 255) * s), gg = Math.min(255, ((c0 >> 8) & 255) * s), b = Math.min(255, ((c0 >> 16) & 255) * s);
      tex[p] = (0xff000000 | (b << 16) | (gg << 8) | r) >>> 0;
    }
  }
  return new Uint8Array(img.data.buffer);
}

/** Sky gradient rows (dithered bands) as a canvas: row 0 = horizon. Legacy `buildSky` (first part). */
export function buildSkyGradient(tr: Track): HTMLCanvasElement {
  const th = tr.th, bands = th.sky, n = bands.length, BH = 64, ROWS = 420, Wd = 64;
  const c = document.createElement('canvas');
  c.width = Wd;
  c.height = ROWS;
  const g = c.getContext('2d')!;
  for (let r = 0; r < ROWS; r++) {
    const f = r / BH, i0 = Math.min(n - 1, Math.floor(f)), fr = f - Math.floor(f), c0 = bands[n - 1 - i0]!, c1 = bands[Math.max(0, n - 2 - i0)]!;
    for (let x = 0; x < Wd; x++) {
      g.fillStyle = BAYER[(r & 3) * 4 + (x & 3)]! < fr && i0 < n - 1 ? c1 : c0;
      g.fillRect(x, ROWS - 1 - r, 1, 1);
    }
  }
  return c;
}

/** 360° panorama strip (mountains, city, sea...). Width = 2πF, bottom row sits on the horizon. */
export function buildSkyStrip(tr: Track): HTMLCanvasElement {
  const th = tr.th, SW = Math.round(2 * Math.PI * F), SH = 230, m = document.createElement('canvas');
  m.width = SW;
  m.height = SH;
  const g = m.getContext('2d')!;
  const TAU = Math.PI * 2, R = mulberry(99 + tr.N);
  if (th.sun) {
    const sx = SW * 0.3, sy = 60;
    for (let y = -34; y <= 34; y++)
      for (let x = -34; x <= 34; x++) {
        const d = Math.hypot(x, y);
        if (d <= 20) { g.fillStyle = d < 16 ? th.sun : shade(th.sun, 0.95); g.fillRect(sx + x, sy + y, 1, 1); }
        else if (d < 34 && BAYER[((y + 40) & 3) * 4 + ((x + 40) & 3)]! < (34 - d) / 40) { g.fillStyle = th.sun; g.fillRect(sx + x, sy + y, 1, 1); }
      }
  }
  if (th.aurora) {
    for (let x = 0; x < SW; x++) {
      const y = 40 + Math.sin(x * 0.01) * 18 + Math.sin(x * 0.027) * 8;
      for (let k = 0; k < 26; k++) { const tt = k / 26; if (BAYER[(k & 3) * 4 + (x & 3)]! < (1 - tt) * 0.7) { g.fillStyle = tt < 0.35 ? '#5affb0' : tt < 0.7 ? '#3ad0c8' : '#6a7aff'; g.fillRect(x, (y + k) | 0, 1, 1); } }
    }
  }
  if (th.strip === 'city' || th.aurora || th.stars) for (let i = 0; i < 260; i++) { g.fillStyle = R() < 0.7 ? '#ffffff' : '#ffe45e'; g.fillRect((R() * SW) | 0, (R() * 120) | 0, R() < 0.1 ? 2 : 1, R() < 0.1 ? 2 : 1); }
  if (th.strip === 'city') { g.fillStyle = '#fff7e0'; g.beginPath(); g.arc(400, 40, 14, 0, TAU); g.fill(); g.fillStyle = th.sky[1]!; g.beginPath(); g.arc(408, 35, 12, 0, TAU); g.fill(); }
  else if (th.strip === 'volcano') { for (let i = 0; i < 12; i++) { const cx = (R() * SW) | 0, cy = (20 + R() * 60) | 0, w = (60 + R() * 80) | 0; g.fillStyle = '#3a1a22'; g.fillRect(cx, cy, w, 10); g.fillRect(cx + 12, cy - 8, w - 28, 9); g.fillStyle = '#5a2a2e'; g.fillRect(cx + 14, cy - 8, w - 40, 2); } }
  else if (!th.aurora && !th.stars) {
    for (let i = 0; i < 11; i++) {
      const cx = (R() * SW) | 0, cy = (40 + R() * 60) | 0, w = (40 + R() * 60) | 0;
      g.fillStyle = shade(th.fog, 0.9); g.fillRect(cx + 4, cy + 16, w - 6, 4); g.fillStyle = '#ffffff'; g.fillRect(cx, cy + 8, w, 9); g.fillRect(cx + 8, cy, w - 20, 10); g.fillRect(cx + ((w * 0.4) | 0), cy - 6, (w * 0.35) | 0, 8); g.fillStyle = '#f4fbff'; g.fillRect(cx + 10, cy + 1, (w * 0.3) | 0, 2);
    }
  }
  for (let x = 0; x < SW; x++) {
    const u = (x / SW) * TAU;
    if (th.strip === 'city') continue;
    let h1 = 48 + 20 * Math.sin(u * 3 + 0.5) + 14 * Math.sin(u * 7 + 1.3) + 8 * Math.sin(u * 13);
    if (th.strip === 'mesa') h1 = Math.round(h1 / 14) * 14;
    if (th.strip === 'ice') h1 = 60 + 36 * Math.abs(Math.sin(u * 9 + 1)) + 20 * Math.abs(Math.sin(u * 17));
    if (th.strip === 'volcano') { const d = Math.abs(wrapA(u - 1.2)); h1 = Math.max(36 + 12 * Math.sin(u * 5), d < 0.5 ? 140 - d * 220 : 0); }
    if (th.strip === 'sea') h1 = 8 + Math.max(0, 28 * Math.sin(u * 2 + 1) - 12) + Math.max(0, 20 * Math.sin(u * 5) - 12);
    h1 = Math.max(6, h1 | 0);
    const dh = 48 + 20 * Math.sin((u + 0.004) * 3 + 0.5) + 14 * Math.sin((u + 0.004) * 7 + 1.3) - (48 + 20 * Math.sin(u * 3 + 0.5) + 14 * Math.sin(u * 7 + 1.3));
    const lit = th.strip === 'ice' ? Math.cos(u * 9 + 1) * Math.sign(Math.sin(u * 9 + 1)) > 0 : dh > 0;
    for (let y = SH - h1; y < SH; y++) {
      const t = (y - (SH - h1)) / h1;
      g.fillStyle = lit ? (t < 0.5 ? th.mt1 : th.mt2 || th.mt1) : th.mt2 || shade(th.mt1, 0.8);
      if ((x + y) & 1 && Math.abs(t - 0.5) < 0.04) g.fillStyle = th.mt1;
      g.fillRect(x, y, 1, 1);
    }
    if (th.snow && h1 > 62) { g.fillStyle = th.snow; g.fillRect(x, SH - h1, 1, Math.min(12, h1 - 62) + ((x * 7) % 5 === 0 ? 3 : 0)); }
    if (th.strip === 'volcano' && h1 > 116) { g.fillStyle = h1 > 130 ? '#ffe45e' : '#ff6a2a'; g.fillRect(x, SH - h1, 1, 4); }
    if (th.strip === 'sea') continue;
    let h2 = 20 + 10 * Math.sin(u * 5 + 2) + 8 * Math.sin(u * 11 + 0.7) + 4 * Math.sin(u * 23);
    if (th.strip === 'mesa') h2 = Math.round(h2 / 8) * 8;
    h2 = Math.max(4, h2 | 0);
    g.fillStyle = th.hill; g.fillRect(x, SH - h2, 1, h2); g.fillStyle = shade(th.hill, 1.2); g.fillRect(x, SH - h2, 1, 2);
    if (th.strip === 'mount' && x % 9 === 0 && h2 > 18) { g.fillStyle = shade(th.hill, 0.75); g.fillRect(x - 2, SH - h2 - 6, 5, 8); g.fillRect(x - 1, SH - h2 - 10, 3, 4); }
  }
  if (th.strip === 'sea') { g.fillStyle = '#2a8fd0'; g.fillRect(0, SH - 6, SW, 6); g.fillStyle = '#8fd4ff'; for (let x = 0; x < SW; x += 7) g.fillRect(x, SH - 6 + (x % 3), 3, 1); }
  if (th.strip === 'city') {
    for (let x = 0; x < SW;) {
      const w = (16 + R() * 36) | 0, h = (30 + R() * 110) | 0;
      g.fillStyle = R() < 0.5 ? '#241a48' : '#2e2058'; g.fillRect(x, SH - h, w, h);
      g.fillStyle = R() < 0.5 ? '#ff3df0' : '#3df0ff'; g.fillRect(x, SH - h, w, 1);
      for (let yy = SH - h + 4; yy < SH - 2; yy += 5) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (R() < 0.4) { g.fillStyle = R() < 0.5 ? '#ffe45e' : R() < 0.5 ? '#ff3df0' : '#3df0ff'; g.fillRect(xx, yy, 2, 2); }
      x += w + ((R() * 6) | 0);
    }
  }
  if (th.strip === 'volcano') { const cx = Math.round((1.2 / TAU) * SW); g.fillStyle = '#4a2a30'; for (let i = 0; i < 7; i++) g.fillRect(cx - 14 - i * 10 + (i % 2) * 18, SH - 160 - i * 14, 28 + i * 8, 10); }
  return m;
}

export interface SceneryItem { x: number; y: number; z: number; k: string; h: number; arch?: boolean }

/** Decorative scenery placement (legacy `buildScenery`). */
export function buildScenery(tr: Track): SceneryItem[] {
  const TS = tr.size, HM = tr.res;
  const R = mulberry(tr.N * 13 + 1), out: SceneryItem[] = [], th = tr.th;
  let tries = 0;
  const free = (x: number, y: number, m: number) => { const i = ((y / 4) | 0) * HM + ((x / 4) | 0); return tr.dg[i]! - tr.wg[i]! >= m && !tr.liq[i]; };
  const density = (TS / 2048) * (TS / 2048);
  while (out.length < 300 * density && tries < 5000 * density) {
    tries++;
    const x = 30 + R() * (TS - 60), y = 30 + R() * (TS - 60);
    if (!free(x, y, 32)) continue;
    const k = th.deco[(R() * th.deco.length) | 0]!;
    out.push({ x, y, z: hAt(tr, x, y), k, h: DH[k]! });
  }
  tries = 0;
  let lmn = 0;
  while (lmn < 34 * density && tries < 5000 * density) {
    tries++;
    const x = 40 + R() * (TS - 80), y = 40 + R() * (TS - 80);
    if (!free(x, y, 60)) continue;
    const k = th.lm[lmn % th.lm.length]!;
    out.push({ x, y, z: hAt(tr, x, y), k, h: DH[k]! });
    lmn++;
  }
  const posts = Array.isArray(th.post) ? th.post : [th.post];
  for (let i = 6; i < tr.N - 4; i += 7) {
    const a = tr.ang[i]!;
    for (const s of [-1, 1]) {
      if ((s < 0 ? tr.wallL : tr.wallR)[i]) continue; // walls are drawn as railings
      const l = s * (tr.wd[i]! + 19), x = tr.x[i]! - Math.sin(a) * l, y = tr.y[i]! + Math.cos(a) * l;
      if (x < 4 || y < 4 || x > TS - 4 || y > TS - 4 || liqAt(tr, x, y) || dgAt(tr, x, y) - wgAt(tr, x, y) < 15) continue;
      if (tr.water && hAt(tr, x, y) < tr.water.base + 1) continue;
      const k = posts[((i / 7) | 0) % posts.length]!;
      out.push({ x, y, z: hAt(tr, x, y), k, h: DH[k]! });
    }
  }
  out.push({ x: tr.x[0]!, y: tr.y[0]!, z: tr.hc[0]!, k: 'arch', h: DH.arch!, arch: true });
  return out;
}

/** 56×56 minimap of the centerline. */
export function buildMinimap(tr: Track): { cv: HTMLCanvasElement; k: number } {
  const S = 56, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, k = S / tr.size;
  const p = new Path2D();
  p.moveTo(tr.x[0]! * k, tr.y[0]! * k);
  for (let i = 1; i < tr.N; i++) p.lineTo(tr.x[i]! * k, tr.y[i]! * k);
  p.closePath();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = OUT; g.lineWidth = 6; g.stroke(p);
  g.strokeStyle = '#fff7e0'; g.lineWidth = 3; g.stroke(p);
  g.fillStyle = '#e8455a';
  g.fillRect((tr.x[0]! * k - 2) | 0, (tr.y[0]! * k - 2) | 0, 4, 4);
  return { cv: c, k };
}

export const fogRGB = (tr: Track) => hexRGB(tr.th.fog);

/** Authored tracks: variable-width road, curbs, shortcuts (wooden pier over water) and surface bands. */
function paintAuthoredRoad(g: CanvasRenderingContext2D, tr: Track) {
  const th = tr.th, N = tr.N;
  const seg = (i: number, width: number, color: string) => {
    const j = (i + 1) % N;
    g.strokeStyle = color; g.lineWidth = width;
    g.beginPath(); g.moveTo(tr.x[i]!, tr.y[i]!); g.lineTo(tr.x[j]!, tr.y[j]!); g.stroke();
  };
  for (let i = 0; i < N; i++) seg(i, tr.wd[i]! * 2 + 30, shade(th.edge, 0.8));
  for (let i = 0; i < N; i++) seg(i, tr.wd[i]! * 2 + 24, th.edge);
  for (let i = 0; i < N; i++) seg(i, tr.wd[i]! * 2 + 10, (i >> 1) & 1 ? th.curbB : th.curbA);
  for (let i = 0; i < N; i++) seg(i, tr.wd[i]! * 2 + 2, shade(th.road, 0.8));
  for (let i = 0; i < N; i++) seg(i, tr.wd[i]! * 2, th.road);
  // shortcuts: a wooden pier when it crosses water, a dirt path otherwise
  for (const b of tr.branches) {
    const bw = (b.w ?? 24) * 2, pier = !!tr.authored!.branches.find((x) => x.risk === 'agua');
    for (let i = 0; i < b.n - 1; i++) {
      g.strokeStyle = pier ? '#5a3a24' : shade(th.edge, 0.85); g.lineWidth = bw + 6;
      g.beginPath(); g.moveTo(b.x[i]!, b.y[i]!); g.lineTo(b.x[i + 1]!, b.y[i + 1]!); g.stroke();
    }
    for (let i = 0; i < b.n - 1; i++) {
      g.strokeStyle = pier ? (i & 1 ? '#a8784a' : '#9a6a40') : shade(th.road, 0.92); g.lineWidth = bw;
      g.beginPath(); g.moveTo(b.x[i]!, b.y[i]!); g.lineTo(b.x[i + 1]!, b.y[i + 1]!); g.stroke();
    }
  }
  // surface bands
  const COL: Record<string, [string, string]> = { arena: ['#ecd08c', '#d8b870'], barro: ['#6a4a2a', '#4e3420'], hielo: ['#d8f4ff', '#a8dcf0'], charco: ['#5a9ad0', '#3a7ab0'] };
  const R = mulberry(tr.N * 5 + 9);
  for (const s of tr.surfaces) {
    const [c1, c2] = COL[s.kind] ?? ['#888', '#666'];
    for (let i = s.i0; i !== s.i1; i = (i + 1) % N) {
      const a = tr.ang[i]!;
      for (let l = s.lat0; l <= s.lat1; l += 2) {
        if (R() < 0.12) continue;
        g.fillStyle = R() < 0.3 ? c2 : c1;
        g.fillRect((tr.x[i]! - Math.sin(a) * l) | 0, (tr.y[i]! + Math.cos(a) * l) | 0, 3, 3);
      }
    }
  }
  g.setLineDash([10, 14]); g.strokeStyle = th.line; g.lineWidth = 2;
  g.beginPath(); g.moveTo(tr.x[0]!, tr.y[0]!);
  for (let i = 1; i < N; i++) g.lineTo(tr.x[i]!, tr.y[i]!);
  g.closePath(); g.stroke(); g.setLineDash([]);
}
