// Local split screen (Phase 10, input-systems): one input source per player. Player 1 keeps every binding when
// alone; with more players the keyboard splits in two (arrows / WASD) and the gamepads take the rest, one each.
import type { Action, Input } from './input';

export type Source = { kind: 'all' } | { kind: 'keys'; set: 'flechas' | 'wasd' } | { kind: 'pad'; index: number };

/** Keyboard halves for two players on one keyboard. */
export const KEYSETS: Record<'flechas' | 'wasd', Partial<Record<Action, string[]>>> = {
  flechas: { acelerar: ['ArrowUp'], frenar: ['ArrowDown'], izquierda: ['ArrowLeft'], derecha: ['ArrowRight'], derrapar: ['ShiftRight', 'Period'], objeto: ['Slash', 'ControlRight'] },
  wasd: { acelerar: ['KeyW'], frenar: ['KeyS'], izquierda: ['KeyA'], derecha: ['KeyD'], derrapar: ['ShiftLeft', 'KeyC'], objeto: ['KeyQ', 'KeyE'] },
};
export const SOURCE_NAMES = (s: Source) => (s.kind === 'all' ? 'Teclado y mando' : s.kind === 'keys' ? (s.set === 'flechas' ? 'Flechas · Shift der. · /' : 'WASD · Shift izq. · Q') : 'Mando ' + (s.index + 1));

const DEAD = 0.2;
const pads = (): (Gamepad | null)[] => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []);
/** Indices of the connected gamepads, in order. */
export const connectedPads = () => pads().flatMap((p, i) => (p && p.connected ? [i] : []));

/** Sources for `n` local players: pads when there are enough, otherwise the keyboard halves first. */
export function assignSources(n: number): Source[] {
  if (n <= 1) return [{ kind: 'all' }];
  const ps = connectedPads(), out: Source[] = [];
  if (ps.length >= n) return ps.slice(0, n).map((index) => ({ kind: 'pad', index }));
  out.push({ kind: 'keys', set: 'flechas' }, { kind: 'keys', set: 'wasd' });
  for (const index of ps) if (out.length < n) out.push({ kind: 'pad', index });
  // not enough devices: the next free pad slots (they work as soon as a pad is connected)
  for (let index = 0; out.length < n; index++) if (!ps.includes(index)) out.push({ kind: 'pad', index });
  return out.slice(0, n);
}

export class PlayerInput {
  /** item button pressed since the last simulation tick consumed it */
  itemPressed = false;
  private prevItem = false;
  constructor(public src: Source, private base: Input) {}

  private gp(): Gamepad | null {
    return this.src.kind === 'pad' ? pads()[this.src.index] ?? null : null;
  }
  held(a: Action): boolean {
    const s = this.src;
    if (s.kind === 'all') return this.base.held(a);
    if (s.kind === 'keys') return (KEYSETS[s.set][a] ?? []).some((k) => this.base.keys.has(k));
    const gp = this.gp();
    return !!gp && this.base.pad.bindings[a].some((i) => gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5);
  }
  steer(): number {
    const k = (this.held('derecha') ? 1 : 0) - (this.held('izquierda') ? 1 : 0);
    if (k !== 0 || this.src.kind !== 'pad') return this.src.kind === 'all' ? this.base.steer() : k;
    const gp = this.gp();
    if (!gp) return 0;
    const x = gp.axes[0] ?? 0, y = gp.axes[1] ?? 0, mag = Math.hypot(x, y);
    return mag < DEAD ? 0 : (x / mag) * Math.min(1, (mag - DEAD) / (1 - DEAD));
  }
  throttle(): number {
    if (this.src.kind === 'all') return this.base.throttle();
    const k = (this.held('acelerar') ? 1 : 0) - (this.held('frenar') ? 1 : 0);
    if (k !== 0 || this.src.kind !== 'pad') return k;
    const gp = this.gp(), rt = gp?.buttons[7]?.value ?? 0, lt = gp?.buttons[6]?.value ?? 0;
    return rt > 0.05 || lt > 0.05 ? rt - lt : 0;
  }
  /** Once per frame: latch the item button's rising edge until a tick uses it. */
  poll() {
    const it = this.held('objeto');
    if (it && !this.prevItem) this.itemPressed = true;
    this.prevItem = it;
  }
}
