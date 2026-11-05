import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bendAt, frameDiff, open, snap } from './helpers';

test.describe('the meadow', () => {
  test('opens, renders green painted grass, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await open(page);
    await snap(page, 'a', 2);
    const stats = await page.evaluate(() => {
      const w = window.__wind!;
      const d = window.__frames!.a;
      let r = 0, g = 0, b = 0, n = 0, varSum = 0;
      for (let i = 0; i < d.length; i += 400) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        varSum += Math.abs(d[i + 1] - d[i + 5]);
      }
      return { r: r / n, g: g / n, b: b / n, detail: varSum / n, strands: w.app.grass.drawn };
    });
    expect(stats.g).toBeGreaterThan(stats.r);
    expect(stats.g).toBeGreaterThan(stats.b + 30);
    expect(stats.detail).toBeGreaterThan(2); // fibres, not a flat fill
    expect(stats.strands).toBe(180000);
    expect(errors).toEqual([]);
  });

  test('a real pointer drag draws a gust, and grass moves during the drag', async ({ page }) => {
    await open(page);
    const hint = page.getByText('Draw to make the wind blow.');
    await expect(hint).toBeVisible();
    await snap(page, 'rest', 30);
    const box = (await page.locator('canvas').boundingBox())!;
    await page.mouse.move(box.width * 0.25, box.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(box.width * (0.25 + i * 0.015), box.height * 0.5);
      await page.evaluate(() => window.__wind!.app.stepFrames(1));
    }
    // still holding: the gust is live, and the region under the stroke has really changed
    await snap(page, 'during', 3);
    const under = await frameDiff(page, 'rest', 'during', [0.25, 0.42, 0.55, 0.58]);
    const far = await frameDiff(page, 'rest', 'during', [0.75, 0.05, 0.98, 0.2]);
    expect(under).toBeGreaterThan(far * 1.5);
    expect(await page.evaluate(() => window.__wind!.store.get().active)).toBeGreaterThan(0);
    await page.mouse.up();
    await expect(hint).toBeHidden();

    // and it keeps travelling after release
    await page.evaluate(() => window.__wind!.app.stepFrames(40));
    const q = await page.evaluate(() => {
      const s = window.__wind!.app.sim;
      let peak = 0;
      for (let a = 0; a < s.totalU.length; a++) peak = Math.max(peak, Math.hypot(s.field.u[a], s.field.v[a]));
      return peak;
    });
    expect(q).toBeGreaterThan(2);
  });

  test('stroke direction sets bend direction; the picture differs between them', async ({ page }) => {
    await open(page);
    await snap(page, 'base', 10);
    const run = async (from: number, to: number) => {
      await page.evaluate(
        ([a, b]) => {
          const w = window.__wind!;
          const pts: [number, number][] = [];
          for (let i = 0; i < 60; i++) pts.push([a + ((b - a) * i) / 59, 0]);
          w.app.playStroke({ points: pts });
          w.app.stepFrames(75);
        },
        [from, to],
      );
      return bendAt(page, 2, 0);
    };
    const right = await run(-12, 12);
    await snap(page, 'right', 0);
    await page.evaluate(() => window.__wind!.app.resetScene());
    const left = await run(12, -12);
    await snap(page, 'left', 0);
    expect(right[0]).toBeGreaterThan(0.15);
    expect(left[0]).toBeLessThan(-0.15);
    expect(await frameDiff(page, 'right', 'left', [0.3, 0.35, 0.7, 0.65])).toBeGreaterThan(4);
  });

  test('a drawn spiral makes rotating flow, moving the picture around its centre', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const w = window.__wind!;
      w.app.play('spiral');
      w.app.stepFrames(130);
    });
    const circ = await page.evaluate(() => {
      const s = window.__wind!.app.sim;
      let c = 0;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const [u, v] = s.field.sample(1 + Math.cos(a) * 4, -1 + Math.sin(a) * 4);
        c += -Math.sin(a) * u + Math.cos(a) * v;
      }
      return c / 36;
    });
    expect(circ).toBeLessThan(-1); // the pattern turns the negative way
  });

  test('overlapping gusts combine and stay stable', async ({ page }) => {
    await open(page);
    const peak = await page.evaluate(() => {
      const w = window.__wind!;
      for (let k = 0; k < 6; k++) w.app.play('crossing');
      w.app.stepFrames(300);
      const s = w.app.sim;
      let p = 0;
      for (let a = 0; a < s.response.bend.length; a++) {
        if (!Number.isFinite(s.response.bend[a])) return Infinity;
        p = Math.max(p, Math.abs(s.response.bend[a]));
      }
      return p;
    });
    expect(peak).toBeLessThan(2.5);
    expect(peak).toBeGreaterThan(0.2);
  });
});

test.describe('controls', () => {
  test('pause stops simulation time and the picture; resume continues without a jump', async ({ page }) => {
    await open(page, 'fixed&tufts=30000');
    await page.keyboard.press('1');
    await page.waitForFunction(() => window.__wind!.app.sim.steps > 40);
    await page.getByRole('button', { name: 'Pause' }).click();
    const t0 = await page.evaluate(() => window.__wind!.app.sim.time);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__wind!.app.sim.time)).toBe(t0);
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.waitForFunction((t) => window.__wind!.app.sim.time > t, t0);
    const t1 = await page.evaluate(() => window.__wind!.app.sim.time);
    expect(t1 - t0).toBeLessThan(1);
  });

  test('undo calms the latest gust, clear keeps the breeze, reset restores the start', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=30000');
    await page.keyboard.press('4');
    await page.evaluate(() => window.__wind!.app.stepFrames(40));
    await page.evaluate(() => window.__wind!.store.set({ active: window.__wind!.app.sim.activeGusts }));
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeEnabled();
    const before = await page.evaluate(() => window.__wind!.app.sim.gusts.length);
    await undo.click();
    expect(await page.evaluate(() => window.__wind!.app.sim.gusts.length)).toBe(before - 1);
    await page.getByRole('button', { name: 'Clear' }).click();
    const cleared = await page.evaluate(() => {
      const w = window.__wind!;
      w.app.stepFrames(240);
      return { gusts: w.app.sim.gusts.length, ambient: Math.hypot(w.app.sim.totalU[6000], w.app.sim.totalV[6000]) };
    });
    expect(cleared.gusts).toBe(0);
    expect(cleared.ambient).toBeGreaterThan(0.01);

    await page.getByRole('radio', { name: 'Gale' }).click();
    await page.getByRole('button', { name: 'Reset' }).click();
    const state = await page.evaluate(() => ({ t: window.__wind!.app.sim.time, s: window.__wind!.store.get().strength, g: window.__wind!.app.sim.gusts.length }));
    expect(state.t).toBeLessThan(0.1);
    expect(state.s).toBe('gust');
    expect(state.g).toBe(0);
  });

  test('capture writes a real PNG of the scene without the interface', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=30000');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Capture' }).click()]);
    const file = await download.path();
    const bytes = readFileSync(file);
    expect(download.suggestedFilename()).toMatch(/^wind-study-.*\.png$/);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeGreaterThan(100_000);
  });

  test('hide interface hides every control; the key brings it back', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeHidden();
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  });

  test('help opens, its pattern buttons blow real wind', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('button', { name: 'A spiral' }).click();
    await page.evaluate(() => window.__wind!.app.stepFrames(30));
    expect(await page.evaluate(() => window.__wind!.app.sim.gusts.length)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'A spiral' })).toBeHidden();
  });

  test('resizing keeps the wind, and keeps the pointer mapped to the ground', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.__wind!.app.play('sweep');
      window.__wind!.app.stepFrames(50);
    });
    const steps = await page.evaluate(() => window.__wind!.app.sim.steps);
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__wind!.app.sim.steps)).toBe(steps);
    const box = (await page.locator('canvas').boundingBox())!;
    expect(box.width).toBe(900);
    await page.mouse.move(450, 350);
    await page.mouse.down();
    await page.mouse.move(600, 360, { steps: 6 });
    await page.mouse.up();
    const points = await page.evaluate(() => {
      const g = window.__wind!.app.sim.gusts.at(-1)!;
      return g.points.length;
    });
    expect(points).toBeGreaterThan(5);
  });

  test('survives a lost graphics context', async ({ page }) => {
    await open(page, 'fixed&tufts=30000');
    await page.evaluate(() => {
      const gl = window.__wind!.app.renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context')!;
      ext.loseContext();
      setTimeout(() => ext.restoreContext(), 300);
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toBeHidden({ timeout: 10_000 });
    const t = await page.evaluate(() => window.__wind!.app.sim.time);
    await page.waitForFunction((t) => window.__wind!.app.sim.time > t + 0.2, t);
  });
});

test.describe('strand shape in the actual GLSL', () => {
  test('the shader matches the tested formula: roots anchored, length preserved', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=2000');
    const result = await page.evaluate(() => {
      const { BEND_GLSL, strandPoint } = window.__wind!.lib;
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vs, `#version 300 es
        precision highp float;
        in vec4 aIn; // t, h, ax, az
        out vec3 vOut;
        ${BEND_GLSL}
        void main() { vec3 tan; vOut = strandPoint(aIn.x, aIn.y, aIn.zw, tan); gl_Position = vec4(0.0); }`);
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fs, `#version 300 es
        precision highp float; out vec4 c; void main() { c = vec4(0.0); }`);
      gl.compileShader(fs);
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.transformFeedbackVaryings(prog, ['vOut'], gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: gl.getProgramInfoLog(prog) ?? gl.getShaderInfoLog(vs) };
      const inputs: number[] = [];
      const bends = [[0, 0], [0.3, 0], [0, -0.9], [1.2, 1.2], [4, -3], [-0.001, 0.0005]];
      const SAMPLES = 33;
      for (const [ax, az] of bends) for (let i = 0; i < SAMPLES; i++) inputs.push(i / (SAMPLES - 1), 0.8, ax, az);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inputs), gl.STATIC_DRAW);
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'aIn');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
      const out = gl.createBuffer();
      const n = inputs.length / 4;
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
      gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, n * 12, gl.STATIC_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      const res = new Float32Array(n * 3);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, res);

      let worstFormula = 0;
      let worstRoot = 0;
      let worstLength = 0;
      for (let b = 0; b < bends.length; b++) {
        let len = 0;
        for (let i = 0; i < SAMPLES; i++) {
          const k = (b * SAMPLES + i) * 3;
          const t = i / (SAMPLES - 1);
          const m = strandPoint(t, 0.8, bends[b][0], bends[b][1]);
          worstFormula = Math.max(worstFormula, Math.abs(res[k] - m[0]), Math.abs(res[k + 1] - m[1]), Math.abs(res[k + 2] - m[2]));
          if (i === 0) worstRoot = Math.max(worstRoot, Math.abs(res[k]), Math.abs(res[k + 1]), Math.abs(res[k + 2]));
          else len += Math.hypot(res[k] - res[k - 3], res[k + 1] - res[k - 2], res[k + 2] - res[k - 1]);
        }
        worstLength = Math.max(worstLength, Math.abs(len - 0.8));
      }
      const tips = [res[(SAMPLES - 1) * 3 + 1], res[(SAMPLES * 4 + SAMPLES - 1) * 3], res[(SAMPLES * 4 + SAMPLES - 1) * 3 + 1]];
      return { worstFormula, worstRoot, worstLength, tips };
    });
    expect(result.error).toBeUndefined();
    expect(result.worstRoot).toBe(0);
    expect(result.worstFormula!).toBeLessThan(1e-3);
    expect(result.worstLength!).toBeLessThan(2e-3);
    // unbent tip is straight up; a hard bend leans it far over and lower
    expect(result.tips![0]).toBeCloseTo(0.8, 3);
    expect(result.tips![1]).toBeGreaterThan(0.3);
    expect(result.tips![2]).toBeLessThan(0.65);
  });
});

test.describe('travelling wave, measured on pixels', () => {
  test('the gust front moves left to right across the picture', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=30000');
    await page.evaluate(() => {
      const w = window.__wind!;
      w.app.sim.ambient.amount = 0;
      w.app.sim.reset();
      w.app.stepFrames(10);
    });
    await snap(page, 'r', 0);
    await page.evaluate(() => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 90; i++) pts.push([-20 + (40 * i) / 89, 0]);
      window.__wind!.app.playStroke({ points: pts });
    });
    await snap(page, 'early', 28);
    await snap(page, 'late', 62);
    const col = (a: string, x0: number) => frameDiff(page, 'r', a, [x0, 0.35, x0 + 0.15, 0.7]);
    const earlyLeft = await col('early', 0.2);
    const earlyRight = await col('early', 0.7);
    const lateRight = await col('late', 0.7);
    expect(earlyLeft).toBeGreaterThan(earlyRight * 2);
    expect(lateRight).toBeGreaterThan(earlyRight * 2);
    // then the field settles back toward the rest picture
    await snap(page, 'after', 600);
    expect(await frameDiff(page, 'r', 'after', [0.3, 0.35, 0.7, 0.7])).toBeLessThan((await col('late', 0.5)) * 0.35);
  });
});
