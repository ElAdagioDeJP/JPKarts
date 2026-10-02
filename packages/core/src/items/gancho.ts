// gancho: see docs/GDD.md §3.2
import { addFx } from '../sim/effects';
import { ahead } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'gancho', name: 'Gancho Electromagnético', w: 10, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) {
    const G = T.items.gancho, t = ahead(w, k);
    if (!t) return false;
    addFx(k, 'hook', G.time, k.id, t.id);
    addFx(t, 'slow', G.slow, k.id);
  },
});
