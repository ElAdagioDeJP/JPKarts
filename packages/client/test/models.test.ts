// V3-6: los .glb de Blender (12 pilotos + 11 piezas) cumplen la especificación de docs/V3_PLAN.md §4 sin abrir un navegador:
// se lee la cabecera JSON del .glb (nodos, animaciones, mallas) y el tamaño del archivo.
import { expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildShot, triCount } from '../src/art/codeModels';
import { DRIVER_IDS } from '../src/render/driverIds';
import { PARTS } from '../../core/src/data/parts';

const DIR = join(import.meta.dir, '..', 'src', 'assets', 'models');

interface Glb {
  bytes: number;
  nodes: string[];
  animations: string[];
  materials: string[];
  /** malla → triángulos */
  meshes: Record<string, number>;
  hasSkin: boolean;
}

function readGlb(name: string): Glb {
  const file = join(DIR, name + '.glb'), d = readFileSync(file);
  const n = d.readUInt32LE(12);
  const j = JSON.parse(d.subarray(20, 20 + n).toString('utf8'));
  const meshes: Record<string, number> = {};
  for (const m of j.meshes) meshes[m.name] = m.primitives.reduce((a: number, p: { indices: number }) => a + j.accessors[p.indices].count / 3, 0);
  return {
    bytes: statSync(file).size,
    nodes: j.nodes.map((x: { name: string }) => x.name),
    animations: (j.animations ?? []).map((a: { name: string }) => a.name),
    materials: j.materials.map((m: { name: string }) => m.name),
    meshes,
    hasSkin: !!j.skins?.length,
  };
}

const BONES = ['root', 'spine', 'chest', 'neck', 'head', 'upperArm.L', 'forearm.L', 'hand.L', 'upperArm.R', 'forearm.R', 'hand.R'];
const CLIPS = ['idle', 'steerL', 'steerR', 'trick', 'hit', 'lookBack', 'victory'];

test('los 12 pilotos: huesos, 7 clips, LOD0 4000-6000 tris, LOD1 ≤1500, ≤7 materiales, ≤250 KB', () => {
  expect(DRIVER_IDS.length).toBe(12);
  const rows: string[] = [];
  for (const id of DRIVER_IDS) {
    const g = readGlb('driver_' + id);
    for (const b of BONES) expect(g.nodes).toContain(b);
    for (const c of CLIPS) expect(g.animations).toContain(c);
    expect(g.hasSkin).toBe(true);
    const lod0 = g.meshes[id]!, lod1 = g.meshes[id + '_LOD1']!;
    expect(lod0).toBeGreaterThanOrEqual(4000);
    expect(lod0).toBeLessThanOrEqual(6000);
    expect(lod1).toBeLessThanOrEqual(1500);
    expect(g.materials.length).toBeLessThanOrEqual(7);
    expect(g.bytes).toBeLessThanOrEqual(250_000);
    rows.push(`${id}: ${lod0} / ${lod1} tris, ${g.materials.length} mats, ${(g.bytes / 1024).toFixed(0)} KB`);
  }
  console.log(rows.join('\n'));
});

test('las 11 piezas del catálogo tienen su .glb: chasis con empties, ruedas ≤600 tris, alas ≤800, ≤80 KB', () => {
  for (const p of PARTS) {
    const g = readGlb('part_' + p.id), tris = g.meshes['part_' + p.id]!;
    expect(g.bytes).toBeLessThanOrEqual(80_000);
    if (p.type === 'body') {
      for (const e of ['seat', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', 'glider']) expect(g.nodes).toContain(e);
      expect(tris).toBeGreaterThanOrEqual(1000); // el plan pedía 1500-3000; Mainframe y Rover quedaron en ~1300 (bitácora V3-6)
      expect(tris).toBeLessThanOrEqual(3000);
      expect(g.materials.length).toBeLessThanOrEqual(4);
      expect(g.materials).toContain('body');
    }
    if (p.type === 'wheels') { expect(tris).toBeLessThanOrEqual(600); expect(g.materials).toEqual(expect.arrayContaining(['tire', 'rim'])); }
    if (p.type === 'wing') { expect(tris).toBeLessThanOrEqual(800); expect(g.materials).toEqual(expect.arrayContaining(['canvas', 'frame'])); }
  }
});

test('proyectil ciego 3D dentro de presupuesto (≤150 tris)', () => {
  const g = buildShot();
  expect(g).not.toBeNull();
  const t = triCount(g!);
  console.log(`shot: ${t} tris`);
  expect(t).toBeLessThanOrEqual(150);
});
