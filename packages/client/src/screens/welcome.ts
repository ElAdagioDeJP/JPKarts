// First-run welcome: a short tutorial and, at the end, the player's name (kept in the local profile for good).
// Also reachable from Options ("Tutorial y nombre") to replay it or change the name.
import { PROFILE_NAME_MAX, cleanProfileName, validProfileName } from '@jpkart/core';
import { newProfileId, saveProfile } from '../meta/profile';
import { FACES } from '../art/sprites';
import { H, W } from '../ui/draw';
import type { Game } from '../game';

/** Tutorial pages 0..TUTORIAL_PAGES-1, then the name page. */
const TUTORIAL_PAGES = 5;
const NAME_PAGE = TUTORIAL_PAGES;

export function openWelcome(g: Game, first: boolean) {
  g.welcome = { page: 0, name: g.profile.name, first };
  g.input.textMode = false;
  g.state = 'welcome';
}

const key = (g: Game, a: 'acelerar' | 'frenar' | 'izquierda' | 'derecha' | 'derrapar' | 'objeto' | 'mirarAtras') =>
  g.input.bindings[a].slice(0, 2).map((k) => g.keyName(k)).join(' / ');

/** Phone/tablet: the tutorial talks about the on-screen buttons instead of keys. */
const onPhone = () => typeof document !== 'undefined' && document.body.classList.contains('mobile');

function phoneLines(page: number): { title: string; lines: string[] } | null {
  switch (page) {
    case 1: return { title: 'Conducir', lines: [
      'Desliza el pulgar izquierdo para girar:',
      'el joystick aparece donde lo apoyas.',
      'GAS acelera (ya viene en automático).',
      'FRENO frena y da marcha atrás.',
      '',
      'Salida: acelera justo cuando sale el «1».',
    ] };
    case 2: return { title: 'Derrapar', lines: [
      'Mantén DERAPE mientras giras.',
      'Las chispas cambian de color:',
      'azul → naranja → morado.',
      'Al soltar, sales con un mini-turbo:',
      'cuanto más morado, más fuerte.',
    ] };
    case 3: return { title: 'Objetos', lines: [
      'Pasa por las cajas para recibir un objeto.',
      'Toca OBJETO para usarlo.',
      'Los que van atrás reciben objetos más fuertes;',
      'el líder, los más sencillos. ¡Aguanta y remonta!',
      'II (arriba) pausa la carrera.',
    ] };
    default: return null;
  }
}

function pageLines(g: Game, page: number): { title: string; lines: string[] } {
  const ph = onPhone() ? phoneLines(page) : null;
  if (ph) return ph;
  switch (page) {
    case 0: return { title: '¡Bienvenido a JP Kart!', lines: [
      'Carreras de karts con 8 pilotos.',
      'Juega solo contra la IA, con amigos en LAN',
      'o por internet con un código de sala.',
      '',
      'Te enseño lo básico en un minuto.',
    ] };
    case 1: return { title: 'Conducir', lines: [
      'Acelerar: ' + key(g, 'acelerar') + '    Frenar: ' + key(g, 'frenar'),
      'Girar: ' + key(g, 'izquierda') + ' · ' + key(g, 'derecha'),
      'Mirar atrás: ' + key(g, 'mirarAtras'),
      '',
      'Salida: acelera justo cuando sale el «1».',
      'Si aceleras demasiado pronto, patinas.',
    ] };
    case 2: return { title: 'Derrapar', lines: [
      'Mantén ' + key(g, 'derrapar') + ' mientras giras para derrapar.',
      'Las chispas cambian de color:',
      'azul → naranja → morado.',
      'Al soltar, sales con un mini-turbo:',
      'cuanto más morado, más fuerte.',
    ] };
    case 3: return { title: 'Objetos', lines: [
      'Pasa por las cajas para recibir un objeto.',
      'Úsalo con ' + key(g, 'objeto') + '.',
      'Los que van atrás reciben objetos más fuertes;',
      'el líder, los más sencillos. ¡Aguanta y remonta!',
      'Las monedas te dan un poco de velocidad.',
    ] };
    case 4: return { title: 'Online y LAN', lines: [
      'Crea una sala y pasa el código a tus amigos.',
      'Al cruzar la meta miras al resto correr.',
      'Cuando el primero llega, los demás tienen',
      '30 segundos para terminar.',
      'La siguiente carrera empieza sola.',
    ] };
    default: return { title: '', lines: [] };
  }
}

export function welcomeInput(g: Game, code: string, ok: boolean, back: boolean, L: boolean, R: boolean) {
  const w = g.welcome;
  if (!w) { g.state = 'title'; return; }
  if (w.page < NAME_PAGE) {
    if (ok || R || code === 'Space') w.page++;
    else if (L && w.page > 0) w.page--;
    else if (back) w.page = NAME_PAGE; // skip the tutorial
    g.input.textMode = w.page === NAME_PAGE;
    return;
  }
  g.input.textMode = true;
  if (back) {
    if (w.first) { g.toast('Escribe un nombre para empezar'); return; }
    g.input.textMode = false; g.state = 'options'; return;
  }
  if (!(ok && (code === 'Enter' || code === 'NumpadEnter' || code.startsWith('Pad')))) return;
  let name = cleanProfileName(w.name);
  // gamepad only: nothing typed, so a default name (it can be changed later in Options)
  if (!name && code.startsWith('Pad')) name = 'Piloto' + (g.profile.id.slice(0, 2).replace(/\D/g, '') || '1');
  if (!validProfileName(name)) { g.toast('El nombre necesita al menos 3 letras'); return; }
  g.profile = { ...g.profile, id: g.profile.id || newProfileId(), name, tutorialDone: true };
  saveProfile(g.profile);
  g.lanName = name;
  g.input.textMode = false;
  g.toast('¡Listo, ' + name + '! Quedas guardado en este dispositivo');
  g.state = w.first ? 'title' : 'options';
  g.welcome = null;
}

function typeName(g: Game) {
  const w = g.welcome!;
  for (const ch of g.input.typed.splice(0)) {
    if (ch === 'Backspace') w.name = w.name.slice(0, -1);
    else if (w.name.length < PROFILE_NAME_MAX && /[\p{L}\p{N} _.-]/u.test(ch)) w.name += ch;
  }
}

export function drawWelcome(g: Game, t: number) {
  const w = g.welcome;
  if (!w) return;
  const ui = g.ui;
  ui.bg(0.82);
  const dots = Array.from({ length: NAME_PAGE + 1 }, (_, i) => (i === w.page ? '●' : '○')).join(' ');
  if (w.page < NAME_PAGE) {
    const { title, lines } = pageLines(g, w.page);
    ui.txt(title, W / 2, 24, '#ffe45e', 16, 'center');
    lines.forEach((l, i) => ui.txt(l, W / 2, 70 + i * 16, '#fff7e0', 8, 'center'));
    ui.img(FACES[(w.page * 3 + ((t * 2) | 0)) % FACES.length]!.cv, W / 2 - 16, 160, 32, 32);
    ui.txtS(dots, W / 2, 204, '#9c95d6');
    ui.txtS(onPhone() ? 'Toca la pantalla u OK: siguiente · ◀ atrás · ATRÁS: saltar' : 'Intro o → siguiente · ← atrás · Esc: saltar el tutorial', W / 2, 226, '#9c95d6');
    return;
  }
  typeName(g);
  const caret = ((t * 2) | 0) % 2 ? '_' : ' ', ox = (W - 280) / 2;
  ui.txt('¿Cómo te llamas?', W / 2, 30, '#ffe45e', 16, 'center');
  ui.txt('Así te verán los demás jugadores.', W / 2, 62, '#fff7e0', 8, 'center');
  ui.panel(ox, 90, 280, 24, '#3a3478', '#ffe45e');
  ui.txt(w.name + caret, ox + 8, 98, '#fff7e0', 16);
  ui.txtS(onPhone() ? 'Toca el recuadro para escribir · 3 a ' + PROFILE_NAME_MAX + ' letras' : '3 a ' + PROFILE_NAME_MAX + ' caracteres', W / 2, 122, '#9c95d6');
  ui.txtS('Tu perfil se guarda en este dispositivo.', W / 2, 146, '#fff7e0');
  ui.txtS('Puedes cambiar el nombre en Opciones.', W / 2, 158, '#fff7e0');
  ui.txtS('Otras personas pueden usar el mismo nombre.', W / 2, 170, '#fff7e0');
  ui.txtS(dots, W / 2, H - 36, '#9c95d6');
  ui.txtS(onPhone() ? (w.first ? 'OK: empezar' : 'OK: guardar · ATRÁS: cancelar') : w.first ? 'Intro: empezar' : 'Intro: guardar · Esc: cancelar', W / 2, H - 14, '#9c95d6');
}
