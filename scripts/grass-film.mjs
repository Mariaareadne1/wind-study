// Real-time recordings of the grass feasibility scene: node scripts/grass-film.mjs outdir [candidate ...]
// For each candidate and wind (calm, breeze, gust): 10 s at 1672 × 941, DPR 1, and frame timing measured in the page.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
const [out = 'artifacts/grass/film', ...cands] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = 1672, H = 941;
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const results = {};
for (const c of cands.length ? cands : ['a', 'b']) {
  for (const wind of ['calm', 'breeze', 'gust']) {
    const dir = mkdtempSync('artifacts/film-');
    const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
    const p = await ctx.newPage();
    await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=grass-feasibility&candidate=${c}&wind=${wind}&dpr=1`);
    await p.waitForFunction(() => window.__grass, null, { timeout: 60000 });
    await p.waitForTimeout(1500);
    const timing = await p.evaluate(() => new Promise((res) => { const ts = []; let last = performance.now(); const f = (t) => { ts.push(t - last); last = t; if (ts.length < 600) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ median: +ts[300].toFixed(2), p95: +ts[570].toFixed(2), p99: +ts[594].toFixed(2) }); } }; requestAnimationFrame(f); }));
    await ctx.close();
    const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '1.6', '-t', '10', '-i', webm, '-vf', 'scale=1672:940', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `${out}/${c}-${wind}.mp4`]);
    results[`${c}-${wind}`] = timing;
  }
}
await b.close();
console.log(JSON.stringify(results));
