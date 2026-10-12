import { tileRange } from '@shared/iep-schema';
import { createTile, TILE_BYTES, TileGrid, type TileKey } from '../tiles/tile';
import { resampleGrid, rotateArbitraryGrid, type ResampleFilter } from './resample';

/**
 * Pixel jobs too heavy for the UI thread (docs/02 §5.6): Image Size and arbitrary rotation. Pure, so the ops
 * worker and in-thread callers (tests, a missing worker) run the same code. Tiles cross as plain bytes.
 */
export type Size = { width: number; height: number };
export type LayerTiles = { id: string; tiles: Array<[TileKey, Uint8Array]> };

export type OpsJob =
  | { op: 'resample'; layers: LayerTiles[]; src: Size; dst: Size; filter: ResampleFilter }
  | { op: 'rotate'; layers: LayerTiles[]; src: Size; dst: Size; degrees: number };

export function toGrid(tiles: LayerTiles['tiles']): TileGrid {
  const grid = new TileGrid();
  for (const [key, bytes] of tiles) {
    if (bytes.byteLength !== TILE_BYTES) throw new RangeError(`Tile ${key} has the wrong size`);
    grid.set(key, createTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  }
  return grid;
}

export function fromGrid(id: string, grid: TileGrid): LayerTiles {
  return {
    id,
    tiles: [...grid.entries()].map(([k, t]) => [
      k,
      new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength),
    ]),
  };
}

/** Runs a job; `onProgress` gets 0..1. */
export function runOpsJob(job: OpsJob, onProgress?: (p: number) => void): LayerTiles[] {
  const range = tileRange(job.dst.width, job.dst.height);
  const total = Math.max(1, job.layers.length);
  return job.layers.map((layer, i) => {
    const progress = (done: number, rows: number) => onProgress?.((i + done / rows) / total);
    const grid = toGrid(layer.tiles);
    const out =
      job.op === 'resample'
        ? resampleGrid(grid, job.src, job.dst, job.filter, range, progress)
        : rotateArbitraryGrid(grid, job.src, job.dst, job.degrees, range, progress);
    return fromGrid(layer.id, out);
  });
}
