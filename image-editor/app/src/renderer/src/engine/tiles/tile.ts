/**
 * Immutable 256×256 RGBA8 tiles with straight (unpremultiplied) alpha (ADR-0003). A write always creates a
 * new Tile, so history can hold references instead of copies.
 */
export const TILE_SIZE = 256;
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

export type Tile = { readonly id: number; readonly data: Uint8ClampedArray };
export type TileKey = string;

let nextId = 1;

export function createTile(data: Uint8ClampedArray): Tile {
  if (data.length !== TILE_BYTES) throw new RangeError(`Tile data must be ${TILE_BYTES} bytes`);
  return Object.freeze({ id: nextId++, data });
}

export function tileKey(tx: number, ty: number): TileKey {
  return `${tx},${ty}`;
}

export function parseTileKey(key: TileKey): [number, number] {
  const [tx, ty] = key.split(',').map(Number) as [number, number];
  return [tx, ty];
}

/** Keys of all tiles intersecting the rectangle [x0,x1)×[y0,y1) in document pixels. */
export function tileKeysInRect(x0: number, y0: number, x1: number, y1: number): TileKey[] {
  const keys: TileKey[] = [];
  const tx0 = Math.floor(x0 / TILE_SIZE);
  const ty0 = Math.floor(y0 / TILE_SIZE);
  const tx1 = Math.ceil(x1 / TILE_SIZE);
  const ty1 = Math.ceil(y1 / TILE_SIZE);
  for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) keys.push(tileKey(tx, ty));
  return keys;
}

/** Sparse grid of tiles. Missing keys are fully transparent. */
export class TileGrid {
  private readonly tiles = new Map<TileKey, Tile>();

  get(key: TileKey): Tile | undefined {
    return this.tiles.get(key);
  }

  /** Replaces a tile (undefined = transparent). Callers are commands; tools never write directly. */
  set(key: TileKey, tile: Tile | undefined): void {
    if (tile) this.tiles.set(key, tile);
    else this.tiles.delete(key);
  }

  keys(): IterableIterator<TileKey> {
    return this.tiles.keys();
  }

  entries(): IterableIterator<[TileKey, Tile]> {
    return this.tiles.entries();
  }

  get size(): number {
    return this.tiles.size;
  }

  /** Builds a grid from a row-major RGBA8 buffer; fully transparent tiles are skipped. */
  static fromRgba(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): TileGrid {
    const grid = new TileGrid();
    const cols = Math.ceil(width / TILE_SIZE);
    const rows = Math.ceil(height / TILE_SIZE);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const data = new Uint8ClampedArray(TILE_BYTES);
        const w = Math.min(TILE_SIZE, width - tx * TILE_SIZE);
        const h = Math.min(TILE_SIZE, height - ty * TILE_SIZE);
        let opaque = false;
        for (let y = 0; y < h; y++) {
          const src = ((ty * TILE_SIZE + y) * width + tx * TILE_SIZE) * 4;
          const row = rgba.subarray(src, src + w * 4);
          data.set(row, y * TILE_SIZE * 4);
          if (!opaque) for (let i = 3; i < row.length; i += 4) if (row[i] !== 0) opaque = true;
        }
        if (opaque) grid.set(tileKey(tx, ty), createTile(data));
      }
    }
    return grid;
  }

  /** A grid filled with one colour over width×height (e.g. a white background). */
  static filled(width: number, height: number, rgba: readonly [number, number, number, number]): TileGrid {
    const grid = new TileGrid();
    if (rgba[3] === 0) return grid;
    for (const key of tileKeysInRect(0, 0, width, height)) {
      const [tx, ty] = parseTileKey(key);
      const data = new Uint8ClampedArray(TILE_BYTES);
      const w = Math.min(TILE_SIZE, width - tx * TILE_SIZE);
      const h = Math.min(TILE_SIZE, height - ty * TILE_SIZE);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(rgba, (y * TILE_SIZE + x) * 4);
      grid.set(key, createTile(data));
    }
    return grid;
  }

  /** Straight RGBA of one document pixel (transparent black outside tiles). */
  pixel(x: number, y: number): [number, number, number, number] {
    const tile = this.tiles.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
    if (!tile) return [0, 0, 0, 0];
    const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
    return [tile.data[i]!, tile.data[i + 1]!, tile.data[i + 2]!, tile.data[i + 3]!];
  }
}
