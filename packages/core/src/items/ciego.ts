// ciego: see docs/GDD.md §3
import { dcos, dsin } from '../dmath';
import { spawn } from '../sim/entities';
import { aimed } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'ciego', name: 'Proyectil Ciego', w: 55, role: 'ataque', aiAim: true,
  use(w, k) {
    const C = T.items.ciego, v = Math.max(k.speed, 0) + C.speed;
    spawn(w, 'shot', { x: k.x + dcos(k.a) * C.spawn, y: k.y + dsin(k.a) * C.spawn, z: k.z + C.lift, vx: dcos(k.a) * v, vy: dsin(k.a) * v, owner: k.id, life: C.life });
  },
  aiScore(w, k) { return Math.max(aimed(w, k, 260, 0.12) * 1.6, k.hold > 10 ? 0.6 : 0); },
});
