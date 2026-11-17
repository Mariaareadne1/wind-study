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
uniform float uMaxShift;  // however hard the gust, detail never travels further than this (plate px)
uniform sampler2D uFlow;  // strand direction as the doubled angle (rg) and coherence (b), from scripts/hybrid-flow.mjs
uniform float uBlade;     // 0: the detail moves as one sheet; 1: strand by strand, bending from root to tip
uniform float uBladeLen;  // plate px from a strand's root to its tip, roughly
uniform float uDebug;     // 1: show the mask, 2: show the bend field, 3: show the strand directions
out vec4 outColor;

// explicit levels throughout: implicit-derivative sampling is undefined where neighbouring pixels disagree
vec3 highpass(vec2 uv) {
  return textureLod(uPlate, uv, 0.0).rgb - textureLod(uPlate, uv, uDetailLod).rgb;
}

float hash2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

/** Strand phase and strength from one tile's frame: its own constant strand direction, so nothing magnifies. */
vec2 strandNoise(vec2 px, vec2 cell) {
  vec2 c = (cell + 0.5) * 40.0;
  vec2 c2 = textureLod(uFlow, c / uPlateSize, 0.0).rg * 2.0 - 1.0;
  float th = 0.5 * atan(c2.y, c2.x);
  vec2 dir = vec2(cos(th), sin(th));
  vec2 local = px - c;
  vec2 q = vec2(dot(local, vec2(-dir.y, dir.x)) / 8.0, dot(local, dir) / 70.0);
  float phase = noise2(q + cell * 7.31) * 6.2832;
  float tip = 0.5 + 0.5 * sin(dot(local, dir) * 6.2832 / uBladeLen + phase);
  float gain = noise2(q + cell * 7.31 + vec2(37.0, 11.0));
  return vec2(tip, gain);
}

/**
 * How far this pixel moves, per unit of wind, if it belongs to a strand. In each strand's own frame (along the
 * grass and across it), noise that changes every few pixels across but slowly along gives each strand its own
 * phase and strength, so neighbours do not move in lockstep; a smooth wave along the strand stands for root (0)
 * to tip (1), so the tip travels further than the root and the strand bends rather than slides. The frames are
 * evaluated per 40 px tile (each with its own direction) and blended, and the variation is kept small enough
 * that the warp can never fold over and tear.
 */
vec2 bladeShift(vec2 px, vec2 uv, vec2 soft, vec2 stiff) {
  vec3 fl = texture(uFlow, uv).rgb;
  vec2 c2 = fl.rg * 2.0 - 1.0;
  float th = 0.5 * atan(c2.y, c2.x);
  vec2 dir = vec2(cos(th), sin(th));
  vec2 nrm = vec2(-dir.y, dir.x);
  float coh = smoothstep(0.12, 0.5, fl.b);
  vec2 g = px / 40.0 - 0.5;
  vec2 i0 = floor(g);
  vec2 f = fract(g);
  f = f * f * (3.0 - 2.0 * f);
  vec2 n = mix(mix(strandNoise(px, i0), strandNoise(px, i0 + vec2(1.0, 0.0)), f.x),
               mix(strandNoise(px, i0 + vec2(0.0, 1.0)), strandNoise(px, i0 + vec2(1.0, 1.0)), f.x), f.y);
  float tip = n.x;
  float gain = 0.75 + 0.5 * n.y;
  float reach = mix(0.45, 1.0, tip * tip) * gain;
  // the slow spring leans the whole strand; the quick one flutters its tip
  vec2 blade = soft * reach + stiff * (tip * gain * 1.4);
  // a blade sways across itself far more visibly than it slides along itself
  blade = nrm * dot(blade, nrm) * 1.1 + dir * dot(blade, dir) * 0.75;
  return mix(soft * 0.75 + stiff * 0.25, blade, coh);
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
  // sheet: the soft spring carries most of the lean and the stiff one adds a little flutter, everywhere alike
  vec2 sheet = b.xy * 0.75 + b.zw * 0.25;
  vec2 bend = mix(sheet, bladeShift(px, uv, b.xy, b.zw), uBlade);
  // nearer grass (lower in the frame) is larger on screen and moves further
  float near = mix(0.45, 1.0, clamp(uv.y, 0.0, 1.0));
  vec2 shift = bend * uShiftPx * near * mask;
  // however hard the gust, detail never travels more than a few pixels: beyond that strands smear and double
  float reachPx = length(shift);
  shift *= min(1.0, uMaxShift / max(reachPx, 1e-4));
  // sampling upwind moves what is seen downwind; no branch, so every pixel samples alike (zero shift adds zero)
  vec2 from = uv - shift / uPlateSize;
  col += (highpass(from) - highpass(uv)) * mask;
  if (uDebug > 0.5 && uDebug < 1.5) col = mix(col * 0.35, vec3(1.0, 0.35, 0.3), 1.0 - mask);
  if (uDebug > 1.5 && uDebug < 2.5) col = mix(col * 0.5, vec3(0.5 + bend * 0.8, 0.5), 0.8);
  if (uDebug > 2.5) {
    vec3 fl = texture(uFlow, uv).rgb;
    col = mix(col * 0.4, vec3(fl.rg, 0.5) * fl.b, 0.85);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
