// Pointer wind check against a control. The scene is deterministic, so the same steps with and without a
// mouse sweep differ only by what the pointer did. node scripts/hover-check.mjs [prefix] [hover|drag|panel]
//   hover: sweep without pressing; drag: the same sweep pressed; panel: sweep over the glass panel (must do nothing)
// Prints mean change (0-255) inside the swept band and elsewhere, during and 4 s after, and writes a motion map.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
const [prefix = 'artifacts/vs/hover', mode = 'hover'] = process.argv.slice(2);
const W = 1440, H = 900;
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const open = async () => {
  await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=portfolio&compare&panel&tufts=60000`);
  await p.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
};
const step = (n) => p.evaluate((n) => new Promise((res) => { const w = window.__wind; w.app.stepFrames(n); w.app.onceAfterFrame(() => res(0)); }), n);
const grab = () => p.evaluate(() => new Promise((res) => { const w = window.__wind; w.app.stepFrames(0); w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/png'))); }));
const save = async (name) => writeFileSync(`${prefix}-${name}.png`, Buffer.from((await grab()).split(',')[1], 'base64'));
const [x0, x1, y] = mode === 'panel' ? [0.1, 0.3, 0.45] : [0.42, 0.82, 0.72];
const run = async (withPointer, tag) => {
  await open();
  await step(240);
  if (withPointer) {
    await p.mouse.move(W * x0, H * y);
    if (mode === 'drag') await p.mouse.down();
  }
  for (let i = 0; i <= 30; i++) {
    if (withPointer) await p.mouse.move(W * (x0 + (x1 - x0) * (i / 30)), H * y + Math.sin(i / 5) * 6);
    await step(1);
  }
  if (withPointer && mode === 'drag') await p.mouse.up();
  if (withPointer) await p.mouse.move(W * 0.99, H * 0.02);
  await step(20);
  await save(`${tag}-during`);
  await step(240);
  await save(`${tag}-after`);
  return p.evaluate(() => window.__wind.app.sim.activeGusts);
};
await run(false, 'ctl');
const left = await run(true, 'ptr');
await b.close();
const raw = (f) => execFileSync(ffmpeg, ['-loglevel', 'error', '-i', f, '-vf', 'scale=144:90:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
const inBand = (yy, xx) => yy > 90 * (y - 0.1) && yy < 90 * (y + 0.12) && xx > 144 * (x0 - 0.04) && xx < 144 * (x1 + 0.04);
const stats = (t) => {
  const A = raw(`${prefix}-ctl-${t}.png`), B = raw(`${prefix}-ptr-${t}.png`);
  let i = 0, o = 0, ni = 0, no = 0;
  for (let yy = 0; yy < 90; yy++) for (let xx = 0; xx < 144; xx++) { const d = Math.abs(A[yy * 144 + xx] - B[yy * 144 + xx]); if (inBand(yy, xx)) { i += d; ni++; } else { o += d; no++; } }
  return { inside: +(i / ni).toFixed(2), outside: +(o / no).toFixed(2) };
};
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${prefix}-ctl-during.png`, '-i', `${prefix}-ptr-during.png`, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=difference,format=gray,eq=contrast=1:brightness=0,lutyuv=y=val*6', `${prefix}-motion.png`]);
console.log(JSON.stringify({ mode, during: stats('during'), after4s: stats('after'), gustsLeft: left }));
