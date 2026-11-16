// Side by side with the target, at the target's exact aspect, in a fixed deterministic state:
// node scripts/vs.mjs out-prefix [steps=600] [query extra]
// Writes <prefix>.png (render), <prefix>-vs.jpg (target | render) and <prefix>-close.png (a 1:1 crop).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
const [prefix = 'artifacts/vs/current', steps = '600', extra = ''] = process.argv.slice(2);
const TARGET = process.env.TARGET ?? 'references/meadow_target_reference.png';
const W = 421, H = 791, DPR = 2; // the reference is 842 x 1582
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?compare&scene=sunlit&${extra}`);
await p.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
const data = await p.evaluate((n) => new Promise((res) => { const w = window.__wind; w.app.stepFrames(n); w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/png'))); }), +steps);
writeFileSync(`${prefix}.png`, Buffer.from(data.split(',')[1], 'base64'));
await b.close();
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', TARGET, '-i', `${prefix}.png`, '-filter_complex', '[0:v]scale=-2:1100[a];[1:v]scale=-2:1100[b];[a][b]hstack', '-q:v', '3', `${prefix}-vs.jpg`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${prefix}.png`, '-vf', `crop=520:520:${process.env.CX ?? 160}:${process.env.CY ?? 520}`, `${prefix}-close.png`]);
console.log(prefix, errs.slice(0, 5));
