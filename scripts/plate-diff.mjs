// How faithfully a render reproduces the plate: node scripts/plate-diff.mjs render.png [plate.png] [mask.png]
// Prints percentiles of the per-pixel max channel difference (0-255), PSNR, and the worst spots.
import { execFileSync, spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const [render, plate = 'design/reference/clean-landscape.png'] = process.argv.slice(2);
const W = 1672, H = 941;
const raw = (f) => execFileSync(ffmpeg, ['-loglevel', 'error', '-i', f, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
const a = raw(plate), b = raw(render);
const hist = new Array(256).fill(0);
const worst = [];
for (let i = 0; i < W * H; i++) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i * 3 + c] - b[i * 3 + c]));
  hist[d]++;
  if (d > 24 && worst.length < 400) worst.push([i % W, (i / W) | 0, d]);
}
const pct = (p) => { let s = 0; for (let k = 0; k < 256; k++) { s += hist[k]; if (s >= W * H * p) return k; } return 255; };
const psnr = String(spawnSync(ffmpeg, ['-i', plate, '-i', render, '-lavfi', 'psnr', '-f', 'null', '-']).stderr).match(/average:([0-9.inf]+)/)?.[1];
console.log(JSON.stringify({ p50: pct(0.5), p99: pct(0.99), p999: pct(0.999), max: hist.findLastIndex((v) => v > 0), over24: hist.slice(25).reduce((x, y) => x + y, 0), psnr: psnr ? +psnr : null, worst: worst.slice(0, 6) }));
