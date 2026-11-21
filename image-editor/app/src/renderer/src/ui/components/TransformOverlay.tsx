import { useSyncExternalStore } from 'react';
import type { Editor, EditorSnapshot } from '../../engine/editor';

type Props = { transform: NonNullable<EditorSnapshot['transform']>; editor: Editor };

/**
 * Free Transform box (FR-TRF-04, docs/03 §5.5): the transformed outline, its 8 handles and the centre.
 * Display only: the editor handles input and the canvas shows the live GPU preview underneath.
 */
export function TransformOverlay({ transform, editor }: Props) {
  // Subscribes to the view store itself, so panning re-renders only this overlay.
  const { zoom, panX, panY } = useSyncExternalStore(editor.subscribeView, editor.getView);
  const at = ([x, y]: [number, number]): [number, number] => [x * zoom + panX, y * zoom + panY];
  const h = transform.handles;
  const outline = [h.nw, h.ne, h.se, h.sw].map((p) => at(p).join(',')).join(' ');
  const [cx, cy] = at([(h.nw[0] + h.se[0]) / 2, (h.nw[1] + h.se[1]) / 2]);
  return (
    <svg
      aria-hidden
      data-testid="transform-box"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <polygon points={outline} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={3} />
      <polygon points={outline} fill="none" stroke="#fff" strokeWidth={1} />
      {(Object.keys(h) as Array<keyof typeof h>).map((k) => {
        const [x, y] = at(h[k]);
        return (
          <rect
            key={k}
            x={x - 4}
            y={y - 4}
            width={8}
            height={8}
            fill={transform.hover === k ? '#74c0fc' : '#fff'}
            stroke="#000"
            strokeWidth={1}
          />
        );
      })}
      <g stroke="#fff" strokeWidth={1}>
        <circle cx={cx} cy={cy} r={4} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={4} fill="none" />
      </g>
    </svg>
  );
}
