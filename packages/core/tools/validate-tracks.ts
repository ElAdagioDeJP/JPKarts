// Track validator (docs/GDD.md §6.5). Runs in CI: `bun run validate:tracks [id...]`.
// Fails when: the centerline self-intersects, the road is narrower than the cup minimum, a shortcut needs
// something impossible, the hard AI cannot finish 3 laps with 3 seeds, or the lap is out of range.
// Chasms (V3-5): with the worst setup (heaviest pilot + the Light wing, no input) a kart launched at `glideLaunchSpeed` from the glide ramp
// lands beyond the chasm; no way around it on the ground (flood fill); and the AI falls in at most 10 % of its crossings.
// Lap metric (GDD §6.5): the race length the cup promises is the one of a typical racer, so `lapSeconds` applies to
// the median finisher (4th of 8). The winner (hard AI snowballing coins) may be faster, down to 85 % of the minimum.
import { AUTHORED } from '../src/data/authoredTracks';
import { CHARS, LAPS, Rng, T, buildGrid, buildTrack, chasmHasLandPath, createWorld, dhypot, hAt, itemList, kartStats, step, takeEvents } from '../src';
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
  // chasms: glide ramp before, no way around, the worst kart crosses
  for (const c of tr.chasms) {
    const g = tr.ramps.filter((q) => q.kind === 'glide' && q.i < c.i0 && c.i0 - q.i < 40).sort((p, q) => q.i - p.i)[0];
    if (!g) { errs.push(`cañón ${c.i0}-${c.i1}: no hay una rampa de planeo justo antes`); continue; }
    if (chasmHasLandPath(tr, c)) errs.push(`cañón ${c.i0}-${c.i1}: hay un camino por tierra que lo rodea`);
    const luis = CHARS.findIndex((q) => q.name === 'Luis');
    const w = createWorld({ trackIndex: 0, diff: 1, seed: 1, laps: LAPS, grid: buildGrid(new Rng(1), [{ ch: luis, ctrl: 'local' }], { humanSlot: 0 }) }, tr);
    const k = w.karts[0]!;
    k.st = kartStats(luis, { body: 'mainframe', wheels: 'std', wing: 'light' });
    const far = (c.i1 + (N >> 1)) % N; // the others wait on the road half a lap away
    w.karts.forEach((q, n) => { if (q !== k) { const f = (far + n * 6) % N; q.x = tr.x[f]!; q.y = tr.y[f]!; q.idx = f; q.prog = f; if (q.ai) q.ai.speed = 0; } });
    while (w.phase === 'countdown') step(w, [{ t: 0, s: 0, d: false, item: false }]);
    const j = g.i - 6;
    k.idx = j; k.prog = j; k.x = tr.x[j]!; k.y = tr.y[j]!; k.a = k.va = tr.ang[j]!; k.speed = 60; k.z = hAt(tr, k.x, k.y);
    let landed = -1, flew = false, rescued = false;
    for (let t = 0; t < 60 * 12 && landed < 0 && !rescued; t++) {
      step(w, [k.glide ? { t: 0, s: 0, d: false, item: false } : { t: 1, s: 0, d: false, item: false }]);
      for (const e of takeEvents(w)) if (e.type === 'fall' && e.kart === k.id && k.idx < c.i0) rescued = true;
      if (k.glide) flew = true;
      if (flew && !k.air) landed = k.idx;
    }
    if (!flew) errs.push(`cañón ${c.i0}-${c.i1}: la rampa de planeo no abre el ala`);
    else if (rescued || landed <= c.i1) errs.push(`cañón ${c.i0}-${c.i1}: el peor kart (pesado + ala Ligera, sin input) cae al fondo`);
    else notes.push(`cañón ${c.i0}-${c.i1}: el peor kart aterriza en la muestra ${landed} (${((landed - c.i1) * 6).toFixed(0)} u después del borde)`);
  }
  let chasmFalls = 0, chasmTries = 0;
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
        if (e.type === 'fall') { falls++; for (const c of tr.chasms) if (w.karts[e.kart]!.idx < c.i0 && w.karts[e.kart]!.idx > c.i0 - T.race.chasm.rescueBack - 3) chasmFalls++; }
      }
    }
    chasmTries += w.karts.length * LAPS * tr.chasms.length;
    if (w.phase !== 'results') { errs.push(`semilla ${seed}: la IA difícil no termina 3 vueltas en 6 min`); continue; }
    const winner = w.karts[w.finalOrder[0]!]!;
    const finishers = w.karts.filter((k) => k.finished).length;
    if (finishers < w.karts.length) errs.push(`semilla ${seed}: solo ${finishers}/${w.karts.length} karts terminan`);
    const median = w.karts[w.finalOrder[Math.floor(w.karts.length / 2) - 1]!]!;
    laps.push(median.time! / LAPS);
    wins.push(winner.time! / LAPS);
    notes.push(`semilla ${seed}: ganador ${winner.time!.toFixed(1)} s, mediano ${median.time!.toFixed(1)} s, caídas ${falls}`);
  }
  if (chasmTries) {
    notes.push(`cañones: la IA cae en ${chasmFalls} de ${chasmTries} cruces (${((100 * chasmFalls) / chasmTries).toFixed(1)} %)`);
    if (chasmFalls / chasmTries > 0.1) errs.push(`la IA cae al cañón en el ${((100 * chasmFalls) / chasmTries).toFixed(0)} % de los cruces (máximo 10 %)`);
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
