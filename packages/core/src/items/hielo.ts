// hielo: see docs/GDD.md §3.3 (a slippery patch dropped behind)
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { rivalBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'hielo', name: 'Bloque de Hielo', w: 22, role: 'trampa',
  use(w, k) {
    const H = T.items.hielo, p = behind(k, H.behind);
    spawn(w, 'ice', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), r: H.radius, life: H.life, owner: k.id });
  },
  aiScore(w, k) { const b = rivalBehind(w, k, 180); return (b ? 0.85 * (1 - b[1] / 180) + 0.2 : 0) + k.hold * 0.04; },
});
