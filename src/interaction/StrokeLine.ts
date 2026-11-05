import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  Mesh,
  OrthographicCamera,
  type PerspectiveCamera,
  RawShaderMaterial,
  Scene,
  Sphere,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { Terrain } from '../scene/terrain';
import { smoothstep } from '../scene/noise';
import type { StrokePoint } from './stroke';

const MAX_VERTS = 12000;
/** Half-width of the ribbon in CSS px, including room for the soft shadow around the line. */
const HALF_WIDTH = 2.6;
/** Seconds for a released line to dissolve. */
export const FADE = 1.25;

export interface InkLine {
  points: readonly StrokePoint[];
  /** Seconds since release, or negative while still being drawn. */
  fading: number;
}

/**
 * The drawn line: a pencil-thin ivory ribbon, tapered at both ends, drawn on the
 * finished frame. It lives in WebGL so that captures and recordings include it.
 */
export class StrokeLine {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly positions = new Float32Array(MAX_VERTS * 2);
  private readonly attrs = new Float32Array(MAX_VERTS * 3);
  private readonly geometry = new BufferGeometry();
  private readonly material: RawShaderMaterial;
  private readonly world = new Vector3();

  constructor() {
    const pos = new BufferAttribute(this.positions, 2);
    pos.setUsage(DynamicDrawUsage);
    const at = new BufferAttribute(this.attrs, 3);
    at.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pos);
    this.geometry.setAttribute('aInk', at);
    this.geometry.setDrawRange(0, 0);
    // positions are 2D clip coordinates; never let three try to measure them
    this.geometry.boundingSphere = new Sphere(new Vector3(), 10);
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      vertexShader: /* glsl */ `
        in vec2 position;
        in vec3 aInk; // across, alpha, along
        out vec3 vInk;
        void main() { vInk = aInk; gl_Position = vec4(position, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec3 vInk;
        out vec4 outColor;
        float hash(float x) { return fract(sin(x * 91.17) * 43758.5453); }
        void main() {
          float d = abs(vInk.x) * ${HALF_WIDTH.toFixed(2)};
          float i = floor(vInk.z);
          float grain = mix(hash(i), hash(i + 1.0), fract(vInk.z));
          float core = 1.0 - smoothstep(0.32, 0.82, d);
          float shadow = (1.0 - smoothstep(0.5, ${HALF_WIDTH.toFixed(2)}, d)) * 0.16;
          float a = core * (0.82 + 0.18 * grain);
          vec3 ink = mix(vec3(0.16, 0.24, 0.16), vec3(0.992, 0.976, 0.91), a / max(a + shadow * (1.0 - a), 1e-3));
          outColor = vec4(ink, (a + shadow * (1.0 - a)) * vInk.y);
        }`,
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Rebuild the ribbon from world-space lines, projected for the current camera. */
  update(lines: readonly InkLine[], camera: PerspectiveCamera, terrain: Terrain, cssW: number, cssH: number): void {
    const { positions, attrs, world } = this;
    let v = 0;
    const hx = (HALF_WIDTH * 2) / cssW;
    const hy = (HALF_WIDTH * 2) / cssH;
    const aspect = cssW / cssH;
    const ndc: number[] = [];
    for (const line of lines) {
      const pts = line.points;
      const n = pts.length;
      if (n < 2) continue;
      if (v + n * 2 + 4 > MAX_VERTS) break;
      ndc.length = 0;
      for (let i = 0; i < n; i++) {
        world.set(pts[i].x, terrain.height(pts[i].x, pts[i].z), pts[i].z).project(camera);
        ndc.push(world.x, world.y);
      }
      const total = (n - 1) * 0.32;
      const fadeT = line.fading < 0 ? 0 : line.fading / FADE;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        let dx = (ndc[b * 2] - ndc[a * 2]) * aspect;
        let dy = ndc[b * 2 + 1] - ndc[a * 2 + 1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const s = i * 0.32;
        // pencil taper at both ends; while drawing, the live end stays sharp
        const taper = smoothstep(0, 1.6, s) * (line.fading < 0 ? 1 : smoothstep(0, 1.6, total - s));
        // it rubs out from the start of the stroke toward its end
        const rub = line.fading < 0 ? 1 : 1 - smoothstep(0, 0.55, fadeT * 1.45 - (s / Math.max(total, 1)) * 0.9);
        const w = 0.55 + 0.45 * taper;
        const px = -dy * w * hx;
        const py = dx * w * hy;
        const k = v * 2;
        positions[k] = ndc[i * 2] + px;
        positions[k + 1] = ndc[i * 2 + 1] + py;
        positions[k + 2] = ndc[i * 2] - px;
        positions[k + 3] = ndc[i * 2 + 1] - py;
        const alpha = taper * rub;
        const m = v * 3;
        attrs[m] = 1;
        attrs[m + 1] = alpha;
        attrs[m + 2] = s * 2.4;
        attrs[m + 3] = -1;
        attrs[m + 4] = alpha;
        attrs[m + 5] = s * 2.4;
        v += 2;
      }
      // degenerate seam between lines: zero alpha at the join
      if (v > 0) {
        for (let r = 0; r < 2; r++) {
          positions[v * 2] = positions[(v - 2) * 2];
          positions[v * 2 + 1] = positions[(v - 2) * 2 + 1];
          attrs[v * 3 + 1] = 0;
          v++;
        }
      }
    }
    // triangle strip by index, rebuilt as needed
    this.setStrip(v);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aInk').needsUpdate = true;
  }

  private indexCapacity = 0;
  private setStrip(verts: number): void {
    const quads = Math.max(0, Math.floor(verts / 2) - 1);
    if (quads * 6 > this.indexCapacity) {
      const cap = Math.ceil(MAX_VERTS / 2) * 6;
      const idx = new Uint32Array(cap);
      for (let q = 0; q < cap / 6 - 1; q++) {
        const a = q * 2;
        idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6);
      }
      this.geometry.setIndex(new BufferAttribute(idx, 1));
      this.indexCapacity = cap;
    }
    this.geometry.setDrawRange(0, quads * 6);
  }

  render(renderer: WebGLRenderer): void {
    if (this.geometry.drawRange.count === 0) return;
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
