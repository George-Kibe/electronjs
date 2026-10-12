import { useSyncExternalStore } from 'react';
import type { Editor, EditorSnapshot } from '../../engine/editor';

type Props = { crop: NonNullable<EditorSnapshot['crop']>; editor: Editor };

/**
 * Crop box overlay (docs/03 §5.5): shades what will be cut, draws the box and its 8 handles, the
 * rule-of-thirds grid while dragging, and the straighten line. Display only: the editor handles input.
 */
export function CropOverlay({ crop, editor }: Props) {
  // Subscribes to the view store itself, so panning re-renders only this overlay.
  const { zoom, panX, panY } = useSyncExternalStore(editor.subscribeView, editor.getView);
  const { rect } = crop;
  const x = rect.x * zoom + panX;
  const y = rect.y * zoom + panY;
  const w = rect.width * zoom;
  const h = rect.height * zoom;
  const handles = [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [0, 0.5],
    [1, 0.5],
    [0, 1],
    [0.5, 1],
    [1, 1],
  ] as const;
  const line = crop.line;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <mask id="crop-cut">
          <rect width="100%" height="100%" fill="white" />
          <rect x={x} y={y} width={w} height={h} fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#crop-cut)" />
      {crop.dragging &&
        [1 / 3, 2 / 3].map((t) => (
          <g key={t} stroke="rgba(255,255,255,0.6)" strokeWidth={1}>
            <line x1={x + w * t} y1={y} x2={x + w * t} y2={y + h} />
            <line x1={x} y1={y + h * t} x2={x + w} y2={y + h * t} />
          </g>
        ))}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#fff" strokeWidth={1} />
      <rect
        x={x - 1}
        y={y - 1}
        width={w + 2}
        height={h + 2}
        fill="none"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth={1}
      />
      {!line &&
        handles.map(([hx, hy]) => (
          <rect
            key={`${hx},${hy}`}
            x={x + w * hx - 4}
            y={y + h * hy - 4}
            width={8}
            height={8}
            fill="#fff"
            stroke="#000"
            strokeWidth={1}
          />
        ))}
      {line && (
        <line
          x1={line.x0 * zoom + panX}
          y1={line.y0 * zoom + panY}
          x2={line.x1 * zoom + panX}
          y2={line.y1 * zoom + panY}
          stroke="#74c0fc"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      )}
    </svg>
  );
}
