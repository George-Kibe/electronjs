import type { App, IpcMainInvokeEvent, Session } from 'electron';

/**
 * Content Security Policy (docs/06 §3). The renderer loads no remote content and makes no network requests.
 * Dev mode relaxes script/connect for the Vite dev server + HMR only.
 */
export function contentSecurityPolicy(dev: boolean): string {
  const devScript = dev ? " 'unsafe-inline'" : '';
  const devConnect = dev ? ' ws://localhost:* http://localhost:*' : '';
  return [
    "default-src 'none'",
    `script-src 'self'${devScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${dev ? "'self'" + devConnect : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Only our own renderer document may call IPC. */
export function makeSenderCheck(allowedUrl: () => string): (event: IpcMainInvokeEvent) => boolean {
  return (event) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null) return false; // main frame only
    return isAllowedUrl(frame.url, allowedUrl());
  };
}

export function isAllowedUrl(url: string, allowed: string): boolean {
  try {
    const actual = new URL(url);
    const expected = new URL(allowed);
    if (expected.protocol === 'file:')
      return actual.protocol === 'file:' && actual.pathname === expected.pathname;
    return actual.origin === expected.origin;
  } catch {
    return false;
  }
}

export function applySessionPolicy(session: Session, dev: boolean): void {
  const csp = contentSecurityPolicy(dev);
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  // No permissions are needed in M0/M1 (no camera, mic, notifications from web content, etc.).
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

/** Block navigation, new windows and <webview> for every web contents the app creates. */
export function applyNavigationPolicy(app: App): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
