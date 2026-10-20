// Network race lifecycle: LAN + online (WebSocket to the authoritative server).
// Transport details stay in net/session.ts; this module wires a NetSession to a Game.
// Game delegates here so LAN/online changes don't touch the orchestrator.
import { CUPS, SIM_DT, T, isLastCupRace } from '@jpkart/core';
import { newView } from '../app/types';
import type { Mode } from '../app/types';
import { assignSources, PlayerInput } from '../input/players';
import { NetSession, desktop } from './session';
import { localInput } from '../race/localRace';
import { updateSpectate } from '../race/spectate';
import type { Game } from '../game';

/** A session wired to the game: when the server starts a race the game switches to it, when it ends the results show. */
function makeSession(g: Game, url: string, name: string, opts?: { room?: string; create?: boolean; pid?: string }) {
  return new NetSession(
    url,
    name || 'Jugador',
    (i, mirror) => g.tracks.ensureBuilt(i, [g.tr], mirror),
    () => startNetRace(g),
    () => { g.state = 'results'; },
    opts,
  );
}

export function connectLan(
  g: Game,
  addr = g.lanAddr,
  name = g.lanName,
  online?: { room?: string; create?: boolean },
) {
  g.net?.close();
  g.netOnline = !!online;
  g.recon = null;
  // the profile id lets the server give our kart back if the connection drops mid-race
  const opts = { ...(online ?? {}), pid: g.profile.id || undefined };
  const net = makeSession(g, online ? NetSession.onlineUrl(addr) : NetSession.urlFrom(addr), name, opts);
  g.net = net;
  net.connect();
  g.state = 'lobby';
}

/** The connection dropped (or went silent) mid-race: try again every 2 s, same room and profile, for `T.race.awayKeep` s at most. */
function reconnectTick(g: Game, dt: number) {
  const old = g.net!, rc = (g.recon ??= { t: 0, next: 0 });
  rc.t += dt; rc.next -= dt;
  if (rc.t > Math.min(40, T.race.awayKeep)) {
    g.recon = null;
    g.toast('No se pudo volver a la carrera: ' + (old.error || 'sin conexión'));
    leaveNet(g);
    return;
  }
  if (old.status === 'closed' && rc.next <= 0) {
    rc.next = 2;
    old.ws?.close();
    const net = makeSession(g, old.url, old.name, { ...(old.room ? { room: old.room } : {}), pid: g.profile.id || undefined });
    g.net = net;
    net.connect();
  }
}

export function leaveNet(g: Game) {
  if (g.lanHosting) { void desktop()?.stopHost(); g.lanHosting = null; }
  g.net?.close();
  g.net = null;
  g.netEndT = 0;
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
  g.specId = -1; g.specT = 0; g.recon = null;
  g.acc = 0; g.banner = null; g.flashT = 0; g.parts = []; g.paused = false; g.incoming = null;
  g.state = 'race';
}

/** The race (or the whole cup) is over and the server is back in the room. */
export function backToLobby(g: Game) {
  g.world = null;
  g.renderer.clearKarts();
  if (g.net) g.net.race = null;
  g.cup = null;
  g.netEndT = 0;
  g.state = 'lobby';
}

/** The server went back to the room after the results: the last race of a cup shows the cup podium first. */
export function raceOver(g: Game) {
  const net = g.net!, S = net.settings;
  if (isLastCupRace(S.mode, S.cup, net.cupRace)) {
    const def = CUPS[S.cup]!;
    g.cup = { def, race: net.cupRace, pts: { ...net.cupPts }, gain: {}, committed: true };
    g.resultNotes = [];
    g.netEndT = 0; // el podio tiene sus propios 5 s
    g.state = 'final';
    g.audio.jingle();
  } else backToLobby(g);
}

export function simulateNet(g: Game, dt: number) {
  const net = g.net!, r = net.race;
  g.paused = false; // a pause flag left over from a local race (or the tab being hidden) must never freeze an online race
  // every mode: the server is back in the room (also if the `end` never reached a client still watching the race)
  if ((g.state === 'results' || g.state === 'race') && net.phase === 'lobby') { raceOver(g); return; }
  // Timed ending of the last cup race (online/LAN): 5 s of results, 5 s of podium, then back to the room.
  // The server takes ~10 s to come back by itself; this also un-sticks clients it left behind.
  if (g.net && (g.state === 'results' || g.state === 'final') && isLastCupRace(net.settings.mode, net.settings.cup, net.cupRace)) {
    g.netEndT += dt;
    if (g.state === 'results' && g.netEndT >= 5) raceOver(g); // raceOver deja netEndT en 0 para el podio
    else if (g.state === 'final' && g.netEndT >= 5) { backToLobby(g); return; }
  } else g.netEndT = 0;
  // dropped line or silent server: show it and try to come back (the server keeps our kart on AI meanwhile)
  if (net.status === 'race' && net.go && net.lastSnapAt && performance.now() - net.lastSnapAt > 8000 && !document.hidden) net.abandon();
  // 'lobby' = standings or the cup podium: the line is fine, nothing to reconnect (it used to time out and leave the room)
  if (!r || net.status !== 'race') { g.acc = 0; if (net.status !== 'lobby') reconnectTick(g, dt); return; }
  if (!net.go) { g.acc = 0; return; } // waiting for the other players to finish loading
  net.flushSnaps(); // all the snapshots that arrived since the last frame are reconciled once
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
      if (e.type === 'trick') { g.trickAnim.set(e.kart, 0.001); g.trickKind.set(e.kart, e.kind === 'twist' ? 1 : e.kind === 'spin' ? 2 : 3); }
      if (e.type === 'land') { g.squash.set(e.kart, 1); g.trickAnim.delete(e.kart); }
      if (e.type === 'hit') g.hitAnim.set(e.kart, 0.001);
    }
    g.tickAnims(SIM_DT);
    g.acc -= SIM_DT;
  }
  updateSpectate(g, dt);
  net.smooth(dt);
  g.simMs = performance.now() - t0;
}
