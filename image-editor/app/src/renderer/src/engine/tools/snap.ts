import type { Document, Layer } from '../doc/document';
import { contentBounds } from '../ops/canvas';

/**
 * Snapping (FR-NAV-04): moving things line up with guides, the canvas edges and centre, and other layers'
 * edges when they come within a few screen pixels. Pure; the editor gathers the targets when a drag starts.
 */
export type SnapTargets = { x: number[]; y: number[] };

/**
 * The offset that brings the nearest of `values` onto a target within `threshold`, and that target (null:
 * nothing close enough, offset 0).
 */
export function snapOffset(
  values: readonly number[],
  targets: readonly number[],
  threshold: number,
): { offset: number; target: number | null } {
  let best = { offset: 0, target: null as number | null, distance: threshold };
  for (const v of values)
    for (const t of targets) {
      const d = Math.abs(t - v);
      if (d <= best.distance) best = { offset: t - v, target: t, distance: d };
    }
  return { offset: best.offset, target: best.target };
}

/**
 * What a drag can snap to: the guides, the canvas edges and centre, and the edges of every visible raster
 * layer's content except `exclude` (the layers being moved).
 */
export function snapTargets(doc: Document, exclude: ReadonlySet<string> = new Set()): SnapTargets {
  const x = [0, doc.width / 2, doc.width, ...doc.meta.guides.vertical];
  const y = [0, doc.height / 2, doc.height, ...doc.meta.guides.horizontal];
  const visit = (layers: readonly Layer[]) => {
    for (const l of layers) {
      if (!l.visible) continue;
      if (l.type === 'group') visit(l.children);
      else if (l.type === 'raster' && !exclude.has(l.id)) {
        const b = contentBounds([l.tiles]);
        if (b) {
          x.push(b.x0, b.x1);
          y.push(b.y0, b.y1);
        }
      }
    }
  };
  visit(doc.layers);
  return { x, y };
}
