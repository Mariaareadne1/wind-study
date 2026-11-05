import { PerspectiveCamera, Vector3 } from 'three';
import { mix, smoothstep } from './noise';

export interface Framing {
  fov: number;
  pitch: number;
  distance: number;
  targetZ: number;
  /** Where the camera looks, height above y=0. */
  targetY?: number;
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

/**
 * A much lower eye than the meadow: looking across the valley, with ridges
 * rising to the top of the frame. Very wide windows narrow the vertical view,
 * so the sides of the picture never run past the painted world.
 */
export function hillsFramingFor(aspect: number): Framing {
  const wide = smoothstep(0.6, 1.3, aspect);
  const limit = aspect > 1.9 ? 1.9 / aspect : 1;
  return {
    fov: mix(38, 27, wide) * limit,
    pitch: (Math.PI / 180) * mix(29, 15.5, wide),
    distance: mix(36, 41, wide),
    targetZ: mix(-3, -7, wide),
    targetY: mix(3, 4.2, wide),
  };
}

export function placeCamera(camera: PerspectiveCamera, aspect: number, framing: (aspect: number) => Framing = framingFor): void {
  const f = framing(aspect);
  const ty = f.targetY ?? 0;
  camera.fov = f.fov;
  camera.aspect = aspect;
  camera.near = 2;
  camera.far = 220;
  camera.position.set(0, ty + Math.sin(f.pitch) * f.distance, f.targetZ + Math.cos(f.pitch) * f.distance);
  camera.lookAt(new Vector3(0, ty, f.targetZ));
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
