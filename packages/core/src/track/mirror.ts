// Espejo (GDD §9): the same authored track reflected left↔right. Mirroring x flips the handedness, so every
// lateral offset changes sign and left walls become right walls. Terrain noise is not mirrored (only scenery).
import type { AuthoredTrackDef } from './authoredTypes';

export function mirrorAuthored(a: AuthoredTrackDef): AuthoredTrackDef {
  const S = a.size, mx = (x: number) => S - x;
  const flip = (l: [number, number]): [number, number] => [-l[0], -l[1]];
  return {
    ...a,
    id: a.id + '-espejo',
    spline: a.spline.map((p) => ({ ...p, x: mx(p.x) })),
    walls: a.walls.map((wl) => ({ ...wl, side: wl.side === 'izq' ? 'der' : wl.side === 'der' ? 'izq' : 'ambos' })),
    surfaces: a.surfaces.map((s) => ({ ...s, lat: [-s.lat[1], -s.lat[0]] as [number, number] })),
    branches: a.branches.map((b) => ({ ...b, via: b.via.map((v) => ({ ...v, x: mx(v.x) })) })),
    pads: a.pads.map((p) => ({ ...p, lat: -p.lat })),
    hazards: a.hazards.map((h) => (h.lat ? { ...h, lat: flip(h.lat) } : h)),
    coins: a.coins?.map((c) => ({ ...c, lat: -c.lat })),
    water: a.water ? { ...a.water, shore: a.water.shore.map(([x, y]) => [mx(x), y] as [number, number]) } : undefined,
  };
}
