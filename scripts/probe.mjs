// Rest vs gust at 1:1: node scripts/probe.mjs out-prefix [steps=70] [pattern=sweep]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [prefix = 'artifacts/p', steps = '70', pat = 'sweep'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed`);
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
const grab = (n) => page.evaluate((n) => new Promise((res) => { const w = window.__wind; w.app.stepFrames(n); w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/jpeg', 0.95))); }), n);
const save = (f, d) => writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
save(`${prefix}-rest.jpg`, await grab(60));
await page.evaluate((p) => window.__wind.app.play(p), pat);
save(`${prefix}-gust.jpg`, await grab(+steps));
const stats = await page.evaluate(() => {
  const s = window.__wind.app.sim;
  let w = 0, b = 0, e = 0;
  for (let a = 0; a < s.totalU.length; a++) {
    w = Math.max(w, Math.hypot(s.totalU[a], s.totalV[a]));
    b = Math.max(b, Math.hypot(s.response.bend[a * 4], s.response.bend[a * 4 + 1]));
    e = Math.max(e, s.response.energy[a]);
  }
  return { maxWind: +w.toFixed(2), maxBend: +b.toFixed(3), maxEnergy: +e.toFixed(3), strands: window.__wind.app.grass.drawn, calls: window.__wind.app.renderer.info.render.calls };
});
console.log(stats);
await browser.close();
