import {
  GLSL3,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

const SAMPLES = 4;

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
      uniforms: { uScene: { value: this.target.texture }, uPixel: { value: [1 / 4, 1 / 4] }, uDpr: { value: 1 } },
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
        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          // the faintest softening: fibres should feel soft, never crunchy
          vec2 px = uPixel * max(uDpr * 0.6, 0.75);
          vec3 c = texture(uScene, vUv).rgb * 0.56;
          c += texture(uScene, vUv + vec2(px.x, 0.0)).rgb * 0.11;
          c += texture(uScene, vUv - vec2(px.x, 0.0)).rgb * 0.11;
          c += texture(uScene, vUv + vec2(0.0, px.y)).rgb * 0.11;
          c += texture(uScene, vUv - vec2(0.0, px.y)).rgb * 0.11;

          vec2 frag = gl_FragCoord.xy / uDpr;
          // stationary paper: tooth at two scales and slow pigment mottling
          float tooth = vnoise(frag * 0.9) * 0.6 + vnoise(frag * 0.31) * 0.4;
          float mottle = vnoise(frag * 0.012) * 0.6 + vnoise(frag * 0.037) * 0.4;
          c *= 1.0 + (tooth - 0.5) * 0.045;
          c *= 1.0 + (mottle - 0.5) * 0.05;
          // lift the darkest values a touch toward warm paper: gouache has no true black
          c = mix(vec3(0.075, 0.09, 0.07), vec3(1.0), c);
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * 0.11;
          c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
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
  }

  present(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
