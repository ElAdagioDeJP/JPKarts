// World entities (projectiles, traps, hazards): one list, one registry. Adding a kind = one defineEntity().
import { ROAD } from '../constants';
import { dhypot, dpow, dsin, dcos } from '../dmath';
import { lerp } from '../math';
import { T } from '../tunables';
import { dgAt, hAt, wgAt } from '../track/track';
import { addFx, eachFx } from './effects';
import { canBeHit, emit, hit, isHuman } from './helpers';
import type { Ent, Kart, World } from './types';

export interface EntityDef {
  kind: string;
  /** what a black hole does to it: removes all, removes all but the owner's, or nothing */
  blackHole: 'all' | 'notOwner' | 'none';
  /** update one entity; return false to remove it */
  update(w: World, e: Ent, dt: number): boolean;
  /** area that affects karts standing in it (tar) */
  zone?(e: Ent, k: Kart): boolean;
  /** what the zone does: cap the speed at base × maxMul and cancel drifting */
  zoneEffect?: { maxMul: () => number; cancelDrift: boolean };
}

const DEFS: EntityDef[] = [];
const BY_KIND = new Map<string, EntityDef>();
export function defineEntity(d: EntityDef) {
  DEFS.push(d);
  BY_KIND.set(d.kind, d);
  return d;
}
export const entityDef = (kind: string) => BY_KIND.get(kind)!;

export function spawn(w: World, kind: string, p: Partial<Ent>): Ent {
  const e: Ent = { id: w.nextEnt++, kind, x: 0, y: 0, z: 0, owner: -1, target: -1, life: 0, age: 0, t: 0, vx: 0, vy: 0, s: 0, lat: 0, r: 0, cdn: 0, ...p };
  w.ents.push(e);
  return e;
}

/** Update every entity, kind by kind in registration order (deterministic). */
export function updateEntities(w: World, dt: number) {
  for (const d of DEFS) {
    let dead = false;
    for (const e of w.ents) {
      if (e.kind !== d.kind) continue;
      if (!d.update(w, e, dt)) { e.life = -1e9; dead = true; }
    }
    if (dead) w.ents = w.ents.filter((e) => e.kind !== d.kind || e.life > -1e9);
  }
}

/** The zone the kart is standing in (first match), if any. */
export function zoneAt(w: World, k: Kart): EntityDef | undefined {
  for (const e of w.ents) {
    const d = BY_KIND.get(e.kind)!;
    if (d.zone && d.zone(e, k)) return d;
  }
  return undefined;
}

/** Let the kart's effects deflect a projectile (reflector). True = deflected, do not hit. */
function deflected(w: World, k: Kart, e: Ent): boolean {
  let done = false;
  eachFx(k, (d) => { if (!done && d.onProjectile) done = d.onProjectile(w, k, e); });
  return done;
}

/** Black hole: clear entities within `radius` of (x, y). */
export function clearEntitiesNear(w: World, x: number, y: number, radius: number, owner: number) {
  w.ents = w.ents.filter((e) => {
    const bh = BY_KIND.get(e.kind)!.blackHole;
    if (bh === 'none') return true;
    if (bh === 'notOwner' && e.owner === owner) return true;
    return dhypot(e.x - x, e.y - y) > radius;
  });
}

// ---- legacy entities ----
/** Fake oil stain: smudges a human's screen. */
defineEntity({
  kind: 'fake', blackHole: 'all',
  update(w, f, dt) {
    const F = T.items.falsa;
    f.age += dt;
    f.cdn -= dt;
    for (const k of w.karts) {
      if (!isHuman(k) || k.air || f.cdn > 0) continue;
      if (dhypot(k.x - f.x, k.y - f.y) < F.radius && !(f.owner === k.id && f.age < F.ownerGrace)) {
        addFx(k, 'smudge', F.smudge);
        f.cdn = F.cooldown;
        emit(w, { type: 'smudge', kart: k.id });
      }
    }
    return f.age < F.life;
  },
});
/** Tar puddle: slows down whoever drives through it. */
defineEntity({
  kind: 'tar', blackHole: 'all',
  update(_w, t, dt) { t.life -= dt; return t.life > 0; },
  zone(t, k) { return dhypot(k.x - t.x, k.y - t.y) < t.r; },
  zoneEffect: { maxMul: () => T.items.alquitran.maxMul, cancelDrift: true },
});
/** Blind shot: flies straight, dies off-road. */
defineEntity({
  kind: 'shot', blackHole: 'notOwner',
  update(w, s, dt) {
    const C = T.items.ciego;
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z = hAt(w.track, s.x, s.y) + C.lift;
    if (dgAt(w.track, s.x, s.y) - wgAt(w.track, s.x, s.y) > C.offRoad) return false;
    for (const k of w.karts) {
      if (k.id === s.owner) continue;
      if (dhypot(k.x - s.x, k.y - s.y) < C.radius) {
        if (deflected(w, k, s)) break;
        hit(w, k, C.hit, 1); s.life = 0; break;
      }
    }
    return s.life > 0;
  },
});
/** Tracking drone: follows the track towards its target. */
defineEntity({
  kind: 'rocket', blackHole: 'notOwner',
  update(w, r, dt) {
    const D = T.items.dron, tr = w.track, N = tr.N;
    r.life -= dt;
    r.t += dt;
    r.s += D.speed * dt * (r.vx < 0 ? -1 : 1);
    const i0 = Math.floor(r.s), f = r.s - i0, a = ((i0 % N) + N) % N, b = (a + 1) % N;
    const tgt = r.target >= 0 ? w.karts[r.target] : undefined;
    if (tgt && !tgt.finished) {
      const at = tr.ang[tgt.idx]!, lt = (tgt.x - tr.x[tgt.idx]!) * -dsin(at) + (tgt.y - tr.y[tgt.idx]!) * dcos(at);
      r.lat = lerp(r.lat, lt, Math.min(1, D.track * dt));
    } else r.lat *= dpow(D.decay, dt);
    const an = tr.ang[a]!;
    r.x = lerp(tr.x[a]!, tr.x[b]!, f) - dsin(an) * r.lat;
    r.y = lerp(tr.y[a]!, tr.y[b]!, f) + dcos(an) * r.lat;
    r.z = hAt(tr, r.x, r.y) + D.lift;
    for (const k of w.karts) {
      if (k.id === r.owner) continue;
      if (dhypot(k.x - r.x, k.y - r.y) < D.radius) {
        if (deflected(w, k, r)) break;
        hit(w, k, D.hit, 1); r.life = 0; break;
      }
    }
    return r.life > 0;
  },
});
/** Proximity mine: arms after a moment, then explodes when anyone gets close. */
defineEntity({
  kind: 'mine', blackHole: 'all',
  update(w, m, dt) {
    const M = T.items.mina;
    m.age += dt;
    if (m.age > M.life) return false;
    if (m.age < M.arm) return true;
    let boom = false;
    for (const k of w.karts) if (!k.air && k.respawn <= 0 && dhypot(k.x - m.x, k.y - m.y) < M.radius * 0.5) boom = true;
    if (!boom) return true;
    for (const k of w.karts) if (!k.air && dhypot(k.x - m.x, k.y - m.y) < M.radius) hit(w, k, M.hit, 1);
    emit(w, { type: 'explode', x: m.x, y: m.y });
    return false;
  },
});
/** Wave (track hazard): sweeps across the road; a light hit and a push towards land. */
defineEntity({
  kind: 'ola', blackHole: 'none',
  update(w, o, dt) {
    const H = T.race.hazards.ola, tr = w.track, i = o.s;
    o.t += dt;
    const f = Math.min(1, o.t / o.life);
    o.lat = lerp(o.vx, o.vy, f);
    const a = tr.ang[i]!;
    o.x = tr.x[i]! - dsin(a) * o.lat;
    o.y = tr.y[i]! + dcos(a) * o.lat;
    o.z = hAt(tr, o.x, o.y);
    const dir = Math.sign(o.vy - o.vx);
    for (const k of w.karts) {
      if (k.air || !canBeHit(k)) continue;
      if (dhypot(k.x - o.x, k.y - o.y) < H.radius + 10) {
        hit(w, k, 0, 0);
        k.x += -dsin(a) * dir * H.push;
        k.y += dcos(a) * dir * H.push;
      }
    }
    return o.t < o.life;
  },
});
/** Black hole animation (the clearing happens on use). */
defineEntity({
  kind: 'hole', blackHole: 'none',
  update(_w, h, dt) { h.t += dt; return h.t < T.items.agujero.anim; },
});
