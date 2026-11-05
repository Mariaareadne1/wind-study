import { NX, NZ } from './grid';

export interface SpringTuning {
  /** Natural frequency, Hz. */
  freq: number;
  /** Damping ratio; below 1 overshoots a little and settles softly. */
  damping: number;
}

/** How long lingering flutter takes to fade, seconds. */
const ENERGY_DECAY = 2.4;
/** Wind speed that gives a bend of 0.5 (world units per second). */
export const WIND_REF = 7.5;
/** Bend reached at infinite wind. In radians of arc along the strand, before the soft limit. */
export const MAX_BEND = 2.3;

/**
 * Grass inertia, solved per field cell rather than per strand. Each cell carries
 * two damped springs: a slow one read by tall soft strands, a brisk one read by
 * short stiff strands. Blending them in the vertex shader gives every strand its
 * own timing while staying spatially continuous. Tall tufts answer a little
 * late, overshoot a little, and settle gently. Nothing here ever touches a blade.
 */
export class GrassResponse {
  /** softX, softZ, stiffX, stiffZ per cell. */
  readonly bend = new Float32Array(NX * NZ * 4);
  private readonly vel = new Float32Array(NX * NZ * 4);
  /** Flutter energy: rises with wind, fades slowly so tips keep trembling after a gust. */
  readonly energy = new Float32Array(NX * NZ);
  soft: SpringTuning = { freq: 0.82, damping: 0.5 };
  stiff: SpringTuning = { freq: 1.55, damping: 0.62 };

  reset(): void {
    this.bend.fill(0);
    this.vel.fill(0);
    this.energy.fill(0);
  }

  /** Kick the slow and quick springs directly: used by a tap's small radial breath. */
  impulse(at: (i: number, j: number) => [number, number]): void {
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const [x, z] = at(i, j);
        if (x === 0 && z === 0) continue;
        const b = (i + j * NX) * 4;
        this.vel[b] += x;
        this.vel[b + 1] += z;
        this.vel[b + 2] += x * 1.2;
        this.vel[b + 3] += z * 1.2;
      }
    }
  }

  step(windU: Float32Array, windV: Float32Array, dt: number): void {
    const { bend, vel, energy } = this;
    const w1 = 2 * Math.PI * this.soft.freq;
    const w2 = 2 * Math.PI * this.stiff.freq;
    const k1 = w1 * w1;
    const k2 = w2 * w2;
    const c1 = 2 * this.soft.damping * w1;
    const c2 = 2 * this.stiff.damping * w2;
    const fade = Math.exp(-dt / ENERGY_DECAY);
    for (let a = 0; a < energy.length; a++) {
      const wu = windU[a];
      const wv = windV[a];
      const speed = Math.sqrt(wu * wu + wv * wv);
      // force saturates, so a gale leans the grass over without folding it flat
      const sat = (MAX_BEND / WIND_REF) / (1 + speed / WIND_REF);
      const tx = wu * sat;
      const tz = wv * sat;
      const b = a * 4;
      // semi-implicit Euler is stable here for any sensible dt
      vel[b] += dt * (k1 * (tx - bend[b]) - c1 * vel[b]);
      vel[b + 1] += dt * (k1 * (tz - bend[b + 1]) - c1 * vel[b + 1]);
      vel[b + 2] += dt * (k2 * (tx - bend[b + 2]) - c2 * vel[b + 2]);
      vel[b + 3] += dt * (k2 * (tz - bend[b + 3]) - c2 * vel[b + 3]);
      bend[b] += dt * vel[b];
      bend[b + 1] += dt * vel[b + 1];
      bend[b + 2] += dt * vel[b + 2];
      bend[b + 3] += dt * vel[b + 3];
      const stirred = Math.min(speed / WIND_REF, 1.4);
      energy[a] = Math.max(energy[a] * fade, stirred > energy[a] ? energy[a] + (stirred - energy[a]) * dt * 3.5 : 0);
    }
  }
}
