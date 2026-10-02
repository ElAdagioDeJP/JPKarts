export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const TAU = Math.PI * 2;

export function wrapA(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** mulberry32 as a pure function generator (legacy `mulberry`). Used for track building. */
export function mulberry(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Serializable seeded RNG (mulberry32). Its whole state is `s`. */
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(n: number): number {
    return (this.next() * n) | 0;
  }
  pick<T>(a: readonly T[]): T {
    return a[(this.next() * a.length) | 0]!;
  }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (this.next() * (i + 1)) | 0;
      const t = a[i]!;
      a[i] = a[j]!;
      a[j] = t;
    }
    return a;
  }
}

/** Value noise used by track building (legacy `vnoise`). */
export function vnoise(R: () => number) {
  const G = 64;
  const v = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < v.length; i++) v[i] = R();
  const h = (a: number, b: number) => v[(((a % G) + G) % G) * (G + 1) + (((b % G) + G) % G)]!;
  return (x: number, y: number, cell: number) => {
    const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy);
    let fx = gx - ix, fy = gy - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };
}

export const fmtTime = (t: number | null) => {
  if (t == null) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + s.toFixed(2).padStart(5, '0');
};
