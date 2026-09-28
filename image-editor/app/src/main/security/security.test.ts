import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveAppPath, serveAppRequest } from './app-protocol';
import { ALLOWED_PERMISSIONS, CONTENT_SECURITY_POLICY, isAllowedUrl } from './policy';
import { secureWebPreferences } from './web-preferences';

const root = mkdtempSync(join(tmpdir(), 'ie-app-'));
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'index.html'), '<!doctype html>');
writeFileSync(join(root, 'assets', 'a.js'), 'export {}');
writeFileSync(join(tmpdir(), 'ie-secret.txt'), 'secret');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('app:// protocol (docs/06 §4)', () => {
  it('serves files under the renderer root only', () => {
    expect(resolveAppPath('app://editor/', root)).toBe(join(root, 'index.html'));
    expect(resolveAppPath('app://editor/assets/a.js', root)).toBe(join(root, 'assets', 'a.js'));
    for (const evil of [
      'app://editor/../ie-secret.txt',
      'app://editor/%2e%2e/ie-secret.txt',
      'app://editor/assets/%2e%2e%2f%2e%2e%2fie-secret.txt',
      'app://editor/assets/..%5c..%5cie-secret.txt',
      'app://editor/%00',
      'app://editor/%E0%A4%A',
    ]) {
      const resolved = resolveAppPath(evil, root);
      expect(resolved === null || resolved.startsWith(root), evil).toBe(true);
    }
  });

  it('sets cross-origin isolation, CSP and nosniff headers', async () => {
    const res = await serveAppRequest('app://editor/index.html', root);
    expect(res.status).toBe(200);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await serveAppRequest('app://editor/nope.js', root)).status).toBe(404);
  });

  it('uses a strict CSP', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/'unsafe-eval'/);
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
});

describe('Electron baseline', () => {
  it('uses the mandatory webPreferences', () => {
    expect(secureWebPreferences('/p.cjs')).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('grants only the documented permissions', () => {
    expect([...ALLOWED_PERMISSIONS].sort()).toEqual([
      'clipboard-read',
      'clipboard-sanitized-write',
      'local-fonts',
    ]);
  });

  it('accepts IPC only from the app origin', () => {
    expect(isAllowedUrl('app://editor/index.html', 'app://editor')).toBe(true);
    expect(isAllowedUrl('file:///tmp/x.html', 'app://editor')).toBe(false);
    expect(isAllowedUrl('https://evil.example/', 'app://editor')).toBe(false);
    expect(isAllowedUrl('garbage', 'app://editor')).toBe(false);
    expect(isAllowedUrl('app://evil/index.html', 'app://editor')).toBe(false);
    expect(isAllowedUrl('data:text/html,hi', 'app://editor')).toBe(false);
    expect(isAllowedUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
  });
});
