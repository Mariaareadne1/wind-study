import { clamp } from '../scene/noise';
import { AmbientWind } from './ambient';
import { DEFAULT_FIELD_TUNING, WindField } from './field';
import { Gust } from './gust';
import { FIELD as FIELD_CONST, NX, NZ, sampleGridStrided as sampleGrid4 } from './grid';
import { GrassResponse, SOFT_FREQ, STIFF_FREQ } from './response';
import type { Tuning } from '../state/tuning';

export const SIM_DT = 1 / 60;
/** After a stall, drop time rather than fast-forward through it. */
const MAX_STEPS_PER_FRAME = 4;

/**
 * The whole weather: gusts push the air, ambient breeze is added on top, and
 * the grass springs follow the sum. Runs on a fixed clock, so every frame rate
 * gets the same wind.
 */
export class WindSim {
  readonly field = new WindField();
  readonly ambient: AmbientWind;
  readonly response = new GrassResponse();
  readonly gusts: Gust[] = [];
  /** Sim seconds elapsed. Drives flutter and cloud shadows too. */
  time = 0;
  steps = 0;
  paused = false;
  /** Interpolation fraction between the previous and current fixed step. */
  alpha = 1;
  /** Bumps every step; renderers use it to upload only what changed. */
  private acc = 0;
  /** Total wind this step (air + breeze), per cell. */
  readonly totalU = new Float32Array(NX * NZ);
  readonly totalV = new Float32Array(NX * NZ);
  onStep: (() => void) | null = null;

  constructor(seed: number) {
    this.ambient = new AmbientWind(seed);
    this.ambient.update(0);
  }

  /** Everything here takes effect at once, on wind already blowing. Stroke force is applied per stroke. */
  applyTuning(t: Tuning, breezeScale = 1): void {
    this.response.soft.freq = SOFT_FREQ * t.sway;
    this.response.stiff.freq = STIFF_FREQ * t.sway;
    this.response.linger = t.linger;
    this.field.tuning.drag = DEFAULT_FIELD_TUNING.drag * t.linger;
    this.ambient.amount = t.breeze * breezeScale;
  }

  begin(gain: number): Gust {
    const g = new Gust(gain);
    this.gusts.push(g);
    return g;
  }

  /** Release a gust. A tap becomes a tiny breath: a soft ring that leans outward and settles. */
  end(g: Gust): void {
    g.release();
    if (g.kind === 'breath' && !g.breathDone && g.points.length > 0) {
      const p = g.points[0];
      this.breath(p.x, p.z, g.gain);
      g.breathDone = true;
    }
  }

  /** A direct nudge to the springs, outward from a point. It does not go through the air. */
  breath(x: number, z: number, gain: number): void {
    const { cell, minX, minZ } = FIELD_CONST;
    const radius = 2.1;
    const r2 = radius * radius;
    const i0 = clamp(Math.floor((x - radius * 2 - minX) / cell), 0, NX - 1);
    const i1 = clamp(Math.ceil((x + radius * 2 - minX) / cell), 0, NX - 1);
    const j0 = clamp(Math.floor((z - radius * 2 - minZ) / cell), 0, NZ - 1);
    const j1 = clamp(Math.ceil((z + radius * 2 - minZ) / cell), 0, NZ - 1);
    this.response.impulse((i, j) => {
      if (i < i0 || i > i1 || j < j0 || j > j1) return [0, 0];
      const dx = minX + (i + 0.5) * cell - x;
      const dz = minZ + (j + 0.5) * cell - z;
      const d2 = dx * dx + dz * dz;
      const w = (Math.sqrt(d2) / radius) * Math.exp(-d2 / r2) * 5.5 * gain;
      const d = Math.sqrt(d2) || 1;
      return [(dx / d) * w, (dz / d) * w];
    });
  }

  /** Stop the latest gust that is still blowing and still the air along its path. */
  undoLatest(): Gust | null {
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      if (g.finished) continue;
      for (let k = 0; k < g.points.length; k += 4) {
        this.field.splatQuench(g.points[k].x, g.points[k].z, 4.5, g.radius() * 1.4);
      }
      if (g.vortex) this.field.splatQuench(g.vortex.x, g.vortex.z, 4.5, g.vortex.radius * 1.8);
      g.silence();
      this.gusts.splice(i, 1);
      return g;
    }
    return null;
  }

  /** Remove every gust; the ambient breeze stays. Grass settles on its own springs. */
  clear(): void {
    for (const g of this.gusts) g.silence();
    this.gusts.length = 0;
    this.field.quenchAll(3.5);
  }

  reset(): void {
    this.gusts.length = 0;
    this.field.reset();
    this.response.reset();
    this.time = 0;
    this.acc = 0;
    this.alpha = 1;
    this.steps = 0;
    this.ambient.update(0);
  }

  get activeGusts(): number {
    let n = 0;
    for (const g of this.gusts) if (!g.finished) n++;
    return n;
  }

  /** Advance by a wall-clock delta. A pause or a stalled tab costs no catch-up. */
  advance(delta: number): void {
    if (this.paused) return;
    this.acc += Math.min(delta, SIM_DT * MAX_STEPS_PER_FRAME);
    while (this.acc >= SIM_DT) {
      this.step();
      this.acc -= SIM_DT;
    }
    this.alpha = clamp(this.acc / SIM_DT, 0, 1);
  }

  step(): void {
    const dt = SIM_DT;
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      g.step(this.field, dt);
      if (g.finished) this.gusts.splice(i, 1);
    }
    this.field.step(dt);
    this.time += dt;
    this.ambient.update(this.time);
    const { totalU, totalV, ambient, field } = this;
    for (let a = 0; a < totalU.length; a++) {
      totalU[a] = field.u[a] + ambient.u[a];
      totalV[a] = field.v[a] + ambient.v[a];
    }
    this.response.step(totalU, totalV, dt);
    this.steps++;
    this.onStep?.();
  }

  /** Bend of the slow spring at a world position (for tests and inspection). */
  bendAt(x: number, z: number): [number, number] {
    return [sampleGrid4(this.response.bend, 0, x, z), sampleGrid4(this.response.bend, 1, x, z)];
  }
}
