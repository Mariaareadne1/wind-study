/** Seeded 2D gradient noise and helpers. Pure and deterministic, so the painting is reproducible. */

export type Noise2 = (x: number, y: number) => number;

/** Small, fast deterministic RNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Classic gradient noise, roughly in [-0.7, 0.7]. */
export function makeNoise(seed: number): Noise2 {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rng() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const aa = perm[perm[X] + Y];
    const ba = perm[perm[X + 1] + Y];
    const ab = perm[perm[X] + Y + 1];
    const bb = perm[perm[X + 1] + Y + 1];
    const n00 = gx[aa] * fx + gy[aa] * fy;
    const n10 = gx[ba] * (fx - 1) + gy[ba] * fy;
    const n01 = gx[ab] * fx + gy[ab] * (fy - 1);
    const n11 = gx[bb] * (fx - 1) + gy[bb] * (fy - 1);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return a + v * (b - a);
  };
}

export function fbm(n: Noise2, x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2.03): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(fx, fy);
    norm += amp;
    amp *= gain;
    fx = fx * lacunarity + 17.3;
    fy = fy * lacunarity - 9.1;
  }
  return sum / norm;
}

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
