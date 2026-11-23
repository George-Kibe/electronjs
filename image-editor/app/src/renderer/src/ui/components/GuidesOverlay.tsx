import { useSyncExternalStore } from 'react';
import type { Editor, EditorSnapshot } from '../../engine/editor';

/** Guides across the canvas (FR-NAV-04), and the one being dragged. Display only; the editor handles input. */
export function GuidesOverlay(props: {
  editor: Editor;
  guides: EditorSnapshot['guides'];
  drag: EditorSnapshot['guideDrag'];
  shown: boolean;
}) {
  const { zoom, panX, panY } = useSyncExternalStore(props.editor.subscribeView, props.editor.getView);
  const { guides, drag } = props;
  const lines: Array<{ key: string; vertical: boolean; at: number; moving: boolean }> = [];
  if (props.shown) {
    guides.vertical.forEach((x, i) => {
      if (drag?.orientation !== 'vertical' || drag.index !== i)
        lines.push({ key: `v${i}`, vertical: true, at: x * zoom + panX, moving: false });
    });
    guides.horizontal.forEach((y, i) => {
      if (drag?.orientation !== 'horizontal' || drag.index !== i)
        lines.push({ key: `h${i}`, vertical: false, at: y * zoom + panY, moving: false });
    });
  }
  if (drag && Number.isFinite(drag.position)) {
    const vertical = drag.orientation === 'vertical';
    lines.push({ key: 'drag', vertical, at: drag.position * zoom + (vertical ? panX : panY), moving: true });
  }
  if (lines.length === 0) return null;
  return (
    <svg
      aria-hidden
      data-testid="guides"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      {lines.map(({ key, vertical, at, moving }) => {
        const p = Math.round(at) + 0.5;
        return vertical ? (
          <line
            key={key}
            x1={p}
            y1={0}
            x2={p}
            y2="100%"
            stroke={moving ? '#4dabf7' : '#22b8cf'}
            strokeWidth={1}
          />
        ) : (
          <line
            key={key}
            x1={0}
            y1={p}
            x2="100%"
            y2={p}
            stroke={moving ? '#4dabf7' : '#22b8cf'}
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}
