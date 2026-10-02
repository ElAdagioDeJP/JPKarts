// inversor: see docs/GDD.md §3.2
import { addFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'inversor', name: 'Inversor de Controles', w: 7, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    for (const o of w.karts) if (o.rank < k.rank && !o.finished) addFx(o, 'inv', T.items.inversor.time, k.id);
    emit(w, { type: 'flash', color: '#b84aff' });
  },
});
