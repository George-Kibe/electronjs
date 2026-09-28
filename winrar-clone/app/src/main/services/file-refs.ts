import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { FileRef } from '@shared/schemas';

/**
 * Maps opaque FileRef ids to absolute paths the user chose (dialog, drop, CLI). The renderer only ever
 * gets refs + display strings, so a compromised renderer cannot name arbitrary paths (docs/04 §1.1).
 */
export class FileRefRegistry {
  private readonly paths = new Map<string, string>();

  register(path: string): FileRef {
    const absolute = resolve(path);
    const stats = statSync(absolute);
    const id = randomUUID();
    this.paths.set(id, absolute);
    return {
      id,
      displayName: basename(absolute),
      displayDir: dirname(absolute),
      kind: stats.isDirectory() ? 'dir' : 'file',
    };
  }

  resolve(ref: Pick<FileRef, 'id'>): string | undefined {
    return this.paths.get(ref.id);
  }
}
