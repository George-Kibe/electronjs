import { tileRange } from '@shared/iep-schema';
import {
  createTile,
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

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** Shifts a grid by (dx, dy) whole pixels. Tiles are shared when the offset is a multiple of the tile size. */
export function translateGrid(
  grid: TileGrid,
  dx: number,
  dy: number,
  range: ReturnType<typeof tileRange>,
): TileGrid {
  const out = new TileGrid();
  const inRange = (tx: number, ty: number) =>
    tx >= range.tx0 && tx < range.tx1 && ty >= range.ty0 && ty < range.ty1;
  if (dx % TILE_SIZE === 0 && dy % TILE_SIZE === 0) {
    for (const [key, tile] of grid.entries()) {
      const [tx, ty] = parseTileKey(key);
      const nx = tx + dx / TILE_SIZE;
      const ny = ty + dy / TILE_SIZE;
      if (inRange(nx, ny)) out.set(tileKey(nx, ny), tile);
    }
    return out;
  }
  const dest = new Map<TileKey, Uint32Array>();
  for (const [key, tile] of grid.entries()) {
    const [tx, ty] = parseTileKey(key);
    const bytes = tile.data.byteOffset % 4 === 0 ? tile.data : tile.data.slice();
    const src = new Uint32Array(bytes.buffer, bytes.byteOffset, TILE_SIZE * TILE_SIZE);
    const ox = tx * TILE_SIZE + dx; // where the source tile's top-left pixel lands
    const oy = ty * TILE_SIZE + dy;
    for (let ny = Math.floor(oy / TILE_SIZE); ny <= Math.floor((oy + TILE_SIZE - 1) / TILE_SIZE); ny++) {
      for (let nx = Math.floor(ox / TILE_SIZE); nx <= Math.floor((ox + TILE_SIZE - 1) / TILE_SIZE); nx++) {
        if (!inRange(nx, ny)) continue;
        const k = tileKey(nx, ny);
        let d = dest.get(k);
        if (!d) dest.set(k, (d = new Uint32Array(TILE_SIZE * TILE_SIZE)));
        // Overlap of the shifted source tile with destination tile (nx, ny), in destination-local px.
        const x0 = Math.max(0, ox - nx * TILE_SIZE);
        const x1 = Math.min(TILE_SIZE, ox + TILE_SIZE - nx * TILE_SIZE);
        const y0 = Math.max(0, oy - ny * TILE_SIZE);
        const y1 = Math.min(TILE_SIZE, oy + TILE_SIZE - ny * TILE_SIZE);
        const sx = nx * TILE_SIZE - ox; // destination-local → source-local offset
        const sy = ny * TILE_SIZE - oy;
        for (let y = y0; y < y1; y++) {
          const from = (y + sy) * TILE_SIZE + x0 + sx;
          d.set(src.subarray(from, from + (x1 - x0)), y * TILE_SIZE + x0);
        }
      }
    }
  }
  for (const [k, d] of dest) {
    const bytes = new Uint8ClampedArray(d.buffer);
    if (hasPixels(bytes)) out.set(k, createTile(bytes));
  }
  return out;
}

function hasPixels(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
  return false;
}

/** Bounds of the non-transparent pixels of `grids` (document px, exclusive max), or null if all empty. */
export function contentBounds(grids: Iterable<TileGrid>): Bounds | null {
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const grid of grids) {
    for (const [key, tile] of grid.entries()) {
      const [tx, ty] = parseTileKey(key);
      const d = tile.data;
      let x0 = TILE_SIZE;
      let y0 = TILE_SIZE;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < TILE_SIZE; y++) {
        const row = y * TILE_SIZE * 4;
        for (let x = 0; x < TILE_SIZE; x++) {
          if (d[row + x * 4 + 3] === 0) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
      if (x1 < 0) continue;
      const ox = tx * TILE_SIZE;
      const oy = ty * TILE_SIZE;
      b.x0 = Math.min(b.x0, ox + x0);
      b.y0 = Math.min(b.y0, oy + y0);
      b.x1 = Math.max(b.x1, ox + x1 + 1);
      b.y1 = Math.max(b.y1, oy + y1 + 1);
    }
  }
  return b.x1 > b.x0 ? b : null;
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
