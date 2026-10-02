// gancho: see docs/GDD.md §3
import { addFx } from '../sim/effects';
import { ahead, emit } from '../sim/helpers';
import { rivalAhead } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'gancho', name: 'Gancho Electromagnético', w: 10, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) {
    const G = T.items.gancho, t = ahead(w, k);
    if (!t) return false;
    addFx(k, 'hook', G.time, k.id, t.id);
    addFx(t, 'slow', G.slow, k.id);
    emit(w, { type: 'incoming', kart: t.id, item: 'gancho', eta: 0 });
  },
  aiScore(w, k) { const a = rivalAhead(w, k, 260); return a ? 0.9 : 0.2 + k.hold * 0.03; },
});
