// Batalla (GDD §5, §6.6), played on the arenas. Two rule sets:
//   Globos: 3 balloons each; a hit pops one, ramming with a boost steals one; 0 balloons = out.
//           Ends with one kart standing or after `battle.time` (most balloons wins).
//   Captura: one flag; seconds holding it score; a hit drops it. First to `capture.goal` s, or the best at the end.
import { dhypot } from '../dmath';
import { T } from '../tunables';
import { hAt } from '../track/track';
import { addFx, defineEffect, hasFx } from '../sim/effects';
import { defineEntity, spawn } from '../sim/entities';
import { bumpHooks, canBeHit, emit, hitHooks, isHuman } from '../sim/helpers';
import { defineMode } from '../sim/modes';
import type { Ent, Kart, World } from '../sim/types';

const NO_LAPS = 99;
const alive = (w: World) => w.karts.filter((k) => !k.out);

function knockOut(w: World, k: Kart) {
  k.out = true; k.finished = true; k.time = w.raceT;
  k.respawn = 1e9; k.item = null; k.itemN = 0; k.roll = 0; k.speed = 0; k.boost = 0;
  emit(w, { type: 'eliminated', kart: k.id, left: alive(w).length });
}

/** Nearest rival still in the game (and worth chasing), within `range`. */
function nearestRival(w: World, k: Kart, range: number, ok: (o: Kart) => boolean): Kart | null {
  let best: Kart | null = null, bd = range;
  for (const o of w.karts) {
    if (o === k || o.out || o.respawn > 0 || !ok(o)) continue;
    const d = dhypot(o.x - k.x, o.y - k.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// ---------------- Globos ----------------
const isBalloons = (w: World) => w.cfg.mode === 'battle';
hitHooks.push((w, k, src) => {
  if (!isBalloons(w) || k.out || k.balloons <= 0) return;
  k.balloons--;
  emit(w, { type: 'balloon', kart: k.id, left: k.balloons, by: src });
  if (k.balloons <= 0) knockOut(w, k);
});
const ramming = (k: Kart) => k.boost > T.race.battle.stealBoost || hasFx(k, 'jug') || hasFx(k, 'bala');
bumpHooks.push((w, a, b) => {
  if (!isBalloons(w)) return;
  for (const [att, vic] of [[a, b], [b, a]] as const) {
    if (!ramming(att) || ramming(vic) || vic.out || vic.balloons <= 0 || !canBeHit(vic)) continue;
    vic.balloons--;
    att.balloons = Math.min(T.race.battle.maxBalloons, att.balloons + 1);
    vic.invuln = T.driving.hit.invuln;
    emit(w, { type: 'balloonSteal', kart: att.id, from: vic.id });
    if (vic.balloons <= 0) knockOut(w, vic);
    return;
  }
});

defineMode({
  id: 'battle', name: 'Batalla: Globos', arena: true, trackCoins: false,
  laps: () => NO_LAPS,
  setup(w) { for (const k of w.karts) k.balloons = T.race.battle.balloons; },
  rank(a, b) {
    if (a.out !== b.out) return a.out ? 1 : -1;
    if (a.out) return b.time! - a.time!;
    return b.balloons - a.balloons || a.id - b.id;
  },
  aiTarget(w, k) {
    const o = nearestRival(w, k, T.race.battle.chase, (o) => o.balloons > 0);
    return o ? [o.x, o.y] : null;
  },
  endCondition(w) {
    const humans = w.karts.filter(isHuman);
    return alive(w).length <= 1 || w.raceT >= T.race.battle.time || (humans.length > 0 && humans.every((k) => k.out));
  },
});

// ---------------- Captura ----------------
/** Carrying the flag weighs you down a little, so the others can catch up. */
defineEffect({ type: 'flagged', tags: ['slow'], speed: { order: 21, apply(c) { c.max *= T.race.capture.carrierMul; } } });
const flagOf = (w: World): Ent | undefined => w.ents.find((e) => e.kind === 'flag');
/** The flag: `target` = carrier (−1 on the ground); `owner`/`cdn` stop the kart that dropped it from re-grabbing at once. */
defineEntity({
  kind: 'flag', blackHole: 'none',
  update(w, f, dt) {
    const C = T.race.capture;
    if (f.cdn > 0) f.cdn -= dt;
    const c = f.target >= 0 ? w.karts[f.target] : undefined;
    if (c) {
      if (c.out || c.respawn > 0) { f.target = -1; f.owner = c.id; f.cdn = C.regrab; emit(w, { type: 'flagDrop', kart: c.id }); return true; }
      f.x = c.x; f.y = c.y; f.z = c.z;
      c.score += dt;
      addFx(c, 'flagged', 0.1, c.id);
      return true;
    }
    for (const k of w.karts) {
      if (k.out || k.respawn > 0 || k.spin > 0 || (k.id === f.owner && f.cdn > 0)) continue;
      if (dhypot(k.x - f.x, k.y - f.y) < C.radius) { f.target = k.id; f.owner = k.id; f.cdn = C.regrab; emit(w, { type: 'flagGet', kart: k.id }); break; }
    }
    return true;
  },
});
/** Bumping into the carrier takes the flag (not right after they got it: `cdn`). */
bumpHooks.push((w, a, b) => {
  if (w.cfg.mode !== 'capture') return;
  const f = flagOf(w);
  if (!f || f.cdn > 0 || (f.target !== a.id && f.target !== b.id)) return;
  const thief = f.target === a.id ? b : a;
  if (thief.out || thief.respawn > 0) return;
  emit(w, { type: 'flagDrop', kart: f.target });
  f.target = thief.id; f.owner = thief.id; f.cdn = T.race.capture.regrab;
  emit(w, { type: 'flagGet', kart: thief.id });
});
hitHooks.push((w, k) => {
  if (w.cfg.mode !== 'capture') return;
  const f = flagOf(w);
  if (!f || f.target !== k.id) return;
  f.target = -1; f.owner = k.id; f.cdn = T.race.capture.regrab;
  emit(w, { type: 'flagDrop', kart: k.id });
});

defineMode({
  id: 'capture', name: 'Batalla: Captura', arena: true, trackCoins: false,
  laps: () => NO_LAPS,
  setup(w) {
    const tr = w.track, i = Math.floor(tr.N / 2), x = tr.x[i]!, y = tr.y[i]!;
    spawn(w, 'flag', { x, y, z: hAt(tr, x, y), target: -1, owner: -1 });
  },
  rank(a, b) { return b.score - a.score || a.id - b.id; },
  aiTarget(w, k) {
    const f = flagOf(w);
    if (!f) return null;
    if (f.target === k.id) return null; // carrying it: run along the line
    if (f.target >= 0) { const c = w.karts[f.target]!; return [c.x, c.y]; }
    return dhypot(f.x - k.x, f.y - k.y) < 900 ? [f.x, f.y] : null;
  },
  endCondition(w) { return w.raceT >= T.race.capture.time || w.karts.some((k) => k.score >= T.race.capture.goal); },
});
