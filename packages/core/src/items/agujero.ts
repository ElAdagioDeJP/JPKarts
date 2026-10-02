// agujero: see docs/GDD.md §3
import { dhypot } from '../dmath';
import { removeFx } from '../sim/effects';
import { clearEntitiesNear, spawn } from '../sim/entities';
import { threatBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'agujero', name: 'Agujero Negro Portátil', w: 2, role: 'caos',
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
  aiScore(w, k) {
    let near = 0;
    for (const o of w.karts) if (o !== k && dhypot(o.x - k.x, o.y - k.y) < T.items.agujero.radius) near++;
    return Math.min(1, near * 0.25) + threatBehind(w, k) * 0.5;
  },
});
