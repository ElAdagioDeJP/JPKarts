// Runs in its own process (registries are global): registers a brand-new effect + item like a new file would.
import { LAPS, Rng, TRACK_DEFS, addFx, buildGrid, buildTrack, createWorld, defineEffect, defineItem, hasFx, prepTrack, step, takeEvents } from '../../src';

defineEffect({ type: 'test_lento', tags: ['slow'], speed: { order: 25, apply(c) { c.max *= 0.5; } } });
defineItem({ id: 'test_ralentizar', name: 'Prueba', w: 0.0001, role: 'caos', use(w, k) { for (const o of w.karts) if (o !== k) addFx(o, 'test_lento', 2, k.id); } });

const track = buildTrack(prepTrack(TRACK_DEFS[0]!));
const grid = buildGrid(new Rng(1), [{ ch: 0, ctrl: 'local' }], { humanSlot: 0 });
const w = createWorld({ trackIndex: 0, diff: 1, seed: 3, laps: LAPS, grid }, track);
for (let i = 0; i < 300; i++) { step(w, [{ t: 1, s: 0, d: false, item: false }]); takeEvents(w); }
w.karts[0]!.item = 'test_ralentizar';
step(w, [{ t: 1, s: 0, d: false, item: true }]);
const ev = takeEvents(w);
const used = ev.some((e) => e.type === 'itemUse' && e.item === 'test_ralentizar');
const applied = w.karts.slice(1).every((k) => hasFx(k, 'test_lento'));
console.log(JSON.stringify({ used, applied }));
