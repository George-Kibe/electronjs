import { useEffect, useRef, useState } from 'react';
import type { Colors, Tool } from '../../engine/editor';
import { rgbToHex } from '../../lib/color';
import { Button } from './Button';

type ToolInfo = { id: Tool; label: string; key: string; icon: string };

/** Tool groups (docs/03 §4). Groups with more than one tool open a flyout on right-click or long-press. */
const GROUPS: ToolInfo[][] = [
  [{ id: 'move', label: 'Move', key: 'V', icon: '✥' }],
  [{ id: 'crop', label: 'Crop', key: 'C', icon: '⛶' }],
  [
    { id: 'brush', label: 'Brush', key: 'B', icon: '🖌' },
    { id: 'pencil', label: 'Pencil', key: 'B', icon: '✎' },
  ],
  [{ id: 'eraser', label: 'Eraser', key: 'E', icon: '⌫' }],
  [{ id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: '💧' }],
  [{ id: 'hand', label: 'Hand', key: 'H', icon: '✋' }],
  [{ id: 'zoom', label: 'Zoom', key: 'Z', icon: '🔍' }],
];

type Props = {
  tool: Tool;
  colors: Colors;
  onSelect: (t: Tool) => void;
  onEditColor: (which: 'foreground' | 'background') => void;
  onSwap: () => void;
  onReset: () => void;
};

function ToolGroup({
  group,
  tool,
  onSelect,
}: {
  group: ToolInfo[];
  tool: Tool;
  onSelect: (t: Tool) => void;
}) {
  const [lastUsed, setLastUsed] = useState(group[0]!);
  const [open, setOpen] = useState(false);
  const pressTimer = useRef(0);
  const menu = useRef<HTMLDivElement>(null);
  const current = group.find((t) => t.id === tool);
  // The group button shows the member in use, or the last one used (as in Photoshop). Remembered while
  // rendering (React's "adjust state when a prop changes" pattern) so shortcuts update it too.
  if (current && current !== lastUsed) setLastUsed(current);
  const shown = current ?? lastUsed;
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const close = (e: PointerEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const multi = group.length > 1;
  const choose = (t: ToolInfo) => {
    setOpen(false);
    onSelect(t.id);
  };
  return (
    <div className="relative">
      <Button
        active={Boolean(current)}
        aria-pressed={Boolean(current)}
        aria-label={`${shown.label} (${shown.key})`}
        aria-haspopup={multi ? 'menu' : undefined}
        aria-expanded={multi ? open : undefined}
        title={`${shown.label} (${shown.key})${multi ? ' — right-click for more tools' : ''}`}
        className="h-8 w-8 text-base"
        onClick={() => onSelect(shown.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (multi) setOpen(true);
        }}
        onPointerDown={() => {
          if (multi) pressTimer.current = window.setTimeout(() => setOpen(true), 500);
        }}
        onPointerUp={() => window.clearTimeout(pressTimer.current)}
        onPointerLeave={() => window.clearTimeout(pressTimer.current)}
        onKeyDown={(e) => {
          if (multi && e.key === 'ArrowRight') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden>{shown.icon}</span>
        {multi && (
          <span aria-hidden className="text-ui-muted absolute right-0.5 bottom-0 text-[7px]">
            ◢
          </span>
        )}
      </Button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={`${group[0]!.label} tools`}
          className="bg-ui-panel border-ui-border absolute top-0 left-9 z-30 min-w-36 rounded border py-1 shadow-lg"
          onKeyDown={(e) => {
            const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape' || e.key === 'ArrowLeft') setOpen(false);
            else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
            else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {group.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === shown.id}
              className="hover:bg-ui-raised focus:bg-ui-raised flex w-full items-center gap-2 px-3 py-1 text-left"
              onClick={() => choose(t)}
            >
              <span aria-hidden className="w-4">
                {t.icon}
              </span>
              {t.label}
              <span className="text-ui-muted ml-auto">{t.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolBar({ tool, colors, onSelect, onEditColor, onSwap, onReset }: Props) {
  const fg = rgbToHex(colors.foreground);
  const bg = rgbToHex(colors.background);
  return (
    <nav
      aria-label="Tools"
      className="bg-ui-panel border-ui-border flex w-11 flex-col items-center gap-1 border-r py-2"
    >
      {GROUPS.map((g) => (
        <ToolGroup key={g[0]!.id} group={g} tool={tool} onSelect={onSelect} />
      ))}
      {/* Foreground/background colours (FR-PNT-07). */}
      <div className="relative mt-3 h-10 w-10" role="group" aria-label="Colours">
        <button
          aria-label={`Background colour ${bg}`}
          title={`Background colour ${bg} — click to change`}
          onClick={() => onEditColor('background')}
          className="absolute right-1 bottom-1 h-5 w-5 rounded-sm border border-white/70 shadow"
          style={{ background: bg }}
        />
        <button
          aria-label={`Foreground colour ${fg}`}
          title={`Foreground colour ${fg} — click to change`}
          onClick={() => onEditColor('foreground')}
          className="absolute top-0 left-0.5 h-5 w-5 rounded-sm border border-white/70 shadow"
          style={{ background: fg }}
        />
        <button
          aria-label="Swap colours (X)"
          title="Swap colours (X)"
          onClick={onSwap}
          className="text-ui-muted hover:text-ui-text absolute top-0 right-0 text-[10px] leading-none"
        >
          ⇄
        </button>
        <button
          aria-label="Default colours (D)"
          title="Default colours (D)"
          onClick={onReset}
          className="absolute bottom-0 left-0 flex h-3 w-3 items-center justify-center"
        >
          <span aria-hidden className="absolute top-0 left-0 h-2 w-2 border border-white/70 bg-black" />
          <span aria-hidden className="absolute right-0 bottom-0 h-2 w-2 border border-black/50 bg-white" />
        </button>
      </div>
    </nav>
  );
}
