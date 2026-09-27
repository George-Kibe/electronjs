import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, isAllowedUrl, makeSenderCheck } from './policy';
import { secureWebPreferences } from './web-preferences';

describe('Electron hardening baseline (docs/06 §3)', () => {
  it('uses the mandatory webPreferences', () => {
    expect(secureWebPreferences('/p.cjs')).toMatchObject({
      preload: '/p.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });

  it('ships a strict production CSP in index.html, identical to the policy builder', () => {
    const html = readFileSync(join(import.meta.dirname, '../../renderer/index.html'), 'utf8');
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
    expect(meta).toBe(contentSecurityPolicy(false));
    expect(meta).toContain("connect-src 'none'");
    expect(meta).not.toContain('unsafe-eval');
    expect(meta).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('only relaxes the CSP in dev', () => {
    expect(contentSecurityPolicy(true)).toContain('ws://localhost:*');
    expect(contentSecurityPolicy(false)).not.toContain('localhost');
  });
});

describe('IPC sender check', () => {
  const event = (url: string, parent: unknown = null) =>
    ({ senderFrame: { url, parent } }) as unknown as IpcMainInvokeEvent;

  it('accepts only the app document', () => {
    expect(isAllowedUrl('file:///app/out/renderer/index.html', 'file:///app/out/renderer/index.html')).toBe(
      true,
    );
    expect(isAllowedUrl('file:///tmp/evil.html', 'file:///app/out/renderer/index.html')).toBe(false);
    expect(isAllowedUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isAllowedUrl('https://evil.example', 'http://localhost:5173')).toBe(false);
    expect(isAllowedUrl('not a url', 'http://localhost:5173')).toBe(false);
  });

  it('rejects sub-frames and missing frames', () => {
    const check = makeSenderCheck(() => 'file:///app/index.html');
    expect(check(event('file:///app/index.html'))).toBe(true);
    expect(check(event('file:///app/index.html', {}))).toBe(false);
    expect(check({ senderFrame: null } as unknown as IpcMainInvokeEvent)).toBe(false);
  });
});
