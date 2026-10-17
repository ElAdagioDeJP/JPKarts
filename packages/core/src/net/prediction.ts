// Client-side prediction + reconciliation (docs/PLAN.md Fase 6).
// The client simulates the whole world ahead with its own inputs. When a server snapshot arrives it restores
// that exact state and re-simulates the inputs the server has not processed yet. Because the core is
// deterministic, the only mismatch comes from other humans' unknown inputs (we assume they keep their last one).
import { dhypot } from '../dmath';
import { createWorld, step, takeEvents } from '../sim/world';
import type { GameEvent, Input, RaceConfig, World } from '../sim/types';
import type { Track } from '../track/track';
import { packInput, patchJson, restoreWorld, unpackInput, type PackedInput, type ServerMsg, type WorldState } from './protocol';

export class PredictedRace {
  world: World;
  seq = 0;
  /** inputs sent but not yet acknowledged by the server */
  private pending: { seq: number; input: Input; extra: Input[] }[] = [];
  /** last known input of every remote human (from snapshots) */
  private others: Record<number, Input> = {};
  /** local kart position error introduced by the last reconciliation (for smoothing and metrics) */
  lastCorrection = 0;
  corrections: number[] = [];
  serverTick = 0;
  /** last full authoritative state (deltas are applied on top of it) */
  private base: WorldState | null = null;

  /** `seats`: the karts of extra local players (split screen over the network) */
  constructor(public cfg: RaceConfig, track: Track, public kart: number, public seats: number[] = []) {
    this.world = createWorld(cfg, track);
  }

  private inputsFor(local: Input, extra: Input[]): Input[] {
    const arr: Input[] = [];
    for (const [id, i] of Object.entries(this.others)) arr[Number(id)] = i;
    arr[this.kart] = local;
    this.seats.forEach((k, s) => { arr[k] = extra[s] ?? arr[k]!; });
    return arr;
  }

  /** Predict one tick with the local input. Returns the packed input to send and the predicted events. */
  tick(input: Input, extra: Input[] = []): { packed: PackedInput; seats: PackedInput[]; events: GameEvent[] } {
    this.seq++;
    this.pending.push({ seq: this.seq, input, extra });
    step(this.world, this.inputsFor(input, extra));
    return { packed: packInput(this.seq, input), seats: extra.map((e) => packInput(this.seq, e)), events: takeEvents(this.world) };
  }

  /** local kart position before the first snapshot that is waiting to be reconciled */
  private before: { x: number; y: number } | null = null;
  private dirty = false;

  /**
   * Take a server snapshot into the authoritative base WITHOUT re-simulating. Several can queue up between two frames
   * (slow line, throttled tab): apply them all here and call `reconcile()` once.
   */
  ingest(m: Extract<ServerMsg, { t: 'snap' }>) {
    if (!this.dirty) { const me = this.world.karts[this.kart]; this.before = me ? { x: me.x, y: me.y } : null; }
    this.serverTick = m.tick;
    for (const [id, p] of Object.entries(m.last)) if (Number(id) !== this.kart && !this.seats.includes(Number(id))) this.others[Number(id)] = unpackInput(p);
    if (m.state) this.base = m.state;
    else if (m.delta && this.base) this.base = patchJson(this.base, m.delta) as WorldState;
    this.pending = this.pending.filter((q) => q.seq > m.ack);
    this.dirty = true;
  }

  /** Restore the latest base and re-simulate the inputs the server has not processed yet (events discarded). */
  reconcile() {
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.base) return;
    restoreWorld(this.world, this.base);
    for (const q of this.pending) step(this.world, this.inputsFor(q.input, q.extra));
    takeEvents(this.world);
    const after = this.world.karts[this.kart], before = this.before;
    if (before && after) {
      this.lastCorrection = dhypot(after.x - before.x, after.y - before.y);
      this.corrections.push(this.lastCorrection);
      if (this.corrections.length > 600) this.corrections.shift();
    }
  }

  /** Apply a server snapshot: ingest + reconcile (one at a time; the client batches with ingest/reconcile). */
  onSnapshot(m: Extract<ServerMsg, { t: 'snap' }>) {
    this.ingest(m);
    this.reconcile();
  }

  get pendingCount() { return this.pending.length; }
}
