/** Very slow, very soft cloud shadows, shared by the grass and the ground. */
export const CLOUD_GLSL = /* glsl */ `
float cloudBlob(vec2 p, vec2 c, vec2 r) {
  vec2 d = (p - c) / r;
  return exp(-dot(d, d));
}
float cloudAmount(vec2 xz, float time) {
  vec2 drift = vec2(time * 0.09, time * 0.035);
  // lazy wrap: the shadows leave one side of the world long after they entered the other
  vec2 p = xz - drift;
  p.x = mod(p.x + 60.0, 120.0) - 60.0;
  p.y += 0.9 * sin(xz.x * 0.21) + 0.6 * sin(xz.x * 0.47 + 1.3);
  // two small painted shadows in the whole picture, with room between them
  float s = cloudBlob(p, vec2(-13.5, 11.0), vec2(4.6, 1.7))
          + 0.8 * cloudBlob(p, vec2(-9.8, 12.0), vec2(2.6, 1.2))
          + cloudBlob(p, vec2(21.0, -8.0), vec2(4.2, 1.5))
          + 0.8 * cloudBlob(p, vec2(24.0, -7.2), vec2(2.4, 1.1))
          + cloudBlob(p, vec2(-48.0, -6.0), vec2(4.8, 1.7));
  return smoothstep(0.4, 0.9, s);
}
vec3 shadeCloud(vec3 col, float amount) {
  return mix(col, col * vec3(0.84, 0.89, 0.93), amount * 0.8);
}
`;

/** The shading half alone, for shaders that read the amount from the flow texture. */
export const CLOUD_SHADE_GLSL = /* glsl */ `
vec3 shadeCloud(vec3 col, float amount) {
  return mix(col, col * vec3(0.84, 0.89, 0.93), amount * 0.8);
}
`;
