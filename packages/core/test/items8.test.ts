// Phase 8 mechanics: coins and the reworked/new items. Each test builds a small deterministic situation on
// Playa Coco v2, places karts by hand and checks the rule from docs/GDD.md §3–§4.
import { expect, test } from 'bun:test';
import { ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, dcos, dsin, prepAuthored, step, takeEvents, type GameEvent, type Input, type Kart, type World } from '../src';
import { giveItem, useItem } from '../src/sim/items';
import { fxOf } from '../src/sim/effects';
import { hit } from '../src/sim/helpers';
import { T } from '../src/tunables';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const PLAYA = 16;
const IDLE: Input = { t: 0, s: 0, d: false, item: false };

/** A race already past the countdown, kart 0 human. */
function race(seed = 5): World {
  const tr = cache.ensureBuilt(PLAYA), grid = buildGrid(new Rng(seed), [{ ch: 0, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: PLAYA, diff: 1, seed, laps: LAPS, grid }, tr);
  while (w.phase === 'countdown') step(w, [IDLE]);
  takeEvents(w);
  return w;
}
/** Put a kart on the track sample `i` (wrapped) at lateral offset `lat`, facing along the track, stopped. */
function place(w: World, k: Kart, i: number, lat = 0) {
  const tr = w.track, j = ((i % tr.N) + tr.N) % tr.N, a = tr.ang[j]!;
  k.idx = j; k.prog = j; k.x = tr.x[j]! - dsin(a) * lat; k.y = tr.y[j]! + dcos(a) * lat; k.a = k.va = a; k.speed = 0; k.spin = 0; k.invuln = 0; k.respawn = 0;
}
/** Park every kart except the listed ones far behind the action. */
function parkOthers(w: World, keep: Kart[]) {
  w.karts.forEach((k, n) => { if (!keep.includes(k)) place(w, k, 900 + n * 6, (n % 2 ? 1 : -1) * 20); });
}
function run(w: World, ticks: number, inp: Input = IDLE): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) { step(w, [inp]); ev.push(...takeEvents(w)); }
  return ev;
}
const freeze = (w: World) => w.karts.forEach((k) => { if (k.ai) k.ai.speed = 0; });

test('monedas: hay líneas en la pista, se recogen, dan velocidad y se pierden 3 por golpe', () => {
  const w = race();
  const coins = w.ents.filter((e) => e.kind === 'coin');
  expect(coins.length).toBeGreaterThanOrEqual(16);
  const k = w.karts[0]!, c = coins[0]!;
  k.x = c.x; k.y = c.y; k.z = c.z - 4;
  run(w, 1);
  expect(k.coins).toBe(1);
  expect(k.boost).toBeGreaterThan(0); // the first coin gives a tiny boost
  k.coins = 5;
  hit(w, k, 1, 1);
  expect(k.coins).toBe(2);
  expect(w.ents.filter((e) => e.kind === 'coin' && e.target === 0).length).toBe(3);
  // the track coin comes back after its respawn time
  expect(c.t).toBeGreaterThan(0);
  place(w, k, 700);
  k.respawn = 99; // out of the way
  run(w, Math.ceil(T.race.coins.respawn * 60) + 2);
  expect(c.t).toBeLessThanOrEqual(0);
});

test('Turbo Triple: tres usos antes de gastarse', () => {
  const w = race(), k = w.karts[0]!;
  giveItem(w, k, 'turbo3');
  for (let n = 0; n < 3; n++) { expect(k.item).toBe('turbo3'); k.boost = 0; useItem(w, k); expect(k.boost).toBeGreaterThan(0); }
  expect(k.item).toBeNull();
});

test('Triple Ciego: cada proyectil en órbita bloquea un golpe', () => {
  const w = race(), k = w.karts[0]!;
  giveItem(w, k, 'ciego3');
  expect(fxOf(k, 'orbit')).toBeDefined();
  expect(hit(w, k, 1, 1)).toBe(false);
  expect(k.itemN).toBe(2);
  useItem(w, k);
  useItem(w, k);
  expect(k.item).toBeNull();
  expect(fxOf(k, 'orbit')).toBeUndefined();
  expect(w.ents.filter((e) => e.kind === 'shot').length).toBe(2);
});

test('Bumerán: golpea al de delante, vuelve y se atrapa una vez', () => {
  const w = race(), k = w.karts[0]!, o = w.karts[1]!;
  freeze(w);
  parkOthers(w, [k, o]);
  place(w, k, 300);
  place(w, o, 300 + 20); // ~120 u ahead
  k.a = Math.atan2(o.y - k.y, o.x - k.x);
  giveItem(w, k, 'bumeran');
  useItem(w, k);
  const ev = run(w, 60 * 3);
  expect(ev.some((e) => e.type === 'hit' && e.kart === o.id)).toBe(true);
  expect(ev.some((e) => e.type === 'catch' && e.kart === k.id)).toBe(true);
  expect(k.item).toBe('bumeranR');
});

test('Cadena de Rayos: salta del de delante a los karts cercanos (máx. 3)', () => {
  const w = race(), k = w.karts[0]!, [a, b, c, d] = [w.karts[1]!, w.karts[2]!, w.karts[3]!, w.karts[4]!];
  freeze(w);
  parkOthers(w, [k, a, b, c, d]);
  place(w, k, 300); place(w, a, 330); place(w, b, 336, 15); place(w, c, 342, -15); place(w, d, 348);
  run(w, 1);
  k.prog = 300; a.prog = 348 + 4; // `a` leads… make sure the kart right ahead of k is the closest one
  w.ranked = [d.id, c.id, b.id, a.id, k.id, ...w.karts.filter((x) => ![k, a, b, c, d].includes(x)).map((x) => x.id)];
  w.ranked.forEach((id, r) => (w.karts[id]!.rank = r));
  giveItem(w, k, 'cadena');
  useItem(w, k);
  const zaps = takeEvents(w).filter((e) => e.type === 'zap');
  expect(zaps.length).toBe(T.items.cadena.hops + 1);
});

test('Cortina de Humo: la IA dentro pierde precisión y el humano ve la nube', () => {
  const w = race(), k = w.karts[0]!, ai = w.karts[1]!;
  freeze(w);
  parkOthers(w, [k, ai]);
  place(w, k, 300);
  place(w, ai, 300 - 5);
  giveItem(w, k, 'humo');
  useItem(w, k);
  run(w, 2);
  expect(fxOf(ai, 'fog')).toBeDefined();
});

test('Ráfaga: empuja de lado a los karts junto a ti', () => {
  const w = race(), k = w.karts[0]!, o = w.karts[1]!;
  freeze(w);
  parkOthers(w, [k, o]);
  place(w, k, 300, -10);
  place(w, o, 300, 25);
  const lat0 = 25;
  giveItem(w, k, 'rafaga');
  useItem(w, k);
  const tr = w.track, a = tr.ang[o.idx]!, lat = (o.x - tr.x[o.idx]!) * -dsin(a) + (o.y - tr.y[o.idx]!) * dcos(a);
  expect(lat - lat0).toBeGreaterThan(T.items.rafaga.push * 0.4);
});

test('Turbo Bala: piloto automático rápido que termina antes de pasar al líder', () => {
  const w = race(), k = w.karts[0]!;
  freeze(w);
  w.karts.forEach((o, n) => { if (o !== k) place(w, o, 600 + n * 4, (n % 2 ? 1 : -1) * 20); });
  place(w, k, 200);
  run(w, 1);
  expect(k.rank).toBeGreaterThan(1);
  giveItem(w, k, 'bala');
  useItem(w, k);
  expect(fxOf(k, 'bala')).toBeDefined();
  const p0 = k.prog;
  run(w, 60 * 2);
  expect(k.prog - p0).toBeGreaterThan(50); // ≥ 300 u in 2 s
  run(w, 60 * 4);
  expect(fxOf(k, 'bala')).toBeUndefined();
  // used from 1st or 2nd it does nothing (the item is spent, as in the legacy game)
  giveItem(w, k, 'bala');
  k.rank = 1;
  useItem(w, k);
  expect(fxOf(k, 'bala')).toBeUndefined();
});

test('Caja Falsa: también golpea a la IA', () => {
  const w = race(), k = w.karts[0]!, ai = w.karts[1]!;
  freeze(w);
  parkOthers(w, [k, ai]);
  place(w, k, 300);
  giveItem(w, k, 'falsa');
  useItem(w, k);
  const box = w.ents.find((e) => e.kind === 'fakebox')!;
  ai.x = box.x; ai.y = box.y;
  const ev = run(w, 2);
  expect(ev.some((e) => e.type === 'hit' && e.kart === ai.id)).toBe(true);
  expect(w.ents.some((e) => e.kind === 'fakebox')).toBe(false);
});

test('Imán: roba monedas al rival cercano', () => {
  const w = race(), k = w.karts[0]!, o = w.karts[1]!;
  freeze(w);
  parkOthers(w, [k, o]);
  place(w, k, 300); place(w, o, 310);
  o.coins = 5;
  giveItem(w, k, 'iman');
  useItem(w, k);
  expect(k.coins).toBe(T.items.iman.steal);
  expect(o.coins).toBe(5 - T.items.iman.steal);
  expect(fxOf(k, 'magnet')).toBeDefined();
});

test('Bloque de Hielo: deja una zona resbaladiza detrás', () => {
  const w = race(), k = w.karts[0]!;
  place(w, k, 300);
  giveItem(w, k, 'hielo');
  useItem(w, k);
  const ice = w.ents.find((e) => e.kind === 'ice')!;
  expect(ice.r).toBe(T.items.hielo.radius);
  run(w, Math.ceil(T.items.hielo.life * 60) + 2);
  expect(w.ents.some((e) => e.kind === 'ice')).toBe(false);
});
