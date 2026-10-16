// Network race lifecycle: LAN + online (WebSocket to the authoritative server).
// Transport details stay in net/session.ts; this module wires a NetSession to a Game.
// Game delegates here so LAN/online changes don't touch the orchestrator.
import { SIM_DT } from '@jpkart/core';
import { newView } from '../app/types';
import type { Mode } from '../app/types';
import { assignSources, PlayerInput } from '../input/players';
import { NetSession, desktop } from './session';
import { localInput } from '../race/localRace';
import { updateSpectate } from '../race/spectate';
import type { Game } from '../game';

export function connectLan(
  g: Game,
  addr = g.lanAddr,
  name = g.lanName,
  online?: { room?: string; create?: boolean },
) {
  g.net?.close();
  g.netOnline = !!online;
  const net = new NetSession(
    online ? NetSession.onlineUrl(addr) : NetSession.urlFrom(addr),
    name || 'Jugador',
    (i, mirror) => g.tracks.ensureBuilt(i, [g.tr], mirror),
    () => startNetRace(g),
    () => { g.state = 'results'; },
    online,
  );
  g.net = net;
  net.connect();
  g.state = 'lobby';
}

export function leaveNet(g: Game) {
  if (g.lanHosting) { void desktop()?.stopHost(); g.lanHosting = null; }
  g.net?.close();
  g.net = null;
  g.world = null;
  g.renderer.clearKarts();
  g.state = 'menu';
}

export function startNetRace(g: Game) {
  const r = g.net!.race!;
  g.curTrack = r.cfg.trackIndex;
  g.single();
  g.tr = g.tracks.get(r.cfg.trackIndex, !!r.cfg.mirror);
  g.renderer.setTrack(g.tr);
  g.renderer.clearKarts();
  g.world = r.world;
  g.ghost = null; g.resultNotes = [];
  const karts = [r.kart, ...r.seats], srcs = assignSources(karts.length);
  g.views = karts.map((k, i) => ({
    ...newView(), localId: k,
    input: karts.length > 1 ? new PlayerInput(srcs[i]!, g.input) : null,
  }));
  g.v = g.views[0]!;
  g.prev = g.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
  g.mode = r.cfg.mode === 'race' || !r.cfg.mode ? 'free' : (r.cfg.mode as Mode);
  for (const v of g.views) { g.v = v; g.rig.cut(g.camTarget()!, g.tr); }
  g.v = g.views[0]!;
  g.specId = -1; g.specT = 0;
  g.acc = 0; g.banner = null; g.flashT = 0; g.parts = []; g.paused = false; g.incoming = null;
  g.state = 'race';
}

export function simulateNet(g: Game, dt: number) {
  const net = g.net!, r = net.race!;
  g.acc = Math.min(g.acc + dt, SIM_DT * 5);
  const t0 = performance.now();
  while (g.acc >= SIM_DT) {
    g.world = r.world;
    g.prev = r.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    const ins = g.views.map((v) => {
      g.v = v;
      const i = localInput(g);
      v.itemPressed = false;
      if (v.input) v.input.itemPressed = false;
      return i;
    });
    g.v = g.views[0]!;
    const { packed, seats, events } = r.tick(ins[0]!, ins.slice(1));
    net.send(seats.length ? { t: 'in', i: [packed], seats: seats.map((x) => [x]) } : { t: 'in', i: [packed] });
    for (const e of events) {
      g.v = g.viewFor(e); g.onEvent(e); g.v = g.views[0]!;
      g.fx.event(e, r.world);
      if (e.type === 'trick') g.trickAnim.set(e.kart, 0.001);
      if (e.type === 'land') { g.squash.set(e.kart, 1); g.trickAnim.delete(e.kart); }
    }
    g.tickAnims(SIM_DT);
    g.acc -= SIM_DT;
  }
  updateSpectate(g, dt);
  net.smooth(dt);
  g.simMs = performance.now() - t0;
}
