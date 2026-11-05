import { test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { WindSim } from '../../src/wind/WindSim';
test('bench', () => {
  const out: string[] = [];
  const s = new WindSim(1);
  const g = s.begin(1);
  for (let i = 0; i < 300; i++) g.addPoint(-20 + i * 0.13, Math.sin(i * 0.05) * 5, 1 / 60);
  let t = performance.now();
  for (let i = 0; i < 300; i++) s.step();
  out.push('all ' + (performance.now() - t) / 300); t = performance.now();
  for (let i = 0; i < 300; i++) s.field.step(1 / 60);
  out.push('field ' + (performance.now() - t) / 300); t = performance.now();
  for (let i = 0; i < 300; i++) s.ambient.update(i);
  out.push('ambient ' + (performance.now() - t) / 300); t = performance.now();
  for (let i = 0; i < 300; i++) s.response.step(s.totalU, s.totalV, 1 / 60);
  out.push('resp ' + (performance.now() - t) / 300);
  writeFileSync(process.env.BENCH_OUT ?? '/dev/null', out.join('\n'));
});
