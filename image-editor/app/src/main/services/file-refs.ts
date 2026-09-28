import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { FileRef } from '@shared/schemas';

/** Maps opaque FileRef ids to paths the user chose (dialog, drop, CLI). Directories are rejected. */
export class FileRefRegistry {
  private readonly paths = new Map<string, string>();

  register(path: string): FileRef {
    const absolute = resolve(path);
    if (!statSync(absolute).isFile()) throw new Error('Not a file');
    const id = randomUUID();
    this.paths.set(id, absolute);
    return { id, displayName: basename(absolute), displayDir: dirname(absolute) };
  }

  resolve(ref: Pick<FileRef, 'id'>): string | undefined {
    return this.paths.get(ref.id);
  }
}
