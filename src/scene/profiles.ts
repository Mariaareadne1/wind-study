import { framingFor, hillsFramingFor, type Framing } from './framing';
import { HILL_PATCHES, PATCHES, SUN, type FieldPatch } from './paint';
import { hillsClimb, hillsHeight, meadowHeight, type HeightFn } from './terrain';

export type SceneId = 'meadow' | 'hills';

/** Everything that differs between versions. Wind, grass, interface and tests are shared. */
export interface SceneProfile {
  id: SceneId;
  height: HeightFn;
  /** March rays for the first hit: needed when one hill can hide another. */
  marchRays: boolean;
  framing: (aspect: number) => Framing;
  patches: readonly FieldPatch[];
  sun: readonly [number, number, number];
  paint: {
    /** How strongly slope turns into light and shade. */
    litGain: number;
    /** Far distance tint: z where it starts and ends, strength, colour. */
    airFrom: number;
    airTo: number;
    airAmount: number;
    airColor: readonly [number, number, number];
    /** Soft shadows cast by one hill onto the next. */
    castShadows: boolean;
    /** Cool shade pooling in the valleys. */
    valleyShade: number;
    /** The land's general height at a depth, so valleys are judged against their surroundings. */
    baseline?: (z: number) => number;
    /** How quickly one field gives way to the next; lower is softer. */
    patchSharpness: number;
    /** Light on rounded tops and shade in the creases, from the land's curvature. */
    formShade?: number;
    /** How dark one hill's shadow falls on the next, 0..1. */
    shadowDepth?: number;
  };
  grass: {
    /** Distance at which strands are nominal size; null uses the camera height rule. */
    refDist: number | null;
    /** 0 keeps world size (full perspective); 1 keeps screen size. */
    sizeExponent: number;
    /** Finer strands make the land feel larger. */
    sizeScale: number;
    /** Multiplies the strand budget, to keep finer strands dense. */
    density: number;
    /** Below 1, packs tufts toward the top of the frame, where distant strands are small. */
    screenBias: number;
    combJitter: number;
    /** Multiplies how wide a gust is, in world units. */
    gustWidth: number;
  };
  /** Atmosphere by distance from the eye. Amount 0 turns it off. */
  haze: { color: readonly [number, number, number]; near: number; far: number; amount: number };
  /** Ready-made gestures are composed on the screen, then dropped onto whichever hill is there. */
  screenPatterns: boolean;
}

export const MEADOW: SceneProfile = {
  id: 'meadow',
  height: meadowHeight,
  marchRays: false,
  framing: framingFor,
  patches: PATCHES,
  sun: SUN,
  paint: { litGain: 3.6, airFrom: -8, airTo: -24, airAmount: 0.22, airColor: [0.84, 0.9, 0.76], castShadows: false, valleyShade: 0, patchSharpness: 2.2 },
  grass: { refDist: null, sizeExponent: 0.75, sizeScale: 1, density: 1, screenBias: 1, combJitter: 0, gustWidth: 1 },
  screenPatterns: false,
  haze: { color: [0, 0, 0], near: 30, far: 90, amount: 0 },
};

const normalize = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const HILLS: SceneProfile = {
  id: 'hills',
  height: hillsHeight,
  marchRays: true,
  framing: hillsFramingFor,
  patches: HILL_PATCHES,
  // low from the left and a little behind the viewer, so slopes facing us model clearly
  sun: normalize([-0.78, 0.5, 0.36]),
  paint: { litGain: 3, airFrom: 10, airTo: -30, airAmount: 0.08, airColor: [0.79, 0.88, 0.8], castShadows: true, valleyShade: 0.42, baseline: hillsClimb, patchSharpness: 0.85, formShade: 1, shadowDepth: 0.42 },
  grass: { refDist: 30, sizeExponent: 0.12, sizeScale: 0.6, density: 1.15, screenBias: 0.66, combJitter: 3, gustWidth: 1 },
  screenPatterns: true,
  haze: { color: [0.76, 0.86, 0.87], near: 24, far: 72, amount: 0.7 },
};

export function profileFor(id: string | null): SceneProfile {
  return id === 'hills' ? HILLS : MEADOW;
}
