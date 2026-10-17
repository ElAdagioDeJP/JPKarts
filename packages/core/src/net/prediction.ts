// Client-side prediction + reconciliation (docs/PLAN.md Fase 6, docs/PERF_PLAN.md P4).
// The client keeps two worlds. `auth` is the server's world: it starts from a full state and then advances with the
// humans' inputs the server relays (the core is deterministic, so it stays bit-identical; a periodic hash checks it).
// `world` is predicted ahead with our own inputs: on every snapshot it is reset to `auth` and the inputs the server
// has not processed yet are re-simulated. The only mismatch comes from other humans' unknown inputs (we assume they
// keep their last one).
import { dhypot } from '../dmath';
import { hashWorld } from '../sim/replay';
import { createWorld, step, takeEvents } from '../sim/world';
import type { GameEvent, Input, RaceConfig, World } from '../sim/types';
import type { Track } from '../track/track';
import { copyWorld, packInput, restoreWorld, unpackInput, type PackedInput, type ServerMsg } from './protocol';

export class PredictedRace {
  world: World;
  seq = 0;
  /** inputs sent but not yet acknowledged by the server */
  private pending: { seq: number; input: Input; extra: Input[] }[] = [];
  /** last known input of every remote human (from the relayed inputs) */
  private others: Record<number, Input> = {};
  /** local kart position error introduced by the last reconciliation (for smoothing and metrics) */
  lastCorrection = 0;
  corrections: number[] = [];
  serverTick = 0;
  /** the server's world, advanced with the relayed inputs (null until the first full state) */
  private auth: World | null = null;
  /** the authoritative copy drifted or missed ticks: ask for a full state (the session sends `resync`) */
  needResync = false;
  /** how many times that happened (metrics; 0 in a healthy race) */
  resyncs = 0;
  /** ticks re-simulated by the last reconciliation (metrics) */
  lastResim = 0;

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
   * Take a server snapshot into the authoritative world WITHOUT re-simulating the prediction. Several can queue up
   * between two frames (slow line, throttled tab): apply them all here and call `reconcile()` once.
   */
  ingest(m: Extract<ServerMsg, { t: 'snap' }>) {
    if (!this.dirty) { const me = this.world.karts[this.kart]; this.before = me ? { x: me.x, y: me.y } : null; }
    this.serverTick = m.tick;
    if (m.state) {
      this.auth ??= createWorld(this.cfg, this.world.track);
      restoreWorld(this.auth, m.state);
      this.needResync = false;
    } else if (m.ins && this.auth && !this.needResync) {
      if (this.auth.tick !== m.tick - m.ins.length) this.drift();
      else {
        for (const tk of m.ins) {
          const arr: Input[] = [];
          for (const [k, t, s, d, item] of tk) arr[k] = unpackInput([0, t, s, d, item]);
          step(this.auth, arr);
          takeEvents(this.auth);
        }
        const lastTick = m.ins[m.ins.length - 1];
        if (lastTick) for (const [k, t, s, d, item] of lastTick) if (k !== this.kart && !this.seats.includes(k)) this.others[k] = unpackInput([0, t, s, d, item]);
        if (m.h && hashWorld(this.auth) !== m.h) this.drift();
      }
    }
    this.pending = this.pending.filter((q) => q.seq > m.ack);
    this.dirty = true;
  }

  private drift() { this.needResync = true; this.resyncs++; }

  /** Reset the prediction to the authoritative world and re-simulate the inputs the server has not processed yet (events discarded). */
  reconcile() {
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.auth || this.needResync) return; // keep predicting until the full state arrives
    copyWorld(this.world, this.auth);
    for (const q of this.pending) step(this.world, this.inputsFor(q.input, q.extra));
    this.lastResim = this.pending.length;
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
