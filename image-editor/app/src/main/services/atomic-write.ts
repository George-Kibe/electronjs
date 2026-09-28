import { randomBytes } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writes a file so that it is either fully replaced or untouched (NFR-REL-01, ADR-0007): write a temp file
 * in the same folder, fsync it, then rename over the target. A crash mid-save never corrupts the original.
 */
export async function writeAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  const file = await open(tmp, 'wx');
  try {
    let written = 0;
    while (written < data.byteLength) {
      const { bytesWritten } = await file.write(data, written, data.byteLength - written);
      written += bytesWritten;
    }
    await file.sync();
  } catch (err) {
    await file.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await file.close();
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  // Persist the rename itself (POSIX). Windows cannot open directories; there the rename is already durable.
  if (process.platform !== 'win32') {
    const dir = await open(dirname(path), 'r').catch(() => null);
    await dir?.sync().catch(() => undefined);
    await dir?.close();
  }
}
