// V3-3: piezas modulares y fórmula aditiva completa (docs/V3_PLAN.md §2.1, §2.4).
import { describe, expect, test } from 'bun:test';
import { ALL_TRACKS, CHARS, DEFAULT_LOADOUT, LAPS, PARTS, ReplayRecorder, Rng, TrackCache, buildGrid, createWorld, hashWorld, kartStats, partById, playReplay, prepAuthored, randomLoadout, step, takeEvents, validLoadout, type Input, type Loadout } from '../src';

const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const idx = (n: string) => CHARS.findIndex((c) => c.name === n);

describe('parts.json: esquema', () => {
  test('ids únicos, tipos válidos y deltas dentro de [-2, 2]', () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
    for (const p of PARTS) {
      expect(['body', 'wheels', 'wing']).toContain(p.type);
      expect(p.name.length).toBeGreaterThan(0);
      for (const k of ['vel', 'ace', 'pes', 'man', 'tra', 'mt', 'vue'] as const) {
        expect(Math.abs(p[k])).toBeLessThanOrEqual(2);
        expect(Number.isFinite(p[k])).toBe(true);
      }
    }
  });
  test('catálogo 4 + 4 + 3', () => {
    expect(PARTS.filter((p) => p.type === 'body').length).toBe(4);
    expect(PARTS.filter((p) => p.type === 'wheels').length).toBe(4);
    expect(PARTS.filter((p) => p.type === 'wing').length).toBe(3);
  });
  test('cada pieza suma ≈ 0 entre las visibles ([-0.5, 0.5])', () => {
    for (const p of PARTS) expect(Math.abs(p.vel + p.ace + p.pes + p.man + p.tra)).toBeLessThanOrEqual(0.5);
  });
  test('el loadout por defecto existe y no cambia nada', () => {
    expect(validLoadout(DEFAULT_LOADOUT)).toBe(true);
    for (const t of ['body', 'wheels', 'wing'] as const) {
      const p = partById(DEFAULT_LOADOUT[t])!;
      expect(p.type).toBe(t);
      expect(p.vel + p.ace + p.pes + p.man + p.tra + p.mt + p.vue).toBe(0);
    }
  });
});

describe('validLoadout', () => {
  test('rechaza ids inexistentes, tipos cruzados y basura', () => {
    expect(validLoadout({ body: 'kernel', wheels: 'std', wing: 'wing' })).toBe(true);
    expect(validLoadout({ body: 'nope', wheels: 'std', wing: 'wing' })).toBe(false);
    expect(validLoadout({ body: 'std', wheels: 'kernel', wing: 'wing' })).toBe(false); // tipo cruzado
    expect(validLoadout({ body: 'kernel', wheels: 'std' })).toBe(false);
    expect(validLoadout(null)).toBe(false);
    expect(validLoadout('kernel')).toBe(false);
    expect(validLoadout({ body: 'kernel', wheels: 'std', wing: 'wing', extra: 1 })).toBe(false);
  });
  test('randomLoadout siempre es válido y determinista por semilla', () => {
    const a = randomLoadout(new Rng(5)), b = randomLoadout(new Rng(5));
    expect(a).toEqual(b);
    for (let s = 0; s < 40; s++) expect(validLoadout(randomLoadout(new Rng(s)))).toBe(true);
  });
});

describe('fórmula aditiva', () => {
  test('sin piezas = la base del personaje', () => {
    const jp = idx('JP'), st = kartStats(jp, DEFAULT_LOADOUT);
    expect(st.spd).toBeCloseTo(CHARS[jp]!.spd, 9);
    expect(st.fly).toBeCloseTo(CHARS[jp]!.fly, 9);
    expect(st.mtCharge).toBeCloseTo(CHARS[jp]!.mtCharge, 9);
  });
  test('Overdrive sube la velocidad y baja la aceleración respecto a Kernel', () => {
    const m = idx('Marco');
    const k = kartStats(m, DEFAULT_LOADOUT), o = kartStats(m, { ...DEFAULT_LOADOUT, body: 'overdrive' });
    expect(o.spd).toBeGreaterThan(k.spd);
    expect(o.acl).toBeLessThan(k.acl);
  });
  test('Todoterreno da tracción: pierdes menos fuera de pista y agarras más', () => {
    const m = idx('Marco');
    const k = kartStats(m, DEFAULT_LOADOUT), t = kartStats(m, { ...DEFAULT_LOADOUT, wheels: 'offroad' });
    expect(t.gripK).toBeGreaterThan(k.gripK);
    expect(t.offK).toBeLessThan(k.offK);
  });
  test('ala Planeadora: mucho más vuelo; ala Ligera: menos', () => {
    const m = idx('Marco');
    const k = kartStats(m, DEFAULT_LOADOUT), g = kartStats(m, { ...DEFAULT_LOADOUT, wing: 'glider' }), l = kartStats(m, { ...DEFAULT_LOADOUT, wing: 'light' });
    expect(g.fly).toBeGreaterThan(k.fly + 1.5);
    expect(l.fly).toBeLessThan(k.fly - 0.5);
  });
  test('las visibles se recortan a [0, 10] y las ocultas también', () => {
    const luis = idx('Luis'), st = kartStats(luis, { body: 'mainframe', wheels: 'slick', wing: 'glider' });
    expect(st.w).toBeLessThanOrEqual(10);
    expect(st.fly).toBeGreaterThanOrEqual(0);
    expect(st.fly).toBeLessThanOrEqual(10);
    expect(st.mtCharge).toBeGreaterThan(0.5);
  });
  test('mini-turbo oculto: el Mini lo sube y el Overdrive lo baja', () => {
    const m = idx('Miguel');
    const k = kartStats(m, DEFAULT_LOADOUT), mini = kartStats(m, { ...DEFAULT_LOADOUT, wheels: 'mini' }), od = kartStats(m, { ...DEFAULT_LOADOUT, body: 'overdrive' });
    expect(mini.mtCharge).toBeGreaterThan(k.mtCharge);
    expect(od.mtCharge).toBeLessThan(k.mtCharge);
  });
});

describe('en carrera', () => {
  test('el kart lleva sus stats con piezas; los demás, el loadout por defecto', () => {
    const lo: Loadout = { body: 'overdrive', wheels: 'slick', wing: 'light' };
    const humans = [{ ch: idx('JP'), ctrl: 'local' as const, parts: lo }];
    const grid = buildGrid(new Rng(3), humans, { humanSlot: 4 });
    const w = createWorld({ trackIndex: 0, diff: 1, seed: 3, laps: LAPS, grid }, cache.ensureBuilt(0));
    const me = w.karts[4]!;
    expect(me.st.spd).toBeCloseTo(kartStats(idx('JP'), lo).spd, 9);
    expect(w.karts[0]!.st.spd).toBeCloseTo(CHARS[w.karts[0]!.ch]!.spd, 9);
    // la misma base con piezas veloces corre más que sin piezas
    expect(me.st.spd).toBeGreaterThan(CHARS[idx('JP')]!.spd);
  });
  test('un loadout inválido en la config cae al de por defecto (nunca rompe la sim)', () => {
    const grid = buildGrid(new Rng(3), [{ ch: 0, ctrl: 'local', parts: { body: 'x', wheels: 'y', wing: 'z' } as unknown as Loadout }], { humanSlot: 0 });
    const w = createWorld({ trackIndex: 0, diff: 1, seed: 3, laps: LAPS, grid }, cache.ensureBuilt(0));
    expect(w.karts[0]!.st.spd).toBeCloseTo(CHARS[0]!.spd, 9);
  });
  test('misma semilla + mismos loadouts = mismo hash; distintos = distinto hash; el replay reproduce', () => {
    const run = (lo: Loadout) => {
      const grid = buildGrid(new Rng(21), [{ ch: 2, ctrl: 'local', parts: lo }], { humanSlot: 3 });
      const cfg = { trackIndex: 0, diff: 1, seed: 21, laps: LAPS, grid };
      const tr = cache.ensureBuilt(0), w = createWorld(cfg, tr), rec = new ReplayRecorder(cfg);
      const me = w.karts.findIndex((k) => k.ctrl === 'local');
      for (let t = 0; t < 60 * 20; t++) {
        const inputs: Input[] = [];
        inputs[me] = { t: 1, s: 0, d: false, item: false };
        rec.record(w, inputs); step(w, inputs); takeEvents(w); rec.after(w);
      }
      const back = playReplay(JSON.parse(JSON.stringify(rec.replay)), tr);
      return { h: hashWorld(w), same: back.mismatch === -1 && hashWorld(back.world) === hashWorld(w) };
    };
    const a = run({ body: 'overdrive', wheels: 'mini', wing: 'glider' }), a2 = run({ body: 'overdrive', wheels: 'mini', wing: 'glider' }), b = run({ body: 'rover', wheels: 'offroad', wing: 'light' });
    expect(a.h).toBe(a2.h);
    expect(a.h).not.toBe(b.h);
    expect(a.same).toBe(true);
    expect(b.same).toBe(true);
  }, 60000);
});
