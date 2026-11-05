import { describe, expect, test } from 'vitest';
import { WindField, MAX_WIND } from '../../src/wind/field';
import { FIELD, NX, NZ } from '../../src/wind/grid';
import { GrassResponse } from '../../src/wind/response';
import { SIM_DT, WindSim } from '../../src/wind/WindSim';

function draw(sim: WindSim, pts: [number, number][], secondsPerPoint = 1 / 60, gain = 1) {
  const g = sim.begin(gain);
  for (const [x, z] of pts) {
    g.addPoint(x, z, secondsPerPoint);
    sim.step();
  }
  sim.end(g);
  return g;
}

const line = (x0: number, z0: number, x1: number, z1: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), z0 + ((z1 - z0) * i) / (n - 1)]);

const finite = (a: Float32Array) => a.every(Number.isFinite);
const maxAbs = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const quietSim = () => {
  const s = new WindSim(1);
  s.ambient.amount = 0;
  return s;
};

describe('wind field', () => {
  test('still air stays exactly still', () => {
    const f = new WindField();
    for (let i = 0; i < 120; i++) f.step(SIM_DT);
    expect(maxAbs(f.u)).toBe(0);
    expect(maxAbs(f.v)).toBe(0);
  });

  test('a push decays to nothing without a new force', () => {
    const f = new WindField();
    f.splat(0, 0, 12, 0, 3);
    for (let i = 0; i < 60 * 15; i++) f.step(SIM_DT);
    expect(maxAbs(f.u)).toBeLessThan(0.05);
  });

  test('stays finite and bounded under absurd forcing', () => {
    const f = new WindField();
    for (let i = 0; i < 240; i++) {
      f.splat(0, 0, 500, -500, 3);
      f.splat(0, 0, -500, 500, 2);
      f.splatVortex(2, 2, 900, 4);
      f.step(SIM_DT);
    }
    expect(finite(f.u)).toBe(true);
    expect(finite(f.v)).toBe(true);
    expect(Math.max(maxAbs(f.u), maxAbs(f.v))).toBeLessThanOrEqual(MAX_WIND + 1);
  });

  test('neighbouring cells stay close: no discontinuity in an ordinary gust', () => {
    const s = quietSim();
    draw(s, line(-14, 0, 14, 0, 70));
    for (let i = 0; i < 40; i++) s.step();
    let worstJump = 0;
    let peak = 0;
    for (let j = 1; j < NZ - 1; j++) {
      for (let i = 1; i < NX - 1; i++) {
        const a = i + j * NX;
        const w = Math.hypot(s.field.u[a], s.field.v[a]);
        peak = Math.max(peak, w);
        const nb = Math.hypot(s.field.u[a + 1], s.field.v[a + 1]);
        const nc = Math.hypot(s.field.u[a + NX], s.field.v[a + NX]);
        worstJump = Math.max(worstJump, Math.abs(w - nb), Math.abs(w - nc));
      }
    }
    expect(peak).toBeGreaterThan(1.5);
    // a Gaussian push of radius 3 has a natural slope of about 12% of its peak per cell
    expect(worstJump / peak).toBeLessThan(0.2);
  });
});

describe('gestures to wind', () => {
  test('a stroke blows along its direction', () => {
    const s = quietSim();
    draw(s, line(-10, 0, 10, 0, 60));
    for (let i = 0; i < 20; i++) s.step();
    expect(s.field.sample(4, 0)[0]).toBeGreaterThan(2);
    const left = quietSim();
    draw(left, line(10, 0, -10, 0, 60));
    for (let i = 0; i < 20; i++) left.step();
    expect(left.field.sample(-4, 0)[0]).toBeLessThan(-2);
  });

  test('wind arrives later further along the stroke: it travels', () => {
    const s = quietSim();
    // a very quick flick, all drawn in three steps: the head must still take time to get there
    const g = s.begin(1);
    for (const [x, z] of line(-16, 0, 16, 0, 3)) {
      g.addPoint(x, z, 0.03);
      s.step();
    }
    s.end(g);
    const arrive = (x: number): number => {
      const t = quietSim();
      const h = t.begin(1);
      for (const [px, pz] of line(-16, 0, 16, 0, 3)) {
        h.addPoint(px, pz, 0.03);
        t.step();
      }
      t.end(h);
      for (let i = 0; i < 400; i++) {
        t.step();
        if (t.field.sample(x, 0)[0] > 1.2) return i;
      }
      return 1e9;
    };
    const early = arrive(-8);
    const late = arrive(10);
    expect(early).toBeLessThan(late);
    expect(late - early).toBeGreaterThan(15); // over a quarter of a second
    expect(late).toBeLessThan(200);
  });

  test('grass responds during the gesture, before release', () => {
    const s = quietSim();
    const g = s.begin(1);
    for (const [x, z] of line(-8, 0, 2, 0, 40)) {
      g.addPoint(x, z, 1 / 60);
      s.step();
    }
    expect(g.drawing).toBe(true);
    expect(Math.hypot(...s.bendAt(-2, 0))).toBeGreaterThan(0.05);
  });

  test('a fast pointer gives bounded force, a slow one still has real effect', () => {
    const fast = quietSim();
    draw(fast, line(-14, 0, 14, 0, 5), 1 / 60);
    const slow = quietSim();
    draw(slow, line(-14, 0, 14, 0, 180), 1 / 60);
    let peakFast = 0;
    let peakSlow = 0;
    for (let i = 0; i < 180; i++) {
      fast.step();
      slow.step();
      peakFast = Math.max(peakFast, maxAbs(fast.field.u));
      peakSlow = Math.max(peakSlow, maxAbs(slow.field.u));
    }
    expect(peakFast).toBeLessThanOrEqual(MAX_WIND);
    expect(peakSlow).toBeGreaterThan(3);
  });

  test('a spiral makes rotating flow in the direction it was drawn', () => {
    for (const dir of [1, -1]) {
      const s = quietSim();
      const pts: [number, number][] = [];
      for (let i = 0; i < 180; i++) {
        const a = dir * (i / 180) * Math.PI * 5;
        const r = 1 + (i / 180) * 5;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      const g = draw(s, pts);
      expect(g.kind).toBe('whirl');
      for (let i = 0; i < 30; i++) s.step();
      // circulation around the centre has the sign the stroke turned
      let circ = 0;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const [u, v] = s.field.sample(Math.cos(a) * 4, Math.sin(a) * 4);
        circ += -Math.sin(a) * u + Math.cos(a) * v;
      }
      expect(Math.sign(circ)).toBe(dir);
      expect(Math.abs(circ) / 48).toBeGreaterThan(1);
    }
  });

  test('an opposing gust reduces wind where they meet', () => {
    const one = quietSim();
    draw(one, line(-10, 0, 8, 0, 60));
    const both = quietSim();
    draw(both, line(-10, 0, 8, 0, 60));
    draw(both, line(10, 0, -8, 0, 60));
    for (let i = 0; i < 10; i++) {
      one.step();
      both.step();
    }
    expect(Math.abs(both.field.sample(1, 0)[0])).toBeLessThan(Math.abs(one.field.sample(1, 0)[0]));
  });

  test('a tap makes a small outward breath', () => {
    const s = quietSim();
    const g = s.begin(1);
    g.addPoint(3, 2, 1 / 60);
    s.end(g);
    for (let i = 0; i < 8; i++) s.step();
    expect(s.bendAt(5, 2)[0]).toBeGreaterThan(0.03);
    expect(s.bendAt(1, 2)[0]).toBeLessThan(-0.03);
    expect(Math.abs(s.bendAt(20, 2)[0])).toBeLessThan(0.001);
    expect(g.kind).toBe('breath');
  });
});

describe('grass response', () => {
  const steady = (u: number, frames: number, r = new GrassResponse()) => {
    const wu = new Float32Array(NX * NZ).fill(u);
    const wv = new Float32Array(NX * NZ);
    for (let i = 0; i < frames; i++) r.step(wu, wv, SIM_DT);
    return r;
  };

  test('zero wind leaves grass at rest', () => {
    expect(maxAbs(steady(0, 300).bend)).toBe(0);
  });

  test('bends with the wind; slow spring lags the quick one', () => {
    const r = steady(8, 10);
    expect(r.bend[0]).toBeGreaterThan(0);
    expect(r.bend[2]).toBeGreaterThan(r.bend[0]);
  });

  test('recovers to rest, overshooting only gently', () => {
    const r = steady(8, 240);
    const held = r.bend[0];
    expect(held).toBeGreaterThan(0.6);
    const wu = new Float32Array(NX * NZ);
    const wv = new Float32Array(NX * NZ);
    let lowest = Infinity;
    for (let i = 0; i < 60 * 6; i++) {
      r.step(wu, wv, SIM_DT);
      lowest = Math.min(lowest, r.bend[0]);
    }
    expect(Math.abs(r.bend[0])).toBeLessThan(0.002);
    expect(lowest).toBeLessThan(0); // it does overshoot...
    expect(lowest).toBeGreaterThan(-held * 0.3); // ...softly, not like rubber
  });

  test('flutter energy lingers after the wind drops, then fades', () => {
    const r = steady(10, 120);
    const peak = r.energy[0];
    const wu = new Float32Array(NX * NZ);
    const wv = new Float32Array(NX * NZ);
    for (let i = 0; i < 60; i++) r.step(wu, wv, SIM_DT);
    expect(r.energy[0]).toBeGreaterThan(peak * 0.5);
    for (let i = 0; i < 60 * 15; i++) r.step(wu, wv, SIM_DT);
    expect(r.energy[0]).toBeLessThan(peak * 0.01);
  });

  test('saturates: a gale is bounded', () => {
    expect(maxAbs(steady(1000, 400).bend)).toBeLessThan(2.4);
  });
});

describe('sim clock', () => {
  test('any frame rate gives the same wind at the same time', () => {
    const run = (hz: number) => {
      const s = new WindSim(7);
      const g = s.begin(1);
      let last = 0;
      for (let t = 0; t < 2; t += 1 / hz) {
        s.advance(1 / hz);
        const stepsNow = s.steps;
        while (last < stepsNow && last < 90) {
          g.addPoint(-12 + last * 0.25, 0, SIM_DT);
          last++;
        }
        if (last >= 90 && g.drawing) s.end(g);
      }
      return s;
    };
    const a = run(30);
    const b = run(144);
    const stepsCompared = Math.min(a.steps, b.steps);
    expect(stepsCompared).toBeGreaterThan(100);
    // compare at a matching step count by running both forward
    while (a.steps < 130) a.step();
    while (b.steps < 130) b.step();
    expect(a.steps).toBe(b.steps);
    expect(Math.abs(a.field.sample(8, 0)[0] - b.field.sample(8, 0)[0])).toBeLessThan(1.5);
  });

  test('a long stall costs no catch-up', () => {
    const s = new WindSim(1);
    s.advance(10);
    expect(s.steps).toBeLessThanOrEqual(4);
  });

  test('pausing freezes time, and resume continues without a jump', () => {
    const s = new WindSim(1);
    draw(s, line(-8, 0, 8, 0, 40));
    const before = s.steps;
    const t = s.time;
    const was = s.field.sample(4, 0)[0];
    s.paused = true;
    s.advance(1);
    expect(s.steps).toBe(before);
    expect(s.time).toBe(t);
    s.paused = false;
    s.advance(SIM_DT);
    expect(Math.abs(s.field.sample(4, 0)[0] - was)).toBeLessThan(1);
  });

  test('undo stops the latest gust and stills its air, and leaves the earlier one', () => {
    const s = quietSim();
    const first = draw(s, line(-30, 8, 6, 8, 110));
    const second = draw(s, line(-6, -6, 12, -6, 12));
    expect(first.finished).toBe(false);
    expect(s.undoLatest()).toBe(second);
    expect(s.gusts).not.toContain(second);
    expect(s.gusts).toContain(first);
    const control = quietSim();
    draw(control, line(-30, 8, 6, 8, 110));
    draw(control, line(-6, -6, 12, -6, 12));
    for (let i = 0; i < 50; i++) {
      s.step();
      control.step();
    }
    const calmed = Math.abs(s.field.sample(6, -6)[0]);
    const untouched = Math.abs(control.field.sample(6, -6)[0]);
    expect(calmed).toBeLessThan(untouched * 0.4);
  });

  test('clear removes gusts but keeps the breeze', () => {
    const s = new WindSim(3);
    draw(s, line(-8, 0, 8, 0, 40));
    s.clear();
    expect(s.gusts.length).toBe(0);
    for (let i = 0; i < 180; i++) s.step();
    expect(maxAbs(s.response.bend)).toBeGreaterThan(0.005);
    expect(maxAbs(s.field.u)).toBeLessThan(0.5);
  });

  test('ambient breeze is gentle next to a real gust, and varies smoothly', () => {
    const s = new WindSim(3);
    for (let i = 0; i < 30; i++) s.step();
    const speed = (a: number) => Math.hypot(s.ambient.u[a], s.ambient.v[a]);
    let peak = 0;
    let jump = 0;
    for (let j = 0; j < NZ - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const a = i + j * NX;
        peak = Math.max(peak, speed(a));
        jump = Math.max(jump, Math.abs(speed(a) - speed(a + 1)), Math.abs(speed(a) - speed(a + NX)));
      }
    }
    expect(peak).toBeLessThan(1.3);
    expect(peak).toBeGreaterThan(0.3);
    expect(jump).toBeLessThan(0.25);
    expect(FIELD.cell).toBeGreaterThan(0);
  });
});
