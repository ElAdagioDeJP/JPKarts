// How each core effect looks in the client (labels over karts, HUD status lines). Data only:
// a new effect in core gets its presentation by adding one entry here.
import { OUCH, type Fx, type Kart } from '@jpkart/core';

export interface EffectView {
  /** text over the kart; `self` = also shown over the local kart */
  label?: { text: (f: Fx) => string; color: string; self: boolean };
  /** HUD status line for the local kart */
  hud?: { text: (f: Fx) => string; color: string };
  /** label priority (lower wins) */
  prio: number;
}

export const EFFECT_VIEW: Record<string, EffectView> = {
  ouch: { prio: 0, label: { text: (f) => OUCH[f.data] ?? '¡Ay!', color: '#ff6a6a', self: true } },
  scare: { prio: 1, label: { text: () => '¡!', color: '#ffe45e', self: true } },
  emp: { prio: 2, label: { text: () => 'PEM', color: '#3df0ff', self: false }, hud: { text: () => 'Motor apagado', color: '#3df0ff' } },
  inv: { prio: 3, label: { text: () => '¿?', color: '#ff6ad0', self: false } },
  jug: { prio: 4, label: { text: () => '★', color: '#ffd23a', self: true }, hud: { text: (f) => '¡Juggernaut! ' + Math.ceil(f.t), color: '#ffd23a' } },
  bubble: { prio: 9, hud: { text: () => 'Burbuja activa', color: '#8fe0ff' } },
  goma: { prio: 9, hud: { text: (f) => 'Goma ' + Math.ceil(f.t), color: '#ff8a9a' } },
  hook: { prio: 9, hud: { text: () => 'Gancho', color: '#ffe45e' } },
  slow: { prio: 9, hud: { text: () => 'Te enganchan', color: '#ff8a1f' } },
  smudge: { prio: 9 },
};

/** Label over a kart: the highest-priority effect that has one. */
export function kartLabel(k: Kart, isLocal: boolean): [string, string] | null {
  let best: [string, string] | null = null, bp = 1e9;
  for (const f of k.fx) {
    const v = EFFECT_VIEW[f.type];
    if (!v?.label || (isLocal && !v.label.self) || v.prio >= bp) continue;
    best = [v.label.text(f), v.label.color];
    bp = v.prio;
  }
  return best;
}

/** HUD status lines for the local kart, in effect registration order. */
export function hudLines(k: Kart): [string, string][] {
  const out: [string, string][] = [];
  for (const f of k.fx) {
    const v = EFFECT_VIEW[f.type];
    if (v?.hud) out.push([v.hud.text(f), v.hud.color]);
  }
  return out;
}

/** Entity kind → what the world renderer draws. */
export const ENTITY_VIEW: Record<string, 'fake' | 'tar' | 'shot' | 'dron' | 'hole'> = {
  fake: 'fake', tar: 'tar', shot: 'shot', rocket: 'dron', hole: 'hole',
};
