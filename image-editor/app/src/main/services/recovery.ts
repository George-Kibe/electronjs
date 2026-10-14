import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isPng } from './recent-files';

/**
 * Autosave recovery (FR-DOC-10, NFR-REL-01): `<userData>/recovery/<docId>.iep` with `<docId>.json` (name,
 * time) and `<docId>.png` (thumbnail). The renderer writes a snapshot every few minutes while a document
 * has unsaved changes and discards it when the document is saved, closed or replaced. Whatever is left at
 * the next launch was not closed cleanly, and the Welcome screen offers it back. Ids are UUIDs chosen by the
 * renderer; they are validated, so they can never name a path outside the folder. Main never parses the
 * project bytes (the file worker does).
 */

const Id = z.uuid();
const Meta = z.object({ id: Id, name: z.string().max(255), savedAt: z.number() });
type Meta = z.infer<typeof Meta>;

export type RecoveryItem = Meta & { thumbnail: Uint8Array | null };

export type RecoveryDeps = {
  dir: string;
  writeAtomic(path: string, data: Uint8Array): Promise<void>;
};

export class RecoveryStore {
  constructor(private readonly deps: RecoveryDeps) {
    mkdirSync(deps.dir, { recursive: true });
  }

  private path(id: string, ext: 'iep' | 'json' | 'png'): string {
    return join(this.deps.dir, `${Id.parse(id)}.${ext}`);
  }

  /** Writes the project first and the metadata last, so a listed entry always has its project. */
  async write(
    id: string,
    name: string,
    project: Uint8Array,
    thumbnail?: Uint8Array,
    now = Date.now(),
  ): Promise<void> {
    await this.deps.writeAtomic(this.path(id, 'iep'), project);
    if (thumbnail && isPng(thumbnail)) await this.deps.writeAtomic(this.path(id, 'png'), thumbnail);
    const meta: Meta = { id, name, savedAt: now };
    await this.deps.writeAtomic(this.path(id, 'json'), new TextEncoder().encode(JSON.stringify(meta)));
  }

  /** Recoverable documents, newest first. Damaged entries are skipped. */
  async list(): Promise<RecoveryItem[]> {
    const items: RecoveryItem[] = [];
    for (const file of readdirSync(this.deps.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const meta = Meta.parse(JSON.parse(readFileSync(join(this.deps.dir, file), 'utf8')));
        if (`${meta.id}.json` !== file) continue;
        const thumbnail = await readFile(this.path(meta.id, 'png')).then(
          (b) => new Uint8Array(b),
          () => null,
        );
        items.push({ ...meta, thumbnail });
      } catch {
        // half-written or foreign file: not offered
      }
    }
    return items.sort((a, b) => b.savedAt - a.savedAt);
  }

  async read(id: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(id, 'iep')));
  }

  /** Removes an entry (saved, closed cleanly, or the user chose Discard). Missing files are fine. */
  async discard(id: string): Promise<void> {
    // Metadata first: an interrupted discard never lists an entry whose project is gone.
    for (const ext of ['json', 'iep', 'png'] as const)
      await unlink(this.path(id, ext)).catch(() => undefined);
  }
}
