// Modelos procedurales de karts/pilotos (los 6 sin .glb de Blender) + proyectil ciego 3D.
// Puro three (sin DOM): testeable en bun. 1 material + colores por vértice,
// como los .glb (760/348 tris de JP como techo). Marco local del juego:
// +X adelante, +Y arriba, +Z derecha; la cabeza pivota en MK7_RIG.HEAD_C.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CodeModelDef {
  helmet: string;
  kart: string;
  skin: string;
  acc: 'mohawk' | 'none' | 'headphones' | 'tuft' | 'antenna' | 'glasses' | 'spikes' | 'cap';
  accCol: string;
  mouth: string;
  beard?: boolean;
  goatee?: boolean;
  beardCol?: string;
  suit: string;
  glove: string;
  boot: string;
  eye: string;
}

export const BEARD = '#3a2418';
const DARK = '#3a3848';
const CHROME = '#c0c4d4';

function shadeHex(h: string, f: number): string {
  const n = h.replace('#', '');
  const c = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(n.slice(i, i + 2), 16) * f)));
  return '#' + [c(0), c(2), c(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

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

/** Cuerpo completo (chasis + piloto sentado): 25 cajas + 2 escapes = 372 tris (techo 760). */
export function buildCodeBody(c: CodeModelDef): THREE.BufferGeometry | null {
  const K = c.kart, Kd = shadeHex(K, 0.7), S = c.suit, Sd = shadeHex(S, 0.78);
  return mergeGeometries([
    box(8, 1, 7, 0, 1.1, 0, DARK),
    box(6, 1.5, 2, 0, 2, 4, K), box(6, 1.5, 2, 0, 2, -4, K),
    box(4.5, 1.2, 4, 3.2, 2.2, 0, K),
    box(1.5, 1, 3, 5, 2.2, 0, CHROME),
    box(3, 0.8, 2.4, 4.2, 3.6, 4.4, K), box(3, 0.8, 2.4, 4.2, 3.6, -4.4, K),
    box(3, 0.8, 2.4, -4.2, 3.6, 4.4, K), box(3, 0.8, 2.4, -4.2, 3.6, -4.4, K),
    box(4, 2, 5, -3.5, 2.5, 0, '#8a90a4'),
    painted(part(new THREE.CylinderGeometry(0.5, 0.5, 2, 6), -5.4, 2.2, 1.5, Math.PI / 2), CHROME),
    painted(part(new THREE.CylinderGeometry(0.5, 0.5, 2, 6), -5.4, 2.2, -1.5, Math.PI / 2), CHROME),
    box(1, 2.5, 8, -5.2, 4.5, 0, Kd),
    box(1.5, 1.5, 0.6, -5, 3, 2.5, DARK), box(1.5, 1.5, 0.6, -5, 3, -2.5, DARK),
    box(3, 1, 4, -1.5, 3.2, 0, Kd),
    box(1, 3.5, 4, -3, 4.5, 0, Kd),
    box(3, 3, 3.4, -0.8, 5.5, 0, S),
    box(3.1, 0.7, 3.5, -0.8, 4.2, 0, K),
    box(4.5, 1.2, 1.4, 1.8, 3.8, 1.2, Sd), box(4.5, 1.2, 1.4, 1.8, 3.8, -1.2, Sd),
    box(1.6, 1.2, 1.5, 4, 3.8, 1.2, c.boot), box(1.6, 1.2, 1.5, 4, 3.8, -1.2, c.boot),
    box(3.4, 1.1, 1.1, 1.2, 5.8, 2.2, S), box(3.4, 1.1, 1.1, 1.2, 5.8, -2.2, S),
    box(1.2, 1.3, 1.3, 3, 5.5, 2.1, c.glove), box(1.2, 1.3, 1.3, 3, 5.5, -2.1, c.glove),
    box(0.6, 1.6, 2.6, 3.2, 5.2, 0, DARK),
    box(2, 0.6, 0.6, 2.2, 4.4, 0, DARK),
  ]);
}

/** Cabeza chibi centrada en HEAD_C ≈ (-0.5, 9.3, 0): casco + cara + accesorio. Base 212 tris, máx 372 (techo 420). */
export function buildCodeHead(c: CodeModelDef): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [
    painted(part(new THREE.SphereGeometry(3.2, 10, 8), -0.5, 9.3, 0), c.helmet),
    box(1.2, 2.6, 4.6, 2.2, 8.6, 0, c.skin),
  ];
  if (c.acc === 'glasses') {
    parts.push(box(0.5, 1.6, 1.8, 3.1, 9.4, 1.2, '#20306e'), box(0.5, 1.6, 1.8, 3.1, 9.4, -1.2, '#20306e'));
  } else {
    parts.push(
      box(0.8, 1.1, 1.2, 2.9, 9.4, 1.2, '#ffffff'), box(0.8, 1.1, 1.2, 2.9, 9.4, -1.2, '#ffffff'),
      box(0.4, 0.7, 0.7, 3.2, 9.3, 1.2, c.eye), box(0.4, 0.7, 0.7, 3.2, 9.3, -1.2, c.eye),
    );
  }
  parts.push(box(0.3, 0.5, 1.6, 3.0, 8.0, 0, c.mouth));
  const A = c.accCol;
  if (c.acc === 'mohawk') for (const x of [-2.2, -1.1, 0, 1.1]) parts.push(box(1.1, 1.8, 0.7, x, 12.2, 0, A));
  if (c.acc === 'spikes') for (const [x, y] of [[-2.2, 12.3], [-0.5, 12.7], [1.2, 12.3]] as const)
    parts.push(painted(part(new THREE.ConeGeometry(0.9, 2.2, 6), x, y, 0), A));
  if (c.acc === 'tuft') {
    parts.push(painted(part(new THREE.ConeGeometry(1.1, 2, 6), -0.5, 12.9, 0), A));
  }
  if (c.acc === 'headphones') {
    const band = new THREE.TorusGeometry(3.5, 0.55, 6, 8, Math.PI);
    band.rotateY(Math.PI / 2);
    parts.push(painted(part(band, -0.5, 9.6, 0), A));
    for (const s of [1, -1]) {
      const cup = new THREE.CylinderGeometry(1.3, 1.3, 1, 8);
      cup.rotateX(Math.PI / 2);
      parts.push(painted(part(cup, -0.5, 9.3, s * 3.4), A));
    }
  }
  if (c.acc === 'antenna') {
    parts.push(painted(part(new THREE.CylinderGeometry(0.25, 0.25, 3, 6), 2, 12.5, 0), DARK));
    parts.push(painted(part(new THREE.SphereGeometry(0.7, 8, 6), 2, 14.2, 0), A));
  }
  if (c.beard) parts.push(box(1, 1.8, 3, 2.4, 7.2, 0, c.beardCol ?? BEARD));
  if (c.goatee) parts.push(box(0.8, 1.2, 1.2, 2.9, 7.1, 0, c.beardCol ?? BEARD));
  if (c.acc === 'cap') {
    parts.push(painted(part(new THREE.SphereGeometry(3.4, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2.3), -0.5, 9.5, 0), A), box(1.8, 0.4, 4.2, 3.2, 10.6, 0, shadeHex(A, 0.75)));
  }
  return mergeGeometries(parts);
}

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
