// bocina: see docs/GDD.md §3.2
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
});
