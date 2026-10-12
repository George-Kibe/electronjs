import type { CropRect } from '../doc/geometry';

/**
 * Crop tool geometry (FR-TRF-01, docs/03 §5.5): the crop rectangle in document px, dragged by its 8 handles
 * or moved, optionally locked to an aspect ratio, and kept inside the canvas. Pure, so it is unit-tested.
 */

export const CROP_RATIOS = ['free', 'original', '1:1', '4:5', '5:4', '2:3', '3:2', '9:16', '16:9'] as const;
export type CropRatio = (typeof CROP_RATIOS)[number];

export const RATIO_LABELS: Record<CropRatio, string> = {
  free: 'Free',
  original: 'Original ratio',
  '1:1': '1 : 1 (square)',
  '4:5': '4 : 5 (portrait)',
  '5:4': '5 : 4',
  '2:3': '2 : 3',
  '3:2': '3 : 2',
  '9:16': '9 : 16 (story)',
  '16:9': '16 : 9',
};

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
type Canvas = { width: number; height: number };

/** Width / height for a ratio preset, or null when free. */
export function ratioValue(ratio: CropRatio, canvas: Canvas): number | null {
  if (ratio === 'free') return null;
  if (ratio === 'original') return canvas.width / canvas.height;
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  return w / h;
}

/** The largest rectangle of `ratio` centred on `rect`'s centre, inside both `rect` and the canvas. */
export function fitRatio(rect: CropRect, ratio: number | null, canvas: Canvas): CropRect {
  if (ratio === null) return clampRect(rect, canvas);
  let width = Math.min(rect.width, canvas.width);
  let height = width / ratio;
  if (height > Math.min(rect.height, canvas.height)) {
    height = Math.min(rect.height, canvas.height);
    width = height * ratio;
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return clampRect({ x: cx - width / 2, y: cy - height / 2, width, height }, canvas);
}

/** Moves (never resizes) a rectangle so it lies inside the canvas; shrinks only if it is larger. */
export function clampRect(r: CropRect, canvas: Canvas): CropRect {
  const width = Math.min(r.width, canvas.width);
  const height = Math.min(r.height, canvas.height);
  return {
    x: Math.min(Math.max(0, r.x), canvas.width - width),
    y: Math.min(Math.max(0, r.y), canvas.height - height),
    width,
    height,
  };
}

/** Rounds to whole pixels (what the crop commits), staying inside the canvas. */
export function roundRect(r: CropRect, canvas: Canvas): CropRect {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(canvas.width - x, Math.round(r.x + r.width) - x)),
    height: Math.max(1, Math.min(canvas.height - y, Math.round(r.y + r.height) - y)),
  };
}

const MIN = 1;

/**
 * The rectangle after dragging `handle` of `start` by (dx, dy) document px. Edges stop at the canvas and at
 * 1 px; with a ratio, side handles grow the other dimension around the centre and corners keep the
 * opposite corner fixed.
 */
export function dragHandle(
  start: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  canvas: Canvas,
): CropRect {
  if (handle === 'move') return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, canvas);
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.width;
  let y1 = start.y + start.height;
  if (handle.includes('w')) x0 = Math.min(x1 - MIN, Math.max(0, x0 + dx));
  if (handle.includes('e')) x1 = Math.max(x0 + MIN, Math.min(canvas.width, x1 + dx));
  if (handle.includes('n')) y0 = Math.min(y1 - MIN, Math.max(0, y0 + dy));
  if (handle.includes('s')) y1 = Math.max(y0 + MIN, Math.min(canvas.height, y1 + dy));
  if (ratio === null) return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

  const horizontal = handle === 'e' || handle === 'w';
  const vertical = handle === 'n' || handle === 's';
  let width = x1 - x0;
  let height = y1 - y0;
  if (horizontal) height = width / ratio;
  else if (vertical) width = height * ratio;
  else if (width / height > ratio) width = height * ratio;
  else height = width / ratio;
  // Anchor: the opposite edge/corner stays; side handles grow the other axis around the centre.
  const ax = handle.includes('w') ? x1 : handle.includes('e') ? x0 : start.x + start.width / 2;
  const ay = handle.includes('n') ? y1 : handle.includes('s') ? y0 : start.y + start.height / 2;
  // Room available from the anchor, inside the canvas.
  const roomX = handle.includes('w')
    ? ax
    : handle.includes('e')
      ? canvas.width - ax
      : 2 * Math.min(ax, canvas.width - ax);
  const roomY = handle.includes('n')
    ? ay
    : handle.includes('s')
      ? canvas.height - ay
      : 2 * Math.min(ay, canvas.height - ay);
  const scale = Math.min(1, roomX / width, roomY / height);
  width *= scale;
  height *= scale;
  const x = handle.includes('w') ? ax - width : handle.includes('e') ? ax : ax - width / 2;
  const y = handle.includes('n') ? ay - height : handle.includes('s') ? ay : ay - height / 2;
  return { x, y, width, height };
}

/** A new rectangle dragged from `a` to `b` (Photoshop: drag outside the current crop box), constrained. */
export function rectFromDrag(
  a: { x: number; y: number },
  b: { x: number; y: number },
  ratio: number | null,
  canvas: Canvas,
): CropRect {
  const start = {
    x: Math.min(Math.max(0, a.x), canvas.width),
    y: Math.min(Math.max(0, a.y), canvas.height),
    width: 0,
    height: 0,
  };
  const handle: Handle = `${b.y < start.y ? 'n' : 's'}${b.x < start.x ? 'w' : 'e'}` as Handle;
  return dragHandle(start, handle, b.x - start.x, b.y - start.y, ratio, canvas);
}

/** Which handle (or the inside) is under the point, within `tolerance` document px; null if none. */
export function hitHandle(r: CropRect, p: { x: number; y: number }, tolerance: number): Handle | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const x1 = r.x + r.width;
  const y1 = r.y + r.height;
  const inX = p.x >= r.x - tolerance && p.x <= x1 + tolerance;
  const inY = p.y >= r.y - tolerance && p.y <= y1 + tolerance;
  if (!inX || !inY) return null;
  const v = near(p.y, r.y) ? 'n' : near(p.y, y1) ? 's' : '';
  const h = near(p.x, r.x) ? 'w' : near(p.x, x1) ? 'e' : '';
  if (v || h) return `${v}${h}` as Handle;
  return p.x > r.x && p.x < x1 && p.y > r.y && p.y < y1 ? 'move' : null;
}

/**
 * Straighten: the clockwise rotation (degrees) that makes the line a→b horizontal or vertical, whichever
 * is nearer (−45°…45°).
 */
export function straightenAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  // Nearest multiple of 90° to the line's direction; rotate by the difference, the other way.
  const target = Math.round(deg / 90) * 90;
  return target - deg;
}

export const HANDLE_CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  move: 'move',
};
