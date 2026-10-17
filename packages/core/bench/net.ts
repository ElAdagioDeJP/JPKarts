// Headless network benchmark (docs/PERF_PLAN.md P0): what a snapshot costs on the wire and on the client.
// 8 AI karts, full race. Every SNAPSHOT_EVERY ticks: server serialize + diff, JSON size, deflate size (per message,
// no context takeover: an upper bound of what `ws` sends), and the client's patch + restore + re-simulation.
import { constants, createDeflateRaw, deflateRawSync } from 'node:zlib';
import { ALL_TRACKS, LAPS, Rng, SNAPSHOT_EVERY, TrackCache, buildGrid, createWorld, diffJson, patchJson, prepAuthored, restoreWorld, serializeWorld, step, takeEvents, type WorldState } from '../src';

const tracks = (process.argv[2] ?? '0,24,31').split(',').map(Number);
const RESIM = Number(process.argv[3] ?? 6); // pending ticks re-simulated per snapshot (~100 ms RTT in 4G)
const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const pct = (a: number[], q: number) => a[Math.min(a.length - 1, Math.floor(a.length * q))]!;
for (const ti of tracks) {
  const track = cache.ensureBuilt(ti);
  const cfg = { trackIndex: ti, diff: 2, seed: 77 + ti, laps: LAPS, grid: buildGrid(new Rng(ti), [], { humanSlot: 0 }) };
  const w = createWorld(cfg, track), client = createWorld(cfg, track);
  let last: WorldState | null = null, base: WorldState | null = null, ticks = 0, json = 0, wire = 0, ctx = 0, snaps = 0;
  const stream = createDeflateRaw({ level: 3 }); // ws default: the window carries over between messages (context takeover)
  const srv: number[] = [], cli: number[] = [], full: number[] = [];
  while (w.phase !== 'results' && ticks < 60 * 300) {
    step(w, []); takeEvents(w); ticks++;
    if (w.tick % SNAPSHOT_EVERY) continue;
    const a = performance.now();
    const state = serializeWorld(w);
    const delta = last ? diffJson(last, state) ?? {} : undefined;
    const msg = JSON.stringify(delta ? { t: 'snap', tick: w.tick, delta } : { t: 'snap', tick: w.tick, state });
    srv.push(performance.now() - a);
    last = state; snaps++;
    json += msg.length;
    wire += deflateRawSync(msg, { level: 3 }).length;
    stream.write(msg); stream.flush(constants.Z_SYNC_FLUSH); await new Promise((r) => stream.once('data', (c: Buffer) => { ctx += c.length; r(0); }));
    if (!delta) full.push(msg.length);
    const b = performance.now();
    base = delta && base ? patchJson(base, (JSON.parse(msg) as { delta: unknown }).delta) as WorldState : state;
    restoreWorld(client, base);
    for (let i = 0; i < RESIM; i++) step(client, []);
    takeEvents(client);
    cli.push(performance.now() - b);
  }
  srv.sort((x, y) => x - y); cli.sort((x, y) => x - y);
  const secs = ticks / 60;
  console.log(`${ALL_TRACKS[ti]!.name.padEnd(18)} ${snaps} snaps · JSON ${(json / secs / 1024).toFixed(1)} KB/s · deflate ${(wire / secs / 1024).toFixed(1)} KB/s (con contexto ${(ctx / secs / 1024).toFixed(1)}) · full ${((full[0] ?? 0) / 1024).toFixed(1)} KB · server p95 ${pct(srv, 0.95).toFixed(3)} ms/snap · client p95 ${pct(cli, 0.95).toFixed(3)} ms/snap (restore + ${RESIM} resim)`);
}
