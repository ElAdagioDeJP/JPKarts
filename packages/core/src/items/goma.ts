// goma: see docs/GDD.md §3
import { addFx } from '../sim/effects';
import { rivalAhead, threatBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'goma', name: 'Parachoques de Goma', w: 70, role: 'defensa',
  use(_w, k) { addFx(k, 'goma', T.items.goma.time, k.id); },
  aiScore(w, k) { return Math.max(threatBehind(w, k), rivalAhead(w, k, 40) ? 0.8 : 0, k.hold > 4 ? 0.7 : 0); },
});
