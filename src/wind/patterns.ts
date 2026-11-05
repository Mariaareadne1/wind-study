export type Point2 = [number, number];
export type PatternName = 'sweep' | 'spiral' | 'flick' | 'crossing' | 'wave';

export interface ScriptedStroke {
  /** World points, one per fixed sim step. */
  points: Point2[];
  /** Sim steps to wait before this stroke starts. */
  delay?: number;
}

function resample(pts: Point2[], steps: number): Point2[] {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lengths[lengths.length - 1];
  const out: Point2[] = [];
  let k = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i / (steps - 1)) * total;
    while (k < lengths.length - 2 && lengths[k + 1] < s) k++;
    const span = lengths[k + 1] - lengths[k] || 1;
    const t = (s - lengths[k]) / span;
    out.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t]);
  }
  return out;
}

function curve(a: Point2, b: Point2, c: Point2, d: Point2, steps: number): Point2[] {
  const dense: Point2[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const m = 1 - t;
    dense.push([
      m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * d[0],
      m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return resample(dense, steps);
}

export function spiralPoints(cx: number, cz: number, maxR: number, turns: number, dir: number, steps: number): Point2[] {
  const dense: Point2[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const a = dir * t * turns * Math.PI * 2;
    const r = 0.6 + t * maxR;
    dense.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.85]);
  }
  return resample(dense, steps);
}

/** Ready-made gestures, played through the same pipeline as a real pointer. Keyboard users get these. */
export function pattern(name: PatternName): ScriptedStroke[] {
  switch (name) {
    case 'sweep':
      return [{ points: curve([-20, 6], [-8, -7], [6, 10], [20, -5], 96) }];
    case 'wave':
      return [{ points: curve([-26, -4], [-10, 9], [8, -9], [27, 3], 66) }];
    case 'spiral':
      return [{ points: spiralPoints(1, -1, 5.5, 2.4, -1, 110) }];
    case 'flick':
      return [{ points: curve([-7, 3], [-3, 1], [2, 0], [7, -3], 8) }];
    case 'crossing':
      return [
        { points: curve([-18, -8], [-8, -3], [4, 4], [18, 7], 70) },
        { points: curve([16, -9], [7, -3], [-5, 3], [-16, 8], 70), delay: 30 },
      ];
  }
}
