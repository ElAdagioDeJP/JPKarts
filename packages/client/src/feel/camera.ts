// Chase camera v2 (camera-systems + game-feel): frame-rate independent smoothing, drift look-ahead,
// boost FOV kick, jump pull-back, look-behind, and trauma-based shake applied as a visual offset only.
import { type Track, hAt, wrapA } from '@jpkart/core';
import { H0 } from '../render/world3d';
import { F } from '../render/trackArt';

const CAM_H = 15, CAM_BACK = 34;
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export interface CamTarget { x: number; y: number; z: number; a: number; drift: number; boost: boolean; air: boolean; lookBack: boolean; spinning: boolean }

export class CameraRig {
  x = 0; y = 0; z = 30; a = 0; hz = H0; f = F; roll = 0;
  private look = 0;
  private back = CAM_BACK;
  private lift = 0;
  trauma = 0;
  /** accessibility: 1 normal, 0.3 reduced, 0 off */
  shakeScale = 1;
  private t = 0;

  /** Jump straight to a target (start, respawn): no swing across the map. */
  cut(tg: CamTarget, tr: Track) {
    this.a = tg.a; this.x = tg.x - Math.cos(tg.a) * CAM_BACK; this.y = tg.y - Math.sin(tg.a) * CAM_BACK;
    this.z = Math.max(tg.z + CAM_H, hAt(tr, this.x, this.y) + 7); this.hz = H0; this.look = 0; this.back = CAM_BACK; this.lift = 0;
  }

  addTrauma(v: number) { this.trauma = Math.min(1, this.trauma + v); }

  update(dt: number, tg: CamTarget, tr: Track) {
    this.t += dt;
    const yawTarget = tg.spinning ? this.a : tg.a;
    this.a = wrapA(this.a + wrapA(yawTarget - this.a) * smooth(7, dt));
    // drift look-ahead: look towards the exit of the corner
    this.look += ((tg.drift ? tg.drift * 0.12 : 0) - this.look) * smooth(3.5, dt);
    this.back += ((tg.air ? CAM_BACK * 1.2 : CAM_BACK) - this.back) * smooth(3, dt);
    this.lift += ((tg.air ? 4 : 0) - this.lift) * smooth(3, dt);
    this.f += ((tg.boost ? F * 0.92 : F) - this.f) * smooth(tg.boost ? 6 : 2.5, dt);
    const view = this.a + this.look + (tg.lookBack ? Math.PI : 0);
    const camA = tg.lookBack ? this.a + Math.PI : this.a;
    this.x = tg.x - Math.cos(camA) * this.back;
    this.y = tg.y - Math.sin(camA) * this.back;
    const tz = Math.max(tg.z + CAM_H + this.lift, hAt(tr, this.x, this.y) + 7);
    this.z += (tz - this.z) * smooth(8, dt);
    const ahead = hAt(tr, tg.x + Math.cos(view) * 60, tg.y + Math.sin(view) * 60), pitch = Math.max(-0.4, Math.min(0.4, (ahead - tg.z) / 60));
    this.hz += (H0 + pitch * F * 0.55 - this.hz) * smooth(4, dt);
    // shake: trauma² × smooth noise, decays every frame
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma * this.shakeScale;
    this.roll = sh * 0.05 * Math.sin(this.t * 37.1);
    return { x: this.x + sh * 1.6 * Math.sin(this.t * 51.3), y: this.y + sh * 1.6 * Math.sin(this.t * 43.7 + 1), z: this.z + sh * 1.2 * Math.sin(this.t * 47.9 + 2), a: view, hz: this.hz + sh * 6 * Math.sin(this.t * 41.3), f: this.f, roll: this.roll };
  }
}
