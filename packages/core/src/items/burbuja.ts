// burbuja: see docs/GDD.md §3
import { addFx } from '../sim/effects';
import { threatBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'burbuja', name: 'Escudo de Burbuja', w: 40, role: 'defensa',
  use(_w, k) { addFx(k, 'bubble', 1, k.id); },
  aiScore(w, k) { return k.off >= 1 ? 0 : Math.max(threatBehind(w, k) * 1.3, k.hold > 3 ? 0.7 : 0); },
});
