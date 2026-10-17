// Makes straights of an authored track technical (V3-5, docs/V3_PLAN.md §3 V3-5.4): inside the given ranges of the lap the
// control points are replaced by a zig-zag across the centerline (a chicane or a wider "esse"), so the lap gets corners that
// reward handling and mini-turbo (the light pilots) instead of pure top speed (the heavy ones).
// Usage: bun packages/core/tools/technicalize.ts <track-id> <from-to:kind[:amp[:spacing]]> ...   (kind: chicane | esse)
//   e.g. bun packages/core/tools/technicalize.ts pradera-jp 0.095-0.19:chicane 0.545-0.60:esse
// It rewrites core/data/tracks/<id>.json (the spline only) and reports the new length and the closest approach between parts.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dhypot, dcos, dsin, datan2 } from '../src/dmath';
import { splineSamples } from '../src/track/authored';

const [id, ...specs] = process.argv.slice(2);
if (!id || !specs.length) { console.log('uso: bun technicalize.ts <id> <from-to:kind[:amp[:spacing]]> ...'); process.exit(1); }
const file = join(import.meta.dir, '../data/tracks', id + '.json');
const a = JSON.parse(readFileSync(file, 'utf8'));
const S = splineSamples(a.spline, true), N = S.length;
const ang = (i: number) => datan2(S[(i + 1) % N]!.y - S[(i - 1 + N) % N]!.y, S[(i + 1) % N]!.x - S[(i - 1 + N) % N]!.x);
const nearest = (x: number, y: number) => { let b = 0, bd = 1e18; for (let i = 0; i < N; i++) { const d = (S[i]!.x - x) ** 2 + (S[i]!.y - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };

interface Edit { i0: number; i1: number; kind: string; amp: number; spacing: number }
const edits: Edit[] = specs.map((s) => {
  const [rng, kind = 'chicane', amp, sp] = s.split(':'), [f0, f1] = rng!.split('-').map(Number);
  return { i0: Math.floor(f0! * N), i1: Math.floor(f1! * N), kind, amp: Number(amp ?? (kind === 'esse' ? 75 : 40)), spacing: Number(sp ?? (kind === 'esse' ? 180 : 120)) };
});

type Pt = { i: number; x: number; y: number; h: number; w: number };
const keep: Pt[] = a.spline.map((p: Pt) => ({ ...p, i: nearest(p.x, p.y) })).filter((p: Pt) => !edits.some((e) => p.i > e.i0 - 10 && p.i < e.i1 + 10));
const added: Pt[] = [];
for (const e of edits) {
  const span = e.i1 - e.i0, step = Math.max(8, Math.round(e.spacing / 6)), n = Math.max(2, Math.round(span / step));
  for (let k = 0; k <= n; k++) {
    const i = e.i0 + Math.round((span * k) / n), off = k === 0 || k === n ? 0 : (k % 2 ? 1 : -1) * e.amp, an = ang(i), q = S[i]!;
    added.push({ i, x: Math.round(q.x - dsin(an) * off), y: Math.round(q.y + dcos(an) * off), h: Math.round(q.h), w: Math.round(q.w) });
  }
}
const all = [...keep, ...added].sort((p, q) => p.i - q.i);
a.spline = all.map(({ x, y, h, w }) => ({ x, y, h, w }));

// report
const S2 = splineSamples(a.spline, true), N2 = S2.length;
let minSep = 1e9, at = '';
for (let i = 0; i < N2; i += 2) for (let j = i + 60; j < N2; j += 2) {
  if (N2 - (j - i) < 60) continue;
  const d = dhypot(S2[i]!.x - S2[j]!.x, S2[i]!.y - S2[j]!.y) - S2[i]!.w - S2[j]!.w;
  if (d < minSep) { minSep = d; at = `${(i / N2).toFixed(3)}↔${(j / N2).toFixed(3)}`; }
}
let kmax = 0;
for (let i = 0; i < N2; i++) { const p = S2[(i - 5 + N2) % N2]!, q = S2[i]!, r = S2[(i + 5) % N2]!; const a1 = datan2(q.y - p.y, q.x - p.x), a2 = datan2(r.y - q.y, r.x - q.x); let da = Math.abs(a2 - a1); if (da > Math.PI) da = 2 * Math.PI - da; kmax = Math.max(kmax, da / 60); }
console.log(`${id}: ${N} → ${N2} muestras (${((N2 / N - 1) * 100).toFixed(1)} %), separación mínima entre tramos ${minSep.toFixed(0)} u (${at}), curvatura máx ${kmax.toFixed(4)} /u (radio ${(1 / kmax).toFixed(0)} u)`);
if (minSep < 40) { console.log('✗ demasiado cerca de otro tramo: no se escribe'); process.exit(2); }
writeFileSync(file, JSON.stringify(a, null, 2) + '\n');
