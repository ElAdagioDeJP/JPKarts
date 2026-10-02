// Deterministic math. JS engines (V8, JavaScriptCore) may return different last bits for
// Math.sin/cos/atan2/exp/pow/hypot. These ports of fdlibm use only IEEE-754 basic operations
// (+ − × ÷, sqrt), so results are bit-identical on every engine: required for replays and netcode.

const buf = new DataView(new ArrayBuffer(8));
/** 2^k for integer k in [-1022, 1023], exact. */
function pow2i(k: number): number {
  buf.setUint32(0, ((k + 1023) << 20) >>> 0);
  buf.setUint32(4, 0);
  return buf.getFloat64(0);
}

// ---- sin / cos ----
const PIO2_1 = 1.57079632673412561417e+0, PIO2_1T = 6.07710050650619224932e-11, INV_PIO2 = 6.36619772367581382433e-1;
const S1 = -1.66666666666666324348e-1, S2 = 8.33333333332248946124e-3, S3 = -1.98412698298579493134e-4, S4 = 2.75573137070700676789e-6, S5 = -2.50507602534068634195e-8, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2, C2 = -1.38888888888741095749e-3, C3 = 2.48015872894767294178e-5, C4 = -2.75573143513906633035e-7, C5 = 2.08757232129817482790e-9, C6 = -1.13596475577881948265e-11;
const kSin = (r: number) => { const z = r * r; return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))))); };
const kCos = (r: number) => { const z = r * r; return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))); };

export function dsin(x: number): number {
  const n = Math.round(x * INV_PIO2), r = x - n * PIO2_1 - n * PIO2_1T;
  switch (n & 3) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}
export function dcos(x: number): number {
  const n = Math.round(x * INV_PIO2), r = x - n * PIO2_1 - n * PIO2_1T;
  switch (n & 3) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}

// ---- atan / atan2 ----
const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e+0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2];
export function datan(x: number): number {
  const neg = x < 0;
  let ax = neg ? -x : x, id = -1;
  if (ax >= 2.4375) { id = 3; ax = -1 / ax; }
  else if (ax >= 1.1875) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); }
  else if (ax >= 0.6875) { id = 1; ax = (ax - 1) / (ax + 1); }
  else if (ax >= 0.4375) { id = 0; ax = (2 * ax - 1) / (2 + ax); }
  const z = ax * ax, w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  let r: number;
  if (id < 0) r = ax - ax * (s1 + s2);
  else r = ATANHI[id]! - (ax * (s1 + s2) - ATANLO[id]! - ax);
  return neg ? -r : r;
}
export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + Math.PI : datan(y / x) - Math.PI;
  return y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0;
}

// ---- exp / log / pow ----
const LN2_HI = 6.93147180369123816490e-1, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+0;
const P1 = 1.66666666666666019037e-1, P2 = -2.77777777770155933842e-3, P3 = 6.61375632143793436117e-5, P4 = -1.65339022054652515390e-6, P5 = 4.13813679705723846039e-8;
export function dexp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x * INV_LN2), hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo, t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  if (k < -1021) return y * pow2i(k + 64) * pow2i(-64);
  if (k > 1023) return y * pow2i(k - 1) * 2;
  return y * pow2i(k);
}
const LG1 = 6.666666666666735130e-1, LG2 = 3.999999999940941908e-1, LG3 = 2.857142874366239149e-1, LG4 = 2.222219843214978396e-1, LG5 = 1.818357216161805012e-1, LG6 = 1.531383769920937332e-1, LG7 = 1.479819860511658591e-1;
export function dlog(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return x;
  buf.setFloat64(0, x);
  let hx = buf.getUint32(0), k = 0;
  if (hx < 0x00100000) { x *= 18014398509481984; k -= 54; buf.setFloat64(0, x); hx = buf.getUint32(0); } // subnormal
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000; // normalize mantissa into [sqrt(2)/2, sqrt(2))
  buf.setUint32(0, (hx | (i ^ 0x3ff00000)) >>> 0);
  k += i >>> 20;
  const m = buf.getFloat64(0), f = m - 1, s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7))), R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}
/** a^b for a ≥ 0 (enough for the simulation's uses). */
export function dpow(a: number, b: number): number {
  if (b === 0) return 1;
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a < 0) throw new Error('dpow: base negativa');
  return dexp(b * dlog(a));
}
export const dhypot = (x: number, y: number) => Math.sqrt(x * x + y * y);
