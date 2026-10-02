// Gamepad API (input-systems): standard mapping, radial dead zone, edge events for menus.
import type { Action } from './input';

/** Standard gamepad buttons → actions (remappable through settings). */
export const DEFAULT_PAD: Record<Action, number[]> = {
  acelerar: [0, 7], // A, RT
  frenar: [1, 6], // B, LT
  izquierda: [14],
  derecha: [15],
  derrapar: [2, 5], // X, RB
  objeto: [3, 4], // Y, LB
  mirarAtras: [10], // L3
  pausa: [9], // Start
  sonido: [],
  aceptar: [0, 9],
  atras: [1, 8],
  arriba: [12],
  abajo: [13],
};

export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Guía'];

export class Gamepads {
  bindings: Record<Action, number[]> = structuredClone(DEFAULT_PAD);
  connected = false;
  steer = 0;
  throttle = 0;
  private prev: boolean[] = [];
  private pressed: number[] = [];
  /** set when any pad input was used last (to show pad glyphs) */
  lastUsed = false;

  poll() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected) ?? null;
    this.connected = !!gp;
    this.pressed = [];
    if (!gp) { this.steer = 0; this.throttle = 0; return; }
    // radial dead zone on the left stick (diagonals keep their direction)
    const x = gp.axes[0] ?? 0, y = gp.axes[1] ?? 0, mag = Math.hypot(x, y), dead = 0.2;
    this.steer = mag < dead ? 0 : (x / mag) * Math.min(1, (mag - dead) / (1 - dead));
    const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
    this.throttle = rt > 0.05 || lt > 0.05 ? rt - lt : 0;
    gp.buttons.forEach((b, i) => {
      const down = b.pressed || b.value > 0.5;
      if (down && !this.prev[i]) { this.pressed.push(i); this.lastUsed = true; }
      this.prev[i] = down;
    });
    if (Math.abs(this.steer) > 0.3) this.lastUsed = true;
    // left stick also navigates menus
    if (y < -0.6 && !this.prev[100]) this.pressed.push(12);
    if (y > 0.6 && !this.prev[101]) this.pressed.push(13);
    if (x < -0.6 && !this.prev[102]) this.pressed.push(14);
    if (x > 0.6 && !this.prev[103]) this.pressed.push(15);
    this.prev[100] = y < -0.6; this.prev[101] = y > 0.6; this.prev[102] = x < -0.6; this.prev[103] = x > 0.6;
  }

  held(a: Action): boolean {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return false;
    return this.bindings[a].some((i) => gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5);
  }

  /** Buttons pressed this frame, as synthetic key codes ('Pad0', 'Pad12'…). */
  drainPressed(): string[] {
    return this.pressed.map((i) => 'Pad' + i);
  }

  /** Which actions does a synthetic code trigger? */
  actionsOf(code: string): Action[] {
    if (!code.startsWith('Pad')) return [];
    const i = Number(code.slice(3));
    return (Object.keys(this.bindings) as Action[]).filter((a) => this.bindings[a].includes(i));
  }
}
