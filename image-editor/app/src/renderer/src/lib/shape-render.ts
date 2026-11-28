import type { RGBA, ShapeModel } from '../engine/doc/document';
import { arrowPaths, shapeBounds, shapePath } from '../engine/shape/shape';
import { createTile, parseTileKey, TILE_SIZE, TileGrid, tileKeysInRect } from '../engine/tiles/tile';

/**
 * The page's shape renderer (FR-PNT-08): the engine's path data drawn with Path2D onto 256 px tile
 * canvases, so nothing canvas-sized is allocated. Strokes inside or outside the outline are drawn at twice
 * the width, clipped to the inside or with the inside cleared; dashes scale with the stroke width.
 */

const css = (c: RGBA) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

let tileCanvas: OffscreenCanvas | null = null;

export function renderShape(shape: ShapeModel, origin: { x: number; y: number }): TileGrid {
  const path = new Path2D(shapePath(shape));
  const arrows = arrowPaths(shape).map((d) => new Path2D(d));
  const b = shapeBounds(shape);
  const fill = shape.fill.type === 'solid' && shape.fill.color ? shape.fill.color : null;
  const stroke = shape.stroke && shape.stroke.width > 0 ? shape.stroke : null;
  const tiles = new TileGrid();
  if (!fill && !stroke) return tiles;
  tileCanvas ??= new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = tileCanvas.getContext('2d', { willReadFrequently: true })!;
  for (const key of tileKeysInRect(origin.x + b.x0, origin.y + b.y0, origin.x + b.x1, origin.y + b.y1)) {
    const [tx, ty] = parseTileKey(key);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.save();
    ctx.translate(origin.x - tx * TILE_SIZE, origin.y - ty * TILE_SIZE);
    const strokePath = (width: number) => {
      ctx.lineWidth = width;
      ctx.lineJoin = 'miter';
      const dotted = stroke!.dash && stroke!.dash[0]! < 0.5;
      ctx.lineCap = dotted ? 'round' : 'butt';
      ctx.setLineDash(stroke!.dash ? stroke!.dash.map((d) => d * stroke!.width) : []);
      ctx.strokeStyle = css(stroke!.color);
      ctx.stroke(path);
    };
    if (stroke?.align === 'outside') {
      // The outer half of a double-width stroke: draw it, clear the inside, then fill.
      strokePath(stroke.width * 2);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill(path);
      ctx.globalCompositeOperation = 'source-over';
      if (fill) {
        ctx.fillStyle = css(fill);
        ctx.fill(path);
      }
    } else {
      if (fill) {
        ctx.fillStyle = css(fill);
        ctx.fill(path);
      }
      if (stroke?.align === 'inside') {
        ctx.save();
        ctx.clip(path);
        strokePath(stroke.width * 2);
        ctx.restore();
      } else if (stroke) strokePath(stroke.width);
    }
    if (stroke)
      for (const a of arrows) {
        ctx.fillStyle = css(stroke.color);
        ctx.fill(a);
      }
    ctx.restore();
    const image = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    let any = false;
    for (let i = 3; i < image.data.length; i += 4)
      if (image.data[i] !== 0) {
        any = true;
        break;
      }
    if (any) tiles.set(key, createTile(new Uint8ClampedArray(image.data.buffer)));
  }
  return tiles;
}
