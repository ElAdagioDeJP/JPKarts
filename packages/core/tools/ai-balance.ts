// AI balance check (docs/PLAN.md Fase 4): a "reference human" (hard AI driving a human slot, so the rubber band
// works against it) races 7 AIs of the chosen difficulty. Target for Normal: reference in the top 4 in 40–70 % of races.
// Usage: bun packages/core/tools/ai-balance.ts [trackId=playa-coco] [races=20] [diff=1]
//        bun packages/core/tools/ai-balance.ts --wins [races=24] [diff=1] [trackId,trackId,...]
// --wins (V3-1): carreras solo de IA; victorias por personaje por pista. Objetivo: ninguno > 20 % del total (V3-7: > 15 %).
import { ALL_TRACKS, CHARS, T, refreshChars, LAPS, Rng, TrackCache, aiInput, buildGrid, createWorld, newAiState, prepAuthored, step, takeEvents, type Input } from '../src';

if (process.argv[2] === '--wins') {
  // calibración sin tocar el JSON: JP_STATS='{"man":0.08}' bun ... --wins  (mezcla sobre tunables/stats.json)
  if (process.env.JP_STATS) { Object.assign(T.stats, JSON.parse(process.env.JP_STATS)); refreshChars(); }
  if (process.env.JP_FLAT) { for (const c of CHARS) c.st = { vel: 5, ace: 5, pes: 5, man: 5, tra: 5 }; refreshChars(); } // control: todos Patron
  if (process.env.JP_NOPERS) for (const c of CHARS) c.personality = 'equilibrado'; // control: sin personalidades
  const n = Number(process.argv[3] ?? 24), df = Number(process.argv[4] ?? 1);
  const ids = (process.argv[5] ?? 'playa-coco').split(',');
  const wc = new TrackCache(ALL_TRACKS, prepAuthored);
  const total = new Array(CHARS.length).fill(0);
  let races = 0;
  for (const tid of ids) {
    const ti2 = ALL_TRACKS.findIndex((t) => t.id === tid);
    if (ti2 < 0) { console.log('pista desconocida: ' + tid); continue; }
    const t2 = wc.ensureBuilt(ti2), wins = new Array(CHARS.length).fill(0);
    for (let r = 0; r < n; r++) {
      const seed = 2000 + Number(process.env.JP_SEED ?? 0) + r * 31; // JP_SEED desplaza las semillas (para repartir muchas carreras en varios procesos)
      const grid = buildGrid(new Rng(seed), [], { humanSlot: 0 });
      const w = createWorld({ trackIndex: ti2, diff: df, seed, laps: LAPS, grid }, t2);
      for (let t = 0; t < 60 * 60 * 6 && w.phase !== 'results'; t++) { step(w, []); takeEvents(w); }
      wins[w.karts[w.finalOrder[0]!]!.ch]++; races++;
    }
    wins.forEach((v, i) => (total[i] += v));
    console.log(`${ALL_TRACKS[ti2]!.name}: ` + CHARS.map((c, i) => `${c.short} ${wins[i]}`).join(' · '));
  }
  console.log('TOTAL (' + races + ' carreras): ' + CHARS.map((c, i) => `${c.short} ${(100 * total[i] / races).toFixed(0)} %`).join(' · '));
  console.log('máximo: ' + (100 * Math.max(...total) / races).toFixed(0) + ' %');
  process.exit(0);
}
const id = process.argv[2] ?? 'playa-coco', races = Number(process.argv[3] ?? 20), diff = Number(process.argv[4] ?? 1);
const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const ti = ALL_TRACKS.findIndex((t) => t.id === id);
const tr = cache.ensureBuilt(ti);
const places: number[] = [];
for (let r = 0; r < races; r++) {
  const seed = 1000 + r * 17;
  const grid = buildGrid(new Rng(seed), [{ ch: r % 8, ctrl: 'remote' }], { humanSlot: 5 });
  const w = createWorld({ trackIndex: ti, diff, seed, laps: LAPS, grid }, tr);
  const ref = w.karts.find((k) => k.ctrl === 'remote')!;
  ref.ai = newAiState(w, 2);
  ref.ai.speed = 1;
  for (let t = 0; t < 60 * 60 * 6 && w.phase !== 'results'; t++) {
    const inputs: Input[] = [];
    inputs[ref.id] = aiInput(w, ref);
    step(w, inputs);
    takeEvents(w);
  }
  places.push(w.finalOrder.indexOf(ref.id) + 1);
}
const top4 = places.filter((p) => p <= 4).length / races;
console.log(`${ALL_TRACKS[ti]!.name}, IA ${['Fácil', 'Normal', 'Difícil'][diff]}: puestos del humano de referencia ${places.join(' ')}`);
console.log(`top 4 en ${(top4 * 100).toFixed(0)} % de ${races} carreras (objetivo Normal 40–70 %)`);
