import { expect, test } from '@playwright/test';
import { frameDiff, open, snap } from './helpers';



test.describe('tuning', () => {
  test('default renders the same picture as before tuning existed', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=8000');
    const t = await page.evaluate(() => {
      const w = window.__wind!;
      return { lean: w.app.uniforms.uBendGain.value, flutter: w.app.uniforms.uFlutter.value, breeze: w.app.sim.ambient.amount, drag: w.app.sim.field.tuning.drag };
    });
    expect(t).toEqual({ lean: 1, flutter: 1, breeze: 1, drag: 1.7 });
  });

  test('the same stroke moves real pixels least on Less, most on More', async ({ page }) => {
    const moved: Record<string, number> = {};
    for (const preset of ['less', 'default', 'more']) {
      await open(page, `manual&fixed&dpr=1&tufts=20000&preset=${preset}`);
      await snap(page, 'r', 20);
      await page.evaluate(() => window.__wind!.app.play('sweep'));
      // the whole frame, a little after the stroke: past its bend limit, More shows as reach and persistence
      await snap(page, 'g', 130);
      moved[preset] = await frameDiff(page, 'r', 'g');
    }
    console.log('moved', JSON.stringify(moved));
    expect(moved.less).toBeLessThan(moved.default * 0.6);
    expect(moved.more).toBeGreaterThan(moved.default * 1.25);
  });

  test('the panel: presets, a slider, live effect, and Reset goes back to default', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=8000');
    await page.getByRole('button', { name: 'Tune' }).click();
    await page.getByRole('radio', { name: 'More' }).click();
    await expect(page.getByRole('radio', { name: 'More' })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => window.__wind!.app.uniforms.uBendGain.value)).toBe(1.7);

    const lean = page.getByRole('slider', { name: 'Grass lean' });
    await lean.focus();
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => window.__wind!.app.uniforms.uBendGain.value)).toBeCloseTo(1.65);
    // once adjusted it is no longer the preset
    await expect(page.getByRole('radio', { name: 'More' })).toHaveAttribute('aria-checked', 'false');
    // typing in a slider never fires a keyboard shortcut
    await page.keyboard.press('c');
    await page.keyboard.press('Escape');
    await expect(lean).toBeHidden();

    await page.getByRole('button', { name: 'Reset' }).click();
    expect(await page.evaluate(() => window.__wind!.store.get().tuning.lean)).toBe(1);
  });

  test('settings survive a reload, and a bad stored value is harmless', async ({ page }) => {
    await open(page, 'fixed&tufts=4000');
    await page.keyboard.press('t');
    await page.getByRole('radio', { name: 'Less' }).click();
    await page.getByRole('checkbox', { name: 'Painted border' }).check();
    await page.reload();
    await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading);
    const kept = await page.evaluate(() => ({ lean: window.__wind!.store.get().tuning.lean, framed: window.__wind!.store.get().framed }));
    expect(kept).toEqual({ lean: 0.35, framed: true });

    await page.evaluate(() => localStorage.setItem('wind-study-tuning-v1', '{"tuning":{"lean":"bad","force":999}'));
    await page.reload();
    await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading);
    expect(await page.evaluate(() => window.__wind!.store.get().tuning.lean)).toBe(1);
  });
});

test.describe('painted border', () => {
  test('is cream paper at the edge, painting inside, and appears in captures; the ink stays off it', async ({ page }) => {
    await open(page, 'manual&fixed&dpr=1&tufts=8000&frame=1');
    await page.evaluate(() => {
      const w = window.__wind!;
      const pts: [number, number][] = [];
      for (let i = 0; i < 120; i++) pts.push([-50 + i * 0.84, 0]);
      w.app.playStroke({ points: pts });
    });
    await snap(page, 'f', 130);
    const r = await page.evaluate(() => {
      const c = window.__wind!.app.canvas;
      const d = window.__frames!.f;
      const at = (x: number, y: number) => Array.from(d.slice((x + y * c.width) * 4, (x + y * c.width) * 4 + 3));
      return { corner: at(4, 4), edge: at(Math.floor(c.width / 2), 3), middle: at(Math.floor(c.width / 2), Math.floor(c.height / 2)), side: at(4, Math.floor(c.height / 2)) };
    });
    for (const p of [r.corner, r.edge, r.side]) {
      expect(p[0]).toBeGreaterThan(225);
      expect(p[2]).toBeGreaterThan(195);
    }
    expect(r.middle[1]).toBeGreaterThan(r.middle[2] + 20);
  });

  test('pointer mapping is unchanged by the border', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=4000&frame=1');
    const framed = await page.evaluate(() => (window.__wind!.app as unknown as { worldAt(x: number, y: number): number[] }).worldAt(700, 400));
    await open(page, 'manual&fixed&tufts=4000&frame=0');
    const plain = await page.evaluate(() => (window.__wind!.app as unknown as { worldAt(x: number, y: number): number[] }).worldAt(700, 400));
    expect(framed).toEqual(plain);
  });
});

test.describe('demo', () => {
  test('scripted gestures arrive on schedule and fit a narrow frame', async ({ page }) => {
    await page.setViewportSize({ width: 540, height: 675 });
    await open(page, 'manual&fixed&tufts=8000');
    const r = await page.evaluate(() => {
      const w = window.__wind!;
      w.app.playDemo();
      const seen: number[] = [];
      const widths: number[] = [];
      for (let i = 0; i < 20; i++) {
        w.app.stepFrames(60);
        seen.push(w.app.sim.gusts.length);
        for (const g of w.app.sim.gusts) widths.push(Math.max(...g.points.map((p) => Math.abs(p.x))));
      }
      return { seen, widest: Math.max(...widths) };
    });
    expect(r.seen.slice(0, 3).every((n) => n === 0)).toBe(true); // calm for three seconds
    expect(r.seen[4]).toBeGreaterThan(0);
    expect(r.widest).toBeLessThan(21);
  });

  test('one press records a real video of the demo, without the interface, then restores it', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, 'fixed&tufts=20000');
    await page.keyboard.press('t');
    // a 20-second recording; the headroom is for a busy machine, where the full suite once ran it past 40 s
    const downloading = page.waitForEvent('download', { timeout: 75_000 });
    await page.getByRole('button', { name: 'Record 20-second demo' }).click();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeHidden();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^wind-study-.*\.(mp4|webm)$/);
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  });
});
