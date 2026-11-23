import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') };
// Use a preinstalled Chromium when present (e.g. sandboxed dev containers); CI runs `playwright install`.
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          // Coverage instrumentation (the CI check runs it) slows the large-image tests several times over.
          testTimeout: 30_000,
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.gpu.test.ts', 'src/**/*.browser.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          // Golden images (docs/07 §2): `pnpm test:golden --update` rewrites the baselines after a reviewed change.
          name: 'golden',
          environment: 'node',
          testTimeout: 60_000,
          include: ['test/golden/**/*.test.ts'],
          env: { GOLDEN_UPDATE: process.argv.includes('--update') || process.argv.includes('-u') ? '1' : '' },
        },
      },
      {
        resolve: { alias },
        // Pre-bundled, so a cold cache does not reload the page mid-run (the scratch worker imports it).
        optimizeDeps: { include: ['fflate'] },
        test: {
          // Headless Chromium: WebGL2 conformance, and browser APIs such as OPFS (`*.browser.test.ts`).
          name: 'gpu',
          include: ['src/**/*.gpu.test.ts', 'src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/renderer/src/engine/**/*.ts',
        'src/main/**/*.ts',
        'src/codec-host/**/*.ts',
        'src/shared/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/main/index.ts',
        'src/codec-host/index.ts',
        'src/renderer/src/engine/gpu/**',
      ],
      thresholds: {
        'src/renderer/src/engine/tiles/**': { lines: 90 },
        'src/renderer/src/engine/history/**': { lines: 90 },
        'src/renderer/src/engine/doc/**': { lines: 90 },
      },
    },
  },
});
