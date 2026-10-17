// Local race lifecycle: setup, fixed-step simulation, points.
// Network races live in netRace.ts; the highlight replay lives in replayDirector.ts.
// Game delegates here so new race rules don't touch the orchestrator.
import {
  ALL_TRACKS, CHARS, LAPS, ReplayPlayer, ReplayRecorder, Rng, SIM_DT,
  buildGrid, classCfg, createWorld, fmtTime, modeOf, step, takeEvents,
  type Input as SimInput, type Replay, type World,
} from '@jpkart/core';
import { loadGhost } from '../meta/store';
import { MODE_ID } from '../app/types';
import { newView } from '../app/types';
import { isMobileDevice } from '../mobile';
import { assignSources, PlayerInput } from '../input/players';
import type { Game } from '../game';

export function startRace(g: Game, ti: number) {
  g.curTrack = ti;
  const cc = classCfg(g.cls), mirror = cc.mirror && !!g.tracks.get(ti).authored;
  if (!g.tracks.get(ti, mirror).built) {
    g.pendingRace = ti; g.pendingMirror = mirror; g.loadF = 0; g.state = 'loading'; return;
  }
  g.tr = g.tracks.get(ti, mirror);
  g.renderer.setTrack(g.tr);
  g.renderer.clearKarts();
  const seed = (Math.random() * 2 ** 31) | 0;
  const rng = new Rng(seed ^ 0x5bd1e995);
  // M3 móvil: pantalla dividida deshabilitada (1 jugador por teléfono).
  const mobile1 = (() => { try { return isMobileDevice(); } catch { return false; } })();
  const n = g.mode === 'timetrial' ? 1 : mobile1 ? 1 : g.players;
  const humans = [g.sel, ...CHARS.map((_, i) => (g.sel + i) % CHARS.length).slice(1, n)].map((ch) => ({ ch, ctrl: 'local' as const }));
  let grid = g.mode === 'timetrial' ? humans
    : g.mode === 'cup' && g.cup && g.cup.race > 0
      ? buildGrid(rng, humans, { cupPts: g.cup.pts, humanSlot: 0 })
      : buildGrid(rng, humans, { humanSlot: g.mode === 'cup' ? 7 : 5 });
  if (g.teams) grid = grid.map((gr, i) => ({ ...gr, team: i % 2 }));
  const mode = MODE_ID[g.mode], laps = modeOf({ cfg: { mode } } as World).laps?.(grid.length) ?? LAPS;
  const cfg = { trackIndex: ti, diff: g.diff, seed, laps, grid, mode, cc: cc.cc, mirror, teams: g.teams };
  g.world = createWorld(cfg, g.tr);
  g.resultNotes = [];
  g.ghost = null; g.ghostPrev = null;
  if (g.mode === 'timetrial') {
    const tr = g.tr;
    void loadGhost(ALL_TRACKS[ti]!.id, g.cls).then((gh: Replay | null) => {
      if (gh && gh.cfg.trackIndex === ti && g.world?.cfg === cfg) {
        g.ghost = new ReplayPlayer(gh, tr);
        g.toast('Fantasma: ' + fmtTime(gh.ticks / 60));
      }
    });
  }
  g.recorder = new ReplayRecorder(cfg);
  const srcs = assignSources(humans.length), wk = g.world.karts;
  g.views = humans.map((h, i) => ({
    ...newView(),
    localId: wk.findIndex((k) => k.ch === h.ch),
    input: humans.length > 1 ? new PlayerInput(srcs[i]!, g.input) : null,
  }));
  g.prev = g.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
  for (const v of g.views) { g.v = v; g.rig.cut(g.camTarget()!, g.tr); g.rig.trauma = 0; }
  g.v = g.views[0]!;
  g.acc = 0; g.banner = null; g.flashT = 0; g.parts = []; g.paused = false; g.incoming = null;
  g.trickAnim.clear(); g.squash.clear(); g.lastRank = -1; g.posPop = 0;
  g.state = 'race';
}

export function commitPoints(g: Game) {
  const c = g.cup, w = g.world;
  if (!c || !w || c.committed) return;
  c.committed = true;
  c.gain = {};
  const pts = modeOf(w).scoring?.(w, w.finalOrder) ?? new Map<number, number>();
  for (const id of w.finalOrder) {
    const ch = w.karts[id]!.ch, p = pts.get(id) ?? 0;
    c.pts[ch] = (c.pts[ch] ?? 0) + p; c.gain[ch] = p;
  }
}

export function localInput(g: Game): SimInput {
  const I = g.v.input ?? g.input;
  let d = I.held('derrapar');
  if (g.settings.driftToggle) {
    if (d && !g.driftHeldPrev) g.driftLatch = !g.driftLatch;
    g.driftHeldPrev = d;
    d = g.driftLatch && Math.abs(I.steer()) > 0.05;
  }
  return { t: I.throttle(), s: I.steer(), d, item: g.itemPressed || !!g.v.input?.itemPressed };
}

export function simulate(g: Game, dt: number) {
  if (g.net?.race) { g.simulateNet(dt); return; }
  if (g.replayView) { g.simulateReplay(dt); return; }
  const w = g.world!;
  // M3: en móvil máx. 4 sub-pasos (no 5) para no espiralar en jank.
  const mobCap = (() => { try { return isMobileDevice(); } catch { return false; } })();
  g.acc = Math.min(g.acc + dt, SIM_DT * (mobCap ? 4 : 5));
  const t0 = performance.now();
  while (g.acc >= SIM_DT) {
    g.prev = w.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    if (g.ghost && !g.ghost.done) {
      const gh = g.ghost.world.karts[0]!;
      g.ghostPrev = { x: gh.x, y: gh.y, z: gh.z, a: gh.a };
      g.ghost.step();
    }
    const inputs: SimInput[] = [];
    for (const v of g.views) {
      g.v = v;
      inputs[v.localId] = localInput(g);
      v.itemPressed = false;
      if (v.input) v.input.itemPressed = false;
    }
    g.v = g.views[0]!;
    g.recorder?.record(w, inputs);
    step(w, inputs);
    g.recorder?.after(w);
    g.acc -= SIM_DT;
    for (const e of takeEvents(w)) {
      g.v = g.viewFor(e); g.onEvent(e); g.v = g.views[0]!;
      g.fx.event(e, w);
      if (e.type === 'trick') g.trickAnim.set(e.kart, 0.001);
      if (e.type === 'land') { g.squash.set(e.kart, 1); g.trickAnim.delete(e.kart); }
    }
    g.tickAnims(SIM_DT);
  }
  g.simMs = performance.now() - t0;
}
