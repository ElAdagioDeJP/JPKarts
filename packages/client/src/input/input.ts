// Input layer: gameplay reads named actions, never raw keys (input-systems). Keyboard + gamepad.
import { DEFAULT_PAD, Gamepads } from './gamepad';

export type Action = 'acelerar' | 'frenar' | 'izquierda' | 'derecha' | 'derrapar' | 'objeto' | 'mirarAtras' | 'pausa' | 'sonido' | 'aceptar' | 'atras' | 'arriba' | 'abajo';

/** Gameplay actions the player can remap (menu navigation keeps its defaults as a safe way back). */
export const REMAPPABLE: Action[] = ['acelerar', 'frenar', 'izquierda', 'derecha', 'derrapar', 'objeto', 'mirarAtras', 'pausa'];
export const ACTION_NAMES: Record<Action, string> = {
  acelerar: 'Acelerar', frenar: 'Frenar', izquierda: 'Izquierda', derecha: 'Derecha', derrapar: 'Derrapar / truco', objeto: 'Usar objeto',
  mirarAtras: 'Mirar atrás', pausa: 'Pausa', sonido: 'Sonido', aceptar: 'Aceptar', atras: 'Atrás', arriba: 'Arriba', abajo: 'Abajo',
};

export const DEFAULT_KEYS: Record<Action, string[]> = {
  acelerar: ['ArrowUp', 'KeyW'],
  frenar: ['ArrowDown', 'KeyS'],
  izquierda: ['ArrowLeft', 'KeyA'],
  derecha: ['ArrowRight', 'KeyD'],
  derrapar: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  objeto: ['Space', 'KeyX'],
  mirarAtras: ['KeyB'],
  pausa: ['KeyP'],
  sonido: ['KeyM'],
  aceptar: ['Enter', 'Space'],
  atras: ['Escape'],
  arriba: ['ArrowUp', 'KeyW'],
  abajo: ['ArrowDown', 'KeyS'],
};

export class Input {
  keys = new Set<string>();
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_KEYS);
  pad = new Gamepads();
  private pressedQ: string[] = [];
  onFirstGesture: (() => void) | null = null;
  /** when set, the next key/button press is captured for remapping instead of being dispatched */
  capture: ((code: string) => void) | null = null;
  /** typed characters (for text fields), only collected while `textMode` is on */
  textMode = false;
  typed: string[] = [];

  attach(target: Window, focusEl: HTMLElement) {
    target.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3', 'F4'].includes(e.code)) e.preventDefault();
      if (this.textMode && (e.key.length === 1 || e.key === 'Backspace')) this.typed.push(e.key);
      if (!this.keys.has(e.code)) this.pressedQ.push(e.code);
      this.keys.add(e.code);
      this.pad.lastUsed = false;
      this.onFirstGesture?.();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
    focusEl.addEventListener('pointerdown', () => { focusEl.focus(); this.onFirstGesture?.(); });
  }

  /** Poll gamepads once per frame (before reading input). */
  poll() {
    this.pad.poll();
    const codes = this.pad.drainPressed();
    if (codes.length) this.onFirstGesture?.();
    this.pressedQ.push(...codes);
  }

  held(a: Action): boolean {
    return this.bindings[a].some((k) => this.keys.has(k)) || this.pad.held(a);
  }
  /** Analog steering −1..1 (keyboard gives −1/0/1). */
  steer(): number {
    const k = (this.held('derecha') ? 1 : 0) - (this.held('izquierda') ? 1 : 0);
    return k !== 0 ? k : this.pad.steer;
  }
  /** Analog throttle −1..1. */
  throttle(): number {
    const k = (this.held('acelerar') ? 1 : 0) - (this.held('frenar') ? 1 : 0);
    return k !== 0 ? k : this.pad.throttle;
  }
  /** Codes pressed since the last call (edge events, in order). Captured codes are consumed by `capture`. */
  drainPressed(): string[] {
    const q = this.pressedQ;
    this.pressedQ = [];
    if (this.capture && q.length) { const c = this.capture; this.capture = null; c(q[0]!); return []; }
    return q;
  }
  is(code: string, a: Action) {
    return this.bindings[a].includes(code) || this.pad.actionsOf(code).includes(a);
  }

  /** Bind `code` (a key code or 'PadN') to `action`. A conflicting gameplay action loses that code. Returns it. */
  rebind(action: Action, code: string): Action | null {
    let conflict: Action | null = null;
    if (code.startsWith('Pad')) {
      const b = Number(code.slice(3));
      for (const other of REMAPPABLE) if (other !== action && this.pad.bindings[other].includes(b)) { conflict = other; this.pad.bindings[other] = this.pad.bindings[other].filter((x) => x !== b); }
      this.pad.bindings[action] = [b, ...this.pad.bindings[action].filter((x) => x !== b)].slice(0, 2);
    } else {
      for (const other of REMAPPABLE) if (other !== action && this.bindings[other].includes(code)) { conflict = other; this.bindings[other] = this.bindings[other].filter((x) => x !== code); }
      this.bindings[action] = [code, ...this.bindings[action].filter((x) => x !== code)].slice(0, 2);
    }
    return conflict;
  }
  resetBindings() {
    this.bindings = structuredClone(DEFAULT_KEYS);
    this.pad.bindings = structuredClone(DEFAULT_PAD);
  }
}
