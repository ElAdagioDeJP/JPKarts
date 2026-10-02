// mina: see docs/GDD.md §3
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { rivalBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

/** Proximity mine: dropped behind, arms after a second, explodes in an area (GDD §3.3). */
defineItem({
  id: 'mina', name: 'Mina de Proximidad', w: 24, role: 'trampa',
  use(w, k) {
    const M = T.items.mina, p = behind(k, M.behind);
    spawn(w, 'mine', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), owner: k.id, r: M.radius });
  },
  aiScore(w, k) { const b = rivalBehind(w, k, 220); return (b ? 0.95 * (1 - b[1] / 220) + 0.2 : 0) + k.hold * 0.03; },
});
