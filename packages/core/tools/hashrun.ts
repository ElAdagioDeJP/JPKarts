// Runs a fixed AI race and prints the final hash. Used to compare engines (Bun/JSC vs Node/V8 vs browser).
import { LAPS, Rng, TRACK_DEFS, buildGrid, buildTrack, createWorld, dsin, hashWorld, prepTrack, step, takeEvents } from '../src';

const ti = Number(process.argv[2] ?? 0);
const track = buildTrack(prepTrack(TRACK_DEFS[ti]!));
const grid = buildGrid(new Rng(7), [{ ch: 5, ctrl: 'local' }], { humanSlot: 5 });
const w = createWorld({ trackIndex: ti, diff: 1, seed: 1234, laps: LAPS, grid }, track);
const hashes: string[] = [];
for (let i = 0; i < 60 * 150; i++) {
  // scripted human: full throttle, steer by a fixed pattern, drift every few seconds, item every 5 s
  const t = i / 60;
  step(w, [, , , , , { t: 1, s: dsin(t * 0.7), d: (i % 240) > 180, item: i % 300 === 0 }] as any);
  takeEvents(w);
  if (w.tick % 600 === 0) hashes.push(hashWorld(w));
}
let th = 0x811c9dc5;
for (const v of track.hm) { th ^= Math.round(v * 1000); th = Math.imul(th, 0x01000193); }
console.log(JSON.stringify({ track: (th >>> 0).toString(16), hashes, final: hashWorld(w) }));
