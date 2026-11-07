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

export const HAZE_GLSL = /* glsl */ `
/** Atmosphere by true distance from the eye, so every crest stands out against the hazier hill behind it. */
vec3 applyHaze(vec3 col, float dist, vec4 haze, vec2 range) {
  if (haze.a <= 0.0) return col;
  float k = smoothstep(range.x, range.y, dist);
  float f = haze.a * k * k * (1.4 - 0.4 * k);
  // the nearest land is richer than the painting's average: it sits in front of everything
  float near = 1.0 - smoothstep(range.x * 0.55, range.x * 1.1, dist);
  col = mix(col, col * col * 1.55, near * 0.22 * haze.a);
  // distance first takes the contrast and saturation, then the colour itself
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(lum) * 0.35 + col * 0.65, f * 0.8);
  return mix(col, haze.rgb, f);
}
`;
