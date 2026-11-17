// Render the hybrid hero and save the canvas and the page: node scripts/hybrid-shot.mjs prefix [W H DPR] [extra query]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [prefix = 'artifacts/vs/hy', W = '1672', H = '941', DPR = '1', extra = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: +DPR });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=${process.env.SCENE ?? 'portfolio-hybrid'}&compare&dpr=${DPR}&${extra}`);
await p.waitForFunction(() => window.__wind, null, { timeout: 60000 });
const data = await p.evaluate(() => new Promise((res) => { const w = window.__wind; const t = Number(new URLSearchParams(location.search).get('t') ?? -1); if (t >= 0 && w.app.setTime) w.app.time = t; w.app.stepFrames(Number(new URLSearchParams(location.search).get('steps') ?? 0)); w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/png'))); }));
writeFileSync(`${prefix}.png`, Buffer.from(data.split(',')[1], 'base64'));
await p.waitForTimeout(700);
await p.screenshot({ path: `${prefix}-page.png` });
console.log(prefix, errs.slice(0, 5));
await b.close();
