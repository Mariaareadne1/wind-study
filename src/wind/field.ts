import { FIELD, NX as GRID_NX, NZ as GRID_NZ, sampleGrid } from './grid';

const NX: number = GRID_NX;
const NZ: number = GRID_NZ;
const CELL: number = FIELD.cell;
const MIN_X: number = FIELD.minX;
const MIN_Z: number = FIELD.minZ;

const JACOBI_ITERATIONS = 8;
/**
 * How much of the pressure correction is applied. A full projection sends the
 * air back in two big lobes beside a stroke, stronger than the stroke itself;
 * a partial one keeps a soft curl at the edges and lets the gust stay a ribbon.
 */
const PROJECTION = 0.24;
/** Wind faster than this is softly compressed, so nothing can blow up. */
export const MAX_WIND = 34;

export interface FieldTuning {
  /** Seconds for still air to shed 63% of its motion. */
  drag: number;
  /** Viscous spreading per step, 0..0.25. */
  viscosity: number;
}

export const DEFAULT_FIELD_TUNING: FieldTuning = { drag: 1.7, viscosity: 0.09 };

/**
 * The air over the meadow: a small incompressible 2D fluid (Stam-style, semi-
 * Lagrangian) on a coarse grid. A push along a stroke carries itself forward,
 * spreads, and curls back on itself at its edges, which is what makes a gust feel
 * like weather instead of an animation. The pressure solve stops after a few
 * sweeps and is only partly applied, on purpose: influence reaches a handful of
 * cells and no further, so a gust never moves the whole field at once.
 */
export class WindField {
  u = new Float32Array(NX * NZ);
  v = new Float32Array(NX * NZ);
  private u2 = new Float32Array(NX * NZ);
  private v2 = new Float32Array(NX * NZ);
  private pressure = new Float32Array(NX * NZ);
  private divergence = new Float32Array(NX * NZ);
  /** Extra local stilling, 1/s. Used by undo and clear. */
  readonly quench = new Float32Array(NX * NZ);
  private readonly sponge = new Float32Array(NX * NZ);
  tuning: FieldTuning = { ...DEFAULT_FIELD_TUNING };

  constructor() {
    // edges of the grid soak up wind instead of reflecting it
    const band = 10;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const e = Math.min(i, j, NX - 1 - i, NZ - 1 - j);
        const t = Math.max(0, 1 - e / band);
        this.sponge[i + j * NX] = t * t * 6;
      }
    }
  }

  reset(): void {
    this.u.fill(0);
    this.v.fill(0);
    this.pressure.fill(0);
    this.quench.fill(0);
  }

  /** Add a soft Gaussian push (acceleration × dt) centred at a world position. */
  splat(x: number, z: number, fx: number, fz: number, radius: number): void {
    const cx = (x - MIN_X) / CELL - 0.5;
    const cz = (z - MIN_Z) / CELL - 0.5;
    const r = radius / CELL;
    const reach = Math.ceil(r * 2.6);
    const i0 = Math.max(1, Math.floor(cx - reach));
    const i1 = Math.min(NX - 2, Math.ceil(cx + reach));
    const j0 = Math.max(1, Math.floor(cz - reach));
    const j1 = Math.min(NZ - 2, Math.ceil(cz + reach));
    const k = 1 / (r * r);
    for (let j = j0; j <= j1; j++) {
      const dz = j - cz;
      for (let i = i0; i <= i1; i++) {
        const dx = i - cx;
        const w = Math.exp(-(dx * dx + dz * dz) * k);
        const a = i + j * NX;
        this.u[a] += fx * w;
        this.v[a] += fz * w;
      }
    }
  }

  /** Add a rotating push around a centre: the heart of a whirl. Positive spin is counter-clockwise in x-z. */
  splatVortex(x: number, z: number, spin: number, radius: number): void {
    const cx = (x - MIN_X) / CELL - 0.5;
    const cz = (z - MIN_Z) / CELL - 0.5;
    const r = radius / CELL;
    const reach = Math.ceil(r * 2.6);
    const i0 = Math.max(1, Math.floor(cx - reach));
    const i1 = Math.min(NX - 2, Math.ceil(cx + reach));
    const j0 = Math.max(1, Math.floor(cz - reach));
    const j1 = Math.min(NZ - 2, Math.ceil(cz + reach));
    const k = 1 / (r * r);
    for (let j = j0; j <= j1; j++) {
      const dz = j - cz;
      for (let i = i0; i <= i1; i++) {
        const dx = i - cx;
        const w = Math.exp(-(dx * dx + dz * dz) * k) * (1 / r);
        const a = i + j * NX;
        this.u[a] += -dz * spin * w;
        this.v[a] += dx * spin * w;
      }
    }
  }

  /** Add local stilling, used to calm the air along a path. */
  splatQuench(x: number, z: number, amount: number, radius: number): void {
    const cx = (x - MIN_X) / CELL - 0.5;
    const cz = (z - MIN_Z) / CELL - 0.5;
    const r = radius / CELL;
    const reach = Math.ceil(r * 2.6);
    const i0 = Math.max(1, Math.floor(cx - reach));
    const i1 = Math.min(NX - 2, Math.ceil(cx + reach));
    const j0 = Math.max(1, Math.floor(cz - reach));
    const j1 = Math.min(NZ - 2, Math.ceil(cz + reach));
    const k = 1 / (r * r);
    for (let j = j0; j <= j1; j++) {
      const dz = j - cz;
      for (let i = i0; i <= i1; i++) {
        const dx = i - cx;
        const a = i + j * NX;
        this.quench[a] = Math.max(this.quench[a], amount * Math.exp(-(dx * dx + dz * dz) * k));
      }
    }
  }

  quenchAll(amount: number): void {
    this.quench.fill(amount);
  }

  step(dt: number): void {
    this.advect(dt);
    this.diffuse();
    this.project();
    this.dissipate(dt);
  }

  /** Wind at a world position, for tests and inspection. */
  sample(x: number, z: number): [number, number] {
    return [sampleGrid(this.u, x, z), sampleGrid(this.v, x, z)];
  }

  private advect(dt: number): void {
    const { u, v, u2, v2 } = this;
    const k = dt / CELL;
    for (let j = 1; j < NZ - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const a = i + j * NX;
        let x = i - u[a] * k;
        let y = j - v[a] * k;
        x = x < 0.5 ? 0.5 : x > NX - 1.5 ? NX - 1.5 : x;
        y = y < 0.5 ? 0.5 : y > NZ - 1.5 ? NZ - 1.5 : y;
        const x0 = x | 0;
        const y0 = y | 0;
        const s = x - x0;
        const t = y - y0;
        const b = x0 + y0 * NX;
        const w00 = (1 - s) * (1 - t);
        const w10 = s * (1 - t);
        const w01 = (1 - s) * t;
        const w11 = s * t;
        u2[a] = u[b] * w00 + u[b + 1] * w10 + u[b + NX] * w01 + u[b + NX + 1] * w11;
        v2[a] = v[b] * w00 + v[b + 1] * w10 + v[b + NX] * w01 + v[b + NX + 1] * w11;
      }
    }
    this.u = u2;
    this.v = v2;
    this.u2 = u;
    this.v2 = v;
  }

  private diffuse(): void {
    const { u, v, u2, v2 } = this;
    const nu = this.tuning.viscosity;
    for (let j = 1; j < NZ - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const a = i + j * NX;
        u2[a] = u[a] + nu * (u[a - 1] + u[a + 1] + u[a - NX] + u[a + NX] - 4 * u[a]);
        v2[a] = v[a] + nu * (v[a - 1] + v[a + 1] + v[a - NX] + v[a + NX] - 4 * v[a]);
      }
    }
    this.u = u2;
    this.v = v2;
    this.u2 = u;
    this.v2 = v;
  }

  private project(): void {
    const { u, v, pressure: p, divergence: d } = this;
    for (let j = 1; j < NZ - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const a = i + j * NX;
        d[a] = 0.5 * (u[a + 1] - u[a - 1] + v[a + NX] - v[a - NX]);
      }
    }
    // warm-started, in place (Gauss-Seidel flavoured Jacobi: faster and allocation-free)
    for (let it = 0; it < JACOBI_ITERATIONS; it++) {
      for (let j = 1; j < NZ - 1; j++) {
        for (let i = 1; i < NX - 1; i++) {
          const a = i + j * NX;
          p[a] = 0.25 * (p[a - 1] + p[a + 1] + p[a - NX] + p[a + NX] - d[a]);
        }
      }
    }
    for (let j = 1; j < NZ - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const a = i + j * NX;
        u[a] -= PROJECTION * 0.5 * (p[a + 1] - p[a - 1]);
        v[a] -= PROJECTION * 0.5 * (p[a + NX] - p[a - NX]);
      }
    }
  }

  private dissipate(dt: number): void {
    const { u, v, pressure, sponge, quench } = this;
    const base = 1 / this.tuning.drag;
    const quenchDecay = Math.exp(-dt * 2.2);
    for (let a = 0; a < u.length; a++) {
      const damp = Math.exp(-dt * (base + sponge[a] + quench[a]));
      let wu = u[a] * damp;
      let wv = v[a] * damp;
      // smooth speed limit: leaves ordinary wind alone and bends the curve only near the ceiling
      const s2 = wu * wu + wv * wv;
      if (s2 > 100) {
        const s = Math.sqrt(s2);
        const over = s / MAX_WIND;
        const limited = s / Math.sqrt(Math.sqrt(1 + over * over * over * over));
        wu *= limited / s;
        wv *= limited / s;
      }
      // flush the vanishing tail: denormals are slow and mean nothing here
      u[a] = wu > 1e-6 || wu < -1e-6 ? wu : 0;
      v[a] = wv > 1e-6 || wv < -1e-6 ? wv : 0;
      const pr = pressure[a] * 0.985;
      pressure[a] = pr > 1e-6 || pr < -1e-6 ? pr : 0;
      quench[a] = quench[a] > 1e-3 ? quench[a] * quenchDecay : 0;
    }
  }
}
