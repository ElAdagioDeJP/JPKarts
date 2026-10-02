// Re-simulate a replay recorded elsewhere (e.g. the browser) and compare hashes.
// Usage: bun packages/core/tools/replay-check.ts replay.json [expectedHash]
import { readFileSync } from 'node:fs';
import { TRACK_DEFS, buildTrack, hashWorld, playReplay, prepTrack, type Replay } from '../src';

const r = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Replay;
const track = buildTrack(prepTrack(TRACK_DEFS[r.cfg.trackIndex]!));
const { world, mismatch } = playReplay(r, track);
const h = hashWorld(world);
const expected = process.argv[3];
console.log(JSON.stringify({ ticks: r.ticks, checkpoints: r.hashes.length, mismatch, hash: h, expected: expected ?? null }));
if (mismatch >= 0 || (expected && expected !== h)) process.exit(1);
