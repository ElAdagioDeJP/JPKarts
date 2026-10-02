// bocina: see docs/GDD.md §3
import { dhypot } from '../dmath';
import { addFx } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'bocina', name: 'Bocina de Confusión', w: 100, role: 'caos',
  use(w, k) {
    const B = T.items.bocina;
    for (const o of w.karts) if (o !== k && dhypot(o.x - k.x, o.y - k.y) < B.radius) addFx(o, 'scare', B.scare, k.id);
  },
  aiScore(w, k) {
    let near = 0;
    for (const o of w.karts) if (o !== k && dhypot(o.x - k.x, o.y - k.y) < T.items.bocina.radius) near++;
    return Math.min(1, near * 0.35) + k.hold * 0.02;
  },
});
