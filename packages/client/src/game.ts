// Client orchestrator: screens, fixed-step simulation, camera, event → feedback, HUD.
import {
  ALL_TRACKS, CHARS, CUPS, DIFFS, LAPS, ReplayRecorder, Rng, SIM_DT, STAT_SHORT, TrackCache, prepAuthored,
  buildGrid, clamp, createWorld, fmtTime, fxOf, hAt, hasFx, hashWorld, modeOf, itemDef, itemList, lerp, step, takeEvents, wrapA,
  type GameEvent, type Input as SimInput, type Kart, type Replay, type StatKey, type Track, type World,
} from '@jpkart/core';
import { OUT } from './art/pixel';
import { ENTITY_VIEW, hudLines, kartLabel } from './feel/effectView';
import { DebugOverlay } from './dev/debugOverlay';
import { ACTION_NAMES, REMAPPABLE } from './input/input';
import { PAD_NAMES } from './input/gamepad';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './settings';
import { NetSession, desktop } from './net/session';
import { CameraRig, type CamTarget } from './feel/camera';
import { DRIFT_COL as DCOL, DRIFT_COL_CB, Fx3d } from './feel/fx3d';
import { BALLS, BIGBALL, FACES, ICONS, rotFrames } from './art/sprites';
import { Audio } from './audio/audio';
import { Input } from './input/input';
import { buildMinimap } from './render/trackArt';
import { T } from '@jpkart/core';
import { H0, RW, WorldRenderer, type KartView, type ThingView } from './render/world3d';
import { H, Ui, W } from './ui/draw';

type State = 'title' | 'menu' | 'options' | 'controls' | 'lan' | 'lobby' | 'select' | 'cup' | 'track' | 'loading' | 'race' | 'results' | 'podium' | 'standings' | 'final';
const MENUS: State[] = ['title', 'menu', 'options', 'controls', 'lan', 'lobby', 'select', 'cup', 'track'];
const CAM_H = 15, CAM_BACK = 34, ZMAX = 1000;
const UIK = W / RW; // internal world px → UI px
const DRIFT_COL = ['#fff7e0', '#3df0ff', '#ff8a1f', '#b84aff'];

interface Pose { x: number; y: number; z: number; a: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number; line?: boolean }
interface CupState { def: (typeof CUPS)[number]; race: number; pts: Record<number, number>; gain: Record<number, number>; committed: boolean }

export class Game {
  state: State = 'title';
  sel = 5; trackSel = 0; menuSel = 0; cupSel = 0; diff = 1;
  mode: 'free' | 'cup' = 'free';
  paused = false; pendingRace = 0; loadF = 0;
  cup: CupState | null = null;
  tracks = new TrackCache(ALL_TRACKS, prepAuthored);
  /** track select grid: the cups' tracks, 4 per row */
  grid = CUPS.flatMap((c) => c.tracks);
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
        if (U) { this.menuSel = (this.menuSel + 4) % 5; A.blip(); }
        if (D) { this.menuSel = (this.menuSel + 1) % 5; A.blip(); }
        if (this.menuSel === 3 && (L || R || ok)) { this.diff = (this.diff + (L ? 2 : 1)) % 3; A.blip(); break; }
        if (this.menuSel === 4 && ok) { this.state = 'options'; this.optSel = 0; A.blip(); break; }
        if (this.menuSel === 2 && ok) { this.state = 'lan'; this.lanField = 0; this.input.textMode = true; A.blip(); break; }
        if (ok) { this.mode = this.menuSel === 0 ? 'cup' : 'free'; this.state = 'select'; A.blip(); }
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
        if (R) { this.cupSel = (this.cupSel + 1) % 4; A.blip(); }
        if (L) { this.cupSel = (this.cupSel + 3) % 4; A.blip(); }
        if (U || D) { this.cupSel = (this.cupSel + 2) % 4; A.blip(); }
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
        if (ok) { if (this.mode === 'cup') { this.commitPoints(); this.state = 'standings'; } else { this.state = 'podium'; A.jingle(); } }
        if (back && this.mode === 'free') this.toMenu();
        break;
      case 'podium': if (ok) this.startRace(this.curTrack); if (back) this.toMenu(); break;
      case 'standings':
        if (ok && this.cup) {
          if (this.cup.race < this.cup.def.tracks.length - 1) { this.cup.race++; this.cup.committed = false; this.startRace(this.cup.def.tracks[this.cup.race]!); }
          else { this.state = 'final'; A.jingle(); }
        }
        break;
      case 'final': if (ok || back) this.toMenu(); break;
    }
  }
  private toMenu() { this.state = 'menu'; this.world = null; this.renderer.clearKarts(); }

  // ---------------- race ----------------
  startRace(ti: number) {
    this.curTrack = ti;
    if (!this.tracks.get(ti).built) { this.pendingRace = ti; this.loadF = 0; this.state = 'loading'; return; }
    this.tr = this.tracks.get(ti);
    this.renderer.setTrack(this.tr);
    this.renderer.clearKarts();
    const seed = (Math.random() * 2 ** 31) | 0;
    const rng = new Rng(seed ^ 0x5bd1e995);
    const humans = [{ ch: this.sel, ctrl: 'local' as const }];
    const grid = this.mode === 'cup' && this.cup && this.cup.race > 0
      ? buildGrid(rng, humans, { cupPts: this.cup.pts, humanSlot: 0 })
      : buildGrid(rng, humans, { humanSlot: this.mode === 'cup' ? 7 : 5 });
    const cfg = { trackIndex: ti, diff: this.diff, seed, laps: LAPS, grid, mode: this.mode === 'cup' ? 'cup' : 'race' };
    this.world = createWorld(cfg, this.tr);
    this.recorder = new ReplayRecorder(cfg);
    this.localId = this.world.karts.findIndex((k) => k.ctrl === 'local');
    this.prev = this.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    this.rig.cut(this.camTarget()!, this.tr);
    this.rig.trauma = 0;
    this.acc = 0; this.banner = null; this.flashT = 0; this.parts = []; this.paused = false; this.incoming = null;
    this.trickAnim.clear(); this.squash.clear(); this.lastRank = -1; this.posPop = 0;
    this.state = 'race';
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
    const w = this.world!;
    this.acc = Math.min(this.acc + dt, SIM_DT * 5);
    const t0 = performance.now();
    while (this.acc >= SIM_DT) {
      this.prev = w.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
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
      case 'smudge': if (me(e.kart)) A.beep(160, 0.15, 'triangle', 0.05); break;
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
      case 'hazardWarn': if (this.local && this.nearSample(e.at, 0.12)) { this.banner = { t: '¡Ola!', life: 1 }; A.beep(220, 0.6, 'triangle', 0.05, 200); } break;
      case 'tide': this.banner = { t: '¡Sube la marea!', life: 1.6 }; A.beep(180, 0.9, 'sine', 0.06, -60); break;
      case 'reflect': A.beep(1600, 0.15, 'sine', 0.05, -900); break;
      case 'explode': { const p0 = this.local; if (p0 && Math.hypot(p0.x - e.x, p0.y - e.y) < 260) { A.beep(70, 0.4, 'sawtooth', 0.08, -30); this.flashC = '#ff8a1f'; this.flashT = 0.2; this.rig.addTrauma(0.5 * (1 - Math.hypot(p0.x - e.x, p0.y - e.y) / 260)); } break; }
      case 'raceEnd': if (this.state === 'race') this.state = 'results'; if (this.recorder) { this.lastReplay = this.recorder.replay; this.recorder = null; } break;
    }
  }
  private itemSound(id: string, me: boolean, near: boolean, targetMe: boolean, ok: boolean) {
    const A = this.audio;
    switch (id) {
      case 'bocina': if (me || near) { A.beep(330, 0.4, 'sawtooth', 0.07); A.beep(415, 0.4, 'sawtooth', 0.05); } break;
      case 'falsa': if (me) A.beep(200, 0.1, 'triangle', 0.05); break;
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
      case 'teleport': if (ok) A.beep(1500, 0.3, 'sine', 0.05, -1200); break;
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
      ui.txtS(this.tracks.get(this.pendingRace).def.name, W / 2, H / 2 + 4);
      ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 8, H / 2 + 18, 16, 16);
      if (++this.loadF >= 3) { this.tracks.ensureBuilt(this.pendingRace, [this.tr]); this.startRace(this.pendingRace); }
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
      this.renderWorld(w.raceT, w.karts);
      if (this.state === 'race') {
        if (!this.paused) this.spawnSpeedLines();
        this.drawParticles(this.paused ? 0 : dt);
        this.drawSmudge();
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
        ({ results: () => this.drawResults(), standings: () => this.drawStandings(), final: () => this.drawFinal(t), podium: () => this.drawPodiumFree(t) } as Record<string, () => void>)[this.state]!();
        A.engineSet(false, 0);
      }
    }
    // music by state
    if (MENUS.includes(this.state)) A.musicWant('menu');
    else if (this.state === 'loading' || (this.state === 'race' && this.world?.phase === 'countdown')) A.musicWant(null);
    else if (this.state === 'race' && this.local?.finished) A.musicWant(null);
    else if (this.state === 'race') { const d = this.tr.def, lastLap = this.local!.prog >= (LAPS - 1) * this.tr.N; A.musicWant(d.song, d.mul * (lastLap ? 1.1 : 1), this.paused ? 0 : 1); }
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
      const vis = k.respawn <= 0 || ((t * 10) | 0) % 2 === 1;
      views.push({ id: k.id, ch: k.ch, x: ps.x, y: ps.y, z: k.respawn > 0 ? ps.z - 6 : ps.z, a: ps.a, lean: k.drift ? k.drift : k.sv, hop: k.hop, spin: k.spin, big: hasFx(k, 'jug'), bubble: hasFx(k, 'bubble'), reflect: hasFx(k, 'reflect'), visible: vis, ground: hAt(this.tr, ps.x, ps.y), air: k.air, trick: this.trickAnim.get(k.id) ?? 0, squash: this.squash.get(k.id) ?? 0, local: k.id === this.localId });
    }
    if (w) {
      for (const e of w.ents) { const kind = ENTITY_VIEW[e.kind]; if (kind) things.push({ kind, x: e.x, y: e.y, z: e.z, f: e.kind === 'mine' ? e.age : e.t }); }
    }
    const boxes = w ? w.boxes.map((b) => b.active) : this.tr.boxes.map(() => true);
    const t0 = performance.now();
    this.renderer.render(this.cam, views, things, boxes, t, w?.water ?? this.tr.water?.base ?? 0, 1 / 60);
    this.renderMs = performance.now() - t0;
    if (w && this.state === 'race') this.drawLabels(karts);
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
      if (!me && depth < 260 && top.k * 12.5 * UIK >= 9) ui.txtS(CHARS[k.ch]!.short, lx, ly - 4, '#fff7e0');
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
  private drawSmudge() {
    const p = this.local, ctx = this.ui.ctx;
    const sm = p ? fxOf(p, 'smudge') : undefined;
    if (!sm) return;
    ctx.globalAlpha = Math.min(0.85, sm.t);
    ctx.fillStyle = OUT;
    for (const [x, y, r] of [[93, 90, 26], [160, 150, 34], [280, 110, 30], [333, 170, 22], [213, 70, 18], [53, 170, 20]] as const) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
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
    const lap = clamp(Math.floor(p.prog / tr.N) + 1, 1, LAPS);
    ui.panel(4, 4, 82, this.mode === 'cup' ? 32 : 26, 'rgba(27,23,64,0.75)', '#6d66b0');
    ui.txt('Vuelta ' + lap + '/' + LAPS, 8, 8);
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
      ui.txtS(String(i + 1), 26, y + 5, id === this.localId ? '#ffe45e' : '#fff7e0', 'left');
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
    const crowd = near.filter((r) => r.dist < 120).length / 3, lastLap = p.prog >= (LAPS - 1) * this.tr.N ? 0.35 : 0;
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
    ui.txt('JP KART', W / 2, 24, '#ffe45e', 24, 'center');
    const items = ['Torneo', 'Carrera libre', 'Multijugador LAN', 'Dificultad: ' + DIFFS[this.diff]!.name, 'Opciones'];
    const help = ['4 copas de 4 carreras. Se suman los puntos.', 'Elige cualquiera de las 16 pistas.', 'Juega con amigos en la misma red.', 'Qué tan rápidos y listos son los rivales.', 'Sonido, accesibilidad, gráficos y controles.'];
    items.forEach((s, i) => {
      const on = i === this.menuSel, y = 60 + i * 26;
      ui.panel(W / 2 - 90, y, 180, 24, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      if (on) ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 84, y + 4, 16, 16);
      ui.txt(i === 3 ? (on ? '< ' : '') + s + (on ? ' >' : '') : s, W / 2, y + 8, on ? '#ffe45e' : '#fff7e0', 8, 'center');
    });
    ui.txtS(help[this.menuSel]!, W / 2, 188);
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
      const x = ox + 12 + (i % 2) * 152, y = 32 + ((i / 2) | 0) * 92, on = i === this.cupSel;
      ui.panel(x, y, 144, 84, on ? '#3a3478' : '#241f55', on ? c.col : '#6d66b0');
      ui.trophy(x + 18, y + 10 + (on ? Math.round(Math.sin(t * 6)) : 0), c.col);
      ui.txt(c.name.replace('Copa ', ''), x + 38, y + 8, on ? c.col : '#fff7e0');
      c.tracks.forEach((ti, j) => { const d = this.tracks.get(ti).def; ui.txtS(d.name + (d.flight ? ' *' : ''), x + 38, y + 26 + j * 13, '#fff7e0', 'left'); });
    });
    ui.txtS('* pista con vuelo    Puntos: 15 12 10 8 6 4 2 1', W / 2, 220, '#9c95d6');
  }
  private drawTrackSel() {
    const ui = this.ui, ctx = ui.ctx, ox = (W - 320) / 2;
    ui.bg();
    ui.txt('Elige circuito', W / 2, 6, '#ffe45e', 16, 'center');
    CUPS.forEach((c, r) => ui.txtS(c.name.replace('Copa ', ''), ox + 38, 28 + r * 44 + 16, c.col));
    this.grid.forEach((ti, i) => {
      const trk = this.tracks.get(ti);
      const r = i >> 2, x = ox + 66 + (i % 4) * 62, y = 26 + r * 44, on = i === this.trackSel;
      ui.panel(x, y, 56, 38, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : CUPS[r]!.col);
      ctx.fillStyle = trk.th.ground[0]; ctx.fillRect(x + 14, y + 5, 28, 28);
      ui.img(this.mini(trk).cv, x + 14, y + 5, 28, 28);
      if (trk.def.flight) ui.txtS('*', x + 50, y + 2, '#8fe0ff');
    });
    const d = this.tracks.get(this.grid[this.trackSel]!).def;
    ui.txt(d.name, W / 2, 204, '#ffe45e', 8, 'center');
    const tags = [d.flight ? 'Rampas de vuelo' : null, d.th.ice ? 'Hielo' : null, d.liquid ? d.liquid.msg.replace(/[¡!]/g, '').replace('Al ', 'Cuidado: ').replace('A la ', 'Cuidado: ') : null, d.ramps.length ? 'Saltos' : null].filter(Boolean);
    ui.txtS(tags.join('  /  ') || 'Clásica', W / 2, 216, '#fff7e0');
    ui.txtS('Enter para correr, Esc para volver', W / 2, 228, '#9c95d6');
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
    if (p.best != null) ui.txtS('Tu mejor vuelta: ' + fmtTime(p.best), W / 2, 200);
    ui.txtS(this.net ? (this.net.isHost ? 'Intro: siguiente (todos)    Esc: salir de la sala' : 'Esperando al anfitrión...    Esc: salir de la sala') : this.mode === 'cup' ? 'Enter: ver clasificación' : 'Enter: ver podio    Esc: menú', W / 2, 220, '#9c95d6');
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
    ui.txtS('Enter: otra carrera    Esc: menú', W / 2, 216, '#9c95d6');
  }
  private drawFinal(t: number) {
    const c = this.cup!, ui = this.ui, st = this.standingsList();
    this.drawPodium(st, c.def.name, c.def.col, (ch) => c.pts[ch] + ' pts', t);
    const pos = st.indexOf(this.sel) + 1, name = CHARS[this.sel]!.name;
    ui.txt(pos === 1 ? '¡' + name + ' gana la copa!' : pos <= 3 ? '¡Al podio, ' + name + '!' : 'Quedaste ' + pos + 'º. ¡A por la revancha!', W / 2, 192, '#ff8a1f', 8, 'center');
    ui.txtS('Dificultad: ' + DIFFS[this.diff]!.name, W / 2, 206);
    ui.txtS('Enter para volver al menú', W / 2, 220, '#9c95d6');
  }
}

