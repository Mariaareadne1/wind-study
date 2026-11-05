import { expect, test } from '@playwright/test';
import { open } from './helpers';

test('GPU resources stay flat across rebuilds, resets and many gusts', async ({ page }) => {
  await open(page, 'manual&fixed&tufts=8000');
  const memory = () =>
    page.evaluate(() => {
      const w = window.__wind!;
      w.app.stepFrames(2);
      return { ...w.app.renderer.info.memory };
    });
  // one full cycle first: the ink line's geometry is created the first time it draws
  await page.evaluate(() => {
    const w = window.__wind!;
    w.app.play('flick');
    w.app.stepFrames(20);
    w.app.resetScene();
  });
  const first = await memory();
  await page.evaluate(() => {
    const w = window.__wind!;
    for (let k = 0; k < 8; k++) {
      w.app.rebuildGrass();
      w.app.play('crossing');
      w.app.stepFrames(40);
      w.app.resetScene();
    }
    w.app.stepFrames(5);
  });
  const after = await memory();
  expect(after.geometries).toBeLessThanOrEqual(first.geometries);
  expect(after.textures).toBeLessThanOrEqual(first.textures);
});

test('a long run with repeated strokes stays finite, and returns to calm', async ({ page }) => {
  await open(page, 'manual&fixed&tufts=2000');
  const r = await page.evaluate(() => {
    const w = window.__wind!;
    const s = w.app.sim;
    const names = ['sweep', 'spiral', 'flick', 'crossing', 'wave'] as const;
    for (let i = 0; i < 40; i++) {
      w.app.play(names[i % names.length]);
      for (let k = 0; k < 12; k++) w.app.stepFrames(10);
    }
    const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const finite = s.field.u.every(Number.isFinite) && s.response.bend.every(Number.isFinite);
    const windy = peak(s.field.u);
    for (let i = 0; i < 90; i++) w.app.stepFrames(10);
    return { finite, windy, calm: peak(s.field.u), gusts: s.gusts.length, lines: s.gusts.length };
  });
  expect(r.finite).toBe(true);
  expect(r.windy).toBeLessThan(35);
  expect(r.calm).toBeLessThan(0.3);
  expect(r.gusts).toBe(0);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('turns the breeze and gusts down, and everything still works', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=8000');
    const r = await page.evaluate(() => {
      const w = window.__wind!;
      w.app.play('sweep');
      w.app.stepFrames(90);
      let bend = 0;
      for (let a = 0; a < w.app.sim.response.bend.length; a++) bend = Math.max(bend, Math.abs(w.app.sim.response.bend[a]));
      return { ambient: w.app.sim.ambient.amount, bend };
    });
    expect(r.ambient).toBeLessThan(0.5);
    expect(r.bend).toBeGreaterThan(0.1);
  });
});

test('keyboard alone: focus is visible, the wind can be blown, and controls answer', async ({ page }) => {
  await open(page, 'manual&fixed&tufts=8000');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle };
  });
  expect(focused.tag).toBe('BUTTON');
  expect(focused.outline).toBe('solid');
  await page.keyboard.press('2');
  await page.evaluate(() => window.__wind!.app.stepFrames(20));
  expect(await page.evaluate(() => window.__wind!.app.sim.gusts.length)).toBe(1);
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__wind!.app.sim.gusts.length)).toBe(0);
});

test('undo during a live drag ends the stroke, and the pointer can draw again', async ({ page }) => {
  await open(page, 'manual&fixed&tufts=4000');
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(600, 420, { steps: 8 });
  await page.evaluate(() => window.__wind!.app.stepFrames(4));
  const undone = await page.evaluate(() => window.__wind!.app.undo());
  expect(undone).toBe(true);
  await page.mouse.move(700, 430, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__wind!.app.sim.gusts.length)).toBe(0);
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(650, 320, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__wind!.app.sim.gusts.length)).toBe(1);
});

test('two captures requested at once both finish', async ({ page }) => {
  await open(page, 'fixed&tufts=4000');
  const sizes = await page.evaluate(async () => {
    const w = window.__wind!;
    const one = () => new Promise<string>((res) => w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/jpeg', 0.5))));
    const [a, b] = await Promise.all([one(), one()]);
    return [a.length, b.length];
  });
  expect(sizes[0]).toBeGreaterThan(1000);
  expect(sizes[1]).toBeGreaterThan(1000);
});

test('clearing during a pause reaches the screen at once', async ({ page }) => {
  await open(page, 'manual&fixed&tufts=4000');
  const r = await page.evaluate(() => {
    const w = window.__wind!;
    w.app.play('sweep');
    w.app.stepFrames(60);
    w.app.setPaused(true);
    const before = w.app.sim.steps;
    w.app.clearWind();
    return { stepped: w.app.sim.steps - before, gusts: w.app.sim.gusts.length, paused: w.app.sim.paused };
  });
  expect(r).toEqual({ stepped: 1, gusts: 0, paused: true });
});

test('a resize does not undo an adaptive drop in resolution', async ({ page }) => {
  await page.goto('/?manual&tufts=4000');
  await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90_000 });
  await page.evaluate(() => {
    (window.__wind!.app as unknown as { dprCap: number }).dprCap = 0.5;
  });
  await page.setViewportSize({ width: 1000, height: 640 });
  await expect.poll(() => page.evaluate(() => window.__wind!.app.canvas.width)).toBe(500);
});
