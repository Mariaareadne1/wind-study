import { describe, expect, test } from 'vitest';
import { buildGrass, STRANDS_PER_TUFT } from '../../src/grass/tufts';
import { softLimit, strandPoint, THETA_MAX } from '../../src/grass/bend';
import { buildPainting } from '../../src/scene/paint';
import { hillsHeight, Terrain, WORLD } from '../../src/scene/terrain';
import { hillsFramingFor, placeCamera, screenRays } from '../../src/scene/framing';
import { PerspectiveCamera } from 'three';
import { resampleInto, totalTurning, PointerSmoother } from '../../src/interaction/stroke';
import { pattern } from '../../src/wind/patterns';

describe('a strand', () => {
  test('root never moves, however hard the wind', () => {
    for (const a of [[0, 0], [1, 0], [9, -9]]) for (const v of strandPoint(0, 1, a[0], a[1])) expect(Math.abs(v)).toBe(0);
  });

  test('length is preserved: it bends rather than stretches', () => {
    for (const [ax, az] of [[0, 0], [0.4, 0], [1.2, -1.5], [20, 3]]) {
      let len = 0;
      let p = strandPoint(0, 0.8, ax, az);
      for (let i = 1; i <= 200; i++) {
        const q = strandPoint(i / 200, 0.8, ax, az);
        len += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        p = q;
      }
      expect(len).toBeCloseTo(0.8, 3);
    }
  });

  test('curves smoothly: upper part bends more than lower part', () => {
    const lower = strandPoint(0.3, 1, 1, 0)[0] / 0.3;
    const upper = strandPoint(0.9, 1, 1, 0)[0] / 0.9;
    expect(upper).toBeGreaterThan(lower * 1.8);
  });

  test('leans in the bend direction, and the soft limit holds', () => {
    expect(strandPoint(1, 1, 0, 0.8)[2]).toBeGreaterThan(0.2);
    expect(strandPoint(1, 1, -0.8, 0)[0]).toBeLessThan(-0.2);
    expect(softLimit(100)).toBeLessThanOrEqual(THETA_MAX);
    expect(softLimit(0.1)).toBeCloseTo(0.097, 2);
  });
});

describe('the meadow', () => {
  const terrain = new Terrain(7);
  const paint = buildPainting(terrain, 7);
  const rays = {
    origin: [0, 32, 28] as [number, number, number],
    corners: [[-14, -24, -8], [14, -24, -8], [-20, -24, -40], [20, -24, -40]] as [number, number, number][],
  };

  test('painting and terrain are deterministic and gentle', () => {
    const again = new Terrain(7);
    expect(again.height(3, 4)).toBe(terrain.height(3, 4));
    const hs = Array.from(terrain.heights);
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(9);
    let steepest = 0;
    for (let z = WORLD.minZ + 1; z < WORLD.maxZ - 1; z += 1.3) {
      for (let x = WORLD.minX + 1; x < WORLD.maxX - 1; x += 1.3) steepest = Math.max(steepest, 1 - terrain.normal(x, z)[1]);
    }
    expect(steepest).toBeLessThan(0.25);
  });

  test('raycast lands on the surface', () => {
    const hit = terrain.raycast(0, 32, 28, 0.1, -0.74, -0.66)!;
    expect(hit[1]).toBeCloseTo(terrain.height(hit[0], hit[2]), 2);
  });

  test('strands are rooted on the ground, varied, and cover the frame evenly from any prefix', () => {
    const b = buildGrass(terrain, paint, rays, { tufts: 6000, seed: 3 });
    expect(b.count).toBe(6000 * STRANDS_PER_TUFT);
    for (let i = 0; i < b.count; i += 997) {
      expect(b.root[i * 3 + 1]).toBeCloseTo(terrain.height(b.root[i * 3], b.root[i * 3 + 2]) - 0.03, 1);
    }
    // the first third, binned over the frame's x extent, has no empty stretches
    const bins = new Array(10).fill(0);
    const third = Math.floor(b.count / 3);
    for (let i = 0; i < third; i += STRANDS_PER_TUFT) {
      const k = Math.floor(((b.root[i * 3 + 2] + 40) / 70) * 10);
      if (k >= 0 && k < 10) bins[k]++;
    }
    const heights = new Set<number>();
    for (let i = 0; i < 200; i++) heights.add(Math.round(b.shape[i * 4] * 100));
    expect(heights.size).toBeGreaterThan(20);
    expect(bins.filter((n) => n > 10).length).toBeGreaterThan(3);
  });

  test('wind response varies between strands only by correlated amounts', () => {
    const b = buildGrass(terrain, paint, rays, { tufts: 4000, seed: 3 });
    // within a tuft all strands share softness and gain, so a tuft moves as one
    for (let t = 0; t < 200; t++) {
      const s = t * STRANDS_PER_TUFT;
      for (let k = 1; k < STRANDS_PER_TUFT; k++) {
        expect(b.dyn[(s + k) * 4]).toBe(b.dyn[s * 4]);
        expect(b.dyn[(s + k) * 4 + 1]).toBe(b.dyn[s * 4 + 1]);
      }
    }
  });
});

describe('strokes', () => {
  test('resampling gives even spacing', () => {
    const out: { x: number; z: number }[] = [];
    resampleInto(out, 0, 0);
    resampleInto(out, 3.2, 0);
    resampleInto(out, 3.2, 3.2);
    for (let i = 1; i < out.length; i++) expect(Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z)).toBeCloseTo(0.32, 3);
  });

  test('turning measures a circle as a full turn, with sign', () => {
    const c = Array.from({ length: 201 }, (_, i) => ({ x: Math.cos((i / 200) * 6.283), z: Math.sin((i / 200) * 6.283) }));
    expect(totalTurning(c)).toBeGreaterThan(5.8);
    expect(totalTurning([...c].reverse())).toBeLessThan(-5.8);
  });

  test('pointer smoothing removes jitter on slow moves and keeps up with fast ones', () => {
    const s = new PointerSmoother();
    s.push(0, 0, 0);
    let y = 0;
    for (let i = 0; i < 30; i++) y = s.push(i, i % 2 ? 1.5 : -1.5, 1 / 60)[1];
    expect(Math.abs(y)).toBeLessThan(1.2);
    const f = new PointerSmoother();
    f.push(0, 0, 0);
    let x = 0;
    for (let i = 1; i <= 8; i++) x = f.push(i * 60, 0, 1 / 60)[0];
    expect(480 - x).toBeLessThan(70);
  });

  test('every ready-made pattern is finite, and stays within the field', () => {
    for (const name of ['sweep', 'spiral', 'flick', 'crossing', 'wave', 'heroCurve', 'heroSweep'] as const) {
      for (const s of pattern(name)) {
        for (const [x, z] of s.points) {
          expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
          expect(Math.abs(x)).toBeLessThan(36);
          expect(z).toBeGreaterThan(-28);
          expect(z).toBeLessThan(20);
        }
      }
    }
  });
});

describe('the hills', () => {
  const terrain = new Terrain(7, hillsHeight, true);

  test('a ray stops at the first hill, not the one behind it', () => {
    // from low down, aimed so it would pass through the near ridge to reach land far behind
    const o: [number, number, number] = [0, 12, 34];
    const hit = terrain.raycast(o[0], o[1], o[2], 0, -0.16, -1)!;
    expect(hit[1]).toBeCloseTo(terrain.height(hit[0], hit[2]), 2);
    // nothing along the way sits above the ray: this really is the first contact
    for (let t = 1; t < o[2] - hit[2] - 0.5; t += 0.5) {
      const z = o[2] - t;
      expect(o[1] - 0.16 * t).toBeGreaterThan(terrain.height(0, z));
    }
  });

  test.each([0.46, 0.8, 1, 1.6, 1.78, 2.4, 3.2])('no sky at any window shape: aspect %s', (aspect) => {
    const camera = new PerspectiveCamera();
    placeCamera(camera, aspect, hillsFramingFor);
    const rays = screenRays(camera);
    const [c00, c10, c01, c11] = rays.corners;
    const [ox, oy, oz] = rays.origin;
    for (let j = 0; j <= 20; j++) {
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        const v = j / 20;
        const at = (k: number) => c00[k] * (1 - u) * (1 - v) + c10[k] * u * (1 - v) + c01[k] * (1 - u) * v + c11[k] * u * v;
        const hit = terrain.raycast(ox, oy, oz, at(0), at(1), at(2));
        expect(hit, `ray ${u},${v}`).not.toBeNull();
        expect(Math.abs(hit![0])).toBeLessThanOrEqual(WORLD.maxX);
      }
    }
  });

  test('the land keeps hills, with crests that hide what is behind them', () => {
    let crests = 0;
    for (let z = 20; z > -32; z -= 0.5) {
      const a = terrain.height(0, z + 0.5);
      const b = terrain.height(0, z);
      const c = terrain.height(0, z - 0.5);
      if (b > a && b > c) crests++;
    }
    expect(crests).toBeGreaterThanOrEqual(3);
  });
});
