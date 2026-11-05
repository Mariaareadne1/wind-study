import type { Page } from '@playwright/test';

export async function open(page: Page, query = 'manual&fixed&tufts=30000'): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__wind && !window.__wind.store.get().loading, null, { timeout: 90_000 });
}

/** Mean absolute per-channel difference between two frames, per region, from real pixels. */
export interface FrameStats {
  meanA: number;
  meanB: number;
}

declare global {
  interface Window {
    __frames?: Record<string, Uint8ClampedArray>;
  }
}

/** Steps the sim deterministically, then stores the rendered frame under `key`. */
export async function snap(page: Page, key: string, steps = 0): Promise<void> {
  await page.evaluate(
    ({ key, steps }) =>
      new Promise<void>((resolve) => {
        const w = window.__wind!;
        w.app.stepFrames(steps);
        w.app.onceAfterFrame(() => {
          const c = document.createElement('canvas');
          c.width = w.app.canvas.width;
          c.height = w.app.canvas.height;
          const g = c.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(w.app.canvas, 0, 0);
          window.__frames = window.__frames ?? {};
          window.__frames[key] = g.getImageData(0, 0, c.width, c.height).data;
          resolve();
        });
      }),
    { key, steps },
  );
}

/** Mean per-pixel difference between two stored frames inside a rectangle given as fractions of the frame. */
export function frameDiff(page: Page, a: string, b: string, rect = [0, 0, 1, 1]): Promise<number> {
  return page.evaluate(
    ({ a, b, rect }) => {
      const w = window.__wind!;
      const W = w.app.canvas.width;
      const H = w.app.canvas.height;
      const A = window.__frames![a];
      const B = window.__frames![b];
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(rect[1] * H); y < Math.floor(rect[3] * H); y += 2) {
        for (let x = Math.floor(rect[0] * W); x < Math.floor(rect[2] * W); x += 2) {
          const i = (x + y * W) * 4;
          sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
          n += 3;
        }
      }
      return sum / n;
    },
    { a, b, rect },
  );
}

export const bendAt = (page: Page, x: number, z: number): Promise<[number, number]> =>
  page.evaluate(([x, z]) => window.__wind!.app.sim.bendAt(x, z), [x, z]);
