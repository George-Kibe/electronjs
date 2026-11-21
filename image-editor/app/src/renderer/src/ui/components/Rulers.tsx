import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor, GuideOrientation } from '../../engine/editor';

export type RulerUnits = 'px' | 'in' | 'cm' | '%';

export const RULER = 20; // px

const UNIT_LABELS: Record<RulerUnits, string> = {
  px: 'Pixels',
  in: 'Inches',
  cm: 'Centimetres',
  '%': 'Percent',
};

/** Document px per unit along one axis. */
function pxPerUnit(units: RulerUnits, ppi: number, side: number): number {
  return units === 'in' ? ppi : units === 'cm' ? ppi / 2.54 : units === '%' ? side / 100 : 1;
}

/** Label spacing: the smallest "nice" step at least 60 screen px apart. */
function stepFor(screenPerUnit: number): number {
  const nice = [0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  return nice.find((s) => s * screenPerUnit >= 60) ?? 20000;
}

/**
 * The rulers along the top and left of the canvas (FR-NAV-04), in px, in, cm or % of the canvas. Press and
 * drag out of a ruler to make a guide; right-click to change the units. They lie over the canvas edge.
 */
export function Rulers(props: {
  editor: Editor;
  doc: { width: number; height: number; ppi: number };
  units: RulerUnits;
  cursor: { x: number; y: number } | null;
  onUnits: (u: RulerUnits) => void;
}) {
  const { editor, doc, units, cursor } = props;
  const view = useSyncExternalStore(editor.subscribeView, editor.getView);
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const draw = (canvas: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!canvas) return;
      const length = horizontal ? view.width : view.height;
      canvas.width = Math.round((horizontal ? length : RULER) * dpr);
      canvas.height = Math.round((horizontal ? RULER : length) * dpr);
      const g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const style = getComputedStyle(canvas);
      g.fillStyle = style.getPropertyValue('--ruler-bg') || '#2b2b2b';
      g.fillRect(0, 0, horizontal ? length : RULER, horizontal ? RULER : length);
      g.strokeStyle = g.fillStyle = style.color || '#aaa';
      g.font = '9px system-ui, sans-serif';
      g.lineWidth = 1;
      const unit = pxPerUnit(units, doc.ppi, horizontal ? doc.width : doc.height);
      const screenPerUnit = unit * view.zoom;
      const step = stepFor(screenPerUnit);
      const pan = horizontal ? view.panX : view.panY;
      const first = Math.floor(-pan / screenPerUnit / step) * step;
      g.beginPath();
      for (let v = first; v * screenPerUnit + pan < length; v += step / 5) {
        const at = Math.round(v * screenPerUnit + pan) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const tick = major ? RULER : RULER / 3;
        if (horizontal) {
          g.moveTo(at, RULER - tick);
          g.lineTo(at, RULER);
        } else {
          g.moveTo(RULER - tick, at);
          g.lineTo(RULER, at);
        }
        if (major) {
          const label = `${Number(v.toFixed(3))}`;
          if (horizontal) g.fillText(label, at + 2, 9);
          else {
            g.save();
            g.translate(9, at + 2);
            g.rotate(-Math.PI / 2);
            g.textAlign = 'right';
            g.fillText(label, 0, 0);
            g.restore();
          }
        }
      }
      g.stroke();
      // Where the pointer is.
      if (cursor) {
        const at = Math.round((horizontal ? cursor.x : cursor.y) * view.zoom + pan) + 0.5;
        g.strokeStyle = '#74c0fc';
        g.beginPath();
        if (horizontal) {
          g.moveTo(at, 0);
          g.lineTo(at, RULER);
        } else {
          g.moveTo(0, at);
          g.lineTo(RULER, at);
        }
        g.stroke();
      }
    };
    draw(top.current, true);
    draw(left.current, false);
  }, [view, units, doc.width, doc.height, doc.ppi, cursor]);

  const drag = (orientation: GuideOrientation) => ({
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      editor.beginGuideFromRuler(orientation);
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) editor.dragGuideTo(e.clientX, e.clientY);
    },
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) editor.endGuideDrag();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    },
  });
  return (
    <>
      <canvas
        ref={top}
        role="img"
        aria-label={`Horizontal ruler (${UNIT_LABELS[units]}); drag down from it to make a guide`}
        className="text-ui-muted absolute top-0 left-0 z-10 cursor-row-resize [--ruler-bg:var(--color-ui-panel)]"
        style={{ width: view.width, height: RULER }}
        {...drag('horizontal')}
      />
      <canvas
        ref={left}
        role="img"
        aria-label={`Vertical ruler (${UNIT_LABELS[units]}); drag right from it to make a guide`}
        className="text-ui-muted absolute top-0 left-0 z-10 cursor-col-resize [--ruler-bg:var(--color-ui-panel)]"
        style={{ width: RULER, height: view.height }}
        {...drag('vertical')}
      />
      {menu && (
        <ul
          role="menu"
          aria-label="Ruler units"
          style={{ left: menu.x, top: menu.y }}
          className="bg-ui-panel border-ui-border fixed z-50 min-w-36 rounded border py-1 shadow-lg"
          onMouseLeave={() => setMenu(null)}
        >
          {(Object.keys(UNIT_LABELS) as RulerUnits[]).map((u) => (
            <li key={u} role="none">
              <button
                role="menuitemradio"
                aria-checked={u === units}
                className="hover:bg-ui-bg flex w-full px-3 py-1 text-left"
                onClick={() => {
                  setMenu(null);
                  props.onUnits(u);
                }}
              >
                {UNIT_LABELS[u]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
