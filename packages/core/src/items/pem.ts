// pem: see docs/GDD.md §3.2
import { addFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'pem', name: 'Rayo PEM', w: 5, role: 'caos',
  use(w, k) {
    for (const o of w.karts) if (o !== k && !o.finished && addFx(o, 'emp', T.items.pem.time, k.id)) o.boost = 0;
    emit(w, { type: 'flash', color: '#3df0ff' });
  },
});
