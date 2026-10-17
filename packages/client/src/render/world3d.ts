// Three.js (WebGPU) world renderer. Draws the state it receives; owns no game logic.
import * as THREE from 'three/webgpu';
import { CHARS, type Character, type Track, hAt } from '@jpkart/core';
import { OUT, hexRGB, shade, type Spr } from '../art/pixel';
import { BALLS, D, ICONS, MINE, OLA, PUDDLE, REFLECT_RING, RING, SHOT, TARS } from '../art/sprites';
import { MK7_RIG, mk7Layers, type Voxel } from '../art/mk7';
import { buildCodeBody, buildCodeHead, buildShot, painted, part } from '../art/codeModels';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import jpBodyUrl from '../assets/models/jp_body.glb?inline';
import jpHeadUrl from '../assets/models/jp_head.glb?inline';
import miguelBodyUrl from '../assets/models/miguel_body.glb?inline';
import miguelHeadUrl from '../assets/models/miguel_head.glb?inline';
import wingUrl from '../assets/models/wing.glb?inline';
import shroomUrl from '../assets/models/shroom.glb?inline';
import { GRADES, Post, type Grade } from './post';
import { Particles } from './particles';
import type { QualityTier } from '../mobile';
import { F, buildGroundTexture, buildScenery, buildSkyGradient, buildSkyStrip, type SceneryItem } from './trackArt';

export const RW = 960, RH = 540; // internal world resolution (16:9, modern smooth HD)
export const H0 = RH / 2 - 40; // default horizon row (legacy: 40 px above center)
export const FOG_NEAR = 420, FOG_FAR = 1000;
export const KART_VOXEL = 0.7; // world units per voxel: on screen it matches the legacy 12.5-unit sprite seen from CAM_BACK

export interface CamView { x: number; y: number; z: number; a: number; hz: number; f?: number; roll?: number }
export interface KartView {
  id: number; ch: number; x: number; y: number; z: number; a: number; lean: number;
  hop: number; spin: number; big: boolean; bubble: boolean; reflect: boolean; visible: boolean; ground: number; air: boolean; glide: boolean;
  speed: number;
  /** 0..1 progress of a trick flip (0 = none) */
  trick: number;
  /** which figure: 1 twist (corkscrew), 2 spin, 3 flip (provisional animation in code until the V3-6 clips) */
  trickKind?: number;
  /** 0..1 squash after landing (1 = just landed) */
  squash: number;
  /** time-trial ghost: translucent, no outline */
  ghost?: boolean;
  local: boolean;
}
import type { ThingView } from './thingArt';
export type { ThingView };

const spriteTex = new Map<Spr, THREE.Texture>();
function texOf(s: Spr): THREE.Texture {
  let t = spriteTex.get(s);
  if (!t) {
    t = new THREE.CanvasTexture(s.cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    spriteTex.set(s, t);
  }
  return t;
}
const spriteMat = new Map<Spr, THREE.SpriteMaterial>();
function matOf(s: Spr): THREE.SpriteMaterial {
  let m = spriteMat.get(s);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: texOf(s), alphaTest: 0.5, transparent: false });
    spriteMat.set(s, m);
  }
  return m;
}
const flatMat = new Map<Spr, THREE.MeshBasicMaterial>();
function flatOf(s: Spr): THREE.MeshBasicMaterial {
  let m = flatMat.get(s);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: texOf(s), alphaTest: 0.5, side: THREE.DoubleSide });
    flatMat.set(s, m);
  }
  return m;
}

/** Merged voxel geometry with face culling and baked directional shading. Local frame: +X forward, +Z right, +Y up. */
function geometryFromVoxels(V: Voxel[]): THREE.BufferGeometry {
  const occ = new Set(V.map((v) => v[0] + ',' + v[1] + ',' + v[2]));
  const pos: number[] = [], colr: number[] = [], idx: number[] = [];
  const S = KART_VOXEL, c = new THREE.Color();
  // faces in voxel space (x right, y forward, z up)
  const FACES: { n: [number, number, number]; k: number; q: [number, number, number][] }[] = [
    { n: [0, 0, 1], k: 1.0, q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], k: 0.55, q: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
    { n: [0, 1, 0], k: 0.95, q: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]] },
    { n: [0, -1, 0], k: 0.8, q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [1, 0, 0], k: 0.72, q: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { n: [-1, 0, 0], k: 0.88, q: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]] },
  ];
  for (const [x, y, z, col] of V) {
    for (const f of FACES) {
      if (occ.has(x + f.n[0] + ',' + (y + f.n[1]) + ',' + (z + f.n[2]))) continue;
      const base = pos.length / 3;
      c.setStyle(shade(col, f.k));
      for (const [qx, qy, qz] of f.q) {
        const vx = x - 0.5 + qx, vy = y - 0.5 + qy, vz = z + qz;
        // voxel (x right, y forward, z up) → local (X forward, Y up, Z right)
        pos.push(vy * S, vz * S, vx * S);
        colr.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Decorado low-poly del bioma dunes (cactus, pirámide, calavera): piezas de ≤170 tris,
 * 1 material + colores por vértice, como `shroom.glb`. Base en y=0. Todo es código.
 */
/** Cactus de 30 u (150 tris): tronco + 2 brazos + flor, como el sprite `cactus`. */
function cactusGeo(): THREE.BufferGeometry | null {
  const G = '#4f9a4a', Gd = '#478a42';
  return mergeGeometries([
    painted(part(new THREE.CylinderGeometry(2.6, 3.0, 26, 7), 0, 13, 0), G),
    painted(part(new THREE.ConeGeometry(2.6, 2.5, 7), 0, 27.2, 0), '#5fae58'),
    painted(part(new THREE.BoxGeometry(1.4, 1.4, 1.4), 0, 29.5, 0), '#ff6a9a'),
    painted(part(new THREE.CylinderGeometry(1.4, 1.4, 5, 6), -4.5, 14, 0, Math.PI / 2), Gd),
    painted(part(new THREE.CylinderGeometry(1.4, 1.6, 7, 6), -7, 17.5, 0), Gd),
    painted(part(new THREE.CylinderGeometry(1.4, 1.4, 5, 6), 4.5, 11, 0, Math.PI / 2), G),
    painted(part(new THREE.CylinderGeometry(1.4, 1.6, 7, 6), 7, 14.5, 0), G),
  ]);
}
/** Pirámide de 84 u (20 tris): cara lit/sombra como el sprite `pyramid`. */
function pyramidGeo(): THREE.BufferGeometry | null {
  const cone = new THREE.ConeGeometry(42, 80, 4, 1);
  cone.rotateY(Math.PI / 4);
  cone.translate(0, 44, 0);
  return mergeGeometries([
    painted(cone, (x) => (x < 0 ? '#f0c878' : '#c8984a')),
    painted(part(new THREE.BoxGeometry(88, 4, 88), 0, 2, 0), '#b88a4e'),
  ]);
}
/** Calavera de 22 u (128 tris): cráneo + mandíbula + cuencas, como el sprite `skull`. */
function skullGeo(): THREE.BufferGeometry | null {
  return mergeGeometries([
    painted(part(new THREE.IcosahedronGeometry(8, 1), 0, 14, 0), '#7a6a70'),
    painted(part(new THREE.BoxGeometry(9, 5, 7), 0, 6, 0), '#6a5a60'),
    painted(part(new THREE.BoxGeometry(3, 3.5, 1.2), -3, 13.5, 7.8), '#1a1026'),
    painted(part(new THREE.BoxGeometry(3, 3.5, 1.2), 3, 13.5, 7.8), '#1a1026'),
    painted(part(new THREE.BoxGeometry(1.6, 2.2, 1.2), 0, 10.5, 7.8), '#1a1026'),
  ]);
}
/** Alturas de modelo (u) para escalar cada pieza a su altura de sprite (DH). */
const SOLID_H: Record<string, number> = { cactus: 30, pyramid: 84, skull: 22 };

interface WheelRig { g: THREE.Group; tire: THREE.Mesh; hub: THREE.Mesh; front: boolean }
interface KartObj {
  root: THREE.Group; body: THREE.Group; headG: THREE.Group;
  shadow: THREE.Mesh; ring: THREE.Sprite; refl: THREE.Sprite;
  wheels: WheelRig[]; spin: number;
  ch: number; ghost: boolean;
  bodyMesh: THREE.Mesh; bodyOut: THREE.Mesh; headMesh: THREE.Mesh; headOut: THREE.Mesh;
  wingMesh: THREE.Mesh | null; wingMat: THREE.MeshStandardMaterial; deploy: number; extCh: number;
  /** qué geometría lleva puesta: voxel (fallback), code (procedural) o ext (.glb) */
  model: 'voxel' | 'code' | 'ext';
}
/** Karts modelados en Blender (fase 2): ch -> glb body/head. El resto usa modelos procedurales (codeModels); el voxel es el fallback. */
const EXT_MODELS: Record<number, { body: string; head: string }> = {
  5: { body: jpBodyUrl, head: jpHeadUrl },
  4: { body: miguelBodyUrl, head: miguelHeadUrl },
};
interface KartGeo { body: THREE.BufferGeometry; head: THREE.BufferGeometry; headC: THREE.Vector3 }

export class WorldRenderer {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, RW / RH, 0.5, FOG_FAR + 150);
  backend = '';
  post!: Post;
  particles!: Particles;
  private track: Track | null = null;
  private trackGroup = new THREE.Group();
  private skyGroup = new THREE.Group();
  private kartObjs = new Map<number, KartObj>();
  private kartGeo = new Map<number, KartGeo>();
  private extGeo = new Map<number, { body: THREE.BufferGeometry; head: THREE.BufferGeometry }>();
  private codeGeo = new Map<number, { body: THREE.BufferGeometry; head: THREE.BufferGeometry }>();
  private wingGeo: THREE.BufferGeometry | null = null;
  private wingCenter = new THREE.Vector3();
  private shroomGeo: THREE.BufferGeometry | null = null;
  private shroomPool: THREE.Mesh[] = [];
  private shroomUsed = 0;
  private shotGeo: THREE.BufferGeometry | null = null;
  private shotGeoTried = false;
  private shotPool: THREE.Mesh[] = [];
  private shotUsed = 0;
  private extLoading = false;
  private wheelGeos = new Map<number, THREE.BufferGeometry>();
  private kartMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.08 });
  private outlineMat = new THREE.MeshBasicMaterial({ color: OUT, side: THREE.BackSide });
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  private ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.5, metalness: 0.08 });
  private wheelGeo = new THREE.CylinderGeometry(1.9, 1.9, 1.6, 12);
  private hubGeo = new THREE.CylinderGeometry(0.95, 0.95, 1.7, 10);
  private wheelMat = new THREE.MeshStandardMaterial({ color: 0x232330, roughness: 0.85, metalness: 0.15 });
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  private hemi = new THREE.HemisphereLight(0xbbddff, 0x445533, 0.9);
  private dayBg = new THREE.Color();
  private thingPool: THREE.Object3D[] = [];
  private thingUsed = 0;
  private boxSprites: THREE.Sprite[] = [];
  private water: THREE.Mesh | null = null;
  private decor: { mesh: THREE.InstancedMesh; items: { x: number; y: number; z: number; w: number; h: number }[] }[] = [];
  private decorYaw = NaN;
  private waterTex: THREE.CanvasTexture | null = null;
  private baseGrade: Grade = GRADES.grass!;
  private atm = { night: -1, fog: -1 };
  /** M3: tier de calidad (auto = ahorro en móvil). Por defecto alta = comportamiento PC intacto. */
  tier: QualityTier = 'alta';
  private lowFpsT = 0;

  /** Weather/time of day (visual only): `night` 0..1 blends the biome grade towards night, `fog` 0..1 pulls the fog in. */
  setAtmosphere(night: number, fog: number) {
    if (Math.abs(night - this.atm.night) < 0.005 && Math.abs(fog - this.atm.fog) < 0.005) return;
    this.atm = { night, fog };
    const g = this.baseGrade, N = NIGHT_GRADE, m = (a: number, b: number) => a + (b - a) * night;
    this.post.setGrade({ tint: [m(g.tint[0], N.tint[0]), m(g.tint[1], N.tint[1]), m(g.tint[2], N.tint[2])], saturation: m(g.saturation, N.saturation), contrast: m(g.contrast, N.contrast), lift: m(g.lift, N.lift) });
    const f = this.scene.fog;
    if (f instanceof THREE.Fog) { f.near = FOG_NEAR * (1 - fog * 0.9); f.far = FOG_FAR * (1 - fog * 0.72); }
    // night dims the sun and cools the sky
    this.sun.intensity = 2.6 * (1 - night * 0.8);
    this.hemi.intensity = 0.9 * (1 - night * 0.55);
    const bg = this.scene.background;
    if (bg instanceof THREE.Color) bg.copy(this.dayBg).multiplyScalar(1 - night * 0.7);
    if (f instanceof THREE.Fog) f.color.copy(this.dayBg).multiplyScalar(1 - night * 0.7);
  }

  async init(canvas: HTMLCanvasElement, forceWebGL = false, opts?: { tier?: QualityTier; antialias?: boolean }) {
    this.tier = opts?.tier ?? 'alta';
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: opts?.antialias ?? true, forceWebGL });
    await this.renderer.init();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RW, RH, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.wheelGeo.rotateX(Math.PI / 2); // cylinder axle (Y) → kart right axis (Z)
    this.hubGeo.rotateX(Math.PI / 2);
    // key sun with shadows + sky/ground fill
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 500;
    this.sun.shadow.camera.left = -140;
    this.sun.shadow.camera.right = 140;
    this.sun.shadow.camera.top = 140;
    this.sun.shadow.camera.bottom = -140;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 2;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.skyGroup, this.trackGroup);
    this.camera.rotation.order = 'YXZ';
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.particles = new Particles(this.scene);
    this.applyTier(this.tier);
  }

  /** M3: aplica un tier de calidad sin tocar la sim. Alta = PC intacto. */
  applyTier(t: QualityTier) {
    this.tier = t;
    const r = this.renderer;
    try {
      const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
      r.setPixelRatio(t === 'ahorro' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    } catch { r.setPixelRatio(1); }
    const saving = t === 'ahorro';
    // Sombras: 2048 (PC legacy) → 1024 en alta, OFF en ahorro.
    try {
      this.sun.castShadow = !saving;
      r.shadowMap.enabled = !saving;
      this.sun.shadow.mapSize.set(saving ? 512 : 1024, saving ? 512 : 1024);
      const m = this.sun.shadow.map as { dispose?: () => void } | null;
      if (m && typeof m.dispose === 'function') { m.dispose(); (this.sun.shadow as { map: unknown }).map = null; }
      this.scene.traverse((o) => {
        const mm = o as THREE.Mesh;
        const mats = (mm as { material?: { needsUpdate?: boolean } | { needsUpdate?: boolean }[] }).material;
        if (mats) for (const x of Array.isArray(mats) ? mats : [mats]) x.needsUpdate = true;
      });
    } catch { /* sombras opcionales */ }
    try {
      r.toneMapping = saving ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = saving ? 1 : 1.1;
    } catch { /* noop */ }
    try {
      if (this.particles) this.particles.cap = saving ? 256 : 1024;
      if (this.post) {
        if (saving) { this.post.setBloom(0); this.post.setVignette(0.12); }
        else if (this.track) this.post.setBloom(this.track.th.style === 'grid' || this.track.th.style === 'rock' ? 0.45 : 0.15);
        else this.post.setBloom(0.15);
      }
    } catch { /* noop */ }
  }

  /** M3: auto-downgrade si fps<40 durante 3 s seguidos. Devuelve true al bajar. */
  noteFps(fps: number, dt: number): boolean {
    if (this.tier !== 'alta') { this.lowFpsT = 0; return false; }
    if (fps < 40 && fps > 0) this.lowFpsT += dt;
    else this.lowFpsT = 0;
    if (this.lowFpsT >= 3) {
      this.lowFpsT = 0;
      this.applyTier('ahorro');
      return true;
    }
    return false;
  }

  /** M0: reafirma el tamaño interno tras un resize del viewport virtual. */
  assertSize() {
    try { this.renderer.setSize(RW, RH, false); } catch { /* noop */ }
  }

  /** Rebuild every track-dependent object. */
  setTrack(tr: Track) {
    if (this.track === tr) return;
    this.track = tr;
    this.warmPending = true;
    for (const o of [...this.trackGroup.children]) { this.trackGroup.remove(o); disposeDeep(o); }
    for (const o of [...this.skyGroup.children]) { this.skyGroup.remove(o); disposeDeep(o); }
    this.boxSprites = [];
    this.water = null;
    const fog = new THREE.Color(tr.th.fog);
    this.scene.background = fog;
    this.dayBg.copy(fog);
    this.scene.fog = new THREE.Fog(fog.clone(), FOG_NEAR, FOG_FAR);
    this.baseGrade = GRADES[tr.th.style] ?? GRADES.grass!;
    this.atm = { night: -1, fog: -1 };
    this.post.setGrade(this.baseGrade);
    this.post.setBloom(this.tier === 'ahorro' ? 0 : tr.th.style === 'grid' || tr.th.style === 'rock' ? 0.45 : 0.15);
    this.particles.clear();
    this.buildTerrain(tr);
    this.buildWalls(tr);
    if (tr.water) this.buildWater(tr);
    this.buildSky(tr);
    this.buildSceneryObjs(buildScenery(tr));
    for (const b of tr.boxes) {
      const s = new THREE.Sprite(matOf(BALLS[0]!));
      s.center.set(0.5, 0);
      s.scale.set(11, 11, 1);
      s.position.set(b.x, b.z, b.y);
      this.trackGroup.add(s);
      this.boxSprites.push(s);
    }
  }

  private buildTerrain(tr: Track) {
    const data = buildGroundTexture(tr);
    const TS = tr.size;
    const tex = new THREE.DataTexture(data, TS, TS, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const n = tr.res, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i, x = i * 4 + 2, y = j * 4 + 2;
        pos[k * 3] = x; pos[k * 3 + 1] = tr.hm[k]!; pos[k * 3 + 2] = y;
        uv[k * 2] = x / TS; uv[k * 2 + 1] = y / TS;
      }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.trackGroup.add(mesh);
    // outside the map: checkered plateau (legacy draws outA/outB squares there)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2;
    const cg = cv.getContext('2d')!;
    cg.fillStyle = tr.th.out[0]; cg.fillRect(0, 0, 2, 2);
    cg.fillStyle = tr.th.out[1]; cg.fillRect(1, 0, 1, 1); cg.fillRect(0, 1, 1, 1);
    const ct = new THREE.CanvasTexture(cv);
    ct.magFilter = THREE.NearestFilter; ct.minFilter = THREE.NearestFilter; ct.generateMipmaps = false;
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.colorSpace = THREE.SRGBColorSpace;
    const EXT = 3000;
    ct.repeat.set((TS + EXT * 2) / 32, (TS + EXT * 2) / 32);
    const og = new THREE.PlaneGeometry(TS + EXT * 2, TS + EXT * 2);
    og.rotateX(-Math.PI / 2);
    let edge = 0, cnt = 0;
    for (let i = 0; i < n; i += 8) for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) { edge += tr.hm[k]!; cnt++; }
    const outer = new THREE.Mesh(og, new THREE.MeshBasicMaterial(tr.water ? { color: new THREE.Color(tr.th.ground[0]).multiplyScalar(0.55) } : { map: ct }));
    outer.position.set(TS / 2, tr.water ? -14 : edge / cnt - 2, TS / 2);
    this.trackGroup.add(outer);
  }

  /** Railings along hard walls: a striped ribbon at the road edge. */
  private buildWalls(tr: Track) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 4;
    const g = cv.getContext('2d')!;
    g.fillStyle = tr.th.curbA; g.fillRect(0, 0, 8, 4);
    g.fillStyle = tr.th.curbB; g.fillRect(0, 0, 4, 4);
    g.fillStyle = OUT; g.fillRect(0, 0, 8, 1); g.fillRect(0, 3, 8, 1);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
    const N = tr.N, H = 5;
    for (const side of [-1, 1]) {
      const flags = side < 0 ? tr.wallL : tr.wallR;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let run = false, u = 0;
      for (let k = 0; k <= N; k++) {
        const i = k % N, on = !!flags[i];
        if (on) {
          const a = tr.ang[i]!, l = side * (tr.wd[i]! + 8), x = tr.x[i]! - Math.sin(a) * l, y = tr.y[i]! + Math.cos(a) * l, z = hAt(tr, x, y);
          const base = pos.length / 3;
          pos.push(x, z, y, x, z + H, y);
          uv.push(u, 0, u, 1);
          if (run) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
          run = true; u += 0.75;
        } else run = false;
      }
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      this.trackGroup.add(new THREE.Mesh(geo, mat));
    }
  }

  /** Animated sea surface; its height follows the tide (world.water). */
  private buildWater(tr: Track) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const L = tr.def.liquid!;
    g.fillStyle = L.col; g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x++) {
      const v = Math.sin((x / 64) * Math.PI * 4 + y * 0.7) + Math.sin(y * 0.31);
      if (v > 1.1) { g.fillStyle = L.col3; g.fillRect(x, y, 1, 1); } else if (v < -1.2) { g.fillStyle = L.col2; g.fillRect(x, y, 1, 1); }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const EXT = 3000, S = tr.size + EXT * 2;
    tex.repeat.set(S / 96, S / 96);
    const geo = new THREE.PlaneGeometry(S, S);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.3, depthWrite: false }));
    mesh.position.set(tr.size / 2, tr.water!.base, tr.size / 2);
    mesh.renderOrder = 1;
    this.trackGroup.add(mesh);
    this.water = mesh;
    this.waterTex = tex;
  }

  private buildSky(tr: Track) {
    // Both cylinders are centered on the camera every frame. Radius is arbitrary (fog-free, drawn first).
    const R = 900, SEG = 128;
    const grad = new THREE.CanvasTexture(buildSkyGradient(tr));
    grad.magFilter = THREE.NearestFilter; grad.minFilter = THREE.NearestFilter; grad.generateMipmaps = false; grad.colorSpace = THREE.SRGBColorSpace;
    grad.wrapS = THREE.RepeatWrapping;
    // 64-px dither tile ≈ 64 screen px: F px per radian → u = θ·F/64
    const gradGeo = cylinder(R, 0, (420 / F) * R, SEG, (th) => (th * F) / 64);
    const gradMesh = new THREE.Mesh(gradGeo, new THREE.MeshBasicMaterial({ map: grad, fog: false, depthWrite: false, side: THREE.BackSide }));
    gradMesh.renderOrder = -2;
    // below the horizon: fog color
    const strip = new THREE.CanvasTexture(buildSkyStrip(tr));
    strip.magFilter = THREE.NearestFilter; strip.minFilter = THREE.NearestFilter; strip.generateMipmaps = false; strip.colorSpace = THREE.SRGBColorSpace;
    strip.wrapS = THREE.RepeatWrapping;
    // strip column u (px) is world heading θ = u/F − 1 (legacy: off = a·F, centre column RW/2 = F)
    const stripGeo = cylinder(R * 0.98, 0, (230 / F) * R * 0.98, SEG, (th) => ((th + 1) * F) / (2 * Math.PI * F));
    const stripMesh = new THREE.Mesh(stripGeo, new THREE.MeshBasicMaterial({ map: strip, fog: false, depthWrite: false, transparent: true, alphaTest: 0.5, side: THREE.BackSide }));
    stripMesh.renderOrder = -1;
    this.skyGroup.add(gradMesh, stripMesh);
  }

  /** Scenery as one InstancedMesh per sprite kind (cylindrical billboards), shadows in a single mesh. Solid 3D kinds (dunes) use their low-poly geometry instead. */
  private buildSceneryObjs(list: SceneryItem[]) {
    const byKind = new Map<string, SceneryItem[]>();
    for (const d of list) { let l = byKind.get(d.k); if (!l) byKind.set(d.k, (l = [])); l.push(d); }
    this.decor = [];
    let solid: Record<string, THREE.BufferGeometry | null> = {};
    try {
      solid = { cactus: cactusGeo(), pyramid: pyramidGeo(), skull: skullGeo() };
    } catch { solid = {}; } // fallback: todo sprites si falla la fusión
    const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), ss = new THREE.Vector3(), sp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [k, items] of byKind) {
      const geo3d = solid[k];
      if (geo3d) {
        const mesh = new THREE.InstancedMesh(geo3d, this.kartMat, items.length);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        items.forEach((d, i) => {
          const s = d.h / (SOLID_H[k] ?? d.h);
          sq.setFromAxisAngle(up, Math.sin(d.x * 12.9898 + d.y * 78.233) * Math.PI);
          sm.compose(sp.set(d.x, d.z, d.y), sq, ss.set(s, s, s));
          mesh.setMatrixAt(i, sm);
        });
        this.trackGroup.add(mesh);
        continue;
      }
      const spr = D[k]!;
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ map: texOf(spr), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.frustumCulled = false;
      this.trackGroup.add(mesh);
      this.decor.push({ mesh, items: items.map((d) => ({ x: d.x, y: d.y, z: d.z, w: (spr.w * d.h) / spr.h, h: d.h })) });
    }
    const shadowItems = list.filter((d) => d.h >= 30 && !d.arch && !solid[d.k]);
    if (shadowItems.length) {
      const geo = new THREE.CircleGeometry(1, 12);
      geo.rotateX(-Math.PI / 2);
      const sh = new THREE.InstancedMesh(geo, this.shadowMat, shadowItems.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      shadowItems.forEach((d, i) => {
        const spr = D[d.k]!;
        m.compose(p.set(d.x, d.z + 0.3, d.y), q, sc.set(((spr.w * d.h) / spr.h) * 0.35, 1, 3));
        sh.setMatrixAt(i, m);
      });
      sh.frustumCulled = false;
      this.trackGroup.add(sh);
    }
    this.decorYaw = NaN;
  }

  /** Re-orient the billboards when the camera turns (cheap: one shared rotation). */
  private updateDecor(yaw: number) {
    if (Math.abs(yaw - this.decorYaw) < 0.002) return;
    this.decorYaw = yaw;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw - Math.PI / 2), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const d of this.decor) {
      d.items.forEach((it, i) => { m.compose(p.set(it.x, it.z, it.y), q, sc.set(it.w, it.h, 1)); d.mesh.setMatrixAt(i, m); });
      d.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private kartGeoOf(ch: number): KartGeo {
    let g = this.kartGeo.get(ch);
    if (!g) {
      const L = mk7Layers(CHARS[ch]!);
      const body = geometryFromVoxels([...L.kart, ...L.body]);
      const head = geometryFromVoxels(L.head);
      // centro de la cabeza en coords locales (para pivotear la mirada MK7
      // y para el futuro swap por cabeza Mii: solo cambia `head` + `headC`).
      const S = KART_VOXEL;
      const headC = new THREE.Vector3(MK7_RIG.HEAD_C.y * S, (MK7_RIG.HEAD_C.z + 0.5) * S, MK7_RIG.HEAD_C.x * S);
      g = { body, head, headC };
      this.kartGeo.set(ch, g);
    }
    return g;
  }

  /** Carga perezosa de los .glb de Blender (data-URI embutido, sin fetch): al resolver, swapea los karts en escena. */
  private ensureExternal() {
    if (this.extLoading) return;
    this.extLoading = true;
    const loader = new GLTFLoader();
    const one = async (url: string): Promise<THREE.BufferGeometry | null> => {
      try {
        const gl = await loader.loadAsync(url);
        const mesh = gl.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh | undefined;
        const geo = mesh?.geometry as THREE.BufferGeometry | undefined;
        gl.scene.traverse((ob) => {
          const m = ob as THREE.Mesh;
          if (m.isMesh && m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
        });
        return geo ?? null;
      } catch { return null; }
    };
    (async () => {
      const jobs: { ch: number; part: 'body' | 'head'; url: string }[] = [];
      for (const [ch, f] of Object.entries(EXT_MODELS)) jobs.push({ ch: +ch, part: 'body', url: f.body }, { ch: +ch, part: 'head', url: f.head });
      const geos = await Promise.all(jobs.map((j) => one(j.url)));
      geos.forEach((geo, i) => {
        if (!geo) return;
        geo.rotateY(-Math.PI / 2); // three (-Z adelante) -> marco del juego (+X adelante)
        const j = jobs[i]!;
        let e = this.extGeo.get(j.ch);
        if (!e) { e = { body: null as unknown as THREE.BufferGeometry, head: null as unknown as THREE.BufferGeometry }; this.extGeo.set(j.ch, e); }
        e[j.part] = geo;
      });
      const wg = await one(wingUrl);
      if (wg) {
        wg.rotateY(-Math.PI / 2);
        wg.computeBoundingBox();
        wg.boundingBox!.getCenter(this.wingCenter);
        wg.translate(-this.wingCenter.x, -this.wingCenter.y, -this.wingCenter.z);
        this.wingGeo = wg;
      }
      const sg = await one(shroomUrl);
      if (sg) this.shroomGeo = sg;
      for (const o of this.kartObjs.values()) this.applyModel(o);
    })();
  }

  /** Modelo procedural del ch (los 6 sin .glb). Null si falla la fusión → fallback voxel. */
  private codeModelOf(ch: number): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } | null {
    if (ch in EXT_MODELS) return null;
    let m = this.codeGeo.get(ch);
    if (!m) {
      try {
        const def = CHARS[ch] as Character | undefined;
        if (!def) return null;
        const body = buildCodeBody(def), head = buildCodeHead(def);
        if (!body || !head) return null;
        m = { body, head };
        this.codeGeo.set(ch, m);
      } catch { return null; }
    }
    return m;
  }

  /** Elige geometría: .glb si cargó, procedural si existe, voxel si todo falla. */
  private applyModel(o: KartObj) {
    const e = this.extGeo.get(o.ch);
    if (e?.body && e?.head) {
      if (o.model !== 'ext' || o.extCh !== o.ch) {
        const mat = o.ghost ? this.ghostMat : this.kartMat;
        o.bodyMesh.geometry = e.body; o.bodyMesh.material = mat;
        o.bodyOut.geometry = e.body; o.bodyOut.visible = !o.ghost;
        o.headMesh.geometry = e.head; o.headMesh.material = mat;
        o.headOut.geometry = e.head; o.headOut.visible = !o.ghost;
        o.model = 'ext'; o.extCh = o.ch;
      }
      return;
    }
    const c = this.codeModelOf(o.ch);
    if (c && (o.model !== 'code' || o.extCh !== o.ch)) {
      const mat = o.ghost ? this.ghostMat : this.kartMat;
      o.bodyMesh.geometry = c.body; o.bodyMesh.material = mat;
      o.bodyOut.geometry = c.body; o.bodyOut.visible = !o.ghost;
      o.headMesh.geometry = c.head; o.headMesh.material = mat;
      o.headOut.geometry = c.head; o.headOut.visible = !o.ghost;
      o.model = 'code'; o.extCh = o.ch;
    }
  }

  /** Debug/QA: qué modelo lleva cada kart en escena (id → ch + kind). */
  modelKinds(): Record<number, { ch: number; model: KartObj['model'] }> {
    return Object.fromEntries([...this.kartObjs.entries()].map(([id, o]) => [id, { ch: o.ch, model: o.model }]));
  }

  private wingOf(o: KartObj) {
    if (!o.wingMesh && this.wingGeo) {
      const m = new THREE.Mesh(this.wingGeo, o.wingMat);
      m.castShadow = true;
      m.visible = false;
      m.position.copy(this.wingCenter);
      o.body.add(m);
      o.wingMesh = m;
    }
  }

  /** One wheel per pilot: dark tyre + hub cap in the kart colour, fused with per-vertex colours. */
  private wheelGeoOf(ch: number): THREE.BufferGeometry {
    let g = this.wheelGeos.get(ch);
    if (!g) {
      const paint = (src: THREE.BufferGeometry, col: THREE.Color) => {
        const c = src.clone().toNonIndexed();
        const n = c.attributes.position!.count, a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
        c.setAttribute('color', new THREE.BufferAttribute(a, 3));
        c.deleteAttribute('uv');
        return c;
      };
      g = mergeGeometries([paint(this.wheelGeo, new THREE.Color(0x232330)), paint(this.hubGeo, new THREE.Color(CHARS[ch]!.kart))])!;
      this.wheelGeos.set(ch, g);
    }
    return g;
  }

  private kartObj(id: number, ch: number, ghost = false): KartObj {
    let o = this.kartObjs.get(id);
    if (o) return o;
    const g = this.kartGeoOf(ch);
    const mat = ghost ? this.ghostMat : this.kartMat;
    const root = new THREE.Group(), body = new THREE.Group();
    const mesh = new THREE.Mesh(g.body, mat);
    mesh.castShadow = true;
    const outline = new THREE.Mesh(g.body, this.outlineMat);
    outline.visible = !ghost;
    outline.scale.setScalar(1.07);
    outline.position.y = -0.35;
    body.add(outline, mesh);
    // cabeza aparte: pivota en headC (mirada + cabezazo). El Mii reutilizará este nodo.
    const headG = new THREE.Group();
    headG.position.copy(g.headC);
    const head = new THREE.Mesh(g.head, mat);
    head.castShadow = true;
    head.position.copy(g.headC).negate();
    const headOut = new THREE.Mesh(g.head, this.outlineMat);
    headOut.visible = !ghost;
    headOut.scale.setScalar(1.07);
    headOut.position.copy(head.position).add(new THREE.Vector3(0, -0.35, 0));
    headG.add(headOut, head);
    body.add(headG);
    root.add(body);
    // ruedas expuestas MK7: neumático + tapacubos del color del kart; giran con
    // la velocidad y las delanteras orientan con el derrape/dirección.
    // Van en `body` (no en `root`) para heredar barrel-roll del truco y squash:
    // posiciones en el mismo marco que el voxel (origen de body = origen de root).
    const wheelG = this.wheelGeoOf(ch);
    const wheels: WheelRig[] = [];
    for (const [wx, wz] of [[4.2, 4.4], [4.2, -4.4], [-4.2, 4.4], [-4.2, -4.4]]) {
      const grp = new THREE.Group();
      grp.position.set(wx, 1.9, wz);
      const front = wx > 0;
      // tyre + hub cap fused into one mesh (vertex colours): half the draw calls per wheel, 12 karts must fit
      const tire = new THREE.Mesh(wheelG, ghost ? this.ghostMat : this.kartMat);
      tire.castShadow = true;
      const cap = tire;
      grp.add(tire);
      grp.rotation.order = 'YZX';
      grp.userData.front = front;
      body.add(grp);
      wheels.push({ g: grp, tire, hub: cap, front });
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    const ring = new THREE.Sprite(matOf(RING));
    ring.center.set(0.5, 0.25);
    ring.scale.set(17, 17, 1);
    const refl = new THREE.Sprite(matOf(REFLECT_RING));
    refl.center.set(0.5, 0.25);
    refl.scale.set(19, 19, 1);
    this.scene.add(root, shadow, ring, refl);
    const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(CHARS[ch]?.kart ?? '#ffffff'), roughness: 0.5, metalness: 0.08 });
    if (ghost) { wingMat.transparent = true; wingMat.opacity = 0.42; wingMat.depthWrite = false; }
    o = { root, body, headG, shadow, ring, refl, wheels, spin: 0, ch, ghost, bodyMesh: mesh, bodyOut: outline, headMesh: head, headOut, wingMesh: null, wingMat, deploy: 0, extCh: -1, model: 'voxel' };
    this.applyModel(o);
    this.kartObjs.set(id, o);
    return o;
  }

  clearKarts() {
    for (const o of this.kartObjs.values()) this.scene.remove(o.root, o.shadow, o.ring, o.refl);
    this.kartObjs.clear();
  }

  private thing(spr: Spr, flat: boolean): THREE.Object3D {
    let o = this.thingPool[this.thingUsed];
    const want = flat ? 'flat' : 'sprite';
    if (!o || o.userData.kind !== want) {
      if (o) this.scene.remove(o);
      if (flat) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flatOf(spr));
        m.rotation.x = -Math.PI / 2;
        o = m;
      } else {
        const s = new THREE.Sprite(matOf(spr));
        s.center.set(0.5, 0);
        o = s;
      }
      o.userData.kind = want;
      this.thingPool[this.thingUsed] = o;
      this.scene.add(o);
    }
    if (flat) (o as THREE.Mesh).material = flatOf(spr);
    else (o as THREE.Sprite).material = matOf(spr);
    o.visible = true;
    this.thingUsed++;
    return o;
  }

  render(cam: CamView, karts: KartView[], things: ThingView[], boxesActive: boolean[], t: number, water = 0, dt = 1 / 60) {
    if (!this.track) return;
    this.setCamera(cam, RW, RH);
    this.update(cam, karts, things, boxesActive, t, water, dt);
    // pre-warm: compile every material of the new track (and the karts, now built) in the background, also the ones
    // out of view; otherwise each one compiles the first time it enters the screen = stutters in the first lap
    if (this.warmPending) { this.warmPending = false; void this.renderer.compileAsync(this.scene, this.camera).catch(() => {}); }
    this.post.render(this.scene, this.camera);
  }
  private warmPending = false;

  /**
   * Split screen (Phase 10): the scene is updated once, then drawn once per viewport with its own camera.
   * `rect` = [x, y, w, h] in world pixels (RW × RH, y from the top). Post-processing is skipped (one pass per frame).
   */
  renderSplit(views: { cam: CamView; rect: [number, number, number, number] }[], karts: KartView[], things: ThingView[], boxesActive: boolean[], t: number, water = 0, dt = 1 / 60) {
    if (!this.track || !views.length) return;
    const r = this.renderer;
    this.setCamera(views[0]!.cam, views[0]!.rect[2], views[0]!.rect[3]);
    this.update(views[0]!.cam, karts, things, boxesActive, t, water, dt);
    r.setScissorTest(true);
    for (const v of views) {
      const [x, y, w, h] = v.rect;
      this.setCamera(v.cam, w, h);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.render(this.scene, this.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, RW, RH);
  }

  /** Camera for a view of vw × vh pixels: level, yaw = cam.a, principal point at (vw/2, hz) — legacy voxel projection. */
  private setCamera(cam: CamView, vw: number, vh: number) {
    const c = this.camera, k = vh / RH, hz = cam.hz * k;
    const halfH = Math.max(hz, vh - hz) + 1, focal = (cam.f ?? F) * k;
    c.fov = (2 * Math.atan(halfH / focal) * 180) / Math.PI;
    c.aspect = vw / (halfH * 2);
    c.setViewOffset(vw, halfH * 2, 0, halfH - hz, vw, vh);
    c.position.set(cam.x, cam.z, cam.y);
    c.rotation.set(0, -cam.a - Math.PI / 2, cam.roll ?? 0);
    c.updateProjectionMatrix();
    this.skyGroup.position.set(cam.x, cam.z, cam.y);
    this.updateDecor(cam.a);
  }

  /** Shared per-frame scene update: water, boxes, karts, things, particles. */
  private update(cam: CamView, karts: KartView[], things: ThingView[], boxesActive: boolean[], t: number, water: number, dt: number) {
    const tr = this.track!;
    this.ensureExternal();
    // the sun follows the camera so shadows stay crisp wherever the race goes
    this.sun.position.set(cam.x + 45, cam.z + 130, cam.y - 45);
    this.sun.target.position.set(cam.x, cam.z, cam.y);
    this.sun.target.updateMatrixWorld();
    if (this.water) { this.water.position.y = water; this.waterTex!.offset.set((t * 0.01) % 1, (t * 0.023) % 1); }
    // boxes
    const bf = BALLS[((t * 8) | 0) % 4]!;
    this.boxSprites.forEach((s, i) => {
      s.visible = !!boxesActive[i];
      if (s.visible) {
        s.material = matOf(BALLS[(((t * 8) | 0) + (tr.boxes[i]!.c)) % 4]!) ?? matOf(bf);
        s.position.y = tr.boxes[i]!.z + Math.sin(t * 4 + tr.boxes[i]!.c) * 1.5 + 5;
      }
    });
    // karts
    const seen = new Set<number>();
    for (const k of karts) {
      const o = this.kartObj(k.id, k.ch, k.ghost);
      seen.add(k.id);
      o.root.visible = o.shadow.visible = k.visible;
      o.ring.visible = k.visible && k.bubble;
      o.refl.visible = k.visible && k.reflect;
      if (!k.visible) continue;
      const hop = Math.sin(Math.min(1, k.hop / 0.14) * Math.PI) * 3;
      o.root.position.set(k.x, k.z + hop, k.y);
      const yaw = k.spin > 0 ? -k.a - t * 14 * (Math.PI / 2) : -k.a;
      o.root.rotation.set(0, yaw, 0);
      // trick: a full barrel roll; landing: squash & stretch (ease-out back to 1)
      {
        const a = k.trick > 0 ? k.trick * Math.PI * 2 : 0, kind = k.trickKind ?? 1;
        // twist: roll with a quarter turn of yaw; spin: yaw 360°; flip: pitch 360°
        o.body.rotation.set(k.lean * 0.12 + (kind === 1 ? a : 0), kind === 2 ? a : kind === 1 ? Math.sin(a) * 0.35 : 0, kind === 3 ? a : 0);
      }
      const sq = k.squash * k.squash;
      o.body.scale.set(1 + sq * 0.15, 1 - sq * 0.13, 1 + sq * 0.15);
      // cabeza MK7: mira hacia la salida del derrape + cabezazo en truco/aterrizaje
      o.headG.rotation.set(k.trick > 0 ? -0.35 * Math.sin(k.trick * Math.PI) : sq * 0.3, -k.lean * 0.3, 0);
      // ala externa: visible en planeo, despliegue 0.25 s + escora con el kart
      this.wingOf(o);
      const want = k.glide && k.visible ? 1 : 0;
      o.deploy += Math.sign(want - o.deploy) * Math.min(Math.abs(want - o.deploy), dt / 0.25);
      if (o.wingMesh) {
        o.wingMesh.visible = o.deploy > 0.02;
        const e = o.deploy * o.deploy * (3 - 2 * o.deploy);
        o.wingMesh.scale.setScalar(Math.max(0.001, e));
        o.wingMesh.rotation.x = -k.lean * 0.15;
      }
      // wheels: roll with speed, fronts yaw with steering
      o.spin += (k.speed / 1.9) * dt;
      const steerYaw = k.lean * 0.22;
      for (const wh of o.wheels) {
        wh.g.rotation.y = wh.front ? steerYaw : 0;
        wh.tire.rotation.z = -o.spin;
        wh.hub.rotation.z = -o.spin;
      }
      // legibility: far rivals are drawn bigger (visual only) so they keep ≥ ~12 px on screen
      const depth = Math.hypot(k.x - cam.x, k.y - cam.y), farK = k.local ? 1 : Math.max(1, Math.min(1.6, depth / 300));
      const baseScale = CHARS[k.ch]?.visualScale ?? 1;
      o.root.scale.setScalar(baseScale * (k.big ? 2 : 1) * farK);
      const sw = k.big ? 2 : 1;
      o.shadow.position.set(k.x, k.ground + 0.25, k.y);
      const sh = k.air ? 0.6 : 0.86;
      o.shadow.scale.set(6.5 * sw * sh, 4.2 * sw * sh, 1);
      o.shadow.rotation.set(-Math.PI / 2, 0, -k.a);
      o.ring.position.set(k.x, k.z + hop, k.y);
      o.refl.position.set(k.x, k.z + hop, k.y);
    }
    for (const [id, o] of this.kartObjs) if (!seen.has(id)) { o.root.visible = o.shadow.visible = o.ring.visible = o.refl.visible = false; }
    // transient things
    this.thingUsed = 0;
    this.shroomUsed = 0;
    this.shotUsed = 0;
    if (!this.shotGeoTried) {
      this.shotGeoTried = true;
      try { this.shotGeo = buildShot(); } catch { this.shotGeo = null; } // fallback: sprite SHOT
    }
    for (const th of things) {
      if (th.mesh === 'shroom' && this.shroomGeo) {
        let m = this.shroomPool[this.shroomUsed];
        if (!m) { m = new THREE.Mesh(this.shroomGeo, this.kartMat); m.castShadow = true; this.scene.add(m); this.shroomPool[this.shroomUsed] = m; }
        m.visible = true;
        m.position.set(th.x, th.z, th.y);
        m.scale.setScalar(th.w / 8);
        this.shroomUsed++;
        continue;
      }
      if (th.mesh === 'shot' && this.shotGeo) {
        let m = this.shotPool[this.shotUsed];
        if (!m) { m = new THREE.Mesh(this.shotGeo, this.kartMat); m.castShadow = true; this.scene.add(m); this.shotPool[this.shotUsed] = m; }
        m.visible = true;
        m.position.set(th.x, th.z, th.y);
        m.scale.setScalar(th.w / 5);
        m.rotation.y = t * 9 + th.x; // peonza: gira en vuelo
        this.shotUsed++;
        continue;
      }
      const o = this.thing(th.spr, th.flat);
      o.position.set(th.x, th.z, th.y);
      o.scale.set(th.w, th.h, 1);
      if (th.flat) o.rotation.set(-Math.PI / 2, 0, th.yaw ?? 0);
    }
    for (let i = this.thingUsed; i < this.thingPool.length; i++) this.thingPool[i]!.visible = false;
    for (let i = this.shroomUsed; i < this.shroomPool.length; i++) this.shroomPool[i]!.visible = false;
    for (let i = this.shotUsed; i < this.shotPool.length; i++) this.shotPool[i]!.visible = false;
    this.particles.update(dt, this.camera);
  }

  /** Project a world point (legacy x,y,z) to internal pixel coords; null if behind the camera. */
  project(x: number, y: number, z: number): { sx: number; sy: number; k: number } | null {
    const v = new THREE.Vector3(x, z, y);
    const rel = v.clone().sub(this.camera.position);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const depth = rel.dot(fwd);
    if (depth < 4) return null;
    v.project(this.camera);
    return { sx: (v.x * 0.5 + 0.5) * RW, sy: (-v.y * 0.5 + 0.5) * RH, k: F / depth };
  }

  /** Draw calls of the last frame (perf overlay). */
  get drawCalls(): number { return (this.renderer.info as any).render?.drawCalls ?? (this.renderer.info as any).render?.calls ?? 0; }

  groundAt(x: number, y: number) {
    return this.track ? hAt(this.track, x, y) : 0;
  }
}

/** Open cylinder (inside faces) whose u coordinate is a function of world heading θ. */
function cylinder(r: number, y0: number, y1: number, seg: number, uOf: (theta: number) => number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    // world heading θ → direction (cos θ, sin θ) in legacy (x,y) → three (x, z)
    const x = Math.cos(th) * r, z = Math.sin(th) * r, u = uOf(th);
    pos.push(x, y0, z, x, y1, z);
    uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function disposeDeep(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !(c instanceof THREE.Sprite)) m.geometry.dispose();
  });
}

/** Night grade (ART_BIBLE §3): cold, darker, a bit more contrast so lit things pop. */
const NIGHT_GRADE: Grade = { tint: [0.55, 0.62, 0.95], saturation: 0.85, contrast: 1.1, lift: -0.04 };

export const fogColor = (tr: Track) => hexRGB(tr.th.fog);

