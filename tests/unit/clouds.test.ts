import { describe, expect, test } from 'vitest';
import { bakeCloudShadow, buildLumps, cloudBox, lumpField, MAX_LUMPS } from '../../src/scene/cloudShape';
import { SUNLIT } from '../../src/scene/profiles';
import { sunlitHeight, Terrain } from '../../src/scene/terrain';

describe('sunlit clouds', () => {
  const specs = SUNLIT.clouds!;
  const shapes = specs.map((spec) => ({ spec, lumps: buildLumps(spec) }));

  test('each cloud fits the shader and floats clear of the land', () => {
    const terrain = new Terrain(7, sunlitHeight, true);
    for (const { spec, lumps } of shapes) {
      expect(lumps.length).toBeGreaterThan(8);
      expect(lumps.length).toBeLessThanOrEqual(MAX_LUMPS);
      const box = cloudBox(spec, lumps);
      // the box holds every lump, so the raymarch never clips one flat
      for (const l of lumps) {
        expect(l.x - l.r).toBeGreaterThanOrEqual(box.min[0]);
        expect(l.x + l.r).toBeLessThanOrEqual(box.max[0]);
        expect(l.y + l.r).toBeLessThanOrEqual(box.max[1]);
      }
      expect(spec.y - terrain.height(spec.x, spec.z)).toBeGreaterThan(1);
    }
  });

  test('the mass is solid inside, empty outside, and flat at its base', () => {
    const { spec, lumps } = shapes[0];
    expect(lumpField(lumps, spec, spec.x, spec.y + spec.height * 0.4, spec.z)).toBeGreaterThan(0.3);
    expect(lumpField(lumps, spec, spec.x + spec.width * 2, spec.y + 1, spec.z)).toBe(0);
    expect(lumpField(lumps, spec, spec.x, spec.y - 0.05, spec.z)).toBe(0);
  });

  test('shadows fall on the land under the clouds and nowhere else', () => {
    const terrain = new Terrain(7, sunlitHeight, true);
    const sun = SUNLIT.cloudSun!;
    const rect = { minX: -20, minZ: -15, width: 40, depth: 40 };
    const res = 80;
    const map = bakeCloudShadow(shapes, terrain, sun, rect, res, res);
    let shaded = 0;
    for (const v of map) if (v > 128) shaded++;
    // a few clouds' worth of shade, not a blanket
    expect(shaded / map.length).toBeGreaterThan(0.01);
    expect(shaded / map.length).toBeLessThan(0.25);
    // directly along the sun below the middle of the small cloud, it is dark
    const small = specs[2];
    const t = (small.y + small.height * 0.4 - terrain.height(small.x, small.z)) / sun[1];
    const gx = small.x - sun[0] * t;
    const gz = small.z - sun[2] * t;
    const i = Math.floor(((gx - rect.minX) / rect.width) * res);
    const j = Math.floor(((gz - rect.minZ) / rect.depth) * res);
    expect(map[i + j * res]).toBeGreaterThan(128);
    // a corner of the field far from every cloud is in sun
    expect(map[0]).toBe(0);
  });
});
