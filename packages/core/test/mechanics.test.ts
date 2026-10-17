import { expect, test } from 'bun:test';
import { ALL_TRACKS, LAPS, Rng, T, TrackCache, addFx, arenaGust, buildGrid, createWorld, lateralAt, prepAuthored, step, takeEvents, type GameEvent, type Kart, type World } from '../src';
import { hit } from '../src/sim/helpers';
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

// La mecanica de planeo se prueba con un planeador bueno (vuelo 9, p. ej. un chasis con ala planeadora, V3-3); se restaura al acabar.
test('parapente: trepar cambia altura por velocidad, picar da velocidad, en pérdida cae', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(0);
  const mkGlider = () => {
    // Marco: ligero, el mejor planeador de los 8 actuales (vuelo 6); los pesados planean menos (V3-1)
    const grid = buildGrid(new Rng(3), [{ ch: 0, ctrl: 'local' }], { humanSlot: 0 });
    const w = createWorld({ trackIndex: 0, diff: 0, seed: 3, laps: LAPS, grid }, tr);
    const idle = [{ t: 0, s: 0, d: false, item: false }];
    for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
    const k = w.karts[0]!;
    k.st.fly = 9; k.respawn = 0; k.invuln = 0; k.air = true; k.glide = true; k.glideE = T.driving.air.glideTime; k.vz = 0;
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
  // crucero sostenido ≥4 s sin input: sigue en el aire con hundimiento leve (<60 u)
  const cruise4 = mkGlider();
  cruise4.k.z = 400; cruise4.k.speed = 140; cruise4.k.vz = 0;
  flyTicks(cruise4, 0, 240);
  expect(cruise4.k.air).toBe(true);
  expect(cruise4.k.glide).toBe(true);
  expect(cruise4.k.z).toBeLessThan(460); // vuelo sostenido, no escalera ni roca
  expect(cruise4.k.z).toBeGreaterThan(300); // V3-5: glideLiftGain 0.675 → 0.6, a bit more sink
  // flare: tirar hacia arriba al tocar suelo suaviza el aterrizaje (no duro), soltarlo lo deja duro
  const landWith = (t: number) => {
    const g = mkGlider();
    g.k.z = 60; g.k.vz = -60; g.k.speed = 140;
    takeEvents(g.w);
    for (let i = 0; i < 300 && g.k.air; i++) step(g.w, [{ t, s: 0, d: false, item: false }]);
    const land = takeEvents(g.w).find((e) => e.type === 'land');
    return { landed: !g.k.air, hard: land?.type === 'land' ? land.hard : undefined };
  };
  const flared = landWith(1), plain = landWith(0);
  expect(flared.landed).toBe(true);
  expect(plain.landed).toBe(true);
  expect(flared.hard).toBe(false);
  expect(plain.hard).toBe(true);
}, 60000);

test('parapente: spin/golpe en vuelo cierran el ala (cae sin sustentación)', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(0);
  const grid = buildGrid(new Rng(3), [{ ch: 5, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: 0, diff: 0, seed: 3, laps: LAPS, grid }, tr);
  const idle = [{ t: 0, s: 0, d: false, item: false }];
  for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
  const k = w.karts[0]!;
  k.respawn = 0; k.invuln = 0; k.air = true; k.glide = true; k.vz = 10; k.z = 400; k.speed = 140;
  expect(hit(w, k, 1.0, 1, -1)).toBe(true);
  expect(k.glide).toBe(false);
  expect(k.air).toBe(true); // sigue en el aire pero sin sustentación
  expect(k.spin).toBeGreaterThan(0);
  // sin ala cae con gravedad normal: tras 1 s el vz es claramente negativo
  for (let i = 0; i < 60; i++) step(w, [{ t: 0, s: 0, d: false, item: false }]);
  expect(k.vz).toBeLessThan(-30);
}, 60000);

test('canon-rojo: las setas rebotan y la glideZone abre el ala', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(28);
  expect(tr.glideZones.length).toBeGreaterThan(0);
  const mk = () => {
    const grid = buildGrid(new Rng(7), [{ ch: 5, ctrl: 'local' }], { humanSlot: 0 });
    const w = createWorld({ trackIndex: 28, diff: 0, seed: 7, laps: LAPS, grid }, tr);
    const idle = [{ t: 0, s: 0, d: false, item: false }];
    for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
    const k = w.karts[0]!;
    k.respawn = 0; k.invuln = 0; k.air = false; k.glide = false; k.vz = 0;
    return { w, k };
  };
  // seta: pisarla en el suelo lanza por los aires (sin golpe: level -1)
  const b = mk();
  const idle0 = [{ t: 0, s: 0, d: false, item: false }];
  for (let i = 0; i < 5; i++) step(b.w, idle0); // deja que las entidades fijas se coloquen
  const seta = b.w.ents.find((e) => e.kind === 'seta');
  expect(seta).toBeTruthy();
  b.k.x = seta!.x; b.k.y = seta!.y; b.k.speed = 120;
  step(b.w, [{ t: 0, s: 0, d: false, item: false }]);
  expect(b.k.air).toBe(true);
  expect(b.k.vz).toBeGreaterThan(0);
  // glideZone: entrar rapido en el suelo abre el ala
  const g = mk();
  const z = tr.glideZones[0]!;
  g.k.x = tr.x[z.i0]!; g.k.y = tr.y[z.i0]!; g.k.speed = 140;
  let opened = false;
  for (let i = 0; i < 10 && !opened; i++) {
    step(g.w, [{ t: 0, s: 0, d: false, item: false }]);
    opened = g.k.glide;
  }
  expect(opened).toBe(true);
  expect(g.k.air).toBe(true);
}, 60000);

test('tormenta de arena: ráfagas laterales deterministas desde su vuelta', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(21); // dunas-doradas (arena desde la vuelta 2)
  const mk = () => {
    const grid = buildGrid(new Rng(7), [{ ch: 5, ctrl: 'local' }], { humanSlot: 0 });
    const w = createWorld({ trackIndex: 21, diff: 0, seed: 7, laps: LAPS, grid }, tr);
    const idle = [{ t: 0, s: 0, d: false, item: false }];
    for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
    return w;
  };
  const w1 = mk(), k1 = w1.karts[0]!;
  k1.prog = 0; // vuelta 1: sin tormenta
  expect(arenaGust(w1, k1)).toBe(0);
  const w2 = mk(), k2 = w2.karts[0]!;
  k2.prog = tr.N; // vuelta 2: tormenta activa, ráfaga acotada
  expect(Math.abs(arenaGust(w2, k2))).toBeLessThanOrEqual(10);
  const w3 = mk(), k3 = w3.karts[0]!; // determinista: mismo tick + kart → misma ráfaga
  k3.prog = tr.N;
  expect(arenaGust(w3, k3)).toBe(arenaGust(w2, k2));
  let peak = 0;
  const p0 = k2.prog;
  for (let i = 0; i < 300; i++) { step(w2, [{ t: 1, s: 0, d: false, item: false }]); peak = Math.max(peak, Math.abs(arenaGust(w2, k2))); }
  expect(peak).toBeGreaterThan(5); // la tormenta empuja de verdad en alguna fase
  expect(k2.respawn).toBe(0); // …sin sacar al kart de carrera
  expect(k2.prog).toBeGreaterThan(p0);
}, 60000);

test('proyectil ciego: rebota en muros en vez de atravesarlos', () => {
  const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(16); // playa-coco, con muros
  let wi = -1;
  for (let i = 0; i < tr.N; i++) if (tr.wallR[i]) { wi = i; break; }
  expect(wi).toBeGreaterThanOrEqual(0);
  const grid = buildGrid(new Rng(1), [{ ch: 0, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: 16, diff: 0, seed: 1, laps: LAPS, grid }, tr);
  const idle = [{ t: 0, s: 0, d: false, item: false }];
  for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
  const k = w.karts[0]!;
  k.respawn = 0; k.invuln = 0;
  const a = tr.ang[wi]!;
  k.x = tr.x[wi]!; k.y = tr.y[wi]!; k.speed = 0; k.a = a - Math.PI / 2; k.va = k.a; // mirando al muro derecho
  k.item = 'ciego';
  step(w, [{ t: 0, s: 0, d: false, item: true }]);
  takeEvents(w);
  expect(w.ents.some((e) => e.kind === 'shot')).toBe(true);
  let bounced = false, escaped = false;
  for (let i = 0; i < 120; i++) {
    step(w, [{ t: 0, s: 0, d: false, item: false }]);
    const s = w.ents.find((e) => e.kind === 'shot');
    if (!s) break;
    if (s.lat >= 1) bounced = true;
    const bi = Math.round(s.s) % tr.N;
    if (Math.abs(lateralAt(tr, bi, s.x, s.y)) > tr.wd[bi]! + 20) escaped = true;
  }
  expect(bounced).toBe(true); // tocó el muro y rebotó…
  expect(escaped).toBe(false); // …sin atravesarlo
}, 60000);

test('zonas de planeo = barrancos: anillo y dunas abren el ala sobre desnivel real', () => {
  for (const idx of [32, 33]) {
    const cache = new TrackCache(ALL_TRACKS, prepAuthored), tr = cache.ensureBuilt(idx);
    expect(tr.glideZones.length).toBeGreaterThan(0);
    const grid = buildGrid(new Rng(7), [{ ch: 5, ctrl: 'local' }], { humanSlot: 0 });
    const w = createWorld({ trackIndex: idx, diff: 0, seed: 7, laps: LAPS, grid }, tr);
    const idle = [{ t: 0, s: 0, d: false, item: false }];
    for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, idle);
    const k = w.karts[0]!;
    k.respawn = 0; k.invuln = 0; k.air = false; k.glide = false; k.vz = 0;
    const z = tr.glideZones[0]!;
    k.x = tr.x[z.i0]!; k.y = tr.y[z.i0]!; k.speed = 140;
    let opened = false;
    for (let i = 0; i < 10 && !opened; i++) { step(w, [{ t: 0, s: 0, d: false, item: false }]); opened = k.glide; }
    expect(opened).toBe(true);
    // desnivel real dentro de la zona (cresta - fondo): nada de llanos
    let mn = 1e9, mx = -1e9;
    for (let i = z.i0; ; i = (i + 1) % tr.N) { mn = Math.min(mn, tr.hc[i]!); mx = Math.max(mx, tr.hc[i]!); if (i === z.i1) break; }
    expect(mx - mn).toBeGreaterThan(15);
  }
}, 60000);

test('parapente: un turbo en el aire no da sustentación y la energía se agota (exploit de planear para siempre)', () => {
  const tr = new TrackCache(ALL_TRACKS, prepAuthored).ensureBuilt(0);
  const w = createWorld({ trackIndex: 0, diff: 0, seed: 3, laps: LAPS, grid: buildGrid(new Rng(3), [{ ch: 5, ctrl: 'local' }], { humanSlot: 0 }) }, tr);
  for (let i = 0; i < 60 * 5 && w.phase !== 'race'; i++) step(w, [{ t: 0, s: 0, d: false, item: false }]);
  const k = w.karts[0]!;
  k.respawn = 0; k.invuln = 0; k.air = true; k.glide = true; k.glideE = T.driving.air.glideTime; k.vz = 0; k.z += 150; k.speed = 140;
  // trepando con turbo permanente (el caso del panel en el aire): tiene que acabar aterrizando
  for (let i = 0; i < 60 * 15 && k.air; i++) { k.boost = 1; step(w, [{ t: 1, s: 0, d: false, item: false }]); }
  expect(k.air).toBe(false);
});
