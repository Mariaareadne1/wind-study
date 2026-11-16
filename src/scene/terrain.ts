import { clamp, fbm, makeNoise } from './noise';

/** The painted world, in world units. The camera only ever frames a part of it. */
export const WORLD = { minX: -42, maxX: 42, minZ: -34, maxZ: 24 } as const;

const GRID = 3; // cells per world unit
const MARCH_STEP = 0.35;
const MARCH_MAX = 160;

export type HeightFn = (n: (x: number, y: number) => number, x: number, z: number) => number;

/**
 * Rolling meadow: a few broad, hand-placed swells plus very low-frequency
 * noise. Baked to a grid once, so the ground mesh, the grass roots and pointer
 * rays all agree without any height function being repeated in GLSL.
 */
export class Terrain {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;

  private readonly march: boolean;

  constructor(seed: number, heightFn: HeightFn = meadowHeight, march = false) {
    this.march = march;
    const n = makeNoise(seed + 11);
    this.nx = Math.ceil((WORLD.maxX - WORLD.minX) * GRID) + 1;
    this.nz = Math.ceil((WORLD.maxZ - WORLD.minZ) * GRID) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = WORLD.minZ + j / GRID;
      for (let i = 0; i < this.nx; i++) {
        const x = WORLD.minX + i / GRID;
        this.heights[i + j * this.nx] = heightFn(n, x, z);
      }
    }
  }

  height(x: number, z: number): number {
    const fx = clamp((x - WORLD.minX) * GRID, 0, this.nx - 1.001);
    const fz = clamp((z - WORLD.minZ) * GRID, 0, this.nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = this.heights;
    const a = i + j * this.nx;
    const top = h[a] + (h[a + 1] - h[a]) * u;
    const bot = h[a + this.nx] + (h[a + this.nx + 1] - h[a + this.nx]) * u;
    return top + (bot - top) * v;
  }

  /** Unit surface normal by central differences. */
  normal(x: number, z: number): [number, number, number] {
    const e = 0.5;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return [-dx / l, 1 / l, -dz / l];
  }

  /**
   * Where a downward-looking ray meets the ground. The hills are gentle, so
   * fixed-point iteration from the y=0 hit converges in a few steps.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): [number, number, number] | null {
    if (this.march) return this.marchRay(ox, oy, oz, dx, dy, dz);
    if (dy > -1e-4) return null;
    let t = -oy / dy;
    for (let i = 0; i < 6; i++) {
      const h = this.height(ox + dx * t, oz + dz * t);
      t = (h - oy) / dy;
    }
    return [ox + dx * t, oy + dy * t, oz + dz * t];
  }

  /**
   * First surface along a ray, so a nearer hill correctly hides what's behind it.
   * Returns null only if the ray leaves the painted world without touching land.
   */
  private marchRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): [number, number, number] | null {
    const l = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const uz = dz / l;
    let prev = 0;
    let t = MARCH_STEP;
    while (t < MARCH_MAX) {
      const x = ox + ux * t;
      const z = oz + uz * t;
      if (x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ) {
        if (uz < 0 ? z < WORLD.minZ : z > WORLD.maxZ) return null;
      } else if (oy + uy * t <= this.height(x, z)) {
        // refine between the last point above ground and the first below
        let a = prev;
        let b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          if (oy + uy * m <= this.height(ox + ux * m, oz + uz * m)) b = m;
          else a = m;
        }
        return [ox + ux * b, oy + uy * b, oz + uz * b];
      }
      prev = t;
      // steps can lengthen with distance: a far miss costs little on screen
      t += MARCH_STEP * (1 + t * 0.02);
    }
    return null;
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function bump(x: number, z: number, cx: number, cz: number, rx: number, rz: number, tilt: number): number {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const px = (x - cx) * c + (z - cz) * s;
  const pz = -(x - cx) * s + (z - cz) * c;
  return Math.exp(-((px * px) / (rx * rx) + (pz * pz) / (rz * rz)));
}

export function meadowHeight(n: (x: number, y: number) => number, x: number, z: number): number {
  // a few big, deliberately placed forms; the valley runs lower-left to upper-right
  let h = 0;
  h += 3.2 * bump(x, z, -15, -6, 12, 6.5, 0.5);
  h += 2.8 * bump(x, z, 15, 3, 10, 5.5, -0.55);
  h += 2.5 * bump(x, z, 8, -16, 14, 5.2, 0.2);
  h += 2.1 * bump(x, z, -8, 14, 11, 4.4, -0.25);
  h -= 1.4 * bump(x, z, 1, -3, 13, 3.6, 0.75);
  h += 0.75 * fbm(n, x * 0.04, z * 0.04, 2);
  return h;
}

/** How much the land has climbed by a given depth, before any individual hill. */
export function hillsClimb(z: number): number {
  return 9 * smooth(16, -33, z);
}

/** One long hill: a crest wandering across the view, with saddles along it. */
function ridge(n: (x: number, y: number) => number, x: number, z: number, z0: number, height: number, width: number, seed: number): number {
  const crest = z0 + 3.2 * Math.sin(x * 0.085 + seed) + 1.6 * Math.sin(x * 0.19 + seed * 2.3);
  const d = (z - crest) / width;
  const along = 0.62 + 0.75 * (n(x * 0.045 + seed * 7, seed * 3) + 0.5);
  return height * along * Math.exp(-d * d);
}

/**
 * Rolling hills seen from low down: ridges stacked one behind another, each
 * crest hiding the valley behind it, climbing until the land fills the frame.
 */
export function hillsHeight(n: (x: number, y: number) => number, x: number, z: number): number {
  let h = hillsClimb(z);
  h += ridge(n, x, z, 13, 2.0, 3.6, 0.4);
  h += ridge(n, x, z, 5, 3.6, 3.0, 1.7);
  h += ridge(n, x, z, -3, 4.2, 3.0, 3.1);
  h += ridge(n, x, z, -11, 4.6, 3.0, 4.6);
  h += ridge(n, x, z, -19, 5.0, 3.1, 2.2);
  h += ridge(n, x, z, -28, 6.5, 3.8, 5.9);
  h += 0.5 * fbm(n, x * 0.07, z * 0.07, 2);
  return h;
}

/** The dirt track across the foreground of the sunlit slope: 1 on the track, 0 in the grass. */
export function sunlitPathCentre(x: number): number {
  return 12.2 + 0.8 * Math.sin(x * 0.065 + 0.6) + 0.35 * Math.sin(x * 0.17);
}

export function sunlitPath(x: number, z: number): number {
  return smooth(0.6, 0.22, Math.abs(z - sunlitPathCentre(x)));
}

/**
 * A long slope climbing away from a flat strip, like a hillside seen from across
 * a lane: big enough to fill the frame, with broad swells for the light to roll over.
 */
export function sunlitHeight(n: (x: number, y: number) => number, x: number, z: number): number {
  const k = (8.5 - z) / 3;
  const softplus = k > 12 ? k : Math.log(1 + Math.exp(k));
  let h = 1.25 * softplus;
  h += 1.4 * smooth(7, -12, z) * fbm(n, x * 0.045 + 3, z * 0.06, 3);
  h += 1.2 * bump(x, z, -14, -6, 10, 7, 0.4) - 0.9 * bump(x, z, 10, -2, 8, 6, -0.3) + 1.1 * bump(x, z, 18, -16, 12, 7, 0.2);
  h += 0.12 * fbm(n, x * 0.3, z * 0.3, 2);
  return h;
}
