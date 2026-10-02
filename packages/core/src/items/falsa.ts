// falsa: see docs/GDD.md §3.2 (Caja Falsa replaces the fake oil stain: it hits everyone, AI included)
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { rivalBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'falsa', name: 'Caja Falsa', w: 85, role: 'trampa',
  use(w, k) {
    const p = behind(k, T.items.falsa.behind);
    spawn(w, 'fakebox', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), owner: k.id });
  },
  aiScore(w, k) { const b = rivalBehind(w, k, 120); return (b ? 0.8 : 0.2) + k.hold * 0.04; },
});
