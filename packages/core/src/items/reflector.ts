// reflector: see docs/GDD.md §3
import { addFx } from '../sim/effects';
import { threatBehind } from '../ai/ai';
import { T } from '../tunables';
import { defineItem } from '../sim/items';

/** Reflector shield: the next projectile goes back to whoever threw it (GDD §3.3). */
defineItem({
  id: 'reflector', name: 'Escudo Reflector', w: 20, role: 'defensa',
  use(_w, k) { addFx(k, 'reflect', T.items.reflector.time, k.id); },
  aiScore(w, k) { return Math.max(threatBehind(w, k) * 1.4, k.hold > 10 ? 0.6 : 0); },
});
