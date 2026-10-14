import type { EditorSnapshot } from '../../engine/editor';

type Props = {
  history: EditorSnapshot['history'];
  initialLabel: string;
  onGoTo: (index: number) => void;
  onRestore: (id: string) => void;
  onDeleteSnapshot: (id: string) => void;
};

/**
 * History panel (FR-HIS-02): snapshots on top (the document as opened, then named ones; they never expire),
 * then every step. Clicking a step goes back to it; clicking a snapshot restores it as a new step.
 */
export function HistoryPanel({ history, initialLabel, onGoTo, onRestore, onDeleteSnapshot }: Props) {
  const rows = [{ label: initialLabel, index: -1 }, ...history.entries];
  return (
    // The dock (PanelDock) provides the section, the "History" header and its New snapshot button.
    <div className="flex h-full min-h-0 flex-col">
      <ul aria-label="Snapshots" className="border-ui-border border-b pb-1">
        {history.snapshots.map((s, i) => (
          <li key={s.id} className="group flex items-center">
            <button
              onClick={() => onRestore(s.id)}
              title={`Restore ${s.name} (as a new step; Undo goes back)`}
              className="hover:bg-ui-raised/60 flex-1 truncate px-3 py-1 text-left"
            >
              <span aria-hidden className="text-ui-muted mr-1.5">
                ▣
              </span>
              {s.name}
            </button>
            {i > 0 && (
              <button
                aria-label={`Delete ${s.name}`}
                title={`Delete ${s.name}`}
                onClick={() => onDeleteSnapshot(s.id)}
                className="text-ui-muted hover:text-ui-text px-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <ol aria-label="History" className="min-h-0 overflow-auto pb-2">
        {rows.map((row) => (
          <li key={row.index}>
            <button
              onClick={() => onGoTo(row.index)}
              aria-current={row.index === history.position ? 'step' : undefined}
              className={`w-full px-3 py-1 text-left ${row.index === history.position ? 'bg-ui-raised' : 'hover:bg-ui-raised/60'} ${
                row.index > history.position ? 'text-ui-muted italic' : ''
              }`}
            >
              {row.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
