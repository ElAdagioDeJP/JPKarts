// V3-1: sistema de stats estilo Mario Kart (docs/V3_PLAN.md §2.1-2.2).
import { describe, expect, test } from 'bun:test';
import { ALL_TRACKS, CHARS, LAPS, Rng, T, TrackCache, buildGrid, createWorld, prepAuthored, spawn, step, takeEvents, wrapA, type GameEvent, type World } from '../src';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const byName = (n: string) => CHARS.findIndex((c) => c.name === n);
const IDLE = { t: 0, s: 0, d: false, item: false };

/** A race with one human (`ch`) already in the 'race' phase. */
function raceWith(ch: number, track = 0, seed = 5): World {
  const grid = buildGrid(new Rng(seed), [{ ch, ctrl: 'local' }], { humanSlot: 0 });
  const w = createWorld({ trackIndex: track, diff: 1, seed, laps: LAPS, grid }, cache.ensureBuilt(track));
  for (let i = 0; i < 60 * 8 && w.phase !== 'race'; i++) step(w, [IDLE]);
  takeEvents(w);
  return w;
}

describe('stats: datos', () => {
  test('cada piloto suma 25 puntos visibles', () => {
    for (const c of CHARS) {
      const { vel, ace, pes, man, tra } = c.st;
      expect(vel + ace + pes + man + tra).toBeCloseTo(25, 6);
    }
  });
  test('la clase sale del peso: <4 ligero, >=6 pesado', () => {
    for (const c of CHARS) expect(c.weightClass).toBe(c.st.pes < 4 ? 'ligero' : c.st.pes >= 6 ? 'pesado' : 'medio');
  });
  test('regla de Mario: el pesado tiene ~8 % más de punta que el ligero y el ligero más mini-turbo', () => {
    const light = CHARS[byName('Marco')]!, heavy = CHARS[byName('Luis')]!;
    expect(heavy.spd / light.spd).toBeGreaterThan(1.07);
    expect(heavy.spd / light.spd).toBeLessThan(1.1);
    expect(light.mt).toBeGreaterThan(heavy.mt);
    expect(light.acl).toBeGreaterThan(heavy.acl);
    expect(light.hnd).toBeGreaterThan(heavy.hnd);
  });
  test('JP ya no tiene ventaja de presupuesto', () => {
    const jp = CHARS[byName('JP')]!;
    expect(jp.st.vel + jp.st.ace + jp.st.pes + jp.st.man + jp.st.tra).toBeCloseTo(25, 6);
    expect(jp.fly).toBeLessThanOrEqual(5); // pesado: poco vuelo
  });
  test('stats.json forma parte de los tunables', () => {
    expect(T.stats.speedGlobal).toBeGreaterThan(1);
  });
});

describe('stats: física', () => {
  test('un ligero carga el mini-turbo antes que un pesado', () => {
    const levelTick = (ch: number): number => {
      const w = raceWith(ch);
      const k = w.karts[0]!;
      let tick = -1;
      for (let i = 0; i < 60 * 3; i++) {
        step(w, [{ t: 1, s: i < 30 ? 0 : 1, d: i >= 30, item: false }]);
        for (const e of takeEvents(w) as GameEvent[]) if (e.type === 'driftLevel' && e.kart === k.id && e.level === 1 && tick < 0) tick = i;
      }
      return tick;
    };
    const light = levelTick(byName('Marco')), heavy = levelTick(byName('Luis'));
    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(0);
    expect(light).toBeLessThan(heavy);
  }, 60000);

  test('en recta el pesado alcanza más velocidad que el ligero', () => {
    const top = (ch: number) => {
      const w = raceWith(ch);
      const k = w.karts[0]!;
      let m = 0;
      for (let i = 0; i < 60 * 3.5; i++) { step(w, [{ t: 1, s: 0, d: false, item: false }]); m = Math.max(m, k.speed); }
      return m;
    };
    expect(top(byName('Luis'))).toBeGreaterThan(top(byName('Marco')) * 1.05);
  }, 60000);

  test('con más tracción, el hielo penaliza menos: el kart realinea su rumbo más rápido', () => {
    const slip = (ch: number) => {
      const w = raceWith(ch);
      const k = w.karts[0]!;
      k.speed = 100;
      spawn(w, 'ice', { x: k.x, y: k.y, z: k.z, r: 80, life: 30, owner: -1 });
      k.va = wrapA(k.a + 0.6);
      step(w, [IDLE]);
      return Math.abs(wrapA(k.va - k.a)); // lo que queda de desvío tras un tick: menos = más agarre
    };
    const low = slip(byName('Miguel')), high = slip(byName('Guaycaipuro')); // tra 4 vs 6
    expect(high).toBeLessThan(low);
  }, 60000);

  test('con más tracción se pierde menos velocidad fuera de pista', () => {
    const offMax = (ch: number) => {
      const w = raceWith(ch);
      const k = w.karts[0]!;
      // saca el kart lateralmente de la pista a toda velocidad
      const tr = w.track;
      const j = k.idx, nx = -Math.sin(tr.ang[j]!), ny = Math.cos(tr.ang[j]!);
      k.x += nx * (tr.wd[j]! + 40); k.y += ny * (tr.wd[j]! + 40);
      k.speed = 200;
      for (let i = 0; i < 45; i++) step(w, [IDLE]);
      return k.speed;
    };
    // Mismo base de velocidad (vel 5) y distinta tracción
    const low = offMax(byName('Miguel')), high = offMax(byName('Guaycaipuro'));
    expect(high).toBeGreaterThan(low);
  }, 60000);
});
