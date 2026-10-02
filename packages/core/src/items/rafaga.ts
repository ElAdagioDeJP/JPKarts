// rafaga: see docs/GDD.md §3.3 (a side gust: pushes the karts beside you off the line, or into the water)
import { dcos, dsin } from '../dmath';
import { charOf, emit, hit } from '../sim/helpers';
import { immune } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';
import type { Kart, World } from '../sim/types';

/** Karts beside `k`: [kart, lateral offset (+ = right)]. */
function beside(w: World, k: Kart): [Kart, number][] {
  const R = T.items.rafaga, ca = dcos(k.a), sa = dsin(k.a), out: [Kart, number][] = [];
  for (const o of w.karts) {
    if (o === k || o.respawn > 0 || o.finished) continue;
    const dx = o.x - k.x, dy = o.y - k.y, along = dx * ca + dy * sa, lat = -dx * sa + dy * ca;
    if (Math.abs(along) < R.along && Math.abs(lat) < R.range) out.push([o, lat]);
  }
  return out;
}

defineItem({
  id: 'rafaga', name: 'Ráfaga', w: 6, role: 'caos',
  use(w, k) {
    const R = T.items.rafaga, ca = dcos(k.a), sa = dsin(k.a);
    for (const [o, lat] of beside(w, k)) {
      if (immune(o, 'control')) continue;
      const cls = charOf(o).weightClass, m = cls === 'pesado' ? R.heavyMul : cls === 'ligero' ? R.lightMul : 1, s = Math.sign(lat) || 1;
      o.x += -sa * s * R.push * m;
      o.y += ca * s * R.push * m;
      hit(w, o, R.hit, 0, k.id);
    }
    emit(w, { type: 'gust', kart: k.id });
  },
  aiScore(w, k) { return Math.min(1, beside(w, k).length * 0.6) + k.hold * 0.02; },
});
