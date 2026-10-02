// How each core entity looks (docs/ART_BIBLE.md §4). Data only: a new entity kind in core gets drawn by adding
// one entry here. Each entry appends billboards (`flat: false`) or ground decals (`flat: true`) to `out`.
import type { Ent, Kart } from '@jpkart/core';
import type { Spr } from '../art/pixel';
import {
  BIGBALL, BLADE, BOOM, BOOMER, CAR, COIN, D, FAKEBOX, GATE, GEYSER, ICE, ICONS, LASER, LAVA_GEYSER, METEOR, MINE, MUSHROOM, OLA, ROCK_BALL, SHOT, SMOKE,
  SNOWBALL, TARS, TRAIN, WARN_RING,
} from '../art/sprites';

/** One drawable: legacy world coordinates (x, y ground plane, z up), size in world units. */
export interface ThingView { spr: Spr; flat: boolean; x: number; y: number; z: number; w: number; h: number; yaw?: number }
export interface ThingCtx {
  t: number;
  /** lap of the local kart (gates are drawn closed on the laps they close) */
  lap: number;
  lava: boolean;
}
type Art = (e: Ent, c: ThingCtx, out: ThingView[]) => void;

const bb = (out: ThingView[], spr: Spr, x: number, y: number, z: number, w: number, h: number) => { out.push({ spr, flat: false, x, y, z, w, h }); };
const decal = (out: ThingView[], spr: Spr, x: number, y: number, z: number, w: number, h: number, yaw = 0) => { out.push({ spr, flat: true, x, y, z: z + 0.4, w, h, yaw }); };
const frame = <T>(list: T[], t: number, fps: number, seed = 0) => list[(((t * fps) | 0) + seed) % list.length]!;

/** Eruptions: a pulsing warning ring on the ground first, then the active effect. */
const eruption = (active: Art): Art => (e, c, out) => {
  if (e.t < e.cdn) {
    const pulse = 1 + Math.sin(c.t * 14) * 0.08;
    decal(out, WARN_RING, e.x, e.y, e.z, e.r * 2 * pulse, e.r * 2 * pulse);
    if (e.kind === 'meteoro') bb(out, METEOR, e.x, e.y, e.z + (1 - e.t / e.cdn) * 170, 14, 18);
    return;
  }
  active(e, c, out);
};

export const THING_ART: Record<string, Art> = {
  // items
  fakebox: (e, c, o) => bb(o, FAKEBOX, e.x, e.y, e.z + 3 + Math.sin(c.t * 4) * 1.5, 11, 11),
  tar: (e, _c, o) => decal(o, TARS, e.x, e.y, e.z, 54, 54 * 0.3),
  shot: (e, _c, o) => bb(o, SHOT, e.x, e.y, e.z - 3, 6, 6),
  rocket: (e, _c, o) => bb(o, ICONS.dron!, e.x, e.y, e.z - 5, 11, 11),
  hole: (e, _c, o) => { const s = Math.sin(Math.min(1, e.t) * Math.PI) * 80; bb(o, ICONS.agujero!, e.x, e.y, e.z - 30 + s * 0.25, s, s); },
  mine: (e, c, o) => bb(o, MINE[e.age > 1 && ((c.t * 6) | 0) % 2 ? 1 : 0]!, e.x, e.y, e.z, 10, 7),
  boomer: (e, c, o) => bb(o, frame(BOOMER, c.t, 16), e.x, e.y, e.z - 2, 10, 10),
  ice: (e, _c, o) => decal(o, ICE, e.x, e.y, e.z, e.r * 2, e.r * 0.75),
  smoke: (e, c, o) => bb(o, SMOKE, e.x, e.y, e.z - 4 + Math.sin(c.t * 2) * 1.5, e.r * 1.9, e.r * 1.55),
  coin: (e, c, o) => { if (!(e.target === 1 && e.t > 0)) bb(o, frame(COIN, c.t, 8, e.id), e.x, e.y, e.z - 2, 7, 7); },
  // track hazards
  ola: (e, _c, o) => bb(o, OLA, e.x, e.y, e.z - 1, 44, 18),
  tren: (e, _c, o) => bb(o, TRAIN, e.x, e.y, e.z - 1, 58, 27),
  vaca: (e, _c, o) => bb(o, D.cow!, e.x, e.y, e.z - 1, 22, 16),
  auto: (e, _c, o) => bb(o, CAR, e.x, e.y, e.z - 1, 28, 15),
  pinguino: (e, _c, o) => bb(o, D.penguin!, e.x, e.y, e.z - 1, 12, 16),
  aspa: (e, _c, o) => {
    // the arm sweeps around its hub; e.x/e.y is the middle of the arm
    const a = (e.t / e.life) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cx = e.x - ca * e.r * 0.5, cy = e.y - sa * e.r * 0.5;
    for (let n = 1; n <= 6; n++) bb(o, BLADE, cx + (ca * e.r * n) / 6, cy + (sa * e.r * n) / 6, e.z, 8, 11);
    bb(o, D.windmill!, cx, cy, e.z - 2, 18, 29);
  },
  geiser: eruption((e, c, o) => bb(o, c.lava ? LAVA_GEYSER : GEYSER, e.x, e.y, e.z - 2, e.r * 1.2, 46)),
  laser: eruption((e, _c, o) => { bb(o, LASER, e.x, e.y, e.z - 2, 6, 64); decal(o, WARN_RING, e.x, e.y, e.z, e.r * 2, e.r * 2); }),
  meteoro: eruption((e, _c, o) => bb(o, BOOM, e.x, e.y, e.z - 4, e.r * 2, e.r * 2)),
  roca: (e, _c, o) => bb(o, ROCK_BALL, e.x, e.y, e.z - 1, 16, 16),
  pelota: (e, _c, o) => bb(o, BIGBALL, e.x, e.y, e.z - 1, 14, 14),
  bolanieve: (e, _c, o) => bb(o, SNOWBALL, e.x, e.y, e.z - 1, 18, 18),
  seta: (e, _c, o) => bb(o, MUSHROOM, e.x, e.y, e.z - 1, 26, 22),
  compuerta: (e, c, o) => { if ((e.target >> c.lap) & 1) bb(o, GATE, e.x, e.y, e.z - 1, e.vy - e.vx, 16); },
};

/** Triple Ciego: the shots left orbit the kart. */
export function orbitArt(k: Kart, x: number, y: number, z: number, t: number, out: ThingView[]) {
  if (k.item !== 'ciego3') return;
  for (let i = 0; i < k.itemN; i++) {
    const a = t * 5 + (i * Math.PI * 2) / 3;
    bb(out, SHOT, x + Math.cos(a) * 10, y + Math.sin(a) * 10, z + 2, 5, 5);
  }
}
