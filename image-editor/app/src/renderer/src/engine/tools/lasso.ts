import type { Point } from '../doc/selection';
import type { SelectionOp } from '../doc/selection';

/**
 * Lasso and Polygonal Lasso (L, Shift+L; FR-SEL-02). Pure helpers: the editor tracks the gesture and fills
 * the closed outline with doc/selection.ts polygonMask.
 */
export type LassoKind = 'freehand' | 'polygon';

export type LassoOptions = {
  kind: LassoKind;
  mode: SelectionOp;
  antiAlias: boolean;
};

export const DEFAULT_LASSO: LassoOptions = { kind: 'freehand', mode: 'replace', antiAlias: true };

/** Closing radius around the first vertex of a polygon, in screen pixels. */
export const CLOSE_RADIUS_PX = 6;

/** Adds a freehand point unless it is within `minStep` of the last one (pointer events repeat a lot). */
export function addPoint(points: Point[], p: Point, minStep = 0.5): void {
  const last = points.at(-1);
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minStep) return;
  points.push(p);
}

/** A click near the first vertex closes the polygon (at least 3 vertices). `zoom` maps doc px to screen. */
export function closesPolygon(points: readonly Point[], p: Point, zoom: number): boolean {
  const first = points[0];
  if (!first || points.length < 3) return false;
  return Math.hypot(p[0] - first[0], p[1] - first[1]) * zoom <= CLOSE_RADIUS_PX;
}

/** The outline to fill: consecutive duplicates dropped (a double-click adds its point twice). */
export function lassoOutline(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

export function lassoLabel(kind: LassoKind): string {
  return kind === 'freehand' ? 'Lasso' : 'Polygonal Lasso';
}
