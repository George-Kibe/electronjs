import { createTile, TILE_BYTES, TILE_SIZE, TileGrid } from '../tiles/tile';
import { createGroupLayer, Document, type Layer, type RasterLayer } from './document';
import { maskTile, Mask, type MaskTile } from './selection';

/**
 * Transforming a selection (FR-TRF-04): the selected pixels are lifted off their layer ("float"), are
 * transformed, and go back over what was left behind. A soft selection edge splits a pixel between the two
 * parts by its coverage, as in Photoshop.
 */
export type Floating = { lifted: TileGrid; rest: TileGrid };

/** Splits a layer's tiles by the selection: unselected and fully selected tiles are shared, not copied. */
export function splitBySelection(tiles: TileGrid, selection: Mask): Floating {
  const lifted = new TileGrid();
  const rest = new TileGrid();
  for (const [key, tile] of tiles.entries()) {
    const m = selection.tile(key);
    if (!m) rest.set(key, tile);
    else if (m.full) lifted.set(key, tile);
    else {
      const up = new Uint8ClampedArray(tile.data);
      const down = new Uint8ClampedArray(tile.data);
      let anyUp = false;
      let anyDown = false;
      for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        const a = tile.data[i * 4 + 3]!;
        const kept = Math.round((a * m.data[i]!) / 255);
        up[i * 4 + 3] = kept;
        down[i * 4 + 3] = a - kept;
        if (kept) anyUp = true;
        if (a - kept) anyDown = true;
      }
      if (anyUp) lifted.set(key, createTile(up));
      if (anyDown) rest.set(key, createTile(down));
    }
  }
  return { lifted, rest };
}

/** The selection as RGBA tiles with its coverage in alpha, so pixel jobs can transform it. */
export function selectionToGrid(selection: Mask): TileGrid {
  const grid = new TileGrid();
  for (const [key, t] of selection.entries()) {
    const data = new Uint8ClampedArray(TILE_BYTES);
    for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) data[i * 4 + 3] = t.data[i]!;
    grid.set(key, createTile(data));
  }
  return grid;
}

/** Back from RGBA coverage to a selection, clipped to the canvas; null when nothing is left selected. */
export function gridToSelection(grid: TileGrid, width: number, height: number): Mask | null {
  const tiles = new Map<string, MaskTile>();
  for (const [key, tile] of grid.entries()) {
    const a = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE);
    for (let i = 0; i < a.length; i++) a[i] = tile.data[i * 4 + 3]!;
    const t = maskTile(a);
    if (t) tiles.set(key, t);
  }
  const mask = Mask.fromTiles(tiles, width, height);
  return mask.isEmpty ? null : mask;
}

/** The id the lifted part of layer `id` has in the preview document. */
export const liftedId = (id: string) => `${id}#lifted`;

/**
 * A document for the live preview only: each floating layer becomes an isolated group of what stays (with
 * the layer's mask) and the lifted part on top, carrying the layer's blend mode and opacity, which is how the
 * commit combines them. The real document is not touched.
 */
export function floatingPreview(doc: Document, floating: ReadonlyMap<string, Floating>): Document {
  const swap = (list: readonly Layer[]): Layer[] =>
    list.map((l): Layer => {
      if (l.type === 'group') return { ...l, children: swap(l.children) };
      const f = floating.get(l.id);
      if (!f) return l;
      const part = (id: string, tiles: TileGrid, mask: RasterLayer['mask']): RasterLayer => ({
        ...l,
        id,
        tiles,
        mask,
        blendMode: 'normal',
        opacity: 1,
        clipped: false,
      });
      return createGroupLayer(
        l.name,
        [part(`${l.id}#rest`, f.rest, l.mask), part(liftedId(l.id), f.lifted, null)],
        {
          id: `${l.id}#float`,
          visible: l.visible,
          opacity: l.opacity,
          blendMode: l.blendMode,
          passThrough: false,
        },
      );
    });
  return new Document(doc.width, doc.height, swap(doc.layers));
}
