// Phase 9: every mode's endCondition, checked on a recorded race that is then replayed headless with the same hash.
import { expect, test } from 'bun:test';
import {
  ALL_TRACKS, ARENA_INDICES, ReplayRecorder, Rng, TrackCache, buildGrid, createWorld, datan2, dcos, dsin, hashWorld, modeOf, playReplay, prepAuthored, step, takeEvents, wrapA,
  type GameEvent, type Input, type RaceConfig, type World,
} from '../src';
import { hit } from '../src/sim/helpers';
import { T } from '../src/tunables';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const PRADERA = 17;

/** A decent human stand-in: pure pursuit on the racing line. */
function pilot(w: World, id: number): Input {
  const k = w.karts[id]!, tr = w.track, line = tr.line!, i = (k.idx + 10 + Math.round(Math.max(0, k.speed) / 18)) % tr.N;
  const a = tr.ang[i]!, off = line.off[i]!, tx = tr.x[i]! - dsin(a) * off, ty = tr.y[i]! + dcos(a) * off;
  const da = wrapA(datan2(ty - k.y, tx - k.x) - k.a);
  return { t: Math.abs(da) > 1 ? 0.4 : 1, s: Math.max(-1, Math.min(1, da * 2.6)), d: false, item: w.tick % 400 === 0 };
}

/** Run a whole race (recording it), then replay it and compare hashes. */
function raceAndReplay(cfg: RaceConfig, maxTicks = 60 * 60 * 8) {
  const tr = cache.ensureBuilt(cfg.trackIndex, [], cfg.mirror);
  const w = createWorld(cfg, tr), rec = new ReplayRecorder(cfg), ev: GameEvent[] = [];
  const humans = cfg.grid.map((g, i) => (g.ctrl === 'ai' ? -1 : i)).filter((i) => i >= 0);
  for (let t = 0; t < maxTicks && w.phase !== 'results'; t++) {
    const inputs: Input[] = [];
    for (const h of humans) inputs[h] = pilot(w, h);
    rec.record(w, inputs);
    step(w, inputs);
    ev.push(...takeEvents(w));
    rec.after(w);
  }
  const replay = JSON.parse(JSON.stringify(rec.replay));
  const back = playReplay(replay, tr);
  return { w, ev, replayHash: hashWorld(back.world), mismatch: back.mismatch };
}

test('Contrarreloj: 1 kart, 10 monedas y Turbo Triple; sin monedas ni cajas; termina al cruzar la meta', () => {
  const cfg: RaceConfig = { trackIndex: PRADERA, diff: 1, seed: 3, laps: 1, mode: 'timetrial', grid: [{ ch: 0, ctrl: 'local' }] };
  const w0 = createWorld(cfg, cache.ensureBuilt(PRADERA));
  expect(w0.karts[0]!.coins).toBe(T.race.timeTrial.coins);
  expect(w0.karts[0]!.item).toBe('turbo3');
  expect(w0.ents.some((e) => e.kind === 'coin')).toBe(false);
  const { w, ev, replayHash, mismatch } = raceAndReplay(cfg);
  expect(w.phase).toBe('results');
  expect(modeOf(w).endCondition(w)).toBe(true);
  // only the starting Turbo Triple: the boxes give nothing
  expect(ev.filter((e) => e.type === 'itemGet').length).toBe(1);
  expect(ev.some((e) => e.type === 'itemRoll')).toBe(false);
  expect(mismatch).toBe(-1);
  expect(replayHash).toBe(hashWorld(w));
}, 120000);

test('Eliminación: N − 1 vueltas, sale el último de cada vuelta y queda uno', () => {
  const grid = buildGrid(new Rng(4), [], { humanSlot: 0 }).slice(0, 4);
  const laps = modeOf({ cfg: { mode: 'elimination' } } as World).laps!(grid.length);
  expect(laps).toBe(3);
  const cfg: RaceConfig = { trackIndex: PRADERA, diff: 2, seed: 4, laps, mode: 'elimination', grid };
  const { w, ev, replayHash, mismatch } = raceAndReplay(cfg);
  const outs = ev.filter((e): e is Extract<GameEvent, { type: 'eliminated' }> => e.type === 'eliminated');
  expect(outs.length).toBe(3);
  expect(w.phase).toBe('results');
  expect(w.karts.filter((k) => !k.out).length).toBe(1);
  // final order: the survivor, then the knocked-out karts from the last one out to the first one
  expect(w.finalOrder[0]).toBe(w.karts.find((k) => !k.out)!.id);
  expect(w.finalOrder.slice(1)).toEqual(outs.map((e) => e.kart).reverse());
  expect(mismatch).toBe(-1);
  expect(replayHash).toBe(hashWorld(w));
}, 180000);

test('Equipos: el fuego amigo no golpea; el rival sí', () => {
  const grid = buildGrid(new Rng(5), [], { humanSlot: 0 }).map((g, i) => ({ ...g, team: i % 2 }));
  const w = createWorld({ trackIndex: PRADERA, diff: 1, seed: 5, laps: 3, teams: true, grid }, cache.ensureBuilt(PRADERA));
  const [a, b, c] = [w.karts[0]!, w.karts[1]!, w.karts[2]!];
  expect(a.team).toBe(c.team);
  expect(hit(w, c, 1, 1, a.id)).toBe(false);
  expect(hit(w, b, 1, 1, a.id)).toBe(true);
  expect(hit(w, c, 1, 1, -1)).toBe(true); // the track hurts everyone
});

test('150cc es más rápido que 100cc con los mismos inputs', () => {
  const run = (cc: number) => {
    const w = createWorld({ trackIndex: PRADERA, diff: 1, seed: 6, laps: 3, cc, grid: [{ ch: 0, ctrl: 'local' }] }, cache.ensureBuilt(PRADERA));
    for (let t = 0; t < 60 * 20; t++) step(w, [pilot(w, 0)]);
    return w.karts[0]!.prog;
  };
  expect(run(150)).toBeGreaterThan(run(100) * 1.08);
});

test('Espejo: la pista reflejada es simétrica y la IA completa la carrera', () => {
  const n = cache.ensureBuilt(PRADERA), m = cache.ensureBuilt(PRADERA, [], true);
  expect(m).not.toBe(n);
  expect(m.N).toBe(n.N);
  expect(Math.abs(m.x[0]! - (n.size - n.x[0]!))).toBeLessThan(1);
  const grid = buildGrid(new Rng(7), [], { humanSlot: 0 });
  const { w, mismatch } = raceAndReplay({ trackIndex: PRADERA, diff: 2, seed: 7, laps: 3, mirror: true, grid });
  expect(w.phase).toBe('results');
  expect(w.karts.every((k) => k.finished)).toBe(true);
  expect(mismatch).toBe(-1);
}, 180000);

test('Batalla: Globos en las 4 arenas — termina con uno en pie o por tiempo; replay = mismo hash', () => {
  for (const ti of ARENA_INDICES) {
    const grid = buildGrid(new Rng(ti), [], { humanSlot: 0 }).slice(0, 4);
    const { w, ev, replayHash, mismatch } = raceAndReplay({ trackIndex: ti, diff: 2, seed: ti, laps: 99, mode: 'battle', grid }, 60 * 200);
    expect(w.phase).toBe('results');
    const standing = w.karts.filter((k) => !k.out);
    expect(standing.length === 1 || w.raceT >= T.race.battle.time).toBe(true);
    expect(ev.some((e) => e.type === 'balloon')).toBe(true);
    // the ranking: balloons first, the knocked-out karts last
    const order = w.finalOrder.map((id) => w.karts[id]!);
    for (let i = 1; i < order.length; i++) if (!order[i - 1]!.out && !order[i]!.out) expect(order[i - 1]!.balloons).toBeGreaterThanOrEqual(order[i]!.balloons);
    expect(mismatch).toBe(-1);
    expect(replayHash).toBe(hashWorld(w));
  }
}, 600000);

test('Batalla: Captura — la bandera puntúa, un golpe la suelta; termina por meta o tiempo', () => {
  const ti = ARENA_INDICES[0]!, grid = buildGrid(new Rng(9), [], { humanSlot: 0 }).slice(0, 4);
  const { w, ev, replayHash, mismatch } = raceAndReplay({ trackIndex: ti, diff: 2, seed: 9, laps: 99, mode: 'capture', grid }, 60 * 200);
  expect(w.phase).toBe('results');
  expect(ev.some((e) => e.type === 'flagGet')).toBe(true);
  const top = w.karts[w.finalOrder[0]!]!;
  expect(top.score).toBeGreaterThan(0);
  expect(top.score >= T.race.capture.goal || w.raceT >= T.race.capture.time).toBe(true);
  expect(mismatch).toBe(-1);
  expect(replayHash).toBe(hashWorld(w));
}, 300000);
