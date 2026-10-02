// Three.js (WebGPU) world renderer. Draws the state it receives; owns no game logic.
import * as THREE from 'three/webgpu';
import { CHARS, HM, TS, type Track, hAt } from '@jpkart/core';
import { OUT, hexRGB, shade, type Spr } from '../art/pixel';
import { BALLS, D, ICONS, PUDDLE, RING, SHOT, TARS, voxelKart } from '../art/sprites';
import { F, buildGroundTexture, buildScenery, buildSkyGradient, buildSkyStrip, type SceneryItem } from './trackArt';

export const RW = 640, RH = 360; // internal world resolution (16:9)
export const H0 = RH / 2 - 40; // default horizon row (legacy: 40 px above center)
export const FOG_NEAR = 420, FOG_FAR = 1000;
export const KART_VOXEL = 0.7; // world units per voxel: on screen it matches the legacy 12.5-unit sprite seen from CAM_BACK

export interface CamView { x: number; y: number; z: number; a: number; hz: number }
export interface KartView {
  id: number; ch: number; x: number; y: number; z: number; a: number; lean: number;
  hop: number; spin: number; big: boolean; bubble: boolean; visible: boolean; ground: number; air: boolean;
}
export interface ThingView { kind: 'box' | 'fake' | 'tar' | 'shot' | 'dron' | 'hole'; x: number; y: number; z: number; f: number }

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
function voxelGeometry(ch: number): THREE.BufferGeometry {
  const V = voxelKart(CHARS[ch]!);
  const occ = new Set(V.map((v) => v[0] + ',' + v[1] + ',' + v[2]));
  const pos: number[] = [], colr: number[] = [], idx: number[] = [];
  const S = KART_VOXEL, c = new THREE.Color();
  // faces in voxel space (x right, y forward, z up)
  const FACES: { n: [number, number, number]; k: number; q: [number, number, number][] }[] = [
    { n: [0, 0, 1], k: 1.15, q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
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

interface KartObj { root: THREE.Group; body: THREE.Group; shadow: THREE.Mesh; ring: THREE.Sprite }

export class WorldRenderer {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, RW / RH, 0.5, FOG_FAR + 150);
  backend = '';
  private track: Track | null = null;
  private trackGroup = new THREE.Group();
  private skyGroup = new THREE.Group();
  private kartObjs = new Map<number, KartObj>();
  private kartGeo = new Map<number, THREE.BufferGeometry>();
  private kartMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private outlineMat = new THREE.MeshBasicMaterial({ color: OUT, side: THREE.BackSide });
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  private thingPool: THREE.Object3D[] = [];
  private thingUsed = 0;
  private boxSprites: THREE.Sprite[] = [];

  async init(canvas: HTMLCanvasElement, forceWebGL = false) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
    await this.renderer.init();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RW, RH, false);
    this.backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.scene.add(this.skyGroup, this.trackGroup);
    this.camera.rotation.order = 'YXZ';
  }

  /** Rebuild every track-dependent object. */
  setTrack(tr: Track) {
    if (this.track === tr) return;
    this.track = tr;
    for (const o of [...this.trackGroup.children]) { this.trackGroup.remove(o); disposeDeep(o); }
    for (const o of [...this.skyGroup.children]) { this.skyGroup.remove(o); disposeDeep(o); }
    this.boxSprites = [];
    const fog = new THREE.Color(tr.th.fog);
    this.scene.background = fog;
    this.scene.fog = new THREE.Fog(fog, FOG_NEAR, FOG_FAR);
    this.buildTerrain(tr);
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
    const tex = new THREE.DataTexture(data, TS, TS, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const n = HM, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
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
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
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
    const outer = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ map: ct }));
    outer.position.set(TS / 2, edge / cnt - 2, TS / 2);
    this.trackGroup.add(outer);
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

  private buildSceneryObjs(list: SceneryItem[]) {
    for (const d of list) {
      const s = D[d.k]!;
      const sp = new THREE.Sprite(matOf(s));
      sp.center.set(0.5, 0);
      sp.scale.set((s.w * d.h) / s.h, d.h, 1);
      sp.position.set(d.x, d.z, d.y);
      this.trackGroup.add(sp);
      if (d.h >= 30 && !d.arch) {
        const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 12), this.shadowMat);
        sh.rotation.x = -Math.PI / 2;
        sh.scale.set(((s.w * d.h) / s.h) * 0.35, 3, 1);
        sh.position.set(d.x, d.z + 0.3, d.y);
        this.trackGroup.add(sh);
      }
    }
  }

  private kartObj(id: number, ch: number): KartObj {
    let o = this.kartObjs.get(id);
    if (o) return o;
    let g = this.kartGeo.get(ch);
    if (!g) { g = voxelGeometry(ch); this.kartGeo.set(ch, g); }
    const root = new THREE.Group(), body = new THREE.Group();
    const mesh = new THREE.Mesh(g, this.kartMat);
    const outline = new THREE.Mesh(g, this.outlineMat);
    outline.scale.setScalar(1.07);
    outline.position.y = -0.35;
    body.add(outline, mesh);
    root.add(body);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    const ring = new THREE.Sprite(matOf(RING));
    ring.center.set(0.5, 0.25);
    ring.scale.set(17, 17, 1);
    this.scene.add(root, shadow, ring);
    o = { root, body, shadow, ring };
    this.kartObjs.set(id, o);
    return o;
  }

  clearKarts() {
    for (const o of this.kartObjs.values()) this.scene.remove(o.root, o.shadow, o.ring);
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

  render(cam: CamView, karts: KartView[], things: ThingView[], boxesActive: boolean[], t: number) {
    const tr = this.track;
    if (!tr) return;
    // camera: level, yaw = cam.a, principal point at (RW/2, hz) — legacy voxel projection
    const c = this.camera;
    const halfH = Math.max(cam.hz, RH - cam.hz) + 1;
    c.fov = (2 * Math.atan(halfH / F) * 180) / Math.PI;
    c.aspect = RW / (halfH * 2);
    c.setViewOffset(RW, halfH * 2, 0, halfH - cam.hz, RW, RH);
    c.position.set(cam.x, cam.z, cam.y);
    c.rotation.set(0, -cam.a - Math.PI / 2, 0);
    c.updateProjectionMatrix();
    this.skyGroup.position.set(cam.x, cam.z, cam.y);
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
      const o = this.kartObj(k.id, k.ch);
      seen.add(k.id);
      o.root.visible = o.shadow.visible = k.visible;
      o.ring.visible = k.visible && k.bubble;
      if (!k.visible) continue;
      const hop = Math.sin(Math.min(1, k.hop / 0.14) * Math.PI) * 3;
      o.root.position.set(k.x, k.z + hop, k.y);
      const yaw = k.spin > 0 ? -k.a - t * 14 * (Math.PI / 2) : -k.a;
      o.root.rotation.set(0, yaw, 0);
      o.body.rotation.set(k.lean * 0.12, 0, 0);
      o.root.scale.setScalar(k.big ? 2 : 1);
      const sw = k.big ? 2 : 1;
      o.shadow.position.set(k.x, k.ground + 0.25, k.y);
      const sh = k.air ? 0.6 : 0.86;
      o.shadow.scale.set(6.5 * sw * sh, 4.2 * sw * sh, 1);
      o.shadow.rotation.set(-Math.PI / 2, 0, -k.a);
      o.ring.position.set(k.x, k.z + hop, k.y);
    }
    for (const [id, o] of this.kartObjs) if (!seen.has(id)) { o.root.visible = o.shadow.visible = o.ring.visible = false; }
    // transient things
    this.thingUsed = 0;
    for (const th of things) {
      switch (th.kind) {
        case 'fake': { const o = this.thing(PUDDLE, true); o.position.set(th.x, th.z + 0.4, th.y); o.scale.set(16, 16 / 3, 1); break; }
        case 'tar': { const o = this.thing(TARS, true); o.position.set(th.x, th.z + 0.4, th.y); o.scale.set(54, 54 * 0.3, 1); break; }
        case 'shot': { const o = this.thing(SHOT, false); o.position.set(th.x, th.z - 3, th.y); o.scale.set(6, 6, 1); break; }
        case 'dron': { const o = this.thing(ICONS.dron!, false); o.position.set(th.x, th.z - 5, th.y); o.scale.set(11, 11, 1); break; }
        case 'hole': { const s = Math.sin(Math.min(1, th.f) * Math.PI) * 80; const o = this.thing(ICONS.agujero!, false); o.position.set(th.x, th.z - 30 + s * 0.25, th.y); o.scale.set(s, s, 1); break; }
        case 'box': break;
      }
    }
    for (let i = this.thingUsed; i < this.thingPool.length; i++) this.thingPool[i]!.visible = false;
    this.renderer.render(this.scene, this.camera);
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

export const fogColor = (tr: Track) => hexRGB(tr.th.fog);
