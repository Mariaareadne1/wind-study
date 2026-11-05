import {
  DataTexture,
  GLSL3,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { makeNoise } from '../scene/noise';

const SAMPLES = 4;
const PAPER_SIZE = 256;

/** A small tiling sheet of paper: fine tooth in red, soft mottling in green. Baked once. */
function makePaper(): DataTexture {
  const noise = makeNoise(9101);
  const data = new Uint8Array(PAPER_SIZE * PAPER_SIZE * 4);
  // tile by sampling the torus of the noise lattice: 256 is its own period
  const f1 = 64 / PAPER_SIZE;
  const f2 = 21 / PAPER_SIZE;
  const f3 = 7 / PAPER_SIZE;
  const f4 = 3 / PAPER_SIZE;
  for (let y = 0; y < PAPER_SIZE; y++) {
    for (let x = 0; x < PAPER_SIZE; x++) {
      const tooth = noise(x * 0.5 * f1 * 8, y * 0.5 * f1 * 8) * 0.6 + noise(x * f2, y * f2) * 0.4;
      const mottle = noise(x * f3, y * f3) * 0.6 + noise(x * f4, y * f4) * 0.4;
      const i = (x + y * PAPER_SIZE) * 4;
      data[i] = Math.min(255, Math.max(0, (tooth + 0.5) * 255));
      data[i + 1] = Math.min(255, Math.max(0, (mottle + 0.5) * 255));
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, PAPER_SIZE, PAPER_SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Renders the meadow into a multisampled target (alpha-to-coverage needs it) and
 * lays it on the page with a restrained paper finish: grain that stays put while
 * the grass moves beneath it, a trace of softness, and a faint warm falloff.
 */
export class Compositor {
  readonly target: WebGLRenderTarget;
  private readonly material: RawShaderMaterial;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);

  constructor() {
    this.target = new WebGLRenderTarget(4, 4, {
      type: UnsignedByteType,
      samples: SAMPLES,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: { uScene: { value: this.target.texture }, uPixel: { value: [1 / 4, 1 / 4] }, uDpr: { value: 1 }, uPaper: { value: makePaper() }, uMat: { value: 0 }, uSize: { value: [4, 4] } },
      vertexShader: /* glsl */ `
        in vec3 position;
        out vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv;
        out vec4 outColor;
        uniform sampler2D uScene;
        uniform vec2 uPixel;
        uniform float uDpr;
        uniform sampler2D uPaper;
        uniform float uMat; // border width in device px; 0 is full bleed
        uniform vec2 uSize;
        void main() {
          // the faintest softening: fibres should feel soft, never crunchy
          vec2 px = uPixel * max(uDpr * 0.6, 0.75);
          vec3 c = texture(uScene, vUv).rgb * 0.6;
          c += texture(uScene, vUv + px * vec2(0.7, 0.4)).rgb * 0.2;
          c += texture(uScene, vUv - px * vec2(0.7, 0.4)).rgb * 0.2;

          vec2 frag = gl_FragCoord.xy / uDpr;
          // stationary paper: tooth at two scales and slow pigment mottling
          float tooth = texture(uPaper, frag * 0.0041).r;
          float mottle = texture(uPaper, frag * 0.000173 + 0.37).g * 0.6 + texture(uPaper, frag * 0.000061).g * 0.4;
          c *= 1.0 + (tooth - 0.5) * 0.045;
          c *= 1.0 + (mottle - 0.5) * 0.05;
          // lift the darkest values a touch toward warm paper: gouache has no true black
          c = mix(vec3(0.075, 0.09, 0.07), vec3(1.0), c);
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * 0.11;
          if (uMat > 0.0) {
            // a loaded brush stopping short of the paper's edge: slow wander plus dry, feathered bristle
            vec2 p = gl_FragCoord.xy;
            vec2 d = min(p, uSize - p);
            float edge = min(d.x, d.y);
            float along = d.x < d.y ? p.y : p.x;
            // sampled off-axis and at unrelated scales, so the edge never settles into a repeating wave
            float wander = texture(uPaper, vec2(along * 0.00023, along * 0.00011 + 0.21) / uDpr).g - 0.5;
            float drag = texture(uPaper, vec2(along * 0.0013, along * 0.0007 + 0.63) / uDpr).r - 0.5;
            float bristle = texture(uPaper, vec2(along * 0.0093, edge * 0.021 + 0.4) / uDpr).r - 0.5;
            float reach = uMat * (1.0 + wander * 0.22) + (drag * 5.0 + bristle * 7.0) * uDpr;
            float paint = smoothstep(reach - 1.6 * uDpr, reach + 1.6 * uDpr, edge);
            // pigment pools faintly where the brush stopped
            c *= 1.0 - 0.07 * (1.0 - smoothstep(reach, reach + 9.0 * uDpr, edge));
            vec3 paper = vec3(0.957, 0.937, 0.87) * (1.0 + (tooth - 0.5) * 0.05);
            c = mix(paper, c, paint);
          }
          c += (tooth - 0.5) * 1.5 / 255.0;
          outColor = vec4(c, 1.0);
        }`,
    });
    const quad = new Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(width: number, height: number, dpr: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.uPixel.value = [1 / width, 1 / height];
    this.material.uniforms.uDpr.value = dpr;
    this.material.uniforms.uSize.value = [width, height];
  }

  /** Painted border width in device px; 0 for full bleed. */
  setMat(devicePx: number): void {
    this.material.uniforms.uMat.value = devicePx;
  }

  present(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.uniforms.uPaper.value.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
