// inversor: see docs/GDD.md §3.2 (rework: 3 s, only the 3 karts right ahead, with a warning)
import { addFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { rankRel } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'inversor', name: 'Inversor de Controles', w: 7, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    const I = T.items.inversor;
    if (k.rank === 0) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    for (const o of w.karts)
      if (o.rank < k.rank && o.rank >= k.rank - I.count && !o.finished && addFx(o, 'inv', I.time + I.warn, k.id))
        emit(w, { type: 'incoming', kart: o.id, item: 'inversor', eta: I.warn });
    emit(w, { type: 'flash', color: '#b84aff' });
  },
  aiScore(w, k) { return 0.4 + rankRel(w, k) * 0.6; },
});
