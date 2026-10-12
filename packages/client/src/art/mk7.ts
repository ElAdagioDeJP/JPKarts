// Rig de personajes estilo Mario Kart 7 (voxel) + preparación Mii.
//
// Separación en tres capas para que el próximo refactor Mii solo toque la cabeza:
//   kartVoxels   -> chasis, morro, asiento, escapes, alerón (nunca cambia con Mii)
//   bodyVoxels   -> torso + brazos + piernas del piloto (mismo suit, cambia poco)
//   headVoxels   -> casco/cabeza/cara/accesorio (el Mii lo regenerará desde MiiDef)
//
// Sistema: +y adelante, +x derecha, +z arriba (igual que el legacy `voxelKart`).
// El render (world3d) construye UNA geometría por capa para poder animar la
// cabeza aparte (mirar al derrapar, cabezazo en truco) y para swapearla por un Mii.
import type { Character } from '@jpkart/core';

export type Voxel = [number, number, number, string];
export const BEARD = '#3a2418';
const TIRE = '#2a2833';
const RIM = '#b8bccc';
const DARK = '#3a3848';
const CHROME = '#c0c4d4';

function shadeHex(h: string, f: number): string {
  const n = h.replace('#', '');
  const c = (i: number) => Math.max(0, Math.min(255, Math.round(parseInt(n.slice(i, i + 2), 16) * f)));
  return '#' + [c(0), c(2), c(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

class VB {
  m = new Map<string, Voxel>();
  add(x: number, y: number, z: number, col: string) {
    this.m.set(x + ',' + y + ',' + z, [x, y, z, col]);
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: string | ((x: number, y: number, z: number) => string)) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
          this.add(x, y, z, typeof col === 'function' ? col(x, y, z) : col);
  }
  get list(): Voxel[] {
    return [...this.m.values()];
  }
}

/** Anclas del rig (en voxels). El Mii reutilizará HEAD_C para colocar su cara. */
export const MK7_RIG = {
  /** centro de la cabeza chibi */
  HEAD_C: { x: 0, y: -1, z: 13, r: 4.6 },
  /** umbral z: todo lo >= HEAD_SPLIT_Z pertenece a la capa cabeza */
  HEAD_SPLIT_Z: 9,
  /** manos en el volante (para animar brazos en el futuro) */
  HAND_L: { x: -2, y: 4, z: 6 },
  HAND_R: { x: 2, y: 4, z: 6 },
} as const;

export interface Mk7Layers {
  kart: Voxel[];
  body: Voxel[];
  head: Voxel[];
  all: Voxel[];
}

// ---------------------------------------------------------------- kart MK7
function buildKart(c: Character, b: VB) {
  const K = c.kart;
  const Kd = shadeHex(K, 0.7);
  const Kl = shadeHex(K, 1.18);
  // ruedas voxel (las 3D expuestas de world3d van encima; estas son los pasos)
  for (const s of [-1, 1]) {
    b.box(s * 5, s * 7, -8, -4, 0, 4, (x, y, z) => (x === s * 7 && y >= -7 && y <= -5 && z >= 1 && z <= 3 ? RIM : TIRE));
    b.box(s * 5, s * 7, 4, 7, 0, 3, (x, y, z) => (x === s * 7 && y >= 5 && y <= 6 && z >= 1 && z <= 2 ? RIM : TIRE));
    // guardabarros del color del kart (silueta MK7 redondeada)
    b.box(s * 5, s * 7, -8, -4, 5, 5, (_x, _y, z) => (z === 5 ? Kl : K));
    b.box(s * 5, s * 7, 4, 7, 4, 4, K);
  }
  // suelo + pontones laterales
  b.box(-4, 4, -8, 8, 1, 1, DARK);
  b.box(-5, 5, -3, 3, 2, 3, (_x, _y, z) => (z === 3 ? Kl : K));
  // franja central clara (morro MK7)
  b.box(-1, 1, -3, 9, 3, 3, '#fff7e0');
  // morro cónico + punta cromada
  b.box(-3, 3, 5, 8, 2, 3, (_x, _y, z) => (z === 3 ? Kl : K));
  b.box(-2, 2, 9, 10, 2, 2, CHROME);
  b.box(0, 0, 6, 9, 3, 3, '#fff7e0');
  // trasera + motor + escapes dobles cromados (firma MK7)
  b.box(-4, 4, -8, -6, 2, 4, (_x, _y, z) => (z >= 4 ? CHROME : '#8a90a4'));
  b.box(-2, 2, -8, -7, 4, 5, '#5a5e70');
  for (const s of [-2, 2]) {
    b.box(s, s, -10, -9, 3, 3, CHROME);
    b.add(s, -10, 3, '#2a2833');
  }
  // alerón trasero con el color del kart (lectura a 400 u)
  b.box(-4, 4, -9, -9, 5, 6, (_x, _y, z) => (z === 6 ? Kl : Kd));
  b.box(-4, -4, -8, -8, 4, 5, DARK);
  b.box(4, 4, -8, -8, 4, 5, DARK);
  // baquet + respaldo (el piloto va encajado, no encima)
  b.box(-3, 3, -6, -4, 4, 5, Kd);
  b.box(-3, 3, -6, -5, 6, 8, Kd);
  // columna + volante
  b.box(0, 0, 2, 4, 4, 5, DARK);
  b.box(-1, 1, 4, 4, 6, 6, '#22222e');
}

// ---------------------------------------------------------------- cuerpo MK7 (sentado, brazos al volante)
function buildBody(c: Character, b: VB) {
  const S = c.suit;
  const Sd = shadeHex(S, 0.78);
  // torso compacto, ligeramente reclinado contra el respaldo
  b.box(-2, 2, -4, -1, 5, 8, (x, _y, z) => (z === 8 ? shadeHex(S, 1.12) : x === 0 ? Sd : S));
  // cinturón
  b.box(-2, 2, -3, -3, 5, 5, c.kart);
  // piernas estiradas hacia el morro (muslos + espinillas + botas)
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -3 : 1, x1 = s < 0 ? -1 : 3;
    b.box(x0, x1, -1, 3, 4, 5, Sd);
    b.box(x0, x1, 4, 6, 4, 5, Sd);
    b.box(x0, x1, 7, 8, 4, 5, c.boot);
  }
  // brazos de hombros al volante + guantes MK7 (blancos, grandes)
  for (const s of [-1, 1]) {
    const sh = s * 3;
    b.box(sh, sh, -2, 1, 6, 7, S);
    b.box(Math.min(sh, s * 2), Math.max(sh, s * 2), 2, 4, 6, 7, S);
    b.box(s < 0 ? -3 : 1, s < 0 ? -1 : 3, 4, 4, 6, 7, c.glove);
  }
}

// ---------------------------------------------------------------- cabeza MK7 (chibi: grande, ojos grandes)
function buildHead(c: Character, b: VB) {
  const { x: cx, y: cy, z: cz, r } = MK7_RIG.HEAD_C;
  const R2 = r * r;
  const eye = c.eye;
  for (let x = -5; x <= 5; x++)
    for (let y = -6; y <= 4; y++)
      for (let z = 8; z <= 18; z++) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
        if (d > R2) continue;
        // frente: solo la parte delantera (y >= 1) es cara
        const front = y >= 1;
        const inFace = front && z >= 10 && z <= 15 && Math.abs(x) <= 3;
        let col = c.helmet;
        if (inFace) col = c.skin;
        // sombra inferior de la cara (barbilla)
        if (inFace && z === 10) col = shadeHex(c.skin, 0.85);
        // barba
        if (c.beard && front && z === 10 && Math.abs(x) <= 2) col = BEARD;
        // --- ojos MK7: esclerótica blanca grande + iris + brillo ---
        // ojo izq x -3..-1, ojo der x 1..3, filas z 12..14
        const ax = Math.abs(x);
        if (front && z >= 12 && z <= 14 && ax >= 1 && ax <= 3) {
          const isIris = ax <= 2 && z >= 12 && z <= 13;
          if (c.acc === 'glasses') {
            col = '#20306e';
            if (ax === 1 && z === 12) col = '#6a9aff'; // reflejo gafa
          } else if (isIris) {
            col = eye;
            if (ax === 2 && z === 14) col = '#ffffff'; // placeholder, se pisa abajo
            if (ax === 1 && z === 13) col = '#101020'; // pupila
            if (ax === 2 && z === 13) col = eye;
          } else {
            col = '#ffffff';
          }
          // brillo superior del ojo
          if (z === 14 && ax === 2) col = '#ffffff';
          if (z === 14 && ax === 1 && c.acc !== 'glasses') col = '#ffffff';
        }
        // pupila + brillo (segunda pasada fina)
        if (front && c.acc !== 'glasses') {
          if ((x === -1 || x === 1) && z === 12) col = '#101020';
          if ((x === -2 || x === 2) && z === 14) col = '#ffffff';
        }
        // nariz (1 voxel piel oscura)
        if (front && x === 0 && z === 11 && y >= 2) col = shadeHex(c.skin, 0.8);
        // boca sonriente MK7: 3 px + comisuras
        if (front && z === 11) {
          if (x >= -1 && x <= 1) col = c.mouth;
          if ((x === -2 || x === 2) && y >= 2) col = shadeHex(c.mouth, 1.2);
        }
        // colorete (sin barba)
        if (!c.beard && front && z === 11 && (x === -3 || x === 3)) col = '#ff8a9a';
        b.add(x, y, z, col);
      }
  // brillo del casco (reflejo arriba-izquierda, firma MK7): solo pisa voxels existentes
  for (const [x, y, z] of [[-2, -3, 16], [-3, -2, 16], [-2, -2, 17], [-1, -3, 16]] as const) {
    const key = x + ',' + y + ',' + z;
    if (b.m.has(key)) b.add(x, y, z, shadeHex(c.helmet, 1.55));
  }
  // visera del casco: anillo inferior más oscuro (separa cabeza y cuerpo)
  for (let x = -4; x <= 4; x++)
    for (let y = -5; y <= 3; y++) {
      const d = x * x + (y + 1) * (y + 1) + (9 - cz) * (9 - cz);
      if (d <= R2 + 2 && d >= R2 - 6) {
        const k = x + ',' + y + ',' + 9;
        if (b.m.has(k)) b.add(x, y, 9, shadeHex(c.helmet, 0.62));
      }
    }
  // --- accesorios reposicionados a la cabeza grande (z 17..20) ---
  const A = c.accCol;
  const Ad = shadeHex(A, 0.75);
  if (c.acc === 'mohawk') b.box(0, 0, -4, 2, 18, 19, A);
  if (c.acc === 'tuft') {
    b.box(-1, 1, -2, 0, 18, 18, A);
    b.add(0, -1, 19, A);
  }
  if (c.acc === 'spikes') for (const x of [-2, 0, 2]) {
    b.box(x, x, -2, 0, 18, 18, A);
    b.add(x, -1, 19, A);
  }
  if (c.acc === 'antenna') {
    b.box(2, 2, -1, -1, 18, 20, '#2a2833');
    b.box(2, 3, -1, -1, 21, 21, A);
  }
  if (c.acc === 'headphones') {
    b.box(-5, -4, -2, 0, 12, 15, A);
    b.box(4, 5, -2, 0, 12, 15, A);
    for (let x = -4; x <= 4; x++) b.add(x, -1, Math.round(13 + Math.sqrt(Math.max(0, 20 - x * x)) * 1.05), '#2a2833');
  }
  if (c.acc === 'glasses') {
    // patillas sobre el casco
    b.box(-5, -4, -1, 1, 13, 13, '#20306e');
    b.box(4, 5, -1, 1, 13, 13, '#20306e');
  }
}

export function mk7Layers(c: Character): Mk7Layers {
  const kart = new VB();
  const body = new VB();
  const head = new VB();
  buildKart(c, kart);
  buildBody(c, body);
  buildHead(c, head);
  // `all` fusionado (compat con el pipeline actual de una sola malla).
  const all = new VB();
  for (const v of kart.list) all.add(v[0], v[1], v[2], v[3]);
  for (const v of body.list) all.add(v[0], v[1], v[2], v[3]);
  for (const v of head.list) all.add(v[0], v[1], v[2], v[3]);
  return { kart: kart.list, body: body.list, head: head.list, all: all.list };
}

/** Modelo completo (una lista). Sustituto directo del legacy `voxelKart`. */
export function mk7Voxels(c: Character): Voxel[] {
  return mk7Layers(c).all;
}

/**
 * Punto de extensión Mii (futuro, no usar aún):
 * generará solo la capa `head` desde `c.mii` (piel, pelo, ojos, gafas),
 * reutilizando kart + body del MK7. Firma congelada para el próximo refactor.
 */
export function miiHeadVoxels(_c: Character): Voxel[] {
  throw new Error('miiHeadVoxels no implementado: próximo refactor (estilo Mii)');
}
