import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sevenZipPath } from '../../src/main/engine/binary';
import { run7z } from '../../src/main/engine/spawn';

export const appRoot = resolve(import.meta.dirname, '../..');
export const rarFixtures = join(appRoot, 'test/fixtures/rar');

export const binary = sevenZipPath({
  isPackaged: false,
  appRoot,
  resourcesPath: '',
  platform: process.platform,
  arch: process.arch,
});

/** Integration tests need the bundled 7-Zip (fetched on `pnpm install`). */
export const hasBinary = existsSync(binary);
if (!hasBinary && process.env.CI) throw new Error(`Bundled 7-Zip missing at ${binary}; run pnpm fetch-7zip`);

export function tempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'wrc-test-'));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

/** Creates an archive with the bundled 7-Zip (test setup only; passwords on argv are fine here). */
export async function createArchive(archive: string, cwd: string, extraArgs: string[] = []): Promise<void> {
  const result = await run7z({
    binary,
    cwd,
    args: ['a', '-bso0', '-bsp0', ...extraArgs, '--', archive, '.'],
  });
  if (result.exitCode !== 0) throw new Error(`7z a failed: ${result.stderrTail}`);
}
