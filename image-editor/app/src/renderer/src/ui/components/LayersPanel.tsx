import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { BLEND_MODE_LABELS, IMPLEMENTED_BLEND_MODES } from '../../engine/doc/blend';
import type { BlendMode, LayerLocks } from '../../engine/doc/document';
import type { Editor, EditorSnapshot, LayerRow } from '../../engine/editor';
import { Button } from './Button';

const THUMB = 32;

/** Throttled, lazily generated layer thumbnail (FR-LAY-06). */
function Thumbnail({ editor, row }: { editor: Editor; row: LayerRow }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const thumb = editor.layerThumbnail(row.id, THUMB);
      const c = canvas.current;
      if (!thumb || !c) return;
      c.width = thumb.width;
      c.height = thumb.height;
      c.getContext('2d')?.putImageData(
        new ImageData(new Uint8ClampedArray(thumb.rgba), thumb.width, thumb.height),
        0,
        0,
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [editor, row.id, row.contentKey]);
  return (
    <span className="border-ui-border flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden border bg-[conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)] bg-[length:8px_8px]">
      <canvas ref={canvas} className="max-h-full max-w-full" aria-hidden="true" />
    </span>
  );
}

const LOCKS: Array<[keyof LayerLocks, string, string]> = [
  ['transparency', '▦', 'Lock transparent pixels'],
  ['pixels', '✎', 'Lock image pixels'],
  ['position', '✥', 'Lock position'],
  ['all', '🔒', 'Lock all'],
];

type Props = { editor: Editor; snap: EditorSnapshot };

export function LayersPanel({ editor, snap }: Props) {
  const rows = snap.layers;
  const active = rows.find((l) => l.id === snap.activeLayerId) ?? null;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: 'above' | 'below' | 'inside' } | null>(null);
  const dragged = useRef<string | null>(null);
  const percent = (v: number) => Math.round(v * 100);

  const whereFor = (e: DragEvent, row: LayerRow): 'above' | 'below' | 'inside' => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - box.top) / box.height;
    if (row.type === 'group' && t > 0.3 && t < 0.7) return 'inside';
    return t < 0.5 ? 'above' : 'below';
  };

  const onListKey = (e: KeyboardEvent) => {
    if (renaming) return;
    const i = rows.findIndex((r) => r.id === snap.activeLayerId);
    if (e.key === 'ArrowDown' && rows[i + 1]) editor.setActiveLayer(rows[i + 1]!.id);
    else if (e.key === 'ArrowUp' && rows[i - 1]) editor.setActiveLayer(rows[i - 1]!.id);
    else if (e.key === 'F2' && active) setRenaming(active.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <section
      aria-labelledby="layers-title"
      className="border-ui-border flex min-h-0 flex-1 flex-col border-b"
    >
      <h2 id="layers-title" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
        Layers
      </h2>
      {active && (
        <div className="flex flex-col gap-1 px-3 pb-2">
          <select
            aria-label="Blend mode"
            className="bg-ui-bg border-ui-border rounded border px-1 py-0.5"
            value={active.type === 'group' && active.passThrough ? 'pass-through' : active.blendMode}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'pass-through') editor.setLayerProps(active.id, { passThrough: true });
              else
                editor.setLayerProps(active.id, {
                  blendMode: v as BlendMode,
                  ...(active.type === 'group' ? { passThrough: false } : {}),
                });
            }}
          >
            {active.type === 'group' && <option value="pass-through">Pass Through</option>}
            {IMPLEMENTED_BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {BLEND_MODE_LABELS[m]}
              </option>
            ))}
            {!(IMPLEMENTED_BLEND_MODES as readonly string[]).includes(active.blendMode) && (
              <option value={active.blendMode}>
                {BLEND_MODE_LABELS[active.blendMode]} (shown as Normal)
              </option>
            )}
          </select>
          {(['opacity', 'fillOpacity'] as const)
            // Fill is kept (disabled) for groups so the panel never shifts under the pointer.
            .map((k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="text-ui-muted w-12">{k === 'opacity' ? 'Opacity' : 'Fill'}</span>
                <input
                  type="range"
                  aria-label={k === 'opacity' ? 'Layer opacity' : 'Fill opacity'}
                  min={0}
                  max={100}
                  value={percent(active[k])}
                  disabled={k === 'fillOpacity' && active.type === 'group'}
                  title={k === 'fillOpacity' && active.type === 'group' ? 'Groups have no fill' : undefined}
                  onChange={(e) =>
                    editor.setLayerProps(active.id, { [k]: Number(e.target.value) / 100 }, { coalesce: true })
                  }
                  onPointerUp={() => editor.endCoalesce()}
                  onKeyUp={() => editor.endCoalesce()}
                  className="min-w-0 flex-1"
                />
                <span className="w-9 text-right tabular-nums">{percent(active[k])}%</span>
              </label>
            ))}
          <div className="flex items-center gap-1" role="group" aria-label="Locks">
            <span className="text-ui-muted w-12">Lock</span>
            {LOCKS.map(([key, icon, label]) => (
              <Button
                key={key}
                aria-label={label}
                title={label}
                aria-pressed={active.locks[key]}
                active={active.locks[key]}
                className="h-6 w-6 px-0"
                onClick={() =>
                  editor.setLayerProps(active.id, { locks: { ...active.locks, [key]: !active.locks[key] } })
                }
              >
                {icon}
              </Button>
            ))}
          </div>
        </div>
      )}
      <ul
        role="listbox"
        aria-label="Layers"
        tabIndex={0}
        onKeyDown={onListKey}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {rows.map((row) => {
          const selected = row.id === snap.activeLayerId;
          const marker =
            drop?.id === row.id
              ? drop.where === 'inside'
                ? 'ring-1 ring-brand ring-inset'
                : drop.where === 'above'
                  ? 'shadow-[inset_0_2px_0_var(--color-brand)]'
                  : 'shadow-[inset_0_-2px_0_var(--color-brand)]'
              : '';
          const lockedAny = Object.values(row.locks).some(Boolean);
          return (
            <li
              key={row.id}
              role="option"
              aria-selected={selected}
              aria-level={row.depth + 1}
              draggable={renaming !== row.id}
              onClick={() => editor.setActiveLayer(row.id)}
              onDoubleClick={() => setRenaming(row.id)}
              onDragStart={(e) => {
                dragged.current = row.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-imageeditor-layer', row.id);
              }}
              onDragOver={(e) => {
                if (!dragged.current || dragged.current === row.id) return;
                e.preventDefault();
                setDrop({ id: row.id, where: whereFor(e, row) });
              }}
              onDragLeave={() => setDrop((d) => (d?.id === row.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation(); // not a file drop on the window
                if (dragged.current) editor.dropLayer(dragged.current, row.id, whereFor(e, row));
                dragged.current = null;
                setDrop(null);
              }}
              onDragEnd={() => {
                dragged.current = null;
                setDrop(null);
              }}
              style={{ paddingLeft: 8 + row.depth * 14 }}
              className={`flex cursor-default items-center gap-1.5 py-1 pr-2 ${selected ? 'bg-ui-raised' : 'hover:bg-ui-raised/60'} ${marker}`}
            >
              <button
                aria-label={`${row.visible ? 'Hide' : 'Show'} ${row.name}`}
                aria-pressed={row.visible}
                onClick={(e) => {
                  e.stopPropagation();
                  editor.setLayerVisible(row.id, !row.visible);
                }}
                className="w-5 shrink-0 text-center"
              >
                {row.visible ? '👁' : '·'}
              </button>
              {row.type === 'group' ? (
                <button
                  aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${row.name}`}
                  aria-expanded={!row.collapsed}
                  onClick={(e) => {
                    e.stopPropagation();
                    editor.toggleCollapsed(row.id);
                  }}
                  className="text-ui-muted w-4 shrink-0"
                >
                  {row.collapsed ? '▸' : '▾'}
                </button>
              ) : (
                <Thumbnail editor={editor} row={row} />
              )}
              {renaming === row.id ? (
                <input
                  aria-label="Layer name"
                  defaultValue={row.name}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.currentTarget.value = row.name;
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== row.name) editor.setLayerProps(row.id, { name });
                    setRenaming(null);
                  }}
                  className="bg-ui-bg border-ui-border min-w-0 flex-1 rounded border px-1"
                />
              ) : (
                <span className={`min-w-0 flex-1 truncate ${row.type === 'group' ? 'font-semibold' : ''}`}>
                  {row.name}
                </span>
              )}
              {lockedAny && (
                <span aria-label="locked" title="Locked" className="text-ui-muted">
                  🔒
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-1 px-2 py-1">
        <Button aria-label="New group" title="New group" onClick={() => editor.addGroup()}>
          ▭
        </Button>
        <Button aria-label="New layer" title="New layer (Ctrl+Shift+N)" onClick={() => editor.addLayer()}>
          ＋
        </Button>
        <Button
          aria-label="Duplicate layer"
          title="Duplicate layer (Ctrl+J)"
          onClick={() => editor.duplicateLayer()}
        >
          ⧉
        </Button>
        <Button
          aria-label="Merge down"
          title={snap.layerOps.mergeDown ?? 'Merge down (Ctrl+E)'}
          disabled={snap.layerOps.mergeDown !== null}
          onClick={() => editor.mergeDown()}
        >
          ⤓
        </Button>
        <Button
          aria-label="Delete layer"
          title="Delete layer"
          onClick={() => editor.deleteLayer()}
          disabled={!snap.layerOps.canDelete}
        >
          🗑
        </Button>
      </div>
    </section>
  );
}
