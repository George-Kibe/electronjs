import { useRef, useSyncExternalStore, type PointerEvent } from 'react';
import type { Editor } from '../../engine/editor';
import { scrollGeometry } from '../../engine/render/viewport';

const THICKNESS = 10;

/**
 * Pan with scrollbars (FR-NAV-02). The document can scroll until its edge reaches the middle of the view
 * (so any corner can be brought to the centre, as in Photoshop). Subscribes to the view store, so panning
 * re-renders only the scrollbars.
 */
export function Scrollbars({
  editor,
  docWidth,
  docHeight,
}: {
  editor: Editor;
  docWidth: number;
  docHeight: number;
}) {
  const view = useSyncExternalStore(editor.subscribeView, editor.getView);
  if (view.width === 0 || view.height === 0) return null;
  return (
    <>
      <Bar
        axis="x"
        editor={editor}
        size={docWidth * view.zoom}
        pan={view.panX}
        viewSize={view.width}
        other={view.panY}
      />
      <Bar
        axis="y"
        editor={editor}
        size={docHeight * view.zoom}
        pan={view.panY}
        viewSize={view.height}
        other={view.panX}
      />
    </>
  );
}

function Bar(props: {
  axis: 'x' | 'y';
  editor: Editor;
  size: number;
  pan: number;
  viewSize: number;
  other: number;
}) {
  const { axis, editor, size, pan, viewSize, other } = props;
  const drag = useRef<{ from: number; offset: number } | null>(null);
  const track = viewSize - THICKNESS; // leave the corner free
  const g = scrollGeometry(size, pan, viewSize);
  const panFor = (offset: number) => viewSize / 2 - Math.min(g.max, Math.max(0, offset));
  const setPan = (p: number) => (axis === 'x' ? editor.panTo(p, other) : editor.panTo(other, p));
  const coord = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY);
  const horizontal = axis === 'x';
  return (
    <div
      aria-hidden
      className="absolute bg-black/30"
      style={
        horizontal
          ? { left: 0, bottom: 0, width: track, height: THICKNESS }
          : { top: 0, right: 0, height: track, width: THICKNESS }
      }
      onPointerDown={(e) => {
        // Clicking the track pages towards the click.
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        const at = (coord(e) - (horizontal ? box.left : box.top)) / track;
        setPan(panFor(g.offset + Math.sign(at - g.start) * viewSize * 0.9));
      }}
    >
      <div
        data-testid={`scrollbar-${axis}`}
        className="absolute rounded-full bg-[#8a8f96] hover:bg-[#b0b5bb]"
        style={
          horizontal
            ? { left: g.start * track, width: Math.max(20, g.thumb * track), top: 2, bottom: 2 }
            : { top: g.start * track, height: Math.max(20, g.thumb * track), left: 2, right: 2 }
        }
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { from: coord(e), offset: g.offset };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setPan(panFor(d.offset + ((coord(e) - d.from) * g.total) / track));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  );
}
