import { TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import type { FilterInput } from './filters';

/**
 * Filters that are not separable (FR-FLT-01): each output tile is computed from a window of the layer
 * around it (the tile plus `reach` pixels on each side, canvas edges repeated), in premultiplied alpha. The
 * CPU reference for a later GPU path; see filters.ts for how the result is mixed with the original.
 */
export type WindowFilter =
  | { kind: 'motion-blur'; angle: number; distance: number }
  | {
      kind: 'add-noise';
      amount: number;
      distribution: 'uniform' | 'gaussian';
      monochromatic: boolean;
      seed: number;
    }
  | { kind: 'reduce-noise'; radius: number }
  | { kind: 'mosaic'; cellSize: number }
  | { kind: 'emboss'; angle: number; height: number; amount: number }
  | { kind: 'find-edges' }
  | { kind: 'vignette'; amount: number; midpoint: number };

/** How far (px) a window filter reads around each output pixel. */
export function windowReach(f: WindowFilter): number {
  switch (f.kind) {
    case 'motion-blur':
      return Math.ceil(f.distance / 2) + 1;
    case 'reduce-noise':
      return Math.round(f.radius);
    case 'mosaic':
      return Math.max(1, Math.round(f.cellSize)) - 1;
    case 'emboss':
      return Math.ceil(f.height) + 1;
    case 'find-edges':
      return 1;
    default:
      return 0;
  }
}

/** One output tile from its window (side × side, premultiplied RGBA, the tile at offset reach,reach). */
type Kernel = (ctx: {
  win: Float32Array;
  side: number;
  reach: number;
  out: Float32Array;
  /** The tile's origin and the canvas size, in document px. */
  x0: number;
  y0: number;
  width: number;
  height: number;
}) => void;

const N = TILE_SIZE;
const INV255 = 1 / 255;

/** Bilinear premultiplied sample of the window at (x, y) (window px; clamped to the window). */
function sample(win: Float32Array, side: number, x: number, y: number, into: Float32Array): void {
  const fx = Math.min(side - 1, Math.max(0, x - 0.5));
  const fy = Math.min(side - 1, Math.max(0, y - 0.5));
  const ix = Math.min(side - 2, Math.floor(fx));
  const iy = Math.min(side - 2, Math.floor(fy));
  const tx = fx - ix;
  const ty = fy - iy;
  const i00 = (iy * side + ix) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + side * 4;
  const i11 = i01 + 4;
  for (let c = 0; c < 4; c++) {
    const top = win[i00 + c]! + (win[i10 + c]! - win[i00 + c]!) * tx;
    const bottom = win[i01 + c]! + (win[i11 + c]! - win[i01 + c]!) * tx;
    into[c] = top + (bottom - top) * ty;
  }
}

/** A 32-bit integer hash (deterministic noise: the preview's tiles and the commit's agree). */
function hash(x: number, y: number, c: number, seed: number): number {
  let h =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(c + 1, 1274126177) ^
    Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

function kernelOf(f: WindowFilter): Kernel {
  switch (f.kind) {
    case 'motion-blur': {
      // The average along a line of `distance` px through the pixel, at `angle` (counter-clockwise).
      const n = Math.max(1, Math.round(f.distance));
      const dx = Math.cos((f.angle * Math.PI) / 180);
      const dy = -Math.sin((f.angle * Math.PI) / 180);
      const px = new Float32Array(4);
      return ({ win, side, reach, out }) => {
        for (let ly = 0; ly < N; ly++)
          for (let lx = 0; lx < N; lx++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let i = 0; i < n; i++) {
              const t = -f.distance / 2 + (f.distance * (i + 0.5)) / n;
              sample(win, side, reach + lx + 0.5 + t * dx, reach + ly + 0.5 + t * dy, px);
              r += px[0]!;
              g += px[1]!;
              b += px[2]!;
              a += px[3]!;
            }
            const o = (ly * N + lx) * 4;
            out[o] = r / n;
            out[o + 1] = g / n;
            out[o + 2] = b / n;
            out[o + 3] = a / n;
          }
      };
    }
    case 'add-noise': {
      // Per pixel and channel: uniform in ±amount/2, or Gaussian with σ = amount/5 (both of the 0..1 range).
      const k = f.amount / 100;
      const noise = (x: number, y: number, c: number) => {
        if (f.distribution === 'uniform') return (hash(x, y, c, f.seed) * 2 - 1) * (k / 2);
        const u1 = Math.max(1e-7, hash(x, y, c, f.seed));
        const u2 = hash(x, y, c + 7, f.seed);
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * (k / 5);
      };
      return ({ win, side, reach, out, x0, y0 }) => {
        for (let ly = 0; ly < N; ly++)
          for (let lx = 0; lx < N; lx++) {
            const i = ((reach + ly) * side + reach + lx) * 4;
            const o = (ly * N + lx) * 4;
            const a = win[i + 3]!;
            out[o + 3] = a;
            if (a <= 0) continue;
            const x = x0 + lx;
            const y = y0 + ly;
            const mono = f.monochromatic ? noise(x, y, 0) : 0;
            for (let c = 0; c < 3; c++) {
              const v = win[i + c]! / a + (f.monochromatic ? mono : noise(x, y, c));
              out[o + c] = Math.min(1, Math.max(0, v)) * a;
            }
          }
      };
    }
    case 'reduce-noise':
      return medianKernel(Math.round(f.radius));
    case 'mosaic': {
      // Squares of `cellSize` from the canvas origin, each the average of its pixels on the canvas.
      const c = Math.max(1, Math.round(f.cellSize));
      return ({ win, side, reach, out, x0, y0, width, height }) => {
        for (let cy = Math.floor(y0 / c) * c; cy < y0 + N; cy += c)
          for (let cx = Math.floor(x0 / c) * c; cx < x0 + N; cx += c) {
            const ax = Math.max(cx, 0);
            const ay = Math.max(cy, 0);
            const bx = Math.min(cx + c, width);
            const by = Math.min(cy + c, height);
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            let count = 0;
            for (let y = ay; y < by; y++)
              for (let x = ax; x < bx; x++) {
                const wx = x - x0 + reach;
                const wy = y - y0 + reach;
                if (wx < 0 || wy < 0 || wx >= side || wy >= side) continue;
                const i = (wy * side + wx) * 4;
                r += win[i]!;
                g += win[i + 1]!;
                b += win[i + 2]!;
                a += win[i + 3]!;
                count++;
              }
            if (count === 0) continue;
            for (let y = Math.max(cy, y0); y < Math.min(cy + c, y0 + N); y++)
              for (let x = Math.max(cx, x0); x < Math.min(cx + c, x0 + N); x++) {
                const o = ((y - y0) * N + (x - x0)) * 4;
                out[o] = r / count;
                out[o + 1] = g / count;
                out[o + 2] = b / count;
                out[o + 3] = a / count;
              }
          }
      };
    }
    case 'emboss': {
      // Grey: mid-grey plus the difference in lightness across the pixel, along `angle`, scaled by amount.
      const dx = f.height * Math.cos((f.angle * Math.PI) / 180);
      const dy = -f.height * Math.sin((f.angle * Math.PI) / 180);
      const k = f.amount / 100;
      const p = new Float32Array(4);
      const q = new Float32Array(4);
      const straightLuma = (s: Float32Array) => (s[3]! > 0 ? luma(s[0]!, s[1]!, s[2]!) / s[3]! : 0);
      return ({ win, side, reach, out }) => {
        for (let ly = 0; ly < N; ly++)
          for (let lx = 0; lx < N; lx++) {
            const cx = reach + lx + 0.5;
            const cy = reach + ly + 0.5;
            sample(win, side, cx + dx, cy + dy, p);
            sample(win, side, cx - dx, cy - dy, q);
            const v = Math.min(1, Math.max(0, 0.5 + (straightLuma(p) - straightLuma(q)) * k));
            const i = ((reach + ly) * side + reach + lx) * 4;
            const a = win[i + 3]!;
            const o = (ly * N + lx) * 4;
            out[o] = out[o + 1] = out[o + 2] = v * a;
            out[o + 3] = a;
          }
      };
    }
    case 'find-edges':
      // Sobel per channel on the straight colour: white where flat, the edges dark and coloured.
      return ({ win, side, reach, out }) => {
        const at = (x: number, y: number, c: number) => {
          const i = (y * side + x) * 4;
          const a = win[i + 3]!;
          return a > 0 ? win[i + c]! / a : 0;
        };
        for (let ly = 0; ly < N; ly++)
          for (let lx = 0; lx < N; lx++) {
            const x = reach + lx;
            const y = reach + ly;
            const i = (y * side + x) * 4;
            const a = win[i + 3]!;
            const o = (ly * N + lx) * 4;
            out[o + 3] = a;
            for (let c = 0; c < 3; c++) {
              const gx =
                at(x + 1, y - 1, c) +
                2 * at(x + 1, y, c) +
                at(x + 1, y + 1, c) -
                at(x - 1, y - 1, c) -
                2 * at(x - 1, y, c) -
                at(x - 1, y + 1, c);
              const gy =
                at(x - 1, y + 1, c) +
                2 * at(x, y + 1, c) +
                at(x + 1, y + 1, c) -
                at(x - 1, y - 1, c) -
                2 * at(x, y - 1, c) -
                at(x + 1, y - 1, c);
              out[o + c] = (1 - Math.min(1, (Math.abs(gx) + Math.abs(gy)) / 2)) * a;
            }
          }
      };
    case 'vignette': {
      // Darker (amount < 0) or lighter (> 0) towards the corners, starting at `midpoint` of the way out.
      const k = f.amount / 100;
      const m = Math.min(0.99, f.midpoint / 100);
      return ({ win, side, reach, out, x0, y0, width, height }) => {
        for (let ly = 0; ly < N; ly++)
          for (let lx = 0; lx < N; lx++) {
            const nx = (x0 + lx + 0.5 - width / 2) / (width / 2);
            const ny = (y0 + ly + 0.5 - height / 2) / (height / 2);
            const d = Math.min(1, Math.sqrt(nx * nx + ny * ny) / Math.SQRT2);
            const s = Math.min(1, Math.max(0, (d - m) / (1 - m)));
            const t = s * s * (3 - 2 * s);
            const i = ((reach + ly) * side + reach + lx) * 4;
            const o = (ly * N + lx) * 4;
            const a = win[i + 3]!;
            out[o + 3] = a;
            for (let c = 0; c < 3; c++) {
              const v = a > 0 ? win[i + c]! / a : 0;
              const w = k < 0 ? v * (1 + k * t) : v + (1 - v) * k * t;
              out[o + c] = w * a;
            }
          }
      };
    }
  }
}

/**
 * Median of each channel (straight colour and alpha) over the (2r + 1)² square: Huang's sliding histogram,
 * O(r) per pixel, with the median tracked as the window slides along each row.
 */
function medianKernel(r: number): Kernel {
  return ({ win, side, reach, out }) => {
    // The window as straight 8-bit values.
    const bytes = new Uint8Array(side * side * 4);
    for (let i = 0; i < bytes.length; i += 4) {
      const a = win[i + 3]!;
      bytes[i + 3] = Math.round(a * 255);
      if (a <= 0) continue;
      bytes[i] = Math.round((win[i]! / a) * 255);
      bytes[i + 1] = Math.round((win[i + 1]! / a) * 255);
      bytes[i + 2] = Math.round((win[i + 2]! / a) * 255);
    }
    const hist = new Uint32Array(4 * 256);
    const half = ((2 * r + 1) * (2 * r + 1)) >> 1;
    const med = new Int32Array(4);
    const below = new Int32Array(4);
    const column = (wx: number, wy0: number, sign: number) => {
      for (let wy = wy0; wy <= wy0 + 2 * r; wy++) {
        const i = (wy * side + wx) * 4;
        for (let c = 0; c < 4; c++) {
          const v = bytes[i + c]!;
          hist[c * 256 + v]! += sign;
          if (v < med[c]!) below[c]! += sign;
        }
      }
    };
    for (let ly = 0; ly < N; ly++) {
      hist.fill(0);
      med.fill(0);
      below.fill(0);
      const wy0 = reach + ly - r;
      for (let wx = reach - r; wx <= reach + r; wx++) column(wx, wy0, 1);
      for (let lx = 0; lx < N; lx++) {
        if (lx > 0) {
          column(reach + lx - r - 1, wy0, -1);
          column(reach + lx + r, wy0, 1);
        }
        const o = (ly * N + lx) * 4;
        for (let c = 0; c < 4; c++) {
          // Move the tracked median until `half` values lie below it and fewer than half + 1 at or below.
          let m = med[c]!;
          let lt = below[c]!;
          while (lt > half && m > 0) lt -= hist[c * 256 + --m]!;
          while (m < 255 && lt + hist[c * 256 + m]! <= half) lt += hist[c * 256 + m++]!;
          med[c] = m;
          below[c] = lt;
        }
        const a = med[3]! * INV255;
        out[o] = med[0]! * INV255 * a;
        out[o + 1] = med[1]! * INV255 * a;
        out[o + 2] = med[2]! * INV255 * a;
        out[o + 3] = a;
      }
    }
  };
}

/** Writes one output pixel (see filters.ts `combine`). */
export type CombinePixel = (
  orig: Uint8Array | null,
  oi: number,
  filtered: Float32Array,
  fi: number,
  k: number,
  out: Uint8Array,
) => void;

/** Runs a window filter over the wanted tiles of the canvas (see filters.ts applyFilter). */
export function runWindowFilter(
  f: WindowFilter,
  input: FilterInput,
  combine: CombinePixel,
  onTile?: (done: number, total: number) => void,
): Array<[TileKey, Uint8Array]> {
  const { width: W, height: H } = input.size;
  const reach = windowReach(f);
  const side = N + 2 * reach;
  const kernel = kernelOf(f);
  const win = new Float32Array(side * side * 4);
  const filtered = new Float32Array(N * N * 4);
  const wanted: Array<[number, number]> = [];
  for (let ty = 0; ty < Math.ceil(H / N); ty++)
    for (let tx = 0; tx < Math.ceil(W / N); tx++) {
      const key = tileKey(tx, ty);
      if (input.keys && !input.keys.has(key)) continue;
      if (input.selection && !input.selection.get(key)) continue;
      wanted.push([tx, ty]);
    }
  const out: Array<[TileKey, Uint8Array]> = [];
  wanted.forEach(([tx, ty], n) => {
    const x0 = tx * N;
    const y0 = ty * N;
    // The window, read row by row (canvas edges repeated).
    for (let wy = 0; wy < side; wy++) {
      const y = Math.min(H - 1, Math.max(0, y0 - reach + wy));
      const sty = Math.floor(y / N);
      const ly = y - sty * N;
      let lastKey = '';
      let t: Uint8Array | undefined;
      for (let wx = 0; wx < side; wx++) {
        const x = Math.min(W - 1, Math.max(0, x0 - reach + wx));
        const stx = Math.floor(x / N);
        const key = `${stx},${sty}`;
        if (key !== lastKey) {
          lastKey = key;
          t = input.tiles.get(key as TileKey);
        }
        const d = (wy * side + wx) * 4;
        if (!t) {
          win[d] = win[d + 1] = win[d + 2] = win[d + 3] = 0;
          continue;
        }
        const s = (ly * N + (x - stx * N)) * 4;
        const a = t[s + 3]! * INV255;
        win[d] = t[s]! * INV255 * a;
        win[d + 1] = t[s + 1]! * INV255 * a;
        win[d + 2] = t[s + 2]! * INV255 * a;
        win[d + 3] = a;
      }
    }
    filtered.fill(0);
    kernel({ win, side, reach, out: filtered, x0, y0, width: W, height: H });
    const key = tileKey(tx, ty);
    const src = input.tiles.get(key) ?? null;
    const sel = input.selection?.get(key) ?? null;
    const data = src ? new Uint8Array(src) : new Uint8Array(N * N * 4);
    const w = Math.min(N, W - x0);
    const h = Math.min(N, H - y0);
    for (let ly = 0; ly < h; ly++)
      for (let lx = 0; lx < w; lx++) {
        const p = ly * N + lx;
        const k = sel ? sel[p]! * INV255 : 1;
        if (k > 0) combine(src, p * 4, filtered, p * 4, k, data);
      }
    let any = false;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] !== 0) {
        any = true;
        break;
      }
    if (any) out.push([key, data]);
    else if (src) out.push([key, new Uint8Array(0)]);
    onTile?.(n + 1, wanted.length);
  });
  return out;
}
