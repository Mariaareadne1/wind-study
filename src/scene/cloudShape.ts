import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import { fbm, makeNoise, makeRng } from './noise';
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

/** One rounded mass of the cloud's body: the raymarch erodes these with noise. */
export interface Lump {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** The shader holds this many lumps per cloud. */
export const MAX_LUMPS = 64;
/** Sharpness of the smooth union between lumps: the shader uses the same. */
const BLEND = 8;

/**
 * A cumulus as a handful of overlapping masses: a broad flattened base,
 * a lumpy middle, and towers that rise off-centre, the way a real one builds
 * toward the side its updraft is strongest.
 */
export function buildLumps(c: CloudSpec): Lump[] {
  const rng = makeRng(c.seed);
  const lumps: Lump[] = [];
  const hw = c.width * 0.5;
  const tower = (rng() - 0.5) * 0.5; // where the crown leans, as a fraction of the half-width
  const dome = domeOf(c);
  // cauliflower: rounded heads budding all over the core's surface, bigger toward the crown,
  // some sunk deep and some standing proud, so the outline is a run of billows
  for (let i = 0; i < MAX_LUMPS; i++) {
    const a = rng() * Math.PI * 2;
    // upper hemisphere and sides; few on the flat base
    const up = Math.pow(rng(), 0.7);
    const el = Math.asin(up) * (0.15 + 0.85 * rng());
    const ce = Math.cos(el);
    const crown = Math.sin(el);
    const sink = 0.5 + 0.4 * rng();
    const r = c.width * (0.065 + 0.06 * rng()) * (0.6 + 0.95 * crown * (1 - Math.abs(Math.cos(a) * ce) * 0.5));
    lumps.push({
      x: dome.c[0] + Math.cos(a) * ce * dome.r[0] * sink + tower * hw * crown,
      y: dome.c[1] + crown * dome.r[1] * sink + r * 0.45,
      z: dome.c[2] + Math.sin(a) * ce * dome.r[2] * sink,
      r,
    });
  }
  return lumps.slice(0, MAX_LUMPS);
}

/** The cloud's world-space box, padded for the eroded rim. */
export function cloudBox(c: CloudSpec, lumps: readonly Lump[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, c.y, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const l of lumps) {
    min[0] = Math.min(min[0], l.x - l.r);
    min[2] = Math.min(min[2], l.z - l.r);
    max[0] = Math.max(max[0], l.x + l.r);
    max[1] = Math.max(max[1], l.y + l.r);
    max[2] = Math.max(max[2], l.z + l.r);
  }
  // the smooth union swells a little past each lump: leave room so nothing is clipped flat
  const px = (max[0] - min[0]) * 0.12, pz = (max[2] - min[2]) * 0.12;
  return { min: [min[0] - px, min[1], min[2] - pz], max: [max[0] + px, max[1] + (max[1] - min[1]) * 0.15, max[2] + pz] };
}

/** The half-ellipsoid every cumulus is built on: flat base, rounded crown. Centre of its base, and radii. */
export function domeOf(c: CloudSpec): { c: [number, number, number]; r: [number, number, number] } {
  return { c: [c.x, c.y, c.z], r: [c.width * 0.44, c.height * 0.74, c.depth * 0.42] };
}

/** How far into the cloud's soft mass a point is: 0 outside, toward 1 at its core. Matches the shader. */
export function lumpField(lumps: readonly Lump[], spec: CloudSpec, x: number, y: number, z: number): number {
  const dome = domeOf(spec);
  let sum = Math.exp(BLEND * (1 - Math.hypot((x - dome.c[0]) / dome.r[0], (y - dome.c[1]) / dome.r[1], (z - dome.c[2]) / dome.r[2])));
  for (const l of lumps) sum += Math.exp(BLEND * (1 - Math.hypot(x - l.x, y - l.y, z - l.z) / l.r));
  const s = Math.max(Math.log(Math.max(sum, 1e-6)) / BLEND, 0);
  // flat-bottomed, as cumulus are: the base is the condensation level
  const base = Math.min(1, Math.max(0, (y - spec.y) / 0.35));
  return s * base * base * (3 - 2 * base);
}

/**
 * Cloud shadow cover over a world rectangle, cast along the sun. 0 is sunlit, 255 full shadow.
 * Optical depth through the soft masses gives a dark core and a feathered, irregular edge.
 */
export function bakeCloudShadow(
  clouds: readonly { spec: CloudSpec; lumps: readonly Lump[] }[],
  terrain: Terrain,
  sun: readonly [number, number, number],
  rect: { minX: number; minZ: number; width: number; depth: number },
  resX: number,
  resZ: number,
): Uint8Array {
  const out = new Uint8Array(resX * resZ);
  const [lx, ly, lz] = sun;
  const edge = makeNoise(907);
  const STEP = 0.28;
  for (let j = 0; j < resZ; j++) {
    const z = rect.minZ + ((j + 0.5) / resZ) * rect.depth;
    for (let i = 0; i < resX; i++) {
      const x = rect.minX + ((i + 0.5) / resX) * rect.width;
      const y = terrain.height(x, z);
      let depth = 0;
      for (const { spec, lumps } of clouds) {
        // where this ray crosses the cloud's base and its top
        const t0 = (spec.y - y) / ly;
        const t1 = (spec.y + spec.height * 1.25 - y) / ly;
        if (t1 <= 0) continue;
        const cx = x + lx * (t0 + t1) * 0.5;
        const cz = z + lz * (t0 + t1) * 0.5;
        if (Math.abs(cx - spec.x) > spec.width + 1 || Math.abs(cz - spec.z) > spec.depth + spec.height + 1) continue;
        for (let t = Math.max(t0, 0); t < t1; t += STEP) depth += Math.min(1, Math.max(0, (lumpField(lumps, spec, x + lx * t, y + ly * t, z + lz * t) - 0.12) * 3.5)) * STEP;
      }
      // the rim of a real cloud shadow wanders: let noise eat into the thinner parts
      const n = fbm(edge, x * 0.6, z * 0.6, 3);
      const cover = 1 - Math.exp(-depth * (2.6 + 1.6 * n));
      out[i + j * resX] = Math.round(Math.min(1, Math.max(0, cover)) * 255);
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
