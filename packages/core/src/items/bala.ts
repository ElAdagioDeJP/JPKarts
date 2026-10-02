// bala: see docs/GDD.md §3.2 (Turbo Bala replaces Teletransporte al 1º: autopilot, not a free teleport)
import { addFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'bala', name: 'Turbo Bala', w: 0.8, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) {
    if (k.rank <= T.items.bala.stopRank) { emit(w, { type: 'alreadyFirst', kart: k.id }); return false; }
    k.spin = 0; k.drift = 0; k.dc = 0;
    addFx(k, 'bala', T.items.bala.time, k.id);
    emit(w, { type: 'flash', color: '#ffd23a' });
  },
  aiScore(_w, k) { return k.rank > 2 ? 0.95 : 0; },
});
