/**
 * The living hero's composite: the approved landscape, separated into layers (scripts/living-layers.mjs), and put back
 * together every frame with each layer doing what it would do in the world. Nothing is warped:
 *
 *   land     the landscape with the clouds lifted out and the ground under them filled. It never moves.
 *   shadows  each cloud's shadow is a lighting layer: the plate's own shadow is divided out and the same shadow is
 *            applied again where the drifting cloud now casts it, so cloud and shadow always travel together.
 *   grass    wind shows in a grass field as light, not as shape: where a gust passes, blades tilt and catch the sun
 *            on their sides, so bands of silvery brightening travel downwind with darker troughs between them.
 *            Only the light changes; no pixel moves.
 *   clouds   each cloud is its own sprite, drifting slowly on its own path.
 */
export const LIVING_VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const LIVING_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLand;
uniform sampler2D uMask;
uniform sampler2D uCloud0;
uniform sampler2D uCloud1;
uniform sampler2D uCloud2;
uniform sampler2D uShadow0;
uniform sampler2D uShadow1;
uniform sampler2D uShadow2;
uniform vec4 uCloudRect[3];   // where each cloud sprite sits on the plate: x, y, w, h (plate px)
uniform vec4 uShadowRect[3];  // where each shadow sprite sits
uniform float uShadowDepth[3];
uniform vec2 uDrift[3];       // each cloud's current drift from its place in the picture (plate px)
uniform vec3 uFit;            // plate top-left x, y (device px, y down) and device px per plate px
uniform float uHeight;
uniform vec2 uPlateSize;
uniform float uTime;
uniform float uLife;          // how strongly the wind shows in the grass (0 = a still picture)
uniform sampler2D uGust;      // local wind from the pointer: bend in rg (Wind Study's grass springs)
uniform vec4 uFieldMap;       // plate px -> wind-field uv
uniform float uGustGain;
out vec4 outColor;

float hash2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return noise2(p) * 0.6 + noise2(p * 2.03 + 7.1) * 0.3 + noise2(p * 4.1 + 3.7) * 0.1; }

// a shadow sprite placed on the plate, zero outside its rectangle
float shadowAt(sampler2D tex, vec4 rect, vec2 px) {
  vec2 q = (px - rect.xy) / rect.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return 0.0;
  return textureLod(tex, q, 0.0).r;
}
// a cloud sprite: premultiplied colour in the top half of its image, alpha in the bottom half
vec3 over(vec3 col, sampler2D tex, vec4 rect, vec2 px) {
  vec2 q = (px - rect.xy) / rect.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return col;
  q.y = clamp(q.y, 0.5 / rect.w, 1.0 - 0.5 / rect.w) * 0.5;
  vec3 premul = textureLod(tex, q, 0.0).rgb;
  float a = textureLod(tex, q + vec2(0.0, 0.5), 0.0).r;
  return col * (1.0 - a) + premul;
}

/**
 * Wind in the grass, as light. Bands of gust travel downwind (toward the upper right, the way the grass lies), broad
 * and quick in the foreground, finer and slower toward the far hills, and they come and go as the noise evolves.
 * Returns a signed amount: positive where blades tilt into the light, negative in the troughs between gusts.
 */
float windLight(vec2 px, float t) {
  vec2 dir = normalize(vec2(0.93, -0.36));
  vec2 across = vec2(-dir.y, dir.x);
  float depth = clamp(px.y / uPlateSize.y, 0.0, 1.0);
  float scale = mix(0.55, 1.25, depth);           // nearer grass: bigger gusts on screen
  float a = dot(px, dir) / (320.0 * scale);
  float b = dot(px, across) / (120.0 * scale);
  float speed = mix(0.18, 0.42, depth);           // nearer gusts cross the screen faster
  float n = fbm(vec2(a - t * speed, b + t * 0.02));
  float m = fbm(vec2(a * 2.3 - t * speed * 1.6 + 13.0, b * 1.7 + 5.0));
  float gust = smoothstep(0.52, 0.78, n) * (0.6 + 0.4 * m);
  float trough = smoothstep(0.42, 0.22, n);
  return gust - 0.35 * trough;
}

void main() {
  vec2 dev = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  vec2 px = (dev - uFit.xy) / uFit.z;
  vec2 uv = px / uPlateSize;
  vec3 land = textureLod(uLand, uv, 0.0).rgb;
  vec3 col = land;

  // shadows move with their clouds: take the plate's own shadow out of the light, put it back where it now falls
  float lightNow = 1.0;
  float lightThen = 1.0;
  lightThen *= 1.0 - uShadowDepth[0] * shadowAt(uShadow0, uShadowRect[0], px);
  lightThen *= 1.0 - uShadowDepth[1] * shadowAt(uShadow1, uShadowRect[1], px);
  lightThen *= 1.0 - uShadowDepth[2] * shadowAt(uShadow2, uShadowRect[2], px);
  lightNow *= 1.0 - uShadowDepth[0] * shadowAt(uShadow0, uShadowRect[0], px - uDrift[0]);
  lightNow *= 1.0 - uShadowDepth[1] * shadowAt(uShadow1, uShadowRect[1], px - uDrift[1]);
  lightNow *= 1.0 - uShadowDepth[2] * shadowAt(uShadow2, uShadowRect[2], px - uDrift[2]);
  // the shadow sprites only approximate the real shadows, so a departing shadow may lift the light only a little
  col *= clamp(lightNow / lightThen, 0.75, 1.12);

  // wind in the grass: only the light changes, and only on grass
  float grass = textureLod(uMask, uv, 0.0).r;
  float depth = clamp(uv.y, 0.0, 1.0);
  vec3 detail = land - textureLod(uLand, uv, 2.0).rgb;   // the strands themselves
  float lum = dot(detail, vec3(0.3, 0.59, 0.11));
  // the pointer's local gust adds to the ambient wind where it blows
  vec4 b = texture(uGust, px * uFieldMap.xy + uFieldMap.zw);
  float local = clamp(length(b.xy) * uGustGain, 0.0, 1.5);
  float w = (windLight(px, uTime) * uLife + local) * grass * mix(0.45, 1.0, depth) * lightNow;
  float wp = max(w, 0.0);
  float wn = max(-w, 0.0);
  // tilted blades: their bright fibres flare, the whole patch lifts a little toward a pale, silvery green
  col += detail * wp * 1.7 + max(lum, 0.0) * wp * vec3(0.9, 1.0, 0.75) * 2.1;
  col = mix(col, col * 1.09 + vec3(0.024, 0.03, 0.014), wp);
  // between gusts the blades stand and shade one another
  col *= 1.0 - wn * 0.16;

  // clouds, each on its own slow path
  col = over(col, uCloud0, uCloudRect[0], px - uDrift[0]);
  col = over(col, uCloud1, uCloudRect[1], px - uDrift[1]);
  col = over(col, uCloud2, uCloudRect[2], px - uDrift[2]);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
