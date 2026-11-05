// Prints a coarse ASCII map of grass bend after a pattern: node scripts/fieldmap.mjs pattern steps
import { chromium } from '@playwright/test';
const [pat = 'sweep', steps = '70'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(`${process.env.URL ?? 'http://localhost:5428/'}?manual&fixed&tufts=2000`);
await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
const out = await page.evaluate(({ pat, steps }) => {
  const w = window.__wind; w.app.stepFrames(60); w.app.play(pat); w.app.stepFrames(+steps);
  const s = w.app.sim; let txt = '';
  for (let z = -18; z <= 14; z += 2.4) { for (let x = -30; x <= 30; x += 2.2) { const q = s.bendAt(x, z); txt += ' .:-=+*#%@'[Math.min(9, Math.floor(Math.hypot(q[0], q[1]) * 7))]; } txt += '\n'; }
  return txt;
}, { pat, steps });
console.log(out);
await b.close();
