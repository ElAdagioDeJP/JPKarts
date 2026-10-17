// Podium in 3D (V3-6b): the first three karts of the final order stand on pedestals at the start line, drawn by the world renderer
// (rigged pilots, `victory` clip); the 2D layer only draws the pedestals (projected from world points), the names and the title.
import { DEFAULT_LOADOUT, hAt } from '@jpkart/core';
import type { CamView, KartView } from '../render/world3d';
import type { Game } from '../game';

export interface PodiumSpot { ch: number; place: number; cx: number; cy: number; gz: number; h: number; rx: number; ry: number }
const H = [10, 6.5, 3.5]; // pedestal height (world units) of 1st, 2nd and 3rd
const SIDE = [0, 17, -17]; // lateral offset of 1st, 2nd and 3rd (2nd stands on the left of the screen)
const AHEAD = 44;

/** The free camera + kart views for the podium, and where each pedestal stands (world coordinates). */
export function podiumScene(g: Game, order: number[], t: number): { cam: CamView; views: KartView[]; spots: PodiumSpot[] } {
  const tr = g.tr, i0 = 4, a0 = tr.ang[i0]!;
  const sx = tr.x[i0]!, sy = tr.y[i0]!, fx = Math.cos(a0), fy = Math.sin(a0), rx = Math.sin(a0), ry = -Math.cos(a0);
  const gz = hAt(tr, sx + fx * AHEAD, sy + fy * AHEAD);
  const cam: CamView = { ...g.cam, x: sx, y: sy, z: gz + 13, a: a0, roll: 0 };
  const views: KartView[] = [], spots: PodiumSpot[] = [];
  const grid = g.world?.cfg.grid;
  for (let p = 0; p < 3; p++) {
    const ch = order[p];
    if (ch == null) continue;
    const cx = sx + fx * AHEAD + rx * SIDE[p]!, cy = sy + fy * AHEAD + ry * SIDE[p]!;
    spots.push({ ch, place: p, cx, cy, gz, h: H[p]!, rx, ry });
    views.push({
      id: 200 + p, ch, x: cx, y: cy, z: gz + H[p]!, a: a0 + Math.PI + Math.sin(t * 1.4 + p * 2) * 0.35, lean: 0, hop: 0, spin: 0,
      big: false, bubble: false, reflect: false, visible: true, ground: gz + H[p]!, air: false, glide: false, speed: 0, trick: 0, squash: 0, local: false,
      parts: grid?.find((q) => q.ch === ch)?.parts ?? { ...DEFAULT_LOADOUT }, win: true,
    });
  }
  return { cam, views, spots };
}
