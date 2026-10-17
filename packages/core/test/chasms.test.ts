// V3-5: cañones (docs/V3_PLAN.md §2.6): terreno hundido sin carretera, paredes, rampa de planeo con velocidad garantizada,
// rescate al caer y que no se pueda rodear.
import { describe, expect, test } from 'bun:test';
import {
  ALL_TRACKS, CHARS, LAPS, Rng, T, TrackCache, buildGrid, chasmHasLandPath, createWorld, dcos, dsin, hAt, kartStats, lateralAt, prepAuthored, step, takeEvents, trackIndexById,
  type GameEvent, type Input, type Kart, type Track, type World,
} from '../src';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const IDLE: Input = { t: 0, s: 0, d: false, item: false };
const IDS = ['volcan-rugiente', 'crater-ardiente', 'pico-nevado'];
const build = (id: string): Track => cache.ensureBuilt(trackIndexById(id));

function raceOn(id: string, ch = 0, seed = 5): World {
  const ti = trackIndexById(id), grid = buildGrid(new Rng(seed), [{ ch, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: ti, diff: 1, seed, laps: LAPS, grid }, cache.ensureBuilt(ti));
  while (w.phase === 'countdown') step(w, [IDLE]);
  takeEvents(w);
  return w;
}
function place(w: World, k: Kart, i: number, lat = 0) {
  const tr = w.track, j = ((i % tr.N) + tr.N) % tr.N, a = tr.ang[j]!;
  k.idx = j; k.prog = j; k.x = tr.x[j]! - dsin(a) * lat; k.y = tr.y[j]! + dcos(a) * lat; k.a = k.va = a; k.speed = 0; k.spin = 0; k.invuln = 0; k.respawn = 0; k.z = hAt(tr, k.x, k.y); k.vz = 0; k.air = false; k.glide = false;
}
/** The other karts wait half a lap away from the chasm. */
function parkOthers(w: World, keep: Kart[]) { const far = (w.track.chasms[0]!.i1 + (w.track.N >> 1)) % w.track.N; w.karts.forEach((k, n) => { if (!keep.includes(k)) place(w, k, far + n * 6, (n % 2 ? 1 : -1) * 20); }); }
const freeze = (w: World) => w.karts.forEach((k) => { if (k.ai) k.ai.speed = 0; });
const WORST = { body: 'mainframe', wheels: 'std', wing: 'light' }; // heaviest pilot + the wing with the least flight

describe.each(IDS)('cañón de %s', (id) => {
  test('la pista tiene un cañón y una rampa de planeo justo antes', () => {
    const tr = build(id);
    expect(tr.chasms.length).toBe(1);
    const c = tr.chasms[0]!, glide = tr.ramps.filter((r) => r.kind === 'glide');
    expect(glide.length).toBe(1);
    const before = c.i0 - glide[0]!.i;
    expect(before).toBeGreaterThan(4);
    expect(before).toBeLessThan(30);
    expect(c.i1 - c.i0).toBeGreaterThan(15); // ≥ ~90 u de vacío
    expect(c.depth).toBeGreaterThan(40);
  });

  test('el terreno se hunde `depth` bajo el tramo y a los lados hay paredes de `wallH`', () => {
    const tr = build(id), c = tr.chasms[0]!, mid = Math.floor((c.i0 + c.i1) / 2), a = tr.ang[mid]!, side = tr.wd[mid]! + T.race.chasm.edge + 14;
    const floor = hAt(tr, tr.x[mid]!, tr.y[mid]!), road = tr.hc[mid]!;
    expect(floor).toBeLessThan(road - c.depth * 0.9);
    // road just before the chasm is still road, just after too
    const b = c.i0 - 6, af = c.i1 + 6;
    expect(Math.abs(hAt(tr, tr.x[b]!, tr.y[b]!) - tr.hc[b]!)).toBeLessThan(4);
    expect(Math.abs(hAt(tr, tr.x[af]!, tr.y[af]!) - tr.hc[af]!)).toBeLessThan(4);
    for (const s of [-1, 1]) {
      const wx = tr.x[mid]! - dsin(a) * side * s, wy = tr.y[mid]! + dcos(a) * side * s;
      expect(hAt(tr, wx, wy)).toBeGreaterThan(road + c.wallH * 0.8);
    }
  });

  test('con paredes marcadas a ambos lados del cañón y su aproximación', () => {
    const tr = build(id), c = tr.chasms[0]!, pad = T.race.chasm.wallPad;
    for (let i = c.i0 - pad; i <= c.i1 + pad; i++) { expect(tr.wallL[i]).toBe(1); expect(tr.wallR[i]).toBe(1); }
  });

  test('no existe ningún camino por tierra que una los dos lados (no se puede rodear)', () => {
    const tr = build(id);
    expect(chasmHasLandPath(tr, tr.chasms[0]!)).toBe(false);
  });

  test('caer al fondo provoca el rescate: reaparece en la pista antes del cañón, tras ~2 s', () => {
    const w = raceOn(id), k = w.karts[0]!, tr = w.track, c = tr.chasms[0]!, mid = Math.floor((c.i0 + c.i1) / 2);
    parkOthers(w, [k]); freeze(w);
    place(w, k, mid);
    const prog0 = k.prog;
    const ev: GameEvent[] = [];
    step(w, [IDLE]); ev.push(...takeEvents(w));
    expect(ev.some((e) => e.type === 'fall')).toBe(true);
    expect(k.respawn).toBeGreaterThan(1.5);
    expect(k.idx).toBeLessThan(c.i0);
    expect(k.prog).toBeLessThan(prog0); // lost the progress of the fall
    for (let t = 0; t < 60 * 3; t++) { step(w, [IDLE]); takeEvents(w); }
    expect(k.respawn).toBeLessThanOrEqual(0);
    expect(Math.abs(lateralAt(tr, k.idx, k.x, k.y))).toBeLessThan(tr.wd[k.idx]!);
    expect(k.idx).toBeLessThan(c.i0);
    expect(k.z).toBeGreaterThan(tr.hc[k.idx]! - 3); // back on the road, not on the floor
  });

  test('la rampa de planeo garantiza la velocidad: lanzado lento y sin tocar nada, el peor kart cruza y aterriza al otro lado', () => {
    const luis = CHARS.findIndex((q) => q.name === 'Luis'), w = raceOn(id, luis), k = w.karts[0]!, tr = w.track, c = tr.chasms[0]!, g = tr.ramps.find((r) => r.kind === 'glide')!;
    k.st = kartStats(luis, WORST);
    expect(k.st.fly).toBeLessThan(3.5); // the worst glider there is
    parkOthers(w, [k]); freeze(w);
    place(w, k, g.i - 6); k.speed = 60; // below the launch speed; it keeps the throttle until it takes off
    let landedAt = -1, flew = false, chasmFall = false;
    for (let t = 0; t < 60 * 12 && landedAt < 0 && !chasmFall; t++) {
      step(w, [k.glide ? IDLE : { t: 1, s: 0, d: false, item: false }]);
      for (const e of takeEvents(w)) if (e.type === 'fall' && e.kart === k.id && k.idx < c.i0) chasmFall = true; // rescued back before the chasm
      if (k.glide) flew = true;
      if (flew && !k.air && landedAt < 0) landedAt = k.idx;
    }
    expect(flew).toBe(true);
    expect(chasmFall).toBe(false);
    expect(landedAt).toBeGreaterThan(c.i1); // touched down beyond the chasm (what happens next is the track's business)
  });

  test('la rampa de planeo abre el ala aunque el kart pase por ella a cualquier velocidad', () => {
    const w = raceOn(id), k = w.karts[0]!, g = w.track.ramps.find((r) => r.kind === 'glide')!;
    parkOthers(w, [k]); freeze(w);
    place(w, k, g.i - 4); k.speed = 30;
    let glided = false, speedAtLaunch = 0;
    for (let t = 0; t < 60 && !glided; t++) { step(w, [{ t: 1, s: 0, d: false, item: false }]); takeEvents(w); if (k.glide) { glided = true; speedAtLaunch = k.speed; } }
    expect(glided).toBe(true);
    expect(speedAtLaunch).toBeGreaterThanOrEqual(T.driving.air.glideLaunchSpeed * 0.95);
  });
});

test('la IA cruza los 3 cañones sin caer en más del 10 % de los intentos', () => {
  let attempts = 0, falls = 0;
  for (const id of IDS) {
    const ti = trackIndexById(id);
    for (const seed of [101, 202]) {
      const grid = buildGrid(new Rng(seed), [], { humanSlot: 0 });
      const w = createWorld({ trackIndex: ti, diff: 1, seed, laps: LAPS, grid }, cache.ensureBuilt(ti));
      const c = w.track.chasms[0]!;
      for (let t = 0; t < 60 * 60 * 6 && w.phase !== 'results'; t++) {
        step(w, []);
        for (const e of takeEvents(w)) if (e.type === 'fall') { const k = w.karts[e.kart]!; if (k.respawn > 1.5 && k.idx < c.i0 && k.idx > c.i0 - T.race.chasm.rescueBack - 3) falls++; }
      }
      attempts += w.karts.length * LAPS;
    }
  }
  console.log(`cañones: ${falls} caídas en ${attempts} intentos (${((100 * falls) / attempts).toFixed(1)} %)`);
  expect(falls / attempts).toBeLessThanOrEqual(0.1);
}, 600000);

test('los karts de la IA y los humanos usan el mismo suelo: sin cañones en las Clásicas', () => {
  const tr = cache.ensureBuilt(0);
  expect(tr.chasms.length).toBe(0);
  void dcos;
});
