import { tileRange } from '@shared/iep-schema';
import { assemble, contentBounds, words, type Bounds } from '../ops/canvas';

export { contentBounds, type Bounds };
import {
  parseTileKey,
  TILE_BYTES,
  TILE_SIZE,
  tileKey,
  TileGrid,
  type Tile,
  type TileKey,
} from '../tiles/tile';
import type { Command, DirtySet } from './commands';
import { walkLayers, type Document, type Layer, type RasterLayer } from './document';

/**
 * Move tool operations (FR-TRF-07): translate a layer's pixels by whole pixels, align to the canvas and
 * pick the layer under the pointer. Pixels may leave the canvas; they are kept (so moving back restores
 * them) up to the margin of `tileRange` (shared with the `.iep` reader), and dropped beyond it.
 */

/** Shifts a grid by (dx, dy) whole pixels. Tiles are shared when the offset is a multiple of the tile size. */
export function translateGrid(
  grid: TileGrid,
  dx: number,
  dy: number,
  range: ReturnType<typeof tileRange>,
): TileGrid {
  if (dx % TILE_SIZE === 0 && dy % TILE_SIZE === 0) {
    const out = new TileGrid();
    const inRange = (tx: number, ty: number) =>
      tx >= range.tx0 && tx < range.tx1 && ty >= range.ty0 && ty < range.ty1;
    for (const [key, tile] of grid.entries()) {
      const [tx, ty] = parseTileKey(key);
      const nx = tx + dx / TILE_SIZE;
      const ny = ty + dy / TILE_SIZE;
      if (inRange(nx, ny)) out.set(tileKey(nx, ny), tile);
    }
    return out;
  }
  return assemble(
    [...grid.entries()].map(([key, tile]) => {
      const [tx, ty] = parseTileKey(key);
      return { x: tx * TILE_SIZE + dx, y: ty * TILE_SIZE + dy, data: words(tile) };
    }),
    range,
  );
}

/** The raster layers a move of `id` affects: the layer itself, or every raster layer inside a group. */
export function movedRasters(doc: Document, id: string): RasterLayer[] {
  const layer = doc.layer(id);
  if (layer.type === 'raster') return [layer];
  return [...walkLayers(layer.children)].flatMap((l) => (l.layer.type === 'raster' ? [l.layer] : []));
}

/** Why the layer `id` cannot be moved, or null if it can (position lock, FR-LAY-02). */
export function moveBlocker(doc: Document, id: string): string | null {
  if (!doc.has(id)) return 'No layer selected.';
  const layer = doc.layer(id);
  const locked = (l: Layer) => l.locks.all || l.locks.position;
  if (locked(layer)) return 'This layer is locked.';
  if (layer.type === 'group' && [...walkLayers(layer.children)].some((l) => locked(l.layer)))
    return 'A layer in this group is locked.';
  if (!contentBounds(movedRasters(doc, id).map((l) => l.tiles)))
    return 'Nothing to move: the layer is empty.';
  return null;
}

type Pixels = ReadonlyMap<string, readonly [TileKey, Tile][]>;

/** Replaces the pixels of one or more raster layers (a move). Coalesces consecutive nudges (docs/02 §6). */
export class TranslateCommand implements Command {
  constructor(
    readonly label: string,
    private readonly before: Pixels,
    private readonly after: Pixels,
  ) {}

  private apply(doc: Document, pixels: Pixels): DirtySet {
    for (const [id, entries] of pixels) {
      const grid = doc.raster(id).tiles;
      grid.clear();
      for (const [key, tile] of entries) grid.set(key, tile);
    }
    return { layerIds: [...pixels.keys()], tiles: 'all' };
  }

  do(doc: Document): DirtySet {
    return this.apply(doc, this.after);
  }

  undo(doc: Document): DirtySet {
    return this.apply(doc, this.before);
  }

  /** Bytes of tiles created by the move (tiles shared with the previous state cost nothing). */
  sizeBytes(): number {
    let n = 128;
    for (const [id, entries] of this.after) {
      const shared = new Set((this.before.get(id) ?? []).map(([, t]) => t.id));
      for (const [, t] of entries) if (!shared.has(t.id)) n += TILE_BYTES;
    }
    return n;
  }

  /** The editor coalesces arrow-key nudges of the same layers: one undo step, exact before and after. */
  mergeWith(next: Command): Command | null {
    if (!(next instanceof TranslateCommand) || next.label !== this.label) return null;
    const ids = [...this.after.keys()].join();
    if ([...next.before.keys()].join() !== ids) return null;
    return new TranslateCommand(this.label, this.before, next.after);
  }
}

/** Moves layer `id` (a raster layer, or all raster layers in a group) by whole pixels. Null if refused. */
export function translateLayer(
  doc: Document,
  id: string,
  dx: number,
  dy: number,
  label = 'Move',
): TranslateCommand | null {
  dx = Math.round(dx);
  dy = Math.round(dy);
  if ((dx === 0 && dy === 0) || moveBlocker(doc, id)) return null;
  const range = tileRange(doc.width, doc.height, TILE_SIZE);
  const before = new Map<string, [TileKey, Tile][]>();
  const after = new Map<string, [TileKey, Tile][]>();
  for (const layer of movedRasters(doc, id)) {
    before.set(layer.id, [...layer.tiles.entries()]);
    after.set(layer.id, [...translateGrid(layer.tiles, dx, dy, range).entries()]);
  }
  return new TranslateCommand(label, before, after);
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Offset that aligns the layer's content with the canvas edge or centre (FR-TRF-07). [0, 0] if empty. */
export function alignOffset(doc: Document, id: string, edge: AlignEdge): [number, number] {
  const b = contentBounds(movedRasters(doc, id).map((l) => l.tiles));
  if (!b) return [0, 0];
  switch (edge) {
    case 'left':
      return [-b.x0, 0];
    case 'right':
      return [doc.width - b.x1, 0];
    case 'hcenter':
      return [Math.round((doc.width - (b.x1 - b.x0)) / 2) - b.x0, 0];
    case 'top':
      return [0, -b.y0];
    case 'bottom':
      return [0, doc.height - b.y1];
    case 'vcenter':
      return [0, Math.round((doc.height - (b.y1 - b.y0)) / 2) - b.y0];
  }
}

/**
 * Auto-select (FR-TRF-07): the topmost visible raster layer with a non-transparent pixel at (x, y). In
 * 'group' mode, the top-level layer or group that contains it. Null over empty canvas.
 */
export function layerAt(doc: Document, x: number, y: number, mode: 'layer' | 'group'): string | null {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const px = Math.floor(x);
  const py = Math.floor(y);
  const search = (layers: readonly Layer[]): string | null => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      if (!l.visible) continue;
      if (l.type === 'group') {
        const hit = search(l.children);
        if (hit) return hit;
      } else if (l.tiles.pixel(px, py)[3] > 0) {
        return l.id;
      }
    }
    return null;
  };
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const top = doc.layers[i]!;
    const hit = search([top]);
    if (hit) return mode === 'group' ? top.id : hit;
  }
  return null;
}
