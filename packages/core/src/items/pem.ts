// pem: see docs/GDD.md §3.2 (rework: only the karts ahead; the bubble shortens it)
import { addFx, hasFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { rankRel } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'pem', name: 'Rayo PEM', w: 5, role: 'caos', aiNotWhenFirst: true,
  use(w, k) {
    const P = T.items.pem;
    if (k.rank === 0) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    for (const o of w.karts)
      if (o.rank < k.rank && !o.finished && addFx(o, 'emp', hasFx(o, 'bubble') ? P.bubbleTime : P.time, k.id)) o.boost = 0;
    emit(w, { type: 'flash', color: '#3df0ff' });
  },
  aiScore(w, k) { return 0.5 + rankRel(w, k) * 0.5; },
});
