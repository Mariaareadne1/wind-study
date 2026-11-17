/**
 * A thick, clear, faintly smoky glass panel, drawn inside the compositor's final pass so it
 * refracts the live landscape texture directly: no copy of the frame, no read-back.
 *
 * The optics are ported from the author's own glass-studies project (MIT,
 * src/glass/shaders.ts): a rounded-rectangle SDF, a convex squircle bevel whose slope
 * builds a 3D normal, refraction at IOR 1.52, dispersion toward the rim, a frosted body,
 * a Fresnel rim, a top-edge streak and a hairline. The rounded-box distance follows
 * Inigo Quilez's formulation.
 *
 * Everything here is in device pixels, y up, from the canvas's bottom left.
 */
export const GLASS_GLSL = /* glsl */ `
uniform vec4 uGlass;      // centre x, y and half width, height
uniform vec4 uGlassShape; // corner radius, bevel width, thickness, on (1) / off (0)
uniform vec4 uGlassPtr;   // pointer x, y, and how present it is (0..1)

struct GlassHit {
  float inside; // coverage, antialiased at the hairline
  float sd;     // signed distance to the edge, negative inside
  vec2 local;   // position from the centre
  vec2 outward; // direction out through the nearest edge
  float t;      // 0 at the edge, 1 where the bevel meets the flat face
  float hgt;    // bevel height profile, 0..1
  vec3 n;       // surface normal
};

float glassSd(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - (h - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

GlassHit glassHit(vec2 fc) {
  GlassHit g;
  g.inside = 0.0;
  g.sd = 1e5;
  g.local = vec2(0.0);
  g.outward = vec2(0.0, 1.0);
  g.t = 1.0;
  g.hgt = 1.0;
  g.n = vec3(0.0, 0.0, 1.0);
  if (uGlassShape.w < 0.5) return g;
  vec2 h = uGlass.zw;
  float r = min(uGlassShape.x, min(h.x, h.y));
  vec2 p = fc - uGlass.xy;
  g.local = p;
  g.sd = glassSd(p, h, r);
  // a gradient rather than an analytic normal: smooth around the corners
  float e = 1.0;
  vec2 grad = vec2(glassSd(p + vec2(e, 0.0), h, r) - glassSd(p - vec2(e, 0.0), h, r),
                   glassSd(p + vec2(0.0, e), h, r) - glassSd(p - vec2(0.0, e), h, r));
  g.outward = grad / max(length(grad), 1e-5);
  g.inside = 1.0 - smoothstep(-0.75 * uDpr, 0.75 * uDpr, g.sd);
  float bevel = max(uGlassShape.y, 1.0);
  g.t = clamp(max(-g.sd, 0.0) / bevel, 0.0, 1.0);
  float om = 1.0 - g.t;
  float om4 = om * om * om * om;
  // convex squircle: steep at the rim, flat across the face
  g.hgt = pow(max(1.0 - om4, 0.0), 0.25);
  float slope = min(om * om * om * pow(max(1.0 - om4, 1e-4), -0.75), 6.0);
  g.n = normalize(vec3(g.outward * slope * uGlassShape.z / bevel, 1.0));
  return g;
}

/** The land seen through the slab: bent at the bevel, a little frosted, split into colour at the rim. */
vec3 glassScene(GlassHit g) {
  vec3 rr = refract(vec3(0.0, 0.0, -1.0), g.n, 1.0 / 1.52);
  float travel = uGlassShape.z * (0.35 + 0.65 * g.hgt);
  vec2 disp = rr.xy / max(-rr.z, 0.25) * travel;
  vec2 fc = gl_FragCoord.xy;
  float om = 1.0 - g.t;
  // a calm, softly blurred body; the thick rim scatters a little more
  // heavily frosted, like the reference: no single blade survives, only the land's light and shade
  float frost = mix(30.0, 36.0, om) * uDpr;
  float ab = 0.55 * om;
  // a per-pixel rotation of the sample spiral trades banding for fine grain the paper finish hides
  float spin = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  vec3 acc = vec3(0.0);
  const int TAPS = 24;
  for (int k = 0; k < TAPS; k++) {
    float fk = float(k);
    float a = fk * 2.39996 + spin;
    vec2 o = vec2(cos(a), sin(a)) * frost * sqrt((fk + 0.5) / float(TAPS));
    acc.r += texture(uScene, (fc + disp * (1.0 - 0.35 * ab) + o) * uPixel).r;
    acc.g += texture(uScene, (fc + disp + o) * uPixel).g;
    acc.b += texture(uScene, (fc + disp * (1.0 + 0.55 * ab) + o) * uPixel).b;
  }
  return acc / float(TAPS);
}

vec3 screenBlend(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }

/** Body tint, rim light, highlights and the shadow the slab casts, in display colour. */
vec3 glassFinish(vec3 c, GlassHit g, vec2 fc) {
  if (uGlassShape.w < 0.5) return c;
  vec2 h = uGlass.zw;
  float r = min(uGlassShape.x, min(h.x, h.y));
  // a soft contact shadow below the slab, outside it only
  float sdS = glassSd(g.local + vec2(-4.0, 16.0) * uDpr, h, r);
  float shadow = exp(-max(sdS, 0.0) / (30.0 * uDpr)) * 0.2;
  vec3 outside = c * (1.0 - shadow);
  if (g.inside <= 0.0) return outside;

  // smoky green body: the slab absorbs a little and leans toward the land's own green
  vec3 body = mix(c, c * vec3(0.84, 0.94, 0.82), 0.55) * 0.9;
  // the face catches the sky from the upper left: milky at the top, clearer below
  float lift = smoothstep(-h.y * 0.6, h.y, g.local.y + g.local.x * -0.25);
  body = screenBlend(body, vec3(0.92, 0.96, 0.88) * (0.08 + 0.14 * lift));

  // the thick wall scatters light: a milky band round the rim, brightest toward the light
  vec3 Lm = normalize(vec3(-0.5, 0.62, 0.62));
  float facingM = dot(g.outward, normalize(Lm.xy));
  float band = 1.0 - smoothstep(0.0, 0.5, g.t);
  float litM = 0.35 + 0.65 * pow(facingM * 0.5 + 0.5, 1.4);
  body = screenBlend(body, vec3(0.95, 0.98, 0.92) * band * band * litM * 0.42);

  vec3 L = normalize(vec3(-0.5, 0.62, 0.62));
  vec2 Ld = normalize(L.xy);
  float facing = dot(g.outward, Ld);
  float fres = pow(1.0 - g.n.z, 1.6);
  vec3 refv = reflect(vec3(0.0, 0.0, -1.0), g.n);
  float spec = pow(max(dot(refv, L), 0.0), 60.0) * 0.55;
  // a faint second light follows the pointer across the rim
  vec3 Lp = normalize(vec3((uGlassPtr.xy - fc) / max(h.x, 1.0), 0.8));
  spec += pow(max(dot(refv, Lp), 0.0), 36.0) * 0.4 * uGlassPtr.z;
  float rimLit = fres * (0.42 * max(facing, 0.0) + 0.16);
  float rimShade = fres * 0.1 * max(-facing, 0.0);
  float topness = smoothstep(0.05, 0.85, g.outward.y * 0.85 + facing * 0.35);
  float streak = exp(-pow((g.t - 0.17) / 0.06, 2.0)) * topness * 0.42;
  float lowGlint = exp(-pow((g.t - 0.22) / 0.12, 2.0)) * smoothstep(0.2, 0.9, -g.outward.y) * 0.16;
  vec3 glassCol = body * (1.0 - rimShade) + vec3(spec + streak + lowGlint) + vec3(0.97, 1.0, 0.95) * rimLit * 0.5;
  // the manufactured hairline at the very edge
  float line = exp(-pow(g.sd / (1.1 * uDpr), 2.0));
  glassCol += vec3(line * (0.18 + 0.3 * max(facing, 0.0)));
  return mix(outside, min(glassCol, vec3(1.0)), g.inside);
}
`;
