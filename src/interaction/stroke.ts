export interface StrokePoint {
  x: number;
  z: number;
}

/** Fine spacing of resampled stroke points, world units. */
export const RESAMPLE_SPACING = 0.32;

/**
 * Pointer smoothing with very little lag: a one-pole filter whose cut-off rises
 * with speed (the One Euro idea). Slow careful strokes lose their jitter; quick
 * ones track the finger.
 */
export class PointerSmoother {
  private x = 0;
  private y = 0;
  private started = false;

  push(x: number, y: number, dt: number): [number, number] {
    if (!this.started) {
      this.started = true;
      this.x = x;
      this.y = y;
      return [x, y];
    }
    const speed = Math.hypot(x - this.x, y - this.y) / Math.max(dt, 1e-3);
    const cutoff = 4 + speed * 0.05; // Hz, speed in px/s
    const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * Math.max(dt, 1e-3));
    this.x += (x - this.x) * alpha;
    this.y += (y - this.y) * alpha;
    return [this.x, this.y];
  }
}

/** Appends points to a polyline at even arc-length spacing. Returns how many were added. */
export function resampleInto(out: StrokePoint[], x: number, z: number, spacing = RESAMPLE_SPACING): number {
  if (out.length === 0) {
    out.push({ x, z });
    return 1;
  }
  let added = 0;
  let last = out[out.length - 1];
  let d = Math.hypot(x - last.x, z - last.z);
  while (d >= spacing) {
    const t = spacing / d;
    last = { x: last.x + (x - last.x) * t, z: last.z + (z - last.z) * t };
    out.push(last);
    added++;
    d = Math.hypot(x - last.x, z - last.z);
  }
  return added;
}

/** Sum of signed turning along a polyline, radians, reading every `step`th point. */
export function totalTurning(points: readonly StrokePoint[], step = 3): number {
  let sum = 0;
  let prev: number | null = null;
  for (let i = step; i < points.length; i += step) {
    const a = Math.atan2(points[i].z - points[i - step].z, points[i].x - points[i - step].x);
    if (prev !== null) {
      let d = a - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      sum += d;
    }
    prev = a;
  }
  return sum;
}
