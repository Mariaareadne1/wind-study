import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  type Texture,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { NX, NZ } from './grid';
import type { WindSim } from './WindSim';

const UPSCALE = 2;

const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** C² cubic B-spline: no visible cell boundaries however strong the gradient. */
const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform highp sampler2D uA;
uniform highp sampler2D uB;
uniform float uAlpha;
vec4 spline(highp sampler2D tex, vec2 uv) {
  ivec2 size = textureSize(tex, 0);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec4 sum = vec4(0.0);
  ivec2 base = ivec2(i);
  ivec2 hi = size - ivec2(1);
  for (int y = 0; y < 4; y++) {
    float wy = y == 0 ? w0.y : y == 1 ? w1.y : y == 2 ? w2.y : w3.y;
    for (int x = 0; x < 4; x++) {
      float wx = x == 0 ? w0.x : x == 1 ? w1.x : x == 2 ? w2.x : w3.x;
      sum += wx * wy * texelFetch(tex, clamp(base + ivec2(x - 1, y - 1), ivec2(0), hi), 0);
    }
  }
  return sum;
}
void main() {
  outColor = mix(spline(uA, vUv), spline(uB, vUv), uAlpha);
}`;

function makeRaw(): DataTexture {
  const t = new DataTexture(new Float32Array(NX * NZ * 4), NX, NZ, RGBAFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function makeTarget(): WebGLRenderTarget {
  return new WebGLRenderTarget(NX * UPSCALE, NZ * UPSCALE, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

/**
 * Carries the CPU grid to the GPU. The raw float textures are read with an
 * explicit cubic B-spline into half-float targets, blended between the last two
 * fixed steps, so the vertex shader gets a smooth field at any frame rate using
 * nothing but a cheap hardware-filtered fetch.
 */
export class WindTextures {
  private readonly bendRaw = [makeRaw(), makeRaw()];
  private readonly flowRaw = [makeRaw(), makeRaw()];
  private current = 0;
  private readonly bendTarget = makeTarget();
  private readonly flowTarget = makeTarget();
  private readonly material: RawShaderMaterial;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);

  constructor() {
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uA: { value: null }, uB: { value: null }, uAlpha: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get bend(): Texture {
    return this.bendTarget.texture;
  }

  get flow(): Texture {
    return this.flowTarget.texture;
  }

  /** Copy this step's state into the next raw pair and upload it. */
  ingest(sim: WindSim): void {
    this.current = 1 - this.current;
    const bendTex = this.bendRaw[this.current];
    const flowTex = this.flowRaw[this.current];
    (bendTex.image.data as Float32Array).set(sim.response.bend);
    const flow = flowTex.image.data as Float32Array;
    const { energy } = sim.response;
    const { totalU, totalV } = sim;
    for (let a = 0; a < energy.length; a++) {
      const b = a * 4;
      flow[b] = energy[a];
      flow[b + 1] = totalU[a];
      flow[b + 2] = totalV[a];
    }
    bendTex.needsUpdate = true;
    flowTex.needsUpdate = true;
  }

  /** Resample at the current interpolation alpha. */
  render(renderer: WebGLRenderer, alpha: number): void {
    const u = this.material.uniforms;
    const prev = 1 - this.current;
    u.uAlpha.value = alpha;
    u.uA.value = this.bendRaw[prev];
    u.uB.value = this.bendRaw[this.current];
    renderer.setRenderTarget(this.bendTarget);
    renderer.render(this.scene, this.camera);
    u.uA.value = this.flowRaw[prev];
    u.uB.value = this.flowRaw[this.current];
    renderer.setRenderTarget(this.flowTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
  }

  dispose(): void {
    for (const t of [...this.bendRaw, ...this.flowRaw]) t.dispose();
    this.bendTarget.dispose();
    this.flowTarget.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
