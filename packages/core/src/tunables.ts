// Every balance/tuning number lives in core/data/tunables/*.json (CLAUDE.md rule 5).
// The object is mutated in place on hot reload, so code always reads the current value.
import driving from '../data/tunables/driving.json';
import items from '../data/tunables/items.json';
import race from '../data/tunables/race.json';
import ai from '../data/tunables/ai.json';
import surfaces from '../data/tunables/surfaces.json';

const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v));
export const T = { driving: clone(driving), items: clone(items), race: clone(race), ai: clone(ai), surfaces: clone(surfaces) };
export type Tunables = typeof T;
export type TunableGroup = keyof Tunables;
const DEFAULTS: Tunables = clone(T);

/** Shape check: same keys and same value types as the defaults, all numbers finite. */
export function validateTunables(group: TunableGroup, data: unknown): string[] {
  const errs: string[] = [];
  const walk = (ref: any, v: any, path: string) => {
    if (typeof ref === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${path}: se esperaba un número`); return; }
    if (ref && typeof ref === 'object') {
      if (!v || typeof v !== 'object') { errs.push(`${path}: se esperaba un objeto`); return; }
      for (const k of Object.keys(ref)) walk(ref[k], v[k], path + '.' + k);
      for (const k of Object.keys(v)) if (!(k in ref)) errs.push(`${path}.${k}: clave desconocida`);
      return;
    }
    if (typeof v !== typeof ref) errs.push(`${path}: tipo incorrecto`);
  };
  walk(DEFAULTS[group], data, group);
  return errs;
}

/** Replace a group in place (dev hot reload). Returns validation errors; nothing changes if there are any. */
export function setTunables(group: TunableGroup, data: unknown): string[] {
  const errs = validateTunables(group, data);
  if (errs.length) return errs;
  const assign = (dst: any, src: any) => {
    for (const k of Object.keys(src)) {
      if (src[k] && typeof src[k] === 'object') assign(dst[k], src[k]);
      else dst[k] = src[k];
    }
  };
  assign(T[group], data);
  return [];
}

/** Fingerprint of all tunables: peers must agree on it (network handshake, replays). */
export function tunablesHash(): string {
  const s = JSON.stringify(T);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
