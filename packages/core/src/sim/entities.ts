// World entities (projectiles, traps, hazards): one list, one registry. Adding a kind = one defineEntity().
import { ROAD } from '../constants';
import { dhypot, dpow, dsin, dcos } from '../dmath';
import { lerp } from '../math';
import { T } from '../tunables';
import { dgAt, hAt, lateralAt, wgAt } from '../track/track';
import { addFx, eachFx } from './effects';
import { emit, hit, isHuman } from './helpers';
import { giveItem } from './items';
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
  zoneEffect?: { maxMul?: () => number; cancelDrift: boolean; grip?: () => number };
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
    const d = BY_KIND.get(e.kind);
    if (!d) throw new Error('Entidad sin registrar: ' + e.kind);
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
/** Fake item box (Caja Falsa): looks like a box; whoever touches it takes a light hit. Affects everyone. */
defineEntity({
  kind: 'fakebox', blackHole: 'all',
  update(w, f, dt) {
    const F = T.items.falsa;
    f.age += dt;
    for (const k of w.karts) {
      if (k.air || k.respawn > 0 || (f.owner === k.id && f.age < F.ownerGrace)) continue;
      if (dhypot(k.x - f.x, k.y - f.y) < F.radius) {
        hit(w, k, F.hit, 0, f.owner);
        emit(w, { type: 'explode', x: f.x, y: f.y });
        return false;
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
/** Blind shot: flies straight, dies off-road. Bounces off hard walls (GDD §3.2). */
defineEntity({
  kind: 'shot', blackHole: 'notOwner',
  update(w, s, dt) {
    const C = T.items.ciego, tr = w.track, N = tr.N;
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    // nearest sample (windowed around the last one, global fallback); kept in `s`
    let bi = ((Math.round(s.s) % N) + N) % N, bd = 1e12;
    for (let j = -25; j <= 25; j++) {
      const i = (bi + j + N) % N, dx = tr.x[i]! - s.x, dy = tr.y[i]! - s.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bi = i; }
    }
    if (bd > 130 * 130) {
      bd = 1e12;
      for (let i = 0; i < N; i++) { const dx = tr.x[i]! - s.x, dy = tr.y[i]! - s.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    }
    s.s = bi;
    s.z = hAt(tr, s.x, s.y) + C.lift;
    if (dgAt(tr, s.x, s.y) - wgAt(tr, s.x, s.y) > C.offRoad) return false;
    // hard walls: bounce up to `bounces` times (impact count in `lat`), then fizzle
    const lat = lateralAt(tr, bi, s.x, s.y), lim = tr.wd[bi]! + 8;
    let side = 0;
    if (lat > lim && tr.wallR[bi]) side = 1;
    else if (lat < -lim && tr.wallL[bi]) side = -1;
    if (side) {
      s.lat += 1;
      if (s.lat > C.bounces) return false;
      const a = tr.ang[bi]!, rx = -dsin(a), ry = dcos(a);
      const vn = (s.vx * rx + s.vy * ry) * side;
      if (vn > 0) { s.vx -= 2 * vn * rx * side; s.vy -= 2 * vn * ry * side; }
      const pen = Math.abs(lat) - lim;
      s.x -= rx * pen * side; s.y -= ry * pen * side;
    }
    for (const k of w.karts) {
      if (k.id === s.owner) continue;
      if (dhypot(k.x - s.x, k.y - s.y) < C.radius) {
        if (deflected(w, k, s)) break;
        hit(w, k, C.hit, 1, s.owner); s.life = 0; break;
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
        hit(w, k, D.hit, 1, r.owner); r.life = 0; break;
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
    for (const k of w.karts) if (!k.air && dhypot(k.x - m.x, k.y - m.y) < M.radius) hit(w, k, M.hit, 1, m.owner);
    emit(w, { type: 'explode', x: m.x, y: m.y });
    return false;
  },
});
/** Black hole animation (the clearing happens on use). */
defineEntity({
  kind: 'hole', blackHole: 'none',
  update(_w, h, dt) { h.t += dt; return h.t < T.items.agujero.anim; },
});
/** Boomerang: flies `range` units, then homes back to its owner. Hits on the way out and back; caught once (target 0 = first throw). */
defineEntity({
  kind: 'boomer', blackHole: 'notOwner',
  update(w, b, dt) {
    const B = T.items.bumeran, o = w.karts[b.owner];
    b.life -= dt;
    if (b.s >= B.range && o) {
      const dx = o.x - b.x, dy = o.y - b.y, d = dhypot(dx, dy) || 1, k = Math.min(1, B.returnTurn * dt);
      b.vx += ((dx / d) * B.speed - b.vx) * k;
      b.vy += ((dy / d) * B.speed - b.vy) * k;
      if (d < B.catch) {
        if (b.target === 0 && !o.item && o.roll <= 0) { giveItem(w, o, 'bumeranR'); emit(w, { type: 'catch', kart: o.id }); }
        return false;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.s += dhypot(b.vx, b.vy) * dt;
    b.z = hAt(w.track, b.x, b.y) + 4;
    for (const k of w.karts) {
      if (k.id === b.owner || dhypot(k.x - b.x, k.y - b.y) >= B.radius) continue;
      if (deflected(w, k, b)) break;
      hit(w, k, B.hit, 1, b.owner);
    }
    return b.life > 0;
  },
});
/** Ice block: a slippery patch (grip x `hielo.grip`) that melts after a while. */
defineEntity({
  kind: 'ice', blackHole: 'all',
  update(_w, t, dt) { t.life -= dt; return t.life > 0; },
  zone(t, k) { return dhypot(k.x - t.x, k.y - t.y) < t.r; },
  zoneEffect: { cancelDrift: false, grip: () => T.items.hielo.grip },
});
/** Smoke curtain: covers the view of the locals inside it and makes the AI's line sloppy. */
defineEntity({
  kind: 'smoke', blackHole: 'all',
  update(w, s, dt) {
    const H = T.items.humo;
    s.life -= dt;
    for (const k of w.karts) {
      if (k.id === s.owner || dhypot(k.x - s.x, k.y - s.y) > s.r) continue;
      addFx(k, isHuman(k) ? 'smoke' : 'fog', H.fog, s.owner);
    }
    return s.life > 0;
  },
});
