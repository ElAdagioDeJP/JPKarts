import type { Track } from '../track/track';
import { createWorld, step, takeEvents } from './world';
import { quantizeInput, type Input, type RaceConfig, type World } from './types';

/** Plain-data snapshot of the world (no track geometry, no pending events). */
export function snapshot(w: World) {
  return {
    cfg: w.cfg, rng: w.rng.s, tick: w.tick, karts: w.karts, ents: w.ents, nextEnt: w.nextEnt,
    boxes: w.boxes, pairCD: w.pairCD, raceT: w.raceT, phase: w.phase, cd: w.cd, cdLast: w.cdLast, finishDelay: w.finishDelay, ranked: w.ranked, finalOrder: w.finalOrder,
  };
}

/** FNV-1a 32-bit over the canonical JSON of the snapshot. */
export function hashWorld(w: World): string {
  const s = JSON.stringify(snapshot(w));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const REPLAY_VERSION = 1;

/** Input changes per human kart: [tick, t, s, d(0/1), item(0/1)] only when the input changed. */
export interface Replay {
  version: number;
  cfg: RaceConfig;
  ticks: number;
  inputs: Record<number, [number, number, number, number, number][]>;
  /** hash every 60 ticks, to detect desyncs */
  hashes: string[];
}

export class ReplayRecorder {
  replay: Replay;
  private last: Record<number, string> = {};
  constructor(cfg: RaceConfig) {
    this.replay = { version: REPLAY_VERSION, cfg, ticks: 0, inputs: {}, hashes: [] };
  }
  /** Call once per tick, before `step`, with the same inputs. */
  record(w: World, inputs: readonly Input[]) {
    w.karts.forEach((k) => {
      if (k.ctrl === 'ai') return;
      const i = quantizeInput(inputs[k.id]);
      const row: [number, number, number, number, number] = [w.tick, Math.round(i.t * 127), Math.round(i.s * 127), i.d ? 1 : 0, i.item ? 1 : 0];
      const key = row.slice(1).join(',');
      if (this.last[k.id] !== key) {
        (this.replay.inputs[k.id] ??= []).push(row);
        this.last[k.id] = key;
      }
    });
  }
  /** Call once per tick, after `step`. */
  after(w: World) {
    this.replay.ticks = w.tick;
    if (w.tick % 60 === 0) this.replay.hashes.push(hashWorld(w));
  }
}

/** Steps a replay one tick at a time (ghosts, the end-of-race replay). Deterministic: same world as the original. */
export class ReplayPlayer {
  world: World;
  private cursor: Record<number, number> = {};
  private cur: Input[] = [];
  constructor(public replay: Replay, track: Track) {
    if (replay.version !== REPLAY_VERSION) throw new Error('Versión de replay no soportada: ' + replay.version);
    this.world = createWorld(replay.cfg, track);
  }
  get done() { return this.world.tick >= this.replay.ticks; }
  /** Advance one tick. Returns the events of that tick. */
  step() {
    const w = this.world;
    if (this.done) return [];
    for (const [id, rows] of Object.entries(this.replay.inputs)) {
      const k = Number(id);
      let c = this.cursor[k] ?? 0;
      while (c < rows.length && rows[c]![0] <= w.tick) {
        const [, t, s, d, item] = rows[c]!;
        this.cur[k] = { t: t / 127, s: s / 127, d: !!d, item: !!item };
        c++;
      }
      this.cursor[k] = c;
    }
    step(w, this.cur);
    return takeEvents(w);
  }
}

/** Re-simulate a replay headless. Returns the world and the index of the first hash mismatch (-1 if none). */
export function playReplay(r: Replay, track: Track, onTick?: (w: World) => void): { world: World; mismatch: number } {
  const p = new ReplayPlayer(r, track), w = p.world;
  let mismatch = -1;
  while (!p.done) {
    p.step();
    onTick?.(w);
    if (w.tick % 60 === 0 && mismatch < 0) {
      const i = w.tick / 60 - 1;
      if (r.hashes[i] !== undefined && r.hashes[i] !== hashWorld(w)) mismatch = i;
    }
  }
  return { world: w, mismatch };
}
