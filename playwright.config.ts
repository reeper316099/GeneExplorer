// Playwright drives the real Electron app (no browser download needed). Network is served from fixtures via test mode.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
