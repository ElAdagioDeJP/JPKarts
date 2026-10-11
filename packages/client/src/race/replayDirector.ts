// End-of-race highlight replay director (#62).
// Cuts to hits, top-3 overtakes and big mini-turbos; otherwise follows the leader.
import { CHARS, ReplayPlayer, SIM_DT } from '@jpkart/core';
import { W, H } from '../ui/draw';
import type { Game } from '../game';

export function startReplayView(g: Game) {
  if (!g.lastReplay || !g.world) return;
  const player = new ReplayPlayer(g.lastReplay, g.tr);
  while (player.world.phase === 'countdown' && !player.done) player.step();
  const views = g.views;
  g.views = [views[0]!]; g.v = views[0]!;
  g.replayView = {
    player, world: g.world, localId: g.localId, back: g.state,
    focus: g.localId, hold: 3,
    ranks: player.world.karts.map((k) => k.rank), views,
  };
  g.world = player.world;
  g.prev = g.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
  g.renderer.clearKarts();
  g.state = 'replay';
  g.rig.cut(g.camTarget()!, g.tr);
}

export function endReplayView(g: Game) {
  const r = g.replayView;
  if (!r) return;
  g.views = r.views; g.v = r.views[0]!;
  g.world = r.world; g.localId = r.localId; g.state = r.back; g.replayView = null;
  g.renderer.clearKarts();
}

export function simulateReplay(g: Game, dt: number) {
  const r = g.replayView!, w = r.player.world;
  g.acc = Math.min(g.acc + dt, SIM_DT * 5);
  while (g.acc >= SIM_DT) {
    g.prev = w.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    let best = -1, score = 0;
    for (const e of r.player.step()) {
      g.fx.event(e, w);
      const s = e.type === 'hit' ? 3 : e.type === 'explode' ? 2 : (e.type === 'miniTurbo' && e.level === 3) || e.type === 'trick' ? 1 : 0;
      if (s > score && 'kart' in e) { score = s; best = (e as { kart: number }).kart; }
    }
    for (const k of w.karts) {
      if (k.rank < 3 && r.ranks[k.id]! > k.rank && score < 2) { score = 2; best = k.id; }
      r.ranks[k.id] = k.rank;
    }
    r.hold -= SIM_DT;
    if (r.hold <= 0 && best >= 0 && best !== r.focus) {
      r.focus = best; r.hold = 3; g.localId = best; g.rig.cut(g.camTarget()!, g.tr);
    } else if (r.hold <= -2) {
      const lead = w.ranked[0]!;
      if (lead !== r.focus) { r.focus = lead; g.localId = lead; g.rig.cut(g.camTarget()!, g.tr); }
      r.hold = 3;
    }
    g.localId = r.focus;
    g.acc -= SIM_DT;
    g.tickAnims(SIM_DT);
    if (r.player.done) { endReplayView(g); return; }
  }
}

export function drawReplayHud(g: Game, t: number) {
  const ui = g.ui, r = g.replayView;
  if (!r) return;
  if (((t * 2) | 0) % 2 === 0) ui.txt('● Repetición', 8, 8, '#ff4d6d', 8, 'left');
  const k = g.local;
  if (k) ui.txtS(CHARS[k.ch]!.name + '  ·  ' + (k.rank + 1) + 'º', W / 2, H - 22, '#fff7e0');
  ui.txtS('Enter: salir de la repetición', W / 2, H - 10, '#9c95d6');
}
