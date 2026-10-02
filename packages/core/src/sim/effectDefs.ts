// The status effects of the 15 legacy items. Registration order = pipeline order (keeps legacy behavior).
import { datan2, dhypot } from '../dmath';
import { clamp, wrapA } from '../math';
import { T } from '../tunables';
import { defineEffect, removeFx } from './effects';
import { emit, hit } from './helpers';

/** "¡Ay!" label after a hit or a fall. data = OUCH text index. */
defineEffect({ type: 'ouch', tags: ['visual'] });
/** Horn scare: only a "¡!" label (legacy behavior; reworked in Phase 8). */
defineEffect({ type: 'scare', tags: ['visual'] });
/** PEM: engine off, no boost. */
defineEffect({
  type: 'emp', tags: ['control'], noBoost: true,
  input(_k, inp) { inp.t = 0; inp.d = false; },
});
/** Control inverter: steering reversed (AI only partially). */
defineEffect({
  type: 'inv', tags: ['control'],
  input(_k, inp, _f, human) { inp.s = -inp.s * (human ? 1 : T.items.inversor.aiMul); },
});
/** Hooked by an electromagnetic hook: slower. */
defineEffect({
  type: 'slow', tags: ['slow'],
  speed: { order: 20, apply(c) { c.max *= T.items.gancho.slowMul; } },
});
/** Juggernaut armor: immune, bigger, faster, knocks karts on contact. */
defineEffect({
  type: 'jug', tags: ['shield'], blocks: ['control', 'hit'], bumpScale: T.items.jugger.bumpScale,
  speed: {
    order: 10,
    apply(c) {
      const J = T.items.jugger;
      c.max = Math.max(c.max, c.base * J.maxMul);
      if (c.inp.t > 0 && c.k.speed < c.max) c.k.speed += J.accel * c.dt;
    },
  },
  onBump(w, _self, other) {
    if (!other.fx.some((f) => f.type === 'jug')) hit(w, other, T.items.jugger.bumpHit, T.items.jugger.bumpLevel);
  },
});
/** Hook: pulls the kart towards its target (data = target kart id). */
defineEffect({
  type: 'hook', tags: ['movement'], cancelOnHit: true,
  speed: {
    order: 40,
    apply(c, f) {
      const tg = c.w.karts[f.data];
      if (!tg) return;
      const G = T.items.gancho, k = c.k, dd = dhypot(tg.x - k.x, tg.y - k.y);
      c.max = Math.max(c.max, c.base * G.maxMul);
      if (k.speed < c.max) k.speed += G.accel * c.dt;
      const da = wrapA(datan2(tg.y - k.y, tg.x - k.x) - k.a);
      if (dd < G.steerRange) c.inp.s = clamp(c.inp.s + da * G.steerGain, -1, 1);
      if (dd < G.release) removeFx(k, 'hook');
    },
  },
});
/** Rubber bumper: pushes karts away and bounces off the world border. */
defineEffect({
  type: 'goma', tags: ['shield'],
  bumpPush(self, nx, ny, sign) {
    const B = T.race.bump;
    self.x += nx * sign * B.gomaPush;
    self.y += ny * sign * B.gomaPush;
    self.speed *= B.gomaSlow;
  },
  onWorldBounds(k) { k.speed *= T.race.bump.gomaBounce; },
});
/** Fake oil stain on a human's screen (visual only). */
defineEffect({ type: 'smudge', tags: ['visual'] });
/** Reflector shield: the next projectile goes back to whoever threw it. */
defineEffect({
  type: 'reflect', tags: ['shield'],
  onProjectile(w, k, e) {
    removeFx(k, 'reflect');
    const thrower = e.owner;
    e.owner = k.id;
    if (e.kind === 'shot') { e.vx = -e.vx; e.vy = -e.vy; e.life = Math.max(e.life, 1.5); }
    else { e.target = thrower; e.vx = -(e.vx || 1); }
    emit(w, { type: 'reflect', kart: k.id });
    return true;
  },
});
/** Spring jump in progress (Muelle): only a marker for presentation. */
defineEffect({ type: 'spring', tags: ['movement'] });
/** Bubble shield: absorbs one light hit, pops off-road. */
defineEffect({
  type: 'bubble', tags: ['shield'], permanent: true,
  absorbHit(w, k, _f, level) {
    if (level > 1) return false;
    removeFx(k, 'bubble');
    emit(w, { type: 'shieldPop', kart: k.id, offroad: false });
    return true;
  },
  onOffRoad(w, k, off) {
    if (off < 1) return;
    removeFx(k, 'bubble');
    emit(w, { type: 'shieldPop', kart: k.id, offroad: true });
  },
});
