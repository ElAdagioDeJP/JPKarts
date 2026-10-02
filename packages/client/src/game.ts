// Client orchestrator: screens, fixed-step simulation, camera, event → feedback, HUD.
import {
  CHARS, CUPS, DIFFS, LAPS, POINTS, Rng, SIM_DT, STAT_SHORT, TRACK_DEFS, TrackCache,
  buildGrid, clamp, createWorld, fmtTime, hAt, itemDef, itemList, lerp, step, takeEvents, wrapA,
  type GameEvent, type Input as SimInput, type Kart, type StatKey, type Track, type World,
} from '@jpkart/core';
import { OUT } from './art/pixel';
import { BALLS, BIGBALL, FACES, ICONS, rotFrames } from './art/sprites';
import { Audio } from './audio/audio';
import { Input } from './input/input';
import { buildMinimap } from './render/trackArt';
import { H0, RW, WorldRenderer, type KartView, type ThingView } from './render/world3d';
import { H, Ui, W } from './ui/draw';

type State = 'title' | 'menu' | 'select' | 'cup' | 'track' | 'loading' | 'race' | 'results' | 'podium' | 'standings' | 'final';
const MENUS: State[] = ['title', 'menu', 'select', 'cup', 'track'];
const CAM_H = 15, CAM_BACK = 34, ZMAX = 1000;
const UIK = W / RW; // internal world px → UI px
const OUCH = ['¡Ay!', '¡Uf!', '¡Auch!', '¡Ay, ay!'];

interface Pose { x: number; y: number; z: number; a: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number; line?: boolean }
interface CupState { def: (typeof CUPS)[number]; race: number; pts: Record<number, number>; gain: Record<number, number>; committed: boolean }

export class Game {
  state: State = 'title';
  sel = 5; trackSel = 0; menuSel = 0; cupSel = 0; diff = 1;
  mode: 'free' | 'cup' = 'free';
  paused = false; pendingRace = 0; loadF = 0;
  cup: CupState | null = null;
  tracks = new TrackCache(TRACK_DEFS);
  tr: Track;
  world: World | null = null;
  localId = -1;
  private prev: Pose[] = [];
  private acc = 0;
  private itemPressed = false;
  cam = { x: 0, y: 0, a: 0, z: 30, hz: H0 };
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
    input.onFirstGesture = () => audio.init();
  }

  get local(): Kart | undefined { return this.world && this.localId >= 0 ? this.world.karts[this.localId] : undefined; }
  mini(t: Track) { let m = this.minis.get(t); if (!m) { m = buildMinimap(t); this.minis.set(t, m); } return m; }

  // ---------------- input ----------------
  private onPress(code: string) {
    const I = this.input, A = this.audio;
    const ok = I.is(code, 'aceptar'), back = I.is(code, 'atras');
    const L = I.is(code, 'izquierda'), R = I.is(code, 'derecha'), U = I.is(code, 'arriba'), D = I.is(code, 'abajo');
    if (I.is(code, 'sonido')) A.muted = !A.muted;
    if (code === 'F2') this.showPerf = !this.showPerf;
    switch (this.state) {
      case 'title': if (ok) { this.state = 'menu'; A.blip(); } break;
      case 'menu':
        if (U) { this.menuSel = (this.menuSel + 2) % 3; A.blip(); }
        if (D) { this.menuSel = (this.menuSel + 1) % 3; A.blip(); }
        if (this.menuSel === 2 && (L || R || ok)) { this.diff = (this.diff + (L ? 2 : 1)) % 3; A.blip(); break; }
        if (ok) { this.mode = this.menuSel === 0 ? 'cup' : 'free'; this.state = 'select'; A.blip(); }
        if (back) this.state = 'title';
        break;
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
        if (ok) { this.startRace(this.trackSel); A.beep(880, 0.12); }
        if (back) this.state = 'select';
        break;
      case 'race':
        if (I.is(code, 'pausa') || (back && !this.paused)) { this.paused = !this.paused; A.beep(440, 0.06); return; }
        if (this.paused && back) { this.paused = false; this.state = 'menu'; this.world = null; this.renderer.clearKarts(); A.engineSet(false, 0); return; }
        if (this.paused && code === 'Enter') { this.paused = false; return; }
        if (!this.paused && I.is(code, 'objeto')) this.itemPressed = true;
        break;
      case 'results':
        if (ok) { if (this.mode === 'cup') { this.commitPoints(); this.state = 'standings'; } else { this.state = 'podium'; A.jingle(); } }
        if (back && this.mode === 'free') this.toMenu();
        break;
      case 'podium': if (ok) this.startRace(this.trackSel); if (back) this.toMenu(); break;
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
    this.trackSel = ti;
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
    this.world = createWorld({ trackIndex: ti, diff: this.diff, seed, laps: LAPS, grid }, this.tr);
    this.localId = this.world.karts.findIndex((k) => k.ctrl === 'local');
    this.prev = this.world.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
    const p = this.local!;
    this.cam.a = p.a; this.cam.x = p.x - Math.cos(p.a) * CAM_BACK; this.cam.y = p.y - Math.sin(p.a) * CAM_BACK; this.cam.z = p.z + CAM_H; this.cam.hz = H0;
    this.acc = 0; this.banner = null; this.flashT = 0; this.parts = []; this.paused = false;
    this.state = 'race';
  }
  private commitPoints() {
    const c = this.cup, w = this.world;
    if (!c || !w || c.committed) return;
    c.committed = true;
    c.gain = {};
    w.finalOrder.forEach((id, i) => { const ch = w.karts[id]!.ch, p = POINTS[i] || 0; c.pts[ch] = (c.pts[ch] ?? 0) + p; c.gain[ch] = p; });
  }
  private localInput(): SimInput {
    const I = this.input;
    const inp: SimInput = {
      t: (I.held('acelerar') ? 1 : 0) - (I.held('frenar') ? 1 : 0),
      s: (I.held('derecha') ? 1 : 0) - (I.held('izquierda') ? 1 : 0),
      d: I.held('derrapar'),
      item: this.itemPressed,
    };
    return inp;
  }
  private simulate(dt: number) {
    const w = this.world!;
    this.acc = Math.min(this.acc + dt, SIM_DT * 5);
    const t0 = performance.now();
    while (this.acc >= SIM_DT) {
      this.prev = w.karts.map((k) => ({ x: k.x, y: k.y, z: k.z, a: k.a }));
      const inputs: SimInput[] = [];
      inputs[this.localId] = this.localInput();
      this.itemPressed = false;
      step(w, inputs);
      this.acc -= SIM_DT;
      for (const e of takeEvents(w)) this.onEvent(e);
    }
    this.simMs = performance.now() - t0;
  }
  private pose(k: Kart): Pose {
    const p = this.prev[k.id], a = this.acc / SIM_DT;
    if (!p || this.paused) return { x: k.x, y: k.y, z: k.z, a: k.a };
    return { x: lerp(p.x, k.x, a), y: lerp(p.y, k.y, a), z: lerp(p.z, k.z, a), a: p.a + wrapA(k.a - p.a) * a };
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
      case 'land': if (me(e.kart) && e.hard) A.beep(90, 0.1, 'square', 0.05); break;
      case 'pad': if (me(e.kart)) A.beep(640, 0.2, 'sawtooth', 0.05, 500); break;
      case 'itemRoll': if (me(e.kart)) { A.beep(1100, 0.05, 'square', 0.05); A.beep(600, 0.08, 'square', 0.04, 300); } break;
      case 'itemGet': if (me(e.kart)) A.beep(880, 0.08); break;
      case 'itemUse': this.itemSound(e.item, me(e.kart), near(e.kart, 260), e.target != null && me(e.target), e.ok); break;
      case 'alreadyFirst': if (me(e.kart)) this.banner = { t: 'Ya vas primero', life: 1 }; break;
      case 'hit': {
        const k = w.karts[e.kart]!, d = p ? Math.hypot(p.x - k.x, p.y - k.y) : 0;
        A.groan(CHARS[k.ch]!, me(e.kart) ? 0.5 : 0.45 * (1 - clamp(d / 380, 0, 1)), Math.random());
        break;
      }
      case 'bump': if (me(e.a) || me(e.b)) A.beep(120, 0.06, 'square', 0.04); break;
      case 'smudge': if (me(e.kart)) A.beep(160, 0.15, 'triangle', 0.05); break;
      case 'lap': if (me(e.kart)) { this.banner = { t: e.final ? '¡Última vuelta!' : 'Vuelta ' + e.lap, life: 1.8 }; A.beep(e.final ? 990 : 700, 0.2); } break;
      case 'finish': if (me(e.kart)) { this.banner = { t: '¡Meta!', life: 2.2, big: true }; A.musicWant(null); A.jingle(); } break;
      case 'flash': this.flashC = e.color; this.flashT = 0.35; break;
      case 'raceEnd': if (this.state === 'race') this.state = 'results'; break;
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

  // ---------------- camera ----------------
  private updateCam(dt: number, x: number, y: number, a: number, z: number) {
    const c = this.cam, tr = this.tr;
    c.a = wrapA(c.a + wrapA(a - c.a) * Math.min(1, dt * 7));
    c.x = x - Math.cos(c.a) * CAM_BACK;
    c.y = y - Math.sin(c.a) * CAM_BACK;
    const tz = Math.max(z + CAM_H, hAt(tr, c.x, c.y) + 7);
    c.z = lerp(c.z, tz, Math.min(1, dt * 8));
    const ahead = hAt(tr, x + Math.cos(c.a) * 60, y + Math.sin(c.a) * 60), pitch = clamp((ahead - z) / 60, -0.4, 0.4);
    c.hz = lerp(c.hz, H0 + pitch * 320 * 0.55, Math.min(1, dt * 4));
  }

  // ---------------- frame ----------------
  frame(now: number) {
    const rawDt = (now - this.last) / 1000;
    const dt = clamp(rawDt, 0, 1 / 30);
    this.last = now;
    this.fpsAcc += rawDt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    const t = now / 1000;
    for (const code of this.input.drainPressed()) this.onPress(code);
    const ui = this.ui, A = this.audio;
    ui.begin();
    if (this.state === 'loading') {
      ui.ctx.fillStyle = '#1b1740'; ui.ctx.fillRect(0, 0, W, H);
      ui.txt('Cargando pista...', W / 2, H / 2 - 14, '#ffe45e', 8, 'center');
      ui.txtS(TRACK_DEFS[this.pendingRace]!.name, W / 2, H / 2 + 4);
      ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 8, H / 2 + 18, 16, 16);
      if (++this.loadF >= 3) { this.tracks.ensureBuilt(this.pendingRace, [this.tr]); this.startRace(this.pendingRace); }
    } else if (MENUS.includes(this.state)) {
      const want = this.state === 'track' ? this.tracks.get(this.trackSel) : this.state === 'cup' ? this.tracks.get(CUPS[this.cupSel]!.tracks[0]!) : this.tracks.get(((t / 10) | 0) % 16);
      if (want.built && want !== this.tr) { this.tr = want; this.renderer.setTrack(want); const i = Math.floor(this.attract) % want.N; this.cam.a = want.ang[i]!; this.cam.z = want.hc[i]! + CAM_H; }
      const tr = this.tr;
      this.attract = (((this.attract + dt * 30) % tr.N) + tr.N) % tr.N;
      const i = Math.floor(this.attract) % tr.N, x = tr.x[i]!, y = tr.y[i]!;
      this.updateCam(dt, x, y, tr.ang[i]!, hAt(tr, x, y));
      this.renderWorld(t, []);
      ({ title: () => this.drawTitle(t), menu: () => this.drawMenu(t), select: () => this.drawSelect(t), cup: () => this.drawCupSel(t), track: () => this.drawTrackSel() } as Record<string, () => void>)[this.state]!();
      A.engineSet(false, 0);
    } else if (this.world) {
      const w = this.world, p = this.local!;
      if (!this.paused) this.simulate(dt);
      const pp = this.pose(p);
      this.updateCam(this.paused ? 0 : dt, pp.x, pp.y, p.spin > 0 ? this.cam.a : pp.a, pp.z);
      this.renderWorld(w.raceT, w.karts);
      if (this.state === 'race') {
        if (!this.paused) this.spawnParticles();
        this.drawParticles(this.paused ? 0 : dt);
        this.drawSmudge();
        if (this.flashT > 0) { ui.ctx.globalAlpha = Math.min(0.6, this.flashT * 2); ui.ctx.fillStyle = this.flashC; ui.ctx.fillRect(0, 0, W, H); ui.ctx.globalAlpha = 1; this.flashT -= dt; }
        if (w.phase === 'countdown') {
          const n = Math.ceil(w.cd);
          ui.txt(n > 0 ? String(n) : '', W / 2, H / 2 - 40, '#ffe45e', 40, 'center');
          ui.txt(TRACK_DEFS[this.trackSel]!.name, W / 2, 34, '#fff7e0', 8, 'center');
          ui.txtS('Truco: acelera justo en el 1 para salir con turbo', W / 2, H - 30);
        } else this.drawHUD(this.paused ? 0 : dt);
        A.engineSet(!this.paused, p.speed + (p.boost > 0 ? 40 : 0));
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
    else if (this.state === 'race') { const d = TRACK_DEFS[this.trackSel]!, lastLap = this.local!.prog >= (LAPS - 1) * this.tr.N; A.musicWant(d.song, d.mul * (lastLap ? 1.1 : 1), this.paused ? 0 : 1); }
    else A.musicWant('menu', 1, 0.7);
    if (this.showPerf) {
      ui.txtS(`${this.fps.toFixed(0)} fps · ${this.renderer.backend} · sim ${this.simMs.toFixed(2)} ms · render ${this.renderMs.toFixed(2)} ms`, 4, H - 8, '#9cff9c', 'left');
    }
  }

  private renderWorld(t: number, karts: Kart[]) {
    const w = this.world, views: KartView[] = [], things: ThingView[] = [];
    for (const k of karts) {
      const ps = this.pose(k);
      const vis = k.respawn <= 0 || ((t * 10) | 0) % 2 === 1;
      views.push({ id: k.id, ch: k.ch, x: ps.x, y: ps.y, z: k.respawn > 0 ? ps.z - 6 : ps.z, a: ps.a, lean: k.drift ? k.drift : k.sv, hop: k.hop, spin: k.spin, big: k.jug > 0, bubble: k.bubble > 0, visible: vis, ground: hAt(this.tr, ps.x, ps.y), air: k.air });
    }
    if (w) {
      for (const o of w.fakes) things.push({ kind: 'fake', x: o.x, y: o.y, z: o.z, f: 0 });
      for (const o of w.tars) things.push({ kind: 'tar', x: o.x, y: o.y, z: o.z, f: 0 });
      for (const o of w.shots) things.push({ kind: 'shot', x: o.x, y: o.y, z: o.z, f: 0 });
      for (const o of w.rockets) things.push({ kind: 'dron', x: o.x, y: o.y, z: o.z, f: 0 });
      for (const o of w.holes) things.push({ kind: 'hole', x: o.x, y: o.y, z: o.z, f: o.t });
    }
    const boxes = w ? w.boxes.map((b) => b.active) : this.tr.boxes.map(() => true);
    const t0 = performance.now();
    this.renderer.render(this.cam, views, things, boxes, t);
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
      let lab: [string, string] | null = null;
      if (k.ouch > 0) lab = [OUCH[k.ouchT]!, '#ff6a6a'];
      else if (k.scare > 0) lab = ['¡!', '#ffe45e'];
      else if (k.emp > 0 && !me) lab = ['PEM', '#3df0ff'];
      else if (k.inv > 0 && !me) lab = ['¿?', '#ff6ad0'];
      else if (k.jug > 0) lab = ['★', '#ffd23a'];
      if (lab) ui.txtS(lab[0], lx, ly - (me ? 0 : 12), lab[1]);
      if (!me && depth < 260 && top.k * 12.5 * UIK >= 9) ui.txtS(CHARS[k.ch]!.short, lx, ly - 4, '#fff7e0');
    }
  }

  private spawnParticles() {
    const p = this.local!, tr = this.tr;
    if (p.respawn > 0) return;
    const ps = this.pose(p), base = this.renderer.project(ps.x, ps.y, ps.z);
    if (!base) return;
    const w = 12.5 * base.k * UIK, h = 13.3 * base.k * UIK, x0 = base.sx * UIK - w / 2, by = base.sy * UIK - 2;
    const lx = x0 + w * 0.15, rx = x0 + w * 0.85, r = (a: number, b: number) => a + Math.random() * (b - a);
    void h;
    if (p.drift && p.speed > 60) {
      const col = p.dc > 1.5 ? '#ff8a1f' : p.dc > 0.75 ? '#5ab8ff' : '#fff7e0';
      for (let i = 0; i < 3; i++) this.parts.push({ x: (i % 2 ? rx : lx) + r(-2, 2), y: by + r(-1, 1), vx: r(-30, 30) - p.drift * 20, vy: r(-40, -10), life: 0.25, c: col, s: r(1, 2.5) });
    }
    if (p.boost > 0) for (let i = 0; i < 3; i++) this.parts.push({ x: x0 + w / 2 + r(-5, 5), y: by, vx: r(-10, 10), vy: r(10, 40), life: 0.2, c: ['#ffe45e', '#ff8a1f', '#fff7e0'][(Math.random() * 3) | 0]!, s: r(1.5, 3) });
    if (p.off === 2 && Math.abs(p.speed) > 20) this.parts.push({ x: Math.random() < 0.5 ? lx : rx, y: by, vx: r(-20, 20), vy: r(-30, -5), life: 0.3, c: tr.th.ground[0], s: 1.5 });
    if (tr.th.ice && Math.abs(wrapA(p.va - p.a)) > 0.15 && p.speed > 60) this.parts.push({ x: Math.random() < 0.5 ? lx : rx, y: by, vx: r(-20, 20), vy: r(-20, -5), life: 0.3, c: '#ffffff', s: 1.5 });
    if (p.speed > 120 && Math.random() < 0.4) this.parts.push({ x: r(0, W), y: r(H * 0.55, H), vx: 0, vy: 0, life: 0.08, c: 'rgba(255,255,255,0.35)', s: 1, line: true });
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
    if (!p || p.smudge <= 0) return;
    ctx.globalAlpha = Math.min(0.85, p.smudge);
    ctx.fillStyle = OUT;
    for (const [x, y, r] of [[93, 90, 26], [160, 150, 34], [280, 110, 30], [333, 170, 22], [213, 70, 18], [53, 170, 20]] as const) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // ---------------- HUD ----------------
  private drawHUD(dt: number) {
    const ui = this.ui, ctx = ui.ctx, w = this.world!, p = this.local!, tr = this.tr;
    const lap = clamp(Math.floor(p.prog / tr.N) + 1, 1, LAPS);
    ui.panel(4, 4, 82, this.mode === 'cup' ? 32 : 26, 'rgba(27,23,64,0.75)', '#6d66b0');
    ui.txt('Vuelta ' + lap + '/' + LAPS, 8, 8);
    ui.txt(fmtTime(w.raceT), 8, 19, '#ffe45e');
    if (this.mode === 'cup' && this.cup) ui.txtS('Carrera ' + (this.cup.race + 1) + '/' + this.cup.def.tracks.length, 8, 30, '#fff7e0', 'left');
    const pos = p.rank + 1;
    ui.txt(pos + 'º', W - 8, 6, pos === 1 ? '#ffe45e' : pos <= 3 ? '#fff7e0' : '#c8c4f0', 24, 'right');
    const bx = W / 2 - 15, by = 5;
    ui.panel(bx, by, 30, 30, '#1b1740', p.roll > 0 ? (((w.raceT * 10) | 0) % 2 ? '#ffe45e' : '#fff7e0') : '#fff7e0');
    const list = itemList();
    let icon = null;
    if (p.roll > 0) icon = ICONS[list[((w.raceT * 18) | 0) % list.length]!.id];
    else if (p.item) icon = ICONS[p.item];
    if (icon) ui.img(icon.cv, bx + 3, by + 3, 24, 24);
    if (p.item && p.roll <= 0) ui.txtS(itemDef(p.item).name, W / 2, by + 36);
    const st: [string, string][] = [];
    if (p.bubble) st.push(['Burbuja activa', '#8fe0ff']);
    if (p.goma > 0) st.push(['Goma ' + Math.ceil(p.goma), '#ff8a9a']);
    if (p.jug > 0) st.push(['¡Juggernaut! ' + Math.ceil(p.jug), '#ffd23a']);
    if (p.emp > 0) st.push(['Motor apagado', '#3df0ff']);
    if (p.hookT > 0) st.push(['Gancho', '#ffe45e']);
    if (p.slowT > 0) st.push(['Te enganchan', '#ff8a1f']);
    if (p.glide) st.push(['¡Volando!', '#8fe0ff']);
    st.forEach(([s, c], i) => ui.txtS(s, W / 2, by + 46 + i * 9, c));
    if (p.inv > 0 && ((w.raceT * 4) | 0) % 2 === 0) ui.txt('¡Controles invertidos!', W / 2, H / 2 - 40, '#ff6ad0', 8, 'center');
    const m = this.mini(tr), mx = W - 62, my = H - 62;
    ui.panel(mx - 2, my - 2, 60, 60, 'rgba(27,23,64,0.55)', '#6d66b0');
    ui.img(m.cv, mx, my);
    for (const k of w.karts) {
      const x = mx + k.x * m.k, y = my + k.y * m.k, r = k.id === this.localId ? 3 : 2;
      ctx.fillStyle = OUT; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      if (k.id === this.localId) { ctx.fillStyle = '#fff7e0'; ctx.fillRect(x - 2, y - 2, 4, 4); }
      ctx.fillStyle = CHARS[k.ch]!.kart; ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    w.ranked.forEach((id, i) => {
      const k = w.karts[id]!, y = 44 + i * 17;
      if (id === this.localId) { ctx.fillStyle = 'rgba(255,228,94,0.35)'; ctx.fillRect(4, y - 1, 34, 17); }
      ui.img(FACES[k.ch]!.cv, 5, y, 16, 16);
      ui.txtS(String(i + 1), 26, y + 5, id === this.localId ? '#ffe45e' : '#fff7e0', 'left');
    });
    if (p.drift) {
      const c = p.dc > 1.5 ? '#ff8a1f' : p.dc > 0.75 ? '#5ab8ff' : '#fff7e0', ww = Math.min(60, (p.dc / 1.5) * 60);
      ui.panel(W / 2 - 31, H - 14, 62, 6, '#1b1740'); ctx.fillStyle = c; ctx.fillRect(W / 2 - 30, H - 13, ww, 4);
    }
    if (p.backT > 0.8 && !p.finished && ((w.raceT * 3) | 0) % 2 === 0) ui.txt('¡Sentido contrario!', W / 2, H / 2 - 30, '#ff4d6d', 8, 'center');
    if (this.banner) {
      this.banner.life -= dt;
      ui.txt(this.banner.t, W / 2, this.banner.big ? H / 2 - 24 : 66, '#ffe45e', this.banner.big ? 24 : 16, 'center');
      if (this.banner.life <= 0) this.banner = null;
    }
    if (this.audio.muted) ui.txtS('Sin sonido', W / 2, H - 24);
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
    const items = ['Torneo', 'Carrera libre', 'Dificultad: ' + DIFFS[this.diff]!.name];
    const help = ['4 copas de 4 carreras. Se suman los puntos.', 'Elige cualquiera de las 16 pistas.', 'Qué tan rápidos y listos son los rivales.'];
    items.forEach((s, i) => {
      const on = i === this.menuSel, y = 76 + i * 34;
      ui.panel(W / 2 - 90, y, 180, 24, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      if (on) ui.img(BALLS[((t * 8) | 0) % 4]!.cv, W / 2 - 84, y + 4, 16, 16);
      ui.txt(i === 2 ? (on ? '< ' : '') + s + (on ? ' >' : '') : s, W / 2, y + 8, on ? '#ffe45e' : '#fff7e0', 8, 'center');
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
      c.tracks.forEach((ti, j) => ui.txtS(TRACK_DEFS[ti]!.name + (TRACK_DEFS[ti]!.flight ? ' *' : ''), x + 38, y + 26 + j * 13, '#fff7e0', 'left'));
    });
    ui.txtS('* pista con vuelo    Puntos: 15 12 10 8 6 4 2 1', W / 2, 220, '#9c95d6');
  }
  private drawTrackSel() {
    const ui = this.ui, ctx = ui.ctx, ox = (W - 320) / 2;
    ui.bg();
    ui.txt('Elige circuito', W / 2, 6, '#ffe45e', 16, 'center');
    CUPS.forEach((c, r) => ui.txtS(c.name.replace('Copa ', ''), ox + 38, 28 + r * 44 + 16, c.col));
    this.tracks.list.forEach((trk, i) => {
      const r = i >> 2, x = ox + 66 + (i % 4) * 62, y = 26 + r * 44, on = i === this.trackSel;
      ui.panel(x, y, 56, 38, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : CUPS[r]!.col);
      ctx.fillStyle = trk.th.ground[0]; ctx.fillRect(x + 14, y + 5, 28, 28);
      ui.img(this.mini(trk).cv, x + 14, y + 5, 28, 28);
      if (trk.def.flight) ui.txtS('*', x + 50, y + 2, '#8fe0ff');
    });
    const d = TRACK_DEFS[this.trackSel]!;
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
    ui.bg(0.8);
    ui.txt(TRACK_DEFS[this.trackSel]!.name, W / 2, 8, '#ffe45e', 8, 'center');
    ui.txt('Resultados', W / 2, 20, '#fff7e0', 16, 'center');
    this.rowList(w.finalOrder.map((id) => w.karts[id]!.ch), (_ch, i, y) => {
      const k = w.karts[w.finalOrder[i]!]!;
      ui.txt(k.finished ? fmtTime(k.time) : 'En pista', ox + 320 - (this.mode === 'cup' ? 70 : 36), y + 4, '#fff7e0', 8, 'right');
      if (this.mode === 'cup') ui.txt('+' + POINTS[i], ox + 284, y + 4, '#2ec46b', 8, 'right');
    });
    const p = this.local!;
    if (p.best != null) ui.txtS('Tu mejor vuelta: ' + fmtTime(p.best), W / 2, 200);
    ui.txtS(this.mode === 'cup' ? 'Enter: ver clasificación' : 'Enter: ver podio    Esc: menú', W / 2, 220, '#9c95d6');
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
    ui.txtS(last ? 'Enter: ver podio' : 'Enter: siguiente carrera, ' + TRACK_DEFS[c.def.tracks[c.race + 1]!]!.name, W / 2, 218, '#9c95d6');
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
    this.drawPodium(L, 'Podio', TRACK_DEFS[this.trackSel]!.th.curbB || '#ffe45e', (ch) => { const k = w.karts.find((q) => q.ch === ch)!; return k.finished ? fmtTime(k.time) : ''; }, t);
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

