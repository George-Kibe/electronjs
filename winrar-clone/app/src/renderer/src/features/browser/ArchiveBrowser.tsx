import { useEffect, useState } from 'react';
import type { ArchiveInfo, EntryDTO, FileRef, SortSpec } from '@shared/schemas';
import { Button } from '../../components/ui/Button';
import { api, errorMessage } from '../../lib/api';
import { formatBytes, formatModified, revealBidi } from '../../lib/format';

type Props = { sessionId: string; archive: FileRef; info: ArchiveInfo; onClose: () => void };

const PAGE = 500;
const COLUMNS: Array<{ key: SortSpec['key']; label: string; width: string; align?: 'right' }> = [
  { key: 'name', label: 'Name', width: '' },
  { key: 'size', label: 'Size', width: 'w-28', align: 'right' },
  { key: 'packed', label: 'Packed', width: 'w-28', align: 'right' },
  { key: 'modified', label: 'Modified', width: 'w-40' },
];

export function ArchiveBrowser({ sessionId, archive, info, onClose }: Props) {
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState<SortSpec>({ key: 'name', dir: 'asc' });
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<EntryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reload the first page whenever the view changes; ignore responses for a view we already left.
  useEffect(() => {
    let current = true;
    api.archive.list({ sessionId, folder, sort, filter, offset: 0, limit: PAGE }).then(
      (page) => {
        if (!current) return;
        setTotal(page.total);
        setEntries(page.entries);
        setError(null);
      },
      (err: unknown) => current && setError(errorMessage(err)),
    );
    return () => {
      current = false;
    };
  }, [sessionId, folder, sort, filter]);

  const loadMore = async () => {
    try {
      const page = await api.archive.list({
        sessionId,
        folder,
        sort,
        filter,
        offset: entries.length,
        limit: PAGE,
      });
      setTotal(page.total);
      setEntries((prev) => [...prev, ...page.entries]);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const crumbs = folder === '' ? [] : folder.split('/');
  const toggleSort = (key: SortSpec['key']) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="flex h-full flex-col">
      <header className="bg-panel border-border flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" onClick={onClose} aria-label="Close archive">
          ←
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold" title={`${archive.displayDir}/${archive.displayName}`}>
            {revealBidi(archive.displayName)}
          </h1>
          <p className="text-muted text-xs">
            {info.format}
            {info.solid ? ' · solid' : ''}
            {info.multivolume ? ` · ${info.volumes} volumes` : ''}
            {info.encryptedHeaders || info.hasEncryptedEntries ? ' · 🔒 encrypted' : ''}
            {info.method ? ` · ${info.method}` : ''}
          </p>
        </div>
        <input
          type="search"
          placeholder="Filter this folder"
          aria-label="Filter entries in this folder"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border-border bg-bg w-56 rounded-md border px-2 py-1"
        />
        {/* Extract/Test actions arrive in M1 (FR-EXT-02/03, FR-TST-01). */}
        <Button variant="primary" disabled title="Coming in the next milestone">
          Extract here
        </Button>
      </header>

      {info.warnings.length > 0 && (
        <div role="status" className="bg-raised border-border border-b px-4 py-1.5 text-xs">
          ⚠ {info.warnings.join(' · ')}
        </div>
      )}

      <nav
        aria-label="Folder path"
        className="text-muted flex flex-wrap items-center gap-1 px-4 py-2 text-xs"
      >
        <button className="hover:text-text underline-offset-2 hover:underline" onClick={() => setFolder('')}>
          {revealBidi(archive.displayName)}
        </button>
        {crumbs.map((segment, i) => (
          <span key={i} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <button
              className="hover:text-text underline-offset-2 hover:underline"
              onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}
            >
              {revealBidi(segment)}
            </button>
          </span>
        ))}
      </nav>

      <div className="flex-1 overflow-auto px-4">
        <table className="w-full table-fixed border-collapse" aria-rowcount={total}>
          <thead className="bg-bg sticky top-0">
            <tr className="border-border text-muted border-b text-left text-xs">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`py-1.5 pr-3 font-medium ${c.width} ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  <button onClick={() => toggleSort(c.key)} className="hover:text-text">
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {folder !== '' && (
              <tr className="hover:bg-raised cursor-default" onDoubleClick={() => setFolder(parent(folder))}>
                <td colSpan={COLUMNS.length} className="py-1">
                  <button onClick={() => setFolder(parent(folder))}>📁 ..</button>
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr
                key={e.path}
                className="hover:bg-raised border-border/50 cursor-default border-b"
                onDoubleClick={() => e.isDir && setFolder(e.path)}
              >
                <td className="truncate py-1 pr-3" title={e.path}>
                  {e.isDir ? (
                    <button onClick={() => setFolder(e.path)} className="text-left">
                      📁 {revealBidi(e.name)}
                    </button>
                  ) : (
                    <span>
                      {e.link ? '🔗' : '📄'} {revealBidi(e.name)}
                      {e.encrypted && <span aria-label="encrypted"> 🔒</span>}
                      {e.link && <span className="text-muted"> → {revealBidi(e.link.target)}</span>}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{e.isDir ? '' : formatBytes(e.size)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{e.isDir ? '' : formatBytes(e.packed)}</td>
                <td className="py-1 tabular-nums">{formatModified(e.modified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length < total && (
          <div className="py-3 text-center">
            <Button onClick={() => void loadMore()}>Load more ({total - entries.length} remaining)</Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger py-3">
            {error}
          </p>
        )}
      </div>

      <footer className="bg-panel border-border text-muted border-t px-4 py-1.5 text-xs">
        {info.totals.files.toLocaleString()} files · {info.totals.folders.toLocaleString()} folders ·{' '}
        {formatBytes(info.totals.size)} (packed {formatBytes(info.totals.packed)})
      </footer>
    </div>
  );
}

function parent(folder: string): string {
  const i = folder.lastIndexOf('/');
  return i === -1 ? '' : folder.slice(0, i);
}
