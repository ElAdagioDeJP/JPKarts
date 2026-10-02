// Eliminación (GDD §5): N − 1 laps; every lap, the last kart to cross the line is knocked out.
import { emit, isHuman } from '../sim/helpers';
import { defineMode } from '../sim/modes';
import type { Kart, World } from '../sim/types';

function knockOut(w: World, k: Kart, left: number) {
  k.out = true; k.finished = true; k.time = w.raceT;
  k.respawn = 1e9; k.item = null; k.itemN = 0; k.roll = 0; k.speed = 0; k.boost = 0;
  emit(w, { type: 'eliminated', kart: k.id, left });
}

defineMode({
  id: 'elimination', name: 'Eliminación',
  laps: (players) => Math.max(1, players - 1),
  tick(w) {
    const N = w.track.N, alive = w.karts.filter((k) => !k.out);
    if (alive.length <= 1) return;
    const L = w.elimLap + 1, behind = alive.filter((k) => k.prog < L * N);
    if (behind.length === 1) { w.elimLap = L; knockOut(w, behind[0]!, alive.length - 1); }
    else if (behind.length === 0) w.elimLap = L;
  },
  endCondition(w) {
    const alive = w.karts.filter((k) => !k.out), humans = w.karts.filter(isHuman);
    // the race ends with one kart standing, or when every human is out
    return alive.length <= 1 || (humans.length > 0 && humans.every((k) => k.out || k.finished));
  },
});
