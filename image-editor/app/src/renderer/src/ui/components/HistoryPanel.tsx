import type { EditorSnapshot } from '../../engine/editor';

type Props = { history: EditorSnapshot['history']; initialLabel: string; onGoTo: (index: number) => void };

export function HistoryPanel({ history, initialLabel, onGoTo }: Props) {
  const rows = [{ label: initialLabel, index: -1 }, ...history.entries];
  return (
    <section aria-labelledby="history-title" className="flex max-h-[40%] min-h-0 flex-col">
      <h2 id="history-title" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
        History
      </h2>
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
    </section>
  );
}
