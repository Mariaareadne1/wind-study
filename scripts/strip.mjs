// Pull evenly spaced frames from a film into a contact sheet: node scripts/strip.mjs in.mp4 out.jpg cols n [crop=w:h:x:y] [start] [dur]
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const [input, out, cols = '3', n = '6', crop = '', start = '0', dur = ''] = process.argv.slice(2);
const every = dur ? (+dur / +n) : 0;
const rows = Math.ceil(+n / +cols);
const vf = [crop ? `crop=${crop}` : '', every ? `fps=${1 / every}` : 'select=not(mod(n\\,30))', 'scale=660:-2', `tile=${cols}x${rows}`].filter(Boolean).join(',');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', start, '-i', input, ...(dur ? ['-t', dur] : []), '-vf', vf, '-frames:v', '1', '-vsync', '0', out]);
console.log(out);
