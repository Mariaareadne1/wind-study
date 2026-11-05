import { expect, test } from '@playwright/test';
import { open } from './helpers';

// Deterministic frames from real rendering: fixed seed, fixed sim steps, this machine's GPU.
// Update with: npx playwright test visual --update-snapshots
test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });

const SCENES: { name: string; run: string; steps: number }[] = [
  { name: 'rest', run: '', steps: 10 },
  { name: 'breeze', run: '', steps: 300 },
  {
    name: 'strong-horizontal',
    run: `w.store.set({strength:'gale'}); const p=[]; for(let i=0;i<70;i++)p.push([-20+i*0.58,0]); w.app.playStroke({points:p});`,
    steps: 75,
  },
  { name: 'curved', run: `w.app.play('sweep');`, steps: 90 },
  { name: 'spiral', run: `w.app.play('spiral');`, steps: 130 },
  { name: 'max-bend', run: `w.store.set({strength:'gale'}); w.app.play('sweep'); w.app.play('wave');`, steps: 80 },
  { name: 'recovering', run: `w.app.play('sweep');`, steps: 300 },
  { name: 'overlapping', run: `w.app.play('crossing');`, steps: 100 },
];

for (const scene of SCENES) {
  test(`frame: ${scene.name}`, async ({ page }) => {
    await open(page, 'manual&fixed&dpr=1&tufts=30000');
    const data = await page.evaluate(
      ({ run, steps }) =>
        new Promise<string>((resolve) => {
          const w = window.__wind!;
          w.app.stepFrames(30);
          if (run) new Function('w', run)(w);
          w.app.stepFrames(steps);
          w.app.onceAfterFrame(() => resolve(w.app.canvas.toDataURL('image/png')));
        }),
      scene,
    );
    expect(Buffer.from(data.split(',')[1], 'base64')).toMatchSnapshot(`${scene.name}.png`, { maxDiffPixelRatio: 0.01, threshold: 0.12 });
  });
}

test('frame: phone framing', async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 640 });
  await open(page, 'manual&fixed&dpr=1&tufts=20000');
  const data = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const w = window.__wind!;
        w.app.stepFrames(30);
        w.app.onceAfterFrame(() => resolve(w.app.canvas.toDataURL('image/png')));
      }),
  );
  expect(Buffer.from(data.split(',')[1], 'base64')).toMatchSnapshot('phone.png', { maxDiffPixelRatio: 0.01, threshold: 0.12 });
});
