import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'], headless: false });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5428/?fixed&' + (process.env.QUERY ?? ''));
await p.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => new Promise((res) => { const ts = []; let last = performance.now(); window.__wind.app.play('sweep'); const f = (t) => { ts.push(t - last); last = t; if (ts.length < 300) requestAnimationFrame(f); else { const s = ts.slice(10).sort((a, b) => a - b); res({ med: s[Math.floor(s.length * .5)], p90: s[Math.floor(s.length * .9)], p99: s[Math.floor(s.length * .99)], w: window.__wind.app.canvas.width, strands: window.__wind.app.grass.drawn }); } }; requestAnimationFrame(f); }));
console.log('rAF headed', r); await b.close();
