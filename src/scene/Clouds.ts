import {
  DataTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  type PerspectiveCamera,
  type Vector3,
} from 'three';
import { makeRng } from './noise';
import type { Terrain } from './terrain';

/** A cumulus floating low over the grass: centre of its flat base, and its size. */
export interface CloudSpec {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  seed: number;
}

export interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Centre of the whole cloud, so lumps shade as one mass. */
  cx: number;
  cy: number;
  cz: number;
  cr: number;
  /** 0 at the cloud's base, 1 at its crown: shading reads it. */
  level: number;
}

/**
 * Builds a cotton-ball cumulus from overlapping spheres: a broad, nearly flat
 * base, a domed body, and smaller cauliflower lumps on top.
 */
export function buildPuffs(c: CloudSpec): Puff[] {
  const rng = makeRng(c.seed);
  const puffs: Puff[] = [];
  const centre = { cx: c.x, cy: c.y + c.height * 0.45, cz: c.z, cr: Math.max(c.width, c.height) * 0.55 };
  const body = 80;
  for (let i = 0; i < body; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng());
    const ex = Math.cos(a) * rr;
    const ez = Math.sin(a) * rr;
    const dome = Math.sqrt(Math.max(0, 1 - rr * rr));
    const r = (0.2 + 0.2 * dome + 0.1 * rng()) * Math.min(c.width, c.height * 2) * 0.5;
    const lift = rng() * dome * c.height * 0.75;
    puffs.push({ ...centre, x: c.x + ex * c.width * 0.5, y: c.y + r * 0.55 + lift, z: c.z + ez * c.depth * 0.5, r, level: (lift + r) / (c.height + r) });
  }
  // cauliflower lumps along the upper surface
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * 0.85;
    const dome = Math.sqrt(Math.max(0, 1 - rr * rr));
    const r = (0.11 + 0.12 * rng()) * c.width * 0.5;
    puffs.push({
      ...centre,
      x: c.x + Math.cos(a) * rr * c.width * 0.5,
      y: c.y + dome * c.height * 0.85 + r * 0.6,
      z: c.z + Math.sin(a) * rr * c.depth * 0.5,
      r,
      level: Math.min(1, (dome * c.height * 0.85 + r) / c.height),
    });
  }
  return puffs;
}

/** Cloud shadow cover over a world rectangle, along the sun, soft-edged. 0 sunlit, 255 full shadow. */
export function bakeCloudShadow(
  puffs: readonly Puff[],
  terrain: Terrain,
  sun: readonly [number, number, number],
  rect: { minX: number; minZ: number; width: number; depth: number },
  resX: number,
  resZ: number,
): Uint8Array {
  const out = new Uint8Array(resX * resZ);
  const [lx, ly, lz] = sun;
  for (let j = 0; j < resZ; j++) {
    const z = rect.minZ + ((j + 0.5) / resZ) * rect.depth;
    for (let i = 0; i < resX; i++) {
      const x = rect.minX + ((i + 0.5) / resX) * rect.width;
      const y = terrain.height(x, z);
      let light = 1;
      for (const p of puffs) {
        const wx = p.x - x;
        const wy = p.y - y;
        const wz = p.z - z;
        const along = wx * lx + wy * ly + wz * lz;
        if (along <= 0) continue;
        const d2 = wx * wx + wy * wy + wz * wz - along * along;
        const r = p.r;
        if (d2 > r * r) continue;
        // denser through the middle of a puff, feathered at its rim
        const t = 1 - Math.sqrt(d2) / r;
        // a crisp edge, then full shade: low cumulus throw hard-edged shadows in bright sun
        light *= 1 - Math.min(1, t * 4.5) * 0.95;
        if (light < 0.01) break;
      }
      out[i + j * resX] = Math.round((1 - light) * 255);
    }
  }
  return out;
}

export function makeShadowTexture(data: Uint8Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */ `
precision highp float;
in vec4 aPuff; // x, y, z, radius
in vec4 aCloud; // centre of the whole cloud, its radius
in float aLevel;
uniform vec3 uOffset;
out vec2 vUv;
out float vLevel;
out vec3 vCentreView;
out float vRadius;
out vec3 vMassNormal;
void main() {
  vec3 centre = aPuff.xyz + uOffset;
  vec4 mv = viewMatrix * vec4(centre, 1.0);
  // a little oversized: the fluffy rim needs room
  mv.xy += position.xy * aPuff.w * 1.25;
  vUv = position.xy * 1.25;
  vLevel = aLevel;
  vRadius = aPuff.w;
  vCentreView = (viewMatrix * vec4(centre, 1.0)).xyz;
  // where this lump sits on the cloud as a whole, in view space
  vec3 fromMass = (viewMatrix * vec4(centre, 1.0)).xyz - (viewMatrix * vec4(aCloud.xyz + uOffset, 1.0)).xyz;
  vMassNormal = normalize(fromMass / aCloud.w + vec3(0.0, 0.0, 0.6));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
in float vLevel;
in vec3 vCentreView;
in float vRadius;
in vec3 vMassNormal;
uniform vec3 uSunView;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uBounce;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  // keep the noise inputs small: a large offset makes the hash band into streaks
  float seed = fract(dot(vCentreView, vec3(0.037, 0.071, 0.013))) * 17.0;
  vec2 q = vUv * 2.6 + seed;
  float billow = vnoise(q) * 0.55 + vnoise(q * 2.3) * 0.3 + vnoise(q * 5.1) * 0.15;
  float r = length(vUv) + (billow - 0.5) * 0.18;
  if (r > 1.0) discard;
  vec2 uv = vUv / max(r, 1e-3) * min(r, 1.0);
  vec3 lump = normalize(vec3(uv, sqrt(max(1.0 - dot(uv, uv), 0.0))));
  // the cloud is shaded as one body; its lumps only modulate that
  vec3 n = normalize(mix(vMassNormal, lump, 0.78));
  // each lump is a little sphere of cotton: bright toward the light, soft grey away, rim kept light
  vec3 lightDir = normalize(uSunView);
  float lambert = dot(n, lightDir) * 0.5 + 0.5;
  float body = smoothstep(0.0, 0.9, vLevel);
  float lit = clamp(mix(0.28, 1.25, lambert) * mix(0.72, 1.0, body), 0.0, 1.0);
  // crisp bright crowns: the tops facing up and toward the light go nearly white
  lit = max(lit, smoothstep(0.35, 0.9, n.y) * smoothstep(0.4, 1.0, body) * 1.05);
  vec3 col = mix(uShade, uLit, lit * lit * (3.0 - 2.0 * lit));
  // undersides pick up green light from the grass below
  col = mix(col, uBounce, (1.0 - body) * 0.28 * clamp(-n.y + 0.4, 0.0, 1.0));
  col *= 0.95 + 0.1 * billow;
  // shade the creases where lumps meet: each lump darkens toward its rim, which carves the cauliflower
  col *= mix(0.93, 1.0, smoothstep(1.0, 0.6, r));
  // solid through the body; only the outer rim of each lump is soft
  float a = smoothstep(1.0, 0.74, r);
  outColor = vec4(col, a);
}
`;

/** Clouds as many soft sphere impostors, sorted far to near once: cheap, and cotton-like. */
export class Clouds {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly geometry: InstancedBufferGeometry;
  private readonly base = new PlaneGeometry(2, 2);

  constructor(puffs: readonly Puff[], camera: PerspectiveCamera, sun: readonly [number, number, number], offset: { value: Vector3 }) {
    const cam = camera.position;
    const sorted = [...puffs].sort((a, b) => Math.hypot(b.x - cam.x, b.y - cam.y, b.z - cam.z) - Math.hypot(a.x - cam.x, a.y - cam.y, a.z - cam.z));
    const data = new Float32Array(sorted.length * 4);
    const mass = new Float32Array(sorted.length * 4);
    const level = new Float32Array(sorted.length);
    sorted.forEach((p, i) => {
      data.set([p.x, p.y, p.z, p.r], i * 4);
      mass.set([p.cx, p.cy, p.cz, p.cr], i * 4);
      level[i] = p.level;
    });
    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute('position', this.base.getAttribute('position'));
    this.geometry.setIndex(this.base.getIndex());
    this.geometry.setAttribute('aPuff', new InstancedBufferAttribute(data, 4));
    this.geometry.setAttribute('aLevel', new InstancedBufferAttribute(level, 1));
    this.geometry.setAttribute('aCloud', new InstancedBufferAttribute(mass, 4));
    this.geometry.instanceCount = sorted.length;
    void sunInView(sun, camera);
    this.material = new ShaderMaterial({
      glslVersion: '300 es' as never,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // they float well above the grass and nothing in the scene stands between them and the viewer
      depthTest: false,
      uniforms: {
        uOffset: offset,
        uSunView: { value: [-0.45, 0.62, 0.64] },
        uLit: { value: [1.0, 1.0, 0.985] },
        uShade: { value: [0.58, 0.64, 0.76] },
        uBounce: { value: [0.62, 0.72, 0.5] },
      },
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  dispose(): void {
    this.geometry.dispose();
    this.base.dispose();
    this.material.dispose();
  }
}

function sunInView(sun: readonly [number, number, number], camera: PerspectiveCamera): [number, number, number] {
  const e = camera.matrixWorldInverse.elements;
  const x = e[0] * sun[0] + e[4] * sun[1] + e[8] * sun[2];
  const y = e[1] * sun[0] + e[5] * sun[1] + e[9] * sun[2];
  const z = e[2] * sun[0] + e[6] * sun[1] + e[10] * sun[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
