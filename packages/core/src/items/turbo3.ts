// turbo3: see docs/GDD.md §3.3 (three nitros in a row)
import { rankRel, straightAhead } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'turbo3', name: 'Turbo Triple', w: 18, role: 'movilidad', charges: 3,
  use(_w, k) { k.boost = Math.max(k.boost, T.items.turbo3.boost); },
  aiScore(w, k) { return k.boost > 0.2 ? 0 : straightAhead(w, k, 30) * 0.9 + rankRel(w, k) * 0.3; },
});
