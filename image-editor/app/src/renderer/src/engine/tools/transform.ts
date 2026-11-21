import { invert, multiply, type Affine } from '../ops/affine';

/**
 * Free Transform (Ctrl+T, FR-TRF-04): the box around the layers' content, transformed by scale, skew and
 * rotation about its centre, then moved. Pure geometry; the editor tracks the gesture and the options bar
 * edits the same parameters.
 */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export type TransformParams = {
  /** Movement of the box centre, document px. */
  tx: number;
  ty: number;
  /** Scale factors; negative = flipped. */
  sx: number;
  sy: number;
  /** Rotation, radians, clockwise on screen. */
  angle: number;
  /** Horizontal and vertical skew, radians. */
  skewX: number;
  skewY: number;
};

export const NO_TRANSFORM: TransformParams = { tx: 0, ty: 0, sx: 1, sy: 1, angle: 0, skewX: 0, skewY: 0 };

export const centre = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

/** The rotation × skew part (no scale, no translation). */
function rotateSkew(p: TransformParams): Affine {
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const rotate: Affine = [cos, sin, -sin, cos, 0, 0];
  const skew: Affine = [1, Math.tan(p.skewY), Math.tan(p.skewX), 1, 0, 0];
  return multiply(rotate, skew);
}

/** Source document px → destination document px. */
export function transformMatrix(box: Box, p: TransformParams): Affine {
  const [cx, cy] = centre(box);
  const toOrigin: Affine = [1, 0, 0, 1, -cx, -cy];
  const scale: Affine = [p.sx, 0, 0, p.sy, 0, 0];
  const back: Affine = [1, 0, 0, 1, cx + p.tx, cy + p.ty];
  return multiply(back, multiply(rotateSkew(p), multiply(scale, toOrigin)));
}

export type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Box-relative position (0..1) of each handle. */
export const HANDLE_AT: Record<TransformHandle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

const at = (box: Box, u: number, v: number): [number, number] => [
  box.x0 + (box.x1 - box.x0) * u,
  box.y0 + (box.y1 - box.y0) * v,
];

const map = (m: Affine, [x, y]: [number, number]): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** Where the transformed box's corners and handles are, in document px. */
export function transformedHandles(box: Box, p: TransformParams): Record<TransformHandle, [number, number]> {
  const m = transformMatrix(box, p);
  return Object.fromEntries(
    (Object.keys(HANDLE_AT) as TransformHandle[]).map((h) => [h, map(m, at(box, ...HANDLE_AT[h]))]),
  ) as Record<TransformHandle, [number, number]>;
}

export type TransformHit = TransformHandle | 'move' | 'rotate';

/**
 * What a press at document point `pt` grabs: a handle within `slop` document px, inside the box (move), or
 * outside it (rotate).
 */
export function hitTransform(box: Box, p: TransformParams, pt: [number, number], slop: number): TransformHit {
  const handles = transformedHandles(box, p);
  for (const h of Object.keys(handles) as TransformHandle[]) {
    const [x, y] = handles[h];
    if (Math.hypot(pt[0] - x, pt[1] - y) <= slop) return h;
  }
  try {
    const [lx, ly] = map(invert(transformMatrix(box, p)), pt);
    if (lx >= box.x0 && lx <= box.x1 && ly >= box.y0 && ly <= box.y1) return 'move';
  } catch {
    // a flat box: nothing is inside
  }
  return 'rotate';
}

/**
 * The parameters after dragging `hit` from `from` to `to` (document px), starting at `start` (docs/03 §5.4).
 * Corners scale proportionally unless `shift` is held (as in current Photoshop); edges scale one axis. `alt`
 * scales about the centre instead of the opposite handle. `shift` also gives 15° rotation steps and
 * horizontal/vertical moves; `ctrl` on an edge skews.
 */
export function dragTransform(
  box: Box,
  start: TransformParams,
  hit: TransformHit,
  from: [number, number],
  to: [number, number],
  mods: { shift: boolean; ctrl: boolean; alt?: boolean },
): TransformParams {
  const [cx, cy] = centre(box);
  if (hit === 'move') {
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    if (mods.shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    return { ...start, tx: start.tx + Math.round(dx), ty: start.ty + Math.round(dy) };
  }
  const c: [number, number] = [cx + start.tx, cy + start.ty];
  if (hit === 'rotate') {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    const a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
    let angle = start.angle + (a1 - a0);
    if (mods.shift) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    return { ...start, angle };
  }
  const [hu, hv] = HANDLE_AT[hit];
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  // The pointer in the box's own frame (rotation and skew undone), relative to its centre.
  const rs = invert(rotateSkew(start));
  const [lx, ly] = map(rs, [to[0] - c[0], to[1] - c[1]]);
  if (mods.ctrl && (hit === 'n' || hit === 's' || hit === 'e' || hit === 'w')) {
    // Skew: an edge slides along itself.
    const [fx, fy] = map(rs, [from[0] - c[0], from[1] - c[1]]);
    if (hit === 'n' || hit === 's') {
      const lever = (hv - 0.5) * h * start.sy || 1;
      return { ...start, skewX: start.skewX + Math.atan2(lx - fx, lever) * Math.sign(lever) };
    }
    const lever = (hu - 0.5) * w * start.sx || 1;
    return { ...start, skewY: start.skewY + Math.atan2(ly - fy, lever) * Math.sign(lever) };
  }
  // Scale: the opposite handle (or with Alt the centre) stays where it is.
  const ou = mods.alt ? 0.5 : 1 - hu;
  const ov = mods.alt ? 0.5 : 1 - hv;
  const anchor = map(transformMatrix(box, start), at(box, ou, ov));
  const [ax, ay] = map(rs, [anchor[0] - c[0], anchor[1] - c[1]]);
  let sx = hu === 0.5 ? start.sx : (lx - ax) / ((hu - ou) * w || 1);
  let sy = hv === 0.5 ? start.sy : (ly - ay) / ((hv - ov) * h || 1);
  if (!mods.shift && hu !== 0.5 && hv !== 0.5) {
    const k = Math.max(Math.abs(sx / start.sx), Math.abs(sy / start.sy));
    sx = Math.sign(sx || 1) * Math.abs(start.sx) * k;
    sy = Math.sign(sy || 1) * Math.abs(start.sy) * k;
  }
  const next = { ...start, sx, sy };
  // Re-centre so the anchor stays fixed.
  const moved = map(transformMatrix(box, next), at(box, ou, ov));
  return { ...next, tx: next.tx + anchor[0] - moved[0], ty: next.ty + anchor[1] - moved[1] };
}

const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

/** A curved double arrow (CSS has no rotate cursor). */
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
    "<g fill='none' stroke-linecap='round'><path d='M6 17A8 8 0 0 1 17 6' stroke='white' stroke-width='4'/>" +
    "<path d='M6 17A8 8 0 0 1 17 6' stroke='black' stroke-width='1.5'/></g>" +
    "<path d='M14 2l6 4-6 4z M2 14l4 6 4-6z' fill='black' stroke='white' stroke-width='1'/></svg>",
)}") 12 12, crosshair`;

/** The CSS cursor for what a press would grab: resize arrows follow the box's rotation. */
export function transformCursor(box: Box, p: TransformParams, hit: TransformHit): string {
  if (hit === 'move') return 'move';
  if (hit === 'rotate') return ROTATE_CURSOR;
  const [hx, hy] = transformedHandles(box, p)[hit];
  const [cx, cy] = centre(box);
  const octant = Math.round(Math.atan2(hy - cy - p.ty, hx - cx - p.tx) / (Math.PI / 4));
  return RESIZE_CURSORS[((octant % 4) + 4) % 4]!;
}
