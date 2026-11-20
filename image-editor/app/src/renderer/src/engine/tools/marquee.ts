import type { Bounds, SelectionOp } from '../doc/selection';

/**
 * Rectangular and Elliptical Marquee (M, Shift+M; FR-SEL-01/04). Pure geometry: the editor tracks the
 * gesture, this turns it into a pixel-aligned box.
 */
export type MarqueeShape = 'rect' | 'ellipse';
/** Normal drag, a fixed width:height ratio, or a fixed size in pixels. */
export type MarqueeStyle = 'normal' | 'ratio' | 'size';

export type MarqueeOptions = {
  shape: MarqueeShape;
  /** The options bar's mode; Shift / Alt at mouse-down override it for one drag. */
  mode: SelectionOp;
  style: MarqueeStyle;
  ratioW: number;
  ratioH: number;
  width: number;
  height: number;
  /** Soft ellipse edges (the rectangle is pixel-aligned and always hard). */
  antiAlias: boolean;
};

export const DEFAULT_MARQUEE: MarqueeOptions = {
  shape: 'rect',
  mode: 'replace',
  style: 'normal',
  ratioW: 1,
  ratioH: 1,
  width: 64,
  height: 64,
  antiAlias: true,
};

/** Shift adds, Alt subtracts, both intersect (Photoshop); with neither, the options bar's mode. */
export function dragMode(base: SelectionOp, shift: boolean, alt: boolean): SelectionOp {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return base;
}

export type MarqueeDrag = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  /** Shift: a square or circle. */
  constrain: boolean;
  /** Alt: the start point is the centre. */
  fromCentre: boolean;
};

/** The box for a drag, in whole document pixels (not yet clipped to the canvas). */
export function marqueeRect(
  drag: MarqueeDrag,
  o: Pick<MarqueeOptions, 'style' | 'ratioW' | 'ratioH' | 'width' | 'height'>,
): Bounds {
  const { start, current } = drag;
  if (o.style === 'size') {
    // A fixed box follows the pointer: its corner (or centre, with Alt) is under it.
    const w = Math.max(1, Math.round(o.width));
    const h = Math.max(1, Math.round(o.height));
    const x0 = Math.round(drag.fromCentre ? current.x - w / 2 : current.x);
    const y0 = Math.round(drag.fromCentre ? current.y - h / 2 : current.y);
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  }
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (o.style === 'ratio' || drag.constrain) {
    const rw = o.style === 'ratio' ? Math.max(1e-6, o.ratioW) : 1;
    const rh = o.style === 'ratio' ? Math.max(1e-6, o.ratioH) : 1;
    const s = Math.max(Math.abs(dx) / rw, Math.abs(dy) / rh);
    dx = Math.sign(dx || 1) * s * rw;
    dy = Math.sign(dy || 1) * s * rh;
  }
  const [ax, ay, bx, by] = drag.fromCentre
    ? [start.x - dx, start.y - dy, start.x + dx, start.y + dy]
    : [start.x, start.y, start.x + dx, start.y + dy];
  return {
    x0: Math.round(Math.min(ax, bx)),
    y0: Math.round(Math.min(ay, by)),
    x1: Math.round(Math.max(ax, bx)),
    y1: Math.round(Math.max(ay, by)),
  };
}

/** History label for a marquee drag (shown in the History panel). */
export function marqueeLabel(shape: MarqueeShape): string {
  return shape === 'rect' ? 'Rectangular Marquee' : 'Elliptical Marquee';
}
