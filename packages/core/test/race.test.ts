import { expect, test } from 'bun:test';
import { CHARS, LAPS, Rng, SIM_HZ, TRACK_DEFS, buildGrid, buildTrack, createWorld, prepTrack, step, takeEvents } from '../src';

test('carrera solo-IA completa en Bun sin navegador', () => {
  const track = buildTrack(prepTrack(TRACK_DEFS[0]!));
  const grid = buildGrid(new Rng(1), [], { humanSlot: 0 });
  expect(grid.length).toBe(CHARS.length);
  const w = createWorld({ trackIndex: 0, diff: 1, seed: 42, laps: LAPS, grid }, track);
  let laps = 0;
  for (let i = 0; i < SIM_HZ * 60 * 6 && w.phase !== 'results'; i++) {
    step(w, []);
    for (const e of takeEvents(w)) if (e.type === 'lap') laps++;
  }
  expect(w.phase).toBe('results');
  expect(w.finalOrder.length).toBe(8);
  expect(laps).toBeGreaterThan(8);
  const winner = w.karts[w.finalOrder[0]!]!;
  // legacy lap ~43 s → 3 laps between 1:40 and 3:00
  expect(winner.time!).toBeGreaterThan(100);
  expect(winner.time!).toBeLessThan(180);
}, 60000);
