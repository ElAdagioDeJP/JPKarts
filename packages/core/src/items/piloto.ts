// piloto: Piloto Automático, see docs/V3_PLAN.md §2.5 (the Bullet Bill of this game: drives itself along the racing line,
// much faster, runs over whatever it touches; unlike Turbo Bala it can pass the leader, and it leaves 0.5 s of invulnerability)
import { datan2, dcos, dsin } from '../dmath';
import { clamp, wrapA } from '../math';
import { addFx, defineEffect } from '../sim/effects';
import { emit, hit } from '../sim/helpers';
import { defineItem } from '../sim/items';
import { T } from '../tunables';

defineEffect({
  type: 'auto', tags: ['shield'], blocks: ['control', 'hit', 'slow'], bumpScale: 1.5,
  speed: {
    order: 12,
    apply(c) {
      const P = T.items.piloto, k = c.k, tr = c.w.track, N = tr.N;
      c.max = Math.max(c.max, c.base * P.maxMul);
      if (k.speed < c.max) k.speed += P.accel * c.dt;
      const j = (k.idx + P.look) % N, off = tr.line ? tr.line.off[j]! : 0, an = tr.ang[j]!;
      const tx = tr.x[j]! - dsin(an) * off, ty = tr.y[j]! + dcos(an) * off;
      c.inp.s = clamp(wrapA(datan2(ty - k.y, tx - k.x) - k.a) * P.steerGain, -1, 1);
      c.inp.d = false; c.inp.t = 1;
    },
  },
  onBump(w, self, other) { hit(w, other, T.items.piloto.bumpHit, 1, self.id); },
  onEnd(w, k) {
    k.invuln = Math.max(k.invuln, T.items.piloto.afterInvuln);
    emit(w, { type: 'autoEnd', kart: k.id });
  },
});

defineItem({
  id: 'piloto', name: 'Piloto Automático', w: 4, role: 'movilidad', aiNotWhenFirst: true,
  use(w, k) {
    k.spin = 0; k.drift = 0; k.dc = 0;
    addFx(k, 'auto', T.items.piloto.time, k.id);
    emit(w, { type: 'autoStart', kart: k.id });
    emit(w, { type: 'flash', color: '#8fe0ff' });
  },
  aiScore(_w, k) { return k.rank > 0 ? 0.95 : 0; },
});
