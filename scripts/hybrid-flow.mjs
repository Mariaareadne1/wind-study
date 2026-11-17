// Measures which way the grass runs at every point of the plate, for blade-level motion.
// node scripts/hybrid-flow.mjs [plate] [out.png] [debug.png]
// A structure tensor of the plate's luminance: strands are long, thin and bright, so the dominant gradient runs
// across them and the strand runs perpendicular to it. Stored as the doubled angle (no sign ambiguity):
// R = 0.5 + 0.5 cos 2θ, G = 0.5 + 0.5 sin 2θ, B = coherence (how clearly one direction dominates). Written at half size; the shipped file is then
// scaled to a quarter (418 × 235), since the field is smooth at that scale:
//   ffmpeg -i half.png -vf scale=418:235:flags=area -pix_fmt rgb24 q.png
//   ffmpeg -i q.png -c:v libwebp -lossless 1 public/hybrid/grass-flow.webp
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const [plate = 'design/reference/clean-landscape.png', out = 'artifacts/grass-flow-half.png', debug = 'artifacts/hybrid-flow-debug.png'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(plate).toString('base64')}`;
const r = await p.evaluate(async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = img.width, H = img.height;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const src = g.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (0.3 * src[i * 4] + 0.59 * src[i * 4 + 1] + 0.11 * src[i * 4 + 2]) / 255;
  // Sobel gradients -> tensor products
  const xx = new Float32Array(W * H), yy = new Float32Array(W * H), xy = new Float32Array(W * H);
  const at = (x, y) => L[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const i = y * W + x;
      xx[i] = gx * gx;
      yy[i] = gy * gy;
      xy[i] = gx * gy;
    }
  }
  // smooth the tensor (separable box blur, three passes ~ Gaussian, radius 7): orientation over a few strands
  const blur = (a, rad) => {
    const tmp = new Float32Array(W * H);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < H; y++) {
        let s = 0;
        for (let x = -rad; x <= rad; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))];
        for (let x = 0; x < W; x++) {
          tmp[y * W + x] = s / (2 * rad + 1);
          s += a[y * W + Math.min(W - 1, x + rad + 1)] - a[y * W + Math.max(0, x - rad)];
        }
      }
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let y = -rad; y <= rad; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
        for (let y = 0; y < H; y++) {
          a[y * W + x] = s / (2 * rad + 1);
          s += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.max(0, y - rad) * W + x];
        }
      }
    }
  };
  blur(xx, 4);
  blur(yy, 4);
  blur(xy, 4);
  // half-size output: doubled strand angle and coherence
  const OW = W >> 1, OH = H >> 1;
  const o = new ImageData(OW, OH);
  const dbg = new OffscreenCanvas(W, H);
  const dg = dbg.getContext('2d');
  dg.drawImage(img, 0, 0);
  dg.fillStyle = 'rgba(0,0,0,0.45)';
  dg.fillRect(0, 0, W, H);
  dg.lineWidth = 1.4;
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const i = (y * 2) * W + x * 2;
      const a = xx[i], bb = yy[i], cxy = xy[i];
      // gradient orientation is the tensor's major axis; the strand runs at right angles to it
      const theta = 0.5 * Math.atan2(2 * cxy, a - bb) + Math.PI / 2;
      const lam = Math.sqrt((a - bb) * (a - bb) + 4 * cxy * cxy);
      const coh = (a + bb) > 1e-6 ? lam / (a + bb) : 0;
      const k = (y * OW + x) * 4;
      o.data[k] = Math.round((0.5 + 0.5 * Math.cos(2 * theta)) * 255);
      o.data[k + 1] = Math.round((0.5 + 0.5 * Math.sin(2 * theta)) * 255);
      o.data[k + 2] = Math.round(Math.min(1, coh) * 255);
      o.data[k + 3] = 255;
      if (x % 12 === 6 && y % 12 === 6) {
        const len = 5 + 14 * Math.min(1, coh);
        const cx = x * 2, cy = y * 2;
        dg.strokeStyle = `hsl(${(((theta % Math.PI) + Math.PI) % Math.PI) / Math.PI * 360}, 90%, ${45 + 25 * coh}%)`;
        dg.beginPath();
        dg.moveTo(cx - Math.cos(theta) * len, cy - Math.sin(theta) * len);
        dg.lineTo(cx + Math.cos(theta) * len, cy + Math.sin(theta) * len);
        dg.stroke();
      }
    }
  }
  const oc = new OffscreenCanvas(OW, OH);
  oc.getContext('2d').putImageData(o, 0, 0);
  const toB64 = async (cv) => {
    const buf = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  };
  return { flow: await toB64(oc), debug: await toB64(dbg) };
}, dataUrl);
await b.close();
writeFileSync(out, Buffer.from(r.flow, 'base64'));
writeFileSync(debug, Buffer.from(r.debug, 'base64'));
console.log(JSON.stringify({ out, debug }));
