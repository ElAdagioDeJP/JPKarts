// Modelos procedurales: proyectil ciego 3D (los pilotos y karts son .glb de Blender, ver render/kartModels.ts).
// Puro three (sin DOM): testeable en bun. 1 material + colores por vértice. Marco local del juego: +X adelante, +Y arriba, +Z derecha.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Pinta una primitiva con un color (o función por vértice) y la devuelve no indexada. */
export function painted(geo: THREE.BufferGeometry, col: string | ((x: number, y: number, z: number) => string)): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  const arr = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.setStyle(typeof col === 'function' ? col(p.getX(i), p.getY(i), p.getZ(i)) : col);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Coloca una primitiva en (dx,dy,dz), opcionalmente rotada en Z antes. */
export function part(geo: THREE.BufferGeometry, dx = 0, dy = 0, dz = 0, rz = 0): THREE.BufferGeometry {
  if (rz) geo.rotateZ(rz);
  geo.translate(dx, dy, dz);
  return geo;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: string) =>
  painted(part(new THREE.BoxGeometry(w, h, d), x, y, z), col);

/** Proyectil ciego 3D (128 tris): bala con venda de ciego + pinchos. Gira como peonza en vuelo. */
export function buildShot(): THREE.BufferGeometry | null {
  const spike = (z: number) => {
    const g = new THREE.ConeGeometry(0.7, 1.6, 6);
    g.rotateZ(-Math.PI / 2);
    return painted(part(g, -2.8, 2.5, z), '#5a5e70');
  };
  return mergeGeometries([
    painted(part(new THREE.SphereGeometry(2.4, 8, 6), 0, 2.5, 0), '#8a90a4'),
    box(1.4, 1.8, 5.4, 1.2, 3, 0, '#1a1026'),
    spike(-1.5), spike(0), spike(1.5),
  ]);
}

/** Tris de una geometría fusionada (indexada o no). */
export function triCount(g: THREE.BufferGeometry): number {
  return Math.round(((g.index?.count ?? (g.attributes.position as THREE.BufferAttribute).count) / 3));
}
