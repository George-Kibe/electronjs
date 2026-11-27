import { createTile, TILE_BYTES, TILE_SIZE, tileKey, type Tile, type TileKey } from '../tiles/tile';
import { GRAIN_SIZE, tipGrain, type BrushTip } from './tips';

/**
 * Clone Stamp (S; FR-PNT-05): a brush whose paint is the image itself, `offset` away. Target pixel (x, y)
 * receives source pixel (x + dx, y + dy); the offset is whole pixels, so the copy is exact. The source is
 * what the layer (or all layers) looked like when the stroke began, so a stroke never clones itself.
 * Composited source-over through the stroke's coverage × opacity × tip grain, in straight alpha; with
 * transparency locked, existing pixels change colour and keep their alpha.
 */
export type CloneSource = (key: TileKey) => Uint8ClampedArray | undefined;

export function cloneTile(
  before: Tile | undefined,
  coverage: Float32Array,
  source: CloneSource,
  offset: { dx: number; dy: number },
  settings: { opacity: number; tip?: BrushTip; aliased?: boolean },
  bounds: { tileX: number; tileY: number; docWidth: number; docHeight: number },
  preserveAlpha = false,
): Tile | undefined {
  if (preserveAlpha && !before) return before;
  const { dx, dy } = offset;
  const { docWidth: W, docHeight: H } = bounds;
  const out = before ? new Uint8ClampedArray(before.data) : new Uint8ClampedArray(TILE_BYTES);
  const ox = bounds.tileX * TILE_SIZE;
  const oy = bounds.tileY * TILE_SIZE;
  const w = Math.min(TILE_SIZE, W - ox);
  const h = Math.min(TILE_SIZE, H - oy);
  const grain = settings.aliased ? null : tipGrain(settings.tip ?? 'round');
  let srcKey = '';
  let src: Uint8ClampedArray | undefined;
  let changed = false;
  for (let y = 0; y < h; y++) {
    const sy = oy + y + dy;
    if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < w; x++) {
      const i = y * TILE_SIZE + x;
      const c = coverage[i]!;
      if (c <= 0) continue;
      const sx = ox + x + dx;
      if (sx < 0 || sx >= W) continue;
      const key = tileKey(Math.floor(sx / TILE_SIZE), Math.floor(sy / TILE_SIZE));
      if (key !== srcKey) {
        srcKey = key;
        src = source(key);
      }
      if (!src) continue;
      const s = ((sy % TILE_SIZE) * TILE_SIZE + (sx % TILE_SIZE)) * 4;
      const g = grain ? grain[(y % GRAIN_SIZE) * GRAIN_SIZE + (x % GRAIN_SIZE)]! / 255 : 1;
      const as = (src[s + 3]! / 255) * c * settings.opacity * g;
      if (as <= 0) continue;
      const p = i * 4;
      const ad = out[p + 3]! / 255;
      if (preserveAlpha) {
        if (ad === 0) continue;
        out[p] = out[p]! + (src[s]! - out[p]!) * as;
        out[p + 1] = out[p + 1]! + (src[s + 1]! - out[p + 1]!) * as;
        out[p + 2] = out[p + 2]! + (src[s + 2]! - out[p + 2]!) * as;
      } else {
        const ao = as + ad * (1 - as);
        out[p] = (src[s]! * as + out[p]! * ad * (1 - as)) / ao;
        out[p + 1] = (src[s + 1]! * as + out[p + 1]! * ad * (1 - as)) / ao;
        out[p + 2] = (src[s + 2]! * as + out[p + 2]! * ad * (1 - as)) / ao;
        out[p + 3] = ao * 255;
      }
      changed = true;
    }
  }
  if (!changed) return before;
  for (let p = 3; p < out.length; p += 4) if (out[p] !== 0) return createTile(out);
  return undefined;
}
