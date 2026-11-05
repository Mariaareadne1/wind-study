/**
 * The shape of one strand: a constant-curvature arc. Its root stays exactly on
 * the ground and its length never changes, however hard the wind pushes, so a
 * strand can only lean, never stretch or rotate as a rigid card. The GLSL below
 * and the TypeScript mirror are the same formula; an E2E test runs the GLSL
 * through transform feedback and compares it with the mirror.
 */

export const THETA_MAX = 1.5;

/** Soft limit on total bend, so strong gusts lean strands over without folding them. */
export function softLimit(theta: number): number {
  return THETA_MAX * (1 - Math.exp(-theta / THETA_MAX));
}

/** Point at parameter t∈[0,1] of a strand of length h whose bend vector is (ax, az). */
export function strandPoint(t: number, h: number, ax: number, az: number): [number, number, number] {
  const raw = Math.hypot(ax, az);
  const theta = softLimit(raw);
  const dx = raw > 1e-5 ? ax / raw : 0;
  const dz = raw > 1e-5 ? az / raw : 0;
  let horiz: number;
  let up: number;
  if (theta < 1e-3) {
    horiz = 0.5 * theta * t * t;
    up = t;
  } else {
    horiz = (1 - Math.cos(theta * t)) / theta;
    up = Math.sin(theta * t) / theta;
  }
  return [h * dx * horiz, h * up, h * dz * horiz];
}

export const BEND_GLSL = /* glsl */ `
const float THETA_MAX = ${THETA_MAX.toFixed(4)};
// returns the offset from the root; writes the unit tangent
vec3 strandPoint(float t, float h, vec2 A, out vec3 tangent) {
  float raw = length(A);
  float theta = THETA_MAX * (1.0 - exp(-raw / THETA_MAX));
  vec2 dir = raw > 1e-5 ? A / raw : vec2(0.0);
  float a = theta * t;
  float s = sin(a);
  float c = cos(a);
  float horiz, up;
  if (theta < 1e-3) { horiz = 0.5 * theta * t * t; up = t; }
  else { horiz = (1.0 - c) / theta; up = s / theta; }
  tangent = vec3(dir.x * s, c, dir.y * s);
  return h * vec3(dir.x * horiz, up, dir.y * horiz);
}
`;
