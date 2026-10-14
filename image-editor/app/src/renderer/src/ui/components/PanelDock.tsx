import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PanelId } from '@shared/settings';
import {
  movePanel,
  PANEL_TITLES,
  panelsOf,
  resizePanel,
  setWidth,
  toggleOpen,
  type Workspace,
} from '../workspace';

type Props = {
  workspace: Workspace;
  onChange: (ws: Workspace) => void;
  panels: Record<PanelId, { content: ReactNode; actions?: ReactNode }>;
};

/**
 * The right-hand panel dock (FR-GEN-01, docs/03 §3): collapsible sections that can be reordered (drag a
 * header, or Alt+↑/↓ on it) and resized (drag the line between two open panels, or the dock's left edge).
 * Layout lives in the workspace settings; this component only renders it.
 */
export function PanelDock({ workspace, onChange, panels }: Props) {
  const dock = useRef<HTMLElement>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragged = useRef<PanelId | null>(null);
  const shown = panelsOf(workspace).filter((p) => p.visible);

  /** Pointer drag helper: calls `onMove(dx, dy)` with the distance from the press. */
  const drag = (e: React.PointerEvent, onMove: (dx: number, dy: number) => void) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /** Height shared by the open panels (the dock minus headers and splitters). */
  const available = () => {
    const box = dock.current;
    if (!box) return 0;
    const fixed = [...box.querySelectorAll<HTMLElement>('[data-fixed]')].reduce(
      (n, el) => n + el.offsetHeight,
      0,
    );
    return box.clientHeight - fixed;
  };

  const onHeaderKey = (e: KeyboardEvent, id: PanelId, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    const all = panelsOf(workspace);
    const target = shown[index + (e.key === 'ArrowUp' ? -1 : 1)];
    if (target)
      onChange(
        movePanel(
          workspace,
          id,
          all.findIndex((p) => p.id === target.id),
        ),
      );
  };

  return (
    <aside
      ref={dock}
      aria-label="Panels"
      className="bg-ui-panel border-ui-border relative flex shrink-0 flex-col border-l"
      style={{ width: workspace.width }}
    >
      <div
        aria-hidden
        title="Drag to resize the panels"
        className="hover:bg-brand/50 absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-ew-resize"
        onPointerDown={(e) => {
          const start = workspace;
          drag(e, (dx) => onChange(setWidth(start, start.width - dx)));
        }}
      />
      {shown.map((p, i) => {
        const nextOpen = p.open && shown.slice(i + 1).some((q) => q.open);
        return (
          <section
            key={p.id}
            aria-labelledby={`panel-${p.id}`}
            className={`border-ui-border flex min-h-0 flex-col border-b ${dropAt === i ? 'border-t-brand border-t-2' : ''}`}
            style={p.open ? { flex: `${p.size} 1 0` } : { flex: '0 0 auto' }}
            onDragOver={(e) => {
              if (!dragged.current) return;
              e.preventDefault();
              setDropAt(i);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragged.current;
              setDropAt(null);
              if (id && id !== p.id)
                onChange(
                  movePanel(
                    workspace,
                    id,
                    panelsOf(workspace).findIndex((q) => q.id === p.id),
                  ),
                );
            }}
          >
            <div
              data-fixed
              draggable
              onDragStart={(e) => {
                dragged.current = p.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', p.id);
              }}
              onDragEnd={() => {
                dragged.current = null;
                setDropAt(null);
              }}
              className="flex cursor-grab items-center pr-2"
            >
              <button
                id={`panel-${p.id}`}
                aria-expanded={p.open}
                title={`${p.open ? 'Collapse' : 'Expand'} ${PANEL_TITLES[p.id]} (Alt+↑/↓ moves it)`}
                onClick={() => onChange(toggleOpen(workspace, p.id))}
                onKeyDown={(e) => onHeaderKey(e, p.id, i)}
                className="flex flex-1 items-center gap-1 px-3 py-1.5 text-left text-[11px] font-semibold tracking-wide uppercase"
              >
                <span aria-hidden className="text-ui-muted w-3">
                  {p.open ? '▾' : '▸'}
                </span>
                {PANEL_TITLES[p.id]}
              </button>
              {p.open && panels[p.id].actions}
            </div>
            {p.open && <div className="min-h-0 flex-1 overflow-auto">{panels[p.id].content}</div>}
            {nextOpen && (
              <div
                data-fixed
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize ${PANEL_TITLES[p.id]}`}
                className="hover:bg-brand/50 h-1 shrink-0 cursor-ns-resize"
                onPointerDown={(e) => {
                  const start = workspace;
                  const space = available();
                  drag(e, (_dx, dy) => onChange(resizePanel(start, p.id, dy, space)));
                }}
              />
            )}
          </section>
        );
      })}
    </aside>
  );
}
