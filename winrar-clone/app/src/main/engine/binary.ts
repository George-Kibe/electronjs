import { join } from 'node:path';

export type BinaryLocation = {
  isPackaged: boolean;
  /** Project root in development (contains vendor/). */
  appRoot: string;
  /** process.resourcesPath in a packaged app. */
  resourcesPath: string;
  platform: NodeJS.Platform;
  arch: string;
};

/**
 * Location of the bundled 7-Zip binary (docs/04 §2.1). Packaged apps ship it via electron-builder
 * `extraResources` (vendor/7zip/${platform}-${arch} → resources/7zip). We never fall back to a 7-Zip on PATH:
 * its version and RAR support are unknown.
 */
export function sevenZipPath(loc: BinaryLocation): string {
  const exe = loc.platform === 'win32' ? '7z.exe' : '7zz';
  const dir = loc.isPackaged
    ? join(loc.resourcesPath, '7zip')
    : join(loc.appRoot, 'vendor', '7zip', `${loc.platform}-${loc.arch}`);
  return join(dir, exe);
}
