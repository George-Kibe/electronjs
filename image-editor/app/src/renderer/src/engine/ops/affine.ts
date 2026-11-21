import { createTile, TILE_SIZE, tileKey, TileGrid } from '../tiles/tile';
import { contentBounds, type TileRange } from './canvas';
import { cubic } from './resample';

/**
 * Free Transform's commit (FR-TRF-04, docs/02 §5.6): re-rasterizes a layer under an affine matrix with
 * bicubic sampling in premultiplied alpha. When the transform shrinks the image, the kernel widens by the
 * inverse scale along each source axis (with normalised weights), so reductions do not alias. Runs in the ops
 * worker; pure, so tests run the same code.
 */

/** x' = a·x + c·y + e, y' = b·x + d·y + f (the canvas / DOMMatrix convention). */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** `outer` after `inner`. */
export function multiply(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new RangeError('The transform is flat (zero area)');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function isIdentity(m: Affine): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9);
}

/**
 * A flip or a 90° turn at 100 % moves pixels onto whole pixels when the offset is whole: rounding it keeps
 * them bit-exact instead of resampling by half a pixel. Other transforms are returned as they are.
 */
export function snapExact(m: Affine): Affine {
  const near = (v: number, t: number) => Math.abs(v - t) < 1e-9;
  const unit = (v: number) => near(Math.abs(v), 1);
  const straight =
    (unit(m[0]) && unit(m[3]) && near(m[1], 0) && near(m[2], 0)) ||
    (unit(m[1]) && unit(m[2]) && near(m[0], 0) && near(m[3], 0));
  if (!straight) return m;
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v));
  return [r(m[0]), r(m[1]), r(m[2]), r(m[3]), Math.round(m[4]) || 0, Math.round(m[5]) || 0];
}

const N = TILE_SIZE;

/**
 * Alpha → 255 − alpha in every tile; tiles that become fully transparent are dropped. A reveal-all mask
 * (missing tile = opaque) becomes a grid where missing means transparent, which transforms correctly.
 */
export function invertAlpha(grid: TileGrid): TileGrid {
  const out = new TileGrid();
  for (const [key, tile] of grid.entries()) {
    const data = new Uint8ClampedArray(tile.data);
    let any = false;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255 - data[i]!;
      if (data[i]) any = true;
    }
    if (any) out.set(key, createTile(data));
  }
  return out;
}

/** `top` over `bottom` (source-over, straight alpha); tiles only one of them has are shared. */
export function sourceOver(top: TileGrid, bottom: TileGrid): TileGrid {
  const out = new TileGrid();
  for (const [key, t] of bottom.entries()) out.set(key, t);
  for (const [key, t] of top.entries()) {
    const b = bottom.get(key);
    if (!b) {
      out.set(key, t);
      continue;
    }
    const data = new Uint8ClampedArray(b.data);
    const s = t.data;
    for (let i = 0; i < data.length; i += 4) {
      const at = s[i + 3]! / 255;
      if (at === 0) continue;
      const ab = (data[i + 3]! / 255) * (1 - at);
      const a = at + ab;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round((s[i + c]! * at + data[i + c]! * ab) / a);
      data[i + 3] = Math.round(a * 255);
    }
    out.set(key, createTile(data));
  }
  return out;
}

/** Premultiplied float RGBA of one source pixel (0 outside tiles). */
function sampler(grid: TileGrid) {
  let lastKey = '';
  let last: Uint8ClampedArray | undefined;
  return (x: number, y: number, out: Float32Array): void => {
    const tx = Math.floor(x / N);
    const ty = Math.floor(y / N);
    const key = tileKey(tx, ty);
    if (key !== lastKey) {
      lastKey = key;
      last = grid.get(key)?.data;
    }
    if (!last) {
      out.fill(0);
      return;
    }
    const p = ((y - ty * N) * N + (x - tx * N)) * 4;
    const a = last[p + 3]! / 255;
    out[0] = (last[p]! / 255) * a;
    out[1] = (last[p + 1]! / 255) * a;
    out[2] = (last[p + 2]! / 255) * a;
    out[3] = a;
  };
}

/** The grid transformed by `m` (source document px → destination document px), within `range`. */
export function affineGrid(
  grid: TileGrid,
  m: Affine,
  range: TileRange,
  onRow?: (done: number, total: number) => void,
): TileGrid {
  const out = new TileGrid();
  const tb = contentBounds([grid]);
  if (!tb) return out;
  if (isIdentity(m)) {
    for (const [k, t] of grid.entries()) out.set(k, t);
    return out;
  }
  const inv = invert(m);
  // How far one destination pixel reaches in the source along each source axis (> 1 = reduction).
  const fx = Math.max(1, Math.hypot(inv[0], inv[2]));
  const fy = Math.max(1, Math.hypot(inv[1], inv[3]));
  const rx = 2 * fx;
  const ry = 2 * fy;
  const corners = [
    apply(m, tb.x0, tb.y0),
    apply(m, tb.x1, tb.y0),
    apply(m, tb.x0, tb.y1),
    apply(m, tb.x1, tb.y1),
  ];
  const x0 = Math.max(range.tx0 * N, Math.floor(Math.min(...corners.map((c) => c[0]))) - 2);
  const y0 = Math.max(range.ty0 * N, Math.floor(Math.min(...corners.map((c) => c[1]))) - 2);
  const x1 = Math.min(range.tx1 * N, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 2);
  const y1 = Math.min(range.ty1 * N, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 2);
  if (x1 <= x0 || y1 <= y0) return out;
  const read = sampler(grid);
  const px = new Float32Array(4);
  const ty0 = Math.floor(y0 / N);
  const ty1 = Math.ceil(y1 / N);
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = Math.floor(x0 / N); tx < Math.ceil(x1 / N); tx++) {
      const data = new Uint8ClampedArray(N * N * 4);
      let any = false;
      for (let ly = 0; ly < N; ly++) {
        for (let lx = 0; lx < N; lx++) {
          const [sx, sy] = apply(inv, tx * N + lx + 0.5, ty * N + ly + 0.5);
          const u = sx - 0.5;
          const v = sy - 0.5;
          if (u < tb.x0 - rx - 1 || u > tb.x1 + rx || v < tb.y0 - ry - 1 || v > tb.y1 + ry) continue;
          const i0 = Math.ceil(u - rx);
          const i1 = Math.floor(u + rx);
          const j0 = Math.ceil(v - ry);
          const j1 = Math.floor(v + ry);
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let wsum = 0;
          for (let j = j0; j <= j1; j++) {
            const wy = cubic((v - j) / fy);
            if (wy === 0) continue;
            for (let i = i0; i <= i1; i++) {
              const w = cubic((u - i) / fx) * wy;
              if (w === 0) continue;
              wsum += w;
              if (i < tb.x0 || i >= tb.x1 || j < tb.y0 || j >= tb.y1) continue;
              read(i, j, px);
              r += px[0]! * w;
              g += px[1]! * w;
              b += px[2]! * w;
              a += px[3]! * w;
            }
          }
          if (wsum === 0 || a <= 0) continue;
          a /= wsum;
          if (a <= 1 / 510) continue;
          const o = (ly * N + lx) * 4;
          data[o] = Math.round(Math.min(1, Math.max(0, r / wsum / a)) * 255);
          data[o + 1] = Math.round(Math.min(1, Math.max(0, g / wsum / a)) * 255);
          data[o + 2] = Math.round(Math.min(1, Math.max(0, b / wsum / a)) * 255);
          data[o + 3] = Math.round(Math.min(1, a) * 255);
          any = true;
        }
      }
      if (any) out.set(tileKey(tx, ty), createTile(data));
    }
    onRow?.(ty - ty0 + 1, ty1 - ty0);
  }
  return out;
}
