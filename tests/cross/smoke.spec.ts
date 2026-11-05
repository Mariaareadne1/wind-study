import { expect, test } from '@playwright/test';

for (const scene of ['meadow', 'hills']) {
test(`${scene}: renders and a drawn gust moves real pixels`, async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?manual&fixed&dpr=1&tufts=8000&scene=${scene}`);
  await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90_000 });
  const stats = await page.evaluate(
    () =>
      new Promise<{ g: number; r: number; diff: number; bend: number }>((resolve) => {
        const w = window.__wind!;
        const read = (cb: (d: Uint8ClampedArray) => void) =>
          w.app.onceAfterFrame(() => {
            const c = document.createElement('canvas');
            c.width = w.app.canvas.width;
            c.height = w.app.canvas.height;
            const g = c.getContext('2d')!;
            g.drawImage(w.app.canvas, 0, 0);
            cb(g.getImageData(0, 0, c.width, c.height).data);
          });
        w.app.stepFrames(20);
        read((a) => {
          w.app.play('sweep');
          w.app.stepFrames(70);
          read((b) => {
            let r = 0;
            let g = 0;
            let diff = 0;
            let n = 0;
            for (let i = 0; i < a.length; i += 40) {
              r += b[i];
              g += b[i + 1];
              diff += Math.abs(a[i + 1] - b[i + 1]);
              n++;
            }
            resolve({ r: r / n, g: g / n, diff: diff / n, bend: Math.max(...w.app.sim.response.bend.map(Math.abs)) });
          });
        });
      }),
  );
  console.log(browserName, stats);
  expect(stats.g).toBeGreaterThan(stats.r);
  expect(stats.diff).toBeGreaterThan(1);
  expect(stats.bend).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
}
