import { TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import { blendInto, blendModeIndex } from './blend';
import type { BlendMode, Layer } from './document';

type NodeProps = { visible: boolean; opacity: number; fillOpacity: number; blendMode: BlendMode };

/** What the CPU compositor needs from the layer tree; satisfied by live layers and by worker snapshots. */
export type FlatLayer =
  | (NodeProps & { kind: 'raster'; tile(key: TileKey): Uint8Array | Uint8ClampedArray | undefined })
  | (NodeProps & { kind: 'group'; passThrough: boolean; children: FlatLayer[] });

const TILE_PIXELS = TILE_SIZE * TILE_SIZE;

/** Scratch buffers for isolated groups, one per nesting depth. */
const scratch: Float32Array[] = [];
function scratchAt(depth: number, length: number): Float32Array {
  let buf = scratch[depth];
  if (!buf || buf.length < length) scratch[depth] = buf = new Float32Array(length);
  const view = buf.subarray(0, length);
  view.fill(0);
  return view;
}

/**
 * Composites `nodes` (bottom → top) into `acc` (premultiplied RGBA floats, 0..1) for `count` pixels of tile
 * `key`, starting at pixel `first` of the tile. The CPU reference for the GPU compositor (docs/02 §5.2):
 * gamma-space blending (ADR-0004), pass-through groups inline, other groups isolated then blended.
 */
function compositeSpan(
  nodes: readonly FlatLayer[],
  key: TileKey,
  acc: Float32Array,
  first: number,
  count: number,
  depth: number,
): void {
  for (const node of nodes) {
    if (!node.visible) continue;
    if (node.kind === 'raster') {
      const t = node.tile(key);
      const k = node.opacity * node.fillOpacity;
      if (!t || k === 0) continue;
      const mode = blendModeIndex(node.blendMode);
      for (let p = 0; p < count; p++) {
        const s = (first + p) * 4;
        const a = t[s + 3]!;
        if (a === 0) continue;
        blendInto(acc, p * 4, mode, t[s]! / 255, t[s + 1]! / 255, t[s + 2]! / 255, (a / 255) * k);
      }
    } else if (node.passThrough && node.opacity === 1) {
      compositeSpan(node.children, key, acc, first, count, depth);
    } else {
      if (node.opacity === 0) continue;
      const group = scratchAt(depth, count * 4);
      compositeSpan(node.children, key, group, first, count, depth + 1);
      // Pass-through groups with reduced opacity are composited isolated and blended normally.
      const mode = node.passThrough ? 0 : blendModeIndex(node.blendMode);
      for (let p = 0; p < count; p++) {
        const i = p * 4;
        const a = group[i + 3]!;
        if (a === 0) continue;
        blendInto(acc, i, mode, group[i]! / a, group[i + 1]! / a, group[i + 2]! / a, a * node.opacity);
      }
    }
  }
}

function toByte(acc: Float32Array, i: number): [number, number, number, number] {
  const a = acc[i + 3]!;
  if (a <= 0) return [0, 0, 0, 0];
  return [
    Math.round(Math.min(1, acc[i]! / a) * 255),
    Math.round(Math.min(1, acc[i + 1]! / a) * 255),
    Math.round(Math.min(1, acc[i + 2]! / a) * 255),
    Math.round(Math.min(1, a) * 255),
  ];
}

/** Straight RGBA8 of the composite at one document pixel. */
export function compositePixel(
  layers: readonly FlatLayer[],
  x: number,
  y: number,
): [number, number, number, number] {
  const key = tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  const acc = new Float32Array(4);
  compositeSpan(layers, key, acc, (y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE), 1, 0);
  return toByte(acc, 0);
}

/** Straight RGBA8 of one whole tile of the composite (merge commands, previews). */
export function compositeTile(layers: readonly FlatLayer[], key: TileKey): Uint8ClampedArray {
  const acc = new Float32Array(TILE_PIXELS * 4);
  compositeSpan(layers, key, acc, 0, TILE_PIXELS, 0);
  const out = new Uint8ClampedArray(TILE_PIXELS * 4);
  for (let i = 0; i < out.length; i += 4) out.set(toByte(acc, i), i);
  return out;
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
  const acc = new Float32Array(TILE_PIXELS * 4);
  const rows = Math.ceil(height / TILE_SIZE);
  const cols = Math.ceil(width / TILE_SIZE);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      acc.fill(0);
      compositeSpan(layers, tileKey(tx, ty), acc, 0, TILE_PIXELS, 0);
      const w = Math.min(TILE_SIZE, width - tx * TILE_SIZE);
      const h = Math.min(TILE_SIZE, height - ty * TILE_SIZE);
      for (let y = 0; y < h; y++) {
        let o = ((ty * TILE_SIZE + y) * width + tx * TILE_SIZE) * 4;
        let i = y * TILE_SIZE * 4;
        for (let x = 0; x < w; x++, i += 4, o += 4) if (acc[i + 3]! > 0) out.set(toByte(acc, i), o);
      }
    }
    onRow?.(ty + 1, rows);
  }
  return out;
}

/**
 * Small flattened preview (the `.iep` preview.png, recent-file and layer thumbnails): each output pixel
 * averages a 2×2 grid of composited samples, so thin strokes don't vanish entirely.
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

/** Adapts the live layer tree (engine/doc) to the compositor. */
export function liveLayers(layers: readonly Layer[]): FlatLayer[] {
  return layers.map((l): FlatLayer => {
    const props = {
      visible: l.visible,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      blendMode: l.blendMode,
    };
    if (l.type === 'group')
      return { ...props, kind: 'group', passThrough: l.passThrough, children: liveLayers(l.children) };
    return { ...props, kind: 'raster', tile: (key) => l.tiles.get(key)?.data };
  });
}
