// LAN / online / lobby screens + their input (extracted from game.ts).
// Lobby protocol stays in net/session.ts; this module is draw + field navigation only.
import {
  ARENA_INDICES, CHARS, CLASSIC_CUPS, CLASSES, CLASS_NAMES, CUPS, DIFFS,
  type EngineClass,
} from '@jpkart/core';
import { FACES } from '../art/sprites';
import { isArena, type Mode } from '../app/types';
import { W } from '../ui/draw';
import { desktop } from '../net/session';
import type { Game } from '../game';

/** LAN menu fields: 0 name, 1 address, then (desktop app) 2 create game, 3 search, 4.. found games. */
export function lanFieldCount(g: Game) { return desktop() ? 4 + g.lanFound.length : 2; }

export function lanInput(g: Game, code: string, back: boolean, U: boolean, D: boolean) {
  if (back) { g.input.textMode = false; g.state = 'menu'; return; }
  const n = lanFieldCount(g);
  if (U) { g.lanField = (g.lanField + n - 1) % n; }
  if (D || code === 'Tab') { g.lanField = (g.lanField + 1) % n; }
  g.input.textMode = g.lanField < 2;
  if (code !== 'Enter' && code !== 'NumpadEnter' && code !== 'Pad0') return;
  const d = desktop();
  if (g.lanField < 2) { g.input.textMode = false; g.connectLan(); return; }
  if (!d) return;
  if (g.lanField === 2) {
    void d.host(g.lanName).then((h) => {
      g.lanHosting = h.addresses;
      g.toast('Partida creada. Tus amigos se conectan a ' + (h.addresses[0] ?? 'tu IP') + ':' + h.port);
      g.connectLan('localhost');
    });
  } else if (g.lanField === 3) {
    g.toast('Buscando partidas en la red...');
    void d.discover().then((list) => {
      g.lanFound = list;
      g.toast(list.length ? list.length + ' partida(s) encontrada(s)' : 'No se encontró ninguna partida');
    });
  } else {
    const found = g.lanFound[g.lanField - 4];
    if (found) g.connectLan(found.address + ':' + found.port);
  }
}

export function onlineInput(g: Game, code: string, back: boolean, U: boolean, D: boolean) {
  if (back) { g.input.textMode = false; g.state = 'menu'; return; }
  if (U) g.onlineField = (g.onlineField + 4) % 5;
  if (D || code === 'Tab') g.onlineField = (g.onlineField + 1) % 5;
  g.input.textMode = g.onlineField < 3;
  if (code !== 'Enter' && code !== 'NumpadEnter' && code !== 'Pad0') return;
  const create = g.onlineField === 3 || (g.onlineField < 3 && !g.onlineCode);
  if (!g.onlineAddr.trim()) { g.toast('Escribe la dirección del servidor online'); g.onlineField = 1; return; }
  if (!create && g.onlineCode.length < 5) { g.toast('El código de sala tiene 5 letras'); g.onlineField = 2; return; }
  try { localStorage.setItem('jpkart.online.server', g.onlineAddr.trim()); } catch { /* private mode */ }
  g.input.textMode = false;
  g.connectLan(g.onlineAddr, g.lanName, create ? { create: true } : { room: g.onlineCode });
}

export function typeInto(g: Game) {
  for (const ch of g.input.typed.splice(0)) {
    const online = g.state === 'online', f = online ? g.onlineField : g.lanField;
    const field = f === 0 ? 'lanName' : online ? (f === 1 ? 'onlineAddr' : 'onlineCode') : 'lanAddr';
    if (ch === 'Backspace') g[field] = g[field].slice(0, -1);
    else if (field === 'onlineCode') { if (g.onlineCode.length < 5 && /[a-z0-9]/i.test(ch)) g.onlineCode += ch.toUpperCase(); }
    else if (g[field].length < (field === 'lanName' ? 12 : 60)) g[field] += ch;
  }
}

export function lobbyInput(g: Game, _code: string, ok: boolean, back: boolean, L: boolean, R: boolean, U: boolean, D: boolean) {
  const net = g.net;
  if (!net) { g.state = 'menu'; return; }
  if (back) { g.leaveNet(); return; }
  if (net.status === 'closed') {
    if (ok) { g.state = net.url.startsWith('wss') || g.netOnline ? 'online' : 'lan'; g.input.textMode = true; }
    return;
  }
  const me = net.me;
  if (!me) return;
  if (L || R) net.send({ t: 'pick', ch: (me.ch + (L ? 7 : 1)) % 8 });
  if ((_code === 'KeyJ' || _code === 'Pad8') && net.localSeats.length < 4)
    net.send({ t: 'addSeat', name: (me.name || 'Jugador').slice(0, 9) + ' ' + (net.localSeats.length + 1) });
  if (_code === 'KeyR' || (ok && !net.isHost)) net.send({ t: 'ready', ready: !me.ready });
  if (net.isHost) {
    const s = { ...net.settings };
    if (U || D) {
      const ms = ['free', 'cup', 'elimination', 'battle', 'capture'] as const, was = isArena(s.mode as Mode);
      s.mode = ms[(ms.indexOf(s.mode) + (U ? ms.length - 1 : 1)) % ms.length]!;
      if (s.mode !== 'free' && s.mode !== 'cup') s.teams = false;
      if (isArena(s.mode as Mode) !== was) s.trackIndex = isArena(s.mode as Mode) ? ARENA_INDICES[0]! : CUPS[0]!.tracks[0]!;
      net.send({ t: 'settings', s });
    }
    if (_code === 'KeyX') { s.cls = CLASSES[(CLASSES.indexOf((s.cls ?? '100') as EngineClass) + 1) % CLASSES.length]; net.send({ t: 'settings', s }); }
    if (_code === 'KeyT' && s.mode !== 'elimination') { s.teams = !s.teams; net.send({ t: 'settings', s }); }
    if (_code === 'KeyQ' || _code === 'KeyE') {
      const dir = _code === 'KeyE' ? 1 : -1;
      if (s.mode === 'cup') s.cup = (s.cup + dir + CUPS.length) % CUPS.length;
      else {
        const list = isArena(s.mode as Mode) ? ARENA_INDICES : [...CUPS, ...CLASSIC_CUPS].flatMap((c) => c.tracks);
        const gi = list.indexOf(s.trackIndex);
        s.trackIndex = list[(Math.max(0, gi) + dir + list.length) % list.length]!;
      }
      net.send({ t: 'settings', s });
    }
    if (_code === 'KeyF') { s.diff = (s.diff + 1) % 3; net.send({ t: 'settings', s }); }
    if (ok) net.send({ t: 'start' });
  }
}

export function drawOnline(g: Game, t: number) {
  const ui = g.ui, ox = (W - 300) / 2, caret = ((t * 2) | 0) % 2 ? '_' : ' ';
  typeInto(g);
  ui.bg(0.85);
  ui.txt('Online', W / 2, 10, '#ffe45e', 16, 'center');
  ([['Tu nombre', g.lanName], ['Servidor (dominio o IP:puerto)', g.onlineAddr], ['Código de sala (para unirte)', g.onlineCode]] as const)
    .forEach(([k, v], i) => {
      const y = 36 + i * 36, on = i === g.onlineField;
      ui.txtS(k, ox, y, '#9c95d6', 'left');
      ui.panel(ox, y + 10, 300, 18, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      ui.txt(v + (on ? caret : ''), ox + 6, y + 15, '#fff7e0');
    });
  ['Crear sala nueva', 'Unirse con el código'].forEach((r, i) => {
    const y = 150 + i * 18, on = g.onlineField === 3 + i;
    ui.panel(ox, y, 300, 15, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    ui.txt(r, W / 2, y + 4, on ? '#ffe45e' : '#fff7e0', 8, 'center');
  });
  ui.txtS('Crea la sala y pasa el código a tus amigos. La conexión va cifrada (wss).', W / 2, 202, '#fff7e0');
  ui.txtS('Intro: crear o unirse · ↑↓ cambia de campo · Esc vuelve', W / 2, 226, '#9c95d6');
}

export function drawLan(g: Game, t: number) {
  const ui = g.ui, ox = (W - 300) / 2;
  typeInto(g);
  ui.bg(0.85);
  ui.txt('Multijugador LAN', W / 2, 10, '#ffe45e', 16, 'center');
  const caret = ((t * 2) | 0) % 2 ? '_' : ' ';
  ([['Tu nombre', g.lanName], ['Anfitrión (IP o nombre)', g.lanAddr]] as const).forEach(([k, v], i) => {
    const y = 50 + i * 44, on = i === g.lanField;
    ui.txtS(k, ox, y, '#9c95d6', 'left');
    ui.panel(ox, y + 10, 300, 18, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    ui.txt(v + (on ? caret : ''), ox + 6, y + 15, '#fff7e0');
  });
  const d = desktop();
  if (d) {
    const rows = ['Crear partida (en este PC)', 'Buscar partidas en la red', ...g.lanFound.map((found) => `Unirse a ${found.name} · ${found.address} · ${found.players} jugador(es)`)];
    rows.forEach((r, i) => {
      const y = 142 + i * 15, on = g.lanField === i + 2;
      ui.panel(ox, y, 300, 12, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
      ui.txtS(r, ox + 6, y + 3, on ? '#ffe45e' : '#fff7e0', 'left');
    });
    ui.txtS('Si Windows pregunta por el firewall, permite el acceso en redes privadas.', W / 2, 214, '#9c95d6');
  } else ui.txtS('El anfitrión ejecuta "bun run server" o crea la partida desde la app de escritorio.', W / 2, 160, '#fff7e0');
  ui.txtS('Puerto 7777 · Intro para conectar · ↑↓ cambia de campo · Esc vuelve', W / 2, 226, '#9c95d6');
}

export function drawLobby(g: Game, t: number) {
  const ui = g.ui, net = g.net, ox = (W - 340) / 2;
  ui.bg(0.85);
  ui.txt(net?.room ? 'Sala online ' + net.room : 'Sala LAN', W / 2, 8, '#ffe45e', 16, 'center');
  if (!net) return;
  if (net.status === 'connecting') { ui.txt('Conectando a ' + net.url + '...', W / 2, 100, '#fff7e0', 8, 'center'); return; }
  if (net.status === 'closed') {
    ui.txt(net.error || 'Conexión cerrada', W / 2, 96, '#ff6a6a', 8, 'center');
    ui.txtS('Intro: volver a intentar · Esc: menú', W / 2, 120, '#9c95d6');
    return;
  }
  const S = net.settings;
  const what = S.mode === 'cup'
    ? CUPS[S.cup]!.name + (net.phase !== 'lobby' ? ` · carrera ${net.cupRace + 1}` : '')
    : g.tracks.get(S.trackIndex).def.name;
  ui.panel(ox, 30, 340, 22, '#1b1740', '#6d66b0');
  ui.txt(
    ({ cup: 'Copa: ', elimination: 'Eliminación: ', battle: 'Globos: ', capture: 'Captura: ', free: 'Carrera: ' } as Record<string, string>)[S.mode]! + what,
    ox + 6, 34, '#fff7e0');
  ui.txtS(
    'IA: ' + DIFFS[S.diff]!.name + ' · ' + CLASS_NAMES[(S.cls ?? '100') as EngineClass] + (S.teams ? ' · Equipos' : '') +
    ' · ' + net.players.length + ' humano(s) + ' + (8 - net.players.length) + ' IA',
    ox + 6, 45, '#9c95d6', 'left');
  if (S.mode === 'cup') {
    const cw = 340 / CUPS.length;
    CUPS.forEach((c, i) => {
      const on = i === S.cup;
      ui.panel(ox + i * cw, 54, cw - 2, 10, on ? '#3a3478' : '#241f55', on ? c.col : '#6d66b0');
      ui.txtS(c.name.replace('Copa ', ''), ox + i * cw + (cw - 2) / 2, 56, on ? c.col : '#9c95d6', 'center');
    });
  }
  net.players.forEach((p, i) => {
    const y = 68 + i * 18, me = p.id === net.id;
    ui.panel(ox, y, 340, 15, me ? '#3a3478' : '#241f55', me ? '#ffe45e' : '#6d66b0');
    ui.img(FACES[p.ch]!.cv, ox + 4, y - 1, 16, 16);
    ui.txt(p.name + (p.host ? ' ★' : '') + (p.seat ? ' (pantalla de ' + (net.players.find((q) => q.conn === p.conn && !q.seat)?.name ?? '?') + ')' : ''),
      ox + 26, y + 4, me || p.conn === net.id ? '#ffe45e' : '#fff7e0');
    ui.txt(CHARS[p.ch]!.short, ox + 200, y + 4, '#9c95d6');
    ui.txt(p.host ? 'anfitrión' : p.ready ? 'listo ✓' : 'no listo', ox + 334, y + 4, p.ready || p.host ? '#9cff9c' : '#ff8a9a', 8, 'right');
  });
  const help = net.isHost
    ? '←→ piloto · Q/E copa o pista · ↑↓ modo · F IA · X clase · T equipos · Intro'
    : '←→ personaje · Intro o R: listo · J: otro jugador aquí';
  ui.txtS(help, W / 2, 214, '#9c95d6');
  ui.txtS('Esc: salir de la sala', W / 2, 226, '#9c95d6');
  void t;
}
