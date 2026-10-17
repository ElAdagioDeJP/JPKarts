// lagspike: see docs/MECHANICS_BACKLOG.md #67 (everyone ahead of you lags for a few seconds: comeback item)
import { addFx } from '../sim/effects';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'lagspike', name: 'Pico de Latencia', w: 10, role: 'ataque', aiNotWhenFirst: true,
  use(w, k) {
    let n = 0;
    for (const o of w.karts) {
      if (o.rank >= k.rank || (w.cfg.teams && o.team === k.team)) continue;
      if (addFx(o, 'lag', T.items.lagspike.time, k.id)) n++;
    }
    if (!n) return false;
  },
  aiScore(_w, k) { return k.rank > 0 ? 0.5 + k.rank * 0.05 + k.hold * 0.04 : 0; },
});
