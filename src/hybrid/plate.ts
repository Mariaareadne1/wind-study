/**
 * The photographic plate, drawn as one full-screen pass.
 *
 * At rest the output is the plate itself, sampled at its own pixels. When the wind bends the grass,
 * only the plate's fine detail moves: the colour at a pixel becomes
 *
 *   plate(p) + mask(p) · [ highpass(p - shift) − highpass(p) ],   highpass = plate − blurred plate
 *
 * so strands and glints slide a few pixels downwind while the light and shade of the hills, which
 * live in the blurred part, stay exactly where they are. The blur is a mip level of the plate, so
 * there is no second, lossy detail image. The shift comes from Wind Study's own grass springs.
 */

/** The plate's size in pixels. Every other coordinate here is measured against it. */
export const PLATE = { width: 1672, height: 941 } as const;

export interface Fit {
  /** Device pixels per plate pixel. */
  scale: number;
  /** Where the plate's top left lands, in device pixels from the canvas's top left (can be negative). */
  x: number;
  y: number;
}

/**
 * Cover the canvas with the plate, cropping around a focal point (fractions of the plate). The same
 * crop drives the CSS still and fallback, so the live scene replaces it without a jump.
 */
export function coverFit(width: number, height: number, focusX: number, focusY: number): Fit {
  const scale = Math.max(width / PLATE.width, height / PLATE.height);
  const w = PLATE.width * scale;
  const h = PLATE.height * scale;
  return { scale, x: (width - w) * focusX, y: (height - h) * focusY };
}

export const PLATE_VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const PLATE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPlate;
uniform sampler2D uMask;
uniform sampler2D uBend;
uniform vec3 uFit;        // plate top-left x, y (device px, y down) and device px per plate px
uniform float uHeight;    // canvas height in device px
uniform vec2 uPlateSize;
uniform vec4 uFieldMap;   // plate px -> wind-field uv: scale x, scale y, offset x, offset y
uniform float uDetailLod; // mip level that counts as "the hills": detail is everything finer
uniform float uShiftPx;   // plate px of detail shift per unit of grass bend
uniform float uDebug;     // 1: show the mask, 2: show the bend field
out vec4 outColor;

// explicit levels throughout: implicit-derivative sampling is undefined where neighbouring pixels disagree
vec3 highpass(vec2 uv) {
  return textureLod(uPlate, uv, 0.0).rgb - textureLod(uPlate, uv, uDetailLod).rgb;
}

void main() {
  // canvas pixel -> plate pixel (y down, like the image)
  vec2 dev = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  vec2 px = (dev - uFit.xy) / uFit.z;
  vec2 uv = px / uPlateSize;
  vec3 col = textureLod(uPlate, uv, 0.0).rgb;
  // nothing moves at the plate's own edges, where a shifted sample would fall off the picture
  vec2 inward = min(px, uPlateSize - px);
  float mask = texture(uMask, uv).r * smoothstep(6.0, 28.0, min(inward.x, inward.y));
  vec4 b = texture(uBend, px * uFieldMap.xy + uFieldMap.zw);
  // the soft spring carries most of the lean; the stiff one adds the quick flutter at the tips
  vec2 bend = b.xy * 0.75 + b.zw * 0.25;
  // nearer grass (lower in the frame) is larger on screen and moves further
  float near = mix(0.45, 1.0, clamp(uv.y, 0.0, 1.0));
  vec2 shift = bend * uShiftPx * near * mask;
  // sampling upwind moves what is seen downwind; no branch, so every pixel samples alike (zero shift adds zero)
  vec2 from = uv - shift / uPlateSize;
  col += (highpass(from) - highpass(uv)) * mask;
  if (uDebug > 0.5 && uDebug < 1.5) col = mix(col * 0.35, vec3(1.0, 0.35, 0.3), 1.0 - mask);
  if (uDebug > 1.5) col = mix(col * 0.5, vec3(0.5 + bend * 0.8, 0.5), 0.8);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
