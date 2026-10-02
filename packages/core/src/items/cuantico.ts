// cuantico: see docs/GDD.md §3.2
import { ahead, emit } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

const SWAP = ['x', 'y', 'z', 'idx', 'prog', 'a', 'va', 'vz', 'air', 'glide'] as const;
defineItem({
  id: 'cuantico', name: 'Intercambio Cuántico', w: 1.2, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    const t = ahead(w, k);
    if (!t) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    for (const f of SWAP) {
      const tmp = k[f];
      (k as any)[f] = t[f];
      (t as any)[f] = tmp;
    }
    emit(w, { type: 'flash', color: '#2ec46b' });
  },
});
