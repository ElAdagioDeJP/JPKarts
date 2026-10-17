// V3-4: Modo Dios, Overclock Infinito y Piloto Automático (docs/V3_PLAN.md §2.5), each one with its replay test,
// AI score and events (CLAUDE.md rule 8). Deterministic situations on Playa Coco v2.
import { expect, test } from 'bun:test';
import {
  ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, dcos, dsin, hashWorld, lateralAt, prepAuthored, step, takeEvents,
  type GameEvent, type Input, type Kart, type World,
} from '../src';
import { giveItem, itemDef, itemList, useItem } from '../src/sim/items';
import { fxOf, hasFx } from '../src/sim/effects';
import { hit } from '../src/sim/helpers';
import { T } from '../src/tunables';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const PLAYA = 16;
const IDLE: Input = { t: 0, s: 0, d: false, item: false };
const GAS: Input = { t: 1, s: 0, d: false, item: false };

function race(seed = 5, ch = 0): World {
  const tr = cache.ensureBuilt(PLAYA), grid = buildGrid(new Rng(seed), [{ ch, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: PLAYA, diff: 1, seed, laps: LAPS, grid }, tr);
  while (w.phase === 'countdown') step(w, [IDLE]);
  takeEvents(w);
  return w;
}
function place(w: World, k: Kart, i: number, lat = 0) {
  const tr = w.track, j = ((i % tr.N) + tr.N) % tr.N, a = tr.ang[j]!;
  k.idx = j; k.prog = j; k.x = tr.x[j]! - dsin(a) * lat; k.y = tr.y[j]! + dcos(a) * lat; k.a = k.va = a; k.speed = 0; k.spin = 0; k.invuln = 0; k.respawn = 0;
}
function parkOthers(w: World, keep: Kart[]) {
  w.karts.forEach((k, n) => { if (!keep.includes(k)) place(w, k, 900 + n * 6, (n % 2 ? 1 : -1) * 20); });
}
const freeze = (w: World) => w.karts.forEach((k) => { if (k.ai) k.ai.speed = 0; });
function run(w: World, ticks: number, inp: Input = IDLE): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) { step(w, [inp]); ev.push(...takeEvents(w)); }
  return ev;
}
const types = (ev: GameEvent[], t: string) => ev.filter((e) => e.type === t);
const baseSpeed = (k: Kart) => T.driving.baseSpeed * k.st.spd;

test('los tres objetos están registrados con sus tunables y su aiScore', () => {
  for (const id of ['dios', 'infinito', 'piloto']) {
    const d = itemDef(id);
    expect(d.aiScore).toBeDefined();
    expect(itemList().some((x) => x.id === id)).toBe(true);
  }
  expect(T.items.dios.time).toBe(6);
  expect(T.items.dios.maxMul).toBeCloseTo(1.15, 5);
  expect(T.items.infinito.time).toBe(6);
  expect(T.items.infinito.boost).toBeCloseTo(0.6, 5);
  expect(T.items.piloto.time).toBe(5);
  expect(T.items.piloto.maxMul).toBeCloseTo(1.6, 5);
  expect(T.items.piloto.afterInvuln).toBeCloseTo(0.5, 5);
});

// ---------------------------------------------------------------- Modo Dios
test('Modo Dios: 6 s invencible, +15 % de punta, golpea al contacto y avisa con godStart/godEnd', () => {
  const w = race(), k = w.karts[0]!, other = w.karts[1]!;
  parkOthers(w, [k, other]); freeze(w);
  place(w, k, 40); place(w, other, 40, 0);
  giveItem(w, k, 'dios');
  const ev0: GameEvent[] = [];
  useItem(w, k); ev0.push(...takeEvents(w));
  expect(types(ev0, 'godStart').length).toBe(1);
  expect(hasFx(k, 'god')).toBe(true);
  expect(fxOf(k, 'god')!.t).toBeCloseTo(6, 5);
  expect(k.item).toBeNull();
  // invencible: ni los golpes ni los giros le afectan
  expect(hit(w, k, 1, 3)).toBe(false);
  expect(k.spin).toBe(0);
  // punta +15 %
  place(w, other, 900);
  place(w, k, 40);
  const ev = run(w, 60 * 3, GAS);
  expect(k.speed).toBeGreaterThan(baseSpeed(k) * 1.1);
  expect(k.speed).toBeLessThanOrEqual(baseSpeed(k) * T.items.dios.maxMul * 1.02);
  // acaba a los 6 s exactamente
  ev.push(...run(w, 60 * 3 + 5, GAS));
  expect(hasFx(k, 'god')).toBe(false);
  expect(types(ev, 'godEnd').length).toBe(1);
  expect(hit(w, k, 1, 3)).toBe(true); // ya no es invencible
});

test('Modo Dios: arrolla al kart que toca y no sufre la penalización fuera de pista', () => {
  const w = race(), k = w.karts[0]!, rival = w.karts[1]!;
  parkOthers(w, [k, rival]); freeze(w);
  place(w, k, 60); place(w, rival, 60, 0);
  giveItem(w, k, 'dios'); useItem(w, k); takeEvents(w);
  k.speed = 120; rival.speed = 0; rival.x = k.x + dcos(k.a) * 4; rival.y = k.y + dsin(k.a) * 4;
  run(w, 3, GAS);
  expect(rival.spin).toBeGreaterThan(0);
  expect(k.spin).toBe(0);
  // fuera de pista (hierba) sigue a velocidad de dios
  const w2 = race(7), g = w2.karts[0]!;
  parkOthers(w2, [g]); freeze(w2);
  place(w2, g, 80, w2.track.wd[80]! + 30); // out of the road
  giveItem(w2, g, 'dios'); useItem(w2, g); takeEvents(w2);
  run(w2, 60 * 2, GAS);
  const w3 = race(7), n = w3.karts[0]!;
  parkOthers(w3, [n]); freeze(w3);
  place(w3, n, 80, w3.track.wd[80]! + 30);
  run(w3, 60 * 2, GAS);
  expect(g.speed).toBeGreaterThan(n.speed * 1.3);
});

// ---------------------------------------------------------------- Overclock Infinito
test('Overclock Infinito: 6 s en los que cada pulsación del objeto da un turbo de 0.6 s', () => {
  const w = race(), k = w.karts[0]!;
  parkOthers(w, [k]); freeze(w);
  place(w, k, 40);
  giveItem(w, k, 'infinito'); useItem(w, k);
  expect(hasFx(k, 'ocinf')).toBe(true);
  expect(fxOf(k, 'ocinf')!.t).toBeCloseTo(6, 5);
  expect(k.item).toBeNull();
  takeEvents(w);
  k.boost = 0;
  const ev = run(w, 1, { t: 1, s: 0, d: false, item: true });
  expect(k.boost).toBeGreaterThan(T.items.infinito.boost - 0.1);
  const boosts = types(ev, 'boost') as Extract<GameEvent, { type: 'boost' }>[];
  expect(boosts.length).toBe(1);
  expect(boosts[0]!.src).toBe('overclockInf');
  // sin pulsar no hay turbo nuevo: el boost se gasta
  run(w, 60, GAS);
  expect(k.boost).toBeLessThanOrEqual(1e-9);
  // cada pulsación vuelve a darlo
  const ev2 = [...run(w, 1, { t: 1, s: 0, d: false, item: true }), ...run(w, 40, GAS), ...run(w, 1, { t: 1, s: 0, d: false, item: true })];
  expect(types(ev2, 'boost').length).toBe(2);
});

test('Overclock Infinito: pasados los 6 s ya no hay turbo por pulsación', () => {
  const w = race(), k = w.karts[0]!;
  parkOthers(w, [k]); freeze(w);
  place(w, k, 40);
  giveItem(w, k, 'infinito'); useItem(w, k);
  run(w, 60 * 6 + 5, IDLE);
  expect(hasFx(k, 'ocinf')).toBe(false);
  takeEvents(w);
  k.boost = 0;
  const ev = run(w, 2, { t: 0, s: 0, d: false, item: true });
  expect(types(ev, 'boost').length).toBe(0);
  expect(k.boost).toBeLessThanOrEqual(1e-9);
});

test('Overclock Infinito: la IA lo usa sola con un ritmo fijo', () => {
  const w = race(9);
  const ai = w.karts.find((q) => q.ctrl === 'ai')!;
  parkOthers(w, [w.karts[0]!, ai]);
  place(w, ai, 40);
  giveItem(w, ai, 'infinito'); useItem(w, ai); takeEvents(w);
  const ev = run(w, 60 * 5);
  const n = (types(ev, 'boost') as Extract<GameEvent, { type: 'boost' }>[]).filter((e) => e.kart === ai.id).length;
  expect(n).toBeGreaterThanOrEqual(4);
  expect(n).toBeLessThanOrEqual(8);
});

// ---------------------------------------------------------------- Piloto Automático
test('Piloto Automático: conduce solo por la línea a 1.6× la base, invulnerable, y al acabar 0.5 s de invulnerabilidad', () => {
  const w = race(), k = w.karts[0]!;
  parkOthers(w, [k]); freeze(w);
  place(w, k, 40);
  giveItem(w, k, 'piloto');
  const ev = [...(useItem(w, k), takeEvents(w))];
  expect(types(ev, 'autoStart').length).toBe(1);
  expect(hasFx(k, 'auto')).toBe(true);
  expect(hit(w, k, 1, 3)).toBe(false);
  const p0 = k.prog;
  let worst = 0;
  for (let i = 0; i < 60 * 4; i++) {
    step(w, [IDLE]); ev.push(...takeEvents(w)); // sin input: lo hace él
    worst = Math.max(worst, Math.abs(lateralAt(w.track, k.idx, k.x, k.y)) - w.track.wd[k.idx]!);
  }
  expect(k.prog).toBeGreaterThan(p0 + 120); // 4 s at ~230 u/s, 6 u per sample
  expect(k.speed).toBeGreaterThan(baseSpeed(k) * 1.45);
  expect(worst).toBeLessThan(2); // se queda en la pista
  // termina a los 5 s
  ev.push(...run(w, 60 + 6, IDLE));
  expect(hasFx(k, 'auto')).toBe(false);
  expect(types(ev, 'autoEnd').length).toBe(1);
  expect(k.invuln).toBeGreaterThan(0.3);
  expect(k.invuln).toBeLessThanOrEqual(T.items.piloto.afterInvuln);
  expect(hit(w, k, 1, 3)).toBe(false); // la invulnerabilidad de después
});

test('Piloto Automático: puede pasar al líder (no se detiene detrás de él) y arrolla lo que toca', () => {
  const w = race(), k = w.karts[0]!, rival = w.karts[1]!;
  parkOthers(w, [k, rival]); freeze(w);
  place(w, k, 40); place(w, rival, 70);
  w.karts.forEach((q, i) => (q.rank = q === k ? 1 : q === rival ? 0 : i + 1));
  w.ranked = [rival.id, k.id, ...w.karts.map((q) => q.id).filter((id) => id !== k.id && id !== rival.id)];
  giveItem(w, k, 'piloto'); useItem(w, k); takeEvents(w);
  rival.speed = 0;
  run(w, 60 * 3, IDLE);
  expect(k.prog).toBeGreaterThan(rival.prog); // lo ha pasado
  expect(hasFx(k, 'auto')).toBe(true);
});

// ---------------------------------------------------------------- IA y replay
test('aiScore: Piloto Automático solo si no vas el primero; los otros dos puntúan en 0..1', () => {
  const w = race(), k = w.karts[0]!;
  k.rank = 5; k.hold = 10;
  for (const id of ['dios', 'infinito', 'piloto']) {
    const s = itemDef(id).aiScore!(w, k);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1.5);
  }
  expect(itemDef('piloto').aiScore!(w, k)).toBeGreaterThan(0.5);
  k.rank = 0;
  expect(itemDef('piloto').aiScore!(w, k)).toBe(0);
});

test('determinismo: dos carreras iguales donde el humano usa los 3 objetos dan el mismo hash (y la IA también los usa)', () => {
  const seed = 31, order = ['dios', 'infinito', 'piloto'];
  const run3 = () => {
    const grid = buildGrid(new Rng(seed), [{ ch: 3, ctrl: 'local' }], { humanSlot: 8 });
    const w = createWorld({ trackIndex: PLAYA, diff: 1, seed, laps: LAPS, grid }, cache.ensureBuilt(PLAYA)), me = w.karts.findIndex((k) => k.ctrl === 'local');
    const seen = new Set<string>();
    for (let t = 0; t < 60 * 50; t++) {
      const k = w.karts[me]!, give = t > 60 * 5 && t % 600 === 0;
      if (give && !k.item) giveItem(w, k, order[((t / 600) | 0) % order.length]!);
      const inputs: Input[] = [];
      inputs[me] = { t: 1, s: 0, d: false, item: give || (t % 45 === 0 && hasFx(k, 'ocinf')) };
      step(w, inputs);
      for (const e of takeEvents(w)) if (e.type === 'godStart' || e.type === 'autoStart' || (e.type === 'boost' && e.src === 'overclockInf')) seen.add(e.type);
    }
    return { h: hashWorld(w), seen };
  };
  const a = run3(), b = run3();
  expect(a.h).toBe(b.h);
  expect(a.seen.size).toBeGreaterThanOrEqual(2);
}, 60000);
