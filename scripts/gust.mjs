// Film a gust as a contact sheet: node scripts/gust.mjs prefix "<pattern or js>" step count [dpr]
// Each frame is produced by deterministic stepping through the real gesture pipeline.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [prefix = 'artifacts/g', pat = 'sweep', step = '20', count = '6', dpr = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +dpr });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed`);
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
await page.evaluate((p) => { const w = window.__wind; w.app.stepFrames(60); if (p.includes('(')) new Function('w', p)(w); else w.app.play(p); }, pat);
const files = [];
for (let i = 0; i < +count; i++) {
  const data = await page.evaluate((n) => new Promise((res) => { const w = window.__wind; w.app.stepFrames(n); w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/jpeg', 0.93))); }), +step);
  const f = `${prefix}-${i}.jpg`; writeFileSync(f, Buffer.from(data.split(',')[1], 'base64')); files.push(f);
}
console.log(files.join(' '), errs);
await browser.close();
