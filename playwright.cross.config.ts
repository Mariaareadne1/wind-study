import { defineConfig, devices } from '@playwright/test';

/** Smoke test in other engines: npx playwright test -c playwright.cross.config.ts */
export default defineConfig({
  testDir: 'tests/cross',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/cross',
  use: { baseURL: 'http://localhost:5428', viewport: { width: 1200, height: 750 } },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1200, height: 750 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1200, height: 750 } } },
  ],
  webServer: { command: 'npm run dev', port: 5428, reuseExistingServer: true, timeout: 180_000 },
});
