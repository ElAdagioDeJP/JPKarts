// Chasm checks (V3-5, docs/V3_PLAN.md §2.6): is there a way around a chasm on the ground? Used by the track validator and tests.
// It mirrors what the simulation lets a kart do: it cannot stand on the canyon floor (it is rescued), and next to samples whose
// walls are flagged it cannot leave the road (wallCollide pushes it back), so those cells are blocked too.
import { T } from '../tunables';
import type { Track } from './track';

type Chasm = Track['chasms'][number];

const inRange = (i: number, a: number, b: number) => (a <= b ? i >= a && i <= b : i >= a || i <= b);

/** Nearest centerline sample of a point (brute force: only used by the validator on a small window). */
function nearest(tr: Track, x: number, y: number): [number, number] {
  let best = 0, bd = 1e18;
  for (let i = 0; i < tr.N; i++) { const dx = tr.x[i]! - x, dy = tr.y[i]! - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  return [best, Math.sqrt(bd)];
}

/**
 * Flood fill (8 units per cell) in a window around the chasm. Starts on the road where a rescued kart reappears and asks whether the
 * road just after the canyon can be reached without crossing it. `true` = there is a way around (the track is broken).
 */
export function chasmHasLandPath(tr: Track, c: Chasm, cell = 8, debug?: { path: [number, number][] }): boolean {
  const N = tr.N, CH = T.race.chasm, W = T.driving.wall;
  const pad = CH.wallPad, span = ((c.i1 - c.i0 + N) % N) + 1;
  const a = (c.i0 - pad - 10 + N) % N;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let n = 0; n < span + 2 * pad + 20; n++) {
    const i = (a + n) % N;
    x0 = Math.min(x0, tr.x[i]!); x1 = Math.max(x1, tr.x[i]!); y0 = Math.min(y0, tr.y[i]!); y1 = Math.max(y1, tr.y[i]!);
  }
  const M = 200;
  x0 -= M; y0 -= M; x1 += M; y1 += M;
  const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
  // blocked(cell): canyon, or beside walled samples beyond the road edge
  const near = new Int16Array(nx * ny).fill(-2); // memo: -2 unknown, -1 blocked, 0 free
  const blocked = (gx: number, gy: number): boolean => {
    const k = gy * nx + gx;
    if (near[k] !== -2) return near[k] === -1;
    const px = x0 + (gx + 0.5) * cell, py = y0 + (gy + 0.5) * cell, [i, d] = nearest(tr, px, py);
    let b = false;
    if (tr.chasms.some((q) => inRange(i, q.i0, q.i1) && d < tr.wd[i]! + CH.edge)) b = true; // canyon floor
    else if (d > tr.wd[i]! + W.gap && tr.wallL[i] && tr.wallR[i]) b = true; // pushed back to the road
    near[k] = b ? -1 : 0;
    return b;
  };
  const cellOf = (i: number): [number, number] => [Math.floor((tr.x[i]! - x0) / cell), Math.floor((tr.y[i]! - y0) / cell)];
  const [sx, sy] = cellOf((c.i0 - CH.rescueBack + N) % N), [tx, ty] = cellOf((c.i1 + 4) % N);
  const seen = new Uint8Array(nx * ny), stack: number[] = [sy * nx + sx], parent = debug ? new Int32Array(nx * ny).fill(-1) : null;
  seen[sy * nx + sx] = 1;
  while (stack.length) {
    const k = stack.pop()!, gx = k % nx, gy = (k / nx) | 0;
    if (Math.abs(gx - tx) <= 1 && Math.abs(gy - ty) <= 1) {
      if (debug && parent) for (let q = k; q >= 0; q = parent[q]!) debug.path.push([x0 + ((q % nx) + 0.5) * cell, y0 + (((q / nx) | 0) + 0.5) * cell]);
      return true;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ax = gx + dx, ay = gy + dy;
      if (ax < 0 || ay < 0 || ax >= nx || ay >= ny || seen[ay * nx + ax] || blocked(ax, ay)) continue;
      seen[ay * nx + ax] = 1;
      if (parent) parent[ay * nx + ax] = k;
      stack.push(ay * nx + ax);
    }
  }
  return false;
}
