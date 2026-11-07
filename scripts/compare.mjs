// The same moment under different settings: node scripts/compare.mjs out.jpg "query1" "query2" ... (W, H, DPR, STEPS, PATTERN env)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
const [out, ...queries] = process.argv.slice(2);
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 800), DPR = +(process.env.DPR ?? 1), STEPS = +(process.env.STEPS ?? 85), PATTERN = process.env.PATTERN ?? 'heroCurve';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const files = [];
for (let i = 0; i < queries.length; i++) {
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed&${queries[i]}`);
  await p.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
  const data = await p.evaluate(({ STEPS, PATTERN }) => new Promise((res) => { const w = window.__wind; w.app.stepFrames(60); w.app.play(PATTERN); w.app.stepFrames(STEPS); w.app.onceAfterFrame(() => res(w.app.canvas.toDataURL('image/jpeg', 0.95))); }), { STEPS, PATTERN });
  const f = `${out}.${i}.jpg`; writeFileSync(f, Buffer.from(data.split(',')[1], 'base64')); files.push(f);
  await p.close();
}
await b.close();
if (files.length === 1) execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', files[0], out]);
else execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}:v]`).join('')}hstack=inputs=${files.length}`, '-frames:v', '1', out]);
console.log(out);
