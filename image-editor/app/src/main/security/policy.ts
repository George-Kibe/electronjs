import type { App, IpcMainInvokeEvent, Session } from 'electron';

/**
 * Production CSP for app:// (docs/06 §4). 'wasm-unsafe-eval' is required by onnxruntime-web (M4);
 * blob: workers by bundled worker patterns. The renderer makes no network requests.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Permissions the renderer may use (docs/06 §4). Everything else is denied. */
export const ALLOWED_PERMISSIONS = new Set(['local-fonts', 'clipboard-read', 'clipboard-sanitized-write']);

/**
 * True if `url` belongs to the same scheme + host + port as `allowed`. Compares the parts explicitly:
 * Node's URL reports origin "null" for custom schemes (app://) and for file://, so an origin comparison
 * would let any file:// page through.
 */
export function isAllowedUrl(url: string, allowed: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(allowed);
    return a.protocol === b.protocol && a.host === b.host && a.port === b.port && a.host !== '';
  } catch {
    return false;
  }
}

export function makeSenderCheck(allowedOrigin: () => string): (event: IpcMainInvokeEvent) => boolean {
  return (event) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null) return false;
    return isAllowedUrl(frame.url, allowedOrigin());
  };
}

export function applySessionPolicy(session: Session): void {
  session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

export function applyNavigationPolicy(app: App): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
