// Track validator (docs/GDD.md §6.5). Runs in CI: `bun run validate:tracks [id...]`.
// Fails when: the centerline self-intersects, the road is narrower than the cup minimum, a shortcut needs
// something impossible, the hard AI cannot finish 3 laps with 3 seeds, or the lap is out of range.
// Lap metric (GDD §6.5): the race length the cup promises is the one of a typical racer, so `lapSeconds` applies to
// the median finisher (4th of 8). The winner (hard AI snowballing coins) may be faster, down to 85 % of the minimum.
import { AUTHORED } from '../src/data/authoredTracks';
import { LAPS, Rng, buildGrid, buildTrack, createWorld, dhypot, step, takeEvents, itemList } from '../src';
import { prepAuthored } from '../src/track/authored';
import type { AuthoredTrackDef } from '../src/track/authoredTypes';

const want = process.argv.slice(2);
const list = AUTHORED.filter((a) => !want.length || want.includes(a.id));
let failed = 0;

function check(a: AuthoredTrackDef) {
  const errs: string[] = [], notes: string[] = [];
  const tr = buildTrack(prepAuthored(a)), N = tr.N;
  // geometry
  let minW = 1e9;
  for (let i = 0; i < N; i++) minW = Math.min(minW, tr.wd[i]!);
  if (minW < a.metrics.minHalfWidth) errs.push(`semiancho mínimo ${minW.toFixed(1)} < ${a.metrics.minHalfWidth} de la copa`);
  for (let i = 0; i < N; i += 2)
    for (let j = i + 40; j < N; j += 2) {
      if (N - (j - i) < 40) continue;
      const d = dhypot(tr.x[i]! - tr.x[j]!, tr.y[i]! - tr.y[j]!), sep = tr.wd[i]! + tr.wd[j]!;
      if (d < sep && Math.abs(tr.hc[i]! - tr.hc[j]!) < 20) { errs.push(`la pista se cruza consigo misma (${(i / N).toFixed(3)} ↔ ${(j / N).toFixed(3)})`); i = N; break; }
    }
  const ids = new Set(itemList().map((x) => x.id));
  for (const b of a.branches) if (b.needs && !ids.has(b.needs)) errs.push(`atajo ${b.from}→${b.to}: necesita "${b.needs}", que no existe`);
  // AI: hard difficulty, 3 seeds, 3 laps
  const laps: number[] = [], wins: number[] = [];
  for (const seed of [101, 202, 303]) {
    const grid = buildGrid(new Rng(seed), [], { humanSlot: 0 });
    const w = createWorld({ trackIndex: 0, diff: 2, seed, laps: LAPS, grid }, tr);
    const lapAt: number[][] = w.karts.map(() => []);
    let falls = 0;
    for (let t = 0; t < 60 * 60 * 6 && w.phase !== 'results'; t++) {
      step(w, []);
      for (const e of takeEvents(w)) {
        if (e.type === 'lap' || e.type === 'finish') lapAt[e.type === 'lap' ? e.kart : e.kart]!.push(w.raceT);
        if (e.type === 'fall') falls++;
      }
    }
    if (w.phase !== 'results') { errs.push(`semilla ${seed}: la IA difícil no termina 3 vueltas en 6 min`); continue; }
    const winner = w.karts[w.finalOrder[0]!]!;
    const finishers = w.karts.filter((k) => k.finished).length;
    if (finishers < w.karts.length) errs.push(`semilla ${seed}: solo ${finishers}/${w.karts.length} karts terminan`);
    const median = w.karts[w.finalOrder[Math.floor(w.karts.length / 2) - 1]!]!;
    laps.push(median.time! / LAPS);
    wins.push(winner.time! / LAPS);
    notes.push(`semilla ${seed}: ganador ${winner.time!.toFixed(1)} s, mediano ${median.time!.toFixed(1)} s, caídas ${falls}`);
  }
  if (laps.length) {
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const mean = avg(laps), win = avg(wins), [lo, hi] = a.metrics.lapSeconds;
    notes.push(`vuelta media del piloto mediano: ${mean.toFixed(1)} s (objetivo ${lo}–${hi} s) · del ganador: ${win.toFixed(1)} s`);
    if (mean < lo || mean > hi) errs.push(`vuelta media ${mean.toFixed(1)} s fuera de ${lo}–${hi} s`);
    if (win < lo * 0.85) errs.push(`el ganador da la vuelta en ${win.toFixed(1)} s: la pista es demasiado corta (< ${(lo * 0.85).toFixed(1)} s)`);
  }
  return { errs, notes, N };
}

for (const a of list) {
  const { errs, notes, N } = check(a);
  console.log(`\n${a.name} (${a.id}): ${N} muestras ≈ ${N * 6} u`);
  for (const n of notes) console.log('  · ' + n);
  for (const e of errs) { console.log('  ✗ ' + e); if (process.env.GITHUB_ACTIONS) console.log(`::error title=Validador de pistas::${a.name}: ${e}`); }
  if (errs.length) failed++;
  else console.log('  ✓ válida');
}
if (failed) { console.log(`\n${failed} pista(s) no pasan el validador`); process.exit(1); }
