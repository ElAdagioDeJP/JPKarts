// Event/state → 3D particles (ART_BIBLE §6). Visual only: never touches the simulation.
import { CHARS, type GameEvent, type Kart, type World, hasFx } from '@jpkart/core';
import type { Particles } from '../render/particles';

export const DRIFT_COL = ['#fff7e0', '#3df0ff', '#ff8a1f', '#b84aff'];
/** Colorblind-safe drift levels (blue / yellow / white). */
export const DRIFT_COL_CB = ['#fff7e0', '#3a7aff', '#ffe45e', '#ffffff'];
const SURF_COL: Record<string, string> = { arena: '#e8cc88', barro: '#6a4a2a', charco: '#8fd4ff', hielo: '#ffffff' };

export class Fx3d {
  colorblind = false;
  private acc = 0;
  constructor(private p: Particles) {}

  /** Continuous emitters from karts near the camera. `pose` gives interpolated positions. */
  frame(w: World, dt: number, camX: number, camY: number, pose: (k: Kart) => { x: number; y: number; z: number; a: number }, ground: string) {
    this.acc += dt;
    if (this.acc < 1 / 60) return;
    this.acc = 0;
    const r = Math.random, cols = this.colorblind ? DRIFT_COL_CB : DRIFT_COL;
    for (const k of w.karts) {
      if (k.respawn > 0) continue;
      const ps = pose(k);
      if (Math.hypot(ps.x - camX, ps.y - camY) > 360) continue;
      const ca = Math.cos(ps.a), sa = Math.sin(ps.a);
      const rear = (side: number) => [ps.x - ca * 6 - sa * side * 4, ps.y - sa * 6 + ca * side * 4] as const;
      if (k.drift && k.speed > 60) {
        for (const side of [-1, 1]) {
          const [x, y] = rear(side);
          this.p.emit(x, y, ps.z + 1, (r() - 0.5) * 30 - sa * k.drift * 20, (r() - 0.5) * 30 + ca * k.drift * 20, 20 + r() * 30, 0.25, k.dLvl ? 1.4 : 0.9, cols[k.dLvl]!, 120);
        }
      }
      if (k.boost > 0) {
        const [x, y] = rear(0);
        for (let i = 0; i < 2; i++) this.p.emit(x, y, ps.z + 2, -ca * 40 + (r() - 0.5) * 15, -sa * 40 + (r() - 0.5) * 15, 5 + r() * 10, 0.18, 1.6, r() < 0.5 ? '#ffe45e' : '#ff8a1f');
      }
      const dusty = k.off === 2 || (k.surf && SURF_COL[k.surf]);
      if (dusty && Math.abs(k.speed) > 30 && r() < 0.7) {
        const [x, y] = rear(r() < 0.5 ? -1 : 1);
        this.p.emit(x, y, ps.z + 0.5, (r() - 0.5) * 20, (r() - 0.5) * 20, 10 + r() * 15, 0.35, 1.3, k.surf ? SURF_COL[k.surf]! : ground, 60);
      }
      if (hasFx(k, 'jug') && r() < 0.5) this.p.emit(ps.x + (r() - 0.5) * 12, ps.y + (r() - 0.5) * 12, ps.z + 4 + r() * 10, 0, 0, 10, 0.3, 1.2, r() < 0.5 ? '#ffd23a' : '#ffffff');
    }
    for (const e of w.ents) {
      if (e.kind === 'ola') for (let i = 0; i < 3; i++) this.p.emit(e.x + (r() - 0.5) * 30, e.y + (r() - 0.5) * 30, e.z + 6, (r() - 0.5) * 20, (r() - 0.5) * 20, 20 + r() * 25, 0.45, 1.6, r() < 0.6 ? '#ffffff' : '#bff0ff', 80);
      if (e.kind === 'mine' && e.age > 1 && ((e.age * 6) | 0) % 2 === 0 && r() < 0.2) this.p.emit(e.x, e.y, e.z + 3, 0, 0, 6, 0.2, 1, '#ff3a3a');
    }
  }

  /** One-shot bursts from simulation events. */
  event(e: GameEvent, w: World) {
    const k = 'kart' in e ? w.karts[e.kart] : undefined;
    switch (e.type) {
      case 'hit': if (k) this.p.burst(k.x, k.y, k.z + 6, 14, 60, 0.5, 1.6, ['#ffe45e', '#ffffff', '#d8f03a'], 90); break;
      case 'explode': this.p.burst(e.x, e.y, (w.karts[0]?.z ?? 0) + 4, 40, 110, 0.7, 2.4, ['#ff8a1f', '#ffe45e', '#e8455a', '#3a3848'], 120); break;
      case 'fall': if (k) this.p.burst(k.x, k.y, k.z + 1, 24, 70, 0.6, 1.8, w.track.def.liquid ? [w.track.def.liquid.col3, '#ffffff', w.track.def.liquid.col] : ['#888'], 160); break;
      case 'trick': if (k) this.p.burst(k.x, k.y, k.z + 8, 10, 40, 0.4, 1.2, ['#ffffff', '#ffe45e', '#3df0ff']); break;
      case 'miniTurbo': if (k) this.p.burst(k.x - Math.cos(k.a) * 6, k.y - Math.sin(k.a) * 6, k.z + 2, 8 + e.level * 4, 50, 0.3, 1.4, [DRIFT_COL[e.level]!, '#ffffff']); break;
      case 'shieldPop': if (k) this.p.burst(k.x, k.y, k.z + 7, 16, 50, 0.4, 1.4, ['#8fe0ff', '#ffffff']); break;
      case 'land': if (k && e.hard) this.p.burst(k.x, k.y, k.z, 10, 40, 0.35, 1.4, [w.track.th.ground[0]], 120); break;
      case 'reflect': if (k) this.p.burst(k.x, k.y, k.z + 7, 18, 60, 0.4, 1.4, ['#ffd23a', '#fff7b0']); break;
      case 'itemGet': if (k && k.ctrl !== 'ai') this.p.burst(k.x, k.y, k.z + 10, 6, 25, 0.35, 1.2, ['#d8f03a', '#ffffff']); break;
      default: break;
    }
    void CHARS;
  }
}
