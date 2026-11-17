import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { hillHeight, hillTerrain } from '../../src/feasibility/hillside';

describe('feasibility hillside', () => {
  it('has a ridge standing well above the valley in front of it', () => {
    // along x = 0 the ridge crest sits near z = -5.5 and the valley about 17 m nearer the camera
    const crest = Math.max(...Array.from({ length: 41 }, (_, i) => hillHeight(0, -20 + i)));
    const valley = Math.min(...Array.from({ length: 41 }, (_, i) => hillHeight(0, 5 + i)));
    expect(crest - valley).toBeGreaterThan(8);
  });

  it('meets the grass terrain contract with unit normals and no paths', () => {
    const t = hillTerrain();
    const n = t.normalAt(3, -4, new Vector3());
    expect(n.length()).toBeCloseTo(1, 5);
    expect(n.y).toBeGreaterThan(0);
    expect(t.heightAt(3, -4)).toBe(hillHeight(3, -4));
    expect(t.isPath(0, 0)).toBe(false);
  });
});
