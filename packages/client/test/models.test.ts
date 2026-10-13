// Roster full-3D: los 8 personajes resuelven modelo (ext .glb o procedural) dentro de
// presupuesto, con sus colores de characters.json y su accesorio.
import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { buildCodeBody, buildCodeHead, buildShot, triCount, type CodeModelDef } from '../src/art/codeModels';
import { CHARS } from '../../core/src/data/characters';

const DEFS = CHARS as unknown as (CodeModelDef & { name: string })[];
const EXT_CH = new Set([4, 5]); // Miguel y JP tienen .glb; el resto es procedural

function colorNear(g: THREE.BufferGeometry, hex: string, eps = 0.03): boolean {
  const want = new THREE.Color(hex);
  const c = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) {
    const d = Math.abs(c.getX(i) - want.r) + Math.abs(c.getY(i) - want.g) + Math.abs(c.getZ(i) - want.b);
    if (d < eps) return true;
  }
  return false;
}

test('los 8 generan cuerpo/cabeza dentro de presupuesto (cuerpo ≤760, cabeza ≤440)', () => {
  const rows: string[] = [];
  for (const d of DEFS) {
    const body = buildCodeBody(d), head = buildCodeHead(d);
    expect(body).not.toBeNull();
    expect(head).not.toBeNull();
    const tb = triCount(body!), th = triCount(head!);
    rows.push(`${d.name}: body ${tb} / head ${th}`);
    expect(tb).toBeLessThanOrEqual(760);
    expect(th).toBeLessThanOrEqual(440);
  }
  console.log(rows.join('\n'));
});

test('colores de characters.json y accesorio por personaje', () => {
  for (const d of DEFS) {
    if (EXT_CH.has(DEFS.indexOf(d))) continue;
    const body = buildCodeBody(d)!, head = buildCodeHead(d)!;
    expect(colorNear(body, d.kart)).toBe(true);
    expect(colorNear(body, d.suit)).toBe(true);
    expect(colorNear(head, d.helmet)).toBe(true);
    expect(colorNear(head, d.skin)).toBe(true);
    if (d.acc !== 'none' && d.acc !== 'glasses') expect(colorNear(head, d.accCol)).toBe(true);
    if (d.beard) expect(colorNear(head, '#3a2418')).toBe(true);
  }
  // accesorios esperados por índice: Marco mohawk, Guaycaipuro none, Luis/Jesús/Mario/Andrés…
  expect(DEFS[0]!.acc).toBe('mohawk');
  expect(DEFS[2]!.acc).toBe('headphones');
  expect(DEFS[3]!.acc).toBe('tuft');
  expect(DEFS[6]!.acc).toBe('headphones');
  expect(DEFS[7]!.acc).toBe('spikes');
});

test('proyectil ciego 3D dentro de presupuesto (≤150 tris)', () => {
  const g = buildShot();
  expect(g).not.toBeNull();
  const t = triCount(g!);
  console.log(`shot: ${t} tris`);
  expect(t).toBeLessThanOrEqual(150);
});
