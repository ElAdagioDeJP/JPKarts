// Coins (docs/GDD.md §4.1): each coin raises the top speed (+1.2 %, up to 10). A hit drops 3 coins that anyone
// can pick up for a few seconds. Track coins come back after a while. One entity kind, two flavours:
//   target = 1 → track coin (home position in vx/vy, hidden while t > 0)
//   target = 0 → dropped coin (lives `dropLife` s, its dropper cannot take it back during the first half second)
import { dcos, dhypot, dsin } from '../dmath';
import { T } from '../tunables';
import { hAt } from '../track/track';
import { fxOf } from './effects';
import { defineEntity, spawn } from './entities';
import { emit, hitHooks } from './helpers';
import { modeOf } from './modes';
import type { Kart, World } from './types';

const LIFT = 4;
const DROP_GRACE = 0.5;

export function giveCoins(w: World, k: Kart, n: number) {
  const C = T.race.coins, before = k.coins;
  k.coins = Math.min(C.max, k.coins + n);
  if (before === 0 && k.coins > 0) k.boost = Math.max(k.boost, C.firstBoost);
  emit(w, { type: 'coin', kart: k.id, coins: k.coins });
}

/** Take up to `n` coins from a kart and scatter them around it. Returns how many it lost. */
export function dropCoins(w: World, k: Kart, n: number): number {
  const C = T.race.coins, lost = Math.min(n, k.coins);
  if (lost <= 0) return 0;
  k.coins -= lost;
  for (let i = 0; i < lost; i++) {
    const a = k.a + Math.PI + (i - (lost - 1) / 2) * 0.9, x = k.x + dcos(a) * C.dropSpread, y = k.y + dsin(a) * C.dropSpread;
    spawn(w, 'coin', { x, y, z: hAt(w.track, x, y) + LIFT, life: C.dropLife, owner: k.id, target: 0 });
  }
  emit(w, { type: 'coinLoss', kart: k.id, n: lost });
  return lost;
}

hitHooks.push((w, k) => { dropCoins(w, k, T.race.coins.lose); });

defineEntity({
  kind: 'coin', blackHole: 'none',
  update(w, c, dt) {
    const C = T.race.coins, M = T.items.iman, track = c.target === 1;
    c.age += dt;
    if (track && c.t > 0) {
      c.t -= dt;
      if (c.t <= 0) { c.x = c.vx; c.y = c.vy; c.z = hAt(w.track, c.x, c.y) + LIFT; }
      return true;
    }
    if (!track) { c.life -= dt; if (c.life <= 0) return false; }
    for (const k of w.karts) {
      if (k.respawn > 0 || k.finished) continue;
      if (!track && k.id === c.owner && c.age < DROP_GRACE) continue;
      const d = dhypot(k.x - c.x, k.y - c.y);
      // coin magnet: pull nearby coins towards the kart
      if (d < M.radius && d > 1 && fxOf(k, 'magnet')) {
        const s = Math.min(d, M.pull * dt) / d;
        c.x += (k.x - c.x) * s; c.y += (k.y - c.y) * s; c.z = hAt(w.track, c.x, c.y) + LIFT;
      }
      if (d < C.radius && Math.abs(k.z - c.z) < 16) {
        giveCoins(w, k, 1);
        if (!track) return false;
        c.t = C.respawn;
        return true;
      }
    }
    return true;
  },
});

/** Lines of coins between the item rows (and a few on each shortcut): authored tracks only. */
export function spawnTrackCoins(w: World) {
  const tr = w.track, a = tr.authored;
  if (!a || modeOf(w).trackCoins === false) return;
  const C = T.race.coins, N = tr.N, step = Math.max(1, Math.round(C.spacing / 6));
  const put = (i: number, lat: number) => {
    const j = ((i % N) + N) % N, an = tr.ang[j]!, x = tr.x[j]! - dsin(an) * lat, y = tr.y[j]! + dcos(an) * lat;
    spawn(w, 'coin', { x, y, z: hAt(tr, x, y) + LIFT, vx: x, vy: y, target: 1, owner: -1 });
  };
  const lines = a.coins ?? a.itemRows.map((f, r) => ({ at: f + 0.045, lat: [-0.5, 0.5, 0, -0.45][r % 4]!, n: C.line }));
  for (const l of lines) {
    const i0 = Math.floor(l.at * N);
    for (let c = 0; c < (l.n ?? C.line); c++) put(i0 + c * step, l.lat * tr.wd[(i0 + c * step) % N]!);
  }
  // risky lines pay more: coins along each shortcut
  for (const b of tr.branches)
    for (let c = 1; c <= 3; c++) {
      const i = Math.floor((b.n * c) / 4), x = b.x[i]!, y = b.y[i]!;
      spawn(w, 'coin', { x, y, z: hAt(tr, x, y) + LIFT, vx: x, vy: y, target: 1, owner: -1 });
    }
}
