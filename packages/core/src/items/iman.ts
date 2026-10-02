// iman: see docs/GDD.md §3.3 (pulls coins for a few seconds and steals some from the nearest rival)
import { dhypot } from '../dmath';
import { addFx } from '../sim/effects';
import { dropCoins, giveCoins } from '../sim/coins';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'iman', name: 'Imán de Monedas', w: 14, role: 'movilidad',
  use(w, k) {
    const M = T.items.iman;
    addFx(k, 'magnet', M.time, k.id);
    let best = null as null | (typeof w.karts)[number], bd = M.stealRange;
    for (const o of w.karts) { const d = dhypot(o.x - k.x, o.y - k.y); if (o !== k && o.coins > 0 && d < bd) { bd = d; best = o; } }
    if (best) {
      const n = Math.min(M.steal, best.coins);
      best.coins -= n;
      giveCoins(w, k, n);
    }
    void dropCoins;
  },
  aiScore(w, k) {
    let near = 0;
    for (const o of w.karts) if (o !== k && o.coins > 0 && dhypot(o.x - k.x, o.y - k.y) < T.items.iman.stealRange) near = 1;
    return k.coins >= T.race.coins.max ? 0.1 : 0.4 + near * 0.4 + k.hold * 0.03;
  },
});
