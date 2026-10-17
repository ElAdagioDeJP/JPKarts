// Client orchestrator (facade): owns shared state, routes input/frame to modules.
// Race, screens, HUD, feedback and render live in their own modules; Game only delegates.
// Public fields stay stable: tools/*.mjs drive the game through them.
import {
  ALL_TRACKS, ARENA_INDICES, CLASSIC_CUPS, CUPS, LAPS, ReplayPlayer, ReplayRecorder, TrackCache, prepAuthored,
  SIM_DT, clamp, hAt, hasFx, hashWorld, lerp, recordRace, wrapA,
  type EngineClass, type GameEvent, type Input as SimInput, type Kart, type Loadout, type Profile, type Progress, type Replay, type StatKey, type Track, type World,
} from '@jpkart/core';
import { DebugOverlay } from './dev/debugOverlay';
import { loadSettings, type Settings } from './settings';
import { type NetSession } from './net/session';
import { type CamTarget } from './feel/camera';
import { Fx3d } from './feel/fx3d';
import { BALLS } from './art/sprites';
import { Audio, DRUM_BY_STYLE, motifForTrack } from './audio/audio';
import { songFile } from './audio/songs';
import { Input } from './input/input';
import { buildMinimap } from './render/trackArt';
import { WorldRenderer } from './render/world3d';
import { H, Ui, W } from './ui/draw';
import { loadProgress, saveGhost, saveProgress } from './meta/store';
import { loadProfile, saveProfile } from './meta/profile';
import {
  CAM_H, MENUS, isArena, newView,
  type CupState, type Mode, type Particle, type PlayerView, type Pose, type State,
} from './app/types';
export type { CupState, Mode, Particle, PlayerView, Pose, State };
import * as Options from './screens/options';
import * as Feedback from './feel/eventFeedback';
import * as Hud from './hud/hud';
import * as WorldView from './render/worldView';
import * as LocalRace from './race/localRace';
import * as ReplayDirector from './race/replayDirector';
import * as NetRace from './net/netRace';
import * as NetScreens from './screens/netScreens';
import * as Menus from './screens/menus';
import * as Picker from './screens/picker';
import * as InputRouter from './app/inputRouter';
import * as Welcome from './screens/welcome';
import { buzz, isMobileDevice } from './mobile';
import { drawNetOverlay } from './race/spectate';

/** Served from the online server's own domain (https, not an IP/localhost): that same host is the server. */
function sameOriginServer() {
  if (typeof location === 'undefined' || !location.protocol.startsWith('http')) return '';
  return /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(location.hostname) ? '' : location.host;
}

export class Game {
  state: State = 'title';
  sel = 5; trackSel = 0; menuSel = 0; cupSel = 0; diff = 1;
  /** the kart choice of every local player (V3-3): pilot + parts; see screens/picker.ts */
  pickers: Picker.Picker[] = [];
  /** what the next race starts with: the confirmed picks of the local players */
  loadouts: { ch: number; parts: Loadout }[] = [];
  /** where the builder was opened from: the pilot grid (local race) or the LAN/online lobby */
  buildFrom: 'local' | 'lobby' = 'local';
  /** the lobby already sent this player's remembered kart */
  lobbyInit = false;
  mode: Mode = 'free';
  /** progression (GDD §9): unlocks and records, saved with versions and migrations */
  progress: Progress = loadProgress();
  /** who is playing on this device (name + id for rejoining online races), see screens/welcome.ts */
  profile: Profile = loadProfile();
  welcome: { page: number; name: string; first: boolean } | null = null;
  /** `?desbloquear` in the URL (or the LAN host option) opens everything */
  allUnlocked = typeof location !== 'undefined' && new URLSearchParams(location.search).has('desbloquear');
  cls: EngineClass = '100';
  teams = false;
  /** time trial: the record run, replayed next to the player */
  ghost: ReplayPlayer | null = null;
  ghostPrev: Pose | null = null;
  /** messages for the last result screen (records, unlocks) */
  resultNotes: string[] = [];
  /** end-of-race replay with the highlight camera (#62) */
  replayView: { player: ReplayPlayer; world: World; localId: number; back: State; focus: number; hold: number; ranks: number[]; views: PlayerView[] } | null = null;
  pendingMirror = false;
  paused = false; pendingRace = 0; loadF = 0;
  cup: CupState | null = null;
  tracks = new TrackCache(ALL_TRACKS, prepAuthored);
  /** track select: new (authored) tracks, or the legacy ones ("Clásicas") */
  classic = false;
  get trackCups() { return isArena(this.mode) ? [{ id: 'arenas', name: 'Arenas', tracks: ARENA_INDICES, col: '#ff8a1f' }] : this.classic ? CLASSIC_CUPS : CUPS; }
  /** track select grid: the cups' tracks, 4 per row */
  get grid() { return this.trackCups.flatMap((c) => c.tracks); }
  /** index (into ALL_TRACKS) of the track being raced */
  curTrack = 0;
  dbg = new DebugOverlay();
  settings: Settings = loadSettings();
  net: NetSession | null = null;
  lanField = 0;
  lanFound: { name: string; address: string; port: number; players: number }[] = [];
  lanHosting: string[] | null = null;
  lanName = loadProfile().name || 'Jugador';
  lanAddr = typeof location !== 'undefined' && location.hostname && location.hostname !== '' ? location.hostname : 'localhost';
  optSel = 0;
  /** online: server address (remembered), room code and the selected field (0 name, 1 server, 2 code, 3 create, 4 join) */
  onlineAddr = (() => { try { return localStorage.getItem('jpkart.online.server') ?? ((import.meta as { env?: Record<string, string> }).env?.VITE_ONLINE_SERVER || sameOriginServer()); } catch { return ''; } })();
  onlineCode = '';
  onlineField = 1;
  netOnline = false;
  ctlSel = 0;
  tr: Track;
  world: World | null = null;
  recorder: ReplayRecorder | null = null;
  lastReplay: Replay | null = null;
  /** one view per local player; the accessors below read and write the active one (`v`) */
  views: PlayerView[] = [newView()];
  v: PlayerView = this.views[0]!;
  /** local players for the next race (1–4) */
  players = 1;
  get localId() { return this.v.localId; } set localId(x: number) { this.v.localId = x; }
  get cam() { return this.v.cam; }
  get rig() { return this.v.rig; }
  get banner() { return this.v.banner; } set banner(x: PlayerView['banner']) { this.v.banner = x; }
  get incoming() { return this.v.incoming; } set incoming(x: PlayerView['incoming']) { this.v.incoming = x; }
  get posPop() { return this.v.posPop; } set posPop(x: number) { this.v.posPop = x; }
  get lastRank() { return this.v.lastRank; } set lastRank(x: number) { this.v.lastRank = x; }
  get coinPop() { return this.v.coinPop; } set coinPop(x: number) { this.v.coinPop = x; }
  get itemPressed() { return this.v.itemPressed; } set itemPressed(x: boolean) { this.v.itemPressed = x; }
  get driftLatch() { return this.v.driftLatch; } set driftLatch(x: boolean) { this.v.driftLatch = x; }
  get driftHeldPrev() { return this.v.driftHeldPrev; } set driftHeldPrev(x: boolean) { this.v.driftHeldPrev = x; }
  single() { this.views = [newView()]; this.v = this.views[0]!; }
  prev: Pose[] = [];
  acc = 0;
  fx: Fx3d;
  /** visual hit-stop: hold the rendered poses for a few frames (simulation keeps running) */
  hitStop = 0;
  stallBeep = -1;
  /** visual-only animation timers per kart */
  /** online spectator: kart the camera follows after you finish (-1 = none) */
  specId = -1;
  /** online: the connection dropped mid-race and we are trying to come back (seconds lost, seconds to the next try) */
  recon: { t: number; next: number } | null = null;
  specT = 0;
  trickAnim = new Map<number, number>();
  squash = new Map<number, number>();
  held: Pose[] | null = null;
  attract = 0;
  flashC = '#ffffff'; flashT = 0;
  fogK = 0;
  rain: { x: number; y: number }[] = [];
  parts: Particle[] = [];
  minis = new Map<Track, { cv: HTMLCanvasElement; k: number }>();
  last = performance.now();
  fps = 0; private fpsAcc = 0; private fpsN = 0;
  showPerf = false;
  simMs = 0; renderMs = 0;
  /** last 600 raw frame times (ms): p95/p99 show the stutters an fps average hides (PERF_PLAN P0) */
  private frames = new Float32Array(600); private frameI = 0;
  /** p-th percentile of the recent frame times (ms) */
  frameP(q: number) { const a = Float32Array.from(this.frames).sort(); return a[Math.min(599, Math.floor(600 * q))]!; }
  private tierToast = false;
  private batteryToast = false;

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
    if (this.dbg.pointer(kind, ux, uy, this.tr) && this.tr.authored) this.rebuildAuthored();
  }

  /** Editor F3: reconstruye la pista authored tras editar geometría o alturas. */
  rebuildAuthored() {
    if (!this.tr.authored) return;
    const i = ALL_TRACKS.findIndex((t) => t.id === this.tr.def.id);
    const fresh = this.tracks.rebuildAuthored(i);
    if (fresh) { this.tr = fresh; this.renderer.setTrack(fresh); this.toast('Pista reconstruida (' + fresh.N + ' muestras)'); }
  }

  /** Debug/test hooks: perf numbers. */
  perf() {
    const r = this.net?.race;
    return { fps: this.fps, sim: this.simMs, render: this.renderMs, drawCalls: this.renderer.drawCalls, backend: this.renderer.backend, frameP95: this.frameP(0.95), frameP99: this.frameP(0.99), resim: r?.lastResim ?? 0, resyncs: r?.resyncs ?? 0 };
  }

  /** Debug/test hooks: current replay and state hash. */
  debugReplay() { return { replay: this.recorder?.replay ?? this.lastReplay, hash: this.world ? hashWorld(this.world) : '' }; }

  get local(): Kart | undefined { return this.world && this.localId >= 0 ? this.world.karts[this.localId] : undefined; }
  mini(t: Track) { let m = this.minis.get(t); if (!m) { m = buildMinimap(t); this.minis.set(t, m); } return m; }

  // ---------------- input (see app/inputRouter.ts) ----------------
  onPress(code: string) { InputRouter.onPress(this, code); }
  toMenu() { this.state = 'menu'; this.world = null; this.ghost = null; this.single(); this.renderer.clearKarts(); }
  /** Which player's view an event belongs to (its kart is local), else player 1. */
  viewFor(e: GameEvent): PlayerView {
    if (this.views.length > 1) for (const f of ['kart', 'to', 'from', 'a', 'by'] as const) { const id = (e as Record<string, unknown>)[f]; const v = typeof id === 'number' ? this.views.find((q) => q.localId === id) : undefined; if (v) return v; }
    return this.views[0]!;
  }
  /** Cup/track screens: X cycles the engine class (only unlocked ones), E toggles teams (race and cup). */
  classKeys(code: string): boolean { return InputRouter.classKeys(this, code); }

  drawClassLine(y: number) { Menus.drawClassLine(this, y); }

  // ---------------- race (see race/localRace.ts, race/replayDirector.ts) ----------------
  startRace(ti: number) { LocalRace.startRace(this, ti); }
  /** Records and ghosts (local races only; LAN races do not count). */
  onRaceEnd() {
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
  commitPoints() { LocalRace.commitPoints(this); }
  localInput(): SimInput { return LocalRace.localInput(this); }
  simulate(dt: number) { LocalRace.simulate(this, dt); }
  // ---------------- end-of-race replay with a highlight camera (#62) ----------------
  startReplayView() { ReplayDirector.startReplayView(this); }
  endReplayView() { ReplayDirector.endReplayView(this); }
  /** Director: cut to whoever gets hit, overtakes in the top 3 or pulls a big mini-turbo; otherwise the leader. */
  simulateReplay(dt: number) { ReplayDirector.simulateReplay(this, dt); }
  drawReplayHud(t: number) { ReplayDirector.drawReplayHud(this, t); }

  tickAnims(dt: number) {
    for (const [id, v] of this.trickAnim) { const n = v + dt / 0.45; if (n >= 1) this.trickAnim.delete(id); else this.trickAnim.set(id, n); }
    for (const [id, v] of this.squash) { const n = v - dt / 0.18; if (n <= 0) this.squash.delete(id); else this.squash.set(id, n); }
  }

  pose(k: Kart): Pose {
    if (this.held && this.held[k.id]) return this.held[k.id]!;
    const p = this.prev[k.id], a = this.acc / SIM_DT;
    const vo = this.net && k.id === this.localId ? this.net.visOff : null;
    if (!p || this.paused) return { x: k.x + (vo?.x ?? 0), y: k.y + (vo?.y ?? 0), z: k.z, a: k.a };
    return { x: lerp(p.x, k.x, a) + (vo?.x ?? 0), y: lerp(p.y, k.y, a) + (vo?.y ?? 0), z: lerp(p.z, k.z, a), a: p.a + wrapA(k.a - p.a) * a };
  }

  // ---------------- events → feedback (see feel/eventFeedback.ts) ----------------
  onEvent(e: GameEvent) {
    Feedback.onEvent(this, e);
    // M4 haptics: leve 10 ms (roces), medio 20 ms (golpes), 30 ms (objeto/incoming).
    // Solo con vibración disponible y sacudida activada.
    try {
      if (this.settings.shake > 0 && isMobileDevice()) {
        const me = (id: unknown) => typeof id === 'number' && id === this.localId;
        const r = e as Record<string, unknown>;
        if (e.type === 'incoming' && me(r['kart'])) buzz(30);
        else if (e.type === 'itemGet' && me(r['kart'])) buzz(30);
        else if (e.type === 'hit' && me(r['kart'])) buzz(20);
        else if (e.type === 'wallBump' && me(r['kart'])) buzz(r['hard'] ? 20 : 10);
        else if (e.type === 'bump' && (me(r['a']) || me(r['b']))) buzz(10);
        else if (e.type === 'explode') buzz(20);
      }
    } catch { /* haptics opcional */ }
  }

  /** Is the local kart within `frac` of a lap before track position `at` (0..1)? */
  nearSample(at: number, frac: number) { return Feedback.nearSample(this, at, frac); }

  // ---------------- camera + world view (see render/worldView.ts) ----------------
  camTarget(): CamTarget | null { return WorldView.camTarget(this); }
  updateCam(dt: number, x: number, y: number, a: number, z: number) { WorldView.updateCam(this, dt, x, y, a, z); }

  // ---------------- frame ----------------
  frame(now: number) {
    const rawDt = (now - this.last) / 1000;
    const dt = clamp(rawDt, 0, 1 / 30);
    this.last = now;
    this.fpsAcc += rawDt; this.fpsN++;
    this.frames[this.frameI] = rawDt * 1000; this.frameI = (this.frameI + 1) % 600;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    // M3: auto-downgrade a ahorro si <40fps 3 s + aviso de batería baja (una vez).
    try {
      if (this.renderer.noteFps(this.fps, rawDt)) {
        if (!this.tierToast) { this.tierToast = true; this.toast('Modo ahorro: calidad reducida'); }
        if (this.settings.quality === 'auto') { /* el tier auto ya bajó */ }
      }
      if (!this.batteryToast) {
        // M3: se comprueba una sola vez por sesión (sin spam de promesas).
        this.batteryToast = true;
        const gb = (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery;
        if (typeof gb === 'function') {
          void gb.call(navigator).then((b) => {
            if (b && b.level < 0.2 && this.renderer.tier === 'alta') this.toast('Batería baja: prueba el modo ahorro en Opciones');
          }).catch(() => {});
        }
      }
    } catch { /* telemetría opcional */ }
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
      if (this.state === 'select' && this.pickers.length > 1) Picker.updatePickers(this);
      if (this.state === 'lobby') Picker.lobbyTick(this);
      const want = this.state === 'track' ? this.tracks.get(this.grid[this.trackSel]!) : this.state === 'cup' ? this.tracks.get(CUPS[this.cupSel]!.tracks[0]!) : this.tracks.get(this.grid[((t / 10) | 0) % this.grid.length]!);
      if (want.built && want !== this.tr) { this.tr = want; this.renderer.setTrack(want); const i = Math.floor(this.attract) % want.N; this.cam.a = want.ang[i]!; this.cam.z = want.hc[i]! + CAM_H; }
      const tr = this.tr;
      this.attract = (((this.attract + dt * 30) % tr.N) + tr.N) % tr.N;
      const i = Math.floor(this.attract) % tr.N, x = tr.x[i]!, y = tr.y[i]!;
      this.updateCam(dt, x, y, tr.ang[i]!, hAt(tr, x, y));
      this.renderWorld(t, []);
      this.safeArea(() => ({ title: () => this.drawTitle(t), welcome: () => Welcome.drawWelcome(this, t), menu: () => this.drawMenu(t), options: () => this.drawOptions(), controls: () => this.drawControls(), lan: () => this.drawLan(t), online: () => this.drawOnline(t), lobby: () => this.drawLobby(t), select: () => this.drawSelect(t), build: () => Menus.drawBuild(this, t), cup: () => this.drawCupSel(t), track: () => this.drawTrackSel() } as Record<string, () => void>)[this.state]!());
      A.engineSet(false, 0);
    } else if (this.world) {
      const w = this.world, p = this.local!;
      for (const v of this.views) v.input?.poll();
      if (this.net) this.paused = false; // online the race does not wait: a stuck pause froze the camera for good
      if (!this.paused) this.simulate(dt);
      if (this.hitStop > 0) { this.hitStop -= dt; if (this.hitStop <= 0) this.held = null; }
      for (const v of this.views) {
        this.v = v;
        const tg = this.camTarget(), q = this.local;
        if (!tg || !q) continue;
        if (q.respawn > 0 && q.respawn < 0.05) this.rig.cut(tg, this.tr);
        Object.assign(this.cam, this.rig.update(this.paused ? 0 : dt, tg, this.tr));
      }
      this.v = this.views[0]!;
      if (!this.paused) this.fx.frame(w, dt, this.cam.x, this.cam.y, (k) => this.pose(k), this.tr.th.ground[0]);
      this.updateAtmosphere(w, dt);
      this.renderWorld(w.raceT, w.karts);
      if (this.state === 'replay') this.drawReplayHud(t);
      else if (this.state === 'race') {
        if (!this.paused && this.views.length === 1) this.spawnSpeedLines();
        this.drawParticles(this.paused ? 0 : dt);
        this.drawSmudge();
        this.drawWeather(dt);
        if (this.flashT > 0) { ui.ctx.globalAlpha = Math.min(this.settings.reduceFlash ? 0.2 : 0.6, this.flashT * 2); ui.ctx.fillStyle = this.flashC; ui.ctx.fillRect(0, 0, W, H); ui.ctx.globalAlpha = 1; this.flashT -= dt; }
        if (w.phase === 'countdown') {
          const n = Math.ceil(w.cd);
          ui.txt(n > 0 ? String(n) : '', W / 2, H / 2 - 40, '#ffe45e', 40, 'center');
          ui.txt(this.tr.def.name, W / 2, 34, '#fff7e0', 8, 'center');
          ui.txtS('Truco: acelera justo en el 1 para salir con turbo', W / 2, isMobileDevice() ? 46 : H - 30); // en móvil los botones táctiles tapan el borde inferior
        } else this.drawHUDs(this.paused ? 0 : dt);
        if (this.net) drawNetOverlay(this);
        A.engineSet(!this.paused, p.speed + (p.boost > 0 ? 40 : 0));
        this.audioFrame(w, p);
        if (this.paused) { ui.bg(0.7); ui.txt('Pausa', W / 2, 80, '#ffe45e', 24, 'center'); ui.txt('P para seguir', W / 2, 130, '#fff7e0', 8, 'center'); ui.txt('Esc para salir al menú', W / 2, 146, '#fff7e0', 8, 'center'); }
      } else {
        this.safeArea(() => ({ replay: () => {}, results: () => this.drawResults(), standings: () => this.drawStandings(), final: () => this.drawFinal(t), podium: () => this.drawPodiumFree(t) } as Record<string, () => void>)[this.state]!());
        A.engineSet(false, 0);
      }
    }
    // music by state: the recorded song when there is one, else the synth below
    const song = this.songPick();
    if (song.preload) A.musicPreload(song.preload);
    if (A.musicFile(song.file, song.rate, song.vol, song.loop)) A.musicWant(null);
    else if (MENUS.includes(this.state)) A.musicWant('menu');
    else if (this.state === 'loading' || (this.state === 'race' && this.world?.phase === 'countdown')) A.musicWant(null);
    else if (this.state === 'race' && this.local?.finished) A.musicWant(null);
    else if (this.state === 'race' || this.state === 'replay') {
      const d = this.tr.def, lastLap = this.local!.prog >= ((this.world?.cfg.laps ?? LAPS) - 1) * this.tr.N;
      const motif = { ...motifForTrack(this.tr.def.id), drums: DRUM_BY_STYLE[this.tr.th.style] ?? 'base' as const };
      A.musicWant(d.song, d.mul * (lastLap ? 1.06 : 1) * (this.local && hasFx(this.local, 'god') ? 1.15 : 1), this.paused ? 0 : 1, motif); // Modo Dios: the music speeds up
    }
    else A.musicWant('menu', 1, 0.7);
    this.dbg.draw(ui, this.tr, this.world);
    if (this.toastMsg) { this.toastMsg.life -= dt; ui.txtS(this.toastMsg.t, 4, 4, '#9cff9c', 'left'); if (this.toastMsg.life <= 0) this.toastMsg = null; }
    if (this.showPerf) {
      ui.txtS(`${this.fps.toFixed(0)} fps · ${this.renderer.backend} · sim ${this.simMs.toFixed(2)} ms · render ${this.renderMs.toFixed(2)} ms · ${this.renderer.drawCalls} draw calls · frame p95 ${this.frameP(0.95).toFixed(1)} / p99 ${this.frameP(0.99).toFixed(1)} ms` + (this.net?.race ? ` · resim ${this.net.race.lastResim} · resync ${this.net.race.resyncs}` : ''), 4, H - 8, '#9cff9c', 'left');
    }
  }

  renderWorld(t: number, karts: Kart[]) { WorldView.renderWorld(this, t, karts); }

  private drawLabels(karts: Kart[]) { WorldView.drawLabels(this, karts); }

  /** Screen-space speed lines at high speed (the rest of the particles are 3D, see feel/fx3d.ts). */
  private spawnSpeedLines() { WorldView.spawnSpeedLines(this); }
  private drawParticles(dt: number) { WorldView.drawParticles(this, dt); }
  /** Day → night over the race, fog from its lap on (visual only; grip is in core). */
  private updateAtmosphere(w: World, dt: number) { WorldView.updateAtmosphere(this, w, dt); }
  /** Rain streaks and sand haze over the screen when the track's weather is on for the local kart. */
  private drawWeather(dt: number) { WorldView.drawWeather(this, dt); }
  /** Smoke curtain covering the local kart's view. */
  private drawSmudge() { Hud.drawSmudge(this); }

  // ---------------- HUD (see hud/hud.ts) ----------------
  /** One HUD per local player, scaled into its viewport. */
  private drawHUDs(dt: number) { Hud.drawHUDs(this, dt); }
  private drawHUD(dt: number) { Hud.drawHUD(this, dt); }
  private drawHUDScaled(dt: number, Wv: number, Hv: number) { Hud.drawHUDScaled(this, dt, Wv, Hv); }

  // ---------------- LAN / online (see screens/netScreens.ts, net/netRace.ts) ----------------
  /** LAN menu fields: 0 name, 1 address, then (desktop app) 2 create game, 3 search, 4.. found games. */
  lanFieldCount() { return NetScreens.lanFieldCount(this); }
  lanInput(code: string, back: boolean, U: boolean, D: boolean) { NetScreens.lanInput(this, code, back, U, D); }
  textNav(code: string, U: boolean, D: boolean): [boolean, boolean] { return InputRouter.textNav(this, code, U, D); }
  onlineInput(code: string, back: boolean, U: boolean, D: boolean) { NetScreens.onlineInput(this, code, back, U, D); }
  drawOnline(t: number) { NetScreens.drawOnline(this, t); }
  typeInto() { NetScreens.typeInto(this); }
  connectLan(addr = this.lanAddr, name = this.lanName, online?: { room?: string; create?: boolean }) {
    NetRace.connectLan(this, addr, name, online);
  }
  leaveNet() { NetRace.leaveNet(this); }
  startNetRace() { NetRace.startNetRace(this); }
  simulateNet(dt: number) { NetRace.simulateNet(this, dt); }
  lobbyInput(_code: string, ok: boolean, back: boolean, L: boolean, R: boolean, U: boolean, D: boolean) {
    NetScreens.lobbyInput(this, _code, ok, back, L, R, U, D);
  }
  drawLan(t: number) { NetScreens.drawLan(this, t); }
  drawLobby(t: number) { NetScreens.drawLobby(this, t); }

  // ---------------- settings (see screens/options.ts) ----------------
  applySettings() { Options.applySettings(this); }
  storeSettings() { Options.storeSettings(this); }
  optionRows(): [string, string][] { return Options.optionRows(this); }
  optionsInput(_code: string, ok: boolean, back: boolean, L: boolean, R: boolean, U: boolean, D: boolean) {
    Options.optionsInput(this, _code, ok, back, L, R, U, D);
  }
  controlsInput(code: string, ok: boolean, back: boolean, U: boolean, D: boolean) {
    Options.controlsInput(this, code, ok, back, U, D);
  }
  keyName(code: string) { return Options.keyName(code); }
  openWelcome(first: boolean) { Welcome.openWelcome(this, first); }
  private drawOptions() { Options.drawOptions(this); }
  private drawControls() { Options.drawControls(this); }

  /** Positional rival engines + adaptive music intensity. */
  private audioFrame(w: World, p: Kart) { Feedback.audioFrame(this, w, p); }

  // ---------------- menus (see screens/menus.ts) ----------------
  drawTitle(t: number) { Menus.drawTitle(this, t); }
  drawMenu(t: number) { Menus.drawMenu(this, t); }
  statBar10(key: StatKey, v: number, x: number, y: number) { Menus.statBar10(this, key, v, x, y); }
  /** (Re)create the selector state for the current number of local players. */
  initPickers() { this.pickers = Picker.newPickers(this); }
  drawSelect(t: number) { if (!this.pickers.length) this.initPickers(); Menus.drawSelect(this, t); }
  /** Persist the profile (the last kart changed). */
  saveProfileNow() { saveProfile(this.profile); }
  drawCupSel(t: number) { Menus.drawCupSel(this, t); }
  drawTrackSel() { Menus.drawTrackSel(this); }
  rowList(list: number[], extra: (ch: number, i: number, y: number) => void) { Menus.rowList(this, list, extra); }
  /**
   * Phones: the on-screen pad (56 px buttons + margin) covers the bottom of every 2D screen, so those screens are drawn
   * scaled down into the area above it (the dim background still fills everything, see Ui.bg).
   */
  private safeArea(draw: () => void) {
    let k = 1;
    try { if (isMobileDevice()) { const h = this.ui.cv.getBoundingClientRect().height; if (h > 0) k = Math.min(1, Math.max(0.6, (h - 74) / h)); } } catch { /* noop */ }
    if (k >= 1) { draw(); return; }
    const c = this.ui.ctx;
    c.save(); c.translate((W * (1 - k)) / 2, 0); c.scale(k, k);
    try { draw(); } finally { c.restore(); }
  }
  /** Recorded song for the current state (file null = silence or synth fallback). */
  private songPick(): { file: string | null; preload?: string; rate: number; vol: number; loop: boolean } {
    const st = this.state, ui = { rate: 1, vol: 1, loop: true };
    if (st === 'welcome') return { file: 'tutorial', ...ui };
    if (MENUS.includes(st)) return { file: 'menu', ...ui };
    if (st === 'loading') return { file: null, ...ui };
    if (st === 'race' && this.world?.phase === 'countdown') return { file: null, preload: songFile(this.tr.def.id), ...ui };
    if (st === 'race' && this.local?.finished) return { file: null, ...ui };
    if (st === 'race' || st === 'replay') {
      const lastLap = this.local!.prog >= ((this.world?.cfg.laps ?? LAPS) - 1) * this.tr.N;
      return { file: songFile(this.tr.def.id), ...ui, rate: (lastLap ? 1.06 : 1) * (this.local && hasFx(this.local, 'god') ? 1.15 : 1), vol: this.paused ? 0 : 1 };
    }
    if (st === 'results' || st === 'standings') return { file: 'results', ...ui, vol: 0.8 };
    const won = st === 'final' ? this.standingsList().indexOf(this.sel) < 3 : (this.local?.rank ?? 9) < 3;
    return { file: won ? 'victory' : 'defeat', ...ui, loop: false };
  }
  drawResults() { Menus.drawResults(this); }
  standingsList() { return Menus.standingsList(this); }
  drawStandings() { Menus.drawStandings(this); }
  drawPodium(list: number[], title: string, col: string, sub: ((ch: number) => string) | null, t: number) {
    Menus.drawPodium(this, list, title, col, sub, t);
  }
  drawPodiumFree(t: number) { Menus.drawPodiumFree(this, t); }
  drawFinal(t: number) { Menus.drawFinal(this, t); }
}

