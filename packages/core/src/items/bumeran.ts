// bumeran: see docs/GDD.md §3.3 (goes out and comes back; can hit twice; caught once to throw it again)
import { dcos, dsin } from '../dmath';
import { spawn } from '../sim/entities';
import { rivalAhead } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';
import type { Kart, World } from '../sim/types';

const throwIt = (w: World, k: Kart, gen: number) => {
  const B = T.items.bumeran, v = Math.max(k.speed, 0) + B.speed;
  spawn(w, 'boomer', { x: k.x + dcos(k.a) * 10, y: k.y + dsin(k.a) * 10, z: k.z + 4, vx: dcos(k.a) * v, vy: dsin(k.a) * v, owner: k.id, life: B.life, target: gen });
};
const score = (w: World, k: Kart) => { const a = rivalAhead(w, k, 220); return a && a[1] > 80 ? 0.9 : k.hold > 10 ? 0.6 : 0; };

defineItem({ id: 'bumeran', name: 'Bumerán', w: 14, role: 'ataque', use(w, k) { throwIt(w, k, 0); }, aiScore: score });
/** The caught boomerang: one more throw, not catchable again. Never comes out of a box. */
defineItem({ id: 'bumeranR', name: 'Bumerán', w: 0, role: 'ataque', noRoll: true, use(w, k) { throwIt(w, k, 1); }, aiScore: score });
