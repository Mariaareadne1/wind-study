import { clamp, fbm, makeNoise } from './noise';

/** The painted world, in world units. The camera only ever frames a part of it. */
export const WORLD = { minX: -42, maxX: 42, minZ: -34, maxZ: 24 } as const;

const GRID = 3; // cells per world unit

/**
 * Rolling meadow: a few broad, hand-placed swells plus very low-frequency
 * noise. Baked to a grid once, so the ground mesh, the grass roots and pointer
 * rays all agree without any height function being repeated in GLSL.
 */
export class Terrain {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;

  constructor(seed: number) {
    const n = makeNoise(seed + 11);
    this.nx = Math.ceil((WORLD.maxX - WORLD.minX) * GRID) + 1;
    this.nz = Math.ceil((WORLD.maxZ - WORLD.minZ) * GRID) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      const z = WORLD.minZ + j / GRID;
      for (let i = 0; i < this.nx; i++) {
        const x = WORLD.minX + i / GRID;
        this.heights[i + j * this.nx] = rawHeight(n, x, z);
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
    if (dy > -1e-4) return null;
    let t = -oy / dy;
    for (let i = 0; i < 6; i++) {
      const h = this.height(ox + dx * t, oz + dz * t);
      t = (h - oy) / dy;
    }
    return [ox + dx * t, oy + dy * t, oz + dz * t];
  }
}

function bump(x: number, z: number, cx: number, cz: number, rx: number, rz: number, tilt: number): number {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const px = (x - cx) * c + (z - cz) * s;
  const pz = -(x - cx) * s + (z - cz) * c;
  return Math.exp(-((px * px) / (rx * rx) + (pz * pz) / (rz * rz)));
}

function rawHeight(n: (x: number, y: number) => number, x: number, z: number): number {
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
