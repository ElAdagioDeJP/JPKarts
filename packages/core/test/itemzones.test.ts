// Item odds v3 (docs/V3_PLAN.md §2.5): 6 zones, zone = max(zone by rank, zone by distance to the leader), 12 karts.
import { expect, test } from 'bun:test';
import '../src/items';
import { itemList, itemWeights, itemZone } from '../src/sim/items';
import { T } from '../src/tunables';

const N = 12, ids = () => itemList().map((i) => i.id);
const odds = (rank: number, dist = 0, n = N) => { const w = itemWeights(rank, n, dist), t = w.reduce((a, b) => a + b, 0); return Object.fromEntries(ids().map((id, i) => [id, w[i]! / t])); };
const NEW = ['dios', 'infinito', 'piloto'];
const WEAK = ['bocina', 'falsa', 'goma', 'ciego'];

test('con 12 karts el campo se divide en 6 zonas de 2 puestos', () => {
  expect(Array.from({ length: N }, (_, r) => itemZone(r, N))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  expect(itemZone(0, 1)).toBe(0);
  expect(itemZone(3, 4)).toBe(4); // 4 karts: floor(3·6/4)
  expect(itemZone(7, 8)).toBe(5);
});

test('la zona es el máximo entre la zona por puesto y la zona por distancia al líder', () => {
  const D = T.items.distZones;
  expect(D.length).toBe(6);
  expect(D[0]).toBe(0);
  // sin distancia manda el puesto
  expect(itemZone(2, N, 0)).toBe(1);
  // mucha distancia sube la zona aunque vayas 3.º
  expect(itemZone(2, N, D[5]!)).toBe(5);
  expect(itemZone(2, N, D[3]!)).toBe(3);
  expect(itemZone(2, N, D[3]! - 1)).toBe(2);
  // el puesto manda cuando es mayor que la distancia
  expect(itemZone(10, N, D[1]!)).toBe(5);
  // el líder, a distancia 0: zona 0
  expect(itemZone(0, N, 0)).toBe(0);
});

test('los umbrales de distancia crecen', () => {
  const D = T.items.distZones;
  for (let i = 1; i < D.length; i++) expect(D[i]!).toBeGreaterThan(D[i - 1]!);
});

test('todo objeto con caja tiene 6 pesos y alguno positivo', () => {
  const Z = T.items.zones as Record<string, number[]>;
  for (const it of itemList()) if (!it.noRoll) {
    expect(Z[it.id]?.length).toBe(6);
    expect(Z[it.id]!.some((x) => x > 0)).toBe(true);
    for (const x of Z[it.id]!) expect(x).toBeGreaterThanOrEqual(0);
  }
});

test('los objetos flojos nunca salen del 7.º-8.º puesto hacia atrás (12 karts)', () => {
  for (let r = 6; r < N; r++) for (const id of WEAK) expect(odds(r)[id]).toBe(0);
  // ni por distancia: un 3.º muy lejos del líder tampoco los recibe
  for (const id of WEAK) expect(odds(2, T.items.distZones[3]!)[id]).toBe(0);
  // pero delante sí existen
  for (const id of WEAK) expect(odds(0)[id]).toBeGreaterThan(0);
});

test('Turbo Triple y Overclock solo desde la zona 4', () => {
  for (const id of ['turbo3', 'overclock']) {
    for (let r = 0; r < 6; r++) expect(odds(r)[id]).toBe(0);
    expect(odds(6)[id]).toBeGreaterThan(0);
  }
});

test('Modo Dios (zonas 5-6), Overclock Infinito (4-6) y Piloto Automático (solo la 6); ninguno en 1-3', () => {
  for (let r = 0; r < 6; r++) for (const id of NEW) expect(odds(r)[id]).toBe(0);
  expect(odds(6).dios).toBe(0);
  expect(odds(6).infinito).toBeGreaterThan(0);
  expect(odds(8).dios).toBeGreaterThan(0);
  expect(odds(8).infinito).toBeGreaterThan(0);
  expect(odds(8).piloto).toBe(0);
  expect(odds(10).piloto).toBeGreaterThan(0);
  expect(odds(11).piloto).toBeGreaterThan(0);
  expect(odds(2, T.items.distZones[5]!).piloto).toBeGreaterThan(0); // la distancia también abre la zona 6
});

test('el 12.º tiene al menos un 25 % de probabilidad de uno de los 3 nuevos', () => {
  const o = odds(11), p = NEW.reduce((a, id) => a + o[id]!, 0);
  expect(p).toBeGreaterThanOrEqual(0.25);
  expect(p).toBeLessThan(0.6); // no todo son los nuevos
});

test('los objetos fuertes tienen más probabilidad cuanto más atrás vas', () => {
  const strong = ['ciego3', 'dron', 'gancho', 'lagspike', 'rafaga', 'cadena', 'inversor', 'pem', 'jugger', 'agujero', 'bala', ...NEW];
  const sum = (r: number) => strong.reduce((a, id) => a + odds(r)[id]!, 0);
  expect(sum(0)).toBeLessThan(sum(4));
  expect(sum(4)).toBeLessThan(sum(8));
  expect(sum(8)).toBeLessThan(sum(11));
  expect(sum(11)).toBeGreaterThan(0.6);
});

test('los chetados nunca salen delante (puestos 1-6)', () => {
  for (const r of [0, 1, 2, 3, 4, 5]) for (const id of ['cuantico', 'bala', 'agujero', 'jugger']) expect(odds(r)[id]).toBe(0);
});

test('el Intercambio Cuántico sigue siendo el objeto más raro de las zonas de atrás y solo sale desde atrás', () => {
  const all = [8, 11].flatMap((r) => itemWeights(r, N, 0).map((w, i) => ({ id: ids()[i]!, w }))).filter((x) => x.w > 0);
  const min = Math.min(...all.map((x) => x.w)), lowest = all.filter((x) => x.w === min);
  expect(lowest.map((x) => x.id)).toEqual(['cuantico']);
  expect(odds(0).cuantico).toBe(0);
  expect(odds(11).cuantico).toBeGreaterThan(0);
});

test('con pocos karts (8) las reglas siguen: los flojos fuera de los 3 últimos puestos', () => {
  for (let r = 4; r < 8; r++) for (const id of WEAK) expect(odds(r, 0, 8)[id]).toBe(0);
});
