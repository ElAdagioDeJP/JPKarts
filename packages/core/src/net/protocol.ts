// Network protocol (CLAUDE.md rule 10): authoritative server, inputs 60 Hz up, snapshots ~30 Hz down.
// JSON messages (the WebSocket layer compresses them with permessage-deflate).
import { Rng } from '../math';
import { tunablesHash } from '../tunables';
import type { Track } from '../track/track';
import type { Ctrl, GameEvent, Input, RaceConfig, World } from '../sim/types';

export const PROTOCOL_VERSION = 2; // 2: coins, item charges, Phase 8 items and hazards
export const LAN_PORT = 7777;
export const DISCOVERY_PORT = 7778;
export const SNAPSHOT_EVERY = 3; // server ticks per snapshot (60 Hz / 3 = 20 Hz): clients predict everything, so 20 Hz is plenty

/** Packed input: [seq, t·127, s·127, drift, item]. */
export type PackedInput = [number, number, number, number, number];
export const packInput = (seq: number, i: Input): PackedInput => [seq, Math.round(i.t * 127), Math.round(i.s * 127), i.d ? 1 : 0, i.item ? 1 : 0];
export const unpackInput = (p: PackedInput): Input => ({ t: p[1] / 127, s: p[2] / 127, d: !!p[3], item: !!p[4] });

export interface LobbyPlayer { id: number; name: string; ch: number; ready: boolean; host: boolean }
export interface LobbySettings {
  mode: 'free' | 'cup' | 'elimination' | 'battle' | 'capture';
  trackIndex: number; cup: number; diff: number; laps: number;
  /** two teams, no friendly fire */
  teams?: boolean;
  /** engine class: '100' | '150' | 'espejo' (LAN: everything is unlocked) */
  cls?: string;
}

export type ClientMsg =
  | { t: 'hello'; proto: number; name: string; tun: string }
  | { t: 'pick'; ch: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; s: LobbySettings }
  | { t: 'start' }
  | { t: 'next' }
  | { t: 'in'; i: PackedInput[] }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'welcome'; id: number; proto: number }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; players: LobbyPlayer[]; settings: LobbySettings; phase: 'lobby' | 'race' | 'standings'; cupRace: number; cupPts: Record<number, number> }
  | { t: 'start'; cfg: RaceConfig; kart: number }
  | { t: 'snap'; tick: number; ack: number; state?: WorldState; delta?: Delta; last: Record<number, PackedInput> }
  | { t: 'end'; order: number[]; points: Record<number, number> };

/** Everything needed to rebuild a World on a peer (the track is rebuilt locally from cfg.trackIndex). */
export type WorldState = Omit<World, 'track' | 'rng' | 'events'> & { rng: number };

export function serializeWorld(w: World): WorldState {
  const { track: _t, rng, events: _e, ...rest } = w;
  return JSON.parse(JSON.stringify({ ...rest, rng: rng.s }));
}

/** Overwrite `w` with a received state (same track). Deep copy: the snapshot can be reused. */
export function restoreWorld(w: World, s: WorldState) {
  const c: WorldState = JSON.parse(JSON.stringify(s));
  Object.assign(w, c, { rng: new Rng(0), events: [] });
  w.rng.s = c.rng;
}

export function worldFromState(s: WorldState, track: Track): World {
  const w = { track, rng: new Rng(0), events: [] as GameEvent[] } as unknown as World;
  restoreWorld(w, s);
  return w;
}

/** Peers must agree on the rules: protocol version + tunables fingerprint. */
export const handshakeTunables = () => tunablesHash();

export const isRemoteHuman = (c: Ctrl) => c === 'remote' || c === 'local';

/**
 * Exact JSON delta between two states (TCP keeps snapshots ordered and reliable, so each one can be a diff
 * of the previous). Objects: only changed keys; arrays of equal length: per index; otherwise replaced.
 * `null` marks a deleted key. The rebuilt state is bit-identical to the server's.
 */
export type Delta = { [k: string]: unknown } | unknown[];
const DEL = { __del: 1 };
export function diffJson(a: unknown, b: unknown): unknown {
  if (a === b) return undefined;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return b === undefined ? DEL : b;
  if (Array.isArray(a) !== Array.isArray(b)) return b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return b;
    const out: Record<string, unknown> = {};
    let any = false;
    for (let i = 0; i < b.length; i++) { const d = diffJson(a[i], b[i]); if (d !== undefined) { out[i] = d; any = true; } }
    return any ? { __arr: out } : undefined;
  }
  const out: Record<string, unknown> = {};
  let any = false;
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  for (const k of Object.keys(bo)) { const d = diffJson(ao[k], bo[k]); if (d !== undefined) { out[k] = d; any = true; } }
  for (const k of Object.keys(ao)) if (!(k in bo)) { out[k] = DEL; any = true; }
  return any ? out : undefined;
}
export function patchJson(a: unknown, d: unknown): unknown {
  if (d === undefined) return a;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return d;
  const dd = d as Record<string, unknown>;
  if ('__del' in dd) return undefined;
  if ('__arr' in dd) {
    const arr = [...(a as unknown[])];
    for (const [i, v] of Object.entries(dd.__arr as Record<string, unknown>)) arr[Number(i)] = patchJson(arr[Number(i)], v);
    return arr;
  }
  if (typeof a !== 'object' || a === null || Array.isArray(a)) a = {};
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(dd)) {
    const pv = patchJson(out[k], v);
    if (pv === undefined) delete out[k];
    else out[k] = pv;
  }
  return out;
}
