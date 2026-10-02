// nitro: see docs/GDD.md §3
import { rankRel, straightAhead } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'nitro', name: 'Inyector Nitro Básico', w: 30, role: 'movilidad',
  use(_w, k) { k.boost = Math.max(k.boost, T.items.nitro.boost); },
  aiScore(w, k) { return straightAhead(w, k, 30) * 0.9 + rankRel(w, k) * 0.2; },
});
