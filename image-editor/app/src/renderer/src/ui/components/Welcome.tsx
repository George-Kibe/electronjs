import { useEffect, useMemo, type ComponentProps } from 'react';
import { PRODUCT_NAME } from '@shared/constants';
import type { RecentItem } from '@shared/ipc-contract';
import { Button } from './Button';
import { NewDocumentForm } from './NewDocumentForm';

type Props = {
  onOpen: () => void;
  recent: RecentItem[];
  onOpenRecent: (id: string) => void;
  onRemoveRecent: (id: string) => void;
  onClearRecent: () => void;
  newDocument: Omit<ComponentProps<typeof NewDocumentForm>, 'children'>;
};

/** "3 minutes ago" style times for the recent list. */
function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (s < 60) return fmt.format(-s, 'second');
  if (s < 3600) return fmt.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return fmt.format(-Math.round(s / 3600), 'hour');
  return fmt.format(-Math.round(s / 86_400), 'day');
}

/** Thumbnail from PNG bytes (blob: URL, allowed by the CSP), revoked when the card goes away. */
function Thumb({ png, name }: { png: Uint8Array | null; name: string }) {
  const url = useMemo(
    () => (png ? URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })) : null),
    [png],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <div className="flex h-28 items-center justify-center overflow-hidden rounded bg-[conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)] bg-[length:12px_12px]">
      {url ? (
        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      ) : (
        <span aria-hidden className="text-2xl text-neutral-500">
          {/\.iep$/i.test(name) ? '▤' : '🖼'}
        </span>
      )}
    </div>
  );
}

/**
 * Welcome screen (FR-GEN-08, docs/03 §3): recent files as a thumbnail grid, Open, and a new document with
 * presets. Shown when no document is open.
 */
export function Welcome({ onOpen, recent, onOpenRecent, onRemoveRecent, onClearRecent, newDocument }: Props) {
  return (
    <div className="absolute inset-0 overflow-auto p-8">
      <div className="mx-auto flex max-w-5xl gap-8">
        <div className="bg-ui-panel border-ui-border flex w-[380px] shrink-0 flex-col gap-4 self-start rounded-lg border p-6 shadow-xl">
          <h1 className="text-lg font-semibold">{PRODUCT_NAME}</h1>
          <p className="text-ui-muted">
            Open an image or project, or create a new document. You can also drop a file here.
          </p>
          <Button variant="primary" onClick={onOpen} className="py-2">
            Open…
          </Button>
          <div className="border-ui-border flex flex-col gap-2 border-t pt-4">
            <span className="font-semibold">New document</span>
            <NewDocumentForm {...newDocument}>
              {(valid) => (
                <Button type="submit" disabled={!valid} className="bg-ui-raised self-start">
                  Create
                </Button>
              )}
            </NewDocumentForm>
          </div>
        </div>
        <section aria-labelledby="recent-title" className="min-w-0 flex-1">
          <div className="mb-3 flex items-center">
            <h2 id="recent-title" className="text-sm font-semibold">
              Recent
            </h2>
            {recent.length > 0 && (
              <button className="text-ui-muted hover:text-ui-text ml-auto" onClick={onClearRecent}>
                Clear recent
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="text-ui-muted">Files you open or save appear here.</p>
          ) : (
            <ul
              aria-label="Recent files"
              className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
            >
              {recent.map((r) => (
                <li key={r.id} className="group relative">
                  <button
                    onClick={() => onOpenRecent(r.id)}
                    disabled={!r.exists}
                    title={r.exists ? `${r.displayDir}` : 'This file was moved or deleted'}
                    aria-label={`Open ${r.displayName}${r.exists ? '' : ' (missing)'}`}
                    className="bg-ui-panel border-ui-border hover:border-brand flex w-full flex-col gap-1.5 rounded-lg border p-2 text-left disabled:opacity-50"
                  >
                    <Thumb png={r.thumbnail} name={r.displayName} />
                    <span className="truncate font-medium">{r.displayName}</span>
                    <span className="text-ui-muted truncate text-[11px]">
                      {r.exists ? ago(r.openedAt) : 'Missing'}
                    </span>
                  </button>
                  <button
                    aria-label={`Remove ${r.displayName} from recent files`}
                    title="Remove from the list"
                    onClick={() => onRemoveRecent(r.id)}
                    className="bg-ui-panel/90 absolute top-3 right-3 rounded px-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
