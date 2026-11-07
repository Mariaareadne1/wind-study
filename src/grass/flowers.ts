import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';
import type { ScreenRays } from '../scene/framing';
import { fbm, makeNoise, makeRng, mix, smoothstep } from '../scene/noise';
import { WORLD, type Terrain } from '../scene/terrain';
import { BEND_GLSL } from './bend';
import { CLOUD_SHADE_GLSL, HAZE_GLSL } from './clouds';
import type { GrassUniforms } from './GrassField';

const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;

const COLOURS: [number, number, number][] = [
  [0.96, 0.91, 0.71], // cream
  [0.97, 0.88, 0.46], // pale yellow
  [0.985, 0.975, 0.92], // white
  [0.62, 0.72, 0.9], // small blue
  [0.96, 0.91, 0.71],
  [0.985, 0.975, 0.92],
];
const SEED_COLOUR: [number, number, number] = [0.9, 0.84, 0.6];

/** Number of flowers and seed heads drawn into a given number of grass strands. */
export interface FlowerOptions {
  flowers: number;
  seedHeads: number;
  seed: number;
  /** Multiplies stem height and head size. */
  scale?: number;
  refDist?: number | null;
  sizeExponent?: number;
}

export interface FlowerBuffers {
  count: number;
  /** root x, y, z */
  root: Float32Array;
  /** stem height, head size, kind (0 flower, 1 seed head), softness */
  shape: Float32Array;
  /** rgb, phase */
  tint: Float32Array;
  /** rest lean x, z */
  lean: Float32Array;
}

/** Scatters small drifts of flowers and a sparse scatter of tall seed heads. */
export function buildFlowers(terrain: Terrain, rays: ScreenRays, opts: FlowerOptions): FlowerBuffers {
  const count = opts.flowers + opts.seedHeads;
  const root = new Float32Array(count * 3);
  const shape = new Float32Array(count * 4);
  const tint = new Float32Array(count * 4);
  const lean = new Float32Array(count * 2);
  const rng = makeRng(opts.seed + 2000);
  const drift = makeNoise(opts.seed + 401);
  const hueDrift = makeNoise(opts.seed + 402);
  const [c00, c10, c01, c11] = rays.corners;
  const [ox, oy, oz] = rays.origin;
  const refDist = opts.refDist ?? oy * 1.3;
  const sizeExponent = opts.sizeExponent ?? 0.75;
  const scale = opts.scale ?? 1;

  let i = 0;
  let n = 0;
  // low-discrepancy points kept where the drift noise is high, so flowers gather rather than sprinkle
  while (i < count && n < count * 200) {
    n++;
    const u = (n * R2_A) % 1;
    const v = (n * R2_B) % 1;
    const sx = -0.06 + u * 1.12;
    const sy = -0.06 + v * 1.12;
    const dx = mix(mix(c00[0], c10[0], sx), mix(c01[0], c11[0], sx), sy);
    const dy = mix(mix(c00[1], c10[1], sx), mix(c01[1], c11[1], sx), sy);
    const dz = mix(mix(c00[2], c10[2], sx), mix(c01[2], c11[2], sx), sy);
    const hit = terrain.raycast(ox, oy, oz, dx, dy, dz);
    if (!hit) continue;
    const [x, y, z] = hit;
    if (x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ) continue;
    const isSeed = i >= opts.flowers;
    const d = fbm(drift, x * 0.16, z * 0.16, 3);
    const keep = isSeed ? 0.5 : smoothstep(0.1, 0.3, d) * 0.9 + 0.006;
    if (rng() > keep) continue;

    const dist = Math.hypot(ox - x, oy - y, oz - z);
    const distScale = Math.pow(dist / refDist, sizeExponent) * scale;
    root[i * 3] = x;
    root[i * 3 + 1] = y - 0.02;
    root[i * 3 + 2] = z;
    if (isSeed) {
      shape[i * 4] = mix(0.95, 1.35, rng()) * distScale;
      shape[i * 4 + 1] = mix(0.026, 0.038, rng()) * distScale;
      shape[i * 4 + 2] = 1;
      shape[i * 4 + 3] = mix(0.75, 1, rng());
      tint.set([SEED_COLOUR[0] * mix(0.92, 1.05, rng()), SEED_COLOUR[1] * mix(0.92, 1.05, rng()), SEED_COLOUR[2], rng()], i * 4);
    } else {
      // the colours drift across the field too: a yellow corner here, a white one there
      const hue = (fbm(hueDrift, x * 0.09, z * 0.09, 2) * 2.4 + 0.5 + rng() * 0.28 + 1) % 1;
      const c = COLOURS[Math.floor(hue * COLOURS.length) % COLOURS.length];
      shape[i * 4] = mix(0.62, 0.95, rng()) * distScale;
      shape[i * 4 + 1] = mix(0.05, 0.078, rng()) * distScale;
      shape[i * 4 + 2] = 0;
      shape[i * 4 + 3] = mix(0.35, 0.8, rng());
      tint.set([c[0], c[1], c[2], rng()], i * 4);
    }
    const a = rng() * Math.PI * 2;
    const l = mix(0.05, 0.3, rng());
    lean[i * 2] = Math.cos(a) * l;
    lean[i * 2 + 1] = Math.sin(a) * l;
    i++;
  }
  return { count: i, root, shape, tint, lean };
}

function buildGeometry(): BufferGeometry {
  // position = (side or head u, t or head v, 0 stem / 1 head)
  const p: number[] = [];
  const idx: number[] = [];
  const STEM = 4;
  for (let i = 0; i <= STEM; i++) p.push(-1, i / STEM, 0, 1, i / STEM, 0);
  for (let i = 0; i < STEM; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const h = p.length / 3;
  p.push(-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1);
  idx.push(h, h + 1, h + 2, h, h + 2, h + 3);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 aRoot;
in vec4 aShape;
in vec4 aTint;
in vec2 aLean;
uniform sampler2D uBend;
uniform sampler2D uFlow;
uniform vec4 uFieldRect;
uniform float uTime;
uniform vec3 uCamPos;
uniform float uBendGain;
uniform float uFlutter;
uniform vec4 uHaze;
uniform vec2 uHazeRange;
out vec3 vColor;
out vec2 vHead;
out float vKind;
out float vSide;
${BEND_GLSL}
${CLOUD_SHADE_GLSL}
${HAZE_GLSL}
void main() {
  bool isHead = position.z > 0.5;
  float h = aShape.x;
  float size = aShape.y;
  float seed = aShape.z;
  float softness = aShape.w;
  vec2 fuv = (aRoot.xz - uFieldRect.xy) * uFieldRect.zw;
  vec4 b = texture(uBend, fuv);
  vec4 flow = texture(uFlow, fuv);
  float energy = flow.r;
  vec2 bend = mix(b.zw, b.xy, softness) * (0.75 + 0.45 * softness) * uBendGain;
  float phase = aTint.a * 6.2831853;
  vec2 flut = vec2(sin(uTime * 5.7 + phase), cos(uTime * 4.9 + phase * 1.4)) * (0.005 + energy * 0.17) * uFlutter;
  vec2 A = aLean + bend + flut;
  vec3 tangent;
  float t = isHead ? 1.0 : position.y;
  vec3 world = aRoot + strandPoint(t, h, A, tangent);
  vec3 view = normalize(uCamPos - world);
  vec3 side = cross(tangent, view);
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  vHead = position.xy;
  vKind = seed;
  vSide = position.x;
  vec3 stem = vec3(0.42, 0.6, 0.34);
  if (isHead) {
    if (seed > 0.5) {
      // a seed head runs along the stalk's own direction
      world += side * position.x * size + tangent * (position.y * size * 3.2 + size * 2.4);
    } else {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      world += (right * position.x + up * position.y) * size * 1.25;
    }
    vColor = aTint.rgb;
  } else {
    world += side * position.x * (seed > 0.5 ? 0.012 : 0.014) * (1.0 - t * 0.4);
    vColor = mix(stem * 0.7, seed > 0.5 ? aTint.rgb : stem, t);
    vHead = vec2(-9.0, position.x);
  }
  vColor = applyHaze(shadeCloud(vColor, flow.a), length(uCamPos - world), uHaze, uHazeRange);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in vec2 vHead;
in float vKind;
in float vSide;
out vec4 outColor;
void main() {
  if (vHead.x < -5.0) {
    float d = abs(vSide);
    float a = 1.0 - smoothstep(1.0 - max(fwidth(vSide), 1e-3) * 1.5, 1.0, d);
    outColor = vec4(vColor, a);
    return;
  }
  vec3 col = vColor;
  float dist;
  if (vKind > 0.5) {
    // feathery oval, grainy along its length
    vec2 p = vHead * vec2(1.0, 1.0);
    dist = length(p * vec2(1.05, 0.98)) - 0.9;
    col *= 0.88 + 0.16 * smoothstep(-1.0, 1.0, vHead.y);
  } else {
    // five soft rounded petals around a warm eye
    float r = length(vHead);
    float ang = atan(vHead.y, vHead.x);
    float petals = 0.72 + 0.2 * cos(ang * 5.0);
    dist = r - petals;
    col = mix(vec3(0.95, 0.78, 0.38), col, smoothstep(0.12, 0.3, r));
    col *= 0.9 + 0.1 * smoothstep(0.75, 0.2, r);
  }
  float aa = max(fwidth(dist), 1e-3) * 1.2;
  outColor = vec4(col, 1.0 - smoothstep(-aa, aa, dist));
}
`;

/** Flowers and seed heads, bent by exactly the same wind texture as the grass. */
export class Flowers {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private geometry = new InstancedBufferGeometry();
  private readonly base = buildGeometry();

  constructor(uniforms: GrassUniforms) {
    this.material = new ShaderMaterial({
      glslVersion: '300 es' as never,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uniforms as never,
      side: DoubleSide,
      alphaToCoverage: true,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setBuffers(b: FlowerBuffers): void {
    this.geometry.dispose();
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', this.base.getAttribute('position'));
    g.setIndex(this.base.getIndex());
    g.setAttribute('aRoot', new InstancedBufferAttribute(b.root, 3));
    g.setAttribute('aShape', new InstancedBufferAttribute(b.shape, 4));
    g.setAttribute('aTint', new InstancedBufferAttribute(b.tint, 4));
    g.setAttribute('aLean', new InstancedBufferAttribute(b.lean, 2));
    g.instanceCount = b.count;
    this.geometry = g;
    this.mesh.geometry = g;
  }

  dispose(): void {
    this.geometry.dispose();
    this.base.dispose();
    this.material.dispose();
  }
}
