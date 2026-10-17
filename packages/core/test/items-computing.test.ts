// Computing-themed items (backlog #64-#67): Overclock, Fork Bomb, Antivirus, Pico de Latencia.
import { expect, test } from 'bun:test';
import { ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, dsin, prepAuthored, step, takeEvents, type Input, type Kart, type World } from '../src';
import { addFx, fxOf } from '../src/sim/effects';
import { giveItem, useItem } from '../src/sim/items';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const PLAYA = 16;
const IDLE: Input = { t: 0, s: 0, d: false, item: false };
const GAS: Input = { t: 1, s: 0, d: false, item: false };

function race(seed = 5): World {
  const tr = cache.ensureBuilt(PLAYA), grid = buildGrid(new Rng(seed), [{ ch: 0, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: PLAYA, diff: 1, seed, laps: LAPS, grid }, tr);
  while (w.phase === 'countdown') step(w, [IDLE]);
  takeEvents(w);
  return w;
}
function place(w: World, k: Kart, i: number) {
  const tr = w.track, j = ((i % tr.N) + tr.N) % tr.N, a = tr.ang[j]!;
  k.idx = j; k.prog = j; k.x = tr.x[j]!; k.y = tr.y[j]!; k.a = k.va = a; k.speed = 0; k.spin = 0; k.invuln = 0; k.respawn = 0;
}
const freeze = (w: World) => w.karts.forEach((k) => { if (k.ai) k.ai.speed = 0; });

test('Overclock: con gas a fondo llega más rápido que sin él', () => {
  const run = (use: boolean) => {
    const w = race(), k = w.karts[0]!;
    freeze(w);
    if (use) { giveItem(w, k, 'overclock'); useItem(w, k); expect(fxOf(k, 'oc')).toBeDefined(); }
    for (let i = 0; i < 240; i++) step(w, [GAS]);
    return k.speed;
  };
  expect(run(true)).toBeGreaterThan(run(false));
}, 30000);

test('Fork Bomb: deja tres minas detrás', () => {
  const w = race(), k = w.karts[0]!, before = w.ents.filter((e) => e.kind === 'mine').length;
  giveItem(w, k, 'forkbomb'); useItem(w, k);
  const mines = w.ents.filter((e) => e.kind === 'mine' && e.owner === k.id);
  expect(w.ents.filter((e) => e.kind === 'mine').length - before).toBe(3);
  expect(mines.length).toBe(3);
  expect(k.item).toBeNull();
});

test('Antivirus: limpia los debuffs y bloquea los nuevos mientras dura', () => {
  const w = race(), k = w.karts[0]!;
  addFx(k, 'inv', 3); addFx(k, 'lag', 3);
  giveItem(w, k, 'antivirus'); useItem(w, k);
  expect(fxOf(k, 'inv')).toBeUndefined();
  expect(fxOf(k, 'lag')).toBeUndefined();
  expect(fxOf(k, 'av')).toBeDefined();
  expect(addFx(k, 'inv', 3)).toBe(false);
  expect(addFx(k, 'lag', 3)).toBe(false);
});

test('Pico de Latencia: frena a todos los de delante; el líder no afecta a nadie', () => {
  const w = race(), k = w.karts[0]!;
  freeze(w);
  w.karts.forEach((o, n) => { if (o !== k) place(w, o, 400 + n * 6); });
  place(w, k, 10);
  step(w, [IDLE]); // refresh the ranking
  expect(k.rank).toBeGreaterThan(0);
  giveItem(w, k, 'lagspike'); useItem(w, k);
  for (const o of w.karts) if (o.rank < k.rank) expect(fxOf(o, 'lag')).toBeDefined();
  expect(fxOf(k, 'lag')).toBeUndefined();
  // leading kart: nobody ahead, so nobody lags (a use with no effect still consumes the item, like any other)
  const lead = w.ranked.map((id) => w.karts[id]!)[0]!;
  lead.item = null; giveItem(w, lead, 'lagspike'); useItem(w, lead);
  expect(w.karts.filter((o) => fxOf(o, 'lag')).length).toBe(w.karts.filter((o) => o.rank < k.rank).length);
}, 30000);

void dsin;
