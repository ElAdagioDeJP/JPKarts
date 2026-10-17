// Prints the item odds per position zone (front / middle / back) from core/data/tunables/items.json.
// Usage: bun packages/core/tools/item-odds.ts
import '../src/items';
import { itemList, itemWeights, itemZone } from '../src/sim/items';

const N = 8, zoneOf = (z: number) => Array.from({ length: N }, (_, r) => r).filter((r) => itemZone(r, N) === z);
const cols = [0, 1, 2].map((z) => { const w = itemWeights(zoneOf(z)[0]!, N), tot = w.reduce((a, b) => a + b, 0); return w.map((x) => (100 * x) / tot); });
console.log('objeto'.padEnd(26) + ['delante', 'medio', 'atrás'].map((s) => s.padStart(9)).join(''));
itemList().forEach((it, i) => { if (!it.noRoll) console.log(`${it.name} (${it.id})`.padEnd(26).slice(0, 26) + cols.map((c) => (c[i]!.toFixed(1) + '%').padStart(9)).join('')); });
console.log('zonas:', [0, 1, 2].map((z) => 'puestos ' + zoneOf(z).map((r) => r + 1).join(',')).join(' · '));
