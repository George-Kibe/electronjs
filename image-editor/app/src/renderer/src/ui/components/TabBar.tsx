import type { KeyboardEvent } from 'react';
import type { EditorSnapshot } from '../../engine/editor';

type Props = {
  tabs: EditorSnapshot['tabs'];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** A tab dragged out of the window: show it in a new window near (x, y) on screen (FR-DOC-03). */
  onMoveOut: (id: string, at: { x: number; y: number }) => void;
};

/**
 * Document tabs (FR-DOC-03, docs/03 §3): name with an unsaved-changes dot; middle-click or ✕ closes
 * (asking about unsaved changes). Arrow keys move between tabs (WAI-ARIA tabs pattern).
 */
export function TabBar({ tabs, onActivate, onClose, onMoveOut }: Props) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.active);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || tabs.length < 2) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    onActivate(next.id);
    requestAnimationFrame(() =>
      e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus(),
    );
  };
  return (
    <div
      role="tablist"
      aria-label="Documents"
      onKeyDown={onKey}
      className="bg-ui-bg border-ui-border flex h-8 shrink-0 items-end gap-px overflow-x-auto border-b px-1"
    >
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`group flex h-7 max-w-56 min-w-0 items-center rounded-t ${
            t.active ? 'bg-ui-panel text-ui-text' : 'text-ui-muted hover:bg-ui-raised/60'
          }`}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(t.id);
          }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-imageeditor-tab', t.id);
          }}
          onDragEnd={(e) => {
            // Dropped outside the window (nothing accepted it, and the pointer is off the page).
            const outside =
              e.clientX < 0 ||
              e.clientY < 0 ||
              e.clientX > window.innerWidth ||
              e.clientY > window.innerHeight;
            if (e.dataTransfer.dropEffect === 'none' && outside)
              onMoveOut(t.id, { x: e.screenX, y: e.screenY });
          }}
        >
          <button
            role="tab"
            data-tab={t.id}
            aria-selected={t.active}
            tabIndex={t.active ? 0 : -1}
            title={t.name}
            aria-label={t.dirty ? `${t.name}, unsaved changes` : t.name}
            onClick={() => onActivate(t.id)}
            className="min-w-0 truncate py-1 pl-3"
          >
            {t.name}
            {t.dirty && <span aria-hidden> •</span>}
          </button>
          <button
            aria-label={`Close ${t.name}`}
            title="Close (Ctrl+W)"
            onClick={() => onClose(t.id)}
            className={`hover:bg-ui-raised mx-1 rounded px-1 ${t.active ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
