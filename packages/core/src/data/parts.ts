import partsJson from '../../data/parts.json';
import type { Rng } from '../math';

export type PartType = 'body' | 'wheels' | 'wing';
export const PART_TYPES: readonly PartType[] = ['body', 'wheels', 'wing'];
/** Deltas over the five visible stats plus the two hidden ones (mini-turbo, flight). Data: core/data/parts.json. */
export interface PartDef { id: string; type: PartType; name: string; vel: number; ace: number; pes: number; man: number; tra: number; mt: number; vue: number }
/** A kart build: one part id per slot. Plain data (CLAUDE.md rule 3). */
export interface Loadout { body: string; wheels: string; wing: string }

export const PARTS: readonly PartDef[] = partsJson as PartDef[];
export const DEFAULT_LOADOUT: Readonly<Loadout> = Object.freeze({ body: 'kernel', wheels: 'std', wing: 'wing' });

const BY_ID = new Map(PARTS.map((p) => [p.id, p]));
export const partById = (id: string): PartDef | undefined => BY_ID.get(id);
export const partsOfType = (t: PartType): PartDef[] => PARTS.filter((p) => p.type === t);

/** Every slot holds an existing part of the right type, and nothing else is in the object (servers never trust a client). */
export function validLoadout(x: unknown): x is Loadout {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (Object.keys(o).length !== PART_TYPES.length) return false;
  return PART_TYPES.every((t) => typeof o[t] === 'string' && BY_ID.get(o[t] as string)?.type === t);
}

/** The loadout to simulate: the given one if valid, else the default (a bad config must never break the sim). */
export const resolveLoadout = (x: unknown): Loadout => (validLoadout(x) ? { body: x.body, wheels: x.wheels, wing: x.wing } : { ...DEFAULT_LOADOUT });

/** "Aleatorio": one random part per slot, from the given (seeded) generator. */
export function randomLoadout(rng: Rng): Loadout {
  const pick = (t: PartType) => rng.pick(partsOfType(t)).id;
  return { body: pick('body'), wheels: pick('wheels'), wing: pick('wing') };
}
