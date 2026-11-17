// Separates the clean plate into layers for the living hero (run once; outputs go to public/living/):
//   land.webp      the landscape with the clouds lifted out and the ground beneath them filled
//   cloud-N.png    each cloud as its own sprite: premultiplied colour (top half) and alpha (bottom half)
//   shadow-N.png   each cloud's shadow: its silhouette, blurred and flattened onto the ground
//   layers.json    where each sprite sits on the plate, and each shadow's offset and depth
// plus artifacts/living-layers-debug.png (land, mattes and shadow outlines) for inspection.
// node scripts/living-layers.mjs [plate.png]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [plate = 'design/reference/clean-landscape.png'] = process.argv.slice(2);
// Authored by eye against the plate (1672 × 941). Cloud: its region. Shadow: where its shadow lies relative to the
// cloud (the ground falls away below the clouds, so each differs), how flat it is, and how much light it takes.
const CLOUDS = [
  { x: 918, y: 205, rx: 300, ry: 118, shadow: { dx: -70, dy: 175, squash: 0.62, depth: 0.2 } },
  { x: 1298, y: 452, rx: 312, ry: 135, shadow: { dx: -140, dy: 175, squash: 0.6, depth: 0.2 } },
  { x: 826, y: 592, rx: 128, ry: 60, shadow: { dx: -40, dy: 95, squash: 0.65, depth: 0.18 } },
];
const PAD = 40;

mkdirSync('public/living', { recursive: true });
const b = await chromium.launch();
const p = await b.newPage();
const dataUrl = `data:image/png;base64,${readFileSync(plate).toString('base64')}`;
const out = await p.evaluate(
  async ({ dataUrl, CLOUDS, PAD }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const W = img.width, H = img.height;
    const cv = new OffscreenCanvas(W, H);
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, W, H).data;
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const blurField = (field, w, h, rad, passes = 3) => {
      const a = Float32Array.from(field), t = new Float32Array(w * h);
      for (let pass = 0; pass < passes; pass++) {
        for (let y = 0; y < h; y++) { let s = 0; for (let x = -rad; x <= rad; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { t[y * w + x] = s / (2 * rad + 1); s += a[y * w + Math.min(w - 1, x + rad + 1)] - a[y * w + Math.max(0, x - rad)]; } }
        for (let x = 0; x < w; x++) { let s = 0; for (let y = -rad; y <= rad; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { a[y * w + x] = s / (2 * rad + 1); s += t[Math.min(h - 1, y + rad + 1) * w + x] - t[Math.max(0, y - rad) * w + x]; } }
      }
      return a;
    };
    // 1. cloud alpha: bright and nearly colourless, inside each cloud's region
    const alpha = new Float32Array(W * H);
    const id = new Int8Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let inside = -1, reach = 0;
      CLOUDS.forEach((c, k) => { const e = ((x - c.x) / (c.rx + PAD)) ** 2 + ((y - c.y) / (c.ry + PAD)) ** 2; if (e < 1) { inside = k; reach = 1 - smooth(0.75, 1, e); } });
      if (inside < 0) continue;
      const r = src[i * 4] / 255, gg = src[i * 4 + 1] / 255, bb = src[i * 4 + 2] / 255;
      const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      const sat = (mx - mn) / Math.max(mx, 1e-3), lum = 0.3 * r + 0.59 * gg + 0.11 * bb;
      // the one thing that cleanly separates cloud from grass is greenness: how far green exceeds red and blue.
      // Clouds, down to their grey-blue bases, sit near zero; grass is clearly green even in deep shade. Grass at a
      // cloud's base therefore stays in the land (it never needs filling, and never travels with the cloud).
      const green = gg - Math.max(r, bb);
      alpha[i] = (1 - smooth(0.0, 0.07, green)) * smooth(0.3, 0.55, lum) * reach;
      id[i] = inside;
    }
    // 2. the hole to fill: anything cloudy, grown by a few pixels so no rim of white survives in the land
    // anything near a cloud that is not green goes into the hole too, so the fill only ever copies real grass
    const notGreen = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (id[i] < 0) continue;
      const gg = src[i * 4 + 1] / 255 - Math.max(src[i * 4] / 255, src[i * 4 + 2] / 255);
      notGreen[i] = gg < 0.05 ? 1 : 0;
    }
    const grown = blurField(alpha.map((v, i) => (v > 0.015 || notGreen[i] ? 1 : 0)), W, H, 3, 2);
    const hole = grown.map((v) => smooth(0.02, 0.25, v));
    // 3. fill. A cloud only drifts a few dozen pixels, so only a thin rim of each hole is ever uncovered. Each hole
    //    pixel takes the real grass mirrored across the hole's edge (its nearest known pixel q, reflected: 2q − p),
    //    which keeps the texture and the local tone continuous right at the boundary; deeper in, never seen, a smooth
    //    fill of the surroundings is enough.
    const land = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) land[i * 3 + c] = src[i * 4 + c] / 255;
    const isHole = hole.map((h) => (h > 0.01 ? 1 : 0));
    // nearest known pixel for every hole pixel: breadth-first from the hole's edge
    const near = new Int32Array(W * H).fill(-1);
    const dist = new Float32Array(W * H).fill(1e9);
    let queue = [];
    for (let i = 0; i < W * H; i++) if (!isHole[i]) { near[i] = i; dist[i] = 0; }
    for (let i = 0; i < W * H; i++) {
      if (!isHole[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && !isHole[yy * W + xx]) { queue.push(i); break; } }
    }
    for (const i of queue) { const x = i % W, y = (i / W) | 0; let best = -1, bd = 1e9; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (!isHole[j]) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = j; } } } near[i] = best; dist[i] = bd; }
    while (queue.length) {
      const next = [];
      for (const i of queue) {
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (!isHole[j]) continue;
          const q = near[i], qx = q % W, qy = (q / W) | 0;
          const d = Math.hypot(xx - qx, yy - qy);
          if (d + 1e-3 < dist[j]) { dist[j] = d; near[j] = q; next.push(j); }
        }
      }
      queue = next;
    }
    // tone comes from a local smooth fill of the surrounding land (so a sunlit patch is never copied into shade);
    // only the fine texture comes from the mirror, so the revealed rim is real strands at the right brightness
    const known = isHole.map((h) => 1 - h);
    const chans = [0, 1, 2].map((c) => land.filter((_, i) => i % 3 === c));
    const normFill = (rad) => {
      const w = blurField(known, W, H, rad);
      return chans.map((ch) => { const b = blurField(ch.map((v, i) => v * known[i]), W, H, rad); return b.map((v, i) => (w[i] > 1e-5 ? v / w[i] : 0)); });
    };
    const nearFill = normFill(12);
    const deepFill = normFill(40);
    const mirrored = chans.map((ch) => Float32Array.from(ch));
    for (let i = 0; i < W * H; i++) {
      if (!isHole[i] || near[i] < 0) continue;
      const x = i % W, y = (i / W) | 0, q = near[i], qx = q % W, qy = (q / W) | 0;
      const mx = Math.min(W - 1, Math.max(0, 2 * qx - x)), my = Math.min(H - 1, Math.max(0, 2 * qy - y));
      const m = my * W + mx;
      const from = isHole[m] ? q : m;
      for (let c = 0; c < 3; c++) mirrored[c][i] = chans[c][from];
    }
    const mirroredLow = mirrored.map((ch) => blurField(ch, W, H, 4));
    // the smooth tone alone, without borrowed texture: clouds are unmixed against this, so no fill texture travels with them
    const landTone = Float32Array.from(land);
    for (let i = 0; i < W * H; i++) {
      if (!isHole[i] || near[i] < 0) continue;
      const deep = smooth(20, 50, dist[i]);
      const h = hole[i];
      for (let c = 0; c < 3; c++) {
        const tone = nearFill[c][i] * (1 - deep) + deepFill[c][i] * deep;
        // borrowed texture only where the cloud was opaque: there it is hidden at rest and seen only once the cloud
        // drifts off; under the cloud's translucent fringe it would show through, so it fades out there
        const grain = (mirrored[c][i] - mirroredLow[c][i]) * 0.7 * smooth(0.35, 0.9, alpha[i]) * (1 - 0.5 * deep);
        land[i * 3 + c] = chans[c][i] * (1 - h) + (tone + grain) * h;
        landTone[i * 3 + c] = chans[c][i] * (1 - h) + tone * h;
      }
    }
    // 4. cloud sprites: colour unmixed from the filled land, so cloud over land reproduces the plate
    const sprites = [];
    CLOUDS.forEach((c, k) => {
      const x0 = Math.max(0, Math.floor(c.x - c.rx - PAD)), y0 = Math.max(0, Math.floor(c.y - c.ry - PAD));
      const x1 = Math.min(W, Math.ceil(c.x + c.rx + PAD)), y1 = Math.min(H, Math.ceil(c.y + c.ry + PAD));
      const sw = x1 - x0, sh = y1 - y0;
      // stored premultiplied and opaque (top half), with alpha as grey (bottom half): no division by a small alpha
      // and no canvas premultiplication, so cloud over land gives back the plate exactly at the soft rims
      const im = new ImageData(sw, sh * 2);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = (y + y0) * W + (x + x0), o = (y * sw + x) * 4, oa = ((y + sh) * sw + x) * 4;
        const a = id[i] === k ? alpha[i] : 0;
        for (let ch = 0; ch < 3; ch++) {
          // only this cloud's own pixels: where another cloud's sprite overlaps, it contributes nothing here
          // only this cloud's own pixels: where another cloud's sprite overlaps, it contributes nothing here
          const premul = id[i] === k ? src[i * 4 + ch] / 255 - (1 - a) * landTone[i * 3 + ch] : 0;
          im.data[o + ch] = Math.round(Math.min(1, Math.max(0, premul)) * 255);
          im.data[oa + ch] = Math.round(a * 255);
        }
        im.data[o + 3] = 255;
        im.data[oa + 3] = 255;
      }
      const sc = new OffscreenCanvas(sw, sh * 2);
      sc.getContext('2d').putImageData(im, 0, 0);
      // 5. the shadow: the cloud's silhouette, softened and flattened, centred where it falls on the ground
      const shW = sw, shH = Math.round(sh * c.shadow.squash);
      const shc = new OffscreenCanvas(shW + 2 * PAD, shH + 2 * PAD);
      const sg = shc.getContext('2d');
      sg.filter = 'blur(16px)';
      const solid = new OffscreenCanvas(sw, sh);
      const sd = new ImageData(sw, sh);
      for (let q = 0; q < sw * sh; q++) { const a = im.data[(q + sw * sh) * 4] / 255; const v = Math.round(smooth(0.05, 0.5, a) * 255); sd.data[q * 4] = sd.data[q * 4 + 1] = sd.data[q * 4 + 2] = v; sd.data[q * 4 + 3] = 255; }
      solid.getContext('2d').putImageData(sd, 0, 0);
      sg.fillStyle = '#000';
      sg.fillRect(0, 0, shc.width, shc.height);
      sg.drawImage(solid, PAD, PAD, shW, shH);
      sprites.push({
        cloud: { canvas: sc, x: x0, y: y0, w: sw, h: sh },
        shadow: { canvas: shc, x: x0 + c.shadow.dx - PAD, y: y0 + c.shadow.dy + (sh - shH) / 2 - PAD, w: shc.width, h: shc.height, depth: c.shadow.depth },
      });
    });
    // 6. write everything
    const landIm = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) { for (let c = 0; c < 3; c++) landIm.data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, land[i * 3 + c])) * 255); landIm.data[i * 4 + 3] = 255; }
    const lc = new OffscreenCanvas(W, H);
    lc.getContext('2d').putImageData(landIm, 0, 0);
    const b64 = async (canvas, type = 'image/png', quality) => { const buf = new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return btoa(s); };
    // debug: the land, with each cloud's matte outline in white and each shadow's in red
    const dbg = new OffscreenCanvas(W, H);
    const dg = dbg.getContext('2d');
    dg.drawImage(lc, 0, 0);
    for (const s of sprites) {
      dg.globalAlpha = 0.5;
      dg.drawImage(s.cloud.canvas, 0, 0, s.cloud.w, s.cloud.h, s.cloud.x, s.cloud.y, s.cloud.w, s.cloud.h);
      dg.globalAlpha = 0.45;
      dg.globalCompositeOperation = 'screen';
      const red = new OffscreenCanvas(s.shadow.w, s.shadow.h);
      const rg = red.getContext('2d');
      rg.drawImage(s.shadow.canvas, 0, 0);
      rg.globalCompositeOperation = 'multiply';
      rg.fillStyle = '#ff2a2a';
      rg.fillRect(0, 0, s.shadow.w, s.shadow.h);
      dg.drawImage(red, s.shadow.x, s.shadow.y);
      dg.globalCompositeOperation = 'source-over';
      dg.globalAlpha = 1;
    }
    return {
      land: await b64(lc, 'image/webp', 0.95),
      landPng: await b64(lc),
      debug: await b64(dbg),
      sprites: await Promise.all(sprites.map(async (s) => ({ cloud: await b64(s.cloud.canvas), shadow: await b64(s.shadow.canvas), meta: { cloud: { x: s.cloud.x, y: s.cloud.y, w: s.cloud.w, h: s.cloud.h }, shadow: { x: s.shadow.x, y: s.shadow.y, w: s.shadow.w, h: s.shadow.h, depth: s.shadow.depth } } }))),
    };
  },
  { dataUrl, CLOUDS, PAD },
);
await b.close();
writeFileSync('public/living/land.webp', Buffer.from(out.land, 'base64'));
writeFileSync('artifacts/living-land.png', Buffer.from(out.landPng, 'base64'));
writeFileSync('artifacts/living-layers-debug.png', Buffer.from(out.debug, 'base64'));
out.sprites.forEach((s, k) => {
  writeFileSync(`public/living/cloud-${k}.png`, Buffer.from(s.cloud, 'base64'));
  writeFileSync(`public/living/shadow-${k}.png`, Buffer.from(s.shadow, 'base64'));
});
writeFileSync('public/living/layers.json', JSON.stringify({ plate: { width: 1672, height: 941 }, clouds: out.sprites.map((s) => s.meta) }, null, 2));
console.log(JSON.stringify(out.sprites.map((s) => s.meta)));
