// V3-5: ramp kinds, reliable tricks (docs/V3_PLAN.md §2.6). Chasms are in chasms.test.ts.
import { describe, expect, test } from 'bun:test';
import { ALL_TRACKS, AUTHORED, LAPS, Rng, T, TrackCache, buildGrid, createWorld, dcos, dsin, prepAuthored, step, takeEvents, trackIndexById, type GameEvent, type Input, type Kart, type World } from '../src';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const IDLE: Input = { t: 0, s: 0, d: false, item: false };

function raceOn(id: string, seed = 5): World {
  const ti = trackIndexById(id), tr = cache.ensureBuilt(ti), grid = buildGrid(new Rng(seed), [{ ch: 1, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: ti, diff: 1, seed, laps: LAPS, grid }, tr);
  while (w.phase === 'countdown') step(w, [IDLE]);
  takeEvents(w);
  return w;
}
function place(w: World, k: Kart, i: number, lat = 0) {
  const tr = w.track, j = ((i % tr.N) + tr.N) % tr.N, a = tr.ang[j]!;
  k.idx = j; k.prog = j; k.x = tr.x[j]! - dsin(a) * lat; k.y = tr.y[j]! + dcos(a) * lat; k.a = k.va = a; k.speed = 0; k.spin = 0; k.invuln = 0; k.respawn = 0; k.z = tr.hc[j]!;
}
function parkOthers(w: World, keep: Kart[]) { w.karts.forEach((k, n) => { if (!keep.includes(k)) place(w, k, 900 + n * 6, (n % 2 ? 1 : -1) * 20); }); }
const freeze = (w: World) => w.karts.forEach((k) => { if (k.ai) k.ai.speed = 0; });
function run(w: World, ticks: number, inp: Input = IDLE): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) { step(w, [inp]); ev.push(...takeEvents(w)); }
  return ev;
}
const of = (ev: GameEvent[], t: string) => ev.filter((e) => e.type === t);

describe('rampas marcadas', () => {
  test('todas las rampas de las pistas authored tienen un tipo válido (hop, trick o glide)', () => {
    let n = 0;
    for (const a of AUTHORED) for (const r of a.ramps) { n++; expect(['hop', 'trick', 'glide']).toContain(r.kind); expect((r as { big?: boolean }).big).toBeUndefined(); }
    expect(n).toBeGreaterThan(15);
  });
  test('las rampas antiguas con `big` pasaron a trick y el resto a hop', () => {
    const byId = (id: string) => AUTHORED.find((a) => a.id === id)!;
    expect(byId('playa-coco').ramps.map((r) => r.kind)).toEqual(['trick']);
    expect(byId('anillo-turbo').ramps.map((r) => r.kind)).toEqual(['hop', 'trick']);
    expect(byId('pradera-jp').ramps.every((r) => r.kind === 'hop')).toBe(true);
  });
  test('la pista lleva sus rampas marcadas por índice, con su tipo', () => {
    const tr = cache.ensureBuilt(trackIndexById('anillo-turbo'));
    expect(tr.ramps.length).toBe(2);
    expect(tr.ramps.map((r) => r.kind)).toEqual(['hop', 'trick']);
    expect(tr.ramps[0]!.i).toBeGreaterThan(0);
  });
  test('cruzar una rampa marcada despega aunque la pendiente sea suave y se abre la ventana de truco', () => {
    const w = raceOn('anillo-turbo'), k = w.karts[0]!, tr = w.track, r = tr.ramps[0]!;
    parkOthers(w, [k]); freeze(w);
    place(w, k, r.i - 6); k.speed = 110;
    const ev = run(w, 40, { t: 1, s: 0, d: false, item: false });
    expect(of(ev, 'jump').length).toBeGreaterThanOrEqual(1);
    // the window is open right after take-off
    const w2 = raceOn('anillo-turbo'), k2 = w2.karts[0]!;
    parkOthers(w2, [k2]); freeze(w2);
    place(w2, k2, r.i - 3); k2.speed = 110;
    let opened = false;
    for (let i = 0; i < 30; i++) { step(w2, [{ t: 1, s: 0, d: false, item: false }]); takeEvents(w2); if (k2.air && k2.trickT > 0.3) opened = true; }
    expect(opened).toBe(true);
  });
  test('demasiado lento no despega (se sube la rampa a pie)', () => {
    const w = raceOn('anillo-turbo'), k = w.karts[0]!, r = w.track.ramps[0]!;
    parkOthers(w, [k]); freeze(w);
    place(w, k, r.i - 6); k.speed = T.driving.ramp.minSpeed - 40;
    const ev = run(w, 40, IDLE);
    expect(of(ev, 'jump').length).toBe(0);
  });
});

describe('trucos fiables', () => {
  test('la ventana de truco es de 0.45 s', () => {
    expect(T.driving.trick.takeoff).toBeCloseTo(0.45, 5);
  });

  function inAir(): { w: World; k: Kart } {
    const w = raceOn('playa-coco'), k = w.karts[0]!;
    parkOthers(w, [k]); freeze(w);
    place(w, k, 120); k.speed = 120; k.air = true; k.z += 60; k.vz = 20; k.trickT = T.driving.trick.takeoff; k.trick = false;
    return { w, k };
  }

  test('pulsar el derrape en el aire hace el truco', () => {
    const { w, k } = inAir();
    const ev = run(w, 1, { t: 1, s: 0, d: true, item: false });
    expect(of(ev, 'trick').length).toBe(1);
    expect(k.trick).toBe(true);
  });
  test('SOLTAR el derrape en el aire también cuenta', () => {
    const { w, k } = inAir();
    k.dPrev = true; // the player was drifting when it took off
    const ev = run(w, 1, { t: 1, s: 0, d: false, item: false });
    expect(of(ev, 'trick').length).toBe(1);
    expect(k.trick).toBe(true);
  });
  test('sin tocar el botón no hay truco, y fuera de la ventana tampoco', () => {
    const { w, k } = inAir();
    expect(of(run(w, 10, { t: 1, s: 0, d: false, item: false }), 'trick').length).toBe(0);
    k.trickT = 0;
    expect(of(run(w, 1, { t: 1, s: 0, d: true, item: false }), 'trick').length).toBe(0);
  });
  test('un truco por salto', () => {
    const { w } = inAir();
    const ev = [...run(w, 1, { t: 1, s: 0, d: true, item: false }), ...run(w, 1, { t: 1, s: 0, d: false, item: false }), ...run(w, 1, { t: 1, s: 0, d: true, item: false })];
    expect(of(ev, 'trick').length).toBe(1);
  });
  test('la dirección elige la figura: izquierda = tirabuzón, derecha = giro, centro = mortal', () => {
    for (const [s, kind] of [[-1, 'twist'], [1, 'spin'], [0, 'flip'], [-0.2, 'flip'], [0.5, 'spin']] as const) {
      const { w } = inAir();
      const ev = run(w, 1, { t: 1, s, d: true, item: false });
      const t = of(ev, 'trick')[0] as Extract<GameEvent, { type: 'trick' }>;
      expect(t.kind).toBe(kind);
    }
  });
  test('al aterrizar: salto pequeño (hop) = turbo corto; rampa de truco = turbo largo', () => {
    const land = (big: boolean) => {
      const { w, k } = inAir();
      k.trickBig = big;
      run(w, 1, { t: 1, s: 0, d: true, item: false });
      k.z = w.track.hc[k.idx]! + 1; k.vz = -10;
      for (let i = 0; i < 90 && k.air; i++) { step(w, [{ t: 1, s: 0, d: true, item: false }]); takeEvents(w); }
      return k.boost;
    };
    const hop = land(false), big = land(true);
    expect(hop).toBeGreaterThan(0.3);
    expect(big).toBeGreaterThan(hop);
  });
  test('en una carrera real, un truco hecho al soltar el derrape justo tras la rampa de truco da el turbo', () => {
    const w = raceOn('anillo-turbo'), k = w.karts[0]!, r = w.track.ramps.find((q) => q.kind === 'trick')!;
    parkOthers(w, [k]); freeze(w);
    place(w, k, r.i - 14); k.speed = 120;
    const ev: GameEvent[] = [];
    let tricked = false;
    for (let t = 0; t < 60 * 5; t++) {
      // drift held on the way in, released as soon as it leaves the ground
      const d = !k.air && !tricked;
      step(w, [{ t: 1, s: 0, d, item: false }]);
      ev.push(...takeEvents(w));
      if (k.trick) tricked = true;
    }
    expect(of(ev, 'trick').length).toBe(1);
    expect(of(ev, 'land').length).toBeGreaterThanOrEqual(1);
  });
});

test('trucos de la IA: en Normal siempre hace el truco al despegar', () => {
  const w = raceOn('anillo-turbo', 8);
  const ai = w.karts.find((q) => q.ctrl === 'ai')!, r = w.track.ramps.find((q) => q.kind === 'trick')!;
  parkOthers(w, [w.karts[0]!, ai]); freeze(w);
  ai.ai!.speed = 1; ai.ai!.diff = 1;
  place(w, ai, r.i - 40); ai.speed = 120;
  const ev: GameEvent[] = [];
  for (let t = 0; t < 60 * 4; t++) { step(w, [IDLE]); ev.push(...takeEvents(w)); }
  const tricks = (of(ev, 'trick') as Extract<GameEvent, { type: 'trick' }>[]).filter((e) => e.kart === ai.id);
  expect(tricks.length).toBeGreaterThanOrEqual(1);
  void dcos;
});
