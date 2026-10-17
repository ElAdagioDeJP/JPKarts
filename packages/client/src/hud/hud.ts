// HUD per local player (extracted from game.ts).
// One HUD per viewport; split-screen scales each into its rect.
// New HUD widgets go here, not in Game.
import { CHARS, T, clamp, fmtTime, fxOf, hasFx, itemDef, itemList, modeOf } from '@jpkart/core';
import { OUT } from '../art/pixel';
import { COIN, FACES, ICONS } from '../art/sprites';
import { hudLines } from '../feel/effectView';
import { DRIFT_COL as DCOL, DRIFT_COL_CB } from '../feel/fx3d';
import { TEAM_COL, uiRect } from '../app/types';
import { effectiveHudScale, isMobileDevice } from '../mobile';
import { W } from '../ui/draw';
import type { Game } from '../game';

export function drawSmudge(g: Game) {
  const p = g.local, ctx = g.ui.ctx;
  const sk = p ? fxOf(p, 'smoke') : undefined;
  if (sk) {
    ctx.globalAlpha = Math.min(0.75, sk.t * 1.5);
    for (const [x, y, r, c] of [
      [80, 120, 60, '#8a8898'], [200, 100, 70, '#b8b6c4'], [320, 140, 64, '#9a98a8'],
      [150, 190, 50, '#c4c2d0'], [270, 200, 56, '#8a8898'],
    ] as const) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}

/** One HUD per local player, scaled into its viewport. */
export function drawHUDs(g: Game, dt: number) {
  const n = g.views.length;
  if (n === 1) { drawHUD(g, dt); return; }
  const ctx = g.ui.ctx, sc = 0.5 * g.settings.hudScale;
  g.views.forEach((v, i) => {
    g.v = v;
    const [x, y, w, h] = uiRect(i, n);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.translate(x, y); ctx.scale(sc, sc);
    try { drawHUDScaled(g, dt, w / sc, h / sc); } finally { ctx.restore(); }
  });
  g.v = g.views[0]!;
  ctx.fillStyle = OUT;
  if (n === 2) ctx.fillRect(0, 240 / 2 - 1, W, 2);
  else { ctx.fillRect(W / 2 - 1, 0, 2, 240); ctx.fillRect(0, 240 / 2 - 1, W, 2); }
  if (n === 3) {
    ctx.fillStyle = 'rgba(27,23,64,0.9)';
    ctx.fillRect(W / 2 + 1, 240 / 2 + 1, W / 2, 240 / 2);
    g.ui.img(g.mini(g.tr).cv, W * 0.75 - 28, 240 * 0.75 - 28, 56, 56);
  }
}

export function drawHUD(g: Game, dt: number) {
  // M2: en móvil la escala efectiva nunca baja de 1.5× (legible a 30 cm).
  const sc = (() => { try { return effectiveHudScale(g.settings.hudScale); } catch { return g.settings.hudScale; } })();
  g.ui.ctx.save();
  g.ui.ctx.scale(sc, sc);
  try { drawHUDScaled(g, dt, W / sc, 240 / sc); } finally { g.ui.ctx.restore(); }
}

export function drawHUDScaled(g: Game, dt: number, Wv: number, Hv: number) {
  const ui = g.ui, ctx = ui.ctx, w = g.world!, p = g.local!, tr = g.tr;
  const laps = w.cfg.laps, lap = clamp(Math.floor(p.prog / tr.N) + 1, 1, laps);
  ui.panel(4, 4, 82, g.mode === 'cup' ? 32 : 26, 'rgba(27,23,64,0.75)', '#6d66b0');
  ui.txt(
    w.cfg.mode === 'battle' ? 'Globos: ' + p.balloons
    : w.cfg.mode === 'capture' ? 'Bandera: ' + p.score.toFixed(0) + '/' + T.race.capture.goal
    : 'Vuelta ' + lap + '/' + laps, 8, 8);
  if (w.cfg.mode === 'elimination') {
    const alive = w.karts.filter((k) => !k.out);
    ui.txtS('Quedan ' + alive.length, 8, 34, '#ff8a1f', 'left');
    if (!p.out && alive.length > 1 && w.ranked.filter((id) => !w.karts[id]!.out).at(-1) === p.id && ((w.raceT * 3) | 0) % 2 === 0)
      ui.txt('¡Vas último!', Wv / 2, Hv / 2 - 30, '#ff4d6d', 8, 'center');
  }
  if (g.ghost) {
    const gh = g.ghost.world.karts[0]!;
    ui.txtS('Fantasma ' + (gh.prog > p.prog ? '+' : '-') + Math.abs(((gh.prog - p.prog) * 6) / Math.max(60, p.speed)).toFixed(1) + ' s', 8, 34, '#bff0ff', 'left');
  }
  const A9 = modeOf(w).arena, limit = w.cfg.mode === 'capture' ? T.race.capture.time : T.race.battle.time;
  ui.txt(A9 ? fmtTime(Math.max(0, limit - w.raceT)) : fmtTime(w.raceT), 8, 19, A9 && limit - w.raceT < 30 ? '#ff4d6d' : '#ffe45e');
  if (g.mode === 'cup' && g.cup) ui.txtS('Carrera ' + (g.cup.race + 1) + '/' + g.cup.def.tracks.length, 8, 30, '#fff7e0', 'left');
  const pos = p.rank + 1;
  if (p.rank !== g.lastRank) { g.posPop = g.lastRank >= 0 ? 1 : 0; g.lastRank = p.rank; }
  g.posPop = Math.max(0, g.posPop - dt * 4);
  const pop = 1 + Math.sin(g.posPop * Math.PI) * 0.35;
  ctx.save(); ctx.translate(Wv - 8, 6); ctx.scale(pop, pop);
  ui.txt(pos + 'º', 0, 0, pos === 1 ? '#ffe45e' : pos <= 3 ? '#fff7e0' : '#c8c4f0', 24, 'right');
  ctx.restore();
  const bx = Wv / 2 - 15, by = 5;
  ui.panel(bx, by, 30, 30, '#1b1740', p.roll > 0 ? (((w.raceT * 10) | 0) % 2 ? '#ffe45e' : '#fff7e0') : '#fff7e0');
  const list = itemList();
  let icon = null;
  if (p.roll > 0) icon = ICONS[list[((w.raceT * 18) | 0) % list.length]!.id];
  else if (p.item) icon = ICONS[p.item];
  if (icon) ui.img(icon.cv, bx + 3, by + 3, 24, 24);
  if (p.item && p.roll <= 0 && p.itemN > 1) ui.txtS('×' + p.itemN, bx + 28, by + 22, '#ffe45e', 'left');
  if (w.ents.some((e) => e.kind === 'coin') || p.coins > 0) {
    g.coinPop = Math.max(0, g.coinPop - dt * 3);
    const cx = bx - 30, cy = by + 8, shake = g.coinPop > 0 ? Math.sin(g.coinPop * 40) * 2 : 0;
    ui.img(COIN[0]!.cv, cx + shake, cy, 10, 10);
    ui.txtS('×' + p.coins, cx + 12 + shake, cy + 2, p.coins >= T.race.coins.max ? '#ffe45e' : g.coinPop > 0 ? '#ff4d6d' : '#fff7e0', 'left');
  }
  if (p.item && p.roll <= 0) ui.txtS(itemDef(p.item).name, Wv / 2, by + 36);
  const st = hudLines(p);
  if (p.glide) st.push(['¡Volando!', '#8fe0ff']);
  st.forEach(([s, c], i) => ui.txtS(s, Wv / 2, by + 46 + i * 9, c));
  if (hasFx(p, 'inv') && ((w.raceT * 4) | 0) % 2 === 0) ui.txt('¡Controles invertidos!', Wv / 2, Hv / 2 - 40, '#ff6ad0', 8, 'center');
  const m = g.mini(tr), mob = (() => { try { return isMobileDevice(); } catch { return false; } })();
  // M2: minimapa un 20% más grande y abajo-centro en móvil (fuera de los pulgares).
  const ms = mob ? 72 : 60, mx = mob ? Wv / 2 - ms / 2 : Wv - 62, my = mob ? Hv - ms - 8 : Hv - 62;
  ui.panel(mx - 2, my - 2, ms, ms, 'rgba(27,23,64,0.55)', '#6d66b0');
  ui.img(m.cv, mx, my, ms, ms);
  for (const k of w.karts) {
    const x = mx + k.x * m.k, y = my + k.y * m.k, r = k.id === g.localId ? 3 : 2;
    ctx.fillStyle = OUT; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (k.id === g.localId) { ctx.fillStyle = '#fff7e0'; ctx.fillRect(x - 2, y - 2, 4, 4); }
    ctx.fillStyle = CHARS[k.ch]!.helmet; ctx.fillRect(x - 1, y - 1, 2, 2);
    if (k.rank === 0) { ctx.fillStyle = '#ffd23a'; ctx.fillRect(x - 2, y - r - 2, 1, 1); ctx.fillRect(x, y - r - 3, 1, 1); ctx.fillRect(x + 1, y - r - 2, 1, 1); }
  }
  w.ranked.forEach((id, i) => {
    const k = w.karts[id]!, y = 44 + i * 17;
    if (id === g.localId) { ctx.fillStyle = 'rgba(255,228,94,0.35)'; ctx.fillRect(4, y - 1, 34, 17); }
    ui.img(FACES[k.ch]!.cv, 5, y, 16, 16);
    if (w.cfg.mode === 'battle' && !k.out) ui.txtS('●'.repeat(k.balloons), 38, y + 5, CHARS[k.ch]!.helmet, 'left');
    if (w.cfg.mode === 'capture') ui.txtS(k.score.toFixed(0), 38, y + 5, '#ffd23a', 'left');
    ui.txtS(String(i + 1), 26, y + 5, k.out ? '#6d66b0' : id === g.localId ? '#ffe45e' : k.team >= 0 ? TEAM_COL[k.team]! : '#fff7e0', 'left');
  });
  if (p.drift) {
    const L3 = T.driving.drift.level3, c = (g.fx.colorblind ? DRIFT_COL_CB : DCOL)[p.dLvl]!, ww = Math.min(60, (p.dc / L3) * 60);
    ui.panel(Wv / 2 - 31, Hv - 14, 62, 6, '#1b1740'); ctx.fillStyle = c; ctx.fillRect(Wv / 2 - 30, Hv - 13, ww, 4);
  }
  if (g.incoming) {
    g.incoming.t -= dt;
    if (g.incoming.t <= 0) g.incoming = null;
    else if (((w.raceT * 8) | 0) % 2 === 0) {
      const ix = Wv / 2, iy = Hv - 46;
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.moveTo(ix - 14, iy + 14); ctx.lineTo(ix + 14, iy + 14); ctx.lineTo(ix, iy + 26); ctx.fill();
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.moveTo(ix - 11, iy + 15); ctx.lineTo(ix + 11, iy + 15); ctx.lineTo(ix, iy + 24); ctx.fill();
      const ic = ICONS[g.incoming.item];
      if (ic) ui.img(ic.cv, ix - 8, iy - 4, 16, 16);
      ui.txtS('¡Detrás!', ix, iy - 12, '#ff4d6d');
    }
  }
  if (p.backT > 0.8 && !p.finished && ((w.raceT * 3) | 0) % 2 === 0) ui.txt('¡Sentido contrario!', Wv / 2, Hv / 2 - 30, '#ff4d6d', 8, 'center');
  if (g.banner) {
    g.banner.life -= dt;
    ui.txt(g.banner.t, Wv / 2, g.banner.big ? Hv / 2 - 24 : 66, '#ffe45e', g.banner.big ? 24 : 16, 'center');
    if (g.banner.life <= 0) g.banner = null;
  }
  if (g.audio.muted) ui.txtS('Sin sonido', Wv / 2, Hv - 24);
}
