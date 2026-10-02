// Input layer: gameplay reads named actions, never raw keys (input-systems).
export type Action = 'acelerar' | 'frenar' | 'izquierda' | 'derecha' | 'derrapar' | 'objeto' | 'pausa' | 'sonido' | 'aceptar' | 'atras' | 'arriba' | 'abajo';

export const DEFAULT_KEYS: Record<Action, string[]> = {
  acelerar: ['ArrowUp', 'KeyW'],
  frenar: ['ArrowDown', 'KeyS'],
  izquierda: ['ArrowLeft', 'KeyA'],
  derecha: ['ArrowRight', 'KeyD'],
  derrapar: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  objeto: ['Space', 'KeyX'],
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
  private pressedQ: string[] = [];
  onFirstGesture: (() => void) | null = null;

  attach(target: Window, focusEl: HTMLElement) {
    target.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedQ.push(e.code);
      this.keys.add(e.code);
      this.onFirstGesture?.();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
    focusEl.addEventListener('pointerdown', () => { focusEl.focus(); this.onFirstGesture?.(); });
  }

  held(a: Action): boolean {
    return this.bindings[a].some((k) => this.keys.has(k));
  }
  /** Key codes pressed since the last call (edge events, in order). */
  drainPressed(): string[] {
    const q = this.pressedQ;
    this.pressedQ = [];
    return q;
  }
  is(code: string, a: Action) {
    return this.bindings[a].includes(code);
  }
}
