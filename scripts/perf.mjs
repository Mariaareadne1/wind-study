// GPU-synced frame cost, with a gust blowing: node scripts/perf.mjs [dpr=2] [w] [h]
// Renders back-to-back frames with a pixel readback after each (forces the GPU to finish).
import { chromium } from '@playwright/test';
import { loadavg, cpus } from 'node:os';
const dpr = Number(process.argv[2] ?? 2);
const W = +(process.argv[3] ?? 1440), H = +(process.argv[4] ?? 900);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
await page.goto((process.env.URL ?? 'http://localhost:5428/') + '?manual&fixed' + (process.env.Q ?? ''));
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const w = window.__wind, a = w.app, gl = a.renderer.getContext();
  const px = new Uint8Array(4);
  const times = [], sim = [];
  a.play('crossing');
  for (let i = 0; i < 180; i++) {
    if (i % 60 === 0) a.play('sweep');
    const t0 = performance.now();
    a.stepFrames(1);
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    times.push(performance.now() - t0);
    sim.push(t1 - t0);
  }
  const s = a.sim; const t = performance.now();
  for (let i = 0; i < 60; i++) { s.step(); }
  const simOnly = (performance.now() - t) / 60;
  times.sort((x, y) => x - y);
  const q = (p) => times[Math.floor(times.length * p)];
  return { medianMs: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p99: +q(0.99).toFixed(2), simStepMs: +simOnly.toFixed(2), strands: a.grass.drawn, w: a.canvas.width, h: a.canvas.height };
});
console.log(JSON.stringify({ ...res, load: loadavg().map((l) => l.toFixed(1)).join(' '), cores: cpus().length }));
await browser.close();
