import { TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';
import { runWindowFilter, windowReach, type WindowFilter } from './window-filters';

/**
 * Filters (FR-FLT-01, docs/02 §5.5): destructive, applied to the canvas area of one layer, within the
 * selection by its coverage. Pixels beyond the canvas edge are read as the edge pixels (Photoshop's "repeat
 * edge pixels"), so a blurred photo keeps opaque edges; pixels kept outside the canvas are left alone.
 * Blurs work in premultiplied alpha. Runs in the ops worker; the dialog previews the same code on the tiles in
 * view, so the preview is the result.
 */
export type Filter =
  | { kind: 'gaussian-blur'; radius: number }
  | { kind: 'box-blur'; radius: number }
  | { kind: 'sharpen' }
  | { kind: 'unsharp-mask'; amount: number; radius: number; threshold: number }
  | WindowFilter;

export type FilterKind = Filter['kind'];
export type FilterOf<K extends FilterKind> = Extract<Filter, { kind: K }>;

export const FILTER_LABELS: Record<FilterKind, string> = {
  'gaussian-blur': 'Gaussian Blur',
  'box-blur': 'Box Blur',
  sharpen: 'Sharpen',
  'unsharp-mask': 'Unsharp Mask',
  'motion-blur': 'Motion Blur',
  'add-noise': 'Add Noise',
  'reduce-noise': 'Reduce Noise',
  mosaic: 'Mosaic',
  emboss: 'Emboss',
  'find-edges': 'Find Edges',
  vignette: 'Vignette',
};

/** Photoshop's defaults. */
export function defaultFilter<K extends FilterKind>(kind: K): FilterOf<K> {
  const all: { [P in FilterKind]: FilterOf<P> } = {
    'gaussian-blur': { kind: 'gaussian-blur', radius: 2 },
    'box-blur': { kind: 'box-blur', radius: 5 },
    sharpen: { kind: 'sharpen' },
    'unsharp-mask': { kind: 'unsharp-mask', amount: 100, radius: 1, threshold: 0 },
    'motion-blur': { kind: 'motion-blur', angle: 0, distance: 10 },
    'add-noise': { kind: 'add-noise', amount: 12.5, distribution: 'uniform', monochromatic: false, seed: 1 },
    'reduce-noise': { kind: 'reduce-noise', radius: 1 },
    mosaic: { kind: 'mosaic', cellSize: 10 },
    emboss: { kind: 'emboss', angle: 135, height: 3, amount: 100 },
    'find-edges': { kind: 'find-edges' },
    vignette: { kind: 'vignette', amount: -50, midpoint: 50 },
  };
  return { ...all[kind] };
}

/** Filters that open a dialog (the others apply at once, like Photoshop's Sharpen). */
export const hasSettings = (kind: FilterKind) => kind !== 'sharpen' && kind !== 'find-edges';

const SEPARABLE = new Set<FilterKind>(['gaussian-blur', 'box-blur', 'sharpen', 'unsharp-mask']);
const isWindow = (f: Filter): f is WindowFilter => !SEPARABLE.has(f.kind);

// ---- one line (a row or a column), RGBA interleaved, premultiplied, edges repeated --------------

/** A box of radius `r` (width 2r + 1) along `n` pixels, by a running sum: O(n) whatever the radius. */
export function boxLine(src: Float32Array, dst: Float32Array, n: number, r: number): void {
  if (r <= 0 || n === 1) {
    dst.set(src.subarray(0, n * 4));
    return;
  }
  const inv = 1 / (2 * r + 1);
  const last = (n - 1) * 4;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (let k = -r; k <= r; k++) {
    const j = Math.min(n - 1, Math.max(0, k)) * 4;
    s0 += src[j]!;
    s1 += src[j + 1]!;
    s2 += src[j + 2]!;
    s3 += src[j + 3]!;
  }
  // The window [i − r, i + r] slides one pixel each step; indices beyond the ends repeat the edge pixel.
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    dst[o] = s0 * inv;
    dst[o + 1] = s1 * inv;
    dst[o + 2] = s2 * inv;
    dst[o + 3] = s3 * inv;
    const ai = i + r + 1;
    const ri = i - r;
    const add = ai < n ? ai * 4 : last;
    const rem = ri > 0 ? ri * 4 : 0;
    s0 += src[add]! - src[rem]!;
    s1 += src[add + 1]! - src[rem + 1]!;
    s2 += src[add + 2]! - src[rem + 2]!;
    s3 += src[add + 3]! - src[rem + 3]!;
  }
}

/** A symmetric kernel (weights[0] at the centre) along `n` pixels. */
export function convolveLine(src: Float32Array, dst: Float32Array, n: number, weights: Float32Array): void {
  const r = weights.length - 1;
  const w0 = weights[0]!;
  for (let i = 0; i < n; i++) {
    const c = i * 4;
    let s0 = src[c]! * w0;
    let s1 = src[c + 1]! * w0;
    let s2 = src[c + 2]! * w0;
    let s3 = src[c + 3]! * w0;
    const interior = i >= r && i < n - r;
    for (let k = 1; k <= r; k++) {
      const w = weights[k]!;
      const a = interior ? c - k * 4 : Math.max(0, i - k) * 4;
      const b = interior ? c + k * 4 : Math.min(n - 1, i + k) * 4;
      s0 += (src[a]! + src[b]!) * w;
      s1 += (src[a + 1]! + src[b + 1]!) * w;
      s2 += (src[a + 2]! + src[b + 2]!) * w;
      s3 += (src[a + 3]! + src[b + 3]!) * w;
    }
    dst[c] = s0;
    dst[c + 1] = s1;
    dst[c + 2] = s2;
    dst[c + 3] = s3;
  }
}

/**
 * Box radii whose three passes approximate a Gaussian of standard deviation `sigma` (Kovesi, "Fast almost-
 * Gaussian filtering", 2010).
 */
export function gaussianBoxes(sigma: number): [number, number, number] {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2) as [number, number, number];
}

/** Below this radius the exact kernel is used (three boxes are too coarse for small blurs). */
const EXACT_BELOW = 3;

function gaussianWeights(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const w = new Float32Array(r + 1);
  let sum = 0;
  for (let k = 0; k <= r; k++) {
    w[k] = Math.exp(-(k * k) / (2 * sigma * sigma));
    sum += k === 0 ? w[k]! : 2 * w[k]!;
  }
  for (let k = 0; k <= r; k++) w[k]! /= sum;
  return w;
}

/**
 * A separable blur: how far it reaches (pixels needed on each side), the pass along one row, and the same
 * pass down the columns as row-streaming stages (no column is gathered or blurred twice).
 */
type LineBlur = {
  reach: number;
  run(line: Float32Array, tmp: Float32Array, n: number): void;
  /** Stages for `rows` rows of `width` floats; the last emits finished rows to `sink`. */
  vertical(width: number, rows: number, sink: Emit): RowStage;
};

type Emit = (row: Float32Array, index: number) => void;
type RowStage = { push(row: Float32Array): void };

/**
 * A box of radius `r` down the columns, fed one row at a time (rows beyond the ends repeat the edge row): a
 * running sum per column and a ring of the 2r + 2 rows the window needs.
 */
function verticalBox(width: number, rows: number, r: number, emit: Emit): RowStage {
  if (r <= 0) {
    let i = 0;
    return { push: (row) => emit(row, i++) };
  }
  const cap = 2 * r + 2;
  const ring = new Float32Array(cap * width);
  const sums = new Float64Array(width);
  const out = new Float32Array(width);
  const inv = 1 / (2 * r + 1);
  let received = 0;
  let next = 0;
  const slot = (k: number) => (Math.min(rows - 1, Math.max(0, k)) % cap) * width;
  return {
    push(input) {
      ring.set(input.subarray(0, width), (received % cap) * width);
      received++;
      while (next < rows && Math.min(rows - 1, next + r) < received) {
        const j = next++;
        if (j === 0) {
          sums.fill(0);
          for (let k = -r; k <= r; k++) {
            const o = slot(k);
            for (let x = 0; x < width; x++) sums[x]! += ring[o + x]!;
          }
        } else {
          const add = slot(j + r);
          const rem = slot(j - 1 - r);
          for (let x = 0; x < width; x++) sums[x]! += ring[add + x]! - ring[rem + x]!;
        }
        for (let x = 0; x < width; x++) out[x] = sums[x]! * inv;
        emit(out, j);
      }
    },
  };
}

/** A symmetric kernel down the columns, fed one row at a time (edges repeated). */
function verticalKernel(width: number, rows: number, weights: Float32Array, emit: Emit): RowStage {
  const r = weights.length - 1;
  const cap = 2 * r + 1;
  const ring = new Float32Array(cap * width);
  const out = new Float32Array(width);
  let received = 0;
  let next = 0;
  const slot = (k: number) => (Math.min(rows - 1, Math.max(0, k)) % cap) * width;
  return {
    push(input) {
      ring.set(input.subarray(0, width), (received % cap) * width);
      received++;
      while (next < rows && Math.min(rows - 1, next + r) < received) {
        const j = next++;
        const c = slot(j);
        const w0 = weights[0]!;
        for (let x = 0; x < width; x++) out[x] = ring[c + x]! * w0;
        for (let k = 1; k <= r; k++) {
          const a = slot(j - k);
          const b = slot(j + k);
          const w = weights[k]!;
          for (let x = 0; x < width; x++) out[x]! += (ring[a + x]! + ring[b + x]!) * w;
        }
        emit(out, j);
      }
    },
  };
}

/** Box stages chained: each emits into the next, the last into `sink`. */
function chain(width: number, rows: number, radii: number[], sink: Emit): RowStage {
  let emit = sink;
  let stage: RowStage = { push: (row) => sink(row, 0) };
  for (const r of [...radii].reverse()) {
    stage = verticalBox(width, rows, r, emit);
    const next = stage;
    emit = (row) => next.push(row);
  }
  return stage;
}

/** Photoshop's Gaussian Blur radius is the standard deviation, in pixels. */
export function gaussianLine(radius: number): LineBlur {
  if (radius <= 0)
    return { reach: 0, run: () => undefined, vertical: (w, rows, sink) => chain(w, rows, [0], sink) };
  if (radius < EXACT_BELOW) {
    const w = gaussianWeights(radius);
    return {
      reach: w.length - 1,
      run(line, tmp, n) {
        convolveLine(line, tmp, n, w);
        line.set(tmp.subarray(0, n * 4));
      },
      vertical: (width, rows, sink) => verticalKernel(width, rows, w, sink),
    };
  }
  const [a, b, c] = gaussianBoxes(radius);
  return {
    reach: a + b + c,
    run(line, tmp, n) {
      boxLine(line, tmp, n, a);
      boxLine(tmp, line, n, b);
      boxLine(line, tmp, n, c);
      line.set(tmp.subarray(0, n * 4));
    },
    vertical: (width, rows, sink) => chain(width, rows, [a, b, c], sink),
  };
}

function boxBlurLine(radius: number): LineBlur {
  const r = Math.max(0, Math.round(radius));
  return {
    reach: r,
    run(line, tmp, n) {
      boxLine(line, tmp, n, r);
      line.set(tmp.subarray(0, n * 4));
    },
    vertical: (width, rows, sink) => chain(width, rows, [r], sink),
  };
}

// ---- the whole layer -----------------------------------------------------------------------------

export type FilterInput = {
  /** The layer's tiles (straight RGBA8). */
  tiles: ReadonlyMap<TileKey, Uint8Array>;
  size: { width: number; height: number };
  /** One-byte selection coverage per tile; null = everything. */
  selection: ReadonlyMap<TileKey, Uint8Array> | null;
  /** Only these output tiles (the preview's view); null = every tile on the canvas. */
  keys: ReadonlySet<TileKey> | null;
  /** Transparency locked: the alpha of every pixel stays. */
  preserveAlpha: boolean;
};

/**
 * Runs `filter` and returns the new content of each computed tile; an empty array means the tile became
 * fully transparent (remove it). Tiles the filter cannot change (outside the selection) are not returned.
 */
function lineBlurOf(filter: Exclude<Filter, WindowFilter>): LineBlur {
  return filter.kind === 'gaussian-blur'
    ? gaussianLine(filter.radius)
    : filter.kind === 'box-blur'
      ? boxBlurLine(filter.radius)
      : filter.kind === 'sharpen'
        ? gaussianLine(1)
        : gaussianLine(filter.radius);
}

/** How far (px) the filter reads around each output pixel: a job split into bands needs this margin. */
export function filterReach(filter: Filter): number {
  return isWindow(filter) ? windowReach(filter) : lineBlurOf(filter).reach;
}

export function applyFilter(
  filter: Filter,
  input: FilterInput,
  onRow?: (done: number, total: number) => void,
): Array<[TileKey, Uint8Array]> {
  if (isWindow(filter))
    return runWindowFilter(
      filter,
      input,
      (o, oi, f, fi, k, out) => combine(o, oi, f, fi, k, out, input.preserveAlpha, -1, 0),
      onRow,
    );
  const blur = lineBlurOf(filter);
  // Unsharp masking (and Sharpen, a fixed mild one): amount ≥ 0; a plain blur: −1.
  const amount = filter.kind === 'unsharp-mask' ? filter.amount / 100 : filter.kind === 'sharpen' ? 0.5 : -1;
  const threshold = filter.kind === 'unsharp-mask' ? filter.threshold / 255 : 0;
  return separable(blur, input, amount, threshold, onRow);
}

const INV255 = 1 / 255;
const toByte = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/**
 * One output pixel, written as straight RGBA8 to `out[oi]`: the filtered premultiplied colour at `f[fi]` (for
 * unsharp masking, the blurred one) combined with the original straight bytes at `o[oi]` (null = transparent),
 * mixed by selection coverage `k`.
 */
function combine(
  o: Uint8Array | null,
  oi: number,
  f: Float32Array,
  fi: number,
  k: number,
  out: Uint8Array,
  preserveAlpha: boolean,
  amount: number,
  threshold: number,
): void {
  const o0 = o ? o[oi]! * INV255 : 0;
  const o1 = o ? o[oi + 1]! * INV255 : 0;
  const o2 = o ? o[oi + 2]! * INV255 : 0;
  const oa = o ? o[oi + 3]! * INV255 : 0;
  let r: number;
  let g: number;
  let b: number;
  let a: number;
  const fa = f[fi + 3]!;
  if (amount < 0 && k === 1 && !preserveAlpha) {
    // The common case: a plain blur, fully selected.
    const ab = toByte(fa);
    out[oi + 3] = ab;
    if (ab === 0) {
      out[oi] = out[oi + 1] = out[oi + 2] = 0;
      return;
    }
    const inv = 1 / fa;
    out[oi] = toByte(f[fi]! * inv);
    out[oi + 1] = toByte(f[fi + 1]! * inv);
    out[oi + 2] = toByte(f[fi + 2]! * inv);
    return;
  }
  if (amount >= 0) {
    // Unsharp mask: push each channel away from its blurred value, unless the difference is below the
    // threshold. Alpha stays.
    a = oa;
    const inv = fa > 0 ? 1 / fa : 0;
    const d0 = fa > 0 ? o0 - f[fi]! * inv : 0;
    const d1 = fa > 0 ? o1 - f[fi + 1]! * inv : 0;
    const d2 = fa > 0 ? o2 - f[fi + 2]! * inv : 0;
    r = Math.abs(d0) < threshold ? o0 : o0 + amount * d0;
    g = Math.abs(d1) < threshold ? o1 : o1 + amount * d1;
    b = Math.abs(d2) < threshold ? o2 : o2 + amount * d2;
  } else {
    a = fa;
    const inv = a > 0 ? 1 / a : 0;
    r = f[fi]! * inv;
    g = f[fi + 1]! * inv;
    b = f[fi + 2]! * inv;
    if (preserveAlpha) a = oa;
  }
  if (k < 1) {
    // Mix with the original in premultiplied alpha, so a partly selected edge blends smoothly.
    const pa = oa + (a - oa) * k;
    const inv = pa > 0 ? 1 / pa : 0;
    r = (o0 * oa + (r * a - o0 * oa) * k) * inv;
    g = (o1 * oa + (g * a - o1 * oa) * k) * inv;
    b = (o2 * oa + (b * a - o2 * oa) * k) * inv;
    a = pa;
  }
  const ab = toByte(a);
  out[oi + 3] = ab;
  if (ab === 0) {
    out[oi] = out[oi + 1] = out[oi + 2] = 0;
    return;
  }
  out[oi] = toByte(r);
  out[oi + 1] = toByte(g);
  out[oi + 2] = toByte(b);
}

/**
 * A separable filter over the canvas, streamed one row at a time: each row of the span the wanted tiles
 * need (their own rows and columns and `reach` more on each side) is read, blurred along the row, and fed
 * down the column stages, which emit finished rows that are combined into the wanted tiles. Every pixel is
 * blurred once in each direction with memory for a few rows; for box-based blurs the cost does not grow
 * with the radius.
 */
function separable(
  blur: LineBlur,
  input: FilterInput,
  amount: number,
  threshold: number,
  onRow?: (done: number, total: number) => void,
): Array<[TileKey, Uint8Array]> {
  const { width: W, height: H } = input.size;
  const N = TILE_SIZE;
  const reach = blur.reach;
  const wanted: Array<[number, number]> = [];
  for (let ty = 0; ty < Math.ceil(H / N); ty++)
    for (let tx = 0; tx < Math.ceil(W / N); tx++) {
      const key = tileKey(tx, ty);
      if (input.keys && !input.keys.has(key)) continue;
      // Outside the selection nothing changes.
      if (input.selection && !input.selection.get(key)) continue;
      wanted.push([tx, ty]);
    }
  if (wanted.length === 0) return [];
  let txMin = Infinity;
  let txMax = -Infinity;
  let tyMin = Infinity;
  let tyMax = -Infinity;
  const byRow = new Map<number, number[]>();
  for (const [tx, ty] of wanted) {
    txMin = Math.min(txMin, tx);
    txMax = Math.max(txMax, tx);
    tyMin = Math.min(tyMin, ty);
    tyMax = Math.max(tyMax, ty);
    const list = byRow.get(ty);
    if (list) list.push(tx);
    else byRow.set(ty, [tx]);
  }
  const ymin = tyMin * N;
  const ymax = Math.min(H, (tyMax + 1) * N);
  const ya = Math.max(0, ymin - reach);
  const yb = Math.min(H, ymax + reach);
  const xa = Math.max(0, txMin * N - reach);
  const xb = Math.min(W, (txMax + 1) * N + reach);
  const span = xb - xa;
  const outTiles = new Map<TileKey, Uint8Array>();
  const line = new Float32Array(span * 4);
  const tmp = new Float32Array(span * 4);
  const totalRows = tyMax - tyMin + 1;
  const sink: Emit = (row, j) => {
    const y = ya + j;
    if (y < ymin || y >= ymax) return;
    const ty = Math.floor(y / N);
    const ly = y - ty * N;
    for (const tx of byRow.get(ty) ?? []) {
      const key = tileKey(tx, ty);
      const src = input.tiles.get(key) ?? null;
      let data = outTiles.get(key);
      if (!data) {
        data = src ? new Uint8Array(src) : new Uint8Array(N * N * 4);
        outTiles.set(key, data);
      }
      const sel = input.selection?.get(key) ?? null;
      const x0 = tx * N;
      const w = Math.min(N, W - x0);
      if (!sel && amount < 0 && !input.preserveAlpha) {
        // The common case inline: a plain blur of the whole tile row.
        for (let lx = 0, o = ly * N * 4, f = (x0 - xa) * 4; lx < w; lx++, o += 4, f += 4) {
          const fa = row[f + 3]!;
          if (fa <= 1 / 510) {
            data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
            continue;
          }
          const inv = 255 / fa;
          data[o] = Math.min(255, (row[f]! * inv + 0.5) | 0);
          data[o + 1] = Math.min(255, (row[f + 1]! * inv + 0.5) | 0);
          data[o + 2] = Math.min(255, (row[f + 2]! * inv + 0.5) | 0);
          data[o + 3] = Math.min(255, (fa * 255 + 0.5) | 0);
        }
        continue;
      }
      for (let lx = 0; lx < w; lx++) {
        const p = ly * N + lx;
        const k = sel ? sel[p]! * INV255 : 1;
        if (k === 0) continue;
        combine(src, p * 4, row, (x0 + lx - xa) * 4, k, data, input.preserveAlpha, amount, threshold);
      }
    }
    if (ly === N - 1 || y === ymax - 1) onRow?.(ty - tyMin + 1, totalRows);
  };
  const down = blur.vertical(span * 4, yb - ya, sink);
  for (let y = ya; y < yb; y++) {
    // The row's span as premultiplied floats, then blurred along the row.
    const ty = Math.floor(y / N);
    const ly = y - ty * N;
    for (let tx = Math.floor(xa / N); tx * N < xb; tx++) {
      const from = Math.max(xa, tx * N);
      const to = Math.min(xb, (tx + 1) * N);
      const t = input.tiles.get(tileKey(tx, ty));
      if (!t) {
        line.fill(0, (from - xa) * 4, (to - xa) * 4);
        continue;
      }
      let s = (ly * N + (from - tx * N)) * 4;
      let d = (from - xa) * 4;
      for (let x = from; x < to; x++, s += 4, d += 4) {
        const a = t[s + 3]! * INV255;
        line[d] = t[s]! * INV255 * a;
        line[d + 1] = t[s + 1]! * INV255 * a;
        line[d + 2] = t[s + 2]! * INV255 * a;
        line[d + 3] = a;
      }
    }
    blur.run(line, tmp, span);
    down.push(line);
  }
  const out: Array<[TileKey, Uint8Array]> = [];
  for (const [key, data] of outTiles) {
    let any = false;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] !== 0) {
        any = true;
        break;
      }
    if (any) out.push([key, data]);
    else if (input.tiles.get(key)) out.push([key, new Uint8Array(0)]);
  }
  return out;
}
