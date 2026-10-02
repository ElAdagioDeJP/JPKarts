// humo: see docs/GDD.md §3.3 (smoke curtain behind: covers the locals' view, makes the AI sloppy)
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { rivalBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'humo', name: 'Cortina de Humo', w: 16, role: 'defensa',
  use(w, k) {
    const H = T.items.humo, p = behind(k, H.behind);
    spawn(w, 'smoke', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), r: H.radius, life: H.life, owner: k.id });
  },
  aiScore(w, k) { const b = rivalBehind(w, k, 90); return (b ? 0.95 : 0.1) + k.hold * 0.03; },
});
