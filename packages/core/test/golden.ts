// Golden trajectories: behavior fingerprints that must survive refactors (Phase 3 migration).
// Regenerate ONLY when a behavior change is intended:  bun packages/core/test/golden.ts --write
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAPS, Rng, TRACK_DEFS, buildGrid, buildTrack, createWorld, dsin, itemList, prepTrack, step, takeEvents, type Input, type World } from '../src';

/** Hash of what the player can observe: kinematics, items and world things. Independent of internal field layout. */
export function behaviorHash(w: World): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    const s = String(v);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 44; h = Math.imul(h, 0x01000193);
  };
  for (const k of w.karts) {
    for (const v of [k.x, k.y, k.z, k.a, k.va, k.speed, k.prog, k.boost, k.spin, k.respawn, k.rank]) mix(v);
    mix(k.item ? k.item.length * 31 + k.item.charCodeAt(0) : -1);
  }
  const ents = (w as any).ents as { x: number; y: number; kind: string }[] | undefined;
  const list = ents ?? [...(w as any).fakes, ...(w as any).tars, ...(w as any).shots, ...(w as any).rockets, ...(w as any).holes];
  mix(list.length);
  const xs = list.map((e) => Math.round(e.x * 1e6) + Math.round(e.y * 1e6)).sort((a, b) => a - b);
  for (const v of xs) mix(v);
  mix(w.rng.s);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const SCENARIOS: { track: number; seed: number; diff: number; force?: boolean }[] = [
  { track: 0, seed: 11, diff: 1 },
  { track: 1, seed: 22, diff: 2 },
  { track: 8, seed: 33, diff: 0 },
  { track: 14, seed: 44, diff: 2 },
  // humans receive every item in turn (covers rare items: PEM, black hole, quantum swap, teleport)
  { track: 2, seed: 55, diff: 1, force: true },
  { track: 6, seed: 66, diff: 2, force: true },
];
const ITEM_IDS = itemList().map((i) => i.id);

export function runScenario(sc: (typeof SCENARIOS)[number], ticks = 60 * 90): string[] {
  const track = buildTrack(prepTrack(TRACK_DEFS[sc.track]!));
  const grid = buildGrid(new Rng(sc.seed), [{ ch: 4, ctrl: 'local' }, { ch: 0, ctrl: 'remote' }], { humanSlot: 2 });
  const w = createWorld({ trackIndex: sc.track, diff: sc.diff, seed: sc.seed, laps: LAPS, grid }, track);
  const a = grid.findIndex((g) => g.ch === 4), b = grid.findIndex((g) => g.ch === 0);
  const out: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const inputs: Input[] = [];
    inputs[a] = { t: 1, s: dsin(i / 45), d: i % 180 > 120, item: i % 90 === 0 };
    inputs[b] = { t: i % 500 < 470 ? 1 : 0, s: dsin(i / 33 + 2) * 0.8, d: i % 260 > 200, item: i % 70 === 0 };
    if (sc.force && i % 45 === 0) {
      const k = w.karts[i % 90 === 0 ? a : b]!;
      if (!k.item) k.item = ITEM_IDS[(i / 45) % ITEM_IDS.length]!;
    }
    step(w, inputs);
    takeEvents(w);
    if (w.tick % 300 === 0) out.push(behaviorHash(w));
  }
  return out;
}

if (import.meta.main && process.argv.includes('--write')) {
  const golden = SCENARIOS.map((sc) => runScenario(sc));
  writeFileSync(join(import.meta.dir, 'golden.json'), JSON.stringify(golden, null, 1));
  console.log('golden.json escrito:', golden.map((g) => g[g.length - 1]).join(' '));
}
