import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Recent files (FR-DOC-02 "Open recent", FR-GEN-08), kept by main in userData: `recent.json` plus 256 px PNG
 * thumbnails in `thumbs/` (docs/05 §4). The renderer never sees paths: it gets ids, display names and
 * thumbnail bytes, and asks main to open an entry by id. Thumbnails come from the renderer's file worker;
 * main only checks they look like a small PNG before storing them (it never parses image content).
 */

export const MAX_RECENT = 20;
export const MAX_THUMB_BYTES = 512 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const Entry = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  path: z.string().min(1),
  openedAt: z.number(),
  hasThumb: z.boolean(),
});
type Entry = z.infer<typeof Entry>;
const File = z.object({ version: z.literal(1), entries: z.array(Entry).max(MAX_RECENT) });

export type RecentItem = {
  id: string;
  displayName: string;
  displayDir: string;
  openedAt: number;
  /** False when the file has been moved or deleted since. */
  exists: boolean;
  thumbnail: Uint8Array | null;
};

export const isPng = (b: Uint8Array) =>
  b.byteLength <= MAX_THUMB_BYTES && PNG_SIGNATURE.every((v, i) => b[i] === v);

/** Stable id for a path (thumbnail file name), not reversible to the path. */
const idOf = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 16);

export type RecentFilesDeps = {
  dir: string;
  writeAtomic(path: string, data: Uint8Array): Promise<void>;
  onWarning?(message: string, err?: unknown): void;
};

export class RecentFiles {
  private entries: Entry[];
  private readonly listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RecentFilesDeps) {
    mkdirSync(this.thumbDir, { recursive: true });
    this.entries = this.load();
  }

  private get file(): string {
    return join(this.deps.dir, 'recent.json');
  }

  private get thumbDir(): string {
    return join(this.deps.dir, 'thumbs');
  }

  private thumbPath(id: string): string {
    return join(this.thumbDir, `${id}.png`);
  }

  private load(): Entry[] {
    try {
      return File.parse(JSON.parse(readFileSync(this.file, 'utf8'))).entries;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        this.deps.onWarning?.('Recent files list was damaged; starting empty', err);
      return [];
    }
  }

  /** Runs file changes one at a time, then saves and notifies. */
  private commit(change: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      await change();
      const data = new TextEncoder().encode(JSON.stringify({ version: 1, entries: this.entries }));
      await this.deps.writeAtomic(this.file, data);
      for (const l of this.listeners) l();
    });
    return this.queue;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Newest first, for the menu (no thumbnails). */
  menuItems(): Array<{ id: string; label: string }> {
    return this.entries.map((e) => ({ id: e.id, label: basename(e.path) }));
  }

  async list(): Promise<RecentItem[]> {
    return Promise.all(
      this.entries.map(async (e) => ({
        id: e.id,
        displayName: basename(e.path),
        displayDir: dirname(e.path),
        openedAt: e.openedAt,
        exists: existsSync(e.path),
        thumbnail: e.hasThumb
          ? await readFile(this.thumbPath(e.id)).then(
              (b) => new Uint8Array(b),
              () => null,
            )
          : null,
      })),
    );
  }

  /** Records that `path` was opened or saved now; keeps the previous thumbnail if none is given. */
  add(path: string, thumbnail?: Uint8Array, now = Date.now()): Promise<void> {
    if (thumbnail && !isPng(thumbnail)) thumbnail = undefined;
    return this.commit(async () => {
      const id = idOf(path);
      const previous = this.entries.find((e) => e.id === id);
      if (thumbnail) await this.deps.writeAtomic(this.thumbPath(id), thumbnail);
      const entry: Entry = {
        id,
        path,
        openedAt: now,
        hasThumb: Boolean(thumbnail) || (previous?.hasThumb ?? false),
      };
      const others = this.entries.filter((e) => e.id !== id);
      this.entries = [entry, ...others].slice(0, MAX_RECENT);
      // Entries that fell off the end take their thumbnails with them.
      for (const e of others.slice(MAX_RECENT - 1)) await unlink(this.thumbPath(e.id)).catch(() => undefined);
    });
  }

  resolve(id: string): string | undefined {
    return this.entries.find((e) => e.id === id)?.path;
  }

  remove(id: string): Promise<void> {
    return this.commit(async () => {
      this.entries = this.entries.filter((e) => e.id !== id);
      await unlink(this.thumbPath(id)).catch(() => undefined);
    });
  }

  /** File › Open Recent › Clear Recent (docs/06: thumbnails are deleted too). */
  clear(): Promise<void> {
    return this.commit(async () => {
      const ids = this.entries.map((e) => e.id);
      this.entries = [];
      await Promise.all(ids.map((id) => unlink(this.thumbPath(id)).catch(() => undefined)));
    });
  }
}
