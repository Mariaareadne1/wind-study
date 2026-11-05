// Interface shots from the running app, plus a real MediaRecorder round trip.
import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';
const URL = process.env.URL ?? 'http://localhost:5428/';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const d = await b.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await d.goto(URL + '?fixed');
await d.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
await d.waitForTimeout(800);
await d.screenshot({ path: 'artifacts/ui-desktop.png' });
await d.getByRole('button', { name: 'Help' }).click();
await d.waitForTimeout(100);
await d.screenshot({ path: 'artifacts/ui-help.png' });
await d.keyboard.press('Escape');
// a live drag at real speed, with a real recording running
await d.getByRole('button', { name: 'Record' }).click();
await d.mouse.move(300, 500); await d.mouse.down();
for (let i = 0; i < 50; i++) { await d.mouse.move(300 + i * 16, 500 - Math.sin(i * 0.12) * 120); await d.waitForTimeout(12); }
await d.mouse.up();
await d.waitForTimeout(1500);
const [dl] = await Promise.all([d.waitForEvent('download'), d.getByRole('button', { name: 'Stop recording' }).click()]);
const file = `artifacts/${dl.suggestedFilename()}`; await dl.saveAs(file);
console.log(file, execFileSync(ffprobe.path, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'csv=p=0', file]).toString().trim().replace(/\n/g, ' | '));
const m = await b.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
const mp = await m.newPage();
await mp.goto(URL + '?fixed');
await mp.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90000 });
await mp.evaluate(() => window.__wind.app.play('sweep'));
await mp.waitForTimeout(1200);
await mp.screenshot({ path: 'artifacts/ui-mobile.png' });
console.log('mobile strands', await mp.evaluate(() => window.__wind.app.grass.drawn));
await b.close();
