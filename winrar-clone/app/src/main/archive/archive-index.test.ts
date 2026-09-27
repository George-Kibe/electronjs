import { describe, expect, it } from 'vitest';
import type { ArchiveListing } from '../engine/engine';
import type { ParsedEntry } from '../engine/parsers/list';
import { ArchiveIndex, normalizeArchivePath } from './archive-index';

function entry(path: string, extra: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    path,
    isDir: false,
    size: 10,
    packed: 5,
    modified: '2026-01-01 00:00:00',
    crc: null,
    encrypted: false,
    method: null,
    attributes: null,
    link: null,
    raw: {},
    ...extra,
  };
}

function listing(entries: ParsedEntry[], props: Record<string, string> = { Type: 'zip' }): ArchiveListing {
  return { archivePath: '/a.zip', encryptedHeaders: false, props, warnings: [], entries };
}

const sort = { key: 'name', dir: 'asc' } as const;

describe('ArchiveIndex', () => {
  it('synthesises missing parent folders and lists one folder at a time', () => {
    const index = new ArchiveIndex(listing([entry('a/b/c.txt'), entry('z.txt'), entry('a/y.txt')]));
    expect(index.list({ folder: '', sort, offset: 0, limit: 100 }).entries.map((e) => e.path)).toEqual([
      'a',
      'z.txt',
    ]);
    expect(index.list({ folder: 'a', sort, offset: 0, limit: 100 }).entries.map((e) => e.path)).toEqual([
      'a/b',
      'a/y.txt',
    ]);
    expect(index.hasFolder('a/b')).toBe(true);
    expect(index.hasFolder('nope')).toBe(false);
    expect(index.info.totals).toEqual({ files: 3, folders: 2, size: 30, packed: 15 });
  });

  it('sorts folders first, naturally, and pages results', () => {
    const index = new ArchiveIndex(
      listing([
        entry('file10.txt', { size: 1 }),
        entry('file2.txt', { size: 3 }),
        entry('dir', { isDir: true, size: 0 }),
      ]),
    );
    const names = (key: 'name' | 'size', dir: 'asc' | 'desc') =>
      index.list({ folder: '', sort: { key, dir }, offset: 0, limit: 10 }).entries.map((e) => e.name);
    expect(names('name', 'asc')).toEqual(['dir', 'file2.txt', 'file10.txt']);
    expect(names('size', 'desc')).toEqual(['dir', 'file2.txt', 'file10.txt']);
    expect(names('size', 'asc')).toEqual(['dir', 'file10.txt', 'file2.txt']);
    const page = index.list({ folder: '', sort, offset: 1, limit: 1 });
    expect(page).toMatchObject({ total: 3, entries: [{ name: 'file2.txt' }] });
  });

  it('filters case-insensitively within the folder', () => {
    const index = new ArchiveIndex(listing([entry('Report.PDF'), entry('photo.jpg')]));
    expect(
      index.list({ folder: '', sort, offset: 0, limit: 10, filter: 'pdf' }).entries.map((e) => e.name),
    ).toEqual(['Report.PDF']);
  });

  it('derives archive info from 7-Zip properties', () => {
    const index = new ArchiveIndex(
      listing([entry('x', { encrypted: true })], {
        Type: 'Rar5',
        Solid: '+',
        Multivolume: '+',
        Volumes: '4',
        'Total Physical Size': '43216',
        'Physical Size': '13312',
        Method: 'v6:1M:m5',
      }),
    );
    expect(index.info).toMatchObject({
      format: 'Rar5',
      solid: true,
      multivolume: true,
      volumes: 4,
      physicalSize: 43216,
      hasEncryptedEntries: true,
      method: 'v6:1M:m5',
    });
  });

  it('normalises archive paths', () => {
    expect(normalizeArchivePath('./a//b\\c/')).toBe('a/b/c');
    expect(normalizeArchivePath('/abs/x')).toBe('abs/x');
  });
});
