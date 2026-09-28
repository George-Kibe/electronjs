import type { EditorSnapshot } from '../../engine/editor';
import { Button } from './Button';

type Props = {
  layers: EditorSnapshot['layers'];
  activeLayerId: string | null;
  onSelect: (id: string) => void;
  onVisible: (id: string, visible: boolean) => void;
  onOpacity: (id: string, opacity: number) => void;
  onOpacityDone: () => void;
  onAdd: () => void;
  onDelete: () => void;
};

export function LayersPanel(p: Props) {
  const active = p.layers.find((l) => l.id === p.activeLayerId);
  return (
    <section
      aria-labelledby="layers-title"
      className="border-ui-border flex min-h-0 flex-1 flex-col border-b"
    >
      <h2 id="layers-title" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">
        Layers
      </h2>
      {active && (
        <label className="flex items-center gap-2 px-3 pb-2">
          <span className="text-ui-muted">Opacity</span>
          <input
            type="range"
            aria-label="Layer opacity"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onChange={(e) => p.onOpacity(active.id, Number(e.target.value) / 100)}
            onPointerUp={p.onOpacityDone}
            onKeyUp={p.onOpacityDone}
            className="flex-1"
          />
          <span className="w-9 text-right tabular-nums">{Math.round(active.opacity * 100)}%</span>
        </label>
      )}
      <ul role="listbox" aria-label="Layers" className="min-h-0 flex-1 overflow-auto">
        {p.layers.map((layer) => (
          <li
            key={layer.id}
            role="option"
            aria-selected={layer.id === p.activeLayerId}
            onClick={() => p.onSelect(layer.id)}
            className={`flex cursor-default items-center gap-2 px-3 py-1.5 ${layer.id === p.activeLayerId ? 'bg-ui-raised' : 'hover:bg-ui-raised/60'}`}
          >
            <button
              aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
              aria-pressed={layer.visible}
              onClick={(e) => {
                e.stopPropagation();
                p.onVisible(layer.id, !layer.visible);
              }}
              className="w-5 text-center"
            >
              {layer.visible ? '👁' : '·'}
            </button>
            <span className="truncate">{layer.name}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-1 px-2 py-1">
        <Button aria-label="New layer" title="New layer (Ctrl+Shift+N)" onClick={p.onAdd}>
          ＋
        </Button>
        <Button
          aria-label="Delete layer"
          title="Delete layer"
          onClick={p.onDelete}
          disabled={p.layers.length <= 1}
        >
          🗑
        </Button>
      </div>
    </section>
  );
}
