import type { RGBA, ShapeKind, ShapeModel } from '../doc/document';
import { TileGrid } from '../tiles/tile';

/**
 * Shapes (FR-PNT-08). The engine keeps the model; the page draws it (lib/shape-render.ts, canvas paths),
 * injected like the text renderer. Without one (headless tests), shape layers render nothing.
 */
export type ShapeRenderer = (shape: ShapeModel, origin: { x: number; y: number }) => TileGrid;

/** The Shape tool's options: the kind to draw and the look (applied to a selected shape layer too). */
export type ShapeStyle = {
  kind: ShapeKind;
  fill: RGBA | null;
  stroke: RGBA | null;
  strokeWidth: number;
  strokeAlign: 'inside' | 'center' | 'outside';
  dash: 'solid' | 'dashed' | 'dotted';
  radius: number;
  sides: number;
  points: number;
  /** Star: inner radius as a fraction of the outer. */
  inner: number;
  arrowStart: boolean;
  arrowEnd: boolean;
};

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  kind: 'rect',
  fill: [0, 0, 0, 1],
  stroke: null,
  strokeWidth: 4,
  strokeAlign: 'inside',
  dash: 'solid',
  radius: 20,
  sides: 5,
  points: 5,
  inner: 0.5,
  arrowStart: false,
  arrowEnd: false,
};

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rect',
  'rounded-rect',
  'ellipse',
  'line',
  'polygon',
  'star',
];
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  'rounded-rect': 'Rounded Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  polygon: 'Polygon',
  star: 'Star',
};

const DASHES: Record<ShapeStyle['dash'], number[] | undefined> = {
  solid: undefined,
  dashed: [4, 2],
  dotted: [0.01, 2],
};

/**
 * The model for a shape of `style` in a box of w × h from the origin. A line goes from the origin to
 * (w, h) (either may be negative), so its "box" is the drag itself.
 */
export function shapeModel(style: ShapeStyle, w: number, h: number): ShapeModel {
  const params: Record<string, number> = { w, h };
  if (style.kind === 'rounded-rect') params['radius'] = style.radius;
  if (style.kind === 'polygon') params['sides'] = style.sides;
  if (style.kind === 'star') {
    params['points'] = style.points;
    params['inner'] = style.inner;
  }
  if (style.kind === 'line') {
    params['x2'] = w;
    params['y2'] = h;
    params['arrowStart'] = style.arrowStart ? 1 : 0;
    params['arrowEnd'] = style.arrowEnd ? 1 : 0;
  }
  const dash = DASHES[style.dash];
  // A line has no inside: it is all stroke.
  const stroke =
    style.kind === 'line'
      ? {
          color: style.stroke ?? style.fill ?? [0, 0, 0, 1],
          width: style.strokeWidth,
          align: 'center' as const,
        }
      : style.stroke && { color: style.stroke, width: style.strokeWidth, align: style.strokeAlign };
  return {
    kind: style.kind,
    params,
    fill: style.kind === 'line' || !style.fill ? { type: 'none' } : { type: 'solid', color: style.fill },
    stroke: stroke ? { ...stroke, ...(dash ? { dash } : {}) } : null,
  };
}

/** The style a shape layer was drawn with (what the options bar shows while it is selected). */
export function styleOfShape(shape: ShapeModel, base: ShapeStyle): ShapeStyle {
  const p = shape.params;
  const dash = !shape.stroke?.dash ? 'solid' : shape.stroke.dash[0]! < 0.5 ? 'dotted' : 'dashed';
  return {
    ...base,
    kind: shape.kind,
    fill: shape.kind === 'line' ? base.fill : shape.fill.type === 'solid' ? (shape.fill.color ?? null) : null,
    stroke: shape.stroke?.color ?? null,
    strokeWidth: shape.stroke?.width ?? base.strokeWidth,
    strokeAlign: shape.stroke?.align ?? base.strokeAlign,
    dash,
    radius: p['radius'] ?? base.radius,
    sides: p['sides'] ?? base.sides,
    points: p['points'] ?? base.points,
    inner: p['inner'] ?? base.inner,
    arrowStart: (p['arrowStart'] ?? 0) > 0,
    arrowEnd: (p['arrowEnd'] ?? 0) > 0,
  };
}

/** The same shape (kind and size) in another style: changing the options of a selected shape layer. */
export function reshaped(shape: ShapeModel, style: ShapeStyle): ShapeModel {
  const w = shape.kind === 'line' ? (shape.params['x2'] ?? 0) : (shape.params['w'] ?? 0);
  const h = shape.kind === 'line' ? (shape.params['y2'] ?? 0) : (shape.params['h'] ?? 0);
  return shapeModel({ ...style, kind: shape.kind }, w, h);
}

export const emptyShape = (): TileGrid => new TileGrid();

const n = (v: number) => Math.round(v * 1000) / 1000;

/** Polygon and star corners in a w × h box, starting at the top. */
function corners(count: number, w: number, h: number, inner?: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const steps = inner === undefined ? count : count * 2;
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    const r = inner !== undefined && i % 2 === 1 ? inner : 1;
    out.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return out;
}

/**
 * The shape's outline as SVG path data, in px from the layer's origin: the canvas renderer draws it
 * (Path2D) and the overlay shows it while dragging, so both are the same shape.
 */
export function shapePath(shape: ShapeModel): string {
  const p = shape.params;
  const w = p['w'] ?? 0;
  const h = p['h'] ?? 0;
  switch (shape.kind) {
    case 'rect':
      return `M0 0H${n(w)}V${n(h)}H0Z`;
    case 'rounded-rect': {
      const r = Math.max(0, Math.min(p['radius'] ?? 0, Math.abs(w) / 2, Math.abs(h) / 2));
      if (r === 0) return `M0 0H${n(w)}V${n(h)}H0Z`;
      return (
        `M${n(r)} 0H${n(w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)}V${n(h - r)}` +
        `A${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)}H${n(r)}A${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)}` +
        `V${n(r)}A${n(r)} ${n(r)} 0 0 1 ${n(r)} 0Z`
      );
    }
    case 'ellipse':
      return `M0 ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(w)} ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 0 ${n(h / 2)}Z`;
    case 'polygon':
    case 'star': {
      const pts =
        shape.kind === 'polygon'
          ? corners(Math.round(p['sides'] ?? 5), w, h)
          : corners(Math.round(p['points'] ?? 5), w, h, p['inner'] ?? 0.5);
      return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
    }
    case 'line':
      return `M0 0L${n(p['x2'] ?? w)} ${n(p['y2'] ?? h)}`;
  }
}

/** A line's arrowheads as closed SVG paths (filled with the stroke colour). */
export function arrowPaths(shape: ShapeModel): string[] {
  if (shape.kind !== 'line' || !shape.stroke) return [];
  const x2 = shape.params['x2'] ?? 0;
  const y2 = shape.params['y2'] ?? 0;
  const len = Math.hypot(x2, y2);
  if (len === 0) return [];
  const ux = x2 / len;
  const uy = y2 / len;
  const size = Math.max(6, shape.stroke.width * 3);
  const head = (tx: number, ty: number, dx: number, dy: number) => {
    const bx = tx - dx * size * 1.5;
    const by = ty - dy * size * 1.5;
    return `M${n(tx)} ${n(ty)}L${n(bx - dy * size)} ${n(by + dx * size)}L${n(bx + dy * size)} ${n(by - dx * size)}Z`;
  };
  const out: string[] = [];
  if ((shape.params['arrowEnd'] ?? 0) > 0) out.push(head(x2, y2, ux, uy));
  if ((shape.params['arrowStart'] ?? 0) > 0) out.push(head(0, 0, -ux, -uy));
  return out;
}

/** Where the shape can paint, in px from the origin: its box, the stroke beyond it and arrowheads. */
export function shapeBounds(shape: ShapeModel): { x0: number; y0: number; x1: number; y1: number } {
  const p = shape.params;
  const w = shape.kind === 'line' ? (p['x2'] ?? 0) : (p['w'] ?? 0);
  const h = shape.kind === 'line' ? (p['y2'] ?? 0) : (p['h'] ?? 0);
  const s = shape.stroke;
  const out = !s ? 0 : s.align === 'outside' ? s.width : s.align === 'center' ? s.width / 2 : 0;
  const pad = Math.ceil(out + (shape.kind === 'line' && s ? Math.max(6, s.width * 3) * 2 : 0)) + 2;
  return {
    x0: Math.min(0, w) - pad,
    y0: Math.min(0, h) - pad,
    x1: Math.max(0, w) + pad,
    y1: Math.max(0, h) + pad,
  };
}
