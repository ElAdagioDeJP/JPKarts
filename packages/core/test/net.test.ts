import { expect, test } from 'bun:test';
import { ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, diffJson, patchJson, prepAuthored, serializeWorld, step, takeEvents } from '../src';

test('delta de snapshots: diff + patch reconstruye el estado exacto', () => {
  const tr = new TrackCache(ALL_TRACKS, prepAuthored).ensureBuilt(0);
  const w = createWorld({ trackIndex: 0, diff: 1, seed: 5, laps: LAPS, grid: buildGrid(new Rng(2), [], { humanSlot: 0 }) }, tr);
  let base = serializeWorld(w), rebuilt: unknown = JSON.parse(JSON.stringify(base));
  for (let i = 0; i < 1200; i++) {
    step(w, []);
    takeEvents(w);
    if (i % 3) continue;
    const next = serializeWorld(w);
    const d = JSON.parse(JSON.stringify(diffJson(base, next) ?? {}));
    rebuilt = patchJson(rebuilt, d);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(next));
    base = next;
  }
}, 60000);
