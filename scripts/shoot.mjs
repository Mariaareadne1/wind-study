// Deterministic stills: node scripts/shoot.mjs out.png [dpr=2] [w=1440] [h=900] [js-to-run-before-capture]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const [out = 'artifacts/shot.png', dpr = '2', w = '1440', h = '900', js = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
await page.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed`);
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
const t0 = Date.now();
await page.evaluate((src) => {
  const w = window.__wind; w.app.stepFrames(30);
  if (src) new Function('w', src)(w);
}, js);
const data = await page.evaluate(() => new Promise((res) => {
  const w = window.__wind;
  w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/png')));
  w.app.renderFrame();
}));
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log(out, Date.now() - t0, 'ms', errors.slice(0, 8));
await browser.close();
