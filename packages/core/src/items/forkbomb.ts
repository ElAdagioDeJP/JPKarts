// forkbomb: see docs/MECHANICS_BACKLOG.md #65 (a row of proximity mines behind the kart)
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { rivalBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'forkbomb', name: 'Fork Bomb', w: 18, role: 'trampa',
  use(w, k) {
    const F = T.items.forkbomb;
    for (let i = 0; i < F.count; i++) {
      const p = behind(k, F.behind + i * F.spacing);
      spawn(w, 'mine', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), owner: k.id, r: F.radius });
    }
  },
  aiScore(w, k) { const b = rivalBehind(w, k, 200); return (b ? 0.95 * (1 - b[1] / 200) + 0.2 : 0) + k.hold * 0.03; },
});
