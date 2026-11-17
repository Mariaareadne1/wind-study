import { expect, test, type Page } from '@playwright/test';
import { frameDiff, snap } from './helpers';

/** The portfolio hero, deterministic: no animation loop, the sim stepped by hand. */
async function openHero(page: Page, extra = '') {
  await page.goto(`/?scene=portfolio&compare&panel&tufts=30000&dpr=1${extra}`);
  await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90_000 });
}

const gusts = (page: Page) => page.evaluate(() => window.__wind!.app.sim.activeGusts);

test.describe('the portfolio hero', () => {
  test('introduces the work in real text, with working links, over live glass', async ({ page }) => {
    await openHero(page);
    const panel = page.locator('section.intro');
    await expect(panel).toHaveClass(/live/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('DesignEngineering');
    await expect(panel.getByText('Maria Showalter')).toBeVisible();
    await expect(panel.getByText('Interactive systems, creative tools,')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '#work');
    await expect(nav.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '#playground');
    await expect(nav.getByRole('link', { name: 'About' })).toHaveAttribute('href', '#about');
    await expect(nav.getByRole('link', { name: 'Open the full Wind Study' })).toHaveAttribute('href', '?scene=sunlit');
    // the compositor is drawing glass exactly where the panel sits
    const r = await page.evaluate(() => {
      const box = document.querySelector('section.intro')!.getBoundingClientRect();
      const u = (window.__wind!.app as unknown as { compositor: { material: { uniforms: Record<string, { value: number[] }> } } }).compositor.material.uniforms;
      return { box: [box.left, box.top, box.width, box.height], glass: u.uGlass.value, on: u.uGlassShape.value[3], h: u.uSize.value[1] };
    });
    expect(r.on).toBe(1);
    expect(r.glass[0]).toBeCloseTo(r.box[0] + r.box[2] / 2, 0);
    expect(r.glass[1]).toBeCloseTo(r.h - (r.box[1] + r.box[3] / 2), 0);
  });

  test('the glass refracts the land behind it, and the text stays out of the canvas', async ({ page }) => {
    await openHero(page);
    await snap(page, 'with', 2);
    await page.evaluate(() => (window.__wind!.app as unknown as { setGlass(g: null): void }).setGlass(null));
    await snap(page, 'without', 0);
    const box = await page.locator('section.intro').boundingBox();
    const vw = page.viewportSize()!;
    const rect = [box!.x / vw.width, box!.y / vw.height, (box!.x + box!.width) / vw.width, (box!.y + box!.height) / vw.height];
    // inside the panel the land is bent, frosted and tinted; outside its shadow nothing changes
    expect(await frameDiff(page, 'with', 'without', rect)).toBeGreaterThan(4);
    expect(await frameDiff(page, 'with', 'without', [0.62, 0.1, 0.98, 0.9])).toBeLessThan(0.2);
  });

  test('moving the mouse over the grass stirs a local breeze; over the panel it does not', async ({ page }) => {
    await openHero(page);
    const vw = page.viewportSize()!;
    await snap(page, 'before', 240);
    // over the panel: no wind
    await page.mouse.move(vw.width * 0.1, vw.height * 0.45);
    for (let i = 0; i <= 12; i++) await page.mouse.move(vw.width * (0.1 + 0.015 * i), vw.height * 0.45);
    expect(await gusts(page)).toBe(0);
    // over the land: a soft gust that follows the pointer, with no button pressed
    const y = vw.height * 0.72;
    let peak = 0;
    for (let i = 0; i <= 30; i++) {
      await page.mouse.move(vw.width * (0.42 + 0.4 * (i / 30)), y);
      await snap(page, 'tmp', 1);
      peak = Math.max(peak, await gusts(page));
    }
    expect(peak).toBeGreaterThan(0);
    await snap(page, 'during', 20);
    const band = await frameDiff(page, 'before', 'during', [0.38, 0.6, 0.86, 0.84]);
    const elsewhere = await frameDiff(page, 'before', 'during', [0.02, 0.02, 0.3, 0.2]);
    expect(band).toBeGreaterThan(elsewhere * 1.25);
    // it dies away on its own
    await page.mouse.move(vw.width * 0.99, vw.height * 0.02);
    await snap(page, 'after', 360);
    expect(await gusts(page)).toBe(0);
  });

  test('a drag is a stronger gust than a hover, and settles', async ({ page }) => {
    await openHero(page);
    const vw = page.viewportSize()!;
    const y = vw.height * 0.72;
    await page.mouse.move(vw.width * 0.42, y);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) {
      await page.mouse.move(vw.width * (0.42 + 0.4 * (i / 20)), y);
      await snap(page, 'tmp', 1);
    }
    await page.mouse.up();
    const gain = await page.evaluate(() => (window.__wind!.app.sim as unknown as { gusts: { gain: number }[] }).gusts.map((g) => g.gain));
    expect(Math.max(...gain)).toBeGreaterThan(0.9);
    await snap(page, 'settled', 600);
    expect(await gusts(page)).toBe(0);
  });

  test('links are reachable by keyboard, in reading order, with a visible focus ring', async ({ page }) => {
    await openHero(page);
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      names.push(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? document.activeElement!.textContent ?? ''));
    }
    expect(names).toEqual(['Work', 'Playground', 'About', 'Open the full Wind Study']);
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('without WebGL the introduction still reads, over a still of the land', async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (real as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof real;
    });
    await page.goto('/?scene=portfolio');
    await expect(page.locator('.hero')).toHaveClass(/fallback/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Work' })).toBeVisible();
    const still = await page.locator('.hero-still').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(still).toContain('still-wide');
  });
});

test.describe('the portfolio hero on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('the panel fits, the navigation does not overflow, and the page still scrolls', async ({ page }) => {
    await openHero(page);
    const box = await page.locator('section.intro').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    const overflow = await page.locator('.intro-nav').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    expect(await page.locator('.hero-canvas').evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-y');
  });
});
