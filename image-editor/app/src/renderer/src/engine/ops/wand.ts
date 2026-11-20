import { compositeTile, type FlatLayer } from '../doc/flatten';
import { parseTileKey, TILE_SIZE, tileKey, tileKeysInRect, type TileKey } from '../tiles/tile';

/**
 * Magic Wand (W; FR-SEL-03, docs/02 §5.4): the pixels whose colour is within `tolerance` of the clicked one,
 * either the connected region around it (contiguous, 4-connected scanline flood fill) or every such pixel.
 * Runs in the ops worker on the composite of `layers` (the active layer alone, or all of them for "Sample
 * all layers"). Pure, so tests and a missing worker run the same code.
 */
export type WandOptions = {
  /** 0..255: largest per-channel difference that still matches (Photoshop's default is 32). */
  tolerance: number;
  contiguous: boolean;
  /** Soften the region's edge by averaging the 3 × 3 neighbourhood of edge pixels. */
  antiAlias: boolean;
};

export type MaskTiles = Array<[TileKey, Uint8Array]>;

/**
 * Colours are compared premultiplied, so every fully transparent pixel is the same colour whatever RGB it
 * stores, and half-transparent pixels compare by what they show.
 */
function premultiplied(t: Uint8ClampedArray, i: number): [number, number, number, number] {
  const a = t[i + 3]!;
  return [(t[i]! * a) / 255, (t[i + 1]! * a) / 255, (t[i + 2]! * a) / 255, a];
}

export function magicWand(
  layers: readonly FlatLayer[],
  size: { width: number; height: number },
  seed: { x: number; y: number },
  o: WandOptions,
): MaskTiles {
  const { width: W, height: H } = size;
  const sx = Math.floor(seed.x);
  const sy = Math.floor(seed.y);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return [];
  const seedTile = compositeTile(layers, tileKey(Math.floor(sx / TILE_SIZE), Math.floor(sy / TILE_SIZE)));
  const c = premultiplied(seedTile, ((sy % TILE_SIZE) * TILE_SIZE + (sx % TILE_SIZE)) * 4);
  const tol = Math.max(0, Math.min(255, o.tolerance));

  // 1 = within tolerance of the seed colour. One byte per canvas pixel; this runs in the worker.
  const match = new Uint8Array(W * H);
  for (const key of tileKeysInRect(0, 0, W, H)) {
    const [tx, ty] = parseTileKey(key);
    const t = compositeTile(layers, key);
    const ox = tx * TILE_SIZE;
    const oy = ty * TILE_SIZE;
    const w = Math.min(TILE_SIZE, W - ox);
    const h = Math.min(TILE_SIZE, H - oy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = premultiplied(t, (y * TILE_SIZE + x) * 4);
        const d = Math.max(
          Math.abs(p[0] - c[0]),
          Math.abs(p[1] - c[1]),
          Math.abs(p[2] - c[2]),
          Math.abs(p[3] - c[3]),
        );
        if (d <= tol + 1e-9) match[(oy + y) * W + ox + x] = 1;
      }
    }
  }

  // The region: 2 marks selected pixels.
  const region = match;
  if (o.contiguous) {
    const stack: number[] = [sx, sy];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      const row = y * W;
      if (region[row + x] !== 1) continue;
      while (x > 0 && region[row + x - 1] === 1) x--;
      let up = false;
      let down = false;
      for (; x < W && region[row + x] === 1; x++) {
        region[row + x] = 2;
        if (y > 0) {
          const u = region[row - W + x] === 1;
          if (u && !up) stack.push(x, y - 1);
          up = u;
        }
        if (y < H - 1) {
          const dn = region[row + W + x] === 1;
          if (dn && !down) stack.push(x, y + 1);
          down = dn;
        }
      }
    }
  } else {
    for (let i = 0; i < region.length; i++) if (region[i] === 1) region[i] = 2;
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === 2;

  // Mask tiles (only where something is selected), with soft edges when anti-aliased.
  const out: MaskTiles = [];
  for (const key of tileKeysInRect(0, 0, W, H)) {
    const [tx, ty] = parseTileKey(key);
    const ox = tx * TILE_SIZE;
    const oy = ty * TILE_SIZE;
    const w = Math.min(TILE_SIZE, W - ox);
    const h = Math.min(TILE_SIZE, H - oy);
    let data: Uint8Array | null = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = ox + x;
        const gy = oy + y;
        let v = inside(gx, gy) ? 255 : 0;
        if (o.antiAlias) {
          const self = v === 255;
          const edge =
            inside(gx - 1, gy) !== self ||
            inside(gx + 1, gy) !== self ||
            inside(gx, gy - 1) !== self ||
            inside(gx, gy + 1) !== self;
          if (edge) {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) if (inside(gx + dx, gy + dy)) n++;
            v = Math.round((n * 255) / 9);
          }
        }
        if (v === 0) continue;
        data ??= new Uint8Array(TILE_SIZE * TILE_SIZE);
        data[y * TILE_SIZE + x] = v;
      }
    }
    if (data) out.push([key, data]);
  }
  return out;
}
