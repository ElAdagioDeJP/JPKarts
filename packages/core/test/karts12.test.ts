// V3-2: 12 karts por carrera (docs/V3_PLAN.md §2.7).
import { expect, test } from 'bun:test';
import { ALL_TRACKS, CHARS, POINTS, ReplayRecorder, Rng, T, TrackCache, buildGrid, createWorld, datan2, dcos, dsin, hashWorld, lateralAt, modeOf, playReplay, prepAuthored, step, takeEvents, trackIndexById, wrapA, type Input, type RaceConfig, type World } from '../src';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const grid12 = (seed: number) => buildGrid(new Rng(seed), [], { humanSlot: 0 });

test('hay 12 pilotos y la parrilla libre los lleva a todos', () => {
  expect(CHARS.length).toBe(12);
  expect(new Set(grid12(1).map((g) => g.ch)).size).toBe(12);
  const withHuman = buildGrid(new Rng(1), [{ ch: 3, ctrl: 'local' }], { humanSlot: 5 });
  expect(withHuman.length).toBe(12);
  expect(withHuman[5]!.ch).toBe(3);
});

test('puntos de copa para 12 (15, 12, 10, 9... 1) y la copa ordena a los 12', () => {
  expect([...POINTS]).toEqual([15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const pts = Object.fromEntries(CHARS.map((_, i) => [i, 100 - i]));
  const g = buildGrid(new Rng(2), [], { cupPts: pts, humanSlot: 0 });
  expect(g.map((x) => x.ch)).toEqual(CHARS.map((_, i) => i));
});

test('los 12 salen en pista (sin muros ni agua) en todas las pistas y arenas', () => {
  for (let ti = 0; ti < ALL_TRACKS.length; ti++) {
    const tr = cache.ensureBuilt(ti);
    const w = createWorld({ trackIndex: ti, diff: 1, seed: 3, laps: 3, grid: grid12(3) }, tr);
    expect(w.karts.length).toBe(12);
    for (const k of w.karts) {
      const lat = Math.abs(lateralAt(tr, k.idx, k.x, k.y));
      expect(lat).toBeLessThan(tr.wd[k.idx]! - 4);
    }
    // nadie encima de otro
    for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) {
      const d = Math.hypot(w.karts[a]!.x - w.karts[b]!.x, w.karts[a]!.y - w.karts[b]!.y);
      expect(d).toBeGreaterThan(8);
    }
    // y nadie se cae/respawnea en el primer segundo tras la salida
    for (let t = 0; t < 60 * 6; t++) step(w, []);
    takeEvents(w);
    expect(w.karts.filter((k) => k.respawn > 0).length).toBe(0);
  }
}, 300000);

function pilot(w: World, id: number): Input {
  const k = w.karts[id]!, tr = w.track, line = tr.line!, i = (k.idx + 10 + Math.round(Math.max(0, k.speed) / 18)) % tr.N;
  const a = tr.ang[i]!, off = line.off[i]!, tx = tr.x[i]! - dsin(a) * off, ty = tr.y[i]! + dcos(a) * off;
  const da = wrapA(datan2(ty - k.y, tx - k.x) - k.a);
  return { t: Math.abs(da) > 1 ? 0.4 : 1, s: Math.max(-1, Math.min(1, da * 2.6)), d: false, item: false };
}
function run(cfg: RaceConfig, maxTicks = 60 * 60 * 8) {
  const tr = cache.ensureBuilt(cfg.trackIndex, [], cfg.mirror);
  const w = createWorld(cfg, tr), rec = new ReplayRecorder(cfg);
  const humans = cfg.grid.map((g, i) => (g.ctrl === 'ai' ? -1 : i)).filter((i) => i >= 0);
  for (let t = 0; t < maxTicks && w.phase !== 'results'; t++) {
    const inputs: Input[] = [];
    for (const h of humans) inputs[h] = pilot(w, h);
    rec.record(w, inputs); step(w, inputs); takeEvents(w); rec.after(w);
  }
  const back = playReplay(JSON.parse(JSON.stringify(rec.replay)), tr);
  return { w, same: back.mismatch === -1 && hashWorld(back.world) === hashWorld(w) };
}

test('carrera de 12 (1 humano + 11 IA): terminan todos y el replay da el mismo hash', () => {
  const grid = buildGrid(new Rng(8), [{ ch: 0, ctrl: 'local' }], { humanSlot: 6 });
  const { w, same } = run({ trackIndex: 17, diff: 1, seed: 8, laps: 2, grid });
  expect(w.phase).toBe('results');
  expect(w.finalOrder.length).toBe(12);
  expect(same).toBe(true);
}, 300000);

test('Eliminación con 12: 11 vueltas, sale uno por vuelta y queda uno', () => {
  expect(modeOf({ cfg: { mode: 'elimination' } } as World).laps!(12)).toBe(11);
  const laps = 11, grid = grid12(4);
  const { w, same } = run({ trackIndex: trackIndexById('anillo-turbo'), diff: 2, seed: 4, laps, mode: 'elimination', grid });
  expect(w.phase).toBe('results');
  expect(w.karts.filter((k) => !k.out).length).toBe(1);
  expect(same).toBe(true);
}, 600000);

test('Equipos 6 contra 6', () => {
  const grid = grid12(5).map((g, i) => ({ ...g, team: i % 2 }));
  const w = createWorld({ trackIndex: trackIndexById('anillo-turbo'), diff: 1, seed: 5, laps: 3, teams: true, grid }, cache.ensureBuilt(trackIndexById('anillo-turbo')));
  expect(w.karts.filter((k) => k.team === 0).length).toBe(6);
  expect(w.karts.filter((k) => k.team === 1).length).toBe(6);
});

test('Batalla con 12 en las arenas: termina y replay = mismo hash', () => {
  const ti = ALL_TRACKS.findIndex((t) => t.id === 'arena-plaza');
  const { w, same } = run({ trackIndex: ti, diff: 2, seed: 9, laps: 99, mode: 'battle', grid: grid12(9) }, 60 * 200);
  expect(w.phase).toBe('results');
  expect(same).toBe(true);
}, 300000);

test('las personalidades de los 12 existen en tunables y las nuevas se diferencian', () => {
  for (const c of CHARS) expect(T.ai.personality[c.personality]).toBeDefined();
  const P = T.ai.personality;
  expect(P.limpio.attack).toBeLessThan(P.equilibrado.attack);
  expect(P.limpio.lineErr).toBeLessThan(P.equilibrado.lineErr);
  expect(P.caotico.hold).toBeLessThan(P.equilibrado.hold);
  expect(P.caotico.lineErr).toBeCloseTo(1.2, 5); // 20 % más de errores de línea
});
