import { expect, test } from 'bun:test';
import { ALL_TRACKS, LAPS, Rng, TrackCache, addFx, buildGrid, createWorld, prepAuthored, step, takeEvents, type GameEvent, type Kart, type World } from '../src';
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

test('choques: ambos karts rebotan; la goma protege al dueño y frena al atacante', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(0);
  const grid = buildGrid(new Rng(3), [{ ch: 0, ctrl: 'local' }, { ch: 1, ctrl: 'remote' }], { humanSlot: 2 });
  const w = createWorld({ trackIndex: 0, diff: 0, seed: 3, laps: LAPS, grid }, tr);
  const idle = [{ t: 0, s: 0, d: false, item: false }, { t: 0, s: 0, d: false, item: false }];
  for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
  expect(w.phase).toBe('race');
  const [a, b] = [w.karts[0]!, w.karts[1]!];
  for (const k of [a, b]) { k.respawn = 0; k.speed = 100; k.boost = 0; k.spin = 0; }
  b.x = a.x + 2; b.y = a.y; b.z = a.z;
  step(w, idle);
  const d1 = Math.hypot(b.x - a.x, b.y - a.y);
  expect(d1).toBeGreaterThan(6); // mutual shove apart, not just de-overlap
  expect(a.speed).toBeLessThan(100);
  expect(b.speed).toBeLessThan(100);
  // goma: owner keeps pace, attacker is shoved away and slowed
  addFx(b, 'goma', 12, b.id);
  for (const k of [a, b]) { k.respawn = 0; k.speed = 100; }
  w.pairCD.fill(0);
  b.x = a.x + 2; b.y = a.y; b.z = a.z;
  step(w, idle);
  expect(b.speed).toBeGreaterThan(a.speed);
}, 60000);

test('parapente: trepar cambia altura por velocidad, picar da velocidad, en pérdida cae', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(0);
  const mkGlider = () => {
    const grid = buildGrid(new Rng(3), [{ ch: 5, ctrl: 'local' }], { humanSlot: 0 });
    const w = createWorld({ trackIndex: 0, diff: 0, seed: 3, laps: LAPS, grid }, tr);
    const idle = [{ t: 0, s: 0, d: false, item: false }];
    for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
    const k = w.karts[0]!;
    k.respawn = 0; k.invuln = 0; k.air = true; k.glide = true; k.vz = 0;
    return { w, k };
  };
  const flyTicks = (g: { w: World; k: Kart }, t: number, n: number) => {
    for (let i = 0; i < n; i++) step(g.w, [{ t, s: 0, d: false, item: false }]);
  };
  // trepar (t=1) vs neutro: más alto pero más lento al cabo de 1 s
  const climb = mkGlider(), neut = mkGlider();
  for (const g of [climb, neut]) { g.k.z = 400; g.k.speed = 140; }
  flyTicks(climb, 1, 60); flyTicks(neut, 0, 60);
  expect(climb.k.air).toBe(true);
  expect(neut.k.air).toBe(true);
  expect(climb.k.z).toBeGreaterThan(neut.k.z);
  expect(climb.k.speed).toBeLessThan(neut.k.speed);
  // picar (t=-1): más velocidad pero pierde altura
  const dive = mkGlider(), neut2 = mkGlider();
  for (const g of [dive, neut2]) { g.k.z = 600; g.k.speed = 140; }
  flyTicks(dive, -1, 60); flyTicks(neut2, 0, 60);
  expect(dive.k.speed).toBeGreaterThan(neut2.k.speed);
  expect(dive.k.z).toBeLessThan(neut2.k.z);
  // pérdida: lento y sin picar cae y aterriza antes que el neutro
  const stall = mkGlider(), neut3 = mkGlider();
  for (const g of [stall, neut3]) { g.k.z = 400; }
  stall.k.speed = 30; neut3.k.speed = 140;
  flyTicks(stall, 0, 120); flyTicks(neut3, 0, 120);
  expect(stall.k.air).toBe(false);
  expect(neut3.k.air).toBe(true);
}, 60000);
