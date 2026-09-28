import type { Tool } from '../../engine/editor';
import { Button } from './Button';

const TOOLS: Array<{ id: Tool; label: string; key: string; icon: string }> = [
  { id: 'brush', label: 'Brush', key: 'B', icon: '🖌' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: '⌫' },
  { id: 'hand', label: 'Hand', key: 'H', icon: '✋' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: '🔍' },
];

export function ToolBar({ tool, onSelect }: { tool: Tool; onSelect: (t: Tool) => void }) {
  return (
    <nav
      aria-label="Tools"
      className="bg-ui-panel border-ui-border flex w-11 flex-col items-center gap-1 border-r py-2"
    >
      {TOOLS.map((t) => (
        <Button
          key={t.id}
          active={tool === t.id}
          aria-pressed={tool === t.id}
          aria-label={`${t.label} (${t.key})`}
          title={`${t.label} (${t.key})`}
          className="h-8 w-8 text-base"
          onClick={() => onSelect(t.id)}
        >
          <span aria-hidden>{t.icon}</span>
        </Button>
      ))}
    </nav>
  );
}
