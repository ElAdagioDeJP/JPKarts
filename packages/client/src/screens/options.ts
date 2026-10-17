// Settings / controls screens (extracted from game.ts).
// New options rows are added here, not in Game.
// Game delegates to these functions and keeps its public API stable for tools.
import { ACTION_NAMES, REMAPPABLE } from '../input/input';
import { PAD_NAMES } from '../input/gamepad';
import { DEFAULT_SETTINGS } from '../settings';
import { saveSettings } from '../settings';
import { initialTier } from '../mobile';
import { W } from '../ui/draw';
import type { Game } from '../game';

export function applySettings(g: Game) {
  const S = g.settings;
  g.audio.setVolumes(S.volume.music, S.volume.sfx);
  g.rig.shakeScale = S.shake;
  g.fx.colorblind = S.colorblind;
  g.renderer.post.enabled = S.post;
  // M3: la calidad manual fuerza tier; `auto` = ahorro en móvil, alta en PC.
  try {
    g.renderer.applyTier(S.quality === 'alta' || S.quality === 'ahorro' ? S.quality : initialTier('auto'));
    g.renderer.post.enabled = S.post;
  } catch { /* render opcional en tests */ }
  for (const [a, ks] of Object.entries(S.keys)) if (ks?.length) (g.input.bindings as any)[a] = [...ks];
  for (const [a, bs] of Object.entries(S.pad)) if (bs) (g.input.pad.bindings as any)[a] = [...bs];
}

export function storeSettings(g: Game) {
  const S = g.settings;
  S.keys = Object.fromEntries(REMAPPABLE.map((a) => [a, g.input.bindings[a]]));
  S.pad = Object.fromEntries(REMAPPABLE.map((a) => [a, g.input.pad.bindings[a]]));
  saveSettings(S);
  applySettings(g);
}

export function optionRows(g: Game): [string, string][] {
  const S = g.settings, onoff = (b: boolean) => (b ? 'Sí' : 'No');
  return [
    ['Música', '■'.repeat(Math.round(S.volume.music * 10)).padEnd(10, '·')],
    ['Efectos', '■'.repeat(Math.round(S.volume.sfx * 10)).padEnd(10, '·')],
    ['Sacudida de cámara', S.shake >= 1 ? 'Normal' : S.shake > 0 ? 'Reducida' : 'No'],
    ['Reducir destellos', onoff(S.reduceFlash)],
    ['Modo daltónico', onoff(S.colorblind)],
    ['Tamaño del HUD', S.hudScale > 1 ? '1,5×' : '1×'],
    ['Post-proceso', onoff(S.post)],
    ['Derrape', S.driftToggle ? 'Alternar' : 'Mantener'],
    ['Gas automático (táctil)', onoff(S.touch.autoGas)],
    ['Calidad', S.quality === 'auto' ? 'Auto' : S.quality === 'alta' ? 'Alta' : 'Ahorro'],
    ['Controles…', ''],
    ['Restaurar valores', ''],
    ['Tutorial y nombre: ' + g.profile.name, ''],
    ['Volver', ''],
  ];
}

export function optionsInput(g: Game, _code: string, ok: boolean, back: boolean, L: boolean, R: boolean, U: boolean, D: boolean) {
  const S = g.settings, n = optionRows(g).length, A = g.audio;
  if (U) { g.optSel = (g.optSel + n - 1) % n; A.blip(); }
  if (D) { g.optSel = (g.optSel + 1) % n; A.blip(); }
  if (back) { storeSettings(g); g.state = 'menu'; return; }
  const step = L ? -1 : R || ok ? 1 : 0;
  if (!step) return;
  const c = (v: number) => Math.max(0, Math.min(1, Math.round(v * 10) / 10));
  switch (g.optSel) {
    case 0: S.volume.music = c(S.volume.music + step * 0.1); break;
    case 1: S.volume.sfx = c(S.volume.sfx + step * 0.1); break;
    case 2: S.shake = S.shake >= 1 ? (step > 0 ? 0.3 : 0) : S.shake > 0 ? (step > 0 ? 0 : 1) : step > 0 ? 1 : 0.3; break;
    case 3: S.reduceFlash = !S.reduceFlash; break;
    case 4: S.colorblind = !S.colorblind; break;
    case 5: S.hudScale = S.hudScale > 1 ? 1 : 1.5; break;
    case 6: S.post = !S.post; break;
    case 7: S.driftToggle = !S.driftToggle; break;
    case 8: S.touch.autoGas = !S.touch.autoGas; break;
    case 9: S.quality = S.quality === 'auto' ? 'alta' : S.quality === 'alta' ? 'ahorro' : 'auto'; break;
    case 10: if (ok) { g.state = 'controls'; g.ctlSel = 0; } break;
    case 11: if (ok) { g.settings = structuredClone(DEFAULT_SETTINGS); g.input.resetBindings(); g.toast('Valores restaurados'); } break;
    case 12: if (ok) { storeSettings(g); g.openWelcome(false); return; } break;
    case 13: if (ok) { storeSettings(g); g.state = 'menu'; return; } break;
  }
  A.blip();
  storeSettings(g);
}

export function controlsInput(g: Game, code: string, ok: boolean, back: boolean, U: boolean, D: boolean) {
  const n = REMAPPABLE.length + 1;
  if (U) { g.ctlSel = (g.ctlSel + n - 1) % n; g.audio.blip(); }
  if (D) { g.ctlSel = (g.ctlSel + 1) % n; g.audio.blip(); }
  if (back || (ok && g.ctlSel === REMAPPABLE.length)) { storeSettings(g); g.state = 'options'; return; }
  if (ok && g.ctlSel < REMAPPABLE.length) {
    const action = REMAPPABLE[g.ctlSel]!;
    g.toast('Pulsa una tecla o un botón para «' + ACTION_NAMES[action] + '»…');
    g.input.capture = (c) => {
      if (c === 'Escape') { g.toast('Cancelado'); return; }
      const lost = g.input.rebind(action, c);
      g.toast(lost ? `Asignado. «${ACTION_NAMES[lost]}» ya no usa esa tecla.` : 'Asignado.');
      storeSettings(g);
    };
  }
  void code;
}

export function keyName(code: string) {
  const N: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    ShiftLeft: 'Mayús', ShiftRight: 'Mayús d.', Space: 'Espacio', Enter: 'Intro',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl d.', AltLeft: 'Alt', Tab: 'Tab',
  };
  return N[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

export function drawOptions(g: Game) {
  const ui = g.ui, rows = optionRows(g), ox = (W - 300) / 2;
  ui.bg(0.82);
  ui.txt('Opciones', W / 2, 8, '#ffe45e', 16, 'center');
  rows.forEach(([k, v], i) => {
    const y = 32 + i * 17, on = i === g.optSel;
    ui.panel(ox, y, 300, 13, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    ui.txt(k, ox + 6, y + 3, on ? '#ffe45e' : '#fff7e0');
    if (v) ui.txt((on ? '< ' : '') + v + (on ? ' >' : ''), ox + 294, y + 3, '#fff7e0', 8, 'right');
  });
  ui.txtS('Flechas o mando para cambiar · Esc para volver (se guarda solo)', W / 2, 226, '#9c95d6');
}

export function drawControls(g: Game) {
  const ui = g.ui, ox = (W - 340) / 2, I = g.input;
  ui.bg(0.85);
  ui.txt('Controles', W / 2, 8, '#ffe45e', 16, 'center');
  [...REMAPPABLE, null].forEach((a, i) => {
    const y = 32 + i * 19, on = i === g.ctlSel;
    ui.panel(ox, y, 340, 15, on ? '#3a3478' : '#241f55', on ? '#ffe45e' : '#6d66b0');
    if (!a) { ui.txt('Volver', ox + 6, y + 4, on ? '#ffe45e' : '#fff7e0'); return; }
    ui.txt(ACTION_NAMES[a], ox + 6, y + 4, on ? '#ffe45e' : '#fff7e0');
    ui.txtS(I.bindings[a].slice(0, 2).map((k) => keyName(k)).join(' / ') || '—', ox + 200, y + 5, '#fff7e0', 'left');
    ui.txtS(I.pad.bindings[a].map((b) => PAD_NAMES[b] ?? 'B' + b).join(' / ') || '—', ox + 300, y + 5, '#8fe0ff', 'left');
  });
  ui.txtS(I.pad.connected ? 'Mando conectado' : 'Sin mando (conéctalo y pulsa un botón)', W / 2, 212, I.pad.connected ? '#9cff9c' : '#9c95d6');
  ui.txtS('Enter: cambiar · si la tecla ya se usaba, se quita de la otra acción', W / 2, 226, '#9c95d6');
}
