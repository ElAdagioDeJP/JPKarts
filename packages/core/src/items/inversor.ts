// inversor: see docs/GDD.md §3
import { addFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { rankRel } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'inversor', name: 'Inversor de Controles', w: 7, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    for (const o of w.karts) if (o.rank < k.rank && !o.finished) addFx(o, 'inv', T.items.inversor.time, k.id);
    emit(w, { type: 'flash', color: '#b84aff' });
  },
  aiScore(w, k) { return 0.4 + rankRel(w, k) * 0.6; },
});
