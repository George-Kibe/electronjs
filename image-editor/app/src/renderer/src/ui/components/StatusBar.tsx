import { useState } from 'react';
import type { EditorSnapshot } from '../../engine/editor';
import { MAX_ZOOM, MIN_ZOOM } from '../../engine/render/viewport';

const GB = 1024 ** 3;
const formatBytes = (n: number) =>
  n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;

/** Editable zoom percentage: type a value and press Enter (FR-NAV-01). */
function ZoomField({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const shown = `${Math.round(zoom * 1000) / 10}`;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = Number((draft ?? '').replace('%', '').trim());
    if (draft !== null && Number.isFinite(v) && v > 0)
      onZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v / 100)));
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-0.5">
      <input
        aria-label="Zoom percentage"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className="hover:bg-ui-raised focus:bg-ui-bg w-12 rounded bg-transparent px-1 text-right tabular-nums"
      />
      <span>%</span>
    </label>
  );
}

/**
 * Status bar (FR-NAV-06): zoom, document size, cursor position, colour under the cursor, memory use (amber at
 * 80 % of the budget, docs/03 §8), long-operation progress and the GPU.
 */
export function StatusBar({ snap, onZoom }: { snap: EditorSnapshot; onZoom: (z: number) => void }) {
  const doc = snap.doc!;
  const { usedBytes, budgetBytes } = snap.memory;
  const high = usedBytes >= budgetBytes * 0.8;
  return (
    <>
      <ZoomField zoom={snap.zoom} onZoom={onZoom} />
      <span>
        {doc.width} × {doc.height} px · sRGB
        {doc.sourceProfile ? ` (converted from ${doc.sourceProfile})` : ''}
      </span>
      <span className="w-28">{snap.cursor ? `X ${snap.cursor.x}  Y ${snap.cursor.y}` : ''}</span>
      <span className="flex w-20 items-center gap-1" aria-label="Colour under the cursor">
        {snap.cursor?.color && (
          <>
            <span
              aria-hidden
              className="border-ui-border h-3 w-3 border"
              style={{ background: snap.cursor.color }}
            />
            {snap.cursor.color}
          </>
        )}
      </span>
      <span
        className={high ? 'text-amber-400' : ''}
        title={
          high
            ? 'Memory is nearly full. Fewer history steps (Preferences) or a Flatten frees memory.'
            : 'Pixels held by the document, snapshots and history'
        }
      >
        Mem {formatBytes(usedBytes)} / {formatBytes(budgetBytes)}
      </span>
      {snap.job && (
        <span
          role="progressbar"
          aria-label={snap.job.label}
          aria-valuenow={Math.round(snap.job.progress * 100)}
          className="flex items-center gap-1.5"
        >
          {snap.job.label}…
          <span className="bg-ui-raised h-1.5 w-24 overflow-hidden rounded">
            <span className="bg-brand block h-full" style={{ width: `${snap.job.progress * 100}%` }} />
          </span>
        </span>
      )}
      <span className="ml-auto truncate">{snap.gpu}</span>
    </>
  );
}
