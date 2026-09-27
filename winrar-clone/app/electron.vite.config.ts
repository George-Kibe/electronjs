import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { contentSecurityPolicy } from './src/main/security/policy';

/** Swap the strict CSP <meta> for the dev variant (inline React refresh preamble + HMR websocket). */
function devCsp(): Plugin {
  return {
    name: 'winrar-clone:dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(
        /(http-equiv="Content-Security-Policy"\s+content=")[^"]*/,
        `$1${contentSecurityPolicy(true)}`,
      ),
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), tailwindcss(), devCsp()],
    build: { minify: true },
  },
});
