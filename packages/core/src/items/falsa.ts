// falsa: see docs/GDD.md §3.2
import { hAt } from '../track/track';
import { spawn } from '../sim/entities';
import { behind } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'falsa', name: 'Mancha de Aceite Falsa', w: 85, role: 'trampa',
  use(w, k) {
    const p = behind(k, T.items.falsa.behind);
    spawn(w, 'fake', { x: p.x, y: p.y, z: hAt(w.track, p.x, p.y), owner: k.id });
  },
});
