import { parseTileKey, TILE_SIZE, tileKey, type TileKey } from '../tiles/tile';

/**
 * Select › Modify (FR-SEL-05, docs/02 §5.4): feather, expand, contract, border and smooth, in the ops worker.
 * Each works on the selection's bounds grown by how far the effect reaches, never the whole canvas unless
 * the selection covers it, and every step is linear in the pixel count (no per-radius cost).
 */
export type ModifyOp =
  | { kind: 'feather'; radius: number }
  | { kind: 'expand'; by: number }
  | { kind: 'contract'; by: number }
  | { kind: 'border'; width: number }
  | { kind: 'smooth'; radius: number };

/** Mask tiles as plain data: 256×256 coverage, or 'full' for a fully selected tile. */
export type ClipTiles = Array<[TileKey, Uint8Array | 'full']>;
type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** How far outside the selection an effect can reach, in pixels. */
function reach(op: ModifyOp): number {
  switch (op.kind) {
    case 'feather':
      return Math.ceil(op.radius * 1.5) + 2;
    case 'expand':
      return Math.ceil(op.by) + 1;
    case 'border':
      return Math.ceil(op.width / 2) + 3;
    default:
      return 1;
  }
}

/** A window of the canvas as flat coverage, with its origin. */
type Field = { x0: number; y0: number; w: number; h: number; v: Float32Array };

function toField(tiles: ClipTiles, win: Bounds): Field {
  const w = win.x1 - win.x0;
  const h = win.y1 - win.y0;
  const v = new Float32Array(w * h);
  for (const [key, data] of tiles) {
    const [tx, ty] = parseTileKey(key);
    const ox = tx * TILE_SIZE;
    const oy = ty * TILE_SIZE;
    const ax = Math.max(ox, win.x0);
    const bx = Math.min(ox + TILE_SIZE, win.x1);
    for (let y = Math.max(oy, win.y0); y < Math.min(oy + TILE_SIZE, win.y1); y++) {
      for (let x = ax; x < bx; x++) {
        v[(y - win.y0) * w + (x - win.x0)] =
          (data === 'full' ? 255 : data[(y - oy) * TILE_SIZE + (x - ox)]!) / 255;
      }
    }
  }
  return { x0: win.x0, y0: win.y0, w, h, v };
}

function fromField(f: Field): Array<[TileKey, Uint8Array]> {
  const out: Array<[TileKey, Uint8Array]> = [];
  const tx0 = Math.floor(f.x0 / TILE_SIZE);
  const ty0 = Math.floor(f.y0 / TILE_SIZE);
  const tx1 = Math.floor((f.x0 + f.w - 1) / TILE_SIZE);
  const ty1 = Math.floor((f.y0 + f.h - 1) / TILE_SIZE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      let data: Uint8Array | null = null;
      const ox = tx * TILE_SIZE;
      const oy = ty * TILE_SIZE;
      for (let y = Math.max(oy, f.y0); y < Math.min(oy + TILE_SIZE, f.y0 + f.h); y++) {
        for (let x = Math.max(ox, f.x0); x < Math.min(ox + TILE_SIZE, f.x0 + f.w); x++) {
          const b = Math.round(Math.min(1, Math.max(0, f.v[(y - f.y0) * f.w + (x - f.x0)]!)) * 255);
          if (b === 0) continue;
          data ??= new Uint8Array(TILE_SIZE * TILE_SIZE);
          data[(y - oy) * TILE_SIZE + (x - ox)] = b;
        }
      }
      if (data) out.push([tileKey(tx, ty), data]);
    }
  }
  return out;
}

/** Running-sum box blur of radius r along rows (dir 0) or columns (dir 1); outside the window counts as 0. */
function boxBlur(f: Field, r: number, dir: 0 | 1): void {
  if (r <= 0) return;
  const { w, h, v } = f;
  const [len, lines, step, lineStep] = dir === 0 ? [w, h, 1, w] : [h, w, w, 1];
  const line = new Float32Array(len);
  const norm = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let i = 0; i < len; i++) line[i] = v[base + i * step]!;
    let sum = 0;
    for (let i = 0; i <= Math.min(r, len - 1); i++) sum += line[i]!;
    for (let i = 0; i < len; i++) {
      v[base + i * step] = sum * norm;
      const add = i + r + 1;
      const drop = i - r;
      if (add < len) sum += line[add]!;
      if (drop >= 0) sum -= line[drop]!;
    }
  }
}

/** Gaussian blur of standard deviation sigma, as three box blurs (Kovesi's "boxes for Gauss"). */
function gaussian(f: Field, sigma: number): void {
  if (sigma <= 0) return;
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wl + 2) - 1) / 2;
    boxBlur(f, r, 0);
    boxBlur(f, r, 1);
  }
}

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher 2012): the lower envelope of parabolas. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  const meet = (q: number, p: number) => (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k]!);
    while (s <= z[k]!) s = meet(q, v[--k]!); // stops at k = 0: z[0] is -Infinity
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = (q - p) * (q - p) + f[p]!;
  }
}

/** Squared distance from every pixel of the window to the nearest pixel where `feature` is true. */
function distance2(f: Field, feature: (value: number) => boolean): Float32Array {
  const { w, h, v } = f;
  const big = (w + h) * (w + h);
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = feature(v[i]!) ? 0 : big;
  const n = Math.max(w, h);
  // Per-line buffers in 64-bit: the "far" sentinel is large and parabola intersections subtract it.
  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const vv = new Int32Array(n);
  const zz = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[y] = g[y * w + x]!;
    edt1d(line, h, out, vv, zz);
    for (let y = 0; y < h; y++) g[y * w + x] = out[y]!;
  }
  for (let y = 0; y < h; y++) {
    line.set(g.subarray(y * w, y * w + w));
    edt1d(line, w, out, vv, zz);
    g.set(out.subarray(0, w), y * w);
  }
  return g;
}

function expand(f: Field, by: number): void {
  const d = distance2(f, (x) => x >= 0.5);
  const r2 = by * by;
  for (let i = 0; i < f.v.length; i++) if (d[i]! <= r2) f.v[i] = Math.max(f.v[i]!, 1);
}

function contract(f: Field, by: number, touchesEdge: Bounds): void {
  // Outside the canvas counts as unselected, so a selection touching the edge shrinks from it too: the
  // window is surrounded by a 1 px frame of "outside" wherever it meets the canvas edge.
  const d = distance2(f, (x) => x < 0.5);
  const r2 = by * by;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      const gx = f.x0 + x;
      const gy = f.y0 + y;
      // Distance to the canvas edge (pixels beyond it are unselected).
      const edge = Math.min(
        gx - touchesEdge.x0 + 1,
        touchesEdge.x1 - gx,
        gy - touchesEdge.y0 + 1,
        touchesEdge.y1 - gy,
      );
      if (d[i]! <= r2 || edge <= by) f.v[i] = 0;
    }
  }
}

function smooth(f: Field, radius: number): void {
  const r = Math.round(radius);
  if (r <= 0) return;
  for (let i = 0; i < f.v.length; i++) f.v[i] = f.v[i]! >= 0.5 ? 1 : 0;
  const count: Field = { ...f, v: new Float32Array(f.v) };
  boxBlur(count, r, 0);
  boxBlur(count, r, 1);
  for (let i = 0; i < f.v.length; i++) f.v[i] = count.v[i]! >= 0.5 ? 1 : 0;
}

/** Applies a Modify command to a selection; returns its new tiles (empty when nothing is left). */
export function modifySelection(
  tiles: ClipTiles,
  bounds: Bounds,
  size: { width: number; height: number },
  op: ModifyOp,
): Array<[TileKey, Uint8Array]> {
  const m = reach(op);
  const win: Bounds = {
    x0: Math.max(0, bounds.x0 - m),
    y0: Math.max(0, bounds.y0 - m),
    x1: Math.min(size.width, bounds.x1 + m),
    y1: Math.min(size.height, bounds.y1 + m),
  };
  const f = toField(tiles, win);
  const canvas = { x0: 0, y0: 0, x1: size.width, y1: size.height };
  switch (op.kind) {
    case 'feather':
      gaussian(f, Math.max(0, op.radius) / 2);
      break;
    case 'expand':
      expand(f, Math.max(0, op.by));
      break;
    case 'contract':
      contract(f, Math.max(0, op.by), canvas);
      break;
    case 'border': {
      const half = Math.max(0.5, op.width / 2);
      const outer: Field = { ...f, v: new Float32Array(f.v) };
      const inner: Field = { ...f, v: new Float32Array(f.v) };
      expand(outer, half);
      contract(inner, half, canvas);
      for (let i = 0; i < f.v.length; i++)
        f.v[i] = Math.max(0, Math.min(outer.v[i]!, 1) - Math.min(inner.v[i]!, 1));
      gaussian(f, 0.7); // a soft band, as in Photoshop
      break;
    }
    case 'smooth':
      smooth(f, op.radius);
      break;
  }
  return fromField(f);
}
