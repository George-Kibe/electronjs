import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type { FileRef } from '@shared/schemas';

type Entry = { path: string; writable: boolean };

/**
 * Maps opaque FileRef ids to paths the user chose (dialog, drop, CLI). Directories are rejected.
 * A ref is writable only if it came from a save dialog, or names a project the user opened (so "Save"
 * can overwrite it). A compromised renderer therefore cannot write to any other path (docs/06 §4).
 */
export class FileRefRegistry {
  private readonly entries = new Map<string, Entry>();

  /** An existing file the user opened. Opened projects (.iep) may be saved over. */
  register(path: string): FileRef {
    const absolute = resolve(path);
    if (!statSync(absolute).isFile()) throw new Error('Not a file');
    return this.add(absolute, extname(absolute).toLowerCase() === '.iep');
  }

  /** A destination the user picked in a save dialog. The file may not exist yet; its folder must. */
  registerSaveTarget(path: string): FileRef {
    const absolute = resolve(path);
    if (!statSync(dirname(absolute)).isDirectory()) throw new Error('No such folder');
    try {
      if (!statSync(absolute).isFile()) throw new Error('Not a file');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return this.add(absolute, true);
  }

  resolve(ref: Pick<FileRef, 'id'>): string | undefined {
    return this.entries.get(ref.id)?.path;
  }

  resolveWritable(ref: Pick<FileRef, 'id'>): string | undefined {
    const entry = this.entries.get(ref.id);
    return entry?.writable ? entry.path : undefined;
  }

  private add(path: string, writable: boolean): FileRef {
    const id = randomUUID();
    this.entries.set(id, { path, writable });
    return { id, displayName: basename(path), displayDir: dirname(path) };
  }
}
