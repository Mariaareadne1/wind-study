// Offline film from the real gesture pipeline, frame by frame through the real renderer.
// node scripts/film.mjs out.mp4 <hero | pattern> [seconds=8] [fps=30] [dpr=1] [width=1440] [height=900]
// QUERY adds settings, for example QUERY='preset=more&frame=1'. CRF sets quality (default 17).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
const [out = 'artifacts/film.mp4', what = 'sweep', seconds = '8', fps = '30', dpr = '1', vw = '1440', vh = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +vw, height: +vh }, deviceScaleFactor: +dpr });
await page.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed&${process.env.QUERY ?? ''}`);
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
await page.evaluate(() => window.__wind.app.stepFrames(120));
// hero: gestures at set times (seconds); otherwise a single pattern a second in
const events = what === 'hero' ? [] : [[1.0, what]];
if (what === 'hero') await page.evaluate(() => window.__wind.app.playDemo());
const total = Math.round(+seconds * +fps);
const stepsPerFrame = Math.round(60 / +fps);
const size = await page.evaluate(() => [window.__wind.app.canvas.width, window.__wind.app.canvas.height]);
const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${size[0] - size[0] % 2}:${size[1] - size[1] % 2}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let f = 0; f < total; f++) {
  const t = f / +fps;
  const due = events.filter((e) => e[0] <= t && e[0] > t - 1 / +fps).map((e) => e[1]);
  const data = await page.evaluate(({ due, n }) => new Promise((res) => {
    const w = window.__wind;
    for (const d of due) w.app.play(d);
    w.app.stepFrames(n);
    w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/jpeg', 0.96)));
  }), { due, n: stepsPerFrame });
  if (!ff.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log(out, total, 'frames');
await browser.close();
