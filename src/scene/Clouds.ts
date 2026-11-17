import {
  BufferGeometry,
  Color,
  CustomBlending,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { buildLumps, cloudBox, domeOf, MAX_LUMPS, taperOf, type CloudSpec, type Lump } from './cloudShape';

export type { CloudSpec } from './cloudShape';

/** Light the clouds are rendered in: the same linear sun and sky as the land. */
export interface CloudLight {
  /** Direction the clouds are modelled by. */
  sun: readonly [number, number, number];
  sunColor: readonly [number, number, number];
  skyColor: readonly [number, number, number];
  /** Light thrown up off the sunlit grass onto the undersides. */
  groundColor: readonly [number, number, number];
}

/** How a scene's clouds are drawn. Defaults are the Sunlit look. */
export interface CloudStyle {
  /** Multiplies all the light on the clouds. */
  gain?: number;
  /** How quickly density rises inside the rim: lower is softer, more feathered. */
  edge?: number;
  /** Fine erosion along the rim: higher frays it into wisps. */
  fray?: number;
  /** Billows per cloud width: sizes the erosion to each cloud, rather than in world units (1.25 per unit). */
  billows?: number;
  /** Multiplies the sky and ground fill: lower keeps grey in the creases. */
  ambient?: number;
  /** Sharpness of the union between heads: higher keeps each billow distinct (the shadow bake keeps 10). */
  blend?: number;
  /** How far the slow noise warp drags the billows; high values streak them. */
  warp?: number;
}

/** Longest side of one cloud's baked image, in pixels: they are soft, so this is plenty. */
const MAX_BAKE = 1024;
/** A cloud's bake is padded around its projected box, as a fraction of its size. */
const PAD = 0.04;

const BAKE_VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Raymarched once per cloud into a texture. Density is soft masses eroded by billowing noise;
// light is Beer-Lambert toward the sun with a few scattering octaves (Wrenninge's approximation
// of multiple scattering), a forward-and-back phase, the sky from above and the grass from below.
const BAKE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform vec4 uLumps[${MAX_LUMPS}];
uniform int uCount;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec4 uRect;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uSeed;
uniform vec3 uDomeC;
uniform vec3 uDomeR;
out vec4 outColor;

float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// billows: rounded bumps, the cauliflower of a cumulus
float billow(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * (1.0 - abs(noise3(p) * 2.0 - 1.0)); p = p * 2.07 + vec3(3.1, 1.7, 5.3); a *= 0.55; }
  return s / 1.0;
}
const float SUN_GAIN = 0.7;
const float AMB_GAIN = 0.42;
uniform float uGain;
uniform float uEdge;
uniform float uFray;
uniform float uNoiseScale;
uniform float uTaper;
uniform float uAmbient;
uniform float uBlend;
uniform float uWarp;
float shape(vec3 p) {
  // a smooth union, so the masses merge into one body instead of reading as balls
  vec3 dd = p - uDomeC;
  float narrow = 1.0 - uTaper * clamp(dd.y / uDomeR.y, 0.0, 1.0);
  float sum = exp(uBlend * (1.0 - length(dd / (uDomeR * vec3(narrow, 1.0, narrow)))));
  for (int i = 0; i < ${MAX_LUMPS}; i++) {
    if (i >= uCount) break;
    vec4 l = uLumps[i];
    sum += exp(uBlend * (1.0 - length(p - l.xyz) / l.w));
  }
  float s = max(log(max(sum, 1e-6)) / uBlend, 0.0);
  float b = smoothstep(uBoxMin.y, uBoxMin.y + 0.35, p.y);
  return s * b;
}
float density(vec3 p, bool fine) {
  float s = shape(p);
  if (s <= 0.0) return 0.0;
  vec3 q = p * uNoiseScale + uSeed;
  // a slow warp, so billows sprawl and lean instead of sitting on a grid of bumps
  q += vec3(noise3(p * 0.35 + 7.0), noise3(p * 0.35 + 19.0), noise3(p * 0.35 + 31.0)) * (2.0 * uWarp) - uWarp;
  // erode the masses, harder near their rim and less on the flat base
  float hf = clamp((p.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
  // billows bite into the upper surface; the flat base is cut cleaner, and wispier
  float e = (billow(q) - 0.5) * 0.5 * mix(0.4, 1.0, smoothstep(0.0, 0.3, hf));
  if (fine) e += (billow(q * 2.6) - 0.5) * uFray;
  float d = s - e - 0.12;
  // dense body, with a thin feathered fringe where the billows thin out into air
  return clamp(d * uEdge, 0.0, 1.0) * 0.85 + smoothstep(-0.06, 0.12, d) * 0.15;
}
vec2 box(vec3 ro, vec3 rd) {
  // never exactly axis-aligned, so no 0 × inf at a face
  vec3 inv = 1.0 / (rd + vec3(1e-7) * step(abs(rd), vec3(1e-7)));
  vec3 a = (uBoxMin - ro) * inv, b = (uBoxMax - ro) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

void main() {
  vec2 ndc = mix(uRect.xy, uRect.zw, vUv);
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 rd = normalize(far.xyz / far.w - uCamPos);
  vec2 t = box(uCamPos, rd);
  if (t.y <= max(t.x, 0.0)) { outColor = vec4(0.0); return; }
  const int STEPS = 112;
  float len = t.y - max(t.x, 0.0);
  float dt = len / float(STEPS);
  float tt = max(t.x, 0.0) + dt * hash3(vec3(gl_FragCoord.xy, uSeed));
  const float SIGMA = 9.0;
  vec3 col = vec3(0.0);
  float T = 1.0;
  float cosT = dot(rd, uSun);
  float extent = uBoxMax.y - uBoxMin.y;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCamPos + rd * tt;
    tt += dt;
    float d = density(p, true);
    if (d <= 0.001) continue;
    // optical depth toward the sun, in growing steps
    float od = 0.0;
    float ls = extent * 0.035;
    vec3 lp = p;
    for (int k = 0; k < 6; k++) { lp += uSun * ls; od += density(lp, false) * ls; ls *= 1.6; }
    vec3 sunL = vec3(0.0);
    float a = 1.0, b = 1.0, c = 1.0;
    for (int o = 0; o < 3; o++) {
      float ph = mix(hg(cosT, 0.35 * c), hg(cosT, -0.2 * c), 0.3) * 4.0 * 3.14159;
      sunL += a * ph * exp(-SIGMA * b * od);
      a *= 0.55; b *= 0.4; c *= 0.5;
    }
    // a little darker just inside the surface facing away: the "powder" of dense cloud
    float powder = 1.0 - exp(-SIGMA * 2.0 * d * 0.25);
    float hf = clamp((p.y - uBoxMin.y) / extent, 0.0, 1.0);
    vec3 amb = mix(uGroundColor, uSkyColor * vec3(1.2, 1.3, 1.5), smoothstep(0.0, 0.9, hf)) * mix(0.5, 1.0, hf);
    vec3 S = (uSunColor * sunL * SUN_GAIN * mix(0.45, 1.0, powder) + amb * AMB_GAIN * uAmbient) * uGain;
    float ext = SIGMA * d;
    float tr = exp(-ext * dt);
    col += T * S * (1.0 - tr);
    T *= tr;
    if (T < 0.004) break;
  }
  outColor = vec4(col, 1.0 - T);
}
`;

const DRAW_VERT = /* glsl */ `
uniform vec4 uRect;
uniform vec3 uCentre;
uniform vec3 uOffset;
out vec2 vUv;
void main() {
  // the bake was made from where the cloud was; slide its image with the cloud as it drifts
  vec4 a = projectionMatrix * viewMatrix * vec4(uCentre, 1.0);
  vec4 b = projectionMatrix * viewMatrix * vec4(uCentre + uOffset, 1.0);
  vec2 shift = b.xy / b.w - a.xy / a.w;
  vUv = position.xy;
  gl_Position = vec4(mix(uRect.xy, uRect.zw, position.xy) + shift, 0.0, 1.0);
}
`;

const DRAW_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
out vec4 outColor;
void main() { outColor = texture(uImage, vUv); }
`;

interface Baked {
  spec: CloudSpec;
  lumps: Lump[];
  box: { min: [number, number, number]; max: [number, number, number] };
  target: WebGLRenderTarget | null;
  material: ShaderMaterial;
  mesh: Mesh;
  distance: number;
}

/**
 * Photographic cumulus: each cloud is raymarched once, from the camera, into its own image,
 * then drawn as a screen-aligned card that slides with the cloud's slow drift. Rebaked when the
 * camera moves (a resize), so the frame never pays for the volume.
 */
export class Clouds {
  readonly mesh = new Group();
  readonly shapes: readonly { spec: CloudSpec; lumps: readonly Lump[] }[];
  private readonly clouds: Baked[];
  private readonly geometry = new BufferGeometry();
  private readonly quad = new PlaneGeometry(2, 2);
  private readonly bakeMaterial: ShaderMaterial;
  private readonly bakeScene = new Scene();
  private readonly bakeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly billows: number | undefined;

  constructor(specs: readonly CloudSpec[], light: CloudLight, offset: { value: Vector3 }, style: CloudStyle = {}) {
    this.billows = style.billows;
    this.geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    this.bakeMaterial = new ShaderMaterial({
      glslVersion: '300 es' as never,
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uLumps: { value: Array.from({ length: MAX_LUMPS }, () => new Vector4()) },
        uCount: { value: 0 },
        uBoxMin: { value: new Vector3() },
        uBoxMax: { value: new Vector3() },
        uInvViewProj: { value: new Matrix4() },
        uCamPos: { value: new Vector3() },
        uRect: { value: new Vector4() },
        uSun: { value: new Vector3(...light.sun) },
        uSunColor: { value: new Vector3(...light.sunColor) },
        uSkyColor: { value: new Vector3(...light.skyColor) },
        uGroundColor: { value: new Vector3(...light.groundColor) },
        uSeed: { value: 0 },
        uGain: { value: style.gain ?? 1 },
        uEdge: { value: style.edge ?? 5 },
        uFray: { value: style.fray ?? 0.05 },
        uNoiseScale: { value: 1.25 },
        uTaper: { value: 0.3 },
        uAmbient: { value: style.ambient ?? 1 },
        uBlend: { value: style.blend ?? 10 },
        uWarp: { value: style.warp ?? 0.8 },
        uDomeC: { value: new Vector3() },
        uDomeR: { value: new Vector3(1, 1, 1) },
      },
    });
    this.bakeScene.add(new Mesh(this.quad, this.bakeMaterial));
    this.clouds = specs.map((spec) => {
      const lumps = buildLumps(spec);
      const box = cloudBox(spec, lumps);
      const centre = new Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
      const material = new ShaderMaterial({
        glslVersion: '300 es' as never,
        vertexShader: DRAW_VERT,
        fragmentShader: DRAW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // the bake is premultiplied
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        uniforms: { uImage: { value: null }, uRect: { value: new Vector4() }, uCentre: { value: centre }, uOffset: offset },
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      return { spec, lumps, box, target: null, material, mesh, distance: 0 };
    });
    this.shapes = this.clouds.map(({ spec, lumps }) => ({ spec, lumps }));
  }

  /** Raymarch every cloud from the camera as it now stands. */
  bake(renderer: WebGLRenderer, camera: PerspectiveCamera, pixelW: number, pixelH: number): void {
    camera.updateMatrixWorld(true);
    const viewProj = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const u = this.bakeMaterial.uniforms;
    u.uInvViewProj.value.copy(viewProj).invert();
    u.uCamPos.value.copy(camera.position);
    const previous = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();
    for (const c of this.clouds) {
      const rect = projectBox(c.box, viewProj);
      c.distance = camera.position.distanceTo(c.material.uniforms.uCentre.value);
      c.material.uniforms.uRect.value.copy(rect);
      const w = Math.max(8, Math.round(((rect.z - rect.x) / 2) * pixelW));
      const h = Math.max(8, Math.round(((rect.w - rect.y) / 2) * pixelH));
      const k = Math.min(1, MAX_BAKE / Math.max(w, h));
      const tw = Math.round(w * k);
      const th = Math.round(h * k);
      if (!c.target || c.target.width !== tw || c.target.height !== th) {
        c.target?.dispose();
        c.target = new WebGLRenderTarget(tw, th, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
      }
      c.lumps.forEach((l, i) => u.uLumps.value[i].set(l.x, l.y, l.z, l.r));
      u.uCount.value = c.lumps.length;
      u.uBoxMin.value.set(...c.box.min);
      u.uBoxMax.value.set(...c.box.max);
      u.uRect.value.copy(rect);
      u.uSeed.value = (c.spec.seed % 97) * 0.37;
      u.uTaper.value = taperOf(c.spec);
      u.uNoiseScale.value = this.billows ? this.billows / c.spec.width : 1.25;
      const dome = domeOf(c.spec);
      u.uDomeC.value.set(...dome.c);
      u.uDomeR.value.set(...dome.r);
      renderer.setRenderTarget(c.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.bakeScene, this.bakeCamera);
      c.material.uniforms.uImage.value = c.target.texture;
    }
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    // far clouds first
    this.mesh.clear();
    [...this.clouds].sort((a, b) => b.distance - a.distance).forEach((c, i) => {
      c.mesh.renderOrder = 10 + i;
      this.mesh.add(c.mesh);
    });
  }

  dispose(): void {
    for (const c of this.clouds) {
      c.target?.dispose();
      c.material.dispose();
    }
    this.geometry.dispose();
    this.quad.dispose();
    this.bakeMaterial.dispose();
  }
}

/** The screen rectangle, in NDC, that a world box covers, padded a little. */
function projectBox(box: { min: [number, number, number]; max: [number, number, number] }, viewProj: Matrix4): Vector4 {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const p = new Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]).applyMatrix4(viewProj);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const px = (x1 - x0) * PAD, py = (y1 - y0) * PAD;
  return new Vector4(Math.max(-1.2, x0 - px), Math.max(-1.2, y0 - py), Math.min(1.2, x1 + px), Math.min(1.2, y1 + py));
}
