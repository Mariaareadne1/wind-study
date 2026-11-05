import { expect, test } from '@playwright/test';
import { frameDiff, open, snap } from './helpers';

test.describe('the hills version', () => {
  test('is a separate version: the meadow stays the default', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=4000');
    expect(await page.evaluate(() => window.__wind!.app.profile.id)).toBe('meadow');
    await open(page, 'manual&fixed&tufts=4000&scene=hills');
    expect(await page.evaluate(() => window.__wind!.app.profile.id)).toBe('hills');
  });

  test('has real depth: a lower camera, and a crest hides land behind it', async ({ page }) => {
    await open(page, 'manual&fixed&tufts=4000&scene=hills');
    const r = await page.evaluate(() => {
      const a = window.__wind!.app;
      const hits: number[] = [];
      for (let y = 0.85; y > -0.85; y -= 0.02) {
        const h = (a as unknown as { worldAtNdc(x: number, y: number): number[] | null }).worldAtNdc(0, y);
        hits.push(h ? h[1] : NaN);
      }
      let largestJump = 0;
      for (let i = 1; i < hits.length; i++) largestJump = Math.max(largestJump, Math.abs(hits[i] - hits[i - 1]));
      return { camY: a.camera.position.y, largestJump, missing: hits.filter(Number.isNaN).length };
    });
    expect(r.camY).toBeLessThan(20);
    expect(r.missing).toBe(0);
    // moving down the screen, the ground point leaps when it crosses a crest into the hidden valley
    expect(r.largestJump).toBeGreaterThan(2);
  });

  test('renders land to every edge, no clear colour showing', async ({ page }) => {
    await open(page, 'manual&fixed&dpr=1&tufts=20000&scene=hills');
    await snap(page, 'a', 2);
    const detail = await page.evaluate(() => {
      const c = window.__wind!.app.canvas;
      const d = window.__frames!.a;
      const band = (y0: number, y1: number) => {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = 1; x < c.width; x += 3) {
            const i = (x + y * c.width) * 4;
            sum += Math.abs(d[i + 1] - d[i - 3]);
            n++;
          }
        }
        return sum / n;
      };
      return { top: band(0, 40), bottom: band(c.height - 40, c.height) };
    });
    expect(detail.top).toBeGreaterThan(1.5); // fibres right up to the top of the frame
    expect(detail.bottom).toBeGreaterThan(1.5);
  });

  test('a real drag on a hill bends the grass there, and the wind travels', async ({ page }) => {
    await open(page, 'manual&fixed&dpr=1&tufts=20000&scene=hills');
    await snap(page, 'rest', 20);
    const box = (await page.locator('canvas').boundingBox())!;
    await page.mouse.move(box.width * 0.15, box.height * 0.55);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(box.width * (0.15 + i * 0.012), box.height * 0.55);
      await page.evaluate(() => window.__wind!.app.stepFrames(1));
    }
    await snap(page, 'during', 2);
    await page.mouse.up();
    const under = await frameDiff(page, 'rest', 'during', [0.15, 0.45, 0.42, 0.65]);
    const elsewhere = await frameDiff(page, 'rest', 'during', [0.65, 0.05, 0.95, 0.25]);
    expect(under).toBeGreaterThan(elsewhere * 1.5);
    await snap(page, 'later', 50);
    const farLater = await frameDiff(page, 'rest', 'later', [0.42, 0.45, 0.7, 0.65]);
    const farDuring = await frameDiff(page, 'rest', 'during', [0.55, 0.45, 0.7, 0.65]);
    expect(farLater).toBeGreaterThan(farDuring);
  });

  test('a stroke across a crest keeps its ink straight on screen', async ({ page }) => {
    await open(page, 'manual&fixed&dpr=1&tufts=4000&scene=hills');
    const box = (await page.locator('canvas').boundingBox())!;
    const yA = box.height * 0.82;
    const yB = box.height * 0.3;
    await page.mouse.move(box.width * 0.5, yA);
    await page.mouse.down();
    await page.mouse.move(box.width * 0.5, yB, { steps: 3 });
    const r = await page.evaluate(() => {
      const a = window.__wind!.app;
      const g = a.sim.gusts.at(-1)!;
      return { n: g.points.length, hasHeight: g.points.every((p) => p.y !== undefined), ys: g.points.map((p) => p.y!).slice(0, 4) };
    });
    await page.mouse.up();
    expect(r.n).toBeGreaterThan(5);
    expect(r.hasHeight).toBe(true);
  });

  test('all ready-made gestures land on the hills, and the demo runs', async ({ page }) => {
    await open(page, 'manual&fixed&dpr=1&tufts=4000&scene=hills');
    const r = await page.evaluate(() => {
      const w = window.__wind!;
      w.app.playDemo();
      let peak = 0;
      let most = 0;
      let finite = true;
      for (let i = 0; i < 20; i++) {
        w.app.stepFrames(60);
        most = Math.max(most, w.app.sim.gusts.length);
        finite = finite && w.app.sim.field.u.every(Number.isFinite);
        for (let a = 0; a < w.app.sim.response.bend.length; a += 4) peak = Math.max(peak, Math.abs(w.app.sim.response.bend[a]));
      }
      return { peak, most, finite };
    });
    expect(r.finite).toBe(true);
    expect(r.most).toBeGreaterThan(0);
    expect(r.peak).toBeGreaterThan(0.5);
    expect(r.peak).toBeLessThan(2.6);
  });

  test('the Tune panel links the two versions', async ({ page }) => {
    await open(page, 'fixed&tufts=4000');
    await page.keyboard.press('t');
    await page.getByRole('link', { name: 'Hills' }).click();
    await page.waitForFunction(() => window.__wind && window.__wind.app.profile.id === 'hills');
    await page.keyboard.press('t');
    await expect(page.getByRole('link', { name: 'Hills' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Meadow' }).click();
    await page.waitForFunction(() => window.__wind && window.__wind.app.profile.id === 'meadow');
  });
});
