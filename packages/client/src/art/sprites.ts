// Characters, items and scenery pixel art (ported verbatim from legacy/jp-kart.html).
import { CHARS, type Character } from '@jpkart/core';
import { OUT, P, PX, cyl, miniText, miniW, mk, mulberry, shade, sph, type PXBuf, type Spr } from './pixel';

export const BEARD = '#3a2418';
function drawAcc(p: PXBuf, c: Character, cx: number, cy: number, r: number) {
  const A = c.accCol, Ad = shade(A, 0.75);
  switch (c.acc) {
    case 'antenna': P.line(p, cx, cy - r * 0.9, cx + r * 0.3, cy - r * 1.6, '#2a2833', Math.max(1, Math.round(r / 7))); P.ell(p, cx + r * 0.3, cy - r * 1.7, r * 0.24, r * 0.24, sph(A)); break;
    case 'spikes': for (const o of [-0.5, 0, 0.5]) P.tri(p, cx + o * r - r * 0.22, cy - r * 0.75, cx + o * r + r * 0.22, cy - r * 0.75, cx + o * r, cy - r * 1.38, (x) => (x < cx + o * r ? shade(A, 1.15) : Ad)); break;
    case 'mohawk': for (let i = -2; i <= 2; i++) P.tri(p, cx + i * r * 0.15 - r * 0.12, cy - r * 0.8, cx + i * r * 0.15 + r * 0.12, cy - r * 0.8, cx + i * r * 0.15, cy - r * (1.35 - Math.abs(i) * 0.08), i % 2 ? A : Ad); break;
    case 'tuft': P.ell(p, cx + r * 0.12, cy - r * 1.05, r * 0.22, r * 0.3, A); P.ell(p, cx - r * 0.14, cy - r * 1.1, r * 0.17, r * 0.24, Ad); break;
    case 'headphones': {
      const t = Math.max(1, Math.round(r / 5));
      for (let i = 0; i <= 24; i++) { const a = Math.PI + (i / 24) * Math.PI; P.rect(p, Math.round(cx + Math.cos(a) * r * 1.04 - t / 2), Math.round(cy + Math.sin(a) * r * 1.1 - t / 2), t, t, '#2a2833'); }
      break;
    }
  }
}
function drawAccPost(p: PXBuf, c: Character, cx: number, cy: number, r: number) {
  if (c.acc === 'headphones') for (const s of [-1, 1]) P.ell(p, cx + s * r * 0.98, cy + r * 0.12, r * 0.3, r * 0.44, sph(c.accCol));
}
export const suitOf = (c: Character) => shade(c.helmet, 0.72);

function portrait(c: Character): Spr {
  const p = PX(32, 32), S = suitOf(c);
  P.ell(p, 16, 33, 13, 8, sph(S));
  drawAcc(p, c, 16, 15, 11);
  P.ell(p, 16, 15, 11, 11, sph(c.helmet));
  P.ell(p, 16, 17.5, 7.6, 6.6, (dx, dy) => (dy > 0.62 ? shade(c.skin, 0.8) : dx < -0.45 && dy < -0.1 ? shade(c.skin, 1.1) : c.skin));
  if (c.beard) P.ell(p, 16, 21.8, 7, 3.2, (_dx, dy) => (dy > -0.7 ? BEARD : 0));
  for (const ex of [12, 19]) { P.rect(p, ex, 15, 2, 3, OUT); P.set(p, ex, 15, '#ffffff'); }
  if (!c.beard) { P.rect(p, 10, 19, 2, 1, '#ff8a9a'); P.rect(p, 21, 19, 2, 1, '#ff8a9a'); }
  P.set(p, 14, 20, c.mouth); P.set(p, 18, 20, c.mouth); P.rect(p, 15, 21, 3, 1, c.mouth);
  if (c.acc === 'glasses') { P.rect(p, 10, 14, 5, 4, '#20306e'); P.rect(p, 17, 14, 5, 4, '#20306e'); P.rect(p, 15, 15, 2, 1, '#20306e'); P.rect(p, 11, 14, 2, 1, '#6a9aff'); P.rect(p, 18, 14, 2, 1, '#6a9aff'); }
  P.ell(p, 12, 9, 2.2, 1.4, shade(c.helmet, 1.55));
  drawAccPost(p, c, 16, 15, 11);
  P.outline(p);
  return P.toSpr(p);
}

export type Voxel = [number, number, number, string];
/** Voxel model of a kart + driver: +y forward, +x right, +z up (legacy `voxelKart`). */
export function voxelKart(c: Character): Voxel[] {
  const V = new Map<string, Voxel>(), add = (x: number, y: number, z: number, col: string) => V.set(x + ',' + y + ',' + z, [x, y, z, col]);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: string | ((x: number, y: number, z: number) => string)) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) add(x, y, z, typeof col === 'function' ? col(x, y, z) : col);
  };
  const tire = '#2a2833', rim = '#b8bccc', K = c.kart, S = suitOf(c), A = c.accCol;
  for (const s of [-1, 1]) {
    box(s * 5, s * 7, -8, -4, 0, 4, (x, y, z) => (x === s * 7 && y >= -7 && y <= -5 && z >= 1 && z <= 3 ? rim : tire));
    box(s * 5, s * 7, 4, 7, 0, 3, (x, y, z) => (x === s * 7 && y >= 5 && y <= 6 && z >= 1 && z <= 2 ? rim : tire));
  }
  box(-4, 4, -8, 8, 1, 1, '#3a3848');
  box(-5, 5, -6, 6, 2, 3, (_x, _y, z) => (z === 3 ? shade(K, 1.18) : K));
  box(-3, 3, 6, 8, 2, 3, (_x, _y, z) => (z === 3 ? shade(K, 1.18) : K)); box(-3, 3, 9, 9, 2, 2, '#c0c4d4');
  box(-3, 3, -8, -7, 2, 4, (_x, _y, z) => (z === 4 ? '#c0c4d4' : '#8a90a4')); box(-2, -2, -9, -9, 3, 3, '#c0c4d4'); box(2, 2, -9, -9, 3, 3, '#c0c4d4');
  box(-3, 3, -6, -5, 4, 7, shade(K, 0.7));
  box(-2, 2, -4, -1, 4, 8, S); box(-3, -3, -2, 2, 6, 7, S); box(3, 3, -2, 2, 6, 7, S); add(-3, 3, 7, c.skin); add(3, 3, 7, c.skin);
  box(-2, 2, 4, 4, 6, 7, '#2a2833');
  for (let x = -4; x <= 4; x++)
    for (let y = -6; y <= 4; y++)
      for (let z = 8; z <= 16; z++) {
        const d = x * x + (y + 1) * (y + 1) + (z - 12) * (z - 12);
        if (d > 3.9 * 3.9) continue;
        let col = c.helmet;
        if (y >= 1 && z >= 10 && z <= 14 && Math.abs(x) <= 2) col = c.skin;
        if (y >= 1 && z === 13 && Math.abs(x) === 1) col = c.acc === 'glasses' ? '#20306e' : OUT;
        if (c.beard && y >= 1 && z === 10 && Math.abs(x) <= 2) col = BEARD;
        add(x, y, z, col);
      }
  if (c.acc === 'mohawk') box(0, 0, -4, 2, 16, 17, A);
  if (c.acc === 'tuft') { box(-1, 1, -2, 0, 16, 16, A); add(0, -1, 17, A); }
  if (c.acc === 'spikes') for (const x of [-2, 0, 2]) { box(x, x, -2, 0, 16, 16, A); add(x, -1, 17, A); }
  if (c.acc === 'antenna') { box(2, 2, -1, -1, 16, 18, '#2a2833'); box(2, 3, -1, -1, 19, 19, A); }
  if (c.acc === 'headphones') { box(-5, -4, -2, 0, 11, 14, A); box(4, 5, -2, 0, 11, 14, A); for (let x = -4; x <= 4; x++) add(x, -1, Math.round(12 + Math.sqrt(Math.max(0, 16 - x * x)) * 1.05), '#2a2833'); }
  return [...V.values()];
}
function renderVoxel(V: Voxel[], ang: number): Spr {
  const S = 3, w = 84, h = 84, el = 0.55, ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(ang), sa = Math.sin(ang);
  const occ = new Set(V.map((v) => v[0] + ',' + v[1] + ',' + v[2])), zb = new Float32Array(w * h).fill(-1e9), p = PX(w, h);
  for (const [x, y, z, c] of V) {
    const xr = x * ca - y * sa, yr = x * sa + y * ca, sx = Math.round(w / 2 - xr * S - S / 2), sy = Math.round(h * 0.74 + (yr * se - z * ce) * S), cl = yr * ce + z * se;
    const top = !occ.has(x + ',' + y + ',' + (z + 1));
    for (let dy = 0; dy <= S; dy++)
      for (let dx = 0; dx <= S; dx++) {
        const px = sx + dx, py = sy + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const i = py * w + px;
        if (cl > zb[i]!) { zb[i] = cl; p.a[i] = top && dy === 0 ? shade(c, 1.22) : c; }
      }
  }
  P.outline(p);
  return P.toSpr(p);
}
const ROT = new Map<number, Spr[]>();
/** 24 pre-rendered 360° frames (menus and podium). */
export function rotFrames(ci: number): Spr[] {
  let r = ROT.get(ci);
  if (!r) {
    const V = voxelKart(CHARS[ci]!);
    r = [];
    for (let i = 0; i < 24; i++) r.push(renderVoxel(V, (i / 24) * Math.PI * 2));
    ROT.set(ci, r);
  }
  return r;
}
export const FACES: Spr[] = CHARS.map(portrait);

// ---- balls and items ----
export const BALL = '#d8f03a';
function ballSprite(size: number, phase: number, colr = BALL, face?: string): Spr {
  return mk(size, size, (p) => {
    const c = size / 2, r = size / 2 - 1, f = sph(colr), R = mulberry(size * 7 + Math.round(phase * 10));
    P.ell(p, c, c, r, r, (dx, dy) => {
      const seam = Math.abs(dx - 0.5 * Math.sin(phase) - 0.42 * Math.cos(dy * 1.7 + phase)) < 0.13;
      if (seam) { const l = -(dx * 0.62 + dy * 0.78); return l > -0.3 ? '#ffffff' : '#c8ccd8'; }
      return f(dx, dy);
    });
    for (let i = 0; i < size; i++) { const x = c + (R() * 2 - 1) * r * 0.7, y = c + (R() * 2 - 1) * r * 0.7; if (P.get(p, x | 0, y | 0) === colr) P.set(p, x, y, shade(colr, 1.12)); }
    if (face === 'angry') {
      const e = Math.max(1, Math.round(size / 12));
      P.rect(p, c - r * 0.5, c - r * 0.15, e * 2, e * 2, OUT); P.rect(p, c + r * 0.2, c - r * 0.15, e * 2, e * 2, OUT);
      P.line(p, c - r * 0.65, c - r * 0.45, c - r * 0.15, c - r * 0.25, OUT, e); P.line(p, c + r * 0.65, c - r * 0.45, c + r * 0.15, c - r * 0.25, OUT, e); P.rect(p, c - r * 0.3, c + r * 0.35, r * 0.6, e, OUT);
    }
  });
}
export const BALLS = [0, 1, 2, 3].map((i) => ballSprite(16, (i * Math.PI) / 2));
export const BIGBALL = ballSprite(28, 0.6);
function qmark(p: PXBuf, x: number, y: number, c: string) {
  ['111', '001', '011', '000', '010'].forEach((r, j) => { for (let i = 0; i < 3; i++) if (r[i] === '1') P.set(p, x + i, y + j, c); });
}
export const ICONS: Record<string, Spr> = {
  bocina: mk(16, 16, (p) => { P.tri(p, 4, 8, 13, 2, 13, 14, (x) => (x < 8 ? '#ffe45e' : x < 11 ? '#ffd23a' : '#d8a820')); P.ell(p, 3, 8, 2.5, 2.5, sph('#e8455a')); P.rect(p, 14, 4, 1, 8, '#b8900a'); }),
  falsa: mk(16, 16, (p) => { P.ell(p, 8, 11, 7, 3.6, (dx, dy) => (dx < -0.3 && dy < -0.2 ? '#4a3a60' : '#2a2040')); qmark(p, 7, 2, '#fff7e0'); }),
  goma: mk(16, 16, (p) => { P.ell(p, 8, 8, 7, 7, (dx, dy) => (dx * dx + dy * dy < 0.2 ? 0 : sph('#e8455a')(dx, dy))); }),
  ciego: mk(16, 16, (p) => { P.rect(p, 0, 6, 5, 1, '#c8ccd8'); P.rect(p, 1, 9, 4, 1, '#c8ccd8'); P.ell(p, 10, 8, 5, 5, sph('#8a90a4')); P.rect(p, 8, 6, 2, 1, '#ffffff'); }),
  burbuja: mk(16, 16, (p) => { P.ell(p, 8, 8, 7, 7, (dx, dy) => { const d = dx * dx + dy * dy; return d > 0.7 ? '#8fe0ff' : dx < -0.2 && dy < -0.2 && d > 0.2 && d < 0.45 ? '#ffffff' : '#dff8ff'; }); }),
  nitro: mk(16, 16, (p) => { P.tri(p, 6, 12, 10, 12, 8, 16, '#ff8a1f'); P.rect(p, 5, 3, 6, 10, cyl('#2f6bff')); P.rect(p, 6, 1, 4, 2, '#9aa0b4'); P.rect(p, 6, 6, 4, 2, '#fff7e0'); }),
  alquitran: mk(16, 16, (p) => { P.ell(p, 8, 10, 7.5, 4.5, (dx, dy) => (dx < -0.4 && dy < -0.3 ? '#3a3038' : '#141014')); P.ell(p, 5, 8, 1.4, 1.4, '#4a4050'); P.ell(p, 11, 11, 1, 1, '#4a4050'); }),
  dron: mk(16, 16, (p) => { P.rect(p, 1, 4, 5, 1, '#2a2833'); P.rect(p, 10, 4, 5, 1, '#2a2833'); P.line(p, 4, 5, 7, 8, '#6a7080'); P.line(p, 12, 5, 9, 8, '#6a7080'); P.ell(p, 8, 9, 4, 2.8, sph('#b8bccc')); P.rect(p, 7, 10, 2, 1, '#ff3a3a'); }),
  gancho: mk(16, 16, (p) => { P.ell(p, 8, 9, 6, 6, (dx, dy) => (dx * dx + dy * dy < 0.3 || dy < 0 ? 0 : '#e8455a')); P.rect(p, 2, 4, 3, 6, '#e8455a'); P.rect(p, 11, 4, 3, 6, '#e8455a'); P.rect(p, 2, 3, 3, 2, '#ffffff'); P.rect(p, 11, 3, 3, 2, '#ffffff'); P.line(p, 8, 0, 6, 4, '#ffe45e', 1); P.line(p, 6, 4, 9, 4, '#ffe45e', 1); P.line(p, 9, 4, 7, 8, '#ffe45e', 1); }),
  inversor: mk(16, 16, (p) => { P.rect(p, 2, 4, 9, 2, '#b84aff'); P.tri(p, 10, 1, 10, 8, 14, 4.5, '#b84aff'); P.rect(p, 5, 10, 9, 2, '#ff6ad0'); P.tri(p, 6, 7.5, 6, 14.5, 2, 11, '#ff6ad0'); }),
  pem: mk(16, 16, (p) => { P.ell(p, 8, 8, 7, 7, (dx, dy) => (dx * dx + dy * dy > 0.75 ? '#3df0ff' : '#15305a')); P.tri(p, 9, 2, 4, 9, 8, 9, '#ffe45e'); P.tri(p, 8, 7, 12, 7, 7, 14, '#ffe45e'); }),
  jugger: mk(16, 16, (p) => { P.rect(p, 3, 2, 10, 7, cyl('#ffd23a')); P.tri(p, 3, 9, 13, 9, 8, 15, (x) => (x < 8 ? '#ffe45e' : '#c89a1a')); for (const [x, y] of [[8, 4], [7, 5], [8, 5], [9, 5], [8, 6], [6, 5], [10, 5]] as const) P.set(p, x, y, '#ffffff'); }),
  agujero: mk(16, 16, (p) => { P.ell(p, 8, 8, 7.5, 7.5, (dx, dy) => { const d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx); return d > 0.8 ? '#9a4aff' : d > 0.4 ? (Math.sin(a * 3 + d * 9) > 0.3 ? '#6a2ad0' : '#2a0a4a') : '#000000'; }); }),
  cuantico: mk(16, 16, (p) => { P.ell(p, 4, 8, 3, 3, sph('#2ec46b')); P.ell(p, 12, 8, 3, 3, sph('#3df0ff')); P.line(p, 4, 4, 11, 3, '#fff7e0', 1); P.tri(p, 11, 1, 11, 5, 14, 3, '#fff7e0'); P.line(p, 12, 12, 5, 13, '#fff7e0', 1); P.tri(p, 5, 11, 5, 15, 2, 13, '#fff7e0'); }),
  teleport: mk(16, 16, (p) => {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      P.tri(p, 8, 8.5, 8 + Math.cos(a) * 7.5, 8.5 + Math.sin(a) * 7.5, 8 + Math.cos(a + Math.PI / 5) * 3.2, 8.5 + Math.sin(a + Math.PI / 5) * 3.2, '#ffd23a');
      P.tri(p, 8, 8.5, 8 + Math.cos(a) * 7.5, 8.5 + Math.sin(a) * 7.5, 8 + Math.cos(a - Math.PI / 5) * 3.2, 8.5 + Math.sin(a - Math.PI / 5) * 3.2, '#ffe45e');
    }
    miniText(p, '1', 7, 6, OUT);
  }),
};
// ---- new items (Phase 4) ----
ICONS.muelle = mk(16, 16, (p) => { for (let i = 0; i < 4; i++) P.rect(p, 3, 4 + i * 3, 10, 2, i & 1 ? '#9aa0b4' : '#d8dce8'); P.rect(p, 2, 1, 12, 3, cyl('#e8455a')); P.rect(p, 2, 13, 12, 2, '#3a3848'); });
ICONS.mina = mk(16, 16, (p) => { P.ell(p, 8, 9, 6, 6, sph('#3a3848')); for (const [x, y] of [[8, 2], [2, 9], [14, 9], [8, 15]] as const) P.rect(p, x - 1, y - 1, 2, 2, '#6a7080'); P.rect(p, 7, 6, 2, 2, '#ff3a3a'); });
ICONS.reflector = mk(16, 16, (p) => { P.ell(p, 8, 8, 7, 7, (dx, dy) => { const d = dx * dx + dy * dy; return d > 0.65 ? '#ffd23a' : d > 0.35 ? '#fff7b0' : (dx + dy < 0 ? '#ffffff' : '#ffe45e'); }); P.line(p, 4, 11, 11, 4, '#c89a1a', 1); });
export const MINE = [false, true].map((on) => mk(14, 10, (p) => { P.ell(p, 7, 6, 6, 4, sph('#3a3848')); P.rect(p, 6, 2, 2, 2, on ? '#ff3a3a' : '#6a2a2a'); }));
export const OLA = mk(48, 20, (p) => {
  for (let x = 0; x < 48; x++) {
    const h = 8 + Math.round(Math.sin((x / 47) * Math.PI) * 9);
    for (let y = 20 - h; y < 20; y++) P.set(p, x, y, y < 22 - h ? '#ffffff' : y < 25 - h ? '#bff0ff' : (x + y) % 5 === 0 ? '#58b8f0' : '#2e9ee0');
  }
}, true);
export const REFLECT_RING = mk(44, 44, (p) => P.ell(p, 22, 22, 21, 21, (dx, dy, x, y) => { const d = dx * dx + dy * dy; return d > 0.82 ? ((x! + y!) % 4 < 2 ? '#ffd23a' : '#fff7b0') : 0; }), false);
export const PUDDLE = mk(24, 8, (p) => P.ell(p, 12, 4, 11.5, 3.5, (dx, dy) => (dx < -0.3 && dy < -0.1 ? '#4a3a60' : '#2a2040')), false);
export const TARS = mk(40, 12, (p) => { P.ell(p, 20, 6, 19.5, 5.5, (dx, dy) => (dx < -0.4 && dy < -0.2 ? '#3a3038' : '#141014')); for (const [x, y] of [[8, 5], [25, 4], [31, 7], [15, 8]] as const) P.ell(p, x, y, 1.6, 1.1, '#4a4050'); }, false);
export const SHOT = mk(12, 12, (p) => P.ell(p, 6, 6, 5, 5, sph('#8a90a4')));
export const BOOM = mk(32, 32, (p) => {
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 15 : 10; P.tri(p, 16, 16, 16 + Math.cos(a - 0.3) * 6, 16 + Math.sin(a - 0.3) * 6, 16 + Math.cos(a) * r, 16 + Math.sin(a) * r, i % 2 ? '#d8f03a' : '#ffe45e'); }
  P.ell(p, 16, 16, 7, 7, '#ffffff'); P.ell(p, 16, 16, 4, 4, '#fff7b0');
}, false);
export const RING = mk(44, 44, (p) => P.ell(p, 22, 22, 21, 21, (dx, dy, x, y) => { const d = dx * dx + dy * dy; return d > 0.82 ? ((x! + y!) % 4 < 2 ? '#8fe0ff' : '#ffffff') : (x! % 6 === 0 || y! % 6 === 0) && d > 0.3 ? '#bff0ff' : 0; }), false);

// ---- scenery ----
const WOOD = '#8a5a3a';
export const D: Record<string, Spr> = {};
D.tree = mk(22, 32, (p) => { P.rect(p, 9, 24, 4, 8, cyl(WOOD)); const g = '#3f9a3a'; for (const [y0, y1, w] of [[1, 12, 6], [6, 18, 8], [11, 25, 10.5]] as const) P.tri(p, 11 - w, y1, 11 + w, y1, 11, y0, (x, y) => { const u = (x - 11) / w, v = (y - y0) / (y1 - y0); return u < -0.35 + v * 0.2 ? shade(g, 1.25) : u < 0.25 ? g : u < 0.6 ? shade(g, 0.8) : shade(g, 0.64); }); });
D.round = mk(22, 28, (p) => { P.rect(p, 9, 18, 4, 10, cyl(WOOD)); P.ell(p, 11, 10, 10, 9.5, sph('#4fae4a')); P.ell(p, 6, 7, 1.5, 1.5, '#7fd06a'); P.ell(p, 14, 5, 1.2, 1.2, '#7fd06a'); });
D.bush = mk(16, 10, (p) => { P.ell(p, 8, 6, 7.5, 4.5, sph('#57b04a')); P.set(p, 5, 4, '#ff8ab0'); P.set(p, 10, 5, '#ffe45e'); });
D.windmill = mk(30, 48, (p) => {
  P.tri(p, 9, 47, 21, 47, 15, 14, (x) => (x < 13 ? '#fff7e0' : x < 17 ? '#e8e0d0' : '#b8b0a0')); P.rect(p, 13, 38, 4, 9, '#6a3a2a'); P.rect(p, 12, 24, 3, 3, '#3a6fb5');
  P.tri(p, 9, 17, 21, 17, 15, 9, (x) => (x < 15 ? '#e8455a' : '#b83040'));
  const hx = 15, hy = 15;
  for (const a of [0.8, 2.37, 3.94, 5.5]) { const ex = hx + Math.cos(a) * 14, ey = hy + Math.sin(a) * 14; P.line(p, hx, hy, ex, ey, '#8a5a3a', 1); P.line(p, hx + Math.cos(a) * 4 + Math.cos(a + 1.57) * 2, hy + Math.sin(a) * 4 + Math.sin(a + 1.57) * 2, ex + Math.cos(a + 1.57) * 2, ey + Math.sin(a + 1.57) * 2, '#f4f1ff', 2); }
  P.ell(p, hx, hy, 1.8, 1.8, '#3a2a55');
});
D.barn = mk(34, 26, (p) => {
  P.rect(p, 2, 10, 30, 16, (i, j) => (i < 3 ? '#e8455a' : i > 25 ? '#9a2a38' : j % 4 === 0 ? '#b83040' : '#d23c4c')); P.tri(p, 0, 11, 34, 11, 17, 1, (x) => (x < 17 ? '#6a2a30' : '#4a1a22'));
  P.rect(p, 12, 15, 10, 11, '#fff7e0'); P.rect(p, 13, 16, 8, 10, '#b83040'); P.line(p, 13, 16, 20, 25, '#fff7e0', 1); P.line(p, 20, 16, 13, 25, '#fff7e0', 1); P.rect(p, 15, 5, 4, 4, '#fff7e0');
});
D.cow = mk(18, 13, (p) => { P.rect(p, 3, 9, 2, 4, '#3a3040'); P.rect(p, 12, 9, 2, 4, '#3a3040'); P.ell(p, 9, 6, 7, 4, sph('#fff7f0')); P.ell(p, 6, 5, 2, 1.5, OUT); P.ell(p, 11, 7, 2, 1.4, OUT); P.ell(p, 15.5, 4, 2.5, 2.5, sph('#fff7f0')); P.rect(p, 15, 5, 3, 2, '#ffb3c7'); P.set(p, 14, 1, '#e8d0a0'); P.set(p, 17, 1, '#e8d0a0'); });
D.lighthouse = mk(16, 50, (p) => {
  P.rect(p, 4, 14, 8, 36, (i, j) => { const band = ((j / 6) | 0) % 2 ? '#e8455a' : '#fff7e0'; return i < 2 ? shade(band, 1.1) : i > 5 ? shade(band, 0.75) : band; }); P.rect(p, 2, 46, 12, 4, cyl('#9aa0b4'));
  P.rect(p, 3, 6, 10, 8, (_i, j) => (j > 1 && j < 6 ? '#fff09a' : '#3a3848')); P.tri(p, 2, 7, 14, 7, 8, 0, (x) => (x < 8 ? '#e8455a' : '#b83040')); P.rect(p, 2, 13, 12, 2, '#3a3848');
});
D.umbrella = mk(22, 22, (p) => { P.rect(p, 10, 8, 2, 14, '#fff7e0'); P.ell(p, 11, 9, 10.5, 7, (_dx, dy, x) => (dy > 0.05 ? 0 : ((x! / 3) | 0) % 2 ? '#e8455a' : '#fff7e0')); P.rect(p, 3, 20, 15, 2, '#2ec4b6'); });
D.surf = mk(8, 22, (p) => { P.ell(p, 4, 11, 3.5, 10.5, (dx) => (Math.abs(dx) < 0.25 ? '#e8455a' : dx < -0.5 ? '#ffffff' : '#ffe45e')); });
D.palm = mk(24, 44, (p) => {
  for (let y = 14; y < 44; y++) { const x = 12 + Math.sin(((44 - y) / 30) * 1.6) * 3 - 3; P.rect(p, x - 1.5, y, 4, 1, (y >> 1) & 1 ? '#9a6a3a' : '#7a4a2a'); }
  const cx = 12, cy = 13;
  for (const [a, l] of [[-2.8, 11], [-2.2, 12], [-1.6, 9], [-1.0, 12], [-0.35, 11], [0.3, 9]] as const) for (let t = 0; t < l; t++) { const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t + t * t * 0.05; P.ell(p, x, y, 1.8, 1.3, t % 3 ? '#3fb04a' : '#2f8a3a'); }
  P.ell(p, 11, 15, 2, 2, '#7a4a2a'); P.ell(p, 14, 15, 2, 2, '#6a3a1a');
});
D.pyramid = mk(46, 30, (p) => { P.tri(p, 0, 30, 46, 30, 23, 1, (x, y) => { const lit = x < 23 + (y - 1) * 0.02; const c = lit ? '#f0c878' : '#c8984a'; return y % 4 === 0 ? shade(c, 0.88) : c; }); });
D.camel = mk(22, 18, (p) => { P.rect(p, 5, 11, 2, 7, '#a8783a'); P.rect(p, 14, 11, 2, 7, '#a8783a'); P.ell(p, 10, 9, 7, 4, sph('#d8a458')); P.ell(p, 8, 5, 3, 3, sph('#d8a458')); P.ell(p, 13, 6, 2.5, 2.5, sph('#d8a458')); P.line(p, 16, 9, 19, 3, '#d8a458', 2); P.ell(p, 19.5, 3, 2, 1.6, sph('#d8a458')); P.set(p, 20, 2, OUT); });
D.cactus = mk(14, 26, (p) => { const g = '#4f9a4a'; P.rect(p, 5, 2, 5, 24, cyl(g)); P.ell(p, 7.5, 2.5, 2.5, 2, sph(g)); P.rect(p, 1, 10, 3, 7, cyl(g)); P.rect(p, 1, 16, 5, 2, cyl(g)); P.rect(p, 11, 7, 3, 6, cyl(g)); P.rect(p, 9, 12, 4, 2, cyl(g)); P.set(p, 7, 1, '#ff6a9a'); });
D.rock = mk(14, 8, (p) => { P.ell(p, 7, 5, 6.5, 3.5, sph('#c98a5a')); });
D.igloo = mk(26, 15, (p) => { P.ell(p, 13, 15, 12.5, 14, (dx, dy, x, y) => (dy > 0 ? 0 : y! % 4 === 0 || (x! + ((y! / 4) | 0) * 3) % 7 === 0 ? '#b8d4f0' : sph('#f4f8ff')(dx, dy))); P.ell(p, 13, 15, 4, 6, (_dx, dy) => (dy > 0 ? 0 : '#2a3a5a')); });
D.crystal = mk(14, 28, (p) => { P.tri(p, 7, 0, 1, 10, 13, 10, (x) => (x < 7 ? '#bff0ff' : '#6ac8f0')); P.rect(p, 1, 10, 12, 12, (i) => (i < 4 ? '#9ae0ff' : i < 8 ? '#5ab8e8' : '#3a8ac8')); P.tri(p, 1, 22, 13, 22, 7, 28, (x) => (x < 7 ? '#5ab8e8' : '#2a6aa8')); P.rect(p, 3, 6, 1, 12, '#ffffff'); });
D.penguin = mk(12, 16, (p) => { P.ell(p, 6, 9, 5, 6.5, sph('#2a2a3a')); P.ell(p, 6, 10, 3.4, 5, '#f4f6ff'); P.rect(p, 4, 5, 1, 1, '#ffffff'); P.rect(p, 7, 5, 1, 1, '#ffffff'); P.rect(p, 5, 7, 2, 1, '#ff9a1f'); P.rect(p, 3, 15, 2, 1, '#ff9a1f'); P.rect(p, 7, 15, 2, 1, '#ff9a1f'); });
D.snowtree = mk(22, 32, (p) => { P.rect(p, 9, 24, 4, 8, cyl(WOOD)); const g = '#2f7a6a'; for (const [y0, y1, w] of [[1, 12, 6], [6, 18, 8], [11, 25, 10.5]] as const) P.tri(p, 11 - w, y1, 11 + w, y1, 11, y0, (x, y) => { const u = (x - 11) / w, v = (y - y0) / (y1 - y0); if (v < 0.35 || (v > 0.8 && (x * 7 + y * 3) % 5 < 2)) return u < 0.3 ? '#ffffff' : '#d8e8ff'; return u < -0.2 ? shade(g, 1.2) : u < 0.35 ? g : shade(g, 0.7); }); });
D.snowman = mk(16, 24, (p) => { P.ell(p, 8, 18, 6.5, 5.5, sph('#f4f8ff')); P.ell(p, 8, 10, 4.8, 4.2, sph('#f4f8ff')); P.rect(p, 3, 12, 10, 2, '#e8455a'); P.rect(p, 10, 13, 2, 4, '#e8455a'); P.rect(p, 5, 1, 6, 5, '#2a2a3a'); P.rect(p, 4, 5, 8, 1, '#2a2a3a'); P.set(p, 6, 9, OUT); P.set(p, 9, 9, OUT); P.rect(p, 8, 10, 3, 1, '#ff8a1f'); P.set(p, 8, 16, OUT); P.set(p, 8, 19, OUT); });
for (let v = 0; v < 2; v++) {
  const R = mulberry(40 + v);
  D['building' + v] = mk(20, 44, (p) => {
    P.rect(p, 0, 2, 20, 42, (i) => (i < 2 ? (v ? '#3a2e70' : '#4a2a60') : i > 16 ? (v ? '#221a48' : '#2a1438') : v ? '#2e2458' : '#3a1f4f'));
    for (let y = 5; y < 42; y += 3) for (let x = 2; x < 18; x += 3) if (R() < 0.55) P.rect(p, x, y, 2, 1, R() < 0.5 ? '#ffe45e' : v ? '#3df0ff' : '#ff3df0');
    P.rect(p, 0, 1, 20, 1, v ? '#3df0ff' : '#ff3df0');
    if (v) P.rect(p, 9, 0, 1, 2, '#ff4d6d');
  });
}
D.lamp = mk(8, 26, (p) => { P.rect(p, 3, 6, 2, 20, '#3a3450'); P.ell(p, 4, 3, 3.6, 3, '#ff3df0'); P.ell(p, 4, 3, 1.8, 1.5, '#ffffff'); P.rect(p, 1, 24, 6, 2, '#2a2440'); });
D.lamp2 = mk(8, 26, (p) => { P.rect(p, 3, 6, 2, 20, '#3a3450'); P.ell(p, 4, 3, 3.6, 3, '#3df0ff'); P.ell(p, 4, 3, 1.8, 1.5, '#ffffff'); P.rect(p, 1, 24, 6, 2, '#2a2440'); });
D.billboard = mk(40, 30, (p) => { P.rect(p, 6, 18, 2, 12, '#3a3450'); P.rect(p, 32, 18, 2, 12, '#3a3450'); P.rect(p, 0, 0, 40, 19, '#ff3df0'); P.rect(p, 1, 1, 38, 17, '#1a1033'); miniText(p, 'JP', 4, 3, '#3df0ff', 3); miniText(p, 'KART', 28, 4, '#ffe45e', 1); miniText(p, 'GO', 28, 11, '#ff3df0', 1); });
D.obsidian = mk(12, 32, (p) => { P.tri(p, 0, 32, 12, 32, 5, 0, (x) => (x < 4 ? '#6a4a8a' : x < 7 ? '#3a2a55' : '#241a38')); P.line(p, 4, 4, 2, 30, '#9a7ac8', 1); });
D.skull = mk(24, 18, (p) => { P.ell(p, 12, 10, 11, 8, sph('#6a5a60')); P.ell(p, 8, 9, 2.6, 2.8, OUT); P.ell(p, 16, 9, 2.6, 2.8, OUT); P.set(p, 8, 9, '#ff6a2a'); P.set(p, 16, 9, '#ff6a2a'); P.rect(p, 10, 14, 4, 2, OUT); });
D.geyser = mk(12, 26, (p) => { P.ell(p, 6, 23, 5.5, 3, sph('#4a3036')); for (let y = 2; y < 22; y++) { const w = 2 + Math.sin(y * 0.7) * 1 + (22 - y) * 0.08; P.rect(p, 6 - w, y, w * 2, 1, y % 3 ? '#ff8a1f' : '#ffe45e'); } P.ell(p, 6, 3, 3, 2.5, '#ffe45e'); });
D.darkrock = mk(16, 10, (p) => { P.ell(p, 8, 6, 7.5, 4.5, sph('#4a3036')); P.line(p, 4, 6, 9, 4, '#ff6a2a', 1); P.line(p, 9, 4, 12, 7, '#ff8a1f', 1); });
D.deadtree = mk(18, 30, (p) => { const c = '#3a2a2e'; P.line(p, 9, 30, 9, 10, c, 2); P.line(p, 9, 16, 3, 8, c, 1); P.line(p, 9, 13, 15, 5, c, 1); P.line(p, 4, 9, 2, 3, c, 1); P.line(p, 14, 6, 16, 1, c, 1); P.line(p, 9, 10, 8, 3, c, 1); });
D.stands = mk(48, 24, (p) => { for (let r = 0; r < 5; r++) { P.rect(p, r * 2, 4 + r * 4, 48 - r * 4, 4, r % 2 ? '#c8ccdc' : '#aab0c4'); for (let x = r * 2 + 1; x < 46 - r * 2; x += 3) P.rect(p, x, 4 + r * 4, 2, 2, ['#e8455a', '#2f6bff', '#ffe45e', '#2ec46b', '#ff8a1f', '#fff0e6'][(x * 7 + r * 3) % 6]!); } P.rect(p, 0, 0, 48, 4, '#2ec46b'); miniText(p, 'JP', 19, 0, '#fff7e0', 1); });
D.umpire = mk(14, 28, (p) => { P.rect(p, 2, 10, 2, 18, '#fff7e0'); P.rect(p, 10, 10, 2, 18, '#fff7e0'); P.rect(p, 2, 16, 10, 1, '#fff7e0'); P.rect(p, 1, 8, 12, 3, '#2ec46b'); P.ell(p, 7, 4, 3, 3, sph('#e0a878')); P.rect(p, 4, 1, 6, 2, '#fff7e0'); });
D.net = mk(36, 12, (p) => { P.rect(p, 0, 0, 2, 12, '#9aa0b4'); P.rect(p, 34, 0, 2, 12, '#9aa0b4'); P.rect(p, 2, 1, 32, 1, '#ffffff'); P.rect(p, 2, 2, 32, 8, (i, j) => (i % 3 === 0 || j % 3 === 0 ? '#e8e8f0' : 0)); P.rect(p, 2, 10, 32, 1, '#ffffff'); });
D.bigball = BIGBALL;
D.fence = mk(18, 12, (p) => { P.rect(p, 1, 1, 3, 11, cyl('#9a6a3a')); P.rect(p, 14, 1, 3, 11, cyl('#9a6a3a')); P.rect(p, 0, 3, 18, 2, '#c89a5a'); P.rect(p, 0, 7, 18, 2, '#b0804a'); });
D.buoy = mk(8, 16, (p) => { P.rect(p, 1, 2, 6, 14, (_i, j) => (((j / 3) | 0) % 2 ? '#fff7e0' : '#e8455a')); P.ell(p, 4, 2, 3, 2, '#e8455a'); });
D.stake = mk(8, 16, (p) => { P.rect(p, 2, 2, 4, 14, cyl('#a8783a')); P.tri(p, 2, 2, 6, 2, 4, 0, '#a8783a'); P.rect(p, 0, 5, 8, 1, '#e8d0a0'); });
D.iceblock = mk(16, 12, (p) => { P.rect(p, 0, 0, 16, 12, (i, j) => (i < 3 || j < 2 ? '#e8f8ff' : i > 12 ? '#7ab8e8' : '#aee0ff')); P.line(p, 4, 3, 9, 8, '#ffffff', 1); });
D.neonpost = mk(6, 22, (p) => { P.rect(p, 2, 4, 2, 18, '#3a3450'); P.rect(p, 0, 0, 6, 5, '#3df0ff'); P.rect(p, 1, 1, 4, 3, '#ffffff'); });
D.neonpost2 = mk(6, 22, (p) => { P.rect(p, 2, 4, 2, 18, '#3a3450'); P.rect(p, 0, 0, 6, 5, '#ff3df0'); P.rect(p, 1, 1, 4, 3, '#ffffff'); });
D.bollard = mk(14, 10, (p) => { P.ell(p, 7, 6, 6.5, 4, sph('#4a3036')); P.rect(p, 3, 4, 8, 1, '#ff6a2a'); });
D.windscreen = mk(20, 14, (p) => { P.rect(p, 0, 0, 2, 14, '#9aa0b4'); P.rect(p, 18, 0, 2, 14, '#9aa0b4'); P.rect(p, 2, 1, 16, 11, (i, j) => ((i + j) % 3 === 0 ? '#3f8a4a' : '#2e6a3a')); });
D.arch = mk(72, 44, (p) => {
  for (const x of [2, 64]) P.rect(p, x, 8, 6, 36, (i, j) => (((i >> 1) + (j >> 1)) % 2 ? '#ffffff' : '#1a1026'));
  P.rect(p, 0, 2, 72, 12, '#e8455a'); P.rect(p, 0, 2, 72, 2, '#ff8a9a'); P.rect(p, 0, 12, 72, 2, '#9a2a38');
  const s = 2, t = 'JP KART';
  miniText(p, t, (72 - miniW(t, s)) >> 1, 3, '#ffe45e', s);
});
D.purpletree = mk(22, 30, (p) => { P.rect(p, 9, 20, 4, 10, cyl('#5a3a4a')); P.ell(p, 11, 11, 10, 10, sph('#9a5ad0')); P.ell(p, 7, 8, 1.5, 1.5, '#ffb0ff'); P.ell(p, 15, 13, 1.2, 1.2, '#ffb0ff'); });
D.mushroom = mk(16, 16, (p) => { P.rect(p, 6, 8, 4, 8, cyl('#f4ecd8')); P.ell(p, 8, 7, 7.5, 5, (dx, dy) => (dy > 0.4 ? 0 : sph('#e8455a')(dx, dy))); for (const [x, y] of [[5, 4], [10, 3], [8, 6], [12, 6]] as const) P.rect(p, x, y, 2, 1, '#ffffff'); });
D.fern = mk(18, 12, (p) => { for (let i = -3; i <= 3; i++) P.line(p, 9, 12, 9 + i * 2.5, 2 + Math.abs(i), i % 2 ? '#3fae3a' : '#2f8a2e', 1); });

/** World height of each scenery sprite (units). */
export const DH: Record<string, number> = {
  tree: 40, round: 32, bush: 12, windmill: 70, barn: 40, cow: 13, lighthouse: 80, umbrella: 20, surf: 18, palm: 52, pyramid: 80, camel: 22, cactus: 30, rock: 10, igloo: 22, crystal: 34, penguin: 14, snowtree: 42, snowman: 24,
  building0: 90, building1: 90, lamp: 34, lamp2: 34, billboard: 48, obsidian: 40, skull: 22, geyser: 34, darkrock: 12, deadtree: 32, stands: 44, umpire: 28, net: 14, bigball: 30,
  fence: 11, buoy: 13, stake: 12, iceblock: 11, neonpost: 22, neonpost2: 22, bollard: 10, windscreen: 13, arch: 66, purpletree: 40, mushroom: 16, fern: 12,
};
