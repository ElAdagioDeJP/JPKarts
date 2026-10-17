// Kart selector and builder (V3-3, docs/V3_PLAN.md §3): pilot grid → builder (3 part carousels, live stat bars,
// "Aleatorio", confirm). With several local players every player gets a compact panel in their own quadrant and
// picks at the same time with their own input source. The same builder serves the LAN/online lobby.
// Pure UI over core data (parts.json, kartStats): the selection ends up in `RaceConfig.grid[i].parts`.
import {
  CHARS, DEFAULT_LOADOUT, PART_TYPES, Rng, STAT_KEYS, STAT_SHORT, clamp, kartStats, partById, partsOfType, randomLoadout, validLoadout,
  type Loadout, type PartType, type StatKey,
} from '@jpkart/core';
import { FACES, rotFrames } from '../art/sprites';
import { OUT } from '../art/pixel';
import { PlayerInput, SOURCE_NAMES, assignSources } from '../input/players';
import { uiRect } from '../app/types';
import { W } from '../ui/draw';
import type { Game } from '../game';

export const PART_LABEL: Record<PartType, string> = { body: 'Carrocería', wheels: 'Ruedas', wing: 'Ala' };
const PART_SHORT: Record<PartType, string> = { body: 'Carro.', wheels: 'Ruedas', wing: 'Ala' };

/** One local player's choice. */
export interface Picker {
  ch: number;
  parts: Loadout;
  /** cursor: 0 pilot (panel only), 1-3 parts, 4 random, 5 confirm (the builder screen starts at row 1) */
  row: number;
  ready: boolean;
  /** null = player 1 alone (keyboard + pad, through the screen's key presses) */
  input: PlayerInput | null;
  /** previous held state of each action (edge detection for split-screen sources) */
  held: Record<string, boolean>;
}

const ROW_CH = 0, ROW_RAND = 4, ROW_OK = 5;
const ROW_TYPE: Record<number, PartType> = { 1: 'body', 2: 'wheels', 3: 'wing' };

const randomSeed = () => (Math.random() * 2 ** 31) | 0;

export function newPickers(g: Game): Picker[] {
  const n = g.mode === 'timetrial' ? 1 : g.players, srcs = assignSources(n), out: Picker[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < n; i++) {
    let ch = i === 0 ? (g.profile.lastCh >= 0 ? g.profile.lastCh : g.sel) : (out[0]!.ch + i) % CHARS.length;
    while (taken.has(ch)) ch = (ch + 1) % CHARS.length;
    taken.add(ch);
    const parts = i === 0 && validLoadout(g.profile.lastParts) ? { ...g.profile.lastParts } : { ...DEFAULT_LOADOUT };
    out.push({ ch, parts, row: n > 1 ? ROW_CH : 1, ready: false, input: n > 1 ? new PlayerInput(srcs[i]!, g.input) : null, held: {} });
  }
  return out;
}

/** Next pilot in `dir` that no other picker holds. */
export function cycleCh(pickers: Picker[], p: Picker, dir: number) {
  const n = CHARS.length;
  let ch = p.ch;
  for (let i = 0; i < n; i++) {
    ch = (ch + dir + n) % n;
    if (!pickers.some((q) => q !== p && q.ch === ch)) break;
  }
  p.ch = ch;
}

export function cyclePart(p: Picker, type: PartType, dir: number) {
  const list = partsOfType(type), i = list.findIndex((x) => x.id === p.parts[type]);
  p.parts[type] = list[(i + dir + list.length) % list.length]!.id;
}

export function randomize(p: Picker) { p.parts = randomLoadout(new Rng(randomSeed())); }

export type Nav = 'L' | 'R' | 'U' | 'D' | 'OK' | 'BACK';

/** One navigation step of a picker. `panel`: split-screen panel (pilot row, ready toggle); else the builder screen. Returns true when the player confirmed. */
export function navigate(g: Game, p: Picker, a: Nav, panel: boolean): boolean {
  const first = panel ? ROW_CH : 1;
  if (p.ready && panel) { if (a === 'OK' || a === 'BACK') { p.ready = false; g.audio.blip(); } return false; }
  switch (a) {
    case 'U': p.row = p.row <= first ? ROW_OK : p.row - 1; g.audio.blip(); break;
    case 'D': p.row = p.row >= ROW_OK ? first : p.row + 1; g.audio.blip(); break;
    case 'L': case 'R': {
      const dir = a === 'L' ? -1 : 1;
      if (p.row === ROW_CH) cycleCh(g.pickers, p, dir);
      else if (ROW_TYPE[p.row]) cyclePart(p, ROW_TYPE[p.row]!, dir);
      else break;
      g.audio.blip();
      break;
    }
    case 'OK':
      if (p.row === ROW_RAND) { randomize(p); p.row = ROW_OK; g.audio.beep(660, 0.08); }
      else if (p.row === ROW_OK) { g.audio.beep(780, 0.1); return true; }
      else { p.row = Math.min(ROW_OK, p.row + 1); g.audio.blip(); }
      break;
    case 'BACK': break;
  }
  return false;
}

/** Split screen: every frame, read each player's own source and move their panel. */
export function updatePickers(g: Game) {
  for (const p of g.pickers) {
    const I = p.input;
    if (!I) continue;
    const now: Record<string, boolean> = { L: I.held('izquierda'), R: I.held('derecha'), U: I.held('acelerar'), D: I.held('frenar'), OK: I.held('objeto'), BACK: I.held('derrapar') };
    for (const a of Object.keys(now) as Nav[]) {
      if (now[a] && !p.held[a]) {
        if (navigate(g, p, a, true)) p.ready = true;
      }
      p.held[a] = now[a]!;
    }
  }
}

export const allReady = (g: Game) => g.pickers.length > 0 && g.pickers.every((p) => p.ready);

/** Remember player 1's kart and apply the picks to the game. */
export function commit(g: Game) {
  const p = g.pickers[0]!;
  g.sel = p.ch;
  g.loadouts = g.pickers.map((q) => ({ ch: q.ch, parts: { ...q.parts } }));
  g.profile.lastCh = p.ch;
  g.profile.lastParts = { ...p.parts };
  g.saveProfileNow();
}

// ---------------------------------------------------------------- drawing

const SEG = 6;
/** A stat bar of 10 segments: the pilot's base in yellow, the parts' effect on top (green = better, red = worse). */
export function statBarDelta(g: Game, key: StatKey, base: number, total: number, x: number, y: number, opts: { label?: string; barX?: number; seg?: number; value?: boolean } = {}) {
  const ui = g.ui, ctx = ui.ctx, seg = opts.seg ?? SEG, bx = x + (opts.barX ?? 40), inner = seg - 3;
  ui.txtS(opts.label ?? STAT_SHORT[key], x, y, '#fff7e0', 'left');
  for (let i = 0; i < 10; i++) {
    const fb = clamp(base - i, 0, 1), ft = clamp(total - i, 0, 1);
    ctx.fillStyle = OUT; ctx.fillRect(bx + i * seg, y - 1, seg - 1, 7);
    ctx.fillStyle = '#3a3478'; ctx.fillRect(bx + i * seg + 1, y, inner, 5);
    const w = (f: number) => (f > 0 ? Math.max(1, Math.round(inner * f)) : 0);
    const keep = Math.min(fb, ft);
    if (keep > 0) { ctx.fillStyle = '#ffe45e'; ctx.fillRect(bx + i * seg + 1, y, w(keep), 5); }
    if (ft > fb) { ctx.fillStyle = '#2ec46b'; const x0 = w(fb), x1 = w(ft); ctx.fillRect(bx + i * seg + 1 + x0, y, Math.max(1, x1 - x0), 5); }
    else if (ft < fb) { ctx.fillStyle = '#ff4d6d'; const x0 = w(ft), x1 = w(fb); ctx.fillRect(bx + i * seg + 1 + x0, y, Math.max(1, x1 - x0), 5); }
  }
  if (opts.value !== false) {
    const d = Math.round((total - base) * 100) / 100, vx = bx + 10 * seg + 4;
    ui.txtS(String(Math.round(total * 100) / 100), vx, y, '#fff7e0', 'left');
    if (d !== 0) ui.txtS((d > 0 ? '+' : '') + d, vx + 22, y, d > 0 ? '#2ec46b' : '#ff4d6d', 'left');
  }
}

/** Visible stats of a build: the base of the pilot and the total with parts (clamped 0-10). */
export function buildStats(p: { ch: number; parts: Loadout }): Record<StatKey, { base: number; total: number }> {
  const base = CHARS[p.ch]!.st, out = {} as Record<StatKey, { base: number; total: number }>;
  for (const k of STAT_KEYS) {
    let d = 0;
    for (const t of PART_TYPES) d += partById(p.parts[t])?.[k] ?? 0;
    out[k] = { base: base[k], total: clamp(base[k] + d, 0, 10) };
  }
  return out;
}

const fmtPart = (id: string) => partById(id)?.name ?? id;
/** One-line summary of what a part does: its biggest visible changes. */
export function partEffects(id: string): string {
  const p = partById(id);
  if (!p) return '';
  const bits: string[] = [], n = (v: number) => (v > 0 ? '+' : '-') + String(Math.abs(v)).replace(/^0\./, '.');
  for (const k of STAT_KEYS) if (p[k]) bits.push(k.toUpperCase() + n(p[k]));
  if (p.mt) bits.push('MT' + n(p.mt));
  if (p.vue) bits.push('VU' + n(p.vue));
  return bits.join(' ') || 'Sin cambios';
}

/** Pilot grid (single player): 4 × 3 faces. */
export function drawGrid(g: Game, t: number) {
  const ui = g.ui, ox = (W - 320) / 2, p = g.pickers[0]!;
  CHARS.forEach((c, i) => {
    const col = i % 4, row = i >> 2, x = ox + 18 + col * 74, y = 26 + row * 38, on = i === p.ch;
    ui.panel(x, y, 62, 35, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    const b = on ? Math.round(Math.sin(t * 8) * 1) : 0;
    ui.img(FACES[i]!.cv, x + 19, y + 1 + b, 24, 24);
    ui.txtS(c.short, x + 31, y + 26, on ? '#ffe45e' : '#fff7e0');
  });
}

/** Detail panel under the grid: description + the five base stats. */
export function drawPilotInfo(g: Game, t: number) {
  const ui = g.ui, ox = (W - 320) / 2, p = g.pickers[0]!, c = CHARS[p.ch]!;
  ui.panel(ox + 10, 144, 300, 90, '#1b1740');
  ui.img(rotFrames(p.ch)[((t * 10) | 0) % rotFrames(p.ch).length]!.cv, ox + 262, 142, 42, 42);
  ui.txt(c.name, ox + 18, 150, '#ffe45e');
  ui.txtS(c.desc, ox + 18, 162, '#fff7e0', 'left');
  STAT_KEYS.forEach((k, i) => statBarDelta(g, k, c.st[k], c.st[k], ox + 18 + (i % 2) * 124, 176 + ((i / 2) | 0) * 13, { value: false, barX: 34, seg: 6 }));
  ui.txtS('Clase: ' + c.weightClass, ox + 18, 222, '#9c95d6', 'left');
}

/** The builder screen (one player): rotating kart, three carousels, live bars, Aleatorio, confirm. */
export function drawBuilder(g: Game, t: number, opts: { confirm: string; extra?: string }) {
  const ui = g.ui, ctx = ui.ctx, ox = (W - 320) / 2, p = g.pickers[0]!, c = CHARS[p.ch]!, S = buildStats(p);
  ui.bg();
  ui.txt('Arma tu kart', W / 2, 6, '#ffe45e', 16, 'center');
  // left: the kart turning
  ui.panel(ox + 4, 28, 104, 108, '#1b1740');
  const fr = rotFrames(p.ch);
  ui.img(fr[((t * 10) | 0) % fr.length]!.cv, ox + 14, 36, 84, 84);
  ui.img(FACES[p.ch]!.cv, ox + 8, 30, 20, 20);
  ui.txt(c.short, ox + 56, 122, '#ffe45e', 8, 'center');
  // right: carousels
  PART_TYPES.forEach((type, i) => {
    const row = i + 1, y = 28 + i * 25, on = p.row === row, id = p.parts[type];
    ui.panel(ox + 116, y, 200, 22, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    ui.txtS(PART_LABEL[type], ox + 122, y + 3, '#9c95d6', 'left');
    ui.txt((on ? '◀ ' : '') + fmtPart(id) + (on ? ' ▶' : ''), ox + 310, y + 3, on ? '#ffe45e' : '#fff7e0', 8, 'right');
    ui.txtS(partEffects(id), ox + 122, y + 14, '#8fe0ff', 'left');
  });
  const btn = (row: number, label: string, x: number, w: number) => {
    const on = p.row === row;
    ui.panel(x, 104, w, 22, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    ui.txt(label, x + w / 2, 111, on ? '#ffe45e' : '#fff7e0', 8, 'center');
  };
  btn(ROW_RAND, 'Aleatorio', ox + 116, 96);
  btn(ROW_OK, opts.confirm, ox + 220, 96);
  // bars
  ui.panel(ox + 4, 144, 312, 76, '#1b1740');
  STAT_KEYS.forEach((k, i) => statBarDelta(g, k, S[k].base, S[k].total, ox + 12 + (i % 2) * 156, 152 + ((i / 2) | 0) * 14, { barX: 40, seg: 5 }));
  const hid = kartStats(p.ch, p.parts);
  ui.txtS('Mini-turbo ' + hid.mt.toFixed(1) + '   Vuelo ' + hid.fly.toFixed(1) + '   Clase ' + hid.weightClass, ox + 12, 194, '#9c95d6', 'left');
  ui.txtS(opts.extra ?? '↑↓ elegir · ←→ cambiar pieza · Intro: seguir · Esc: atrás', W / 2, 228, '#9c95d6');
  void ctx;
}

/** Split screen: one compact panel per player, in their own quadrant. */
export function drawPanels(g: Game, t: number) {
  const ui = g.ui, ctx = ui.ctx, n = g.pickers.length;
  ui.bg();
  ui.txtS('Cada jugador elige su kart · J: jugadores · Intro: seguir', W / 2, 4, '#9c95d6');
  g.pickers.forEach((p, i) => {
    const [rx, ry0, rw, rh0] = uiRect(i, n), ry = ry0 + (n <= 2 ? 13 : 12), rh = rh0 - (n <= 2 ? 17 : 15), x = rx + 5, w = rw - 10, S = buildStats(p);
    ui.panel(x, ry, w, rh, p.ready ? '#1d4a33' : '#1b1740', p.ready ? '#2ec46b' : '#6d66b0');
    ui.txtS('J' + (i + 1) + (p.input ? ' · ' + SOURCE_NAMES(p.input.src).split(' · ')[0] : ''), x + 4, ry + 3, p.ready ? '#9cff9c' : '#8fe0ff', 'left');
    if (p.ready) ui.txt('¡Listo!', x + w - 6, ry + 3, '#9cff9c', 8, 'right');
    const lx = x + 4, lw = Math.min(w * 0.58, 150), rowH = Math.min(15, (rh - 14) / 6);
    const row = (r: number, y: number, label: string, text: string) => {
      const on = p.row === r && !p.ready;
      if (on) { ctx.fillStyle = 'rgba(255,228,94,0.22)'; ctx.fillRect(lx - 1, y - 1, lw + 2, rowH - 1); }
      ui.txtS(label, lx + 2, y + 2, on ? '#ffe45e' : '#9c95d6', 'left');
      ui.txtS((on ? '◀ ' : '') + text + (on ? ' ▶' : ''), lx + lw - 2, y + 2, on ? '#ffe45e' : '#fff7e0', 'right');
    };
    let y = ry + 12;
    ui.img(FACES[p.ch]!.cv, lx + 40, y - 1, 12, 12);
    row(ROW_CH, y, 'Piloto', CHARS[p.ch]!.short); y += rowH;
    PART_TYPES.forEach((type, k) => { row(k + 1, y, PART_SHORT[type], fmtPart(p.parts[type])); y += rowH; });
    row(ROW_RAND, y, '', 'Aleatorio'); y += rowH;
    row(ROW_OK, y, '', p.ready ? 'Cancelar' : 'Listo');
    const bx = x + lw + 12;
    STAT_KEYS.forEach((k, j) => statBarDelta(g, k, S[k].base, S[k].total, bx, ry + 14 + j * 11, { label: k.toUpperCase(), barX: 20, seg: Math.max(3, Math.min(5, Math.floor((w - lw - 36 - 20) / 10))), value: false }));
  });
  void t;
}

// ---------------------------------------------------------------- LAN / online lobby

/** Open the builder from the lobby with the pilot and parts the server has for me. */
export function openLobbyBuilder(g: Game) {
  const me = g.net?.me;
  if (!me) return;
  g.pickers = [{ ch: me.ch, parts: { ...me.parts }, row: ROW_OK, ready: false, input: null, held: {} }];
  g.buildFrom = 'lobby';
  g.state = 'build';
}

/** Builder confirmed in the lobby: send the pilot and parts, and (guests) mark ready. The last kart is remembered. */
export function confirmLobbyKart(g: Game) {
  const net = g.net, p = g.pickers[0];
  if (!net || !p) { g.state = 'lobby'; return; }
  net.send({ t: 'pick', ch: p.ch, parts: p.parts });
  if (!net.isHost) net.send({ t: 'ready', ready: true });
  g.profile.lastCh = p.ch; g.profile.lastParts = { ...p.parts }; g.saveProfileNow();
  g.state = 'lobby';
}

/** Once per lobby: ask the server for the kart this player built last time (pilot only if nobody else took it). */
export function lobbyTick(g: Game) {
  const net = g.net, me = net?.me;
  if (!net || !me) { g.lobbyInit = false; return; }
  if (g.lobbyInit) return;
  g.lobbyInit = true;
  const last = g.profile.lastCh, free = last >= 0 && !net.players.some((q) => q.id !== me.id && q.ch === last);
  if (validLoadout(g.profile.lastParts)) net.send({ t: 'pick', ch: free ? last : me.ch, parts: g.profile.lastParts });
}

/** Three-letter codes of a build for the lobby rows ("OVE·SLI·PLA"). */
export const partsCode = (parts: Loadout) => PART_TYPES.map((t) => fmtPart(parts[t]).slice(0, 3).toUpperCase()).join('·');
