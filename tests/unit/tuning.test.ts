import { describe, expect, test } from 'vitest';
import { DEFAULT_TUNING, frameMargin, PRESETS, presetOf, sanitizeTuning, TUNING_CONTROLS, tuningFromQuery } from '../../src/state/tuning';
import { NX, NZ } from '../../src/wind/grid';
import { pattern, scaleStroke, DEMO_SECONDS, DEMO_TIMELINE } from '../../src/wind/patterns';
import { WindSim } from '../../src/wind/WindSim';

describe('settings', () => {
  test('default is exactly the design: every multiplier is 1', () => {
    for (const { key } of TUNING_CONTROLS) expect(DEFAULT_TUNING[key]).toBe(1);
    expect(presetOf({ ...DEFAULT_TUNING })).toBe('default');
  });

  test('every preset is within the slider ranges and is recognised', () => {
    for (const name of ['less', 'default', 'more'] as const) {
      expect(sanitizeTuning(PRESETS[name])).toEqual(PRESETS[name]);
      expect(presetOf(PRESETS[name])).toBe(name);
    }
    expect(presetOf({ ...DEFAULT_TUNING, lean: 1.1 })).toBeNull();
  });

  test('bad stored or URL values fall back or clamp, never NaN', () => {
    expect(sanitizeTuning(null)).toEqual(DEFAULT_TUNING);
    expect(sanitizeTuning({ lean: 'x', force: NaN, sway: 99, flutter: -4 })).toEqual({ ...DEFAULT_TUNING, sway: 1.6, flutter: 0 });
    expect(tuningFromQuery(new URLSearchParams('preset=nope&lean=&force=abc'), DEFAULT_TUNING)).toEqual(DEFAULT_TUNING);
  });

  test('the URL picks a preset and can adjust it', () => {
    const t = tuningFromQuery(new URLSearchParams('preset=more&lean=1.2'), DEFAULT_TUNING);
    expect(t.lean).toBe(1.2);
    expect(t.force).toBe(PRESETS.more.force);
  });

  test('the border scales with the frame and has a floor', () => {
    expect(frameMargin(1000, 1000)).toBe(45);
    expect(frameMargin(200, 300)).toBe(16);
  });
});

describe('what the settings do to the wind', () => {
  const bentBy = (t = DEFAULT_TUNING, gain = t.force) => {
    const s = new WindSim(4);
    s.applyTuning(t);
    const g = s.begin(gain);
    for (let i = 0; i < 60; i++) {
      g.addPoint(-14 + i * 0.47, 0, 1 / 60);
      s.step();
    }
    s.end(g);
    for (let i = 0; i < 20; i++) s.step();
    return { s, peak: Math.max(...s.response.bend.map(Math.abs)) };
  };

  test('more moves the grass further than default, default further than less', () => {
    const less = bentBy(PRESETS.less).peak * PRESETS.less.lean;
    const normal = bentBy().peak;
    const more = bentBy(PRESETS.more).peak * PRESETS.more.lean;
    expect(less).toBeLessThan(normal * 0.45);
    expect(more).toBeGreaterThan(normal * 1.3);
  });

  test('settings at default change nothing at all', () => {
    const plain = new WindSim(4);
    const applied = new WindSim(4);
    applied.applyTuning(DEFAULT_TUNING);
    for (const s of [plain, applied]) {
      const g = s.begin(1);
      for (let i = 0; i < 40; i++) {
        g.addPoint(-8 + i * 0.4, 0, 1 / 60);
        s.step();
      }
    }
    expect(Array.from(applied.response.bend)).toEqual(Array.from(plain.response.bend));
  });

  test('linger slows the fade; every extreme stays finite and bounded', () => {
    const remaining = (linger: number) => {
      const { s } = bentBy({ ...DEFAULT_TUNING, linger });
      for (let i = 0; i < 180; i++) s.step();
      return Math.max(...s.field.u.map(Math.abs));
    };
    expect(remaining(2.5)).toBeGreaterThan(remaining(0.5) * 3);
    for (const t of [
      { force: 2.5, lean: 1.8, sway: 1.6, linger: 2.5, flutter: 3, breeze: 3 },
      { force: 2.5, lean: 1.8, sway: 0.5, linger: 2.5, flutter: 3, breeze: 3 },
      { force: 0.25, lean: 0.25, sway: 0.5, linger: 0.5, flutter: 0, breeze: 0 },
    ]) {
      const { s, peak } = bentBy(t);
      for (let i = 0; i < 300; i++) s.step();
      expect(s.response.bend.every(Number.isFinite)).toBe(true);
      expect(peak).toBeLessThan(3);
    }
    expect(NX * NZ).toBeGreaterThan(0);
  });

  test('zero breeze means truly still air', () => {
    const s = new WindSim(2);
    s.applyTuning({ ...DEFAULT_TUNING, breeze: 0 });
    for (let i = 0; i < 60; i++) s.step();
    expect(Math.max(...s.response.bend.map(Math.abs))).toBe(0);
  });
});

describe('demo', () => {
  test('the timeline fits inside its 20 seconds, and gestures scale about the origin', () => {
    for (const b of DEMO_TIMELINE) expect(b.at).toBeLessThan(DEMO_SECONDS - 2);
    const [s] = pattern('sweep');
    const half = scaleStroke(s, 0.5);
    expect(half.points[0][0]).toBeCloseTo(s.points[0][0] / 2);
    expect(half.points.length).toBe(s.points.length);
  });
});
