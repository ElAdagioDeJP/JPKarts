// Procedural pixel art toolkit (ported from legacy/jp-kart.html).
export const OUT = '#1a1026';
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export const hexRGB = (h: string): [number, number, number] => {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const toU32 = (h: string) => {
  const [r, g, b] = hexRGB(h);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const SHC = new Map<string, string>();
export const shade = (h: string, f: number): string => {
  const key = h + f;
  let v = SHC.get(key);
  if (v) return v;
  const [r, g, b] = hexRGB(h);
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * f)));
  v = '#' + [c(r), c(g), c(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  SHC.set(key, v);
  return v;
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Spr {
  cv: HTMLCanvasElement;
  w: number;
  h: number;
  px: Uint32Array;
}
export interface PXBuf {
  w: number;
  h: number;
  a: (string | 0)[];
}
type ColFn = string | 0 | ((...args: number[]) => string | 0);

export function spr(c: HTMLCanvasElement): Spr {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  return { cv: c, w: c.width, h: c.height, px: new Uint32Array(d.data.buffer) };
}
export function PX(w: number, h: number): PXBuf {
  return { w, h, a: new Array(w * h).fill(0) };
}
const col = (c: ColFn, ...a: number[]): string | 0 => (typeof c === 'function' ? c(...a) : c);

export const P = {
  set(p: PXBuf, x: number, y: number, c: string | 0) {
    if (!c) return;
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < p.w && y < p.h) p.a[y * p.w + x] = c;
  },
  get(p: PXBuf, x: number, y: number) {
    return x >= 0 && y >= 0 && x < p.w && y < p.h ? p.a[y * p.w + x] : 0;
  },
  rect(p: PXBuf, x: number, y: number, w: number, h: number, c: ColFn) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P.set(p, x + i, y + j, col(c, i, j, w, h));
  },
  ell(p: PXBuf, cx: number, cy: number, rx: number, ry: number, c: ColFn) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) P.set(p, x, y, col(c, dx, dy, x, y));
      }
  },
  tri(p: PXBuf, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: ColFn) {
    const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx)), y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
    const s = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5, d1 = s(px, py, ax, ay, bx, by), d2 = s(px, py, bx, by, cx, cy), d3 = s(px, py, cx, cy, ax, ay);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) P.set(p, x, y, col(c, x, y));
      }
  },
  line(p: PXBuf, x0: number, y0: number, x1: number, y1: number, c: ColFn, t = 1) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const x = lerp(x0, x1, i / n), y = lerp(y0, y1, i / n);
      P.rect(p, Math.floor(x - t / 2 + 0.5), Math.floor(y - t / 2 + 0.5), t, t, c);
    }
  },
  outline(p: PXBuf, c: string = OUT) {
    const o = p.a.slice();
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        if (o[y * p.w + x]) continue;
        if ((x > 0 && o[y * p.w + x - 1]) || (x < p.w - 1 && o[y * p.w + x + 1]) || (y > 0 && o[(y - 1) * p.w + x]) || (y < p.h - 1 && o[(y + 1) * p.w + x])) p.a[y * p.w + x] = c;
      }
  },
  toSpr(p: PXBuf): Spr {
    const c = document.createElement('canvas');
    c.width = p.w;
    c.height = p.h;
    const g = c.getContext('2d')!;
    for (let i = 0; i < p.a.length; i++)
      if (p.a[i]) {
        g.fillStyle = p.a[i] as string;
        g.fillRect(i % p.w, (i / p.w) | 0, 1, 1);
      }
    return spr(c);
  },
};

export function mk(w: number, h: number, draw: (p: PXBuf) => void, outline = true): Spr {
  const p = PX(w, h);
  draw(p);
  if (outline) P.outline(p);
  return P.toSpr(p);
}
export function sph(base: string) {
  const hi = shade(base, 1.32), lo = shade(base, 0.78), dk = shade(base, 0.6);
  return (dx: number, dy: number) => {
    const l = -(dx * 0.62 + dy * 0.78);
    return l > 0.5 ? hi : l > -0.05 ? base : l > -0.5 ? lo : dk;
  };
}
export function cyl(base: string) {
  const hi = shade(base, 1.28), lo = shade(base, 0.78), dk = shade(base, 0.6);
  return (i: number, _j: number, w: number) => {
    const u = i / (w - 1 || 1);
    return u < 0.25 ? hi : u < 0.6 ? base : u < 0.85 ? lo : dk;
  };
}
// mini 3x5 font
const MINI: Record<string, string[]> = {
  J: ['001', '001', '001', '101', '010'], P: ['110', '101', '110', '100', '100'], K: ['101', '101', '110', '101', '101'], A: ['010', '101', '111', '101', '101'],
  R: ['110', '101', '110', '101', '101'], T: ['111', '010', '010', '010', '010'], ' ': ['000', '000', '000', '000', '000'],
  O: ['010', '101', '101', '101', '010'], E: ['111', '100', '110', '100', '111'], N: ['101', '111', '111', '111', '101'], I: ['111', '010', '010', '010', '111'],
  S: ['011', '100', '010', '001', '110'], C: ['011', '100', '100', '100', '011'], L: ['100', '100', '100', '100', '111'], U: ['101', '101', '101', '101', '111'],
  B: ['110', '101', '110', '101', '110'], G: ['011', '100', '101', '101', '011'], '1': ['010', '110', '010', '010', '111'],
};
export function miniText(p: PXBuf, str: string, x: number, y: number, c: string, s = 1) {
  let cx = x;
  for (const ch of str) {
    const g = MINI[ch] || MINI[' ']!;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j]![i] === '1') P.rect(p, cx + i * s, y + j * s, s, s, c);
    cx += 4 * s;
  }
}
export const miniW = (str: string, s = 1) => str.length * 4 * s - s;
export function mulberry(s: number) {
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
