// Designer helper: length, control-point fractions, curvature and self-proximity of an authored track.
// Usage: bun packages/core/tools/track-info.ts packages/core/data/tracks/<id>.json
import { readFileSync } from 'node:fs';
import { dhypot, wrapA } from '../src';
import { prepAuthored, splineSamples } from '../src/track/authored';
import type { AuthoredTrackDef } from '../src/track/authoredTypes';

const def = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as AuthoredTrackDef;
const tr = prepAuthored(def);
const N = tr.N;
console.log(`${def.name}: N=${N} muestras, longitud ≈ ${(N * 6).toFixed(0)} u (vuelta a 130 u/s ≈ ${((N * 6) / 130).toFixed(1)} s)`);
// fraction of each control point = nearest sample index / N
const fr = def.spline.map((p, k) => {
  let best = 0, bd = 1e12;
  for (let i = 0; i < N; i++) { const d = dhypot(tr.x[i]! - p.x, tr.y[i]! - p.y); if (d < bd) { bd = d; best = i; } }
  return `P${k}=${(best / N).toFixed(3)}`;
});
console.log('fracciones:', fr.join(' '));
// tight corners: heading change over 60 units
const tight: string[] = [];
for (let i = 0; i < N; i += 5) { const c = Math.abs(wrapA(tr.ang[(i + 10) % N]! - tr.ang[i]!)); if (c > 0.9) tight.push(`${(i / N).toFixed(2)}(${c.toFixed(2)})`); }
console.log('curvas cerradas (>0.9 rad/60u):', tight.join(' ') || '—');
// self proximity: min distance between samples more than 40 apart along the track
let minD = 1e9, at = '';
for (let i = 0; i < N; i += 2)
  for (let j = i + 40; j < N; j += 2) {
    if (N - (j - i) < 40) continue;
    const d = dhypot(tr.x[i]! - tr.x[j]!, tr.y[i]! - tr.y[j]!);
    if (d < minD) { minD = d; at = `${(i / N).toFixed(3)}↔${(j / N).toFixed(3)}`; }
  }
console.log(`proximidad mínima entre tramos: ${minD.toFixed(0)} u en ${at} (mínimo seguro ≈ 2×46+40 = 132)`);
for (const b of tr.branches) {
  let L = 0;
  for (let i = 1; i < b.n; i++) L += dhypot(b.x[i]! - b.x[i - 1]!, b.y[i]! - b.y[i - 1]!);
  const main = ((b.i1 - b.i0 + N) % N) * 6;
  console.log(`atajo ${(b.i0 / N).toFixed(2)}→${(b.i1 / N).toFixed(2)}: ${L.toFixed(0)} u vs ${main} u por la pista (ahorra ${(main - L).toFixed(0)} u)`);
}
void splineSamples;
