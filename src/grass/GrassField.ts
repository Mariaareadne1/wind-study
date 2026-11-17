import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { SUN } from '../scene/paint';
import { BEND_GLSL } from './bend';
import { CLOUD_SHADE_GLSL, HAZE_GLSL } from './clouds';
import { TERRAIN_LIGHT_RECT } from '../scene/terrainLight';
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
uniform vec4 uHaze;
uniform vec2 uHazeRange;
uniform vec3 uSun3;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform sampler2D uTerrainLight;
uniform vec4 uWorldRect;
uniform float uWidthScale;
uniform float uBendGain;
uniform float uFlutter;
out vec3 vColor;
out float vSide;
out float vT;
out float vSwept;
${BEND_GLSL}
${CLOUD_SHADE_GLSL}
${HAZE_GLSL}

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

#ifdef REALISTIC
  // Sunlit fibres: hair-style lighting (diffuse by sine, a tight sheen and a broad one),
  // light glowing through backlit blades, and deep shade down among the roots.
  vec3 base = aTint.rgb;
  vec3 L = uSun3;
  vec3 T = tangent;
  float TL = dot(T, L);
  // a blade standing up into a high sun still catches light across its face and tip
  float fibre = mix(0.55, 1.0, sqrt(max(1.0 - TL * TL, 0.0)));
  vec3 H = normalize(L + view);
  float TH = dot(T, H);
  float sinTH = sqrt(max(1.0 - TH * TH, 0.0));
  float sheen = pow(sinTH, 90.0) * 1.0 + pow(sinTH, 10.0) * 0.32;
  float glow = pow(max(dot(-view, L), 0.0), 2.5) * t * t;
  float ao = mix(0.12, 1.0, pow(t, 0.75));
  // blades lying toward the sun are lit along their length; lying away, they shade each other
  vec2 lieDir = length(A) > 1e-3 ? A / length(A) : vec2(0.0);
  vec2 sunFlat = normalize(L.xz + vec2(1e-4));
  float facing = clamp(0.88 + 0.36 * dot(lieDir, sunFlat), 0.4, 1.3);
  // the cloud shadow is read where this part of the blade actually is, not at its root:
  // long blades lying over would otherwise drag shadows sideways
  float sunVis = 1.0 - texture(uFlow, (world.xz - uFieldRect.xy) * uFieldRect.zw).a;
  vec3 sunCol = uSunColor;
  vec3 skyCol = uSkyColor;
#ifdef LINEAR
  // Linear light, lit like a canopy: the land's own normal carries most of the shading, the
  // fibre term the rest; the land's occlusion and self-shadow put the valleys in real shade.
  vec4 tl = texture(uTerrainLight, (world.xz - uWorldRect.xy) * uWorldRect.zw);
  vec3 nT = vec3(tl.b * 2.0 - 1.0, 0.0, tl.a * 2.0 - 1.0);
  nT.y = sqrt(max(1.0 - nT.x * nT.x - nT.z * nT.z, 0.0));
  vec3 albedo = pow(base, vec3(2.2));
  // the waves' own shape carries the light; blade attitude adds texture on top
  float canopy = pow(max(dot(nT, L), 0.0), 1.4) * 0.8 + fibre * 0.2;
  float self = mix(0.18, 1.0, ao);
  vec3 direct = sunCol * canopy * tl.g * sunVis * self * mix(0.8, 1.15, facing - 0.4);
  // a cloud overhead also hides part of the sky, which is what makes its shadow read in shade too
  vec3 ambient = skyCol * tl.r * tl.r * mix(0.22, 1.0, ao) * (1.0 - 0.45 * (1.0 - sunVis));
  vec3 lin = albedo * (direct + ambient);
  // restrained fibre highlights and a little light through backlit tips
  lin += sunCol * (pow(sinTH, 160.0) * 0.16 + pow(sinTH, 24.0) * 0.045) * tl.g * sunVis * t * t;
  lin += albedo * vec3(0.9, 1.1, 0.4) * glow * tl.g * sunVis * 0.5;
  // long swept blades are glossy: in shade they reflect the blue sky, which reads as silvery teal
  float swept = aTint.a;
  float grazing = pow(1.0 - abs(dot(normalize(cross(sideDir, tangent)), view)), 2.0);
  lin += skyCol * swept * swept * t * (0.04 + 0.2 * grazing) * mix(1.0, 0.45, tl.g * sunVis);
  lin = mix(lin, lin * vec3(0.8, 0.95, 1.15), swept * (1.0 - tl.g * sunVis * 0.7) * 0.6);
  vSwept = swept;
  vColor = lin;
#else
  vec3 col = base * skyCol * mix(0.35, 1.0, ao);
  col += base * sunCol * fibre * facing * sunVis * mix(0.25, 1.0, ao);
  col += mix(sunCol, base * 1.6 + 0.25, 0.45) * sheen * sunVis * t * facing * 0.7;
  col += base * vec3(1.05, 1.25, 0.45) * glow * sunVis * 0.9;
  vColor = col;
#endif
#else
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
  col = applyHaze(col, length(uCamPos - world), uHaze, uHazeRange);

  vColor = col;
#endif
#ifdef REALISTIC
  vColor = applyHaze(vColor, length(uCamPos - world), uHaze, uHazeRange);
#endif
  vSide = side;
  vT = t;
#ifndef LINEAR
  vSwept = 0.0;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
// (REALISTIC comes from the material's defines)
in vec3 vColor;
in float vSide;
in float vT;
in float vSwept;
out vec4 outColor;
void main() {
  // soft edges through alpha-to-coverage, so there's no sorting and no hard line
  float d = abs(vSide);
  float aa = max(fwidth(vSide), 1e-3);
#ifdef LINEAR
  // fine blades: a crisp edge with a little feather, so each blade still reads on its own
  // swept blades are softer, like grass caught moving; short blades keep a crisp edge
  float a = 1.0 - smoothstep(mix(1.0 - aa * 2.5 - 0.15, 0.45, vSwept), 1.0, d);
  a *= 1.0 - smoothstep(mix(0.7, 0.45, vSwept), 1.0, vT) * 0.6;
#elif defined(REALISTIC)
  // long silky blades: a wide feather and a fading tip read as soft, slightly blurred grass
  float a = 1.0 - smoothstep(0.2, 1.0, d);
  a *= 1.0 - smoothstep(0.55, 1.0, vT) * 0.75;
#else
  float a = 1.0 - smoothstep(1.0 - aa * 1.6, 1.0, d);
  a *= 1.0 - smoothstep(0.82, 1.0, vT) * 0.55;
#endif
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
  uHaze: { value: Vector4 };
  uHazeRange: { value: Vector2 };
  uSun3: { value: Vector3 };
  uSunColor: { value: Vector3 };
  uSkyColor: { value: Vector3 };
  uTerrainLight: { value: Texture | null };
  uWorldRect: { value: Vector4 };
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
    uHaze: { value: new Vector4(0, 0, 0, 0) },
    uHazeRange: { value: new Vector2(30, 90) },
    uSun3: { value: new Vector3(sun[0], sun[1], sun[2]).normalize() },
    uSunColor: { value: new Vector3(1.3, 1.22, 1.0) },
    uSkyColor: { value: new Vector3(0.36, 0.46, 0.5) },
    uTerrainLight: { value: null },
    uWorldRect: { value: new Vector4(...TERRAIN_LIGHT_RECT) },
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

  constructor(uniforms: GrassUniforms, realistic = false, linear = false) {
    this.material = new ShaderMaterial({
      defines: realistic ? (linear ? { REALISTIC: 1, LINEAR: 1 } : { REALISTIC: 1 }) : {},
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
