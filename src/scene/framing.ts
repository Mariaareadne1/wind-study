import { PerspectiveCamera, Vector3 } from 'three';
import { mix, smoothstep } from './noise';

export interface Framing {
  fov: number;
  pitch: number;
  distance: number;
  targetZ: number;
}

/**
 * An elevated view of the top of the grass. The landscape viewport keeps a wide
 * aerial; a phone in portrait gets a steeper, tighter frame rather than a crop.
 */
export function framingFor(aspect: number): Framing {
  const wide = smoothstep(0.6, 1.3, aspect);
  return {
    fov: mix(38, 26, wide),
    pitch: (Math.PI / 180) * mix(58, 49, wide),
    distance: mix(39, 43, wide),
    targetZ: mix(-2, 0, wide),
  };
}

export function placeCamera(camera: PerspectiveCamera, aspect: number): void {
  const f = framingFor(aspect);
  camera.fov = f.fov;
  camera.aspect = aspect;
  camera.near = 2;
  camera.far = 220;
  camera.position.set(0, Math.sin(f.pitch) * f.distance, f.targetZ + Math.cos(f.pitch) * f.distance);
  camera.lookAt(new Vector3(0, 0, f.targetZ));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export interface ScreenRays {
  origin: [number, number, number];
  /** Unnormalised ray directions at NDC corners: [-1,-1], [1,-1], [-1,1], [1,1]. */
  corners: [number, number, number][];
}

export function screenRays(camera: PerspectiveCamera): ScreenRays {
  const o = camera.position;
  const corner = (x: number, y: number): [number, number, number] => {
    const p = new Vector3(x, y, 0.5).unproject(camera).sub(o);
    return [p.x, p.y, p.z];
  };
  return { origin: [o.x, o.y, o.z], corners: [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1)] };
}
