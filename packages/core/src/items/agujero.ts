// agujero: see docs/GDD.md §3.2
import { dhypot } from '../dmath';
import { removeFx } from '../sim/effects';
import { clearEntitiesNear, spawn } from '../sim/entities';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'agujero', name: 'Agujero Negro Portátil', w: 2, role: 'caos', aiQuick: true,
  use(w, k) {
    const R = T.items.agujero.radius;
    spawn(w, 'hole', { x: k.x, y: k.y, z: k.z, owner: k.id });
    clearEntitiesNear(w, k.x, k.y, R, k.id);
    for (const o of w.karts)
      if (o !== k && !(dhypot(o.x - k.x, o.y - k.y) > R)) {
        removeFx(o, 'bubble'); removeFx(o, 'goma'); removeFx(o, 'jug');
        o.boost = 0; o.item = null; o.roll = 0;
      }
  },
});
