import { BufferAttribute, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import type { GrassTerrain } from './vendor/WindSweptGrass';

/** One sculpted hillside: a ridge that curves across the view, a darker valley in front of it, a gentle rise behind. */
export const HILL_SIZE = 128;
/** The composition is authored larger; this scale keeps most of the view within WindSweptGrass's blade layers. */
const SCALE = 0.8;

function ridgeLine(x: number): number {
  return -8 + 9 * Math.sin(x * 0.034 + 0.5) + 3 * Math.sin(x * 0.081 - 1.2);
}

export function hillHeight(x: number, z: number): number {
  return SCALE * shape(x / SCALE, z / SCALE);
}

function shape(x: number, z: number): number {
  const r = ridgeLine(x);
  const ridge = 13 * Math.exp(-((z - r) ** 2) / (2 * 12 ** 2));
  const valley = -6.5 * Math.exp(-((z - r - 21) ** 2) / (2 * 7.5 ** 2)) * (0.75 + 0.25 * Math.sin(x * 0.05 + 1));
  const rise = 0.22 * Math.max(0, -(z + 10));
  const swell = 1.4 * Math.sin(x * 0.06 + z * 0.04);
  return ridge + valley + rise + swell;
}

/** The terrain contract WindSweptGrass expects; this scene has no paths. */
export function hillTerrain(): GrassTerrain {
  return {
    size: HILL_SIZE,
    heightAt: hillHeight,
    normalAt(x, z, target: Vector3) {
      const e = 0.18;
      const dx = hillHeight(x + e, z) - hillHeight(x - e, z);
      const dz = hillHeight(x, z + e) - hillHeight(x, z - e);
      return target.set(-dx, e * 2, -dz).normalize();
    },
    isPath: () => false,
    path: { width: 0, shoulderWidth: 0, nearest: () => ({ distance: Infinity }) },
  };
}

/** The ground under the grass, a soft moss tone so gaps never read as bare earth. */
export function hillMesh(color = '#4d6a33'): Mesh {
  const g = new PlaneGeometry(HILL_SIZE, HILL_SIZE, 240, 240);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hillHeight(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeVertexNormals();
  const m = new MeshStandardMaterial({ color, roughness: 0.97, metalness: 0 });
  const mesh = new Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}
