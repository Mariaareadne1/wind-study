import { WORLD, type Terrain } from './terrain';
import { clamp, fbm, makeNoise, mix, smoothstep } from './noise';

type Rgb = readonly [number, number, number];
const hex = (h: string): Rgb => {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export const PALETTE = {
  spring: hex('#b2d66e'),
  fresh: hex('#86c060'),
  sage: hex('#a9cf7f'),
  golden: hex('#d6d565'),
  straw: hex('#ead980'),
  deep: hex('#6fb063'),
  cool: hex('#6a9a94'),
  warm: hex('#f6eba0'),
} as const;

type PaletteKey = keyof typeof PALETTE;

/**
 * A hand-placed patchwork: where each field sits, what it is planted with, which
 * way its grass is combed and how tall it grows. Noise only ever feathers these
 * decisions; it never makes them, so the composition reads as a composition.
 */
export interface FieldPatch {
  x: number;
  z: number;
  /** Elongation and rotation of the patch. */
  sx: number;
  sz: number;
  rot: number;
  color: PaletteKey;
  /** Direction the pile is combed, radians. */
  comb: number;
  /** Multiplies strand length. */
  tall: number;
}

export const PATCHES: FieldPatch[] = [
  { x: -18, z: 8, sx: 1.2, sz: 0.8, rot: 0.2, color: 'spring', comb: 0.5, tall: 1 },
  { x: -3, z: 10, sx: 0.9, sz: 1.0, rot: -0.3, color: 'fresh', comb: 2.2, tall: 1.05 },
  { x: 14, z: 11, sx: 1.2, sz: 0.8, rot: 0.25, color: 'golden', comb: 1.2, tall: 1.2 },
  { x: 29, z: 5, sx: 1, sz: 1, rot: 0, color: 'sage', comb: 0.1, tall: 0.95 },
  { x: -29, z: -3, sx: 1, sz: 1.1, rot: 0.4, color: 'fresh', comb: 1.5, tall: 1 },
  { x: -13, z: -2.5, sx: 1.3, sz: 0.65, rot: 0.55, color: 'straw', comb: 0.4, tall: 1.25 },
  { x: 2, z: 0.5, sx: 0.85, sz: 0.9, rot: 0.4, color: 'spring', comb: 2.6, tall: 1.05 },
  { x: 15, z: -3.5, sx: 1.15, sz: 0.8, rot: -0.35, color: 'deep', comb: 0.9, tall: 1 },
  { x: -24, z: -13, sx: 1.2, sz: 0.8, rot: -0.2, color: 'sage', comb: 2.0, tall: 0.95 },
  { x: -7, z: -11.5, sx: 1.2, sz: 0.75, rot: 0.3, color: 'fresh', comb: 0.2, tall: 1 },
  { x: 8, z: -13, sx: 1.05, sz: 0.7, rot: -0.1, color: 'golden', comb: 1.8, tall: 1.2 },
  { x: 27, z: -10, sx: 1.1, sz: 1, rot: 0.25, color: 'spring', comb: 0.8, tall: 1 },
  { x: -18, z: -24, sx: 1.6, sz: 0.8, rot: 0.1, color: 'spring', comb: 1.1, tall: 1 },
  { x: 16, z: -24, sx: 1.6, sz: 0.8, rot: -0.1, color: 'sage', comb: 2.4, tall: 1 },
  { x: -32, z: 16, sx: 1.2, sz: 1, rot: 0, color: 'deep', comb: 1.4, tall: 1 },
  { x: 34, z: 17, sx: 1.2, sz: 1, rot: 0, color: 'spring', comb: 0.6, tall: 1 },
];

/** The patchwork for the hills: fields lie across the slopes, gold on the upper faces. */
export const HILL_PATCHES: FieldPatch[] = [
  // foreground
  { x: -10, z: 17, sx: 1.3, sz: 0.7, rot: 0.1, color: 'spring', comb: 0.4, tall: 1.1 },
  { x: 11, z: 17, sx: 1.3, sz: 0.7, rot: -0.1, color: 'fresh', comb: 2.1, tall: 1.15 },
  // near ridges
  { x: -20, z: 6, sx: 1.1, sz: 0.45, rot: 0.15, color: 'fresh', comb: 1.7, tall: 1 },
  { x: 0, z: 6, sx: 0.9, sz: 0.45, rot: -0.1, color: 'spring', comb: 0.6, tall: 1.05 },
  { x: 20, z: 5, sx: 1.1, sz: 0.45, rot: -0.15, color: 'golden', comb: 1.2, tall: 1.15 },
  { x: -24, z: -3, sx: 1.1, sz: 0.42, rot: 0.1, color: 'golden', comb: 0.3, tall: 1.15 },
  { x: -3, z: -3, sx: 0.9, sz: 0.42, rot: 0.1, color: 'deep', comb: 1.9, tall: 1 },
  { x: 17, z: -3, sx: 1, sz: 0.42, rot: 0.1, color: 'spring', comb: 0.8, tall: 1 },
  // middle distance
  { x: -18, z: -11, sx: 1.2, sz: 0.42, rot: 0.05, color: 'spring', comb: 1.3, tall: 1 },
  { x: 4, z: -11, sx: 0.9, sz: 0.42, rot: -0.05, color: 'straw', comb: 2.2, tall: 1.15 },
  { x: 26, z: -11, sx: 1.1, sz: 0.42, rot: 0.1, color: 'deep', comb: 0.5, tall: 1 },
  { x: -26, z: -19, sx: 1.1, sz: 0.42, rot: 0.05, color: 'deep', comb: 1.0, tall: 1 },
  { x: -3, z: -19, sx: 1, sz: 0.42, rot: 0.03, color: 'fresh', comb: 2.4, tall: 1 },
  { x: 20, z: -19, sx: 1.1, sz: 0.42, rot: -0.03, color: 'golden', comb: 1.4, tall: 1.1 },
  // the far ridge
  { x: -18, z: -29, sx: 1.8, sz: 0.45, rot: 0.03, color: 'sage', comb: 1.0, tall: 1 },
  { x: 18, z: -29, sx: 1.8, sz: 0.45, rot: -0.03, color: 'spring', comb: 2.4, tall: 1 },
];

/** Where the low sun sits. Shared with the grass shader so the bake and the fibres agree. */
export const SUN = (() => {
  const v = [-0.62, 0.55, -0.56];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number];
})();

const TEXELS_PER_UNIT = 9;

export interface PaintLook {
  litGain: number;
  airFrom: number;
  airTo: number;
  airAmount: number;
  airColor: readonly [number, number, number];
  castShadows: boolean;
  valleyShade: number;
  baseline?: (z: number) => number;
  patchSharpness: number;
  formShade?: number;
  shadowDepth?: number;
}

const DEFAULT_LOOK: PaintLook = { litGain: 3.6, airFrom: -8, airTo: -24, airAmount: 0.22, airColor: [0.84, 0.9, 0.76], castShadows: false, valleyShade: 0, patchSharpness: 2.2 };

export interface PaintOptions {
  patches?: readonly FieldPatch[];
  sun?: readonly [number, number, number];
  look?: Partial<PaintLook>;
}

export interface Painting {
  width: number;
  height: number;
  /** RGBA8 pigment; alpha holds the patch's strand-length multiplier (÷2). */
  pixels: Uint8Array;
  /** Comb angle of the dominant patch, as a unit vector ×0.5+0.5 (RG8). */
  combs: Uint8Array;
}

const lookup = (p: Painting, x: number, z: number): number => {
  const fx = clamp((x - WORLD.minX) * TEXELS_PER_UNIT, 0, p.width - 1);
  const fz = clamp((z - WORLD.minZ) * TEXELS_PER_UNIT, 0, p.height - 1);
  return Math.round(fx) + Math.round(fz) * p.width;
};

/** Nearest-texel pigment at a world position, RGB in 0..255 written to `out`. */
export function samplePaint(p: Painting, x: number, z: number, out: Uint8Array | number[]): void {
  const i = lookup(p, x, z) * 4;
  out[0] = p.pixels[i];
  out[1] = p.pixels[i + 1];
  out[2] = p.pixels[i + 2];
  out[3] = p.pixels[i + 3];
}

/** Combed pile direction at a world position. */
export function sampleComb(p: Painting, x: number, z: number): [number, number] {
  const i = lookup(p, x, z) * 2;
  return [p.combs[i] / 127.5 - 1, p.combs[i + 1] / 127.5 - 1];
}

/**
 * Bakes the painting: patches with feathered edges, soft tonal bands from the
 * hills, slow pigment drift and directional dry-brush. Everything that wears
 * this colour (ground and every strand) reads it from here.
 */
export function buildPainting(terrain: Terrain, seed: number, opts: PaintOptions = {}): Painting {
  const sourcePatches = opts.patches ?? PATCHES;
  const look = { ...DEFAULT_LOOK, ...opts.look };
  const sun = opts.sun ?? SUN;
  const sunLen = Math.hypot(sun[0], sun[2]);
  const sunX = sun[0] / sunLen;
  const sunZ = sun[2] / sunLen;
  const climb = sun[1] / sunLen;
  const warpA = makeNoise(seed + 101);
  const warpB = makeNoise(seed + 102);
  const pigment = makeNoise(seed + 103);
  const brush = makeNoise(seed + 104);
  const width = Math.ceil((WORLD.maxX - WORLD.minX) * TEXELS_PER_UNIT);
  const height = Math.ceil((WORLD.maxZ - WORLD.minZ) * TEXELS_PER_UNIT);
  const pixels = new Uint8Array(width * height * 4);
  const combs = new Uint8Array(width * height * 2);
  const patches = sourcePatches.map((p) => ({
    ...p,
    rgb: PALETTE[p.color],
    c: Math.cos(p.rot),
    s: Math.sin(p.rot),
    cc: Math.cos(p.comb),
    cs: Math.sin(p.comb),
  }));
  const weights = new Float32Array(patches.length);

  for (let j = 0; j < height; j++) {
    const z = WORLD.minZ + (j + 0.5) / TEXELS_PER_UNIT;
    for (let i = 0; i < width; i++) {
      const x = WORLD.minX + (i + 0.5) / TEXELS_PER_UNIT;
      // organic field shapes: warp the coordinates before measuring distance
      const wx = x + 16 * warpA(x * 0.035, z * 0.035) + 6 * fbm(warpB, x * 0.11 + 5, z * 0.11, 3, 0.55) + 1.2 * warpA(x * 0.4, z * 0.4);
      const wz = z + 16 * warpB(x * 0.035 + 8, z * 0.035) + 6 * fbm(warpA, x * 0.11, z * 0.11 + 5, 3, 0.55) + 1.2 * warpB(x * 0.4, z * 0.4);
      let best = 1e9;
      let second = 1e9;
      let bestIdx = 0;
      for (let k = 0; k < patches.length; k++) {
        const p = patches[k];
        const dx = wx - p.x;
        const dz = wz - p.z;
        const u = (dx * p.c + dz * p.s) / p.sx;
        const v = (-dx * p.s + dz * p.c) / p.sz;
        const d = Math.sqrt(u * u + v * v);
        weights[k] = d;
        if (d < best) {
          second = best;
          best = d;
          bestIdx = k;
        } else if (d < second) {
          second = d;
        }
      }
      // feather: patches blend over a band a world unit or so wide
      let r = 0;
      let g = 0;
      let b = 0;
      let tall = 0;
      let sum = 0;
      for (let k = 0; k < patches.length; k++) {
        const w = Math.exp(-(weights[k] - best) * look.patchSharpness);
        if (w < 0.01) continue;
        const p = patches[k];
        r += p.rgb[0] * w;
        g += p.rgb[1] * w;
        b += p.rgb[2] * w;
        tall += p.tall * w;
        sum += w;
      }
      r /= sum;
      g /= sum;
      b /= sum;
      tall /= sum;

      // slow pigment drift, a little warmer here, cooler there
      const drift = fbm(pigment, x * 0.11, z * 0.11, 4);
      r += drift * 0.09;
      g += drift * 0.045;
      b -= drift * 0.05;

      // dry-brush along the comb of the local patch: long pale drags in the pigment
      const dom = patches[bestIdx];
      const along = x * dom.cc + z * dom.cs;
      const across = -x * dom.cs + z * dom.cc;
      const drag = fbm(brush, along * 0.16 + bestIdx * 7, across * 1.15, 3);
      // where brush direction changes between soft-edged fields, the marks fade out rather than meet in a seam
      const lift = drag * 0.11 * (look.patchSharpness < 1 ? smoothstep(0, 0.45, second - best) : 1);
      r += lift;
      g += lift;
      b += lift * 0.75;

      // tonal bands from the hills, softly posterised as a gouache painter would mass them
      const n = terrain.normal(x, z);
      const lit = (n[0] * sunX + n[2] * sunZ) * look.litGain;
      const tone = softBands(clamp(0.5 + lit, 0, 1), 5, 0.55);
      const shade = smoothstep(0.55, 0.05, tone);
      const light = smoothstep(0.55, 1, tone);
      // shadow as a glaze over the pigment, so a golden field stays golden in the shade
      r *= 1 - shade * 0.27;
      g *= 1 - shade * 0.1;
      b *= 1 - shade * 0.06;
      r = mix(r, PALETTE.warm[0], light * 0.34);
      g = mix(g, PALETTE.warm[1], light * 0.28);
      b = mix(b, PALETTE.warm[2], light * 0.2);

      if (look.castShadows) {
        // walk toward the sun: land rising above the ray puts this spot in a soft shadow
        const ground = terrain.height(x, z);
        let block = 0;
        for (let d = 1.2; d < 26; d *= 1.32) {
          const over = terrain.height(x + sunX * d, z + sunZ * d) - (ground + climb * d * 0.62);
          if (over > block) block = over;
        }
        const cast = smoothstep(0, 1.5, block) * ((look.shadowDepth ?? 0.26) / 0.26);
        r *= 1 - cast * 0.26;
        g *= 1 - cast * 0.13;
        b *= 1 - cast * 0.02;
      }
      if (look.formShade) {
        // curvature at the scale of a hill: rounded tops catch light, creases between hills fall into cool shade
        const e = 1.6;
        const h0 = terrain.height(x, z);
        const curv = (terrain.height(x + e, z) + terrain.height(x - e, z) + terrain.height(x, z + e) + terrain.height(x, z - e)) / 4 - h0;
        const top = smoothstep(0, -0.32, curv) * look.formShade;
        const crease = smoothstep(0, 0.32, curv) * look.formShade;
        r = mix(r, PALETTE.warm[0], top * 0.2);
        g = mix(g, PALETTE.warm[1], top * 0.16);
        b = mix(b, PALETTE.warm[2], top * 0.1);
        r *= 1 - crease * 0.3;
        g *= 1 - crease * 0.17;
        b *= 1 - crease * 0.06;
      }
      if (look.valleyShade > 0) {
        const low = smoothstep(2.2, 0, terrain.height(x, z) - (look.baseline?.(z) ?? 0));
        r *= 1 - low * look.valleyShade * 0.8;
        g *= 1 - low * look.valleyShade * 0.35;
        b *= 1 - low * look.valleyShade * 0.1;
      }

      // a breath of aerial perspective toward the top of the picture
      const air = smoothstep(look.airFrom, look.airTo, z) * look.airAmount;
      r = mix(r, look.airColor[0], air);
      g = mix(g, look.airColor[1], air);
      b = mix(b, look.airColor[2], air);

      const o = (i + j * width) * 4;
      pixels[o] = clamp(r, 0, 1) * 255;
      pixels[o + 1] = clamp(g, 0, 1) * 255;
      pixels[o + 2] = clamp(b, 0, 1) * 255;
      pixels[o + 3] = clamp(tall / 2, 0, 1) * 255;
      const c = (i + j * width) * 2;
      combs[c] = (dom.cc * 0.5 + 0.5) * 255;
      combs[c + 1] = (dom.cs * 0.5 + 0.5) * 255;
    }
  }
  return { width, height, pixels, combs };
}

/** Posterise softly: `n` plateaus with rounded shoulders; softness 0 is hard, 1 is linear. */
export function softBands(x: number, n: number, softness: number): number {
  const v = x * n;
  const i = Math.floor(v);
  const f = v - i;
  const k = smoothstep(0.5 - 0.5 * softness - 0.001, 0.5 + 0.5 * softness + 0.001, f);
  return mix((i + k) / n, x, 0.35);
}
