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
  private pending: { seq: number; input: Input }[] = [];
  /** last known input of every remote human (from snapshots) */
  private others: Record<number, Input> = {};
  /** local kart position error introduced by the last reconciliation (for smoothing and metrics) */
  lastCorrection = 0;
  corrections: number[] = [];
  serverTick = 0;
  /** last full authoritative state (deltas are applied on top of it) */
  private base: WorldState | null = null;

  constructor(public cfg: RaceConfig, track: Track, public kart: number) {
    this.world = createWorld(cfg, track);
  }

  private inputsFor(local: Input): Input[] {
    const arr: Input[] = [];
    for (const [id, i] of Object.entries(this.others)) arr[Number(id)] = i;
    arr[this.kart] = local;
    return arr;
  }

  /** Predict one tick with the local input. Returns the packed input to send and the predicted events. */
  tick(input: Input): { packed: PackedInput; events: GameEvent[] } {
    this.seq++;
    this.pending.push({ seq: this.seq, input });
    step(this.world, this.inputsFor(input));
    return { packed: packInput(this.seq, input), events: takeEvents(this.world) };
  }

  /** Apply a server snapshot: restore, drop acknowledged inputs, re-simulate the rest (events discarded). */
  onSnapshot(m: Extract<ServerMsg, { t: 'snap' }>) {
    const me = this.world.karts[this.kart];
    const before = me ? { x: me.x, y: me.y } : null;
    this.serverTick = m.tick;
    for (const [id, p] of Object.entries(m.last)) if (Number(id) !== this.kart) this.others[Number(id)] = unpackInput(p);
    if (m.state) this.base = m.state;
    else if (m.delta && this.base) this.base = patchJson(this.base, m.delta) as WorldState;
    if (!this.base) return;
    restoreWorld(this.world, this.base);
    this.pending = this.pending.filter((p) => p.seq > m.ack);
    for (const p of this.pending) step(this.world, this.inputsFor(p.input));
    takeEvents(this.world);
    const after = this.world.karts[this.kart];
    if (before && after) {
      this.lastCorrection = dhypot(after.x - before.x, after.y - before.y);
      this.corrections.push(this.lastCorrection);
      if (this.corrections.length > 600) this.corrections.shift();
    }
  }

  get pendingCount() { return this.pending.length; }
}
