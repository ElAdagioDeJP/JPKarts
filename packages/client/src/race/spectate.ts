// Online spectator: once your kart crosses the line you keep watching the rest of the race.
// The camera hops by itself between the karts still racing (humans first), or by hand with ←/→.
// Pure client feedback: the sim keeps running on the server and nothing here touches the core state.
import { CHARS, type Kart } from '@jpkart/core';
import { H, W } from '../ui/draw';
import type { Game } from '../game';

/** Seconds on one kart before the camera moves on by itself. */
const HOLD = 5;

export const spectating = (g: Game) =>
  !!g.net && g.views.length === 1 && !!g.local?.finished && g.world?.phase === 'race';

/** Karts still racing, humans first, then by race order. */
function candidates(g: Game): Kart[] {
  const w = g.world!;
  const racing = w.ranked.map((id) => w.karts[id]!).filter((k) => !k.finished && !k.out);
  return [...racing.filter((k) => k.ctrl !== 'ai'), ...racing.filter((k) => k.ctrl === 'ai')];
}

/** The kart the camera follows while spectating, or undefined when you are still racing. */
export function spectated(g: Game): Kart | undefined {
  if (!spectating(g)) return undefined;
  return g.world!.karts[g.specId];
}

function watch(g: Game, id: number) {
  if (id === g.specId) return;
  g.specId = id; g.specT = 0;
  const tg = g.camTarget();
  if (tg) g.rig.cut(tg, g.tr);
}

export function updateSpectate(g: Game, dt: number) {
  if (!spectating(g)) { g.specId = -1; g.specT = 0; return; }
  const list = candidates(g), cur = g.world!.karts[g.specId];
  g.specT += dt;
  if (!list.length) { watch(g, g.local!.id); return; }
  if (!cur || cur.finished || cur.out || g.specT >= HOLD) {
    const i = list.findIndex((k) => k.id === g.specId);
    watch(g, list[(i + 1) % list.length]!.id);
  }
}

/** ←/→: previous / next kart (also restarts the auto timer). */
export function spectateStep(g: Game, dir: 1 | -1) {
  const list = candidates(g);
  if (!list.length) return;
  const i = list.findIndex((k) => k.id === g.specId);
  watch(g, list[(i + dir + list.length) % list.length]!.id);
  g.specT = 0;
}

/** Banner for the spectator + the stragglers' clock (visible to everybody once the first human finished). */
export function drawNetOverlay(g: Game) {
  const w = g.world!, ui = g.ui;
  if (w.cfg.lastCall && w.lastCall >= 0 && w.finishDelay <= 0) {
    const s = Math.ceil(w.lastCall), urgent = s <= 10;
    ui.txt('¡Termina la carrera!', W / 2, 50, '#ffe45e', 8, 'center');
    ui.txt(s + ' s', W / 2, 62, urgent ? '#ff4d6d' : '#fff7e0', 16, 'center');
  }
  const k = spectated(g);
  if (k && k.id !== g.local?.id) {
    ui.txt('Espectando: ' + CHARS[k.ch]!.short, W / 2, H - 34, '#9cff9c', 8, 'center');
    ui.txtS('← → cambiar de piloto', W / 2, H - 22);
  }
}
