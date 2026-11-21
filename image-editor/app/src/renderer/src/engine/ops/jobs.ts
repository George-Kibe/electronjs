import { tileRange } from '@shared/iep-schema';
import { createTile, TILE_BYTES, TileGrid, type TileKey } from '../tiles/tile';
import { snapshotLayers, type LayerSnapshot } from '../io/snapshot';
import { resampleGrid, rotateArbitraryGrid, type ResampleFilter } from './resample';
import { affineGrid, invertAlpha, sourceOver, type Affine } from './affine';
import { modifySelection, type ClipTiles, type ModifyOp } from './modify';
import { adjustTiles, prepareAdjustment, type Adjustment } from './adjust';
import { histogramOf, packHistogram } from './histogram';
import { trimContent, type TrimBasis } from './trim';
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
  /**
   * Free Transform (FR-TRF-04): each layer re-rasterized under `matrix` (document px → document px).
   * `inverted`: layers (reveal-all masks) whose missing tiles mean opaque, so they transform inverted.
   * `beneath`: for a transformed selection, what stays of each layer; the result goes over it.
   */
  | {
      op: 'affine';
      layers: LayerTiles[];
      size: Size;
      matrix: Affine;
      inverted?: string[];
      beneath?: LayerTiles[];
    }
  /** Image › Adjustments (FR-ADJ-01): one layer adjusted, within the selection (one-byte tiles) if any. */
  | {
      op: 'adjust';
      layer: LayerTiles;
      adjustment: Adjustment;
      selection: Array<[TileKey, Uint8Array]> | null;
    }
  /** Histogram (FR-ADJ-02/03) of the composite of `layers`, within the selection (one-byte tiles) if any. */
  | {
      op: 'histogram';
      layers: LayerSnapshot[];
      size: Size;
      selection: Array<[TileKey, Uint8Array]> | null;
    }
  /** Image › Trim (FR-TRF-06): the composite pixels to keep, as a mask. */
  | { op: 'trim'; layers: LayerSnapshot[]; size: Size; basis: TrimBasis }
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
  if (job.op === 'wand' || job.op === 'modify' || job.op === 'colorRange' || job.op === 'trim') {
    const tiles =
      job.op === 'wand'
        ? magicWand(snapshotLayers(job.layers), job.size, job.seed, job.options)
        : job.op === 'modify'
          ? modifySelection(job.tiles, job.bounds, job.size, job.modify)
          : job.op === 'trim'
            ? trimContent(snapshotLayers(job.layers), job.size, job.basis)
            : colorRange(snapshotLayers(job.layers), job.size, job.color, job.fuzziness);
    onProgress?.(1);
    return [{ id: 'mask', tiles }];
  }
  if (job.op === 'histogram') {
    const h = histogramOf(
      snapshotLayers(job.layers),
      job.size,
      job.selection ? new Map(job.selection) : null,
    );
    onProgress?.(1);
    return [{ id: 'histogram', tiles: [['0,0', packHistogram(h)]] }];
  }
  if (job.op === 'adjust') {
    const selection = job.selection ? new Map(job.selection) : null;
    const tiles = adjustTiles(job.layer.tiles, prepareAdjustment(job.adjustment), selection, (done, total) =>
      onProgress?.(done / total),
    );
    return [{ id: job.layer.id, tiles: tiles as Array<[TileKey, Uint8Array]> }];
  }
  if (job.op === 'affine') {
    const range = tileRange(job.size.width, job.size.height);
    const inverted = new Set(job.inverted);
    const beneath = new Map(job.beneath?.map((l) => [l.id, l.tiles]));
    return job.layers.map((layer, i) => {
      const flip = inverted.has(layer.id);
      const src = toGrid(layer.tiles);
      const moved = affineGrid(flip ? invertAlpha(src) : src, job.matrix, range, (done, rows) =>
        onProgress?.((i + done / rows) / Math.max(1, job.layers.length)),
      );
      const under = beneath.get(layer.id);
      const out = flip ? invertAlpha(moved) : under ? sourceOver(moved, toGrid(under)) : moved;
      return fromGrid(layer.id, out);
    });
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
