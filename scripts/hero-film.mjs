// A short recording of the live hero answering the mouse: a hover sweep, then a drag. node scripts/hero-film.mjs out.mp4
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
const out = process.argv[2] ?? 'artifacts/hero-interaction.mp4';
const W = 1440, H = 810;
const dir = mkdtempSync('artifacts/film-');
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
const p = await ctx.newPage();
await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=portfolio`);
await p.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
await p.waitForTimeout(2200);
const sweep = async (x0, x1, y, ms, wobble = 10) => {
  const n = Math.round(ms / 16);
  for (let i = 0; i <= n; i++) {
    await p.mouse.move(W * (x0 + (x1 - x0) * (i / n)), H * y + Math.sin(i / 6) * wobble);
    await p.waitForTimeout(16);
  }
};
// hover: slow, then quicker
await p.mouse.move(W * 0.4, H * 0.75);
await sweep(0.4, 0.9, 0.75, 1600);
await p.waitForTimeout(900);
await sweep(0.9, 0.45, 0.6, 900, 18);
await p.waitForTimeout(1500);
// drag: a deliberate gust across the hills
await p.mouse.move(W * 0.38, H * 0.85);
await p.mouse.down();
await sweep(0.38, 0.95, 0.62, 1100, 30);
await p.mouse.up();
await p.mouse.move(W * 0.99, H * 0.02);
await p.waitForTimeout(3200);
await ctx.close();
await b.close();
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
// drop the loading second at the start
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '2.2', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', out]);
console.log(out);
