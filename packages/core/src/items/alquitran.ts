// alquitran: see docs/GDD.md §3
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { rivalBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'alquitran', name: 'Charco de Alquitrán', w: 22, role: 'trampa',
  use(w, k) {
    const A = T.items.alquitran, p = behind(k, A.behind);
    spawn(w, 'tar', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), r: A.radius, life: A.life, owner: k.id });
  },
  aiScore(w, k) { const b = rivalBehind(w, k, 160); return (b ? 0.9 * (1 - b[1] / 160) + 0.2 : 0) + k.hold * 0.04; },
});
