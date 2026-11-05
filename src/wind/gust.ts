import { clamp, mix, smoothstep } from '../scene/noise';
import { RESAMPLE_SPACING, resampleInto, totalTurning, type StrokePoint } from '../interaction/stroke';
import type { WindField } from './field';

/** Spirals are recognised once a stroke has turned this far around a compact centre. */
const VORTEX_TURNING = Math.PI * 1.6;
const TAP_LENGTH = 0.9;
/** Length of path behind the gust's head that is still pushing, world units. */
const TRAIL_SLOW = 9;
const TRAIL_FAST = 4.5;
/** Past its end, a gust's head runs on along its last direction before dying away. */
const OVERRUN = 7;

export type GustKind = 'stroke' | 'whirl' | 'breath';

let nextId = 1;

/**
 * One gesture's wind. A gust owns a smoothed path and a "head" that runs along it
 * no faster than the air could carry it, pushing the air along the local tangent
 * as it goes. While the pointer is down the head chases the pointer, so a slow
 * stroke responds at once; a fast flick outruns it, and the head catches up over
 * the next half-second, which is why a flick still travels instead of flashing.
 * After release it runs on past the end and dies away.
 */
export class Gust {
  readonly id = nextId++;
  readonly points: StrokePoint[] = [];
  /** Arc length of the head along `points`. */
  head = 0;
  drawing = true;
  /** Seconds since release; negative while drawing. */
  released = -1;
  age = 0;
  gain: number;
  /** Peak speed the pointer has moved, world units per second (smoothed). */
  pointerSpeed = 0;
  // vortex state (from spirals)
  vortex: { x: number; z: number; spin: number; radius: number; left: number } | null = null;
  // a tap makes a little radial breath instead of a path
  breathDone = false;
  private lastPush = 0;
  /** Smoothed speed of the head, world units per second. */
  private travel = 0;

  constructor(gain: number) {
    this.gain = gain;
  }

  get arcLength(): number {
    return Math.max(0, this.points.length - 1) * RESAMPLE_SPACING;
  }

  get kind(): GustKind {
    if (this.vortex) return 'whirl';
    if (!this.drawing && this.arcLength < TAP_LENGTH) return 'breath';
    return 'stroke';
  }

  addPoint(x: number, z: number, dt: number, y?: number): void {
    const before = this.arcLength;
    if (this.points.length === 0) {
      this.points.push(y === undefined ? { x, z } : { x, z, y });
      return;
    }
    const last = this.points[this.points.length - 1];
    const moved = Math.hypot(x - last.x, z - last.z);
    resampleInto(this.points, x, z, RESAMPLE_SPACING, y);
    if (dt > 0) {
      const instant = moved / dt;
      // rises quickly, falls slowly: a flick stays a flick
      this.pointerSpeed += (instant - this.pointerSpeed) * (instant > this.pointerSpeed ? 0.35 : 0.04);
    }
    if (this.arcLength > before) this.detectVortex();
  }

  release(): void {
    this.drawing = false;
    this.released = 0;
  }

  /** Stop pushing now. The air it already moved is left to the field. */
  silence(): void {
    this.drawing = false;
    this.head = this.arcLength + OVERRUN + TRAIL_SLOW;
    this.released = Math.max(this.released, 0);
    this.vortex = null;
    this.breathDone = true;
  }

  get finished(): boolean {
    if (this.drawing || this.vortex) return false;
    if (this.kind === 'breath') return this.breathDone;
    return this.head >= this.arcLength + OVERRUN + this.trail();
  }

  /** How broad the gust is. Slow strokes are wide and gentle; quick ones narrow and sharp. */
  radius(): number {
    // stronger wind also takes a wider swath; at the default gain this factor is exactly 1
    const swath = clamp(0.6 + 0.4 * this.gain, 0.75, 1.75);
    return mix(3.6, 2.3, smoothstep(6, 50, this.pointerSpeed)) * swath;
  }

  trail(): number {
    return mix(TRAIL_SLOW, TRAIL_FAST, smoothstep(10, 60, this.pointerSpeed));
  }

  /** Top speed of the head, world units per second. */
  headSpeed(): number {
    return clamp(15 + this.pointerSpeed * 0.32, 15, 34);
  }

  /** Strength of the push, bounded however fast the pointer flew. */
  force(): number {
    const speedTerm = 0.72 + 0.62 * smoothstep(2, 45, this.pointerSpeed);
    const lengthTerm = 0.55 + 0.45 * smoothstep(2, 10, this.arcLength);
    return speedTerm * lengthTerm * this.gain;
  }

  step(field: WindField, dt: number): void {
    this.age += dt;
    if (!this.drawing) this.released += dt;
    if (this.kind === 'breath') return; // handled at release by WindSim
    if (this.points.length < 2) return;

    const target = this.drawing ? this.arcLength : this.arcLength + OVERRUN + this.trail();
    const maxStep = this.headSpeed() * dt;
    const before = this.head;
    this.head = Math.min(this.head + maxStep, Math.max(this.head, target));
    // Energy per unit of path, not per unit of time: without this a slow stroke
    // would dwell, pile up force and blow harder than a fast one. The floor keeps
    // a held pointer gently alive.
    const v = (this.head - before) / dt;
    this.travel += (v - this.travel) * 0.2;
    this.pushAir(field, dt);
    this.stepVortex(field, dt);
  }

  private pushAir(field: WindField, dt: number): void {
    const trail = this.trail();
    const radius = this.radius();
    const force = this.force() * ACCEL * clamp(this.travel / HEAD_REF, 0.12, 1.7);
    const n = this.points.length;
    const arc = this.arcLength;
    const every = 2; // every other sample is plenty: the splats overlap broadly
    const headIdx = Math.min(this.head / RESAMPLE_SPACING, n - 1);
    const start = Math.max(0, Math.floor((this.head - trail) / RESAMPLE_SPACING));
    const phase = this.lastPush++ % every;
    for (let i = start + phase; i <= headIdx; i += every) {
      const s = i * RESAMPLE_SPACING;
      const behind = this.head - s;
      // soft onset at the head, long fading tail behind it
      const front = smoothstep(0, 1.8, behind + 0.25);
      const tail = 1 - smoothstep(trail * 0.35, trail, behind);
      const ends = smoothstep(0, 1.2, s + 0.3);
      const e = front * tail * ends;
      if (e < 0.01) continue;
      const a = this.points[Math.max(0, i - 2)];
      const b = this.points[Math.min(n - 1, i + 2)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const k = (force * e * dt * every * RESAMPLE_SPACING) / l;
      field.splat(this.points[i].x, this.points[i].z, dx * k, dz * k, radius);
    }
    // past the end: the head coasts on along its final direction, weakening
    if (!this.drawing && this.head > arc && n >= 3) {
      const a = this.points[Math.max(0, n - 6)];
      const b = this.points[n - 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const over = this.head - arc;
      const fade = 1 - smoothstep(0, OVERRUN, over);
      const k = force * fade * fade * dt * 3 * RESAMPLE_SPACING * 3;
      field.splat(b.x + (dx / l) * over, b.z + (dz / l) * over, (dx / l) * k, (dz / l) * k, radius * 1.15);
    }
  }

  private stepVortex(field: WindField, dt: number): void {
    const v = this.vortex;
    if (!v) return;
    if (!this.drawing) v.left -= dt;
    if (v.left <= 0) {
      this.vortex = null;
      return;
    }
    const k = smoothstep(0, 1.2, v.left);
    field.splatVortex(v.x, v.z, v.spin * k * dt * this.gain, v.radius);
  }

  private detectVortex(): void {
    if (this.points.length < 24) return;
    const turning = totalTurning(this.points);
    if (Math.abs(turning) < VORTEX_TURNING) return;
    // a spiral stays compact: its extent is small for its length
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let sx = 0;
    let sz = 0;
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
      sx += p.x;
      sz += p.z;
    }
    const extent = Math.max(maxX - minX, maxZ - minZ);
    if (this.arcLength < extent * 1.7) return;
    const cx = sx / this.points.length;
    const cz = sz / this.points.length;
    const radius = clamp(extent * 0.5, 2.2, 8);
    const spin = Math.sign(turning) * VORTEX_SPIN;
    if (this.vortex) {
      this.vortex.x = cx;
      this.vortex.z = cz;
      this.vortex.radius = radius;
      this.vortex.spin = spin;
      this.vortex.left = VORTEX_LIFE;
    } else {
      this.vortex = { x: cx, z: cz, spin, radius, left: VORTEX_LIFE };
    }
  }
}

/** Push along a path, in acceleration per unit length of path that's active. */
const ACCEL = 30;
/** Head speed at which a path gets its nominal push. */
const HEAD_REF = 20;
const VORTEX_SPIN = 30;
const VORTEX_LIFE = 2.0;
