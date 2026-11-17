import { expect, test, type Page } from '@playwright/test';
import { frameDiff, snap } from './helpers';

/** The living hero at the plate's own size, its clock and wind stepped by hand. */
async function openLiving(page: Page, extra = '') {
  await page.goto(`/?scene=portfolio-living&compare&dpr=1${extra}`);
  await page.waitForFunction(() => window.__wind, null, { timeout: 60_000 });
}

type Living = { time: number; material: { uniforms: Record<string, { value: number }> }; renderFrame(): void };
/** Render the scene at a chosen moment, with or without the wind showing in the grass, and keep the frame. */
async function at(page: Page, key: string, t: number, life: number) {
  await page.evaluate(
    ({ t, life }) => {
      const a = window.__wind!.app as unknown as Living;
      a.time = t;
      a.material.uniforms.uLife.value = life;
    },
    { t, life },
  );
  await snap(page, key, 0);
}
const gusts = (page: Page) => page.evaluate(() => window.__wind!.app.sim.activeGusts);

test.describe('the living hero', () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test('at rest the layers put the approved plate back together', async ({ page }) => {
    await openLiving(page);
    await at(page, 'rest', 0, 0);
    const r = await page.evaluate(async () => {
      const img = new Image();
      img.src = '/hybrid/clean-landscape.webp';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1672;
      c.height = 941;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const plate = g.getImageData(0, 0, 1672, 941).data;
      const frame = window.__frames!.rest;
      let sum = 0;
      let big = 0;
      for (let i = 0; i < plate.length; i += 4) {
        const d = Math.max(Math.abs(plate[i] - frame[i]), Math.abs(plate[i + 1] - frame[i + 1]), Math.abs(plate[i + 2] - frame[i + 2]));
        sum += d;
        if (d > 12) big++;
      }
      return { mean: sum / (plate.length / 4), big: big / (plate.length / 4) };
    });
    expect(r.mean).toBeLessThan(2.5);
    expect(r.big).toBeLessThan(0.01);
  });

  test('clouds drift and their shadows move, while the land itself never moves', async ({ page }) => {
    await openLiving(page);
    await at(page, 't0', 0, 0);
    await at(page, 't30', 30, 0);
    // the clouds and their shadows have moved
    expect(await frameDiff(page, 't0', 't30', [600 / 1672, 90 / 941, 1220 / 1672, 320 / 941])).toBeGreaterThan(1);
    expect(await frameDiff(page, 't0', 't30', [560 / 1672, 300 / 941, 1000 / 1672, 430 / 941])).toBeGreaterThan(0.1);
    // far from any cloud or shadow, the land is exactly as it was: nothing is warped
    expect(await frameDiff(page, 't0', 't30', [0, 0.72, 0.3, 1])).toBe(0);
    expect(await frameDiff(page, 't0', 't30', [0, 0, 0.25, 0.25])).toBe(0);
  });

  test('wind shows in the grass as light, and only on grass', async ({ page }) => {
    await openLiving(page);
    await at(page, 'a', 4, 1);
    await at(page, 'b', 7, 1);
    expect(await frameDiff(page, 'a', 'b', [0, 0.7, 0.6, 1])).toBeGreaterThan(0.3);
    // the clouds' own bright cores are not grass and do not take the wind light
    await at(page, 'a0', 4, 0);
    await at(page, 'b0', 4, 1);
    expect(await frameDiff(page, 'a0', 'b0', [860 / 1672, 140 / 941, 980 / 1672, 220 / 941])).toBeLessThan(0.05);
  });

  test('a drag brushes wind across nearby grass only; over the panel nothing stirs', async ({ page }) => {
    await openLiving(page, '&panel');
    await page.waitForFunction(() => {
      const u = (window.__wind!.app as unknown as { compositor: { material: { uniforms: Record<string, { value: number[] }> } } }).compositor.material.uniforms;
      return u.uGlassShape.value[3] === 1;
    });
    for (let i = 0; i <= 12; i++) {
      await page.mouse.move(150 + 25 * i, 420);
      await snap(page, 'tmp', 1);
    }
    expect(await gusts(page)).toBe(0);
    // freeze the scene clock so only the pointer's wind differs between the two frames
    await page.evaluate(() => {
      const a = window.__wind!.app as unknown as Living;
      a.material.uniforms.uLife.value = 0;
    });
    await snap(page, 'before', 0);
    const t = await page.evaluate(() => (window.__wind!.app as unknown as Living).time);
    await page.mouse.move(1020, 768);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) {
      await page.mouse.move(1020 + 13 * i, 768 + i);
      await snap(page, 'tmp', 1);
    }
    await page.mouse.up();
    await page.mouse.move(1668, 4);
    await snap(page, 'tmp', 20);
    await page.evaluate((t) => {
      (window.__wind!.app as unknown as Living).time = t;
    }, t);
    await snap(page, 'during', 0);
    expect(await frameDiff(page, 'before', 'during', [1000 / 1672, 700 / 941, 1290 / 1672, 840 / 941])).toBeGreaterThan(2);
    expect(await frameDiff(page, 'before', 'during', [0, 0, 0.3, 0.3])).toBeLessThan(0.05);
  });

  test('without WebGL the plate and the panel still carry the page', async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (real as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof real;
    });
    await page.goto('/?scene=portfolio-living');
    await expect(page.locator('.hero')).toHaveClass(/fallback/, { timeout: 30_000 });
    expect(await page.locator('.hero-still').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('clean-landscape');
    await expect(page.getByRole('link', { name: 'Work' })).toBeVisible();
  });
});

test.describe('the living hero with reduced motion', () => {
  test.use({ viewport: { width: 1672, height: 941 }, reducedMotion: 'reduce' });

  test('the scene holds still and hovering makes no wind; a drag still answers', async ({ page }) => {
    await openLiving(page);
    const t0 = await page.evaluate(() => (window.__wind!.app as unknown as Living).time);
    for (let i = 0; i <= 15; i++) {
      await page.mouse.move(1000 + 15 * i, 770);
      await snap(page, 'tmp', 1);
    }
    expect(await page.evaluate(() => (window.__wind!.app as unknown as Living).time)).toBe(t0);
    expect(await gusts(page)).toBe(0);
    await page.mouse.down();
    for (let i = 0; i <= 10; i++) {
      await page.mouse.move(1225 - 15 * i, 770);
      await snap(page, 'tmp', 1);
    }
    expect(await gusts(page)).toBeGreaterThan(0);
    await page.mouse.up();
  });
});

test.describe('the living hero on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('fits the panel, keeps the navigation on one line, and leaves vertical swipes to the page', async ({ page }) => {
    await openLiving(page, '&panel');
    const box = await page.locator('section.intro').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(await page.locator('.intro-nav').evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    expect(await page.locator('.hero-canvas').evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  });
});
