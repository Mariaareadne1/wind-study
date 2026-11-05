import { fbm, makeNoise, smoothstep } from '../scene/noise';
import { FIELD, NX, NZ } from './grid';

const COARSE = 4; // one coarse sample per this many field cells

/**
 * The breath of the meadow before anyone draws: a slow, patchy, coherent breeze.
 * Sampled coarsely and interpolated, it stays smooth and costs almost nothing.
 * Time moves it through non-repeating noise, so it never visibly loops.
 */
export class AmbientWind {
  readonly u = new Float32Array(NX * NZ);
  readonly v = new Float32Array(NX * NZ);
  /** Multiplies the whole breeze: reduced motion turns it right down. */
  amount = 1;
  private readonly cx = Math.ceil(NX / COARSE) + 2;
  private readonly cz = Math.ceil(NZ / COARSE) + 2;
  private readonly cu = new Float32Array(this.cx * this.cz);
  private readonly cv = new Float32Array(this.cx * this.cz);
  private readonly dirNoise: ReturnType<typeof makeNoise>;
  private readonly gustNoise: ReturnType<typeof makeNoise>;

  constructor(seed: number) {
    this.dirNoise = makeNoise(seed + 301);
    this.gustNoise = makeNoise(seed + 302);
  }

  update(time: number): void {
    const { cx, cz, cu, cv } = this;
    // the prevailing air drifts from upper left toward lower right, and wanders over minutes
    const prevailing = 0.55 + 0.5 * this.dirNoise(time * 0.013, 4.2);
    const px = Math.cos(prevailing);
    const pz = Math.sin(prevailing);
    const travel = time * 0.85;
    for (let j = 0; j < cz; j++) {
      const z = FIELD.minZ + j * COARSE * FIELD.cell;
      for (let i = 0; i < cx; i++) {
        const x = FIELD.minX + i * COARSE * FIELD.cell;
        // broad soft patches of moving air pass over in the prevailing direction
        const sx = x - px * travel;
        const sz = z - pz * travel;
        const patch = fbm(this.gustNoise, sx * 0.055, sz * 0.055 + time * 0.02, 3);
        const strength = 0.12 + 0.95 * smoothstep(-0.12, 0.42, patch);
        const wander = fbm(this.dirNoise, sx * 0.03 + 9, sz * 0.03 + time * 0.016, 2) * 1.2;
        const c = Math.cos(wander);
        const s = Math.sin(wander);
        cu[i + j * cx] = (px * c - pz * s) * strength;
        cv[i + j * cx] = (px * s + pz * c) * strength;
      }
    }
    const { u, v, amount } = this;
    for (let j = 0; j < NZ; j++) {
      const fj = j / COARSE;
      const j0 = fj | 0;
      const t = fj - j0;
      for (let i = 0; i < NX; i++) {
        const fi = i / COARSE;
        const i0 = fi | 0;
        const s = fi - i0;
        const a = i0 + j0 * cx;
        const w00 = (1 - s) * (1 - t);
        const w10 = s * (1 - t);
        const w01 = (1 - s) * t;
        const w11 = s * t;
        const k = i + j * NX;
        u[k] = amount * (cu[a] * w00 + cu[a + 1] * w10 + cu[a + cx] * w01 + cu[a + cx + 1] * w11);
        v[k] = amount * (cv[a] * w00 + cv[a + 1] * w10 + cv[a + cx] * w01 + cv[a + cx + 1] * w11);
      }
    }
  }

  reset(): void {
    this.u.fill(0);
    this.v.fill(0);
  }
}
