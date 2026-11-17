// Recordings of the living hero with no input at all, to judge the ambient scene on its own.
// node scripts/living-film.mjs [prefix] [W H]
//   prefix.mp4        12 s in real time, as a visitor sees it (the live page, its own clock)
//   prefix-lapse.mp4  80 s of scene time at 15× (deterministic frames), to judge the clouds' drift and their shadows
//   prefix-sheet.png  a frame every second of the real-time clip;  prefix-lapse-sheet.png  every 10 s of scene time
//   prefix-zoom.mp4   the real-time clip, foreground grass at 2×
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';

const [prefix = 'artifacts/living', Ws = '1672', Hs = '941'] = process.argv.slice(2);
const W = +Ws, H = +Hs;
const base = process.env.URL ?? 'http://localhost:5428/';
const extra = process.env.EXTRA ?? '';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });

// real time
const dir = mkdtempSync('artifacts/film-');
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
const p = await ctx.newPage();
await p.goto(`${base}?scene=portfolio-living&dpr=1&${extra}`);
await p.waitForFunction(() => window.__wind, null, { timeout: 60000 });
await p.waitForTimeout(14000);
await ctx.close();
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '1.8', '-t', '12', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${prefix}.mp4`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${prefix}.mp4`, '-vf', 'fps=1,scale=420:-2,tile=4x3', '-frames:v', '1', `${prefix}-sheet.png`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${prefix}.mp4`, '-vf', `crop=${Math.round(W * 0.36)}:${Math.round(H * 0.32)}:${Math.round(W * 0.05)}:${Math.round(H * 0.64)},scale=iw*2:ih*2:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', `${prefix}-zoom.mp4`]);

// time-lapse from deterministic frames
const q = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await q.goto(`${base}?scene=portfolio-living&compare&dpr=1&${extra}`);
await q.waitForFunction(() => window.__wind, null, { timeout: 60000 });
const frames = mkdtempSync('artifacts/lapse-');
for (let f = 0; f <= 160; f++) {
  const d = await q.evaluate((t) => new Promise((res) => { const a = window.__wind.app; a.time = t; a.onceAfterFrame(() => res(a.canvas.toDataURL('image/jpeg', 0.92))); a.renderFrame(); }), f * 0.5);
  writeFileSync(join(frames, `f${String(f).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64'));
}
await b.close();
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(frames, 'f%04d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${prefix}-lapse.mp4`]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '2', '-i', join(frames, 'f%04d.jpg'), '-vf', 'select=not(mod(n\\,20)),scale=420:-2,tile=3x3', '-frames:v', '1', `${prefix}-lapse-sheet.png`]);
console.log(JSON.stringify({ realtime: `${prefix}.mp4`, lapse: `${prefix}-lapse.mp4`, zoom: `${prefix}-zoom.mp4` }));
