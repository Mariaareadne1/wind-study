// Grass feasibility captures: node scripts/grass-shot.mjs prefix candidate wind [t ...]
// Renders ?scene=grass-feasibility deterministically at 1672 × 941, DPR 1, at each scene time t (seconds).
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [prefix = 'artifacts/grass/a', candidate = 'a', wind = 'breeze', ...times] = process.argv.slice(2);
const W = +(process.env.W ?? 1672), H = +(process.env.H ?? 941);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 300)));
await p.goto(`${process.env.URL ?? 'http://localhost:5428/'}?scene=grass-feasibility&compare&candidate=${candidate}&wind=${wind}&dpr=${process.env.DPR ?? 1}`);
await p.waitForFunction(() => window.__grass, null, { timeout: 60000 });
for (const t of times.length ? times : ['4']) {
  const d = await p.evaluate((t) => { window.__grass.render(+t); return window.__grass.canvas.toDataURL('image/png'); }, t);
  writeFileSync(`${prefix}-t${t}.png`, Buffer.from(d.split(',')[1], 'base64'));
}
const info = await p.evaluate(() => window.__grass.info());
console.log(JSON.stringify({ errs: errs.slice(0, 4), info: { candidate: info.candidate, blades: info.blades, calls: info.calls, triangles: info.triangles } }));
await b.close();
