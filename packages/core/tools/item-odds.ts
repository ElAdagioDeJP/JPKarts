// Prints the item odds of every position (12 karts) and of the 6 zones, from core/data/tunables/items.json.
// Usage: bun packages/core/tools/item-odds.ts [karts=12] [distance-behind-the-leader=0]
// With a distance, the zone is the larger of the zone by place and the zone by distance (docs/V3_PLAN.md §2.5).
import '../src/items';
import { itemList, itemWeights, itemZone } from '../src/sim/items';
import { T } from '../src/tunables';

const N = Number(process.argv[2] ?? 12), dist = Number(process.argv[3] ?? 0);
const ranks = Array.from({ length: N }, (_, r) => r);
const col = (r: number) => { const w = itemWeights(r, N, r === 0 ? 0 : dist), t = w.reduce((a, b) => a + b, 0); return w.map((x) => (100 * x) / t); };
const cols = ranks.map(col);
console.log(`Probabilidad de cada objeto por puesto (${N} karts${dist ? `, ${dist} u detrás del líder` : ''})`);
console.log('objeto'.padEnd(30) + ranks.map((r) => ('P' + (r + 1)).padStart(6)).join(''));
console.log('zona'.padEnd(30) + ranks.map((r) => String(itemZone(r, N, r === 0 ? 0 : dist) + 1).padStart(6)).join(''));
itemList().forEach((it, i) => {
  if (it.noRoll) return;
  console.log(`${it.name} (${it.id})`.padEnd(30).slice(0, 30) + cols.map((c) => (c[i]! ? c[i]!.toFixed(1) : '·').padStart(6)).join(''));
});
const group = (name: string, ids: string[]) => console.log(name.padEnd(30) + cols.map((c) => c.reduce((a, x, i) => a + (ids.includes(itemList()[i]!.id) ? x : 0), 0).toFixed(1).padStart(6)).join(''));
console.log('-'.repeat(30 + 6 * N));
group('SUMA flojos (bocina/falsa/goma/ciego)', ['bocina', 'falsa', 'goma', 'ciego']);
group('SUMA nuevos (dios/infinito/piloto)', ['dios', 'infinito', 'piloto']);
console.log('umbrales de distancia por zona (u):', T.items.distZones.join(', '));
