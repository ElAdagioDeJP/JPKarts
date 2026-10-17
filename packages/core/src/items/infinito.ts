// infinito: Overclock Infinito, see docs/V3_PLAN.md §2.5 (the Golden Mushroom of this game: every press of the item button is a turbo)
import { rankRel, straightAhead } from '../ai/ai';
import { addFx, defineEffect } from '../sim/effects';
import { emit } from '../sim/helpers';
import { defineItem } from '../sim/items';
import { T } from '../tunables';

defineEffect({
  type: 'ocinf', tags: ['buff'],
  // a press of the item button (only while nothing else is in hand) gives a short boost; the AI presses on a fixed beat
  input(k, inp, f, human, w) {
    if (k.item) return;
    const O = T.items.infinito;
    let press = false;
    if (human) press = inp.item;
    else {
      const phase = Math.floor((O.time - f.t) / O.aiEvery);
      if (phase !== f.data) { f.data = phase; press = true; }
    }
    if (!press) return;
    k.boost = Math.max(k.boost, O.boost);
    emit(w, { type: 'boost', kart: k.id, src: 'overclockInf' });
  },
});

defineItem({
  id: 'infinito', name: 'Overclock Infinito', w: 8, role: 'movilidad',
  use(_w, k) { addFx(k, 'ocinf', T.items.infinito.time, k.id, -1); },
  aiScore(w, k) { return straightAhead(w, k, 30) * 0.9 + rankRel(w, k) * 0.2; },
});
