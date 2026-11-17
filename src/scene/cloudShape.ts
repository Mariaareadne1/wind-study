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

/** How much narrower a cumulus is at its crown than at its base. */
export const TAPER = 0.3;

/** The shader holds this many lumps per cloud. */
export const MAX_LUMPS = 64;
/** Sharpness of the smooth union between lumps: the shader uses the same. */
const BLEND = 10;

/**
 * A cumulus as a handful of overlapping masses: a broad flattened base,
 * a lumpy middle, and towers that rise off-centre, the way a real one builds
 * toward the side its updraft is strongest.
 */
export function buildLumps(c: CloudSpec): Lump[] {
  const rng = makeRng(c.seed);
  const lumps: Lump[] = [];
  const hw = c.width * 0.5;
  const tower = 0.12 + rng() * 0.22 * (rng() < 0.5 ? -1 : 1); // where the crown leans, as a fraction of the half-width
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
    // heads ride the dome's surface, so the outline follows the dome instead of sagging between them
    const sink = 0.72 + 0.2 * rng();
    const r = c.width * (0.06 + 0.05 * rng()) * (0.7 + 0.75 * crown);
    lumps.push({
      x: dome.c[0] + Math.cos(a) * ce * dome.r[0] * sink * (1 - TAPER * crown) + tower * hw * crown * 0.4,
      y: dome.c[1] + crown * dome.r[1] * sink + r * 0.45,
      z: dome.c[2] + Math.sin(a) * ce * dome.r[2] * sink * (1 - TAPER * crown),
      r,
    });
  }
  // the crown: a few big heads piled up off-centre, the part of the cloud still climbing
  const crowns = 4;
  for (let i = 0; i < crowns; i++) {
    const r = c.width * (0.1 + 0.035 * rng());
    lumps[i] = {
      x: dome.c[0] + (tower + (rng() - 0.5) * 0.35) * hw,
      y: dome.c[1] + dome.r[1] * (0.62 + 0.15 * rng()),
      z: dome.c[2] + (rng() - 0.5) * dome.r[2] * 0.5,
      r,
    };
  }
  return lumps.slice(0, MAX_LUMPS);
}

/** The cloud's world-space box: everything the raymarch could find density in. */
export function cloudBox(c: CloudSpec, lumps: readonly Lump[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, c.y, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  // the smooth union of many overlapping parts swells past each one, by up to log(n)/BLEND of its radius
  const swell = 1 + Math.log(lumps.length + 1) / BLEND;
  const dome = domeOf(c);
  const reach = (x: number, y: number, z: number, rx: number, ry: number, rz: number): void => {
    min[0] = Math.min(min[0], x - rx * swell);
    min[2] = Math.min(min[2], z - rz * swell);
    max[0] = Math.max(max[0], x + rx * swell);
    max[1] = Math.max(max[1], y + ry * swell);
    max[2] = Math.max(max[2], z + rz * swell);
  };
  reach(dome.c[0], dome.c[1], dome.c[2], dome.r[0], dome.r[1], dome.r[2]);
  for (const l of lumps) reach(l.x, l.y, l.z, l.r, l.r, l.r);
  return { min, max };
}

/** The half-ellipsoid every cumulus is built on: flat base, rounded crown. Centre of its base, and radii. */
export function domeOf(c: CloudSpec): { c: [number, number, number]; r: [number, number, number] } {
  return { c: [c.x, c.y, c.z], r: [c.width * 0.44, c.height * 0.74, c.depth * 0.42] };
}

/** How far into the cloud's soft mass a point is: 0 outside, toward 1 at its core. Matches the shader. */
export function lumpField(lumps: readonly Lump[], spec: CloudSpec, x: number, y: number, z: number): number {
  const dome = domeOf(spec);
  const narrow = 1 - TAPER * Math.min(1, Math.max(0, (y - dome.c[1]) / dome.r[1]));
  let sum = Math.exp(BLEND * (1 - Math.hypot((x - dome.c[0]) / (dome.r[0] * narrow), (y - dome.c[1]) / dome.r[1], (z - dome.c[2]) / (dome.r[2] * narrow))));
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
