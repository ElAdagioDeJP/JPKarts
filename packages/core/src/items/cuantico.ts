// cuantico: see docs/GDD.md §3
import { ahead, emit } from '../sim/helpers';
import { rivalAhead } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

const SWAP = ['x', 'y', 'z', 'idx', 'prog', 'a', 'va', 'vz', 'air', 'glide'] as const;
defineItem({
  id: 'cuantico', name: 'Intercambio Cuántico', w: 1.2, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    const t = ahead(w, k);
    if (!t) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    emit(w, { type: 'incoming', kart: t.id, item: 'cuantico', eta: 0 });
    for (const f of SWAP) {
      const tmp = k[f];
      (k as any)[f] = t[f];
      (t as any)[f] = tmp;
    }
    emit(w, { type: 'flash', color: '#2ec46b' });
  },
  aiScore(w, k) { const a = rivalAhead(w, k, 600); return a ? 0.3 + Math.min(0.7, a[1] / 600) : 0; },
});
