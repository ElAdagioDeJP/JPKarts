// dios: Modo Dios, see docs/V3_PLAN.md §2.5 (the Star of this game: invincible, faster, knocks rivals, ignores the off-road penalty)
import { rankRel, rivalAhead } from '../ai/ai';
import { addFx, defineEffect } from '../sim/effects';
import { emit, hit } from '../sim/helpers';
import { defineItem } from '../sim/items';
import { T } from '../tunables';

defineEffect({
  type: 'god', tags: ['shield'], blocks: ['control', 'hit', 'slow'],
  speed: {
    order: 13,
    apply(c) {
      // raising the cap over the road limit is what removes the off-road penalty
      const G = T.items.dios;
      c.max = Math.max(c.max, c.base * G.maxMul);
      if (c.inp.t > 0 && c.k.speed < c.max) c.k.speed += G.accel * c.dt;
    },
  },
  onBump(w, self, other) { hit(w, other, T.items.dios.bumpHit, T.items.dios.bumpLevel, self.id); },
  onEnd(w, k) { emit(w, { type: 'godEnd', kart: k.id }); },
});

defineItem({
  id: 'dios', name: 'Modo Dios', w: 6, role: 'movilidad',
  use(w, k) {
    k.spin = 0; k.drift = 0; k.dc = 0;
    addFx(k, 'god', T.items.dios.time, k.id);
    emit(w, { type: 'godStart', kart: k.id });
    emit(w, { type: 'flash', color: '#ffe45e' });
  },
  // use it as soon as there is somebody to run over, or when it has been waiting for a while
  aiScore(w, k) { return Math.min(1, Math.max(rivalAhead(w, k, 300) ? 0.85 : 0, 0.35 + rankRel(w, k) * 0.3 + k.hold * 0.06)); },
});
