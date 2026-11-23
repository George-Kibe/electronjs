import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor, EditorSnapshot } from '../../engine/editor';
import { MAX_ZOOM, MIN_ZOOM } from '../../engine/render/viewport';

const SIDE = 200;

/**
 * Navigator panel (FR-NAV-05): a thumbnail of the image with the part in view outlined. Click or drag in it
 * to move the view there; the slider zooms.
 */
export function NavigatorPanel({ editor, snap }: { editor: Editor; snap: EditorSnapshot }) {
  const view = useSyncExternalStore(editor.subscribeView, editor.getView);
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  /** The room the thumbnail has (the panel's size, which the dock decides). */
  const [room, setRoom] = useState<{ width: number; height: number }>({ width: SIDE, height: SIDE });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setRoom({ width: Math.max(40, r.width), height: Math.max(30, r.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const doc = snap.doc;
  useEffect(() => {
    // The thumbnail is redrawn a moment after the document changes.
    const timer = window.setTimeout(() => {
      const thumb = editor.documentThumbnail(SIDE);
      const c = canvas.current;
      if (!thumb || !c) return;
      c.width = thumb.width;
      c.height = thumb.height;
      c.getContext('2d')?.putImageData(
        new ImageData(new Uint8ClampedArray(thumb.rgba), thumb.width, thumb.height),
        0,
        0,
      );
      setSize({ width: thumb.width, height: thumb.height });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [editor, doc?.id, snap.docVersion]);
  if (!doc) return null;
  // The thumbnail is shown as large as the panel allows, keeping its proportions.
  const scale = Math.min(room.width / doc.width, room.height / doc.height);
  const shown = { width: Math.round(doc.width * scale), height: Math.round(doc.height * scale) };
  // The visible part of the canvas, in thumbnail px.
  const x0 = Math.max(0, -view.panX / view.zoom);
  const y0 = Math.max(0, -view.panY / view.zoom);
  const x1 = Math.min(doc.width, (view.width - view.panX) / view.zoom);
  const y1 = Math.min(doc.height, (view.height - view.panY) / view.zoom);
  const centreOn = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left) / scale;
    const dy = (e.clientY - r.top) / scale;
    editor.panTo(view.width / 2 - dx * view.zoom, view.height / 2 - dy * view.zoom);
  };
  const log = (z: number) => Math.log10(z);
  return (
    <div className="flex h-full min-h-24 flex-col gap-2 p-2">
      <div ref={area} className="flex min-h-0 flex-1 items-center justify-center">
        <div
          role="img"
          aria-label={`Navigator: showing ${Math.round(x0)}, ${Math.round(y0)} to ${Math.round(x1)}, ${Math.round(y1)}`}
          className="relative cursor-pointer touch-none bg-[conic-gradient(#ccc_25%,#fff_0_50%,#ccc_0_75%,#fff_0)] bg-[length:8px_8px]"
          style={shown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            centreOn(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) centreOn(e);
          }}
        >
          <canvas
            ref={canvas}
            aria-hidden
            className="block h-full w-full"
            data-size={size ? `${size.width}x${size.height}` : ''}
          />
          {x1 > x0 && y1 > y0 && (
            <div
              data-testid="navigator-view"
              className="pointer-events-none absolute border-2 border-red-500"
              style={{
                left: x0 * scale,
                top: y0 * scale,
                width: (x1 - x0) * scale,
                height: (y1 - y0) * scale,
              }}
            />
          )}
        </div>
      </div>
      <label className="flex w-full items-center gap-2">
        <span className="text-ui-muted">Zoom</span>
        <input
          type="range"
          aria-label="Navigator zoom"
          min={log(MIN_ZOOM)}
          max={log(MAX_ZOOM)}
          step={0.01}
          value={log(view.zoom)}
          onChange={(e) => editor.zoomTo(10 ** Number(e.target.value))}
          className="min-w-0 flex-1"
        />
        <span className="w-12 text-right tabular-nums">{Math.round(view.zoom * 100)} %</span>
      </label>
    </div>
  );
}
