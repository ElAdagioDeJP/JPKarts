// dron: see docs/GDD.md §3
import { spawn } from '../sim/entities';
import { ahead, emit, lateral } from '../sim/helpers';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'dron', name: 'Dron Rastreador', w: 15, role: 'ataque', aiNotWhenFirst: true,
  use(w, k) {
    const D = T.items.dron, t = ahead(w, k);
    spawn(w, 'rocket', { s: k.idx + D.ahead, lat: lateral(w, k), owner: k.id, target: t ? t.id : -1, life: D.life, x: k.x, y: k.y, z: k.z, vx: 1 });
    if (t) emit(w, { type: 'incoming', kart: t.id, item: 'dron', eta: T.items.incoming.dronEta });
  },
  aiScore(w, k) { return k.rank > 0 ? 0.6 + k.hold * 0.05 : 0; },
});
