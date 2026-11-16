import { fbm, makeNoise, smoothstep, type Noise2 } from './noise';

/**
 * Which way long grass lies when nothing is blowing: broad streams across the
 * slope, curling into a few slow eddies, as if a big wind had combed it and
 * left. Returns the direction, how far over it lies, and a streak value that
 * makes long light and dark lanes along the flow.
 */
export interface Lay {
  x: number;
  z: number;
  lean: number;
  streak: number;
}

interface Eddy {
  x: number;
  z: number;
  radius: number;
  spin: number;
}

const EDDIES: Eddy[] = [
  { x: -10, z: -4, radius: 6.5, spin: 2.6 },
  { x: 8, z: 1, radius: 6, spin: -2.4 },
  { x: -3, z: -14, radius: 7, spin: -2.3 },
  { x: 15, z: -13, radius: 6.5, spin: 2.4 },
  { x: -20, z: -16, radius: 7, spin: 2.0 },
  { x: -19, z: 4, radius: 5.5, spin: -2.0 },
  { x: 20, z: 5, radius: 5.5, spin: 2.0 },
  { x: 4, z: -24, radius: 8, spin: 2.2 },
];

export function makeSwirl(seed: number): (x: number, z: number) => Lay {
  const warp: Noise2 = makeNoise(seed + 501);
  const lanes: Noise2 = makeNoise(seed + 502);
  const lean: Noise2 = makeNoise(seed + 503);
  return (x, z) => {
    // the prevailing comb runs across the slope and a little downhill
    let fx = 0.55;
    let fz = 0.12;
    for (const e of EDDIES) {
      const dx = x - e.x;
      const dz = z - e.z;
      const r2 = (dx * dx + dz * dz) / (e.radius * e.radius);
      const w = Math.exp(-r2) * e.spin;
      fx += -dz / e.radius * w;
      fz += dx / e.radius * w;
    }
    // curl of a noise potential: divergence-free wandering, so streams never pile up or part
    const eps = 0.5;
    const pot = (px: number, pz: number) => fbm(warp, px * 0.07, pz * 0.07, 3);
    const curlX = (pot(x, z + eps) - pot(x, z - eps)) / (2 * eps);
    const curlZ = -(pot(x + eps, z) - pot(x - eps, z)) / (2 * eps);
    fx += curlX * 4;
    fz += curlZ * 4;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    // lanes: noise stretched along the local flow
    const along = x * fx + z * fz;
    const across = -x * fz + z * fx;
    // broad waves across the stream, finer combing inside them
    const wave = fbm(lanes, along * 0.03, across * 0.14, 2);
    const comb = fbm(lanes, along * 0.07 + 31, across * 0.6, 2);
    const lane = wave * 0.8 + comb * 0.35;
    const streak = 0.5 + 0.85 * smoothstep(-0.32, 0.32, lane);
    // lanes that lie flat catch the sun along their whole length; lanes standing up fall into shade
    // (the strand's soft bend limit compresses this: 2.6 lies at about 70 degrees)
    const tilt = 2.6 + 0.5 * fbm(lean, x * 0.12, z * 0.12, 2) + 1.4 * lane;
    return { x: fx, z: fz, lean: tilt, streak };
  };
}

/**
 * Grass direction that follows the land: along the contours of each wave, blended
 * into one prevailing breeze where the ground is flat, with only slow, broad
 * wandering on top. Neighbouring blades always agree; nothing curls tightly.
 */
export function makeFlow(seed: number, height: (x: number, z: number) => number): (x: number, z: number) => Lay {
  const wander: Noise2 = makeNoise(seed + 511);
  const lanes: Noise2 = makeNoise(seed + 512);
  const tilt: Noise2 = makeNoise(seed + 513);
  const gx = 0.94;
  const gz = 0.34;
  return (x, z) => {
    const e = 0.8;
    const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    const slope = Math.hypot(dx, dz);
    // along the contour, pointed the same way as the prevailing breeze
    let cx = -dz;
    let cz = dx;
    if (cx * gx + cz * gz < 0) {
      cx = -cx;
      cz = -cz;
    }
    const cl = Math.hypot(cx, cz) || 1;
    const follow = smoothstep(0.04, 0.4, slope);
    const pot = (px: number, pz: number) => fbm(wander, px * 0.035, pz * 0.035, 2);
    const curlX = (pot(x, z + 1) - pot(x, z - 1)) * 0.5;
    const curlZ = -(pot(x + 1, z) - pot(x - 1, z)) * 0.5;
    let fx = (cx / cl) * follow * 1.6 + gx * (1 - follow * 0.75) + curlX * 6;
    let fz = (cz / cl) * follow * 1.6 + gz * (1 - follow * 0.75) + curlZ * 6;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    const along = x * fx + z * fz;
    const across = -x * fz + z * fx;
    const lane = fbm(lanes, along * 0.06, across * 0.3, 2);
    const streak = 0.84 + 0.32 * smoothstep(-0.35, 0.35, lane);
    // blades lie well over, a little more on the steep faces, never a hard change
    // upright, tufty grass on the flat; swept over on the waves' slopes
    const lean = 0.5 + 0.35 * fbm(tilt, x * 0.08, z * 0.08, 2) + 1.25 * follow;
    return { x: fx, z: fz, lean, streak };
  };
}
