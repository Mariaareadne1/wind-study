import type { Framing } from './framing';
import { fbm, mix, smoothstep } from './noise';

/**
 * The portfolio hero: a wide window onto big rolling swells of long grass, after
 * design/reference/portfolio_hero_target.png. Fewer, larger waves than Sunlit,
 * whose crests rise gently toward the right and bend in long S-curves.
 */

/** The general rise of the land with distance, without its swells. */
export function portfolioClimb(z: number): number {
  const k = (10 - z) / 6;
  return 1.7 * (k > 12 ? k : Math.log(1 + Math.exp(k)));
}

export function portfolioHeight(n: (x: number, y: number) => number, x: number, z: number): number {
  const climb = portfolioClimb(z);
  // the swells settle into a broad, calm slope in the nearest foreground
  const build = smoothstep(17, 6, z);
  // crests run across the view, rising to the right, with long S-bends and a slow wander
  const warp = 0.34 * x + 4.2 * Math.sin(x * 0.055 + 1.1) + 1.8 * Math.sin(x * 0.12 - 0.4 + z * 0.04) + 3 * fbm(n, x * 0.025, z * 0.025, 2);
  const phase = (z + warp) / 12.5;
  const f = phase - Math.floor(phase);
  // a long rise to each crest, then a quicker fall into the hollow behind it
  const swell = f < 0.66 ? smoothstep(0, 0.66, f) : smoothstep(1, 0.66, f);
  // each ridge swells and subsides along its length
  const along = 0.45 + 0.8 * smoothstep(-0.3, 0.3, fbm(n, x * 0.04 + 23, Math.floor(phase) * 2.7, 2));
  let h = climb + build * 5.4 * along * swell;
  h += 0.8 * build * fbm(n, x * 0.02 + 9, z * 0.028, 2);
  return h;
}

/**
 * A fixed, moderately raised view across the swells. Desktop windows keep the
 * reference's wide composition; tall phone windows look a little more steeply down.
 */
/** The reference image's vertical field of view and shape. */
const REFERENCE_FOV = 29;
const REFERENCE_ASPECT = 1914 / 1048;

export function portfolioFramingFor(aspect: number): Framing {
  const wide = smoothstep(0.6, 1.5, aspect);
  // desktop windows keep the reference's width of view (29 degrees tall at 1914 x 1048), so a
  // 16:10 window shows a little more land above and below rather than cropping the clouds
  const across = Math.tan((REFERENCE_FOV / 2) * (Math.PI / 180)) * REFERENCE_ASPECT;
  const desktopFov = 2 * Math.atan(across / Math.max(aspect, 1.2)) * (180 / Math.PI);
  const limit = aspect > 2.1 ? 2.1 / aspect : 1;
  return {
    fov: mix(50, Math.min(desktopFov, 36), wide) * limit,
    pitch: (Math.PI / 180) * mix(48, 35, wide),
    distance: mix(40, 52, wide),
    // tall windows centre on the clouds, which sit right of the middle in the wide view
    targetX: mix(5.5, 0, wide),
    // and look a little further up the hill, leaving the lower part of the frame for the panel
    targetZ: mix(2, -3, wide),
    targetY: 4,
  };
}
