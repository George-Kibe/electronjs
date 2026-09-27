import type { ArchiveInfo, EntryDTO, ListRequest, ListResult } from '@shared/schemas';
import type { ArchiveListing } from '../engine/engine';
import type { ParsedEntry } from '../engine/parsers/list';

/**
 * In-memory index of an opened archive (docs/05 §2): flat entries plus a folder → children map, so the
 * renderer can page through one folder at a time (FR-BRW-03, FR-BRW-09).
 */
export class ArchiveIndex {
  private readonly children = new Map<string, EntryDTO[]>();
  readonly info: ArchiveInfo;

  constructor(listing: ArchiveListing) {
    const byPath = new Map<string, EntryDTO>();
    for (const entry of listing.entries) {
      const path = normalizeArchivePath(entry.path);
      if (path === '') continue;
      byPath.set(path, toDTO(entry, path));
    }
    // Archives often omit explicit folder entries; synthesise them so the tree is navigable.
    for (const path of [...byPath.keys()]) {
      let parent = parentOf(path);
      while (parent !== '' && !byPath.has(parent)) {
        byPath.set(parent, syntheticFolder(parent));
        parent = parentOf(parent);
      }
    }
    for (const dto of byPath.values()) {
      const parent = parentOf(dto.path);
      let list = this.children.get(parent);
      if (!list) this.children.set(parent, (list = []));
      list.push(dto);
    }

    let files = 0;
    let folders = 0;
    let size = 0;
    let packed = 0;
    let hasEncryptedEntries = false;
    for (const dto of byPath.values()) {
      if (dto.isDir) folders++;
      else files++;
      size += dto.size;
      packed += dto.packed ?? 0;
      hasEncryptedEntries ||= dto.encrypted;
    }

    const props = listing.props;
    const volumes = Number(props['Volumes'] ?? '1');
    this.info = {
      format: props['Type'] ?? 'Unknown',
      physicalSize: numberOrNull(props['Total Physical Size'] ?? props['Physical Size']),
      solid: props['Solid'] === undefined ? null : props['Solid'] === '+',
      multivolume: props['Multivolume'] === '+',
      volumes: Number.isInteger(volumes) && volumes > 0 ? volumes : 1,
      encryptedHeaders: listing.encryptedHeaders,
      hasEncryptedEntries,
      method: props['Method'] || null,
      comment: props['Comment'] || null,
      warnings: listing.warnings,
      totals: { files, folders, size, packed },
    };
  }

  hasFolder(folder: string): boolean {
    return folder === '' || this.children.has(folder);
  }

  list(req: Omit<ListRequest, 'sessionId'>): ListResult {
    const folder = normalizeArchivePath(req.folder);
    let items = this.children.get(folder) ?? [];
    const filter = req.filter?.trim().toLocaleLowerCase();
    if (filter) items = items.filter((e) => e.name.toLocaleLowerCase().includes(filter));
    const sorted = [...items].sort(comparator(req.sort));
    return { total: sorted.length, entries: sorted.slice(req.offset, req.offset + req.limit) };
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function comparator(sort: ListRequest['sort']): (a: EntryDTO, b: EntryDTO) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // folders first regardless of direction
    let cmp: number;
    switch (sort.key) {
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'packed':
        cmp = (a.packed ?? 0) - (b.packed ?? 0);
        break;
      case 'modified':
        cmp = (a.modified ?? '').localeCompare(b.modified ?? '');
        break;
      default:
        cmp = 0;
    }
    return sign * (cmp || collator.compare(a.name, b.name));
  };
}

/** Normalises an archive-internal path for display/navigation: '/' separators, no leading './' or '/'. */
export function normalizeArchivePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/');
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function toDTO(entry: ParsedEntry, path: string): EntryDTO {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    isDir: entry.isDir,
    size: entry.size,
    packed: entry.packed,
    modified: entry.modified,
    crc: entry.crc,
    encrypted: entry.encrypted,
    method: entry.method,
    link: entry.link,
  };
}

function syntheticFolder(path: string): EntryDTO {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    isDir: true,
    size: 0,
    packed: null,
    modified: null,
    crc: null,
    encrypted: false,
    method: null,
    link: null,
  };
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
