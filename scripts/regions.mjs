// Mean colour per region, target vs render: node scripts/regions.mjs render.png [target]
// Prints a 4x3 grid of mean sRGB, and how far the render's mean sits from the target's.
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const [render, target = 'design/reference/portfolio_hero_target.png'] = process.argv.slice(2);
const grid = (file) => execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', 'scale=4:3:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const t = grid(target);
const r = grid(render);
const lum = (b, i) => 0.3 * b[i] + 0.59 * b[i + 1] + 0.11 * b[i + 2];
let err = 0;
for (let y = 0; y < 3; y++) {
  const row = [];
  for (let x = 0; x < 4; x++) {
    const i = (y * 4 + x) * 3;
    row.push(`T ${t[i]},${t[i + 1]},${t[i + 2]} R ${r[i]},${r[i + 1]},${r[i + 2]}`.padEnd(34));
    err += Math.abs(lum(t, i) - lum(r, i));
  }
  console.log(row.join(' | '));
}
console.log('mean luminance gap', (err / 12).toFixed(1));
