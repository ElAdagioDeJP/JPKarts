// Menu + select + results screens (extracted from game.ts).
// Each screen is a pure draw function of (Game, t); navigation lives in app/inputRouter.ts.
// New menus register here and in the frame dispatch, without touching race/net code.
import {
  ALL_TRACKS, CHARS, CLASSES, CLASS_NAMES, CUPS, DIFFS, POINTS, STAT_SHORT,
  classUnlocked, cupUnlocked, fmtTime, modeOf, clamp,
  type StatKey,
} from '@jpkart/core';
import { OUT } from '../art/pixel';
import { BALLS, BUG, FACES, rotFrames } from '../art/sprites';
import { assignSources } from '../input/players';
import { SOURCE_NAMES } from '../input/players';
import { HAZARD_TAG, TEAM_COL, TEAM_NAME, WEATHER_TAG, isArena } from '../app/types';
import { W } from '../ui/draw';
import type { Game } from '../game';

export function drawClassLine(g: Game, y: number) {
  const ui = g.ui, next = CLASSES.filter((c) => classUnlocked(g.progress, c, g.allUnlocked)).length > 1;
  const parts = ['Clase: ' + CLASS_NAMES[g.cls] + (next ? ' (X)' : '')];
  if (g.mode === 'free' || g.mode === 'cup') parts.push('Equipos: ' + (g.teams ? 'sí' : 'no') + ' (E)');
  ui.txtS(parts.join('    '), W / 2, y, '#8fe0ff');
}

export function drawTitle(g: Game, t: number) {
  const ui = g.ui, ctx = ui.ctx;
  ui.bg(0.25);
  ctx.font = '40px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const y = 40 + Math.round(Math.sin(t * 2) * 2);
  for (let i = 6; i > 0; i--) { ctx.fillStyle = i > 3 ? OUT : '#e8455a'; ctx.fillText('JP KART', W / 2 + i, y + i); }
  ctx.fillStyle = '#ffe45e'; ctx.fillText('JP KART', W / 2, y);
  ctx.fillStyle = '#fff7b0'; ctx.fillText('JP KART', W / 2, y - 1);
  ctx.fillStyle = '#ffe45e'; ctx.fillText('JP KART', W / 2, y + 1);
  ctx.fillStyle = '#ff8a1f'; ctx.fillRect(W / 2 - 128, y + 46, 256, 2);
  ui.txt('Gran Premio Pixel', W / 2, y + 56, '#fff7e0', 8, 'center');
  const b = Math.round(Math.abs(Math.sin(t * 3)) * 14);
  ui.img(BUG.cv, W / 2 + 104, y - 14 - b, 20, 20);
  CHARS.forEach((_, i) => {
    const x = W / 2 - 140 + i * 35, bb = Math.round(Math.sin(t * 5 + i) * 2);
    ui.img(FACES[i]!.cv, x, 146 + bb, 32, 32);
  });
  if (((t * 2) | 0) % 2 === 0) ui.txt('Pulsa Enter para jugar', W / 2, 202, '#fff7e0', 8, 'center');
}

export function drawMenu(g: Game, t: number) {
  const ui = g.ui;
  ui.bg(0.6);
  ui.txt('JP KART', W / 2, 10, '#ffe45e', 24, 'center');
  const items = ['Torneo', 'Carrera libre', 'Contrarreloj', 'Eliminación', 'Batalla', 'Online', 'Multijugador LAN', 'Dificultad: ' + DIFFS[g.diff]!.name, 'Opciones'];
  const help = [
    '4 copas de 4 carreras. Se suman los puntos.', 'Elige cualquiera de las pistas, nuevas o clásicas.',
    'Tú solo contra el reloj y tu fantasma.', 'El último de cada vuelta queda fuera.',
    'Globos o captura de la bandera en 4 arenas.', 'Crea una sala en internet y comparte su código.',
    'Juega con amigos en la misma red.', 'Qué tan rápidos y listos son los rivales.', 'Sonido, accesibilidad, gráficos y controles.'];
  items.forEach((s, i) => {
    const on = i === g.menuSel, y = 40 + i * 17;
    ui.panel(W / 2 - 90, y, 180, 15, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    if (on) ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 84, y + 1, 13, 13);
    ui.txt(i === 7 ? (on ? '< ' : '') + s + (on ? ' >' : '') : s, W / 2, y + 3, on ? '#ffe45e' : '#fff7e0', 8, 'center');
  });
  ui.txtS(help[g.menuSel]!, W / 2, 200);
  ui.txtS('Flechas para moverte, Enter para elegir', W / 2, 214, '#9c95d6');
}

export function statBar10(g: Game, key: StatKey, v: number, x: number, y: number) {
  const ui = g.ui, ctx = ui.ctx;
  ui.txtS(STAT_SHORT[key], x, y, '#fff7e0', 'left');
  for (let i = 0; i < 10; i++) {
    const f = clamp(v - i, 0, 1);
    ctx.fillStyle = OUT; ctx.fillRect(x + 40 + i * 6, y - 1, 5, 7);
    ctx.fillStyle = '#3a3478'; ctx.fillRect(x + 41 + i * 6, y, 3, 5);
    if (f > 0) { ctx.fillStyle = i < 4 ? '#2ec46b' : i < 7 ? '#ffe45e' : '#ff8a1f'; ctx.fillRect(x + 41 + i * 6, y, Math.max(1, Math.round(3 * f)), 5); }
  }
  ui.txtS(String(v), x + 104, y, '#fff7e0', 'left');
}

export function drawSelect(g: Game, t: number) {
  const ui = g.ui, ox = (W - 320) / 2;
  ui.bg();
  ui.txt('Elige piloto', W / 2, 6, '#ffe45e', 16, 'center');
  if (g.mode !== 'timetrial') {
    const n = g.players, srcs = assignSources(n);
    ui.txtS('Jugadores: ' + n + ' (J)', ox + 318, 8, n > 1 ? '#8fe0ff' : '#9c95d6', 'right');
    if (n > 1) ui.txtS(srcs.map((src, i) => 'J' + (i + 1) + ' ' + (i ? CHARS[(g.sel + i) % CHARS.length]!.short : CHARS[g.sel]!.short) + ': ' + SOURCE_NAMES(src)).join('   '), W / 2, 230, '#8fe0ff');
  }
  CHARS.forEach((c, i) => {
    const col = i % 4, row = i >> 2, x = ox + 18 + col * 74, y = 28 + row * 56, on = i === g.sel;
    ui.panel(x, y, 62, 48, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    const b = on ? Math.round(Math.sin(t * 8) * 1.5) : 0;
    ui.img(FACES[i]!.cv, x + 15, y + 2 + b, 32, 32);
    ui.txtS(c.short, x + 31, y + 37, on ? '#ffe45e' : '#fff7e0');
  });
  const c = CHARS[g.sel]!;
  ui.panel(ox + 10, 144, 300, 90, '#1b1740');
  ui.img(rotFrames(g.sel)[((t * 10) | 0) % rotFrames(g.sel).length]!.cv, ox + 262, 142, 42, 42);
  ui.txt(c.name, ox + 18, 150, '#ffe45e');
  ui.txtS(c.desc, ox + 18, 162, '#fff7e0', 'left');
  (['vel', 'ace', 'man', 'pes', 'vue'] as StatKey[]).forEach((k, i) => statBar10(g, k, c.st[k], ox + 18 + (i % 2) * 124, 176 + ((i / 2) | 0) * 13));
  ui.txtS(g.mode === 'cup' ? 'Torneo' : 'Carrera libre', ox + 282, 196, '#9c95d6');
  ui.txtS(DIFFS[g.diff]!.name, ox + 282, 206, '#9c95d6');
  ui.txtS('Clase: ' + c.weightClass, ox + 282, 186, '#9c95d6');
  ui.txtS('Enter', ox + 282, 218, '#9c95d6');
}

export function drawCupSel(g: Game, t: number) {
  const ui = g.ui, ox = (W - 320) / 2;
  ui.bg();
  ui.txt('Elige copa', W / 2, 8, '#ffe45e', 16, 'center');
  CUPS.forEach((c, i) => {
    const x = ox + 12 + (i % 2) * 152, y = 28 + ((i / 2) | 0) * 90, on = i === g.cupSel, open = cupUnlocked(g.progress, i, g.allUnlocked);
    ui.panel(x, y, 144, 84, on ? '#3a3478' : '#241f55', on ? c.col : '#6d66b0');
    const best = g.progress.cups[c.id + ':' + g.cls];
    if (best && best <= 3) ui.txtS(['', 'Oro', 'Plata', 'Bronce'][best]!, x + 136, y + 8, ['', '#ffd23a', '#c8ccdc', '#d9894a'][best]!, 'right');
    if (!open) { ui.txt('Bloqueada', x + 72, y + 40, '#9c95d6', 8, 'center'); ui.txtS('Podio en la anterior', x + 72, y + 56, '#6d66b0'); return; }
    ui.trophy(x + 18, y + 10 + (on ? Math.round(Math.sin(t * 6)) : 0), c.col);
    ui.txt(c.name.replace('Copa ', ''), x + 38, y + 8, on ? c.col : '#fff7e0');
    c.tracks.forEach((ti, j) => { const d = g.tracks.get(ti).def; ui.txtS(d.name + (d.flight ? ' *' : ''), x + 38, y + 26 + j * 13, '#fff7e0', 'left'); });
  });
  drawClassLine(g, 212);
  ui.txtS('Puntos: 15 12 10 8 6 4 2 1', W / 2, 224, '#9c95d6');
}

export function drawTrackSel(g: Game) {
  const ui = g.ui, ctx = ui.ctx, ox = (W - 320) / 2;
  ui.bg();
  ui.txt(isArena(g.mode) ? (g.mode === 'battle' ? 'Batalla: Globos' : 'Batalla: Captura') : 'Elige circuito', W / 2, 6, '#ffe45e', 16, 'center');
  g.trackCups.forEach((c, r) => ui.txtS(c.name.replace('Copa ', '').replace('Clásica ', ''), ox + 38, 28 + r * 44 + 16, c.col));
  g.grid.forEach((ti, i) => {
    const trk = g.tracks.get(ti);
    const r = i >> 2, x = ox + 66 + (i % 4) * 62, y = 26 + r * 44, on = i === g.trackSel;
    ui.panel(x, y, 56, 38, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : g.trackCups[r]!.col);
    ctx.fillStyle = trk.th.ground[0]; ctx.fillRect(x + 14, y + 5, 28, 28);
    ui.img(g.mini(trk).cv, x + 14, y + 5, 28, 28);
    if (trk.def.flight) ui.txtS('*', x + 50, y + 2, '#8fe0ff');
  });
  const d = g.tracks.get(g.grid[g.trackSel]!).def;
  ui.txt(d.name, W / 2, 182, '#ffe45e', 8, 'center');
  const au = g.tracks.get(g.grid[g.trackSel]!).authored;
  const tags = au?.cup === 'arena' ? [au.sections[0]?.intent ?? 'Arena'] : au
    ? [...new Set(au.hazards.map((h) => HAZARD_TAG[h.kind]).filter(Boolean)), au.weather ? WEATHER_TAG[au.weather.kind] : null, au.dayNight ? 'Del día a la noche' : null, au.narrow ? 'La nieve estrecha la pista' : null, au.water?.kind === 'lava' ? 'Lava' : null].filter(Boolean)
    : [d.flight ? 'Rampas de vuelo' : null, d.th.ice ? 'Hielo' : null, d.liquid ? d.liquid.msg.replace(/[¡!]/g, '').replace('Al ', 'Cuidado: ').replace('A la ', 'Cuidado: ') : null, d.ramps.length ? 'Saltos' : null].filter(Boolean);
  ui.txtS(tags.join('  /  ') || 'Clásica', W / 2, 214, '#fff7e0');
  const rec = g.progress.records[ALL_TRACKS[g.grid[g.trackSel]!]!.id + ':' + g.cls];
  if (rec?.race != null) ui.txtS('Récord: ' + fmtTime(rec.race) + (rec.lap != null ? '   Vuelta: ' + fmtTime(rec.lap) : ''), W / 2, 194, '#ffe45e');
  drawClassLine(g, 204);
  ui.txtS(isArena(g.mode) ? 'Enter: luchar  ·  C: ' + (g.mode === 'battle' ? 'Captura' : 'Globos') + '  ·  Esc: volver' : 'Enter: correr  ·  C: ' + (g.classic ? 'pistas nuevas' : 'pistas clásicas') + '  ·  Esc: volver', W / 2, 228, '#9c95d6');
}

export function rowList(g: Game, list: number[], extra: (ch: number, i: number, y: number) => void) {
  const ui = g.ui, ox = (W - 320) / 2;
  list.forEach((ch, i) => {
    const y = 44 + i * 19, me = ch === g.sel;
    ui.panel(ox + 28, y, 264, 15, me ? '#3a3478' : '#241f55', me ? '#ffe45e' : '#6d66b0');
    ui.txt(i + 1 + 'º', ox + 34, y + 4, me ? '#ffe45e' : '#fff7e0');
    ui.img(FACES[ch]!.cv, ox + 60, y - 1, 16, 16);
    ui.txt(CHARS[ch]!.name, ox + 80, y + 4, me ? '#ffe45e' : '#fff7e0');
    extra(ch, i, y);
  });
}

export function drawResults(g: Game) {
  const ui = g.ui, w = g.world!, ox = (W - 320) / 2;
  if (g.net?.lastEnd && w.finalOrder.length === 0) w.finalOrder = g.net.lastEnd.order;
  ui.bg(0.8);
  ui.txt(g.tr.def.name, W / 2, 8, '#ffe45e', 8, 'center');
  ui.txt('Resultados', W / 2, 20, '#fff7e0', 16, 'center');
  rowList(g, w.finalOrder.map((id) => w.karts[id]!.ch), (_ch, i, y) => {
    const k = w.karts[w.finalOrder[i]!]!;
    const col = w.cfg.mode === 'battle' ? (k.out ? 'Fuera' : k.balloons + ' globo' + (k.balloons === 1 ? '' : 's')) : w.cfg.mode === 'capture' ? k.score.toFixed(1) + ' s' : k.out ? 'Eliminado' : k.finished ? fmtTime(k.time) : w.cfg.lastCall ? 'Sin meta' : 'En pista';
    ui.txt(col, ox + 320 - (g.mode === 'cup' ? 70 : 36), y + 4, '#fff7e0', 8, 'right');
    if (g.mode === 'cup') ui.txt('+' + (modeOf(w).scoring?.(w, w.finalOrder).get(w.finalOrder[i]!) ?? 0), ox + 284, y + 4, '#2ec46b', 8, 'right');
  });
  const p = g.local!;
  if (p.best != null) ui.txtS('Tu mejor vuelta: ' + fmtTime(p.best), W / 2, 186);
  if (w.cfg.teams) {
    const tot = [0, 0];
    w.finalOrder.forEach((id, i) => { const k = w.karts[id]!; if (k.team >= 0) tot[k.team]! += POINTS[i] ?? 0; });
    ui.txtS('Equipo ' + TEAM_NAME[0] + ' ' + tot[0] + '  ·  Equipo ' + TEAM_NAME[1] + ' ' + tot[1] + (tot[0] === tot[1] ? '  ·  Empate' : '  ·  Gana el ' + TEAM_NAME[tot[0]! > tot[1]! ? 0 : 1]), W / 2, 196, tot[0] === tot[1] ? '#fff7e0' : TEAM_COL[tot[0]! > tot[1]! ? 0 : 1]!);
  }
  g.resultNotes.forEach((n, i) => ui.txtS(n, W / 2, 206 - (g.resultNotes.length - 1 - i) * 9, '#ffe45e'));
  ui.txtS(g.net
    ? (g.net.nextIn > 0 ? (g.net.settings.mode === 'cup' && g.net.cupRace < CUPS[g.net.settings.cup]!.tracks.length - 1 ? 'Siguiente carrera en ' : 'Volviendo a la sala en ') + g.net.nextIn + ' s' : 'Esperando...') + (g.net.isHost ? '    Intro: saltar' : '') + '    Esc: salir'
    : g.mode === 'cup' ? 'Enter: ver clasificación    R: repetición'
    : g.mode === 'timetrial' ? 'Enter: otra vez    R: repetición    Esc: menú'
    : 'Enter: ver podio    R: repetición    Esc: menú', W / 2, 220, '#9c95d6');
}

export function standingsList(g: Game) {
  const c = g.cup!;
  return CHARS.map((_, i) => i).sort((a, b) => c.pts[b]! - c.pts[a]!);
}

export function drawStandings(g: Game) {
  const ui = g.ui, c = g.cup!, ox = (W - 320) / 2;
  ui.bg(0.85);
  ui.txt(c.def.name, W / 2, 8, c.def.col, 8, 'center');
  ui.txt('Clasificación', W / 2, 20, '#fff7e0', 16, 'center');
  rowList(g, standingsList(g), (ch, _i, y) => {
    ui.txt('+' + (c.gain[ch] || 0), ox + 230, y + 4, '#2ec46b', 8, 'right');
    ui.txt(String(c.pts[ch]), ox + 284, y + 4, '#ffe45e', 8, 'right');
  });
  const last = c.race >= c.def.tracks.length - 1;
  ui.txtS('Carrera ' + (c.race + 1) + ' de ' + c.def.tracks.length, W / 2, 202);
  ui.txtS(last ? 'Enter: ver podio' : 'Enter: siguiente carrera, ' + g.tracks.get(c.def.tracks[c.race + 1]!).def.name, W / 2, 218, '#9c95d6');
}

export function drawPodium(g: Game, list: number[], title: string, col: string, sub: ((ch: number) => string) | null, t: number) {
  const ui = g.ui, ctx = ui.ctx;
  ui.bg(0.8);
  ui.txt(title, W / 2, 8, col, 16, 'center');
  const ped: [number, number, number][] = [[1, W / 2 - 86, 26], [0, W / 2, 42], [2, W / 2 + 86, 14]], base = 164;
  for (const [i, x, h] of ped) {
    const ch = list[i];
    if (ch == null) continue;
    ctx.fillStyle = OUT; ctx.fillRect(x - 32, base - h - 1, 64, h + 1);
    ctx.fillStyle = i === 0 ? '#ffe45e' : i === 1 ? '#c8ccdc' : '#d9894a'; ctx.fillRect(x - 31, base - h, 62, h);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x - 31, base - h, 62, 3);
    ui.txt(String(i + 1), x, base - h + 6, OUT, 8, 'center', '#fff7e0');
    ui.img(rotFrames(ch)[((t * 12 + i * 8) | 0) % rotFrames(ch).length]!.cv, x - 21, base - h - 38, 42, 42);
    ui.img(FACES[ch]!.cv, x - 8, base - h - 56 + Math.round(Math.sin(t * 5 + i) * 2), 16, 16);
    ui.txtS(CHARS[ch]!.short, x, base + 5, '#fff7e0');
    if (sub) ui.txtS(sub(ch), x, base + 14, '#ffe45e');
  }
  for (let i = 0; i < 18; i++) {
    const x = (i * 53 + t * 40) % W, y = (i * 37 + t * 60) % 150;
    ctx.fillStyle = ['#ffe45e', '#e8455a', '#2ec46b', '#3df0ff'][i % 4]!;
    ctx.fillRect(x, y, 2, 3);
  }
}

export function drawPodiumFree(g: Game, t: number) {
  const w = g.world!, ui = g.ui;
  const L = w.finalOrder.map((id) => w.karts[id]!.ch);
  drawPodium(g, L, 'Podio', g.tr.th.curbB || '#ffe45e', (ch) => {
    const k = w.karts.find((q) => q.ch === ch)!;
    return w.cfg.mode === 'battle' ? k.balloons + ' globos' : w.cfg.mode === 'capture' ? k.score.toFixed(0) + ' s' : k.finished && !k.out ? fmtTime(k.time) : '';
  }, t);
  const pos = w.finalOrder.indexOf(g.localId) + 1;
  ui.txt(pos === 1 ? '¡Ganaste!' : pos <= 3 ? '¡Al podio!' : 'Quedaste ' + pos + 'º', W / 2, 196, '#ff8a1f', 8, 'center');
  ui.txtS('Enter: otra carrera    R: repetición    Esc: menú', W / 2, 216, '#9c95d6');
}

export function drawFinal(g: Game, t: number) {
  const c = g.cup!, ui = g.ui, st = standingsList(g);
  drawPodium(g, st, c.def.name, c.def.col, (ch) => c.pts[ch] + ' pts', t);
  const pos = st.indexOf(g.sel) + 1, name = CHARS[g.sel]!.name;
  ui.txt(pos === 1 ? '¡' + name + ' gana la copa!' : pos <= 3 ? '¡Al podio, ' + name + '!' : 'Quedaste ' + pos + 'º. ¡A por la revancha!', W / 2, 192, '#ff8a1f', 8, 'center');
  ui.txtS('Dificultad: ' + DIFFS[g.diff]!.name + '  ·  ' + CLASS_NAMES[g.cls], W / 2, 204);
  if (g.resultNotes.length) ui.txtS(g.resultNotes.join('  ·  '), W / 2, 212, '#ffe45e');
  ui.txtS('Enter para volver al menú', W / 2, 220, '#9c95d6');
}
