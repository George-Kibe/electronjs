import type { tileRange } from '@shared/iep-schema';
import {
  createTile,
  parseTileKey,
  TILE_SIZE,
  tileKey,
  TileGrid,
  type Tile,
  type TileKey,
} from '../tiles/tile';

/**
 * Exact (lossless) pixel-plane operations on tile grids: placing 256×256 blocks at any whole-pixel origin,
 * clipping to the canvas, 90° rotations and flips (FR-TRF-03, T-TRF-01: rotating 4 × 90° is bit-exact).
 * Pixels are copied as packed RGBA words; nothing is resampled.
 */

export type TileRange = ReturnType<typeof tileRange>;

/** A 256×256 block of packed RGBA pixels whose top-left pixel lands at document (x, y). */
export type Block = { x: number; y: number; data: Uint32Array };

const N = TILE_SIZE;

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

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

/** A tile's pixels as packed RGBA words (copied only when the bytes are not 4-byte aligned). */
export function words(tile: Tile): Uint32Array {
  const bytes = tile.data.byteOffset % 4 === 0 ? tile.data : tile.data.slice();
  return new Uint32Array(bytes.buffer, bytes.byteOffset, N * N);
}

function hasPixels(d: Uint32Array): boolean {
  // Alpha is the high byte of each little-endian word; any non-zero alpha counts.
  for (let i = 0; i < d.length; i++) if (d[i]! >>> 24 !== 0) return true;
  return false;
}

/**
 * Builds a grid from blocks placed at arbitrary whole-pixel origins. Later blocks overwrite earlier ones
 * where they overlap (callers place disjoint blocks). Tiles outside `range` are dropped, as are empty ones.
 */
export function assemble(blocks: Iterable<Block>, range: TileRange): TileGrid {
  const inRange = (tx: number, ty: number) =>
    tx >= range.tx0 && tx < range.tx1 && ty >= range.ty0 && ty < range.ty1;
  const dest = new Map<TileKey, Uint32Array>();
  for (const { x: ox, y: oy, data: src } of blocks) {
    for (let ny = Math.floor(oy / N); ny <= Math.floor((oy + N - 1) / N); ny++) {
      for (let nx = Math.floor(ox / N); nx <= Math.floor((ox + N - 1) / N); nx++) {
        if (!inRange(nx, ny)) continue;
        const k = tileKey(nx, ny);
        let d = dest.get(k);
        if (!d) dest.set(k, (d = new Uint32Array(N * N)));
        // Overlap of the block with destination tile (nx, ny), in destination-local px.
        const x0 = Math.max(0, ox - nx * N);
        const x1 = Math.min(N, ox + N - nx * N);
        const y0 = Math.max(0, oy - ny * N);
        const y1 = Math.min(N, oy + N - ny * N);
        const sx = nx * N - ox; // destination-local → block-local offset
        const sy = ny * N - oy;
        for (let y = y0; y < y1; y++) {
          const from = (y + sy) * N + x0 + sx;
          d.set(src.subarray(from, from + (x1 - x0)), y * N + x0);
        }
      }
    }
  }
  const out = new TileGrid();
  for (const [k, d] of dest) if (hasPixels(d)) out.set(k, createTile(new Uint8ClampedArray(d.buffer)));
  return out;
}

/** Removes every pixel outside [0, width) × [0, height) ("Delete cropped pixels"). Untouched tiles are shared. */
export function clipGrid(grid: TileGrid, width: number, height: number): TileGrid {
  const out = new TileGrid();
  const cols = Math.ceil(width / N);
  const rows = Math.ceil(height / N);
  for (const [key, tile] of grid.entries()) {
    const [tx, ty] = parseTileKey(key);
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
    const w = Math.min(N, width - tx * N);
    const h = Math.min(N, height - ty * N);
    if (w === N && h === N) {
      out.set(key, tile);
      continue;
    }
    const src = words(tile);
    const d = new Uint32Array(N * N);
    for (let y = 0; y < h; y++) d.set(src.subarray(y * N, y * N + w), y * N);
    if (hasPixels(d)) out.set(key, createTile(new Uint8ClampedArray(d.buffer)));
  }
  return out;
}

/** Quarter turns clockwise. */
export type Turns = 1 | 2 | 3;

/**
 * Rotates the whole pixel plane of a `width`×`height` canvas clockwise by `turns` × 90°, so the canvas maps
 * onto the new canvas exactly (its size is height×width for odd turns). Pixels outside the canvas rotate
 * with it; `range` is the new canvas's range.
 */
export function rotateGrid(
  grid: TileGrid,
  width: number,
  height: number,
  turns: Turns,
  range: TileRange,
): TileGrid {
  const blocks: Block[] = [];
  for (const [key, tile] of grid.entries()) {
    const [tx, ty] = parseTileKey(key);
    const X = tx * N;
    const Y = ty * N;
    const s = words(tile);
    const r = new Uint32Array(N * N);
    // Source pixel (X + lx, Y + ly) → destination; r is the destination block in row-major order.
    if (turns === 1) {
      // (x, y) → (H − 1 − y, x)
      for (let ly = 0; ly < N; ly++)
        for (let lx = 0; lx < N; lx++) r[lx * N + (N - 1 - ly)] = s[ly * N + lx]!;
      blocks.push({ x: height - N - Y, y: X, data: r });
    } else if (turns === 2) {
      // (x, y) → (W − 1 − x, H − 1 − y)
      for (let i = 0; i < N * N; i++) r[N * N - 1 - i] = s[i]!;
      blocks.push({ x: width - N - X, y: height - N - Y, data: r });
    } else {
      // (x, y) → (y, W − 1 − x)
      for (let ly = 0; ly < N; ly++)
        for (let lx = 0; lx < N; lx++) r[(N - 1 - lx) * N + ly] = s[ly * N + lx]!;
      blocks.push({ x: Y, y: width - N - X, data: r });
    }
  }
  return assemble(blocks, range);
}

/** Mirrors the pixel plane of a `width`×`height` canvas horizontally or vertically (Flip Canvas). */
export function flipGrid(
  grid: TileGrid,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical',
  range: TileRange,
): TileGrid {
  const blocks: Block[] = [];
  for (const [key, tile] of grid.entries()) {
    const [tx, ty] = parseTileKey(key);
    const s = words(tile);
    const r = new Uint32Array(N * N);
    if (axis === 'horizontal') {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) r[y * N + (N - 1 - x)] = s[y * N + x]!;
      blocks.push({ x: width - N - tx * N, y: ty * N, data: r });
    } else {
      for (let y = 0; y < N; y++) r.set(s.subarray(y * N, y * N + N), (N - 1 - y) * N);
      blocks.push({ x: tx * N, y: height - N - ty * N, data: r });
    }
  }
  return assemble(blocks, range);
}
