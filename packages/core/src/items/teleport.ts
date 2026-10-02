// teleport: see docs/GDD.md §3
import { hAt } from '../track/track';
import { emit } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'teleport', name: 'Teletransporte al 1º', w: 0.8, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) {
    const L = w.karts[w.ranked[0]!], tr = w.track;
    if (!L || L === k) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    const i = (L.idx + T.items.teleport.ahead) % tr.N;
    k.x = tr.x[i]!; k.y = tr.y[i]!; k.z = hAt(tr, k.x, k.y); k.idx = i; k.prog = L.prog + T.items.teleport.ahead;
    k.a = k.va = tr.ang[i]!; k.air = false; k.glide = false; k.vz = 0;
    emit(w, { type: 'flash', color: '#ffd23a' });
  },
  aiScore(w, k) { return k.rank > 1 ? 0.9 : 0.3; },
});
