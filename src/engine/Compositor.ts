import {
  DataTexture,
  GLSL3,
  HalfFloatType,
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
import { GLASS_GLSL } from './glass';

const SAMPLES = 4;
/** Frost radius (CSS px), milky rim, smoky tint, face haze: the portfolio hero's glass. */
export const DEFAULT_GLASS_LOOK = [30, 0.42, 0.55, 0.22] as const;
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

  constructor(linear = false) {
    // linear light needs more precision than 8 bits in the deep valleys
    this.target = new WebGLRenderTarget(4, 4, {
      type: linear ? HalfFloatType : UnsignedByteType,
      samples: SAMPLES,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: { uScene: { value: this.target.texture }, uPixel: { value: [1 / 4, 1 / 4] }, uDpr: { value: 1 }, uPaper: { value: makePaper() }, uMat: { value: 0 }, uSize: { value: [4, 4] }, uLift: { value: 1 }, uGrain: { value: 1 }, uSat: { value: 1 }, uSoft: { value: 1 }, uExposure: { value: 0 }, uGlass: { value: [0, 0, 0, 0] }, uGlassShape: { value: [0, 0, 0, 0] }, uGlassPtr: { value: [0, 0, 0, 0] }, uGlassLook: { value: [...DEFAULT_GLASS_LOOK] }, uVignette: { value: 1 } },
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
        uniform float uLift;
        uniform float uGrain;
        uniform float uSat;
        uniform float uSoft;
        uniform float uExposure; // 0: the scene is already display colour; above 0: linear light, filmic tonemap
        uniform float uVignette; // 1: the faint corner falloff; 0: none
        vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        ${GLASS_GLSL}
        // the faintest softening: fibres should feel soft, never crunchy
        vec3 sceneAt(vec2 uv) {
          vec2 px = uPixel * max(uDpr * 0.6, 0.75);
          vec3 c = texture(uScene, uv).rgb * (1.0 - 0.4 * uSoft);
          c += texture(uScene, uv + px * vec2(0.7, 0.4)).rgb * 0.2 * uSoft;
          c += texture(uScene, uv - px * vec2(0.7, 0.4)).rgb * 0.2 * uSoft;
          return c;
        }
        void main() {
          // glass: inside the panel, the land is seen through a thick lens (see glass.ts)
          GlassHit glass = glassHit(gl_FragCoord.xy);
          vec3 c = glass.inside > 0.0 ? glassScene(glass) : sceneAt(vUv);

          if (uExposure > 0.0) c = pow(aces(c * uExposure), vec3(1.0 / 2.2));
          vec2 frag = gl_FragCoord.xy / uDpr;
          // stationary paper: tooth at two scales and slow pigment mottling
          float tooth = texture(uPaper, frag * 0.0041).r;
          float mottle = texture(uPaper, frag * 0.000173 + 0.37).g * 0.6 + texture(uPaper, frag * 0.000061).g * 0.4;
          c *= 1.0 + (tooth - 0.5) * 0.045 * uGrain;
          c *= 1.0 + (mottle - 0.5) * 0.05 * uGrain;
          // lift the darkest values a touch toward warm paper: gouache has no true black
          c = mix(vec3(0.075, 0.09, 0.07) * uLift, vec3(1.0), c);
          float lum = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(vec3(lum), c, uSat);
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * 0.11 * uVignette;
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
          c = glassFinish(c, glass, gl_FragCoord.xy);
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

  /** Finish: black lift, paper grain, saturation and softening, each 1 = the painted default. */
  setFinish(f: { lift: number; grain: number; saturation: number; soften: number; exposure?: number }): void {
    const u = this.material.uniforms;
    u.uExposure.value = f.exposure ?? 0;
    u.uLift.value = f.lift;
    u.uGrain.value = f.grain;
    u.uSat.value = f.saturation;
    u.uSoft.value = f.soften;
  }

  /**
   * The glass panel, in device pixels from the canvas's top left, or null for none.
   * radius, bevel and thickness are device pixels too.
   */
  setGlass(g: { x: number; y: number; width: number; height: number; radius: number; bevel: number; thickness: number } | null): void {
    const u = this.material.uniforms;
    if (!g) {
      u.uGlassShape.value = [0, 0, 0, 0];
      return;
    }
    const h = u.uSize.value[1] as number;
    // the shader works y-up, from the canvas's bottom left
    u.uGlass.value = [g.x + g.width / 2, h - (g.y + g.height / 2), g.width / 2, g.height / 2];
    u.uGlassShape.value = [g.radius, g.bevel, g.thickness, 1];
  }

  /** How the glass looks: frost radius in CSS px, milky rim, smoky tint and face haze (see DEFAULT_GLASS_LOOK). */
  setGlassLook(look: readonly [number, number, number, number]): void {
    this.material.uniforms.uGlassLook.value = [...look];
  }

  /** 0 turns off the faint corner falloff, for a photographic plate that must stay as it is. */
  setVignette(amount: number): void {
    this.material.uniforms.uVignette.value = amount;
  }

  /** Pointer over the glass, in device pixels from the top left, and how present it is (0..1). */
  setGlassPointer(x: number, y: number, presence: number): void {
    const h = this.material.uniforms.uSize.value[1] as number;
    this.material.uniforms.uGlassPtr.value = [x, h - y, presence, 0];
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
