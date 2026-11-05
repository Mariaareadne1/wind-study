import type { ScreenRays } from '../scene/framing';
import { sampleComb, samplePaint, type Painting } from '../scene/paint';
import { WORLD, type Terrain } from '../scene/terrain';
import { clamp, fbm, makeNoise, makeRng, mix, smoothstep } from '../scene/noise';

export const STRANDS_PER_TUFT = 6;

export interface GrassBuffers {
  /** Strand count (tufts × STRANDS_PER_TUFT). Any whole-tuft prefix covers the screen evenly. */
  count: number;
  /** Root position (x, y, z). */
  root: Float32Array;
  /** Length, width, rest lean x, rest lean z. */
  shape: Float32Array;
  /** RGB pigment, tip lightness. */
  tint: Uint8Array;
  /** Softness (0 stiff..1 soft), wind gain, direction twist, flutter phase. */
  dyn: Uint8Array;
}

export interface GrassOptions {
  tufts: number;
  seed: number;
  /** Extra margin around the frame in NDC, so bent strands and resizes never reveal an edge. */
  overscan?: number;
}

/** Soft mounds of grass a little over a world unit across: the mid scale of the fluff. */
const MOUND_CELL = 0.95;

function hash2(i: number, j: number, k: number): number {
  const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Nearest jittered mound to (x, z): writes its centre offset and normalised distance. */
function nearestMound(x: number, z: number, out: Float64Array): void {
  const gx = Math.floor(x / MOUND_CELL);
  const gz = Math.floor(z / MOUND_CELL);
  let best = 1e9;
  for (let j = gz - 1; j <= gz + 1; j++) {
    for (let i = gx - 1; i <= gx + 1; i++) {
      const size = 0.7 + 0.6 * hash2(i, j, 3);
      const mx = (i + 0.15 + 0.7 * hash2(i, j, 1)) * MOUND_CELL;
      const mz = (j + 0.15 + 0.7 * hash2(i, j, 2)) * MOUND_CELL;
      const d = Math.hypot(x - mx, z - mz) / size;
      if (d < best) {
        best = d;
        out[0] = x - mx;
        out[1] = z - mz;
        out[2] = d / MOUND_CELL;
        out[3] = hash2(i, j, 4);
      }
    }
  }
}

const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;

/**
 * Scatters tufts evenly over the screen rather than the world. The camera never
 * moves, so this gives the same fineness near and far with no LOD rings at all,
 * and because the sequence is low-discrepancy, keeping only the first N tufts
 * still covers the frame evenly: quality can drop without a visible seam.
 *
 * Each tuft is a small dome of six strands fanning outward, shorter and darker
 * at its rim. That dome is what reads as fluff from the air: many tiny, rounded,
 * softly lit dabs rather than a forest of needles.
 */
export function buildGrass(terrain: Terrain, paint: Painting, rays: ScreenRays, opts: GrassOptions): GrassBuffers {
  const { tufts, seed } = opts;
  const overscan = opts.overscan ?? 0.1;
  const count = tufts * STRANDS_PER_TUFT;
  const root = new Float32Array(count * 3);
  const shape = new Float32Array(count * 4);
  const tint = new Uint8Array(count * 4);
  const dyn = new Uint8Array(count * 4);

  const rng = makeRng(seed + 1000);
  const clumpNoise = makeNoise(seed + 201);
  const twistNoise = makeNoise(seed + 202);
  const heightNoise = makeNoise(seed + 203);
  const pigment: number[] = [0, 0, 0, 0];
  const pigment2: number[] = [0, 0, 0, 0];
  const [c00, c10, c01, c11] = rays.corners;
  const [ox, oy, oz] = rays.origin;
  const refDist = oy * 1.3;
  const mound = new Float64Array(4);

  let s = 0;
  for (let i = 0; i < tufts; i++) {
    const u = ((i + 1) * R2_A + 0.5 * (rng() - 0.5) * 0.002) % 1;
    const v = ((i + 1) * R2_B + 0.5 * (rng() - 0.5) * 0.002) % 1;
    // through the frame, with overscan
    const sx = -overscan + u * (1 + 2 * overscan);
    const sy = -overscan + v * (1 + 2 * overscan);
    const dx = mix(mix(c00[0], c10[0], sx), mix(c01[0], c11[0], sx), sy);
    const dy = mix(mix(c00[1], c10[1], sx), mix(c01[1], c11[1], sx), sy);
    const dz = mix(mix(c00[2], c10[2], sx), mix(c01[2], c11[2], sx), sy);
    const hit = terrain.raycast(ox, oy, oz, dx, dy, dz);
    const cx = hit ? clamp(hit[0], WORLD.minX, WORLD.maxX) : 0;
    const cz = hit ? clamp(hit[2], WORLD.minZ, WORLD.maxZ) : 0;
    const dist = hit ? Math.hypot(ox - cx, oy - hit[1], oz - cz) : refDist;
    // keep the fineness of the fibres fairly even from near to far
    const scale = Math.pow(dist / refDist, 0.75);

    nearestMound(cx, cz, mound);
    // 1 at the crown of a mound, 0 down in the creases between mounds
    const crown = smoothstep(0.82, 0.08, mound[2]);
    const moundLen = Math.hypot(mound[0], mound[1]) || 1;
    const moundX = mound[0] / moundLen;
    const moundZ = mound[1] / moundLen;

    // three layers: dense short underfur, the main pile, sparse tall wisps
    const layerRoll = rng();
    const under = layerRoll < 0.34;
    const wisp = layerRoll > 0.9;
    const tuftRadius = (under ? 0.24 : wisp ? 0.15 : 0.25) * scale * mix(0.75, 1.25, rng());

    samplePaint(paint, cx, cz, pigment);
    const patchTall = (pigment[3] / 255) * 2;
    // feathered field edges: every tuft reads its colour from a little way off
    const jitterA = rng() * Math.PI * 2;
    const jitterR = rng() * rng() * 2.4;
    samplePaint(paint, cx + Math.cos(jitterA) * jitterR, cz + Math.sin(jitterA) * jitterR, pigment2);

    const tuftTone = (rng() - 0.5) * (under ? 0.07 : 0.13);
    const warmth = (rng() - 0.5) * 0.16;
    const lengthDrift = 0.8 + 0.5 * smoothstep(-0.45, 0.45, fbm(heightNoise, cx * 0.5, cz * 0.5, 2));
    const baseH = (under ? 0.3 : wisp ? 0.84 : 0.54) * scale * patchTall * lengthDrift * mix(0.85, 1.15, rng()) * mix(0.78, 1.12, crown);
    const baseW = (under ? 0.082 : wisp ? 0.042 : 0.064) * scale;
    const [combX, combZ] = sampleComb(paint, cx, cz);
    const combLean = (under ? 0.16 : 0.26) * mix(0.6, 1.15, rng());
    // strands fall outward off the crown of their mound, which rounds its silhouette
    const moundFan = 0.5 * smoothstep(0.06, 0.8, mound[2]);
    const moundTone = 0.91 + 0.15 * crown + (mound[3] - 0.5) * 0.07;
    // clump behaviour is correlated in space: neighbouring tufts answer the wind alike
    const clump = fbm(clumpNoise, cx * 0.42, cz * 0.42, 2);
    const twistField = fbm(twistNoise, cx * 0.3, cz * 0.3, 2);
    const softness = clamp((under ? 0.12 : wisp ? 0.95 : 0.6) + clump * 0.5 + (rng() - 0.5) * 0.25, 0, 1);
    const gain = clamp((under ? 0.72 : wisp ? 1.2 : 1) * (1 + clump * 0.9) + (rng() - 0.5) * 0.1, 0.4, 1.6);
    const twist = clamp(twistField * 1.5 + (rng() - 0.5) * 0.3, -1, 1);
    const tuftPhase = rng();
    const fanStart = rng() * Math.PI * 2;

    for (let k = 0; k < STRANDS_PER_TUFT; k++) {
      // a sunflower disc gives an even dome with no two tufts alike
      const r = Math.sqrt((k + 0.35) / STRANDS_PER_TUFT);
      const a = fanStart + k * 2.39996 + (rng() - 0.5) * 0.6;
      const ax = Math.cos(a);
      const az = Math.sin(a);
      const px = cx + ax * r * tuftRadius;
      const pz = cz + az * r * tuftRadius;

      root[s * 3] = px;
      root[s * 3 + 1] = terrain.height(px, pz) - 0.03;
      root[s * 3 + 2] = pz;

      const dome = 1 - 0.42 * r * r;
      const h = baseH * dome * mix(0.82, 1.14, rng());
      const fan = (under ? 0.5 : 0.62) * r * mix(0.8, 1.2, rng());
      shape[s * 4] = h;
      shape[s * 4 + 1] = baseW * mix(0.8, 1.2, rng());
      shape[s * 4 + 2] = ax * fan + combX * combLean + moundX * moundFan;
      shape[s * 4 + 3] = az * fan + combZ * combLean + moundZ * moundFan;

      // rim strands sit in the tuft's own shade; centre strands catch the light
      const rim = 1 - 0.28 * r * r;
      const under_ = under ? 0.84 : 1;
      const tone = (1 + tuftTone + (rng() - 0.5) * 0.05) * rim * under_ * moundTone;
      tint[s * 4] = clamp((pigment2[0] * (1 + warmth * 0.6)) * tone, 0, 255);
      tint[s * 4 + 1] = clamp(pigment2[1] * tone, 0, 255);
      tint[s * 4 + 2] = clamp((pigment2[2] * (1 - warmth)) * tone, 0, 255);
      tint[s * 4 + 3] = clamp((under ? 0.2 : wisp ? 0.95 : 0.55) * mix(0.75, 1.2, rng()) * 255, 0, 255);

      dyn[s * 4] = softness * 255;
      dyn[s * 4 + 1] = (gain / 2) * 255;
      dyn[s * 4 + 2] = (twist * 0.5 + 0.5) * 255;
      dyn[s * 4 + 3] = ((tuftPhase + k * 0.012) % 1) * 255;
      s++;
    }
  }
  return { count, root, shape, tint, dyn };
}
