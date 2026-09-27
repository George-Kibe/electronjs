import { defineConfig } from '@playwright/test';

/**
 * Electron end-to-end tests (docs/07). E2E_TARGET=dev (default) runs the built app from out/ with the
 * npm electron binary; E2E_TARGET=packaged runs the electron-builder --dir output, which also proves the
 * bundled 7-Zip is resolved from resources/ like in a real install.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0, // flaky tests are bugs (docs/07 §6)
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
