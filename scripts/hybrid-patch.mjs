// One-patch wind proof for the hybrid hero. Drags (or hovers) across a patch of grass with the sim stepped by
// hand, saves native-resolution crops before / during / settling / settled, a 4× difference map, and prints how
// far the change spreads outside the patch and how the grass bend decays.
// node scripts/hybrid-patch.mjs [prefix] [drag|hover] [cx cy] (patch centre in plate px, default 1150 780)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'artifacts/vs/patch', mode = 'drag', cxs = '1150', cys = '780'] = process.argv.slice(2);
const W = 1672, H = 941, CX = +cxs, CY = +cys, PW = 300, PH = 200;
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=portfolio-hybrid&compare&dpr=1&${process.env.EXTRA ?? ""}`);
await p.waitForFunction(() => window.__wind, null, { timeout: 60000 });
const step = (n) => p.evaluate((n) => new Promise((res) => { const a = window.__wind.app; a.stepFrames(n); a.onceAfterFrame(() => res(a.bendEnergy())); }), n);
const grab = async (name) => {
  const d = await p.evaluate(() => new Promise((res) => { const a = window.__wind.app; a.onceAfterFrame(() => res(a.canvas.toDataURL('image/png'))); a.renderFrame(); }));
  writeFileSync(`${prefix}-${name}.png`, Buffer.from(d.split(',')[1], 'base64'));
};
await step(120);
await grab('a-before');
const energy = [];
// a 260 px stroke across the patch, left to right and a little downhill, over 20 steps (a third of a second)
const x0 = CX - 130, x1 = CX + 130;
await p.mouse.move(x0, CY - 12);
if (mode === 'drag') await p.mouse.down();
for (let i = 0; i <= 20; i++) {
  await p.mouse.move(x0 + (x1 - x0) * (i / 20), CY - 12 + 24 * (i / 20));
  energy.push(+(await step(1)).toFixed(4));
}
if (mode === 'drag') await p.mouse.up();
await p.mouse.move(W - 4, 4);
energy.push(+(await step(6)).toFixed(4));
await grab('b-during');
for (const [n, tag] of [[30, 'c-0.6s'], [60, 'd-1.6s'], [90, 'e-3.1s']]) {
  energy.push(+(await step(n)).toFixed(4));
  await grab(tag);
}
const gusts = await p.evaluate(() => window.__wind.app.sim.activeGusts);
await b.close();

const crop = `crop=${PW}:${PH}:${CX - PW / 2}:${CY - PH / 2}`;
const tags = ['a-before', 'b-during', 'c-0.6s', 'd-1.6s', 'e-3.1s'];
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...tags.flatMap((t) => ['-i', `${prefix}-${t}.png`]), '-filter_complex', `${tags.map((_, i) => `[${i}:v]${crop}[c${i}]`).join(';')};${tags.map((_, i) => `[c${i}]`).join('')}hstack=inputs=${tags.length}`, `${prefix}-strip.png`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${prefix}-a-before.png`, '-i', `${prefix}-b-during.png`, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=difference,format=gray,lutyuv=y=val*4', `${prefix}-diff.png`]);
// how much changed inside the patch versus well away from it (clouds, far hills)
const gray = (f) => execFileSync(ffmpeg, ['-loglevel', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 });
const A = gray(`${prefix}-a-before.png`), B = gray(`${prefix}-b-during.png`), E = gray(`${prefix}-e-3.1s.png`);
const mean = (X, Y, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Math.abs(X[y * W + x] - Y[y * W + x]); n++; } return +(s / n).toFixed(2); };
console.log(JSON.stringify({
  mode,
  patchDuring: mean(A, B, CX - 150, CY - 100, CX + 150, CY + 100),
  cloudDuring: mean(A, B, 700, 120, 1150, 290),
  farHillsDuring: mean(A, B, 40, 40, 400, 200),
  patchAfter3s: mean(A, E, CX - 150, CY - 100, CX + 150, CY + 100),
  energy,
  gustsLeft: gusts,
}));
