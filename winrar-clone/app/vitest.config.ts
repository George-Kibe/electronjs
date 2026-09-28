import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main/index.ts'],
      thresholds: {
        'src/main/engine/parsers/**': { lines: 90 },
        'src/main/engine/args.ts': { lines: 90 },
      },
    },
  },
});
