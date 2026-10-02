// Headless simulation benchmark: 8 AI karts, full races on several tracks. Prints p50/p95/max per tick.
// Budget (docs/PLAN.md): full tick ≤ 2.0 ms p95 on the reference PC.
import { ALL_TRACKS, LAPS, Rng, TrackCache, buildGrid, createWorld, prepAuthored, step, takeEvents } from '../src';

// default: the classic Pradera plus the busiest authored tracks (coins, hazards, lava, meteors)
const tracks = (process.argv[2] ?? '0,16,24,30,31').split(',').map(Number);
const cache = new TrackCache(ALL_TRACKS, prepAuthored);
const all: number[] = [];
const heap0 = process.memoryUsage().heapUsed;
for (const ti of tracks) {
  const t0 = performance.now();
  const track = cache.ensureBuilt(ti);
  const buildMs = performance.now() - t0;
  const w = createWorld({ trackIndex: ti, diff: 2, seed: 77 + ti, laps: LAPS, grid: buildGrid(new Rng(ti), [], { humanSlot: 0 }) }, track);
  const times: number[] = [];
  let ticks = 0;
  while (w.phase !== 'results' && ticks < 60 * 300) {
    const a = performance.now();
    step(w, []);
    takeEvents(w);
    times.push(performance.now() - a);
    ticks++;
  }
  times.sort((x, y) => x - y);
  all.push(...times);
  const p = (q: number) => times[Math.floor(times.length * q)]!.toFixed(3);
  console.log(`${ALL_TRACKS[ti]!.name.padEnd(18)} build ${buildMs.toFixed(0).padStart(4)} ms · ${ticks} ticks · p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · max ${times[times.length - 1]!.toFixed(3)} ms`);
}
all.sort((x, y) => x - y);
const p95 = all[Math.floor(all.length * 0.95)]!;
const heapMb = (process.memoryUsage().heapUsed - heap0) / 1048576;
console.log(`TOTAL p95 ${p95.toFixed(3)} ms (presupuesto 2.0 ms) · heap +${heapMb.toFixed(1)} MB`);
if (p95 > 2.0) process.exit(1);
