import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { CROSS_ORIGIN_ISOLATION_HEADERS } from './src/shared/constants';

const alias = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        // The codec host runs in its own utilityProcess (docs/02 §2, ADR-0008).
        input: { index: resolve('src/main/index.ts'), 'codec-host': resolve('src/codec-host/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    // Same cross-origin isolation as the app:// protocol in production (SharedArrayBuffer, OPFS).
    server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
    worker: { format: 'es' },
    build: { minify: true },
  },
});
