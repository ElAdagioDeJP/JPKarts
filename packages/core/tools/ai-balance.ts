// AI balance check (docs/PLAN.md Fase 4): a "reference human" (hard AI driving a human slot, so the rubber band
// works against it) races 7 AIs of the chosen difficulty. Target for Normal: reference in the top 4 in 40–70 % of races.
// Usage: bun packages/core/tools/ai-balance.ts [trackId=playa-coco] [races=20] [diff=1]
import { ALL_TRACKS, LAPS, Rng, TrackCache, aiInput, buildGrid, createWorld, newAiState, prepAuthored, step, takeEvents, type Input } from '../src';

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
