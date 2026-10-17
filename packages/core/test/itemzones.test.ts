import { expect, test } from 'bun:test';
import '../src/items';
import { itemList, itemWeights, itemZone } from '../src/sim/items';

const N = 8, ids = () => itemList().map((i) => i.id);
const odds = (rank: number) => { const w = itemWeights(rank, N), t = w.reduce((a, b) => a + b, 0); return Object.fromEntries(ids().map((id, i) => [id, w[i]! / t])); };

test('el campo se divide en tres zonas (8 karts: 3 + 3 + 2)', () => {
  expect(Array.from({ length: N }, (_, r) => itemZone(r, N))).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
  expect(itemZone(0, 1)).toBe(0);
  expect(itemZone(3, 4)).toBe(2);
});

test('todo objeto con caja tiene sus pesos por zona', () => {
  for (const it of itemList()) if (!it.noRoll) expect(itemWeights(0, N)[ids().indexOf(it.id)]! + itemWeights(3, N)[ids().indexOf(it.id)]! + itemWeights(7, N)[ids().indexOf(it.id)]!).toBeGreaterThan(0);
});

test('los básicos nunca salen en el último tercio; los chetados nunca delante', () => {
  for (const r of [6, 7]) for (const id of ['bocina', 'falsa', 'goma']) expect(odds(r)[id]).toBe(0);
  for (const r of [0, 1, 2]) for (const id of ['cuantico', 'bala', 'agujero', 'jugger', 'pem', 'cadena', 'rafaga', 'inversor']) expect(odds(r)[id]).toBe(0);
});

test('el Intercambio Cuántico es el objeto con menos peso de toda la tabla y solo sale atrás', () => {
  const all = [0, 3, 7].flatMap((r) => itemWeights(r, N).map((w, i) => ({ id: ids()[i]!, w }))).filter((x) => x.w > 0);
  const min = Math.min(...all.map((x) => x.w)), lowest = all.filter((x) => x.w === min);
  expect(lowest.map((x) => x.id)).toEqual(['cuantico']);
  expect(odds(7).cuantico).toBeGreaterThan(0);
  expect(odds(0).cuantico).toBe(0);
  expect(odds(3).cuantico).toBe(0);
});

test('los objetos fuertes tienen más probabilidad cuanto más atrás vas', () => {
  const strong = ['ciego3', 'dron', 'gancho', 'rafaga', 'cadena', 'inversor', 'pem', 'jugger', 'agujero', 'bala'];
  const sum = (r: number) => strong.reduce((a, id) => a + odds(r)[id]!, 0);
  expect(sum(0)).toBeLessThan(sum(3));
  expect(sum(3)).toBeLessThan(sum(7));
  expect(sum(7)).toBeGreaterThan(0.6);
});
