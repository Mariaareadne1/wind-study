import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type Texture,
  Vector3,
  Vector4,
} from 'three';
import { SUN } from '../scene/paint';
import { BEND_GLSL } from './bend';
import { CLOUD_SHADE_GLSL } from './clouds';
import { STRANDS_PER_TUFT, type GrassBuffers } from './tufts';

const SEGMENTS = 3;

/** A tapered ribbon: (side, t). Positions are all computed in the vertex shader. */
export function buildStrandGeometry(segments = SEGMENTS): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    positions.push(-1, t, 0, 1, t, 0);
  }
  positions.push(0, 1, 0);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  index.push(last, last + 1, segments * 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(index);
  return g;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 aRoot;
in vec4 aShape;
in vec4 aTint;
in vec4 aDyn;
uniform sampler2D uBend;
uniform sampler2D uFlow;
uniform vec4 uFieldRect; // minX, minZ, 1/width, 1/depth
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uSun;
uniform float uWidthScale;
uniform float uBendGain;
uniform float uFlutter;
out vec3 vColor;
out float vSide;
out float vT;
${BEND_GLSL}
${CLOUD_SHADE_GLSL}

void main() {
  float t = position.y;
  float side = position.x;
  float h = aShape.x;
  vec2 rest = aShape.zw;
  float softness = aDyn.x;
  float gain = aDyn.y * 2.0;
  float twist = (aDyn.z - 0.5) * 2.0;
  float phase = aDyn.w * 6.2831853;

  vec2 fuv = (aRoot.xz - uFieldRect.xy) * uFieldRect.zw;
  vec4 bendTex = texture(uBend, fuv);
  vec4 flow = texture(uFlow, fuv);
  // two springs per field cell: tall soft strands read the slower one
  vec2 bend = mix(bendTex.zw, bendTex.xy, softness);
  float tw = twist * 0.55;
  float ct = cos(tw), st = sin(tw);
  bend = vec2(ct * bend.x - st * bend.y, st * bend.x + ct * bend.y) * gain * uBendGain;

  // lingering tip flutter: amplitude follows wind energy, phase is steady, so it never jumps
  float energy = flow.r;
  float fl = (0.004 + energy * 0.14) * (0.6 + 0.8 * softness) * uFlutter;
  float wob = phase + dot(aRoot.xz, vec2(0.9, 0.7));
  vec2 flut = vec2(
    sin(uTime * 7.3 + wob) + 0.5 * sin(uTime * 11.9 + wob * 1.7),
    cos(uTime * 6.1 + wob * 1.3) + 0.5 * sin(uTime * 13.3 + wob * 0.6)
  ) * fl;

  vec2 A = rest + bend + flut;
  vec3 tangent;
  vec3 offset = strandPoint(t, h, A, tangent);
  vec3 world = aRoot + offset;

  // the ribbon always shows its broad side to the viewer
  vec3 view = normalize(uCamPos - world);
  vec3 sideDir = cross(tangent, view);
  float sl = length(sideDir);
  sideDir = sl > 1e-3 ? sideDir / sl : vec3(1.0, 0.0, 0.0);
  // soft leaf: slim at the root, full below the middle, tapering to a fine tip
  float prof = sqrt(max(1.0 - t * t * t, 0.0)) * (0.62 + 0.38 * smoothstep(0.0, 0.34, t));
  world += sideDir * side * aShape.y * uWidthScale * prof;

  // Colour: all of the shimmer through the field comes from the fibres' own attitude.
  vec3 base = aTint.rgb;
  float tipLight = aTint.a;
  vec3 cool = vec3(0.34, 0.50, 0.42);
  float ao = smoothstep(-0.05, 0.8, t);
  vec3 col = mix(base * 0.74 + cool * 0.1, base, ao);
  col = mix(col, min(base * 1.1 + vec3(0.05, 0.05, 0.01), vec3(1.0)), tipLight * t * t);

  // a strand leaning toward the sun is lit along its length; away, it falls into its own shade
  vec3 sunH = uSun;
  float lean = dot(tangent, sunH);
  float restLean = dot(normalize(vec3(rest.x, 1.0, rest.y)), sunH);
  float sheen = (lean - restLean) * (0.25 + 0.75 * t);
  col *= 1.0 + clamp(sheen, -1.0, 1.0) * 0.2;
  col += vec3(0.04, 0.04, -0.005) * max(sheen, 0.0);
  col = mix(col, cool * 0.7 + col * 0.45, max(-sheen, 0.0) * 0.16);
  // a bowed strand shows its paler flank
  float flank = smoothstep(0.22, 1.05, length(bend)) * t;
  col = mix(col, col * 1.03 + vec3(0.07, 0.065, 0.055), flank);

  // the cloud shadow is computed once per field texel, in the flow texture
  col = shadeCloud(col, flow.a);

  vColor = col;
  vSide = side;
  vT = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vSide;
in float vT;
out vec4 outColor;
void main() {
  // soft edges through alpha-to-coverage, so there's no sorting and no hard line
  float d = abs(vSide);
  float aa = max(fwidth(vSide), 1e-3);
  float a = 1.0 - smoothstep(1.0 - aa * 1.6, 1.0, d);
  a *= 1.0 - smoothstep(0.82, 1.0, vT) * 0.55;
  outColor = vec4(vColor, a);
}
`;

export interface GrassUniforms {
  uBend: { value: Texture | null };
  uFlow: { value: Texture | null };
  uFieldRect: { value: Vector4 };
  uTime: { value: number };
  uCamPos: { value: Vector3 };
  uSun: { value: Vector3 };
  uWidthScale: { value: number };
  uBendGain: { value: number };
  uFlutter: { value: number };
}

export function makeGrassUniforms(fieldRect: Vector4, sun: readonly [number, number, number] = SUN): GrassUniforms {
  return {
    uBend: { value: null },
    uFlow: { value: null },
    uFieldRect: { value: fieldRect },
    uTime: { value: 0 },
    uCamPos: { value: new Vector3() },
    uSun: { value: new Vector3(sun[0], 0, sun[2]).normalize() },
    uWidthScale: { value: 1 },
    uBendGain: { value: 1 },
    uFlutter: { value: 1 },
  };
}

/** Every strand in one instanced draw call; the vertex shader does all of the motion. */
export class GrassField {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private geometry: InstancedBufferGeometry;
  private capacity = 0;

  constructor(uniforms: GrassUniforms) {
    this.material = new ShaderMaterial({
      glslVersion: '300 es' as never,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: uniforms as never,
      side: DoubleSide,
      alphaToCoverage: true,
    });
    this.geometry = new InstancedBufferGeometry();
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Replace all strands; the old GPU buffers are released. */
  setBuffers(b: GrassBuffers): void {
    this.geometry.dispose();
    const g = new InstancedBufferGeometry();
    const strand = buildStrandGeometry();
    g.setAttribute('position', strand.getAttribute('position'));
    g.setIndex(strand.getIndex());
    g.setAttribute('aRoot', new InstancedBufferAttribute(b.root, 3));
    g.setAttribute('aShape', new InstancedBufferAttribute(b.shape, 4));
    g.setAttribute('aTint', new InstancedBufferAttribute(b.tint, 4, true));
    g.setAttribute('aDyn', new InstancedBufferAttribute(b.dyn, 4, true));
    g.instanceCount = b.count;
    this.geometry = g;
    this.mesh.geometry = g;
    this.capacity = b.count;
  }

  /** Draw only a prefix of the strands. Tufts are low-discrepancy, so coverage stays even. */
  setDensity(fraction: number): void {
    const tufts = Math.floor((this.capacity * fraction) / STRANDS_PER_TUFT);
    this.geometry.instanceCount = tufts * STRANDS_PER_TUFT;
  }

  get drawn(): number {
    return this.geometry.instanceCount;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
