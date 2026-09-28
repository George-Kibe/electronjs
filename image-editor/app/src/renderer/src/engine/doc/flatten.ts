import { TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import type { BlendMode } from './document';

/** What the CPU compositor needs from a layer; satisfied by live layers and by worker snapshots. */
export type FlatLayer = {
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
  tile(key: TileKey): Uint8Array | Uint8ClampedArray | undefined;
};

/**
 * CPU reference compositor (docs/02 §5.2): bottom → top, gamma-space blending on straight 8-bit tiles
 * (ADR-0004). The GPU compositor must match it (gpu.gpu.test.ts). Used for export, previews and tests.
 * M1 slice 1: Normal only.
 */
export function compositePixel(
  layers: readonly FlatLayer[],
  x: number,
  y: number,
): [number, number, number, number] {
  const key = tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0; // premultiplied accumulation, 0..1
  for (const layer of layers) {
    if (!layer.visible) continue;
    const t = layer.tile(key);
    if (!t) continue;
    const sa = (t[i + 3]! / 255) * layer.opacity * layer.fillOpacity;
    r = (t[i]! / 255) * sa + r * (1 - sa);
    g = (t[i + 1]! / 255) * sa + g * (1 - sa);
    b = (t[i + 2]! / 255) * sa + b * (1 - sa);
    a = sa + a * (1 - sa);
  }
  if (a === 0) return [0, 0, 0, 0];
  return [
    Math.round((r / a) * 255),
    Math.round((g / a) * 255),
    Math.round((b / a) * 255),
    Math.round(a * 255),
  ];
}

/**
 * Flattens the whole document to a row-major straight RGBA8 buffer (export, docs/02 §7.2). Works tile by
 * tile so the working set stays small; `onRow` reports progress per tile row.
 */
export function flatten(
  layers: readonly FlatLayer[],
  width: number,
  height: number,
  onRow?: (done: number, total: number) => void,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const acc = new Float32Array(TILE_SIZE * TILE_SIZE * 4);
  const rows = Math.ceil(height / TILE_SIZE);
  const cols = Math.ceil(width / TILE_SIZE);
  const shown = layers.filter((l) => l.visible && l.opacity * l.fillOpacity > 0);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      acc.fill(0);
      const key = tileKey(tx, ty);
      for (const layer of shown) {
        const t = layer.tile(key);
        if (!t) continue;
        const k = layer.opacity * layer.fillOpacity;
        for (let i = 0; i < acc.length; i += 4) {
          const sa = (t[i + 3]! / 255) * k;
          if (sa === 0) continue;
          const keep = 1 - sa;
          acc[i] = (t[i]! / 255) * sa + acc[i]! * keep;
          acc[i + 1] = (t[i + 1]! / 255) * sa + acc[i + 1]! * keep;
          acc[i + 2] = (t[i + 2]! / 255) * sa + acc[i + 2]! * keep;
          acc[i + 3] = sa + acc[i + 3]! * keep;
        }
      }
      const w = Math.min(TILE_SIZE, width - tx * TILE_SIZE);
      const h = Math.min(TILE_SIZE, height - ty * TILE_SIZE);
      for (let y = 0; y < h; y++) {
        let o = ((ty * TILE_SIZE + y) * width + tx * TILE_SIZE) * 4;
        let i = y * TILE_SIZE * 4;
        for (let x = 0; x < w; x++, i += 4, o += 4) {
          const a = acc[i + 3]!;
          if (a === 0) continue; // out is zero-initialised: transparent black
          out[o] = Math.round((acc[i]! / a) * 255);
          out[o + 1] = Math.round((acc[i + 1]! / a) * 255);
          out[o + 2] = Math.round((acc[i + 2]! / a) * 255);
          out[o + 3] = Math.round(a * 255);
        }
      }
    }
    onRow?.(ty + 1, rows);
  }
  return out;
}

/**
 * Small flattened preview (the `.iep` preview.png and recent-file thumbnails): each output pixel averages a
 * 2×2 grid of composited samples, so thin strokes don't vanish entirely.
 */
export function flattenPreview(
  layers: readonly FlatLayer[],
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  const offsets = [0.25, 0.75];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          const sx = Math.min(width - 1, Math.floor((x + ox) / scale));
          const sy = Math.min(height - 1, Math.floor((y + oy) / scale));
          const [pr, pg, pb, pa] = compositePixel(layers, sx, sy);
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round(a / 4);
    }
  }
  return { width: w, height: h, rgba };
}

/** Adapts live raster layers (engine/doc) to the compositor. */
export function liveLayers(
  layers: ReadonlyArray<{
    visible: boolean;
    opacity: number;
    fillOpacity: number;
    blendMode: BlendMode;
    tiles: { get(key: TileKey): { data: Uint8ClampedArray } | undefined };
  }>,
): FlatLayer[] {
  return layers.map((l) => ({
    visible: l.visible,
    opacity: l.opacity,
    fillOpacity: l.fillOpacity,
    blendMode: l.blendMode,
    tile: (key) => l.tiles.get(key)?.data,
  }));
}
