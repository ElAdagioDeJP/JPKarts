// World rendering orchestration: camera, kart views, particles, weather.
// Three.js details stay in render/world3d.ts; this module decides *what* to draw.
// New visual layers (e.g. new weather) are added here.
import { CHARS, clamp, hAt, hasFx, lerp } from '@jpkart/core';
import type { Kart, World } from '@jpkart/core';
import { kartLabel } from '../feel/effectView';
import { THING_ART, balloonArt, orbitArt, type ThingCtx } from './thingArt';
import { RW, type KartView, type ThingView } from './world3d';
import { H, W } from '../ui/draw';
import { CAM_H, TEAM_COL, UIK, ZMAX, uiRect } from '../app/types';
import type { CamTarget } from '../feel/camera';
import { spectated } from '../race/spectate';
import type { Game } from '../game';

export function camTarget(g: Game): CamTarget | null {
  const p = spectated(g) ?? g.local;
  if (!p) return null;
  const ps = g.pose(p);
  return {
    x: ps.x, y: ps.y, z: ps.z, a: ps.a,
    drift: p.drift, boost: p.boost > 0, air: p.air,
    lookBack: g.input.held('mirarAtras'), spinning: p.spin > 0,
  };
}

export function updateCam(g: Game, dt: number, x: number, y: number, a: number, z: number) {
  const v = g.rig.update(dt, { x, y, z, a, drift: 0, boost: false, air: false, lookBack: false, spinning: false }, g.tr);
  Object.assign(g.cam, v);
}

export function renderWorld(g: Game, t: number, karts: Kart[]) {
  if (g.showcase) { g.renderer.render(g.showcase.cam, g.showcase.views, [], [], t, -1e4, 1 / 60); return; }
  const w = g.world, views: KartView[] = [], things: ThingView[] = [];
  for (const k of karts) {
    const ps = g.pose(k);
    const vis = !k.out && (k.respawn <= 0 || ((t * 10) | 0) % 2 === 1);
    views.push({
      id: k.id, ch: k.ch, x: ps.x, y: ps.y, z: k.respawn > 0 ? ps.z - 6 : ps.z, a: ps.a,
      lean: k.drift ? k.drift : k.sv, hop: k.hop, spin: k.spin,
      big: hasFx(k, 'jug'), bubble: hasFx(k, 'bubble'), reflect: hasFx(k, 'reflect'),
      visible: vis, ground: hAt(g.tr, ps.x, ps.y), air: k.air, glide: k.glide, speed: k.speed,
      trick: g.trickAnim.get(k.id) ?? 0, trickKind: g.trickKind.get(k.id), squash: g.squash.get(k.id) ?? 0,
      parts: w?.cfg.grid[k.id]?.parts, hit: g.hitAnim.get(k.id) ?? 0, look: k.id === g.localId && g.input.held('mirarAtras'), win: k.finished && !k.out && k.rank < 3,
      local: g.views.some((v) => v.localId === k.id),
    });
  }
  if (g.ghost && g.state === 'race') {
    const gh = g.ghost.world.karts[0]!, pg = g.ghostPrev, a = g.acc / (1 / 60);
    const gx = pg ? lerp(pg.x, gh.x, a) : gh.x, gy = pg ? lerp(pg.y, gh.y, a) : gh.y, gz = pg ? lerp(pg.z, gh.z, a) : gh.z;
    views.push({
      id: 100, ch: gh.ch, x: gx, y: gy, z: gz, a: gh.a, lean: gh.sv, hop: 0, spin: 0,
      big: false, bubble: false, reflect: false, visible: !g.ghost.done,
      ground: hAt(g.tr, gx, gy), air: gh.air, glide: false, speed: 0, trick: 0, squash: 0, local: false, ghost: true,
    });
  }
  if (w) {
    const me = g.local, tc: ThingCtx = { t, lap: me ? Math.floor(me.prog / g.tr.N) + 1 : 1, lava: g.tr.def.liquid?.kind === 'lava' };
    for (const e of w.ents) THING_ART[e.kind]?.(e, tc, things);
    for (const k of karts) if (k.respawn <= 0) {
      const ps = g.pose(k);
      orbitArt(k, ps.x, ps.y, ps.z, t, things);
      if (k.balloons > 0 && (g.views.length > 1 || k.id !== g.localId))
        balloonArt(k, k.team >= 0 ? TEAM_COL[k.team]! : CHARS[k.ch]!.helmet, ps.x, ps.y, ps.z, t, things);
    }
  }
  const boxes = w ? w.boxes.map((b) => b.active) : g.tr.boxes.map(() => true);
  const t0 = performance.now(), water = w?.water ?? g.tr.water?.base ?? 0, n = g.views.length;
  if (n > 1 && w && g.state === 'race') {
    const k = RW / W;
    g.renderer.renderSplit(
      g.views.map((v, i) => {
        const [x, y, ww, hh] = uiRect(i, n);
        return { cam: v.cam, rect: [x * k, y * k, ww * k, hh * k] as [number, number, number, number] };
      }),
      views, things, boxes, t, water, 1 / 60);
  } else g.renderer.render(g.cam, views, things, boxes, t, water, 1 / 60);
  g.renderMs = performance.now() - t0;
  if (w && (g.state === 'race' || g.state === 'replay') && n === 1) drawLabels(g, karts.filter((k) => !k.out));
}

export function drawLabels(g: Game, karts: Kart[]) {
  const ui = g.ui;
  for (const k of karts) {
    const ps = g.pose(k), top = g.renderer.project(ps.x, ps.y, ps.z + 15);
    if (!top) continue;
    const depth = 320 / top.k;
    if (depth > ZMAX) continue;
    const lx = Math.round(top.sx * UIK), ly = Math.round(top.sy * UIK);
    const me = k.id === g.localId;
    const lab = kartLabel(k, me);
    if (lab) ui.txtS(lab[0], lx, ly - (me ? 0 : 12), lab[1]);
    if (!me && depth < 260 && top.k * 12.5 * UIK >= 9)
      ui.txtS(CHARS[k.ch]!.short, lx, ly - 4, k.team >= 0 ? TEAM_COL[k.team]! : '#fff7e0');
  }
}

/** Screen-space speed lines at high speed (the rest of the particles are 3D, see feel/fx3d.ts). */
export function spawnSpeedLines(g: Game) {
  const p = g.local!;
  if (p.respawn > 0) return;
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  if (p.speed > 120 && Math.random() < (p.boost > 0 ? 0.9 : 0.4))
    g.parts.push({ x: r(0, W), y: r(H * 0.55, H), vx: 0, vy: 0, life: 0.08, c: 'rgba(255,255,255,0.35)', s: 1, line: true });
  if (p.slip > 0.3 && Math.random() < 0.5)
    g.parts.push({ x: r(W * 0.2, W * 0.8), y: r(H * 0.3, H * 0.8), vx: 0, vy: 0, life: 0.1, c: 'rgba(200,240,255,' + (0.2 + p.slip * 0.3).toFixed(2) + ')', s: 1, line: true });
}

export function drawParticles(g: Game, dt: number) {
  const ctx = g.ui.ctx;
  for (const p of g.parts) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.fillStyle = p.c;
    if (p.line) {
      const dx = (p.x - W / 2) * 0.12, dy = (p.y - H * 0.42) * 0.12;
      ctx.fillRect(p.x, p.y, Math.max(0.5, Math.abs(dx)), Math.max(0.5, Math.abs(dy)));
    } else ctx.fillRect(p.x, p.y, p.s, p.s);
  }
  g.parts = g.parts.filter((p) => p.life > 0);
}

/** Day → night over the race, fog from its lap on (visual only; grip is in core). */
export function updateAtmosphere(g: Game, w: World, dt: number) {
  const a = g.tr.authored, p = g.local;
  let night = 0, fog = 0;
  if (a?.dayNight) {
    let lead = 0;
    for (const k of w.karts) lead = Math.max(lead, k.prog);
    night = clamp((lead / (w.cfg.laps * g.tr.N) - 0.15) / 0.75, 0, 1);
  }
  const wt = a?.weather, on = !!(wt && p && Math.floor(p.prog / g.tr.N) + 1 >= wt.fromLap);
  if (on && wt!.kind === 'noche') night = 1;
  if (on && (wt!.kind === 'niebla' || wt!.kind === 'arena')) fog = wt!.kind === 'niebla' ? 1 : 0.6;
  g.fogK += (fog - g.fogK) * Math.min(1, dt * 0.8);
  g.renderer.setAtmosphere(night, g.fogK);
}

/** Rain streaks and sand haze over the screen when the track's weather is on for the local kart. */
export function drawWeather(g: Game, dt: number) {
  const wt = g.tr.authored?.weather, p = g.local, ctx = g.ui.ctx;
  if (!wt || !p || Math.floor(p.prog / g.tr.N) + 1 < wt.fromLap) { g.rain.length = 0; return; }
  if (wt.kind === 'lluvia') {
    while (g.rain.length < 70) g.rain.push({ x: Math.random() * W, y: Math.random() * H });
    ctx.strokeStyle = 'rgba(200,225,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of g.rain) {
      d.y += 420 * dt; d.x -= 60 * dt;
      if (d.y > H) { d.y = -8; d.x = Math.random() * (W + 40); }
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 8);
    }
    ctx.stroke();
  } else if (wt.kind === 'arena') {
    ctx.fillStyle = 'rgba(232,190,120,0.16)';
    ctx.fillRect(0, 0, W, H);
    while (g.rain.length < 40) g.rain.push({ x: Math.random() * W, y: Math.random() * H });
    ctx.fillStyle = 'rgba(255,230,170,0.5)';
    for (const d of g.rain) { d.x -= 300 * dt; d.y += 20 * dt; if (d.x < 0) { d.x = W; d.y = Math.random() * H; } ctx.fillRect(d.x, d.y, 6, 1); }
  }
}

export function attractCam(g: Game, dt: number, t: number) {
  const tr = g.tr;
  g.attract = (((g.attract + dt * 30) % tr.N) + tr.N) % tr.N;
  const i = Math.floor(g.attract) % tr.N, x = tr.x[i]!, y = tr.y[i]!;
  updateCam(g, dt, x, y, tr.ang[i]!, hAt(tr, x, y));
  void t;
  void CAM_H;
}
