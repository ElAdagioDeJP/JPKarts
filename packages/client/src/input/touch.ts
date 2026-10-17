// Controles táctiles M1 (input-systems + game-feel): joystick flotante + botones.
// El contrato con el resto del juego es `Input` (input.ts): el táctil alimenta
// steer/throttle/held y un código virtual `TouchItem`; `core` no se toca.
// La parte pura (curva, mezcla) es testeable en Bun; la DOM está guardada.
import type { Action } from './input';
import { buzz } from '../mobile';

export const TOUCH_DEADZONE = 0.15;
export const TOUCH_RADIUS = 56;
export const TOUCH_MIN_PX = 56;
/** Código virtual que `Input.is(code,'objeto')` reconoce (equivale a Space). */
export const TOUCH_ITEM_CODE = 'TouchItem';

export interface TouchAnalog {
  /** −1..1 ya con deadzone + curva */
  steer: number;
  /** 0..1 (con autoGas el layer pone 1 por defecto) */
  gas: number;
  /** 0..1 */
  brake: number;
  drift: boolean;
}

export const NEUTRAL_TOUCH: TouchAnalog = { steer: 0, gas: 0, brake: 0, drift: false };

/** Deadzone radial 0.15 + curva x^1.4 (el táctil se siente mal sin ella). */
export function applyTouchCurve(v: number): number {
  const a = Math.abs(v);
  if (a < TOUCH_DEADZONE) return 0;
  const n = (a - TOUCH_DEADZONE) / (1 - TOUCH_DEADZONE);
  return Math.sign(v) * Math.pow(n, 1.4);
}

/** Mezcla táctil → SimInput. Con autoGas el gas va a fondo salvo freno. */
export function touchStateToSimInput(
  s: TouchAnalog,
  autoGas: boolean,
): { t: number; s: number; d: boolean } {
  const gas = autoGas ? 1 : s.gas;
  const t = Math.max(-1, Math.min(1, gas - s.brake));
  return { t, s: Math.max(-1, Math.min(1, s.steer)), d: s.drift };
}

export interface TouchCallbacks {
  onAnalog(s: TouchAnalog): void;
  onItem(): void;
  onGesture(): void;
}

/**
 * Overlay DOM: joystick flotante a la izquierda (aparece donde cae el pulgar),
 * derecha: GAS (grande), FRENO, DERAPE, OBJETO (≥56 px, `touch-action:none`,
 * un `pointerId` por dedo, `pointercancel` = soltar). 5 toques simultáneos.
 */
export class TouchControls {
  private root: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private cb: TouchCallbacks | null = null;
  private autoGas = true;
  private joyId: number | null = null;
  private joyOX = 0;
  private joyOY = 0;
  private joyDX = 0;
  private joyDY = 0;
  private gasIds = new Set<number>();
  private brakeIds = new Set<number>();
  private driftIds = new Set<number>();
  private baseEl: HTMLElement | null = null;
  private knobEl: HTMLElement | null = null;
  private off: (() => void)[] = [];
  attached = false;

  constructor(autoGas = true) {
    this.autoGas = autoGas;
  }

  setAutoGas(v: boolean) {
    this.autoGas = v;
    this.emit();
  }

  attach(stage: HTMLElement, cb: TouchCallbacks): void {
    if (this.attached || typeof document === 'undefined') return;
    this.stage = stage;
    this.cb = cb;
    const root = stage.querySelector<HTMLElement>('#touch');
    if (!root) return;
    this.root = root;
    root.innerHTML = '';
    root.setAttribute('aria-hidden', 'false');

    const mk = (label: string, cls: string, x: string, y: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tbtn ' + cls;
      b.textContent = label;
      b.style.right = x;
      b.style.bottom = y;
      b.setAttribute('aria-label', label);
      root.appendChild(b);
      return b;
    };
    // Layout 844×390: GAS grande abajo-derecha, FRENO a su izquierda,
    // DERAPE encima de GAS, OBJETO encima de FRENO. Todo ≥56 px.
    const gasB = mk('GAS', 'gas', '16px', '16px');
    const brakeB = mk('FRENO', '', '116px', '16px');
    const driftB = mk('DERAPE', '', '16px', '116px');
    const itemB = mk('OBJETO', 'item', '116px', '116px');

    const on = (el: EventTarget, ev: string, fn: (e: Event) => void) => {
      el.addEventListener(ev, fn as EventListener, { passive: false });
      this.off.push(() => el.removeEventListener(ev, fn as EventListener));
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      this.cb?.onGesture();
      const r = (this.stage as HTMLElement).getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // Mitad izquierda = joystick flotante (re-ancla al dedo restante).
      if (x < r.width / 2 && this.joyId === null && e.pointerType !== 'mouse') {
        this.joyId = e.pointerId;
        this.joyOX = e.clientX;
        this.joyOY = e.clientY;
        this.joyDX = 0;
        this.joyDY = 0;
        this.showJoy(e.clientX, e.clientY, 0, 0);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      e.preventDefault();
      const dx = e.clientX - this.joyOX, dy = e.clientY - this.joyOY;
      const m = Math.hypot(dx, dy), max = TOUCH_RADIUS * 2;
      const k = m > max ? max / m : 1;
      this.joyDX = dx * k;
      this.joyDY = dy * k;
      // El steering usa el eje X normalizado al radio (56 px = fondo).
      void dy;
      this.showJoy(this.joyOX, this.joyOY, this.joyDX, this.joyDY);
      this.emit();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.joyDX = 0;
        this.joyDY = 0;
        this.hideJoy();
        this.emit();
      }
      this.gasIds.delete(e.pointerId);
      this.brakeIds.delete(e.pointerId);
      this.driftIds.delete(e.pointerId);
      this.emit();
    };
    on(stage, 'pointerdown', down as (e: Event) => void);
    on(window, 'pointermove', move as (e: Event) => void);
    on(window, 'pointerup', up as (e: Event) => void);
    // `pointercancel` (Chrome Android pierde el dedo): se suelta sin ghosting.
    on(window, 'pointercancel', up as (e: Event) => void);
    on(window, 'blur', (() => {
      this.joyId = null;
      this.gasIds.clear();
      this.brakeIds.clear();
      this.driftIds.clear();
      this.hideJoy();
      this.emit();
    }) as (e: Event) => void);

    const hold = (set: Set<number>, e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      set.add(e.pointerId);
      this.cb?.onGesture();
      this.emit();
    };
    const release = (set: Set<number>, e: PointerEvent) => {
      e.preventDefault();
      set.delete(e.pointerId);
      this.emit();
    };
    for (const [btn, set] of [[gasB, this.gasIds], [brakeB, this.brakeIds], [driftB, this.driftIds]] as const) {
      on(btn, 'pointerdown', ((e: Event) => hold(set, e as PointerEvent)) as (e: Event) => void);
      on(btn, 'pointerup', ((e: Event) => release(set, e as PointerEvent)) as (e: Event) => void);
      on(btn, 'pointercancel', ((e: Event) => release(set, e as PointerEvent)) as (e: Event) => void);
      on(btn, 'lostpointercapture', (() => {}) as (e: Event) => void);
    }
    on(itemB, 'pointerdown', ((e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb?.onGesture();
      buzz(15);
      this.cb?.onItem();
    }) as (e: Event) => void);
    this.attached = true;
    this.emit();
  }

  detach(): void {
    for (const fn of this.off) try { fn(); } catch { /* noop */ }
    this.off = [];
    if (this.root) this.root.innerHTML = '';
    this.root = null;
    this.stage = null;
    this.cb = null;
    this.attached = false;
  }

  private showJoy(cx: number, cy: number, dx: number, dy: number): void {
    if (typeof document === 'undefined' || !this.stage || !this.root) return;
    const r = this.stage.getBoundingClientRect();
    if (!this.baseEl) {
      this.baseEl = document.createElement('div');
      this.baseEl.className = 'joy-base';
      this.knobEl = document.createElement('div');
      this.knobEl.className = 'joy-knob';
      this.root.append(this.baseEl, this.knobEl);
    }
    const bx = cx - r.left, by = cy - r.top;
    this.baseEl.style.left = bx + 'px';
    this.baseEl.style.top = by + 'px';
    this.knobEl!.style.left = bx + dx / 2 + 'px';
    this.knobEl!.style.top = by + dy / 2 + 'px';
    void dy;
  }

  private hideJoy(): void {
    this.baseEl?.remove();
    this.knobEl?.remove();
    this.baseEl = null;
    this.knobEl = null;
  }

  private emit(): void {
    if (!this.cb) return;
    const nx = Math.max(-1, Math.min(1, this.joyDX / TOUCH_RADIUS));
    this.cb.onAnalog({
      steer: applyTouchCurve(nx),
      gas: this.autoGas ? 1 : this.gasIds.size > 0 ? 1 : 0,
      brake: this.brakeIds.size > 0 ? 1 : 0,
      drift: this.driftIds.size > 0,
    });
  }
}
