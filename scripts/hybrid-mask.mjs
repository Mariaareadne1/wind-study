// Authors the grass mask for the hybrid hero from the clean plate: white = grass detail may move,
// black = keep still (clouds, their rims, flowers). node scripts/hybrid-mask.mjs [plate] [out.png] [debug.png]
// Three steps: a colour key for bright, unsaturated pixels (clouds, flowers); hand-placed ellipses that
// cover each cloud and its backlit rim generously; then dilation and a soft feather, so no edge halos.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const [plate = 'design/reference/clean-landscape.png', out = 'public/hybrid/grass-mask.png', debug = 'artifacts/hybrid-mask-debug.png'] = process.argv.slice(2);
const W = 1672, H = 941;
// cloud cut-outs in plate pixels: centre, radii, rotation (authored by eye against the plate)
const CLOUDS = [
  { x: 918, y: 205, rx: 300, ry: 118, a: -0.02 },
  { x: 1298, y: 452, rx: 312, ry: 135, a: 0.0 },
  { x: 826, y: 592, rx: 128, ry: 60, a: 0.0 },
];

const b = await chromium.launch();
const p = await b.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(plate).toString('base64')}`;
const result = await p.evaluate(
  async ({ dataUrl, W, H, CLOUDS }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, W, H).data;
    const smooth = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // 1. colour key: clouds and flowers are bright and nearly colourless; sunlit grass is bright but strongly green
    const key = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const r = src[i * 4] / 255, gg = src[i * 4 + 1] / 255, bb = src[i * 4 + 2] / 255;
      const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      const sat = (mx - mn) / Math.max(mx, 1e-3);
      const lum = 0.3 * r + 0.59 * gg + 0.11 * bb;
      const v = smooth(0.6, 0.78, lum) * (1 - smooth(0.2, 0.38, sat));
      key.data[i * 4] = key.data[i * 4 + 1] = key.data[i * 4 + 2] = Math.round(v * 255);
      key.data[i * 4 + 3] = 255;
    }
    const k = new OffscreenCanvas(W, H);
    const kg = k.getContext('2d');
    kg.putImageData(key, 0, 0);
    // 2. authored cloud ellipses, feathered
    kg.save();
    kg.filter = 'blur(10px)';
    kg.fillStyle = '#fff';
    for (const e of CLOUDS) {
      kg.beginPath();
      kg.ellipse(e.x, e.y, e.rx, e.ry, e.a, 0, Math.PI * 2);
      kg.fill();
    }
    kg.restore();
    // 3. dilate (blur then lift) and feather: a still zone a few pixels wider than anything bright
    const d = new OffscreenCanvas(W, H);
    const dg = d.getContext('2d', { willReadFrequently: true });
    dg.filter = 'blur(7px)';
    dg.drawImage(k, 0, 0);
    const grown = dg.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) {
      const v = smooth(0.04, 0.3, grown.data[i * 4] / 255);
      const keep = Math.round((1 - v) * 255);
      grown.data[i * 4] = grown.data[i * 4 + 1] = grown.data[i * 4 + 2] = keep;
    }
    dg.filter = 'none';
    dg.putImageData(grown, 0, 0);
    const f = new OffscreenCanvas(W / 2, H / 2);
    const fg = f.getContext('2d');
    fg.filter = 'blur(2px)';
    fg.drawImage(d, 0, 0, W / 2, H / 2);
    // debug: the plate with still zones tinted red, to inspect the mask at full contrast
    const dbg = new OffscreenCanvas(W, H);
    const bg = dbg.getContext('2d');
    bg.drawImage(img, 0, 0);
    const pix = bg.getImageData(0, 0, W, H);
    const m = dg.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) {
      const still = 1 - m[i * 4] / 255;
      pix.data[i * 4] = pix.data[i * 4] * (1 - still) + 255 * still;
      pix.data[i * 4 + 1] *= 1 - still * 0.85;
      pix.data[i * 4 + 2] *= 1 - still * 0.85;
    }
    bg.putImageData(pix, 0, 0);
    const toUrl = async (cv) => {
      const blob = await cv.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    };
    let grass = 0;
    for (let i = 0; i < W * H; i++) grass += m[i * 4] / 255;
    return { mask: await toUrl(f), debug: await toUrl(dbg), grassShare: grass / (W * H) };
  },
  { dataUrl, W, H, CLOUDS },
);
await b.close();
writeFileSync(out, Buffer.from(result.mask, 'base64'));
writeFileSync(debug, Buffer.from(result.debug, 'base64'));
console.log(JSON.stringify({ out, debug, grassShare: +result.grassShare.toFixed(3) }));
