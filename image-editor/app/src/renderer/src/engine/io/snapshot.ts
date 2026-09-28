import { createRasterLayer, Document, type BlendMode, type LayerLocks } from '../doc/document';
import { createTile, TILE_BYTES, TileGrid, type TileKey } from '../tiles/tile';

/**
 * Plain, structured-cloneable copy of a document: what crosses to the file worker (save, export flatten)
 * and comes back from it (open). Tile bytes are shared with the live tiles, never mutated.
 */
export type LayerSnapshot = {
  id: string;
  type: 'raster';
  name: string;
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
  locks: LayerLocks;
  clipped: boolean;
  extra?: Record<string, unknown>;
  tiles: Array<[TileKey, Uint8Array]>;
};

export type DocSnapshot = {
  width: number;
  height: number;
  ppi: number;
  guides: { horizontal: number[]; vertical: number[] };
  name: string;
  sourceProfile: string | null;
  exif: Uint8Array | null;
  activeLayerId: string;
  /** Bottom → top. */
  layers: LayerSnapshot[];
  /** Unknown manifest fields, preserved on save (docs/05 §2.1). */
  extra?: { manifest?: Record<string, unknown>; document?: Record<string, unknown> };
};

export function toSnapshot(doc: Document): DocSnapshot {
  return {
    width: doc.width,
    height: doc.height,
    ppi: doc.meta.ppi,
    guides: doc.meta.guides,
    name: doc.meta.name,
    sourceProfile: doc.meta.sourceProfile,
    exif: doc.meta.exif,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map((l) => ({
      id: l.id,
      type: 'raster',
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      blendMode: l.blendMode,
      locks: { ...l.locks },
      clipped: l.clipped,
      ...(l.extra ? { extra: l.extra } : {}),
      tiles: [...l.tiles.entries()].map(([key, tile]) => [
        key,
        new Uint8Array(tile.data.buffer, tile.data.byteOffset, tile.data.byteLength),
      ]),
    })),
    ...(doc.meta.extra ? { extra: doc.meta.extra } : {}),
  };
}

export function fromSnapshot(s: DocSnapshot): Document {
  const layers = s.layers.map((l) => {
    const grid = new TileGrid();
    for (const [key, bytes] of l.tiles) {
      if (bytes.byteLength !== TILE_BYTES) throw new RangeError(`Tile ${key} has the wrong size`);
      grid.set(key, createTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
    }
    const { tiles: _tiles, type: _type, ...props } = l;
    return createRasterLayer(l.name, grid, props);
  });
  const doc = new Document(s.width, s.height, layers, {
    name: s.name,
    sourceProfile: s.sourceProfile,
    ppi: s.ppi,
    guides: s.guides,
    exif: s.exif,
    ...(s.extra ? { extra: s.extra } : {}),
  });
  if (layers.some((l) => l.id === s.activeLayerId)) doc.activeLayerId = s.activeLayerId;
  return doc;
}
