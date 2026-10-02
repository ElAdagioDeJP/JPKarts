// dron: see docs/GDD.md §3.2
import { spawn } from '../sim/entities';
import { ahead, lateral } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'dron', name: 'Dron Rastreador', w: 15, role: 'ataque', aiNotWhenFirst: true,
  use(w, k) {
    const D = T.items.dron, t = ahead(w, k);
    spawn(w, 'rocket', { s: k.idx + D.ahead, lat: lateral(w, k), owner: k.id, target: t ? t.id : -1, life: D.life, x: k.x, y: k.y, z: k.z });
  },
});
