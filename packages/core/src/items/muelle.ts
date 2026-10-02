// muelle: see docs/GDD.md §3
import { addFx } from '../sim/effects';
import { emit } from '../sim/helpers';
import { dhypot } from '../dmath';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

/** Spring: a super jump over traps, hazards and gaps (GDD §3.3). Tricks are possible in the air. */
defineItem({
  id: 'muelle', name: 'Muelle', w: 26, role: 'movilidad',
  use(w, k) {
    if (k.air) return false;
    k.air = true; k.glide = false; k.vz = T.items.muelle.vz; k.drift = 0; k.dc = 0;
    k.trickT = T.driving.trick.takeoff; k.trick = false; k.trickBig = false;
    addFx(k, 'spring', T.driving.spring.time, k.id);
    emit(w, { type: 'jump', kart: k.id });
  },
  aiScore(w, k) {
    let s = k.hold > 12 ? 0.6 : 0;
    for (const e of w.ents) {
      if (e.owner === k.id || !(e.kind === 'tar' || e.kind === 'mine' || e.kind === 'fake' || e.kind === 'ola' || e.kind === 'shot')) continue;
      const d = dhypot(e.x - k.x, e.y - k.y);
      if (d < 70 && d > 20) s = Math.max(s, 0.95);
    }
    return s;
  },
});
