import { defineConfig } from '@playwright/test';

/** Electron E2E (docs/07 §4). E2E_TARGET=packaged runs the electron-builder --dir output. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
