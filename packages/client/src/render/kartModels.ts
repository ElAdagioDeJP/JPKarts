// Karts de Blender (V3-6b): `driver_<id>.glb` (piloto riggeado) + `part_<chasis|rueda|ala>.glb` montados sobre los empties del chasis.
// Los .glb se sirven como archivos (no van dentro del JS). Al cargar cada uno se "hornea" a UN solo material con colores por vértice
// (como el kart voxel): un kart = chasis 1 + ruedas 4 + piloto 1 draw calls. Marco del modelo: glTF −Z adelante, +Y arriba.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DRIVER_IDS } from './driverIds';
import { DEFAULT_LOADOUT, partsOfType, type Loadout } from '@jpkart/core';

const urls = import.meta.glob('../assets/models/{driver,part}_*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const urlOf = (name: string): string | undefined => urls[`../assets/models/${name}.glb`];

export { DRIVER_IDS };
/** Radio de cada rueda (m) para que el giro siga la velocidad. */
export const WHEEL_R: Record<string, number> = { std: 0.21, slick: 0.22, offroad: 0.235, mini: 0.15 };
/** Unidades del juego por metro de modelo (el piloto mide ≈0.9 m; su cabeza ≈0.47 m → ≈5 u). */
export const KART_SCALE = 10;
/** Más allá de esta distancia a la cámara el piloto usa su LOD1. */
export const LOD_DIST = 60;
const WHEEL_EMPTIES = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] as const;

export type PartIds = Loadout;
export const DEFAULT_PARTS: PartIds = { ...DEFAULT_LOADOUT };

interface Chassis { geo: THREE.BufferGeometry; seat: THREE.Vector3; wheels: THREE.Vector3[]; glider: THREE.Vector3 }
interface Driver { template: THREE.Object3D; clips: THREE.AnimationClip[] }
const TINTED = ['body', 'canvas'];

/** Une todas las mallas estáticas de `root` en una geometría con color por vértice (+ `tintMask`: 1 = material que el juego tiñe). */
function bakeStatic(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', m.geometry.getAttribute('position').clone());
    g.setAttribute('normal', m.geometry.getAttribute('normal').clone());
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const n = g.getAttribute('position').count, col = new Float32Array(n * 3), mask = new Float32Array(n);
    for (let i = 0; i < n; i++) { col[i * 3] = mat.color.r; col[i * 3 + 1] = mat.color.g; col[i * 3 + 2] = mat.color.b; mask[i] = TINTED.includes(mat.name) ? 1 : 0; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tintMask', new THREE.BufferAttribute(mask, 1));
    geos.push(g);
  });
  const merged = mergeGeometries(geos);
  if (!merged) throw new Error('bakeStatic: sin mallas');
  merged.computeBoundingSphere();
  return merged;
}

/** Piloto: las mallas riggeadas (una por material) se funden en una `lod0` y una `lod1` con color por vértice, ligadas al mismo esqueleto. */
function bakePilot(scene: THREE.Object3D, mat: THREE.Material): void {
  scene.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
  for (const lod of [0, 1] as const) {
    const group = skinned.filter((m) => m.name.includes('LOD1') === (lod === 1)); // GLTFLoader nombra cada primitiva `<malla>_<n>`
    if (!group.length) continue;
    const geos = group.map((m) => {
      const mm = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const g = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(a, m.geometry.getAttribute(a).clone());
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      const n = g.getAttribute('position').count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = mm.color.r; col[i * 3 + 1] = mm.color.g; col[i * 3 + 2] = mm.color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.name = lod === 0 ? 'lod0' : 'lod1';
    sm.frustumCulled = false;
    sm.castShadow = true;
    sm.bind(group[0]!.skeleton, group[0]!.bindMatrix);
    scene.add(sm);
  }
  for (const m of skinned) m.parent?.remove(m);
}

export interface RigInput {
  /** < 0 = izquierda (como `sv`), −1..1 */
  lean: number;
  speed: number;
  trick: number; hit: number; look: boolean; win: boolean;
  /** 0..1 de despliegue del ala */
  deploy: number;
  /** distancia a la cámara (u), para el LOD */
  depth: number;
  dt: number;
}

/** Un kart montado: chasis + 4 ruedas + ala + piloto con sus clips. Cuelga de `root` (escala y marco de modelo; el dueño lo orienta). */
export class RigKart {
  root = new THREE.Group();
  private wheels: { pivot: THREE.Group; mesh: THREE.Mesh; front: boolean }[] = [];
  private wing: THREE.Mesh | null = null;
  private mixer: THREE.AnimationMixer;
  private act: Record<'idle' | 'steerL' | 'steerR' | 'trick' | 'hit' | 'lookBack' | 'victory', THREE.AnimationAction>;
  private lod0: THREE.Object3D | null; private lod1: THREE.Object3D | null;
  private spin = 0; private look = 0; private win = 0;
  private radius: number;

  constructor(ch: number, chassis: Chassis, chassisGeo: THREE.BufferGeometry, wheelGeo: THREE.BufferGeometry, rearGeo: THREE.BufferGeometry, wheelId: string, wingGeo: THREE.BufferGeometry,
    driver: Driver, mats: { kart: THREE.Material; pilot: THREE.Material }, ghost: boolean) {
    this.root.scale.setScalar(KART_SCALE);
    this.root.rotation.y = -Math.PI / 2; // glTF −Z (adelante) → +X del juego
    const body = new THREE.Mesh(chassisGeo, mats.kart);
    body.castShadow = true;
    this.root.add(body);
    this.radius = (WHEEL_R[wheelId] ?? 0.21) * KART_SCALE;
    // 2 ruedas delanteras (giran con el volante) + las dos traseras fundidas en una malla sobre su eje: un draw call menos por kart
    const addWheel = (pos: THREE.Vector3, geo: THREE.BufferGeometry, front: boolean) => {
      const pivot = new THREE.Group();
      pivot.position.copy(pos);
      pivot.rotation.order = 'YXZ';
      const mesh = new THREE.Mesh(geo, mats.kart);
      mesh.castShadow = true;
      pivot.add(mesh);
      this.root.add(pivot);
      this.wheels.push({ pivot, mesh, front });
    };
    addWheel(chassis.wheels[0]!, wheelGeo, true);
    addWheel(chassis.wheels[1]!, wheelGeo, true);
    addWheel(chassis.wheels[2]!.clone().add(chassis.wheels[3]!).multiplyScalar(0.5), rearGeo, false);
    const wing = new THREE.Mesh(wingGeo, mats.kart);
    wing.castShadow = true;
    wing.position.copy(chassis.glider);
    wing.visible = false;
    this.wing = wing;
    this.root.add(wing);
    const pilot = cloneSkinned(driver.template);
    pilot.position.copy(chassis.seat);
    this.root.add(pilot);
    this.lod0 = pilot.getObjectByName('lod0') ?? null;
    this.lod1 = pilot.getObjectByName('lod1') ?? null;
    if (ghost) for (const o of [this.lod0, this.lod1]) if (o) (o as THREE.Mesh).material = mats.pilot;
    this.mixer = new THREE.AnimationMixer(pilot);
    const mk = (name: string, loop: boolean) => {
      const clip = driver.clips.find((c) => c.name === name) ?? new THREE.AnimationClip(name, 1, []);
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.play();
      if (!loop) a.paused = true;
      return a;
    };
    this.act = { idle: mk('idle', true), steerL: mk('steerL', false), steerR: mk('steerR', false), trick: mk('trick', false), hit: mk('hit', false), lookBack: mk('lookBack', false), victory: mk('victory', true) };
    this.act.idle.time = (ch * 0.37) % 2; // que los karts no respiren a la vez
    this.act.victory.time = (ch * 0.23) % 2;
  }

  /** Ruedas (giro + dirección), ala, LOD y clips del piloto. */
  update(s: RigInput) {
    this.spin += (s.speed / this.radius) * s.dt;
    const steer = -Math.max(-1, Math.min(1, s.lean)) * 0.32; // lean < 0 = izquierda = giro antihorario (+Y)
    for (const w of this.wheels) { w.pivot.rotation.y = w.front ? steer : 0; w.mesh.rotation.x = -this.spin; }
    if (this.wing) {
      this.wing.visible = s.deploy > 0.02;
      const e = s.deploy * s.deploy * (3 - 2 * s.deploy);
      this.wing.scale.setScalar(Math.max(0.001, e));
      this.wing.rotation.z = -s.lean * 0.15;
    }
    const far = s.depth > LOD_DIST;
    if (this.lod0) this.lod0.visible = !far;
    if (this.lod1) this.lod1.visible = far;
    // la pose se mezcla por pesos (el mixer promedia): base idle ↔ volante, y encima los clips de evento
    const k = 1 - Math.exp(-s.dt * 9);
    this.look += ((s.look ? 1 : 0) - this.look) * k;
    this.win += ((s.win ? 1 : 0) - this.win) * k;
    const a = this.act, c = (x: number) => Math.max(0, Math.min(1, x));
    const tw = s.trick > 0 ? 1 : 0, hw = s.hit > 0 ? 1 : 0, ov = Math.max(tw, hw, this.look, this.win);
    const l = c(-s.lean), r = c(s.lean), base = 1 - ov;
    a.steerL.time = a.steerL.getClip().duration; a.steerR.time = a.steerR.getClip().duration;
    a.trick.time = c(s.trick) * a.trick.getClip().duration; a.hit.time = c(s.hit) * a.hit.getClip().duration;
    a.lookBack.time = a.lookBack.getClip().duration;
    a.steerL.setEffectiveWeight(l * base); a.steerR.setEffectiveWeight(r * base);
    a.idle.setEffectiveWeight(Math.max(0.0001, (1 - l - r) * base));
    a.trick.setEffectiveWeight(tw); a.hit.setEffectiveWeight(hw); a.lookBack.setEffectiveWeight(this.look); a.victory.setEffectiveWeight(this.win);
    this.mixer.update(s.dt);
  }

  dispose() { this.mixer.stopAllAction(); }
}

export class KartModels {
  private loader = new GLTFLoader();
  private chassis = new Map<string, Chassis>();
  private wheels = new Map<string, THREE.BufferGeometry>();
  private wings = new Map<string, THREE.BufferGeometry>();
  private drivers = new Map<number, Driver>();
  private pending = new Map<string, Promise<void>>();
  private tinted = new Map<string, THREE.BufferGeometry>();
  readonly kartMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.08 });
  readonly pilotMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  readonly ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.55, metalness: 0.08 });

  private load(name: string, done: (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => void): Promise<void> {
    let p = this.pending.get(name);
    if (!p) {
      const url = urlOf(name);
      p = url ? this.loader.loadAsync(url).then((g) => done(g), () => { /* sin archivo: el kart voxel sigue de respaldo */ }) : Promise.resolve();
      this.pending.set(name, p);
    }
    return p;
  }

  loadChassis(id: string) {
    return this.load(`part_${id}`, (g) => {
      g.scene.updateMatrixWorld(true);
      const at = (n: string) => { const o = g.scene.getObjectByName(n); return o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(); };
      this.chassis.set(id, { geo: bakeStatic(g.scene), seat: at('seat'), wheels: WHEEL_EMPTIES.map(at), glider: at('glider') });
    });
  }
  loadWheel(id: string) { return this.load(`part_${id}`, (g) => this.wheels.set(id, bakeStatic(g.scene))); }
  loadWing(id: string) { return this.load(`part_${id}`, (g) => this.wings.set(id, bakeStatic(g.scene))); }
  loadDriver(ch: number) {
    return this.load(`driver_${DRIVER_IDS[ch]}`, (g) => {
      bakePilot(g.scene, this.pilotMat);
      this.drivers.set(ch, { template: g.scene, clips: g.animations });
    });
  }
  /** Carga lo que necesita un kart (piloto + sus 3 piezas). */
  loadKart(ch: number, p: PartIds) { return Promise.all([this.loadDriver(ch), this.loadChassis(p.body), this.loadWheel(p.wheels), this.loadWing(p.wing)]); }
  /** En segundo plano: los 12 pilotos y todas las piezas del catálogo. */
  preloadAll() {
    DRIVER_IDS.forEach((_, ch) => this.loadDriver(ch));
    partsOfType('body').forEach((p) => this.loadChassis(p.id));
    partsOfType('wheels').forEach((p) => this.loadWheel(p.id));
    partsOfType('wing').forEach((p) => this.loadWing(p.id));
  }

  ready(ch: number, p: PartIds): boolean {
    return this.drivers.has(ch) && this.chassis.has(p.body) && this.wheels.has(p.wheels) && this.wings.has(p.wing);
  }

  /** Las dos ruedas traseras en una sola geometría centrada en el eje trasero (cacheada por rueda y chasis). */
  private rearAxle(wheelId: string, bodyId: string, ck: Chassis, wg: THREE.BufferGeometry): THREE.BufferGeometry {
    const key = `r:${wheelId}|${bodyId}`;
    let g = this.tinted.get(key);
    if (!g) {
      const mid = ck.wheels[2]!.clone().add(ck.wheels[3]!).multiplyScalar(0.5);
      const side = (p: THREE.Vector3) => { const c = wg.clone(); c.translate(p.x - mid.x, p.y - mid.y, p.z - mid.z); return c; };
      g = mergeGeometries([side(ck.wheels[2]!), side(ck.wheels[3]!)])!;
      g.computeBoundingSphere();
      this.tinted.set(key, g);
    }
    return g;
  }

  /** Copia de la geometría con el material `body`/`canvas` teñido (caché por color: ≤ 12 karts). */
  private tint(key: string, geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
    const k = key + hex;
    let g = this.tinted.get(k);
    if (!g) {
      g = geo.clone();
      const col = g.getAttribute('color') as THREE.BufferAttribute, mask = g.getAttribute('tintMask') as THREE.BufferAttribute, c = new THREE.Color(hex);
      for (let i = 0; i < col.count; i++) if (mask.getX(i) > 0) col.setXYZ(i, c.r, c.g, c.b);
      this.tinted.set(k, g);
    }
    return g;
  }

  build(ch: number, p: PartIds, tintHex: string, ghost: boolean): RigKart | null {
    const ck = this.chassis.get(p.body), wg = this.wheels.get(p.wheels), ng = this.wings.get(p.wing), dr = this.drivers.get(ch);
    if (!ck || !wg || !ng || !dr) return null;
    const kart = ghost ? this.ghostMat : this.kartMat;
    return new RigKart(ch, ck, this.tint('c:' + p.body, ck.geo, tintHex), wg, this.rearAxle(p.wheels, p.body, ck, wg), p.wheels, this.tint('w:' + p.wing, ng, tintHex), dr, { kart, pilot: ghost ? this.ghostMat : this.pilotMat }, ghost);
  }
}
