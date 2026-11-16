import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';
import { clamp } from './noise';
import { WORLD, type Terrain } from './terrain';

const TEXELS_PER_UNIT = 3;
const DIRECTIONS = 12;
const STEPS = [0.6, 1.2, 2, 3.2, 4.8, 7, 10];

export interface TerrainLight {
  width: number;
  height: number;
  /** R: sky visibility (ambient occlusion), G: sun visibility (self shadow), B, A: surface normal x, z (×0.5+0.5). */
  data: Uint8Array;
}

/**
 * How much sky and sun each patch of ground can see, from the land's own shape.
 * Valleys between waves fall into shade because the ridges around them really
 * do hide the sky and the sun — nothing is painted dark.
 */
export function bakeTerrainLight(terrain: Terrain, sun: readonly [number, number, number]): TerrainLight {
  const width = Math.ceil((WORLD.maxX - WORLD.minX) * TEXELS_PER_UNIT);
  const height = Math.ceil((WORLD.maxZ - WORLD.minZ) * TEXELS_PER_UNIT);
  const data = new Uint8Array(width * height * 4);
  const sunLen = Math.hypot(sun[0], sun[2]) || 1;
  const sx = sun[0] / sunLen;
  const sz = sun[2] / sunLen;
  const sunRise = sun[1] / sunLen; // rise per unit of horizontal travel
  const dirs = Array.from({ length: DIRECTIONS }, (_, i) => [Math.cos((i / DIRECTIONS) * Math.PI * 2), Math.sin((i / DIRECTIONS) * Math.PI * 2)]);
  for (let j = 0; j < height; j++) {
    const z = WORLD.minZ + (j + 0.5) / TEXELS_PER_UNIT;
    for (let i = 0; i < width; i++) {
      const x = WORLD.minX + (i + 0.5) / TEXELS_PER_UNIT;
      const h0 = terrain.height(x, z) + 0.15;
      // horizon-based occlusion: the average steepest rise in every direction
      let occl = 0;
      for (const [dx, dz] of dirs) {
        let horizon = 0;
        for (const d of STEPS) {
          const rise = (terrain.height(x + dx * d, z + dz * d) - h0) / d;
          if (rise > horizon) horizon = rise;
        }
        occl += horizon / Math.sqrt(1 + horizon * horizon); // sine of the horizon angle
      }
      const sky = clamp(1 - (occl / DIRECTIONS) * 1.15, 0, 1);
      // soft self-shadow: how far the land toward the sun rises above the sun's ray
      let block = 0;
      for (let d = 0.6; d < 26; d *= 1.25) {
        const over = terrain.height(x + sx * d, z + sz * d) - (h0 + sunRise * d);
        block = Math.max(block, over / (0.35 + d * 0.06));
      }
      const sunVis = clamp(1 - block, 0, 1);
      const n = terrain.normal(x, z);
      const o = (i + j * width) * 4;
      data[o] = sky * 255;
      data[o + 1] = sunVis * 255;
      data[o + 2] = (n[0] * 0.5 + 0.5) * 255;
      data[o + 3] = (n[2] * 0.5 + 0.5) * 255;
    }
  }
  return { width, height, data };
}

export function terrainLightTexture(t: TerrainLight): DataTexture {
  const tex = new DataTexture(t.data, t.width, t.height, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** World rectangle the texture covers: minX, minZ, 1/width, 1/depth. */
export const TERRAIN_LIGHT_RECT = [WORLD.minX, WORLD.minZ, 1 / (WORLD.maxX - WORLD.minX), 1 / (WORLD.maxZ - WORLD.minZ)] as const;
