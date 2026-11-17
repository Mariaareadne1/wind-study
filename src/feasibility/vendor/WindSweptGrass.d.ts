import type { Object3D, Vector2, Vector3 } from 'three';

export interface GrassTerrain {
  size: number;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, target: Vector3): Vector3;
  isPath(x: number, z: number): boolean;
  path: { width: number; shoulderWidth: number; nearest(x: number, z: number): { distance: number } };
}

export interface GrassOptions {
  terrain: GrassTerrain;
  quality?: 'low' | 'medium' | 'high' | 'auto' | number;
  seed?: number;
  windDirection?: Vector2;
  clearings?: { x: number; z: number; radius: number; hardness: number }[];
}

export interface Flattener {
  id: string;
  position: Vector3;
  radius: number;
  strength: number;
  trail?: boolean;
}

export class WindSweptGrass {
  constructor(options: GrassOptions);
  readonly object3d: Object3D;
  readonly uniforms: Record<string, { value: unknown }>;
  readonly telemetry: Record<string, unknown>;
  readonly bladeCount: number;
  setFlatteners(items: Flattener[]): void;
  setSunDirection(direction: Vector3): void;
  update(deltaSeconds: number, elapsedSeconds: number): void;
  dispose(): void;
}
