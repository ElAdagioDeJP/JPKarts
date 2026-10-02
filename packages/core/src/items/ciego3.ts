// ciego3: see docs/GDD.md §3.3 (three orbiting shots: each one blocks a hit; fired one by one)
import { dcos, dsin } from '../dmath';
import { addFx, removeFx } from '../sim/effects';
import { spawn } from '../sim/entities';
import { aimed } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

defineItem({
  id: 'ciego3', name: 'Triple Ciego', w: 10, role: 'ataque', charges: 3, aiAim: true,
  onGet(_w, k) { addFx(k, 'orbit', 1, k.id); },
  use(w, k) {
    const C = T.items.ciego, v = Math.max(k.speed, 0) + C.speed;
    spawn(w, 'shot', { x: k.x + dcos(k.a) * C.spawn, y: k.y + dsin(k.a) * C.spawn, z: k.z + C.lift, vx: dcos(k.a) * v, vy: dsin(k.a) * v, owner: k.id, life: C.life });
    if (k.itemN <= 1) removeFx(k, 'orbit');
  },
  aiScore(w, k) { return aimed(w, k, 260, 0.12) * 1.6; },
});
