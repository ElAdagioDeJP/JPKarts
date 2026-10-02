import { expect, test } from 'bun:test';
import { ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, prepAuthored, step, takeEvents, type GameEvent } from '../src';
import { SCENARIOS, runScenario } from './golden';

// Every Phase 4 mechanic must actually happen in the replayed Playa Coco v2 scenario (its trajectory is
// locked by golden.test.ts, so this is the "replay test" of each mechanic).
test('las mecánicas nuevas ocurren en el escenario dorado de Playa Coco v2', () => {
  const sc = SCENARIOS.find((s) => s.track === 16)!;
  const seen = new Map<string, number>();
  const note = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1);
  runScenario(sc, 60 * 150, (e) => {
    note(e.type);
    if (e.type === 'itemUse') note('use:' + e.item);
  });
  const required = ['tide', 'hazardWarn', 'hazard', 'wallBump', 'trick', 'slipstream', 'driftLevel', 'miniTurbo', 'rocketStart', 'incoming', 'use:muelle', 'use:mina', 'use:reflector', 'explode'];
  const missing = required.filter((r) => !seen.get(r));
  expect(missing).toEqual([]);
}, 60000);

test('drift largo: nivel 3 (morado) y su mini-turbo', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(16);
  const grid = buildGrid(new Rng(1), [{ ch: 0, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: 16, diff: 1, seed: 9, laps: LAPS, grid }, tr);
  const ev: GameEvent[] = [];
  let i = 0;
  for (; i < 60 * 6; i++) { step(w, [{ t: 1, s: 0, d: false, item: false }]); ev.push(...takeEvents(w)); } // countdown + accelerate
  for (let j = 0; j < 60 * 2.7; j++, i++) { step(w, [{ t: 1, s: 1, d: true, item: false }]); ev.push(...takeEvents(w)); }
  step(w, [{ t: 1, s: 0, d: false, item: false }]);
  ev.push(...takeEvents(w));
  expect(ev.some((e) => e.type === 'driftLevel' && e.level === 3)).toBe(true);
  expect(ev.some((e) => e.type === 'miniTurbo' && e.level === 3)).toBe(true);
}, 60000);
