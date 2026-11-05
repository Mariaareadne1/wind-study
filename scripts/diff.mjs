// Motion map: how far the picture moved from rest, computed on actual pixels.
// node scripts/diff.mjs out.png "<pattern>" stepsList(e.g. 40,80,140) [dpr=1]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [out = 'artifacts/diff.png', pat = 'sweep', list = '40,80,140', dpr = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +dpr });
await page.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed&${process.env.QUERY ?? ''}`);
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
const res = await page.evaluate(async ({ pat, list }) => {
  const w = window.__wind;
  const grab = (n) => new Promise((res) => {
    w.app.stepFrames(n);
    w.app.onceAfterFrame(() => { const c = document.createElement('canvas'); c.width = w.app.canvas.width; c.height = w.app.canvas.height; c.getContext('2d').drawImage(w.app.canvas, 0, 0); res(c); });
  });
  const base = await grab(60);
  const W = base.width, H = base.height;
  const bd = base.getContext('2d').getImageData(0, 0, W, H).data;
  if (pat.includes('(')) new Function('w', pat)(w); else w.app.play(pat);
  const steps = list.split(',').map(Number);
  let prev = 0;
  const panels = [], stats = [];
  for (const s of steps) {
    const c = await grab(s - prev); prev = s;
    const d = c.getContext('2d').getImageData(0, 0, W, H).data;
    const o = c.getContext('2d').createImageData(W, H);
    let sum = 0, cx = 0, cy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (x + y * W) * 4;
      const v = Math.abs(d[i] - bd[i]) + Math.abs(d[i + 1] - bd[i + 1]) + Math.abs(d[i + 2] - bd[i + 2]);
      o.data[i] = o.data[i + 1] = o.data[i + 2] = Math.min(255, v * 3); o.data[i + 3] = 255;
      if (v > 30) { sum++; cx += x; cy += y; }
    }
    c.getContext('2d').putImageData(o, 0, 0);
    panels.push(c);
    stats.push({ step: s, moved: +(sum / (W * H)).toFixed(3), cx: Math.round(cx / Math.max(sum, 1)), cy: Math.round(cy / Math.max(sum, 1)) });
  }
  const sheet = document.createElement('canvas'); sheet.width = W / 2 * panels.length; sheet.height = H / 2;
  panels.forEach((p, i) => sheet.getContext('2d').drawImage(p, i * W / 2, 0, W / 2, H / 2));
  return { url: sheet.toDataURL('image/jpeg', 0.9), stats };
}, { pat, list });
writeFileSync(out, Buffer.from(res.url.split(',')[1], 'base64'));
console.log(res.stats);
await browser.close();
