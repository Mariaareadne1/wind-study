// Target above, render below, at the same width: node scripts/stack.mjs render.png out.jpg [target]
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const [render, out, target = 'design/reference/portfolio_hero_target.png'] = process.argv.slice(2);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', target, '-i', render, '-filter_complex', '[0:v]scale=1000:-2[a];[1:v]scale=1000:-2[b];[a][b]vstack', '-q:v', '3', out]);
