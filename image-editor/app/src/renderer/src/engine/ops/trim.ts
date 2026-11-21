import { compositeTile, type FlatLayer } from '../doc/flatten';
import { parseTileKey, TILE_SIZE, tileKey, tileKeysInRect } from '../tiles/tile';
import type { MaskTiles } from './wand';

/** What Image › Trim removes (FR-TRF-06): transparent pixels, or the colour of a corner pixel. */
export type TrimBasis = 'transparent' | 'topLeft' | 'bottomRight';

/** Premultiplied, so every fully transparent pixel counts as the same colour whatever its RGB. */
function premultiplied(t: Uint8ClampedArray, i: number): [number, number, number, number] {
  const a = t[i + 3]!;
  return [
    Math.round((t[i]! * a) / 255),
    Math.round((t[i + 1]! * a) / 255),
    Math.round((t[i + 2]! * a) / 255),
    a,
  ];
}

/**
 * The composite pixels Trim keeps, as mask tiles (255 = kept): those that are not transparent, or not
 * exactly the colour of the chosen corner. Runs in the ops worker; the editor crops to their bounds.
 */
export function trimContent(
  layers: readonly FlatLayer[],
  size: { width: number; height: number },
  basis: TrimBasis,
): MaskTiles {
  const { width: W, height: H } = size;
  let ref: [number, number, number, number] | null = null;
  if (basis !== 'transparent') {
    const [x, y] = basis === 'topLeft' ? [0, 0] : [W - 1, H - 1];
    const corner = compositeTile(layers, tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
    ref = premultiplied(corner, ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4);
  }
  const out: MaskTiles = [];
  for (const key of tileKeysInRect(0, 0, W, H)) {
    const [tx, ty] = parseTileKey(key);
    const t = compositeTile(layers, key);
    const w = Math.min(TILE_SIZE, W - tx * TILE_SIZE);
    const h = Math.min(TILE_SIZE, H - ty * TILE_SIZE);
    let data: Uint8Array | null = null;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * TILE_SIZE + x) * 4;
        let keep: boolean;
        if (!ref) keep = t[i + 3]! > 0;
        else {
          const p = premultiplied(t, i);
          keep = p[0] !== ref[0] || p[1] !== ref[1] || p[2] !== ref[2] || p[3] !== ref[3];
        }
        if (!keep) continue;
        data ??= new Uint8Array(TILE_SIZE * TILE_SIZE);
        data[y * TILE_SIZE + x] = 255;
      }
    if (data) out.push([key, data]);
  }
  return out;
}
