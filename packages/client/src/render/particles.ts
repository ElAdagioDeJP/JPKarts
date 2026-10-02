// 3D pixel particles (ART_BIBLE §6): a fixed pool of camera-facing quads in one InstancedMesh.
// Never allocates per frame; dead particles are recycled.
import * as THREE from 'three/webgpu';

const MAX = 1024;

interface P { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; g: number; life: number; max: number; size: number; r: number; gr: number; b: number }

export class Particles {
  mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  cap = MAX;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < MAX; i++) {
      this.ps.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0, max: 1, size: 1, r: 1, gr: 1, b: 1 });
      this.mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
    }
    scene.add(this.mesh);
  }

  /** Emit one particle. World coords use the legacy layout: (x, y) ground plane, z height. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, gravity = 0) {
    const p = this.ps[this.next]!;
    this.next = (this.next + 1) % this.cap;
    p.alive = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.g = gravity;
    p.life = life; p.max = life; p.size = size;
    this.c.set(color);
    p.r = this.c.r; p.gr = this.c.g; p.b = this.c.b;
  }

  burst(x: number, y: number, z: number, n: number, speed: number, life: number, size: number, colors: string[], gravity = 0, rand: () => number = Math.random) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, u = rand() * 0.8 + 0.2;
      this.emit(x, y, z, Math.cos(a) * speed * u, Math.sin(a) * speed * u, speed * (0.3 + rand() * 0.7), life * (0.6 + rand() * 0.4), size, colors[(rand() * colors.length) | 0]!, gravity);
    }
  }

  update(dt: number, camera: THREE.Camera) {
    camera.getWorldQuaternion(this.q);
    let n = 0;
    for (const p of this.ps) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vz -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = Math.max(0.35, p.life / p.max), sz = p.size * k;
      this.m.compose(this.p.set(p.x, p.z, p.y), this.q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.setRGB(p.r, p.gr, p.b));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { for (const p of this.ps) p.alive = false; this.mesh.count = 0; }
}
