import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { CROSS_ORIGIN_ISOLATION_HEADERS } from '@shared/constants';
import { CONTENT_SECURITY_POLICY } from './policy';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/**
 * Resolves an app:// URL to a file under `root`, or null if it would escape it (docs/06 §4).
 * `app://editor/` and `app://editor/index.html` both serve the page.
 */
export function resolveAppPath(url: string, root: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const relative = normalize(pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (relative.startsWith('..') || relative.split(sep).includes('..')) return null;
  const full = join(root, relative);
  return full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}

/** Serves the renderer build with isolation + CSP headers. */
export async function serveAppRequest(url: string, root: string): Promise<Response> {
  const path = resolveAppPath(url, root);
  if (!path) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(path);
    return new Response(body, {
      headers: {
        'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
        // Every resource must opt in to being embedded under COEP require-corp.
        'Cross-Origin-Resource-Policy': 'same-origin',
        ...CROSS_ORIGIN_ISOLATION_HEADERS,
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
