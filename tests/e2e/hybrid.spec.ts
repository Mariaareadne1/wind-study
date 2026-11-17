import { expect, test, type Page } from '@playwright/test';
import { frameDiff, snap } from './helpers';

/** The image-directed hero at the plate's own size (1672 × 941, DPR 1), stepped by hand. */
async function openHybrid(page: Page, extra = '') {
  await page.goto(`/?scene=portfolio-hybrid&compare&dpr=1${extra}`);
  await page.waitForFunction(() => window.__wind, null, { timeout: 60_000 });
}

const gusts = (page: Page) => page.evaluate(() => window.__wind!.app.sim.activeGusts);
const energy = (page: Page) => page.evaluate(() => (window.__wind!.app as unknown as { bendEnergy(): number }).bendEnergy());

test.describe('the hybrid hero', () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test('at rest it is the approved plate, pixel for pixel within compression', async ({ page }) => {
    await openHybrid(page);
    await snap(page, 'rest', 0);
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
        if (d > 8) big++;
      }
      return { mean: sum / (plate.length / 4), big: big / (plate.length / 4) };
    });
    // only the compositor's sub-level dither and the ambient breeze's first breath remain
    expect(r.mean).toBeLessThan(1.5);
    expect(r.big).toBeLessThan(0.01);
  });

  test('a drag moves the grass detail along its path, never the clouds or the far hills, then settles', async ({ page }) => {
    await openHybrid(page);
    await snap(page, 'before', 120);
    const rest = await energy(page);
    const y = 768;
    await page.mouse.move(1020, y);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) {
      await page.mouse.move(1020 + 13 * i, y + i);
      await snap(page, 'tmp', 1);
    }
    await page.mouse.up();
    await page.mouse.move(1668, 4);
    await snap(page, 'during', 6);
    const patch = [1000 / 1672, 680 / 941, 1300 / 1672, 880 / 941];
    expect(await frameDiff(page, 'before', 'during', patch)).toBeGreaterThan(3);
    expect(await frameDiff(page, 'before', 'during', [700 / 1672, 120 / 941, 1150 / 1672, 290 / 941])).toBeLessThan(0.2);
    expect(await frameDiff(page, 'before', 'during', [40 / 1672, 40 / 941, 400 / 1672, 200 / 941])).toBeLessThan(0.3);
    // the air the gust moved reaches the grass over the next half second
    let peak = await energy(page);
    for (let k = 0; k < 6; k++) {
      await snap(page, 'tmp', 6);
      peak = Math.max(peak, await energy(page));
    }
    expect(peak).toBeGreaterThan(rest * 1.5);
    await snap(page, 'settled', 270);
    expect(await gusts(page)).toBe(0);
    // back to within a little of the ambient breeze's own level, not frozen and not drifting
    expect(await energy(page)).toBeLessThan(rest + (peak - rest) * 0.35);
  });

  test('blade motion moves strands individually where the sheet moves them together; at rest both are the plate', async ({ page }) => {
    const run = async (motion: string) => {
      await openHybrid(page, `&motion=${motion}`);
      await snap(page, 'rest', 0);
      const rest = await page.evaluate(() => Array.from(window.__frames!.rest.slice(0, 4 * 1672 * 40)));
      await snap(page, 'before', 120);
      await page.mouse.move(1020, 768);
      await page.mouse.down();
      for (let i = 0; i <= 20; i++) {
        await page.mouse.move(1020 + 13 * i, 768 + i);
        await snap(page, 'tmp', 1);
      }
      await page.mouse.up();
      await snap(page, 'during', 6);
      // the strand-scale texture of the change: how much it varies from one pixel to the next across the patch
      const texture = await page.evaluate(() => {
        const A = window.__frames!.before;
        const B = window.__frames!.during;
        const W = 1672;
        let rough = 0;
        let n = 0;
        for (let y = 700; y < 860; y++) {
          for (let x = 1010; x < 1290; x++) {
            const i = (y * W + x) * 4;
            const d0 = B[i + 1] - A[i + 1];
            const d1 = B[i + 1 + 4 * W] - A[i + 1 + 4 * W];
            rough += Math.abs(d0 - d1);
            n++;
          }
        }
        return rough / n;
      });
      return { rest, texture };
    };
    const sheet = await run('sheet');
    const blade = await run('blade');
    // the ambient breeze is already leaning the grass a little at rest, so allow a hair's difference
    let restGap = 0;
    for (let i = 0; i < sheet.rest.length; i++) restGap += Math.abs(sheet.rest[i] - blade.rest[i]);
    expect(restGap / sheet.rest.length).toBeLessThan(0.5);
    expect(blade.texture).not.toBeCloseTo(sheet.texture, 1);
  });

  test('a mouse passing over the grass stirs it gently; over the panel it does nothing', async ({ page }) => {
    await openHybrid(page, '&panel');
    await page.waitForFunction(() => {
      const u = (window.__wind!.app as unknown as { compositor: { material: { uniforms: Record<string, { value: number[] }> } } }).compositor.material.uniforms;
      return u.uGlassShape.value[3] === 1;
    });
    for (let i = 0; i <= 12; i++) {
      await page.mouse.move(150 + 25 * i, 420);
      await snap(page, 'tmp', 1);
    }
    expect(await gusts(page)).toBe(0);
    let peak = 0;
    for (let i = 0; i <= 20; i++) {
      await page.mouse.move(1000 + 15 * i, 770);
      await snap(page, 'tmp', 1);
      peak = Math.max(peak, await gusts(page));
    }
    expect(peak).toBeGreaterThan(0);
  });

  test('the panel is real HTML over glass that sits exactly on it', async ({ page }) => {
    await openHybrid(page, '&panel');
    const panel = page.locator('section.intro');
    await expect(panel).toHaveClass(/live/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('DesignEngineering');
    await expect(page.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '#work');
    await expect(page.getByRole('link', { name: 'Open the full Wind Study' })).toHaveAttribute('href', '?scene=sunlit');
    const box = await panel.boundingBox();
    // the approved layout at 1672 × 941: about 6% from the left, 24% down, 478 wide
    expect(box!.x).toBeCloseTo(102, -1);
    expect(box!.y).toBeCloseTo(230, -1);
    expect(box!.width).toBeCloseTo(478, -1);
    const glass = await page.evaluate(() => (window.__wind!.app as unknown as { compositor: { material: { uniforms: Record<string, { value: number[] }> } } }).compositor.material.uniforms.uGlass.value);
    expect(glass[0]).toBeCloseTo(box!.x + box!.width / 2, 0);
    expect(glass[1]).toBeCloseTo(941 - (box!.y + box!.height / 2), 0);
  });

  test('without WebGL the plate and the panel still carry the page', async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (real as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof real;
    });
    await page.goto('/?scene=portfolio-hybrid');
    await expect(page.locator('.hero')).toHaveClass(/fallback/, { timeout: 30_000 });
    expect(await page.locator('.hero-still').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('clean-landscape');
    await expect(page.getByRole('link', { name: 'About' })).toBeVisible();
  });
});

test.describe('the hybrid hero with reduced motion', () => {
  test.use({ viewport: { width: 1672, height: 941 }, reducedMotion: 'reduce' });

  test('passing the mouse makes no wind; a drag still does', async ({ page }) => {
    await openHybrid(page);
    for (let i = 0; i <= 15; i++) {
      await page.mouse.move(1000 + 15 * i, 770);
      await snap(page, 'tmp', 1);
    }
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

test.describe('the hybrid hero on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('crops around the clouds, fits the panel, and leaves vertical swipes to the page', async ({ page }) => {
    await openHybrid(page, '&panel');
    const box = await page.locator('section.intro').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(await page.locator('.intro-nav').evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    expect(await page.locator('.hero-canvas').evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  });
});
