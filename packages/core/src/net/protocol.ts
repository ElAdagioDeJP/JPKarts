// Network protocol (CLAUDE.md rule 10): authoritative server, inputs 60 Hz up, snapshots ~30 Hz down.
// JSON messages (the WebSocket layer compresses them with permessage-deflate).
import { Rng } from '../math';
import { tunablesHash } from '../tunables';
import type { Track } from '../track/track';
import type { Loadout } from '../data/parts';
import type { Ctrl, GameEvent, Input, RaceConfig, World } from '../sim/types';

export const PROTOCOL_VERSION = 7; // 7: 12 players, kart parts in `pick`/lobby (+ `pickIn` countdown), `parts` in the grid; 6: snapshots relay the humans' inputs + a periodic hash instead of the world (full state on start/resync); 5: items Overclock/Fork Bomb/Antivirus/Pico de Latencia; 4: load barrier (`loaded`/`go`), race ids, rejoin by `pid`; 3: auto next race (`nextIn`), last call; 2: coins, item charges, Phase 8 items and hazards
export const LAN_PORT = 7777;
export const DISCOVERY_PORT = 7778;
export const SNAPSHOT_EVERY = 3; // server ticks per snapshot (60 Hz / 3 = 20 Hz): clients predict everything, so 20 Hz is plenty
export const HASH_EVERY = 10; // snapshots between two world hashes (2 Hz): a client whose copy drifted asks for a full state

/** One relayed tick: the packed input of every human kart, `[kart, t·127, s·127, drift, item]`. */
export type RelayTick = [number, number, number, number, number][];

/** Packed input: [seq, t·127, s·127, drift, item]. */
export type PackedInput = [number, number, number, number, number];
export const packInput = (seq: number, i: Input): PackedInput => [seq, Math.round(i.t * 127), Math.round(i.s * 127), i.d ? 1 : 0, i.item ? 1 : 0];
export const unpackInput = (p: PackedInput): Input => ({ t: p[1] / 127, s: p[2] / 127, d: !!p[3], item: !!p[4] });
/** The server never trusts a client: a packed input must be 5 integers in range (NaN would break determinism). */
export const validPacked = (p: unknown): p is PackedInput =>
  Array.isArray(p) && p.length === 5 && p.every((v) => Number.isInteger(v)) && p[0] >= 0 && Math.abs(p[1]) <= 127 && Math.abs(p[2]) <= 127 && (p[3] === 0 || p[3] === 1) && (p[4] === 0 || p[4] === 1);
/** Player names: printable characters only, trimmed, 12 at most. */
export const cleanName = (n: unknown) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12).trim() : '') || 'Jugador';
/** Profile id (random, kept on the player's device): lets a dropped player come back to the same kart. */
export const cleanPid = (p: unknown) => (typeof p === 'string' && /^[A-Za-z0-9-]{8,40}$/.test(p) ? p : undefined);
/** Online room codes: 5 characters without look-alikes (no I, O, 0, 1). */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const cleanRoomCode = (c: unknown) => (typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) : '');

export interface LobbyPlayer { id: number; name: string; ch: number; /** the kart build */ parts: Loadout; ready: boolean; host: boolean; seat?: number; conn?: number }
export interface LobbySettings {
  mode: 'free' | 'cup' | 'elimination' | 'battle' | 'capture';
  trackIndex: number; cup: number; diff: number; laps: number;
  /** two teams, no friendly fire */
  teams?: boolean;
  /** engine class: '100' | '150' | 'espejo' (LAN: everything is unlocked) */
  cls?: string;
}

export type ClientMsg =
  | { t: 'hello'; proto: number; name: string; tun: string; room?: string; create?: boolean; /** profile id (see cleanPid) */ pid?: string }
  /** choose the pilot and (optionally) the kart parts; the server validates both against the data files */
  | { t: 'pick'; ch: number; parts?: Loadout; seat?: number }
  | { t: 'ready'; ready: boolean }
  /** split screen over the network: one more local player on this connection (seat 1, 2, 3) */
  | { t: 'addSeat'; name: string }
  | { t: 'settings'; s: LobbySettings }
  | { t: 'start' }
  /** this client built the track of race `rid`: the countdown waits until every human sent it */
  | { t: 'loaded'; rid: number }
  | { t: 'next' }
  /** `seats[k]`: the inputs of local seat k + 1 (same seq numbers as `i`) */
  | { t: 'in'; i: PackedInput[]; seats?: PackedInput[][] }
  | { t: 'leave' }
  /** the client's authoritative copy drifted (hash mismatch / gap): send the next snapshot whole */
  | { t: 'resync' };

export type ServerMsg =
  | { t: 'welcome'; id: number; proto: number; room?: string }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; players: LobbyPlayer[]; settings: LobbySettings; phase: 'lobby' | 'race' | 'standings'; cupRace: number; cupPts: Record<number, number>; room?: string; /** seconds until the next race starts by itself (standings only) */ nextIn?: number; /** while the race waits for the slow clients */ loading?: { done: number; total: number }; /** the host pressed start and somebody has not confirmed their kart: seconds until the server picks for them */ pickIn?: number }
  /** `seats`: the karts of the extra local seats, in seat order */
  | { t: 'start'; cfg: RaceConfig; kart: number; seats?: number[]; /** race id: stale messages of another race are ignored */ rid: number; /** a dropped player coming back to a race already running: no load barrier */ resume?: boolean }
  /** every human is ready: the countdown starts now */
  | { t: 'go'; rid: number }
  /**
   * `state`: the whole world after `tick` (race start, rejoin, resync, server-side changes). Otherwise `ins`: the
   * humans' inputs of every tick since the previous snapshot (the core is deterministic, so the client advances its
   * own authoritative copy with them) and, every HASH_EVERY snapshots, `h` = hashWorld after `tick`.
   */
  | { t: 'snap'; rid: number; tick: number; ack: number; state?: WorldState; ins?: RelayTick[]; h?: string }
  | { t: 'end'; rid: number; order: number[]; points: Record<number, number> };

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

/** Overwrite `dst` with a deep copy of `src` (same track), cloning once. */
export function copyWorld(dst: World, src: World) {
  const { track: _t, rng, events: _e, ...rest } = src;
  Object.assign(dst, JSON.parse(JSON.stringify(rest)), { rng: new Rng(0), events: [] });
  dst.rng.s = rng.s;
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
