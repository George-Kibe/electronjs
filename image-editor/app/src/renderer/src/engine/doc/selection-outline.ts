import { TILE_SIZE, tileKey } from '../tiles/tile';
import type { Mask } from './selection';

/** A pixel counts as selected for the outline at half coverage or more (Photoshop draws ants at 50 %). */
const THRESHOLD = 128;

/** Row `y` of the mask between x0 and x1 as 0/1 flags (one tile lookup per tile, not per pixel). */
function fillRow(mask: Mask, y: number, x0: number, x1: number, out: Uint8Array): void {
  const ty = Math.floor(y / TILE_SIZE);
  const ly = (y - ty * TILE_SIZE) * TILE_SIZE;
  for (let tx = Math.floor(x0 / TILE_SIZE); tx * TILE_SIZE < x1; tx++) {
    const ox = tx * TILE_SIZE;
    const a = Math.max(x0, ox);
    const b = Math.min(x1, ox + TILE_SIZE);
    const tile = mask.tile(tileKey(tx, ty));
    if (!tile) out.fill(0, a - x0, b - x0);
    else if (tile.full) out.fill(1, a - x0, b - x0);
    else for (let x = a; x < b; x++) out[x - x0] = tile.data[ly + x - ox]! >= THRESHOLD ? 1 : 0;
  }
}

/**
 * The selection's edge for the marching ants (FR-SEL-06): every pixel edge between a selected and an
 * unselected pixel, merged into horizontal and vertical runs, as an SVG path in document pixels
 * (`M x y H x` / `M x y V y`). Empty when nothing is selected.
 */
export function selectionOutline(mask: Mask): string {
  const b = mask.bounds();
  if (!b) return '';
  const w = b.x1 - b.x0;
  let prev = new Uint8Array(w);
  let cur = new Uint8Array(w);
  /** Start row of the open vertical run at each column edge (x0 + c), or -1. */
  const vStart = new Int32Array(w + 1).fill(-1);
  const parts: string[] = [];
  for (let y = b.y0; y <= b.y1; y++) {
    if (y < b.y1) fillRow(mask, y, b.x0, b.x1, cur);
    else cur.fill(0);
    // Horizontal edges on the line between rows y - 1 and y.
    let run = -1;
    for (let i = 0; i <= w; i++) {
      const edge = i < w && prev[i] !== cur[i];
      if (edge && run < 0) run = i;
      else if (!edge && run >= 0) {
        parts.push(`M${b.x0 + run} ${y}H${b.x0 + i}`);
        run = -1;
      }
    }
    // Vertical edges between columns, within row y.
    for (let c = 0; c <= w; c++) {
      const left = c > 0 && y < b.y1 ? cur[c - 1]! : 0;
      const right = c < w && y < b.y1 ? cur[c]! : 0;
      const edge = left !== right;
      if (edge && vStart[c]! < 0) vStart[c] = y;
      else if (!edge && vStart[c]! >= 0) {
        parts.push(`M${b.x0 + c} ${vStart[c]}V${y}`);
        vStart[c] = -1;
      }
    }
    [prev, cur] = [cur, prev];
  }
  return parts.join('');
}
