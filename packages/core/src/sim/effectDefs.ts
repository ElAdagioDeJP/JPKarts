// The status effects of the 15 legacy items. Registration order = pipeline order (keeps legacy behavior).
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { clamp, wrapA } from '../math';
import { T } from '../tunables';
import { defineEffect, removeFx } from './effects';
import { emit, hit } from './helpers';

/** "¡Ay!" label after a hit or a fall. data = OUCH text index. */
defineEffect({ type: 'ouch', tags: ['visual'] });
/** Horn wave: the "¡!" label over the karts it reached (the light hit is applied by the item). */
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
/** Bubble shield: absorbs one hit of level ≤ 1; lasts until then or `burbuja.time` (GDD §3.2: no more off-road pops). */
defineEffect({
  type: 'bubble', tags: ['shield'],
  absorbHit(w, k, _f, level) {
    if (level > 1) return false;
    removeFx(k, 'bubble');
    emit(w, { type: 'shieldPop', kart: k.id, offroad: false });
    return true;
  },
});
/** Turbo Bala: autopilot along the racing line, much faster, knocks whatever it touches, immune. */
defineEffect({
  type: 'bala', tags: ['shield'], blocks: ['control', 'hit'], bumpScale: 1.5,
  speed: {
    order: 12,
    apply(c) {
      const B = T.items.bala, k = c.k, tr = c.w.track, N = tr.N;
      c.max = Math.max(c.max, c.base * B.maxMul);
      if (k.speed < c.max) k.speed += B.accel * c.dt;
      const j = (k.idx + B.look) % N, off = tr.line ? tr.line.off[j]! : 0, an = tr.ang[j]!;
      const tx = tr.x[j]! - dsin(an) * off, ty = tr.y[j]! + dcos(an) * off;
      c.inp.s = clamp(wrapA(datan2(ty - k.y, tx - k.x) - k.a) * B.steerGain, -1, 1);
      c.inp.d = false; c.inp.t = 1;
      // it never takes you past the leader: ends one position behind at most
      if (k.rank <= B.stopRank) removeFx(k, 'bala');
    },
  },
  onBump(w, _self, other) { hit(w, other, T.items.bala.bumpHit, 1); },
});
/** Triple Ciego: shots orbiting the kart; each one blocks a hit (the item in hand counts them). */
defineEffect({
  type: 'orbit', tags: ['shield'], permanent: true,
  absorbHit(w, k, _f, level) {
    if (level > 1 || k.item !== 'ciego3' || k.itemN <= 0) return false;
    k.itemN--;
    if (k.itemN <= 0) { k.item = null; removeFx(k, 'orbit'); }
    emit(w, { type: 'shieldPop', kart: k.id, offroad: false });
    return true;
  },
});
/** Coin magnet: nearby coins fly to the kart (see sim/coins.ts). */
defineEffect({ type: 'magnet', tags: ['buff'] });
/** Inside a smoke curtain: the local view is covered (visual only). */
defineEffect({ type: 'smoke', tags: ['visual'] });
/** Inside a smoke curtain (AI): its line gets sloppy. Deterministic wobble from the kart's progress. */
defineEffect({
  type: 'fog', tags: ['control'],
  input(k, inp, _f, human) { if (!human) inp.s = clamp(inp.s + dsin(k.prog * 0.37) * T.items.humo.aiNoise, -1, 1); },
});
