import { TILE_SIZE, type TileKey } from '../tiles/tile';
import type { MaskTiles } from './wand';

/**
 * Paint Bucket (G; FR-PNT-03): `color` poured into `region` on one layer. The region is what the Magic Wand
 * selects from the click (one-byte coverage tiles: same tolerance, contiguous, anti-alias and sampling),
 * limited by the selection's coverage. Normal blending at 100 % in straight alpha (ADR-0003): a pixel of
 * coverage k becomes the colour over the old pixel at opacity k. With transparency locked, the alpha of
 * every pixel stays and only the colour of the pixels that have some changes. Returns the changed tiles.
 */
export function fillRegion(
  layer: ReadonlyMap<TileKey, Uint8Array>,
  region: MaskTiles,
  color: readonly [number, number, number],
  selection: ReadonlyMap<TileKey, Uint8Array> | null,
  preserveAlpha: boolean,
): Array<[TileKey, Uint8Array]> {
  const [cr, cg, cb] = color;
  const out: Array<[TileKey, Uint8Array]> = [];
  for (const [key, cover] of region) {
    const sel = selection ? selection.get(key) : null;
    if (selection && !sel) continue; // outside the selection
    const old = layer.get(key);
    if (!old && preserveAlpha) continue; // nothing to recolour
    const data = old ? new Uint8Array(old) : new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
    let changed = false;
    for (let p = 0; p < TILE_SIZE * TILE_SIZE; p++) {
      const k = sel ? (cover[p]! * sel[p]!) / (255 * 255) : cover[p]! / 255;
      if (k === 0) continue;
      const i = p * 4;
      const da = data[i + 3]! / 255;
      if (preserveAlpha) {
        if (da === 0) continue;
        const r = Math.round(data[i]! + (cr - data[i]!) * k);
        const g = Math.round(data[i + 1]! + (cg - data[i + 1]!) * k);
        const b = Math.round(data[i + 2]! + (cb - data[i + 2]!) * k);
        if (r === data[i] && g === data[i + 1] && b === data[i + 2]) continue;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      } else {
        const a = k + da * (1 - k);
        const r = Math.round((cr * k + data[i]! * da * (1 - k)) / a);
        const g = Math.round((cg * k + data[i + 1]! * da * (1 - k)) / a);
        const b = Math.round((cb * k + data[i + 2]! * da * (1 - k)) / a);
        const a8 = Math.round(a * 255);
        if (r === data[i] && g === data[i + 1] && b === data[i + 2] && a8 === data[i + 3]) continue;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a8;
      }
      changed = true;
    }
    if (changed) out.push([key, data]);
  }
  return out;
}
