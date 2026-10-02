// Track hazards (docs/GDD.md §4.3): generic behaviours with data presets.
//  - crossers: sweep across the road (wave, train, cows, cars, penguins)
//  - sweepers: rotating arm over the road (windmill blades)
//  - eruptions: an area becomes dangerous after a warning (geysers, lasers, meteors)
//  - rollers: roll back down the track towards the karts (rocks, balls, snowballs)
//  - trampolines: static launch pads (mushrooms)
//  - gates: block a route on some laps (stadium gates)
// Every hazard warns ≥ 1 s before it can hurt (pillar "chaos, but fair").
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { clamp, lerp } from '../math';
import { T } from '../tunables';
import { hAt } from '../track/track';
import { defineEntity } from './entities';
import { canBeHit, emit, hit } from './helpers';
import type { Ent, Kart, World } from './types';

export interface HazardPreset {
  /** crossing/rolling speed or duration (s) */
  duration?: number;
  speed?: number;
  /** contact radius */
  radius: number;
  /** hit: 0 light, 1 normal, 2 strong (shields don't stop it) */
  level: number;
  /** spin time for normal/strong hits */
  spin?: number;
  /** lateral push on contact (units) */
  push?: number;
  /** launch upwards (geysers, mushrooms) */
  launch?: number;
}
const preset = (kind: string): HazardPreset => (T.race.hazards as unknown as Record<string, HazardPreset>)[kind]!;

/** Track-space position of a hazard: sample i + lateral offset. */
function place(w: World, e: Ent) {
  const tr = w.track, i = ((Math.floor(e.s) % tr.N) + tr.N) % tr.N, f = e.s - Math.floor(e.s), j = (i + 1) % tr.N, a = tr.ang[i]!;
  e.x = lerp(tr.x[i]!, tr.x[j]!, f) - dsin(a) * e.lat;
  e.y = lerp(tr.y[i]!, tr.y[j]!, f) + dcos(a) * e.lat;
  e.z = hAt(tr, e.x, e.y);
}

function strike(w: World, e: Ent, P: HazardPreset, k: Kart, dirLat: number) {
  if (!canBeHit(k)) return;
  if (P.launch && !k.air) {
    k.air = true; k.glide = false; k.vz = P.launch; k.trickT = T.driving.trick.takeoff; k.trick = false;
    emit(w, { type: 'jump', kart: k.id });
  }
  if (P.level >= 0) hit(w, k, P.spin ?? 1, P.level);
  if (P.push) {
    const a = w.track.ang[((Math.floor(e.s) % w.track.N) + w.track.N) % w.track.N]!;
    k.x += -dsin(a) * dirLat * P.push;
    k.y += dcos(a) * dirLat * P.push;
  }
}

const touching = (e: Ent, k: Kart, r: number) => !k.air && k.respawn <= 0 && dhypot(k.x - e.x, k.y - e.y) < r;

/** Crosser: moves from lateral vx to vy over `life` seconds at sample s. */
function crosser(kind: string) {
  defineEntity({
    kind, blackHole: 'none',
    update(w, e, dt) {
      const P = preset(kind);
      e.t += dt;
      e.lat = lerp(e.vx, e.vy, Math.min(1, e.t / e.life));
      place(w, e);
      const dir = Math.sign(e.vy - e.vx);
      for (const k of w.karts) if (touching(e, k, P.radius + 8)) strike(w, e, P, k, dir);
      return e.t < e.life;
    },
  });
}
/** Sweeper: an arm rotating around (s, lat) with radius r; `life` is the rotation period. Lives all race. */
function sweeper(kind: string) {
  defineEntity({
    kind, blackHole: 'none',
    update(w, e, dt) {
      const P = preset(kind);
      e.t += dt;
      const ang = (e.t / e.life) * Math.PI * 2, tr = w.track, i = ((Math.floor(e.s) % tr.N) + tr.N) % tr.N, a = tr.ang[i]!;
      const cx = tr.x[i]! - dsin(a) * e.lat, cy = tr.y[i]! + dcos(a) * e.lat;
      // arm tip and middle sweep the road plane
      e.x = cx + dcos(ang) * e.r * 0.5;
      e.y = cy + dsin(ang) * e.r * 0.5;
      e.z = hAt(tr, cx, cy);
      for (const k of w.karts) {
        if (k.air || k.respawn > 0) continue;
        // distance from the kart to the arm segment
        const ax = dcos(ang), ay = dsin(ang), rx = k.x - cx, ry = k.y - cy, along = clamp(rx * ax + ry * ay, 0, e.r);
        if (dhypot(rx - ax * along, ry - ay * along) < P.radius) strike(w, e, P, k, 1);
      }
      return true;
    },
  });
}
/** Eruption: warned at spawn, active for P.duration after `cdn` seconds, at (s, lat) with radius r. */
function eruption(kind: string) {
  defineEntity({
    kind, blackHole: 'none',
    update(w, e, dt) {
      const P = preset(kind);
      e.t += dt;
      place(w, e);
      if (e.t >= e.cdn) for (const k of w.karts) if (touching(e, k, e.r)) strike(w, e, P, k, 0);
      return e.t < e.cdn + (P.duration ?? 1);
    },
  });
}
/** Roller: rolls backwards along the track (against the karts) from sample s. */
function roller(kind: string) {
  defineEntity({
    kind, blackHole: 'notOwner',
    update(w, e, dt) {
      const P = preset(kind);
      e.t += dt;
      e.s -= ((P.speed ?? 120) * dt) / 6;
      place(w, e);
      for (const k of w.karts) if (touching(e, k, P.radius + 6)) { strike(w, e, P, k, 0); return false; }
      return e.t < e.life;
    },
  });
}
/** Trampoline: static; launches karts that drive over it. */
function trampoline(kind: string) {
  defineEntity({
    kind, blackHole: 'none',
    update(w, e) {
      const P = preset(kind);
      place(w, e);
      for (const k of w.karts) if (touching(e, k, e.r)) strike(w, e, P, k, Math.sign(e.lat) || 1);
      return true;
    },
  });
}
/** Gate: blocks lateral range [vx, vy] at sample s for karts whose current lap is in the closed laps (bitmask in `target`). */
function gate(kind: string) {
  defineEntity({
    kind, blackHole: 'none',
    update(w, e) {
      const tr = w.track, i = ((Math.floor(e.s) % tr.N) + tr.N) % tr.N, a = tr.ang[i]!;
      e.lat = (e.vx + e.vy) / 2;
      place(w, e);
      for (const k of w.karts) {
        const lap = Math.floor(k.prog / tr.N) + 1;
        if (!((e.target >> lap) & 1)) continue;
        // along-track distance to the gate line
        const dx = k.x - tr.x[i]!, dy = k.y - tr.y[i]!, along = dx * dcos(a) + dy * dsin(a), lat = dx * -dsin(a) + dy * dcos(a);
        if (Math.abs(along) < 7 && lat > e.vx && lat < e.vy) {
          if (k.wallCD <= 0) { emit(w, { type: 'wallBump', kart: k.id, hard: true }); k.wallCD = 0.3; }
          // the closed gate sends the kart to the start of the detour that goes around it (no stuck loops)
          const N = tr.N, b = tr.branches.find((b) => (i - b.i0 + N) % N < (b.i1 - b.i0 + N) % N);
          if (b && b.n > 1) {
            if (k.ai) k.ai.branch = tr.branches.indexOf(b);
            k.x = b.x[0]!; k.y = b.y[0]!; k.a = k.va = datan2(b.y[1]! - b.y[0]!, b.x[1]! - b.x[0]!); k.speed = 0; k.drift = 0;
          } else {
            k.x -= dcos(a) * (8 - along); k.y -= dsin(a) * (8 - along);
            k.speed = Math.min(k.speed, 0) - 20;
          }
        }
      }
      return true;
    },
  });
}

export const HAZARD_KINDS = {
  crosser: ['ola', 'tren', 'vaca', 'auto', 'pinguino'],
  sweeper: ['aspa'],
  eruption: ['geiser', 'laser', 'meteoro'],
  roller: ['roca', 'pelota', 'bolanieve'],
  trampoline: ['seta'],
  gate: ['compuerta'],
} as const;
for (const k of HAZARD_KINDS.crosser) crosser(k);
for (const k of HAZARD_KINDS.sweeper) sweeper(k);
for (const k of HAZARD_KINDS.eruption) eruption(k);
for (const k of HAZARD_KINDS.roller) roller(k);
for (const k of HAZARD_KINDS.trampoline) trampoline(k);
for (const k of HAZARD_KINDS.gate) gate(k);

const kindOf = (kind: string) => (Object.entries(HAZARD_KINDS).find(([, l]) => (l as readonly string[]).includes(kind))?.[0] ?? 'crosser') as keyof typeof HAZARD_KINDS;
export const hazardFamily = kindOf;

export interface HazardSpec { kind: string; at: number; period: number; warn: number; offset?: number; lat?: [number, number]; radius?: number; laps?: number[] }

/** Permanent hazards (sweepers, trampolines, gates) exist from the start. */
export function spawnStaticHazards(w: World, spawn: (w: World, kind: string, p: Partial<Ent>) => Ent) {
  const tr = w.track, a = tr.authored;
  if (!a) return;
  for (const h of a.hazards as HazardSpec[]) {
    const fam = kindOf(h.kind), i = ((Math.floor(h.at * tr.N) % tr.N) + tr.N) % tr.N;
    if (fam === 'sweeper') spawn(w, h.kind, { s: i, lat: h.lat?.[0] ?? 0, r: h.radius ?? tr.wd[i]! + 10, life: h.period, t: (h.offset ?? 0) });
    if (fam === 'trampoline') spawn(w, h.kind, { s: i, lat: h.lat?.[0] ?? 0, r: h.radius ?? 12 });
    const g0 = h.lat?.[0] ?? -tr.wd[i]! - 10, g1 = h.lat?.[1] ?? tr.wd[i]! + 10;
    if (fam === 'gate') spawn(w, h.kind, { s: i, vx: Math.min(g0, g1), vy: Math.max(g0, g1), target: (h.laps ?? []).reduce((m, l) => m | (1 << l), 0) });
  }
}

/** Timed hazards: warn, then spawn. Meteors pick a random lateral position (race RNG, deterministic). */
export function spawnTimedHazard(w: World, h: HazardSpec, spawn: (w: World, kind: string, p: Partial<Ent>) => Ent) {
  const tr = w.track, fam = kindOf(h.kind), i = ((Math.floor(h.at * tr.N) % tr.N) + tr.N) % tr.N, P = preset(h.kind), lat = h.lat ?? [60, -60];
  if (fam === 'crosser') spawn(w, h.kind, { s: i, lat: lat[0], vx: lat[0], vy: lat[1], life: P.duration ?? 1.5 });
  else if (fam === 'roller') spawn(w, h.kind, { s: i, lat: lat[0], life: 8 });
  else if (fam === 'eruption') {
    const l = h.kind === 'meteoro' ? w.rng.range(lat[0], lat[1]) : lat[0];
    spawn(w, h.kind, { s: i, lat: l, r: h.radius ?? 18, cdn: h.warn, t: 0 });
  }
}

export const isTimed = (kind: string) => ['crosser', 'roller', 'eruption'].includes(kindOf(kind));
