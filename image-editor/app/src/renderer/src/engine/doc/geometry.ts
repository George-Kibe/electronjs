import { tileRange } from '@shared/iep-schema';
import { clipGrid, flipGrid, rotateGrid, type TileRange, type Turns } from '../ops/canvas';
import { TILE_BYTES, TILE_SIZE, TileGrid } from '../tiles/tile';
import { cloneTree, TreeCommand, type CanvasGeometry, type TreeEdit } from './commands';
import type { Document, Layer, RasterLayer } from './document';
import { translateGrid } from './translate';

/**
 * Document-level geometry (FR-TRF-01..03): crop, canvas size, rotate and flip the canvas, and installing
 * resampled pixels (image size, arbitrary rotation, straighten) computed in the ops worker. Every raster
 * layer is transformed, hidden and locked ones included (as in Photoshop). One TreeCommand each, so undo
 * restores the previous tiles, size and guides exactly.
 */

type Guides = CanvasGeometry['guides'];

/** Replaces every raster layer's tiles via `transform` and sets the new canvas geometry. */
function transformRasters(
  label: string,
  canvas: (doc: Document) => CanvasGeometry,
  /** `old` is the canvas size before the edit. */
  transform: (layer: RasterLayer, range: TileRange, old: { width: number; height: number }) => TileGrid,
): TreeCommand {
  return new TreeCommand(label, (d): TreeEdit => {
    const old = { width: d.width, height: d.height };
    const geometry = canvas(d);
    const range = tileRange(geometry.width, geometry.height, TILE_SIZE);
    let newTileBytes = 0;
    const visit = (list: Layer[]): Layer[] =>
      list.map((l) => {
        if (l.type === 'group') {
          l.children = visit(l.children);
          return l;
        }
        const tiles = transform(l, range, old);
        const shared = new Set([...l.tiles.entries()].map(([, t]) => t.id));
        for (const [, t] of tiles.entries()) if (!shared.has(t.id)) newTileBytes += TILE_BYTES;
        return { ...l, tiles } as RasterLayer;
      });
    return {
      root: visit(cloneTree(d.layers)),
      activeLayerId: d.activeLayerId,
      newTileBytes,
      canvas: geometry,
    };
  });
}

const shiftGuides = (g: Guides, dx: number, dy: number): Guides => ({
  horizontal: g.horizontal.map((y) => y + dy),
  vertical: g.vertical.map((x) => x + dx),
});

/** Image › Image Rotation › 90° CW / 180° / 90° CCW (turns = 1 / 2 / 3). Bit-exact. */
export function rotateCanvas(_doc: Document, turns: Turns): TreeCommand {
  const label =
    turns === 2 ? 'Rotate 180°' : turns === 1 ? 'Rotate 90° Clockwise' : 'Rotate 90° Counter Clockwise';
  return transformRasters(
    label,
    (d) => {
      const { width: W, height: H } = d;
      const g = d.meta.guides;
      if (turns === 2)
        return {
          width: W,
          height: H,
          guides: { horizontal: g.horizontal.map((y) => H - y), vertical: g.vertical.map((x) => W - x) },
        };
      // Continuous coordinates: 90° CW maps (x, y) → (H − y, x); 90° CCW maps (x, y) → (y, W − x).
      const guides =
        turns === 1
          ? { horizontal: g.vertical.slice(), vertical: g.horizontal.map((y) => H - y) }
          : { horizontal: g.vertical.map((x) => W - x), vertical: g.horizontal.slice() };
      return { width: H, height: W, guides };
    },
    (l, range, old) => rotateGrid(l.tiles, old.width, old.height, turns, range),
  );
}

/** Image › Image Rotation › Flip Canvas Horizontal / Vertical. Bit-exact. */
export function flipCanvas(_doc: Document, axis: 'horizontal' | 'vertical'): TreeCommand {
  return transformRasters(
    axis === 'horizontal' ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical',
    (d) => {
      const g = d.meta.guides;
      return {
        width: d.width,
        height: d.height,
        guides:
          axis === 'horizontal'
            ? { horizontal: g.horizontal.slice(), vertical: g.vertical.map((x) => d.width - x) }
            : { horizontal: g.horizontal.map((y) => d.height - y), vertical: g.vertical.slice() },
      };
    },
    (l, range, old) => flipGrid(l.tiles, old.width, old.height, axis, range),
  );
}

/** Where existing pixels sit in a resized canvas: 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export type Anchor = { x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 };

/** Offset of the old canvas inside a new one of the given size, for an anchor (whole pixels). */
export function anchorOffset(
  from: { width: number; height: number },
  to: { width: number; height: number },
  anchor: Anchor,
): [number, number] {
  // `+ 0` turns −0 (e.g. −10 × 0) into 0.
  return [
    Math.round((to.width - from.width) * anchor.x) + 0,
    Math.round((to.height - from.height) * anchor.y) + 0,
  ];
}

/**
 * Image › Canvas Size (FR-TRF-02): grows or shrinks the canvas around the anchor. New area is transparent.
 * Pixels that end up outside the canvas are kept (within the usual margin), like a crop without deleting.
 */
export function resizeCanvas(
  doc: Document,
  width: number,
  height: number,
  anchor: Anchor,
): TreeCommand | null {
  if (width === doc.width && height === doc.height) return null;
  const [dx, dy] = anchorOffset(doc, { width, height }, anchor);
  return transformRasters(
    'Canvas Size',
    (d) => ({ width, height, guides: shiftGuides(d.meta.guides, dx, dy) }),
    (l, range) => translateGrid(l.tiles, dx, dy, range),
  );
}

export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * Crop (FR-TRF-01): the canvas becomes `rect` (whole pixels). With `deletePixels`, everything outside the new
 * canvas is removed; otherwise it is kept as hidden pixels that Move and Canvas Size can bring back.
 */
export function cropDocument(doc: Document, rect: CropRect, deletePixels: boolean): TreeCommand | null {
  const r = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
  if (r.x === 0 && r.y === 0 && r.width === doc.width && r.height === doc.height && !deletePixels)
    return null;
  return transformRasters(
    'Crop',
    (d) => ({ width: r.width, height: r.height, guides: shiftGuides(d.meta.guides, -r.x, -r.y) }),
    (l, range) => {
      const moved = translateGrid(l.tiles, -r.x, -r.y, range);
      return deletePixels ? clipGrid(moved, r.width, r.height) : moved;
    },
  );
}

/**
 * Installs pixels computed elsewhere (the ops worker): Image Size, Image Rotation › Arbitrary, Straighten.
 * `grids` has an entry for every raster layer id; layers missing from it become empty.
 */
export function replacePixels(
  label: string,
  grids: ReadonlyMap<string, TileGrid>,
  canvas: CanvasGeometry,
): TreeCommand {
  return transformRasters(
    label,
    () => canvas,
    (l, range) => {
      const g = grids.get(l.id);
      return g ? translateGrid(g, 0, 0, range) : new TileGrid();
    },
  );
}
