import { tileRange } from '@shared/iep-schema';
import { createTile, TILE_BYTES, TileGrid, type TileKey } from '../tiles/tile';
import { snapshotLayers, type LayerSnapshot } from '../io/snapshot';
import { resampleGrid, rotateArbitraryGrid, type ResampleFilter } from './resample';
import { modifySelection, type ClipTiles, type ModifyOp } from './modify';
import { colorRange, magicWand, type WandOptions } from './wand';

/**
 * Pixel jobs too heavy for the UI thread (docs/02 §5.6): Image Size and arbitrary rotation. Pure, so the ops
 * worker and in-thread callers (tests, a missing worker) run the same code. Tiles cross as plain bytes.
 */
export type Size = { width: number; height: number };
export type LayerTiles = { id: string; tiles: Array<[TileKey, Uint8Array]> };

export type OpsJob =
  | { op: 'resample'; layers: LayerTiles[]; src: Size; dst: Size; filter: ResampleFilter }
  | { op: 'rotate'; layers: LayerTiles[]; src: Size; dst: Size; degrees: number }
  /** Magic Wand (FR-SEL-03): the result is one LayerTiles, id 'mask', of 256×256 one-byte mask tiles. */
  | { op: 'wand'; layers: LayerSnapshot[]; size: Size; seed: { x: number; y: number }; options: WandOptions }
  /** Select › Modify (FR-SEL-05) of the selection in `tiles`. */
  | {
      op: 'modify';
      tiles: ClipTiles;
      bounds: { x0: number; y0: number; x1: number; y1: number };
      size: Size;
      modify: ModifyOp;
    }
  /** Select › Color Range (FR-SEL-05). */
  | {
      op: 'colorRange';
      layers: LayerSnapshot[];
      size: Size;
      color: [number, number, number];
      fuzziness: number;
    };

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
  if (job.op === 'wand' || job.op === 'modify' || job.op === 'colorRange') {
    const tiles =
      job.op === 'wand'
        ? magicWand(snapshotLayers(job.layers), job.size, job.seed, job.options)
        : job.op === 'modify'
          ? modifySelection(job.tiles, job.bounds, job.size, job.modify)
          : colorRange(snapshotLayers(job.layers), job.size, job.color, job.fuzziness);
    onProgress?.(1);
    return [{ id: 'mask', tiles }];
  }
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
