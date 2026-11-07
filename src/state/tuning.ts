/** Every setting is a multiplier on the art-directed default, so 1 always means "as designed". */
export interface Tuning {
  /** How hard a drawn stroke pushes the air. */
  force: number;
  /** How far the grass leans for a given wind. */
  lean: number;
  /** How quickly the grass sways and recovers. */
  sway: number;
  /** How long moved air and trembling tips take to die down. */
  linger: number;
  /** How much the tips tremble. */
  flutter: number;
  /** The ambient breeze when nothing is drawn. */
  breeze: number;
}

export type TuningKey = keyof Tuning;
export type PresetName = 'less' | 'default' | 'more';

export const DEFAULT_TUNING: Readonly<Tuning> = { force: 1, lean: 1, sway: 1, linger: 1, flutter: 1, breeze: 1 };

export const TUNING_CONTROLS: readonly { key: TuningKey; label: string; hint: string; min: number; max: number }[] = [
  { key: 'force', label: 'Wind force', hint: 'How hard a stroke pushes the air', min: 0.25, max: 2.5 },
  { key: 'lean', label: 'Grass lean', hint: 'How far the grass bends', min: 0.25, max: 1.8 },
  { key: 'sway', label: 'Sway speed', hint: 'How quickly the grass moves and recovers', min: 0.5, max: 1.6 },
  { key: 'linger', label: 'Linger', hint: 'How long the wind takes to die down', min: 0.5, max: 2.5 },
  { key: 'flutter', label: 'Tip flutter', hint: 'How much the tips tremble', min: 0, max: 3 },
  { key: 'breeze', label: 'Idle breeze', hint: 'Movement when nothing is drawn', min: 0, max: 3 },
];

export const PRESETS: Readonly<Record<PresetName, Readonly<Tuning>>> = {
  less: { force: 0.35, lean: 0.35, sway: 1.3, linger: 0.65, flutter: 0.35, breeze: 0.4 },
  default: DEFAULT_TUNING,
  more: { force: 2.2, lean: 1.7, sway: 0.92, linger: 1.8, flutter: 2.4, breeze: 1.8 },
};

/** Which preset these settings are exactly, if any. */
export function presetOf(t: Tuning): PresetName | null {
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const p = PRESETS[name];
    if (TUNING_CONTROLS.every(({ key }) => Math.abs(p[key] - t[key]) < 1e-3)) return name;
  }
  return null;
}

/** Fills gaps with defaults and clamps to range. Stored and URL values are never trusted. */
export function sanitizeTuning(input: unknown): Tuning {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const out: Tuning = { ...DEFAULT_TUNING };
  for (const { key, min, max } of TUNING_CONTROLS) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v));
  }
  return out;
}

const isPreset = (s: string | null): s is PresetName => s === 'less' || s === 'default' || s === 'more';

/** `?preset=more` and `?lean=1.3` make a look shareable and repeatable. They win over stored settings. */
export function tuningFromQuery(q: URLSearchParams, base: Tuning): Tuning {
  const preset = q.get('preset');
  const start: Tuning = isPreset(preset) ? { ...PRESETS[preset] } : { ...base };
  for (const { key } of TUNING_CONTROLS) {
    const v = q.get(key);
    if (v !== null && v.trim() !== '' && Number.isFinite(Number(v))) start[key] = Number(v);
  }
  return sanitizeTuning(start);
}

// v2: the painted border became the default
const STORAGE_KEY = 'wind-study-tuning-v2';
/** The border is on unless someone turns it off. */
export const DEFAULT_FRAMED = true;

export function loadStored(): { tuning: Tuning; framed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tuning: { ...DEFAULT_TUNING }, framed: DEFAULT_FRAMED };
    const parsed = JSON.parse(raw) as { tuning?: unknown; framed?: unknown };
    return { tuning: sanitizeTuning(parsed.tuning), framed: typeof parsed.framed === 'boolean' ? parsed.framed : DEFAULT_FRAMED };
  } catch {
    return { tuning: { ...DEFAULT_TUNING }, framed: DEFAULT_FRAMED };
  }
}

export function saveStored(tuning: Tuning, framed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tuning, framed }));
  } catch {
    // private windows can refuse storage; the settings still apply for this visit
  }
}

/** Width of the painted border in CSS px. styles.css uses the same rule for --mat. */
export function frameMargin(cssWidth: number, cssHeight: number): number {
  return Math.max(16, Math.min(cssWidth, cssHeight) * 0.045);
}
