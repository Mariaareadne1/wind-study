import { expect, test, devices } from '@playwright/test';
import { open } from './helpers';

test.use({ ...devices['iPhone 13'], defaultBrowserType: 'chromium', hasTouch: true });

test('touch drawing on a phone makes a gust, without scrolling, and the controls stay clear', async ({ page }) => {
  await open(page, 'fixed&tufts=12000');
  const box = (await page.locator('canvas').boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const touch = (type: string, x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] } as never);
  await touch('touchStart', box.width * 0.2, box.height * 0.45);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', box.width * (0.2 + i * 0.05), box.height * (0.45 + i * 0.008));
    await page.waitForTimeout(16);
  }
  const during = await page.evaluate(() => window.__wind!.app.sim.gusts.length);
  await touch('touchEnd', 0, 0);
  expect(during).toBeGreaterThan(0);
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);

  // every control is on screen and big enough to touch
  for (const name of ['Undo', 'Pause', 'Capture', 'Hide', 'Help', 'Reset']) {
    const b = (await page.getByRole('button', { name }).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(box.width);
    expect(b.height).toBeGreaterThanOrEqual(32);
  }
});
