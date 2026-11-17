// Real-time recording of the live hybrid hero: hover, then drag, across a patch. Writes the full-frame mp4, a 2× zoom
// of the patch, and a contact sheet of the zoom every 100 ms during the drag.
// node scripts/hybrid-film.mjs [out-prefix] [cx cy]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
const [prefix = 'artifacts/hybrid-film', cxs = '1150', cys = '780'] = process.argv.slice(2);
const W = 1672, H = 941, CX = +cxs, CY = +cys;
const dir = mkdtempSync('artifacts/film-');
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
const p = await ctx.newPage();
await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=portfolio-hybrid&dpr=1`);
await p.waitForFunction(() => window.__wind, null, { timeout: 60000 });
await p.waitForTimeout(1500);
const t0 = Date.now();
const sweep = async (xa, ya, xb, yb, ms) => {
  const n = Math.round(ms / 16);
  for (let i = 0; i <= n; i++) { await p.mouse.move(xa + (xb - xa) * (i / n), ya + (yb - ya) * (i / n)); await p.waitForTimeout(16); }
};
await p.mouse.move(CX - 200, CY - 10);
await sweep(CX - 200, CY - 10, CX + 200, CY + 15, 1200);
await p.waitForTimeout(1600);
const dragAt = (Date.now() - t0) / 1000;
await p.mouse.move(CX - 170, CY - 20);
await p.mouse.down();
await sweep(CX - 170, CY - 20, CX + 170, CY + 20, 500);
await p.mouse.up();
await p.mouse.move(W - 4, 4);
await p.waitForTimeout(2600);
await ctx.close();
await b.close();
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
const lead = 1.5 + 0.35; // page settle before t0, plus load
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(lead), '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${prefix}.mp4`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${prefix}.mp4`, '-vf', `crop=480:300:${CX - 240}:${CY - 150},scale=960:600:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', `${prefix}-zoom.mp4`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, dragAt - 0.2)), '-t', '1.6', '-i', `${prefix}-zoom.mp4`, '-vf', 'fps=10,scale=480:-2,tile=4x4', '-frames:v', '1', `${prefix}-sheet.png`]);
console.log(JSON.stringify({ mp4: `${prefix}.mp4`, zoom: `${prefix}-zoom.mp4`, sheet: `${prefix}-sheet.png`, dragAt }));
