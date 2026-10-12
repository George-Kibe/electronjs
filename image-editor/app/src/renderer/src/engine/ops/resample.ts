import { createTile, TILE_SIZE, tileKey, TileGrid } from '../tiles/tile';
import { contentBounds, type TileRange } from './canvas';

/**
 * Resampling for Image Size (FR-TRF-02) and arbitrary rotation (FR-TRF-03), CPU reference (docs/02 §5.6;
 * runs in the ops worker). Gamma-space sRGB with premultiplied alpha (docs/09 §4.2), so transparent pixels
 * never bleed their colour into neighbours.
 */

export const RESAMPLE_FILTERS = ['bicubic', 'bilinear', 'nearest', 'lanczos'] as const;
export type ResampleFilter = (typeof RESAMPLE_FILTERS)[number];

export const FILTER_LABELS: Record<ResampleFilter, string> = {
  bicubic: 'Bicubic (smooth gradients)',
  bilinear: 'Bilinear',
  nearest: 'Nearest neighbour (hard edges)',
  lanczos: 'Lanczos (sharpest)',
};

const N = TILE_SIZE;
type Rect = { x0: number; y0: number; x1: number; y1: number };

const tileBounds = (grid: TileGrid): Rect | null => contentBounds([grid]);

/** Keys cubic, a = −0.5 (Catmull-Rom), the usual "bicubic". */
export function cubic(x: number): number {
  const t = Math.abs(x);
  if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
  if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
  return 0;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

const KERNELS: Record<Exclude<ResampleFilter, 'nearest'>, { radius: number; fn: (x: number) => number }> = {
  bilinear: { radius: 1, fn: (x) => Math.max(0, 1 - Math.abs(x)) },
  bicubic: { radius: 2, fn: cubic },
  lanczos: { radius: 3, fn: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

type AxisWeights = { first: Int32Array; count: Int32Array; weights: Float32Array; stride: number };

/**
 * Per destination index d in [dst0, dst1): the source taps and normalised weights. Destination pixel
 * centres map to source coordinates (d + 0.5) / scale − 0.5. Downscaling widens the kernel by 1/scale
 * (area averaging), so detail is filtered instead of aliased. Taps are clamped to [src0, src1).
 */
export function axisWeights(
  dst0: number,
  dst1: number,
  src0: number,
  src1: number,
  scale: number,
  filter: ResampleFilter,
): AxisWeights {
  const n = dst1 - dst0;
  if (filter === 'nearest') {
    const first = new Int32Array(n);
    for (let i = 0; i < n; i++)
      first[i] = Math.min(src1 - 1, Math.max(src0, Math.floor((dst0 + i + 0.5) / scale)));
    return { first, count: new Int32Array(n).fill(1), weights: new Float32Array(n).fill(1), stride: 1 };
  }
  const { radius, fn } = KERNELS[filter];
  const stretch = Math.max(1, 1 / scale);
  const support = radius * stretch;
  const stride = Math.ceil(support) * 2 + 1;
  const first = new Int32Array(n);
  const count = new Int32Array(n);
  const weights = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    const center = (dst0 + i + 0.5) / scale - 0.5;
    const lo = Math.ceil(center - support);
    const hi = Math.floor(center + support);
    // Accumulate on clamped indices (edge extension): taps beyond the edge reuse the edge pixel.
    const a = Math.max(src0, Math.min(src1 - 1, lo));
    const b = Math.max(src0, Math.min(src1 - 1, hi));
    first[i] = a;
    count[i] = b - a + 1;
    let sum = 0;
    for (let s = lo; s <= hi; s++) {
      const w = fn((s - center) / stretch);
      const j = Math.max(src0, Math.min(src1 - 1, s)) - a;
      weights[i * stride + j] = weights[i * stride + j]! + w;
      sum += w;
    }
    if (sum !== 0)
      for (let j = 0; j < count[i]!; j++) weights[i * stride + j] = weights[i * stride + j]! / sum;
  }
  return { first, count, weights, stride };
}

/** Reads one source row segment [x0, x1) as premultiplied floats (0..1). */
function readRow(grid: TileGrid, y: number, x0: number, x1: number, out: Float32Array): void {
  out.fill(0);
  const ty = Math.floor(y / N);
  const ly = y - ty * N;
  for (let tx = Math.floor(x0 / N); tx * N < x1; tx++) {
    const tile = grid.get(tileKey(tx, ty));
    if (!tile) continue;
    const d = tile.data;
    const from = Math.max(x0, tx * N);
    const to = Math.min(x1, tx * N + N);
    for (let x = from; x < to; x++) {
      const p = (ly * N + (x - tx * N)) * 4;
      const a = d[p + 3]! / 255;
      if (a === 0) continue;
      const o = (x - x0) * 4;
      out[o] = (d[p]! / 255) * a;
      out[o + 1] = (d[p + 1]! / 255) * a;
      out[o + 2] = (d[p + 2]! / 255) * a;
      out[o + 3] = a;
    }
  }
}

/** Writes premultiplied floats as straight RGBA8 into a tile buffer at pixel index `p`. */
function store(out: Uint8ClampedArray, p: number, r: number, g: number, b: number, a: number): void {
  if (a <= 1 / 510) return; // rounds to alpha 0: leave transparent black
  const alpha = Math.min(1, a);
  out[p] = Math.round(Math.min(1, Math.max(0, r / a)) * 255);
  out[p + 1] = Math.round(Math.min(1, Math.max(0, g / a)) * 255);
  out[p + 2] = Math.round(Math.min(1, Math.max(0, b / a)) * 255);
  out[p + 3] = Math.round(alpha * 255);
}

function hasAlpha(d: Uint8ClampedArray): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
  return false;
}

/**
 * Image Size: scales the pixel plane of a srcW×srcH canvas to dstW×dstH. Works band by band (one tile row of
 * output at a time), so memory stays proportional to the output width. Edges extend (no fringe at the
 * canvas edge); pixels outside the canvas are scaled with it.
 */
export function resampleGrid(
  grid: TileGrid,
  src: { width: number; height: number },
  dst: { width: number; height: number },
  filter: ResampleFilter,
  range: TileRange,
  onRow?: (done: number, total: number) => void,
): TileGrid {
  const out = new TileGrid();
  const tb = tileBounds(grid);
  if (!tb) return out;
  const sx = dst.width / src.width;
  const sy = dst.height / src.height;
  // Source region: canvas ∪ tiles. Edge extension clamps to it.
  const S: Rect = {
    x0: Math.min(0, tb.x0),
    y0: Math.min(0, tb.y0),
    x1: Math.max(src.width, tb.x1),
    y1: Math.max(src.height, tb.y1),
  };
  const D: Rect = {
    x0: Math.max(range.tx0 * N, Math.floor(S.x0 * sx)),
    y0: Math.max(range.ty0 * N, Math.floor(S.y0 * sy)),
    x1: Math.min(range.tx1 * N, Math.ceil(S.x1 * sx)),
    y1: Math.min(range.ty1 * N, Math.ceil(S.y1 * sy)),
  };
  if (D.x1 <= D.x0 || D.y1 <= D.y0) return out;
  const hw = axisWeights(D.x0, D.x1, S.x0, S.x1, sx, filter);
  const dstW = D.x1 - D.x0;
  const srcRow = new Float32Array((S.x1 - S.x0) * 4);
  const rowCache = new Map<number, Float32Array>();
  /** Source row y, horizontally resampled to the destination width. */
  const hRow = (y: number): Float32Array => {
    let row = rowCache.get(y);
    if (row) return row;
    readRow(grid, y, S.x0, S.x1, srcRow);
    row = new Float32Array(dstW * 4);
    for (let i = 0; i < dstW; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const f = hw.first[i]! - S.x0;
      for (let j = 0; j < hw.count[i]!; j++) {
        const w = hw.weights[i * hw.stride + j]!;
        const p = (f + j) * 4;
        r += srcRow[p]! * w;
        g += srcRow[p + 1]! * w;
        b += srcRow[p + 2]! * w;
        a += srcRow[p + 3]! * w;
      }
      row[i * 4] = r;
      row[i * 4 + 1] = g;
      row[i * 4 + 2] = b;
      row[i * 4 + 3] = a;
    }
    rowCache.set(y, row);
    return row;
  };
  const ty0 = Math.floor(D.y0 / N);
  const ty1 = Math.ceil(D.y1 / N);
  for (let ty = ty0; ty < ty1; ty++) {
    const by0 = Math.max(D.y0, ty * N);
    const by1 = Math.min(D.y1, ty * N + N);
    const vw = axisWeights(by0, by1, S.y0, S.y1, sy, filter);
    // Drop cached rows the band no longer needs.
    const need = vw.first[0]!;
    for (const y of rowCache.keys()) if (y < need) rowCache.delete(y);
    const tiles = new Map<number, Uint8ClampedArray>();
    for (let i = 0; i < by1 - by0; i++) {
      const y = by0 + i;
      const ly = y - ty * N;
      const rows: Float32Array[] = [];
      for (let j = 0; j < vw.count[i]!; j++) rows.push(hRow(vw.first[i]! + j));
      for (let x = 0; x < dstW; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let j = 0; j < rows.length; j++) {
          const w = vw.weights[i * vw.stride + j]!;
          const row = rows[j]!;
          r += row[x * 4]! * w;
          g += row[x * 4 + 1]! * w;
          b += row[x * 4 + 2]! * w;
          a += row[x * 4 + 3]! * w;
        }
        if (a <= 1 / 510) continue;
        const X = D.x0 + x;
        const tx = Math.floor(X / N);
        let t = tiles.get(tx);
        if (!t) tiles.set(tx, (t = new Uint8ClampedArray(N * N * 4)));
        store(t, (ly * N + (X - tx * N)) * 4, r, g, b, a);
      }
    }
    for (const [tx, data] of tiles) if (hasAlpha(data)) out.set(tileKey(tx, ty), createTile(data));
    onRow?.(ty - ty0 + 1, ty1 - ty0);
  }
  return out;
}

/** New canvas size that holds a width×height canvas rotated by `degrees` (Image Rotation › Arbitrary). */
export function rotatedCanvasSize(
  width: number,
  height: number,
  degrees: number,
): { width: number; height: number } {
  const t = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  // Round away float noise (e.g. cos 90° ≈ 6e-17) before taking the ceiling.
  const fit = (v: number) => Math.max(1, Math.ceil(Math.round(v * 1e6) / 1e6));
  return { width: fit(width * c + height * s), height: fit(width * s + height * c) };
}

/**
 * Rotates the pixel plane clockwise by `degrees` around the canvas centre, onto a canvas of `dst` size
 * whose centre the old centre maps to. Bicubic (Catmull-Rom); outside the source is transparent, so the
 * corners of the rotated canvas are transparent.
 */
export function rotateArbitraryGrid(
  grid: TileGrid,
  src: { width: number; height: number },
  dst: { width: number; height: number },
  degrees: number,
  range: TileRange,
  onRow?: (done: number, total: number) => void,
): TileGrid {
  const out = new TileGrid();
  const tb = tileBounds(grid);
  if (!tb) return out;
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const scx = src.width / 2;
  const scy = src.height / 2;
  const dcx = dst.width / 2;
  const dcy = dst.height / 2;
  // Forward map (source → destination), for the destination bounds of the content.
  const fwd = (x: number, y: number): [number, number] => [
    dcx + (x - scx) * cos - (y - scy) * sin,
    dcy + (x - scx) * sin + (y - scy) * cos,
  ];
  const corners = [fwd(tb.x0, tb.y0), fwd(tb.x1, tb.y0), fwd(tb.x0, tb.y1), fwd(tb.x1, tb.y1)];
  const D: Rect = {
    x0: Math.max(range.tx0 * N, Math.floor(Math.min(...corners.map((c) => c[0])) - 2)),
    y0: Math.max(range.ty0 * N, Math.floor(Math.min(...corners.map((c) => c[1])) - 2)),
    x1: Math.min(range.tx1 * N, Math.ceil(Math.max(...corners.map((c) => c[0])) + 2)),
    y1: Math.min(range.ty1 * N, Math.ceil(Math.max(...corners.map((c) => c[1])) + 2)),
  };
  if (D.x1 <= D.x0 || D.y1 <= D.y0) return out;
  const tx0 = Math.floor(D.x0 / N);
  const ty0 = Math.floor(D.y0 / N);
  const tx1 = Math.ceil(D.x1 / N);
  const ty1 = Math.ceil(D.y1 / N);
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      // Source patch under this destination tile (inverse-mapped corners + the bicubic apron).
      const inv = (x: number, y: number): [number, number] => [
        scx + (x - dcx) * cos + (y - dcy) * sin,
        scy - (x - dcx) * sin + (y - dcy) * cos,
      ];
      const pc = [
        inv(tx * N, ty * N),
        inv(tx * N + N, ty * N),
        inv(tx * N, ty * N + N),
        inv(tx * N + N, ty * N + N),
      ];
      const px0 = Math.floor(Math.min(...pc.map((c) => c[0]))) - 3;
      const py0 = Math.floor(Math.min(...pc.map((c) => c[1]))) - 3;
      const px1 = Math.ceil(Math.max(...pc.map((c) => c[0]))) + 3;
      const py1 = Math.ceil(Math.max(...pc.map((c) => c[1]))) + 3;
      if (px1 <= tb.x0 || px0 >= tb.x1 || py1 <= tb.y0 || py0 >= tb.y1) continue;
      const pw = px1 - px0;
      const patch = new Float32Array(pw * (py1 - py0) * 4);
      const row = new Float32Array(pw * 4);
      for (let y = Math.max(py0, tb.y0); y < Math.min(py1, tb.y1); y++) {
        readRow(grid, y, px0, px1, row);
        patch.set(row, (y - py0) * pw * 4);
      }
      const data = new Uint8ClampedArray(N * N * 4);
      const wx = new Float32Array(4);
      const wy = new Float32Array(4);
      for (let ly = 0; ly < N; ly++) {
        for (let lx = 0; lx < N; lx++) {
          const [sxp, syp] = inv(tx * N + lx + 0.5, ty * N + ly + 0.5);
          const u = sxp - 0.5 - px0;
          const v = syp - 0.5 - py0;
          const iu = Math.floor(u);
          const iv = Math.floor(v);
          if (iu < 1 || iv < 1 || iu + 2 >= pw || iv + 2 >= py1 - py0) continue;
          for (let k = 0; k < 4; k++) {
            wx[k] = cubic(u - (iu - 1 + k));
            wy[k] = cubic(v - (iv - 1 + k));
          }
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let j = 0; j < 4; j++) {
            const base = ((iv - 1 + j) * pw + iu - 1) * 4;
            for (let k = 0; k < 4; k++) {
              const w = wx[k]! * wy[j]!;
              const p = base + k * 4;
              r += patch[p]! * w;
              g += patch[p + 1]! * w;
              b += patch[p + 2]! * w;
              a += patch[p + 3]! * w;
            }
          }
          store(data, (ly * N + lx) * 4, r, g, b, a);
        }
      }
      if (hasAlpha(data)) out.set(tileKey(tx, ty), createTile(data));
    }
    onRow?.(ty - ty0 + 1, ty1 - ty0);
  }
  return out;
}

/**
 * Largest axis-aligned rectangle inside a width×height rectangle rotated by `degrees`, centred (Straighten
 * crops to it so no transparent corners remain). Returns its size.
 */
export function inscribedSize(
  width: number,
  height: number,
  degrees: number,
): { width: number; height: number } {
  const t = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(t));
  const cos = Math.abs(Math.cos(t));
  if (sin < 1e-12) return { width, height };
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  let w: number;
  let h: number;
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * short;
    [w, h] = width >= height ? [x / sin, x / cos] : [x / cos, x / sin];
  } else {
    const cos2 = cos * cos - sin * sin;
    w = (width * cos - height * sin) / cos2;
    h = (height * cos - width * sin) / cos2;
  }
  return { width: Math.max(1, Math.floor(w) - 2), height: Math.max(1, Math.floor(h) - 2) };
}
