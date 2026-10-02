// Post-processing chain in TSL (docs/ART_BIBLE.md §5): soft bloom on the brightest pixels, per-track
// color grading, vignette and screen flash. Works on the WebGPU backend and on Three's WebGL2 fallback.
import * as THREE from 'three/webgpu';
import { clamp as tclamp, dot, float, length, mix, pass, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface Grade { tint: [number, number, number]; saturation: number; contrast: number; lift: number }

export class Post {
  pipeline: THREE.RenderPipeline;
  enabled = true;
  private uTint = uniform(new THREE.Vector3(1, 1, 1));
  private uSat = uniform(1.08);
  private uContrast = uniform(1.04);
  private uLift = uniform(0);
  private uVig = uniform(0.35);
  private uFlash = uniform(new THREE.Vector4(1, 1, 1, 0));
  private bloomNode: ReturnType<typeof bloom>;

  constructor(private renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    this.bloomNode = bloom(color, 0.18, 0.25, 0.93);
    let c = color.rgb.add(this.bloomNode.rgb);
    // grading: tint, saturation, contrast, lift
    const luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, this.uSat);
    c = c.sub(0.5).mul(this.uContrast).add(0.5).add(this.uLift);
    c = c.mul(this.uTint);
    // vignette
    const d = length(uv().sub(vec2(0.5, 0.5)).mul(vec2(1.25, 1)));
    c = c.mul(float(1).sub(smoothstep(0.45, 0.95, d).mul(this.uVig)));
    // screen flash (items, explosions)
    c = mix(c, this.uFlash.rgb, this.uFlash.a);
    this.pipeline.outputNode = vec4(tclamp(c, 0, 1), 1);
  }

  setGrade(g: Grade) {
    this.uTint.value.set(...g.tint);
    this.uSat.value = g.saturation;
    this.uContrast.value = g.contrast;
    this.uLift.value = g.lift;
  }
  setBloom(strength: number) { this.bloomNode.strength.value = strength; }
  setVignette(v: number) { this.uVig.value = v; }
  setFlash(r: number, g: number, b: number, a: number) { this.uFlash.value.set(r, g, b, a); }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.enabled) this.pipeline.render();
    else this.renderer.render(scene, camera);
  }
}

/** Grading per theme style (ART_BIBLE §3: one LUT-like setting per biome). */
export const GRADES: Record<string, Grade> = {
  grass: { tint: [1.0, 1.0, 0.98], saturation: 1.1, contrast: 1.04, lift: 0 },
  sand: { tint: [1.03, 1.0, 0.95], saturation: 1.1, contrast: 1.05, lift: 0.005 },
  dunes: { tint: [1.06, 0.98, 0.9], saturation: 1.08, contrast: 1.06, lift: 0 },
  snow: { tint: [0.95, 0.99, 1.06], saturation: 0.98, contrast: 1.05, lift: 0.01 },
  grid: { tint: [0.96, 0.94, 1.08], saturation: 1.2, contrast: 1.1, lift: -0.01 },
  rock: { tint: [1.08, 0.95, 0.9], saturation: 1.12, contrast: 1.08, lift: -0.01 },
  clay: { tint: [1.02, 1.0, 0.97], saturation: 1.08, contrast: 1.04, lift: 0 },
};
