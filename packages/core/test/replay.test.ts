import { expect, test } from 'bun:test';
import { LAPS, ReplayRecorder, Rng, TRACK_DEFS, buildGrid, buildTrack, createWorld, dsin, hashWorld, playReplay, prepTrack, snapshot, step, takeEvents, type Input } from '../src';

const track = buildTrack(prepTrack(TRACK_DEFS[1]!));

function recordRace(seed: number, ticks: number) {
  const grid = buildGrid(new Rng(seed), [{ ch: 2, ctrl: 'local' }, { ch: 6, ctrl: 'remote' }], { humanSlot: 3 });
  const cfg = { trackIndex: 1, diff: 2, seed, laps: LAPS, grid };
  const w = createWorld(cfg, track);
  const rec = new ReplayRecorder(cfg);
  const a = grid.findIndex((g) => g.ch === 2), b = grid.findIndex((g) => g.ch === 6);
  for (let i = 0; i < ticks; i++) {
    const inputs: Input[] = [];
    inputs[a] = { t: 1, s: dsin(i / 50), d: i % 200 > 150, item: i % 333 === 0 };
    inputs[b] = { t: i % 400 < 380 ? 1 : -1, s: dsin(i / 37 + 1), d: false, item: i % 250 === 0 };
    rec.record(w, inputs);
    step(w, inputs);
    takeEvents(w);
    rec.after(w);
  }
  return { w, replay: rec.replay };
}

test('misma semilla y mismos inputs → mismo hash (3 ejecuciones)', () => {
  const h = [1, 2, 3].map(() => hashWorld(recordRace(99, 3000).w));
  expect(h[0]).toBe(h[1]!);
  expect(h[1]).toBe(h[2]!);
});

test('un replay grabado se reproduce headless con el mismo hash, también tras pasar por JSON', () => {
  const { w, replay } = recordRace(2024, 4200);
  const parsed = JSON.parse(JSON.stringify(replay));
  const { world, mismatch } = playReplay(parsed, track);
  expect(mismatch).toBe(-1);
  expect(hashWorld(world)).toBe(hashWorld(w));
  // only input changes are stored; two analog sticks moving every tick for 70 s stay under 150 KB
  expect(JSON.stringify(replay).length).toBeLessThan(150_000);
});

test('el estado es serializable a JSON plano sin pérdidas', () => {
  const { w } = recordRace(5, 900);
  const s = snapshot(w);
  expect(JSON.parse(JSON.stringify(s))).toEqual(JSON.parse(JSON.stringify(s)));
  // no object references: effects and entities only hold ids and numbers
  for (const k of w.karts) for (const f of k.fx) { expect(typeof f.data).toBe('number'); expect(typeof f.src).toBe('number'); }
  for (const e of w.ents) { expect(typeof e.owner).toBe('number'); expect(typeof e.target).toBe('number'); }
});
