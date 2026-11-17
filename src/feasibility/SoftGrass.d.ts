import type { Object3D, Vector3 } from 'three';
import type { GrassOptions, Flattener } from './vendor/WindSweptGrass';

export class SoftGrass {
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

