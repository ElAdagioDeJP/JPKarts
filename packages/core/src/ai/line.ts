// AI navigation layer: precomputed racing line (lateral offset per sample) and curvature.
// Deterministic (only + − × ÷ √ and dmath), computed once per track build.
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { clamp, wrapA } from '../math';
import { T } from '../tunables';
import type { Track } from '../track/track';

export interface RacingLine {
  /** lateral offset of the line at each sample (> 0 = right) */
  off: Float32Array;
  /** curvature (rad per unit) of the line at each sample */
  kappa: Float32Array;
  /** line points */
  x: Float32Array;
  y: Float32Array;
}

/** Minimum-curvature line: iteratively pull each point towards the midpoint of its neighbours, clamped to the road. */
export function computeRacingLine(tr: Track): RacingLine {
  const N = tr.N, L = T.ai.line, off = new Float32Array(N);
  const nx = new Float64Array(N), ny = new Float64Array(N), lim = new Float64Array(N);
  for (let i = 0; i < N; i++) { nx[i] = -dsin(tr.ang[i]!); ny[i] = dcos(tr.ang[i]!); lim[i] = Math.max(0, tr.wd[i]! - L.margin); }
  const px = (i: number) => tr.x[i]! + nx[i]! * off[i]!, py = (i: number) => tr.y[i]! + ny[i]! * off[i]!;
  for (let it = 0; it < L.iterations; it++)
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      const mx = (px(a) + px(b)) / 2 - tr.x[i]!, my = (py(a) + py(b)) / 2 - tr.y[i]!;
      const want = mx * nx[i]! + my * ny[i]!;
      off[i] = clamp(off[i]! + L.relax * (want - off[i]!), -lim[i]!, lim[i]!);
    }
  const x = new Float32Array(N), y = new Float32Array(N), kappa = new Float32Array(N);
  for (let i = 0; i < N; i++) { x[i] = px(i); y[i] = py(i); }
  for (let i = 0; i < N; i++) {
    const a = (i - 3 + N) % N, b = (i + 3) % N, c = (i + 9) % N, d = (i - 9 + N) % N;
    const h1 = datan2(y[b]! - y[a]!, x[b]! - x[a]!), h2 = datan2(y[c]! - y[i]!, x[c]! - x[i]!), h0 = datan2(y[i]! - y[d]!, x[i]! - x[d]!);
    const ds = dhypot(x[c]! - x[d]!, y[c]! - y[d]!) || 1;
    kappa[i] = Math.abs(wrapA(h2 - h0)) / ds;
    void h1;
  }
  return { off, kappa, x, y };
}

/** Highest speed the kart can carry through sample i (its yaw rate limits the radius). */
export function cornerSpeed(line: RacingLine, i: number, yawRate: number): number {
  const L = T.ai.line, k = line.kappa[i]!;
  return k < 1e-5 ? L.vmax : clamp(yawRate / k, L.vmin, L.vmax);
}

/** Target speed now: the slowest corner ahead, allowing braking distance (v² = vc² + 2·a·d). */
export function targetSpeed(tr: Track, line: RacingLine, idx: number, yawRate: number): number {
  const L = T.ai.line, N = tr.N;
  let best = L.vmax;
  for (let j = 0; j < L.brakeLook * 4; j += 2) {
    const i = (idx + j) % N, vc = cornerSpeed(line, i, yawRate), dist = j * 6;
    const v = Math.sqrt(vc * vc + 2 * L.decel * dist);
    if (v < best) best = v;
  }
  return best;
}
