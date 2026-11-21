import { parseTileKey, TILE_SIZE, tileKey, tileKeysInRect, type TileKey } from '../tiles/tile';

/**
 * The selection (FR-SEL-01..06, docs/02 §5.4): an anti-aliased 8-bit mask over the canvas in 256×256 tiles,
 * 0 = not selected, 255 = selected. Masks are immutable values, so history holds references (ADR-0005).
 * Missing tiles are 0; fully selected tiles share FULL_TILE, so Select All on a 24 MP image costs nothing.
 * Coverage outside the canvas is always 0 (layers may keep pixels off the canvas; a selection never does).
 */
export const MASK_TILE_BYTES = TILE_SIZE * TILE_SIZE;

export type MaskTile = { readonly data: Uint8ClampedArray; readonly full: boolean };

/** Shared, fully selected tile. Never write to its data. */
export const FULL_TILE: MaskTile = { data: new Uint8ClampedArray(MASK_TILE_BYTES).fill(255), full: true };

export type SelectionOp = 'replace' | 'add' | 'subtract' | 'intersect';
export type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** A coverage tile as a MaskTile: undefined when empty, the shared FULL_TILE when fully selected. */
export function maskTile(data: Uint8ClampedArray): MaskTile | undefined {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    if (min === 0 && max === 255) break;
  }
  if (max === 0) return undefined;
  if (min === 255) return FULL_TILE;
  return { data, full: false };
}

/**
 * A selection as plain data for workers (copy, cut): its bounds and the coverage tiles inside them, with
 * fully selected tiles marked 'full' instead of copied.
 */
export type SelectionClip = { bounds: Bounds; tiles: Array<[TileKey, Uint8Array | 'full']> };

/**
 * The part of a row-major RGBA8 image inside the selection's bounds, with each pixel's alpha multiplied by
 * its coverage (Copy / Cut of a selection, FR-DOC-12). Runs where the image was flattened (the file worker).
 */
export function clipToSelection(
  rgba: Uint8ClampedArray,
  width: number,
  clip: SelectionClip,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const { x0, y0, x1, y1 } = clip.bounds;
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    out.set(rgba.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1) * 4), y * w * 4);
  const tiles = new Map(clip.tiles);
  for (let y = 0; y < h; y++) {
    const gy = y0 + y;
    const ty = Math.floor(gy / TILE_SIZE);
    for (let x = 0; x < w; x++) {
      const gx = x0 + x;
      const tile = tiles.get(tileKey(Math.floor(gx / TILE_SIZE), ty));
      const k = !tile
        ? 0
        : tile === 'full'
          ? 255
          : tile[(gy - ty * TILE_SIZE) * TILE_SIZE + (gx % TILE_SIZE)]!;
      if (k === 255) continue;
      const a = (y * w + x) * 4 + 3;
      out[a] = Math.round((out[a]! * k) / 255);
    }
  }
  return { rgba: out, width: w, height: h };
}

export class Mask {
  private cachedBounds: Bounds | null | undefined;

  private constructor(
    private readonly tiles: ReadonlyMap<TileKey, MaskTile>,
    readonly width: number,
    readonly height: number,
  ) {}

  static empty(width: number, height: number): Mask {
    return new Mask(new Map(), width, height);
  }

  /** Builds a mask from tiles, clipping each to the canvas. */
  static fromTiles(tiles: ReadonlyMap<TileKey, MaskTile>, width: number, height: number): Mask {
    const out = new Map<TileKey, MaskTile>();
    for (const [key, tile] of tiles) {
      const clipped = clipToCanvas(key, tile, width, height);
      if (clipped) out.set(key, clipped);
    }
    return new Mask(out, width, height);
  }

  /** Select All. */
  static all(width: number, height: number): Mask {
    return rectMask({ x0: 0, y0: 0, x1: width, y1: height }, width, height);
  }

  get isEmpty(): boolean {
    return this.tiles.size === 0;
  }

  tile(key: TileKey): MaskTile | undefined {
    return this.tiles.get(key);
  }

  entries(): IterableIterator<[TileKey, MaskTile]> {
    return this.tiles.entries();
  }

  /** Coverage 0..255 of one canvas pixel (integer coordinates). */
  value(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const tile = this.tiles.get(tileKey(tx, ty));
    if (!tile) return 0;
    return tile.data[(y - ty * TILE_SIZE) * TILE_SIZE + (x - tx * TILE_SIZE)]!;
  }

  /** Tight bounds of the selected pixels (any coverage), or null when nothing is selected. */
  bounds(): Bounds | null {
    if (this.cachedBounds !== undefined) return this.cachedBounds;
    let b: Bounds | null = null;
    const grow = (x0: number, y0: number, x1: number, y1: number) => {
      b = b
        ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) }
        : { x0, y0, x1, y1 };
    };
    for (const [key, tile] of this.tiles) {
      const [tx, ty] = parseTileKey(key);
      const ox = tx * TILE_SIZE;
      const oy = ty * TILE_SIZE;
      if (tile.full) {
        grow(ox, oy, Math.min(ox + TILE_SIZE, this.width), Math.min(oy + TILE_SIZE, this.height));
        continue;
      }
      let minX = TILE_SIZE;
      let minY = TILE_SIZE;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < TILE_SIZE; y++) {
        const row = y * TILE_SIZE;
        for (let x = 0; x < TILE_SIZE; x++) {
          if (tile.data[row + x] === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          maxY = y;
        }
      }
      if (maxX >= 0) grow(ox + minX, oy + minY, ox + maxX + 1, oy + maxY + 1);
    }
    this.cachedBounds = b;
    return b;
  }

  /** Combines this (the existing selection) with `shape` (FR-SEL-04). Soft edges combine like coverage. */
  combine(op: SelectionOp, shape: Mask): Mask {
    if (op === 'replace') return shape;
    const keys = new Set<TileKey>([...this.tiles.keys(), ...shape.tiles.keys()]);
    const out = new Map<TileKey, MaskTile>();
    for (const key of keys) {
      const t = combineTile(op, this.tiles.get(key), shape.tiles.get(key));
      if (t) out.set(key, t);
    }
    return new Mask(out, this.width, this.height);
  }

  /** Select › Inverse: everything on the canvas that was not selected. */
  invert(): Mask {
    const out = new Map<TileKey, MaskTile>();
    for (const key of tileKeysInRect(0, 0, this.width, this.height)) {
      const tile = this.tiles.get(key);
      let next: MaskTile | undefined;
      if (!tile) next = FULL_TILE;
      else if (tile.full) next = undefined;
      else {
        const data = new Uint8ClampedArray(MASK_TILE_BYTES);
        for (let i = 0; i < data.length; i++) data[i] = 255 - tile.data[i]!;
        next = maskTile(data);
      }
      const clipped = next && clipToCanvas(key, next, this.width, this.height);
      if (clipped) out.set(key, clipped);
    }
    return new Mask(out, this.width, this.height);
  }

  /** The selection as plain data for a worker (null when nothing is selected). */
  toClip(): SelectionClip | null {
    const bounds = this.bounds();
    if (!bounds) return null;
    const tiles: SelectionClip['tiles'] = [];
    for (const [key, t] of this.tiles) tiles.push([key, t.full ? 'full' : new Uint8Array(t.data)]);
    return { bounds, tiles };
  }

  /** Bytes of tile data this mask owns (shared full tiles are free), for the history memory budget. */
  sizeBytes(): number {
    let n = 0;
    for (const t of this.tiles.values()) if (!t.full) n += MASK_TILE_BYTES;
    return n;
  }
}

function combineTile(
  op: SelectionOp,
  a: MaskTile | undefined,
  b: MaskTile | undefined,
): MaskTile | undefined {
  switch (op) {
    case 'add':
      if (!a) return b;
      if (!b) return a;
      if (a.full || b.full) return FULL_TILE;
      return perPixel(a, b, (x, y) => x + y - Math.round((x * y) / 255));
    case 'subtract':
      if (!a || !b) return a;
      if (b.full) return undefined;
      return perPixel(a, b, (x, y) => Math.round((x * (255 - y)) / 255));
    case 'intersect':
      if (!a || !b) return undefined;
      if (a.full) return b;
      if (b.full) return a;
      return perPixel(a, b, (x, y) => Math.round((x * y) / 255));
    default:
      return b;
  }
}

function perPixel(a: MaskTile, b: MaskTile, f: (x: number, y: number) => number): MaskTile | undefined {
  const data = new Uint8ClampedArray(MASK_TILE_BYTES);
  for (let i = 0; i < data.length; i++) data[i] = f(a.data[i]!, b.data[i]!);
  return maskTile(data);
}

/** Zeroes coverage outside the canvas (edge tiles); undefined when nothing remains. */
function clipToCanvas(key: TileKey, tile: MaskTile, width: number, height: number): MaskTile | undefined {
  const [tx, ty] = parseTileKey(key);
  const ox = tx * TILE_SIZE;
  const oy = ty * TILE_SIZE;
  if (ox >= width || oy >= height || ox + TILE_SIZE <= 0 || oy + TILE_SIZE <= 0) return undefined;
  if (ox >= 0 && oy >= 0 && ox + TILE_SIZE <= width && oy + TILE_SIZE <= height) return tile;
  const data = new Uint8ClampedArray(MASK_TILE_BYTES);
  const x0 = Math.max(0, -ox);
  const y0 = Math.max(0, -oy);
  const x1 = Math.min(TILE_SIZE, width - ox);
  const y1 = Math.min(TILE_SIZE, height - oy);
  for (let y = y0; y < y1; y++) {
    const row = y * TILE_SIZE;
    data.set(tile.data.subarray(row + x0, row + x1), row + x0);
  }
  return maskTile(data);
}

/** A pixel-aligned rectangle (Rectangular Marquee), clipped to the canvas. Hard edges by definition. */
export function rectMask(r: Bounds, width: number, height: number): Mask {
  const x0 = Math.max(0, Math.round(Math.min(r.x0, r.x1)));
  const y0 = Math.max(0, Math.round(Math.min(r.y0, r.y1)));
  const x1 = Math.min(width, Math.round(Math.max(r.x0, r.x1)));
  const y1 = Math.min(height, Math.round(Math.max(r.y0, r.y1)));
  const tiles = new Map<TileKey, MaskTile>();
  if (x1 <= x0 || y1 <= y0) return Mask.empty(width, height);
  for (const key of tileKeysInRect(x0, y0, x1, y1)) {
    const [tx, ty] = parseTileKey(key);
    const ox = tx * TILE_SIZE;
    const oy = ty * TILE_SIZE;
    const lx0 = Math.max(0, x0 - ox);
    const ly0 = Math.max(0, y0 - oy);
    const lx1 = Math.min(TILE_SIZE, x1 - ox);
    const ly1 = Math.min(TILE_SIZE, y1 - oy);
    if (lx0 === 0 && ly0 === 0 && lx1 === TILE_SIZE && ly1 === TILE_SIZE) {
      tiles.set(key, FULL_TILE);
      continue;
    }
    const data = new Uint8ClampedArray(MASK_TILE_BYTES);
    for (let y = ly0; y < ly1; y++) data.fill(255, y * TILE_SIZE + lx0, y * TILE_SIZE + lx1);
    tiles.set(key, { data, full: false });
  }
  return Mask.fromTiles(tiles, width, height);
}

export type Point = readonly [number, number];

/** Sub-scanlines per pixel row for anti-aliasing; horizontal coverage is exact within each. */
const SUBSAMPLES = 5;

/**
 * Fills a closed polygon (lasso, polygonal lasso, ellipse outline) with the even-odd rule, anti-aliased:
 * each pixel row is sampled on SUBSAMPLES sub-scanlines with exact horizontal span coverage (error ≤ 1/10 of
 * a pixel's area). Without anti-aliasing a pixel is selected when its centre is inside. Works one row at a
 * time into tile buffers, so no canvas-sized buffer is ever allocated.
 */
export function polygonMask(points: readonly Point[], width: number, height: number, antiAlias = true): Mask {
  if (points.length < 3) return Mask.empty(width, height);
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const bx0 = Math.max(0, Math.floor(minX));
  const bx1 = Math.min(width, Math.ceil(maxX));
  const by0 = Math.max(0, Math.floor(minY));
  const by1 = Math.min(height, Math.ceil(maxY));
  if (bx1 <= bx0 || by1 <= by0) return Mask.empty(width, height);

  type Edge = { x0: number; y0: number; x1: number; y1: number };
  const edges: Edge[] = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[(i + 1) % points.length]!;
    if (ay === by) continue;
    edges.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by } : { x0: bx, y0: by, x1: ax, y1: ay });
  }

  const rowW = bx1 - bx0;
  // Fractional coverage at span ends goes to `acc`; whole-pixel runs go to `delta` as +w/-w marks and are
  // summed once per row (so a wide span costs O(1) per sub-scanline, not O(width)).
  const acc = new Float32Array(rowW);
  const delta = new Float32Array(rowW + 1);
  const crossings: number[] = [];
  const tiles = new Map<TileKey, Uint8ClampedArray>();
  const samples = antiAlias ? SUBSAMPLES : 1;
  const w = 1 / samples;
  const tx0 = Math.floor(bx0 / TILE_SIZE);
  const tx1 = Math.floor((bx1 - 1) / TILE_SIZE);

  for (let py = by0; py < by1; py++) {
    const rowEdges = edges.filter((e) => e.y1 > py && e.y0 < py + 1);
    for (let s = 0; s < samples; s++) {
      const sy = py + (s + 0.5) / samples;
      crossings.length = 0;
      for (const e of rowEdges) {
        if (sy < e.y0 || sy >= e.y1) continue;
        crossings.push(e.x0 + ((sy - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const xa = Math.max(bx0, crossings[i]!);
        const xb = Math.min(bx1, crossings[i + 1]!);
        if (xb <= xa) continue;
        if (!antiAlias) {
          // Pixel centres x + 0.5 in [xa, xb).
          const c0 = Math.max(bx0, Math.ceil(xa - 0.5));
          const c1 = Math.min(bx1, Math.ceil(xb - 0.5));
          if (c1 > c0) {
            delta[c0 - bx0]! += 1;
            delta[c1 - bx0]! -= 1;
          }
          continue;
        }
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) {
          acc[ia - bx0]! += (xb - xa) * w;
          continue;
        }
        acc[ia - bx0]! += (ia + 1 - xa) * w;
        delta[ia + 1 - bx0]! += w;
        delta[ib - bx0]! -= w;
        if (ib < bx1) acc[ib - bx0]! += (xb - ib) * w;
      }
    }
    // Row → tiles, one tile span at a time; buffers and keys are created only where something is selected.
    const ty = Math.floor(py / TILE_SIZE);
    const row = (py - ty * TILE_SIZE) * TILE_SIZE;
    let run = 0;
    for (let tx = tx0; tx <= tx1; tx++) {
      const ox = tx * TILE_SIZE;
      const a = Math.max(bx0, ox);
      const b = Math.min(bx1, ox + TILE_SIZE);
      let data: Uint8ClampedArray | undefined;
      for (let x = a; x < b; x++) {
        const i = x - bx0;
        run += delta[i]!;
        delta[i] = 0;
        const v = acc[i]! + run;
        acc[i] = 0;
        if (v <= 1e-6) continue;
        if (!data) {
          const key = tileKey(tx, ty);
          data = tiles.get(key);
          if (!data) tiles.set(key, (data = new Uint8ClampedArray(MASK_TILE_BYTES)));
        }
        data[row + x - ox] = Math.round(Math.min(1, v) * 255);
      }
    }
    delta[rowW] = 0;
  }

  const out = new Map<TileKey, MaskTile>();
  for (const [key, data] of tiles) {
    const t = maskTile(data);
    if (t) out.set(key, t);
  }
  return Mask.fromTiles(out, width, height);
}

/** An ellipse inscribed in the rectangle (Elliptical Marquee), as a fine polygon. */
export function ellipseMask(r: Bounds, width: number, height: number, antiAlias = true): Mask {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const rx = Math.abs(r.x1 - r.x0) / 2;
  const ry = Math.abs(r.y1 - r.y0) / 2;
  if (rx < 0.5 || ry < 0.5) return Mask.empty(width, height);
  // Enough vertices that the polygon is within 0.05 px of the true ellipse.
  const n = Math.min(4096, Math.max(32, Math.ceil(Math.PI / Math.acos(1 - 0.05 / Math.max(rx, ry)))));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return polygonMask(pts, width, height, antiAlias);
}
