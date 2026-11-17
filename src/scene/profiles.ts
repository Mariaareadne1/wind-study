import { framingFor, hillsFramingFor, sunlitFramingFor, type Framing } from './framing';
import type { CloudSpec } from './cloudShape';
import { HILL_PATCHES, PATCHES, SUN, SUNLIT_PATCHES, type FieldPatch } from './paint';
import { hillsClimb, hillsHeight, meadowHeight, sunlitClimb, sunlitHeight, type HeightFn } from './terrain';

export type SceneId = 'meadow' | 'hills' | 'sunlit';

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
    bare?: (x: number, z: number) => number;
    bareColor?: readonly [number, number, number];
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
  /** Photographic light instead of the painted look: fibre lighting, cast cloud shadows, a clean finish. */
  realistic?: {
    sunColor: readonly [number, number, number];
    /** Light thrown up off the sunlit land onto cloud undersides. */
    groundColor?: readonly [number, number, number];
    skyColor: readonly [number, number, number];
    finish: { lift: number; grain: number; saturation: number; soften: number; exposure?: number };
  };
  /** Long grass combed into streams. */
  long?: { length: number; width: number; troughs?: number; silver?: number };
  clouds?: readonly CloudSpec[];
  /** Light the clouds are shaded and cast their shadows by, when it should differ from the land's sun. */
  cloudSun?: readonly [number, number, number];
  /** Light the clouds' own forms are modelled by: a little in front, so their billows read. */
  cloudKey?: readonly [number, number, number];
  flowers?: { flowers: number; seedHeads: number };
  /** The land's general slope without its waves, so wave fronts can be told from the climb. */
  baseline?: (z: number) => number;
  /** Long blades swing their tips further for the same breeze: scale the idle motion down. */
  motion?: { breeze: number; flutter: number };
  /** A rider on the track: its centre line, and where the ride starts and ends. */
  cyclist?: { path: (x: number) => number; span: [number, number] };
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

/** After the photographs: a long hillside of silky grass in strong sun, low cumulus casting real shadows. */
export const SUNLIT: SceneProfile = {
  id: 'sunlit',
  height: sunlitHeight,
  marchRays: true,
  framing: sunlitFramingFor,
  patches: SUNLIT_PATCHES,
  // high and a little behind the slope: the waves' faces toward us take soft light, their troughs fall into shade
  sun: normalize([0.32, 0.72, -0.62]),
  paint: {
    litGain: 0,
    airFrom: 0,
    airTo: -30,
    airAmount: 0,
    airColor: [0.8, 0.88, 0.8],
    castShadows: false,
    valleyShade: 0,
    patchSharpness: 0.6,
  },
  grass: { refDist: 30, sizeExponent: 0.25, sizeScale: 0.85, density: 1.1, screenBias: 0.75, combJitter: 0, gustWidth: 1 },
  screenPatterns: true,
  haze: { color: [0.5, 0.6, 0.46], near: 34, far: 90, amount: 0.22 },
  realistic: {
    // linear light, in the units the filmic tonemap expects
    sunColor: [2.6, 2.35, 1.8],
    skyColor: [0.4, 0.54, 0.7],
    groundColor: [0.26, 0.3, 0.24],
    finish: { lift: 0, grain: 0.15, saturation: 0.92, soften: 0, exposure: 1 },
  },
  long: { length: 6.5, width: 0.48, troughs: 0.86, silver: 0.12 },
  // three low cumulus in the photograph's layout, read in a tall frame: big upper left, medium right, small lower left
  clouds: [
    { x: -2.6, y: 8.7, z: -0.8, width: 12.8, depth: 4.6, height: 4.8, seed: 11 },
    { x: 3.6, y: 5.7, z: 5.6, width: 7.6, depth: 3.4, height: 3.6, seed: 23 },
    { x: -3.5, y: 3.8, z: 10, width: 4.3, depth: 2.2, height: 2.3, seed: 37 },
  ],
  flowers: { flowers: 0, seedHeads: 0 },
  motion: { breeze: 0.4, flutter: 0.35 },
  // higher than the land's sun, so each cloud's shadow falls close under it, as in the photograph
  cloudSun: normalize([0.22, 0.9, -0.36]),
  cloudKey: normalize([0.55, 0.75, -0.25]),
  baseline: sunlitClimb,
};

export function profileFor(id: string | null): SceneProfile {
  return id === 'hills' ? HILLS : id === 'sunlit' ? SUNLIT : MEADOW;
}
