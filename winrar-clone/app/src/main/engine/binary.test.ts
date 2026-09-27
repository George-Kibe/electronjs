import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sevenZipPath } from './binary';

describe('sevenZipPath', () => {
  it('uses vendor/<platform>-<arch> in development', () => {
    expect(
      sevenZipPath({
        isPackaged: false,
        appRoot: '/src/app',
        resourcesPath: '',
        platform: 'linux',
        arch: 'arm64',
      }),
    ).toBe(join('/src/app', 'vendor', '7zip', 'linux-arm64', '7zz'));
  });

  it('uses resources/7zip when packaged, with 7z.exe on Windows', () => {
    expect(
      sevenZipPath({ isPackaged: true, appRoot: '', resourcesPath: '/res', platform: 'win32', arch: 'x64' }),
    ).toBe(join('/res', '7zip', '7z.exe'));
    expect(
      sevenZipPath({
        isPackaged: true,
        appRoot: '',
        resourcesPath: '/res',
        platform: 'darwin',
        arch: 'arm64',
      }),
    ).toBe(join('/res', '7zip', '7zz'));
  });
});
