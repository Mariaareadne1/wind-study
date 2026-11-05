/** The field covers a little more than any frame can see, in square cells. */
export const FIELD = {
  minX: -38,
  minZ: -30,
  width: 76,
  depth: 52,
  cell: 0.42,
} as const;

export const NX = Math.round(FIELD.width / FIELD.cell);
export const NZ = Math.round(FIELD.depth / FIELD.cell);

/** Bilinear lookup of a cell-centred scalar grid at a world position. */
export function sampleGrid(a: Float32Array, x: number, z: number): number {
  const fx = Math.min(Math.max((x - FIELD.minX) / FIELD.cell - 0.5, 0), NX - 1.001);
  const fz = Math.min(Math.max((z - FIELD.minZ) / FIELD.cell - 0.5, 0), NZ - 1.001);
  const i = fx | 0;
  const j = fz | 0;
  const u = fx - i;
  const v = fz - j;
  const k = i + j * NX;
  const p = a[k] + (a[k + 1] - a[k]) * u;
  const q = a[k + NX] + (a[k + NX + 1] - a[k + NX]) * u;
  return p + (q - p) * v;
}

/** The same lookup for one channel of an interleaved 4-channel grid. */
export function sampleGridStrided(a: Float32Array, channel: number, x: number, z: number): number {
  const fx = Math.min(Math.max((x - FIELD.minX) / FIELD.cell - 0.5, 0), NX - 1.001);
  const fz = Math.min(Math.max((z - FIELD.minZ) / FIELD.cell - 0.5, 0), NZ - 1.001);
  const i = fx | 0;
  const j = fz | 0;
  const u = fx - i;
  const v = fz - j;
  const at = (ii: number, jj: number) => a[(ii + jj * NX) * 4 + channel];
  const p = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
  const q = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
  return p + (q - p) * v;
}
