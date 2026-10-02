// Client orchestrator: screens, fixed-step simulation, camera, event → feedback, HUD.
import {
  ALL_TRACKS, CHARS, CLASSES, CLASS_NAMES, CLASSIC_CUPS, CUPS, DIFFS, LAPS, ReplayPlayer, ReplayRecorder, Rng, SIM_DT, STAT_SHORT, TrackCache, prepAuthored,
  classCfg, classUnlocked, cupUnlocked, recordCup, recordRace, POINTS,
  buildGrid, clamp, createWorld, fmtTime, fxOf, hAt, hasFx, hashWorld, modeOf, itemDef, itemList, lerp, step, takeEvents, wrapA,
  type EngineClass, type GameEvent, type Input as SimInput, type Kart, type Progress, type Replay, type StatKey, type Track, type World,
} from '@jpkart/core';
import { OUT } from './art/pixel';
import { hudLines, kartLabel } from './feel/effectView';
import { THING_ART, orbitArt, type ThingCtx } from './render/thingArt';
import { DebugOverlay } from './dev/debugOverlay';
import { ACTION_NAMES, REMAPPABLE } from './input/input';
import { PAD_NAMES } from './input/gamepad';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './settings';
import { NetSession, desktop } from './net/session';
import { CameraRig, type CamTarget } from './feel/camera';
import { DRIFT_COL as DCOL, DRIFT_COL_CB, Fx3d } from './feel/fx3d';
import { BALLS, BIGBALL, FACES, ICONS, rotFrames, COIN } from './art/sprites';
import { Audio } from './audio/audio';
import { Input } from './input/input';
import { buildMinimap } from './render/trackArt';
import { T } from '@jpkart/core';
import { H0, RW, WorldRenderer, type KartView, type ThingView } from './render/world3d';
import { H, Ui, W } from './ui/draw';
import { loadGhost, loadProgress, saveGhost, saveProgress } from './meta/store';

type State = 'title' | 'menu' | 'options' | 'controls' | 'lan' | 'lobby' | 'select' | 'cup' | 'track' | 'loading' | 'race' | 'results' | 'podium' | 'standings' | 'final' | 'replay';
type Mode = 'free' | 'cup' | 'timetrial' | 'elimination';
const MODE_ID: Record<Mode, string> = { free: 'race', cup: 'cup', timetrial: 'timetrial', elimination: 'elimination' };
const TEAM_COL = ['#ff5a6a', '#5aa8ff'];
const TEAM_NAME = ['Rojo', 'Azul'];
const MENUS: State[] = ['title', 'menu', 'options', 'controls', 'lan', 'lobby', 'select', 'cup', 'track'];
const CAM_H = 15, CAM_BACK = 34, ZMAX = 1000;
const UIK = W / RW; // internal world px → UI px
const DRIFT_COL = ['#fff7e0', '#3df0ff', '#ff8a1f', '#b84aff'];

interface Pose { x: number; y: number; z: number; a: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number; line?: boolean }
interface CupState { def: (typeof CUPS)[number]; race: number; pts: Record<number, number>; gain: Record<number, number>; committed: boolean }

/** Track select: what each authored track's gimmick is called. */
const HAZARD_TAG: Record<string, string> = {
  ola: 'Olas', tren: 'Tren', vaca: 'Vacas', auto: 'Tráfico', pinguino: 'Pingüinos', aspa: 'Molinos', geiser: 'Géiseres', laser: 'Láseres',
  meteoro: 'Meteoritos', roca: 'Rocas', pelota: 'Pelotas gigantes', bolanieve: 'Bolas de nieve', seta: 'Setas saltarinas', compuerta: 'Compuertas',
};
const WEATHER_TAG: Record<string, string> = { lluvia: 'Lluvia', niebla: 'Niebla', arena: 'Tormenta de arena', noche: 'Noche' };
/** Banner when a track hazard warns near the local kart. */
const HAZARD_WARN: Record<string, string> = {
  ola: '¡Ola!', tren: '¡Tren!', vaca: '¡Vacas!', auto: '¡Tráfico!', pinguino: '¡Pingüinos!', geiser: '¡Géiser!', laser: '¡Láser!',
  meteoro: '¡Meteorito!', roca: '¡Roca!', pelota: '¡Pelota!', bolanieve: '¡Bola de nieve!',
};

export class Game {
  state: State = 'title';
  sel = 5; trackSel = 0; menuSel = 0; cupSel = 0; diff = 1;
  mode: Mode = 'free';
  /** progression (GDD §9): unlocks and records, saved with versions and migrations */
  progress: Progress = loadProgress();
  /** `?desbloquear` in the URL (or the LAN host option) opens everything */
  allUnlocked = typeof location !== 'undefined' && new URLSearchParams(location.search).has('desbloquear');
  cls: EngineClass = '100';
  teams = false;
  /** time trial: the record run, replayed next to the player */
  ghost: ReplayPlayer | null = null;
  private ghostPrev: Pose | null = null;
  /** messages for the last result screen (records, unlocks) */
  resultNotes: string[] = [];
  /** end-of-race replay with the highlight camera (#62) */
  private replayView: { player: ReplayPlayer; world: World; localId: number; back: State; focus: number; hold: number; ranks: number[] } | null = null;
  private pendingMirror = false;
  paused = false; pendingRace = 0; loadF = 0;
  cup: CupState | null = null;
  tracks = new TrackCache(ALL_TRACKS, prepAuthored);
  /** track select: new (authored) tracks, or the legacy ones ("Clásicas") */
  classic = false;
  get trackCups() { return this.classic ? CLASSIC_CUPS : CUPS; }
  /** track select grid: the cups' tracks, 4 per row */
  get grid() { return this.trackCups.flatMap((c) => c.tracks); }
  /** index (into ALL_TRACKS) of the track being raced */
  curTrack = 0;
  incoming: { item: string; t: number } | null = null;
  dbg = new DebugOverlay();
  settings: Settings = loadSettings();
  net: NetSession | null = null;
  lanField = 0;
  lanFound: { name: string; address: string; port: number; players: number }[] = [];
  lanHosting: string[] | null = null;
  lanName = 'Jugador';
  lanAddr = typeof location !== 'undefined' && location.hostname && location.hostname !== '' ? location.hostname : 'localhost';
  optSel = 0;
  ctlSel = 0;
  private driftLatch = false;
  private driftHeldPrev = false;
  tr: Track;
  world: World | null = null;
  recorder: ReplayRecorder | null = null;
  lastReplay: Replay | null = null;
  localId = -1;
  private prev: Pose[] = [];
  private acc = 0;
  private itemPressed = false;
  cam = { x: 0, y: 0, a: 0, z: 30, hz: H0, f: 320, roll: 0 };
  rig = new CameraRig();
  fx: Fx3d;
  /** visual hit-stop: hold the rendered poses for a few frames (simulation keeps running) */
  private hitStop = 0;
  /** visual-only animation timers per kart */
  private trickAnim = new Map<number, number>();
  private squash = new Map<number, number>();
  private posPop = 0;
  private lastRank = -1;
  private held: Pose[] | null = null;
  attract = 0;
  banner: { t: string; life: number; big?: boolean } | null = null;
  flashC = '#ffffff'; flashT = 0;
  parts: Particle[] = [];
  minis = new Map<Track, { cv: HTMLCanvasElement; k: number }>();
  last = performance.now();
  fps = 0; private fpsAcc = 0; private fpsN = 0;
  showPerf = false;
  simMs = 0; renderMs = 0;

  constructor(public renderer: WorldRenderer, public ui: Ui, public input: Input, public audio: Audio) {
    this.tr = this.tracks.ensureBuilt(0);
    renderer.setTrack(this.tr);
    this.fx = new Fx3d(renderer.particles);
    input.onFirstGesture = () => { audio.init(); this.applySettings(); };
    this.applySettings();
  }

  private toastMsg: { t: string; life: number } | null = null;
  /** Small dev message in the corner (hot reload, errors). */
  toast(t: string) { this.toastMsg = { t, life: 3 }; }

  /** Editor: mouse events in UI coordinates (F3). Rebuilds the authored track after a drag. */
  pointer(kind: 'down' | 'move' | 'up', ux: number, uy: number) {
    if (this.dbg.pointer(kind, ux, uy, this.tr) && this.tr.authored) {
      const i = ALL_TRACKS.findIndex((t) => t.id === this.tr.def.id);
      const fresh = this.tracks.rebuildAuthored(i);
      if (fresh) { this.tr = fresh; this.renderer.setTrack(fresh); this.toast('Pista reconstruida (' + fresh.N + ' muestras)'); }
    }
  }

  /** Debug/test hooks: perf numbers. */
  perf() { return { fps: this.fps, sim: this.simMs, render: this.renderMs, drawCalls: this.renderer.drawCalls, backend: this.renderer.backend }; }

  /** Debug/test hooks: current replay and state hash. */
  debugReplay() { return { replay: this.recorder?.replay ?? this.lastReplay, hash: this.world ? hashWorld(this.world) : '' }; }

  get local(): Kart | undefined { return this.world && this.localId >= 0 ? this.world.karts[this.localId] : undefined; }
  mini(t: Track) { let m = this.minis.get(t); if (!m) { m = buildMinimap(t); this.minis.set(t, m); } return m; }

  // ---------------- input ----------------
  private onPress(code: string) {
    const I = this.input, A = this.audio;
    const ok = I.is(code, 'aceptar'), back = I.is(code, 'atras');
    const L = I.is(code, 'izquierda'), R = I.is(code, 'derecha'), U = I.is(code, 'arriba'), D = I.is(code, 'abajo');
    if (I.is(code, 'sonido')) A.muted = !A.muted;
    if (code === 'F2') this.showPerf = !this.showPerf;
    if (code === 'F3') this.dbg.track = !this.dbg.track;
    if (code === 'F4') this.dbg.ai = !this.dbg.ai;
    if (code === 'KeyS' && this.dbg.track && this.dbg.dirty && this.tr.authored) void this.dbg.save(this.tr.authored).then((m) => this.toast(m));
    switch (this.state) {
      case 'title': if (ok) { this.state = 'menu'; A.blip(); } break;
      case 'menu':
        if (U) { this.menuSel = (this.menuSel + 6) % 7; A.blip(); }
        if (D) { this.menuSel = (this.menuSel + 1) % 7; A.blip(); }
        if (this.menuSel === 5 && (L || R || ok)) { this.diff = (this.diff + (L ? 2 : 1)) % 3; A.blip(); break; }
        if (this.menuSel === 6 && ok) { this.state = 'options'; this.optSel = 0; A.blip(); break; }
        if (this.menuSel === 4 && ok) { this.state = 'lan'; this.lanField = 0; this.input.textMode = true; A.blip(); break; }
        if (ok) { this.mode = (['cup', 'free', 'timetrial', 'elimination'] as Mode[])[this.menuSel]!; if (this.mode !== 'free' && this.mode !== 'cup') this.teams = false; this.state = 'select'; A.blip(); }
        if (back) this.state = 'title';
        break;
      case 'options': this.optionsInput(code, ok, back, L, R, U, D); break;
      case 'lan': this.lanInput(code, back, U, D); break;
      case 'lobby': this.lobbyInput(code, ok, back, L, R, U, D); break;
      case 'controls': this.controlsInput(code, ok, back, U, D); break;
      case 'select':
        if (R) { this.sel = (this.sel + 1) % 8; A.blip(); }
        if (L) { this.sel = (this.sel + 7) % 8; A.blip(); }
        if (U || D) { this.sel = (this.sel + 4) % 8; A.blip(); }
        if (ok) { this.state = this.mode === 'cup' ? 'cup' : 'track'; A.beep(780, 0.1); }
        if (back) this.state = 'menu';
        break;
      case 'cup':
        if (this.classKeys(code)) break;
        if (R) { this.cupSel = (this.cupSel + 1) % 4; A.blip(); }
        if (L) { this.cupSel = (this.cupSel + 3) % 4; A.blip(); }
        if (U || D) { this.cupSel = (this.cupSel + 2) % 4; A.blip(); }
        if (ok && !cupUnlocked(this.progress, this.cupSel, this.allUnlocked)) { this.banner = { t: 'Consigue podio en la copa anterior', life: 1.5 }; A.beep(160, 0.15, 'square', 0.05); break; }
        if (ok) {
          this.cup = { def: CUPS[this.cupSel]!, race: 0, pts: Object.fromEntries(CHARS.map((_, i) => [i, 0])), gain: {}, committed: false };
          this.startRace(this.cup.def.tracks[0]!); A.beep(880, 0.12);
        }
        if (back) this.state = 'select';
        break;
      case 'track':
        if (R) { this.trackSel = (this.trackSel + 1) % 16; A.blip(); }
        if (L) { this.trackSel = (this.trackSel + 15) % 16; A.blip(); }
        if (D) { this.trackSel = (this.trackSel + 4) % 16; A.blip(); }
        if (U) { this.trackSel = (this.trackSel + 12) % 16; A.blip(); }
        if (this.classKeys(code)) break;
        if (code === 'KeyC' || code === 'Tab' || code === 'Pad3') { this.classic = !this.classic; A.blip(); }
        if (ok) { this.startRace(this.grid[this.trackSel]!); A.beep(880, 0.12); }
        if (back) this.state = 'select';
        break;
      case 'race':
        if (this.net && back) { this.leaveNet(); return; }
        if (this.net) { if (I.is(code, 'objeto')) this.itemPressed = true; break; }
        if (I.is(code, 'pausa') || (back && !this.paused)) { this.paused = !this.paused; A.beep(440, 0.06); return; }
        if (this.paused && back) { this.paused = false; this.state = 'menu'; this.world = null; this.renderer.clearKarts(); A.engineSet(false, 0); return; }
        if (this.paused && code === 'Enter') { this.paused = false; return; }
        if (!this.paused && I.is(code, 'objeto')) this.itemPressed = true;
        break;
      case 'results':
        if (this.net) { if (ok && this.net.isHost) this.net.send({ t: 'next' }); if (back) this.leaveNet(); break; }
        if (code === 'KeyR' && this.lastReplay) { this.startReplayView(); break; }
        if (ok) { if (this.mode === 'cup') { this.commitPoints(); this.state = 'standings'; } else if (this.mode === 'timetrial') this.startRace(this.curTrack); else { this.state = 'podium'; A.jingle(); } }
        if (back && this.mode !== 'cup') this.toMenu();
        break;
      case 'podium': if (code === 'KeyR' && this.lastReplay) { this.startReplayView(); break; } if (ok) this.startRace(this.curTrack); if (back) this.toMenu(); break;
      case 'replay': if (ok || back || code === 'KeyR') this.endReplayView(); break;
      case 'standings':
        if (ok && this.cup) {
          if (this.cup.race < this.cup.def.tracks.length - 1) { this.cup.race++; this.cup.committed = false; this.startRace(this.cup.def.tracks[this.cup.race]!); }
          else {
            const place = this.standingsList().indexOf(this.sel) + 1;
            this.resultNotes = recordCup(this.progress, CUPS.indexOf(this.cup.def), this.cls, place);
            saveProgress(this.progress);
            this.state = 'final'; A.jingle();
          }
        }
        break;
      case 'final': if (ok || back) this.toMenu(); break;
    }
  }
  private toMenu() { this.state = 'menu'; this.world = null; this.ghost = null; this.renderer.clearKarts(); }
  /** Cup/track screens: X cycles the engine class (only unlocked ones), E toggles teams (race and cup). */
  private classKeys(code: string): boolean {
    if (code === 'KeyX' || code === 'Pad2') {
      const open = CLASSES.filter((c) => classUnlocked(this.progress, c, this.allUnlocked));
      this.cls = open[(open.indexOf(this.cls) + 1) % open.length]!;
      this.audio.blip();
      return true;
    }
    if ((code === 'KeyE' || code === 'Pad1') && (this.mode === 'free' || this.mode === 'cup')) { this.teams = !this.teams; this.audio.blip(); return true; }
    return false;
  }
  private drawClassLine(y: number) {
    const ui = this.ui, next = CLASSES.filter((c) => classUnlocked(this.progress, c, this.allUnlocked)).length > 1;
    const parts = ['Clase: ' + CLASS_NAMES[this.cls] + (next ? ' (X)' : '')];
    if (this.mode === 'free' || this.mode === 'cup') parts.push('Equipos: ' + (this.teams ? 'sí' : 'no') + ' (E)');
    ui.txtS(parts.join('    '), W / 2, y, '#8fe0ff');
  }

  // ---------------- race ----------------
  startRace(ti: number) {
    this.curTrack = ti;
    const cc = classCfg(this.cls), mirror = cc.mirror && !!this.tracks.get(ti).authored;
    if (!this.tracks.get(ti, mirror).built) { this.pendingRace = ti; this.pendingMirror = mirror; this.loadF = 0; this.state = 'loading'; return; }
    this.tr = this.tracks.get(ti, mirror);
    this.renderer.setTrack(this.tr);
    this.renderer.clearKarts();
    const seed = (Math.random() * 2 ** 31) | 0;
    const rng = new Rng(seed ^ 0x5bd1e995);
    const humans = [{ ch: this.sel, ctrl: 'local' as const }];
    let grid = this.mode === 'timetrial' ? humans
      : this.mode === 'cup' && this.cup && this.cup.race > 0
        ? buildGrid(rng, humans, { cupPts: this.cup.pts, humanSlot: 0 })
        : buildGrid(rng, humans, { humanSlot: this.mode === 'cup' ? 7 : 5 });
    if (this.teams) grid = grid.map((g, i) => ({ ...g, team: i % 2 }));
    const mode = MODE_ID[this.mode], laps = modeOf({ cfg: { mode } } as World).laps?.(grid.length) ?? LAPS;
    const cfg = { trackIndex: ti, diff: this.diff, seed, laps, grid, mode, cc: cc.cc, mirror, teams: this.teams };
    this.world = createWorld(cfg, this.tr);
    this.resultNotes = [];
    this.ghost = null; this.ghostPrev = null;
    if (this.mode === 'timetrial') {
      const tr = this.tr;
      void loadGhost(ALL_TRACKS[ti]!.id, this.cls).then((g) => { if (g && g.cfg.trackIndex === ti && this.world?.cfg === cfg) { this.ghost = new ReplayPlayer(g, tr); this.toast('Fantasma: ' + fmtTime(g.ticks / 60)); } });
    }
    this.recorder = new ReplayRecorder(cfg);
    this.localId = this.world.karts.findIndex((k) => k.ctrl === 'local');
    this.prev = this.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    this.rig.cut(this.camTarget()!, this.tr);
    this.rig.trauma = 0;
    this.acc = 0; this.banner = null; this.flashT = 0; this.parts = []; this.paused = false; this.incoming = null;
    this.trickAnim.clear(); this.squash.clear(); this.lastRank = -1; this.posPop = 0;
    this.state = 'race';
  }
  /** Records and ghosts (local races only; LAN races do not count). */
  private onRaceEnd() {
    const w = this.world, k = this.local;
    if (this.net || !w || !k || this.replayView) return;
    const id = ALL_TRACKS[this.curTrack]!.id;
    if (k.finished && !k.out) {
      const rec = recordRace(this.progress, id, this.cls, k.ch, k.best, k.time);
      if (rec.race) this.resultNotes.push('¡Nuevo récord de carrera!');
      if (rec.lap) this.resultNotes.push('¡Nuevo récord de vuelta!');
      if (this.mode === 'timetrial' && rec.race && this.lastReplay) { saveGhost(id, this.cls, this.lastReplay); this.resultNotes.push('Fantasma guardado'); }
    } else this.progress.races++;
    saveProgress(this.progress);
  }
  private commitPoints() {
    const c = this.cup, w = this.world;
    if (!c || !w || c.committed) return;
    c.committed = true;
    c.gain = {};
    const pts = modeOf(w).scoring?.(w, w.finalOrder) ?? new Map<number, number>();
    for (const id of w.finalOrder) { const ch = w.karts[id]!.ch, p = pts.get(id) ?? 0; c.pts[ch] = (c.pts[ch] ?? 0) + p; c.gain[ch] = p; }
  }
  private localInput(): SimInput {
    const I = this.input;
    let d = I.held('derrapar');
    if (this.settings.driftToggle) { if (d && !this.driftHeldPrev) this.driftLatch = !this.driftLatch; this.driftHeldPrev = d; d = this.driftLatch && Math.abs(I.steer()) > 0.05; }
    const inp: SimInput = { t: I.throttle(), s: I.steer(), d, item: this.itemPressed };
    return inp;
  }
  private simulate(dt: number) {
    if (this.net?.race) { this.simulateNet(dt); return; }
    if (this.replayView) { this.simulateReplay(dt); return; }
    const w = this.world!;
    this.acc = Math.min(this.acc + dt, SIM_DT * 5);
    const t0 = performance.now();
    while (this.acc >= SIM_DT) {
      this.prev = w.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
      if (this.ghost && !this.ghost.done) { const g = this.ghost.world.karts[0]!; this.ghostPrev = { x: g.x, y: g.y, z: g.z, a: g.a }; this.ghost.step(); }
      const inputs: SimInput[] = [];
      inputs[this.localId] = this.localInput();
      this.itemPressed = false;
      this.recorder?.record(w, inputs);
      step(w, inputs);
      this.recorder?.after(w);
      this.acc -= SIM_DT;
      for (const e of takeEvents(w)) {
        this.onEvent(e); this.fx.event(e, w);
        if (e.type === 'trick') this.trickAnim.set(e.kart, 0.001);
        if (e.type === 'land') { this.squash.set(e.kart, 1); this.trickAnim.delete(e.kart); }
      }
      this.tickAnims(SIM_DT);
    }
    this.simMs = performance.now() - t0;
  }
  // ---------------- end-of-race replay with a highlight camera (#62) ----------------
  private startReplayView() {
    if (!this.lastReplay || !this.world) return;
    const player = new ReplayPlayer(this.lastReplay, this.tr);
    // skip the countdown
    while (player.world.phase === 'countdown' && !player.done) player.step();
    this.replayView = { player, world: this.world, localId: this.localId, back: this.state, focus: this.localId, hold: 3, ranks: player.world.karts.map((k) => k.rank) };
    this.world = player.world;
    this.prev = this.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    this.renderer.clearKarts();
    this.state = 'replay';
    this.rig.cut(this.camTarget()!, this.tr);
  }
  private endReplayView() {
    const r = this.replayView;
    if (!r) return;
    this.world = r.world; this.localId = r.localId; this.state = r.back; this.replayView = null;
    this.renderer.clearKarts();
  }
  /** Director: cut to whoever gets hit, overtakes in the top 3 or pulls a big mini-turbo; otherwise the leader. */
  private simulateReplay(dt: number) {
    const r = this.replayView!, w = r.player.world;
    this.acc = Math.min(this.acc + dt, SIM_DT * 5);
    while (this.acc >= SIM_DT) {
      this.prev = w.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
      let best = -1, score = 0;
      for (const e of r.player.step()) {
        this.fx.event(e, w);
        const s = e.type === 'hit' ? 3 : e.type === 'explode' ? 2 : (e.type === 'miniTurbo' && e.level === 3) || e.type === 'trick' ? 1 : 0;
        if (s > score && 'kart' in e) { score = s; best = e.kart; }
      }
      for (const k of w.karts) { if (k.rank < 3 && r.ranks[k.id]! > k.rank && score < 2) { score = 2; best = k.id; } r.ranks[k.id] = k.rank; }
      r.hold -= SIM_DT;
      if (r.hold <= 0 && best >= 0 && best !== r.focus) { r.focus = best; r.hold = 3; this.localId = best; this.rig.cut(this.camTarget()!, this.tr); }
      else if (r.hold <= -2) { const lead = w.ranked[0]!; if (lead !== r.focus) { r.focus = lead; this.localId = lead; this.rig.cut(this.camTarget()!, this.tr); } r.hold = 3; }
      this.localId = r.focus;
      this.acc -= SIM_DT;
      this.tickAnims(SIM_DT);
      if (r.player.done) { this.endReplayView(); return; }
    }
  }
  private drawReplayHud(t: number) {
    const ui = this.ui, r = this.replayView;
    if (!r) return;
    if (((t * 2) | 0) % 2 === 0) ui.txt('● Repetición', 8, 8, '#ff4d6d', 8, 'left');
    const k = this.local;
    if (k) ui.txtS(CHARS[k.ch]!.name + '  ·  ' + (k.rank + 1) + 'º', W / 2, H - 22, '#fff7e0');
    ui.txtS('Enter: salir de la repetición', W / 2, H - 10, '#9c95d6');
  }

  private tickAnims(dt: number) {
    for (const [id, v] of this.trickAnim) { const n = v + dt / 0.45; if (n >= 1) this.trickAnim.delete(id); else this.trickAnim.set(id, n); }
    for (const [id, v] of this.squash) { const n = v - dt / 0.18; if (n <= 0) this.squash.delete(id); else this.squash.set(id, n); }
  }

  private pose(k: Kart): Pose {
    if (this.held && this.held[k.id]) return this.held[k.id]!;
    const p = this.prev[k.id], a = this.acc / SIM_DT;
    const vo = this.net && k.id === this.localId ? this.net.visOff : null;
    if (!p || this.paused) return { x: k.x + (vo?.x ?? 0), y: k.y + (vo?.y ?? 0), z: k.z, a: k.a };
    return { x: lerp(p.x, k.x, a) + (vo?.x ?? 0), y: lerp(p.y, k.y, a) + (vo?.y ?? 0), z: lerp(p.z, k.z, a), a: p.a + wrapA(k.a - p.a) * a };
  }

  // ---------------- events → feedback ----------------
  coinPop = 0;
  private onEvent(e: GameEvent) {
    const A = this.audio, w = this.world!, me = (id: number) => id === this.localId;
    const p = this.local;
    const near = (id: number, r: number) => { const k = w.karts[id]; return !!(p && k && Math.hypot(p.x - k.x, p.y - k.y) < r); };
    switch (e.type) {
      case 'countdown': A.beep(440, 0.12); break;
      case 'go': this.banner = { t: '¡Ya!', life: 0.9, big: true }; A.beep(880, 0.3); break;
      case 'flight': if (me(e.kart)) { this.banner = { t: '¡A volar!', life: 1 }; A.beep(400, 0.5, 'sine', 0.05, 500); } break;
      case 'fall': if (me(e.kart)) { this.banner = { t: this.tr.def.liquid?.msg ?? '¡Ay!', life: 1.2 }; A.groan(CHARS[w.karts[e.kart]!.ch]!, 0.45, Math.random()); } break;
      case 'shieldPop': if (me(e.kart)) { A.beep(1200, e.offroad ? 0.12 : 0.15, 'square', 0.05, -600); if (e.offroad) this.banner = { t: '¡La burbuja explotó!', life: 1 }; } break;
      case 'driftStart': if (me(e.kart)) A.beep(260, 0.06, 'square', 0.04); break;
      case 'miniTurbo': if (me(e.kart)) { if (e.level === 2) A.beep(520, 0.3, 'sawtooth', 0.06, 500); else A.beep(420, 0.2, 'sawtooth', 0.05, 300); } break;
      case 'jump': if (me(e.kart)) A.beep(330, 0.12, 'square', 0.04, 200); break;
      case 'land': if (me(e.kart) && e.hard) { A.beep(90, 0.1, 'square', 0.05); this.rig.addTrauma(0.2); } break;
      case 'pad': if (me(e.kart)) A.beep(640, 0.2, 'sawtooth', 0.05, 500); break;
      case 'itemRoll': if (me(e.kart)) { A.beep(1100, 0.05, 'square', 0.05); A.beep(600, 0.08, 'square', 0.04, 300); } break;
      case 'itemGet': if (me(e.kart)) A.beep(880, 0.08); break;
      case 'itemUse': this.itemSound(e.item, me(e.kart), near(e.kart, 260), e.target != null && me(e.target), e.ok); break;
      case 'alreadyFirst': if (me(e.kart)) this.banner = { t: 'Ya vas primero', life: 1 }; break;
      case 'hit': {
        const k = w.karts[e.kart]!, d = p ? Math.hypot(p.x - k.x, p.y - k.y) : 0;
        if (me(e.kart)) { this.rig.addTrauma(0.55); this.hitStop = 0.06; this.held = w.karts.map((q) => this.pose(q)); }
        else if (d < 80) this.rig.addTrauma(0.15);
        A.groan(CHARS[k.ch]!, me(e.kart) ? 0.5 : 0.45 * (1 - clamp(d / 380, 0, 1)), Math.random());
        break;
      }
      case 'bump': if (me(e.a) || me(e.b)) { A.beep(120, 0.06, 'square', 0.04); this.rig.addTrauma(0.08); } break;
      case 'coin': if (me(e.kart)) A.beep(1320 + e.coins * 40, 0.06, 'square', 0.035, 200); break;
      case 'coinLoss': if (me(e.kart)) { this.coinPop = 1; A.beep(900, 0.18, 'square', 0.04, -500); } break;
      case 'zap': { if (me(e.to)) { this.flashC = '#3df0ff'; this.flashT = 0.2; } if (me(e.from) || me(e.to) || near(e.to, 220)) A.beep(1800, 0.12, 'sawtooth', 0.05, -1500); break; }
      case 'gust': if (me(e.kart) || near(e.kart, 160)) A.beep(200, 0.45, 'triangle', 0.05, 300); break;
      case 'catch': if (me(e.kart)) { this.banner = { t: '¡Atrapado!', life: 0.8 }; A.beep(760, 0.12, 'square', 0.05, 300); } break;
      case 'lap': if (me(e.kart)) { if (e.final) A.duck(0.8); this.banner = { t: e.final ? '¡Última vuelta!' : 'Vuelta ' + e.lap, life: 1.8 }; A.beep(e.final ? 990 : 700, 0.2); } break;
      case 'finish': if (me(e.kart)) { A.duck(1.2); this.banner = { t: '¡Meta!', life: 2.2, big: true }; A.musicWant(null); A.jingle(); } break;
      case 'flash': this.flashC = e.color; this.flashT = 0.35; break;
      case 'driftLevel': if (me(e.kart)) A.beep(e.level === 3 ? 760 : e.level === 2 ? 620 : 500, 0.07, 'square', 0.04, 120); break;
      case 'trick': if (me(e.kart)) { this.banner = { t: '¡Truco!', life: 0.7 }; A.beep(980, 0.12, 'square', 0.05, 400); } break;
      case 'slipstream': if (me(e.kart)) { this.banner = { t: '¡Rebufo!', life: 0.6 }; A.beep(360, 0.3, 'sawtooth', 0.04, 500); } break;
      case 'wallBump': if (me(e.kart)) { A.beep(e.hard ? 90 : 140, 0.08, 'square', 0.05); this.rig.addTrauma(e.hard ? 0.35 : 0.12); } break;
      case 'burnout': if (me(e.kart)) { this.banner = { t: '¡Quemaste rueda!', life: 1 }; A.beep(110, 0.5, 'sawtooth', 0.05, -40); } break;
      case 'rocketStart': if (me(e.kart)) { this.banner = { t: '¡Turbo de salida!', life: 0.9 }; A.beep(300, 0.35, 'sawtooth', 0.05, 600); } break;
      case 'incoming': if (me(e.kart)) { this.incoming = { item: e.item, t: Math.max(1, e.eta) }; A.beep(1400, 0.08, 'square', 0.05); A.beep(1400, 0.08, 'square', 0.05); } break;
      case 'hazardWarn': if (this.local && this.nearSample(e.at, 0.12)) { const msg = HAZARD_WARN[e.kind]; if (msg) this.banner = { t: msg, life: 1 }; A.beep(220, 0.6, 'triangle', 0.05, 200); } break;
      case 'tide': this.banner = { t: '¡Sube la marea!', life: 1.6 }; A.beep(180, 0.9, 'sine', 0.06, -60); break;
      case 'reflect': A.beep(1600, 0.15, 'sine', 0.05, -900); break;
      case 'explode': { const p0 = this.local; if (p0 && Math.hypot(p0.x - e.x, p0.y - e.y) < 260) { A.beep(70, 0.4, 'sawtooth', 0.08, -30); this.flashC = '#ff8a1f'; this.flashT = 0.2; this.rig.addTrauma(0.5 * (1 - Math.hypot(p0.x - e.x, p0.y - e.y) / 260)); } break; }
      case 'raceEnd': if (this.state === 'race') this.state = 'results'; if (this.recorder) { this.lastReplay = this.recorder.replay; this.recorder = null; } this.onRaceEnd(); break;
      case 'eliminated': if (me(e.kart)) { this.banner = { t: '¡Eliminado!', life: 2, big: true }; A.beep(160, 0.6, 'sawtooth', 0.07, -80); } else { this.banner = { t: 'Fuera: ' + CHARS[w.karts[e.kart]!.ch]!.short + ' · quedan ' + e.left, life: 1.6 }; A.beep(520, 0.15, 'square', 0.05, -200); } break;
    }
  }
  private itemSound(id: string, me: boolean, near: boolean, targetMe: boolean, ok: boolean) {
    const A = this.audio;
    switch (id) {
      case 'bocina': if (me || near) { A.beep(330, 0.4, 'sawtooth', 0.07); A.beep(415, 0.4, 'sawtooth', 0.05); } break;
      case 'falsa': if (me) A.beep(200, 0.1, 'triangle', 0.05); break;
      case 'turbo3': if (me) A.beep(300, 0.3, 'sawtooth', 0.05, 600); break;
      case 'ciego3': if (me) A.beep(700, 0.1, 'square', 0.05, -300); break;
      case 'bumeran': case 'bumeranR': if (me) A.beep(520, 0.25, 'triangle', 0.05, 260); break;
      case 'iman': if (me) A.beep(440, 0.4, 'sine', 0.05, 440); break;
      case 'cadena': if (me) A.beep(1600, 0.2, 'sawtooth', 0.05, -1200); break;
      case 'hielo': if (me) A.beep(1400, 0.15, 'sine', 0.04, -300); break;
      case 'humo': if (me) A.beep(150, 0.4, 'triangle', 0.05, -60); break;
      case 'rafaga': break;
      case 'bala': if (ok) A.beep(220, 0.6, 'sawtooth', 0.07, 900); break;
      case 'goma': if (me) A.beep(500, 0.15, 'sine', 0.05, -200); break;
      case 'ciego': if (me) A.beep(700, 0.1, 'square', 0.05, -300); break;
      case 'burbuja': if (me) A.beep(900, 0.2, 'sine', 0.05, 300); break;
      case 'nitro': if (me) A.beep(300, 0.35, 'sawtooth', 0.05, 600); break;
      case 'alquitran': if (me) A.beep(120, 0.25, 'triangle', 0.06, -40); break;
      case 'dron': if (me || targetMe) A.beep(880, 0.3, 'square', 0.04, -300); break;
      case 'gancho': if (ok && (me || targetMe)) A.beep(250, 0.4, 'sawtooth', 0.05, 400); break;
      case 'inversor': A.beep(600, 0.4, 'square', 0.05, -400); break;
      case 'pem': A.beep(90, 0.6, 'sawtooth', 0.08, 300); break;
      case 'jugger': if (me) A.beep(200, 0.5, 'square', 0.06, 300); break;
      case 'agujero': A.beep(60, 0.8, 'sawtooth', 0.08, -20); break;
      case 'cuantico': if (ok) A.beep(1200, 0.25, 'sine', 0.05, -800); break;
    }
  }

  /** Is the local kart within `frac` of a lap before track position `at` (0..1)? */
  private nearSample(at: number, frac: number) {
    const p = this.local!, N = this.tr.N, i = Math.floor(at * N);
    const d = (i - p.idx + N) % N;
    return d < frac * N;
  }

  // ---------------- camera ----------------
  private camTarget(): CamTarget | null {
    const p = this.local;
    if (!p) return null;
    const ps = this.pose(p);
    return { x: ps.x, y: ps.y, z: ps.z, a: ps.a, drift: p.drift, boost: p.boost > 0, air: p.air, lookBack: this.input.held('mirarAtras'), spinning: p.spin > 0 };
  }
  private updateCam(dt: number, x: number, y: number, a: number, z: number) {
    const v = this.rig.update(dt, { x, y, z, a, drift: 0, boost: false, air: false, lookBack: false, spinning: false }, this.tr);
    Object.assign(this.cam, v);
  }

  // ---------------- frame ----------------
  frame(now: number) {
    const rawDt = (now - this.last) / 1000;
    const dt = clamp(rawDt, 0, 1 / 30);
    this.last = now;
    this.fpsAcc += rawDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    const t = now / 1000;
    this.input.poll();
    for (const code of this.input.drainPressed()) this.onPress(code);
    const ui = this.ui, A = this.audio;
    ui.begin();
    if (this.state === 'loading') {
      ui.ctx.fillStyle = '#1b1740'; ui.ctx.fillRect(0, 0, W, H);
      ui.txt('Cargando pista...', W / 2, H / 2 - 14, '#ffe45e', 8, 'center');
      ui.txtS(this.tracks.get(this.pendingRace).def.name + (this.pendingMirror ? ' (Espejo)' : ''), W / 2, H / 2 + 4);
      ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 8, H / 2 + 18, 16, 16);
      if (++this.loadF >= 3) { this.tracks.ensureBuilt(this.pendingRace, [this.tr], this.pendingMirror); this.startRace(this.pendingRace); }
    } else if (MENUS.includes(this.state)) {
      const want = this.state === 'track' ? this.tracks.get(this.grid[this.trackSel]!) : this.state === 'cup' ? this.tracks.get(CUPS[this.cupSel]!.tracks[0]!) : this.tracks.get(this.grid[((t / 10) | 0) % this.grid.length]!);
      if (want.built && want !== this.tr) { this.tr = want; this.renderer.setTrack(want); const i = Math.floor(this.attract) % want.N; this.cam.a = want.ang[i]!; this.cam.z = want.hc[i]! + CAM_H; }
      const tr = this.tr;
      this.attract = (((this.attract + dt * 30) % tr.N) + tr.N) % tr.N;
      const i = Math.floor(this.attract) % tr.N, x = tr.x[i]!, y = tr.y[i]!;
      this.updateCam(dt, x, y, tr.ang[i]!, hAt(tr, x, y));
      this.renderWorld(t, []);
      ({ title: () => this.drawTitle(t), menu: () => this.drawMenu(t), options: () => this.drawOptions(), controls: () => this.drawControls(), lan: () => this.drawLan(t), lobby: () => this.drawLobby(t), select: () => this.drawSelect(t), cup: () => this.drawCupSel(t), track: () => this.drawTrackSel() } as Record<string, () => void>)[this.state]!();
      A.engineSet(false, 0);
    } else if (this.world) {
      const w = this.world, p = this.local!;
      if (!this.paused) this.simulate(dt);
      if (this.hitStop > 0) { this.hitStop -= dt; if (this.hitStop <= 0) this.held = null; }
      const tg = this.camTarget()!;
      if (p.respawn > 0 && p.respawn < 0.05) this.rig.cut(tg, this.tr);
      Object.assign(this.cam, this.rig.update(this.paused ? 0 : dt, tg, this.tr));
      if (!this.paused) this.fx.frame(w, dt, this.cam.x, this.cam.y, (k) => this.pose(k), this.tr.th.ground[0]);
      this.updateAtmosphere(w, dt);
      this.renderWorld(w.raceT, w.karts);
      if (this.state === 'replay') this.drawReplayHud(t);
      else if (this.state === 'race') {
        if (!this.paused) this.spawnSpeedLines();
        this.drawParticles(this.paused ? 0 : dt);
        this.drawSmudge();
        this.drawWeather(dt);
        if (this.flashT > 0) { ui.ctx.globalAlpha = Math.min(this.settings.reduceFlash ? 0.2 : 0.6, this.flashT * 2); ui.ctx.fillStyle = this.flashC; ui.ctx.fillRect(0, 0, W, H); ui.ctx.globalAlpha = 1; this.flashT -= dt; }
        if (w.phase === 'countdown') {
          const n = Math.ceil(w.cd);
          ui.txt(n > 0 ? String(n) : '', W / 2, H / 2 - 40, '#ffe45e', 40, 'center');
          ui.txt(this.tr.def.name, W / 2, 34, '#fff7e0', 8, 'center');
          ui.txtS('Truco: acelera justo en el 1 para salir con turbo', W / 2, H - 30);
        } else this.drawHUD(this.paused ? 0 : dt);
        A.engineSet(!this.paused, p.speed + (p.boost > 0 ? 40 : 0));
        this.audioFrame(w, p);
        if (this.paused) { ui.bg(0.7); ui.txt('Pausa', W / 2, 80, '#ffe45e', 24, 'center'); ui.txt('P para seguir', W / 2, 130, '#fff7e0', 8, 'center'); ui.txt('Esc para salir al menú', W / 2, 146, '#fff7e0', 8, 'center'); }
      } else {
        ({ replay: () => {}, results: () => this.drawResults(), standings: () => this.drawStandings(), final: () => this.drawFinal(t), podium: () => this.drawPodiumFree(t) } as Record<string, () => void>)[this.state]!();
        A.engineSet(false, 0);
      }
    }
    // music by state
    if (MENUS.includes(this.state)) A.musicWant('menu');
    else if (this.state === 'loading' || (this.state === 'race' && this.world?.phase === 'countdown')) A.musicWant(null);
    else if (this.state === 'race' && this.local?.finished) A.musicWant(null);
    else if (this.state === 'race' || this.state === 'replay') { const d = this.tr.def, lastLap = this.local!.prog >= ((this.world?.cfg.laps ?? LAPS) - 1) * this.tr.N; A.musicWant(d.song, d.mul * (lastLap ? 1.1 : 1), this.paused ? 0 : 1); }
    else A.musicWant('menu', 1, 0.7);
    this.dbg.draw(ui, this.tr, this.world);
    if (this.toastMsg) { this.toastMsg.life -= dt; ui.txtS(this.toastMsg.t, 4, 4, '#9cff9c', 'left'); if (this.toastMsg.life <= 0) this.toastMsg = null; }
    if (this.showPerf) {
      ui.txtS(`${this.fps.toFixed(0)} fps · ${this.renderer.backend} · sim ${this.simMs.toFixed(2)} ms · render ${this.renderMs.toFixed(2)} ms · ${this.renderer.drawCalls} draw calls`, 4, H - 8, '#9cff9c', 'left');
    }
  }

  private renderWorld(t: number, karts: Kart[]) {
    const w = this.world, views: KartView[] = [], things: ThingView[] = [];
    for (const k of karts) {
      const ps = this.pose(k);
      const vis = !k.out && (k.respawn <= 0 || ((t * 10) | 0) % 2 === 1);
      views.push({ id: k.id, ch: k.ch, x: ps.x, y: ps.y, z: k.respawn > 0 ? ps.z - 6 : ps.z, a: ps.a, lean: k.drift ? k.drift : k.sv, hop: k.hop, spin: k.spin, big: hasFx(k, 'jug'), bubble: hasFx(k, 'bubble'), reflect: hasFx(k, 'reflect'), visible: vis, ground: hAt(this.tr, ps.x, ps.y), air: k.air, trick: this.trickAnim.get(k.id) ?? 0, squash: this.squash.get(k.id) ?? 0, local: k.id === this.localId });
    }
    if (this.ghost && this.state === 'race') {
      const g = this.ghost.world.karts[0]!, pg = this.ghostPrev, a = this.acc / SIM_DT;
      const gx = pg ? lerp(pg.x, g.x, a) : g.x, gy = pg ? lerp(pg.y, g.y, a) : g.y, gz = pg ? lerp(pg.z, g.z, a) : g.z;
      views.push({ id: 100, ch: g.ch, x: gx, y: gy, z: gz, a: g.a, lean: g.sv, hop: 0, spin: 0, big: false, bubble: false, reflect: false, visible: !this.ghost.done, ground: hAt(this.tr, gx, gy), air: g.air, trick: 0, squash: 0, local: false, ghost: true });
    }
    if (w) {
      const me = this.local, tc: ThingCtx = { t, lap: me ? Math.floor(me.prog / this.tr.N) + 1 : 1, lava: this.tr.def.liquid?.kind === 'lava' };
      for (const e of w.ents) THING_ART[e.kind]?.(e, tc, things);
      for (const k of karts) if (k.respawn <= 0) { const ps = this.pose(k); orbitArt(k, ps.x, ps.y, ps.z, t, things); }
    }
    const boxes = w ? w.boxes.map((b) => b.active) : this.tr.boxes.map(() => true);
    const t0 = performance.now();
    this.renderer.render(this.cam, views, things, boxes, t, w?.water ?? this.tr.water?.base ?? 0, 1 / 60);
    this.renderMs = performance.now() - t0;
    if (w && (this.state === 'race' || this.state === 'replay')) this.drawLabels(karts.filter((k) => !k.out));
  }

  private drawLabels(karts: Kart[]) {
    const ui = this.ui;
    for (const k of karts) {
      const ps = this.pose(k), top = this.renderer.project(ps.x, ps.y, ps.z + 15);
      if (!top) continue;
      const depth = 320 / top.k;
      if (depth > ZMAX) continue;
      const lx = Math.round(top.sx * UIK), ly = Math.round(top.sy * UIK);
      const me = k.id === this.localId;
      const lab = kartLabel(k, me);
      if (lab) ui.txtS(lab[0], lx, ly - (me ? 0 : 12), lab[1]);
      if (!me && depth < 260 && top.k * 12.5 * UIK >= 9) ui.txtS(CHARS[k.ch]!.short, lx, ly - 4, k.team >= 0 ? TEAM_COL[k.team]! : '#fff7e0');
    }
  }

  /** Screen-space speed lines at high speed (the rest of the particles are 3D, see feel/fx3d.ts). */
  private spawnSpeedLines() {
    const p = this.local!;
    if (p.respawn > 0) return;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    if (p.speed > 120 && Math.random() < (p.boost > 0 ? 0.9 : 0.4)) this.parts.push({ x: r(0, W), y: r(H * 0.55, H), vx: 0, vy: 0, life: 0.08, c: 'rgba(255,255,255,0.35)', s: 1, line: true });
    if (p.slip > 0.3 && Math.random() < 0.5) this.parts.push({ x: r(W * 0.2, W * 0.8), y: r(H * 0.3, H * 0.8), vx: 0, vy: 0, life: 0.1, c: 'rgba(200,240,255,' + (0.2 + p.slip * 0.3).toFixed(2) + ')', s: 1, line: true });
  }
  private drawParticles(dt: number) {
    const ctx = this.ui.ctx;
    for (const p of this.parts) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.fillStyle = p.c;
      if (p.line) { const dx = (p.x - W / 2) * 0.12, dy = (p.y - H * 0.42) * 0.12; ctx.fillRect(p.x, p.y, Math.max(0.5, Math.abs(dx)), Math.max(0.5, Math.abs(dy))); }
      else ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    this.parts = this.parts.filter((p) => p.life > 0);
  }
  /** Day → night over the race, fog from its lap on (visual only; grip is in core). */
  private fogK = 0;
  private rain: { x: number; y: number }[] = [];
  private updateAtmosphere(w: World, dt: number) {
    const a = this.tr.authored, p = this.local;
    let night = 0, fog = 0;
    if (a?.dayNight) {
      let lead = 0;
      for (const k of w.karts) lead = Math.max(lead, k.prog);
      night = clamp((lead / (w.cfg.laps * this.tr.N) - 0.15) / 0.75, 0, 1);
    }
    const wt = a?.weather, on = !!(wt && p && Math.floor(p.prog / this.tr.N) + 1 >= wt.fromLap);
    if (on && wt!.kind === 'noche') night = 1;
    if (on && (wt!.kind === 'niebla' || wt!.kind === 'arena')) fog = wt!.kind === 'niebla' ? 1 : 0.6;
    this.fogK += (fog - this.fogK) * Math.min(1, dt * 0.8);
    this.renderer.setAtmosphere(night, this.fogK);
  }
  /** Rain streaks and sand haze over the screen when the track's weather is on for the local kart. */
  private drawWeather(dt: number) {
    const wt = this.tr.authored?.weather, p = this.local, ctx = this.ui.ctx;
    if (!wt || !p || Math.floor(p.prog / this.tr.N) + 1 < wt.fromLap) { this.rain.length = 0; return; }
    if (wt.kind === 'lluvia') {
      while (this.rain.length < 70) this.rain.push({ x: Math.random() * W, y: Math.random() * H });
      ctx.strokeStyle = 'rgba(200,225,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.rain) {
        d.y += 420 * dt; d.x -= 60 * dt;
        if (d.y > H) { d.y = -8; d.x = Math.random() * (W + 40); }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 8);
      }
      ctx.stroke();
    } else if (wt.kind === 'arena') {
      ctx.fillStyle = 'rgba(232,190,120,0.16)';
      ctx.fillRect(0, 0, W, H);
      while (this.rain.length < 40) this.rain.push({ x: Math.random() * W, y: Math.random() * H });
      ctx.fillStyle = 'rgba(255,230,170,0.5)';
      for (const d of this.rain) { d.x -= 300 * dt; d.y += 20 * dt; if (d.x < 0) { d.x = W; d.y = Math.random() * H; } ctx.fillRect(d.x, d.y, 6, 1); }
    }
  }
  /** Smoke curtain covering the local kart's view. */
  private drawSmudge() {
    const p = this.local, ctx = this.ui.ctx;
    const sk = p ? fxOf(p, 'smoke') : undefined;
    if (sk) {
      ctx.globalAlpha = Math.min(0.75, sk.t * 1.5);
      for (const [x, y, r, c] of [[80, 120, 60, '#8a8898'], [200, 100, 70, '#b8b6c4'], [320, 140, 64, '#9a98a8'], [150, 190, 50, '#c4c2d0'], [270, 200, 56, '#8a8898']] as const) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- HUD ----------------
  private drawHUD(dt: number) {
    const sc = this.settings.hudScale;
    this.ui.ctx.save();
    this.ui.ctx.scale(sc, sc);
    try { this.drawHUDScaled(dt, W / sc, H / sc); } finally { this.ui.ctx.restore(); }
  }
  private drawHUDScaled(dt: number, W: number, H: number) {
    const ui = this.ui, ctx = ui.ctx, w = this.world!, p = this.local!, tr = this.tr;
    const laps = w.cfg.laps, lap = clamp(Math.floor(p.prog / tr.N) + 1, 1, laps);
    ui.panel(4, 4, 82, this.mode === 'cup' ? 32 : 26, 'rgba(27,23,64,0.75)', '#6d66b0');
    ui.txt('Vuelta ' + lap + '/' + laps, 8, 8);
    if (w.cfg.mode === 'elimination') {
      const alive = w.karts.filter((k) => !k.out);
      ui.txtS('Quedan ' + alive.length, 8, 34, '#ff8a1f', 'left');
      if (!p.out && alive.length > 1 && w.ranked.filter((id) => !w.karts[id]!.out).at(-1) === p.id && ((w.raceT * 3) | 0) % 2 === 0) ui.txt('¡Vas último!', W / 2, H / 2 - 30, '#ff4d6d', 8, 'center');
    }
    if (this.ghost) { const g = this.ghost.world.karts[0]!; ui.txtS('Fantasma ' + (g.prog > p.prog ? '+' : '-') + Math.abs(((g.prog - p.prog) * 6) / Math.max(60, p.speed)).toFixed(1) + ' s', 8, 34, '#bff0ff', 'left'); }
    ui.txt(fmtTime(w.raceT), 8, 19, '#ffe45e');
    if (this.mode === 'cup' && this.cup) ui.txtS('Carrera ' + (this.cup.race + 1) + '/' + this.cup.def.tracks.length, 8, 30, '#fff7e0', 'left');
    const pos = p.rank + 1;
    if (p.rank !== this.lastRank) { this.posPop = this.lastRank >= 0 ? 1 : 0; this.lastRank = p.rank; }
    this.posPop = Math.max(0, this.posPop - dt * 4);
    const pop = 1 + Math.sin(this.posPop * Math.PI) * 0.35;
    ctx.save(); ctx.translate(W - 8, 6); ctx.scale(pop, pop);
    ui.txt(pos + 'º', 0, 0, pos === 1 ? '#ffe45e' : pos <= 3 ? '#fff7e0' : '#c8c4f0', 24, 'right');
    ctx.restore();
    const bx = W / 2 - 15, by = 5;
    ui.panel(bx, by, 30, 30, '#1b1740', p.roll > 0 ? (((w.raceT * 10) | 0) % 2 ? '#ffe45e' : '#fff7e0') : '#fff7e0');
    const list = itemList();
    let icon = null;
    if (p.roll > 0) icon = ICONS[list[((w.raceT * 18) | 0) % list.length]!.id];
    else if (p.item) icon = ICONS[p.item];
    if (icon) ui.img(icon.cv, bx + 3, by + 3, 24, 24);
    if (p.item && p.roll <= 0 && p.itemN > 1) ui.txtS('×' + p.itemN, bx + 28, by + 22, '#ffe45e', 'left');
    // coins (GDD §4.1): count and a pop when they are lost
    if (w.ents.some((e) => e.kind === 'coin') || p.coins > 0) {
      this.coinPop = Math.max(0, this.coinPop - dt * 3);
      const cx = bx - 30, cy = by + 8, shake = this.coinPop > 0 ? Math.sin(this.coinPop * 40) * 2 : 0;
      ui.img(COIN[0]!.cv, cx + shake, cy, 10, 10);
      ui.txtS('×' + p.coins, cx + 12 + shake, cy + 2, p.coins >= T.race.coins.max ? '#ffe45e' : this.coinPop > 0 ? '#ff4d6d' : '#fff7e0', 'left');
    }
    if (p.item && p.roll <= 0) ui.txtS(itemDef(p.item).name, W / 2, by + 36);
    const st = hudLines(p);
    if (p.glide) st.push(['¡Volando!', '#8fe0ff']);
    st.forEach(([s, c], i) => ui.txtS(s, W / 2, by + 46 + i * 9, c));
    if (hasFx(p, 'inv') && ((w.raceT * 4) | 0) % 2 === 0) ui.txt('¡Controles invertidos!', W / 2, H / 2 - 40, '#ff6ad0', 8, 'center');
    const m = this.mini(tr), mx = W - 62, my = H - 62;
    ui.panel(mx - 2, my - 2, 60, 60, 'rgba(27,23,64,0.55)', '#6d66b0');
    ui.img(m.cv, mx, my);
    for (const k of w.karts) {
      const x = mx + k.x * m.k, y = my + k.y * m.k, r = k.id === this.localId ? 3 : 2;
      ctx.fillStyle = OUT; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      if (k.id === this.localId) { ctx.fillStyle = '#fff7e0'; ctx.fillRect(x - 2, y - 2, 4, 4); }
      ctx.fillStyle = CHARS[k.ch]!.helmet; ctx.fillRect(x - 1, y - 1, 2, 2);
      if (k.rank === 0) { ctx.fillStyle = '#ffd23a'; ctx.fillRect(x - 2, y - r - 2, 1, 1); ctx.fillRect(x, y - r - 3, 1, 1); ctx.fillRect(x + 1, y - r - 2, 1, 1); }
    }
    w.ranked.forEach((id, i) => {
      const k = w.karts[id]!, y = 44 + i * 17;
      if (id === this.localId) { ctx.fillStyle = 'rgba(255,228,94,0.35)'; ctx.fillRect(4, y - 1, 34, 17); }
      ui.img(FACES[k.ch]!.cv, 5, y, 16, 16);
      ui.txtS(String(i + 1), 26, y + 5, k.out ? '#6d66b0' : id === this.localId ? '#ffe45e' : k.team >= 0 ? TEAM_COL[k.team]! : '#fff7e0', 'left');
    });
    if (p.drift) {
      const L3 = T.driving.drift.level3, c = (this.fx.colorblind ? DRIFT_COL_CB : DCOL)[p.dLvl]!, ww = Math.min(60, (p.dc / L3) * 60);
      ui.panel(W / 2 - 31, H - 14, 62, 6, '#1b1740'); ctx.fillStyle = c; ctx.fillRect(W / 2 - 30, H - 13, ww, 4);
    }
    if (this.incoming) {
      this.incoming.t -= dt;
      if (this.incoming.t <= 0) this.incoming = null;
      else if (((w.raceT * 8) | 0) % 2 === 0) {
        const ix = W / 2, iy = H - 46;
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.moveTo(ix - 14, iy + 14); ctx.lineTo(ix + 14, iy + 14); ctx.lineTo(ix, iy + 26); ctx.fill();
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.moveTo(ix - 11, iy + 15); ctx.lineTo(ix + 11, iy + 15); ctx.lineTo(ix, iy + 24); ctx.fill();
        const ic = ICONS[this.incoming.item];
        if (ic) ui.img(ic.cv, ix - 8, iy - 4, 16, 16);
        ui.txtS('¡Detrás!', ix, iy - 12, '#ff4d6d');
      }
    }
    if (p.backT > 0.8 && !p.finished && ((w.raceT * 3) | 0) % 2 === 0) ui.txt('¡Sentido contrario!', W / 2, H / 2 - 30, '#ff4d6d', 8, 'center');
    if (this.banner) {
      this.banner.life -= dt;
      ui.txt(this.banner.t, W / 2, this.banner.big ? H / 2 - 24 : 66, '#ffe45e', this.banner.big ? 24 : 16, 'center');
      if (this.banner.life <= 0) this.banner = null;
    }
    if (this.audio.muted) ui.txtS('Sin sonido', W / 2, H - 24);
  }

  // ---------------- LAN ----------------
  /** LAN menu fields: 0 name, 1 address, then (desktop app) 2 create game, 3 search, 4.. found games. */
  private lanFieldCount() { return desktop() ? 4 + this.lanFound.length : 2; }
  private lanInput(code: string, back: boolean, U: boolean, D: boolean) {
    if (back) { this.input.textMode = false; this.state = 'menu'; return; }
    const n = this.lanFieldCount();
    if (U) { this.lanField = (this.lanField + n - 1) % n; }
    if (D || code === 'Tab') { this.lanField = (this.lanField + 1) % n; }
    this.input.textMode = this.lanField < 2;
    if (code !== 'Enter' && code !== 'NumpadEnter' && code !== 'Pad0') return;
    const d = desktop();
    if (this.lanField < 2) { this.input.textMode = false; this.connectLan(); return; }
    if (!d) return;
    if (this.lanField === 2) {
      void d.host(this.lanName).then((h) => { this.lanHosting = h.addresses; this.toast('Partida creada. Tus amigos se conectan a ' + (h.addresses[0] ?? 'tu IP') + ':' + h.port); this.connectLan('localhost'); });
    } else if (this.lanField === 3) {
      this.toast('Buscando partidas en la red...');
      void d.discover().then((list) => { this.lanFound = list; this.toast(list.length ? list.length + ' partida(s) encontrada(s)' : 'No se encontró ninguna partida'); });
    } else {
      const g = this.lanFound[this.lanField - 4];
      if (g) this.connectLan(g.address + ':' + g.port);
    }
  }
  private typeInto() {
    for (const ch of this.input.typed.splice(0)) {
      const field = this.lanField === 0 ? 'lanName' : 'lanAddr';
      if (ch === 'Backspace') this[field] = this[field].slice(0, -1);
      else if (this[field].length < (field === 'lanName' ? 12 : 40)) this[field] += ch;
    }
  }
  connectLan(addr = this.lanAddr, name = this.lanName) {
    this.net?.close();
    const net = new NetSession(NetSession.urlFrom(addr), name || 'Jugador', (i) => this.tracks.ensureBuilt(i, [this.tr]), () => this.startNetRace(), () => { this.state = 'results'; });
    this.net = net;
    net.connect();
    this.state = 'lobby';
  }
  private leaveNet() {
    if (this.lanHosting) { void desktop()?.stopHost(); this.lanHosting = null; }
    this.net?.close();
    this.net = null;
    this.world = null;
    this.renderer.clearKarts();
    this.state = 'menu';
  }
  private startNetRace() {
    const r = this.net!.race!;
    this.curTrack = r.cfg.trackIndex;
    this.tr = this.tracks.get(r.cfg.trackIndex);
    this.renderer.setTrack(this.tr);
    this.renderer.clearKarts();
    this.world = r.world;
    this.localId = r.kart;
    this.prev = this.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    this.mode = r.cfg.mode === 'cup' ? 'cup' : 'free';
    this.rig.cut(this.camTarget()!, this.tr);
    this.acc = 0; this.banner = null; this.flashT = 0; this.parts = []; this.paused = false; this.incoming = null;
    this.state = 'race';
  }
  private simulateNet(dt: number) {
    const net = this.net!, r = net.race!;
    this.acc = Math.min(this.acc + dt, SIM_DT * 5);
    const t0 = performance.now();
    while (this.acc >= SIM_DT) {
      this.world = r.world;
      this.prev = r.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
      const { packed, events } = r.tick(this.localInput());
      this.itemPressed = false;
      net.send({ t: 'in', i: [packed] });
      for (const e of events) { this.onEvent(e); this.fx.event(e, r.world); if (e.type === 'trick') this.trickAnim.set(e.kart, 0.001); if (e.type === 'land') this.squash.set(e.kart, 1); }
      this.tickAnims(SIM_DT);
      this.acc -= SIM_DT;
    }
    net.smooth(dt);
    this.simMs = performance.now() - t0;
  }
  private lobbyInput(_code: string, ok: boolean, back: boolean, L: boolean, R: boolean, U: boolean, D: boolean) {
    const net = this.net;
    if (!net) { this.state = 'menu'; return; }
    if (back) { this.leaveNet(); return; }
    if (net.status === 'closed') { if (ok) { this.state = 'lan'; this.input.textMode = true; } return; }
    const me = net.me;
    if (!me) return;
    if (L || R) net.send({ t: 'pick', ch: (me.ch + (L ? 7 : 1)) % 8 });
    if (_code === 'KeyR' || (ok && !net.isHost)) net.send({ t: 'ready', ready: !me.ready });
    if (net.isHost) {
      const s = { ...net.settings };
      if (U || D) { s.mode = s.mode === 'cup' ? 'free' : 'cup'; net.send({ t: 'settings', s }); }
      if (_code === 'KeyQ' || _code === 'KeyE') {
        const dir = _code === 'KeyE' ? 1 : -1;
        if (s.mode === 'cup') s.cup = (s.cup + dir + CUPS.length) % CUPS.length;
        else { const gi = this.grid.indexOf(s.trackIndex); s.trackIndex = this.grid[(Math.max(0, gi) + dir + this.grid.length) % this.grid.length]!; }
        net.send({ t: 'settings', s });
      }
      if (_code === 'KeyF') { s.diff = (s.diff + 1) % 3; net.send({ t: 'settings', s }); }
      if (ok) net.send({ t: 'start' });
    }
  }
  private drawLan(t: number) {
    const ui = this.ui, ox = (W - 300) / 2;
    this.typeInto();
    ui.bg(0.85);
    ui.txt('Multijugador LAN', W / 2, 10, '#ffe45e', 16, 'center');
    const caret = ((t * 2) | 0) % 2 ? '_' : ' ';
    [['Tu nombre', this.lanName], ['Anfitrión (IP o nombre)', this.lanAddr]].forEach(([k, v], i) => {
      const y = 50 + i * 44, on = i === this.lanField;
      ui.txtS(k!, ox, y, '#9c95d6', 'left');
      ui.panel(ox, y + 10, 300, 18, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      ui.txt(v + (on ? caret : ''), ox + 6, y + 15, '#fff7e0');
    });
    const d = desktop();
    if (d) {
      const rows = ['Crear partida (en este PC)', 'Buscar partidas en la red', ...this.lanFound.map((g) => `Unirse a ${g.name} · ${g.address} · ${g.players} jugador(es)`)];
      rows.forEach((r, i) => {
        const y = 142 + i * 15, on = this.lanField === i + 2;
        ui.panel(ox, y, 300, 12, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
        ui.txtS(r, ox + 6, y + 3, on ? '#ffe45e' : '#fff7e0', 'left');
      });
      ui.txtS('Si Windows pregunta por el firewall, permite el acceso en redes privadas.', W / 2, 214, '#9c95d6');
    } else ui.txtS('El anfitrión ejecuta "bun run server" o crea la partida desde la app de escritorio.', W / 2, 160, '#fff7e0');
    ui.txtS('Puerto ' + 7777 + ' · Intro para conectar · ↑↓ cambia de campo · Esc vuelve', W / 2, 226, '#9c95d6');
  }
  private drawLobby(t: number) {
    const ui = this.ui, net = this.net, ox = (W - 340) / 2;
    ui.bg(0.85);
    ui.txt('Sala LAN', W / 2, 8, '#ffe45e', 16, 'center');
    if (!net) return;
    if (net.status === 'connecting') { ui.txt('Conectando a ' + net.url + '...', W / 2, 100, '#fff7e0', 8, 'center'); return; }
    if (net.status === 'closed') { ui.txt(net.error || 'Conexión cerrada', W / 2, 96, '#ff6a6a', 8, 'center'); ui.txtS('Intro: volver a intentar · Esc: menú', W / 2, 120, '#9c95d6'); return; }
    const S = net.settings;
    const what = S.mode === 'cup' ? CUPS[S.cup]!.name + (net.phase !== 'lobby' ? ` · carrera ${net.cupRace + 1}` : '') : this.tracks.get(S.trackIndex).def.name;
    ui.panel(ox, 30, 340, 22, '#1b1740', '#6d66b0');
    ui.txt((S.mode === 'cup' ? 'Copa: ' : 'Carrera: ') + what, ox + 6, 34, '#fff7e0');
    ui.txtS('IA: ' + DIFFS[S.diff]!.name + ' · ' + net.players.length + ' humano(s) + ' + (8 - net.players.length) + ' IA', ox + 6, 45, '#9c95d6', 'left');
    net.players.forEach((p, i) => {
      const y = 60 + i * 18, me = p.id === net.id;
      ui.panel(ox, y, 340, 15, me ? '#3a3478' : '#241f55', me ? '#ffe45e' : '#6d66b0');
      ui.img(FACES[p.ch]!.cv, ox + 4, y - 1, 16, 16);
      ui.txt(p.name + (p.host ? ' ★' : ''), ox + 26, y + 4, me ? '#ffe45e' : '#fff7e0');
      ui.txt(CHARS[p.ch]!.short, ox + 200, y + 4, '#9c95d6');
      ui.txt(p.host ? 'anfitrión' : p.ready ? 'listo ✓' : 'no listo', ox + 334, y + 4, p.ready || p.host ? '#9cff9c' : '#ff8a9a', 8, 'right');
    });
    const help = net.isHost
      ? '←→ piloto · ↑↓ modo · Q/E pista · F IA · Intro: ¡empezar!'
      : '←→ personaje · Intro o R: listo · espera al anfitrión';
    ui.txtS(help, W / 2, 214, '#9c95d6');
    ui.txtS('Esc: salir de la sala', W / 2, 226, '#9c95d6');
    void t;
  }

  // ---------------- settings ----------------
  applySettings() {
    const S = this.settings;
    this.audio.setVolumes(S.volume.music, S.volume.sfx);
    this.rig.shakeScale = S.shake;
    this.fx.colorblind = S.colorblind;
    this.renderer.post.enabled = S.post;
    for (const [a, ks] of Object.entries(S.keys)) if (ks?.length) (this.input.bindings as any)[a] = [...ks];
    for (const [a, bs] of Object.entries(S.pad)) if (bs) (this.input.pad.bindings as any)[a] = [...bs];
  }
  private storeSettings() {
    const S = this.settings;
    S.keys = Object.fromEntries(REMAPPABLE.map((a) => [a, this.input.bindings[a]]));
    S.pad = Object.fromEntries(REMAPPABLE.map((a) => [a, this.input.pad.bindings[a]]));
    saveSettings(S);
    this.applySettings();
  }
  private optionRows(): [string, string][] {
    const S = this.settings, onoff = (b: boolean) => (b ? 'Sí' : 'No');
    return [
      ['Música', '■'.repeat(Math.round(S.volume.music * 10)).padEnd(10, '·')],
      ['Efectos', '■'.repeat(Math.round(S.volume.sfx * 10)).padEnd(10, '·')],
      ['Sacudida de cámara', S.shake >= 1 ? 'Normal' : S.shake > 0 ? 'Reducida' : 'No'],
      ['Reducir destellos', onoff(S.reduceFlash)],
      ['Modo daltónico', onoff(S.colorblind)],
      ['Tamaño del HUD', S.hudScale > 1 ? '1,5×' : '1×'],
      ['Post-proceso', onoff(S.post)],
      ['Derrape', S.driftToggle ? 'Alternar' : 'Mantener'],
      ['Controles…', ''],
      ['Restaurar valores', ''],
      ['Volver', ''],
    ];
  }
  private optionsInput(_code: string, ok: boolean, back: boolean, L: boolean, R: boolean, U: boolean, D: boolean) {
    const S = this.settings, n = this.optionRows().length, A = this.audio;
    if (U) { this.optSel = (this.optSel + n - 1) % n; A.blip(); }
    if (D) { this.optSel = (this.optSel + 1) % n; A.blip(); }
    if (back) { this.storeSettings(); this.state = 'menu'; return; }
    const step = L ? -1 : R || ok ? 1 : 0;
    if (!step) return;
    const c = (v: number) => Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    switch (this.optSel) {
      case 0: S.volume.music = c(S.volume.music + step * 0.1); break;
      case 1: S.volume.sfx = c(S.volume.sfx + step * 0.1); break;
      case 2: S.shake = S.shake >= 1 ? (step > 0 ? 0.3 : 0) : S.shake > 0 ? (step > 0 ? 0 : 1) : step > 0 ? 1 : 0.3; break;
      case 3: S.reduceFlash = !S.reduceFlash; break;
      case 4: S.colorblind = !S.colorblind; break;
      case 5: S.hudScale = S.hudScale > 1 ? 1 : 1.5; break;
      case 6: S.post = !S.post; break;
      case 7: S.driftToggle = !S.driftToggle; break;
      case 8: if (ok) { this.state = 'controls'; this.ctlSel = 0; } break;
      case 9: if (ok) { this.settings = structuredClone(DEFAULT_SETTINGS); this.input.resetBindings(); this.toast('Valores restaurados'); } break;
      case 10: if (ok) { this.storeSettings(); this.state = 'menu'; return; } break;
    }
    A.blip();
    this.storeSettings();
  }
  private controlsInput(code: string, ok: boolean, back: boolean, U: boolean, D: boolean) {
    const n = REMAPPABLE.length + 1;
    if (U) { this.ctlSel = (this.ctlSel + n - 1) % n; this.audio.blip(); }
    if (D) { this.ctlSel = (this.ctlSel + 1) % n; this.audio.blip(); }
    if (back || (ok && this.ctlSel === REMAPPABLE.length)) { this.storeSettings(); this.state = 'options'; return; }
    if (ok && this.ctlSel < REMAPPABLE.length) {
      const action = REMAPPABLE[this.ctlSel]!;
      this.toast('Pulsa una tecla o un botón para «' + ACTION_NAMES[action] + '»…');
      this.input.capture = (c) => {
        if (c === 'Escape') { this.toast('Cancelado'); return; }
        const lost = this.input.rebind(action, c);
        this.toast(lost ? `Asignado. «${ACTION_NAMES[lost]}» ya no usa esa tecla.` : 'Asignado.');
        this.storeSettings();
      };
    }
    void code;
  }
  private keyName(code: string) {
    const N: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ShiftLeft: 'Mayús', ShiftRight: 'Mayús d.', Space: 'Espacio', Enter: 'Intro', ControlLeft: 'Ctrl', ControlRight: 'Ctrl d.', AltLeft: 'Alt', Tab: 'Tab' };
    return N[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  }
  private drawOptions() {
    const ui = this.ui, rows = this.optionRows(), ox = (W - 300) / 2;
    ui.bg(0.82);
    ui.txt('Opciones', W / 2, 8, '#ffe45e', 16, 'center');
    rows.forEach(([k, v], i) => {
      const y = 32 + i * 17, on = i === this.optSel;
      ui.panel(ox, y, 300, 13, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      ui.txt(k, ox + 6, y + 3, on ? '#ffe45e' : '#fff7e0');
      if (v) ui.txt((on ? '< ' : '') + v + (on ? ' >' : ''), ox + 294, y + 3, '#fff7e0', 8, 'right');
    });
    ui.txtS('Flechas o mando para cambiar · Esc para volver (se guarda solo)', W / 2, 226, '#9c95d6');
  }
  private drawControls() {
    const ui = this.ui, ox = (W - 340) / 2, I = this.input;
    ui.bg(0.85);
    ui.txt('Controles', W / 2, 8, '#ffe45e', 16, 'center');
    [...REMAPPABLE, null].forEach((a, i) => {
      const y = 32 + i * 19, on = i === this.ctlSel;
      ui.panel(ox, y, 340, 15, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      if (!a) { ui.txt('Volver', ox + 6, y + 4, on ? '#ffe45e' : '#fff7e0'); return; }
      ui.txt(ACTION_NAMES[a], ox + 6, y + 4, on ? '#ffe45e' : '#fff7e0');
      ui.txtS(I.bindings[a].slice(0, 2).map((k) => this.keyName(k)).join(' / ') || '—', ox + 200, y + 5, '#fff7e0', 'left');
      ui.txtS(I.pad.bindings[a].map((b) => PAD_NAMES[b] ?? 'B' + b).join(' / ') || '—', ox + 300, y + 5, '#8fe0ff', 'left');
    });
    ui.txtS(I.pad.connected ? 'Mando conectado' : 'Sin mando (conéctalo y pulsa un botón)', W / 2, 212, I.pad.connected ? '#9cff9c' : '#9c95d6');
    ui.txtS('Enter: cambiar · si la tecla ya se usaba, se quita de la otra acción', W / 2, 226, '#9c95d6');
  }

  /** Positional rival engines + adaptive music intensity. */
  private audioFrame(w: World, p: Kart) {
    const near = w.karts.filter((k) => k !== p && k.respawn <= 0).map((k) => {
      const dx = k.x - p.x, dy = k.y - p.y, dist = Math.hypot(dx, dy);
      return { dist, pan: Math.sin(Math.atan2(dy, dx) - this.cam.a), speed: k.speed };
    }).sort((a, b) => a.dist - b.dist).slice(0, 3);
    this.audio.rivalEngines(near);
    const crowd = near.filter((r) => r.dist < 120).length / 3, lastLap = p.prog >= (w.cfg.laps - 1) * this.tr.N ? 0.35 : 0;
    this.audio.intensity = Math.min(1, 0.25 + crowd * 0.4 + lastLap + (p.rank === 0 ? 0.1 : 0) + (p.boost > 0 ? 0.1 : 0));
  }

  // ---------------- menus ----------------
  private drawTitle(t: number) {
    const ui = this.ui, ctx = ui.ctx;
    ui.bg(0.25);
    ctx.font = '40px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const y = 40 + Math.round(Math.sin(t * 2) * 2);
    for (let i = 6; i > 0; i--) { ctx.fillStyle = i > 3 ? OUT : '#e8455a'; ctx.fillText('JP KART', W / 2 + i, y + i); }
    ctx.fillStyle = '#ffe45e'; ctx.fillText('JP KART', W / 2, y); ctx.fillStyle = '#fff7b0'; ctx.fillText('JP KART', W / 2, y - 1); ctx.fillStyle = '#ffe45e'; ctx.fillText('JP KART', W / 2, y + 1);
    ctx.fillStyle = '#ff8a1f'; ctx.fillRect(W / 2 - 128, y + 46, 256, 2);
    ui.txt('Gran Premio Pixel', W / 2, y + 56, '#fff7e0', 8, 'center');
    const b = Math.round(Math.abs(Math.sin(t * 3)) * 14);
    ui.img(BIGBALL.cv, W / 2 + 104, y - 14 - b, 20, 20);
    CHARS.forEach((_, i) => { const x = W / 2 - 140 + i * 35, bb = Math.round(Math.sin(t * 5 + i) * 2); ui.img(FACES[i]!.cv, x, 146 + bb, 32, 32); });
    if (((t * 2) | 0) % 2 === 0) ui.txt('Pulsa Enter para jugar', W / 2, 202, '#fff7e0', 8, 'center');
  }
  private drawMenu(t: number) {
    const ui = this.ui;
    ui.bg(0.6);
    ui.txt('JP KART', W / 2, 10, '#ffe45e', 24, 'center');
    const items = ['Torneo', 'Carrera libre', 'Contrarreloj', 'Eliminación', 'Multijugador LAN', 'Dificultad: ' + DIFFS[this.diff]!.name, 'Opciones'];
    const help = ['4 copas de 4 carreras. Se suman los puntos.', 'Elige cualquiera de las pistas, nuevas o clásicas.', 'Tú solo contra el reloj y tu fantasma.', 'El último de cada vuelta queda fuera.', 'Juega con amigos en la misma red.', 'Qué tan rápidos y listos son los rivales.', 'Sonido, accesibilidad, gráficos y controles.'];
    items.forEach((s, i) => {
      const on = i === this.menuSel, y = 46 + i * 20;
      ui.panel(W / 2 - 90, y, 180, 18, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      if (on) ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 84, y + 2, 14, 14);
      ui.txt(i === 5 ? (on ? '< ' : '') + s + (on ? ' >' : '') : s, W / 2, y + 5, on ? '#ffe45e' : '#fff7e0', 8, 'center');
    });
    ui.txtS(help[this.menuSel]!, W / 2, 194);
    ui.txtS('Flechas para moverte, Enter para elegir', W / 2, 214, '#9c95d6');
  }
  private statBar10(key: StatKey, v: number, x: number, y: number) {
    const ui = this.ui, ctx = ui.ctx;
    ui.txtS(STAT_SHORT[key], x, y, '#fff7e0', 'left');
    for (let i = 0; i < 10; i++) {
      const f = clamp(v - i, 0, 1);
      ctx.fillStyle = OUT; ctx.fillRect(x + 40 + i * 6, y - 1, 5, 7);
      ctx.fillStyle = '#3a3478'; ctx.fillRect(x + 41 + i * 6, y, 3, 5);
      if (f > 0) { ctx.fillStyle = i < 4 ? '#2ec46b' : i < 7 ? '#ffe45e' : '#ff8a1f'; ctx.fillRect(x + 41 + i * 6, y, Math.max(1, Math.round(3 * f)), 5); }
    }
    ui.txtS(String(v), x + 104, y, '#fff7e0', 'left');
  }
  private drawSelect(t: number) {
    const ui = this.ui, ox = (W - 320) / 2;
    ui.bg();
    ui.txt('Elige piloto', W / 2, 6, '#ffe45e', 16, 'center');
    CHARS.forEach((c, i) => {
      const col = i % 4, row = i >> 2, x = ox + 18 + col * 74, y = 28 + row * 56, on = i === this.sel;
      ui.panel(x, y, 62, 48, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      const b = on ? Math.round(Math.sin(t * 8) * 1.5) : 0;
      ui.img(FACES[i]!.cv, x + 15, y + 2 + b, 32, 32);
      ui.txtS(c.short, x + 31, y + 37, on ? '#ffe45e' : '#fff7e0');
    });
    const c = CHARS[this.sel]!;
    ui.panel(ox + 10, 144, 300, 90, '#1b1740');
    ui.img(rotFrames(this.sel)[((t * 10) | 0) % 24]!.cv, ox + 262, 142, 42, 42);
    ui.txt(c.name, ox + 18, 150, '#ffe45e');
    ui.txtS(c.desc, ox + 18, 162, '#fff7e0', 'left');
    (['vel', 'ace', 'man', 'sue', 'pes', 'vue'] as StatKey[]).forEach((k, i) => this.statBar10(k, c.st[k], ox + 18 + (i % 2) * 124, 176 + ((i / 2) | 0) * 13));
    ui.txtS(this.mode === 'cup' ? 'Torneo' : 'Carrera libre', ox + 282, 196, '#9c95d6');
    ui.txtS(DIFFS[this.diff]!.name, ox + 282, 206, '#9c95d6');
    ui.txtS('Clase: ' + c.weightClass, ox + 282, 186, '#9c95d6');
    ui.txtS('Enter', ox + 282, 218, '#9c95d6');
  }
  private drawCupSel(t: number) {
    const ui = this.ui, ox = (W - 320) / 2;
    ui.bg();
    ui.txt('Elige copa', W / 2, 8, '#ffe45e', 16, 'center');
    CUPS.forEach((c, i) => {
      const x = ox + 12 + (i % 2) * 152, y = 28 + ((i / 2) | 0) * 90, on = i === this.cupSel, open = cupUnlocked(this.progress, i, this.allUnlocked);
      ui.panel(x, y, 144, 84, on ? '#3a3478' : '#241f55', on ? c.col : '#6d66b0');
      const best = this.progress.cups[c.id + ':' + this.cls];
      if (best && best <= 3) ui.txtS(['', 'Oro', 'Plata', 'Bronce'][best]!, x + 136, y + 8, ['', '#ffd23a', '#c8ccdc', '#d9894a'][best]!, 'right');
      if (!open) { ui.txt('Bloqueada', x + 72, y + 40, '#9c95d6', 8, 'center'); ui.txtS('Podio en la anterior', x + 72, y + 56, '#6d66b0'); return; }
      ui.trophy(x + 18, y + 10 + (on ? Math.round(Math.sin(t * 6)) : 0), c.col);
      ui.txt(c.name.replace('Copa ', ''), x + 38, y + 8, on ? c.col : '#fff7e0');
      c.tracks.forEach((ti, j) => { const d = this.tracks.get(ti).def; ui.txtS(d.name + (d.flight ? ' *' : ''), x + 38, y + 26 + j * 13, '#fff7e0', 'left'); });
    });
    this.drawClassLine(212);
    ui.txtS('Puntos: 15 12 10 8 6 4 2 1', W / 2, 224, '#9c95d6');
  }
  private drawTrackSel() {
    const ui = this.ui, ctx = ui.ctx, ox = (W - 320) / 2;
    ui.bg();
    ui.txt('Elige circuito', W / 2, 6, '#ffe45e', 16, 'center');
    this.trackCups.forEach((c, r) => ui.txtS(c.name.replace('Copa ', '').replace('Clásica ', ''), ox + 38, 28 + r * 44 + 16, c.col));
    this.grid.forEach((ti, i) => {
      const trk = this.tracks.get(ti);
      const r = i >> 2, x = ox + 66 + (i % 4) * 62, y = 26 + r * 44, on = i === this.trackSel;
      ui.panel(x, y, 56, 38, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : this.trackCups[r]!.col);
      ctx.fillStyle = trk.th.ground[0]; ctx.fillRect(x + 14, y + 5, 28, 28);
      ui.img(this.mini(trk).cv, x + 14, y + 5, 28, 28);
      if (trk.def.flight) ui.txtS('*', x + 50, y + 2, '#8fe0ff');
    });
    const d = this.tracks.get(this.grid[this.trackSel]!).def;
    ui.txt(d.name, W / 2, 182, '#ffe45e', 8, 'center');
    const au = this.tracks.get(this.grid[this.trackSel]!).authored;
    const tags = au
      ? [...new Set(au.hazards.map((h) => HAZARD_TAG[h.kind]).filter(Boolean)), au.weather ? WEATHER_TAG[au.weather.kind] : null, au.dayNight ? 'Del día a la noche' : null, au.narrow ? 'La nieve estrecha la pista' : null, au.water?.kind === 'lava' ? 'Lava' : null].filter(Boolean)
      : [d.flight ? 'Rampas de vuelo' : null, d.th.ice ? 'Hielo' : null, d.liquid ? d.liquid.msg.replace(/[¡!]/g, '').replace('Al ', 'Cuidado: ').replace('A la ', 'Cuidado: ') : null, d.ramps.length ? 'Saltos' : null].filter(Boolean);
    ui.txtS(tags.join('  /  ') || 'Clásica', W / 2, 214, '#fff7e0');
    const rec = this.progress.records[ALL_TRACKS[this.grid[this.trackSel]!]!.id + ':' + this.cls];
    if (rec?.race != null) ui.txtS('Récord: ' + fmtTime(rec.race) + (rec.lap != null ? '   Vuelta: ' + fmtTime(rec.lap) : ''), W / 2, 194, '#ffe45e');
    this.drawClassLine(204);
    ui.txtS('Enter: correr  ·  C: ' + (this.classic ? 'pistas nuevas' : 'pistas clásicas') + '  ·  Esc: volver', W / 2, 228, '#9c95d6');
  }
  private rowList(list: number[], extra: (ch: number, i: number, y: number) => void) {
    const ui = this.ui, ox = (W - 320) / 2;
    list.forEach((ch, i) => {
      const y = 44 + i * 19, me = ch === this.sel;
      ui.panel(ox + 28, y, 264, 15, me ? '#3a3478' : '#241f55', me ? '#ffe45e' : '#6d66b0');
      ui.txt(i + 1 + 'º', ox + 34, y + 4, me ? '#ffe45e' : '#fff7e0');
      ui.img(FACES[ch]!.cv, ox + 60, y - 1, 16, 16);
      ui.txt(CHARS[ch]!.name, ox + 80, y + 4, me ? '#ffe45e' : '#fff7e0');
      extra(ch, i, y);
    });
  }
  private drawResults() {
    const ui = this.ui, w = this.world!, ox = (W - 320) / 2;
    if (this.net?.lastEnd && w.finalOrder.length === 0) w.finalOrder = this.net.lastEnd.order;
    ui.bg(0.8);
    ui.txt(this.tr.def.name, W / 2, 8, '#ffe45e', 8, 'center');
    ui.txt('Resultados', W / 2, 20, '#fff7e0', 16, 'center');
    this.rowList(w.finalOrder.map((id) => w.karts[id]!.ch), (_ch, i, y) => {
      const k = w.karts[w.finalOrder[i]!]!;
      ui.txt(k.finished ? fmtTime(k.time) : 'En pista', ox + 320 - (this.mode === 'cup' ? 70 : 36), y + 4, '#fff7e0', 8, 'right');
      if (this.mode === 'cup') ui.txt('+' + (modeOf(w).scoring?.(w, w.finalOrder).get(w.finalOrder[i]!) ?? 0), ox + 284, y + 4, '#2ec46b', 8, 'right');
    });
    const p = this.local!;
    if (p.best != null) ui.txtS('Tu mejor vuelta: ' + fmtTime(p.best), W / 2, 186);
    if (w.cfg.teams) {
      const tot = [0, 0];
      w.finalOrder.forEach((id, i) => { const k = w.karts[id]!; if (k.team >= 0) tot[k.team]! += POINTS[i] ?? 0; });
      ui.txtS('Equipo ' + TEAM_NAME[0] + ' ' + tot[0] + '  ·  Equipo ' + TEAM_NAME[1] + ' ' + tot[1] + (tot[0] === tot[1] ? '  ·  Empate' : '  ·  Gana el ' + TEAM_NAME[tot[0]! > tot[1]! ? 0 : 1]), W / 2, 196, tot[0] === tot[1] ? '#fff7e0' : TEAM_COL[tot[0]! > tot[1]! ? 0 : 1]!);
    }
    this.resultNotes.forEach((n, i) => ui.txtS(n, W / 2, 206 - (this.resultNotes.length - 1 - i) * 9, '#ffe45e'));
    ui.txtS(this.net ? (this.net.isHost ? 'Intro: siguiente (todos)    Esc: salir de la sala' : 'Esperando al anfitrión...    Esc: salir de la sala') : this.mode === 'cup' ? 'Enter: ver clasificación    R: repetición' : this.mode === 'timetrial' ? 'Enter: otra vez    R: repetición    Esc: menú' : 'Enter: ver podio    R: repetición    Esc: menú', W / 2, 220, '#9c95d6');
  }
  private standingsList() { const c = this.cup!; return CHARS.map((_, i) => i).sort((a, b) => c.pts[b]! - c.pts[a]!); }
  private drawStandings() {
    const ui = this.ui, c = this.cup!, ox = (W - 320) / 2;
    ui.bg(0.85);
    ui.txt(c.def.name, W / 2, 8, c.def.col, 8, 'center');
    ui.txt('Clasificación', W / 2, 20, '#fff7e0', 16, 'center');
    this.rowList(this.standingsList(), (ch, _i, y) => { ui.txt('+' + (c.gain[ch] || 0), ox + 230, y + 4, '#2ec46b', 8, 'right'); ui.txt(String(c.pts[ch]), ox + 284, y + 4, '#ffe45e', 8, 'right'); });
    const last = c.race >= c.def.tracks.length - 1;
    ui.txtS('Carrera ' + (c.race + 1) + ' de ' + c.def.tracks.length, W / 2, 202);
    ui.txtS(last ? 'Enter: ver podio' : 'Enter: siguiente carrera, ' + this.tracks.get(c.def.tracks[c.race + 1]!).def.name, W / 2, 218, '#9c95d6');
  }
  private drawPodium(list: number[], title: string, col: string, sub: ((ch: number) => string) | null, t: number) {
    const ui = this.ui, ctx = ui.ctx;
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
      ui.img(rotFrames(ch)[((t * 12 + i * 8) | 0) % 24]!.cv, x - 21, base - h - 38, 42, 42);
      ui.img(FACES[ch]!.cv, x - 8, base - h - 56 + Math.round(Math.sin(t * 5 + i) * 2), 16, 16);
      ui.txtS(CHARS[ch]!.short, x, base + 5, '#fff7e0');
      if (sub) ui.txtS(sub(ch), x, base + 14, '#ffe45e');
    }
    for (let i = 0; i < 18; i++) { const x = (i * 53 + t * 40) % W, y = (i * 37 + t * 60) % 150; ctx.fillStyle = ['#ffe45e', '#e8455a', '#2ec46b', '#3df0ff'][i % 4]!; ctx.fillRect(x, y, 2, 3); }
  }
  private drawPodiumFree(t: number) {
    const w = this.world!, ui = this.ui;
    const L = w.finalOrder.map((id) => w.karts[id]!.ch);
    this.drawPodium(L, 'Podio', this.tr.th.curbB || '#ffe45e', (ch) => { const k = w.karts.find((q) => q.ch === ch)!; return k.finished ? fmtTime(k.time) : ''; }, t);
    const pos = w.finalOrder.indexOf(this.localId) + 1;
    ui.txt(pos === 1 ? '¡Ganaste!' : pos <= 3 ? '¡Al podio!' : 'Quedaste ' + pos + 'º', W / 2, 196, '#ff8a1f', 8, 'center');
    ui.txtS('Enter: otra carrera    R: repetición    Esc: menú', W / 2, 216, '#9c95d6');
  }
  private drawFinal(t: number) {
    const c = this.cup!, ui = this.ui, st = this.standingsList();
    this.drawPodium(st, c.def.name, c.def.col, (ch) => c.pts[ch] + ' pts', t);
    const pos = st.indexOf(this.sel) + 1, name = CHARS[this.sel]!.name;
    ui.txt(pos === 1 ? '¡' + name + ' gana la copa!' : pos <= 3 ? '¡Al podio, ' + name + '!' : 'Quedaste ' + pos + 'º. ¡A por la revancha!', W / 2, 192, '#ff8a1f', 8, 'center');
    ui.txtS('Dificultad: ' + DIFFS[this.diff]!.name + '  ·  ' + CLASS_NAMES[this.cls], W / 2, 204);
    if (this.resultNotes.length) ui.txtS(this.resultNotes.join('  ·  '), W / 2, 212, '#ffe45e');
    ui.txtS('Enter para volver al menú', W / 2, 220, '#9c95d6');
  }
}

